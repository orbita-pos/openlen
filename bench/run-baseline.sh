#!/usr/bin/env bash
# Run the four bench scenarios against the current Caddy listener on :443.
# Writes JSON summary outputs into bench/results/baseline/ so bench/diff.py
# can compare them to the edge run.
#
# Run this BEFORE the cutover, while Caddy is still owning :443. Re-run
# whenever the baseline needs refreshing (after a Next.js version bump, after
# a hardware change, etc.).
#
# Usage:
#   bash bench/run-baseline.sh
#
# Override defaults with env vars (see each k6 script for the full list):
#   OPENLEN_TARGET=https://127.0.0.1:443        (default — Caddy on :443)
#   OPENLEN_SUB=mirror                          (subdomain known to exist)
#   OPENLEN_CUSTOM_HOST=mybrand.com             (verified custom domain)
#   DURATION=60s                                 (per scenario)

set -euo pipefail

cd "$(dirname "$0")/.."

OUT=bench/results/baseline
mkdir -p "$OUT"

export OPENLEN_TARGET="${OPENLEN_TARGET:-https://127.0.0.1:443}"
export OPENLEN_HOST="${OPENLEN_HOST:-openlen.com}"
export OPENLEN_SUB="${OPENLEN_SUB:-mirror}"
export OPENLEN_CUSTOM_HOST="${OPENLEN_CUSTOM_HOST:-mybrand.com}"
export DURATION="${DURATION:-60s}"

command -v k6 >/dev/null || { echo "ERROR: k6 not in PATH. See https://k6.io/docs/get-started/installation/" >&2; exit 1; }

echo "[baseline] target=$OPENLEN_TARGET host=$OPENLEN_HOST sub=$OPENLEN_SUB custom=$OPENLEN_CUSTOM_HOST duration=$DURATION"

run() {
  local name="$1"
  local script="bench/k6/${name}.js"
  local summary="${OUT}/${name}.json"
  echo "[baseline] running $name"
  k6 run --quiet --insecure-skip-tls-verify --summary-export="$summary" "$script"
}

run apex-proxy
run wildcard-static
run custom-domain
run mixed-traffic

echo "[baseline] done — JSON summaries in $OUT/"
