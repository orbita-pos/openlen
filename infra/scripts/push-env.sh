#!/usr/bin/env bash
# Patch /etc/openlen/openlen.env on the Hetzner box with the KEY=value
# pairs in local infra/.env.production. Existing keys in the remote file
# are preserved; matching keys are updated in place; new keys are appended.
#
# Mental model: `infra/.env.production` is a *diff* — only the vars you
# want to change. Everything else on the box stays as-is.
#
# Why a separate local file (not .env.local):
#   `.env.local` is the Next.js dev convention — FIREWORKS_API_KEY,
#   DATABASE_URL, NEXTAUTH_SECRET pointing at *dev* infra. Production
#   secrets stay physically separate so a stray dev key or a dev DB
#   URL can never reach the box.
#
# Usage (from repo root):
#   bash infra/scripts/push-env.sh
#
# First-time setup:
#   1. touch infra/.env.production
#   2. chmod 600 infra/.env.production
#   3. nano infra/.env.production       # add only the keys you want to set
#   4. bash infra/scripts/push-env.sh
#
# Example contents for infra/.env.production (typical "add CF + R2" patch):
#   CLOUDFLARE_ZONE_ID=abc123...
#   CLOUDFLARE_API_TOKEN=xxx-yyy-zzz
#   R2_PUBLISHED_BUCKET=openlen-published
#
# Comments (lines starting with #) and blank lines are ignored.
# Key format: ^[A-Z_][A-Z0-9_]*$  — anything else is skipped.
#
# Override defaults with env vars:
#   OPENLEN_BOX_IP=...           target host (default: 178.156.175.171)
#   OPENLEN_ADMIN_KEY_PATH=...   ssh key for root operations
#                                 (default: ~/.ssh/openlen-admin)
#   OPENLEN_ENV_LOCAL=...        local source file (default: infra/.env.production)
#
# Gitignore: infra/.env.production is covered by `.env*` in .gitignore.

set -euo pipefail

BOX_IP="${OPENLEN_BOX_IP:-178.156.175.171}"
ADMIN_KEY="${OPENLEN_ADMIN_KEY_PATH:-$HOME/.ssh/openlen-admin}"
LOCAL_ENV="${OPENLEN_ENV_LOCAL:-infra/.env.production}"
REMOTE_PATH="/etc/openlen/openlen.env"

for cmd in scp ssh; do
  command -v "$cmd" >/dev/null || { echo "ERROR: $cmd not found in PATH" >&2; exit 1; }
done
[[ -f "$ADMIN_KEY" ]] || { echo "ERROR: admin key not found at $ADMIN_KEY" >&2; exit 1; }

if [[ ! -f "$LOCAL_ENV" ]]; then
  echo "ERROR: $LOCAL_ENV not found." >&2
  echo "  Create it with the KEY=value lines you want to patch:" >&2
  echo "    touch $LOCAL_ENV && chmod 600 $LOCAL_ENV && nano $LOCAL_ENV" >&2
  exit 1
fi

# Count valid KEY=value lines (skip comments/blanks).
valid_pairs="$(grep -cE '^[A-Z_][A-Z0-9_]*=' "$LOCAL_ENV" || true)"
if [[ "$valid_pairs" -eq 0 ]]; then
  echo "ERROR: $LOCAL_ENV contains no KEY=value lines to patch." >&2
  echo "  Format: each line is KEY=value (comments with # are ignored)." >&2
  exit 1
fi

# Warn if local file is world-readable — it holds secrets.
perms="$(stat -c '%a' "$LOCAL_ENV" 2>/dev/null || stat -f '%A' "$LOCAL_ENV" 2>/dev/null || echo "")"
if [[ -n "$perms" && "$perms" != "600" && "$perms" != "400" ]]; then
  echo "WARNING: $LOCAL_ENV has perms $perms — recommend 'chmod 600 $LOCAL_ENV'."
fi

# Show which keys we're about to patch (values redacted).
echo "[1/4] Keys to patch:"
grep -E '^[A-Z_][A-Z0-9_]*=' "$LOCAL_ENV" | awk -F= '{ print "  " $1 }'
echo

