# Explainable AI & LLM Analysis — Why Did the Model Flag This File?

## The Problem With "Black Box" AI

Our model gives a verdict: "MALICIOUS — 97.3% probability." But for a security analyst, that is not enough. They need to know:

- *What behavior* triggered the detection?
- *Which specific API calls* are suspicious?
- *What kind of malware* is this likely to be?
- Is this a real threat or a false alarm I can dismiss?

A model that cannot explain itself is called a **black box**. Black boxes are dangerous in security — an analyst cannot validate the decision, cannot write detection rules, and cannot brief management on what the threat actually did.

This project addresses this with two layers of explanation: **XAI (Explainable AI)** and **LLM (Large Language Model) analysis**.

---

## Layer 1: XAI — Attention-Based Explanation

### What Is Explainable AI (XAI)?

XAI is the field of making AI decisions understandable to humans. For our Transformer model, we use **attention weights** as the explanation mechanism.

### Attention Weights Recap

Recall from [05_transformer_architecture.md](05_transformer_architecture.md): the Transformer computes attention weights — for each token in the sequence, how much did the CLS (summary) token pay attention to it when forming its final representation?

High attention weight = this token strongly influenced the model's verdict.

After analysis, we extract these weights, map them back to the original API call names, and rank by importance:

```
Top important tokens (example from a ransomware sample):

1. cryptencrypt          importance: 0.87  ██████████████████
2. virtualprotect        importance: 0.71  ██████████████
3. createfilew           importance: 0.65  █████████████
4. writeprocessmemory    importance: 0.58  ████████████
5. <ip>                  importance: 0.44  █████████
6. deletefilew           importance: 0.41  ████████
7. getprocaddress        importance: 0.38  ████████
8. loadlibrarya          importance: 0.29  ██████
```

This tells us: the model paid most attention to `CryptEncrypt` — file encryption. That is the core signal. The file is doing process injection (`WriteProcessMemory`), loading hidden libraries (`GetProcAddress`, `LoadLibraryA`), and connecting to an external IP. This is classic ransomware behavior.

### MITRE ATT&CK Behavior Mapping

The ATT&CK (Adversarial Tactics, Techniques & Common Knowledge) framework, maintained by MITRE Corporation, is the global standard taxonomy of how attackers behave. It organizes thousands of attacker techniques into categories like:

- **Initial Access**: How did they get in?
- **Execution**: How did they run code?
- **Persistence**: How do they survive a reboot?
- **Defense Evasion**: How do they hide?
- **Credential Access**: How do they steal passwords?
- **Lateral Movement**: How do they spread to other machines?
- **Exfiltration**: How do they steal data?
- **Impact**: What damage do they cause?

Our XAI module maps important tokens to ATT&CK categories:

| API Call / Token | ATT&CK Category | Technique |
|---|---|---|
| `VirtualAlloc`, `VirtualProtect` | Defense Evasion / Memory | T1055 Process Injection |
| `WriteProcessMemory`, `CreateRemoteThread` | Process Injection | T1055.002 |
| `RegSetValueEx`, `RegCreateKeyEx` | Persistence | T1547 Registry Run Keys |
| `CreateFileW`, `DeleteFile` | File System | T1565 Data Manipulation |
| `WSAConnect`, `send`, `recv` | Command & Control | T1071 App Layer Protocol |
| `CryptEncrypt`, `BCryptEncrypt` | Impact | T1486 Data Encrypted for Impact |
| `GetProcAddress`, `LoadLibraryA` | Defense Evasion | T1574 DLL Hijacking |
| `OpenProcess` | Process Discovery | T1057 |

The dashboard shows which ATT&CK categories were triggered, colored by severity.

### Maliciousness Score

In addition to the per-token importance, we compute a single **maliciousness score** (0-100%) that summarizes the XAI findings:

```
maliciousness_score = sum over all tokens of (attention_weight × behavior_severity)
```

Where `behavior_severity` is:
- 1.0 for process injection, code execution, encryption
- 0.8 for defense evasion, anti-analysis
- 0.7 for C2 communication
- 0.5 for file access, registry

A high maliciousness score means not just that the model predicted malware, but that the *specific behaviors* it attended to are genuinely dangerous.

---

## Layer 2: LLM Analysis — Human-Readable Threat Report

Even after seeing which tokens are important and which ATT&CK categories they map to, many users still want a plain-English explanation. This is where the **Large Language Model (LLM)** comes in.

### What Is a Large Language Model (LLM)?

An LLM is an AI system trained on vast amounts of text (books, websites, research papers, code) that can generate coherent, contextually appropriate text. Examples: ChatGPT (GPT-4), Claude, Gemini.

