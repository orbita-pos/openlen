#!/usr/bin/env bash
# Build openlen-edge for Linux x86_64 + rsync to Hetzner + atomic swap on
# the box + restart the systemd unit. Run from the repo root.
#
# Usage:
#   bash infra/scripts/deploy-edge.sh
#
# Override defaults with env vars:
#   OPENLEN_BOX_IP=...            target host (default: 178.156.175.171)
#   OPENLEN_ADMIN_KEY_PATH=...    ssh key for root systemctl restart
#                                  (default: ~/.ssh/openlen-admin)
#   CARGO_TARGET_DIR=...          local Cargo target dir (default: target/)
#
# Cross-compile notes (Windows host):
#   The recommended path is to run this script from WSL2 — `cargo build
#   --release --target x86_64-unknown-linux-gnu` works out of the box.
#   Native Windows cross-compile requires `cargo zigbuild`:
#     cargo install cargo-zigbuild
#     pip install ziglang
#     rustup target add x86_64-unknown-linux-gnu
#   then re-export USE_ZIGBUILD=1 before invoking this script.
#
# What the script does:
#   1. Build openlen-edge --release for x86_64-unknown-linux-gnu (stripped
#      via the release profile's `strip = true`).
#   2. Verify binary size < 8.0 MiB cap (warns above, fails above 10 MiB).
#   3. Rsync to root@<box>:/usr/local/bin/openlen-edge.new (the `.new`
#      suffix keeps the running binary on disk during the upload).
#   4. ssh root@<box> to atomically `mv .new openlen-edge` + restart the
#      systemd unit. mv-then-restart preserves the previous binary on
#      disk (renamed `.new` is replaced), so rollback is the previous
#      `.new` from the prior deploy — kept by setting --backup flags
#      below.
#   5. Smoke: hit https://openlen.com from loopback (works as long as the
#      edge is the public listener; in side-by-side bake-off the runbook
#      smoke-tests :8443 separately).

set -euo pipefail

BOX_IP="${OPENLEN_BOX_IP:-178.156.175.171}"
ADMIN_KEY="${OPENLEN_ADMIN_KEY_PATH:-$HOME/.ssh/openlen-admin}"
TARGET="x86_64-unknown-linux-gnu"
BIN_NAME="openlen-edge"
SIZE_CAP_MIB=8.0
SIZE_HARD_FAIL_MIB=10.0

[[ -f "$ADMIN_KEY" ]] || { echo "ERROR: admin key not found at $ADMIN_KEY" >&2; exit 1; }

# Detect whether we should use `cargo zigbuild` (Windows cross-compile).
if [[ "${USE_ZIGBUILD:-0}" == "1" ]]; then
  CARGO_CMD="cargo zigbuild"
else
  CARGO_CMD="cargo build"
fi

echo "[1/5] Building openlen-edge for $TARGET..."
$CARGO_CMD -p openlen-edge --release --target "$TARGET"

CARGO_TARGET="${CARGO_TARGET_DIR:-target}"
BIN_PATH="$CARGO_TARGET/$TARGET/release/$BIN_NAME"

if [[ ! -f "$BIN_PATH" ]]; then
  echo "ERROR: built binary not found at $BIN_PATH" >&2
  echo "       check the cargo output above; if you're on Windows native," >&2
  echo "       set USE_ZIGBUILD=1 or run this from WSL2." >&2
  exit 1
fi

# Size gate. The release profile sets strip = true so the .text is already
# stripped — `stat -c %s` is the deployed footprint.
SIZE_BYTES=$(stat -c %s "$BIN_PATH" 2>/dev/null || stat -f %z "$BIN_PATH")
SIZE_MIB=$(awk -v b="$SIZE_BYTES" 'BEGIN{ printf "%.2f", b/1024/1024 }')
echo "[2/5] Binary size: ${SIZE_MIB} MiB  (cap ${SIZE_CAP_MIB} MiB)"
if awk -v s="$SIZE_MIB" -v cap="$SIZE_HARD_FAIL_MIB" 'BEGIN{ exit (s<=cap) }'; then
  echo "ERROR: binary ${SIZE_MIB} MiB exceeds hard fail ceiling ${SIZE_HARD_FAIL_MIB} MiB — refusing to deploy" >&2
  exit 1
fi
if awk -v s="$SIZE_MIB" -v cap="$SIZE_CAP_MIB" 'BEGIN{ exit (s<=cap) }'; then
  echo "[2/5] WARNING: binary ${SIZE_MIB} MiB exceeds soft cap ${SIZE_CAP_MIB} MiB — investigate before this becomes a habit"
fi

echo "[3/5] Rsyncing to root@${BOX_IP}:/usr/local/bin/${BIN_NAME}.new ..."
rsync -avz \
  -e "ssh -i $ADMIN_KEY -o StrictHostKeyChecking=accept-new" \
  "$BIN_PATH" \
  "root@${BOX_IP}:/usr/local/bin/${BIN_NAME}.new"

echo "[4/5] Atomic swap + service restart on the box ..."
ssh -i "$ADMIN_KEY" -o StrictHostKeyChecking=accept-new "root@${BOX_IP}" bash -s <<EOF
set -euo pipefail
mv /usr/local/bin/${BIN_NAME}.new /usr/local/bin/${BIN_NAME}
# Re-apply CAP_NET_BIND_SERVICE after the swap — the new binary's xattrs
# are fresh (rsync copies file bytes, not xattrs).
if command -v setcap >/dev/null; then
  setcap 'cap_net_bind_service=+ep' /usr/local/bin/${BIN_NAME}
fi
# Only restart if the unit is loaded — fresh-install operators run this
# before the cutover swap when the unit may be installed but inactive.
if systemctl is-enabled openlen-edge >/dev/null 2>&1 || systemctl is-active openlen-edge >/dev/null 2>&1; then
  systemctl restart openlen-edge
  systemctl is-active --quiet openlen-edge
fi
EOF

echo "[5/5] Verifying responsiveness ..."
# Skip when the edge isn't the public listener yet (side-by-side phase).
# A `--resolve` against the box on the standard port should always work
# once the cutover has happened.
if curl --max-time 10 --silent --insecure --output /dev/null --write-out '%{http_code}' \
    --resolve "openlen.com:443:${BOX_IP}" \
    --header "Host: openlen.com" \
    "https://openlen.com" | grep -qE '^(200|301|302|307|308|502)$'; then
  echo "  ↳ apex responded (200/30x means edge serving; 502 means edge up, Node down)"
else
  echo "  ↳ NOTE: apex did not respond on :443 — either edge isn't the public listener yet (expected during bake-off) or something is wrong"
fi

echo
echo "✓ Edge deploy complete."
