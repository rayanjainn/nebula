# Documentation Index

Complete guide to the Dynamic Malware Analysis Platform — written for someone with no prior knowledge of cybersecurity, machine learning, or Windows internals.

---

## Read These in Order

| # | Document | What It Covers |
|---|---|---|
| [01](01_what_is_malware.md) | **What Is Malware?** | Types of malware (ransomware, trojans, RATs, backdoors), why signatures fail, key terms |
| [02](02_dynamic_analysis.md) | **Dynamic Analysis & Windows Emulation** | What the Windows API is, why it matters for detection, what Speakeasy does, SHA-256 hashes explained |
| [03](03_data_and_preprocessing.md) | **The Data** | Where our 15,902 samples come from, what each field means, how raw JSON becomes model input |
| [04](04_tokenization_and_bpe.md) | **Tokenization & BPE** | How text becomes numbers, what Byte-Pair Encoding is, why 50,000 vocab and 512 length |
| [05](05_transformer_architecture.md) | **The Neural Network Architecture** | What a Transformer is, how attention works, chunked attention, CLS token, the full model diagram |
| [06](06_training.md) | **Training the Model** | How the model learns, loss functions, AdamW optimizer, learning rate schedule, results |
| [07](07_evaluation_metrics.md) | **Evaluation Metrics** | Every metric explained from scratch: accuracy, precision, recall, F1, AUC-ROC, TPR@FPR=1e-3 |
| [08](08_xai_and_llm.md) | **Explainable AI & LLM Analysis** | How attention weights explain predictions, MITRE ATT&CK framework, how gemma3:27b generates threat reports |
| [09](09_future_and_usage.md) | **Future Use & Deployment** | How the system gets used in real enterprises, current limitations, roadmap |

---

## Quick Reference Glossaries

Every document ends with a glossary. Key terms across the entire project:

| Term | See Doc |
|---|---|
| Malware, ransomware, trojan, RAT, backdoor | [01](01_what_is_malware.md) |
| Dynamic analysis, Speakeasy, SHA-256, Windows API, entry point | [02](02_dynamic_analysis.md) |
| Dataset, label, training set, validation set, preprocessing, normalization | [03](03_data_and_preprocessing.md) |
| BPE, tokenizer, vocabulary, embedding, positional encoding | [04](04_tokenization_and_bpe.md) |
| Transformer, attention, CLS token, feed-forward, dropout, parameters | [05](05_transformer_architecture.md) |
| Training, loss, optimizer, AdamW, learning rate, epoch, overfitting, checkpoint | [06](06_training.md) |
| Accuracy, precision, recall, F1, AUC-ROC, confusion matrix, false positive | [07](07_evaluation_metrics.md) |
| XAI, MITRE ATT&CK, LLM, gemma3, IOC, threat intelligence | [08](08_xai_and_llm.md) |
| SOC, SIEM, EDR, endpoint, YARA rule | [09](09_future_and_usage.md) |

---

## The System in One Paragraph

This platform takes a suspicious Windows program, runs it inside a safe simulation (Speakeasy), records every Windows API call it makes, converts those calls into a sequence of tokens (via BPE tokenization), and feeds that sequence into a custom Transformer neural network. The network was trained on 15,902 labeled examples (~53% malware) to predict whether a program is malicious. It achieves AUC=0.9892, F1=0.957, and detects 96% of malware at threshold=0.5. When a file is flagged, the platform explains *which specific API calls* drove the decision (XAI), maps them to the MITRE ATT&CK framework, and optionally queries the gemma3:27b language model to generate a plain-English threat intelligence report.
