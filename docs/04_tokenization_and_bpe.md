# Tokenization & BPE — How Text Becomes Numbers

## Why Can't We Just Feed Text to the Neural Network?

Neural networks work with numbers — specifically with vectors of floating-point numbers (decimals). They cannot process the string `"VirtualAlloc"` directly. We need to convert every word in our preprocessed text into a number (or sequence of numbers).

The process of converting text into numbers is called **tokenization**. A **tokenizer** is the tool that does this.

---

## The Simplest Approach: Word Tokenization

The most obvious approach: assign a unique number to every word.

```
VirtualAlloc      →  1042
WriteProcessMemory →  3891
CreateRemoteThread →  2201
<ip>              →  5
<hash>            →  6
...
```

This works, but has problems:

**Problem 1 — Unknown words.** If the model was trained on `WriteProcessMemory` but sees `ZwWriteVirtualMemory` at inference time (a less common Windows API that does the same thing), it has no idea what to do with it. It has never seen that exact word.

**Problem 2 — No relationship between similar words.** The model would have no idea that `CreateFileA` and `CreateFileW` are related — they would just be two completely different numbers. (In reality, they are the ANSI and Unicode versions of the same function.)

**Problem 3 — Enormous vocabulary.** Windows has thousands of API functions. If every unique API name is one token, you need thousands of vocabulary entries.

---

## The Solution: Byte-Pair Encoding (BPE)

BPE is a smarter tokenization approach that works at the **subword** level — it breaks words into meaningful pieces.

### Where BPE Comes From

BPE was originally a data compression algorithm. In 2015, researchers at Edinburgh adapted it for natural language processing (NLP), and it became the standard tokenization method for large language models like GPT and BERT.

### How BPE Works (Step by Step)

BPE learns a vocabulary by starting with individual characters and repeatedly merging the most common pairs:

**Start**: treat every character as a separate token
```
V i r t u a l A l l o c  →  [V] [i] [r] [t] [u] [a] [l] [A] [l] [l] [o] [c]
```

**Iteration 1**: find the most common pair of adjacent tokens across the entire dataset. Say it's `A l` → merge into `Al`
```
V i r t u a l A l l o c  →  [V] [i] [r] [t] [u] [a] [l] [Al] [l] [o] [c]
```

**Iteration 2**: next most common pair is `l l` → merge into `ll`
```
[V] [i] [r] [t] [u] [a] [l] [Al] [ll] [o] [c]
```

**Continue** for 50,000 merge operations → you get 50,000 vocabulary entries (subword pieces).

After training on our Windows API sequence corpus, the BPE vocabulary might contain pieces like:
```
Create  →  1
File    →  2
W       →  3
Virtual →  4
Alloc   →  5
Process →  6
Memory  →  7
Remote  →  8
Thread  →  9
Reg     →  10
SetValue →  11
Ex      →  12
...
```

Now when it sees `CreateFileW`, it tokenizes as `[Create][File][W]` = `[1][2][3]`.  
When it sees `CreateFileA` (a variant it has never seen), it tokenizes as `[Create][File][A]` — the model already knows about `Create` and `File`, so it can reason about this new combination!

### Why This Matters for Windows APIs

Windows API names have a consistent internal structure:

| Pattern | Examples |
|---|---|
| `Create` prefix | `CreateFile`, `CreateProcess`, `CreateThread`, `CreateRemoteThread` |
| `Nt`/`Zw` prefix | `NtCreateFile`, `ZwAllocateVirtualMemory` — low-level NT API variants |
| `A`/`W` suffix | `CreateFileA` (ANSI) vs `CreateFileW` (Unicode) — same function, different character encoding |
| `Ex` suffix | `OpenProcessEx`, `VirtualAllocEx` — extended variants |

BPE learns these patterns automatically. The model learns that anything starting with `Create` involves creating something, and anything ending with `ProcessMemory` involves process memory operations.

---

## Our Tokenizer

