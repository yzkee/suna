#!/usr/bin/env bash
# @kortix/sandbox postinstall — ACID staging-based deployment
#
# Called in two contexts:
#
#   1. Docker build time (PREBAKE):
#      npm install . → triggers this → deploys to /opt/ directly (direct mode)
#      The image ships with everything in /opt/ prebaked.
#
#   2. OTA update (via update.ts):
#      Downloads tarball → extracts to /tmp/kortix-ota-{version}/ → runs this
#      Deploys to /opt/kortix-staging-{version}/ (staging mode)
#      update.ts then atomically swaps symlinks.
#
# Note: This script no longer runs npm install, bun install, or pip install
# for any global tools. Those are all prebaked into the Docker image.
# The only installs here are the bun install calls for the sandbox packages
# themselves (kortix-master, opencode-channels, opencode runtime).
#
# This script is idempotent — safe to run multiple times.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")" && pwd)"

# Detect if we're running inside a sandbox (vs. being installed as a dev dep locally)
if [ ! -d "/opt" ] || [ ! -d "/custom-cont-init.d" ] || [ ! -d "/etc/s6-overlay/s6-rc.d" ] || { [ "$(id -u)" = "0" ] && [ ! -d "/opt/bun" ]; }; then
  echo "[sandbox-postinstall] Not in sandbox environment, skipping file deployment"
  exit 0
fi

PKG_VERSION=$(node -e "console.log(require('$PKG_DIR/package.json').version)" 2>/dev/null || echo "0.0.0")
echo "[sandbox-postinstall] Deploying @kortix/sandbox@$PKG_VERSION..."

KORTIX_OC_PACKAGE="$PKG_DIR/vendor/kortix-oc"
OCC_PACKAGE="$PKG_DIR/vendor/opencode-channels"
OAT_PACKAGE="$PKG_DIR/vendor/opencode-agent-triggers"

for check_dir in "$KORTIX_OC_PACKAGE" "$OCC_PACKAGE" "$OAT_PACKAGE"; do
  if [ ! -d "$check_dir" ]; then
    echo "[sandbox-postinstall] ERROR: $check_dir not found" >&2
    exit 1
  fi
done

echo "[sandbox-postinstall] Using bundled kortix-oc runtime from $KORTIX_OC_PACKAGE"

fail_update() {
  echo "[sandbox-postinstall] ERROR: $1" >&2
  if [ "${MODE:-}" = "staging" ] && [ -n "${STAGING:-}" ]; then
    rm -rf "$STAGING" 2>/dev/null || true
  fi
  exit 1
}

# Ensure rsync is available
if ! command -v rsync &>/dev/null; then
  echo "[sandbox-postinstall] Installing rsync..."
  apk add --no-cache rsync 2>/dev/null || true
fi

# ─── Detect mode ─────────────────────────────────────────────────────────────
# If /opt/kortix-master is a symlink → OTA update, stage into isolated dir.
# If it's a real directory or doesn't exist → first boot / prebake, deploy directly.

if [ -L /opt/kortix-master ]; then
  MODE="staging"
  STAGING="/opt/kortix-staging-$PKG_VERSION"
  echo "[sandbox-postinstall] ACID mode: staging to $STAGING"
  rm -rf "$STAGING"
  mkdir -p "$STAGING"

  KM_DIR="$STAGING/kortix-master"
  OC_DIR="$STAGING/opencode"
  BV_DIR="$STAGING/agent-browser-viewer"
  KX_DIR="$STAGING/kortix"
  KO_DIR="$STAGING/kortix-oc"
  OCC_DIR="$STAGING/opencode-channels"
  OAT_DIR="$STAGING/opencode-agent-triggers"
else
  MODE="direct"
  STAGING=""
  echo "[sandbox-postinstall] Direct mode (prebake / first boot)"

  KM_DIR="/opt/kortix-master"
  OC_DIR="/opt/opencode"
  BV_DIR="/opt/agent-browser-viewer"
  KX_DIR="/opt/kortix"
  KO_DIR="/opt/kortix-oc"
  OCC_DIR="/opt/opencode-channels"
  OAT_DIR="/opt/opencode-agent-triggers"
fi

# ── Kortix Master ────────────────────────────────────────────────────────────
echo "[sandbox-postinstall] Building kortix-master..."
mkdir -p "$KM_DIR"
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='bun.lock' \
  "$PKG_DIR/kortix-master/" "$KM_DIR/"

