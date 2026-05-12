# Training the Model — How the Neural Network Learns

## What Is Training?

A neural network starts with random numbers for all its weights — it knows nothing. Training is the process of showing it thousands of examples, checking how wrong its predictions are, and nudging the weights in the direction that makes the predictions better.

After enough examples, the weights encode patterns that generalize to new, unseen data.

---

## The Training Loop

Every training run follows this cycle:

```
1. Pick a batch of samples (32 at a time)
2. Forward pass: run the batch through the network → get predictions
3. Compute the loss: how wrong are these predictions?
4. Backward pass: calculate how much each weight contributed to the error
5. Update weights: move each weight slightly to reduce the error
6. Repeat for all batches
7. Validate: check performance on held-out data
8. Repeat for 10 epochs
```

---

## Batch Training — Why Not One Sample at a Time?

We process **32 samples at once** (a "batch") rather than one at a time. Reasons:

- **Faster**: modern GPUs are designed for parallel matrix operations — 32 samples at once is nearly as fast as 1
- **Stable gradients**: averaging the error over 32 samples gives a more reliable update signal than one noisy sample
- **Better generalization**: batch diversity helps the model learn broader patterns

---

## The Loss Function — Measuring How Wrong We Are

The **loss function** quantifies how wrong the model's predictions are. We use **Binary Cross-Entropy (BCE) Loss**:

For a single sample with true label y (0 or 1) and predicted probability p:
```
BCE loss = -(y × log(p) + (1-y) × log(1-p))
```

**Intuition**: if the true label is 1 (malicious) and the model predicts p=0.99, the loss is very small (good prediction). If the model predicts p=0.01, the loss is very large (terrible prediction). Training minimizes this loss.

### Label Smoothing

We use a refinement called **label smoothing** (ε=0.05). Instead of training toward probability 0 or 1 exactly, we train toward 0.95 or 0.05:

```
Without smoothing:  malicious → target 1.0, benign → target 0.0
With smoothing:     malicious → target 0.95, benign → target 0.05
```

**Why?** Hard targets of 0 and 1 push the model to be infinitely confident, which causes overconfidence and poor calibration. Smoothed targets encourage the model to be appropriately uncertain, which improves both accuracy and the quality of probability scores.

---

## The Optimizer — AdamW

The **optimizer** is the algorithm that updates the weights. We use **AdamW**.

### How Adam Works

"Adam" stands for Adaptive Moment estimation. It is a smarter version of basic gradient descent:

1. **Gradient descent** (basic): move all weights by the same small step in the direction that reduces loss
2. **Adam**: track the *history* of gradients for each weight separately. Weights that have had consistently large gradients get smaller steps (they are already learning fast). Weights with small gradients get larger steps (need more nudging).

This makes training faster and more stable.

### The "W" in AdamW — Weight Decay

Normal Adam has a subtle bug: the adaptive learning rates can effectively disable weight decay (a regularization technique that prevents weights from growing too large). **AdamW** fixes this by applying weight decay separately from the gradient update.

Weight decay = 0.01 in this project. Think of it as a gentle pressure that pushes all weights toward zero. This prevents any single weight from becoming so large that it "memorizes" a specific example.

### Gradient Clipping

Sometimes a batch produces an unusually large gradient — a spike that would push the weights too far in one direction. **Gradient clipping** (norm = 1.0) caps the gradient magnitude before the update. If the gradient vector has a norm (total magnitude) above 1.0, it is scaled down proportionally. This prevents training from going off-the-rails on difficult batches.

---

## The Learning Rate — How Big Are the Steps?

The **learning rate** controls how much the weights change on each update. Too high → weights jump around and never converge. Too low → training takes forever.

We use **lr = 0.00025** (2.5 × 10⁻⁴).

### Cosine Learning Rate Schedule with Warmup

Instead of a constant learning rate, we use a schedule:

```
Step 0-200 (warmup):     lr rises linearly from 0 to 0.00025
Step 200+  (cosine):     lr decreases following a cosine curve
                         → starts at 0.00025, smoothly approaches 0
```

**Why warmup?** At the start of training, the weights are random. Taking large steps from random weights can permanently damage the initial learning trajectory. Starting with a small learning rate and gradually increasing it prevents this.