**Model**: SentencePiece BPE  
**Vocabulary size**: 50,000 tokens  
**Sequence length**: 512 tokens  
**Training corpus**: Windows API call sequences from the Speakeasy dataset

### SentencePiece

SentencePiece is an open-source tokenization library from Google that implements BPE (and other algorithms). It was designed to work with raw text without requiring pre-tokenization (splitting on spaces first). This makes it ideal for our data, where API names, numbers, and placeholders like `<ip>` appear together.

The tokenizer file is: `nebula/nebula/objects/bpe_50000_sentencepiece.model` (a binary file containing the trained BPE vocabulary and merge rules).

---

## The Full Tokenization Pipeline

Here is what happens to a behavior trace, step by step:

```
Raw Speakeasy JSON report
         ↓
Preprocessing (see doc 03)
Extracts API names, normalizes IPs/hashes/paths
         ↓
Text string:
"createfilew c:\users\<user>\documents\photo.jpg 1073741824 1
 cryptencrypt 5678 4096 1
 deletefilew c:\users\<user>\documents\photo.jpg 1
 <ip> 443 <domain>"
         ↓
BPE Tokenizer
Splits into subword tokens
         ↓
Integer sequence:
[12, 447, 3, 891, 2203, 45, 6, 1, 8891, 3345, ...]
         ↓
Pad to exactly 512 tokens (add zeros at the end if shorter)
Truncate to 512 tokens if longer
         ↓
Final input to neural network:
[12, 447, 3, 891, 2203, 45, 6, 1, 8891, ..., 0, 0, 0]
(512 integers)
```

---

## Vocabulary Size: Why 50,000?

50,000 is a common choice for BPE vocabularies:

- **Too small** (e.g. 1,000): many common API names can't be represented; too many pieces per word → very long sequences
- **Too large** (e.g. 500,000): the model's embedding table becomes enormous; rare tokens get little training signal
- **50,000**: covers nearly all Windows API subword patterns while keeping the model size manageable

---

## Sequence Length: Why 512?

Each tokenized sample is fixed at exactly 512 tokens.

- Short samples (few API calls) → padded with zeros to reach 512
- Long samples (many API calls) → truncated after 512 tokens

**Why 512?** This is a balance:
- The original Nebula paper uses 512
- 512 tokens covers ~200-400 API calls and their arguments — enough to capture meaningful behavioral patterns
- Longer sequences would require more memory and computation (see [05_transformer_architecture.md](05_transformer_architecture.md) on why this matters)

---

## Positional Encoding — Telling the Model About Order

After tokenization, each of the 512 integers is converted to a 64-dimensional vector (the **embedding**). But a neural network that processes all 512 positions simultaneously would have no idea which API call came first and which came last.

**Positional encoding** adds position information to each token embedding:

- Token at position 0 (first API call) gets a unique position signal added
- Token at position 1 (second API call) gets a different signal
- Token at position 511 (last) gets yet another signal

We use **sinusoidal positional encoding** — a mathematical formula using sine and cosine waves at different frequencies, proposed in the original Transformer paper (Vaswani et al., 2017). The formula produces a unique, smooth encoding for every position without requiring any learned parameters.

---

## Glossary

| Term | Plain English |
|---|---|
| Tokenization | Converting text into numbers the model can process |
| Token | One unit in the vocabulary — could be a word, part of a word, or a character |
| BPE (Byte-Pair Encoding) | A method that breaks words into common subword pieces |
| Vocabulary | The complete list of all tokens the model knows |
| Subword | A piece of a word (e.g. `Create`, `File`, `W` are subwords of `CreateFileW`) |
| SentencePiece | Google's open-source tokenization library |
| Sequence length | How many tokens the model processes at once (512 in this project) |
| Padding | Adding zeros to short sequences to make them the right length |
| Truncation | Cutting off long sequences at the maximum length |
| Embedding | Converting a token number into a vector of 64 decimal numbers |
| Positional encoding | A signal added to each embedding to tell the model the token's position |
| Vector | A list of numbers (e.g. [0.3, -1.2, 0.8, ...]) |
