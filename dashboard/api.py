"""
Nebula Enhanced — FastAPI Backend
Endpoints: /predict, /analyze, /explain, /train, /metrics, /dataset, /report
"""
import re
import sys
import json
import time
import logging
import traceback
from pathlib import Path
from typing import Dict, Optional, Any, Union, List
from contextlib import asynccontextmanager

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parent / "nebula"))

log = logging.getLogger("nebula_api")
logging.basicConfig(level=logging.INFO)

# ── lazy global state ────────────────────────────────────────────────────────
_model = None
_tokenizer = None
_training_status: Dict = {"running": False, "epoch": 0, "epochs": 0,
                           "train_loss": [], "val_auc": [], "val_f1": [],
                           "val_tpr": [], "done": False, "error": None}

def get_model_and_tokenizer():
    global _model, _tokenizer
    if _model is None or _tokenizer is None:
        from config import MODEL_CONFIG, TRAIN_CONFIG
        from models.nebula_enhanced import NebulaEnhanced
        from pipeline.tokenizer_utils import load_tokenizer

        _tokenizer = load_tokenizer(TRAIN_CONFIG["tokenizer"], seq_len=MODEL_CONFIG["seq_len"])
        _model = NebulaEnhanced(**MODEL_CONFIG)

        # Load checkpoint if exists
        ckpt_dir = ROOT / "models" / "checkpoints"
        best_ckpt = ckpt_dir / "nebula_run_best.pt"
        if best_ckpt.exists():
            ckpt = torch.load(str(best_ckpt), map_location="cpu", weights_only=False)
            state = ckpt["model_state_dict"]
            # Remap compact Kaggle attribute names → full NebulaEnhanced names
            _REMAP = {
                "cls":        "cls_token",
                "emb.":       "embedding.",
                "pe.pe":      "pos_encoder.pe",
                "pe.drop.":   "pos_encoder.dropout.",
                "chunks.":    "span_attn_layers.",
                ".enc.":      ".encoder.",
                "clf.":       "classifier.",
            }
            remapped = {}
            for k, v in state.items():
                new_k = k
                for old, new in _REMAP.items():
                    new_k = new_k.replace(old, new)
                remapped[new_k] = v
            # Drop pos_encoder.pe — it's a fixed sinusoidal buffer recomputed at
            # init; a 1-position size diff between Kaggle (seq+10) and local (seq+11)
            # would block load_state_dict even with strict=False.
            remapped.pop("pos_encoder.pe", None)
            missing, unexpected = _model.load_state_dict(remapped, strict=False)
            real_issues = [k for k in missing + unexpected if "pos_encoder.pe" not in k]
            if real_issues:
                log.warning(f"Checkpoint key mismatches: {real_issues}")
            log.info(f"Loaded checkpoint from epoch {ckpt.get('epoch', '?')} (AUC {ckpt.get('auc', '?')})")

        _model.eval()
    return _model, _tokenizer


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        get_model_and_tokenizer()
        log.info("Model loaded at startup")
    except Exception as e:
        log.warning(f"Model not loaded at startup: {e}")
    yield


