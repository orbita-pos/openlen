#!/usr/bin/env bash
#
# One-time migration: convert /var/www/openlen/<sub>/index.html (legacy
# layout) into the versioned-releases layout:
#
#   /var/www/openlen/<sub>/
#     releases/<sha12>/index.html
#     current -> releases/<sha12>
#
# Idempotent: skips any subdomain that already has a `current` symlink.
# Safe to run repeatedly. Run on the box BEFORE deploying the nginx
# change that points `root` at $sub/current.
#
# Order of operations for the Phase 3 cutover:
#   1. ssh to the box, run this script
#   2. ssh to the box, install new nginx config, `nginx -t && nginx -s reload`
#   3. from local, run `npm run deploy:prod`
#
# After this, every publish from the app uses the new layout via
# lib/publish/filesystem.ts. The legacy top-level index.html is left in
# place by this script (harmless leftovers, ignored by nginx after the
# config reload). Optional cleanup of legacy top-level files is a manual
# task once you've verified everything works.

set -euo pipefail

ROOT="${PUBLISH_ROOT:-/var/www/openlen}"

if [[ ! -d "$ROOT" ]]; then
  echo "skip: $ROOT does not exist"
  exit 0
fi

shopt -s nullglob

migrated=0
skipped=0

for sub_dir in "$ROOT"/*/; do
  sub="$(basename "$sub_dir")"

  # Reserved + control dirs.
  case "$sub" in
    _default | .* ) continue ;;
  esac

  # Already migrated?
  if [[ -L "$sub_dir/current" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  index="$sub_dir/index.html"
  if [[ ! -f "$index" ]]; then
    # No index.html — nothing to migrate. Could be a stale dir; leave it
    # alone. Operator can rm if they want.
    continue
  fi

  sha="$(sha256sum "$index" | cut -c1-12)"
  release_dir="$sub_dir/releases/$sha"
  mkdir -p "$release_dir"
  # Use cp (not mv) so the legacy top-level index.html remains while we
  # roll the nginx config. After the cutover succeeds you can remove it
  # manually.
  cp -a "$index" "$release_dir/index.html"

  # Create the symlink atomically (write to tmp, rename).
  tmp_link="$sub_dir/.current-$RANDOM.new"
  ln -s "releases/$sha" "$tmp_link"
  mv -T "$tmp_link" "$sub_dir/current"

  echo "migrated $sub → releases/$sha"
  migrated=$((migrated + 1))
done

echo ""
echo "done. migrated=$migrated skipped=$skipped"
