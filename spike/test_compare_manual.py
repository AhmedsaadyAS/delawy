"""pytest for spike/compare_manual.py — synthetic data only, no network."""
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from compare_manual import compare

RESULTS = [
    {"ts": "2026-11-16T14:00:00Z", "sku": "N11111111A", "strategy": "A",
     "warp": True, "parse_ok": True, "price": 100.0, "seller": "Shop A",
     "in_stock": True},
    {"ts": "2026-11-16T14:05:00Z", "sku": "N22222222B", "strategy": "A",
     "warp": True, "parse_ok": True, "price": 200.0, "seller": "Shop B",
     "in_stock": True},
    # Strategy B must NOT be used for the manual comparison (different offer).
    {"ts": "2026-11-16T14:01:00Z", "sku": "N11111111A", "strategy": "B",
     "warp": True, "parse_ok": True, "price": 999.0, "seller": "Other",
     "in_stock": True},
    {"ts": "2026-11-16T14:02:00Z", "sku": "N33333333C", "strategy": "A",
     "warp": True, "parse_ok": False, "price": None, "seller": None,
     "in_stock": None},
]


def _write(tmp_path, manual_rows, results=RESULTS):
    manual = tmp_path / "manual.csv"
    with open(manual, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["sku", "url", "checked_at",
                                          "price_in_browser", "seller_in_browser",
                                          "in_stock_in_browser"])
        w.writeheader()
        for r in manual_rows:
            w.writerow(r)
    res = tmp_path / "results.jsonl"
    with open(res, "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
    return str(manual), str(res)


def test_exact_match_is_not_wrong(tmp_path):
    manual, res = _write(tmp_path, [{
        "sku": "N11111111A", "url": "https://example.test/x",
        "checked_at": "2026-11-16T14:10:00Z", "price_in_browser": "100",
        "seller_in_browser": "Shop A", "in_stock_in_browser": "true"}])
    s = compare(manual, res)
    assert s["wrong_prices"] == 0 and s["wrong_sellers"] == 0
    assert s["matched"] == 1


def test_any_price_difference_is_wrong(tmp_path):
    manual, res = _write(tmp_path, [{
        "sku": "N11111111A", "url": "https://example.test/x",
        "checked_at": "2026-11-16T14:10:00Z", "price_in_browser": "101",
        "seller_in_browser": "Shop A", "in_stock_in_browser": "true"}])
    s = compare(manual, res)
    assert s["wrong_prices"] == 1 and s["wrong_sellers"] == 0


def test_seller_difference_is_a_separate_error(tmp_path):
    manual, res = _write(tmp_path, [{
        "sku": "N22222222B", "url": "https://example.test/x",
        "checked_at": "2026-11-16T14:15:00Z", "price_in_browser": "200",
        "seller_in_browser": "Shop C", "in_stock_in_browser": "true"}])
    s = compare(manual, res)
    assert s["wrong_prices"] == 0 and s["wrong_sellers"] == 1


def test_no_nearby_record_when_too_far_in_time(tmp_path):
    manual, res = _write(tmp_path, [{
        "sku": "N11111111A", "url": "https://example.test/x",
        "checked_at": "2026-11-16T18:00:00Z", "price_in_browser": "100",
        "seller_in_browser": "Shop A", "in_stock_in_browser": "true"}])
    s = compare(manual, res)
    assert s["no_nearby_record"] == 1 and s["matched"] == 0


def test_failed_record_is_not_counted_as_wrong_price(tmp_path):
    manual, res = _write(tmp_path, [{
        "sku": "N33333333C", "url": "https://example.test/x",
        "checked_at": "2026-11-16T14:10:00Z", "price_in_browser": "50",
        "seller_in_browser": "Shop D", "in_stock_in_browser": "true"}])
    s = compare(manual, res)
    assert s["record_failed"] == 1 and s["wrong_prices"] == 0


def test_unfilled_rows_are_skipped(tmp_path):
    manual, res = _write(tmp_path, [{
        "sku": "N11111111A", "url": "https://example.test/x",
        "checked_at": "", "price_in_browser": "",
        "seller_in_browser": "", "in_stock_in_browser": ""}])
    s = compare(manual, res)
    assert s["manual_rows_filled"] == 0 and s["matched"] == 0
