"""
XAI (Explainable AI) module for Nebula Enhanced.

Two techniques from the paper (Section 4.6):
  1. Attention weight visualization — from transformer encoder heads
  2. Integrated Gradients (GradientSHAP approximation) — token importance

Plus improvements:
  3. Token-level importance aggregation across heads/layers
  4. Malware behavior pattern matching on important tokens
"""
import sys
import re
import numpy as np
import torch
import torch.nn as nn
from pathlib import Path
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "nebula"))


# Known malicious API patterns from paper Table 11 & domain knowledge
MALICIOUS_PATTERNS = {
    "privilege_escalation": ["advapi32", "setprivilege", "adjusttokenprivileges", "openprocesstoken"],
    "persistence": ["regsetvalue", "regcreatekey", "scheduledtask", "createservice"],
    "network_c2": ["getsockobj", "wsastartup", "connect", "send", "recv", "httpopenrequest"],
    "ransomware": ["cryptencrypt", "cryptgenkey", "setfileattributes", "movefileex"],
    "process_injection": ["virtualalloc", "writeprocessmemory", "createremotethread", "ntunmapviewofsection"],
    "defense_evasion": ["setenvnvar", "isdebuggerpresent", "checkremotedebugger", "ntqueryinformationprocess"],
    "file_ops": ["createfile", "readfile", "writefile", "deletefile", "copyfile"],
    "ui_interaction": ["0xcf0000", "createwindowex", "showwindow", "messagebox"],
}

BENIGN_PATTERNS = ["getcurthread", "findatoma", "heapalloc", "getprocheap", "tlsgetvalue"]


def _decode_tokens(tokenizer, ids_arr: np.ndarray) -> List[str]:
    """Decode a 1-D array of token IDs to a list of string tokens."""
    if hasattr(tokenizer, "vocab") and tokenizer.vocab:
        inv = {v: k for k, v in tokenizer.vocab.items()}
        return [inv.get(int(i), f"<{i}>") for i in ids_arr]
    if hasattr(tokenizer, "decode"):
        decoded = tokenizer.decode(ids_arr)
        if isinstance(decoded, list):
            return [str(t) for t in decoded]
        return decoded.split()
    return [str(i) for i in ids_arr]


def _fallback_token_scores(input_ids: "torch.Tensor", tokenizer) -> List[Tuple[str, float]]:
    """Return uniform token importance when attention is unavailable."""
    ids_arr = input_ids[0].cpu().numpy()
    tokens = _decode_tokens(tokenizer, ids_arr)
    n = max(1, len(tokens))
    return [(t, 1.0 / n) for t in tokens if t not in ("<pad>", "<unk>", "")]


