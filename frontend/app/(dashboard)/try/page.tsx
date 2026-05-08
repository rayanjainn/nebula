"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { ExampleInfo } from "@/lib/api";
import {
  Sparkles, Play, Loader2, AlertTriangle, CheckCircle,
  ChevronDown, ChevronUp, Lightbulb, Info, RefreshCw
} from "lucide-react";
import MarkdownText from "@/components/MarkdownText";

const FAMILY_META: Record<string, { color: string; bg: string; label: string; description: string }> = {
  ransomware: { color: "#dc2626", bg: "#fef2f2", label: "Ransomware — file encryption", description: "Encrypts your files and demands payment to restore them." },
  backdoor:   { color: "#6366f1", bg: "#eef2ff", label: "Backdoor — remote control", description: "Opens a hidden channel for attackers to control your PC." },
  trojan:     { color: "#f59e0b", bg: "#fffbeb", label: "Trojan — disguised malware", description: "Looks legitimate but carries a malicious payload." },
  rat:        { color: "#f97316", bg: "#fff7ed", label: "RAT — remote access trojan", description: "Full remote control: screen capture, keylogging, file theft." },
  keylogger:  { color: "#8b5cf6", bg: "#f5f3ff", label: "Keylogger — keystroke spy", description: "Silently records everything you type, including passwords." },
  coinminer:  { color: "#0891b2", bg: "#ecfeff", label: "Coinminer — crypto hijack", description: "Hijacks your CPU to mine cryptocurrency without your knowledge." },
  dropper:    { color: "#64748b", bg: "#f8fafc", label: "Dropper — malware installer", description: "Downloads and installs other malware once it gets in." },
  benign:     { color: "#16a34a", bg: "#f0fdf4", label: "Safe program — benign", description: "A normal Windows application with no malicious behavior." },
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#dc2626",
  high: "#f97316",
  medium: "#ca8a04",
  low: "#16a34a",
};

const BEHAVIOR_PLAIN: Record<string, string> = {
  "Process Injection": "The program tried to inject code into another running process — a classic trick malware uses to hide inside legitimate software.",
  "Memory Manipulation": "The program allocated or modified memory in unusual ways, often to load hidden code that was not in the original file.",
  "File Access": "The program read, wrote, or deleted files. By itself this is normal, but combined with encryption it suggests ransomware.",
  "Registry": "The program modified the Windows Registry — the settings database Windows uses to remember startup programs. Malware does this to survive reboots.",
  "Network": "The program connected to external servers. Malware does this to receive commands or send stolen data.",
  "Defense Evasion": "The program used tricks to hide from antivirus and security tools.",
  "Encryption": "The program used encryption functions — the primary indicator of ransomware.",
  "Persistence": "The program tried to ensure it runs again after a reboot.",
};

