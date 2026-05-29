#!/usr/bin/env bash
# Run the four bench scenarios against the edge sidecar (default :8443) while
# Caddy still owns :443. Writes JSON summary outputs into bench/results/edge/
# so bench/diff.py can compare them to the baseline.
#
# Pre-requisite: edge running with OPENLEN_EDGE_BIND=0.0.0.0:8443 (see step
# 4d in infra/edge/CUTOVER.md — the side-by-side bake-off). Caddy still
# owns :443 + :80; the edge only listens on :8443 during this phase.
#
# Usage:
#   bash bench/run-edge.sh
#
# Override defaults with env vars (see each k6 script for the full list):
#   OPENLEN_TARGET=https://127.0.0.1:8443       (default — edge sidecar)
#   OPENLEN_SUB=mirror
#   OPENLEN_CUSTOM_HOST=mybrand.com
#   DURATION=60s

set -euo pipefail

cd "$(dirname "$0")/.."

OUT=bench/results/edge
mkdir -p "$OUT"

export OPENLEN_TARGET="${OPENLEN_TARGET:-https://127.0.0.1:8443}"
export OPENLEN_HOST="${OPENLEN_HOST:-openlen.com}"
export OPENLEN_SUB="${OPENLEN_SUB:-mirror}"
export OPENLEN_CUSTOM_HOST="${OPENLEN_CUSTOM_HOST:-mybrand.com}"
export DURATION="${DURATION:-60s}"

command -v k6 >/dev/null || { echo "ERROR: k6 not in PATH. See https://k6.io/docs/get-started/installation/" >&2; exit 1; }

echo "[edge] target=$OPENLEN_TARGET host=$OPENLEN_HOST sub=$OPENLEN_SUB custom=$OPENLEN_CUSTOM_HOST duration=$DURATION"

run() {
  local name="$1"
  local script="bench/k6/${name}.js"
  local summary="${OUT}/${name}.json"
  echo "[edge] running $name"
  k6 run --quiet --insecure-skip-tls-verify --summary-export="$summary" "$script"
}

run apex-proxy
run wildcard-static
run custom-domain
run mixed-traffic

echo "[edge] done — JSON summaries in $OUT/"
echo "[edge] compare against baseline with: python3 bench/diff.py"
