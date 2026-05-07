"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ModelMetrics, DatasetStats } from "@/lib/api";
import {
  Shield, Activity, Database, Zap, ArrowRight, CheckCircle,
  Cpu, BrainCircuit, Microscope, Sparkles, Target, Globe,
  RefreshCw, Layers, BookOpen
} from "lucide-react";

const FEATURES = [
  {
    icon: Shield,
    title: "Transformer Detection",
    desc: "Chunked self-attention with O(MS²) complexity. CLS pooling, pre-LayerNorm, 512-token sequences.",
    color: "#6366f1",
    bg: "#eef2ff",
    href: "/analyze",
  },
  {
    icon: Microscope,
    title: "XAI Explainability",
    desc: "Attention weight visualization + Integrated Gradients. MITRE ATT&CK behavior mapping.",
    color: "#8b5cf6",
    bg: "#f5f3ff",
    href: "/xai",
  },
  {
    icon: BrainCircuit,
    title: "LLM Analysis",
    desc: "gemma3:27b generates executive summaries, threat reports, and IOC extraction.",
    color: "#06b6d4",
    bg: "#ecfeff",
    href: "/llm",
  },
  {
    icon: Zap,
    title: "Training Pipeline",
    desc: "AdamW + cosine LR warmup, label smoothing, time-budgeted 5-fold CV, TPR@FPR=1e-3.",
    color: "#f59e0b",
    bg: "#fffbeb",
    href: "/training",
  },
];

const IMPROVEMENTS = [
  "CLS token pooling (vs paper's mean pooling)",
  "Pre-LayerNorm for stable training",
  "Learnable positional encodings option",
  "Label smoothing (ε=0.05)",
  "Cosine LR schedule with warmup",
  "Global attention layer over chunk outputs",
  "GELU activations in classifier head",
  "Gradient clipping (norm=1.0)",
];

