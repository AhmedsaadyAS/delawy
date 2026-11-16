"""pytest for spike/report.py — synthetic data only, no network."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from report import build


def _rec(sku, strategy="A", warp=True, ok=True, price=100.0, akamai=False,
         elapsed=1000, ts="2026-11-16T14:00:00Z", parser="json_ld", status=200):
    return {"ts": ts, "sku": sku, "strategy": strategy, "http_status": status,
            "attempts": 1, "impersonate": "chrome146",
            "akamai_challenge": akamai, "parse_ok": ok, "parser_used": parser,
            "price": price if ok else None, "original_price": 150.0,
            "seller": "Shop", "in_stock": True, "offer_code": "x",
            "elapsed_ms": elapsed, "error": None, "warp": warp}


def _build(records, manual=None, tmp_path=None):
    # build() reads files, so write the fixtures to tmp files first.
    res = tmp_path / "results.jsonl"
    with open(res, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
    man = tmp_path / "manual.json"
    if manual is not None:
        with open(man, "w", encoding="utf-8") as f:
            json.dump(manual, f)
    return build(str(res), str(man) if manual is not None else str(tmp_path / "missing.json"),
                 str(tmp_path / "missing2.jsonl"))


def test_go_when_success_90_and_zero_wrong_prices(tmp_path):
    records = [_rec(f"N{i:08d}A") for i in range(10)]
    manual = {"manual_rows_filled": 5, "matched": 5, "wrong_prices": 0,
              "wrong_sellers": 0, "wrong_stock": 0, "no_nearby_record": 0,
              "record_failed": 0}
    s = _build(records, manual, tmp_path)
    assert s["decision"] == "go"
    assert s["success_rate"] == 100.0


def test_no_go_when_success_below_90(tmp_path):
    records = [_rec(f"N{i:08d}A", ok=(i < 8)) for i in range(10)]
    manual = {"manual_rows_filled": 5, "matched": 5, "wrong_prices": 0,
              "wrong_sellers": 0, "wrong_stock": 0, "no_nearby_record": 0,
              "record_failed": 0}
    s = _build(records, manual, tmp_path)
    assert s["decision"] == "no-go"
    assert s["success_rate"] == 80.0


def test_no_go_when_one_wrong_price(tmp_path):
    records = [_rec(f"N{i:08d}A") for i in range(10)]
    manual = {"manual_rows_filled": 5, "matched": 5, "wrong_prices": 1,
              "wrong_sellers": 0, "wrong_stock": 0, "no_nearby_record": 0,
              "record_failed": 0}
    s = _build(records, manual, tmp_path)
    assert s["decision"] == "no-go"


def test_pending_with_no_records(tmp_path):
    s = _build([], None, tmp_path)
    assert s["decision"] == "pending"
    assert s["success_rate"] is None


def test_pending_with_no_manual_sample(tmp_path):
    records = [_rec(f"N{i:08d}A") for i in range(10)]
    s = _build(records, None, tmp_path)
    assert s["decision"] == "pending"


def test_latency_median_and_p95(tmp_path):
    records = [_rec(f"N{i:08d}A", elapsed=100 * (i + 1)) for i in range(10)]
    s = _build(records, None, tmp_path)
    assert s["latency_ms"]["median"] == 550.0
    assert s["latency_ms"]["p95"] == 1000.0


def test_by_strategy_and_by_warp_split(tmp_path):
    records = ([_rec("N00000001A", strategy="A", warp=True)] * 4
               + [_rec("N00000001A", strategy="B", warp=True)] * 4
               + [_rec("N00000001A", strategy="A", warp=False, ok=False)] * 2)
    s = _build(records, None, tmp_path)
    assert s["by_strategy"]["A"]["records"] == 6
    assert s["by_strategy"]["B"]["records"] == 4
    assert s["by_warp"]["True"]["success_rate"] == 100.0
    assert s["by_warp"]["False"]["success_rate"] == 0.0


def test_per_sku_keeps_last_price(tmp_path):
    records = [_rec("N00000001A", price=100.0, ts="2026-11-16T14:00:00Z"),
               _rec("N00000001A", price=90.0, ts="2026-11-16T15:00:00Z")]
    s = _build(records, None, tmp_path)
    assert len(s["per_sku"]) == 1
    assert s["per_sku"][0]["last_price"] == 90.0
    assert s["per_sku"][0]["status"] == "ok"


def test_reads_both_results_files(tmp_path):
    # WARP file + control file are merged; a missing control file is fine.
    warp = tmp_path / "results.jsonl"
    ctrl = tmp_path / "results-control.jsonl"
    with open(warp, "w", encoding="utf-8") as f:
        f.write(json.dumps(_rec("N00000001A", warp=True)) + "\n")
    with open(ctrl, "w", encoding="utf-8") as f:
        f.write(json.dumps(_rec("N00000002A", warp=False)) + "\n")
    s = build([str(warp), str(ctrl)], str(tmp_path / "missing.json"),
              str(tmp_path / "missing2.jsonl"))
    assert s["records_total"] == 2
    assert s["by_warp"]["True"]["records"] == 1
    assert s["by_warp"]["False"]["records"] == 1
    s2 = build([str(warp), str(tmp_path / "no-such-file.jsonl")],
               str(tmp_path / "missing.json"), str(tmp_path / "missing2.jsonl"))
    assert s2["records_total"] == 1
