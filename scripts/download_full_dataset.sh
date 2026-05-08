#!/bin/bash
# scripts/download_full_dataset.sh
# Download the full QuoVadis-Speakeasy dataset (~5.5 GB, 93,533 JSON reports)

set -euo pipefail

DATA_DIR="./data/full"
LOG_FILE="./data/download.log"
REPO="dtrizna/quovadis-speakeasy"

mkdir -p "$DATA_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "=========================================="
log "QuoVadis-Speakeasy dataset download"
log "Target directory : $DATA_DIR"
log "HuggingFace repo : $REPO"
log "Estimated size   : ~5.5 GB (93,533 files)"
log "=========================================="

if command -v hf &> /dev/null; then
    log "Using hf (huggingface_hub CLI)"
    log "Starting download — progress shown below"
    echo ""
    hf download "$REPO" \
        --repo-type dataset \
        --local-dir "$DATA_DIR" \
        2>&1 | tee -a "$LOG_FILE"
    echo ""
    log "hf download finished"
elif command -v huggingface-cli &> /dev/null; then
    log "Using huggingface-cli (legacy)"
    log "Starting download — progress shown below"
    echo ""
    huggingface-cli download "$REPO" \
        --repo-type dataset \
        --local-dir "$DATA_DIR" \
        --local-dir-use-symlinks False \
        2>&1 | tee -a "$LOG_FILE"
    echo ""
    log "huggingface-cli finished"
else
    log "huggingface-cli not found — falling back to wget"
    log "Note: wget only downloads the single example file, not the full dataset."
    log "Install huggingface-cli for the full download:  pip install huggingface_hub"
    echo ""
    wget \
        --continue \
        --progress=bar:force \
        --show-progress \
        --verbose \
        --server-response \
        -P "$DATA_DIR" \
        "https://huggingface.co/datasets/${REPO}/resolve/main/speakeasy_train_full.jsonl" \
        2>&1 | tee -a "$LOG_FILE"
fi

echo ""
log "=========================================="
log "Download complete"
log "Files saved to : $DATA_DIR"
log "Log saved to   : $LOG_FILE"
log "Disk usage     : $(du -sh "$DATA_DIR" 2>/dev/null | cut -f1)"
log "File count     : $(find "$DATA_DIR" -type f | wc -l | tr -d ' ') files"
log "=========================================="
log ""
log "Next step: merge into JSONL and retrain"
log "  python scripts/merge_dataset.py --input $DATA_DIR --output data/merged_dataset.jsonl"
