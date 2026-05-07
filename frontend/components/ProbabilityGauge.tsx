"use client";
import { useEffect, useState } from "react";

interface Props {
  probability: number;
  size?: number;
}

export default function ProbabilityGauge({ probability, size = 140 }: Props) {
  const [animated, setAnimated] = useState(0);
  const pct = Math.round(probability * 100);
  const isMalicious = probability > 0.5;

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(probability), 100);
    return () => clearTimeout(timer);
  }, [probability]);

  const r = (size - 20) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = Math.PI * r; // half circle
  const strokeDash = circumference;
  const strokeOffset = circumference - animated * circumference;

  const color = isMalicious
    ? animated > 0.85 ? "#dc2626" : animated > 0.65 ? "#ef4444" : "#f97316"
    : animated < 0.2 ? "#059669" : "#10b981";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size / 2 + 20} viewBox={`0 0 ${size} ${size / 2 + 20}`}>
        {/* Track */}
        <path
          d={`M ${10} ${cy} A ${r} ${r} 0 0 1 ${size - 10} ${cy}`}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth={10}
          strokeLinecap="round"
        />
        {/* Fill */}
        <path
          d={`M ${10} ${cy} A ${r} ${r} 0 0 1 ${size - 10} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${strokeDash} ${strokeDash}`}
          strokeDashoffset={strokeOffset}
          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1), stroke 0.5s" }}
        />
        {/* Value */}
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          fontSize={size * 0.18}
          fontWeight="700"
          fill={color}
          style={{ transition: "fill 0.5s" }}
        >
          {pct}%
        </text>
        {/* Label */}
        <text
          x={cx}
          y={cy + size * 0.14}
          textAnchor="middle"
          fontSize={size * 0.09}
          fill="#94a3b8"
          fontWeight="500"
        >
          {isMalicious ? "MALICIOUS" : "BENIGN"}
        </text>
      </svg>
    </div>
  );
}
