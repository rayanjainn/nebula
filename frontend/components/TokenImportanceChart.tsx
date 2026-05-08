"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface Props {
  tokens: [string, number][];
  behaviorMap?: Record<string, [string, number][]>;
}

const BEHAVIOR_COLORS: Record<string, string> = {
  process_injection: "#ef4444",
  ransomware: "#dc2626",
  network_c2: "#f97316",
  privilege_escalation: "#f59e0b",
  defense_evasion: "#eab308",
  persistence: "#8b5cf6",
  file_ops: "#6366f1",
  ui_interaction: "#06b6d4",
  unknown_suspicious: "#94a3b8",
};

const BEHAVIOR_LABELS: Record<string, string> = {
  process_injection: "Process Injection",
  ransomware: "Ransomware",
  network_c2: "Network C2",
  privilege_escalation: "Privilege Escalation",
  defense_evasion: "Defense Evasion",
  persistence: "Persistence",
  file_ops: "File Operations",
  ui_interaction: "UI Interaction",
  unknown_suspicious: "Unknown Suspicious",
};

// Plain-English explanations for common token patterns
const TOKEN_EXPLANATIONS: Record<string, string> = {
  virtualalloc: "Allocates memory in another process — key step in code injection",
  writeprocessmemory: "Writes code into another process — used to inject malicious payloads",
  createremotethread: "Starts code running inside another process — completes injection",
  getprocaddress: "Looks up a function address at runtime — used to hide imports from security tools",
  loadlibrary: "Loads a DLL file — used to add capabilities or hide malicious code",
  kernel32: "Windows core library (kernel32.dll) — provides process, memory, and file functions",
  ntdll: "Low-level Windows library — direct OS calls, often used to bypass security hooks",
  wsaconnect: "Opens a network socket connection — malware uses this for C2 communication",
  cryptencrypt: "Encrypts data — ransomware uses this to lock your files",
  createfile: "Opens or creates a file — file access or ransomware encryption target",
  regsetvalue: "Writes to the Windows Registry — used for persistence (auto-start on reboot)",
  shellexecute: "Runs a program or command — used to launch additional malware",
  getmodulehandle: "Gets a reference to a loaded library — reconnaissance or evasion",
  getmodulefilename: "Gets the path of the running executable — self-location",
  gettickcoun: "Gets system uptime — used to detect sandbox environments (short uptime = sandbox)",
  gettickcount: "Gets system uptime — used to detect sandbox environments (short uptime = sandbox)",
  sleep: "Pauses execution — malware sleeps to evade sandbox time limits",
  exitprocess: "Terminates the process — normal exit or quick sandbox exit",
  heapalloc: "Allocates memory on the heap — normal operation or unpacking hidden code",
  memset: "Fills memory with a value — often used to zero-out buffers or prepare injection",
};

function getTokenExplanation(token: string): string | null {
  const clean = token.replace(/^▁/, "").toLowerCase();
  // Direct match
  if (TOKEN_EXPLANATIONS[clean]) return TOKEN_EXPLANATIONS[clean];
  // Partial match — check if token contains a known key
  for (const [key, val] of Object.entries(TOKEN_EXPLANATIONS)) {
    if (clean.includes(key) || key.includes(clean)) return val;
  }
  // Hex addresses
  if (/^0x[0-9a-f]+$/i.test(clean)) return "Memory address — marks a specific location in program code";
  // Short fragments (BPE sub-words)
  if (clean.length <= 4) return "BPE sub-word token — part of a longer API name split by the tokenizer";
  return null;
}

function getTokenColor(token: string, behaviorMap?: Record<string, [string, number][]>): string {
  if (!behaviorMap) return "#6366f1";
  for (const [cat, pairs] of Object.entries(behaviorMap)) {
    if (pairs.some(([t]) => t === token)) {
      return BEHAVIOR_COLORS[cat] || "#6366f1";
    }
  }
  return "#6366f1";
}

interface TooltipPayloadItem {
  payload?: { fullToken?: string; explanation?: string };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{ borderRadius: 10, border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", background: "#fff", padding: "10px 14px", maxWidth: 260, fontSize: 12 }}>
      <p className="font-mono font-semibold text-slate-800 mb-1">{d?.fullToken}</p>
      {d?.explanation && (
        <p className="text-slate-500 leading-snug">{d.explanation}</p>
      )}
      <p className="text-slate-400 text-[11px] mt-1.5">Importance score: {payload[0] && typeof (payload[0] as { value?: number }).value === "number" ? ((payload[0] as { value: number }).value).toFixed(5) : "—"}</p>
    </div>
  );
}

export default function TokenImportanceChart({ tokens, behaviorMap }: Props) {
  const data = tokens.slice(0, 15).map(([token, score]) => ({
    token: token.replace(/^▁/, "").length > 16
      ? token.replace(/^▁/, "").slice(0, 14) + "…"
      : token.replace(/^▁/, ""),
    fullToken: token,
    score: Math.round(score * 10000) / 10000,
    color: getTokenColor(token, behaviorMap),
    explanation: getTokenExplanation(token),
  }));

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
        No token data available
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[10px] text-slate-400 leading-relaxed">
        Bar length = how much that token influenced the verdict. Hover any bar to see what the token means.
        Tokens starting with <code className="bg-slate-100 px-1 rounded">▁</code> are word-start markers from the BPE tokenizer.
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" domain={[0, "dataMax"]} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey="token"
            width={110}
            tick={{ fontSize: 11, fill: "#475569", fontFamily: "monospace" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="score" radius={[0, 4, 4, 0]} maxBarSize={18}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      {behaviorMap && Object.keys(behaviorMap).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(behaviorMap)
            .filter(([, pairs]) => pairs.length > 0)
            .map(([cat]) => (
              <span key={cat} className="flex items-center gap-1.5 text-xs text-slate-600">
                <span
                  className="w-2.5 h-2.5 rounded-sm inline-block"
                  style={{ background: BEHAVIOR_COLORS[cat] || "#6366f1" }}
                />
                {BEHAVIOR_LABELS[cat] || cat}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
