"""
LLM-powered malware analysis using Ollama cloud API (gemma3:27b).

Features:
  - Generate natural language explanations of malware behavior
  - Analyze API call sequences for threat intelligence
  - Summarize XAI token importance findings
  - Generate threat reports
  - Answer questions about specific behaviors
"""
import json
import logging
import requests
from typing import Dict, List, Optional, Generator

log = logging.getLogger(__name__)

OLLAMA_HOST = "https://ollama.com"
OLLAMA_API_KEY = "b240dea1798441f1869c754dd6f4175e.BHR7ANZq-3W18tIztbsRl-Dj"
OLLAMA_MODEL = "gemma3:27b"


SYSTEM_PROMPT = """You are a senior malware analyst and cybersecurity researcher specializing in Windows malware behavioral analysis.
You have deep expertise in:
- Windows API calls and their malicious uses
- Malware families: ransomware, RATs, backdoors, trojans, coinminers, keyloggers, droppers
- Dynamic analysis and sandbox reports
- MITRE ATT&CK framework
- Threat intelligence reporting

When analyzing behavioral reports, you:
1. Identify specific malicious behaviors from API sequences
2. Map behaviors to MITRE ATT&CK techniques
3. Assess severity and risk level
4. Provide actionable threat intelligence
5. Explain technical findings clearly for both technical and non-technical audiences

Be precise, evidence-based, and cite specific API calls or tokens from the data you're given."""


class OllamaClient:
    """Client for Ollama cloud API (OpenAI-compatible endpoint)."""

    def __init__(
        self,
        host: str = OLLAMA_HOST,
        api_key: str = OLLAMA_API_KEY,
        model: str = OLLAMA_MODEL,
        timeout: int = 60,
    ):
        self.host = host.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.base_url = f"{self.host}/api"

    def _headers(self) -> Dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def chat(
        self,
        messages: List[Dict],
        temperature: float = 0.3,
        max_tokens: int = 1500,
        stream: bool = False,
    ) -> str:
        """Send a chat completion request."""
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "stream": stream,
            "options": {"num_predict": max_tokens},
        }

        url = f"{self.base_url}/chat"
        try:
            resp = requests.post(
                url, json=payload, headers=self._headers(), timeout=self.timeout
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("message", {}).get("content", "")
        except requests.exceptions.Timeout:
            return "Analysis timed out. Please try again."
        except Exception as e:
            log.error(f"Ollama API error: {e}")
            return f"LLM unavailable: {str(e)}"

    def stream_chat(
        self,
        messages: List[Dict],
        temperature: float = 0.3,
        max_tokens: int = 1500,
    ) -> Generator[str, None, None]:
        """Stream chat completion tokens."""
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
            "options": {"num_predict": max_tokens},
        }
        url = f"{self.base_url}/chat"
        try:
            with requests.post(
                url, json=payload, headers=self._headers(),
                timeout=self.timeout, stream=True
            ) as resp:
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if line:
                        try:
                            data = json.loads(line)
                            token = data.get("message", {}).get("content", "")
                            if token:
                                yield token
                            if data.get("done"):
                                break
                        except json.JSONDecodeError:
                            continue
        except Exception as e:
            yield f"\n[Error: {e}]"


