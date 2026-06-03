#!/usr/bin/env bash
# OpenLen — dedicated Postgres box setup (Hetzner CX33, 8 GB, private-network only).
#
# Idempotent: safe to re-run. The ONE destructive step (zpool create) is guarded
# behind CONFIRM_WIPE=yes and a device that must be empty. READ before running.
#
# Usage (on the fresh CX33, as root):
#   ZPOOL_DEVICE=/dev/sdb PRIVATE_IP=10.0.0.3 APP_IP=10.0.0.2 CONFIRM_WIPE=yes \
#     bash setup-db-box.sh
#
# Leaves Postgres 17 running on ZFS, tuned, scram-only, listening on localhost +
# the private IP. WAL archiving stays OFF until pgBackRest is configured (next
# batch) — turning archive_mode on without a working archive_command fills the
# disk. Roles + cutover are separate steps (see roles.sql + MIGRATION_RUNBOOK.md).
set -euo pipefail

PG_VERSION=17
PRIVATE_IP="${PRIVATE_IP:-10.0.0.3}"
APP_IP="${APP_IP:-10.0.0.2}"
ZPOOL_DEVICE="${ZPOOL_DEVICE:-}"
ARC_MAX_BYTES="${ARC_MAX_BYTES:-3221225472}" # 3 GiB ZFS ARC cap on an 8 GB box
DATA_DIR="/var/lib/postgresql/${PG_VERSION}/main"
WAL_DIR="/var/lib/postgresql/${PG_VERSION}/wal"
CONF_SRC_DIR="$(cd "$(dirname "$0")" && pwd)/conf"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root"

# ── 1. ZFS ARC cap BEFORE the module loads (an 8 GB box can't give ARC 50%) ──
say "Capping ZFS ARC at $((ARC_MAX_BYTES/1024/1024)) MiB"
echo "options zfs zfs_arc_max=${ARC_MAX_BYTES}" >/etc/modprobe.d/zfs.conf

# ── 2. Packages: ZFS, PGDG Postgres 17, pgBackRest ──
say "Installing packages (zfs, postgresql-${PG_VERSION}, pgbackrest)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq zfsutils-linux ca-certificates curl gnupg lsb-release
if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
  echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    >/etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
fi
apt-get install -y -qq "postgresql-${PG_VERSION}" "postgresql-contrib-${PG_VERSION}" pgbackrest openssl

# pgvector (extension only — no speculative pipeline)
apt-get install -y -qq "postgresql-${PG_VERSION}-pgvector" || \
  say "pgvector package not found for PG${PG_VERSION} (skip; add later)"

# ── 3. ZFS pool + datasets (DESTRUCTIVE — guarded) ──
if zpool list pgpool >/dev/null 2>&1; then
  say "zpool 'pgpool' already exists — skipping pool creation"
else
  [ -n "$ZPOOL_DEVICE" ] || die "ZPOOL_DEVICE unset and no pgpool exists. Set it to an EMPTY block device (e.g. an attached Hetzner Volume)."
  [ -b "$ZPOOL_DEVICE" ] || die "$ZPOOL_DEVICE is not a block device"
  [ "${CONFIRM_WIPE:-}" = "yes" ] || die "Refusing to create a pool on $ZPOOL_DEVICE without CONFIRM_WIPE=yes (this ERASES the device)."
  if blkid "$ZPOOL_DEVICE" >/dev/null 2>&1; then
    die "$ZPOOL_DEVICE already has a filesystem/signature. Refusing to wipe automatically — wipe it yourself if you're sure."
  fi
  say "Creating zpool 'pgpool' on $ZPOOL_DEVICE"
  zpool create -f -o ashift=12 \
    -O compression=zstd -O atime=off -O xattr=sa -O acltype=posixacl \
    -O mountpoint=none pgpool "$ZPOOL_DEVICE"
  # Postgres-tuned datasets: 32K records, separate WAL, latency-biased log.
  zfs create -o recordsize=32K -o logbias=latency -o mountpoint="${DATA_DIR}" pgpool/data
  zfs create -o recordsize=32K -o logbias=latency -o mountpoint="${WAL_DIR}"  pgpool/wal
  chown -R postgres:postgres /var/lib/postgresql
  chmod 700 "${DATA_DIR}" "${WAL_DIR}"
