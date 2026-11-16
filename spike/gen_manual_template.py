#!/usr/bin/env python3
"""Generate spike/manual_check.csv: 15 random SKUs x 3 rounds (45 rows).

The user fills each row by hand from the browser (no logged-in account):
open the URL, note the price, seller and stock, and the time (UTC, ISO).
Three rounds at different times, so a price that moves between rounds
is caught against the nearest run (within 30 minutes).

Columns are exactly:
    sku, url, checked_at, price_in_browser, seller_in_browser, in_stock_in_browser

Usage:
    python spike/gen_manual_template.py [--skus spike/skus.csv]
        [--out spike/manual_check.csv] [--seed 7]
"""
from __future__ import annotations

import argparse
import csv
import random

ROUNDS = 3
SAMPLE_SIZE = 15


def _bucket(price: float) -> str:
    if price < 500:
        return "<500"
    if price < 3000:
        return "500-3000"
    if price < 15000:
        return "3000-15000"
    return ">15000"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skus", default="spike/skus.csv")
    ap.add_argument("--out", default="spike/manual_check.csv")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    with open(args.skus, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    rng = random.Random(args.seed)
    # Stratified: pick from every price bucket and every feed, then shuffle.
    by_bucket: dict[str, list[dict]] = {}
    for r in rows:
        by_bucket.setdefault(_bucket(float(r["listing_price"])), []).append(r)
    picked: list[dict] = []
    order = ["<500", "500-3000", "3000-15000", ">15000"]
    i = 0
    while len(picked) < SAMPLE_SIZE:
        bucket = order[i % len(order)]
        pool = by_bucket.get(bucket, [])
        choice = rng.choice(pool) if pool else None
        if choice and choice not in picked:
            picked.append(choice)
        i += 1
        if i > 200:  # pool exhausted — fall back to any remaining SKU
            rest = [r for r in rows if r not in picked]
            picked.extend(rng.sample(rest, SAMPLE_SIZE - len(picked)))
            break
    rng.shuffle(picked)

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["sku", "url", "checked_at", "price_in_browser",
                        "seller_in_browser", "in_stock_in_browser"],
        )
        w.writeheader()
        for _round in range(1, ROUNDS + 1):
            round_rows = list(picked)
            rng.shuffle(round_rows)
            for r in round_rows:
                w.writerow({
                    "sku": r["sku"], "url": r["url"], "checked_at": "",
                    "price_in_browser": "", "seller_in_browser": "",
                    "in_stock_in_browser": "",
                })
    print(f"wrote {args.out}: {SAMPLE_SIZE} SKUs x {ROUNDS} rounds = "
          f"{SAMPLE_SIZE * ROUNDS} rows")
    for r in picked:
        print(f"  {r['sku']}  {r['listing_price']} EGP  {r['seller']}  [{_bucket(float(r['listing_price']))}]")


if __name__ == "__main__":
    main()
