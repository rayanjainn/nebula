"use client";
import { useState, useEffect, useRef } from "react";
import { api, TrainingStatus } from "@/lib/api";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from "recharts";
import { Zap, Play, StopCircle, Loader2, CheckCircle, AlertCircle, Clock } from "lucide-react";

export default function TrainingPage() {
  const [config, setConfig] = useState({
    epochs: 10,
    time_budget_minutes: 15,
    batch_size: 32,
    lr: 0.00025,
  });
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.trainStatus().then(setStatus).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function startTraining() {
    setStarting(true);
    setError("");
    try {
      await api.trainStart(config);
      setPolling(true);
      pollRef.current = setInterval(async () => {
        const s = await api.trainStatus();
        setStatus(s);
        if (!s.running && (s.done || s.error)) {
          clearInterval(pollRef.current!);
          setPolling(false);
        }
      }, 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  }

  const chartData = status?.val_auc?.map((auc, i) => ({
    epoch: i + 1,
    "Val AUC": auc,
    "Val F1": status.val_f1?.[i] ?? 0,
    "TPR@1e-3": status.val_tpr?.[i] ?? 0,
    "Train Loss": status.train_loss?.[i] ?? 0,
  })) || [];

  const isRunning = status?.running;
  const isDone = status?.done;
  const hasError = !!status?.error;
  const currentEpoch = status?.epoch ?? 0;
  const totalEpochs = status?.epochs ?? config.epochs;
  const progress = totalEpochs > 0 ? (currentEpoch / totalEpochs) * 100 : 0;
  const lastAuc = status?.val_auc?.[status.val_auc.length - 1];
  const lastF1 = status?.val_f1?.[status.val_f1.length - 1];

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Training Pipeline</h1>
        <p className="text-sm text-slate-500 mt-1">
          AdamW + cosine LR warmup + label smoothing · time-budgeted training
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Config */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-800">Training Configuration</h3>
          {[
            { key: "epochs", label: "Epochs", min: 1, max: 50, step: 1, format: (v: number) => v },
            { key: "time_budget_minutes", label: "Time Budget (min)", min: 1, max: 60, step: 1, format: (v: number) => v },
            { key: "batch_size", label: "Batch Size", min: 8, max: 128, step: 8, format: (v: number) => v },
            { key: "lr", label: "Learning Rate", min: 1e-5, max: 1e-3, step: 1e-5, format: (v: number) => v.toExponential(1) },
          ].map(({ key, label, min, max, step, format }) => (
            <div key={key}>
              <div className="flex justify-between text-xs mb-1.5">
                <label className="font-medium text-slate-600">{label}</label>
                <span className="text-slate-800 font-mono">{format(config[key as keyof typeof config])}</span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={config[key as keyof typeof config]}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, [key]: parseFloat(e.target.value) }))
                }
                className="w-full accent-indigo-500"
                disabled={isRunning}
              />
            </div>
          ))}

          <div className="pt-2">
            {!isRunning ? (
              <button
                className="btn-primary w-full justify-center"
                onClick={startTraining}
                disabled={starting || isRunning}
              >
                {starting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {starting ? "Starting…" : "Start Training"}
              </button>
            ) : (
              <button className="btn-secondary w-full justify-center border-red-200 text-red-500" disabled>
                <Loader2 size={16} className="animate-spin" />
                Training in progress…
              </button>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}
        </div>

        {/* Status panel */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Status</h3>
            <span className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full
              ${isRunning ? "bg-blue-50 text-blue-600" : isDone ? "bg-green-50 text-green-600" : hasError ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"}`}>
              {isRunning && <Loader2 size={11} className="animate-spin" />}
              {isDone && <CheckCircle size={11} />}
              {hasError && <AlertCircle size={11} />}
              {!isRunning && !isDone && !hasError && <Clock size={11} />}
              {isRunning ? "Running" : isDone ? "Complete" : hasError ? "Error" : "Idle"}
            </span>
          </div>

          {status && (
            <>
              <div>
                <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                  <span>Progress</span>
                  <span>{currentEpoch}/{totalEpochs} epochs</span>
                </div>
                <div className="prob-meter">
                  <div
                    className="prob-meter-fill bg-indigo-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Val AUC", value: lastAuc?.toFixed(4) ?? "—", color: "#6366f1" },
                  { label: "Val F1", value: lastF1?.toFixed(4) ?? "—", color: "#8b5cf6" },
                  {
                    label: "TPR@FPR=1e-3",
                    value: status.val_tpr?.[status.val_tpr.length - 1]
                      ? ((status.val_tpr[status.val_tpr.length - 1]) * 100).toFixed(1) + "%"
                      : "—",
                    color: "#f59e0b",
                  },
                  {
                    label: "Train Loss",
                    value: status.train_loss?.[status.train_loss.length - 1]?.toFixed(4) ?? "—",
                    color: "#ef4444",
                  },
                  {
                    label: "Elapsed",
                    value: status.elapsed_seconds
                      ? `${Math.floor(status.elapsed_seconds / 60)}m ${Math.floor(status.elapsed_seconds % 60)}s`
                      : "—",
                    color: "#64748b",
                  },
                  {
                    label: "Current Epoch",
                    value: String(currentEpoch),
                    color: "#0891b2",
                  },
                ].map((m) => (
                  <div key={m.label} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-slate-500">{m.label}</p>
                    <p className="font-mono font-bold text-sm" style={{ color: m.color }}>
                      {m.value}
                    </p>
                  </div>
                ))}
              </div>

              {hasError && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  Error: {status.error}
                </div>
              )}

              {isDone && (
                <div className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2 flex items-center gap-2">
                  <CheckCircle size={14} />
                  Training complete! Best checkpoint saved.
                </div>
              )}
            </>
          )}

          {!status && (
            <div className="text-sm text-slate-400 py-4 text-center">
              No training history yet
            </div>
          )}
        </div>
      </div>

      {/* Charts */}
      {chartData.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Validation Metrics</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="epoch" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} />
                <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Val AUC" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Val F1" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="TPR@1e-3" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Training Loss</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="epoch" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Line type="monotone" dataKey="Train Loss" stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
