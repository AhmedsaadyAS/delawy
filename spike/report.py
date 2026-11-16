#!/usr/bin/env python3
"""Build the Spike results page data + Markdown report.

Reads spike/data/results.jsonl (WARP job) and spike/data/results-control.jsonl
(no-WARP control job), appended hourly by Actions, and, when present,
spike/data/manual_summary.json (from compare_manual.py) and
spike/data/dispatch.jsonl (from dispatch_test.py).

Writes:
  - public/results.json   (read by public/index.html)
  - spike/SPIKE-RESULTS.md (human-readable report)

Go / No-Go (per the Spike spec):
  Go     — overall success rate >= 90% AND zero wrong prices in the
           manual sample.
  No-Go  — anything else, with the reason.
  Pending — no records yet, or no manual sample yet: the decision
           cannot be made, and the page says so instead of guessing.

Usage:
    python spike/report.py [--results spike/data/results.jsonl spike/data/results-control.jsonl]
        [--manual spike/data/manual_summary.json]
        [--dispatch spike/data/dispatch.jsonl]
        [--out-json public/results.json] [--out-md spike/SPIKE-RESULTS.md]
"""
from __future__ import annotations

import argparse
import json
import math
import os
from datetime import datetime, timezone


def _load_jsonl(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def _load_json(path: str) -> dict | None:
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _percent(part: int, whole: int) -> float | None:
    return round(100.0 * part / whole, 1) if whole else None


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    values = sorted(values)
    n = len(values)
    mid = n // 2
    return float(values[mid] if n % 2 else (values[mid - 1] + values[mid]) / 2)


def _p95(values: list[float]) -> float | None:
    if not values:
        return None
    values = sorted(values)
    idx = min(len(values) - 1, math.ceil(0.95 * len(values)) - 1)
    return float(values[idx])


def _group_stats(records: list[dict], key: str) -> dict:
    out: dict[str, dict] = {}
    groups: dict[str, list[dict]] = {}
    for r in records:
        groups.setdefault(str(r.get(key, "?")), []).append(r)
    for name, items in sorted(groups.items()):
        ok = sum(1 for r in items if r.get("parse_ok"))
        ak = sum(1 for r in items if r.get("akamai_challenge"))
        out[name] = {
            "records": len(items),
            "success_rate": _percent(ok, len(items)),
            "akamai_rate": _percent(ak, len(items)),
        }
    return out


def build(results_paths: str | list[str], manual_path: str, dispatch_path: str) -> dict:
    if isinstance(results_paths, str):
        results_paths = [results_paths]
    records: list[dict] = []
    for path in results_paths:
        records.extend(_load_jsonl(path))
    manual = _load_json(manual_path)
    dispatch = _load_jsonl(dispatch_path)

    total = len(records)
    ok = sum(1 for r in records if r.get("parse_ok"))
    akamai = sum(1 for r in records if r.get("akamai_challenge"))
    failed_429 = sum(1 for r in records if r.get("http_status") == 429)
    latencies = [float(r["elapsed_ms"]) for r in records
                 if r.get("parse_ok") and r.get("elapsed_ms") is not None]
    success_rate = _percent(ok, total)

    # Per-SKU last record (strategy A, main/WARP run first).
    per_sku: dict[str, dict] = {}
    for r in sorted(records, key=lambda x: x.get("ts", "")):
        if r.get("strategy") != "A":
            continue
        if r.get("warp", True) is True:
            per_sku[r["sku"]] = r
    if not per_sku:  # fall back to any strategy-A record
        for r in sorted(records, key=lambda x: x.get("ts", "")):
            if r.get("strategy") == "A":
                per_sku[r["sku"]] = r
    sku_table = [
        {
            "sku": sku,
            "last_price": r.get("price"),
            "original_price": r.get("original_price"),
            "seller": r.get("seller"),
            "in_stock": r.get("in_stock"),
            "parse_ok": bool(r.get("parse_ok")),
            "akamai_challenge": bool(r.get("akamai_challenge")),
            "parser_used": r.get("parser_used"),
            "ts": r.get("ts"),
            "status": ("blocked" if r.get("akamai_challenge")
                       else "ok" if r.get("parse_ok") else "failed"),
        }
        for sku, r in sorted(per_sku.items())
    ]

    manual_summary = None
    if manual:
        manual_summary = {
            "filled": manual.get("manual_rows_filled", 0),
            "matched": manual.get("matched", 0),
            "wrong_prices": manual.get("wrong_prices", 0),
            "wrong_sellers": manual.get("wrong_sellers", 0),
            "wrong_stock": manual.get("wrong_stock", 0),
            "no_nearby_record": manual.get("no_nearby_record", 0),
            "record_failed": manual.get("record_failed", 0),
        }

    dispatch_summary = None
    if dispatch:
        starts = [d["time_to_start_s"] for d in dispatch if d.get("time_to_start_s") is not None]
        completes = [d["time_to_complete_s"] for d in dispatch if d.get("time_to_complete_s") is not None]
        dispatch_summary = {
            "runs": len(dispatch),
            "median_time_to_start_s": _median([float(x) for x in starts]),
            "median_time_to_complete_s": _median([float(x) for x in completes]),
        }

    reasons: list[str] = []
    if total == 0:
        decision = "pending"
        reasons.append("لا توجد سجلات بعد — أول Run لم ينتهِ أو لم يُنفَّذ.")
    elif manual_summary is None or manual_summary["filled"] == 0:
        decision = "pending"
        reasons.append("لا توجد عينة تحقق يدوي بعد — املأ spike/manual_check.csv "
                       "وشغّل spike/compare_manual.py.")
        if success_rate is not None and success_rate < 90:
            reasons.append(f"نسبة النجاح {success_rate}% أقل من 90% المطلوبة.")
    else:
        decision = "go"
        if success_rate is None or success_rate < 90:
            decision = "no-go"
            reasons.append(f"نسبة النجاح {success_rate}% أقل من 90% المطلوبة.")
        if manual_summary["wrong_prices"] > 0:
            decision = "no-go"
            reasons.append(f"عدد الأسعار الخاطئة في العينة اليدوية: "
                           f"{manual_summary['wrong_prices']} (المطلوب صفر).")

    first_ts = records[0].get("ts") if records else None
    last_ts = records[-1].get("ts") if records else None
    return {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "records_total": total,
        "success_rate": success_rate,
        "success_count": ok,
        "akamai_count": akamai,
        "akamai_rate": _percent(akamai, total),
        "http_429_count": failed_429,
        "latency_ms": {"median": _median(latencies), "p95": _p95(latencies),
                       "n": len(latencies)},
        "by_strategy": _group_stats(records, "strategy"),
        "by_warp": _group_stats(records, "warp"),
        "by_parser": _group_stats([r for r in records if r.get("parse_ok")], "parser_used"),
        "manual": manual_summary,
        "dispatch": dispatch_summary,
        "per_sku": sku_table,
        "first_ts": first_ts,
        "last_ts": last_ts,
        "decision": decision,
        "decision_reasons": reasons,
    }


def render_markdown(summary: dict) -> str:
    def pct(v: float | None) -> str:
        return f"{v}%" if v is not None else "—"

    lines = [
        "# نتائج الـ Spike — نون مصر",
        "",
        f"آخر تحديث: {summary['generated_at']} — "
        f"السجلات: {summary['records_total']} "
        f"(من {summary['first_ts']} إلى {summary['last_ts']})",
        "",
        "## القرار: " + {"go": "✅ Go", "no-go": "❌ No-Go",
                         "pending": "⏳ بانتظار البيانات"}[summary["decision"]],
        "",
    ]
    for reason in summary["decision_reasons"]:
        lines.append(f"- {reason}")
    lines += [
        "",
        "## البطاقات",
        "",
        f"- نسبة النجاح: {pct(summary['success_rate'])} "
        f"({summary['success_count']}/{summary['records_total']})",
        f"- نسبة تحديات Akamai: {pct(summary['akamai_rate'])} "
        f"({summary['akamai_count']} سجل) — طلبات HTTP 429: {summary['http_429_count']}",
    ]
    if summary["manual"]:
        m = summary["manual"]
        lines.append(f"- الأسعار الخاطئة (يدوي): {m['wrong_prices']} من "
                     f"{m['matched']} مطابَقة ({m['filled']} صف مملوء) — "
                     f"بائع خاطئ: {m['wrong_sellers']}، مخزون خاطئ: {m['wrong_stock']}")
    else:
        lines.append("- الأسعار الخاطئة (يدوي): لا توجد عينة بعد.")
    lat = summary["latency_ms"]
    med = f"{lat['median']}ms" if lat["median"] is not None else "—"
    p95 = f"{lat['p95']}ms" if lat["p95"] is not None else "—"
    lines.append(f"- زمن الاستجابة (الناجح فقط): median {med}، p95 {p95} (n={lat['n']})")
    lines += ["", "## الأسلوب A مقابل B", ""]
    for name, s in summary["by_strategy"].items():
        lines.append(f"- الأسلوب {name}: {s['records']} سجل، نجاح "
                     f"{pct(s['success_rate'])}، Akamai {pct(s['akamai_rate'])}")
    lines += ["", "## WARP مقابل بدون WARP", ""]
    for name, s in summary["by_warp"].items():
        label = "مع WARP" if name == "True" else "بدون WARP" if name == "False" else name
        lines.append(f"- {label}: {s['records']} سجل، نجاح "
                     f"{pct(s['success_rate'])}، Akamai {pct(s['akamai_rate'])}")
    if summary["dispatch"]:
        d = summary["dispatch"]
        lines += ["", "## الفورية (workflow_dispatch)",
                  f"- عدد مرات الاختبار: {d['runs']} — median للبدء: "
                  f"{d['median_time_to_start_s']}s، median للاكتمال: "
                  f"{d['median_time_to_complete_s']}s"]
    lines += ["", "## آخر سعر لكل SKU (الأسلوب A)", ""]
    lines.append("| SKU | السعر | البائع | الحالة | آخر فحص |")
    lines.append("|---|---|---|---|---|")
    for row in summary["per_sku"]:
        status = {"ok": "✅", "failed": "❌", "blocked": "🚫"}[row["status"]]
        lines.append(f"| {row['sku']} | {row['last_price']} | "
                     f"{row['seller'] or '—'} | {status} | {row['ts'] or '—'} |")
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", nargs="+",
                    default=["spike/data/results.jsonl",
                             "spike/data/results-control.jsonl"])
    ap.add_argument("--manual", default="spike/data/manual_summary.json")
    ap.add_argument("--dispatch", default="spike/data/dispatch.jsonl")
    ap.add_argument("--out-json", default="public/results.json")
    ap.add_argument("--out-md", default="spike/SPIKE-RESULTS.md")
    args = ap.parse_args()

    summary = build(args.results, args.manual, args.dispatch)
    for path, content in (
        (args.out_json, json.dumps(summary, ensure_ascii=False, indent=2)),
        (args.out_md, render_markdown(summary)),
    ):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    print(f"decision: {summary['decision']} "
          f"(success {summary['success_rate']}%, "
          f"records {summary['records_total']})")
    for reason in summary["decision_reasons"]:
        print(f"  - {reason}")
    print(f"wrote {args.out_json} and {args.out_md}")


if __name__ == "__main__":
    main()
