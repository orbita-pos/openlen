#!/usr/bin/env bash
#
# Nightly rclone sync of /var/www/openlen/ → R2 `openlen-published` bucket.
# Excludes tmp/old/control dirs that exist only transiently or locally.
# Idempotent: rclone sync copies only changed files, deletes objects in
# the destination that no longer exist locally.
#
# Triggered by openlen-backup.timer (systemd). To run manually:
#   bash infra/scripts/backup-published-to-r2.sh
#
# Requires /etc/openlen/rclone.conf with an [r2-published] remote, e.g.:
#   [r2-published]
#   type = s3
#   provider = Cloudflare
#   access_key_id = ...
#   secret_access_key = ...
#   endpoint = https://<account-id>.r2.cloudflarestorage.com
#   acl = private

set -euo pipefail

PUBLISH_ROOT="${PUBLISH_ROOT:-/var/www/openlen}"
RCLONE_CONF="${RCLONE_CONF:-/etc/openlen/rclone.conf}"
REMOTE="${OPENLEN_BACKUP_REMOTE:-r2-published:openlen-published}"

if [[ ! -d "$PUBLISH_ROOT" ]]; then
  echo "skip: $PUBLISH_ROOT does not exist"
  exit 0
fi

if [[ ! -f "$RCLONE_CONF" ]]; then
  echo "error: rclone config not found at $RCLONE_CONF" >&2
  echo "create it with an [r2-published] remote (see script header)" >&2
  exit 1
fi

exec rclone sync "$PUBLISH_ROOT/" "$REMOTE/" \
  --config "$RCLONE_CONF" \
  --exclude '.tmp-*/**' \
  --exclude '.tmp-*' \
  --exclude '.old-*/**' \
  --exclude '.old-*' \
  --exclude '.current-*.new' \
  --exclude '_default/**' \
  --copy-links \
  --transfers 8 \
  --checkers 16 \
  --retries 3 \
  --log-level INFO
