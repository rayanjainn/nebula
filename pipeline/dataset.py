"""
PyTorch Dataset and DataLoader utilities for Nebula Enhanced.
Supports both local JSONL files and HuggingFace streaming.
"""
import json
import sys
import numpy as np
from pathlib import Path
from typing import List, Optional, Tuple, Dict

import torch
from torch.utils.data import Dataset, DataLoader

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "nebula"))

from pipeline.preprocessor import SpeakeasyPreprocessor


class MalwareDataset(Dataset):
    """
    PyTorch dataset over preprocessed (text, label) pairs.
    Handles encoding via the provided tokenizer.
    """

    def __init__(
        self,
        texts: List[str],
        labels: List[int],
        tokenizer,
        seq_len: int = 512,
    ):
        self.seq_len = seq_len
        self.tokenizer = tokenizer

        assert len(texts) == len(labels)
        self.encoded = tokenizer.encode(texts, pad=True)  # (N, seq_len)
        self.labels = np.array(labels, dtype=np.float32)

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, idx):
        x = torch.tensor(self.encoded[idx], dtype=torch.long)
        y = torch.tensor(self.labels[idx], dtype=torch.float32)
        return x, y


class JSONLDataset(Dataset):
    """
    Lazy-loading dataset from a .jsonl file.
    Lines are preprocessed and encoded on first access.
    """

    def __init__(
        self,
        jsonl_path: str,
        tokenizer,
        seq_len: int = 512,
        label_key: str = "label",
        max_samples: Optional[int] = None,
        preprocessor: Optional[SpeakeasyPreprocessor] = None,
    ):
        self.tokenizer = tokenizer
        self.seq_len = seq_len
        self.preprocessor = preprocessor or SpeakeasyPreprocessor()

        self.texts: List[str] = []
        self.labels: List[int] = []
        self.meta: List[Dict] = []

        with open(jsonl_path) as f:
            for i, line in enumerate(f):
                if max_samples and i >= max_samples:
                    break
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                text = self.preprocessor.process_row(row)
                label = int(row.get(label_key, -1))
                self.texts.append(text)
                self.labels.append(label)
                self.meta.append({
                    "ep_type": row.get("ep_type", "module_entry"),
                    "apihash": row.get("apihash", ""),
                })

        # encode all at once (faster)
        self._encoded = tokenizer.encode(self.texts, pad=True)

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, idx):
        x = torch.tensor(self._encoded[idx], dtype=torch.long)
        y = torch.tensor(self.labels[idx], dtype=torch.float32)
        return x, y

    def get_texts(self) -> List[str]:
        return self.texts

    def get_labels(self) -> List[int]:
        return self.labels


def build_dataloaders(
    train_texts: List[str],
    train_labels: List[int],
    val_texts: List[str],
    val_labels: List[int],
    tokenizer,
    seq_len: int = 512,
    batch_size: int = 32,
    num_workers: int = 0,
) -> Tuple[DataLoader, DataLoader]:

    train_ds = MalwareDataset(train_texts, train_labels, tokenizer, seq_len)
    val_ds = MalwareDataset(val_texts, val_labels, tokenizer, seq_len)

    train_loader = DataLoader(
        train_ds, batch_size=batch_size, shuffle=True,
        num_workers=num_workers, pin_memory=False
    )
    val_loader = DataLoader(
        val_ds, batch_size=batch_size, shuffle=False,
        num_workers=num_workers, pin_memory=False
    )
    return train_loader, val_loader


def load_jsonl_split(
    jsonl_path: str,
    tokenizer,
    seq_len: int = 512,
    max_samples: Optional[int] = None,
    val_ratio: float = 0.15,
    random_seed: int = 42,
) -> Tuple[DataLoader, DataLoader, List[str], List[int]]:
    """Load a JSONL file and split into train/val DataLoaders."""
    import random
    random.seed(random_seed)
    np.random.seed(random_seed)

    preprocessor = SpeakeasyPreprocessor()
    texts, labels = [], []

    with open(jsonl_path) as f:
        for i, line in enumerate(f):
            if max_samples and i >= max_samples:
                break
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            text = preprocessor.process_row(row)
            label = int(row.get("label", 0))
            texts.append(text)
            labels.append(label)

    # shuffle
    idx = list(range(len(texts)))
    random.shuffle(idx)
    texts = [texts[i] for i in idx]
    labels = [labels[i] for i in idx]

    split = int(len(texts) * (1 - val_ratio))
    train_t, val_t = texts[:split], texts[split:]
    train_l, val_l = labels[:split], labels[split:]

    train_loader, val_loader = build_dataloaders(
        train_t, train_l, val_t, val_l, tokenizer, seq_len
    )
    return train_loader, val_loader, texts, labels
