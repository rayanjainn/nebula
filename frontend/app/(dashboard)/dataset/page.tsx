"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { api, DatasetStats, SampleRow } from "@/lib/api";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis
} from "recharts";
import { 
  Database, RefreshCw, Loader2, HelpCircle, X, Info, BookOpen, BrainCircuit, Sparkles,
  Search, Copy, Globe, Shield, CheckCircle, Activity,
  Layers
} from "lucide-react";

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

function SampleSummary({ row }: { row: SampleRow }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    if (summary) { setOpen(true); return; }
    setLoading(true);
    setOpen(true);
    try {
      const r = await api.datasetSummarize(row.top_apis, row.label, row.family);
      setSummary(r.summary);
    } catch {
      setSummary("Summary unavailable.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={load}
        className="flex items-center gap-1.5 text-[10px] bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-2 py-1 rounded font-medium transition-colors"
        title="AI behavioral summary"
      >
        <Sparkles size={11} />
        Summarize
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-50 w-72 bg-white rounded-xl shadow-2xl border border-slate-200 p-4 text-xs">
          <div className="flex items-start justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-1.5">
              <BrainCircuit size={13} className="text-indigo-500" />
              <span className="font-semibold text-slate-800">Behavior Summary</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 shrink-0">
              <X size={14} />
            </button>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 py-2">
              <Loader2 size={12} className="animate-spin" />
              AI is analyzing behavior...
            </div>
          ) : (
            <div className="text-slate-600 leading-relaxed space-y-2">
              <p>{summary}</p>
              <div className="pt-2 border-t border-slate-100 flex items-center gap-1 text-[10px] text-slate-400">
                <Info size={10} />
                Based on first {row.top_apis.length} API calls
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DatasetPage() {
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  
  // Filtering & infinite-scroll state
  const [page, setPage] = useState(1);
  const limit = 10;
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<number | undefined>(undefined);
  const [familyFilter, setFamilyFilter] = useState("all");
  const [isBalanced, setIsBalanced] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    api.datasetStats().then(setStats).finally(() => setLoading(false));
  }, []);

  // Reset and reload from page 1 when filters change
  useEffect(() => {
    setSamples([]);
    setPage(1);
    setHasMore(true);
    loadingRef.current = false;
  }, [labelFilter, familyFilter, search, isBalanced]);

  // Fetch one page and append
  const fetchPage = useCallback(async (pageNum: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setSamplesLoading(true);
    try {
      const r = await api.datasetSample(pageNum, limit, labelFilter, familyFilter, search, isBalanced);
      setTotal(r.total);
      setSamples((prev) => pageNum === 1 ? r.samples : [...prev, ...r.samples]);
      setHasMore(pageNum * limit < r.total);
    } catch (err) {
      console.error(err);
    } finally {
      setSamplesLoading(false);
      loadingRef.current = false;
    }
  }, [labelFilter, familyFilter, search, isBalanced]);

  // Trigger fetch whenever page changes
  useEffect(() => {
    fetchPage(page);
  }, [page, fetchPage]);

  // IntersectionObserver to load next page when sentinel enters viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingRef.current) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore]);

  function handleLabelFilter(label: number | undefined) {
    setLabelFilter(label);
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
            {stats?.total?.toLocaleString() || "..."} unique Windows behavior samples — hover <HelpCircle size={11} className="inline text-indigo-400" /> on any term for an explanation
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
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: "Unique Samples", value: stats.total.toLocaleString(), color: "#6366f1", term: null, detail: "Total unique Windows programs (aggregated)", icon: Database },
            { label: "Total Records", value: stats.total_records.toLocaleString(), color: "#94a3b8", term: null, detail: "Individual behavioral traces (threads) across all samples", icon: Layers },
            { label: "Malicious", value: stats.malicious.toLocaleString(), sub: `${stats.malicious_pct}%`, color: "#ef4444", term: "malicious", detail: "Harmful programs", icon: Shield },
            { label: "Benign", value: stats.benign.toLocaleString(), sub: `${(100 - stats.malicious_pct).toFixed(1)}%`, color: "#10b981", term: "benign", detail: "Safe programs", icon: CheckCircle },
            { label: "Avg APIs", value: stats.avg_api_calls.toString(), sub: `max: ${stats.max_api_calls}`, color: "#f59e0b", term: "api_count", detail: "Avg Windows functions called", icon: Activity },
          ].map((s) => (
            <div key={s.label} className="card card-hover p-3.5 relative overflow-hidden group">
              <div className="absolute -right-2 -bottom-2 opacity-5 group-hover:opacity-10 transition-opacity">
                <s.icon size={56} />
              </div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                {s.label}
                {s.term && <TermTooltip term={s.term} context={s.detail} />}
              </div>
              <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
              {s.sub && <p className="text-[10px] text-slate-400 mt-0.5 font-medium">{s.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Search & Filters Row */}
      <div className="card p-4">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by hash or family..."
              className="input-field pl-9 text-sm h-10"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              className="input-field text-xs h-10 w-32"
              value={labelFilter === undefined ? "all" : labelFilter}
              onChange={(e) => handleLabelFilter(e.target.value === "all" ? undefined : Number(e.target.value))}
            >
              <option value="all">All Labels</option>
              <option value="1">Malicious</option>
              <option value="0">Benign</option>
            </select>
            <select
              className="input-field text-xs h-10 w-40"
              value={familyFilter}
              onChange={(e) => { setFamilyFilter(e.target.value); setPage(1); }}
            >
              <option value="all">All Families</option>
              {Object.keys(stats?.families || {}).sort().map(f => (
                <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="w-px h-6 bg-slate-200" />
          <div className="flex items-center gap-2">
             <button
                onClick={() => setIsBalanced(!isBalanced)}
                className={`flex items-center gap-2 px-3 h-10 rounded-lg text-xs font-medium transition-all ${
                  isBalanced ? "bg-indigo-600 text-white shadow-md shadow-indigo-100" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
             >
                <Sparkles size={14} />
                Balanced View
             </button>
             <span title="In production, benign data is much more common. This view creates a 50/50 balance for better evaluation.">
               <HelpCircle size={14} className="text-slate-300 cursor-help" />
             </span>
          </div>
        </div>
      </div>

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
            <button
              className="btn-secondary text-xs py-2"
              onClick={() => { setSamples([]); setPage(1); setHasMore(true); loadingRef.current = false; }}
              disabled={samplesLoading}
            >
              {samplesLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 w-32">
                  <span className="flex items-center gap-1">Hash <TermTooltip term="sha256" /></span>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">
                  <span className="flex items-center gap-1">Label</span>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">
                  <span className="flex items-center gap-1">Family <TermTooltip term="ransomware" context="malware family type" /></span>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">
                  <span className="flex items-center gap-1">Threads <BrainCircuit size={11} className="text-indigo-400" /></span>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">
                  <span className="flex items-center gap-1">APIs <TermTooltip term="api_count" /></span>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">Signals</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">
                  <span className="flex items-center gap-1">Top APIs <span className="text-indigo-400 font-normal">(click to explain)</span></span>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">Source</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 text-right">AI</th>
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
                      <td className="px-4 py-3">
                         <div className="skeleton h-4 w-8 ml-auto" />
                      </td>
                    </tr>
                  ))
                : samples.map((row, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 w-32">
                        <div className="flex items-center gap-1 group">
                          <code className="text-[10px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 truncate max-w-[80px] block" title={row.sha256}>
                            {row.sha256.slice(0, 10)}…
                          </code>
                          <button
                            onClick={() => navigator.clipboard.writeText(row.sha256)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-indigo-50 text-indigo-400 rounded transition-all shrink-0"
                            title="Copy Full Hash"
                          >
                            <Copy size={10} />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${row.label === 1 ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}>
                          {row.label === 1 ? "MALICIOUS" : "BENIGN"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="badge text-[11px] font-bold px-2 py-0.5 rounded-full"
                          style={{
                            background: (COLORS[row.family as keyof typeof COLORS] || "#6366f1") + "20",
                            color: COLORS[row.family as keyof typeof COLORS] || "#6366f1",
                          }}
                        >
                          {row.family.charAt(0).toUpperCase() + row.family.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 text-xs text-slate-500 font-medium">
                           <BrainCircuit size={12} className="text-slate-300" />
                           {row.threads}
                        </div>
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
                      <td className="px-4 py-3 text-right">
                        <SampleSummary row={row} />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          
          {/* Empty state */}
          {!loading && samples.length === 0 && (
            <div className="py-12 text-center">
              <Database size={32} className="text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No samples found matching your filters</p>
              <button
                onClick={() => { setSearch(""); setLabelFilter(undefined); setFamilyFilter("all"); }}
                className="text-xs text-indigo-500 hover:underline mt-2"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>

        {/* Infinite scroll sentinel + footer */}
        <div ref={sentinelRef} className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-center gap-2">
          {samplesLoading ? (
            <><Loader2 size={14} className="animate-spin text-indigo-400" /><span className="text-xs text-slate-400">Loading more…</span></>
          ) : hasMore ? (
            <span className="text-xs text-slate-400">Scroll for more · {samples.length} of {total.toLocaleString()} shown</span>
          ) : (
            <span className="text-xs text-slate-400">All {total.toLocaleString()} samples loaded</span>
          )}
        </div>
      </div>

      {/* Dataset Expansion Recommendation */}
      <div className="card p-6 border-dashed border-2 border-slate-200 bg-slate-50/50">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white border border-slate-100 flex items-center justify-center shrink-0 shadow-sm">
            <Globe size={24} className="text-indigo-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-900">Add 10GB+ of Real-World Data</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Your current local dataset ({stats?.total.toLocaleString()} samples) is a tiny subset. To achieve high detection accuracy on real-world malware, we recommend downloading the <strong>SOREL-20M</strong> or <strong>EMBER</strong> datasets. This adds approximately 10GB of behavioral traces.
            </p>
            <div className="flex gap-3 mt-4">
              <a 
                href="https://github.com/sophos-ai/SOREL-20M" 
                target="_blank" 
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-indigo-600 bg-white border border-indigo-100 hover:bg-indigo-50 px-3 py-1.5 rounded-lg font-medium transition-colors shadow-sm"
              >
                <Globe size={13} />
                Download SOREL-20M
              </a>
              <button className="flex items-center gap-1.5 text-xs text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg font-medium transition-colors shadow-sm">
                <RefreshCw size={13} />
                Run Merge Script
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
