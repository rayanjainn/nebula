# Dynamic Malware Analysis with Transformer Neural Networks

**A full-stack platform for detecting and explaining malicious Windows software using deep learning, explainable AI, and large language models.**

---

## Table of Contents

1. [The Problem: Why Malware Analysis Is Hard](#1-the-problem-why-malware-analysis-is-hard)
2. [Our Approach: Dynamic Analysis via Windows Emulation](#2-our-approach-dynamic-analysis-via-windows-emulation)
3. [From Behavior Traces to Text: Preprocessing](#3-from-behavior-traces-to-text-preprocessing)
4. [Tokenization: Giving the Model a Vocabulary](#4-tokenization-giving-the-model-a-vocabulary)
5. [The Neural Architecture: Chunked Transformer](#5-the-neural-architecture-chunked-transformer)
6. [Improvements Over Prior Work](#6-improvements-over-prior-work)
7. [Training Methodology](#7-training-methodology)
8. [Explainable AI: What Did the Model See?](#8-explainable-ai-what-did-the-model-see)
9. [LLM Threat Intelligence Integration](#9-llm-threat-intelligence-integration)
10. [Results](#10-results)
11. [System Architecture](#11-system-architecture)
12. [Running the Platform](#12-running-the-platform)
13. [References](#13-references)

---

## 1. The Problem: Why Malware Analysis Is Hard

Every day, security analysts encounter hundreds of thousands of new files — executables, DLLs, scripts — many of which may be malware. Traditional antivirus relies on *signatures*: known byte patterns that match previously catalogued threats. This approach fails completely against:

- **Polymorphic malware**: code that mutates with each infection, changing its byte pattern while keeping its behavior
- **Packed/obfuscated malware**: legitimate-looking code at rest that unpacks malicious payloads at runtime
- **Zero-day threats**: brand-new malware with no prior signature in any database

The security community has increasingly turned to *behavioral* analysis: instead of looking at what a program looks like in storage, we ask *what does it do when it runs*? A ransomware sample that encrypts files behaves like ransomware regardless of how it is packed. A keylogger that hooks keyboard input behaves like a keylogger regardless of its byte-level obfuscation.

The challenge is automating this analysis at scale. Manual reverse engineering of one sample takes hours. Modern malware families produce millions of variants.

---

## 2. Our Approach: Dynamic Analysis via Windows Emulation

### 2.1 What Is Dynamic Analysis?

Dynamic analysis means actually executing the suspicious software and observing what it does. It differs from *static analysis* (reading the binary without running it) in that it captures runtime behavior: which Windows API functions are called, which files are opened or modified, which network connections are made, which registry keys are touched.

The canonical dynamic analysis approach uses a sandboxed virtual machine. The malware runs inside a controlled environment, its actions are logged, and the sandbox reports a detailed trace of everything it did.

### 2.2 Windows API Calls as the Language of Malware

Windows programs interact with the operating system through the Windows API — a set of functions provided by `kernel32.dll`, `ntdll.dll`, `advapi32.dll`, and hundreds of other system libraries. When a program wants to create a file, it calls `CreateFileW`. When it wants to connect to a server, it calls `WSAConnect`. When it encrypts data, it calls functions like `CryptEncrypt` or (in modern ransomware) `BCryptEncrypt`.

This gives us a rich, expressive vocabulary. A ransomware sample's execution trace might look like:

```
CreateFileW → ReadFile → CryptEncrypt → WriteFile → DeleteFileW
```

repeated thousands of times across a victim's documents. A banking trojan might show:

```
OpenProcess → VirtualAllocEx → WriteProcessMemory → CreateRemoteThread
```

— the hallmarks of process injection. These *behavioral patterns* are far more stable identifiers of malicious intent than byte patterns.

### 2.3 Speakeasy: Windows Emulation Without a Full VM

Running actual malware is dangerous and slow. Full sandboxes require virtual machines, are easily detected by sophisticated malware (which then lies dormant), and are expensive to scale.

This platform uses **Speakeasy**, an open-source Windows emulation framework developed at Mandiant/FireEye. Rather than executing malware on real hardware, Speakeasy simulates the Windows execution environment in software. It provides stub implementations of Windows API functions, emulates the CPU instruction set, and hooks all API calls to produce a detailed execution trace — all without ever running actual malicious code.

The output of Speakeasy analysis is a JSON report structured around *entry points*: the places where execution begins (e.g., `DllMain`, `WinMain`, specific export functions). Each entry point record contains:

```json
{
  "ep_type": "module_entry",
  "apis": [
    { "api_name": "CreateFileW", "args": ["C:\\Users\\victim\\document.docx", ...], "ret_val": 1234 },
    { "api_name": "ReadFile", "args": [1234, 4096], "ret_val": 1 },
    ...
  ],
  "file_access": [
    { "event": "create", "path": "C:\\Users\\victim\\document.docx.locked" }
  ],
  "network_events": {
    "traffic": [{ "server": "185.220.101.45", "port": 443 }],
    "dns": [{ "query": "malicious-c2.example.com" }]
  }
}
```

The dataset used for this project is drawn from a curated collection of Speakeasy reports of both malicious samples (trojans, ransomware, RATs, backdoors) and benign Windows programs.

---

## 3. From Behavior Traces to Text: Preprocessing

Raw Speakeasy reports are nested JSON objects. Before a neural network can process them, we need to flatten them into a linear sequence of tokens. The preprocessing pipeline (`pipeline/preprocessor.py`) implements the transformation function **ψ(z) → z'** described in Trizna (2023).

### 3.1 Field Extraction

The preprocessor extracts three categories of behavioral signals:

**API calls**: The name of each Windows API function called, plus its arguments and return value. The function name itself is the most informative signal (`VirtualAlloc` suggests memory shellcode loading; `RegSetValueEx` suggests persistence). Arguments provide additional context (e.g., which registry key, which file path).

**File access events**: The type of file operation (create, read, write, delete) and the path. File paths are highly informative — writing to `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\` indicates an attempt to survive reboots.

**Network events**: DNS queries and TCP/UDP connections. Connecting to hard-coded IP addresses on unusual ports, or querying algorithmically-generated domain names (domain generation algorithm, DGA), are strong malware indicators.

### 3.2 Normalization

Raw field values contain too much noise. IP addresses, file paths, and cryptographic hashes vary from sample to sample even within the same malware family. Without normalization, the model would treat `185.220.101.45` and `45.33.32.156` as entirely different signals when both indicate a C2 connection.

The pipeline applies four normalizations:

| Pattern | Before | After |
|---|---|---|
| MD5/SHA1/SHA256 hashes | `a1b2c3d4e5f6...` (32+ hex chars) | `<hash>` |
| IPv4 addresses | `185.220.101.45` | `<ip>` |
| Windows file paths | `C:\Users\JohnSmith\Documents\` | `<drive>\users\<user>\documents\` |
| Domain names | `update.microsoft.com` | `<domain>` |

Windows environment variables (`%APPDATA%`, `%TEMP%`, `%SYSTEMROOT%`) are also expanded to canonical paths before normalization, so different representations of the same location collapse to one token.

### 3.3 Text Serialization

After extraction and normalization, all tokens are joined into a single space-separated string:

```
createfilew <drive>\users\<user>\appdata\roaming\... readfile virtualalloc 
writeprocessmemory createremotethread wsaconnect <ip> 443 ...
```

This text string is what gets fed into the tokenizer.

---

## 4. Tokenization: Giving the Model a Vocabulary

Natural language models operate on *tokens* — subword units that balance vocabulary coverage against sequence length. We use the same approach here: **Byte-Pair Encoding (BPE)** with a vocabulary of 50,000 tokens, trained on Windows API call sequences.

### 4.1 Why BPE?

A simple word-level tokenizer would assign one token per API name. The problem is that API names like `NtCreateThreadEx`, `ZwAllocateVirtualMemory`, and `RtlAllocateHeap` share meaningful prefixes and suffixes. BPE learns these subword units automatically. After training, the vocabulary might include `Nt`, `Create`, `Thread`, `Ex` as separate pieces, allowing the model to generalize across related API families it has never seen in combination.

With a 50,000-token vocabulary and sequences of length 512 tokens, we can represent approximately 200–400 API calls plus their arguments in a single context window.

### 4.2 Implementation

The BPE model is a SentencePiece model trained on the full behavioral sequence corpus. The tokenizer maps text to a fixed-length integer array of shape `(512,)`, padding shorter sequences with zeros and truncating longer ones.

---

## 5. The Neural Architecture: Chunked Transformer

The core model is a Transformer encoder with a crucial modification for efficiency: **chunked (windowed) self-attention**, following the design in Trizna (2023).

### 5.1 Why Transformers?

Transformers, introduced in *Attention Is All You Need* (Vaswani et al., 2017), have become the dominant architecture for sequence modeling. Their key innovation is the *self-attention mechanism*: every token in the sequence can directly attend to every other token, learning long-range dependencies without the vanishing gradient problems that plague RNNs.

For malware detection, long-range dependencies matter. A `VirtualAlloc` call at position 5 becomes significant when followed by `WriteProcessMemory` at position 47 and `CreateRemoteThread` at position 83 — the classic process injection sequence spread across the trace.

### 5.2 The Quadratic Complexity Problem

Standard self-attention has **O(N²) time and memory complexity** in the sequence length N. For N=512, this is manageable — 512² = 262,144 attention pairs. But as sequences grow longer (more API calls, more arguments), this quickly becomes prohibitive.

### 5.3 Chunked Self-Attention

The solution is **chunked (windowed) self-attention**. The sequence of length N is divided into M independent non-overlapping spans of size S:

```
N = M × S      (e.g., 512 = 8 × 64)
```

Full attention is computed within each span independently. This reduces complexity from **O(N²)** to **O(M·S²)**. With N=512, S=64, M=8:

- Standard attention: 512² = **262,144** operations
- Chunked attention: 8 × 64² = **32,768** operations — **8× reduction**

The trade-off is that tokens in different spans cannot directly attend to each other. A subsequent **global attention layer** partially recovers cross-span context (see Section 6.3).

Mathematically, for each span i containing tokens x_{i·S} through x_{(i+1)·S - 1}:

```
Attention(Q, K, V) = softmax(QKᵀ / √d_k) · V
```

where Q, K, V are the query, key, value projections of that span's tokens. The 8 spans are processed in parallel (batch dimension), then concatenated back into the full sequence.

### 5.4 Multi-Head Attention

Each attention layer uses **8 attention heads**, each operating in a subspace of dimension d_model/n_heads = 128/8 = 16. Different heads learn to attend to different types of relationships: one head might specialize in detecting injection patterns, another in recognizing network activity.

### 5.5 Feed-Forward Sublayer

After each attention sublayer, a position-wise feed-forward network applies:

```
FFN(x) = GELU(x·W₁ + b₁)·W₂ + b₂
```

with inner dimension d_hidden = 512 (4× the model dimension d_model = 128). GELU (Gaussian Error Linear Unit) is a smooth, differentiable approximation of ReLU that tends to train faster and reach better optima.

### 5.6 Complete Forward Pass

```
Input token IDs (batch_size, 512)
    │
    ▼
Token Embedding  (50k vocab → 128-dim)  + scale by √128
    │
    ▼
Prepend CLS token  →  (batch_size, 513, 128)
    │
    ▼
Positional Encoding  (sinusoidal, added in-place)
    │
    ▼
Split:  [CLS] | [tokens 1..512]
         │             │
         │      ┌──────┴──────┐
         │      │ Chunked SA  │  × 3 layers
         │      │  (8 spans)  │
         │      └──────┬──────┘
         │             │
         └─────┬────── ┘
               │  concat → (batch_size, 513, 128)
               ▼
         Global Attention Layer
               │
               ▼
         CLS output → (batch_size, 128)
               │
               ▼
         LayerNorm
               │
               ▼
         Classifier Head:  Linear(128→64) → LayerNorm → GELU → Dropout(0.1) → Linear(64→1)
               │
               ▼
         Logit → sigmoid → Probability [0, 1]
```

### 5.7 Model Size

| Component | Parameters |
|---|---|
| Token embedding (50k × 128) | 6,400,000 |
| CLS token | 128 |
| Positional encoding | 0 (fixed sinusoidal) |
| 3× Chunked attention layers | ~591k |
| Global attention layer | ~197k |
| Classifier head | ~8k |
| **Total** | **~7.2M** |

---

## 6. Improvements Over Prior Work

This implementation extends the chunked-attention Transformer architecture (Trizna 2023) with eight targeted improvements.

### 6.1 CLS Token Pooling

**Prior approach**: Mean pooling — average all output token representations to get a fixed-size summary vector.

**Improvement**: BERT-style CLS token. A learned `[CLS]` token is prepended to every sequence. After all attention layers, only this token's final representation is used for classification. Because every other token can attend to (and be attended to by) the CLS token, it aggregates a summary of the entire sequence that is optimized end-to-end for the classification objective — rather than just averaging.

### 6.2 Pre-LayerNorm (norm_first=True)

**Prior approach**: Post-LayerNorm — normalize after the residual connection.

**Improvement**: Pre-LayerNorm — normalize before the self-attention and FFN sublayers. This stabilizes gradient flow during training, especially in early epochs, and allows the use of higher learning rates. Xiong et al. (2020) show Pre-LN converges more reliably across a range of tasks.

### 6.3 Global Attention Layer

**Prior approach**: Chunked attention layers only — no cross-span communication.

**Improvement**: After all chunked attention layers, a full (non-chunked) attention layer processes the CLS token concatenated with all span outputs. This gives the model a chance to synthesize information across chunk boundaries. At N=512, this full-attention layer operates on 513 tokens — still computationally feasible — while the expensive chunked layers handle the bulk of processing.

### 6.4 Label Smoothing

**Prior approach**: Hard binary cross-entropy — a "malicious" label contributes `log(p)`, and a "benign" label contributes `log(1-p)`.

**Improvement**: Label smoothing with ε=0.05. Instead of training toward probability exactly 0 or 1, the model trains toward 0.95 and 0.05. This prevents overconfidence, encourages better-calibrated probabilities, and improves generalization on borderline samples (Müller et al., 2019).

### 6.5 Cosine Learning Rate Schedule with Warmup

**Prior approach**: Constant learning rate.

**Improvement**: 200-step linear warmup followed by cosine annealing to near-zero. The warmup prevents large gradient updates when weight matrices are randomly initialized; cosine annealing makes fine-grained progress toward the end of training.

### 6.6 AdamW Optimizer with Gradient Clipping

**Prior approach**: Adam optimizer, no gradient clipping specified.

**Improvement**: AdamW (Adam with decoupled weight decay = 0.01, Loshchilov & Hutter 2019) + gradient norm clipping at 1.0. Weight decay prevents overfitting without interfering with the adaptive learning rates. Gradient clipping prevents exploding gradients on difficult batches.

### 6.7 Learnable Positional Encodings (Optional)

**Prior approach**: Fixed sinusoidal positional encodings.

**Improvement**: Option to use learned positional embeddings (`nn.Embedding(max_len, d_model)`), initialized from N(0, 0.02). For behavioral sequences where the absolute position of an API call matters less than relative co-occurrence patterns, learned embeddings can adapt.

### 6.8 GELU Activations

**Prior approach**: ReLU.

**Improvement**: GELU throughout the classifier head. GELU is smoother and differentiable everywhere, producing more stable gradients particularly in deep classifiers.

---

## 7. Training Methodology

### 7.1 Dataset

The dataset comprises **15,902 Windows executable behavior traces** from Speakeasy emulation, sourced from:

| Source | Count | Description |
|---|---|---|
| HuggingFace `dtrizna/speakeasy_trainset` | ~15,793 | Malware and benign samples curated for research |
| Speakeasy example reports | ~109 | Real malware reports from the Speakeasy repository |
| **Total** | **15,902** | |

Label distribution:

| Label | Count | % |
|---|---|---|
| Malicious | ~8,460 | 53.2% |
| Benign | ~7,442 | 46.8% |

The dataset is substantially larger and more balanced than prior versions, with roughly equal representation of malicious and benign samples.

### 7.2 Train/Validation Split

80% / 20% stratified split (stratified = same malicious/benign ratio in both splits):

- **Train**: 12,721 samples (6,762 malicious, ~5,959 benign)
- **Validation**: 3,181 samples (1,691 malicious, ~1,490 benign)

### 7.3 Loss Function

Binary cross-entropy with logits + label smoothing ε=0.05:

```python
BCEWithLogitsLoss  # with smoothed targets: y' = y * (1 - ε) + ε/2
```

Because the dataset is imbalanced (~85% malicious), we monitor recall carefully — missing real malware is more costly than a false alarm.

### 7.4 Training Hyperparameters

| Hyperparameter | Value |
|---|---|
| Optimizer | AdamW |
| Learning rate | 2.5×10⁻⁴ |
| Weight decay | 0.01 |
| β₁, β₂ | 0.9, 0.999 |
| Batch size | 32 |
| Gradient clip | 1.0 (global norm) |
| Warmup steps | 200 |
| LR schedule | Cosine annealing |
| Epochs | 27 (best checkpoint) |
| Label smoothing | ε = 0.05 |

Each epoch: forward pass on all training batches, compute smoothed BCE loss, backpropagate, clip gradients, step optimizer, update LR schedule. Validation AUC is computed after every epoch; the best checkpoint (epoch 27) is saved.

### 7.5 Hardware

Training runs on CUDA GPU, Apple M1 (MPS), or CPU (auto-selected). On CUDA, NebulaEnhanced trains in approximately **14.7 minutes** for 27 epochs; the paper baseline in approximately **21.8 minutes**.

---

## 8. Explainable AI: What Did the Model See?

A classifier that outputs "malicious: 97.3%" is useful for triage, but a security analyst needs to understand *why* the model reached that conclusion. The platform provides three levels of explanation.

### 8.1 Attention-Based Token Importance

Transformers compute attention weights: for each output position, how much did it attend to each input position? These weights (averaged across all heads of the global attention layer) tell us which tokens in the input sequence most influenced the CLS token's representation.

Tokens with high attention from the CLS position were "important" to the model's decision. We extract these weights, map them back to the original token strings, and rank by importance:

```python
model.get_attention_weights(x)  # returns per-head attention weights
# → attention from CLS to each sequence token
# → sort descending → top-K important tokens
```

High-importance tokens like `virtualalloc`, `writeprocessmemory`, `createremotethread` immediately tell an analyst "this looks like process injection."

### 8.2 MITRE ATT&CK Behavior Mapping

The top important tokens are categorized against the MITRE ATT&CK framework — the industry-standard taxonomy of adversary tactics and techniques. Each API call or network pattern maps to one or more ATT&CK categories:

| API Calls | ATT&CK Category |
|---|---|
| `VirtualAlloc`, `VirtualProtect` | Defense Evasion / Memory |
| `WriteProcessMemory`, `CreateRemoteThread` | Process Injection |
| `RegSetValueEx`, `RegCreateKeyEx` | Persistence / Registry |
| `CreateFileW`, `DeleteFile` | File Access |
| `WSAConnect`, `send`, `recv` | C2 Communication |
| `CryptEncrypt`, `BCryptEncrypt` | Data Encryption |
| `OpenProcess`, `GetModuleHandle` | Process Discovery |

The dashboard displays these as color-coded categories with the specific tokens contributing to each.

### 8.3 Maliciousness Score

A composite score is computed by weighting attention importance by category-level maliciousness:

```
maliciousness_score = Σ (attention_weight_i × category_weight_i)
```

where `category_weight` is 1.0 for injection/evasion/encryption, 0.7 for C2, 0.5 for file/registry, etc. This gives a 0–1 score that summarizes the XAI explanation as a single number.

---

## 9. LLM Threat Intelligence Integration

Once a file is classified and explained, the platform can query a large language model for contextual threat intelligence. The system sends:

1. The model's verdict and probability
2. The top behavioral tokens (from XAI)
3. The MITRE ATT&CK categories activated
4. The first ~500 characters of the raw preprocessed text

The LLM is prompted to produce:

- A narrative description of the malware's likely behavior and purpose
- The malware family it most closely resembles
- Indicators of Compromise (IoCs): specific APIs, paths, IPs, or domains to hunt for
- Recommended response actions

This combines the speed and consistency of the neural classifier with the contextual knowledge and communication ability of a large language model.

**Model used**: `gemma3:27b` (Google Gemma 3, 27 billion parameters)  
**Interface**: Ollama Cloud API (streaming and non-streaming)

---

## 10. Results

Both models were trained on the 12,721-sample training set and evaluated on the 3,181-sample held-out validation set.

### 10.1 Primary Results

| Metric | NebulaEnhanced | Baseline (prior approach) | Improvement |
|---|---|---|---|
| **AUC-ROC** | **0.9892** | 0.9860 | +0.0032 |
| **F1 Score** | **0.9570** | 0.9412 | +0.0158 |
| **Accuracy** | **95.41%** | 93.78% | +1.63pp |
| **Precision** | **0.9531** | 0.9446 | +0.0085 |
| **Recall** | **0.9610** | 0.9379 | +0.0231 |
| **Average Precision** | **0.9914** | 0.9886 | +0.0028 |
| **TPR @ FPR=10⁻³** | **0.4252** | 0.5464 | — |
| **Parameters** | **7.22M** | 7.02M | — |

### 10.2 Understanding Each Metric

**AUC-ROC** (Area Under the ROC Curve): Measures the model's ability to rank malicious samples above benign ones at *all* possible decision thresholds. AUC=0.9892 means that for a randomly chosen malicious/benign pair, the model assigns a higher score to the malicious sample 98.92% of the time. An AUC of 0.5 is random chance; 1.0 is perfect.

**F1 Score**: The harmonic mean of precision and recall. Balances the cost of missing real malware (false negatives) against the cost of false alarms (false positives). F1=0.957 is very high for a real-world security dataset.

**Precision** (0.9531): Of all files flagged as malicious, 95.31% were actually malicious. Very few false alarms — an analyst investigating detections would find genuine threats almost every time.

**Recall** (0.9610): Of all actual malware samples, 96.10% were correctly detected. Only ~4% of malware was missed at the default 0.5 threshold.

**Average Precision (AP)**: Area under the Precision-Recall curve. AP=0.9914 indicates near-perfect discrimination between classes across all operating thresholds.

**TPR @ FPR=10⁻³** (True Positive Rate at False Positive Rate = 0.1%): This is the key enterprise deployability metric. In a real Security Operations Center (SOC), analysts cannot investigate every alert. The 0.1% threshold (FPR=10⁻³) is the practical maximum for production deployment. At this operating point, the enhanced model detects **42.52%** of malware — the baseline performs better here at 54.64%, indicating a trade-off: NebulaEnhanced achieves higher overall AUC and F1 but the baseline maintains better precision at the extreme low-FPR operating point.

### 10.3 Confusion Matrix (NebulaEnhanced, threshold = 0.5)

```
                    Predicted Benign    Predicted Malicious
Actual Benign           1,410                  80
Actual Malicious           66               1,625
```

- **True Negatives (1,410)**: Benign files correctly cleared — no investigation triggered
- **False Positives (80)**: 80 benign files incorrectly flagged as malware
- **False Negatives (66)**: 66 malware samples missed — the most critical error type
- **True Positives (1,625)**: Malware correctly detected and flagged

Out of ~1,490 benign validation samples, 80 triggered false alarms (FPR ≈ 5.4% at threshold=0.5). Of 1,691 malicious samples, 66 were missed (FNR ≈ 3.9%).

### 10.4 Training Dynamics

The enhanced model's best checkpoint was at epoch 27, reaching AUC=0.9892. The cosine learning rate schedule produced smooth improvement in validation metrics. Both models trained on CUDA GPU — NebulaEnhanced completed in ~14.7 minutes, the paper baseline in ~21.8 minutes. The full per-epoch training curves (AUC, F1, loss) are visible in the platform's Metrics dashboard.

### 10.5 What This Means

At AUC=0.9892 and F1=0.957 on a 3,181-sample validation set (53% malicious, representing a near-balanced real-world scenario), this model demonstrates strong generalization. NebulaEnhanced outperforms the paper baseline on all aggregate metrics (AUC, F1, accuracy, precision, recall). The architectural improvements — CLS pooling, Pre-LN, global attention, label smoothing, and AdamW — collectively yield a more accurate and better-calibrated classifier.

The high recall (0.961) makes this particularly suitable for tier-1 automated triage: the model catches ~96% of threats while maintaining precision above 95%.

---

## 11. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js Frontend (port 3000)                │
│  Dashboard · Analyze · XAI · Dataset · Metrics · Training · LLM │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP (JSON + SSE)
┌──────────────────────────▼──────────────────────────────────────┐
│                      FastAPI Backend (port 8000)                  │
│                                                                   │
│  POST /predict          → model inference + XAI                  │
│  POST /predict/text     → raw text inference                     │
│  POST /predict/example  → predict on bundled examples            │
│  POST /explain          → detailed XAI breakdown                 │
│  POST /analyze/llm      → prediction + LLM threat report         │
│  GET  /results          → training metrics (JSON)                │
│  GET  /dataset/stats    → dataset statistics                     │
│  GET  /examples         → list bundled malware examples          │
│  GET  /model/info       → model architecture summary             │
└──────┬────────────────────────────────────┬─────────────────────┘
       │                                    │
┌──────▼──────────┐              ┌──────────▼────────────────────┐
│  NebulaEnhanced │              │  Ollama Cloud API             │
│  Transformer    │              │  gemma3:27b                   │
│  (~7.2M params) │              │  Threat intelligence          │
│                 │              │  streaming narrative          │
│  BPE Tokenizer  │              └───────────────────────────────┘
│  50k vocab      │
│  512 seq_len    │
└──────┬──────────┘
       │
┌──────▼──────────┐
│  XAI Engine     │
│  Attention map  │
│  MITRE ATT&CK   │
│  Behavior map   │
└─────────────────┘
```

### Component Responsibilities

**Frontend** (`frontend/`): Next.js 16 App Router, Tailwind CSS, Recharts. Six dashboard pages: file analysis with drag-and-drop, XAI visualization, interactive dataset explorer, comprehensive training metrics with ROC and PR curves, model information, and LLM chat interface.

**API** (`dashboard/api.py`): FastAPI with async endpoints. Handles report parsing, tokenization, model inference, XAI computation, LLM calls, and result streaming via Server-Sent Events.

**Model** (`models/nebula_enhanced.py`): NebulaEnhanced and NebulaPaper (baseline) PyTorch implementations. Checkpoints saved to `models/checkpoints/`.

**Preprocessor** (`pipeline/preprocessor.py`): SpeakeasyPreprocessor for normalizing and flattening behavior traces. Handles nested JSON, string vs dict entries, missing fields.

**Tokenizer** (`pipeline/tokenizer_utils.py`): BPE SentencePiece wrapper. Returns fixed-length integer sequences.

**Trainer** (`pipeline/trainer.py`): NebulaTrainer with AdamW, cosine schedule, gradient clipping, checkpoint saving, per-epoch metrics tracking.

**XAI** (`xai/explainer.py`): Attention weight extraction, integrated gradients (optional), MITRE ATT&CK mapping, maliciousness scoring.

---

## 12. Running the Platform

### Prerequisites

```bash
# Python 3.9+
pip install -r requirements.txt

# Node.js 18+
cd frontend && npm install
```

### One-Command Start

```bash
chmod +x start.sh && ./start.sh
```

This starts the FastAPI backend (port 8000) and Next.js frontend (port 3000) simultaneously.

### Training

```bash
python scripts/train_and_evaluate.py
```

Trains both NebulaEnhanced and NebulaPaper baseline, evaluates on the held-out validation set, saves all metrics to `data/training_results.json` and model checkpoints to `models/checkpoints/`.

### Manual API Start

```bash
cd dashboard
uvicorn api:app --host 0.0.0.0 --port 8000
```

### Manual Frontend Start

```bash
cd frontend
npm run dev       # development
npm run build && npm start   # production
```

### API Usage Example

```bash
# Analyze a Speakeasy report
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{"report": {"apis": [{"api_name": "VirtualAlloc", "args": [4096, 64], "ret_val": 1}], "file_access": [], "network_events": {}}, "use_xai": true}'

# Get training metrics
curl http://localhost:8000/results
```

### Directory Structure

```
nebula-enhanced/
├── config.py                  # Model + training hyperparameters
├── requirements.txt
├── start.sh
├── data/
│   ├── merged_dataset.jsonl   # 15,902 labeled behavior traces
│   └── training_results.json  # All evaluation metrics + curves
├── models/
│   ├── nebula_enhanced.py     # NebulaEnhanced + NebulaPaper
│   └── checkpoints/           # Trained weights (.pt)
├── pipeline/
│   ├── preprocessor.py        # Speakeasy report normalization
│   ├── tokenizer_utils.py     # BPE tokenizer wrapper
│   └── trainer.py             # Training loop, optimizer, schedule
├── xai/
│   └── explainer.py           # Attention extraction, MITRE mapping
├── llm/
│   └── ollama_client.py       # Ollama Cloud API client
├── dashboard/
│   └── api.py                 # FastAPI backend
├── scripts/
│   └── train_and_evaluate.py  # End-to-end training script
└── frontend/                  # Next.js dashboard
    ├── app/
    │   └── (dashboard)/
    │       ├── page.tsx        # Home / quick analysis
    │       ├── analyze/        # Full file analysis
    │       ├── xai/            # XAI visualization
    │       ├── dataset/        # Dataset explorer
    │       ├── metrics/        # Training metrics + ROC curves
    │       ├── model/          # Model architecture info
    │       └── llm/            # LLM chat
    ├── components/             # Shared UI components
    └── lib/api.ts              # Typed API client
```

---

## 13. References

1. **Trizna, D.** (2023). *Nebula: Self-Attention for Dynamic Malware Analysis*. IEEE Security & Privacy Workshops. arXiv:2309.xxxxx

2. **Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, Ł., & Polosukhin, I.** (2017). *Attention Is All You Need*. Advances in Neural Information Processing Systems, 30.

3. **Devlin, J., Chang, M. W., Lee, K., & Toutanova, K.** (2018). *BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding*. arXiv:1810.04805.

4. **Loshchilov, I., & Hutter, F.** (2019). *Decoupled Weight Decay Regularization*. International Conference on Learning Representations (ICLR).

5. **Xiong, R., Yang, Y., He, D., Zheng, K., Zheng, S., Xing, C., Zhang, H., Lan, Y., Wang, L., & Liu, T.** (2020). *On Layer Normalization in the Transformer Architecture*. International Conference on Machine Learning (ICML).

6. **Müller, R., Kornblith, S., & Hinton, G.** (2019). *When Does Label Smoothing Help?* Advances in Neural Information Processing Systems (NeurIPS).

7. **MITRE Corporation.** (2024). *MITRE ATT&CK: Adversarial Tactics, Techniques & Common Knowledge*. https://attack.mitre.org/

8. **Hendler, D., Kels, S., & Rubin, A.** (2018). *Detecting Malicious PowerShell Commands using Deep Neural Networks*. ACM Asia Conference on Computer and Communications Security.

9. **Raff, E., Barker, J., Sylvester, J., Brandon, R., Catanzaro, B., & Nicholas, C.** (2018). *Malware Detection by Eating a Whole EXE*. AAAI Workshop on Artificial Intelligence for Cyber Security.

10. **Google DeepMind.** (2024). *Gemma 3 Technical Report*. Google DeepMind.

11. **Srikant, S., & Payer, M.** (2021). *Generating Realistic and Diverse Tests for Malware Detectors*. IEEE Symposium on Security and Privacy.
