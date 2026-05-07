# The Neural Network Architecture — How the Model Thinks

## What Is a Neural Network?

A neural network is a mathematical system loosely inspired by how the brain works. It consists of many simple computational units (neurons) arranged in layers. Each neuron receives some numbers as input, multiplies them by learned weights, and passes the result to the next layer.

The "learning" part: during training, the network repeatedly sees examples and adjusts its weights to make better predictions. After enough examples, the weights encode patterns learned from the data.

For our malware detector:
- **Input**: a sequence of 512 numbers (the tokenized behavior trace)
- **Output**: a single number between 0 and 1 (probability that the sample is malware)

---

## Why a Transformer?

Transformers are the architecture behind ChatGPT, BERT, and virtually every modern AI language model. They were introduced in the 2017 paper *Attention Is All You Need* (Vaswani et al.). For sequence analysis, they have two key advantages:

### Advantage 1: Parallel Processing
Older sequence models (RNNs) processed tokens one by one — token 1, then token 2, then token 3... This was slow. Transformers process all 512 tokens simultaneously, making them much faster to train.

### Advantage 2: Attention — Seeing the Whole Sequence at Once
The key innovation in Transformers is **self-attention**. Each token can "look at" every other token in the sequence and decide how much to focus on each one.

**Why this matters for malware**: Malicious behavior is often spread across the sequence. A `VirtualAlloc` call at position 5 only becomes alarming when combined with `WriteProcessMemory` at position 47 and `CreateRemoteThread` at position 83. Standard models might miss this connection. The attention mechanism can directly link these three calls regardless of how far apart they are.

---

## Self-Attention Explained Simply

Imagine you are reading a report and you encounter the word "it" in the sentence "The ransomware encrypted the file, then deleted it." To understand what "it" refers to, you look back at the rest of the sentence and realize "it" refers to "the file."

Self-attention works the same way — for every token in the sequence, it computes how relevant every other token is. Tokens that are highly relevant to each other get strong attention; irrelevant ones get near-zero attention.

Mathematically, each token gets turned into three vectors:
- **Query (Q)**: "What am I looking for?"
- **Key (K)**: "What do I represent?"
- **Value (V)**: "What information do I carry?"

The attention weight between token i and token j is computed as: how much does i's query match j's key? Tokens with matching queries and keys attend strongly to each other.

---

## The Quadratic Problem (and Our Solution)

Standard self-attention has one big problem: it computes attention between **every pair of tokens**. With 512 tokens, that is 512 × 512 = 262,144 pairs. If you doubled the sequence to 1,024 tokens, it would be 1,048,576 pairs — 4× more work for 2× more tokens. This is called **O(N²) complexity**.

For sequences of thousands of API calls, standard attention becomes impractical.

### Chunked (Windowed) Self-Attention

The solution used in this project (from the Nebula paper, Trizna 2023) is to split the 512-token sequence into smaller non-overlapping windows and only compute attention within each window:

```
Sequence (512 tokens):
[────────────────────────────────────────────────]

Split into 8 chunks of 64 tokens each:
[chunk 1][chunk 2][chunk 3][chunk 4][chunk 5][chunk 6][chunk 7][chunk 8]
 64 tok   64 tok   64 tok   64 tok   64 tok   64 tok   64 tok   64 tok
```

Attention is computed fully within each chunk. This changes complexity from O(512²) = 262,144 pairs to O(8 × 64²) = 32,768 pairs — **8× more efficient**.

The trade-off: tokens in different chunks cannot directly attend to each other. To compensate, a **global attention layer** is added at the top (see below).

---

## Multi-Head Attention

Instead of one attention computation, we run **8 parallel attention computations** (heads), each looking at the sequence differently:

- Head 1 might specialize in recognizing process injection patterns
- Head 2 might focus on file system activity
- Head 3 might detect network behavior
- Head 4 might recognize registry persistence
- etc.

The outputs of all 8 heads are concatenated and merged. This gives the model much richer representational power than a single attention computation.

---

## The CLS Token — The Model's Summary

When you summarize a long document, you don't use every sentence equally — you identify the key points. The **CLS token** (Classification token, borrowed from BERT) serves this purpose.

Before processing begins, a special learnable token is prepended to the sequence:
```
[CLS] [token1] [token2] ... [token512]
```

Throughout all the attention layers, the CLS token can attend to every other token and collect information. By the end of processing, the CLS token's output vector represents a summary of the entire sequence — distilled specifically for the classification task.

Only the CLS token's final vector is passed to the classifier. This is superior to simply averaging all 512 token outputs (mean pooling) because the CLS token actively learns what to pay attention to.

