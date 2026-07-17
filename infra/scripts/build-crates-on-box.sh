#!/usr/bin/env bash
# Build the 4 napi-rs crates on Hetzner for Linux x86_64-gnu, then drop the
# resulting .node binaries into <target>/node_modules/@openlen/<crate>/.
#
# Default target is /opt/openlen-app (live dir) — invoked manually after
# a fresh checkout or to recover the binaries.
# deploy.ps1 passes the staging dir (e.g. /opt/openlen-app-staging) so the
# binaries enter the atomic swap and survive the live-dir replacement.
#
# Usage on the box:
#   bash /root/build-crates-on-box.sh                       # live dir
#   bash /root/build-crates-on-box.sh /opt/openlen-app-staging
#
# Expects /root/openlen-workspace/ with Cargo.toml + Cargo.lock + crates/.
# deploy.ps1 rsyncs those before invoking. For manual runs, do it yourself:
#   rsync -az crates/ Cargo.toml Cargo.lock openlen:/root/openlen-workspace/

set -e
set -o pipefail
# Un box recién resucitado no trae Rust (ni setup-hetzner ni setup-node lo
# instalan) y el primer deploy moría aquí — cazado en el ensayo DR 2026-07-17.
# Auto-bootstrap: rustup minimal, idempotente.
if [[ ! -f ~/.cargo/env ]]; then
  echo "rustup no encontrado — instalando toolchain minimal..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
# rustc sin linker no compila nada ("linker cc not found" — segundo hallazgo
# del mismo ensayo): un Ubuntu fresco tampoco trae build-essential.
if ! command -v cc >/dev/null 2>&1; then
  echo "cc no encontrado — instalando build-essential..."
  DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential pkg-config libssl-dev
fi
source ~/.cargo/env

TARGET_DIR="${1:-/opt/openlen-app}"
CRATES=(html-engine ai-gateway images rate-limit)
WORKSPACE=/root/openlen-workspace
APP_NM="$TARGET_DIR/node_modules/@openlen"

if [[ ! -d "$APP_NM" ]]; then
  echo "ERROR: $APP_NM does not exist — extract the Next.js standalone first" >&2
  exit 1
fi

for c in "${CRATES[@]}"; do
  echo ""
  echo "=== building $c ==="
  cd "$WORKSPACE/crates/$c"
  npm install --no-audit --no-fund --silent
  npm run build
  cp -v "openlen-$c.linux-x64-gnu.node" "$APP_NM/$c/"
done

# Only restart + smoke when targeting the live dir. When invoked from
# deploy.ps1 with a staging arg, the deploy script handles the swap +
# restart itself after this returns.
if [[ "$TARGET_DIR" == "/opt/openlen-app" ]]; then
  echo ""
  echo "=== restarting openlen-app ==="
  systemctl restart openlen-app
  sleep 3
  systemctl is-active openlen-app
  echo ""
  echo "=== smoke test ==="
  curl -sI http://127.0.0.1:3000/api/upload | head -3
fi