class AttentionVisualizer:
    """Extract and visualize attention weights from transformer layers."""

    def __init__(self, model: nn.Module, device: str = "cpu"):
        self.model = model.eval()
        self.device = device
        self._hooks = []
        self._attn_cache: List[torch.Tensor] = []

    def _register_hooks(self):
        self._attn_cache.clear()

        def make_hook():
            def hook(module, inp, out):
                # Try to get attention weights if available
                if isinstance(out, tuple) and len(out) >= 2 and out[1] is not None:
                    self._attn_cache.append(out[1].detach().cpu())
            return hook

        for name, module in self.model.named_modules():
            if isinstance(module, nn.MultiheadAttention):
                h = module.register_forward_hook(make_hook())
                self._hooks.append(h)

    def _remove_hooks(self):
        for h in self._hooks:
            h.remove()
        self._hooks.clear()

    @torch.no_grad()
    def get_attention_maps(
        self,
        input_ids: torch.Tensor,
    ) -> List[np.ndarray]:
        """
        Returns list of attention weight matrices, one per layer.
        Each is shape (n_heads, seq_len, seq_len).
        """
        self._register_hooks()
        input_ids = input_ids.to(self.device)
        _ = self.model(input_ids)
        self._remove_hooks()

        return [w.numpy() for w in self._attn_cache]

    def get_token_importance_from_attention(
        self,
        input_ids: torch.Tensor,
        tokenizer,
        layer_idx: int = -1,
        head_reduction: str = "mean",
    ) -> List[Tuple[str, float]]:
        """
        Returns (token, importance_score) pairs from attention weights.
        Uses CLS token's attention row (what CLS attends to = importance).
        Prefers model.get_attention_weights() which explicitly requests need_weights=True.
        """
        # Try model's built-in method first (uses need_weights=True on self_attn directly)
        if hasattr(self.model, "get_attention_weights"):
            try:
                with torch.no_grad():
                    attn_list = self.model.get_attention_weights(input_ids.to(self.device))
                if attn_list:
                    # attn_list: list of tensors (B, n_heads, seq_len, seq_len)
                    attn = attn_list[layer_idx][0].cpu().numpy()  # (n_heads, seq_len, seq_len)
                    if head_reduction == "mean":
                        attn_agg = attn.mean(axis=0)
                    else:
                        attn_agg = attn.max(axis=0)
                    cls_attn = attn_agg[0, 1:]  # CLS row, skip position 0

                    ids_arr = input_ids[0].cpu().numpy()
                    tokens = _decode_tokens(tokenizer, ids_arr)

                    pairs = list(zip(tokens, cls_attn.tolist()))
                    pairs_filtered = [(t, s) for t, s in pairs
                                      if t not in ("<pad>", "<unk>", "<mask>", "") and s > 0]
                    return sorted(pairs_filtered, key=lambda x: x[1], reverse=True)[:50]
            except Exception:
                pass  # fall through to hook-based method

        # Fallback: hook-based
        attn_maps = self.get_attention_maps(input_ids)
        if not attn_maps:
            return _fallback_token_scores(input_ids, tokenizer)

        attn = attn_maps[layer_idx]
        attn_agg = attn.mean(axis=0) if head_reduction == "mean" else attn.max(axis=0)
        cls_attn = attn_agg[0, 1:]

        ids_arr = input_ids[0].cpu().numpy()
        tokens = _decode_tokens(tokenizer, ids_arr)

        pairs = list(zip(tokens, cls_attn.tolist()))
        pairs_filtered = [(t, s) for t, s in pairs if t not in ("<pad>", "<unk>", "<mask>", "")]
        return sorted(pairs_filtered, key=lambda x: x[1], reverse=True)[:50]


class IntegratedGradients:
    """
    Integrated Gradients for token importance (paper uses GradientSHAP).

    Computes importance by integrating gradients from a baseline (zero embedding)
    to the actual embedding, approximated with n_steps interpolations.
    """

    def __init__(self, model: nn.Module, device: str = "cpu", n_steps: int = 50):
        self.model = model
        self.device = device
        self.n_steps = n_steps

    def _get_embedding(self, input_ids: torch.Tensor) -> torch.Tensor:
        """Get token embeddings directly."""
        return self.model.embedding(input_ids)

    def compute_attributions(
        self,
        input_ids: torch.Tensor,
        target_class: int = 1,
    ) -> np.ndarray:
        """
        Compute integrated gradient attributions per token position.

        Returns:
            attributions: (seq_len,) array of importance scores
        """
        input_ids = input_ids.to(self.device)
        baseline_ids = torch.zeros_like(input_ids)  # zero = PAD token

        # Get embeddings for input and baseline
        emb_input = self._get_embedding(input_ids).float()
        emb_baseline = self._get_embedding(baseline_ids).float()

        # Interpolate
        alphas = torch.linspace(0, 1, self.n_steps, device=self.device)
        integrated_grads = torch.zeros_like(emb_input)

        for alpha in alphas:
            interp_emb = emb_baseline + alpha * (emb_input - emb_baseline)
            interp_emb = interp_emb.detach().requires_grad_(True)

            # Forward pass using interpolated embeddings
            # We need to hook into the model to use interp_emb directly
            # Approximate: use input_ids but scale the embedding
            logits = self._forward_with_emb(interp_emb, input_ids)

            if logits.shape[-1] == 1 or len(logits.shape) == 1:
                score = logits.squeeze()
            else:
                score = logits[:, target_class]

            self.model.zero_grad()
            score.sum().backward()

            if interp_emb.grad is not None:
                integrated_grads += interp_emb.grad.detach()

        # Scale by (input - baseline)
        attributions = integrated_grads * (emb_input - emb_baseline)
        # Aggregate over embedding dimension
        attributions = attributions.abs().mean(dim=-1).squeeze(0)
        return attributions.cpu().numpy()

    def _forward_with_emb(self, emb: torch.Tensor, input_ids: torch.Tensor) -> torch.Tensor:
        """Forward pass bypassing embedding layer, using provided emb directly."""
        import math
        # Scale embedding
        d_model = emb.shape[-1]
        emb_scaled = emb * math.sqrt(d_model)

        # Add CLS token
        B = emb.size(0)
        cls = self.model.cls_token.expand(B, -1, -1)
        emb_with_cls = torch.cat([cls, emb_scaled], dim=1)

        # Positional encoding
        h = self.model.pos_encoder(emb_with_cls)

        cls_tok = h[:, :1, :]
        seq_tok = h[:, 1:, :]

        for layer in self.model.span_attn_layers:
            seq_tok, _ = layer(seq_tok)

        combined = torch.cat([cls_tok, seq_tok], dim=1)
        combined = self.model.global_attn(combined)
        pooled = self.model.norm(combined[:, 0, :])
        return self.model.classifier(pooled)


