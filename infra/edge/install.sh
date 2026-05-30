#!/usr/bin/env bash
# Idempotent one-time install of the openlen-edge service.
#
# What this does (in order):
#   1. Create the `openlen-edge` system user + group (no shell, no home).
#   2. Create the runtime state dir at /var/lib/openlen-edge/certs (mode 700,
#      owner openlen-edge) — the cert renewal sweep + on-demand ACME issuance
#      both write here.
#   3. Create /etc/openlen/ for edge.env (mode 755 root:root). The operator
#      fills /etc/openlen/edge.env separately (template at
#      infra/edge/edge.env.example).
#   4. setcap cap_net_bind_service=+ep on /usr/local/bin/openlen-edge as a
#      belt-and-braces fallback to systemd's AmbientCapabilities. Either
#      route lets the non-root user bind :80 + :443.
#   5. Install a certbot deploy hook so the openlen-edge group keeps read
#      access on the wildcard cert across renewals.
#   6. Apply the initial chgrp/chmod to the existing wildcard cert.
#   7. Copy infra/edge/openlen-edge.service → /etc/systemd/system/ and
#      daemon-reload.
#
# What this does NOT do:
#   * systemctl enable openlen-edge   — the cutover runbook decides timing.
#   * systemctl start openlen-edge    — same.
#   * Stop/disable Caddy               — same.
#   * Write /etc/openlen/edge.env     — the operator fills it from the
#                                      template before the first start.
#
# Re-run is safe: every step checks for existing state and skips when it
# matches. Use that to re-sync after editing the systemd unit in the repo.

set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "ERROR: install.sh must run as root (try: sudo bash infra/edge/install.sh)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UNIT_SRC="${REPO_ROOT}/infra/edge/openlen-edge.service"
UNIT_DST="/etc/systemd/system/openlen-edge.service"
BIN="/usr/local/bin/openlen-edge"
USER_NAME="openlen-edge"
GROUP_NAME="openlen-edge"
STATE_DIR="/var/lib/openlen-edge"
CERT_DIR="${STATE_DIR}/certs"
EDGE_ENV_DIR="/etc/openlen"
LETSENCRYPT_LIVE="/etc/letsencrypt/live/openlen.com"
LETSENCRYPT_ARCHIVE="/etc/letsencrypt/archive/openlen.com"
RENEWAL_HOOK="/etc/letsencrypt/renewal-hooks/deploy/openlen-edge-cert.sh"

# ─── 1. user + group ─────────────────────────────────────────────────────
if id -u "$USER_NAME" >/dev/null 2>&1; then
  echo "[install] user $USER_NAME already exists"
else
  echo "[install] creating system user $USER_NAME"
  # --system: UID < 1000, no expire; --no-create-home: no /home/openlen-edge;
  # --shell /usr/sbin/nologin: interactive login refused.
  useradd --system --no-create-home --shell /usr/sbin/nologin "$USER_NAME"
fi

# ─── 2. state dir ─────────────────────────────────────────────────────────
if [[ ! -d "$STATE_DIR" ]]; then
  echo "[install] creating $STATE_DIR"
  install -d -o "$USER_NAME" -g "$GROUP_NAME" -m 0750 "$STATE_DIR"
fi
if [[ ! -d "$CERT_DIR" ]]; then
  echo "[install] creating $CERT_DIR (mode 700)"
  install -d -o "$USER_NAME" -g "$GROUP_NAME" -m 0700 "$CERT_DIR"
fi

# ─── 3. /etc/openlen/ ────────────────────────────────────────────────────
if [[ ! -d "$EDGE_ENV_DIR" ]]; then
  echo "[install] creating $EDGE_ENV_DIR"
  install -d -o root -g root -m 0755 "$EDGE_ENV_DIR"
fi

# ─── 4. setcap on the binary (belt + braces) ─────────────────────────────
if [[ -x "$BIN" ]]; then
  if command -v setcap >/dev/null; then
    echo "[install] setcap cap_net_bind_service on $BIN"
    setcap 'cap_net_bind_service=+ep' "$BIN"
  else
    echo "[install] WARNING: setcap not in PATH — relying on systemd AmbientCapabilities only"
  fi
