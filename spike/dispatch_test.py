#!/usr/bin/env python3
"""Measure workflow_dispatch latency for the Spike (runs locally only).

Calls the GitHub Actions API to dispatch `.github/workflows/spike.yml`
for ONE SKU, 10 times by default, and measures for each dispatch:
  - time_to_start_s:    dispatch -> the run first appears in the API
  - time_to_complete_s: dispatch -> the run reaches a conclusion

Writes one JSON record per dispatch to spike/data/dispatch.jsonl.

Auth: a fine-grained personal access token in the GH_TOKEN environment
variable only. The token is never written to the repo, to any output
file, or to logs. The token needs "Actions: read and write" on
AhmedsaadyAS/delawy.

Do NOT run this while an hourly Spike run is in progress if you want
clean numbers: the workflow's single concurrency group queues a
dispatched run behind the running one, and that queueing is part of
what this test measures.

Usage:
    export GH_TOKEN="github_pat_..."   # never paste a token in the repo
    python spike/dispatch_test.py [--sku N21961435A] [--count 10]
    python spike/dispatch_test.py --dry-run   # validate token + workflow, no dispatch
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

OWNER = "AhmedsaadyAS"
REPO = "delawy"
WORKFLOW = "spike.yml"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "delawy-spike-dispatch-test",
    }


def _request(token: str, method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path, data=data, method=method, headers=_headers(token))
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        raise RuntimeError(f"GitHub API {method} {path}: HTTP {e.code}: {detail}") from e


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def find_new_run(runs: list[dict], since: datetime, seen_ids: set[int]) -> dict | None:
    """First run created after `since` that we have not seen before."""
    for run in runs:
        if run.get("id") in seen_ids:
            continue
        created = _parse_time(run["created_at"]) if run.get("created_at") else None
        if created and created >= since:
            return run
    return None


def wait_for_run(token: str, since: datetime, seen_ids: set[int],
                 timeout_s: int, interval_s: int = 15) -> dict:
    """Poll until the dispatched run appears, then until it completes.

    Returns the final run object plus measured latencies (seconds).
    """
    deadline = time.monotonic() + timeout_s
    started_at: float | None = None
    run: dict | None = None
    while time.monotonic() < deadline:
        data = _request(token, "GET",
                        f"/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=10")
        run = find_new_run(data.get("workflow_runs", []), since, seen_ids)
        if run is not None:
            if started_at is None:
                started_at = time.monotonic()
            if run.get("status") == "completed":
                return {"run": run, "time_to_start_s": round(started_at - _t0, 1),
                        "time_to_complete_s": round(time.monotonic() - _t0, 1)}
        time.sleep(interval_s)
    raise TimeoutError(f"run did not complete within {timeout_s}s"
                       + (f" (last status: {run.get('status')})" if run else ""))


_t0: float = 0.0  # dispatch instant for the current iteration (monotonic)


def dispatch_once(token: str, sku: str, timeout_s: int) -> dict:
    global _t0
    seen = {r["id"] for r in _request(
        token, "GET",
        f"/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=10"
    ).get("workflow_runs", [])}
    dispatched_at = datetime.now(timezone.utc)
    _t0 = time.monotonic()
    _request(token, "POST", f"/actions/workflows/{WORKFLOW}/dispatches",
             {"ref": "main", "inputs": {"sku": sku}})
    # 10 s grace for clock skew between this machine and GitHub's API.
    from datetime import timedelta
    result = wait_for_run(token, dispatched_at - timedelta(seconds=10), seen, timeout_s)
    run = result["run"]
    return {
        "ts": dispatched_at.isoformat().replace("+00:00", "Z"),
        "sku": sku,
        "run_id": run.get("id"),
        "run_url": run.get("html_url"),
        "status": run.get("status"),
        "conclusion": run.get("conclusion"),
        "time_to_start_s": result["time_to_start_s"],
        "time_to_complete_s": result["time_to_complete_s"],
    }


def default_sku(skus_path: str = "spike/skus.csv") -> str:
    with open(skus_path, newline="", encoding="utf-8") as f:
        return next(csv.DictReader(f))["sku"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sku", default="")
    ap.add_argument("--count", type=int, default=10)
    ap.add_argument("--timeout", type=int, default=1800,
                    help="seconds to wait for one run to complete")
    ap.add_argument("--out", default="spike/data/dispatch.jsonl")
    ap.add_argument("--dry-run", action="store_true",
                    help="validate token + workflow, dispatch nothing")
    args = ap.parse_args()

    token = os.environ.get("GH_TOKEN", "").strip()
    if not token:
        print("error: GH_TOKEN is not set (export GH_TOKEN=... and retry)",
              file=sys.stderr)
        raise SystemExit(2)
    sku = args.sku or default_sku()
    # Validate token + workflow before dispatching anything.
    _request(token, "GET", f"/actions/workflows/{WORKFLOW}")
    print(f"token + workflow OK ({OWNER}/{REPO}@{WORKFLOW}), sku={sku}")
    if args.dry_run:
        print("dry-run: dispatched nothing.")
        return

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "a", encoding="utf-8") as out:
        for i in range(1, args.count + 1):
            print(f"dispatch {i}/{args.count} ...", flush=True)
            try:
                record = dispatch_once(token, sku, args.timeout)
            except Exception as e:
                record = {"ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                          "sku": sku, "run_id": None, "status": "error",
                          "conclusion": None, "time_to_start_s": None,
                          "time_to_complete_s": None, "error": str(e)}
                print(f"  ERROR: {e}", flush=True)
            else:
                print(f"  run {record['run_id']}: {record['conclusion']} "
                      f"start={record['time_to_start_s']}s "
                      f"complete={record['time_to_complete_s']}s", flush=True)
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            out.flush()
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
