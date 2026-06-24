#!/usr/bin/env bash
# Deploy the creator.openlen.com showcase (static multi-file site).
# Usage:  bash designs/creator/deploy-creator.sh
# Uses your existing `openlen` ssh alias (override with OPENLEN_HOST=...).
set -euo pipefail

HOST="${OPENLEN_HOST:-openlen}"
SUB="creator"
TAR="creator-site.tar.gz"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "→ empaquetando bundle fresco"
rm -f "$TAR"
tar -czf "$TAR" \
  index.html variant-brutal.html variant-noir.html variant-editorial.html variant-warm.html \
  video/openlen-explainer.mp4 video/poster.jpg \
  img/brutal/openlen.webp img/brutal/inariwatch.webp img/brutal/orbitapos.webp \
  img/noir/openlen.webp img/noir/inariwatch.webp img/noir/orbitapos.webp \
  img/editorial/openlen.webp img/editorial/inariwatch.webp img/editorial/orbitapos.webp \
  img/warm/openlen.webp img/warm/inariwatch.webp img/warm/orbitapos.webp \
  fonts

echo "→ subiendo $TAR a $HOST:/root/ ($(du -h "$DIR/$TAR" | cut -f1))"
scp -q "$DIR/$TAR" "${HOST}:/root/"

echo "→ extrayendo + swap atómico en /var/www/openlen/$SUB/current"
ssh "$HOST" "set -e
  base=/var/www/openlen/$SUB
  rm -rf \$base/current.new && mkdir -p \$base/current.new
  tar -xzf /root/$TAR -C \$base/current.new
  rm -rf \$base/current.old
  [ -d \$base/current ] && mv \$base/current \$base/current.old || true
  mv \$base/current.new \$base/current
  chmod -R a+rX \$base/current
  rm -f /root/$TAR
  echo '  on-box: '\$(find \$base/current -type f | wc -l)' archivos en '\$base/current"

echo "✓ creator.openlen.com desplegado"
echo "  verifica: https://creator.openlen.com"
