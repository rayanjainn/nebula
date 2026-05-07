"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Shield, Activity, Microscope, BrainCircuit, Database,
  BarChart2, ChevronRight, Cpu, Zap, Sparkles
} from "lucide-react";

const NAV = [
  { label: "Overview", href: "/", icon: Activity },
  { label: "Try It Yourself", href: "/try", icon: Sparkles, highlight: true },
  { label: "Analyze Sample", href: "/analyze", icon: Shield },
  { label: "XAI Explorer", href: "/xai", icon: Microscope },
  { label: "LLM Analysis", href: "/llm", icon: BrainCircuit },
  { label: "Dataset", href: "/dataset", icon: Database },
  { label: "Training", href: "/training", icon: Zap },
  { label: "Model Info", href: "/model", icon: Cpu },
  { label: "Metrics", href: "/metrics", icon: BarChart2 },
];

export default function Sidebar() {
  const path = usePathname();

  return (
    <aside className="w-[220px] shrink-0 h-screen sticky top-0 bg-white border-r border-slate-200 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
            <Shield size={16} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-sm text-slate-900 leading-none">Nebula</p>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">Enhanced v1.0</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ label, href, icon: Icon, highlight }) => {
          const active = path === href;
          return (
            <Link
              key={href}
              href={href}
              className={`sidebar-link ${active ? "active" : ""} ${highlight && !active ? "text-indigo-600 bg-indigo-50/60 hover:bg-indigo-50" : ""}`}
            >
              <Icon size={16} className={active ? "text-indigo-500" : highlight ? "text-indigo-400" : "text-slate-400"} />
              <span>{label}</span>
              {highlight && !active && (
                <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-500 text-white">NEW</span>
              )}
              {active && <ChevronRight size={12} className="ml-auto text-indigo-400" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-slate-100">
        <div className="text-[11px] text-slate-400 space-y-0.5">
          <p className="font-semibold text-slate-500">Nebula Enhanced</p>
          <p>IEEE 2024 · gemma3:27b</p>
          <p>Transformer + XAI + LLM</p>
        </div>
      </div>
    </aside>
  );
}