class MalwareAnalyzer:
    """High-level malware analysis using LLM."""

    def __init__(self, client: Optional[OllamaClient] = None):
        self.client = client or OllamaClient()

    def _build_messages(self, user_content: str) -> List[Dict]:
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

    def analyze_behavior(
        self,
        api_sequence: List[str],
        prediction: float,
        top_tokens: List[tuple],
        behavior_map: Dict,
        sample_hash: str = "unknown",
    ) -> str:
        """
        Generate a comprehensive behavioral analysis report.
        """
        api_preview = ", ".join(api_sequence[:30]) + ("..." if len(api_sequence) > 30 else "")
        top_toks_str = ", ".join([f"{t}({s:.3f})" for t, s in top_tokens[:10]])
        behavior_str = json.dumps({k: [t for t, _ in v[:3]] for k, v in behavior_map.items()}, indent=2)

        prompt = f"""Analyze this malware behavioral report:

**Sample Hash:** {sample_hash}
**Malware Probability Score:** {prediction:.1%}
**Verdict:** {"MALICIOUS" if prediction > 0.5 else "BENIGN"}

**Observed API Calls (first 30):**
{api_preview}

**Top Important Tokens (by attention weight):**
{top_toks_str}

**Detected Behavior Categories:**
{behavior_str}

Please provide:
1. **Executive Summary** (2-3 sentences)
2. **Behavior Analysis** — what specific malicious actions are occurring
3. **MITRE ATT&CK Mapping** — list techniques with IDs (e.g., T1055 Process Injection)
4. **Threat Classification** — best-fit malware family and confidence
5. **Risk Level** — Critical/High/Medium/Low with justification
6. **Key Indicators of Compromise (IOCs)**

Format with clear headings."""

        messages = self._build_messages(prompt)
        return self.client.chat(messages, temperature=0.2, max_tokens=2000)

    def explain_tokens(
        self,
        top_tokens: List[tuple],
        maliciousness_score: float,
    ) -> str:
        """Explain why specific tokens are flagged as important."""
        tokens_str = "\n".join([f"- {t}: importance={s:.4f}" for t, s in top_tokens[:15]])

        prompt = f"""The Nebula transformer model flagged these tokens as most important for its malware prediction (maliciousness score: {maliciousness_score:.2%}):

{tokens_str}

For each token, explain:
1. What Windows API, behavior, or system artifact it refers to
2. Why it's suspicious or benign
3. Which malware families commonly use it

Keep each explanation concise (1-2 sentences). Focus on the most suspicious ones."""

        return self.client.chat(self._build_messages(prompt), temperature=0.1, max_tokens=1000)

    def generate_threat_report(
        self,
        sample_hash: str,
        verdict: str,
        confidence: float,
        behaviors: List[str],
        analysis: str,
    ) -> str:
        """Generate a formal threat intelligence report."""
        prompt = f"""Generate a formal threat intelligence report for:

**File Hash:** {sample_hash}
**Verdict:** {verdict}
**Confidence:** {confidence:.1%}
**Detected Behaviors:** {', '.join(behaviors)}

**Analysis Summary:**
{analysis[:500]}

Format as a professional TI report with:
- Threat Summary
- Technical Details
- Attack Chain
- Recommended Actions
- Detection Rules (YARA-like pseudocode for the behaviors)"""

        return self.client.chat(self._build_messages(prompt), temperature=0.2, max_tokens=2000)

    def answer_question(self, question: str, context: str = "") -> str:
        """Answer a free-form question about malware analysis."""
        ctx_str = f"\n\nContext:\n{context}" if context else ""
        prompt = f"{question}{ctx_str}"
        return self.client.chat(self._build_messages(prompt), temperature=0.4, max_tokens=1000)

    def compare_models(self, nebula_results: Dict, baseline_results: Dict) -> str:
        """Generate comparison analysis between Nebula and baseline models."""
        prompt = f"""Compare these malware detection results:

**Nebula Enhanced (our improved model):**
- AUC: {nebula_results.get('auc', 'N/A')}
- F1: {nebula_results.get('f1', 'N/A')}
- TPR@FPR=1e-3: {nebula_results.get('tpr_at_fpr1e3', 'N/A')}
- Parameters: {nebula_results.get('params', 'N/A')}

**Baseline (original Nebula paper):**
- AUC: {baseline_results.get('auc', 'N/A')}
- F1: {baseline_results.get('f1', 'N/A')}
- TPR@FPR=1e-3: {baseline_results.get('tpr_at_fpr1e3', 'N/A')}

Explain:
1. What the metrics mean in practical security terms
2. Why the improvements matter for real-world deployment
3. Trade-offs between the models
4. Recommendations for production use"""

        return self.client.chat(self._build_messages(prompt), temperature=0.3, max_tokens=800)
