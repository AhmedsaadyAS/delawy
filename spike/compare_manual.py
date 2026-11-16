#!/usr/bin/env python3
"""Compare the manual browser check against the Spike results.

For each filled row in spike/manual_check.csv, find the nearest record
in spike/data/results.jsonl for the same SKU with strategy A (the PDP
URL the user opened — NOT strategy B, whose search result can be a
different seller/offer) and a time difference under 30 minutes.

Rules (per the Spike spec):
- any price difference is a wrong price;
- a seller difference is a separate error;
- a stock difference is reported separately too.

Writes spike/data/manual_summary.json (read by spike/report.py) and
prints a summary. Rows with an empty price_in_browser are skipped
(not yet filled in by hand).

Usage:
    python spike/compare_manual.py [--manual spike/manual_check.csv]
        [--results spike/data/results.jsonl]
        [--out spike/data/manual_summary.json] [--window-minutes 30]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
from datetime import datetime, timezone


def _parse_ts(value: str) -> datetime | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _parse_price(value: str) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "").replace("EGP", "").strip()
    if not text:
        return None
    m = re.search(r"[\d]+\.?\d*", text)
    return float(m.group()) if m else None


def _norm_seller(value: str | None) -> str:
    return (value or "").strip().lower()


def load_results(path: str) -> list[dict]:
    records: list[dict] = []
    if not os.path.exists(path):
        return records
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def compare(manual_path: str, results_path: str, window_minutes: int = 30) -> dict:
    records = load_results(results_path)
    by_sku: dict[str, list[dict]] = {}
    for r in records:
        by_sku.setdefault(r.get("sku", ""), []).append(r)
    for items in by_sku.values():
        items.sort(key=lambda r: r.get("ts", ""))

    summary: dict = {
        "manual_rows_total": 0,
        "manual_rows_filled": 0,
        "matched": 0,
        "no_nearby_record": 0,
        "record_failed": 0,
        "wrong_prices": 0,
        "wrong_sellers": 0,
        "wrong_stock": 0,
        "rows": [],
    }
    with open(manual_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            summary["manual_rows_total"] += 1
            price_browser = _parse_price(row.get("price_in_browser"))
            if price_browser is None:
                continue
            summary["manual_rows_filled"] += 1
            checked_at = _parse_ts(row.get("checked_at"))
            detail: dict = {
                "sku": row.get("sku", ""),
                "checked_at": row.get("checked_at", ""),
                "price_in_browser": price_browser,
                "seller_in_browser": (row.get("seller_in_browser") or "").strip(),
                "in_stock_in_browser": (row.get("in_stock_in_browser") or "").strip(),
                "status": "",
                "record_ts": None,
                "record_price": None,
                "record_seller": None,
                "price_wrong": False,
                "seller_wrong": False,
                "stock_wrong": False,
            }
            # Prefer the main (WARP) strategy-A record — the same PDP URL.
            candidates = [
                r for r in by_sku.get(row.get("sku", ""), [])
                if r.get("strategy") == "A" and r.get("warp", True) is True
            ] or [
                r for r in by_sku.get(row.get("sku", ""), [])
                if r.get("strategy") == "A"
            ]
            best: dict | None = None
            best_diff: float | None = None
            for r in candidates:
                r_ts = _parse_ts(r.get("ts", ""))
                if checked_at is None or r_ts is None:
                    continue
                diff = abs((r_ts - checked_at).total_seconds()) / 60.0
                if diff <= window_minutes and (best_diff is None or diff < best_diff):
                    best, best_diff = r, diff
            if best is None:
                detail["status"] = "no_nearby_record"
                summary["no_nearby_record"] += 1
            elif not best.get("parse_ok") or best.get("price") is None:
                detail["status"] = "record_failed"
                detail["record_ts"] = best.get("ts")
                summary["record_failed"] += 1
            else:
                detail["status"] = "matched"
                detail["record_ts"] = best.get("ts")
                detail["record_price"] = best.get("price")
                detail["record_seller"] = best.get("seller")
                summary["matched"] += 1
                if float(best["price"]) != float(price_browser):
                    detail["price_wrong"] = True
                    summary["wrong_prices"] += 1
                if _norm_seller(best.get("seller")) != _norm_seller(row.get("seller_in_browser")):
                    detail["seller_wrong"] = True
                    summary["wrong_sellers"] += 1
                stock_browser = (row.get("in_stock_in_browser") or "").strip().lower()
                if stock_browser in ("true", "false", "yes", "no", "1", "0"):
                    expected = stock_browser in ("true", "yes", "1")
                    if bool(best.get("in_stock")) != expected:
                        detail["stock_wrong"] = True
                        summary["wrong_stock"] += 1
            summary["rows"].append(detail)
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manual", default="spike/manual_check.csv")
    ap.add_argument("--results", default="spike/data/results.jsonl")
    ap.add_argument("--out", default="spike/data/manual_summary.json")
    ap.add_argument("--window-minutes", type=int, default=30)
    args = ap.parse_args()

    summary = compare(args.manual, args.results, args.window_minutes)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"manual rows: {summary['manual_rows_filled']} filled / "
          f"{summary['manual_rows_total']} total")
    print(f"matched: {summary['matched']}  no_nearby_record: {summary['no_nearby_record']}  "
          f"record_failed: {summary['record_failed']}")
    print(f"WRONG PRICES: {summary['wrong_prices']}  "
          f"wrong sellers: {summary['wrong_sellers']}  "
          f"wrong stock: {summary['wrong_stock']}")
    for row in summary["rows"]:
        if row["price_wrong"] or row["seller_wrong"]:
            print(f"  {row['sku']}: browser={row['price_in_browser']} "
                  f"({row['seller_in_browser']}) vs record={row['record_price']} "
                  f"({row['record_seller']}) @ {row['record_ts']}")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