app = FastAPI(
    title="Nebula Enhanced API",
    description="Dynamic malware analysis with Transformer + LLM + XAI",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models ──────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    report: Union[Dict[str, Any], List[Any]]  # raw speakeasy-format report or entry-point list
    use_xai: bool = True
    use_llm: bool = False

class TextPredictRequest(BaseModel):
    text: str
    use_xai: bool = True
    use_llm: bool = False

class LLMRequest(BaseModel):
    question: str
    context: str = ""

class TrainRequest(BaseModel):
    epochs: int = 10
    time_budget_minutes: float = 15.0
    batch_size: int = 32
    lr: float = 2.5e-4

class CompareRequest(BaseModel):
    nebula_results: Dict
    baseline_results: Dict


# ── helpers ──────────────────────────────────────────────────────────────────

def _extract_text_from_report(report) -> str:
    """Convert speakeasy report (dict, list, or entry-point) → normalized text."""
    from pipeline.preprocessor import SpeakeasyPreprocessor
    pp = SpeakeasyPreprocessor()
    if isinstance(report, list):
        # list of entry-points
        texts = [pp.process_row(ep) for ep in report[:8]]  # cap at 8 EPs
        return " ".join(texts)
    if isinstance(report, dict):
        if "entry_points" in report:
            texts = [pp.process_row(ep) for ep in report["entry_points"][:8]]
            return " ".join(texts)
        return pp.process_row(report)
    return str(report)

def _tokenize(text: str, seq_len: int = 512) -> torch.Tensor:
    _, tok = get_model_and_tokenizer()
    ids = tok.encode(text)
    # tokenizer may return (1, seq_len) ndarray or 1-D list/array
    if hasattr(ids, "shape") and len(ids.shape) == 2:
        return torch.tensor(ids[:, :seq_len], dtype=torch.long)
    if hasattr(ids, "tolist"):
        ids = ids.flatten().tolist()
    ids = list(ids)[:seq_len]
    ids += [0] * (seq_len - len(ids))
    return torch.tensor([ids], dtype=torch.long)

def _run_inference(input_ids: torch.Tensor):
    model, _ = get_model_and_tokenizer()
    with torch.no_grad():
        prob = model.predict_proba(input_ids).item()
    return prob

def _run_xai(input_ids: torch.Tensor, _prob: float = 0.0) -> Dict:
    try:
        from xai.explainer import explain_sample
        model, tok = get_model_and_tokenizer()
        result = explain_sample(model, input_ids, tok, device="cpu", use_ig=True)
        return {
            "top_tokens": [(t, float(s)) for t, s in result["top_tokens"]],
            "behavior_map": {
                k: [(t, float(s)) for t, s in v]
                for k, v in result["behavior_map"].items()
            },
            "maliciousness_score": float(result["maliciousness_score"]),
        }
    except Exception as e:
        log.warning(f"XAI failed: {e}")
        return {"top_tokens": [], "behavior_map": {}, "maliciousness_score": 0.0}


# ── endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    global _model
    return {
        "status": "ok",
        "model_loaded": _model is not None,
        "timestamp": time.time(),
    }


@app.get("/model/info")
def model_info():
    try:
        model, _ = get_model_and_tokenizer()
        return {
            "name": "NebulaEnhanced",
            "parameters": model.count_parameters(),
            "vocab_size": model.vocab_size,
            "seq_len": model.seq_len,
            "d_model": model.d_model,
            "pooling": model.pooling,
            "attention_span": model.attention_span,
            "improvements": [
                "CLS token pooling (vs mean pooling)",
                "Pre-LayerNorm (stable training)",
                "Label smoothing",
                "Cosine LR warmup",
                "Global attention layer",
                "XAI attention hooks",
            ]
        }
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/predict")
def predict(req: PredictRequest):
    try:
        text = _extract_text_from_report(req.report)
        input_ids = _tokenize(text)
        prob = _run_inference(input_ids)
        verdict = "MALICIOUS" if prob > 0.5 else "BENIGN"

        result = {
            "probability": round(prob, 4),
            "verdict": verdict,
            "confidence": round(abs(prob - 0.5) * 2, 4),
            "text_preview": text[:200],
        }

        if req.use_xai:
            result["xai"] = _run_xai(input_ids, prob)

        if req.use_llm and result.get("xai"):
            from llm.analyzer import MalwareAnalyzer
            analyzer = MalwareAnalyzer()
            xai = result["xai"]
            apis = req.report.get("apis") or []
            api_names = [a.get("api_name", "") for a in apis if isinstance(a, dict)]
            result["llm_analysis"] = analyzer.analyze_behavior(
                api_sequence=api_names,
                prediction=prob,
                top_tokens=xai["top_tokens"],
                behavior_map=xai["behavior_map"],
                sample_hash=req.report.get("sha256", "unknown"),
            )

        return result
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.post("/predict/text")
def predict_text(req: TextPredictRequest):
    """Predict from raw text or space-separated API names."""
    try:
        from config import MODEL_CONFIG
        from pipeline.preprocessor import SpeakeasyPreprocessor
        text = req.text.strip()
        tokens = text.split()
        # If input looks like a list of API names (short, identifier-like tokens),
        # wrap it in a synthetic report and run through the same preprocessor used during training.
        if len(tokens) <= 300 and all(re.match(r'^[A-Za-z][A-Za-z0-9_.]*$', t) for t in tokens if t):
            pp = SpeakeasyPreprocessor()
            synthetic_row = {
                "apis": [{"api_name": t, "args": [], "ret_val": 0} for t in tokens],
            }
            text = pp.process_row(synthetic_row)
        input_ids = _tokenize(text, MODEL_CONFIG["seq_len"])
        prob = _run_inference(input_ids)
        verdict = "MALICIOUS" if prob > 0.5 else "BENIGN"

        result = {
            "probability": round(prob, 4),
            "verdict": verdict,
            "confidence": round(abs(prob - 0.5) * 2, 4),
        }
        if req.use_xai:
            result["xai"] = _run_xai(input_ids, prob)
        return result
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.post("/explain")
def explain(req: PredictRequest):
    """Deep XAI explanation with integrated gradients."""
    try:
        text = _extract_text_from_report(req.report)
        input_ids = _tokenize(text)
        prob = _run_inference(input_ids)

        from xai.explainer import explain_sample
        model, tok = get_model_and_tokenizer()
        result = explain_sample(model, input_ids, tok, device="cpu", use_ig=True)

        return {
            "probability": round(prob, 4),
            "verdict": "MALICIOUS" if prob > 0.5 else "BENIGN",
            "top_tokens": [(t, float(s)) for t, s in result["top_tokens"]],
            "attention_importance": [(t, float(s)) for t, s in result["attention_importance"][:20]],
            "ig_attributions": result["ig_attributions"].tolist() if result["ig_attributions"] is not None else None,
            "behavior_map": {k: [(t, float(s)) for t, s in v] for k, v in result["behavior_map"].items()},
            "maliciousness_score": float(result["maliciousness_score"]),
        }
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.post("/analyze/llm")
def analyze_llm(req: PredictRequest):
    """Full LLM behavioral analysis."""
    try:
        from llm.analyzer import MalwareAnalyzer
        text = _extract_text_from_report(req.report)
        input_ids = _tokenize(text)
        prob = _run_inference(input_ids)
        xai = _run_xai(input_ids, prob)

        apis = req.report.get("apis") or []
        api_names = [a.get("api_name", "") for a in apis if isinstance(a, dict)]

        analyzer = MalwareAnalyzer()
        analysis = analyzer.analyze_behavior(
            api_sequence=api_names,
            prediction=prob,
            top_tokens=xai["top_tokens"],
            behavior_map=xai["behavior_map"],
            sample_hash=req.report.get("sha256", "unknown"),
        )
        return {
            "probability": round(prob, 4),
            "verdict": "MALICIOUS" if prob > 0.5 else "BENIGN",
            "analysis": analysis,
            "xai": xai,
        }
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.post("/analyze/llm/stream")
async def analyze_llm_stream(req: PredictRequest):
    """Streaming LLM response."""
    try:
        from llm.analyzer import MalwareAnalyzer, OllamaClient
        text = _extract_text_from_report(req.report)
        input_ids = _tokenize(text)
        prob = _run_inference(input_ids)
        xai = _run_xai(input_ids, prob)

        apis = req.report.get("apis") or []
        api_names = [a.get("api_name", "") for a in apis if isinstance(a, dict)]

        analyzer = MalwareAnalyzer()

        api_preview = ", ".join(api_names[:30])
        top_toks_str = ", ".join([f"{t}({s:.3f})" for t, s in xai["top_tokens"][:10]])
        behavior_str = json.dumps({k: [t for t, _ in v[:3]] for k, v in xai["behavior_map"].items()}, indent=2)

        prompt = f"""Analyze this malware behavioral report:
**Malware Probability:** {prob:.1%} | **Verdict:** {"MALICIOUS" if prob > 0.5 else "BENIGN"}
**API Calls:** {api_preview}
**Top Tokens:** {top_toks_str}
**Behaviors:** {behavior_str}
Provide executive summary, behavior analysis, MITRE ATT&CK mapping, threat classification, and risk level."""

        from llm.analyzer import SYSTEM_PROMPT
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]

        def token_stream():
            yield f"data: {{\"prob\": {prob}, \"verdict\": \"{'MALICIOUS' if prob > 0.5 else 'BENIGN'}\"}}\n\n"
            for token in analyzer.client.stream_chat(messages):
                escaped = token.replace('"', '\\"').replace('\n', '\\n')
                yield f"data: {{\"token\": \"{escaped}\"}}\n\n"
            yield "data: {\"done\": true}\n\n"

        return StreamingResponse(token_stream(), media_type="text/event-stream")
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.post("/llm/question")
def llm_question(req: LLMRequest):
    from llm.analyzer import MalwareAnalyzer
    analyzer = MalwareAnalyzer()
    answer = analyzer.answer_question(req.question, req.context)
    return {"answer": answer}


