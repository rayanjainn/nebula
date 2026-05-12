# Evaluation Metrics — What the Numbers Actually Mean

## Why We Need Multiple Metrics

Accuracy alone is misleading. If 85% of our samples are malware and the model simply said "malicious" for everything, it would achieve 85% accuracy — while completely failing to distinguish malware from benign software.

Each metric measures a different aspect of performance. Together, they give a complete picture.

---

## The Confusion Matrix — The Foundation of Everything

Before any metric, we need the **confusion matrix**. It shows the four possible outcomes of a binary prediction:

```
                    ┌──────────────────────┬──────────────────────┐
                    │  Model says BENIGN   │  Model says MALICIOUS│
┌───────────────────┼──────────────────────┼──────────────────────┤
│ Actually BENIGN   │  True Negative (TN)  │  False Positive (FP) │
│                   │  ✓ Correctly cleared │  ✗ False alarm        │
├───────────────────┼──────────────────────┼──────────────────────┤
│ Actually MALICIOUS│  False Negative (FN) │  True Positive (TP)  │
│                   │  ✗ Missed threat!    │  ✓ Correctly detected│
└───────────────────┴──────────────────────┴──────────────────────┘
```

**Our results** (validation set, threshold = 0.5):
```
              Predicted BENIGN    Predicted MALICIOUS
Actually BENIGN    1,410                80
Actually MALICIOUS    66             1,625
```

- **TN = 1,410**: 1,410 benign files correctly cleared. No wasted analyst time.
- **FP = 80**: 80 benign files falsely accused. Unnecessary investigations.
- **FN = 66**: 66 malware samples missed. These are the dangerous ones — they get through.
- **TP = 1,625**: 1,625 malware samples correctly detected and flagged.

---

## Accuracy

**Formula**: (TP + TN) / Total  
**Our result**: (1,625 + 1,410) / 3,181 = **95.41%**

The percentage of all samples that were correctly classified.

**Limitation**: does not distinguish between different types of errors. Missing malware (FN=66) and falsely flagging benign (FP=80) are both counted as wrong, but they have very different real-world consequences.

---

## Precision

**Formula**: TP / (TP + FP)  
**Our result**: 1,625 / (1,625 + 80) = **95.31%**

"Of all the files the model flagged as malicious, what percentage actually were malicious?"

**In plain English**: When our system sounds the alarm, it is right 95.3% of the time. An analyst who investigates every alert will encounter a false alarm about 4.7% of the time.

High precision → few false alarms → analysts trust the system.

---

## Recall (Sensitivity / True Positive Rate)

**Formula**: TP / (TP + FN)  
**Our result**: 1,625 / (1,625 + 66) = **96.10%**

"Of all the actual malware in the dataset, what percentage did the model catch?"

**In plain English**: The model detects 96.1% of all malware that passes through it. Only ~4% slips through.

High recall → fewer missed threats → better protection.

---

## F1 Score

**Formula**: 2 × (Precision × Recall) / (Precision + Recall)  
**Our result**: 2 × (0.9531 × 0.9610) / (0.9531 + 0.9610) = **0.9570**

The F1 score is the **harmonic mean** of precision and recall. It balances both concerns into a single number. A high F1 requires *both* high precision (few false alarms) and high recall (few missed threats).

If you make precision perfect by being very conservative, recall drops. If you make recall perfect by flagging everything, precision drops. F1 finds the balance point.

**F1 = 0.967** is excellent — both precision and recall are high.

---

## AUC-ROC

**AUC-ROC** = Area Under the Receiver Operating Characteristic Curve  
**Our result**: **0.9892**

This requires understanding the ROC curve first.

### The ROC Curve

Our model does not just say "malicious/benign" — it outputs a **probability** (e.g. 0.97 = very likely malicious, 0.12 = probably benign). By choosing different **thresholds**, we change the trade-off between catches and false alarms:

- **Threshold = 0.9**: Only flag files the model is very sure about → few false alarms, but miss many real threats
- **Threshold = 0.1**: Flag anything even slightly suspicious → catch almost everything, but many false alarms
- **Threshold = 0.5**: The default middle ground

The ROC curve plots **True Positive Rate** (recall) on the Y-axis vs **False Positive Rate** (FP/N) on the X-axis for every possible threshold:

```
TPR  1.0 │ ●───────────────────  ← Perfect classifier
     0.9 │         /
     0.8 │        /  ← Our model (AUC=0.987)
     0.7 │       /
     0.6 │      /
     0.5 │     /
     0.4 │    /
     0.3 │   /  ← Random guessing (AUC=0.5)
     0.2 │  /
     0.1 │ /
     0.0 └─────────────────────
         0.0  0.2  0.4  0.6  0.8  1.0  FPR
```