export default function TryPage() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"apis" | "describe">("apis");
  const [loading, setLoading] = useState(false);
  const [explainLoading, setExplainLoading] = useState(false);
  const [result, setResult] = useState<{
    verdict: string;
    probability: number;
    confidence: number;
    xai?: { top_tokens: [string, number][]; behavior_map: Record<string, [string, number][]>; maliciousness_score: number };
    explanation?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [realExamples, setRealExamples] = useState<ExampleInfo[]>([]);
  const [exampleLoading, setExampleLoading] = useState<string | null>(null);

  useEffect(() => {
    api.listExamples().then((r) => setRealExamples(r.examples)).catch(() => {});
  }, []);

  async function runExample(ex: ExampleInfo) {
    setExampleLoading(ex.name);
    setError("");
    setResult(null);
    try {
      const report = await api.getExample(ex.name);
      const r = await api.predict(report as object, true, false);
      setResult(r as typeof result);
      setExampleLoading(null);
      setExplainLoading(true);
      try {
        const exp = await api.explainVerdict(
          (r as { verdict: string }).verdict,
          (r as { probability: number }).probability,
          (r as { xai?: { top_tokens: [string, number][] } }).xai?.top_tokens ?? [],
          ((r as { xai?: { behavior_map: Record<string, unknown> } }).xai?.behavior_map ?? {}) as Record<string, unknown>
        );
        setResult((prev) => prev ? { ...prev, explanation: exp.explanation } : prev);
      } catch { /* non-critical */ }
      setExplainLoading(false);
    } catch (e: unknown) {
      setExampleLoading(null);
      setError(e instanceof Error ? e.message : "Failed to load example.");
    }
  }

  async function run() {
    if (!input.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);

    try {
      let text = input.trim();

      // If describe mode, first ask the LLM to convert the description to API names
      if (mode === "describe") {
        const r = await api.explainTerm(
          text,
          "Convert this behavior description to a space-separated list of Windows API call names that would represent this behavior. Return ONLY the API names, nothing else."
        );
        // The LLM might give us prose; we extract words that look like API names
        text = r.explanation
          .split(/[\s,;]+/)
          .filter((w) => /^[A-Za-z][A-Za-z0-9]+$/.test(w) && w.length > 3)
          .join(" ");
      }

      const r = await api.predictText(text, true);
      setResult(r);

      // Auto-fetch plain-English explanation
      setExplainLoading(true);
      try {
        const exp = await api.explainVerdict(
          r.verdict,
          r.probability,
          r.xai?.top_tokens ?? [],
          (r.xai?.behavior_map ?? {}) as Record<string, unknown>
        );
        setResult((prev) => prev ? { ...prev, explanation: exp.explanation } : prev);
      } catch { /* non-critical */ }
      setExplainLoading(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Analysis failed. Make sure the API server is running.");
    } finally {
      setLoading(false);
    }
  }

  function useExample(apis: string) {
    setInput(apis);
    setMode("apis");
    setResult(null);
    setError("");
    // Scroll to input
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const isMalicious = result?.verdict === "MALICIOUS";
  const prob = result?.probability ?? 0;

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Sparkles size={20} className="text-indigo-500" />
          Try It Yourself
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Enter any Windows API calls — or describe what a program is doing — and find out if it looks like malware
        </p>
      </div>

      {/* What is this box */}
      <div className="card p-4 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 flex gap-3">
        <Info size={15} className="text-indigo-500 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-600 leading-relaxed space-y-1">
          <p><span className="font-semibold text-slate-800">What am I entering?</span> Windows programs interact with the operating system through "API calls" — requests to do things like open files, connect to the internet, or create new processes. Malware has distinctive patterns of API calls (e.g., ransomware always calls CryptEncrypt; process injection always uses WriteProcessMemory + CreateRemoteThread).</p>
          <p>Enter the API calls you observed (or a description of what the program is doing), and the neural network will predict whether that behavior pattern looks malicious.</p>
        </div>
      </div>

      {/* Input section */}
      <div className="card p-6 space-y-4">
        {/* Mode selector */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          <button
            className={`tab-btn ${mode === "apis" ? "active" : ""}`}
            onClick={() => setMode("apis")}
          >
            API Call Names
          </button>
          <button
            className={`tab-btn ${mode === "describe" ? "active" : ""}`}
            onClick={() => setMode("describe")}
          >
            Describe in Plain English
          </button>
        </div>

        {mode === "apis" ? (
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1.5">
              Windows API call names (space-separated)
            </label>
            <textarea
              className="textarea-field font-mono text-sm"
              rows={4}
              placeholder="e.g.  VirtualAlloc  WriteProcessMemory  CreateRemoteThread  WSAConnect"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <p className="text-[10px] text-slate-400 mt-1.5">
              Don&apos;t know any API names? Pick a guided example below ↓ or switch to &quot;Describe in Plain English&quot; mode.
            </p>
          </div>
        ) : (
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1.5">
              Describe what the program is doing, in plain English
            </label>
            <textarea
              className="textarea-field text-sm"
              rows={4}
              placeholder="e.g. The program opens a bunch of documents, encrypts them, deletes the originals, and connects to a server in Russia."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <p className="text-[10px] text-slate-400 mt-1.5">
              The AI will convert your description to API call patterns before running the detection model.
            </p>
          </div>
        )}

        <button
          className="btn-primary w-full justify-center"
          onClick={run}
          disabled={loading || !input.trim()}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {loading ? "Analyzing behavior pattern…" : "Check if this looks like malware"}
        </button>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </div>
        )}
      </div>

      {/* Real examples from dataset */}
      {realExamples.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
            <Lightbulb size={14} className="text-amber-500" />
            Real malware samples — click one to analyze instantly
          </h2>
          <p className="text-xs text-slate-400 mb-3">
            These are real samples from the Speakeasy emulation dataset — full API traces, not simplified examples. Results are accurate.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {realExamples.map((ex) => {
              const family = ex.family ?? "unknown";
              const meta = FAMILY_META[family] ?? { color: "#64748b", bg: "#f8fafc", label: family, description: "" };
              const isRunning = exampleLoading === ex.name;
              return (
                <button
                  key={ex.name}
                  onClick={() => runExample(ex)}
                  disabled={!!exampleLoading}
                  className="text-left p-4 rounded-xl border transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-60"
                  style={{ background: meta.bg, borderColor: meta.color + "40" }}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-xs font-bold" style={{ color: meta.color }}>{meta.label}</p>
                    {isRunning && <Loader2 size={12} className="animate-spin text-slate-400" />}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{meta.description}</p>
                  <p className="text-[10px] font-mono text-slate-400 mt-2 truncate">
                    {ex.sample_apis.slice(0, 3).map(a => a.replace(/^.*?\./, "")).join(", ")}…
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4 animate-fade-in-up">
          {/* Main verdict card */}
          <div
            className={`card p-6 border-2 ${isMalicious ? "border-red-300" : "border-emerald-300"}`}
            style={{ background: isMalicious ? "#fef2f2" : "#f0fdf4" }}
          >
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${isMalicious ? "bg-red-100" : "bg-emerald-100"}`}>
                {isMalicious
                  ? <AlertTriangle size={24} className="text-red-500" />
                  : <CheckCircle size={24} className="text-emerald-500" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`text-xl font-black ${isMalicious ? "text-red-700" : "text-emerald-700"}`}>
                    {isMalicious ? "LOOKS LIKE MALWARE" : "LOOKS SAFE"}
                  </span>
                  <span
                    className="text-sm font-bold px-3 py-1 rounded-full text-white"
                    style={{ background: isMalicious ? "#dc2626" : "#16a34a" }}
                  >
                    {(prob * 100).toFixed(1)}%
                  </span>
                </div>

                {/* Probability bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Safe</span>
                    <span>Malicious probability: {(prob * 100).toFixed(1)}%</span>
                    <span>Malicious</span>
                  </div>
                  <div className="h-3 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${prob * 100}%`,
                        background: prob > 0.7 ? "#ef4444" : prob > 0.4 ? "#f97316" : "#22c55e",
                      }}
                    />
                  </div>
                </div>

                {/* Plain-English explanation */}
                {explainLoading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 size={11} className="animate-spin" />
                    Getting plain-English explanation…
                  </div>
                ) : result.explanation ? (
                  <div className={`p-3 rounded-lg ${isMalicious ? "bg-red-50" : "bg-emerald-50"}`}>
                    <MarkdownText className={isMalicious ? "[&_p]:text-red-900 [&_strong]:text-red-800 [&_li]:text-red-900" : "[&_p]:text-emerald-900 [&_strong]:text-emerald-800 [&_li]:text-emerald-900"}>
                      {result.explanation}
                    </MarkdownText>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Behavior categories */}
          {result.xai && Object.keys(result.xai.behavior_map).length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Detected behavior categories</h3>
              <div className="space-y-3">
                {Object.entries(result.xai.behavior_map).map(([cat, tokens]) => (
                  <div key={cat} className="flex gap-3">
                    <div
                      className="w-2 rounded-full shrink-0"
                      style={{ background: SEVERITY_COLOR[cat] || "#6366f1" }}
                    />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-slate-800">{cat}</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                        {BEHAVIOR_PLAIN[cat] ?? "Behavior pattern detected in this program."}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {tokens.slice(0, 4).map(([t], ti) => (
                          <code key={`${t}_${ti}`} className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">
                            {t}
                          </code>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top important tokens */}
          {result.xai && result.xai.top_tokens.length > 0 && (
            <div className="card p-5">
              <button
                className="w-full flex items-center justify-between text-sm font-semibold text-slate-800"
                onClick={() => setShowDetails((v) => !v)}
              >
                <span>Which specific functions were most suspicious?</span>
                {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showDetails && (
                <div className="mt-4 space-y-2">
                  {result.xai.top_tokens.slice(0, 10).map(([token, score], ti) => (
                    <div key={`${token}_${ti}`} className="flex items-center gap-3">
                      <code className="text-xs font-mono text-slate-700 w-48 truncate">{token}</code>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${score * 100}%`,
                            background: score > 0.7 ? "#ef4444" : score > 0.4 ? "#f97316" : "#6366f1",
                          }}
                        />
                      </div>
                      <span className="text-xs font-mono text-slate-500 w-12 text-right">
                        {(score * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                  <p className="text-[10px] text-slate-400 pt-1">
                    Bars show how much each function influenced the verdict (attention weight from the neural network).
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Try another */}
          <button
            className="btn-secondary w-full justify-center"
            onClick={() => { setResult(null); setInput(""); setError(""); }}
          >
            <RefreshCw size={14} />
            Try a different input
          </button>
        </div>
      )}
    </div>
  );
}
