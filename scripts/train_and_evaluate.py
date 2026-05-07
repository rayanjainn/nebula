"""
Full training + evaluation script for Nebula Enhanced.
Trains both NebulaEnhanced and NebulaPaper baseline, saves all metrics to data/training_results.json
"""
import sys, os, json, time, warnings
warnings.filterwarnings("ignore")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from config import MODEL_CONFIG, TRAIN_CONFIG
from models.nebula_enhanced import NebulaEnhanced, NebulaPaper
from pipeline.tokenizer_utils import load_tokenizer
from pipeline.trainer import NebulaTrainer

import torch
import numpy as np
from torch.utils.data import DataLoader, TensorDataset
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    roc_auc_score, f1_score, accuracy_score, roc_curve,
    confusion_matrix, precision_score, recall_score,
    average_precision_score, precision_recall_curve
)

# ── helpers ──────────────────────────────────────────────────

def encode_jsonl(path, tokenizer, seq_len):
    """Read merged_dataset.jsonl → (X: ndarray, y: list)"""
    from pipeline.preprocessor import SpeakeasyPreprocessor
    import json as _json
    pp = SpeakeasyPreprocessor()
    texts, labels = [], []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = _json.loads(line)
            if row.get("label", -1) < 0:
                continue
            text = pp.process_row(row)
            ids = tokenizer.encode(text)
            # tokenizer returns (1, seq_len) array
            if hasattr(ids, "shape") and len(ids.shape) == 2:
                ids = ids[0]
            ids = list(ids)[:seq_len]
            ids += [0] * (seq_len - len(ids))
            texts.append(ids)
            labels.append(int(row["label"]))
    return np.array(texts, dtype=np.int64), np.array(labels, dtype=np.float32)


def make_loaders(X, y, batch_size=32, val_ratio=0.2, seed=42):
    X_tr, X_val, y_tr, y_val = train_test_split(
        X, y, test_size=val_ratio, random_state=seed, stratify=y
    )
    def loader(Xd, yd, shuffle):
        ds = TensorDataset(torch.from_numpy(Xd), torch.from_numpy(yd))
        return DataLoader(ds, batch_size=batch_size, shuffle=shuffle, num_workers=0)
    return loader(X_tr, y_tr, True), loader(X_val, y_val, False), X_tr, X_val, y_tr, y_val


