"use client";
import { useState, useEffect, useRef } from "react";
import { api, ExampleInfo } from "@/lib/api";
import VerdictBadge from "@/components/VerdictBadge";
import { BrainCircuit, Loader2, Play, Send, Sparkles, StopCircle } from "lucide-react";
import MarkdownText from "@/components/MarkdownText";

export default function LLMPage() {
  const [examples, setExamples] = useState<ExampleInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"analyze" | "stream" | "chat">("stream");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [result, setResult] = useState<{ prob?: number; verdict?: string; analysis?: string } | null>(null);
  const [streamText, setStreamText] = useState("");
  const [question, setQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState("");
  const [exampleContent, setExampleContent] = useState<string>("");
  const [showExampleContent, setShowExampleContent] = useState(false);
  const streamRef = useRef<AbortController | null>(null);
  const textRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [streamText]);

  async function runStream() {
    setStreaming(true);
    setStreamText("");
    setResult(null);
    setError("");
    streamRef.current = new AbortController();

    try {
      const report = await api.getExample(selected);
      for await (const chunk of api.streamAnalysisFetch(report)) {
        if (chunk.prob !== undefined) {
          setResult({ prob: chunk.prob, verdict: chunk.verdict });
        } else if (chunk.token) {
          setStreamText((prev) => prev + chunk.token);
        } else if (chunk.done) {
          break;
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        setError(e.message);
      }
    } finally {
      setStreaming(false);
    }
  }

  async function runFull() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const report = await api.getExample(selected);
      const r = await api.analyzeLLM(report);
      setResult({ prob: r.probability, verdict: r.verdict, analysis: r.analysis });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "LLM analysis failed");
    } finally {
      setLoading(false);
    }
  }

  async function askQuestion() {
    if (!question.trim()) return;
    setChatLoading(true);
    setChatAnswer("");
    try {
      const r = await api.llmQuestion(question, result?.analysis || streamText || "");
      setChatAnswer(r.answer);
    } catch (e: unknown) {
      setChatAnswer(e instanceof Error ? e.message : "Failed");
    } finally {
      setChatLoading(false);
    }
  }

  const displayText = mode === "stream" ? streamText : result?.analysis || "";

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">LLM Analysis</h1>
          <p className="text-sm text-slate-500 mt-1">
            gemma3:27b generates threat intelligence, MITRE ATT&CK mappings, and IOCs
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full font-medium">
          <Sparkles size={12} />
          Powered by gemma3:27b
        </div>
      </div>

      {/* Controls */}
      <div className="card p-5 space-y-4">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="text-xs font-medium text-slate-600 block mb-1.5">Sample Report</label>
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
                  <pre className="mt-2 text-[10px] font-mono text-slate-600 bg-slate-50 p-2 border rounded overflow-auto max-h-64">
                    {exampleContent || "Loading..."}
                  </pre>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1.5">Mode</label>
            <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                className={`tab-btn text-xs py-1.5 ${mode === "stream" ? "active" : ""}`}
                onClick={() => setMode("stream")}
              >
                Stream
              </button>
              <button
                className={`tab-btn text-xs py-1.5 ${mode === "analyze" ? "active" : ""}`}
                onClick={() => setMode("analyze")}
              >
                Full
              </button>
            </div>
          </div>
          <div>
            {!streaming ? (
              <button
                className="btn-primary"
                onClick={mode === "stream" ? runStream : runFull}
                disabled={loading || !selected}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {loading ? "Analyzing…" : "Analyze"}
              </button>
            ) : (
              <button
                className="btn-secondary border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => { streamRef.current?.abort(); setStreaming(false); }}
              >
                <StopCircle size={16} />
                Stop
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Result header */}
      {result && (result.prob !== undefined) && (
        <div className="card p-4 flex items-center gap-3">
          <VerdictBadge
            verdict={result.verdict as "MALICIOUS" | "BENIGN"}
            probability={result.prob}
          />
          <span className="text-sm text-slate-500">
            {streaming ? "Generating analysis…" : "Analysis complete"}
          </span>
          {streaming && <Loader2 size={14} className="animate-spin text-indigo-400 ml-auto" />}
        </div>
      )}

      {/* LLM Output */}
      {(displayText || streaming) && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <BrainCircuit size={14} className="text-indigo-500" />
            <span className="text-sm font-medium text-slate-700">Threat Intelligence Report</span>
            {streaming && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-indigo-500">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                Streaming
              </span>
            )}
          </div>
          <div
            ref={textRef}
            className="p-5 max-h-[420px] overflow-y-auto"
          >
            {displayText ? (
              <div className="llm-stream">
                <MarkdownText>{displayText}</MarkdownText>
              </div>
            ) : streaming ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Loader2 size={14} className="animate-spin" />
                Waiting for model response…
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Follow-up Q&A */}
      {(displayText || result?.analysis) && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Ask a Follow-up Question</h3>
          <div className="flex gap-2">
            <input
              className="input-field"
              placeholder="e.g. What MITRE ATT&CK technique does this use?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askQuestion()}
            />
            <button
              className="btn-primary shrink-0"
              onClick={askQuestion}
              disabled={chatLoading || !question.trim()}
            >
              {chatLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>

          {chatAnswer && (
            <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-xs font-medium text-slate-500 mb-2">Answer</p>
              <div className="llm-stream">
                <MarkdownText>{chatAnswer}</MarkdownText>
              </div>
            </div>
          )}

          {/* Quick question chips */}
          <div className="flex flex-wrap gap-2 mt-3">
            {[
              "What malware family is this?",
              "List all MITRE ATT&CK IDs",
              "What are the top IOCs?",
              "Is this ransomware?",
              "What network activity is present?",
            ].map((q) => (
              <button
                key={q}
                className="text-xs px-3 py-1.5 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
                onClick={() => { setQuestion(q); }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
