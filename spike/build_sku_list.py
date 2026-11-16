#!/usr/bin/env python3
"""Build the Spike SKU list (50 diverse SKUs) from Noon list pages.

Source of the fetch/parse logic: spike/scraper.py, copied from
https://github.com/Vette1123/noon-deals-bot (MIT) — see THIRD_PARTY_NOTICES.md.

Feeds (verified live 2026-11-16):
- electronics-and-mobiles/mobiles-and-accessories — NOT in upstream
  FEED_CODES, but a real browse path (50 products on page 1) and its rate
  (2%) is in upstream _RATE_PREFIXES. Used here because the Spike is
  about mobiles + electronics.
- electronics-and-mobiles/computers-and-accessories — in FEED_CODES.
- electronics-and-mobiles/wearable-technology — in FEED_CODES.
- electronics-and-mobiles/home-audio — in FEED_CODES.
- home-and-kitchen/home-appliances-31235 — in FEED_CODES; adds the
  >15,000 EGP slice (large appliances) that electronics feeds lack.

Usage:
    python spike/build_sku_list.py [--out spike/skus.csv] [--seed 42]

Low volume: one feed page per feed (5 requests), 2-5 s random delay
between requests, single-threaded, no parallelism.
"""
from __future__ import annotations

import argparse
import csv
import random
import time
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

from scraper import _fetch_html, feed_url, parse_products_from_html

SPIKE_FEEDS: tuple[tuple[str, str], ...] = (
    ("electronics-and-mobiles/mobiles-and-accessories", "mobiles"),
    ("electronics-and-mobiles/computers-and-accessories", "computers"),
    ("electronics-and-mobiles/wearable-technology", "wearable"),
    ("electronics-and-mobiles/home-audio", "home-audio"),
    ("home-and-kitchen/home-appliances-31235", "home-appliances"),
)

# Target counts per price slice (EGP). Total = 50.
BUCKETS: tuple[tuple[str, float, float, int], ...] = (
    ("<500", 0, 500, 12),
    ("500-3000", 500, 3000, 16),
    ("3000-15000", 3000, 15000, 14),
    (">15000", 15000, float("inf"), 8),
)


def _bucket(price: float) -> str:
    for name, lo, hi, _ in BUCKETS:
        if lo <= price < hi:
            return name
    return ">15000"


def _offer_code(url: str) -> str:
    return parse_qs(urlparse(url).query).get("o", [""])[0]


def fetch_pool() -> list[dict]:
    pool: list[dict] = []
    seen: set[str] = set()
    for code, label in SPIKE_FEEDS:
        url = feed_url(code, 1)
        print(f"fetching {code} ...", flush=True)
        html = _fetch_html(url)
        products = parse_products_from_html(html)
        new = 0
        for p in products:
            if p["sku"] in seen:
                continue
            seen.add(p["sku"])
            p["category"] = code
            p["feed_label"] = label
            pool.append(p)
            new += 1
        print(f"  {code}: {len(products)} products ({new} new)", flush=True)
        time.sleep(random.uniform(2, 5))
    return pool


def select(pool: list[dict], seed: int = 42) -> list[dict]:
    rng = random.Random(seed)
    by_bucket: dict[str, list[dict]] = {name: [] for name, _, _, _ in BUCKETS}
    for p in pool:
        by_bucket[_bucket(float(p["sale_price"]))].append(p)
    for items in by_bucket.values():
        rng.shuffle(items)

    selected: list[dict] = []
    seller_count: dict[str, int] = {}
    brand_count: dict[str, int] = {}

    def _can_take(p: dict) -> bool:
        # Diversity caps: at most 3 SKUs per seller, at most 4 per brand.
        return seller_count.get(p.get("store_name", ""), 0) < 3 and brand_count.get(
            p.get("brand", ""), 0
        ) < 4

    def _take(p: dict) -> None:
        selected.append(p)
        seller_count[p.get("store_name", "")] = seller_count.get(p.get("store_name", ""), 0) + 1
        brand_count[p.get("brand", "")] = brand_count.get(p.get("brand", ""), 0) + 1

    # First pass: respect diversity caps, bucket targets in order.
    for name, _, _, target in BUCKETS:
        taken = 0
        for p in by_bucket[name]:
            if taken >= target:
                break
            if _can_take(p):
                _take(p)
                taken += 1
    # Second pass: fill any short bucket ignoring caps (pool may be thin,
    # e.g. the >15000 slice or the home-audio feed with 11 products).
    for name, _, _, target in BUCKETS:
        have = sum(1 for p in selected if _bucket(float(p["sale_price"])) == name)
        for p in by_bucket[name]:
            if have >= target:
                break
            if p not in selected:
                _take(p)
                have += 1
    return selected


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="spike/skus.csv")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    pool = fetch_pool()
    print(f"pool: {len(pool)} unique products")
    for name, _, _, _ in BUCKETS:
        n = sum(1 for p in pool if _bucket(float(p["sale_price"])) == name)
        print(f"  bucket {name}: {n} in pool")
    print(f"  no-discount (discount_pct==0): {sum(1 for p in pool if not p.get('discount_pct'))}")
    print(f"  fulfilled_by_noon: {sum(1 for p in pool if p.get('fulfilled_by_noon'))}")

    selected = select(pool, seed=args.seed)
    print(f"selected: {len(selected)}")
    selected_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "sku", "name", "url", "offer_code", "listing_price",
                "original_price", "seller", "category", "selected_at",
            ],
        )
        w.writeheader()
        for p in selected:
            w.writerow({
                "sku": p["sku"],
                "name": p["name"],
                "url": p["url"],
                "offer_code": _offer_code(p["url"]),
                "listing_price": p["sale_price"],
                "original_price": p["original_price"],
                "seller": p.get("store_name", ""),
                "category": p["category"],
                "selected_at": selected_at,
            })
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