**Why cosine decay?** Near the end of training, the model is close to a good solution. Large learning rate steps would overshoot it. The cosine schedule makes progressively smaller steps as training progresses, allowing fine-grained refinement.

---

## Epochs — How Many Times Do We Train?

One **epoch** = one complete pass through all 12,721 training samples.

We train until validation AUC plateaus; the best checkpoint was reached at **epoch 27**.

After each epoch, we evaluate on the validation set (3,181 samples the model has never seen). We track:
- Validation AUC (main metric for checkpoint saving)
- Validation F1
- Validation accuracy
- Validation TPR @ FPR=10⁻³

The **best checkpoint** (epoch with highest validation AUC) is saved to disk. If training overfits (performance on training set keeps improving but validation set gets worse), we stop early and load the best checkpoint.

---

## Overfitting vs Underfitting

```
                    Training Accuracy
                         │
        Underfitting      │       Overfitting
        ─────────────     │     ─────────────────
        Model too simple  │  Model memorizes training
        Can't learn the   │  data; performs poorly on
        underlying pattern│  new data
                          │
                          │  Sweet spot: good
                          │  generalization
```

**Signs of overfitting**: training loss keeps dropping but validation loss starts rising.

**How we prevent it**:
- Dropout (0.3) — randomly disables neurons during training
- Weight decay (0.01) — pushes weights toward zero
- Label smoothing (0.05) — prevents overconfidence
- Early stopping — save best checkpoint and stop if no improvement
- Controlled model size — 7.2M parameters for 12,721 training samples

---

## Training Hardware

The model automatically selects the best available device: **CUDA GPU** → **Apple M1/M2 MPS** → CPU.

Training times for the full run (best checkpoint at epoch 27):

| Model | Device | Training Time |
|---|---|---|
| NebulaEnhanced | CUDA | ~14.7 minutes |
| NebulaPaper baseline | CUDA | ~21.8 minutes |

---

## What Gets Saved

After training:

| File | Contents |
|---|---|
| `models/checkpoints/nebula_run_best.pt` | NebulaEnhanced weights at best validation epoch |
| `models/checkpoints/nebula_paper_best.pt` | NebulaPaper baseline weights at best validation epoch |
| `data/training_results.json` | All metrics, curves, and comparison data |

The checkpoint file (`.pt`) is a PyTorch file containing:
- The model's state dictionary (all weight tensors)
- The epoch number
- The validation AUC at that epoch

---

## Training Results

| Metric | NebulaEnhanced | Paper Baseline |
|---|---|---|
| AUC-ROC | **0.9892** | 0.9860 |
| F1 Score | **0.9570** | 0.9412 |
| Accuracy | **95.41%** | 93.78% |
| Precision | **0.9531** | 0.9446 |
| Recall | **0.9610** | 0.9379 |
| Average Precision | **0.9914** | 0.9886 |
| TPR @ FPR=10⁻³ | 0.4252 | **0.5464** |
| Best epoch | 27 | — |
| Training time (CUDA) | ~14.7 min | ~21.8 min |
| Parameters | **7.22M** | 7.02M |

See [07_evaluation_metrics.md](07_evaluation_metrics.md) for a complete explanation of every metric.

---

## Glossary

| Term | Plain English |
|---|---|
| Training | The process of adjusting weights to make better predictions |
| Batch | A group of samples processed together (32 in this project) |
| Epoch | One complete pass through the training data |
| Loss function | A number measuring how wrong the model's predictions are |
| Binary cross-entropy | The specific loss function used for yes/no classification |
| Label smoothing | Softening hard 0/1 targets to 0.05/0.95 to prevent overconfidence |
| Optimizer | The algorithm that updates the model's weights |
| AdamW | Adam optimizer with fixed weight decay |
| Weight decay | A penalty that keeps weights small, preventing memorization |
| Gradient clipping | Capping gradient magnitude to prevent unstable weight updates |
| Learning rate | How large each weight update step is |
| Warmup | Gradually increasing the learning rate at the start of training |
| Cosine schedule | Learning rate that decreases following a cosine curve |
| Overfitting | Model memorizes training data but fails on new data |
| Checkpoint | A saved snapshot of the model's weights at a specific point |
| MPS | Apple's GPU acceleration (Metal Performance Shaders) |
| Validation set | Held-out data used only for evaluation, never for training |
