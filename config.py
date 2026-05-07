"""Central configuration for Nebula Enhanced."""
import os
from pathlib import Path

ROOT = Path(__file__).parent

# Paths
DATA_DIR = ROOT / "data"
MODELS_DIR = ROOT / "models" / "checkpoints"
LOGS_DIR = ROOT / "logs"
DOCS_DIR = ROOT / "docs"

for d in [DATA_DIR, MODELS_DIR, LOGS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# Nebula original repo path (for reusing vocab/tokenizer artifacts)
NEBULA_REPO = ROOT.parent / "nebula"
NEBULA_OBJECTS = NEBULA_REPO / "nebula" / "objects"

# Dataset
TRAIN_JSONL = DATA_DIR / "speakeasy_train_sample.jsonl"
TEST_JSONL = DATA_DIR / "speakeasy_test_sample.jsonl"
EXAMPLE_REPORTS_DIR = NEBULA_REPO / "emulation"

# Tokenizer artifacts (reuse from original nebula repo)
BPE_MODEL = str(NEBULA_OBJECTS / "bpe_50000_sentencepiece.model")
BPE_VOCAB = str(NEBULA_OBJECTS / "bpe_50000_vocab.json")
WHITESPACE_VOCAB = str(NEBULA_OBJECTS / "whitespace_50000_vocab.json")

# Model hyperparameters (paper defaults + our improvements)
MODEL_CONFIG = {
    "vocab_size": 50000,
    "seq_len": 512,
    "d_model": 64,
    "n_heads": 8,
    "d_hidden": 256,
    "n_layers": 2,
    "dropout": 0.3,
    "num_classes": 1,          # binary detection
    "classifier_head": [64],
    "attention_span": 64,      # chunked attention from paper (S=64, N=512 → M=8 spans)
    "norm_first": True,
}

# Training
TRAIN_CONFIG = {
    "batch_size": 32,
    "lr": 2.5e-4,
    "weight_decay": 1e-2,
    "grad_clip": 1.0,
    "epochs": 10,
    "time_budget_minutes": 15,
    "beta1": 0.9,
    "beta2": 0.999,
    "eps": 1e-8,
    "tokenizer": "bpe",        # "bpe" or "whitespace"
}

# Ollama cloud LLM
OLLAMA_HOST = "https://ollama.com"
OLLAMA_API_KEY = "b240dea1798441f1869c754dd6f4175e.BHR7ANZq-3W18tIztbsRl-Dj"
OLLAMA_MODEL = "gemma3:27b"

# Malware label map (Speakeasy dataset)
LABEL_MAP = {
    "benign": 0,
    "backdoor": 1,
    "coinminer": 2,
    "dropper": 3,
    "keylogger": 4,
    "ransomware": 5,
    "rat": 6,
    "trojan": 7,
}
LABEL_MAP_INV = {v: k for k, v in LABEL_MAP.items()}

# Speakeasy fields to extract (from paper Section 3.1)
SPEAKEASY_FIELDS = [
    "apis",           # API call names, args, ret_val
    "file_access",    # file operation type and path
    "network_events", # network connection port and server
    # registry_access handled via apis in Speakeasy format
]

# Dashboard
DASHBOARD_PORT = 8501
API_PORT = 8000
