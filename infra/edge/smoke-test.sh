#!/usr/bin/env bash
# Post-cutover smoke for openlen-edge.
#
# Runs eight checks against the live edge, mirroring the §6 sequence in
# infra/edge/CUTOVER.md. Each prints PASS / FAIL with a one-line reason; on
# any failure the operator must roll back per CUTOVER.md §7. The script
# always runs all eight even if an early one fails — operators want the
# full diagnostic, not a fail-fast.
#
# Usage:
#   bash infra/edge/smoke-test.sh
#
# Overrides:
#   APEX=openlen.com
#   SUB=mirror                       (must have /var/www/openlen/<sub>/current/index.html)
#   CUSTOM_DOMAIN=mybrand.com        (must be verified + DNS-pointing at the box)
#   UPLOAD_FILE=path/within/uploads  (must exist under /var/openlen/uploads/<path>)
#   NEXT_STATIC_FILE=chunks/...js    (must exist under /opt/openlen-app/.next/static/<path>)
#   PROJECT_ID=<projectId>           (used for the /c/<id> beacon check)
#
# Exit code: 0 if all 8 pass, 1 otherwise.

set -uo pipefail

APEX="${APEX:-openlen.com}"
SUB="${SUB:-mirror}"
CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-}"
UPLOAD_FILE="${UPLOAD_FILE:-}"
NEXT_STATIC_FILE="${NEXT_STATIC_FILE:-}"
PROJECT_ID="${PROJECT_ID:-smoke-test-projectId}"

PASS=0
FAIL=0
FAILED_CHECKS=()

green()  { printf '\033[32m%s\033[0m' "$1"; }
red()    { printf '\033[31m%s\033[0m' "$1"; }
yellow() { printf '\033[33m%s\033[0m' "$1"; }

ok()  { PASS=$((PASS+1)); printf '  [%s] %s\n' "$(green PASS)" "$1"; }
bad() { FAIL=$((FAIL+1)); FAILED_CHECKS+=("$1"); printf '  [%s] %s\n' "$(red FAIL)" "$1: $2"; }
note() { printf '  [%s] %s: %s\n' "$(yellow NOTE)" "$1" "$2"; }

fetch_headers() {
  # $1 = host, $2 = path; prints headers + status (no body). --resolve forces
  # the destination IP to loopback so the check exercises this box even when
  # DNS still points elsewhere.
  local host="$1" path="$2"
  curl --silent --insecure --max-time 8 --head \
       --resolve "${host}:443:127.0.0.1" \
       "https://${host}${path}"
}

fetch_body() {
  local host="$1" path="$2"
  curl --silent --insecure --max-time 8 \
       --resolve "${host}:443:127.0.0.1" \
       "https://${host}${path}"
}

# ─── Check 1: apex returns 200 ──────────────────────────────────────────
check_apex_status() {
  local name="apex returns 2xx/3xx"
  local out
  out=$(fetch_headers "$APEX" "/")
  local status
  status=$(printf '%s\n' "$out" | head -1 | awk '{print $2}')
  if [[ "$status" =~ ^(200|301|302|307|308)$ ]]; then
    ok "$name (HTTP $status)"
  else
    bad "$name" "got HTTP '$status' — expected 2xx/3xx"
  fi
}

# ─── Check 2: Server header identifies the edge ─────────────────────────
check_server_header() {
  local name="Server header identifies openlen-edge"
  local out
  out=$(fetch_headers "$APEX" "/")
  if printf '%s\n' "$out" | grep -qiE '^server:[[:space:]]*openlen-edge/'; then
    ok "$name"
  else
    local sv
    sv=$(printf '%s\n' "$out" | grep -i '^server:' | head -1 | tr -d '\r')
    bad "$name" "expected 'Server: openlen-edge/...', got '$sv'"
  fi
}

# ─── Check 3: wildcard subdomain returns HTML ──────────────────────────
check_wildcard_html() {
  local name="${SUB}.${APEX} returns HTML"
  local body
  body=$(fetch_body "${SUB}.${APEX}" "/")
  if [[ -z "$body" ]]; then
    bad "$name" "empty body — check /var/www/openlen/${SUB}/current/index.html"
    return
  fi
  if printf '%s' "$body" | grep -qi '<html\|<!doctype'; then
    ok "$name"
  else
    bad "$name" "body did not look like HTML (got first 80 chars: '${body:0:80}')"
  fi
}

# ─── Check 4: /uploads/ serves direct with immutable cache ─────────────
check_shared_uploads() {
  local name="/uploads/<file> served with immutable cache"
  if [[ -z "$UPLOAD_FILE" ]]; then
    # Pick the first regular file under /var/openlen/uploads/ as the test.
    UPLOAD_FILE=$(find /var/openlen/uploads -type f -printf '%P\n' 2>/dev/null | head -1)
    if [[ -z "$UPLOAD_FILE" ]]; then
      note "$name" "no uploads on disk to test; set UPLOAD_FILE=<path> manually if any exists"
      return
    fi
  fi
  local out
  out=$(fetch_headers "$APEX" "/uploads/${UPLOAD_FILE}")
  local status
  status=$(printf '%s\n' "$out" | head -1 | awk '{print $2}')
  if [[ "$status" != "200" ]]; then
    bad "$name" "expected 200, got '$status' for /uploads/${UPLOAD_FILE}"
    return
  fi
  if printf '%s\n' "$out" | grep -qiE '^cache-control:.*immutable'; then
    ok "$name"
  else
    bad "$name" "missing 'immutable' in Cache-Control"
  fi
}