export default function OverviewPage() {
  const [health, setHealth] = useState<{ status: string; model_loaded: boolean } | null>(null);
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.health().then(setHealth),
      api.metrics().then(setMetrics),
      api.datasetStats().then(setStats),
    ]).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Hero */}
      <div
        className="rounded-2xl p-8 text-white relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 60%, #9333ea 100%)" }}
      >
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Shield size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Nebula Enhanced</h1>
              <p className="text-white/70 text-sm">Dynamic Malware Analysis Platform</p>
            </div>
          </div>
          <p className="text-white/80 text-sm max-w-xl leading-relaxed">
            Transformer-based malware detection with chunked self-attention, XAI explainability,
            and LLM-powered threat intelligence. Built on top of the IEEE 2024 Nebula paper with
            8 architectural improvements.
          </p>
          <div className="flex gap-3 mt-6">
            <Link href="/analyze" className="btn-primary bg-white/20 hover:bg-white/30 backdrop-blur text-sm">
              Analyze Sample <ArrowRight size={14} />
            </Link>
            <Link href="/model" className="btn-secondary bg-white/10 border-white/20 text-white hover:bg-white/20 text-sm">
              View Architecture
            </Link>
          </div>
        </div>
      </div>

      {/* Status Row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          {
            label: "API Status",
            value: loading ? "Checking…" : health?.status === "ok" ? "Online" : "Offline",
            sub: health?.model_loaded ? "Model loaded" : "No checkpoint",
            icon: Activity,
            color: health?.status === "ok" ? "#10b981" : "#ef4444",
          },
          {
            label: "Dataset Size",
            value: stats ? stats.total.toLocaleString() : loading ? "—" : "N/A",
            sub: stats ? `${stats.malicious_pct}% malicious` : "",
            icon: Database,
            color: "#6366f1",
          },
          {
            label: "Val AUC",
            value: metrics?.auc ? metrics.auc.toFixed(4) : loading ? "—" : "Untrained",
            sub: metrics?.epoch ? `Epoch ${metrics.epoch}` : "",
            icon: Activity,
            color: "#8b5cf6",
          },
          {
            label: "TPR@FPR=1e-3",
            value: metrics?.tpr_at_fpr1e3 ? (metrics.tpr_at_fpr1e3 * 100).toFixed(1) + "%" : loading ? "—" : "N/A",
            sub: "Paper key metric",
            icon: Cpu,
            color: "#f59e0b",
          },
        ].map((card) => (
          <div key={card.label} className="card card-hover p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">{card.label}</span>
              <card.icon size={14} style={{ color: card.color }} />
            </div>
            <p className="text-xl font-bold text-slate-900">{card.value}</p>
            {card.sub && <p className="text-xs text-slate-400 mt-0.5">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Feature Cards */}
      <div>
        <h2 className="text-base font-semibold text-slate-800 mb-4">Platform Capabilities</h2>
        <div className="grid grid-cols-2 gap-4">
          {FEATURES.map((f) => (
            <Link key={f.href} href={f.href}>
              <div
                className="card card-hover p-5 cursor-pointer"
                style={{ borderColor: f.color + "20" }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: f.bg }}
                  >
                    <f.icon size={18} style={{ color: f.color }} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-slate-900">{f.title}</p>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{f.desc}</p>
                  </div>
                </div>
                <div
                  className="flex items-center gap-1 mt-3 text-xs font-medium"
                  style={{ color: f.color }}
                >
                  Open <ArrowRight size={11} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Improvements over paper */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-4">
          Improvements Over Paper
          <span className="ml-2 text-xs text-indigo-600 font-normal bg-indigo-50 px-2 py-0.5 rounded-full">
            IEEE 2024
          </span>
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {IMPROVEMENTS.map((imp) => (
            <div key={imp} className="flex items-start gap-2 text-sm text-slate-600">
              <CheckCircle size={14} className="text-emerald-500 mt-0.5 shrink-0" />
              {imp}
            </div>
          ))}
        </div>
      </div>

      {/* Dataset Stats */}
      {stats && (
        <div className="card p-6">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Dataset Overview</h2>
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-slate-500 mb-1">Distribution</p>
              <div className="space-y-1.5">
                <div>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-slate-600">Malicious</span>
                    <span className="font-medium text-red-600">{stats.malicious_pct}%</span>
                  </div>
                  <div className="prob-meter">
                    <div
                      className="prob-meter-fill bg-red-400"
                      style={{ width: `${stats.malicious_pct}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-slate-600">Benign</span>
                    <span className="font-medium text-emerald-600">
                      {(100 - stats.malicious_pct).toFixed(1)}%
                    </span>
                  </div>
                  <div className="prob-meter">
                    <div
                      className="prob-meter-fill bg-emerald-400"
                      style={{ width: `${100 - stats.malicious_pct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Malware Families</p>
              <div className="space-y-1">
                {Object.entries(stats.families)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 5)
                  .map(([fam, count]) => (
                    <div key={fam} className="flex justify-between text-xs">
                      <span className="text-slate-600 capitalize">{fam}</span>
                      <span className="font-medium text-slate-800">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">API Call Stats</p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">Avg APIs/sample</span>
                  <span className="font-medium">{stats.avg_api_calls}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">Max APIs</span>
                  <span className="font-medium">{stats.max_api_calls}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">Sources</span>
                  <span className="font-medium">{Object.keys(stats.sources).length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Try It Yourself CTA */}
      <div
        className="rounded-2xl p-6 text-white relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)" }}
      >
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={16} className="text-purple-200" />
              <span className="text-xs font-semibold text-purple-200 uppercase tracking-wide">Interactive</span>
            </div>
            <h2 className="text-lg font-bold mb-1">Try It Yourself</h2>
            <p className="text-white/70 text-sm max-w-md leading-relaxed">
              Don&apos;t know any malware samples? Enter any Windows API calls — or just describe what
              a program is doing in plain English — and find out if it looks malicious.
            </p>
          </div>
          <Link
            href="/try"
            className="shrink-0 flex items-center gap-2 bg-white text-indigo-700 font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-indigo-50 transition-colors"
          >
            Open <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* Future Use Roadmap */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-1">
          <Target size={16} className="text-indigo-500" />
          <h2 className="text-base font-semibold text-slate-800">How This System Gets Used — Now & Future</h2>
        </div>
        <p className="text-xs text-slate-400 mb-5">From research prototype to production security infrastructure</p>

        {/* Current use */}
        <div className="mb-5">
          <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-2">✓ Works Right Now</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Shield, label: "Malware Triage", desc: "Submit any Speakeasy behavior report and get a verdict in under a second." },
              { icon: Microscope, label: "Explainable Verdict", desc: "See exactly which API calls drove the decision — not just a score." },
              { icon: BrainCircuit, label: "Threat Reports", desc: "LLM generates a plain-English threat intel report with MITRE ATT&CK IDs." },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={13} className="text-emerald-600" />
                  <p className="text-xs font-semibold text-emerald-800">{label}</p>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Near-term roadmap */}
        <div className="mb-5">
          <p className="text-xs font-bold text-amber-600 uppercase tracking-wide mb-2">→ Near-Term (next 6 months)</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Layers, label: "Direct .exe Upload", desc: "Skip manual Speakeasy step — upload a binary and the system emulates it automatically." },
              { icon: RefreshCw, label: "Continuous Retraining", desc: "Model retrains weekly on new malware samples from public repositories like MalwareBazaar." },
              { icon: Globe, label: "SOC Integration", desc: "REST API connects to existing SIEM/EDR tools to enrich security alerts automatically." },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={13} className="text-amber-600" />
                  <p className="text-xs font-semibold text-amber-800">{label}</p>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Long-term vision */}
        <div>
          <p className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-2">◆ Long-Term Vision</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: BookOpen, label: "Auto YARA Rules", desc: "After detecting malware, automatically generate detection rules deployable to any security tool." },
              { icon: Zap, label: "Real-Time Streaming", desc: "Monitor process behavior live across the network — detect malware the instant it starts acting." },
              { icon: Cpu, label: "Federated Learning", desc: "Multiple orgs improve the shared model without sharing sensitive data — privacy-preserving collaboration." },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={13} className="text-indigo-600" />
                  <p className="text-xs font-semibold text-indigo-800">{label}</p>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
