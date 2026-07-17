#!/usr/bin/env bash
# Scaffold the Next.js app's runtime layout on the Hetzner box. Idempotent.
#
# Creates /opt/openlen-app (release dir, rsync target), /var/openlen/{uploads,
# witness} (persistent data), /etc/openlen/openlen.env (secrets), and
# installs + enables the openlen-app systemd unit. Does NOT start the
# service — first the operator must paste GEMINI_API_KEY etc. into the
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

echo "[4/4] Installing + enabling systemd units..."
install -m 644 "${SCRIPT_DIR}/openlen-app.service" /etc/systemd/system/openlen-app.service
install -m 644 "${SCRIPT_DIR}/openlen-backup.service" /etc/systemd/system/openlen-backup.service
install -m 644 "${SCRIPT_DIR}/openlen-backup.timer"   /etc/systemd/system/openlen-backup.timer
# Scheduled jobs — analytics rollup (daily) + booking reminders/retention (15m).
install -m 644 "${SCRIPT_DIR}/openlen-analytics-rollup.service"  /etc/systemd/system/openlen-analytics-rollup.service 2>/dev/null || true
install -m 644 "${SCRIPT_DIR}/openlen-analytics-rollup.timer"    /etc/systemd/system/openlen-analytics-rollup.timer   2>/dev/null || true
install -m 644 "${SCRIPT_DIR}/openlen-bookings-remind.service"   /etc/systemd/system/openlen-bookings-remind.service  2>/dev/null || true
install -m 644 "${SCRIPT_DIR}/openlen-bookings-remind.timer"     /etc/systemd/system/openlen-bookings-remind.timer    2>/dev/null || true
# Datos vivos — hourly self-refresh: curls the internal republish endpoint so
# pages bound to a Google Sheet pick up cell edits (needs OPENLEN_INTERNAL_SECRET).
install -m 644 "${SCRIPT_DIR}/openlen-live-republish.service"    /etc/systemd/system/openlen-live-republish.service   2>/dev/null || true
install -m 644 "${SCRIPT_DIR}/openlen-live-republish.timer"      /etc/systemd/system/openlen-live-republish.timer     2>/dev/null || true
# DR frío — nightly system backup (uploads + DB + /etc/openlen + manifest).
install -m 644 "${SCRIPT_DIR}/openlen-backup-system.service"    /etc/systemd/system/openlen-backup-system.service    2>/dev/null || true
install -m 644 "${SCRIPT_DIR}/openlen-backup-system.timer"      /etc/systemd/system/openlen-backup-system.timer      2>/dev/null || true
systemctl daemon-reload
systemctl enable openlen-app.service
# Backup timer stays disabled until /etc/openlen/rclone.conf is populated.
# Enable manually with: systemctl enable --now openlen-backup.timer
# Rollup + booking-reminder timers are safe to enable once the app env is set:
#   systemctl enable --now openlen-analytics-rollup.timer
#   systemctl enable --now openlen-bookings-remind.timer   # needs RESEND_API_KEY to email
#   systemctl enable --now openlen-live-republish.timer     # needs OPENLEN_INTERNAL_SECRET set

echo
echo "✓ App scaffolding installed."
echo
echo "Next steps:"
echo "  1. Paste GEMINI_API_KEY (and DATABASE_URL etc.) into /etc/openlen/openlen.env"
echo "  2. From your local machine: bash infra/scripts/deploy.sh"
echo "  3. systemctl start openlen-app"
echo "  4. journalctl -u openlen-app -f   # tail logs to confirm startup"
echo
echo "Optional — nightly R2 backup of published landings:"
echo "  a. Create /etc/openlen/rclone.conf with an [r2-published] remote (see"
echo "     infra/scripts/backup-published-to-r2.sh for the format)."
echo "  b. systemctl enable --now openlen-backup.timer"
echo
echo "Scheduled jobs (enable once the app env is populated):"
echo "  systemctl enable --now openlen-analytics-rollup.timer"
echo "  systemctl enable --now openlen-bookings-remind.timer   # booking reminders + retention"
echo "  systemctl enable --now openlen-backup-system.timer   # needs rclone.conf + /etc/openlen/backup.pass + pg_dump installed"