@app.post("/llm/compare")
def llm_compare(req: CompareRequest):
    from llm.analyzer import MalwareAnalyzer
    analyzer = MalwareAnalyzer()
    comparison = analyzer.compare_models(req.nebula_results, req.baseline_results)
    return {"comparison": comparison}


# ── dataset cache ─────────────────────────────────────────────────────────────
_dataset_cache: Optional[List[Dict]] = None
_dataset_mtime: float = 0.0

def _load_dataset() -> List[Dict]:
    """Load merged_dataset.jsonl into memory, re-reading only when the file changes."""
    global _dataset_cache, _dataset_mtime
    merged = ROOT / "data" / "merged_dataset.jsonl"
    if not merged.exists():
        return []
    mtime = merged.stat().st_mtime
    if _dataset_cache is not None and mtime == _dataset_mtime:
        return _dataset_cache
    rows: List[Dict] = []
    with open(merged) as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if not r.get("sha256"):
                ah = r.get("apihash", "")
                r["sha256"] = ah if (ah and ah != "unknown") else f"row_{i:06d}"
            rows.append(r)
    _dataset_cache = rows
    _dataset_mtime = mtime
    return rows


@app.get("/dataset/stats")
def dataset_stats():
    """Stats about the merged dataset."""
    merged = ROOT / "data" / "merged_dataset.jsonl"
    if not merged.exists():
        raise HTTPException(404, "Dataset not found")

    all_rows = _load_dataset()
    total = len(all_rows)
    malicious = sum(1 for r in all_rows if r.get("label", 0) == 1)
    families: Dict[str, int] = {}
    sources: Dict[str, int] = {}
    api_lens = []

    for r in all_rows:
        fam = r.get("family", "unknown")
        families[fam] = families.get(fam, 0) + 1
        src = r.get("source", "unknown")
        sources[src] = sources.get(src, 0) + 1
        api_lens.append(len(r.get("apis") or []))

    full_path = ROOT / "data" / "full" / "speakeasy_train_full.jsonl"
    return {
        "total": total,
        "total_records": total,
        "malicious": malicious,
        "benign": total - malicious,
        "malicious_pct": round(malicious / total * 100, 1) if total > 0 else 0,
        "families": families,
        "sources": sources,
        "avg_api_calls": round(float(np.mean(api_lens)), 1) if api_lens else 0,
        "max_api_calls": max(api_lens) if api_lens else 0,
        "full_dataset_found": full_path.exists(),
    }


