"""
Training pipeline for Nebula Enhanced.
Supports time-budgeted training, cross-validation, checkpointing, and metrics.
"""
import os
import sys
import time
import json
import logging
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
from torch.optim import AdamW
from torch.utils.data import DataLoader
from sklearn.metrics import (
    f1_score, roc_auc_score, accuracy_score,
    roc_curve, confusion_matrix
)

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "nebula"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


class EarlyStopping:
    def __init__(self, patience: int = 5, min_delta: float = 1e-4):
        self.patience = patience
        self.min_delta = min_delta
        self.counter = 0
        self.best_score: Optional[float] = None
        self.should_stop = False

    def __call__(self, score: float) -> bool:
        if self.best_score is None or score > self.best_score + self.min_delta:
            self.best_score = score
            self.counter = 0
        else:
            self.counter += 1
            if self.counter >= self.patience:
                self.should_stop = True
        return self.should_stop


class NebulaTrainer:
    """
    Full training pipeline with:
    - AdamW optimizer (paper default)
    - Cosine LR schedule with warmup
    - Gradient clipping
    - Time-budgeted training (paper uses 15min/fold)
    - Checkpointing best model by val AUC
    - Detailed per-epoch metrics
    """

    def __init__(
        self,
        model: nn.Module,
        device: Optional[str] = None,
        lr: float = 2.5e-4,
        weight_decay: float = 1e-2,
        grad_clip: float = 1.0,
        label_smoothing: float = 0.05,
        checkpoint_dir: str = "models/checkpoints",
        run_name: str = "nebula_run",
    ):
        self.device = device or ("cuda" if torch.cuda.is_available() else
                                  "mps" if torch.backends.mps.is_available() else "cpu")
        self.model = model.to(self.device)
        self.grad_clip = grad_clip
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        self.run_name = run_name

        self.optimizer = AdamW(
            model.parameters(),
            lr=lr,
            weight_decay=weight_decay,
            betas=(0.9, 0.999),
            eps=1e-8,
        )

        # Label smoothing helps generalization (improvement over paper)
        self.criterion = nn.BCEWithLogitsLoss(
            reduction="mean",
            pos_weight=None,
        )
        self.label_smoothing = label_smoothing

        self.history: Dict[str, List] = {
            "train_loss": [], "val_loss": [],
            "val_auc": [], "val_f1": [], "val_acc": [],
            "val_tpr_at_fpr1e3": [],
            "epoch_times": [],
        }
        self.best_val_auc = 0.0
        self.best_epoch = 0

    def _smooth_labels(self, y: torch.Tensor) -> torch.Tensor:
        if self.label_smoothing > 0:
            return y * (1 - self.label_smoothing) + 0.5 * self.label_smoothing
        return y

    def _get_cosine_schedule(self, n_steps: int, warmup_steps: int = 100):
        def lr_lambda(step):
            if step < warmup_steps:
                return float(step) / float(max(1, warmup_steps))
            progress = float(step - warmup_steps) / float(max(1, n_steps - warmup_steps))
            return max(0.0, 0.5 * (1.0 + np.cos(np.pi * progress)))
        return torch.optim.lr_scheduler.LambdaLR(self.optimizer, lr_lambda)

    def train_epoch(self, loader: DataLoader, scheduler=None) -> float:
        self.model.train()
        total_loss = 0.0
        n_batches = 0

        for x, y in loader:
            x = x.to(self.device)
            y = y.to(self.device)

            self.optimizer.zero_grad()
            logits = self.model(x).squeeze(-1)
            y_smooth = self._smooth_labels(y)
            loss = self.criterion(logits, y_smooth)
            loss.backward()

            nn.utils.clip_grad_norm_(self.model.parameters(), self.grad_clip)
            self.optimizer.step()
            if scheduler:
                scheduler.step()

            total_loss += loss.item()
            n_batches += 1

        return total_loss / max(n_batches, 1)

    @torch.no_grad()
    def evaluate(self, loader: DataLoader) -> Dict:
        self.model.eval()
        all_logits, all_labels = [], []
        total_loss = 0.0
        n_batches = 0

        for x, y in loader:
            x = x.to(self.device)
            y = y.to(self.device)
            logits = self.model(x).squeeze(-1)
            loss = self.criterion(logits, y)
            total_loss += loss.item()
            n_batches += 1
            all_logits.append(logits.cpu().numpy())
            all_labels.append(y.cpu().numpy())

        all_logits = np.concatenate(all_logits)
        all_labels = np.concatenate(all_labels)
        all_probs = 1 / (1 + np.exp(-all_logits))  # sigmoid
        all_preds = (all_probs >= 0.5).astype(int)

        metrics = {
            "loss": total_loss / max(n_batches, 1),
            "acc": accuracy_score(all_labels, all_preds),
            "f1": f1_score(all_labels, all_preds, zero_division=0),
        }

        try:
            metrics["auc"] = roc_auc_score(all_labels, all_probs)
            fpr, tpr, _ = roc_curve(all_labels, all_probs)
            # TPR at FPR=1e-3 (paper metric)
            idx = np.searchsorted(fpr, 1e-3)
            metrics["tpr_at_fpr1e3"] = float(tpr[min(idx, len(tpr) - 1)])
            metrics["fpr_curve"] = fpr.tolist()
            metrics["tpr_curve"] = tpr.tolist()
        except Exception:
            metrics["auc"] = 0.0
            metrics["tpr_at_fpr1e3"] = 0.0

        metrics["probs"] = all_probs.tolist()
        metrics["labels"] = all_labels.tolist()
        return metrics

    def train(
        self,
        train_loader: DataLoader,
        val_loader: DataLoader,
        epochs: int = 10,
        time_budget_minutes: Optional[float] = None,
        save_best: bool = True,
        verbose: bool = True,
    ) -> Dict:
        """
        Train with optional time budget (mimics paper's 15min/fold setup).
        Returns full training history.
        """
        n_steps = epochs * len(train_loader)
        scheduler = self._get_cosine_schedule(n_steps, warmup_steps=min(200, n_steps // 10))

        t_start = time.time()
        budget_secs = time_budget_minutes * 60 if time_budget_minutes else None

        for epoch in range(1, epochs + 1):
            t_epoch = time.time()

            train_loss = self.train_epoch(train_loader, scheduler)
            val_metrics = self.evaluate(val_loader)

            epoch_time = time.time() - t_epoch
            self.history["train_loss"].append(train_loss)
            self.history["val_loss"].append(val_metrics["loss"])
            self.history["val_auc"].append(val_metrics["auc"])
            self.history["val_f1"].append(val_metrics["f1"])
            self.history["val_acc"].append(val_metrics["acc"])
            self.history["val_tpr_at_fpr1e3"].append(val_metrics["tpr_at_fpr1e3"])
            self.history["epoch_times"].append(epoch_time)

            if save_best and val_metrics["auc"] > self.best_val_auc:
                self.best_val_auc = val_metrics["auc"]
                self.best_epoch = epoch
                self.save_checkpoint(epoch, val_metrics, is_best=True)

            if verbose:
                log.info(
                    f"Epoch {epoch:3d} | "
                    f"Loss {train_loss:.4f} | "
                    f"Val AUC {val_metrics['auc']:.4f} | "
                    f"F1 {val_metrics['f1']:.4f} | "
                    f"TPR@FPR1e-3 {val_metrics['tpr_at_fpr1e3']:.4f} | "
                    f"{epoch_time:.1f}s"
                )

            if budget_secs and (time.time() - t_start) >= budget_secs:
                log.info(f"Time budget of {time_budget_minutes:.0f}min reached at epoch {epoch}.")
                break

        return self.history

    def save_checkpoint(self, epoch: int, metrics: Dict, is_best: bool = False):
        name = f"{self.run_name}_best.pt" if is_best else f"{self.run_name}_epoch{epoch}.pt"
        path = self.checkpoint_dir / name
        torch.save({
            "epoch": epoch,
            "model_state_dict": self.model.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "metrics": {k: v for k, v in metrics.items() if k not in ("probs", "labels", "fpr_curve", "tpr_curve")},
        }, path)
        log.info(f"Saved checkpoint: {path}")

    def load_best(self):
        path = self.checkpoint_dir / f"{self.run_name}_best.pt"
        if path.exists():
            ckpt = torch.load(path, map_location=self.device)
            self.model.load_state_dict(ckpt["model_state_dict"])
            log.info(f"Loaded best checkpoint from epoch {ckpt['epoch']}")
        return self.model

    def get_history_json(self) -> str:
        safe = {k: v for k, v in self.history.items()}
        return json.dumps(safe, indent=2)
