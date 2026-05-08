"use client";

interface Props {
  behaviorMap: Record<string, [string, number][]>;
}

const CATEGORY_META: Record<string, {
  label: string; color: string; bg: string; icon: string;
  plain: string;
}> = {
  process_injection: {
    label: "Process Injection", color: "#dc2626", bg: "#fee2e2", icon: "💉",
    plain: "The program injected its code into another running process. This is how malware hides inside a trusted app (like explorer.exe) so antivirus doesn't see it.",
  },
  ransomware: {
    label: "Ransomware", color: "#b91c1c", bg: "#fee2e2", icon: "🔒",
    plain: "Encryption APIs were used on files. Ransomware does this to lock your files and demand payment — it writes scrambled versions then deletes originals.",
  },
  network_c2: {
    label: "Network C2", color: "#ea580c", bg: "#ffedd5", icon: "🌐",
    plain: "The program made network connections to external servers. C2 (Command & Control) means malware is 'calling home' to receive orders from the attacker.",
  },
  privilege_escalation: {
    label: "Privilege Escalation", color: "#d97706", bg: "#fef3c7", icon: "⬆️",
    plain: "The program tried to gain higher permissions than it should have. This lets malware access admin-only areas of your system it normally couldn't reach.",
  },
  defense_evasion: {
    label: "Defense Evasion", color: "#ca8a04", bg: "#fef9c3", icon: "🛡️",
    plain: "The program used techniques to hide from antivirus. This includes loading code dynamically (so it's invisible in the import table) or using low-level OS calls.",
  },
  persistence: {
    label: "Persistence", color: "#7c3aed", bg: "#ede9fe", icon: "📌",
    plain: "The program made itself survive a reboot — writing to the Windows Registry, creating a scheduled task, or installing as a service so it re-runs automatically.",
  },
  file_ops: {
    label: "File Operations", color: "#4f46e5", bg: "#eef2ff", icon: "📁",
    plain: "The program read, created, or modified files. Combined with encryption APIs this signals ransomware. High file-write counts after encryption API calls = ransomware.",
  },
  ui_interaction: {
    label: "UI Interaction", color: "#0891b2", bg: "#ecfeff", icon: "🖥️",
    plain: "The program interacted with the screen or keyboard. Keyloggers capture your keystrokes; some malware takes screenshots to steal passwords and sensitive info.",
  },
  unknown_suspicious: {
    label: "Unknown Suspicious", color: "#64748b", bg: "#f8fafc", icon: "❓",
    plain: "Suspicious API calls that don't fit a known category. May indicate novel malware techniques or rare behaviors not in the known-pattern library.",
  },
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
        const meta = CATEGORY_META[cat] || {
          label: cat, color: "#6366f1", bg: "#eef2ff", icon: "🔍",
          plain: "Suspicious behavior detected in this category.",
        };
        return (
          <div
            key={cat}
            className="rounded-lg border p-3"
            style={{ borderColor: meta.color + "30", background: meta.bg }}
          >
            <div className="flex items-center gap-2 mb-1.5">
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
            <p className="text-[11px] text-slate-600 leading-relaxed mb-2">{meta.plain}</p>
            <div className="flex flex-wrap gap-1.5">
              {tokens.map(([token, score], ti) => (
                <span
                  key={`${token}_${ti}`}
                  className="token-tag text-xs"
                  style={{
                    background: meta.color + "15",
                    borderColor: meta.color + "30",
                    color: meta.color,
                  }}
                  title={`Score: ${score.toFixed(4)}`}
                >
                  <code>{token.replace(/^▁/, "")}</code>
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