@app.get("/dataset/sample")
def dataset_sample(
    page: int = 1,
    limit: int = 10,
    label: Optional[int] = None,
    family: Optional[str] = None,
    search: Optional[str] = None,
    balanced: bool = False,
):
    """Return paginated samples with search and filtering."""
    merged = ROOT / "data" / "merged_dataset.jsonl"
    if not merged.exists():
        return {"samples": [], "total": 0}

    all_rows = _load_dataset()

    # Filter in one pass
    rows: List[Dict] = []
    fam_lower = family.lower() if family and family.lower() != "all" else None
    search_lower = search.lower() if search else None
    for d in all_rows:
        if label is not None and d.get("label") != label:
            continue
        if fam_lower and d.get("family", "").lower() != fam_lower:
            continue
        if search_lower and search_lower not in d["sha256"].lower() and search_lower not in d.get("family", "").lower():
            continue
        rows.append(d)

    if balanced:
        malicious_pool = [r for r in rows if r.get("label") == 1]
        benign_pool = [r for r in rows if r.get("label") == 0]
        count = min(len(malicious_pool), len(benign_pool))
        rows = malicious_pool[:count] + benign_pool[:count]

    rows.sort(key=lambda x: x.get("label", 0), reverse=True)
    total = len(rows)
    sample_page = rows[(page - 1) * limit : page * limit]

    result = []
    for r in sample_page:
        apis = r.get("apis") or []
        api_names = [a.get("api_name", str(a)) if isinstance(a, dict) else str(a) for a in apis[:20]]
        result.append({
            "sha256": r.get("sha256", r.get("apihash", "unknown")),
            "label": r.get("label", 0),
            "family": r.get("family", "unknown"),
            "threads": r.get("threads", 1),
            "api_count": len(apis),
            "top_apis": api_names,
            "has_network": len(r.get("network_events") or []) > 0,
            "has_files": len(r.get("file_access") or []) > 0,
            "source": r.get("source", "unknown"),
        })

    return {"samples": result, "total": total, "page": page, "limit": limit}


