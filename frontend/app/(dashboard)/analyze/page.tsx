"use client";
import { useState, useEffect } from "react";
import { api, PredictResult, ExampleInfo } from "@/lib/api";
import VerdictBadge from "@/components/VerdictBadge";
import ProbabilityGauge from "@/components/ProbabilityGauge";
import TokenImportanceChart from "@/components/TokenImportanceChart";
import BehaviorMap from "@/components/BehaviorMap";
import {
  Play, ChevronDown, ChevronUp, Loader2,
  FileJson, Terminal, BookOpen, Lightbulb, HelpCircle,
  AlertTriangle, CheckCircle, BrainCircuit
} from "lucide-react";
import MarkdownText from "@/components/MarkdownText";

type InputMode = "json" | "text" | "example";

// Plain-English behavior descriptions (shown below results without API call)
const BEHAVIOR_PLAIN: Record<string, { label: string; plain: string; severity: "critical" | "high" | "medium" | "low" }> = {
  "Process Injection": {
    label: "Process Injection",
    plain: "The program forced its code into another running program. This is like a parasite hiding inside a legitimate app. Malware does this to evade detection — antivirus sees the trusted program running, not the malware.",
    severity: "critical",
  },
  "Memory Manipulation": {
    label: "Memory Manipulation",
    plain: "The program allocated or modified memory in unusual ways, often to load hidden code that was not in the original file. Ransomware and trojans use this to unpack themselves.",
    severity: "high",
  },
  "File Access": {
    label: "File Access",
    plain: "The program read, wrote, created, or deleted files. This is normal for most software, but combined with encryption APIs it suggests ransomware. Deleting original files after writing locked versions is a key ransomware indicator.",
    severity: "medium",
  },
  "Registry": {
    label: "Registry Modification",
    plain: "The Windows Registry is like a settings database for your entire computer. Malware writes to it to ensure it starts automatically every time Windows boots — even after you restart your machine.",
    severity: "high",
  },
  "Network": {
    label: "Network Communication",
    plain: "The program connected to external servers on the internet. Malware does this to receive commands from attackers (a 'command-and-control server'), send stolen data, or download additional malicious files.",
    severity: "high",
  },
  "Defense Evasion": {
    label: "Defense Evasion",
    plain: "The program used techniques to hide itself from security software. This includes loading libraries dynamically (so they don't appear in the import table), using low-level Windows calls, or modifying its own code.",
    severity: "critical",
  },
  "Encryption": {
    label: "Encryption/Crypto",
    plain: "The program used cryptographic (encryption/decryption) functions. This is a primary indicator of ransomware — files are encrypted to hold them hostage. Can also be used for secure C2 communication.",
    severity: "critical",
  },
  "Persistence": {
    label: "Persistence",
    plain: "The program tried to survive a computer restart. It may have added itself to Windows startup, created a scheduled task, or installed itself as a Windows service. This means the malware keeps running even after you reboot.",
    severity: "high",
  },
};

const SEVERITY_COLORS = {
  critical: { bg: "#fef2f2", border: "#fca5a5", text: "#dc2626", badge: "#ef4444" },
  high:     { bg: "#fff7ed", border: "#fed7aa", text: "#ea580c", badge: "#f97316" },
  medium:   { bg: "#fefce8", border: "#fde68a", text: "#ca8a04", badge: "#eab308" },
  low:      { bg: "#f0fdf4", border: "#bbf7d0", text: "#16a34a", badge: "#22c55e" },
};