def evaluate_model(model, loader, device):
    model.eval()
    all_logits, all_labels = [], []
    with torch.no_grad():
        for x, y in loader:
            x = x.to(device)
            logits = model(x).squeeze(-1).cpu().numpy()
            all_logits.append(logits)
            all_labels.append(y.numpy())
    logits = np.concatenate(all_logits)
    labels = np.concatenate(all_labels)
    probs  = 1 / (1 + np.exp(-logits))
    preds  = (probs >= 0.5).astype(int)

    auc   = roc_auc_score(labels, probs)
    f1    = f1_score(labels, preds, zero_division=0)
    acc   = accuracy_score(labels, preds)
    prec  = precision_score(labels, preds, zero_division=0)
    rec   = recall_score(labels, preds, zero_division=0)
    ap    = average_precision_score(labels, probs)
    cm    = confusion_matrix(labels, preds).tolist()
    fpr, tpr, roc_thresh = roc_curve(labels, probs)
    pr_prec, pr_rec, pr_thresh = precision_recall_curve(labels, probs)
    idx = min(np.searchsorted(fpr, 1e-3), len(tpr) - 1)
    tpr1e3 = float(tpr[idx])

    # sample ROC / PR to 200 points max
    step = max(1, len(fpr) // 200)
    return {
        "auc": round(auc, 4), "f1": round(f1, 4), "accuracy": round(acc, 4),
        "precision": round(prec, 4), "recall": round(rec, 4),
        "average_precision": round(ap, 4), "tpr_at_fpr1e3": round(tpr1e3, 4),
        "confusion_matrix": cm,
        "roc": {"fpr": fpr[::step].tolist(), "tpr": tpr[::step].tolist()},
        "pr_curve": {"precision": pr_prec[::step].tolist(), "recall": pr_rec[::step].tolist()},
        "probs": probs.tolist(), "labels": labels.tolist(),
    }


# ── main ─────────────────────────────────────────────────────

def main():
    SEQ_LEN = MODEL_CONFIG["seq_len"]
    BATCH   = TRAIN_CONFIG["batch_size"]
    EPOCHS  = TRAIN_CONFIG["epochs"]
    BUDGET  = TRAIN_CONFIG["time_budget_minutes"]
    device  = "mps" if torch.backends.mps.is_available() else "cpu"

    print("=" * 62)
    print("  NEBULA ENHANCED — FULL TRAINING & EVALUATION")
    print("=" * 62)
    print(f"  Device: {device} | Epochs: {EPOCHS} | Budget: {BUDGET}min")

    # 1. tokenizer
    print("\n[1/6] Loading BPE tokenizer (vocab=50k)…")
    tok = load_tokenizer("bpe", SEQ_LEN)
    print("      ✓ done")

    # 2. encode dataset
    print("\n[2/6] Encoding dataset…")
    data_path = os.path.join(ROOT, "data", "merged_dataset.jsonl")
    X, y = encode_jsonl(data_path, tok, SEQ_LEN)
    print(f"      ✓ {len(X)} samples | shape {X.shape}")
    print(f"      ✓ malicious: {int(y.sum())} ({y.mean():.1%}) | benign: {int((y==0).sum())}")

    # 3. dataloaders
    print("\n[3/6] Splitting train/val (80/20 stratified)…")
    train_loader, val_loader, X_tr, X_val, y_tr, y_val = make_loaders(X, y, BATCH)
    print(f"      ✓ train: {len(X_tr)} ({int(y_tr.sum())} mal) | val: {len(X_val)} ({int(y_val.sum())} mal)")

    # 4. train NebulaEnhanced
    print("\n[4/6] Training NebulaEnhanced…")
    model_e = NebulaEnhanced(**MODEL_CONFIG)
    print(f"      Parameters: {model_e.count_parameters():,}")
    trainer_e = NebulaTrainer(
        model_e, device=device,
        lr=TRAIN_CONFIG["lr"], weight_decay=TRAIN_CONFIG["weight_decay"],
        grad_clip=TRAIN_CONFIG["grad_clip"], label_smoothing=0.05,
        checkpoint_dir=os.path.join(ROOT, "models", "checkpoints"),
        run_name="nebula_run",
    )
    t0 = time.time()
    history_e = trainer_e.train(train_loader, val_loader,
                                epochs=EPOCHS, time_budget_minutes=BUDGET, verbose=True)
    elapsed_e = time.time() - t0
    print(f"\n      ✓ done in {elapsed_e/60:.1f}m | best AUC: {max(history_e['val_auc']):.4f} @ epoch {trainer_e.best_epoch}")

    # 5. train NebulaPaper baseline
    print("\n[5/6] Training NebulaPaper baseline…")
    paper_cfg = {k: v for k, v in MODEL_CONFIG.items()
                 if k not in ("norm_first", "learnable_pe", "pooling")}
    model_p = NebulaPaper(**paper_cfg)
    print(f"      Parameters: {model_p.count_parameters():,}")
    trainer_p = NebulaTrainer(
        model_p, device=device,
        lr=TRAIN_CONFIG["lr"], weight_decay=TRAIN_CONFIG["weight_decay"],
        checkpoint_dir=os.path.join(ROOT, "models", "checkpoints"),
        run_name="nebula_paper",
    )
    t1 = time.time()
    history_p = trainer_p.train(train_loader, val_loader,
                                epochs=EPOCHS, time_budget_minutes=BUDGET, verbose=True)
    elapsed_p = time.time() - t1
    print(f"\n      ✓ done in {elapsed_p/60:.1f}m | best AUC: {max(history_p['val_auc']):.4f}")

    # 6. evaluate
    print("\n[6/6] Full evaluation…")
    trainer_e.load_best()
    trainer_p.load_best()

    metrics_e = evaluate_model(model_e, val_loader, device)
    metrics_p = evaluate_model(model_p, val_loader, device)

    tn, fp_, fn, tp = (metrics_e["confusion_matrix"][0][0], metrics_e["confusion_matrix"][0][1],
                       metrics_e["confusion_matrix"][1][0], metrics_e["confusion_matrix"][1][1])

    results = {
        "enhanced": {**metrics_e, "train_history": history_e,
                     "elapsed_minutes": round(elapsed_e/60, 2),
                     "parameters": model_e.count_parameters()},
        "paper_baseline": {**metrics_p, "train_history": history_p,
                           "elapsed_minutes": round(elapsed_p/60, 2),
                           "parameters": model_p.count_parameters()},
        "dataset": {
            "total": len(X), "train": len(X_tr), "val": len(X_val),
            "train_malicious": int(y_tr.sum()), "val_malicious": int(y_val.sum()),
            "malicious_pct": round(float(y.mean()) * 100, 1),
        },
        "model_config": MODEL_CONFIG,
        "train_config": TRAIN_CONFIG,
        "device": device,
        "timestamp": time.time(),
    }

    out = os.path.join(ROOT, "data", "training_results.json")
    with open(out, "w") as f:
        json.dump(results, f, indent=2)

    # print table
    print("\n" + "=" * 62)
    print(f"  {'Metric':<30} {'Enhanced':>10}  {'Baseline':>10}")
    print(f"  {'-'*52}")
    for name, ke, kp in [
        ("AUC-ROC",           "auc",              "auc"),
        ("F1 Score",          "f1",               "f1"),
        ("Accuracy",          "accuracy",         "accuracy"),
        ("Precision",         "precision",        "precision"),
        ("Recall",            "recall",           "recall"),
        ("Avg Precision (AP)","average_precision","average_precision"),
        ("TPR @ FPR=1e-3",    "tpr_at_fpr1e3",    "tpr_at_fpr1e3"),
    ]:
        ve = metrics_e.get(ke, "N/A")
        vp = metrics_p.get(kp, "N/A")
        fmt = lambda v: f"{v:.4f}" if isinstance(v, float) else str(v)
        print(f"  {name:<30} {fmt(ve):>10}  {fmt(vp):>10}")
    print(f"\n  Confusion Matrix (Enhanced)")
    print(f"    True Neg={tn}  False Pos={fp_}")
    print(f"    False Neg={fn}  True Pos={tp}")
    print(f"\n  ✓ Results saved → {out}")
    print("=" * 62)


if __name__ == "__main__":
    main()