@app.post("/train/start")
def train_start(req: TrainRequest, background_tasks: BackgroundTasks):
    global _training_status
    if _training_status["running"]:
        raise HTTPException(400, "Training already running")

    _training_status = {
        "running": True, "epoch": 0, "epochs": req.epochs,
        "train_loss": [], "val_auc": [], "val_f1": [],
        "val_tpr": [], "done": False, "error": None,
        "start_time": time.time(),
    }
    background_tasks.add_task(_run_training, req)
    return {"status": "started", "epochs": req.epochs}


def _run_training(req: TrainRequest):
    global _model, _training_status
    try:
        from config import MODEL_CONFIG
        from models.nebula_enhanced import NebulaEnhanced
        from pipeline.tokenizer_utils import load_tokenizer
        from pipeline.dataset import load_jsonl_split
        from pipeline.trainer import NebulaTrainer

        tokenizer = load_tokenizer("bpe", MODEL_CONFIG["seq_len"])
        merged = ROOT / "data" / "merged_dataset.jsonl"

        train_loader, val_loader, _, _ = load_jsonl_split(
            str(merged), tokenizer, seq_len=MODEL_CONFIG["seq_len"], val_ratio=0.2,
            balance=True, max_per_class=9000,
        )

        model = NebulaEnhanced(**MODEL_CONFIG)
        trainer = NebulaTrainer(model, lr=req.lr, checkpoint_dir=str(ROOT / "models" / "checkpoints"))

        original_train_epoch = trainer.train_epoch
        original_evaluate = trainer.evaluate

        def patched_train(loader, scheduler=None):
            loss = original_train_epoch(loader, scheduler)
            _training_status["train_loss"].append(round(loss, 4))
            return loss

        def patched_eval(loader):
            metrics = original_evaluate(loader)
            _training_status["epoch"] += 1
            _training_status["val_auc"].append(round(metrics.get("auc", 0), 4))
            _training_status["val_f1"].append(round(metrics.get("f1", 0), 4))
            _training_status["val_tpr"].append(round(metrics.get("tpr_at_fpr1e3", 0), 4))
            return metrics

        trainer.train_epoch = patched_train
        trainer.evaluate = patched_eval

        trainer.train(
            train_loader, val_loader,
            epochs=req.epochs,
            time_budget_minutes=req.time_budget_minutes,
        )

        _model = trainer.model
        _training_status["running"] = False
        _training_status["done"] = True
    except Exception as e:
        _training_status["running"] = False
        _training_status["error"] = str(e)
        log.error(f"Training failed: {e}\n{traceback.format_exc()}")


