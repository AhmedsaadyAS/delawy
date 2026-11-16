#!/usr/bin/env python3
"""Run the Spike batch: every SKU in spike/skus.csv, strategies A then B.

Low volume (the Spike's hard rule):
- one Fetcher session for the whole run, no parallelism,
- random 2-5 s delay between requests,
- stop the batch after HTTP 429 twice in a row.

Results are appended (never rewritten) to spike/data/results.jsonl.
On a parse failure the first 20 KB of the HTML are saved under
--failure-dir (uploaded as a GitHub Actions artifact, never committed).

Usage:
    python spike/run_spike.py [--skus spike/skus.csv] [--out spike/data/results.jsonl]
    python spike/run_spike.py --only-sku N21961435A --strategy A
    python spike/run_spike.py --no-sleep   # tests / dry runs only
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

FAILURE_HEAD_BYTES = 20 * 1024


def load_skus(path: str) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _save_failure(failure_dir: str, record: dict, html: str) -> None:
    os.makedirs(failure_dir, exist_ok=True)
    name = f"{record['sku']}_{record['strategy']}_{record['ts'].replace(':', '-').replace('.', '_')}.html"
    with open(os.path.join(failure_dir, name), "w", encoding="utf-8") as f:
        f.write(html[:FAILURE_HEAD_BYTES])


def run(
    skus: list[dict],
    out_path: str,
    strategies: tuple[str, ...] = ("A", "B"),
    only_sku: str = "",
    no_sleep: bool = False,
    failure_dir: str = "",
    proxy: str | None = None,
    warp: bool = True,
) -> dict:
    stats = {"records": 0, "ok": 0, "akamai": 0, "http_429": 0, "stopped_on_429": False}
    consecutive_429 = 0
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with Fetcher(proxy=proxy) as fetcher, open(out_path, "a", encoding="utf-8") as out:
        for row in skus:
            if only_sku and row["sku"] != only_sku:
                continue
            for strategy in strategies:
                record, html = fetch_product(
                    fetcher,
                    sku=row["sku"],
                    url=row.get("url", ""),
                    offer_code=row.get("offer_code", ""),
                    strategy=strategy,
                )
                record["warp"] = warp  # extra field: how this run reached noon
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                out.flush()
                stats["records"] += 1
                stats["ok"] += 1 if record["parse_ok"] else 0
                stats["akamai"] += 1 if record["akamai_challenge"] else 0
                if record["http_status"] == 429:
                    consecutive_429 += 1
                    stats["http_429"] += 1
                else:
                    consecutive_429 = 0
                if not record["parse_ok"] and html and failure_dir:
                    _save_failure(failure_dir, record, html)
                print(
                    f"{record['sku']} {strategy}: "
                    f"http={record['http_status']} parse_ok={record['parse_ok']} "
                    f"parser={record['parser_used']} price={record['price']} "
                    f"seller={record['seller']} err={record['error']}",
                    flush=True,
                )
                if consecutive_429 >= 2:
                    print("STOP: HTTP 429 twice in a row — ending the batch.", flush=True)
                    stats["stopped_on_429"] = True
                    return stats
                if not no_sleep:
                    time.sleep(random.uniform(2, 5))
    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skus", default="spike/skus.csv")
    ap.add_argument("--out", default="spike/data/results.jsonl")
    ap.add_argument("--strategy", default="AB", help="A, B or AB")
    ap.add_argument("--only-sku", default="")
    ap.add_argument("--no-sleep", action="store_true")
    ap.add_argument("--failure-dir", default="spike/data/failures")
    ap.add_argument("--proxy", default=os.environ.get("SCRAPER_PROXY") or None)
    ap.add_argument("--warp", type=lambda v: v.lower() not in ("0", "false", "no"), default=True)
    args = ap.parse_args()

    strategies = tuple(c for c in args.strategy.upper() if c in "AB") or ("A", "B")
    stats = run(
        load_skus(args.skus),
        args.out,
        strategies=strategies,
        only_sku=args.only_sku,
        no_sleep=args.no_sleep,
        failure_dir=args.failure_dir,
        proxy=args.proxy,
        warp=args.warp,
    )
    print(f"done: {stats}")


if __name__ == "__main__":
    main()
