"use client";

interface Props {
  verdict: "MALICIOUS" | "BENIGN" | string;
  probability?: number;
  size?: "sm" | "md" | "lg";
}

export default function VerdictBadge({ verdict, probability, size = "md" }: Props) {
  const isMalicious = verdict === "MALICIOUS";
  const sizeClasses = {
    sm: "text-[11px] px-2 py-0.5",
    md: "text-xs px-3 py-1",
    lg: "text-sm px-4 py-1.5",
  }[size];

  return (
    <span
      className={`badge ${isMalicious ? "badge-malicious" : "badge-benign"} ${sizeClasses}`}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
          isMalicious ? "bg-red-500" : "bg-emerald-500"
        }`}
      />
      {verdict}
      {probability !== undefined && (
        <span className="ml-1.5 opacity-70">{(probability * 100).toFixed(1)}%</span>
      )}
    </span>
  );
}
