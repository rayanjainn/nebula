"""
PyTorch Dataset and DataLoader utilities for Nebula Enhanced.
"""
import json
import sys
import numpy as np
from pathlib import Path
from typing import List, Optional, Tuple

import torch
from torch.utils.data import Dataset, DataLoader

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "nebula"))

from pipeline.preprocessor import SpeakeasyPreprocessor


def _encode_texts(tokenizer, texts: List[str], seq_len: int) -> np.ndarray:
    """Encode texts one-by-one (BPE tokenizer doesn't support true batching)."""
    rows = []
    for text in texts:
        arr = np.array(tokenizer.encode(text)).flatten()[:seq_len]
        if len(arr) < seq_len:
            arr = np.pad(arr, (0, seq_len - len(arr)))
        rows.append(arr)
    return np.stack(rows, axis=0)


def _cache_path(jsonl_path: str) -> Path:
    p = Path(jsonl_path)
    return p.parent / f".cache_{p.stem}.npz"


def _load_preprocessed(jsonl_path: str, tokenizer, seq_len: int):
    """Load from disk cache if available and file hasn't changed, else recompute."""
    src = Path(jsonl_path)
    cache = _cache_path(jsonl_path)
    src_mtime = src.stat().st_mtime

    if cache.exists():
        try:
            data = np.load(cache, allow_pickle=True)
            if float(data["mtime"]) == src_mtime:
                print(f"[dataset] Loaded cache ({len(data['labels'])} rows) from {cache.name}")
                return data["encoded"], data["labels"].tolist(), [t.item() for t in data["labels"]]
        except Exception:
            pass

    print(f"[dataset] Preprocessing {src.name} … (will cache for next run)")
    preprocessor = SpeakeasyPreprocessor()
    texts, labels = [], []
    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            label = int(row.get("label", -1))
            if label not in (0, 1):
                continue
            texts.append(preprocessor.process_row(row))
            labels.append(label)

    print(f"[dataset] Encoding {len(texts)} texts …")
    encoded = _encode_texts(tokenizer, texts, seq_len)
    np.savez_compressed(cache, encoded=encoded, labels=np.array(labels), mtime=np.float64(src_mtime))
    print(f"[dataset] Cached to {cache.name}")
    return encoded, labels, labels


class MalwareDataset(Dataset):
    def __init__(self, encoded: np.ndarray, labels: List[int]):
        self.encoded = encoded
        self.labels = np.array(labels, dtype=np.float32)

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, idx):
        return (
            torch.tensor(self.encoded[idx], dtype=torch.long),
            torch.tensor(self.labels[idx], dtype=torch.float32),
        )


def build_dataloaders(
    train_enc: np.ndarray, train_labels: List[int],
    val_enc: np.ndarray,   val_labels: List[int],
    batch_size: int = 32,
    num_workers: int = 0,
) -> Tuple[DataLoader, DataLoader]:
    train_ds = MalwareDataset(train_enc, train_labels)
    val_ds   = MalwareDataset(val_enc,   val_labels)
    return (
        DataLoader(train_ds, batch_size=batch_size, shuffle=True,  num_workers=num_workers),
        DataLoader(val_ds,   batch_size=batch_size, shuffle=False, num_workers=num_workers),
    )


def load_jsonl_split(
    jsonl_path: str,
    tokenizer,
    seq_len: int = 512,
    max_samples: Optional[int] = None,
    val_ratio: float = 0.15,
    random_seed: int = 42,
    balance: bool = True,
    max_per_class: Optional[int] = None,
) -> Tuple[DataLoader, DataLoader, List[str], List[int]]:
    import random
    random.seed(random_seed)
    np.random.seed(random_seed)

    encoded, labels, _ = _load_preprocessed(jsonl_path, tokenizer, seq_len)

    # Balance classes by downsampling to minority class size (or max_per_class)
    if balance:
        labels_arr = np.array(labels)
        idx0 = np.where(labels_arr == 0)[0].tolist()
        idx1 = np.where(labels_arr == 1)[0].tolist()
        random.shuffle(idx0)
        random.shuffle(idx1)
        cap = max_per_class or min(len(idx0), len(idx1))
        idx0 = idx0[:cap]
        idx1 = idx1[:cap]
        combined = sorted(idx0 + idx1)
        random.shuffle(combined)
        encoded = encoded[combined]
        labels  = [labels[i] for i in combined]
        print(f"[dataset] Balanced: {len(idx0)} benign + {len(idx1)} malicious = {len(labels)} total")

    if max_samples:
        encoded = encoded[:max_samples]
        labels  = labels[:max_samples]

    idx = list(range(len(labels)))
    random.shuffle(idx)
    encoded = encoded[idx]
    labels  = [labels[i] for i in idx]

    split = int(len(labels) * (1 - val_ratio))
    train_loader, val_loader = build_dataloaders(
        encoded[:split], labels[:split],
        encoded[split:], labels[split:],
    )
    return train_loader, val_loader, [], labels