@app.get("/train/status")
def train_status():
    global _training_status
    status = dict(_training_status)
    if status.get("start_time"):
        status["elapsed_seconds"] = round(time.time() - status["start_time"], 1)
    return status


@app.get("/metrics")
def get_metrics():
    """Return latest training metrics — prefers training_results.json, falls back to checkpoint."""
    results_path = ROOT / "data" / "training_results.json"
    if results_path.exists():
        with open(results_path) as f:
            r = json.load(f)
        e = r.get("enhanced", {})
        p = r.get("paper_baseline", {})
        return {
            "epoch": r.get("best_epoch", ckpt_epoch(ROOT)),
            "auc":           e.get("auc", 0),
            "f1":            e.get("f1", 0),
            "accuracy":      e.get("accuracy", 0),
            "precision":     e.get("precision", 0),
            "recall":        e.get("recall", 0),
            "tpr_at_fpr1e3": e.get("tpr_at_fpr1e3", 0),
            "average_precision": e.get("average_precision", 0),
            "confusion_matrix":  e.get("confusion_matrix"),
            "parameters":    e.get("parameters", 0),
            "baseline": {
                "auc":           p.get("auc", 0),
                "f1":            p.get("f1", 0),
                "accuracy":      p.get("accuracy", 0),
                "precision":     p.get("precision", 0),
                "recall":        p.get("recall", 0),
                "tpr_at_fpr1e3": p.get("tpr_at_fpr1e3", 0),
                "parameters":    p.get("parameters", 0),
            },
        }

    # fallback: read directly from checkpoint
    best_ckpt = ROOT / "models" / "checkpoints" / "nebula_run_best.pt"
    if not best_ckpt.exists():
        return {"status": "no_checkpoint", "message": "Model not yet trained"}
    ckpt = torch.load(str(best_ckpt), map_location="cpu", weights_only=False)
    return {
        "epoch": ckpt.get("epoch", 0),
        "auc":   round(float(ckpt.get("auc", 0)), 4),
        "f1":    round(float(ckpt.get("f1", 0)), 4),
    }


def ckpt_epoch(root: Path) -> int:
    p = root / "models" / "checkpoints" / "nebula_run_best.pt"
    if not p.exists():
        return 0
    try:
        ckpt = torch.load(str(p), map_location="cpu", weights_only=False)
        return int(ckpt.get("epoch", 0))
    except Exception:
        return 0


def _load_examples_index() -> Dict[str, Dict]:
    """Load speakeasy_examples.jsonl and group rows by SHA-256 into per-sample dicts."""
    examples_file = ROOT / "data" / "speakeasy_examples.jsonl"
    if not examples_file.exists():
        return {}
    by_sha: Dict[str, Dict] = {}
    with open(examples_file) as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            sha = r.get("sha256") or r.get("apihash") or ""
            if not sha or sha in ("unknown", ""):
                sha = f"row_{i:06d}"
            if sha not in by_sha:
                family = r.get("family", "unknown")
                label = r.get("label", -1)
                by_sha[sha] = {
                    "sha256": sha,
                    "family": family,
                    "label": label,
                    "entry_points": [],
                }
            ep_entry = {
                "ep_type": r.get("ep_type", ""),
                "apis": r.get("apis") or [],
            }
            by_sha[sha]["entry_points"].append(ep_entry)
    return by_sha