else
  echo "[install] WARNING: $BIN not found yet — run bash infra/scripts/deploy-edge.sh first, then re-run install"
fi

# ─── 5. certbot deploy hook ──────────────────────────────────────────────
echo "[install] writing certbot renewal hook → $RENEWAL_HOOK"
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat >"$RENEWAL_HOOK" <<'HOOK'
#!/usr/bin/env bash
# Re-grant the openlen-edge user read access after every cert rotation.
# certbot recreates the symlinks under live/ pointing at fresh files in
# archive/, so the previous chgrp/chmod doesn't survive — re-apply here.
set -euo pipefail

GROUP=openlen-edge

# Cert dirs may have a different ownership/mode in the operator-managed
# install; only touch the files we care about and ignore those that don't
# exist yet (post-renewal, pre-deploy).
for path in /etc/letsencrypt/live/openlen.com/fullchain.pem \
            /etc/letsencrypt/live/openlen.com/privkey.pem \
            /etc/letsencrypt/archive/openlen.com/fullchain*.pem \
            /etc/letsencrypt/archive/openlen.com/privkey*.pem; do
  for f in $path; do
    [[ -e "$f" ]] || continue
    chgrp "$GROUP" "$f"
    chmod 640 "$f"
  done
done

# Make sure the live/ + archive/ dirs are traversable so the openlen-edge
# user can reach the files. certbot leaves live/ at 755 but archive/ at 700
# (root-only) — without o+x on the archive/ PARENT the non-root edge can't
# traverse down to the per-domain dir below, even with the per-domain perms.
# o+x = traverse only; per-domain dirs + cert files still gate actual reads.
chmod o+x /etc/letsencrypt/live /etc/letsencrypt/archive 2>/dev/null || true
[[ -d /etc/letsencrypt/live/openlen.com ]] && \
  chgrp "$GROUP" /etc/letsencrypt/live/openlen.com && \
  chmod 750 /etc/letsencrypt/live/openlen.com
[[ -d /etc/letsencrypt/archive/openlen.com ]] && \
  chgrp "$GROUP" /etc/letsencrypt/archive/openlen.com && \
  chmod 750 /etc/letsencrypt/archive/openlen.com

# The edge's notify-based watcher should pick up the inode change on its
# own — no SIGHUP needed. If we ever switch to a poll-only watcher this
# is where the reload trigger would live.
exit 0
HOOK
chmod 0755 "$RENEWAL_HOOK"

# ─── 6. initial chgrp/chmod ──────────────────────────────────────────────
echo "[install] applying initial cert ownership (running renewal hook once)"
"$RENEWAL_HOOK" || echo "[install] WARNING: initial chgrp failed — operator should fix cert paths before starting the service"

# ─── 7. systemd unit ─────────────────────────────────────────────────────
if [[ ! -f "$UNIT_SRC" ]]; then
  echo "ERROR: unit source not found at $UNIT_SRC — wrong repo path?" >&2
  exit 1
fi
if cmp -s "$UNIT_SRC" "$UNIT_DST" 2>/dev/null; then
  echo "[install] $UNIT_DST already up to date"
else
  echo "[install] installing $UNIT_DST"
  install -m 0644 -o root -g root "$UNIT_SRC" "$UNIT_DST"
  systemctl daemon-reload
fi

cat <<'EOM'
[install] done.

Next steps (do NOT skip):
  1. Edit /etc/openlen/edge.env (copy from infra/edge/edge.env.example,
     fill OPENLEN_EDGE_DATABASE_URL + OPENLEN_EDGE_ACME_CONTACT).
     chmod 0640 /etc/openlen/edge.env
     chown root:openlen-edge /etc/openlen/edge.env

  2. If the binary isn't on the box yet:
       bash infra/scripts/deploy-edge.sh

  3. Follow infra/edge/CUTOVER.md from step 4 (side-by-side deployment).
     `systemctl enable --now openlen-edge` is a runbook decision, NOT
     done here.
EOM
