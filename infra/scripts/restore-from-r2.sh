#!/usr/bin/env bash
#
# Restore published landings from the R2 `openlen-published` backup bucket
# into /var/www/openlen/. Disaster-recovery script — run after a disk
# replacement or a corrupted publish root.
#
# Usage:
#   bash infra/scripts/restore-from-r2.sh           # full restore (all subs)
#   bash infra/scripts/restore-from-r2.sh acme      # one subdomain only
#
# After a full restore, also rebuilds the `current` symlink for any
# subdomain that's missing one — rclone may not round-trip symlinks
# cleanly depending on storage backend version, so we regenerate from
# the most recent release dir on disk.

set -euo pipefail

PUBLISH_ROOT="${PUBLISH_ROOT:-/var/www/openlen}"
RCLONE_CONF="${RCLONE_CONF:-/etc/openlen/rclone.conf}"
REMOTE="${OPENLEN_BACKUP_REMOTE:-r2-published:openlen-published}"
TARGET_SUB="${1:-}"

rebuild_symlink() {
  local sub_dir="$1"
  sub_dir="${sub_dir%/}"
  if [[ -L "$sub_dir/current" ]]; then
    return 0
  fi
  local releases="$sub_dir/releases"
  if [[ ! -d "$releases" ]]; then
    return 0
  fi
  local newest
  newest="$(ls -1t "$releases" 2>/dev/null | head -n1 || true)"
  if [[ -z "$newest" ]]; then
    return 0
  fi
  # El backup sube con --copy-links, así que `current` baja del restore como
  # DIRECTORIO real (no symlink). mv -T no puede pisar un dir no vacío — y
  # peor: el siguiente publish del sub fallaría igual en publishToDir.
  # Degradarlo a symlink (releases/ ya tiene el mismo contenido). Cazado en
  # el ensayo DR 2026-07-17.
  if [[ -d "$sub_dir/current" ]]; then
    rm -rf "$sub_dir/current"
  fi
  local tmp_link="$sub_dir/.current-$RANDOM.new"
  ln -s "releases/$newest" "$tmp_link"
  mv -T "$tmp_link" "$sub_dir/current"
  echo "  rebuilt symlink $(basename "$sub_dir") → releases/$newest"
}

if [[ ! -f "$RCLONE_CONF" ]]; then
  echo "error: rclone config not found at $RCLONE_CONF" >&2
  exit 1
fi

mkdir -p "$PUBLISH_ROOT"

if [[ -n "$TARGET_SUB" ]]; then
  echo "restoring single subdomain: $TARGET_SUB"
  rclone copy "$REMOTE/$TARGET_SUB/" "$PUBLISH_ROOT/$TARGET_SUB/" \
    --config "$RCLONE_CONF" \
    --transfers 8 \
    --retries 3
  rebuild_symlink "$PUBLISH_ROOT/$TARGET_SUB"
  echo "done."
  exit 0
fi

echo "full restore from $REMOTE → $PUBLISH_ROOT"
rclone copy "$REMOTE/" "$PUBLISH_ROOT/" \
  --config "$RCLONE_CONF" \
  --transfers 8 \
  --retries 3 \
  --log-level INFO

shopt -s nullglob
for sub_dir in "$PUBLISH_ROOT"/*/; do
  rebuild_symlink "$sub_dir"
done

echo "done."
