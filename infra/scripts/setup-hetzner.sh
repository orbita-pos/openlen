#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# OpenLen — Hetzner box setup (idempotent)
#
# Provisions a fresh Ubuntu 24.04 box to serve *.openlen.com landings:
#   - nginx + certbot + ufw + fail2ban installed
#   - openlen-deploy user (member of www-data) for SCP-based deploys
#   - /var/www/openlen web root with shared write perms (deploy) + read (nginx)
#   - UFW firewall: SSH + HTTP + HTTPS
#   - Wildcard TLS cert via Let's Encrypt DNS-01 (cloudflare.ini required)
#   - certbot.timer auto-renewal
#
# Idempotent: re-running is safe. Each step checks before mutating.
#
# Usage (run as root):
#   ssh root@<HETZNER_IP> 'bash -s' < infra/scripts/setup-hetzner.sh
#
# Or push first then run:
#   scp infra/scripts/setup-hetzner.sh root@<HETZNER_IP>:/root/
#   ssh root@<HETZNER_IP> "bash /root/setup-hetzner.sh"
#
# Prerequisite: /etc/letsencrypt/cloudflare.ini must exist with the API
# token before the cert step runs. See infra/dns/CLOUDFLARE_TOKEN.md.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

DOMAIN="openlen.com"
DEPLOY_USER="openlen-deploy"
WEB_ROOT="/var/www/openlen"
CERT_EMAIL="${CERT_EMAIL:-jose12cheti12@gmail.com}"

# ─── Guardrails ───────────────────────────────────────────────────────────────

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: must run as root (sudo bash setup-hetzner.sh)" >&2
  exit 1
fi

if ! grep -q "Ubuntu" /etc/os-release; then
  echo "WARNING: this script is tested on Ubuntu 24.04. Detected:"
  cat /etc/os-release | grep PRETTY_NAME
  read -rp "Continue anyway? [y/N] " ans
  [[ "${ans,,}" == "y" ]] || exit 1
fi

log() { printf "\n\033[1;36m[%s]\033[0m %s\n" "$(date +%H:%M:%S)" "$*"; }

# ─── 1. Base packages ─────────────────────────────────────────────────────────

log "[1/8] Installing base packages (nginx, certbot, ufw, fail2ban)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y \
  nginx \
  certbot \
  python3-certbot-dns-cloudflare \
  ufw \
  fail2ban \
  curl \
  ca-certificates \
  rclone

# ─── 2. Deploy user ───────────────────────────────────────────────────────────

log "[2/8] Setting up ${DEPLOY_USER} user..."
if id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  echo "  ${DEPLOY_USER} already exists — skipping create"
else
  useradd --create-home --shell /bin/bash --groups www-data "${DEPLOY_USER}"
  echo "  created ${DEPLOY_USER}"
fi

# SSH dir — public key gets added separately via infra/scripts/deploy-key-setup.md
install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 700 \
  "/home/${DEPLOY_USER}/.ssh"
touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"

# ─── 3. Web root ──────────────────────────────────────────────────────────────

log "[3/8] Creating ${WEB_ROOT} with deploy/www-data perms..."
install -d -o "${DEPLOY_USER}" -g www-data -m 2775 "${WEB_ROOT}"
install -d -o "${DEPLOY_USER}" -g www-data -m 2775 "${WEB_ROOT}/_default"

# Default 404 will be installed by infra/nginx/install-config.sh in a later
# step. We just ensure the directory exists here.

# ─── 4. UFW firewall ──────────────────────────────────────────────────────────

log "[4/8] Configuring UFW (22/tcp, 80/tcp, 443/tcp)..."
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp  comment 'SSH'
ufw allow 80/tcp  comment 'HTTP — Let''s Encrypt + redirect'
ufw allow 443/tcp comment 'HTTPS — landings'
ufw --force enable
ufw status verbose

# ─── 5. fail2ban ──────────────────────────────────────────────────────────────

log "[5/8] Enabling fail2ban (default sshd jail)..."
systemctl enable fail2ban
systemctl restart fail2ban
fail2ban-client status

# ─── 6. nginx baseline ────────────────────────────────────────────────────────

log "[6/8] Verifying nginx is installed and listening..."
systemctl enable nginx
systemctl start nginx
nginx -t

# ─── 7. TLS wildcard cert via Let's Encrypt DNS-01 ────────────────────────────

log "[7/8] Issuing wildcard cert for ${DOMAIN} and *.${DOMAIN}..."

CF_INI="/etc/letsencrypt/cloudflare.ini"
if [[ ! -f "${CF_INI}" ]]; then
  echo
  echo "  ⚠️  ${CF_INI} not found."
  echo "  Add it before running certbot — see infra/dns/CLOUDFLARE_TOKEN.md."
  echo "  Skipping cert issuance. Re-run this script after adding the file."
  echo
else
  chmod 600 "${CF_INI}"
  chown root:root "${CF_INI}"

  if [[ -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
    echo "  Cert already exists at /etc/letsencrypt/live/${DOMAIN} — skipping"
  else
    certbot certonly \
      --dns-cloudflare \
      --dns-cloudflare-credentials "${CF_INI}" \
      --dns-cloudflare-propagation-seconds 60 \
      --non-interactive \
      --agree-tos \
      --email "${CERT_EMAIL}" \
      -d "${DOMAIN}" \
      -d "*.${DOMAIN}"
  fi

  # Auto-renewal: certbot ships a systemd timer in Ubuntu 24.04. Make sure
  # it's enabled.
  systemctl enable certbot.timer
  systemctl start certbot.timer

  echo
  echo "  Testing renewal (dry run)..."
  if certbot renew --dry-run; then
    echo "  ✓ Renewal dry-run succeeded"
  else
    echo "  ⚠️  Renewal dry-run failed — check ${CF_INI} permissions/contents"
  fi
fi

# ─── 8. Summary ───────────────────────────────────────────────────────────────

log "[8/8] Setup complete."

cat <<EOF

  Done. What you have now:

    • nginx running, firewall + fail2ban active
    • ${DEPLOY_USER} user ready (add SSH pub key — see deploy-key-setup.md)
    • ${WEB_ROOT}/ writable by ${DEPLOY_USER}, readable by www-data
    • TLS cert at /etc/letsencrypt/live/${DOMAIN}/ (if cloudflare.ini was present)
    • certbot.timer enabled — auto-renewal at the default daily schedule

  Next:
    1. Push the nginx config:
         scp -r infra/nginx root@<HETZNER_IP>:/root/openlen-nginx
         ssh root@<HETZNER_IP> "bash /root/openlen-nginx/install-config.sh"
    2. Add deploy user public key — see infra/scripts/deploy-key-setup.md
    3. Smoke test — see infra/scripts/smoke-test.md

EOF