function BehavioralAnalysisCard({
  result,
}: {
  result: PredictResult;
}) {
  const [explanation, setExplanation] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    if (loaded) return;
    setLoading(true);
    try {
      const behaviorCats = result.xai?.behavior_map ?? {};
      const r = await api.explainVerdict(
        result.verdict,
        result.probability,
        result.xai?.top_tokens ?? [],
        behaviorCats as Record<string, unknown>
      );
      setExplanation(r.explanation);
      setLoaded(true);
    } catch {
      setExplanation("Plain-English explanation unavailable — LLM may be offline.");
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  // Auto-load for all results
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const isMalicious = result.verdict === "MALICIOUS";

  return (
    <div className={`card p-5 border-l-4 ${isMalicious ? "border-l-red-400" : "border-l-emerald-400"}`}
         style={{ background: isMalicious ? "#fef2f2" : "#f0fdf4" }}>
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isMalicious ? "bg-red-100" : "bg-emerald-100"}`}>
          {isMalicious
            ? <AlertTriangle size={16} className="text-red-500" />
            : <CheckCircle size={16} className="text-emerald-500" />}
        </div>
        <div className="flex-1">
          <p className={`text-sm font-bold mb-1 ${isMalicious ? "text-red-700" : "text-emerald-700"}`}>
            {isMalicious ? "⚠ Malicious Intent Detected" : "✓ Likely Benign Behavior"}
          </p>
          <p className="text-xs text-slate-500 mb-3">
            Confidence: <span className="font-semibold text-slate-700">{(result.probability * 100).toFixed(1)}%</span>
            {" · "}
            The model analysed {(result.text_preview?.split(" ").length ?? 0)} tokens of behavior
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-xs">
              <Loader2 size={12} className="animate-spin" />
              Getting plain-English explanation from AI…
            </div>
          ) : explanation ? (
            <div className="bg-white/70 rounded-xl p-4 shadow-sm border border-white/40">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Program Intent & Behavioral Summary</div>
              <div className="text-sm text-slate-700 leading-relaxed">
                <MarkdownText>{explanation}</MarkdownText>
              </div>
            </div>
          ) : !loaded ? (
            <button
              onClick={load}
              className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              <BrainCircuit size={12} />
              Get plain-English explanation (uses AI)
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BehaviorPlainCards({ behaviorMap }: { behaviorMap: Record<string, [string, number][]> }) {
  const categories = Object.keys(behaviorMap);
  if (!categories.length) return null;

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
        <Lightbulb size={14} className="text-amber-500" />
        What the detected behaviors mean
      </h3>
      <p className="text-xs text-slate-400 mb-4">Plain-English explanation of each suspicious behavior category found</p>
      <div className="space-y-3">
        {categories.map((cat) => {
          const def = BEHAVIOR_PLAIN[cat];
          if (!def) return null;
          const col = SEVERITY_COLORS[def.severity];
          const tokens = behaviorMap[cat].slice(0, 3).map(([t]) => t);
          return (
            <div
              key={cat}
              className="rounded-lg p-3 border"
              style={{ background: col.bg, borderColor: col.border }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full text-white font-bold uppercase tracking-wide"
                  style={{ background: col.badge }}
                >
                  {def.severity}
                </span>
                <span className="text-xs font-semibold" style={{ color: col.text }}>{def.label}</span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed mb-2">{def.plain}</p>
              <p className="text-[10px] text-slate-500">
                Triggered by:{" "}
                {tokens.map((t, i) => (
                  <span key={`${t}_${i}`}>
                    <code className="font-mono text-slate-700">{t}</code>
                    {i < tokens.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AnalyzePage() {
  const [mode, setMode] = useState<InputMode>("example");
  const [jsonInput, setJsonInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [selectedExample, setSelectedExample] = useState("");
  const [examples, setExamples] = useState<ExampleInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [error, setError] = useState("");
  const [showText, setShowText] = useState(false);
  const [exampleData, setExampleData] = useState<Record<string, unknown> | null>(null);
  const [exampleLoading, setExampleLoading] = useState(false);
  const [showExampleDetail, setShowExampleDetail] = useState(false);

  useEffect(() => {
    api.listExamples().then((r) => {
      setExamples(r.examples);
      if (r.examples.length) setSelectedExample(r.examples[0].name);
    });
  }, []);

  useEffect(() => {
    if (selectedExample && mode === "example") {
      setExampleLoading(true);
      setExampleData(null);
      api.getExample(selectedExample)
        .then(res => setExampleData(res as Record<string, unknown>))
        .catch(() => setExampleData(null))
        .finally(() => setExampleLoading(false));
    } else {
      setExampleData(null);
    }
  }, [selectedExample, mode]);

  async function run() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      if (mode === "example") {
        const r = await api.predictExample(selectedExample, true);
        setResult(r);
      } else if (mode === "text") {
        const r = await api.predictText(textInput, true);
        setResult(r);
      } else {
        const report = JSON.parse(jsonInput);
        const r = await api.predict(report, true, false);
        setResult(r);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  const prob = result?.probability ?? 0;
  const isMalicious = result?.verdict === "MALICIOUS";

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Analyze Sample</h1>
          <p className="text-sm text-slate-500 mt-1">
            Submit a Windows program behavior report — get an instant malware verdict with plain-English explanation
          </p>
        </div>
        <a
          href="/try"
          className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-full font-medium transition-colors"
        >
          <HelpCircle size={13} />
          Try It Yourself
        </a>
      </div>

      {/* How it works banner */}
      <div className="card p-4 bg-gradient-to-r from-slate-50 to-indigo-50 border border-slate-100 flex gap-3">
        <BookOpen size={15} className="text-indigo-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-600 leading-relaxed">
          <span className="font-semibold text-slate-700">How this works:</span> The program is analyzed by our
          Transformer neural network (trained on 1,561 malware samples). It reads the sequence of Windows API calls
          the program made, and predicts whether that pattern of behavior looks malicious. Results appear in under
          a second. The XAI section shows <em>which specific behaviors</em> drove the decision.
        </div>
      </div>

      {/* Input Card */}
      <div className="card p-6 space-y-4">
        {/* Mode tabs */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          {(["example", "json", "text"] as InputMode[]).map((m) => (
            <button
              key={m}
              className={`tab-btn capitalize ${mode === m ? "active" : ""}`}
              onClick={() => setMode(m)}
            >
              {m === "example" ? "Built-in Examples" : m === "json" ? "JSON Report" : "Raw Text"}
            </button>
          ))}
        </div>

        {mode === "example" && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Real malware examples from Speakeasy emulation — select one and run the analysis
            </p>
            <div className="grid grid-cols-2 gap-2">
              {examples.map((ex) => {
                const isMal = ex.verdict === "malicious";
                const family = ex.family;
                const shortId = ex.name.length > 16 ? ex.name.slice(0, 8) + "…" + ex.name.slice(-6) : ex.name;
                return (
                  <button
                    key={ex.name}
                    onClick={() => setSelectedExample(ex.name)}
                    className={`text-left p-3 rounded-lg border transition-all ${
                      selectedExample === ex.name
                        ? "border-indigo-400 bg-indigo-50"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <FileJson size={14} className="text-slate-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <code className="text-[10px] font-mono text-slate-600">{shortId}</code>
                          {family && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold capitalize ${
                              isMal ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-700"
                            }`}>{family}</span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400">
                          {ex.entry_points} entry point{ex.entry_points !== 1 ? "s" : ""} ·{" "}
                          {ex.sample_apis.slice(0, 2).map(a => a.replace(/^.*?\./, "")).join(", ")}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            
            {selectedExample && (
              <div className="mt-3 border rounded-lg overflow-hidden bg-slate-50">
                <button
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                  onClick={() => setShowExampleDetail(!showExampleDetail)}
                >
                  <span className="flex items-center gap-1.5">
                    <FileJson size={12} className="text-indigo-400" />
                    View example contents
                  </span>
                  {showExampleDetail ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {showExampleDetail && (
                  <div className="px-3 pb-3">
                    {exampleLoading ? (
                      <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                        <Loader2 size={12} className="animate-spin" /> Loading…
                      </div>
                    ) : exampleData ? (
                      <pre className="mt-1 text-[10px] font-mono text-slate-600 bg-white border border-slate-200 rounded p-2 overflow-auto max-h-72 whitespace-pre">
                        {JSON.stringify(exampleData, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-xs text-slate-400 py-2">Failed to load example data.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {mode === "json" && (
          <div>
            <p className="text-xs text-slate-500 mb-2">
              Paste a Speakeasy JSON report — the behavior trace output from running a Windows executable in the emulator
            </p>
            <textarea
              className="textarea-field font-mono text-xs"
              rows={8}
              placeholder='{"entry_points": [{"apis": [...], "network_events": {...]}}'
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
            />
          </div>
        )}

        {mode === "text" && (
          <div>
            <p className="text-xs text-slate-500 mb-2">
              Type or paste space-separated Windows API call names — the behaviors you want to check
            </p>
            <textarea
              className="textarea-field"
              rows={5}
              placeholder="VirtualAlloc WriteProcessMemory CreateRemoteThread WSAConnect..."
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
            />
            <p className="text-[10px] text-slate-400 mt-1.5">
              Not sure what to type?{" "}
              <button
                className="text-indigo-500 hover:underline"
                onClick={() => setTextInput("VirtualAlloc WriteProcessMemory CreateRemoteThread WSAConnect CryptEncrypt DeleteFile")}
              >
                Try a ransomware example
              </button>
              {" · "}
              <button
                className="text-indigo-500 hover:underline"
                onClick={() => setTextInput("CreateFileW ReadFile WriteFile CloseHandle ExitProcess")}
              >
                Try a benign example
              </button>
            </p>
          </div>
        )}

        <button
          className="btn-primary"
          onClick={run}
          disabled={loading || (mode === "json" && !jsonInput) || (mode === "text" && !textInput)}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {loading ? "Analyzing…" : "Run Analysis"}
        </button>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-4 animate-fade-in-up">
          {/* Verdict row */}
          <div className={`card p-6 border-l-4 ${isMalicious ? "border-l-red-500" : "border-l-emerald-500"}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <VerdictBadge verdict={result.verdict} size="lg" />
                  <span className="text-sm text-slate-500">
                    Confidence: {(result.confidence * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 w-28">Malware Prob.</span>
                    <div className="flex items-center gap-2 flex-1">
                      <div className="prob-meter flex-1 max-w-40">
                        <div
                          className="prob-meter-fill"
                          style={{
                            width: `${prob * 100}%`,
                            background: isMalicious ? "#ef4444" : "#10b981",
                          }}
                        />
                      </div>
                      <span className="font-mono font-medium text-slate-800">
                        {(prob * 100).toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  {result.xai && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 w-28">Behavior Score</span>
                      <span className="font-mono font-medium text-slate-800">
                        {(result.xai.maliciousness_score * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <ProbabilityGauge probability={prob} size={120} />
            </div>

            {/* Text preview toggle */}
            {result.text_preview && (
              <div className="mt-4">
                <button
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
                  onClick={() => setShowText(!showText)}
                >
                  <Terminal size={12} />
                  {showText ? "Hide" : "Show"} the raw behavior sequence fed to the model
                  {showText ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {showText && (
                  <div className="code-block mt-2 text-xs">{result.text_preview}</div>
                )}
              </div>
            )}
          </div>

          {/* AI Behavioral Analysis */}
          <BehavioralAnalysisCard result={result} />

          {/* XAI results */}
          {result.xai && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-slate-800 mb-1">What the Model Focused On</h3>
                  <p className="text-xs text-slate-400 mb-3">
                    These API calls had the highest influence on the verdict — taller bar = more suspicious
                  </p>
                  <TokenImportanceChart
                    tokens={result.xai.top_tokens}
                    behaviorMap={result.xai.behavior_map}
                  />
                </div>
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-slate-800 mb-1">Attack Categories</h3>
                  <p className="text-xs text-slate-400 mb-3">
                    MITRE ATT&CK framework categories detected in this program's behavior
                  </p>
                  <BehaviorMap behaviorMap={result.xai.behavior_map} />
                </div>
              </div>

              {/* Plain-English behavior explanations */}
              <BehaviorPlainCards behaviorMap={result.xai.behavior_map} />
            </>
          )}

          {/* What to do next */}
          <div className="card p-5 border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">What should you do?</h3>
            {isMalicious ? (
              <div className="space-y-2">
                {[
                  { step: "1", text: "Do not run this file on any production or personal machine", color: "#dc2626" },
                  { step: "2", text: "If already executed, isolate the machine from the network immediately", color: "#ea580c" },
                  { step: "3", text: "Use the LLM page to get a detailed threat report with specific IOCs", color: "#6366f1" },
                  { step: "4", text: "Report to your security team with the behavior score and category breakdown above", color: "#8b5cf6" },
                ].map((s) => (
                  <div key={s.step} className="flex items-start gap-3 text-xs text-slate-600">
                    <span className="w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0" style={{ background: s.color }}>{s.step}</span>
                    {s.text}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-600 leading-relaxed">
                The model did not detect malicious behavior patterns in this file. This does not guarantee safety —
                the model catches ~94% of malware but may miss heavily obfuscated samples.
                Use this as one signal alongside other security checks (antivirus, file reputation services).
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
