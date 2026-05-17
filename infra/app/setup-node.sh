#!/usr/bin/env bash
# Install Node.js 22 LTS + Chromium on the Hetzner box. Idempotent —
# re-running is safe.
#
# Node 22 ships from NodeSource's apt repo. Chromium comes from Ubuntu's
# own apt repo and is required at runtime by the orchestrator's puppeteer
# gates (a11y + mobile). The runtime points puppeteer at the system binary
# via PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser in the env file.
#
# Usage (run as root on the box):
#   bash setup-node.sh
#
# Or push from local and run remotely:
#   scp -i ~/.ssh/openlen-admin infra/app/setup-node.sh root@<IP>:/root/
#   ssh -i ~/.ssh/openlen-admin root@<IP> "bash /root/setup-node.sh"

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: must run as root" >&2
  exit 1
fi

# ─── 1. Node.js 22 ──────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -v | grep -oP '\d+' | head -1)" -lt 22 ]]; then
  echo "[1/2] Installing Node.js 22 from NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "[1/2] Node $(node -v) already installed — skipping."
fi

# ─── 2. Chromium for puppeteer gates ────────────────────────────────────────
if ! command -v chromium-browser &>/dev/null && ! command -v chromium &>/dev/null; then
  echo "[2/2] Installing chromium-browser..."
  apt-get install -y chromium-browser || apt-get install -y chromium
else
  echo "[2/2] Chromium already installed — skipping."
fi

echo
echo "Node version:     $(node -v)"
echo "npm version:      $(npm -v)"
echo "Chromium version: $(chromium-browser --version 2>/dev/null || chromium --version 2>/dev/null || echo 'unknown')"
echo
echo "✓ Runtime ready. Next: bash install-app.sh"
