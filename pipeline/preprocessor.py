"""
Data preprocessing pipeline for Nebula Enhanced.

Implements the full ψ(z) → z' pipeline from the paper:
  1. Field filtering (APIs, file, network, registry)
  2. Normalization (IPs, hashes, paths, domains)
  3. Flattening to text sequence for tokenization
"""
import re
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Union

_NEBULA_PATH = str(Path(__file__).parent.parent.parent / "nebula")
sys.path.insert(0, _NEBULA_PATH)

# Import normalization functions directly to avoid nebula __init__ pulling in unicorn/pefile
try:
    import importlib.util as _ilu
    _norm_spec = _ilu.spec_from_file_location(
        "nebula_normalization",
        Path(_NEBULA_PATH) / "nebula" / "preprocessing" / "normalization.py",
    )
    _norm_mod = _ilu.module_from_spec(_norm_spec)  # type: ignore
    _norm_spec.loader.exec_module(_norm_mod)  # type: ignore
    normalizeStringHash = _norm_mod.normalizeStringHash
    normalizeStringIP = _norm_mod.normalizeStringIP
    normalizeStringPath = _norm_mod.normalizeStringPath
    normalizeStringDomain = _norm_mod.normalizeStringDomain
except Exception:
    # Fallback: simple regex normalizers
    def normalizeStringHash(s: str) -> str:
        import re
        return re.sub(r'[0-9a-fA-F]{32,}', '<hash>', s)
    def normalizeStringIP(s: str) -> str:
        import re
        return re.sub(r'\b\d{1,3}(?:\.\d{1,3}){3}\b', '<ip>', s)
    def normalizeStringPath(s: str) -> str:
        import re
        s = re.sub(r'[C-Fc-f]:\\', '<drive>\\', s)
        s = re.sub(r'[Uu]sers\\[^\\]+\\', 'users\\<user>\\', s)
        return s
    def normalizeStringDomain(s: str) -> str:
        import re
        return re.sub(r'\b[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}\b', '<domain>', s)


# Windows env var expansion map (subset of nebula constants)
VARIABLE_MAP = {
    "%windir%": "c:\\windows",
    "%systemroot%": "c:\\windows",
    "%programfiles%": "c:\\program files",
    "%programfiles(x86)%": "c:\\program files (x86)",
    "%userprofile%": "c:\\users\\<user>",
    "%appdata%": "c:\\users\\<user>\\appdata\\roaming",
    "%localappdata%": "c:\\users\\<user>\\appdata\\local",
    "%temp%": "c:\\users\\<user>\\appdata\\local\\temp",
    "%tmp%": "c:\\users\\<user>\\appdata\\local\\temp",
    "%systemdrive%": "c:",
}

JSON_CLEANUP = ['"', "'", ":", ",", "[", "]", "{", "}", "\\", "/"]
STOPWORDS = ["api_name", "args", "ret_val", "event", "path", "open_flags",
             "access_flags", "size", "server", "proto", "port", "method"]


class SpeakeasyPreprocessor:
    """
    Preprocesses raw Speakeasy HuggingFace dataset rows into normalized text.

    Each row in the HF dataset represents one entry_point. This class:
      - Extracts relevant fields (APIs, file_access, network_events)
      - Normalizes stochastic values (IPs, hashes, paths)
      - Flattens to a single text string suitable for tokenization
    """

    def __init__(self, normalize: bool = True, include_args: bool = True):
        self.normalize = normalize
        self.include_args = include_args

    def _normalize_value(self, val: str) -> str:
        val = str(val).lower()
        val = normalizeStringHash(val)
        val = normalizeStringIP(val)
        val = normalizeStringDomain(val)
        try:
            val = normalizeStringPath(val)
        except Exception:
            pass
        return val

    def _extract_apis(self, apis: Optional[List[Dict]]) -> List[str]:
        if not apis:
            return []
        tokens = []
        for api in apis:
            name = api.get("api_name", "")
            if name:
                tokens.append(name.lower())
            if self.include_args:
                for arg in (api.get("args") or []):
                    tokens.append(str(arg).lower())
                ret = api.get("ret_val")
                if ret is not None:
                    tokens.append(str(ret).lower())
        return tokens

    def _extract_file_access(self, file_access) -> List[str]:
        if not file_access:
            return []
        tokens = []
        if isinstance(file_access, list):
            entries = file_access
        elif isinstance(file_access, dict):
            entries = [file_access]
        else:
            return []
        for entry in entries:
            if not isinstance(entry, dict):
                if isinstance(entry, str):
                    tokens.append(self._normalize_value(entry))
                continue
            evt = entry.get("event", "")
            path = entry.get("path", "")
            if evt:
                tokens.append(str(evt).lower())
            if path:
                norm = self._normalize_value(str(path))
                tokens.append(norm)
        return tokens

    def _extract_network(self, network_events) -> List[str]:
        if not network_events:
            return []
        tokens = []
        traffic = network_events.get("traffic", []) if isinstance(network_events, dict) else []
        for t in (traffic or []):
            server = t.get("server", "")
            port = t.get("port", "")
            if server:
                norm = self._normalize_value(str(server))
                tokens.append(norm)
            if port:
                tokens.append(str(port))
        dns = network_events.get("dns", []) if isinstance(network_events, dict) else []
        for d in (dns or []):
            name = d.get("query", "") if isinstance(d, dict) else str(d)
            if name:
                norm = self._normalize_value(str(name))
                tokens.append(norm)
        return tokens

    def process_row(self, row: Dict) -> str:
        """Convert a single HF dataset row to a normalized text string."""
        tokens = []

        tokens.extend(self._extract_apis(row.get("apis")))
        tokens.extend(self._extract_file_access(row.get("file_access")))
        tokens.extend(self._extract_network(row.get("network_events")))

        text = " ".join(tokens)
        # clean JSON-like symbols
        for sym in JSON_CLEANUP:
            text = text.replace(sym, " ")
        # collapse whitespace
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def process_batch(self, rows: List[Dict]) -> List[str]:
        return [self.process_row(r) for r in rows]

    def process_jsonl(self, path: str) -> List[Dict]:
        """
        Read a .jsonl file and return list of {text, label, ep_type} dicts.
        Label comes from 'label' field if present, else inferred from structure.
        """
        results = []
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                text = self.process_row(row)
                label = row.get("label", -1)
                ep_type = row.get("ep_type", "module_entry")
                results.append({"text": text, "label": label, "ep_type": ep_type, "raw": row})
        return results


class ReportPreprocessor:
    """Preprocesses raw JSON report files (from emulation/ folder)."""

    def __init__(self):
        self.sp = SpeakeasyPreprocessor()

    def process_file(self, path: str) -> Dict:
        with open(path) as f:
            data = json.load(f)

        if isinstance(data, list):
            entry_points = data
        elif isinstance(data, dict) and "entry_points" in data:
            entry_points = data["entry_points"]
        else:
            entry_points = [data]

        texts = []
        for ep in entry_points:
            text = self.sp.process_row(ep)
            if text.strip():
                texts.append(text)

        combined = " ".join(texts)
        return {
            "text": combined,
            "n_entry_points": len(entry_points),
            "ep_types": [ep.get("ep_type", "unknown") for ep in entry_points],
            "raw": data,
        }