# In staging mode, copy node_modules from live version if lockfile unchanged
if [ "$MODE" = "staging" ] && [ -L /opt/kortix-master ]; then
  CURRENT_KM=$(readlink -f /opt/kortix-master)
  CURRENT_LOCK="$CURRENT_KM/bun.lock"
  NEW_LOCK="$PKG_DIR/kortix-master/bun.lock"
  if [ -f "$CURRENT_LOCK" ] && [ -f "$NEW_LOCK" ] && diff -q "$CURRENT_LOCK" "$NEW_LOCK" >/dev/null 2>&1; then
    echo "[sandbox-postinstall] kortix-master lockfile unchanged — copying node_modules"
    cp -a "$CURRENT_KM/node_modules" "$KM_DIR/node_modules" 2>/dev/null || true
  fi
fi

if [ ! -d "$KM_DIR/node_modules" ]; then
  echo "[sandbox-postinstall] Installing kortix-master dependencies..."
  if ! (cd "$KM_DIR" && bun install); then
    fail_update "bun install failed for kortix-master"
  fi
fi

# ── OpenCode channels ─────────────────────────────────────────────────────────
echo "[sandbox-postinstall] Building opencode-channels..."
mkdir -p "$OCC_DIR"
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='bun.lock' \
  "$OCC_PACKAGE/" "$OCC_DIR/"

if [ "$MODE" = "staging" ] && [ -L /opt/opencode-channels ]; then
  CURRENT_OCC=$(readlink -f /opt/opencode-channels)
  CURRENT_LOCK="$CURRENT_OCC/bun.lock"
  NEW_LOCK="$OCC_PACKAGE/bun.lock"
  if [ -f "$CURRENT_LOCK" ] && [ -f "$NEW_LOCK" ] && diff -q "$CURRENT_LOCK" "$NEW_LOCK" >/dev/null 2>&1; then
    echo "[sandbox-postinstall] opencode-channels lockfile unchanged — copying node_modules"
    cp -a "$CURRENT_OCC/node_modules" "$OCC_DIR/node_modules" 2>/dev/null || true
  fi
fi

if [ ! -d "$OCC_DIR/node_modules" ]; then
  echo "[sandbox-postinstall] Installing opencode-channels dependencies..."
  if ! (cd "$OCC_DIR" && bun install); then
    fail_update "bun install failed for opencode-channels"
  fi
fi

# ── OpenCode agent triggers ────────────────────────────────────────────────────
echo "[sandbox-postinstall] Staging opencode-agent-triggers..."
mkdir -p "$OAT_DIR"
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='bun.lock' \
  "$OAT_PACKAGE/" "$OAT_DIR/"

# ── OpenCode runtime ──────────────────────────────────────────────────────────
echo "[sandbox-postinstall] Building opencode runtime..."
mkdir -p "$KO_DIR"
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='bun.lock' \
  "$KORTIX_OC_PACKAGE/" "$KO_DIR/"

mkdir -p "$OC_DIR"

# In staging mode, copy node_modules from live version if lockfile unchanged
if [ "$MODE" = "staging" ] && [ -L /opt/opencode ]; then
  CURRENT_OC=$(readlink -f /opt/opencode)
  CURRENT_LOCK="$CURRENT_OC/package.json"
  NEW_MANIFEST="$KO_DIR/runtime/package.json"
  if [ -f "$CURRENT_LOCK" ] && [ -f "$NEW_MANIFEST" ]; then
    CURRENT_HASH=$(md5sum "$CURRENT_LOCK" 2>/dev/null | cut -d' ' -f1 || true)
    NEW_HASH=$(md5sum "$NEW_MANIFEST" 2>/dev/null | cut -d' ' -f1 || true)
    if [ "$CURRENT_HASH" = "$NEW_HASH" ]; then
      echo "[sandbox-postinstall] opencode package.json unchanged — copying node_modules"
      cp -a "$CURRENT_OC/node_modules" "$OC_DIR/node_modules" 2>/dev/null || true
    fi
  fi
  # Also preserve .local runtime data
  if [ -d "$CURRENT_OC/.local" ]; then
    cp -a "$CURRENT_OC/.local" "$OC_DIR/.local" 2>/dev/null || true
  fi
fi

if ! (cd "$KO_DIR" && bun run bin/kortix-oc.ts materialize "$OC_DIR" --clean); then
  fail_update "failed to materialize opencode runtime"