# ─── Check 5: /_next/static/ serves direct with 1y immutable ───────────
check_next_static() {
  local name="/_next/static/<file> served with 1y immutable cache"
  if [[ -z "$NEXT_STATIC_FILE" ]]; then
    NEXT_STATIC_FILE=$(find /opt/openlen-app/.next/static -type f -printf '%P\n' 2>/dev/null | head -1)
    if [[ -z "$NEXT_STATIC_FILE" ]]; then
      note "$name" "no /_next/static/ files found; check NEXT_STATIC_ROOT mount"
      return
    fi
  fi
  local out
  out=$(fetch_headers "$APEX" "/_next/static/${NEXT_STATIC_FILE}")
  local status
  status=$(printf '%s\n' "$out" | head -1 | awk '{print $2}')
  if [[ "$status" != "200" ]]; then
    bad "$name" "expected 200, got '$status' for /_next/static/${NEXT_STATIC_FILE}"
    return
  fi
  if printf '%s\n' "$out" | grep -qiE 'cache-control:.*max-age=31536000'; then
    ok "$name"
  else
    bad "$name" "missing 'max-age=31536000' in Cache-Control"
  fi
}

# ─── Check 6: /c/ beacon proxies to Node ────────────────────────────────
check_beacon_proxy() {
  local name="/c/<projectId> reaches Node (not 502)"
  local out
  out=$(fetch_headers "${SUB}.${APEX}" "/c/${PROJECT_ID}")
  local status
  status=$(printf '%s\n' "$out" | head -1 | awk '{print $2}')
  # Anything except 502/504 means the edge got an answer from Node (200 / 4xx
  # are both fine — the test point is "the proxy happened"). 502/504 means
  # the edge couldn't reach Node.
  if [[ -z "$status" ]]; then
    bad "$name" "no HTTP status returned (TLS handshake failed?)"
  elif [[ "$status" =~ ^(502|504)$ ]]; then
    bad "$name" "got $status — Node unreachable from edge"
  else
    ok "$name (HTTP $status)"
  fi
}

# ─── Check 7: /api/f/ form-submission proxies ───────────────────────────
check_form_proxy() {
  local name="/api/f/<sub> reaches Node (not 502)"
  local out
  out=$(curl --silent --insecure --max-time 8 --head \
             --resolve "${SUB}.${APEX}:443:127.0.0.1" \
             "https://${SUB}.${APEX}/api/f/${SUB}")
  local status
  status=$(printf '%s\n' "$out" | head -1 | awk '{print $2}')
  if [[ -z "$status" ]]; then
    bad "$name" "no HTTP status returned"
  elif [[ "$status" =~ ^(502|504)$ ]]; then
    bad "$name" "got $status — Node unreachable from edge"
  else
    ok "$name (HTTP $status)"
  fi
}

# ─── Check 8: custom-domain TLS + serve ─────────────────────────────────
check_custom_domain() {
  local name="custom domain handshake + serve"
  if [[ -z "$CUSTOM_DOMAIN" ]]; then
    note "$name" "CUSTOM_DOMAIN not set; skip (set it to test on-demand TLS)"
    return
  fi
  # Custom domain TLS goes via on-demand issuance, which only works when DNS
  # points at this box. Don't use --resolve here — that would mask DNS
  # misconfigurations.
  local out
  out=$(curl --silent --max-time 15 --head "https://${CUSTOM_DOMAIN}/" 2>&1)
  local status
  status=$(printf '%s\n' "$out" | grep -E '^HTTP/' | head -1 | awk '{print $2}')
  if [[ "$status" == "200" ]]; then
    ok "$name (HTTP 200 — cert issued + disk served)"
  elif [[ "$status" =~ ^(301|302|307|308)$ ]]; then
    ok "$name (HTTP $status redirect — TLS handshake succeeded)"
  else
    bad "$name" "got '$status' — TLS handshake may have failed or DB lookup empty"
  fi
}

echo "openlen-edge smoke test — $(date -Is)"
echo "  apex=${APEX} sub=${SUB} custom=${CUSTOM_DOMAIN:-<unset>}"
echo

check_apex_status
check_server_header
check_wildcard_html
check_shared_uploads
check_next_static
check_beacon_proxy
check_form_proxy
check_custom_domain

echo
TOTAL=$((PASS+FAIL))
if (( FAIL == 0 )); then
  echo "Result: $(green "${PASS}/8 PASS")"
  exit 0
else
  echo "Result: $(red "${FAIL}/8 FAIL"): ${FAILED_CHECKS[*]}"
  echo "Rollback per infra/edge/CUTOVER.md §7."
  exit 1
fi