---

## The Feed-Forward Layer

After each attention layer, each token passes through a **feed-forward network** — two linear transformations with a GELU activation in between:

```
FFN(x) = GELU(x × W₁ + b₁) × W₂ + b₂
```

- **Linear transformation**: matrix multiplication — mixes information
- **GELU**: a smooth "gate" that lets some signals through and blocks others (the smooth version of ReLU)
- **Second linear**: transforms back to the original dimension

This layer processes each token position independently, adding non-linearity and depth.

---

## Layer Normalization

After each sub-layer (attention and feed-forward), **layer normalization** is applied. This rescales the activations to have mean ≈ 0 and variance ≈ 1.

This project uses **Pre-LayerNorm** (normalize before the sub-layer, rather than after). Pre-LN is more stable during training — it prevents the gradients from exploding or vanishing, especially in early training.

---

## The Complete Architecture

```
512-token input sequence
         │
         ▼
┌─────────────────────────┐
│  Token Embedding        │  512 tokens × 64 dimensions
│  (50,000-word vocab)    │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  Prepend CLS token      │  513 tokens × 64 dimensions
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  Positional Encoding    │  Adds position info to each token
└─────────┬───────────────┘
          │  Split: [CLS] vs [tokens 1-512]
          │
          ▼ (tokens 1-512 only)
┌─────────────────────────┐
│  Chunked Attention ×1   │  8 chunks of 64 tokens
│  (8 heads, 64-dim)      │  32,768 attention pairs
│  + Feed-Forward         │
│  + LayerNorm            │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  Chunked Attention ×2   │  Second layer of chunked attention
│  + Feed-Forward         │
│  + LayerNorm            │
└─────────┬───────────────┘
          │  Recombine with CLS
          ▼
┌─────────────────────────┐
│  Global Attention       │  Full attention: CLS sees all 513 tokens
│  (CLS + all tokens)     │  CLS collects cross-chunk summary
│  + Feed-Forward         │
│  + LayerNorm            │
└─────────┬───────────────┘
          │  Take only CLS output
          ▼
┌─────────────────────────┐
│  Layer Normalization    │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  Classifier Head        │
│  Linear(64 → 64)        │
│  LayerNorm              │
│  GELU activation        │
│  Dropout(0.3)           │
│  Linear(64 → 1)         │
└─────────┬───────────────┘
          │
          ▼
     Single number
     (logit, unconstrained)
          │
          ▼
     Sigmoid function
     → Probability [0, 1]
          │
     ┌────┴────┐
  ≥ 0.5      < 0.5
MALICIOUS    BENIGN
```

---

## Dropout — Preventing Over-Memorization

**Dropout** is a training technique: during each training step, 30% of neurons are randomly switched off. This forces the network to learn robust features that work even when some neurons are missing — it cannot just memorize specific examples.

During inference (when you actually analyze a sample), dropout is turned off and all neurons are active. This is why the `model.eval()` call is important in the code.

---

## Model Size

| Component | Parameters |
|---|---|
| Token embedding (50,000 × 64) | 3,200,000 |
| CLS token | 64 |
| 2× Chunked attention layers | ~133,000 |
| Global attention layer | ~66,000 |
| Classifier head | ~8,000 |
| **Total** | **~3,400,000** |

3.4 million parameters might sound large, but modern language models have billions. Our model is deliberately small — it needs to run quickly on a server that might process hundreds of files per minute.

---

## Glossary

| Term | Plain English |
|---|---|
| Neural network | A mathematical system that learns patterns from examples |
| Transformer | A type of neural network that processes all tokens in parallel using attention |
| Self-attention | Mechanism that lets each token look at all other tokens to understand context |
| Query / Key / Value | The three vectors computed per token during attention |
| O(N²) complexity | When work grows with the square of input size |
| Chunked attention | Splitting the sequence into windows to reduce computation |
| Multi-head attention | Running several attention computations in parallel |
| CLS token | A special summary token prepended to the sequence |
| Feed-forward network | A pair of linear transformations with an activation function |
| GELU | A smooth activation function (better than ReLU) |
| Layer normalization | Rescaling activations to stabilize training |
| Pre-LayerNorm | Normalizing before (rather than after) each sub-layer |
| Dropout | Randomly disabling neurons during training to prevent memorization |
| Parameters | The learned numbers (weights) inside the model |
| Sigmoid | A function that squashes any number to the range [0, 1] |
| Logit | The raw output before sigmoid — can be any number |
| Embedding | A 64-dimensional vector representation of a token |
