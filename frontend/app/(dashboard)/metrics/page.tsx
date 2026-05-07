"use client";
import { useEffect, useState } from "react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, ReferenceLine,
  ScatterChart, Scatter, ZAxis,
} from "recharts";
import { BarChart2, Loader2, TrendingUp, Target, Activity, CheckCircle, AlertTriangle, RefreshCw } from "lucide-react";
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
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function MetricsPage() {
  const [data, setData] = useState<TrainingResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"overview" | "roc" | "training" | "confusion" | "compare">("overview");

  async function load() {
    setLoading(true); setError("");
    try {
      const r = await fetch(`${API}/results`);
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load results");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

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

  // Build training curves
  const trainData = th.train_loss.map((loss, i) => ({
    epoch: i + 1,
    "Train Loss": parseFloat(loss.toFixed(4)),
    "Val AUC": parseFloat((th.val_auc[i] ?? 0).toFixed(4)),
    "Val F1": parseFloat((th.val_f1[i] ?? 0).toFixed(4)),
    "TPR@FPR1e-3": parseFloat((th.val_tpr_at_fpr1e3[i] ?? 0).toFixed(4)),
    "Paper AUC": parseFloat((p.train_history.val_auc[i] ?? 0).toFixed(4)),
    "Epoch Time (s)": parseFloat((th.epoch_times[i] ?? 0).toFixed(1)),
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
        <button className="btn-secondary text-xs py-2" onClick={load}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

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
        {([["overview","Overview"],["roc","ROC & PR"],["training","Training Curves"],["confusion","Confusion Matrix"],["compare","Model Comparison"]] as const).map(([id, label]) => (
          <button key={id} className={`tab-btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id as typeof tab)}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === "overview" && (
        <div className="grid grid-cols-2 gap-4 animate-fade-in-up">
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
                ["Learning Rate", String(data.train_config.lr)],
                ["Weight Decay", String(data.train_config.weight_decay)],
                ["Batch Size", String(data.train_config.batch_size)],
                ["Epochs", String(th.train_loss.length)],
                ["Label Smoothing", "ε = 0.05"],
                ["Grad Clip", String(data.train_config.grad_clip)],
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
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Architectural Differences</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { feature: "Pooling Strategy", enhanced: "CLS token (BERT-style)", baseline: "Mean pooling", impact: "Better task-specific representation" },
                { feature: "Layer Normalization", enhanced: "Pre-LayerNorm (norm_first=True)", baseline: "Post-LayerNorm", impact: "More stable gradient flow" },
                { feature: "Loss Function", enhanced: "BCE + label smoothing ε=0.05", baseline: "BCE, hard labels", impact: "Better calibration, less overfit" },
                { feature: "LR Schedule", enhanced: "Cosine + 200-step warmup", baseline: "Cosine (no warmup)", impact: "Avoids early divergence" },
                { feature: "Global Context", enhanced: "Global attn layer on all chunks", baseline: "Independent chunk attention", impact: "Cross-span information" },
                { feature: "Activations", enhanced: "GELU in classifier head", baseline: "ReLU", impact: "Smoother gradient landscape" },
                { feature: "Positional Encoding", enhanced: "Sinusoidal (learnable option)", baseline: "Sinusoidal only", impact: "Optional adaptability" },
                { feature: "Gradient Clipping", enhanced: "norm = 1.0", baseline: "Unspecified", impact: "Prevents exploding gradients" },
              ].map((row) => (
                <div key={row.feature} className="border border-slate-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-slate-700 mb-1.5">{row.feature}</p>
                  <div className="flex gap-2 text-xs mb-1">
                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium">Enhanced: {row.enhanced}</span>
                  </div>
                  <div className="flex gap-2 text-xs mb-1">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Baseline: {row.baseline}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">→ {row.impact}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
