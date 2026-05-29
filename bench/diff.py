#!/usr/bin/env python3
"""Diff k6 summary outputs between bench/results/baseline/ and bench/results/edge/.

Prints a table with median RPS, p50/p95/p99 latency, and error rate for each
scenario. Applies the cutover acceptance gates from infra/edge/CUTOVER.md
step 4f:

  * edge median RPS  >= 95% of Caddy median RPS
  * edge p99 latency <= 120% of Caddy p99 latency
  * edge error rate  <=  Caddy error rate + 0.1pp

Exits 0 if ALL scenarios pass every gate, 1 otherwise. The operator chains on
the exit code:

  bash bench/run-baseline.sh && bash bench/run-edge.sh && python3 bench/diff.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

SCENARIOS = ["apex-proxy", "wildcard-static", "custom-domain", "mixed-traffic"]
BASELINE_DIR = Path("bench/results/baseline")
EDGE_DIR = Path("bench/results/edge")

# Gates — see infra/edge/CUTOVER.md step 4f.
GATE_RPS_FLOOR = 0.95           # edge must hit >= 95% of baseline RPS
GATE_P99_CEIL = 1.20            # edge p99 may be at most 120% of baseline p99
GATE_ERR_DELTA = 0.001          # edge error rate may be at most baseline + 0.1pp


def load(path: Path) -> dict:
    if not path.is_file():
        raise SystemExit(f"missing summary: {path} — did the corresponding run script complete?")
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def metric(summary: dict, name: str) -> dict:
    m = summary.get("metrics", {}).get(name)
    if not m:
        raise SystemExit(f"summary missing metric `{name}`: keys={list(summary.get('metrics', {}).keys())}")
    return m


def stats(summary: dict) -> dict:
    """Extract the four numbers we compare per scenario."""
    req_dur = metric(summary, "http_req_duration")
    return {
        "median_rps": metric(summary, "http_reqs").get("rate", 0.0),
        "p50_ms": req_dur.get("med", float("nan")),
        "p95_ms": req_dur.get("p(95)", float("nan")),
        "p99_ms": req_dur.get("p(99)", float("nan")),
        "err_rate": metric(summary, "http_req_failed").get("rate", 0.0),
    }


def pct_delta(baseline: float, candidate: float) -> str:
    if baseline == 0:
        return "n/a"
    delta = (candidate - baseline) / baseline * 100.0
    sign = "+" if delta >= 0 else ""
    return f"{sign}{delta:.1f}%"


def evaluate(scen: str, base: dict, edge: dict) -> list[str]:
    failures = []
    if edge["median_rps"] < base["median_rps"] * GATE_RPS_FLOOR:
        failures.append(
            f"RPS gate failed: edge {edge['median_rps']:.1f} < {GATE_RPS_FLOOR*100:.0f}% of baseline {base['median_rps']:.1f}"
        )
    if base["p99_ms"] > 0 and edge["p99_ms"] > base["p99_ms"] * GATE_P99_CEIL:
        failures.append(
            f"p99 gate failed: edge {edge['p99_ms']:.1f}ms > {GATE_P99_CEIL*100:.0f}% of baseline {base['p99_ms']:.1f}ms"
        )
    if edge["err_rate"] > base["err_rate"] + GATE_ERR_DELTA:
        failures.append(
            f"error-rate gate failed: edge {edge['err_rate']*100:.3f}% > baseline {base['err_rate']*100:.3f}% + 0.1pp"
        )
    return failures


def main() -> int:
    if not BASELINE_DIR.is_dir() or not EDGE_DIR.is_dir():
        raise SystemExit(
            f"both {BASELINE_DIR} and {EDGE_DIR} must exist — run run-baseline.sh and run-edge.sh first"
        )

    header = (
        f"{'scenario':<18} | {'RPS (base→edge)':<25} | {'p50 ms':<18} | {'p95 ms':<18} | {'p99 ms':<18} | {'err rate':<18}"
    )
    print(header)
    print("-" * len(header))

    all_pass = True
    for scen in SCENARIOS:
        base = stats(load(BASELINE_DIR / f"{scen}.json"))
        edge = stats(load(EDGE_DIR / f"{scen}.json"))

        rps_cell = f"{base['median_rps']:.1f} → {edge['median_rps']:.1f} ({pct_delta(base['median_rps'], edge['median_rps'])})"
        p50_cell = f"{base['p50_ms']:.1f} → {edge['p50_ms']:.1f} ({pct_delta(base['p50_ms'], edge['p50_ms'])})"
        p95_cell = f"{base['p95_ms']:.1f} → {edge['p95_ms']:.1f} ({pct_delta(base['p95_ms'], edge['p95_ms'])})"
        p99_cell = f"{base['p99_ms']:.1f} → {edge['p99_ms']:.1f} ({pct_delta(base['p99_ms'], edge['p99_ms'])})"
        err_cell = f"{base['err_rate']*100:.3f}% → {edge['err_rate']*100:.3f}%"

        print(f"{scen:<18} | {rps_cell:<25} | {p50_cell:<18} | {p95_cell:<18} | {p99_cell:<18} | {err_cell:<18}")

        failures = evaluate(scen, base, edge)
        if failures:
            all_pass = False
            for msg in failures:
                print(f"    ✗ {scen}: {msg}")

    print()
    if all_pass:
        print("PASS: edge meets baseline within gates — cutover is GO per infra/edge/CUTOVER.md step 4f")
        return 0
    print("FAIL: at least one gate breached — do NOT cut over; investigate before retrying")
    return 1


if __name__ == "__main__":
    sys.exit(main())
