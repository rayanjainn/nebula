"""
Nebula Enhanced — FastAPI Backend
Endpoints: /predict, /analyze, /explain, /train, /metrics, /dataset, /report
"""
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
            ckpt = torch.load(str(best_ckpt), map_location="cpu")
            _model.load_state_dict(ckpt["model_state_dict"])
            log.info(f"Loaded checkpoint from epoch {ckpt.get('epoch', '?')}")

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
        result = explain_sample(model, input_ids, tok, device="cpu", use_ig=False)
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
    """Predict from raw text (pre-processed API sequence string)."""
    try:
        from config import MODEL_CONFIG
        input_ids = _tokenize(req.text, MODEL_CONFIG["seq_len"])
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


@app.get("/dataset/stats")
def dataset_stats():
    """Stats about the merged dataset."""
    merged = ROOT / "data" / "merged_dataset.jsonl"
    if not merged.exists():
        raise HTTPException(404, "Dataset not found")

    rows = []
    with open(merged) as f:
        for line in f:
            rows.append(json.loads(line))

    total = len(rows)
    malicious = sum(1 for r in rows if r.get("label", 0) == 1)
    families: Dict[str, int] = {}
    sources: Dict[str, int] = {}
    api_lens = []

    for r in rows:
        fam = r.get("family", "unknown")
        families[fam] = families.get(fam, 0) + 1
        src = r.get("source", "unknown")
        sources[src] = sources.get(src, 0) + 1
        apis = r.get("apis") or []
        api_lens.append(len(apis))

    return {
        "total": total,
        "malicious": malicious,
        "benign": total - malicious,
        "malicious_pct": round(malicious / total * 100, 1),
        "families": families,
        "sources": sources,
        "avg_api_calls": round(float(np.mean(api_lens)), 1) if api_lens else 0,
        "max_api_calls": max(api_lens) if api_lens else 0,
    }


@app.get("/dataset/sample")
def dataset_sample(n: int = 5, label: Optional[int] = None):
    """Return n sample rows from dataset."""
    merged = ROOT / "data" / "merged_dataset.jsonl"
    rows = []
    with open(merged) as f:
        for line in f:
            d = json.loads(line)
            if label is None or d.get("label") == label:
                rows.append(d)

    import random
    sample = random.sample(rows, min(n, len(rows)))
    result = []
    for r in sample:
        apis = r.get("apis") or []
        api_names = [a.get("api_name", str(a)) if isinstance(a, dict) else str(a) for a in apis[:10]]
        result.append({
            "sha256": r.get("sha256", r.get("apihash", "unknown"))[:16] + "...",
            "label": r.get("label", 0),
            "family": r.get("family", "unknown"),
            "ep_type": r.get("ep_type", "unknown"),
            "api_count": len(apis),
            "top_apis": api_names,
            "has_network": len(r.get("network_events") or []) > 0,
            "has_files": len(r.get("file_access") or []) > 0,
            "source": r.get("source", "unknown"),
        })
    return {"samples": result, "total_available": len(rows)}


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
        from pipeline.dataset import load_jsonl_split, build_dataloaders
        from pipeline.trainer import NebulaTrainer

        tokenizer = load_tokenizer("bpe", MODEL_CONFIG["seq_len"])
        merged = ROOT / "data" / "merged_dataset.jsonl"

        (X_train, y_train), (X_val, y_val) = load_jsonl_split(
            str(merged), tokenizer, seq_len=MODEL_CONFIG["seq_len"], val_ratio=0.2
        )
        train_loader, val_loader = build_dataloaders(
            X_train, y_train, X_val, y_val, batch_size=req.batch_size
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
    """Return latest training metrics from checkpoint."""
    ckpt_dir = ROOT / "models" / "checkpoints"
    best_ckpt = ckpt_dir / "nebula_run_best.pt"

    if not best_ckpt.exists():
        return {"status": "no_checkpoint", "message": "Model not yet trained"}

    ckpt = torch.load(str(best_ckpt), map_location="cpu")
    metrics = ckpt.get("metrics", {})
    return {
        "epoch": ckpt.get("epoch", 0),
        "auc": round(metrics.get("auc", 0), 4),
        "f1": round(metrics.get("f1", 0), 4),
        "accuracy": round(metrics.get("acc", 0), 4),
        "tpr_at_fpr1e3": round(metrics.get("tpr_at_fpr1e3", 0), 4),
        "loss": round(metrics.get("loss", 0), 4),
    }


@app.get("/examples")
def list_examples():
    """Return list of built-in example reports for demo."""
    emulation_dir = ROOT.parent / "nebula" / "emulation"
    examples = []
    for f in emulation_dir.glob("*.json"):
        if f.name == "speakeasy_config.json":
            continue
        try:
            with open(f) as fh:
                data = json.load(fh)
            eps = data.get("entry_points", [data]) if isinstance(data, dict) else data
            apis = []
            for ep in eps[:1]:
                apis = [a.get("api_name", "") for a in (ep.get("apis") or [])[:5] if isinstance(a, dict)]
            examples.append({
                "name": f.name,
                "sha256": data.get("sha256", "example")[:16] + "..." if isinstance(data, dict) and data.get("sha256") else "example",
                "entry_points": len(eps),
                "sample_apis": apis,
            })
        except:
            pass
    return {"examples": examples}


@app.get("/examples/{name}")
def get_example(name: str):
    """Return a specific example report."""
    emulation_dir = ROOT.parent / "nebula" / "emulation"
    fpath = emulation_dir / name
    if not fpath.exists() or not fpath.suffix == ".json":
        raise HTTPException(404, f"Example {name} not found")
    with open(fpath) as f:
        return json.load(f)


@app.post("/predict/example/{name}")
def predict_example(name: str, use_xai: bool = True, use_llm: bool = False):
    """Run prediction on a built-in example report."""
    emulation_dir = ROOT.parent / "nebula" / "emulation"
    fpath = emulation_dir / name
    if not fpath.exists():
        raise HTTPException(404, f"Example {name} not found")
    with open(fpath) as f:
        report = json.load(f)

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
        return json.load(f)


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