fi

# ── 4. Re-init the cluster onto the ZFS data dir ──
# PGDG installs a default cluster on the root fs; move it onto ZFS cleanly.
if [ -f "${DATA_DIR}/PG_VERSION" ]; then
  say "Cluster already initialized at ${DATA_DIR} — skipping initdb"
else
  say "Initializing PG${PG_VERSION} cluster on ZFS (waldir on separate dataset)"
  pg_dropcluster "${PG_VERSION}" main --stop 2>/dev/null || true
  pg_createcluster "${PG_VERSION}" main -d "${DATA_DIR}" -- \
    --waldir="${WAL_DIR}" --auth-host=scram-sha-256 --auth-local=peer
fi

# ── 5. Server TLS cert (self-signed; app connects over the private net) ──
# Upgrade to a real/verify-full cert later (see MIGRATION_RUNBOOK hardening).
if [ ! -f "${DATA_DIR}/server.crt" ]; then
  say "Generating self-signed server cert"
  openssl req -new -x509 -days 825 -nodes -subj "/CN=openlen-db" \
    -keyout "${DATA_DIR}/server.key" -out "${DATA_DIR}/server.crt"
  chown postgres:postgres "${DATA_DIR}/server.key" "${DATA_DIR}/server.crt"
  chmod 600 "${DATA_DIR}/server.key"
fi

# ── 6. Drop in tuned config + pg_hba (rendered with the real IPs) ──
say "Installing postgresql.openlen.conf + pg_hba"
ETC="/etc/postgresql/${PG_VERSION}/main"
install -d "${ETC}/conf.d"
sed -e "s/__PRIVATE_IP__/${PRIVATE_IP}/g" \
    "${CONF_SRC_DIR}/postgresql.openlen.conf" > "${ETC}/conf.d/10-openlen.conf"
grep -q "include_dir = 'conf.d'" "${ETC}/postgresql.conf" || \
  echo "include_dir = 'conf.d'" >> "${ETC}/postgresql.conf"
sed -e "s/__APP_IP__/${APP_IP}/g" \
    "${CONF_SRC_DIR}/pg_hba.openlen.conf" > "${ETC}/pg_hba.conf"
chown postgres:postgres "${ETC}/pg_hba.conf"

# ── 7. /etc/openlen secrets dir (mirror the app box's model) ──
install -d -m 750 -o root -g postgres /etc/openlen
[ -f /etc/openlen/db.env ] || {
  cat >/etc/openlen/db.env <<'EOF'
# Per-role DB passwords — fill these, then run roles.sql. 640 root:postgres.
OPENLEN_APP_PASSWORD=
OPENLEN_MIGRATE_PASSWORD=
OPENLEN_BACKUP_PASSWORD=
OPENLEN_EDGE_RO_PASSWORD=
OPENLEN_METRICS_PASSWORD=
EOF
  chmod 640 /etc/openlen/db.env
  chown root:postgres /etc/openlen/db.env
}

# ── 8. Restart + report ──
say "Restarting Postgres ${PG_VERSION}"
systemctl restart "postgresql@${PG_VERSION}-main"
systemctl enable postgresql >/dev/null 2>&1 || true

say "Done. Next:"
cat <<EOF
  1. Edit /etc/openlen/db.env with strong passwords.
  2. Create roles:   sudo -u postgres psql -v ON_ERROR_STOP=1 -f roles.sql
  3. Firewall: confirm Hetzner Cloud Firewall denies inbound 5432 from the internet
     (this script does NOT manage the cloud firewall — do it in the Hetzner console).
  4. Cutover from Neon — see MIGRATION_RUNBOOK.md.
  WAL archiving (archive_mode) stays OFF until pgBackRest is set up (next batch).
EOF
