#!/usr/bin/with-contenv bash
set -euo pipefail

# Sync encrypted secrets from /app/secrets into the s6 container environment.
# This makes them available to all services started with /usr/bin/with-contenv.

SECRETS_FILE="${SECRET_FILE_PATH:-/app/secrets/.secrets.json}"

if [ -f "$SECRETS_FILE" ]; then
  echo "[Kortix] Syncing secrets into s6 container environment"
  bun "/opt/kortix-master/src/scripts/sync-s6-env.ts" || echo "[Kortix] WARN: secret sync failed"
else
  echo "[Kortix] No secrets file yet — skipping secret sync"
fi