@app.get("/examples")
def list_examples():
    """Return list of built-in example reports for demo."""
    index = _load_examples_index()
    examples = []
    for sha, data in index.items():
        eps = data["entry_points"]
        apis = []
        for ep in eps[:1]:
            apis = [a.get("api_name", "") for a in (ep.get("apis") or [])[:5] if isinstance(a, dict)]
        family = data.get("family", "unknown")
        label = data.get("label", -1)
        verdict = "malicious" if label == 1 else "benign"
        examples.append({
            "name": sha,
            "sha256": sha[:16] + "..." if len(sha) > 16 else sha,
            "entry_points": len(eps),
            "sample_apis": apis,
            "family": family,
            "verdict": verdict,
        })
    # Sort: malicious first, then by family
    examples.sort(key=lambda x: (x["verdict"] == "benign", x["family"]))
    return {"examples": examples}


@app.get("/examples/{name}")
def get_example(name: str):
    """Return a specific example report by SHA-256 key."""
    index = _load_examples_index()
    if name not in index:
        raise HTTPException(404, f"Example {name} not found")
    return index[name]


@app.post("/predict/example/{name}")
def predict_example(name: str, use_xai: bool = True, use_llm: bool = False):
    """Run prediction on a built-in example report."""
    index = _load_examples_index()
    if name not in index:
        raise HTTPException(404, f"Example {name} not found")
    report = index[name]

    try:
        from config import MODEL_CONFIG
        text = _extract_text_from_report(report)
        input_ids = _tokenize(text, MODEL_CONFIG["seq_len"])
        prob = _run_inference(input_ids)
        verdict = "MALICIOUS" if prob > 0.5 else "BENIGN"
        result: Dict = {
            "probability": round(prob, 4),
            "verdict": verdict,
            "confidence": round(abs(prob - 0.5) * 2, 4),
            "text_preview": text[:200],
        }
        if use_xai:
            result["xai"] = _run_xai(input_ids)
        if use_llm and result.get("xai"):
            from llm.analyzer import MalwareAnalyzer
            analyzer = MalwareAnalyzer()
            eps = report if isinstance(report, list) else report.get("entry_points", [report])
            all_apis = []
            for ep in eps[:3]:
                all_apis += [a.get("api_name", "") for a in (ep.get("apis") or []) if isinstance(a, dict)]
            xai = result["xai"]
            result["llm_analysis"] = analyzer.analyze_behavior(
                api_sequence=all_apis,
                prediction=prob,
                top_tokens=xai["top_tokens"],
                behavior_map=xai["behavior_map"],
                sample_hash=report.get("sha256", "example") if isinstance(report, dict) else "example",
            )
        return result
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.get("/results")
def get_training_results():
    """Full training results including ROC, PR curve, confusion matrix, comparison."""
    path = ROOT / "data" / "training_results.json"
    if not path.exists():
        raise HTTPException(404, "No training results found. Run scripts/train_and_evaluate.py first.")
    with open(path) as f:
        result = json.load(f)
    # Overlay live training history if a dashboard run has more epochs
    live = _training_status
    if live.get("val_auc") and len(live["val_auc"]) > 0:
        live_history = {
            "train_loss": live["train_loss"],
            "val_auc": live["val_auc"],
            "val_f1": live["val_f1"],
            "val_tpr_at_fpr1e3": live["val_tpr"],
            "val_acc": [],
            "epoch_times": [],
        }
        result["live_training"] = {
            "running": live["running"],
            "epoch": live["epoch"],
            "epochs": live["epochs"],
            "done": live["done"],
            "train_history": live_history,
            "latest_auc": live["val_auc"][-1],
            "latest_f1": live["val_f1"][-1],
        }
    return result


class ExplainTermRequest(BaseModel):
    term: str
    context: str = ""   # optional surrounding context (e.g. "seen in a ransomware report")


