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

function getTokenColor(token: string, behaviorMap?: Record<string, [string, number][]>): string {
  if (!behaviorMap) return "#6366f1";
  for (const [cat, pairs] of Object.entries(behaviorMap)) {
    if (pairs.some(([t]) => t === token)) {
      return BEHAVIOR_COLORS[cat] || "#6366f1";
    }
  }
  return "#6366f1";
}

export default function TokenImportanceChart({ tokens, behaviorMap }: Props) {
  const data = tokens.slice(0, 15).map(([token, score]) => ({
    token: token.length > 18 ? token.slice(0, 16) + "…" : token,
    fullToken: token,
    score: Math.round(score * 10000) / 10000,
    color: getTokenColor(token, behaviorMap),
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
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" domain={[0, "dataMax"]} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey="token"
            width={120}
            tick={{ fontSize: 11, fill: "#475569", fontFamily: "monospace" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(val, _, props) => [
              (val as number).toFixed(4),
              (props as { payload?: { fullToken?: string } }).payload?.fullToken || "score",
            ]}
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              fontSize: "13px",
            }}
          />
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
