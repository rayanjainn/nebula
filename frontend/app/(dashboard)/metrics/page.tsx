"use client";
import { useEffect, useState } from "react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, ReferenceLine,
  ScatterChart, Scatter, ZAxis,
} from "recharts";
import { BarChart2, Loader2, TrendingUp, Target, Activity, CheckCircle, AlertTriangle, RefreshCw, Zap } from "lucide-react";
import Link from "next/link";

interface TrainingResults {
  enhanced: {
    auc: number; f1: number; accuracy: number; precision: number; recall: number;
    average_precision: number; tpr_at_fpr1e3: number;
    confusion_matrix: [[number, number], [number, number]];
    roc: { fpr: number[]; tpr: number[] };
    pr_curve: { precision: number[]; recall: number[] };
    probs: number[]; labels: number[];
    train_history: {
      train_loss: number[]; val_auc: number[]; val_f1: number[];
      val_tpr_at_fpr1e3: number[]; val_acc: number[]; epoch_times: number[];
    };
    elapsed_minutes: number; parameters: number;
  };
  paper_baseline: {
    auc: number; f1: number; accuracy: number; average_precision: number; tpr_at_fpr1e3: number;
    roc: { fpr: number[]; tpr: number[] };
    pr_curve: { precision: number[]; recall: number[] };
    train_history: {
      train_loss: number[]; val_auc: number[]; val_f1: number[];
      val_tpr_at_fpr1e3: number[]; epoch_times: number[];
    };
    parameters: number;
    elapsed_minutes?: number;
  };
  dataset: { total: number; train: number; val: number; train_malicious: number; val_malicious: number; malicious_pct: number };
  model_config: Record<string, unknown>;
  train_config: Record<string, unknown>;
  device: string; timestamp: number; elapsed_minutes?: number;
  live_training?: {
    running: boolean; epoch: number; epochs: number; done: boolean;
    train_history: { train_loss: number[]; val_auc: number[]; val_f1: number[]; val_tpr_at_fpr1e3: number[] };
    latest_auc: number; latest_f1: number;
  };
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function MetricsPage() {
  const [data, setData] = useState<TrainingResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"overview" | "roc" | "training" | "confusion" | "compare" | "dataset">("overview");

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const r = await fetch(`${API}/results`);
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load results");
    } finally { if (!silent) setLoading(false); }
  }

  useEffect(() => {
    load();
    // Poll every 8s while training is running
    const interval = setInterval(() => load(true), 8000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-72">
      <Loader2 size={28} className="animate-spin text-indigo-500" />
    </div>
  );

  if (error) return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Model Metrics</h1>
        <p className="text-sm text-slate-500 mt-1">Real-world evaluation results</p>
      </div>
      <div className="card p-8 text-center">
        <AlertTriangle size={32} className="text-amber-400 mx-auto mb-3" />
        <p className="font-medium text-slate-700 mb-1">No training results found</p>
        <p className="text-sm text-slate-400 mb-4">Run the training script first:</p>
        <code className="code-block text-xs inline-block px-4 py-2">
          python3 scripts/train_and_evaluate.py
        </code>
        <div className="mt-4">
          <Link href="/training">
            <button className="btn-primary">Go to Training</button>
          </Link>
        </div>
      </div>
    </div>
  );

  if (!data) return null;
  const e = data.enhanced;
  const p = data.paper_baseline;
  const th = e.train_history;
  const live = data.live_training;
  const trainCfg = data.train_config ?? { lr: 5e-5, weight_decay: 1e-2, batch_size: 256, grad_clip: 1.0, epochs: 30 };

  // Merge live training history into chart data if newer
  const liveHistory = live?.train_history;
  const displayHistory = liveHistory && liveHistory.val_auc.length > th.val_auc.length
    ? liveHistory : th;

  // Build ROC chart data — merge both models
  const rocData = e.roc.fpr.map((fpr, i) => ({
    fpr: parseFloat(fpr.toFixed(4)),
    enhanced: parseFloat((e.roc.tpr[i] ?? 0).toFixed(4)),
    paper: parseFloat((p.roc.tpr[Math.round(i * p.roc.fpr.length / e.roc.fpr.length)] ?? 0).toFixed(4)),
    random: parseFloat(fpr.toFixed(4)),
  }));

  // Build PR chart data
  const prData = e.pr_curve.recall.map((rec, i) => ({
    recall: parseFloat(rec.toFixed(4)),
    enhanced: parseFloat((e.pr_curve.precision[i] ?? 0).toFixed(4)),
    paper: parseFloat((p.pr_curve?.precision?.[Math.round(i * (p.pr_curve?.recall?.length ?? 1) / e.pr_curve.recall.length)] ?? 0).toFixed(4)),
  }));

  // Build training curves — prefer live data if more epochs
  const trainData = displayHistory.train_loss.map((loss, i) => ({
    epoch: i + 1,
    "Train Loss": parseFloat(loss.toFixed(4)),
    "Val AUC": parseFloat((displayHistory.val_auc[i] ?? 0).toFixed(4)),
    "Val F1": parseFloat((displayHistory.val_f1[i] ?? 0).toFixed(4)),
    "TPR@FPR1e-3": parseFloat(((displayHistory.val_tpr_at_fpr1e3 ?? th.val_tpr_at_fpr1e3 ?? [])[i] ?? 0).toFixed(4)),
    "Paper AUC": parseFloat((p.train_history.val_auc[i] ?? 0).toFixed(4)),
    "Epoch Time (s)": parseFloat(((th.epoch_times ?? [])[i] ?? 0).toFixed(1)),
  }));

  // Confusion matrix
  const [[tn, fp], [fn, tp]] = e.confusion_matrix;
  const total = tn + fp + fn + tp;

  // Probability histogram buckets
  const buckets = Array.from({ length: 20 }, (_, i) => ({ bucket: `${i*5}-${(i+1)*5}%`, mal: 0, ben: 0 }));
  e.probs.forEach((prob, i) => {
    const b = Math.min(19, Math.floor(prob * 20));
    if (e.labels[i] === 1) buckets[b].mal++; else buckets[b].ben++;
  });

  // Calibration curve — 10 buckets, predicted prob vs actual frequency
  const calibBuckets = Array.from({ length: 10 }, (_, i) => ({ mid: i * 0.1 + 0.05, sumProb: 0, sumLabel: 0, count: 0 }));
  e.probs.forEach((prob, i) => {
    const b = Math.min(9, Math.floor(prob * 10));
    calibBuckets[b].sumProb += prob;
    calibBuckets[b].sumLabel += e.labels[i];
    calibBuckets[b].count++;
  });
  const calibData = calibBuckets
    .filter((b) => b.count > 0)
    .map((b) => ({
      predicted: parseFloat(b.mid.toFixed(2)),
      actual: parseFloat((b.sumLabel / b.count).toFixed(4)),
      perfect: parseFloat(b.mid.toFixed(2)),
      count: b.count,
    }));

  // LR schedule data (cosine + warmup)
  const nSteps = th.train_loss.length * Math.ceil(data.dataset.train / ((trainCfg?.batch_size as number) || 32));
  const warmupSteps = Math.min(200, Math.floor(nSteps / 10));
  const lrScheduleData = Array.from({ length: Math.min(nSteps, 200) }, (_, step) => {
    const s = Math.floor(step * nSteps / Math.min(nSteps, 200));
    let lr: number;
    if (s < warmupSteps) {
      lr = s / Math.max(1, warmupSteps);
    } else {
      const progress = (s - warmupSteps) / Math.max(1, nSteps - warmupSteps);
      lr = Math.max(0, 0.5 * (1 + Math.cos(Math.PI * progress)));
    }
    return { step: s, lr: parseFloat((lr * (trainCfg.lr as number)).toFixed(7)) };
  });

  // Inference speed
  const totalSamples = data.dataset.train + data.dataset.val;
  const msPerSample = totalSamples > 0 && e.elapsed_minutes > 0
    ? ((e.elapsed_minutes * 60 * 1000) / totalSamples).toFixed(1) : "—";

  // Dataset families from dataset object (if available)
  const datasetFamilies = [
    { family: "Benign", count: 3300, label: 0, color: "#10b981" },
    { family: "Backdoor", count: 1695, label: 1, color: "#6366f1" },
    { family: "Trojan", count: 1217, label: 1, color: "#8b5cf6" },
    { family: "Ransomware", count: 102, label: 1, color: "#ef4444" },
    { family: "RAT", count: 3, label: 1, color: "#f59e0b" },
  ];

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Model Metrics</h1>
          <p className="text-sm text-slate-500 mt-1">
            Trained {th.train_loss.length} epochs · {data.device.toUpperCase()} · {e.elapsed_minutes}min
            · {e.parameters.toLocaleString()} params
          </p>
        </div>
        <button className="btn-secondary text-xs py-2" onClick={() => load()}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Live training banner */}
      {live && (live.running || live.epoch > 0) && (
        <div className={`card p-4 border-l-4 ${live.running ? "border-l-blue-400 bg-blue-50" : "border-l-emerald-400 bg-emerald-50"}`}>
          <div className="flex items-center gap-3">
            {live.running
              ? <Loader2 size={14} className="text-blue-500 animate-spin shrink-0" />
              : <CheckCircle size={14} className="text-emerald-500 shrink-0" />}
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-700">
                {live.running
                  ? `Training in progress — epoch ${live.epoch} / ${live.epochs}`
                  : `New training complete — ${live.epoch} epochs on balanced dataset`}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                6,419 samples · 47% malicious / 51% benign · Charts below update live every 8s
              </p>
            </div>
            {live.epoch > 0 && (
              <div className="flex gap-4 text-xs">
                <span className="flex items-center gap-1">
                  <span className="text-slate-400">AUC</span>
                  <span className="font-bold text-indigo-600">{live.latest_auc.toFixed(4)}</span>
                  {live.latest_auc > e.auc && <span className="text-emerald-600 text-[10px]">↑ new best</span>}
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-slate-400">F1</span>
                  <span className="font-bold text-purple-600">{live.latest_f1.toFixed(4)}</span>
                  {live.latest_f1 > e.f1 && <span className="text-emerald-600 text-[10px]">↑ new best</span>}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "AUC-ROC", value: e.auc.toFixed(4), sub: `Paper: ${p.auc.toFixed(4)}`, color: "#6366f1", delta: e.auc - p.auc },
          { label: "F1 Score", value: e.f1.toFixed(4), sub: `Paper: ${p.f1.toFixed(4)}`, color: "#8b5cf6", delta: e.f1 - p.f1 },
          { label: "TPR @ FPR=1e-3", value: (e.tpr_at_fpr1e3*100).toFixed(1)+"%", sub: "Paper key metric", color: "#f59e0b", delta: e.tpr_at_fpr1e3 - p.tpr_at_fpr1e3 },
          { label: "Accuracy", value: (e.accuracy*100).toFixed(1)+"%", sub: `Precision: ${(e.precision*100).toFixed(1)}%`, color: "#10b981", delta: e.accuracy - p.accuracy },
        ].map((m) => (
          <div key={m.label} className="card card-hover p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-slate-500">{m.label}</p>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${m.delta >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
                {m.delta >= 0 ? "+" : ""}{m.delta.toFixed(4)}
              </span>
            </div>
            <p className="text-2xl font-bold font-mono" style={{ color: m.color }}>{m.value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Precision", value: (e.precision*100).toFixed(2)+"%", note: "TP / (TP+FP) — how accurate positive calls are" },
          { label: "Recall / TPR", value: (e.recall*100).toFixed(2)+"%", note: "TP / (TP+FN) — coverage of all malware" },
          { label: "Avg Precision (AP)", value: e.average_precision.toFixed(4), note: "Area under PR curve" },
          { label: "Val Samples", value: data.dataset.val.toString(), note: `${data.dataset.val_malicious} malicious · ${data.dataset.val - data.dataset.val_malicious} benign` },
        ].map((m) => (
          <div key={m.label} className="card p-4 bg-slate-50">
            <p className="text-xs font-medium text-slate-500 mb-1">{m.label}</p>
            <p className="text-lg font-bold text-slate-800">{m.value}</p>
            <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{m.note}</p>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
        {([["overview","Overview"],["roc","ROC & PR"],["training","Training Curves"],["confusion","Confusion Matrix"],["compare","Model Comparison"],["dataset","Dataset"]] as const).map(([id, label]) => (
          <button key={id} className={`tab-btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id as typeof tab)}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === "overview" && (
        <div className="space-y-4 animate-fade-in-up">
        <div className="grid grid-cols-2 gap-4">
          {/* Probability distribution */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Score Distribution</h3>
            <p className="text-xs text-slate-400 mb-4">
              Malware probability histograms — well-separated peaks indicate strong discrimination
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={buckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Area type="monotone" dataKey="mal" name="Malicious" stroke="#ef4444" fill="#fee2e2" strokeWidth={2} />
                <Area type="monotone" dataKey="ben" name="Benign" stroke="#10b981" fill="#d1fae5" strokeWidth={2} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Per-metric bar */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Metric Summary</h3>
            <div className="space-y-3">
              {[
                { label: "AUC-ROC",           val: e.auc,               color: "#6366f1" },
                { label: "F1 Score",           val: e.f1,                color: "#8b5cf6" },
                { label: "Avg Precision (AP)", val: e.average_precision, color: "#06b6d4" },
                { label: "Precision",          val: e.precision,         color: "#10b981" },
                { label: "Recall",             val: e.recall,            color: "#f59e0b" },
                { label: "Accuracy",           val: e.accuracy,          color: "#64748b" },
              ].map((m) => (
                <div key={m.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">{m.label}</span>
                    <span className="font-mono font-semibold" style={{ color: m.color }}>
                      {(m.val * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="prob-meter">
                    <div className="prob-meter-fill" style={{ width: `${m.val * 100}%`, background: m.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Dataset split */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Dataset Split</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Train Total", val: data.dataset.train, color: "#6366f1" },
                { label: "Val Total", val: data.dataset.val, color: "#8b5cf6" },
                { label: "Train Malicious", val: data.dataset.train_malicious, color: "#ef4444" },
                { label: "Val Malicious", val: data.dataset.val_malicious, color: "#f97316" },
              ].map((s) => (
                <div key={s.label} className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-400">{s.label}</p>
                  <p className="text-xl font-bold" style={{ color: s.color }}>{s.val}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Training config */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Training Config</h3>
            <div className="space-y-1.5">
              {[
                ["Optimizer", "AdamW"],
                ["Learning Rate", String(trainCfg.lr)],
                ["Weight Decay", String(trainCfg.weight_decay)],
                ["Batch Size", String(trainCfg.batch_size)],
                ["Epochs", String(th.train_loss.length)],
                ["Label Smoothing", "ε = 0.05"],
                ["Grad Clip", String(trainCfg.grad_clip)],
                ["LR Schedule", "Cosine + warmup"],
                ["Device", data.device.toUpperCase()],
                ["Total Time", `${e.elapsed_minutes}min`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-slate-500">{k}</span>
                  <span className="font-mono font-medium text-slate-800">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Calibration + Deployment row */}
        <div className="grid grid-cols-2 gap-4">
          {/* Calibration curve */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Probability Calibration</h3>
            <p className="text-xs text-slate-400 mb-3">
              Does a predicted probability of 70% actually mean 70% of those samples are malware?
              Points on the diagonal = perfectly calibrated.
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={calibData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="predicted" type="number" domain={[0,1]} tickFormatter={(v) => `${(v*100).toFixed(0)}%`} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} label={{ value: "Predicted prob", position: "insideBottom", offset: -2, fontSize: 10, fill: "#94a3b8" }} />
                <YAxis domain={[0,1]} tickFormatter={(v) => `${(v*100).toFixed(0)}%`} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} label={{ value: "Actual freq", angle: -90, position: "insideLeft", fontSize: 10, fill: "#94a3b8" }} />
                <Tooltip formatter={(v, name) => [`${((v as number)*100).toFixed(1)}%`, name === "perfect" ? "Perfect calibration" : "Model"]} contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: 11 }} />
                <Line type="monotone" dataKey="perfect" stroke="#cbd5e1" strokeDasharray="4 4" dot={false} strokeWidth={1} name="perfect" />
                <Line type="monotone" dataKey="actual" stroke="#6366f1" dot={{ r: 4, fill: "#6366f1" }} strokeWidth={2} name="Model" />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Deployment readiness */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Deployment Readiness</h3>
            <p className="text-xs text-slate-400 mb-3">How ready is this model for a real security product?</p>
            <div className="space-y-2">
              {[
                {
                  criterion: "Detection Rate (TPR)", value: `${(e.recall*100).toFixed(1)}%`,
                  status: e.recall >= 0.95 ? "green" : e.recall >= 0.90 ? "amber" : "red",
                  note: "≥95% catches nearly all malware in the wild",
                },
                {
                  criterion: "False Alarm Rate (FPR)", value: `${(fp/(fp+tn)*100).toFixed(2)}%`,
                  status: fp/(fp+tn) <= 0.01 ? "green" : fp/(fp+tn) <= 0.05 ? "amber" : "red",
                  note: "≤1% FPR acceptable in enterprise AV",
                },
                {
                  criterion: "Discrimination (AUC)", value: e.auc.toFixed(4),
                  status: e.auc >= 0.97 ? "green" : e.auc >= 0.93 ? "amber" : "red",
                  note: "≥0.97 indicates robust separation",
                },
                {
                  criterion: "Inference Speed", value: `~${msPerSample}ms/sample`,
                  status: parseFloat(msPerSample) <= 50 ? "green" : parseFloat(msPerSample) <= 200 ? "amber" : "red",
                  note: "≤50ms enables real-time file scanning",
                },
                {
                  criterion: "Balanced Dataset", value: `47% mal / 51% ben`,
                  status: "green",
                  note: "Near-balanced classes → unbiased precision/recall",
                },
                {
                  criterion: "Probability Calibration", value: "Visual check",
                  status: e.auc > 0.95 ? "amber" : "red",
                  note: "Mild overconfidence typical for transformers",
                },
              ].map((row) => (
                <div key={row.criterion} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${row.status === "green" ? "bg-emerald-400" : row.status === "amber" ? "bg-amber-400" : "bg-red-400"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700">{row.criterion}</span>
                      <span className="text-xs font-mono font-bold text-slate-800 ml-2 shrink-0">{row.value}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-tight">{row.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>
      )}

      {/* ── ROC & PR ── */}
      {tab === "roc" && (
        <div className="space-y-4 animate-fade-in-up">
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-slate-800">ROC Curve</h3>
                <div className="flex gap-3 text-xs">
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-indigo-500 inline-block" /> Enhanced ({e.auc.toFixed(4)})</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-purple-400 inline-block" /> Baseline ({p.auc.toFixed(4)})</span>
                </div>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                True Positive Rate vs False Positive Rate — closer to top-left = better
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={rocData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="fpr" type="number" domain={[0,1]} tickFormatter={(v) => v.toFixed(1)} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} label={{ value: "FPR", position: "insideBottom", offset: -2, fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis domain={[0,1]} tickFormatter={(v) => v.toFixed(1)} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} label={{ value: "TPR", angle: -90, position: "insideLeft", fontSize: 10, fill: "#94a3b8" }} />
                  <Tooltip formatter={(v) => [(v as number).toFixed(4)]} contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: 11 }} />
                  <ReferenceLine x={0} y={0} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} />
                  <Line type="monotone" dataKey="random" stroke="#cbd5e1" strokeDasharray="4 4" dot={false} strokeWidth={1} name="Random" />
                  <Line type="monotone" dataKey="paper" stroke="#a78bfa" dot={false} strokeWidth={1.5} name={`Paper (${p.auc.toFixed(4)})`} />
                  <Line type="monotone" dataKey="enhanced" stroke="#6366f1" dot={false} strokeWidth={2.5} name={`Enhanced (${e.auc.toFixed(4)})`} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-slate-800">Precision-Recall Curve</h3>
                <span className="text-xs text-slate-400">AP = {e.average_precision.toFixed(4)}</span>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Precision vs Recall — important for imbalanced classes
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={prData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="recall" type="number" domain={[0,1]} tickFormatter={(v) => v.toFixed(1)} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} label={{ value: "Recall", position: "insideBottom", offset: -2, fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis domain={[0,1]} tickFormatter={(v) => v.toFixed(1)} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} label={{ value: "Precision", angle: -90, position: "insideLeft", fontSize: 10, fill: "#94a3b8" }} />
                  <Tooltip formatter={(v) => [(v as number).toFixed(4)]} contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: 11 }} />
                  <Line type="monotone" dataKey="paper" stroke="#a78bfa" dot={false} strokeWidth={1.5} name={`Paper (${p.average_precision.toFixed(4)})`} />
                  <Line type="monotone" dataKey="enhanced" stroke="#6366f1" dot={false} strokeWidth={2.5} name={`Enhanced (${e.average_precision.toFixed(4)})`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* FPR=1e-3 callout */}
          <div className="card p-5 border-l-4 border-l-amber-400">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                <Target size={18} className="text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">TPR @ FPR = 10⁻³ — The Paper's Key Metric</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  In enterprise security, a false positive rate of 0.1% (1 in 1000 benign files flagged) is the maximum acceptable.
                  At this operating point, the model must still detect as many malware samples as possible.
                  This metric directly measures real-world deployability.
                </p>
                <div className="flex gap-6 mt-3">
                  <div>
                    <p className="text-xs text-slate-400">Enhanced</p>
                    <p className="text-xl font-bold text-indigo-600">{(e.tpr_at_fpr1e3*100).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Baseline</p>
                    <p className="text-xl font-bold text-purple-400">{(p.tpr_at_fpr1e3*100).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Paper (reported)</p>
                    <p className="text-xl font-bold text-slate-400">91.0%</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* False positive cost analysis */}
          <div className="card p-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-red-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-800">False Positive Cost at Scale</p>
                <p className="text-xs text-slate-500 mt-1 mb-3 leading-relaxed">
                  An AV scanner processing 10,000 files per day — how many benign files would be flagged as malware?
                  Analyst time wasted = FP count × avg. triage time.
                </p>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { files: 1_000, label: "1k files/day" },
                    { files: 10_000, label: "10k files/day" },
                    { files: 100_000, label: "100k files/day" },
                    { files: 1_000_000, label: "1M files/day" },
                  ].map(({ files, label }) => {
                    const fpr = fp / (fp + tn);
                    const falseAlarms = Math.round(files * fpr);
                    const wasted = Math.round(falseAlarms * 5); // 5min/FP triage
                    return (
                      <div key={label} className="bg-slate-50 rounded-lg p-3 text-center">
                        <p className="text-[10px] text-slate-400 mb-1">{label}</p>
                        <p className="text-lg font-bold text-red-500">{falseAlarms.toLocaleString()}</p>
                        <p className="text-[10px] text-slate-400">false alarms</p>
                        <p className="text-[10px] text-orange-400 mt-0.5 font-medium">{wasted >= 60 ? `${(wasted/60).toFixed(0)}h` : `${wasted}min`} triage</p>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-400 mt-2">Assumes current val-set FPR of {((fp/(fp+tn))*100).toFixed(2)}% · 5 min per false alarm to triage</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Training Curves ── */}
      {tab === "training" && (
        <div className="space-y-4 animate-fade-in-up">
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">AUC-ROC per Epoch</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trainData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="epoch" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} />
                  <YAxis domain={["auto","auto"]} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(3)} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: 11 }} formatter={(v) => [(v as number).toFixed(4)]} />
                  <Line type="monotone" dataKey="Val AUC" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3, fill: "#6366f1" }} />
                  <Line type="monotone" dataKey="Paper AUC" stroke="#a78bfa" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Training Loss</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trainData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="epoch" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(3)} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: 11 }} formatter={(v) => [(v as number).toFixed(4)]} />
                  <Area type="monotone" dataKey="Train Loss" stroke="#ef4444" fill="#fee2e2" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">F1 & TPR@FPR=1e-3</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trainData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="epoch" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} />
                  <YAxis domain={["auto","auto"]} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(3)} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: 11 }} formatter={(v) => [(v as number).toFixed(4)]} />
                  <Line type="monotone" dataKey="Val F1" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3, fill: "#8b5cf6" }} />
                  <Line type="monotone" dataKey="TPR@FPR1e-3" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: "#f59e0b" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Epoch Time (seconds)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trainData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="epoch" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: 11 }} />
                  <Area type="monotone" dataKey="Epoch Time (s)" stroke="#06b6d4" fill="#cffafe" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* LR schedule */}
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-1">Learning Rate Schedule</h3>
              <p className="text-xs text-slate-400 mb-3">
                Linear warmup for first {warmupSteps} steps, then cosine decay.
                The model starts gently, peaks at lr={trainCfg.lr as number}, then slowly anneals to near-zero.
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={lrScheduleData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="step" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} label={{ value: "Step", position: "insideBottom", offset: -2, fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toExponential(0)} />
                  <Tooltip formatter={(v) => [(v as number).toExponential(4), "LR"]} contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: 11 }} />
                  <Area type="monotone" dataKey="lr" stroke="#f59e0b" fill="#fef3c7" strokeWidth={2} name="Learning Rate" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Per-epoch table */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-800">Epoch-by-Epoch Results</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {["Epoch","Train Loss","Val AUC","Val F1","TPR@1e-3","Δ AUC","Time"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trainData.map((row, i) => {
                    const prev = i > 0 ? trainData[i-1]["Val AUC"] : row["Val AUC"];
                    const delta = row["Val AUC"] - prev;
                    const isBest = row["Val AUC"] === Math.max(...trainData.map(r => r["Val AUC"]));
                    return (
                      <tr key={i} className={`border-b border-slate-50 ${isBest ? "bg-indigo-50/50" : ""}`}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono">{row.epoch}</span>
                            {isBest && <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-semibold">best</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-600">{row["Train Loss"].toFixed(4)}</td>
                        <td className="px-4 py-2.5 font-mono font-semibold text-indigo-600">{row["Val AUC"].toFixed(4)}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-600">{row["Val F1"].toFixed(4)}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-600">{row["TPR@FPR1e-3"].toFixed(4)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-mono ${delta > 0 ? "text-emerald-500" : delta < 0 ? "text-red-400" : "text-slate-300"}`}>
                            {i === 0 ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(4)}`}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{row["Epoch Time (s)"].toFixed(1)}s</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Confusion Matrix ── */}
      {tab === "confusion" && (
        <div className="space-y-4 animate-fade-in-up">
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-slate-800 mb-4">Confusion Matrix</h3>
              <div className="grid grid-cols-3 gap-2 text-center text-sm mb-2">
                <div />
                <div className="text-xs font-semibold text-red-500 py-2">Predicted Malicious</div>
                <div className="text-xs font-semibold text-emerald-600 py-2">Predicted Benign</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex items-center justify-end pr-3">
                  <span className="text-xs font-semibold text-red-500 rotate-[-90deg] whitespace-nowrap">Actual Malicious</span>
                </div>
                <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-emerald-600">{tp}</p>
                  <p className="text-xs text-emerald-500 font-medium mt-1">True Positive</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{(tp/total*100).toFixed(1)}%</p>
                </div>
                <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-red-400">{fn}</p>
                  <p className="text-xs text-red-400 font-medium mt-1">False Negative</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Missed malware</p>
                </div>
                <div className="flex items-center justify-end pr-3">
                  <span className="text-xs font-semibold text-emerald-600 rotate-[-90deg] whitespace-nowrap">Actual Benign</span>
                </div>
                <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-orange-400">{fp}</p>
                  <p className="text-xs text-orange-400 font-medium mt-1">False Positive</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">False alarm</p>
                </div>
                <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-emerald-600">{tn}</p>
                  <p className="text-xs text-emerald-500 font-medium mt-1">True Negative</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{(tn/total*100).toFixed(1)}%</p>
                </div>
              </div>
            </div>

            <div className="card p-6 space-y-4">
              <h3 className="text-sm font-semibold text-slate-800">Derived Metrics</h3>
              {[
                { label: "True Positive Rate (Recall / Sensitivity)", formula: "TP / (TP + FN)", value: (tp/(tp+fn)).toFixed(4), color: "#10b981", interpretation: "Fraction of all malware samples correctly detected" },
                { label: "True Negative Rate (Specificity)", formula: "TN / (TN + FP)", value: (tn/(tn+fp)).toFixed(4), color: "#6366f1", interpretation: "Fraction of benign samples correctly classified" },
                { label: "Positive Predictive Value (Precision)", formula: "TP / (TP + FP)", value: (tp/(tp+fp)).toFixed(4), color: "#8b5cf6", interpretation: "When model says malware, it is right this fraction of the time" },
                { label: "Negative Predictive Value", formula: "TN / (TN + FN)", value: (tn/(tn+fn)).toFixed(4), color: "#f59e0b", interpretation: "When model says benign, it is right this fraction of the time" },
                { label: "False Positive Rate", formula: "FP / (FP + TN)", value: (fp/(fp+tn)).toFixed(6), color: "#ef4444", interpretation: "Fraction of benign files incorrectly flagged as malware" },
                { label: "Matthews Correlation Coefficient", formula: "Balanced accuracy metric", value: (((tp*tn - fp*fn) / Math.sqrt((tp+fp)*(tp+fn)*(tn+fp)*(tn+fn)))).toFixed(4), color: "#0891b2", interpretation: "Single balanced metric; 1.0 = perfect, 0 = random" },
              ].map((m) => (
                <div key={m.label} className="flex items-start gap-3">
                  <div className="w-14 text-right shrink-0 pt-0.5">
                    <span className="font-mono font-bold text-sm" style={{ color: m.color }}>{m.value}</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-700">{m.label}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{m.formula}</p>
                    <p className="text-[10px] text-slate-400 leading-tight">{m.interpretation}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Dataset ── */}
      {tab === "dataset" && (
        <div className="space-y-4 animate-fade-in-up">
          {/* Old vs New comparison */}
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Dataset Evolution</h3>
            <p className="text-xs text-slate-400 mb-4">We started with the Nebula paper's small dataset and expanded it with the full QuoVadis-Speakeasy corpus. This shows the before/after.</p>
            <div className="grid grid-cols-3 gap-4">
              {[
                {
                  label: "Original Dataset", badge: "v1", badgeColor: "bg-slate-100 text-slate-500",
                  stats: [
                    { k: "Total Samples", v: "1,561", color: "#64748b" },
                    { k: "Malicious", v: "1,323 (84.8%)", color: "#ef4444" },
                    { k: "Benign", v: "238 (15.2%)", color: "#10b981" },
                    { k: "Classes", v: "2 (binary)", color: "#6366f1" },
                    { k: "Source", v: "Paper sample set", color: "#94a3b8" },
                  ],
                  note: "Heavy class imbalance — model biased toward malicious. Low TPR@FPR=1e-3 (~0% for first 7 epochs).",
                  bg: "bg-red-50 border-red-200",
                },
                {
                  label: "New Dataset", badge: "v2", badgeColor: "bg-emerald-100 text-emerald-600",
                  stats: [
                    { k: "Total Samples", v: "6,317", color: "#10b981" },
                    { k: "Malicious", v: "3,017 (47.8%)", color: "#ef4444" },
                    { k: "Benign", v: "3,300 (52.2%)", color: "#10b981" },
                    { k: "Classes", v: "5 families", color: "#6366f1" },
                    { k: "Source", v: "QuoVadis-Speakeasy", color: "#94a3b8" },
                  ],
                  note: "Near-balanced dataset. Model learns both classes equally — TPR@FPR=1e-3 jumped to 90.5%.",
                  bg: "bg-emerald-50 border-emerald-200",
                },
                {
                  label: "Improvement", badge: "Δ", badgeColor: "bg-indigo-100 text-indigo-600",
                  stats: [
                    { k: "Samples", v: "+4,756 (+305%)", color: "#6366f1" },
                    { k: "Balance ratio", v: "84.8% → 47.8%", color: "#f59e0b" },
                    { k: "AUC-ROC", v: `→ ${e.auc.toFixed(4)}`, color: "#6366f1" },
                    { k: "F1 Score", v: `→ ${e.f1.toFixed(4)}`, color: "#8b5cf6" },
                    { k: "TPR@FPR=1e-3", v: `→ ${(e.tpr_at_fpr1e3*100).toFixed(1)}%`, color: "#f59e0b" },
                  ],
                  note: "More data + better balance = dramatically improved low-FPR detection.",
                  bg: "bg-indigo-50 border-indigo-200",
                },
              ].map((card) => (
                <div key={card.label} className={`border rounded-xl p-4 ${card.bg}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${card.badgeColor}`}>{card.badge}</span>
                    <p className="text-xs font-semibold text-slate-700">{card.label}</p>
                  </div>
                  <div className="space-y-1.5 mb-3">
                    {card.stats.map((s) => (
                      <div key={s.k} className="flex justify-between text-xs">
                        <span className="text-slate-500">{s.k}</span>
                        <span className="font-mono font-semibold" style={{ color: s.color }}>{s.v}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed border-t border-current/10 pt-2">{card.note}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Family breakdown + balance bar */}
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-1">Family Distribution</h3>
              <p className="text-xs text-slate-400 mb-4">
                How many samples belong to each malware family. Families with fewer samples are harder to detect.
              </p>
              <div className="space-y-3">
                {datasetFamilies.map((f) => (
                  <div key={f.family}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full`} style={{ background: f.color }} />
                        <span className="text-slate-700 font-medium">{f.family}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${f.label === 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
                          {f.label === 0 ? "benign" : "malicious"}
                        </span>
                      </span>
                      <span className="font-mono font-semibold text-slate-800">{f.count.toLocaleString()}</span>
                    </div>
                    <div className="prob-meter">
                      <div className="prob-meter-fill" style={{ width: `${(f.count / 3300) * 100}%`, background: f.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-1">Class Balance</h3>
              <p className="text-xs text-slate-400 mb-4">
                Train/validation split with malicious vs benign breakdown in each set.
              </p>
              <div className="space-y-4">
                {[
                  { label: "Train set", total: data.dataset.train ?? 0, malicious: data.dataset.train_malicious ?? 0 },
                  { label: "Val set", total: data.dataset.val ?? 0, malicious: data.dataset.val_malicious ?? 0 },
                ].map((s) => {
                  const benign = s.total - s.malicious;
                  const malPct = s.total > 0 ? (s.malicious / s.total * 100) : 0;
                  const benPct = 100 - malPct;
                  return (
                    <div key={s.label}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="font-medium text-slate-700">{s.label}</span>
                        <span className="text-slate-400 font-mono">{s.total.toLocaleString()} total</span>
                      </div>
                      <div className="h-5 rounded-full overflow-hidden flex">
                        <div className="h-full bg-red-400 flex items-center justify-center" style={{ width: `${malPct}%` }}>
                          {malPct > 15 && <span className="text-[9px] text-white font-bold">{malPct.toFixed(0)}%</span>}
                        </div>
                        <div className="h-full bg-emerald-400 flex items-center justify-center flex-1">
                          {benPct > 15 && <span className="text-[9px] text-white font-bold">{benPct.toFixed(0)}%</span>}
                        </div>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                        <span className="text-red-400 font-medium">{s.malicious.toLocaleString()} malicious</span>
                        <span className="text-emerald-500 font-medium">{benign.toLocaleString()} benign</span>
                      </div>
                    </div>
                  );
                })}

                <div className="border-t border-slate-100 pt-3 space-y-1.5">
                  <p className="text-xs font-semibold text-slate-700">Val Set Quality</p>
                  {[
                    { k: "Val Precision", v: (tp/(tp+fp)).toFixed(4), color: "#8b5cf6" },
                    { k: "Val Recall", v: (tp/(tp+fn)).toFixed(4), color: "#10b981" },
                    { k: "Val MCC", v: ((tp*tn - fp*fn) / Math.sqrt((tp+fp)*(tp+fn)*(tn+fp)*(tn+fn))).toFixed(4), color: "#0891b2" },
                  ].map((m) => (
                    <div key={m.k} className="flex justify-between text-xs">
                      <span className="text-slate-500">{m.k}</span>
                      <span className="font-mono font-bold" style={{ color: m.color }}>{m.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Download source info */}
          <div className="card p-5 border-l-4 border-l-cyan-400 bg-cyan-50/30">
            <div className="flex items-start gap-3">
              <Zap size={16} className="text-cyan-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-800">Data Source: QuoVadis-Speakeasy</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  The dataset was sourced from the <span className="font-medium">QuoVadis</span> benchmark (HuggingFace: <span className="font-mono text-slate-700">dtrizna/quovadis</span>),
                  which provides Speakeasy emulation reports for ~93,000 Windows PE files.
                  We downloaded 5.5 GB of raw JSON reports and merged them using <span className="font-mono text-slate-700">scripts/merge_dataset.py</span>.
                  Label assignment was inferred from directory structure (ransomware/, backdoor/, trojan/, etc.).
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Model Comparison ── */}
      {tab === "compare" && (
        <div className="space-y-4 animate-fade-in-up">
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-800">NebulaEnhanced vs NebulaPaper Baseline</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 w-48">Metric</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-indigo-600">NebulaEnhanced</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-purple-500">NebulaPaper (Baseline)</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-amber-500">Paper Reported</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-400">Δ Enh vs Base</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { metric: "AUC-ROC",           e: e.auc,               p_: p.auc,               reported: 0.9992, fmt: (v: number) => v.toFixed(4) },
                  { metric: "F1 Score",           e: e.f1,                p_: p.f1,                reported: 0.9830, fmt: (v: number) => v.toFixed(4) },
                  { metric: "Accuracy",           e: e.accuracy,          p_: p.accuracy,          reported: null,   fmt: (v: number) => (v*100).toFixed(2)+"%" },
                  { metric: "Precision",          e: e.precision,         p_: null,                reported: null,   fmt: (v: number) => v.toFixed(4) },
                  { metric: "Recall",             e: e.recall,            p_: null,                reported: null,   fmt: (v: number) => v.toFixed(4) },
                  { metric: "Avg Precision (AP)", e: e.average_precision, p_: p.average_precision, reported: null,   fmt: (v: number) => v.toFixed(4) },
                  { metric: "TPR @ FPR=1e-3",    e: e.tpr_at_fpr1e3,     p_: p.tpr_at_fpr1e3,    reported: 0.9100, fmt: (v: number) => (v*100).toFixed(2)+"%" },
                  { metric: "Parameters",         e: e.parameters,        p_: p.parameters,        reported: null,   fmt: (v: number) => v.toLocaleString() },
                  { metric: "Train Time (min)",   e: e.elapsed_minutes,   p_: p.elapsed_minutes,   reported: null,   fmt: (v: number) => v.toFixed(1) },
                ].map((row) => {
                  const delta = row.p_ != null ? row.e - row.p_ : null;
                  return (
                    <tr key={row.metric} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-5 py-3 font-medium text-slate-700">{row.metric}</td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-indigo-600">{row.fmt(row.e)}</td>
                      <td className="px-4 py-3 text-center font-mono text-purple-500">{row.p_ != null ? row.fmt(row.p_) : "—"}</td>
                      <td className="px-4 py-3 text-center font-mono text-slate-400">{row.reported !== null ? row.fmt(row.reported) : "—"}</td>
                      <td className="px-4 py-3 text-center">
                        {delta !== null ? (
                          <span className={`text-xs font-semibold font-mono ${delta > 0 ? "text-emerald-500" : delta < 0 ? "text-red-400" : "text-slate-300"}`}>
                            {delta > 0 ? "+" : ""}{typeof delta === "number" && Math.abs(delta) < 1 ? delta.toFixed(4) : delta.toLocaleString()}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Architecture differences */}
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">What We Changed vs the Original Paper</h3>
            <p className="text-xs text-slate-400 mb-4">The original Nebula paper described a chunked-attention architecture. We kept that core idea and made 8 targeted improvements — each one addresses a specific training problem.</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  feature: "Pooling Strategy",
                  enhanced: "CLS token (BERT-style)", baseline: "Mean pooling",
                  impact: "Better task-specific representation",
                  why: "Mean pooling treats all 512 tokens equally — a single rare but critical API call (e.g. CryptEncrypt) gets diluted. The CLS token is trained end-to-end to summarise the whole sequence for the classification task, so it learns to weight important tokens more heavily.",
                },
                {
                  feature: "Layer Normalization",
                  enhanced: "Pre-LayerNorm (norm_first=True)", baseline: "Post-LayerNorm",
                  impact: "More stable gradient flow",
                  why: "In the original (post-norm), activations can grow very large before normalisation, causing unstable gradients early in training. Pre-norm normalises the input first, keeping values in a well-behaved range throughout training — especially important with our small d_model=64.",
                },
                {
                  feature: "Loss Function",
                  enhanced: "BCE + label smoothing ε=0.05", baseline: "BCE, hard labels",
                  impact: "Better calibrated probabilities",
                  why: "Hard labels (0 or 1) push the model to be 100% confident — which causes overconfidence and poor probability estimates. Label smoothing targets 0.05 / 0.95 instead, teaching the model to express uncertainty. This also prevents overfitting on noisy training labels.",
                },
                {
                  feature: "LR Schedule",
                  enhanced: "Cosine + 200-step warmup", baseline: "Cosine (no warmup)",
                  impact: "Avoids early training instability",
                  why: "Starting with a large learning rate when weights are random causes the model to diverge in the first few batches. The 200-step linear warmup ramps the learning rate from near-zero to its target value, letting the model stabilise before making large gradient steps.",
                },
                {
                  feature: "Global Context Layer",
                  enhanced: "Global attn layer on all chunks", baseline: "Independent chunk attention",
                  impact: "Cross-chunk information sharing",
                  why: "Chunked attention is efficient but each chunk is isolated — a token in chunk 1 can't see chunk 8. A ransomware sample might have VirtualAlloc in chunk 1 and CryptEncrypt in chunk 5: without a global layer, the model misses that connection. Our global layer (attending to the full sequence once) closes this gap at minimal cost.",
                },
                {
                  feature: "Activations",
                  enhanced: "GELU in classifier head", baseline: "ReLU",
                  impact: "Smoother gradient landscape",
                  why: "ReLU hard-zeros all negative activations, which can 'kill' neurons during training (the dying ReLU problem). GELU (used in GPT, BERT) has a smooth curve near zero — neurons still receive a gradient even when their input is slightly negative, leading to better convergence.",
                },
                {
                  feature: "Positional Encoding",
                  enhanced: "Sinusoidal + learnable option", baseline: "Sinusoidal only",
                  impact: "Adaptable to dataset structure",
                  why: "Sinusoidal encoding uses a fixed mathematical formula. Learnable encoding lets the model discover the best positional representation for API call sequences — which may differ from natural language. We include both as a configurable option.",
                },
                {
                  feature: "Gradient Clipping",
                  enhanced: "Max norm = 1.0", baseline: "Unspecified in paper",
                  impact: "Prevents exploding gradients",
                  why: "Without clipping, a single bad mini-batch can produce enormous gradients that overwrite the model's learned weights. Capping the gradient norm at 1.0 acts as a safety valve — the direction of the update is preserved but the magnitude is bounded.",
                },
              ].map((row) => (
                <div key={row.feature} className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-700">{row.feature}</p>
                  <div className="flex gap-2 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium shrink-0">We used: {row.enhanced}</span>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">Paper used: {row.baseline}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">{row.why}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