@app.post("/explain/term")
async def explain_term(req: ExplainTermRequest):
    """
    Use the LLM to explain a technical term or API call in plain English.
    Returns a short, jargon-free explanation suitable for non-technical users.
    """
    from llm.analyzer import OllamaClient
    client = OllamaClient()

    ctx_note = f" It appeared in the context of: {req.context}." if req.context else ""

    prompt = (
        f"Explain the following technical term in simple, plain English for someone who knows "
        f"nothing about cybersecurity or Windows programming.{ctx_note}\n\n"
        f"Term: \"{req.term}\"\n\n"
        f"Give a 2-4 sentence explanation. Use an analogy if it helps. "
        f"Say what the term is, what it does in normal software, and why it can be suspicious in malware. "
        f"Do NOT use jargon without immediately explaining it."
    )

    messages = [
        {"role": "system", "content": "You explain technical cybersecurity terms to non-technical people. Keep answers short, clear, and free of unexplained jargon."},
        {"role": "user", "content": prompt},
    ]

    explanation = client.chat(messages, temperature=0.2, max_tokens=200)
    return {"term": req.term, "explanation": explanation}


@app.post("/explain/verdict")
async def explain_verdict(req: dict):
    """
    Use the LLM to explain a verdict result in plain English.
    Accepts: verdict, probability, top_tokens, behavior_categories
    """
    from llm.analyzer import OllamaClient
    client = OllamaClient()

    verdict = req.get("verdict", "UNKNOWN")
    prob = req.get("probability", 0.5)
    tokens = req.get("top_tokens", [])[:5]
    categories = list(req.get("behavior_categories", {}).keys())

    token_list = ", ".join([t[0] if isinstance(t, list) else str(t) for t in tokens])
    cat_list = ", ".join(categories) if categories else "none detected"

    prompt = (
        f"A malware detection AI analyzed a Windows program and returned this result:\n"
        f"- Verdict: {verdict}\n"
        f"- Confidence: {prob:.1%}\n"
        f"- Most suspicious behaviors detected: {token_list}\n"
        f"- Behavior categories: {cat_list}\n\n"
        f"Explain this result in 3-5 sentences of plain English for someone who is not a cybersecurity expert. "
        f"Say what the program appears to be doing, why it is {verdict.lower()}, and what the user should do. "
        f"Avoid technical jargon. If you must use a technical term, explain it immediately."
    )

    messages = [
        {"role": "system", "content": "You explain malware detection results to non-technical users in clear, simple English."},
        {"role": "user", "content": prompt},
    ]

    explanation = client.chat(messages, temperature=0.2, max_tokens=300)
    return {"verdict": verdict, "explanation": explanation}


class SummarizeRequest(BaseModel):
    apis: List[str]
    label: Optional[int] = None
    family: Optional[str] = None

@app.post("/dataset/summarize")
async def summarize_sample(req: SummarizeRequest):
    """
    Use the LLM to provide a behavioral summary of a dataset sample.
    """
    from llm.analyzer import OllamaClient
    client = OllamaClient()

    api_seq = ", ".join(req.apis[:50])
    label_str = "Malicious" if req.label == 1 else "Benign"
    family_str = f" (Family: {req.family})" if req.family and req.family != "unknown" else ""

    prompt = (
        f"Analyze the following sequence of Windows API calls from a program labeled as {label_str}{family_str}:\n\n"
        f"API Sequence: {api_seq}\n\n"
        f"Describe in 3-4 sentences of plain English what this program is doing. "
        f"Explain its behavior and intent. If it's malicious, say why. If it's benign, explain what legitimate "
        f"task it seems to be performing (e.g., managing files, connecting to a server, UI tasks). "
        f"Do not use unexplained jargon."
    )

    messages = [
        {"role": "system", "content": "You provide clear, plain-English summaries of computer program behavior based on API call sequences."},
        {"role": "user", "content": prompt},
    ]

    summary = client.chat(messages, temperature=0.2, max_tokens=350)
    return {"summary": summary}
