"use client";
import { useState, useEffect } from "react";
import { api, ExplainResult, ExampleInfo } from "@/lib/api";
import VerdictBadge from "@/components/VerdictBadge";
import TokenImportanceChart from "@/components/TokenImportanceChart";
import BehaviorMap from "@/components/BehaviorMap";
import { Microscope, Loader2, Play, Info } from "lucide-react";

export default function XAIPage() {
  const [examples, setExamples] = useState<ExampleInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExplainResult | null>(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"attention" | "ig" | "behavior">("attention");
  const [exampleContent, setExampleContent] = useState<string>("");
  const [showExampleContent, setShowExampleContent] = useState(false);

  useEffect(() => {
    if (selected) {
      api.getExample(selected)
        .then(res => setExampleContent(JSON.stringify(res, null, 2)))
        .catch(() => setExampleContent("Failed to load content"));
    }
  }, [selected]);

  useEffect(() => {
    api.listExamples().then((r) => {
      setExamples(r.examples);
      if (r.examples.length) setSelected(r.examples[0].name);
    });
  }, []);

  async function run() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const report = await api.getExample(selected);
      const r = await api.explain(report);
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "XAI failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">XAI Explorer</h1>
          <p className="text-sm text-slate-500 mt-1">
            Attention weights + Integrated Gradients + MITRE ATT&CK behavior mapping
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
          <Info size={12} />
          Uses IG (20 steps) for token attribution
        </div>
      </div>

      {/* Controls */}
      <div className="card p-5 flex items-center gap-4">
        <div className="flex-1">
          <label className="text-xs font-medium text-slate-600 block mb-1.5">Example Report</label>
          <select
            className="input-field"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {examples.map((ex) => (
              <option key={ex.name} value={ex.name}>
                {ex.name.replace(".json", "")}
              </option>
            ))}
          </select>
          {selected && (
            <div className="mt-2">
              <button onClick={() => setShowExampleContent(!showExampleContent)} className="text-xs text-indigo-500 hover:underline">
                {showExampleContent ? "Hide" : "Show"} Example Content
              </button>
              {showExampleContent && (
                <pre className="mt-2 text-[10px] font-mono text-slate-600 bg-slate-50 p-2 border rounded overflow-y-auto max-h-48">
                  {exampleContent || "Loading..."}
                </pre>
              )}
            </div>
          )}
        </div>
        <div className="pt-5">
          <button className="btn-primary" onClick={run} disabled={loading || !selected}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {loading ? "Computing…" : "Explain"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {loading && (
        <div className="card p-12 text-center">
          <Loader2 size={32} className="animate-spin text-indigo-500 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-700">Computing attributions…</p>
          <p className="text-xs text-slate-400 mt-1">Integrated Gradients with 20 interpolation steps</p>
        </div>
      )}

      {result && (
        <div className="space-y-4 animate-fade-in-up">
          {/* Verdict strip */}
          <div className="card p-4 flex items-center gap-4">
            <VerdictBadge verdict={result.verdict} probability={result.probability} size="md" />
            <div className="divider" style={{ width: "1px", height: "24px", background: "#e2e8f0" }} />
            <div className="flex items-center gap-6 text-sm">
              <div>
                <span className="text-slate-500 text-xs">Model Prob.</span>
                <p className="font-mono font-semibold text-slate-900">
                  {(result.probability * 100).toFixed(2)}%
                </p>
              </div>
              <div>
                <span className="text-slate-500 text-xs">XAI Score</span>
                <p className="font-mono font-semibold text-slate-900">
                  {(result.maliciousness_score * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <span className="text-slate-500 text-xs">Top Token</span>
                <p className="font-mono font-semibold text-slate-900">
                  {result.top_tokens[0]?.[0] || "—"}
                </p>
              </div>
              <div>
                <span className="text-slate-500 text-xs">Behaviors</span>
                <p className="font-semibold text-slate-900">
                  {Object.keys(result.behavior_map).length} categories
                </p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
            {(["attention", "ig", "behavior"] as const).map((t) => (
              <button
                key={t}
                className={`tab-btn ${activeTab === t ? "active" : ""}`}
                onClick={() => setActiveTab(t)}
              >
                {t === "attention" ? "Attention Weights" : t === "ig" ? "Integrated Gradients" : "Behavior Map"}
              </button>
            ))}
          </div>

          {activeTab === "attention" && (
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-sm font-semibold text-slate-800">
                  CLS Token Attention Importance
                </h3>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                  Top {Math.min(result.attention_importance.length, 15)} tokens
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Scores represent how much attention the CLS token pays to each input token —
                higher = more influential for the final classification.
              </p>
              <TokenImportanceChart
                tokens={result.attention_importance}
                behaviorMap={result.behavior_map}
              />
            </div>
          )}

          {activeTab === "ig" && (
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Integrated Gradients</h3>
              <p className="text-xs text-slate-500 mb-4">
                IG scores measure how much each token embedding dimension contributes to the
                malware prediction, averaged from baseline (zero) to actual input.
              </p>
              {result.ig_attributions ? (
                <div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.ig_attributions.slice(0, 64).map((score, i) => (
                      <div
                        key={i}
                        className="w-6 h-6 rounded text-[9px] flex items-center justify-center font-mono"
                        style={{
                          background: score > 0.01
                            ? `rgba(239,68,68,${Math.min(score * 8, 0.9)})`
                            : `rgba(16,185,129,${Math.min(Math.abs(score) * 8, 0.4)})`,
                          color: score > 0.05 ? "white" : "#374151",
                        }}
                        title={`Position ${i}: ${score.toFixed(4)}`}
                      >
                        {i}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-3">
                    Showing first 64 positions · red = malicious signal · green = benign signal
                  </p>
                  <div className="mt-4">
                    <p className="text-xs text-slate-600 font-medium mb-2">Top 10 Attribution Scores</p>
                    <TokenImportanceChart
                      tokens={result.top_tokens.slice(0, 10)}
                      behaviorMap={result.behavior_map}
                    />
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-400 py-4 text-center">
                  IG computation failed or skipped (use attention tab)
                </div>
              )}
            </div>
          )}

          {activeTab === "behavior" && (
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-slate-800 mb-1">MITRE ATT&CK Behavior Mapping</h3>
              <p className="text-xs text-slate-500 mb-4">
                Important tokens matched against known malware behavior patterns from
                domain knowledge and Nebula paper Table 11.
              </p>
              <BehaviorMap behaviorMap={result.behavior_map} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
