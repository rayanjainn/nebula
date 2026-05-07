"use client";
import { useState, useEffect } from "react";
import { api, DatasetStats, SampleRow } from "@/lib/api";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis
} from "recharts";
import { Database, RefreshCw, Loader2, HelpCircle, X, Info, BookOpen } from "lucide-react";

const COLORS = {
  ransomware: "#dc2626",
  rat: "#f97316",
  trojan: "#f59e0b",
  backdoor: "#8b5cf6",
  keylogger: "#6366f1",
  coinminer: "#06b6d4",
  dropper: "#10b981",
  benign: "#22c55e",
};

// Static plain-English explanations for common terms (instant, no API call needed)
const STATIC_GLOSSARY: Record<string, { short: string; detail: string }> = {
  sha256: {
    short: "A unique fingerprint of the file",
    detail:
      "SHA-256 is a mathematical formula that produces a unique 64-character ID for any file. Like a fingerprint — no two different files will have the same SHA-256. Security researchers use it to identify specific malware samples without ambiguity.",
  },
  module_entry: {
    short: "How the program started running",
    detail:
      "\"Module entry\" means the program was started from its main entry point — the first function that runs when Windows loads the file. It's the normal starting point for executable (.exe) files.",
  },
  dllmain: {
    short: "Startup code inside a library file",
    detail:
      "DLLMain is the entry point for a DLL (Dynamic Link Library) — a file that contains code shared by multiple programs. When Windows loads a DLL into memory, it calls DllMain first. Malware often hides in DLLs because they look like legitimate shared libraries.",
  },
  ep_type: {
    short: "How the program's execution began",
    detail:
      "EP Type (Entry Point Type) tells you how the program started running. Common types: \"module_entry\" (normal .exe startup), \"dllmain\" (DLL loaded into memory), \"export\" (a specific function was called directly).",
  },
  api_count: {
    short: "How many Windows functions the program called",
    detail:
      "Every Windows program calls operating system functions (APIs) to do things like read files or connect to the internet. A high API count means the program did many things. Very low counts often indicate benign software; high counts with dangerous API names indicate malware.",
  },
  ransomware: {
    short: "Encrypts your files and demands payment",
    detail:
      "Ransomware locks all your files (photos, documents, databases) by encrypting them, then demands payment (usually cryptocurrency) to decrypt them. Highly destructive — has shut down hospitals and government agencies.",
  },
  trojan: {
    short: "Malware disguised as legitimate software",
    detail:
      "Named after the Trojan horse: it looks like something useful but contains hidden malware. Once run, it may install backdoors, steal data, or download more malware. You have to run it yourself — it doesn't spread automatically.",
  },
  rat: {
    short: "Gives attackers full remote control of your PC",
    detail:
      "RAT = Remote Access Trojan. Gives the attacker a full remote desktop to your machine — they can see your screen, record your keystrokes, access your files, and use your computer as a launchpad for attacking others.",
  },
  backdoor: {
    short: "A hidden entry point for attackers",
    detail:
      "A backdoor bypasses normal login (username + password) and lets attackers get in through a secret entrance. Often installed by other malware to maintain access even if the original malware is removed.",
  },
  benign: {
    short: "Safe — not malware",
    detail:
      "Benign means the program is legitimate and not harmful. Our dataset includes benign programs for comparison — so the model learns the difference between normal and malicious behavior.",
  },
  "net": {
    short: "Made network connections",
    detail:
      "This sample made outgoing network connections — connecting to external servers. Malware often does this to receive commands, send stolen data, or contact a command-and-control (C2) server.",
  },
  "fs": {
    short: "Accessed the file system",
    detail:
      "This sample read, wrote, created, or deleted files on disk. File system activity is normal for most programs, but malware often accesses sensitive files (passwords, documents) or drops additional malicious files.",
  },
};

