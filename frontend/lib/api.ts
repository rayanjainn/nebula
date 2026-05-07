const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => request<{ status: string; model_loaded: boolean; timestamp: number }>("/health"),

  modelInfo: () => request<ModelInfo>("/model/info"),

  predict: (report: object, use_xai = true, use_llm = false) =>
    request<PredictResult>("/predict", {
      method: "POST",
      body: JSON.stringify({ report, use_xai, use_llm }),
    }),

  predictText: (text: string, use_xai = true) =>
    request<PredictResult>("/predict/text", {
      method: "POST",
      body: JSON.stringify({ text, use_xai }),
    }),

  explain: (report: object) =>
    request<ExplainResult>("/explain", {
      method: "POST",
      body: JSON.stringify({ report, use_xai: true }),
    }),

  analyzeLLM: (report: object) =>
    request<LLMAnalysisResult>("/analyze/llm", {
      method: "POST",
      body: JSON.stringify({ report, use_xai: true }),
    }),

  llmQuestion: (question: string, context = "") =>
    request<{ answer: string }>("/llm/question", {
      method: "POST",
      body: JSON.stringify({ question, context }),
    }),

  datasetStats: () => request<DatasetStats>("/dataset/stats"),

  datasetSample: (n = 10, label?: number) => {
    const params = new URLSearchParams({ n: String(n) });
    if (label !== undefined) params.set("label", String(label));
    return request<{ samples: SampleRow[]; total_available: number }>(`/dataset/sample?${params}`);
  },

  trainStart: (config: TrainConfig) =>
    request<{ status: string; epochs: number }>("/train/start", {
      method: "POST",
      body: JSON.stringify(config),
    }),

  trainStatus: () => request<TrainingStatus>("/train/status"),

  metrics: () => request<ModelMetrics>("/metrics"),

  trainingResults: () => request<Record<string, unknown>>("/results"),

  explainTerm: (term: string, context = "") =>
    request<{ term: string; explanation: string }>("/explain/term", {
      method: "POST",
      body: JSON.stringify({ term, context }),
    }),

  explainVerdict: (
    verdict: string,
    probability: number,
    top_tokens: [string, number][],
    behavior_categories: Record<string, unknown>
  ) =>
    request<{ verdict: string; explanation: string }>("/explain/verdict", {
      method: "POST",
      body: JSON.stringify({ verdict, probability, top_tokens, behavior_categories }),
    }),

  listExamples: () => request<{ examples: ExampleInfo[] }>("/examples"),

  getExample: (name: string) => request<object>(`/examples/${name}`),

  predictExample: (name: string, use_xai = true) =>
    request<PredictResult>(`/predict/example/${name}?use_xai=${use_xai}`, { method: "POST" }),

  streamAnalysis: (report: object): EventSource => {
    // SSE streaming endpoint — caller must handle events
    // We post via fetch manually since EventSource doesn't support POST
    return new EventSource(`${API_BASE}/analyze/llm/stream`);
  },

  streamAnalysisFetch: async function* (report: object) {
    const res = await fetch(`${API_BASE}/analyze/llm/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report, use_xai: true }),
    });
    if (!res.ok || !res.body) throw new Error("Stream failed");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try { yield JSON.parse(line.slice(6)); } catch {}
        }
      }
    }
  },
};

// ── Types ─────────────────────────────────────────────────────────────────

export interface ModelInfo {
  name: string;
  parameters: number;
  vocab_size: number;
  seq_len: number;
  d_model: number;
  pooling: string;
  attention_span: number;
  improvements: string[];
}

export interface XAIResult {
  top_tokens: [string, number][];
  behavior_map: Record<string, [string, number][]>;
  maliciousness_score: number;
}

export interface PredictResult {
  probability: number;
  verdict: "MALICIOUS" | "BENIGN";
  confidence: number;
  text_preview?: string;
  xai?: XAIResult;
  llm_analysis?: string;
}

export interface ExplainResult {
  probability: number;
  verdict: "MALICIOUS" | "BENIGN";
  top_tokens: [string, number][];
  attention_importance: [string, number][];
  ig_attributions: number[] | null;
  behavior_map: Record<string, [string, number][]>;
  maliciousness_score: number;
}

export interface LLMAnalysisResult {
  probability: number;
  verdict: "MALICIOUS" | "BENIGN";
  analysis: string;
  xai: XAIResult;
}

export interface DatasetStats {
  total: number;
  malicious: number;
  benign: number;
  malicious_pct: number;
  families: Record<string, number>;
  sources: Record<string, number>;
  avg_api_calls: number;
  max_api_calls: number;
}

export interface SampleRow {
  sha256: string;
  label: number;
  family: string;
  ep_type: string;
  api_count: number;
  top_apis: string[];
  has_network: boolean;
  has_files: boolean;
  source: string;
}

export interface TrainConfig {
  epochs: number;
  time_budget_minutes: number;
  batch_size: number;
  lr: number;
}

export interface TrainingStatus {
  running: boolean;
  epoch: number;
  epochs: number;
  train_loss: number[];
  val_auc: number[];
  val_f1: number[];
  val_tpr: number[];
  done: boolean;
  error: string | null;
  elapsed_seconds?: number;
}

export interface ModelMetrics {
  status?: string;
  message?: string;
  epoch?: number;
  auc?: number;
  f1?: number;
  accuracy?: number;
  tpr_at_fpr1e3?: number;
  loss?: number;
}

export interface ExampleInfo {
  name: string;
  sha256: string;
  entry_points: number;
  sample_apis: string[];
}