LLMs excel at:
- Explaining technical concepts in plain English
- Summarizing complex information
- Answering follow-up questions
- Generating structured reports from unstructured data

### Which LLM Does This Project Use?

**Model**: `gemma3:27b`  
**Provider**: Ollama Cloud  
**Size**: 27 billion parameters (Google Gemma 3 family)

Gemma 3 is Google's open-source LLM family. The 27-billion parameter version balances quality with practical inference costs.

### What We Send the LLM

When you click "Analyze with LLM", the system sends:
1. The model's verdict and probability (e.g. "MALICIOUS — 97.3%")
2. The top 10 most important tokens from XAI
3. The MITRE ATT&CK categories detected
4. A preview of the preprocessed text sequence
5. A prompt asking for a structured threat report

### What the LLM Produces

The LLM generates a structured threat intelligence report with:

- **Executive Summary**: 2-3 sentences anyone can understand
- **Behavior Analysis**: what specific malicious actions are occurring
- **MITRE ATT&CK Mapping**: specific techniques with IDs (e.g. T1055.002)
- **Threat Classification**: likely malware family and confidence
- **Risk Level**: Critical / High / Medium / Low with justification
- **Indicators of Compromise (IOCs)**: specific things to hunt for in your environment

**Example output** (for a ransomware sample):
> **Executive Summary**: This sample exhibits classic ransomware behavior, using Windows Cryptographic APIs to encrypt files and communicating with a remote command-and-control server, likely for key exchange and victim tracking.
>
> **Behavior Analysis**: The sample allocates executable memory (VirtualAlloc), reads target files, encrypts their content using CryptEncrypt with a key derived from the C2 server, writes the encrypted content back, and deletes the originals. It injects code into a legitimate process (WriteProcessMemory + CreateRemoteThread) to evade detection.
>
> **MITRE ATT&CK**: T1486 (Data Encrypted for Impact), T1055.002 (Process Injection via CreateRemoteThread), T1071.001 (C2 over HTTPS)
>
> **Classification**: Ransomware — High confidence (behavioral pattern matches families like LockBit, Ryuk)
>
> **Risk Level**: CRITICAL — Active file encryption detected
>
> **IOCs**: CryptEncrypt + DeleteFileW pattern, outbound HTTPS to non-CDN IP, use of VirtualAllocEx + WriteProcessMemory + CreateRemoteThread sequence

### Streaming

The LLM response is streamed in real-time — you see each word appear as the model generates it, rather than waiting for the full response. This is done via **Server-Sent Events (SSE)**, the same technology used by ChatGPT's typing effect.

### The Chat Interface

After getting the initial analysis, you can ask follow-up questions:
- "What is process injection and why is it dangerous?"
- "Which MITRE ATT&CK ID covers file encryption?"
- "Should I isolate this machine?"
- "What network traffic should I look for?"

The LLM answers in the context of the analysis it just performed.

---

## Why XAI + LLM Together?

| Alone | Problem |
|---|---|
| Model verdict only | "MALICIOUS" — but why? What behavior? |
| XAI only | Token names like `WriteProcessMemory` — still requires security expertise to interpret |
| LLM only (no model) | LLM hallucinates; no ground truth from model |

**XAI + LLM together**: the model gives a reliable, fast verdict. XAI identifies the specific evidence. The LLM translates that evidence into plain English for any audience.

---

## Glossary

| Term | Plain English |
|---|---|
| XAI (Explainable AI) | Making AI decisions understandable to humans |
| Attention weights | Numbers showing which parts of the input the model focused on |
| MITRE ATT&CK | The global standard catalog of how attackers operate |
| Tactic | A broad category of attacker behavior (e.g. "Persistence") |
| Technique | A specific method within a tactic (e.g. "Registry Run Keys") |
| IOC (Indicator of Compromise) | Specific evidence that an attack occurred or is in progress |
| LLM (Large Language Model) | AI that generates text — like ChatGPT, Gemini, or Claude |
| gemma3:27b | Google's 27-billion parameter open-source language model |
| Ollama | A platform for running LLMs via API |
| Streaming | Sending text word-by-word as it is generated (vs waiting for the full response) |
| SSE (Server-Sent Events) | Web technology for streaming data from server to browser |
| Threat intelligence | Information about threats that helps defenders protect systems |
| Risk level | Severity of a detected threat: Critical / High / Medium / Low |
| Black box | An AI that makes decisions without explaining them |
| Maliciousness score | A 0-100% score summarizing how dangerous the detected behaviors are |
