#!/usr/bin/env bash
# Scaffold the Next.js app's runtime layout on the Hetzner box. Idempotent.
#
# Creates /opt/openlen-app (release dir, rsync target), /var/openlen/{uploads,
# witness} (persistent data), /etc/openlen/openlen.env (secrets), and
# installs + enables the openlen-app systemd unit. Does NOT start the
# service — first the operator must paste TOGETHER_API_KEY etc. into the
# env file, then `systemctl start openlen-app`.
#
# Run order (on a fresh box):
#   1. setup-node.sh       — Node 22 + Chromium
#   2. install-app.sh      — this script
#   3. paste env values into /etc/openlen/openlen.env
#   4. infra/scripts/deploy.sh from local machine
#   5. systemctl start openlen-app

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: must run as root" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# openlen-deploy user is created by setup-hetzner.sh / deploy-key-setup.md
# in Session 10. Bail with a clear error if it's missing so the operator
# knows to run those first.
if ! id -u openlen-deploy &>/dev/null; then
  echo "ERROR: user 'openlen-deploy' not found." >&2
  echo "  Run setup-hetzner.sh and deploy-key-setup.md (Session 10) first." >&2
  exit 1
fi

echo "[1/4] Creating /opt/openlen-app (release dir)..."
install -d -o openlen-deploy -g www-data -m 2775 /opt/openlen-app

echo "[2/4] Creating /var/openlen/{uploads,witness} (persistent data dirs)..."
install -d -o openlen-deploy -g www-data -m 2775 /var/openlen
install -d -o openlen-deploy -g www-data -m 2775 /var/openlen/uploads
install -d -o openlen-deploy -g www-data -m 2775 /var/openlen/witness

echo "[3/4] Creating /etc/openlen/openlen.env (secrets)..."
install -d -o root -g root -m 755 /etc/openlen
if [[ ! -f /etc/openlen/openlen.env ]]; then
  install -o root -g openlen-deploy -m 640 \
    "${SCRIPT_DIR}/env.example" /etc/openlen/openlen.env
  echo "  ↳ created from env.example — edit before starting the service:"
  echo "    nano /etc/openlen/openlen.env"
else
  echo "  ↳ already exists — leaving in place."
fi

echo "[4/4] Installing + enabling systemd unit..."
install -m 644 "${SCRIPT_DIR}/openlen-app.service" /etc/systemd/system/openlen-app.service
systemctl daemon-reload
systemctl enable openlen-app.service

echo
echo "✓ App scaffolding installed."
echo
echo "Next steps:"
echo "  1. Paste TOGETHER_API_KEY (and DATABASE_URL etc.) into /etc/openlen/openlen.env"
echo "  2. From your local machine: bash infra/scripts/deploy.sh"
echo "  3. systemctl start openlen-app"
echo "  4. journalctl -u openlen-app -f   # tail logs to confirm startup"