fi

if [ ! -d "$OC_DIR/node_modules" ]; then
  echo "[sandbox-postinstall] Installing opencode dependencies..."
  if ! (cd "$OC_DIR" && bun install); then
    fail_update "bun install failed for opencode"
  fi
fi

rm -rf "$KO_DIR/node_modules"
ln -s "$OC_DIR/node_modules" "$KO_DIR/node_modules"

if ! bash "$KO_DIR/runtime/patches/apply.sh" "$OC_DIR"; then
  fail_update "failed to apply opencode patches"
fi

# ── OpenCode binary patches ───────────────────────────────────────────────────
if [ -f "$KO_DIR/runtime/patches/patch-opencode-streaming.js" ]; then
  echo "[sandbox-postinstall] Applying opencode binary patches..."
  node "$KO_DIR/runtime/patches/patch-opencode-streaming.js" || true
fi

# ── bun-pty musl .so patches ──────────────────────────────────────────────────
if [ -f /opt/bun-pty-musl/librust_pty.so ]; then
  echo "[sandbox-postinstall] Patching bun-pty .so..."
  ARCH=$(uname -m)
  for PTY_DIR in \
      "$OC_DIR/node_modules/bun-pty/rust-pty/target/release" \
      /opt/bun/install/cache/bun-pty@*/rust-pty/target/release; do
    [ -d "$PTY_DIR" ] || continue
    if [ "$ARCH" = "x86_64" ]; then
      cp /opt/bun-pty-musl/librust_pty.so "$PTY_DIR/librust_pty.so"
    else
      cp /opt/bun-pty-musl/librust_pty.so "$PTY_DIR/librust_pty_arm64.so"
    fi
  done
fi

# ── Global binary symlinks ───────────────────────────────────────────────────
# opencode and agent-browser are installed via npm (prebaked in the image at
# /opt/kortix-local/sandbox/node_modules/.bin/). We symlink them to /usr/local/bin
# so s6 service scripts and PATH lookups can find them.
echo "[sandbox-postinstall] Linking global binaries..."
for bin in opencode agent-browser; do
  SRC="/opt/kortix-local/sandbox/node_modules/.bin/$bin"
  DEST="/usr/local/bin/$bin"
  if [ -f "$SRC" ]; then
    ln -sf "$SRC" "$DEST"
    echo "[sandbox-postinstall] Linked $DEST → $SRC"
  fi
done

# ── Remove stale opencode-ai .opencode bun cache ─────────────────────────────
# The opencode-ai npm wrapper ships a .opencode cached binary (glibc bun) that
# gets picked up BEFORE platform detection finds the correct musl binary.
# On Alpine (musl) the glibc .opencode binary fails with bun error messages
# ("Script not found 'serve'"). Deleting it forces the wrapper to use proper
# platform detection → finds opencode-linux-arm64-musl/bin/opencode (correct).
OC_WRAPPER_DIR="/opt/kortix-local/sandbox/node_modules/opencode-ai/bin"
if [ -f "$OC_WRAPPER_DIR/.opencode" ]; then
  echo "[sandbox-postinstall] Removing stale opencode-ai bun cache (.opencode)"
  rm -f "$OC_WRAPPER_DIR/.opencode"
fi

# ── s6 service scripts ──────────────────────────────────────────────────────
if [ -d "$PKG_DIR/s6-services" ] && [ -d "/etc/s6-overlay/s6-rc.d" ]; then
  echo "[sandbox-postinstall] Updating s6 service scripts..."
  rsync -a "$PKG_DIR/s6-services/" /etc/s6-overlay/s6-rc.d/ || fail_update "failed to sync s6 service scripts"
  chmod +x /etc/s6-overlay/s6-rc.d/svc-*/run || fail_update "failed to chmod s6 run scripts"

  USER_CONTENTS_DIR="/etc/s6-overlay/s6-rc.d/user/contents.d"
  if [ -d "$USER_CONTENTS_DIR" ]; then
    for legacy in svc-opencode-web svc-opencode-serve svc-lss-sync svc-agent-browser-viewer \
                  svc-presentation-viewer svc-static-web svc-opencode-channels; do
      rm -f "$USER_CONTENTS_DIR/$legacy" 2>/dev/null || true
    done
    touch "$USER_CONTENTS_DIR/svc-kortix-master"
    touch "$USER_CONTENTS_DIR/svc-sshd"
  fi