echo "[2/4] Uploading patch to root@${BOX_IP}:/tmp/openlen.env.patch..."
scp -i "$ADMIN_KEY" -o StrictHostKeyChecking=accept-new \
  "$LOCAL_ENV" \
  "root@${BOX_IP}:/tmp/openlen.env.patch"

echo "[3/4] Merging into ${REMOTE_PATH}..."
# Heredoc is single-quoted so $0, $1, $key etc inside awk are NOT
# expanded by the local shell — they stay literal for the remote awk.
ssh -i "$ADMIN_KEY" -o StrictHostKeyChecking=accept-new "root@${BOX_IP}" 'bash -s' <<'REMOTE'
set -euo pipefail

if [[ ! -f /etc/openlen/openlen.env ]]; then
  echo "ERROR: /etc/openlen/openlen.env doesn't exist on the box." >&2
  echo "  Run infra/app/install-app.sh first to scaffold it." >&2
  rm -f /tmp/openlen.env.patch
  exit 1
fi

# awk merge: load patch into associative array, then walk existing env.
# Lines whose key matches the patch get replaced; unmatched lines pass
# through; any patch keys not seen in the existing file are appended.
awk '
  # First pass: read patch file into `patch[key] = value`.
  FNR==NR {
    if (/^[[:space:]]*#/ || /^[[:space:]]*$/) next
    idx = index($0, "=")
    if (idx == 0) next
    key = substr($0, 1, idx-1)
    val = substr($0, idx+1)
    gsub(/[[:space:]]/, "", key)
    if (key !~ /^[A-Z_][A-Z0-9_]*$/) next
    patch[key] = val
    order[++n] = key
    next
  }
  # Second pass: existing env. Replace matching keys, pass others through.
  /^[A-Z_][A-Z0-9_]*=/ {
    idx = index($0, "=")
    key = substr($0, 1, idx-1)
    if (key in patch) {
      print key "=" patch[key]
      used[key] = 1
      next
    }
  }
  { print }
  END {
    # Append any patch keys that werent in the existing file (preserving
    # the order they appeared in the patch).
    for (i = 1; i <= n; i++) {
      k = order[i]
      if (!(k in used)) print k "=" patch[k]
    }
  }
' /tmp/openlen.env.patch /etc/openlen/openlen.env > /tmp/openlen.env.merged

# Normalize line endings: a Windows-edited infra/.env.production carries CRLF,
# and a trailing \r in a value (e.g. an API token) makes the app read it as
# "value\r" → silent 401s that look like a wrong key. Strip CR before install.
sed -i 's/\r$//' /tmp/openlen.env.merged

# Sanity: merged file must be non-empty and contain at least the keys
# the app needs to boot. If something went wrong, bail without touching
# the live env.
if [[ ! -s /tmp/openlen.env.merged ]]; then
  echo "ERROR: merged env is empty — refusing to install" >&2
  rm -f /tmp/openlen.env.patch /tmp/openlen.env.merged
  exit 1
fi
for required in DATABASE_URL NEXTAUTH_SECRET; do
  if ! grep -qE "^${required}=." /tmp/openlen.env.merged; then
    echo "ERROR: merged env is missing ${required}= — refusing to install" >&2
    echo "  (Existing /etc/openlen/openlen.env may be corrupt; investigate before retrying.)" >&2
    rm -f /tmp/openlen.env.patch /tmp/openlen.env.merged
    exit 1
  fi
done

chown root:openlen-deploy /tmp/openlen.env.merged
chmod 640 /tmp/openlen.env.merged
mv /tmp/openlen.env.merged /etc/openlen/openlen.env
rm -f /tmp/openlen.env.patch

systemctl restart openlen-app
systemctl is-active openlen-app >/dev/null
echo "  ↳ openlen-app restarted and active"
REMOTE

echo "[4/4] Done."
echo
echo "Tail logs to verify:"
echo "  ssh -i $ADMIN_KEY root@${BOX_IP} 'journalctl -u openlen-app -n 50 -f'"
