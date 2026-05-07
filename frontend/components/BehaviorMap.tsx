"use client";

interface Props {
  behaviorMap: Record<string, [string, number][]>;
}

const CATEGORY_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  process_injection:    { label: "Process Injection",    color: "#dc2626", bg: "#fee2e2", icon: "💉" },
  ransomware:           { label: "Ransomware",           color: "#b91c1c", bg: "#fee2e2", icon: "🔒" },
  network_c2:           { label: "Network C2",           color: "#ea580c", bg: "#ffedd5", icon: "🌐" },
  privilege_escalation: { label: "Privilege Escalation", color: "#d97706", bg: "#fef3c7", icon: "⬆️" },
  defense_evasion:      { label: "Defense Evasion",      color: "#ca8a04", bg: "#fef9c3", icon: "🛡️" },
  persistence:          { label: "Persistence",          color: "#7c3aed", bg: "#ede9fe", icon: "📌" },
  file_ops:             { label: "File Operations",      color: "#4f46e5", bg: "#eef2ff", icon: "📁" },
  ui_interaction:       { label: "UI Interaction",       color: "#0891b2", bg: "#ecfeff", icon: "🖥️" },
  unknown_suspicious:   { label: "Unknown Suspicious",   color: "#64748b", bg: "#f8fafc", icon: "❓" },
};

export default function BehaviorMap({ behaviorMap }: Props) {
  const categories = Object.entries(behaviorMap).filter(([, v]) => v.length > 0);

  if (!categories.length) {
    return (
      <div className="text-sm text-slate-400 py-8 text-center">
        No suspicious behaviors detected
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {categories.map(([cat, tokens]) => {
        const meta = CATEGORY_META[cat] || { label: cat, color: "#6366f1", bg: "#eef2ff", icon: "🔍" };
        return (
          <div
            key={cat}
            className="rounded-lg border p-3"
            style={{ borderColor: meta.color + "30", background: meta.bg }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">{meta.icon}</span>
              <span className="text-sm font-semibold" style={{ color: meta.color }}>
                {meta.label}
              </span>
              <span
                className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: meta.color + "20", color: meta.color }}
              >
                {tokens.length} token{tokens.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tokens.map(([token, score]) => (
                <span
                  key={token}
                  className="token-tag text-xs"
                  style={{
                    background: meta.color + "15",
                    borderColor: meta.color + "30",
                    color: meta.color,
                  }}
                  title={`Score: ${score.toFixed(4)}`}
                >
                  <code>{token}</code>
                  <span className="opacity-50 text-[10px]">{score.toFixed(3)}</span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
