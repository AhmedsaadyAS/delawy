#!/usr/bin/env python3
"""One-off backfill of product image URLs for the web Worker seed.

Fetches each tracked PDP once (strategy A, same Fetcher as the Spike) and
writes sku -> image_url into apps/web-worker/seed/sku-images.json, which
the seed uses as a fallback when no Spike record carries an image yet.

Writes ONLY the mapping file — never results.jsonl, so the Spike dataset
stays clean. Same low-volume rules as the Spike: one session, random
2-5 s delay between requests, stop after HTTP 429 twice in a row.
Products whose PDP fails keep no entry (the seed leaves image_url NULL
and the UI shows a placeholder until a later WARP run captures it).

Usage (from the repo mirror root):
    .venv/bin/python spike/backfill_images.py
    .venv/bin/python spike/backfill_images.py --only-sku N70148523V --no-sleep
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fetcher import Fetcher, fetch_product  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_csv(path: str) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skus", default=os.path.join(ROOT, "spike", "skus.csv"))
    ap.add_argument(
        "--removed",
        default=os.path.join(ROOT, "apps", "web-worker", "seed", "removed-skus.csv"),
    )
    ap.add_argument(
        "--out",
        default=os.path.join(ROOT, "apps", "web-worker", "seed", "sku-images.json"),
    )
    ap.add_argument("--only-sku", default="")
    ap.add_argument("--no-sleep", action="store_true")
    args = ap.parse_args()

    rows = load_csv(args.skus) + load_csv(args.removed)
    if args.only_sku:
        rows = [r for r in rows if r["sku"] == args.only_sku]

    images: dict[str, str] = {}
    failures: list[str] = []
    sources: dict[str, int] = {}
    consecutive_429 = 0
    with Fetcher() as fetcher:
        for row in rows:
            record, _html = fetch_product(
                fetcher,
                sku=row["sku"],
                url=row.get("url", ""),
                offer_code=row.get("offer_code", ""),
                strategy="A",
            )
            url = record.get("image_url")
            if url:
                images[row["sku"]] = url
                sources[record.get("parser_used") or "unknown"] = (
                    sources.get(record.get("parser_used") or "unknown", 0) + 1
                )
                print(f"{row['sku']}: image ok ({record['parser_used']})", flush=True)
            else:
                failures.append(row["sku"])
                print(
                    f"{row['sku']}: NO IMAGE http={record['http_status']} "
                    f"parse_ok={record['parse_ok']} err={record['error']}",
                    flush=True,
                )
            if record["http_status"] == 429:
                consecutive_429 += 1
            else:
                consecutive_429 = 0
            if consecutive_429 >= 2:
                print("STOP: HTTP 429 twice in a row — ending the backfill.", flush=True)
                break
            if not args.no_sleep:
                time.sleep(random.uniform(2, 5))

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(images, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    print(f"\nwrote {len(images)} image URLs to {args.out}")
    print(f"parsers that supplied images: {sources}")
    if failures:
        print(f"no image for {len(failures)} SKUs: {', '.join(failures)}")


if __name__ == "__main__":
    main()
