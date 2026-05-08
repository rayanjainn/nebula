#!/usr/bin/env python3
"""
scripts/merge_dataset.py

Merge the downloaded QuoVadis-Speakeasy JSON files into the existing
merged_dataset.jsonl format used by the Nebula training pipeline.

Each downloaded file is a Speakeasy emulation report (one entry-point per file
or a dict with an "entry_points" list).  We flatten them to the same per-EP
row schema already used in merged_dataset.jsonl.

Usage:
    python scripts/merge_dataset.py \
        --input  data/full \
        --output data/merged_dataset.jsonl \
        [--dry-run]
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

# ── helpers ─────────────────────────────────────────────────────────────────

def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

# Map directory/category names → label + family
CATEGORY_MAP = {
    "clean":            (0, "benign"),
    "windows_syswow64": (0, "benign"),
    "ransomware":       (1, "ransomware"),
    "rat":              (1, "rat"),
    "backdoor":         (1, "backdoor"),
    "trojan":           (1, "trojan"),
    "keylogger":        (1, "keylogger"),
    "coinminer":        (1, "coinminer"),
    "dropper":          (1, "dropper"),
}

def infer_label_family(json_path: Path):
    """Walk up directory names to find a known category.
    Strips 'report_' prefix so 'report_ransomware' matches 'ransomware'.
    """
    for part in reversed(json_path.parts):
        part_l = part.lower().removeprefix("report_")
        if part_l in CATEGORY_MAP:
            return CATEGORY_MAP[part_l]
    return None, "unknown"

def iter_entry_points(data: dict | list, sha256: str, label: int, family: str, source: str):
    """Yield one flat row per entry-point in the Speakeasy report."""
    if isinstance(data, list):
        eps = data
    elif "entry_points" in data:
        eps = data["entry_points"]
    else:
        eps = [data]

    for ep in eps:
        if not isinstance(ep, dict):
            continue
        yield {
            "ep_type":               ep.get("ep_type", ""),
            "start_addr":            ep.get("start_addr", ""),
            "ep_args":               ep.get("ep_args", []),
            "apihash":               ep.get("apihash", ""),
            "apis":                  ep.get("apis") or [],
            "ret_val":               ep.get("ret_val"),
            "error":                 ep.get("error"),
            "network_events":        ep.get("network_events"),
            "dynamic_code_segments": ep.get("dynamic_code_segments"),
            "file_access":           ep.get("file_access"),
            "sha256":                sha256,
            "label":                 label,
            "family":                family,
            "source":                source,
        }

# ── main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Merge downloaded Speakeasy JSONs into merged_dataset.jsonl")
    ap.add_argument("--input",   default="data/full",                 help="Directory containing downloaded files")
    ap.add_argument("--output",  default="data/merged_dataset.jsonl", help="Output JSONL file to append to")
    ap.add_argument("--dry-run", action="store_true",                  help="Count files without writing")
    args = ap.parse_args()

    input_dir  = Path(args.input)
    output_path = Path(args.output)

    if not input_dir.exists():
        print(f"ERROR: input directory {input_dir} does not exist — run download_full_dataset.sh first", file=sys.stderr)
        sys.exit(1)

    # ── load existing SHA-256 set to skip duplicates ──────────────────────
    existing_hashes: set[str] = set()
    if output_path.exists():
        print(f"Loading existing hashes from {output_path} …", flush=True)
        with open(output_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                    h = r.get("sha256") or r.get("apihash") or ""
                    if h:
                        existing_hashes.add(h)
                except Exception:
                    pass
        print(f"  {len(existing_hashes):,} existing hashes loaded", flush=True)

    # ── walk input directory ──────────────────────────────────────────────
    json_files = sorted(input_dir.rglob("*.json"))
    # Skip config/metadata files
    json_files = [p for p in json_files if p.name not in ("speakeasy-config.json", "speakeasy_config.json")]

    total_files   = len(json_files)
    written_rows  = 0
    skipped_dup   = 0
    skipped_error = 0

    print(f"Found {total_files:,} JSON files in {input_dir}", flush=True)
    if args.dry_run:
        print("DRY RUN — no files will be written", flush=True)

    out_f = None if args.dry_run else open(output_path, "a")

    try:
        for i, json_path in enumerate(json_files, 1):
            # Progress log every 500 files
            if i % 500 == 0 or i == total_files:
                pct = i / total_files * 100
                print(f"  [{i:>6}/{total_files}  {pct:5.1f}%]  written={written_rows:,}  skipped_dup={skipped_dup:,}  errors={skipped_error}", flush=True)

            label, family = infer_label_family(json_path)
            if label is None:
                # Try to read label from the JSON itself
                pass

            try:
                with open(json_path) as f:
                    data = json.load(f)
            except Exception as e:
                skipped_error += 1
                continue

            # Prefer sha256 from content, fall back to file hash
            if isinstance(data, dict):
                sha256 = data.get("sha256") or ""
            else:
                sha256 = ""
            if not sha256:
                sha256 = file_sha256(json_path)

            # Label from data if not inferred from directory
            if label is None:
                lv = data.get("label") if isinstance(data, dict) else None
                label  = int(lv) if lv is not None else -1
                family = data.get("family", "unknown") if isinstance(data, dict) else "unknown"

            if sha256 in existing_hashes:
                skipped_dup += 1
                continue

            existing_hashes.add(sha256)
            source = str(json_path.relative_to(input_dir))

            for row in iter_entry_points(data, sha256, label, family, source):
                if not args.dry_run:
                    out_f.write(json.dumps(row) + "\n")  # type: ignore[union-attr]
                written_rows += 1

    finally:
        if out_f:
            out_f.close()

    print()
    print("=" * 50)
    print(f"Done.")
    print(f"  Files processed : {total_files - skipped_error:,} / {total_files:,}")
    print(f"  Rows written    : {written_rows:,}")
    print(f"  Duplicates skip : {skipped_dup:,}")
    print(f"  Parse errors    : {skipped_error:,}")
    if not args.dry_run:
        print(f"  Output file     : {output_path}  ({output_path.stat().st_size / 1e6:.1f} MB)")
    print("=" * 50)
    if not args.dry_run:
        print(f"\nNext step: retrain the model")
        print(f"  Go to the Training page in the dashboard and click Start Training")

if __name__ == "__main__":
    main()
