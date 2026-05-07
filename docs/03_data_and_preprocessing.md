# The Data — What We Have and How We Prepare It

## Where Does Our Data Come From?

This project uses **1,561 behavior traces** — records of Windows programs being run inside Speakeasy and having their actions logged. Each trace represents one program (or one entry point of a program).

### Source 1: HuggingFace Dataset (1,452 samples)
A public research dataset called `dtrizna/speakeasy_trainset` on HuggingFace, a platform where researchers share machine learning datasets. This dataset was created specifically for malware research and contains behavior traces from both malware and benign programs that were analyzed using Speakeasy.

### Source 2: Speakeasy Example Reports (109 samples)
The Speakeasy tool comes with example malware reports for testing and demonstration. These are real malware samples (ransomware, trojans, RATs) that Speakeasy's developers included as examples. We extracted these and added them to the dataset.

**Together these form: `data/merged_dataset.jsonl`** — 1,561 lines, one JSON object per line.

---

## What Does Each Sample Contain?

Each line of `merged_dataset.jsonl` is a JSON object. Here is what the fields mean:

| Field | What It Is | Example |
|---|---|---|
| `sha256` | Unique fingerprint of the file | `"a1b2c3d4..."` |
| `label` | Is it malware? 1=yes, 0=no | `1` |
| `family` | Type/name of malware | `"ransomware"`, `"trojan"`, `"benign"` |
| `ep_type` | How execution started | `"module_entry"`, `"dllmain"` |
| `apis` | List of Windows API calls made | `[{"api_name": "VirtualAlloc", ...}]` |
| `file_access` | Files the program opened/created/deleted | `[{"event": "create", "path": "..."}]` |
| `network_events` | Network connections and DNS queries | `{"traffic": [...], "dns": [...]}` |

---

## The Dataset Numbers

| Category | Count | Percentage |
|---|---|---|
| **Malicious samples** | 1,323 | 84.8% |
| Benign samples | 238 | 15.2% |
| **Total** | **1,561** | 100% |

**Malware families in the dataset:**

| Family | Count | What It Does |
|---|---|---|
| Trojan | 1,217 | General malware disguised as legitimate software |
| Ransomware | 102 | Encrypts your files and demands payment |
| Benign | 238 | Safe programs included for comparison |
| RAT | 3 | Remote access trojan — attacker controls your PC |
| Backdoor | 1 | Hidden entry point for attackers |

The dataset is **imbalanced** — mostly malware, less benign. This is realistic: in the real world, security researchers collect far more malware samples than benign ones. Our model accounts for this.

---

## Why 84.8% Malware?

This feels unbalanced because it is. But it reflects reality:
- Malware researchers actively hunt for and collect malicious samples
- Benign Windows programs are less interesting to collect for a research dataset
- The model learns to handle this imbalance through training techniques (label smoothing, careful metric selection)

The key metric we use — **TPR at FPR=0.1%** — specifically measures performance under realistic conditions where the cost of false alarms (falsely accusing benign software) is very high.

---

## How We Label the Data

Not all samples came with clear labels. For the HuggingFace dataset, many rows had labels already. For unlabeled ones, we applied **heuristics** (rules of thumb):

- If the `apihash` field (a hash of all API calls) is empty → likely benign (minimal behavior)
- If API call count is very low (< 5) → likely benign
- If there are network events (connections to external IPs) → likely malicious
- If the filename contains words like "ransomware", "rat", "backdoor" → malicious

These are not perfect labels — they are educated guesses. This is why model accuracy is not 100%: the labels themselves have some noise.

---

## Preprocessing: Turning JSON into Numbers

The neural network cannot understand JSON directly. It needs numbers. The preprocessing pipeline (`pipeline/preprocessor.py`) converts each raw report into a flat text string, which then gets converted to numbers by the tokenizer.

### Step 1: Extract Relevant Fields

From each Speakeasy report, we pull three things:

**API calls** — the most important signal. From:
```json
{"api_name": "WriteProcessMemory", "args": [1234, 4096], "ret_val": 1}
```
We extract: `writeprocessmemory 1234 4096 1`

**File access events** — from:
```json
{"event": "create", "path": "C:\\Users\\John\\document.docx.locked"}
```
We extract: `create c:\users\<user>\document.docx.locked`

**Network events** — from:
```json
{"traffic": [{"server": "185.220.101.45", "port": 443}]}
```
We extract: `<ip> 443`

### Step 2: Normalize (Remove Noise)

Raw data contains lots of variation that would confuse the model. Two ransomware samples might connect to *different* IP addresses, but that does not mean they are different. We normalize these away:

| What We Replace | With | Why |
|---|---|---|
| IP addresses like `185.220.101.45` | `<ip>` | IP varies; the *fact* of connecting is what matters |
| Hashes like `a1b2c3d4...` (32+ chars) | `<hash>` | Every hash is unique; shouldn't fool the model |
| User paths like `C:\Users\JohnSmith\` | `C:\users\<user>\` | Username varies; path structure matters |
| Domain names like `ransom.evil.ru` | `<domain>` | Specific domain varies; fact of DNS lookup matters |
| Windows env vars like `%APPDATA%` | `C:\users\<user>\appdata\roaming` | Expands to canonical form |

### Step 3: Flatten to Text

Everything is joined into a single space-separated string:

```
createfilew c:\users\<user>\documents\photo.jpg 1073741824 1073741824 1 
readfile 1234 4096 1 
cryptacquirecontextw 1 
cryptencrypt 5678 4096 1 
writefilew 9012 4096 1
deletefilew c:\users\<user>\documents\photo.jpg 1
<ip> 443
<domain>
```

This string is exactly what gets fed to the tokenizer.

---

## Train / Validation Split

We split the 1,561 samples into:

| Split | Samples | Malicious | Benign |
|---|---|---|---|
| **Training set** (80%) | 1,248 | 1,058 | 190 |
| **Validation set** (20%) | 313 | 265 | 48 |

**"Stratified" split** means the 85%/15% malicious/benign ratio is preserved in both splits. This prevents the model from accidentally being trained on mostly one type and tested on another.

The model **only sees the training set during training**. The validation set is held completely aside and used only to measure how well the model performs on data it has never seen before. This gives us honest accuracy numbers.

---

## Glossary

| Term | Plain English |
|---|---|
| Dataset | A collection of labeled examples used to train and test the model |
| Sample | One single example in the dataset (one behavior trace) |
| Label | The answer: 1 = malicious, 0 = benign |
| Family | The category/type of malware |
| Preprocessing | Cleaning and transforming raw data into a form the model can use |
| Normalization | Replacing specific values (IPs, hashes) with generic placeholders |
| Training set | The data the model learns from |
| Validation set | Held-out data used to test the model honestly |
| Stratified split | Split that preserves the same malicious/benign ratio in both halves |
| Heuristic | A rule of thumb for making decisions without complete information |
| Imbalanced dataset | A dataset where one class (malicious) has many more examples than the other |
| JSONL | A file format where each line is a separate JSON object |
