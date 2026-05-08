"use client";
import { useEffect, useState } from "react";
import { api, ModelInfo } from "@/lib/api";
import { Cpu, Loader2, CheckCircle } from "lucide-react";

const ARCHITECTURE_STEPS = [
  {
    step: "1",
    title: "Token Embedding",
    desc: "Input token IDs → dense embeddings of size d_model=64. Scale by √d_model.",
    plain: "Each API call name is first converted into a number (a token ID), then looked up in a table of 50,000 rows to get a 64-number vector that captures its meaning. Think of it like translating words into coordinates in a semantic map.",
    color: "#6366f1",
    detail: "nn.Embedding(50000, 64) · Initialization: N(0, 0.02)",
  },
  {
    step: "2",
    title: "CLS Token Prepend",
    desc: "Learnable [CLS] token prepended to sequence. Used for final classification.",
    plain: "A special learnable 'summary' token is added at the front of the sequence. By the end of the network, this single token will have absorbed information from the entire sequence and is used to make the final malware/benign decision. Borrowed from BERT (the language model that powers Google Search).",
    color: "#8b5cf6",
    detail: "nn.Parameter(zeros(1,1,64)) · trunc_normal_(std=0.02)",
  },
  {
    step: "3",
    title: "Positional Encoding",
    desc: "Sinusoidal PE (paper) or Learnable PE (improvement) added to sequence.",
    plain: "Transformers process all tokens simultaneously (unlike reading left-to-right), so they need to be told the order. Positional encoding adds a position signal to each token — token #1 gets one pattern, token #2 gets a slightly different one, etc. This lets the model know 'VirtualAlloc came before WriteProcessMemory'.",
    color: "#a78bfa",
    detail: "SinusoidalPE · max_len=513 (512+CLS)",
  },
  {
    step: "4",
    title: "Chunked Self-Attention ×2",
    desc: "Sequence split into M=8 spans of S=64. Full attention within each span. O(MS²) complexity.",
    plain: "Normal attention compares every token to every other token — for 512 tokens that's 262,144 comparisons (slow!). Chunked attention splits the sequence into 8 groups of 64, and only compares within each group: 8 × 64² = 32,768 comparisons — 8× faster. Each API call attends to its nearby context. This is the paper's key efficiency trick.",
    color: "#ec4899",
    detail: "ChunkedSelfAttention · norm_first=True · 8 heads · M=8, S=64",
  },
  {
    step: "5",
    title: "Global Attention Layer",
    desc: "CLS + chunk-processed sequence passed through a single global TransformerEncoder.",
    plain: "Our improvement over the paper. After chunked attention, each chunk has learned its local context but hasn't 'talked' to other chunks. This global layer lets every position attend to every other position once — the CLS token in particular aggregates a global view of all 512 tokens for the final verdict.",
    color: "#f59e0b",
    detail: "TransformerEncoderLayer · d_model=64, d_ff=256 · GELU",
  },
  {
    step: "6",
    title: "CLS Pooling",
    desc: "Take CLS token output (pos 0) after global attention. Better than mean pooling.",
    plain: "We extract just the CLS token's 64-number vector and use that to represent the entire program's behavior. This is better than averaging all tokens (mean pooling) because the CLS token was specifically trained to summarize the whole sequence for classification.",
    color: "#10b981",
    detail: "combined[:, 0, :] · LayerNorm(64)",
  },
  {
    step: "7",
    title: "Classifier Head",
    desc: "Linear(64→64) → LayerNorm → GELU → Dropout(0.3) → Linear(64→1)",
    plain: "The 64-number CLS vector is fed through two small neural network layers that compress it to a single number. That number is passed through a sigmoid function to get a probability between 0 and 1. Above 0.5 = MALICIOUS, below 0.5 = BENIGN. During training, label smoothing (ε=0.05) prevents the model from being overconfident.",
    color: "#ef4444",
    detail: "BCEWithLogitsLoss · label_smoothing=0.05",
  },
];

export default function ModelPage() {
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.modelInfo().then(setInfo).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Model Architecture</h1>
        <p className="text-sm text-slate-500 mt-1">
          Nebula Enhanced — transformer-based dynamic malware detection
        </p>
      </div>

      {/* Model stats */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin" /> Loading model info…
        </div>
      ) : info ? (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Parameters", value: info.parameters.toLocaleString(), color: "#6366f1" },
            { label: "Vocab Size", value: info.vocab_size.toLocaleString(), color: "#8b5cf6" },
            { label: "Seq Length", value: info.seq_len.toString(), color: "#f59e0b" },
            { label: "d_model", value: info.d_model.toString(), color: "#10b981" },
          ].map((s) => (
            <div key={s.label} className="card card-hover p-4">
              <p className="text-xs text-slate-500 mb-1">{s.label}</p>
              <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-4 text-sm text-slate-500">Model not loaded — start API server first.</div>
      )}

      {/* Architecture diagram */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-5">Forward Pass</h3>
        <div className="space-y-2">
          {ARCHITECTURE_STEPS.map((step, i) => (
            <div key={step.step} className="relative">
              <div className="flex gap-4 items-start">
                {/* Step number */}
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5"
                  style={{ background: step.color }}
                >
                  {step.step}
                </div>
                {/* Content */}
                <div className="flex-1 pb-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                    <code
                      className="text-[10px] px-2 py-0.5 rounded font-mono"
                      style={{ background: step.color + "15", color: step.color }}
                    >
                      {step.detail}
                    </code>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 mb-1.5 font-mono">{step.desc}</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{step.plain}</p>
                </div>
              </div>
              {/* Connector line */}
              {i < ARCHITECTURE_STEPS.length - 1 && (
                <div
                  className="absolute left-4 w-px bg-slate-200"
                  style={{ top: "36px", height: "calc(100% - 8px)" }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Improvements */}
      {info && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">Improvements Over Paper</h3>
          <div className="grid grid-cols-2 gap-2">
            {info.improvements.map((imp) => (
              <div key={imp} className="flex items-start gap-2 text-sm text-slate-700">
                <CheckCircle size={14} className="text-indigo-500 mt-0.5 shrink-0" />
                {imp}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Complexity comparison */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Complexity Analysis</h3>
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              title: "Standard Attention",
              complexity: "O(N²)",
              n: "N=512",
              ops: "262,144",
              color: "#ef4444",
              desc: "Quadratic in sequence length — prohibitive for long sequences",
            },
            {
              title: "Chunked Attention (Paper)",
              complexity: "O(MS²)",
              n: "M=8, S=64",
              ops: "32,768",
              color: "#f59e0b",
              desc: "8× reduction by processing M independent S-length spans",
            },
            {
              title: "Nebula Enhanced",
              complexity: "O(MS²) + O(N)",
              n: "Global layer",
              ops: "32,768+512",
              color: "#10b981",
              desc: "Chunked + global CLS attention for cross-span information",
            },
          ].map((c) => (
            <div
              key={c.title}
              className="rounded-lg p-4 border"
              style={{ borderColor: c.color + "30", background: c.color + "08" }}
            >
              <p className="text-xs font-semibold text-slate-700 mb-1">{c.title}</p>
              <p
                className="text-2xl font-bold font-mono mb-1"
                style={{ color: c.color }}
              >
                {c.complexity}
              </p>
              <p className="text-xs text-slate-500">{c.n} · {c.ops} ops</p>
              <p className="text-xs text-slate-400 mt-2">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