class BehaviorAnalyzer:
    """
    Analyzes token importance to identify malicious behavior patterns.
    Maps important tokens to known malware behavior categories.
    """

    def classify_behaviors(
        self,
        token_importance: List[Tuple[str, float]],
        top_n: int = 20,
    ) -> Dict[str, List[Tuple[str, float]]]:
        """
        Map top tokens to behavior categories.

        Returns dict: {behavior_name: [(token, score), ...]}
        """
        top_tokens = token_importance[:top_n]
        results: Dict[str, List] = {cat: [] for cat in MALICIOUS_PATTERNS}
        results["unknown_suspicious"] = []

        for token, score in top_tokens:
            matched = False
            token_lower = token.lower()
            for category, patterns in MALICIOUS_PATTERNS.items():
                for pat in patterns:
                    if pat in token_lower or token_lower in pat:
                        results[category].append((token, score))
                        matched = True
                        break
                if matched:
                    break
            if not matched and score > 0.1:
                results["unknown_suspicious"].append((token, score))

        # Remove empty categories
        return {k: v for k, v in results.items() if v}

    def is_benign_indicator(self, token: str) -> bool:
        return any(p in token.lower() for p in BENIGN_PATTERNS)

    def compute_maliciousness_score(
        self,
        token_importance: List[Tuple[str, float]],
        top_n: int = 20,
    ) -> float:
        """
        Heuristic maliciousness score from token importance.
        Scores 0.0 (benign) to 1.0 (malicious).
        """
        top_tokens = token_importance[:top_n]
        if not top_tokens:
            return 0.0

        mal_score = 0.0
        total_score = sum(s for _, s in top_tokens)

        for token, score in top_tokens:
            token_lower = token.lower()
            # Check malicious patterns
            for patterns in MALICIOUS_PATTERNS.values():
                if any(p in token_lower for p in patterns):
                    mal_score += score
                    break
            # Penalize benign
            if self.is_benign_indicator(token):
                mal_score -= score * 0.5

        return max(0.0, min(1.0, mal_score / max(total_score, 1e-8)))


def explain_sample(
    model: nn.Module,
    input_ids: torch.Tensor,
    tokenizer,
    device: str = "cpu",
    use_ig: bool = True,
) -> Dict:
    """
    Full explanation pipeline for a single sample.

    Returns:
        {
            "attention_importance": [(token, score), ...],
            "ig_attributions": np.ndarray or None,
            "behavior_map": {category: [(token, score)]},
            "maliciousness_score": float,
            "top_tokens": [(token, score), ...]
        }
    """
    model = model.to(device).eval()

    # Attention-based importance
    viz = AttentionVisualizer(model, device)
    attn_importance = viz.get_token_importance_from_attention(input_ids, tokenizer)

    # Integrated gradients (slower, skip for large batches)
    ig_attr = None
    if use_ig:
        try:
            ig = IntegratedGradients(model, device, n_steps=20)
            ig_attr = ig.compute_attributions(input_ids)
        except Exception as e:
            ig_attr = None

    # Behavior analysis
    analyzer = BehaviorAnalyzer()
    behavior_map = analyzer.classify_behaviors(attn_importance)
    mal_score = analyzer.compute_maliciousness_score(attn_importance)

    return {
        "attention_importance": attn_importance,
        "ig_attributions": ig_attr,
        "behavior_map": behavior_map,
        "maliciousness_score": mal_score,
        "top_tokens": attn_importance[:10],
    }
