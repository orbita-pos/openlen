#!/usr/bin/env bash
# Live smoke — read-only HTTP checks of a deployed OpenLen.
# Confirms routing, auth gates, the billing webhook signature/method, security
# headers, robots/sitemap. Does NOT mutate anything and does NOT exercise the
# browser/external flows (AI gen, OAuth, real payment, email delivery, publish)
# — those are the manual checklist in infra/DEPLOY_RUNBOOK.md §3.
#
# Usage:  bash infra/scripts/smoke-live.sh [BASE_URL]
#         bash infra/scripts/smoke-live.sh https://openlen.com   (default)
set -u

BASE="${1:-https://openlen.com}"
BASE="${BASE%/}"
PASS=0; FAIL=0; WARN=0
CURL="curl -sS --max-time 20"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; WARN=$((WARN+1)); }

# status <label> <path> <expected-regex> [METHOD]
status() {
  local label="$1" path="$2" exp="$3" method="${4:-GET}"
  local code
  code=$($CURL -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" 2>/dev/null || echo 000)
  if [[ "$code" =~ $exp ]]; then ok "$label ($method $path → $code)"
  else bad "$label ($method $path → $code, expected $exp)"; fi
}

# redirects_to <label> <path> <location-substring>
redirects_to() {
  local label="$1" path="$2" want="$3" code loc
  code=$($CURL -o /dev/null -w '%{http_code}' "$BASE$path" 2>/dev/null || echo 000)
  loc=$($CURL -o /dev/null -w '%{redirect_url}' "$BASE$path" 2>/dev/null || echo "")
  if [[ "$code" =~ ^30[1278]$ && "$loc" == *"$want"* ]]; then ok "$label ($path → $code → …$want)"
  else bad "$label ($path → $code → ${loc:-none}, wanted redirect to …$want)"; fi
}

# body_has <label> <path> <grep-pattern>
body_has() {
  local label="$1" path="$2" pat="$3"
  if $CURL "$BASE$path" 2>/dev/null | grep -qi "$pat"; then ok "$label"
  else bad "$label ($path body missing /$pat/)"; fi
}

printf '\n=== OpenLen live smoke — %s ===\n\n' "$BASE"

printf '• Routing + public pages\n'
redirects_to "root negotiates locale" "/" "/en"
status "home en"            "/en"            '^200$'
status "home es"            "/es"            '^200$'
body_has "home renders brand" "/en" "OpenLen"
for p in /en/templates /en/blog /en/docs /en/support \
         /en/privacy /en/terms /en/refund /en/cookie-policy \
         /en/acceptable-use /en/subprocessors /en/login /en/register /en/forgot; do
  status "page $p" "$p" '^200$'
done
status "robots.txt"  "/robots.txt"  '^200$'
status "sitemap.xml" "/sitemap.xml" '^200$'
status "icon.svg"    "/icon.svg"    '^200$'
status "404 on unknown route" "/en/__definitely_not_a_page__" '^404$'

printf '\n• Auth gates (logged-out)\n'
redirects_to "/new → login"      "/new"      "login"
redirects_to "/projects → login" "/projects" "login"

printf '\n• Billing endpoints (no real payment)\n'
status "checkout GET anon → login" "/api/billing/checkout" '^30[1278]$'
status "webhook rejects GET"       "/api/billing/webhook"  '^405$'
# Webhook with no signature: 403 = secret configured + forged event rejected (good).
# 500 = POLAR_WEBHOOK_SECRET not set on the box (config gap, not a crash).
wcode=$($CURL -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
  -d '{"type":"subscription.active","data":{"id":"x","status":"active"}}' \
  "$BASE/api/billing/webhook" 2>/dev/null || echo 000)
case "$wcode" in
  403) ok  "webhook rejects unsigned POST (403 — POLAR_WEBHOOK_SECRET is set)";;
  500) warn "webhook POST → 500: POLAR_WEBHOOK_SECRET NOT set on the box (billing disabled until configured)";;
  *)   bad "webhook unsigned POST → $wcode (expected 403, or 500 if secret unset)";;
esac

printf '\n• AI generation endpoint (wiring only)\n'
status "generate rejects GET" "/api/generate" '^405$'

printf '\n• Security headers (on /en) — Caddy-added in prod\n'
hdr=$($CURL -D - -o /dev/null "$BASE/en" 2>/dev/null | tr -d '\r')
for h in "strict-transport-security" "x-content-type-options" "x-frame-options"; do
  if grep -qi "^$h:" <<<"$hdr"; then ok "header $h"; else warn "header $h missing (check Caddy config)"; fi
done

printf '\n=== Summary: %d passed · %d warnings · %d failed ===\n' "$PASS" "$WARN" "$FAIL"
printf 'Next: the manual browser/external smokes in infra/DEPLOY_RUNBOOK.md §3\n\n'
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