**AUC** = the area under this curve. Ranges from 0.5 (random guessing) to 1.0 (perfect). Our AUC of 0.9892 means: if you randomly pick one malware sample and one benign sample, the model ranks the malware higher 98.92% of the time.

AUC-ROC is threshold-independent — it measures discrimination ability regardless of where you set the cutoff.

---

## Average Precision (AP)

**Our result**: **0.9914**

Similar to AUC-ROC, but uses the **Precision-Recall curve** instead. The PR curve plots Precision on the Y-axis vs Recall on the X-axis. A perfect classifier hugs the top-right corner (high precision at high recall). AP = 0.9914 is very close to perfect.

---

## TPR @ FPR=10⁻³ — The Enterprise Deployability Metric

**Our result**: **0.4252 (42.52%)**  
**Paper baseline**: **0.5464 (54.64%)**

**This is the metric that determines real-world deployability at extreme precision.**

In a real enterprise with, say, 100,000 Windows computers:
- Each computer runs hundreds of processes daily
- A security system might analyze tens of thousands of files per day
- FPR of 1% would mean: 1% of benign files flagged → hundreds or thousands of false alarms per day
- No team of analysts can investigate thousands of alerts daily

**FPR = 10⁻³ (0.1%)** is the maximum acceptable: at most 1 in 1,000 benign files triggers an alert.

**TPR @ FPR=10⁻³ = 42.52%** means: at the threshold where only 0.1% of benign files are falsely flagged, the enhanced model detects 42.52% of malware. The paper baseline achieves 54.64% at this operating point — a trade-off where the baseline model's more conservative scoring works better at this extreme threshold, even though NebulaEnhanced wins on every aggregate metric (AUC, F1, accuracy, precision, recall).

This metric comes directly from the Nebula paper and reflects what the security industry cares about for fully automated, zero-analyst pipelines.

---

## Summary: Our Results vs What They Mean

| Metric | NebulaEnhanced | Paper Baseline | What It Means in Plain English |
|---|---|---|---|
| Accuracy | 95.41% | 93.78% | 95.4 out of 100 files classified correctly |
| Precision | 95.31% | 94.46% | When we ring the alarm, we are right 95.3% of the time |
| Recall | 96.10% | 93.79% | We catch 96 out of every 100 malware samples |
| F1 Score | 0.9570 | 0.9412 | Strong balance between precision and recall |
| AUC-ROC | 0.9892 | 0.9860 | We rank malware above benign 98.9% of the time |
| Avg Precision | 0.9914 | 0.9886 | Near-perfect precision-recall trade-off |
| TPR @ FPR=1e-3 | 42.52% | 54.64% | At extreme enterprise threshold, baseline has an edge |
| Confusion matrix (Enhanced) | TN=1410 FP=80 FN=66 TP=1625 | — | 80 false alarms, 66 missed threats out of 3,181 samples |

---

## Why Not 100%?

The 66 missed malware samples (false negatives) represent the model's hardest cases:
- Very short execution traces with few API calls (not enough behavioral signal)
- Heavily obfuscated samples that load their malicious behavior late
- Very rare malware families the model has seen few examples of
- Samples whose heuristic labels in our dataset may actually be incorrect

The 80 false positives are likely legitimate programs that use unusual APIs (e.g. security tools that use low-level memory APIs for legitimate purposes, or software with unusual but benign network patterns).

---

## Glossary

| Term | Plain English |
|---|---|
| True Positive (TP) | Malware that was correctly detected |
| True Negative (TN) | Benign file correctly cleared |
| False Positive (FP) | Benign file falsely accused (false alarm) |
| False Negative (FN) | Malware that slipped through (missed threat) |
| Accuracy | Percentage of all samples correctly classified |
| Precision | Of files flagged as malicious, percentage that actually are |
| Recall | Of all actual malware, percentage the model caught |
| F1 Score | Harmonic mean of precision and recall |
| AUC-ROC | Area under the ROC curve; 0.5=random, 1.0=perfect |
| ROC curve | Graph of detection rate vs false alarm rate at all thresholds |
| Average Precision | Area under the Precision-Recall curve |
| Threshold | The probability cutoff above which a file is called malicious |
| FPR | False Positive Rate = FP / (FP + TN) = fraction of benign files falsely flagged |
| TPR @ FPR=1e-3 | Recall achieved when only 0.1% of benign files are falsely flagged |
| Imbalanced dataset | When one class has many more samples than the other |
