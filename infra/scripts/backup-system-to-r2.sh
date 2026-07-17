#!/usr/bin/env bash
#
# Nightly system backup → R2 `openlen-backup` bucket. Complements
# backup-published-to-r2.sh (which covers /var/www/openlen): this one covers
# everything else a dead box would lose —
#   uploads/   /var/openlen/uploads (skipped if prod stores uploads in R2)
#   db/        encrypted pg_dump of Neon, newest 7 kept
#   etc/       encrypted tar of /etc/openlen (minus backup.pass), newest 7 kept
#   manifest/  which openlen units/timers are enabled + tool versions
#
# Triggered by openlen-backup-system.timer. Manual run:
#   bash infra/scripts/backup-system-to-r2.sh
#
# Requires:
#   /etc/openlen/rclone.conf  — [r2-published] remote (same file the pages
#                               backup uses; its token must reach the
#                               openlen-backup bucket too)
#   /etc/openlen/backup.pass  — encryption passphrase. NOT backed up with the
#                               data it encrypts; the operator keeps a copy in
#                               their password manager. Without it the db/ and
#                               etc/ objects are unreadable.
#   pg_dump — version >= the Neon server major version.

set -euo pipefail

RCLONE_CONF="${RCLONE_CONF:-/etc/openlen/rclone.conf}"
REMOTE="${OPENLEN_SYSBACKUP_REMOTE:-r2-published:openlen-backup}"
PASS_FILE="${OPENLEN_BACKUP_PASS:-/etc/openlen/backup.pass}"
ENV_FILE="${OPENLEN_ENV_FILE:-/etc/openlen/openlen.env}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/openlen/uploads}"
KEEP=7

STAMP="$(date -u +%Y%m%d)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

[[ -f "$RCLONE_CONF" ]] || { echo "error: no rclone config at $RCLONE_CONF" >&2; exit 1; }
[[ -f "$PASS_FILE" ]] || { echo "error: no passphrase at $PASS_FILE" >&2; exit 1; }

rc() { rclone --config "$RCLONE_CONF" "$@"; }

encrypt() { # encrypt SRC DST
  openssl enc -aes-256-cbc -pbkdf2 -pass "file:$PASS_FILE" -in "$1" -out "$2"
}

# Keep the newest $KEEP objects under REMOTE/<prefix>/ (names embed the date,
# so lexicographic sort == chronological). List-based on purpose: an age-based
# prune could delete every copy if the backup had been failing for a week.
prune() { # prune PREFIX
  rc lsf "$REMOTE/$1/" | sort | head -n "-$KEEP" | while read -r f; do
    [[ -n "$f" ]] && rc deletefile "$REMOTE/$1/$f" && echo "  pruned $1/$f"
  done
}

# ── 1. uploads ──────────────────────────────────────────────────────────────
if [[ -d "$UPLOADS_DIR" ]]; then
  echo "== uploads: sync $UPLOADS_DIR"
  rc sync "$UPLOADS_DIR/" "$REMOTE/uploads/" --transfers 8 --retries 3 --log-level INFO
else
  echo "== uploads: skip ($UPLOADS_DIR not present — prod likely stores uploads in R2)"
fi

# ── 2. DB dump (Neon) ───────────────────────────────────────────────────────
# Direct (unpooled) URL first: pg_dump can't ride a transaction pooler.
DB_URL=""
for key in DATABASE_URL_DIRECT DATABASE_URL_UNPOOLED DATABASE_URL; do
  DB_URL="$(grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"' || true)"
  [[ -n "$DB_URL" ]] && { echo "== db: dumping via $key"; break; }
done
if [[ -n "$DB_URL" ]]; then
  pg_dump "$DB_URL" --format=custom --no-owner --file="$WORK/db.dump"
  encrypt "$WORK/db.dump" "$WORK/openlen-$STAMP.dump.enc"
  rc copyto "$WORK/openlen-$STAMP.dump.enc" "$REMOTE/db/openlen-$STAMP.dump.enc"
  prune db
else
  echo "== db: skip (no DATABASE_URL in $ENV_FILE)" >&2
fi

# ── 3. /etc/openlen (minus the passphrase that encrypts it) ─────────────────
echo "== etc: /etc/openlen"
tar -C /etc -czf "$WORK/etc.tar.gz" --exclude "openlen/$(basename "$PASS_FILE")" openlen
encrypt "$WORK/etc.tar.gz" "$WORK/etc-$STAMP.tar.gz.enc"
rc copyto "$WORK/etc-$STAMP.tar.gz.enc" "$REMOTE/etc/etc-$STAMP.tar.gz.enc"
prune etc

# ── 4. manifest — what a fresh box must re-enable ──────────────────────────
{
  echo "generated: $(date -u -Is)"
  echo "== enabled openlen units =="
  systemctl list-unit-files 'openlen-*' --no-pager 2>/dev/null || true
  echo "== timers =="
  systemctl list-timers 'openlen-*' --all --no-pager 2>/dev/null || true
  echo "== versions =="
  node --version 2>/dev/null || true
  caddy version 2>/dev/null || true
  google-chrome --version 2>/dev/null || true
  pg_dump --version 2>/dev/null || true
} > "$WORK/manifest.txt"
rc copyto "$WORK/manifest.txt" "$REMOTE/manifest/manifest.txt"

echo "system backup ok: $STAMP"
