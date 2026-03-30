#!/usr/bin/with-contenv bash
# Restore user-installed packages after container update/recreate.
#
# The /workspace volume persists but the container layer is ephemeral.
# This script re-installs packages that were saved to manifests by the
# persistence wrappers (apk-persist, pip, npm -g).
#
# Runs AFTER all other init scripts (99 = last).
# Designed to be idempotent and non-fatal — a failed restore doesn't
# block container boot.

echo "[restore-packages] Checking for packages to restore..."

MANIFEST_DIR="/workspace/.kortix/packages"
mkdir -p "$MANIFEST_DIR"

RESTORED=0

# ── 1. Restore apk packages ─────────────────────────────────────────────────
APK_MANIFEST="$MANIFEST_DIR/apk-packages.txt"
if [ -s "$APK_MANIFEST" ]; then
  echo "[restore-packages] Restoring apk packages..."
  PKGS=$(tr '\n' ' ' < "$APK_MANIFEST")
  if apk add --no-cache $PKGS 2>&1; then
    RESTORED=$((RESTORED + $(wc -l < "$APK_MANIFEST")))
    echo "[restore-packages] apk: restored $(wc -l < "$APK_MANIFEST") package(s)"
  else
    echo "[restore-packages] WARNING: some apk packages failed to install (non-fatal)"
  fi
fi

# ── 2. Restore pip packages ─────────────────────────────────────────────────
# pip packages installed with PIP_USER=1 already live in /workspace/.local/
# which persists. But if someone did a manual `pip install --user` before
# the ENV was set, the packages are already there. Nothing to restore.
# We just ensure the bin dir is correct.
if [ -d /workspace/.local/lib/python*/site-packages ]; then
  echo "[restore-packages] pip: user packages found in /workspace/.local/ (persisted via volume)"
fi

# ── 3. Restore npm global packages ──────────────────────────────────────────
# npm -g packages installed with NPM_CONFIG_PREFIX=/workspace/.npm-global
# already persist in the volume. Nothing to restore — just verify.
if [ -d /workspace/.npm-global/lib/node_modules ] && [ "$(ls -A /workspace/.npm-global/lib/node_modules 2>/dev/null)" ]; then
  NPM_COUNT=$(ls -1 /workspace/.npm-global/lib/node_modules | wc -l)
  echo "[restore-packages] npm: $NPM_COUNT global package(s) found in /workspace/.npm-global/ (persisted via volume)"
fi

# ── 4. Inject persistent PATH into s6 environment ───────────────────────────
# s6 services inherit env from /run/s6/container_environment/. We need to
# ensure the persistent bin dirs are in PATH for ALL services, not just
# login shells.
CURRENT_PATH=$(cat /run/s6/container_environment/PATH 2>/dev/null || echo "")
if [ -n "$CURRENT_PATH" ]; then
  # Only add if not already present
  case "$CURRENT_PATH" in
    */workspace/.npm-global/bin*) ;;
    *) CURRENT_PATH="/workspace/.npm-global/bin:$CURRENT_PATH" ;;
  esac
  case "$CURRENT_PATH" in
    */workspace/.local/bin*) ;;
    *) CURRENT_PATH="/workspace/.local/bin:$CURRENT_PATH" ;;
  esac
  printf '%s' "$CURRENT_PATH" > /run/s6/container_environment/PATH
  echo "[restore-packages] PATH updated for s6 services"
fi

# ── 5. Fix ownership of persistent package dirs ─────────────────────────────
# Use abc's actual UID — never hardcode 1000.
WORKSPACE_UID="$(id -u abc 2>/dev/null || echo 911)"
WORKSPACE_GID="$(id -g abc 2>/dev/null || echo 911)"
chown -R "$WORKSPACE_UID:$WORKSPACE_GID" \
  /workspace/.local \
  /workspace/.npm-global \
  /workspace/.kortix/packages \
  2>/dev/null || true

if [ $RESTORED -gt 0 ]; then
  echo "[restore-packages] Restored $RESTORED package(s) total."
else
  echo "[restore-packages] No packages to restore."
fi