fi

# ── Init scripts ─────────────────────────────────────────────────────────────
if [ -d "$PKG_DIR/config" ] && [ -d "/custom-cont-init.d" ]; then
  echo "[sandbox-postinstall] Updating init scripts..."
  cp -f "$PKG_DIR/config/kortix-env-setup.sh" /custom-cont-init.d/98-kortix-env || fail_update "failed to update 98-kortix-env"
  cp -f "$PKG_DIR/config/customize.sh" /custom-cont-init.d/99-customize || fail_update "failed to update 99-customize"
  chmod +x /custom-cont-init.d/98-kortix-env /custom-cont-init.d/99-customize || fail_update "failed to chmod init scripts"
fi

# ── Agent Browser Viewer ─────────────────────────────────────────────────────
if [ -d "$PKG_DIR/browser-viewer" ]; then
  mkdir -p "$BV_DIR"
  rsync -a --delete "$PKG_DIR/browser-viewer/" "$BV_DIR/"
fi

# ── Core contract ─────────────────────────────────────────────────────────────
if [ -d "$PKG_DIR/core" ]; then
  mkdir -p "$KX_DIR/core"
  rsync -a --delete "$PKG_DIR/core/" "$KX_DIR/core/" || fail_update "failed to sync core manifest/spec"
fi

# ── Version file + Changelog ─────────────────────────────────────────────────
mkdir -p "$KX_DIR"
echo "{\"version\":\"$PKG_VERSION\",\"updatedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$KX_DIR/.version"
cp "$PKG_DIR/CHANGELOG.json" "$KX_DIR/CHANGELOG.json" 2>/dev/null || true

# ── Fix ownership ────────────────────────────────────────────────────────────
if id abc &>/dev/null; then
  SANDBOX_USER="abc"
else
  SANDBOX_USER="1000"
fi

chown -R "$SANDBOX_USER:$SANDBOX_USER" "$KM_DIR" "$OC_DIR" "$KX_DIR" "$KO_DIR" "$OAT_DIR" 2>/dev/null || true
[ -d "$BV_DIR" ] && chown -R "$SANDBOX_USER:$SANDBOX_USER" "$BV_DIR" 2>/dev/null || true
[ -d "$OCC_DIR" ] && chown -R "$SANDBOX_USER:$SANDBOX_USER" "$OCC_DIR" 2>/dev/null || true

# ── ACID symlinks (direct / prebake mode only) ───────────────────────────────
if [ "$MODE" = "direct" ]; then
  echo "[sandbox-postinstall] Setting up ACID staging symlinks..."
  STAGING_DIR="/opt/kortix-staging-$PKG_VERSION"
  mkdir -p "$STAGING_DIR"

  for pair in "kortix-master:$KM_DIR" "opencode:$OC_DIR" "agent-browser-viewer:$BV_DIR" \
              "kortix:$KX_DIR" "kortix-oc:$KO_DIR" "opencode-agent-triggers:$OAT_DIR"; do
    NAME="${pair%%:*}"
    SRC="${pair##*:}"
    DEST="$STAGING_DIR/$NAME"
    if [ -d "$SRC" ] && [ ! -L "$SRC" ]; then
      mv "$SRC" "$DEST"
      ln -s "$DEST" "$SRC"
    fi
  done

  if [ -d "$OCC_DIR" ] && [ ! -L "$OCC_DIR" ]; then
    mv "$OCC_DIR" "$STAGING_DIR/opencode-channels"
    ln -s "$STAGING_DIR/opencode-channels" "$OCC_DIR"
  fi

  echo "{\"version\":\"$PKG_VERSION\",\"status\":\"staged\",\"stagedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$STAGING_DIR/.manifest"
  chown -R "$SANDBOX_USER:$SANDBOX_USER" "$STAGING_DIR" 2>/dev/null || true

  mkdir -p /app/secrets && chmod 700 /app/secrets
fi

# ── Staging manifest (OTA mode) ──────────────────────────────────────────────
if [ "$MODE" = "staging" ]; then
  echo "{\"version\":\"$PKG_VERSION\",\"status\":\"staged\",\"stagedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$STAGING/.manifest"
  echo "[sandbox-postinstall] Staging complete: $STAGING"
  echo "[sandbox-postinstall] Waiting for update.ts to commit (symlink swap)..."
else
  echo "[sandbox-postinstall] Prebake deployment complete."
fi