function TermTooltip({ term, context }: { term: string; context?: string }) {
  const [open, setOpen] = useState(false);
  const [llmExplanation, setLlmExplanation] = useState("");
  const [loading, setLoading] = useState(false);

  const key = term.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const staticDef = STATIC_GLOSSARY[key];

  async function loadLLM() {
    if (llmExplanation) return;
    setLoading(true);
    try {
      const r = await api.explainTerm(term, context);
      setLlmExplanation(r.explanation);
    } catch {
      setLlmExplanation("Could not load explanation — LLM unavailable.");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    setOpen((v) => !v);
    if (!open && !staticDef) loadLLM();
  }

  return (
    <span className="relative inline-flex items-center gap-0.5">
      <button
        onClick={toggle}
        className="text-indigo-400 hover:text-indigo-600 transition-colors"
        title={`Explain: ${term}`}
      >
        <HelpCircle size={11} />
      </button>
      {open && (
        <div className="absolute left-0 top-5 z-50 w-72 bg-white rounded-xl shadow-xl border border-slate-200 p-3 text-xs">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="font-semibold text-slate-800 font-mono">{term}</span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 shrink-0">
              <X size={12} />
            </button>
          </div>
          {staticDef ? (
            <div className="space-y-1.5">
              <p className="font-medium text-indigo-600">{staticDef.short}</p>
              <p className="text-slate-600 leading-relaxed">{staticDef.detail}</p>
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 size={11} className="animate-spin" />
              Getting plain-English explanation…
            </div>
          ) : llmExplanation ? (
            <p className="text-slate-600 leading-relaxed">{llmExplanation}</p>
          ) : (
            <p className="text-slate-400">No explanation available.</p>
          )}
        </div>
      )}
    </span>
  );
}

// Clickable API name chip that shows what that API does
function ApiChip({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [loading, setLoading] = useState(false);

  const display = name.split(".").pop() || name;

  async function load() {
    if (explanation) { setOpen(true); return; }
    setLoading(true);
    setOpen(true);
    try {
      const r = await api.explainTerm(display, "Windows API call seen in malware behavior trace");
      setExplanation(r.explanation);
    } catch {
      setExplanation("Explanation unavailable.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="relative">
      <button
        onClick={load}
        className="text-[10px] text-indigo-600 hover:text-indigo-800 hover:underline font-mono transition-colors"
        title="Click to see what this does"
      >
        {display}
      </button>
      {open && (
        <div className="absolute left-0 top-5 z-50 w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-3 text-xs">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="font-semibold text-slate-800 font-mono">{display}</span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 shrink-0">
              <X size={12} />
            </button>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 size={11} className="animate-spin" />
              Looking up…
            </div>
          ) : (
            <p className="text-slate-600 leading-relaxed">{explanation}</p>
          )}
        </div>
      )}
    </span>
  );
}

export default function DatasetPage() {
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [labelFilter, setLabelFilter] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);

  useEffect(() => {
    api.datasetStats().then(setStats).finally(() => setLoading(false));
    fetchSamples();
  }, []);

  async function fetchSamples(label?: number) {
    setSamplesLoading(true);
    const r = await api.datasetSample(12, label);
    setSamples(r.samples);
    setSamplesLoading(false);
  }

  function handleFilter(label: number | undefined) {
    setLabelFilter(label);
    fetchSamples(label);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={28} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  const familyData = stats
    ? Object.entries(stats.families)
        .sort(([, a], [, b]) => b - a)
        .map(([name, value]) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          value,
          color: COLORS[name as keyof typeof COLORS] || "#94a3b8",
        }))
    : [];

  const labelData = stats
    ? [
        { name: "Malicious", value: stats.malicious, color: "#ef4444" },
        { name: "Benign", value: stats.benign, color: "#10b981" },
      ]
    : [];

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dataset Explorer</h1>
          <p className="text-sm text-slate-500 mt-1">
            1,561 Windows behavior traces — hover <HelpCircle size={11} className="inline text-indigo-400" /> on any term for a plain-English explanation
          </p>
        </div>
        <button
          onClick={() => setShowGlossary((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-full font-medium transition-colors"
        >
          <BookOpen size={13} />
          Glossary
        </button>
      </div>

      {/* Inline Glossary Panel */}
      {showGlossary && (
        <div className="card p-5 border-l-4 border-l-indigo-400 animate-fade-in-up">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-800">Plain-English Glossary</h3>
            <button onClick={() => setShowGlossary(false)} className="text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(STATIC_GLOSSARY).map(([k, v]) => (
              <div key={k} className="space-y-0.5">
                <p className="text-xs font-semibold font-mono text-indigo-700">{k}</p>
                <p className="text-xs text-indigo-600 font-medium">{v.short}</p>
                <p className="text-xs text-slate-500 leading-relaxed">{v.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Explainer banner */}
      <div className="card p-4 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 flex gap-3">
        <Info size={16} className="text-indigo-500 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-600 leading-relaxed">
          <span className="font-semibold text-slate-800">What is this data?</span> Each row is a recording of a Windows
          program running inside a safe virtual environment (Speakeasy). The system watched which Windows functions the
          program called, what files it touched, and what network connections it made — then labelled it as malware or
          safe. Click any <span className="font-mono text-indigo-600">blue API name</span> to see what that function
          does. Click the <HelpCircle size={10} className="inline text-indigo-400" /> icon next to any column heading
          for an explanation.
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Samples", value: stats.total.toLocaleString(), color: "#6366f1", term: null, detail: "Total number of Windows programs analyzed" },
            { label: "Malicious", value: stats.malicious.toLocaleString(), sub: `${stats.malicious_pct}%`, color: "#ef4444", term: "malicious", detail: "Programs identified as harmful" },
            { label: "Benign", value: stats.benign.toLocaleString(), sub: `${(100 - stats.malicious_pct).toFixed(1)}%`, color: "#10b981", term: "benign", detail: "Programs confirmed as safe" },
            { label: "Avg API Calls", value: stats.avg_api_calls.toString(), sub: `max: ${stats.max_api_calls}`, color: "#f59e0b", term: "api_count", detail: "Average number of Windows functions called per program" },
          ].map((s) => (
            <div key={s.label} className="card card-hover p-4">
              <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                {s.label}
                {s.term && <TermTooltip term={s.term} context={s.detail} />}
              </div>
              <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
              {s.sub && <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Charts row */}
      {stats && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Label Distribution</h3>
            <p className="text-xs text-slate-400 mb-3">84.8% malicious reflects real-world malware collection patterns</p>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={labelData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                  {labelData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [(v as number).toLocaleString(), "samples"]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 mt-1">
              {labelData.map((d) => (
                <span key={d.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                  {d.name} ({d.value})
                </span>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Malware Families</h3>
            <p className="text-xs text-slate-400 mb-3">Click a family name to see what it does</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={familyData} layout="vertical" margin={{ left: 4, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11, fill: "#475569" }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => [(v as number), "samples"]} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={16}>
                  {familyData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Malware family explainer cards */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">
          What do these malware families do?
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { name: "Trojan", color: "#f59e0b", bg: "#fffbeb", desc: "Disguises itself as a legitimate program. Once run, it installs backdoors or steals data. You have to run it yourself — it doesn't spread automatically." },
            { name: "Ransomware", color: "#dc2626", bg: "#fef2f2", desc: "Encrypts all your files (photos, documents, databases) so you can't open them, then demands cryptocurrency payment to unlock them." },
            { name: "RAT", color: "#f97316", bg: "#fff7ed", desc: "Remote Access Trojan. Gives the attacker full remote control of your PC — they can see your screen, record your keystrokes, and access your files from anywhere." },
            { name: "Backdoor", color: "#8b5cf6", bg: "#f5f3ff", desc: "Creates a hidden entry point into your system, bypassing normal login. The attacker can return at any time, even if the original malware was removed." },
            { name: "Coinminer", color: "#06b6d4", bg: "#ecfeff", desc: "Uses your CPU/GPU to generate cryptocurrency for the attacker. Makes your computer slow and raises your electricity bill. No direct damage, but significant resource theft." },
            { name: "Benign", color: "#22c55e", bg: "#f0fdf4", desc: "Safe, legitimate Windows software included in the dataset for comparison. The model must learn to distinguish normal behavior from malicious." },
          ].map((f) => (
            <div key={f.name} className="rounded-lg p-3" style={{ background: f.bg }}>
              <p className="text-xs font-bold mb-1" style={{ color: f.color }}>{f.name}</p>
              <p className="text-xs text-slate-600 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Sample table */}
      <div className="card">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Sample Browser</h3>
            <p className="text-xs text-slate-400 mt-0.5">Click blue API names to see what they do. Hover <HelpCircle size={10} className="inline text-indigo-400" /> for column explanations.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
              {([undefined, 0, 1] as const).map((l) => (
                <button
                  key={String(l)}
                  className={`tab-btn text-xs py-1 ${labelFilter === l ? "active" : ""}`}
                  onClick={() => handleFilter(l)}
                >
                  {l === undefined ? "All" : l === 0 ? "Benign" : "Malicious"}
                </button>
              ))}
            </div>
            <button
              className="btn-secondary text-xs py-2"
              onClick={() => fetchSamples(labelFilter)}
              disabled={samplesLoading}
            >
              {samplesLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Resample
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">
                  <span className="flex items-center gap-1">Hash <TermTooltip term="sha256" /></span>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">
                  <span className="flex items-center gap-1">Family <TermTooltip term="ransomware" context="malware family type" /></span>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">
                  <span className="flex items-center gap-1">EP Type <TermTooltip term="ep_type" /></span>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">
                  <span className="flex items-center gap-1">APIs <TermTooltip term="api_count" /></span>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">Signals</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">
                  <span className="flex items-center gap-1">Top APIs <span className="text-indigo-400 font-normal">(click to explain)</span></span>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">Source</th>
              </tr>
            </thead>
            <tbody>
              {samplesLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="skeleton h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                : samples.map((row, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <code className="text-xs text-slate-400" title="SHA-256 hash — unique fingerprint of this file">
                          {row.sha256.slice(0, 8)}…{row.sha256.slice(-6)}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="badge text-[11px]"
                          style={{
                            background: (COLORS[row.family as keyof typeof COLORS] || "#6366f1") + "20",
                            color: COLORS[row.family as keyof typeof COLORS] || "#6366f1",
                          }}
                        >
                          {row.family}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <span title={STATIC_GLOSSARY[row.ep_type]?.detail || row.ep_type}>
                          {row.ep_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-medium text-slate-800">{row.api_count}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {row.has_network && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 font-medium cursor-help"
                              title="Made network connections — connected to external servers"
                            >
                              NET
                            </span>
                          )}
                          {row.has_files && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-medium cursor-help"
                              title="Accessed the file system — read, wrote, or deleted files"
                            >
                              FS
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5 max-w-[200px]">
                          {row.top_apis.slice(0, 3).map((apiName, index) => (
                            <ApiChip key={`${apiName}-${index}`} name={apiName} />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] text-slate-400">{row.source}</span>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
