#!/usr/bin/env bash
# Build the Next.js app locally + rsync the standalone artifacts to the box
# + restart the systemd unit. Run from the repo root on your dev machine.
#
# Usage:
#   bash infra/scripts/deploy.sh
#
# Override defaults with env vars:
#   OPENLEN_BOX_IP=...   target host (default: 178.156.175.171)
#   OPENLEN_DEPLOY_KEY_PATH=...   ssh key for rsync user (default: ~/.ssh/openlen-deploy)
#   OPENLEN_ADMIN_KEY_PATH=...    ssh key for root systemctl restart (default: ~/.ssh/openlen-admin)
#
# Idempotent: safe to run repeatedly. Rsync --delete keeps /opt/openlen-app
# in lockstep with .next/standalone/; persistent data in /var/openlen is
# untouched (the rsync target is /opt/openlen-app, not /var).

set -euo pipefail

BOX_IP="${OPENLEN_BOX_IP:-178.156.175.171}"
DEPLOY_KEY="${OPENLEN_DEPLOY_KEY_PATH:-$HOME/.ssh/openlen-deploy}"
ADMIN_KEY="${OPENLEN_ADMIN_KEY_PATH:-$HOME/.ssh/openlen-admin}"
REMOTE_USER="openlen-deploy"
REMOTE_DIR="/opt/openlen-app"

# Pre-flight: required tools and keys present.
for cmd in rsync ssh npm; do
  command -v "$cmd" >/dev/null || { echo "ERROR: $cmd not found in PATH" >&2; exit 1; }
done
[[ -f "$DEPLOY_KEY" ]] || { echo "ERROR: deploy key not found at $DEPLOY_KEY" >&2; exit 1; }
[[ -f "$ADMIN_KEY"  ]] || { echo "ERROR: admin key not found at $ADMIN_KEY"   >&2; exit 1; }

echo "[1/5] Building Next.js standalone..."
npm run build

# Next.js standalone leaves .next/static/ and public/ outside .next/standalone/.
# They must live alongside server.js at runtime, so we copy them in before rsync.
# Done locally rather than on the box so a botched build doesn't corrupt a
# running release.
echo "[2/5] Composing standalone output (copying static + public)..."
mkdir -p .next/standalone/.next/static
cp -r .next/static/. .next/standalone/.next/static/
if [[ -d public ]]; then
  mkdir -p .next/standalone/public
  cp -r public/. .next/standalone/public/
fi

echo "[3/5] Rsyncing to ${REMOTE_USER}@${BOX_IP}:${REMOTE_DIR}..."
rsync -avz --delete \
  -e "ssh -i $DEPLOY_KEY -o StrictHostKeyChecking=accept-new" \
  .next/standalone/ \
  "${REMOTE_USER}@${BOX_IP}:${REMOTE_DIR}/"

echo "[4/5] Restarting openlen-app.service..."
# openlen-deploy can't run systemctl; only the admin key can.
ssh -i "$ADMIN_KEY" -o StrictHostKeyChecking=accept-new "root@${BOX_IP}" \
  "systemctl restart openlen-app && systemctl is-active openlen-app"

echo "[5/5] Verifying https://openlen.com responds..."
sleep 2
if curl -fsS -I --resolve "openlen.com:443:${BOX_IP}" https://openlen.com | head -1 | grep -qE 'HTTP/[12](\.[01])? (200|301|302|307|308)'; then
  echo "  ↳ apex returned a 2xx/3xx"
else
  echo "  ↳ WARNING: apex did not return a 2xx/3xx response."
  echo "    Check logs:  ssh -i $ADMIN_KEY root@$BOX_IP 'journalctl -u openlen-app -n 50'"
  exit 1
fi

echo
echo "✓ Deploy complete."
