#!/usr/bin/env bash
# infra/caddy/install.sh — install + configure Caddy on the Hetzner box.
#
# Installs Caddy from the official Cloudsmith repo (Debian/Ubuntu),
# symlinks the repo's Caddyfile into /etc/caddy/, sets up the certbot
# deploy hook to reload Caddy on cert renewal, and configures the
# `caddy` user so it can read the existing Let's Encrypt cert files.
#
# Idempotent. Re-running just re-syncs the symlink and reload hook.
#
# Run as root or via sudo on the Hetzner box. Does NOT start Caddy —
# that's a separate step in CUTOVER.md so you can stage the swap.

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "this script must be run as root (sudo $0)" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CADDYFILE_SRC="${REPO_DIR}/infra/caddy/Caddyfile"

if [[ ! -f "${CADDYFILE_SRC}" ]]; then
  echo "Caddyfile not found at ${CADDYFILE_SRC}" >&2
  exit 1
fi

echo "──> installing Caddy from official Cloudsmith repo"
apt-get update
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
apt-get update
apt-get install -y caddy

echo "──> linking Caddyfile from ${CADDYFILE_SRC}"
install -d -m 755 /etc/caddy
# Replace the default Caddyfile shipped by the package with our symlink.
if [[ -f /etc/caddy/Caddyfile && ! -L /etc/caddy/Caddyfile ]]; then
  mv /etc/caddy/Caddyfile /etc/caddy/Caddyfile.package-default.bak
fi
ln -sfn "${CADDYFILE_SRC}" /etc/caddy/Caddyfile
# El symlink solo sirve si el usuario caddy puede ATRAVESAR el path origen.
# Corriendo desde /root/infra (el flujo del DR runbook) /root es 700 y caddy
# no llega — cazado en el ensayo DR 2026-07-17. Fallback: copia real.
if ! sudo -u caddy cat /etc/caddy/Caddyfile >/dev/null 2>&1; then
  echo "──> caddy can't traverse ${CADDYFILE_SRC}; installing a real copy instead"
  rm /etc/caddy/Caddyfile
  install -m 644 "${CADDYFILE_SRC}" /etc/caddy/Caddyfile
fi

echo "──> granting caddy user read access to Let's Encrypt certs"
# certbot stores keys with 600 root:root by default; relax to 640 root:ssl-cert
# and add caddy to the ssl-cert group so it can read them.
if ! getent group ssl-cert >/dev/null; then
  groupadd ssl-cert
fi
usermod -aG ssl-cert caddy
if [[ -d /etc/letsencrypt/live ]]; then
  chgrp -R ssl-cert /etc/letsencrypt/live /etc/letsencrypt/archive
  chmod -R g+rX     /etc/letsencrypt/live /etc/letsencrypt/archive
fi

echo "──> wiring certbot deploy hook → caddy reload"
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-caddy.sh <<'EOF'
#!/usr/bin/env bash
# Auto-installed by infra/caddy/install.sh — runs after each certbot
# renewal so Caddy picks up the rotated wildcard cert without dropping
# active TLS sessions.
systemctl reload caddy 2>/dev/null || true
EOF
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-caddy.sh

echo "──> validating Caddyfile syntax"
caddy validate --config /etc/caddy/Caddyfile

cat <<'NEXT'

✓ Caddy installed + configured.

Next steps (see infra/caddy/CUTOVER.md for the full procedure):

  1. Test the Caddyfile in dry-run:   sudo caddy run --config /etc/caddy/Caddyfile --watch
     (ctrl-c to stop; this is just a smoke test, NOT the production start)

  2. Stop nginx + start Caddy:
       sudo systemctl stop  nginx
       sudo systemctl disable nginx
       sudo systemctl enable --now caddy

  3. Verify:
       curl -I https://openlen.com
       curl -I https://<your-subdomain>.openlen.com
       sudo journalctl -u caddy -n 50 --no-pager

  4. (Once a custom domain is added in the workspace UI) test on-demand:
       curl -I https://<your-custom-domain>
NEXT
