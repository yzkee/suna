#!/usr/bin/with-contenv bash
set -euo pipefail

# kortix-master runs as user abc (via s6-setuidgid).
# Ensure both /app/secrets and /run/s6/container_environment are writable by abc.

SECRETS_DIR="${SECRET_DIR_PATH:-/app/secrets}"
S6_ENV_DIR="/run/s6/container_environment"

# Secrets directory (Docker volume, default owner is root).
# chown -R to fix ownership of any pre-existing files (.salt, .secrets.json).
mkdir -p "$SECRETS_DIR"
chown -R abc:users "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

# s6 container environment directory (used by with-contenv)
if [ -d "$S6_ENV_DIR" ]; then
  chown -R abc:users "$S6_ENV_DIR"
  chmod 755 "$S6_ENV_DIR"
fi

# If a secrets file already exists, fix its ownership and sync to s6 env.
SECRETS_FILE="${SECRETS_DIR}/.secrets.json"

if [ -f "$SECRETS_FILE" ]; then
  chown abc:users "$SECRETS_FILE"
  echo "[Kortix] Syncing secrets into s6 container environment"
  bun "/opt/kortix-master/src/scripts/sync-s6-env.ts" || echo "[Kortix] WARN: secret sync failed"
else
  echo "[Kortix] No secrets file yet — skipping secret sync"
fi
