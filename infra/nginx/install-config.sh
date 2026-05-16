#!/usr/bin/env bash
# Install OpenLen nginx config + default 404 page, then reload nginx.
#
# Idempotent: re-running is safe. Replaces existing symlink + reloads.
# Run on the Hetzner box after setup-hetzner.sh has finished and TLS certs
# exist at /etc/letsencrypt/live/openlen.com/.
#
# Usage:
#   sudo bash install-config.sh
#
# Or push from local and run remotely:
#   scp -r infra/nginx root@<HETZNER_IP>:/root/openlen-nginx
#   ssh root@<HETZNER_IP> "bash /root/openlen-nginx/install-config.sh"

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: must run as root" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_NAME="openlen"
WEB_ROOT="/var/www/openlen"

# ─── 1. Verify TLS cert exists (or warn and continue) ────────────────────────
if [[ ! -f /etc/letsencrypt/live/openlen.com/fullchain.pem ]]; then
  echo "WARNING: TLS cert at /etc/letsencrypt/live/openlen.com/ not found."
  echo "  nginx -t will fail until the cert is issued."
  echo "  Run setup-hetzner.sh first (it issues the cert via certbot-dns-cloudflare)."
  echo
  read -rp "Continue anyway? [y/N] " ans
  [[ "${ans,,}" == "y" ]] || exit 1
fi

# ─── 2. Install site config ──────────────────────────────────────────────────
echo "Installing nginx site config..."
install -m 644 "${SCRIPT_DIR}/openlen.conf" "/etc/nginx/sites-available/${SITE_NAME}"
ln -sfn "/etc/nginx/sites-available/${SITE_NAME}" "/etc/nginx/sites-enabled/${SITE_NAME}"

# ─── 3. Disable nginx default site ───────────────────────────────────────────
if [[ -L /etc/nginx/sites-enabled/default ]] || [[ -f /etc/nginx/sites-enabled/default ]]; then
  echo "Disabling default nginx site..."
  rm -f /etc/nginx/sites-enabled/default
fi

# ─── 4. Install default 404 page ─────────────────────────────────────────────
echo "Installing default 404 page..."
install -d -o openlen-deploy -g www-data -m 2775 "${WEB_ROOT}/_default"
install -o openlen-deploy -g www-data -m 644 \
  "${SCRIPT_DIR}/default-404.html" "${WEB_ROOT}/_default/404.html"

# ─── 5. Test config + reload ─────────────────────────────────────────────────
echo "Testing nginx config..."
nginx -t

echo "Reloading nginx..."
systemctl reload nginx

echo
echo "✓ nginx config installed and reloaded."
echo
echo "Smoke test:"
echo "  curl -I https://nothing.openlen.com   # → 404 + default 404.html"
echo "  See infra/scripts/smoke-test.md for the full suite."
