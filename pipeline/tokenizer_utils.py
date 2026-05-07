"""
Tokenizer wrapper — loads BPE or Whitespace tokenizer from original Nebula repo.
Imports tokenization module directly to avoid nebula/__init__ pulling in unicorn/pefile.
"""
import sys
import json
import importlib.util
from pathlib import Path
from typing import List, Union

_NEBULA_ROOT = Path(__file__).parent.parent.parent / "nebula"

def _load_tokenization_module():
    """Load nebula.preprocessing.tokenization without triggering nebula/__init__."""
    import types

    # Stub all problematic native dependencies before any imports
    stub_specs = {
        "pefile": {"PEFormatError": Exception},
        "unicorn": {"UcError": Exception},
        "capstone": {"CsError": Exception},
        "speakeasy": {},
        "speakeasy.errors": {},
    }
    for stub_name, attrs in stub_specs.items():
        if stub_name not in sys.modules:
            m = types.ModuleType(stub_name)
            for k, v in attrs.items():
                setattr(m, k, v)
            sys.modules[stub_name] = m
    # Make speakeasy.errors accessible as attribute
    if hasattr(sys.modules.get("speakeasy"), "errors") is False:
        sys.modules["speakeasy"].errors = sys.modules["speakeasy.errors"]  # type: ignore

    # Add nebula root to path so "from nebula.X import Y" resolves via files
    nebula_root_str = str(_NEBULA_ROOT)
    if nebula_root_str not in sys.path:
        sys.path.insert(0, nebula_root_str)

    # Pre-register nebula package pointing to the directory
    if "nebula" not in sys.modules:
        nebula_pkg = types.ModuleType("nebula")
        nebula_pkg.__path__ = [str(_NEBULA_ROOT / "nebula")]  # type: ignore
        nebula_pkg.__package__ = "nebula"
        sys.modules["nebula"] = nebula_pkg

    # Load constants directly
    constants_path = _NEBULA_ROOT / "nebula" / "constants.py"
    if "nebula.constants" not in sys.modules and constants_path.exists():
        spec = importlib.util.spec_from_file_location("nebula.constants", constants_path)
        cmod = importlib.util.module_from_spec(spec)  # type: ignore
        cmod.__package__ = "nebula"
        sys.modules["nebula.constants"] = cmod
        try:
            spec.loader.exec_module(cmod)  # type: ignore
        except Exception:
            pass  # partial load is fine

    # Load tokenization
    tok_path = _NEBULA_ROOT / "nebula" / "preprocessing" / "tokenization.py"
    if "nebula.preprocessing" not in sys.modules:
        prep_pkg = types.ModuleType("nebula.preprocessing")
        prep_pkg.__path__ = [str(_NEBULA_ROOT / "nebula" / "preprocessing")]  # type: ignore
        sys.modules["nebula.preprocessing"] = prep_pkg

    spec = importlib.util.spec_from_file_location("nebula.preprocessing.tokenization", tok_path)
    mod = importlib.util.module_from_spec(spec)  # type: ignore
    mod.__package__ = "nebula.preprocessing"
    sys.modules["nebula.preprocessing.tokenization"] = mod
    spec.loader.exec_module(mod)  # type: ignore
    return mod

_tok_mod = _load_tokenization_module()
JSONTokenizerBPE = _tok_mod.JSONTokenizerBPE
JSONTokenizerNaive = _tok_mod.JSONTokenizerNaive


def load_tokenizer(tokenizer_type: str = "bpe", seq_len: int = 512):
    """
    Load a pre-trained tokenizer from the nebula repo artifacts.

    Args:
        tokenizer_type: "bpe" or "whitespace"
        seq_len: maximum sequence length

    Returns:
        tokenizer instance with .encode() and .decode() methods
    """
    repo_objects = Path(__file__).parent.parent.parent / "nebula" / "nebula" / "objects"

    if tokenizer_type == "bpe":
        model_path = str(repo_objects / "bpe_50000_sentencepiece.model")
        vocab_path = str(repo_objects / "bpe_50000_vocab.json")
        tokenizer = JSONTokenizerBPE(
            vocab_size=50000,
            seq_len=seq_len,
            model_path=model_path,
            vocab=vocab_path,
        )
    elif tokenizer_type == "whitespace":
        vocab_path = str(repo_objects / "whitespace_50000_vocab.json")
        tokenizer = JSONTokenizerNaive(
            vocab_size=50000,
            seq_len=seq_len,
            vocab=vocab_path,
            type="whitespace",
        )
    else:
        raise ValueError(f"Unknown tokenizer type: {tokenizer_type}")

    return tokenizer


def get_vocab_size(tokenizer) -> int:
    if hasattr(tokenizer, "vocab") and tokenizer.vocab:
        return len(tokenizer.vocab)
    return 50000
