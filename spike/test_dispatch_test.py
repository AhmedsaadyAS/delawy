"""pytest for spike/dispatch_test.py — pure functions only, no network."""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dispatch_test import _parse_time, find_new_run

SINCE = datetime(2026, 11, 16, 14, 0, 0, tzinfo=timezone.utc)
RUNS = [
    {"id": 1, "created_at": "2026-11-16T13:59:00Z", "status": "completed"},
    {"id": 2, "created_at": "2026-11-16T14:00:30Z", "status": "in_progress"},
    {"id": 3, "created_at": "2026-11-16T14:02:00Z", "status": "queued"},
]


def test_parse_time_handles_zulu():
    assert _parse_time("2026-11-16T14:00:00Z") == SINCE


def test_find_new_run_skips_seen_and_old_runs():
    run = find_new_run(RUNS, SINCE, seen_ids={2})
    assert run is not None and run["id"] == 3


def test_find_new_run_returns_none_when_nothing_new():
    assert find_new_run(RUNS, SINCE, seen_ids={2, 3}) is None
    assert find_new_run(RUNS, datetime(2026, 11, 16, 15, 0, tzinfo=timezone.utc), seen_ids=set()) is None


def test_dispatch_test_never_reads_a_token_from_disk():
    # The script takes GH_TOKEN from the environment only; there is no
    # --token argument and no token file handling anywhere in the source.
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "dispatch_test.py"), encoding="utf-8").read()
    assert "GH_TOKEN" in src
    assert "--token" not in src
    assert ".netrc" not in src and "credentials" not in src.lower()
