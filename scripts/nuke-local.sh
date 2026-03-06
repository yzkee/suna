#!/usr/bin/env bash
set -euo pipefail

# ─── Kortix Local Dev — Full Nuke & Reset ────────────────────────────────────
#
# Destroys ALL local state and starts fresh:
#   1. Stops kortix-api (kills any bun/node on port 8008)
#   2. Removes the sandbox container
#   3. Removes ALL sandbox Docker volumes (filesystem state)
#   4. Resets the Supabase database (re-runs all migrations)
#   5. Optionally restarts kortix-api
#
# Usage:
#   ./scripts/nuke-local.sh           # nuke everything, don't start API
#   ./scripts/nuke-local.sh --start   # nuke everything, then start API
# ─────────────────────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

START_API=false
if [[ "${1:-}" == "--start" ]]; then
  START_API=true
fi

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║           🔥 NUKING LOCAL DEV ENVIRONMENT 🔥          ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Kill kortix-api if running ─────────────────────────────────────────────
echo "[1/4] Stopping kortix-api..."
lsof -ti:8008 2>/dev/null | xargs -r kill -9 2>/dev/null || true
echo "  ✓ Port 8008 cleared"

# ── 2. Remove sandbox container ───────────────────────────────────────────────
echo "[2/4] Removing sandbox container..."
docker rm -f kortix-sandbox 2>/dev/null && echo "  ✓ Container removed" || echo "  · No container found"

# ── 3. Remove ALL sandbox volumes ────────────────────────────────────────────
echo "[3/4] Removing sandbox volumes..."
VOLS=$(docker volume ls --format "{{.Name}}" | grep -i sandbox || true)
if [[ -n "$VOLS" ]]; then
  echo "$VOLS" | xargs docker volume rm -f
  echo "  ✓ Removed: $(echo "$VOLS" | tr '\n' ' ')"
else
  echo "  · No sandbox volumes found"
fi

# ── 4. Reset Supabase database ───────────────────────────────────────────────
echo "[4/4] Resetting Supabase database..."
cd "$ROOT_DIR"
supabase db reset
echo "  ✓ Database reset complete"

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║           ✅ LOCAL ENV FULLY NUKED & FRESH             ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ── Optional: restart API ─────────────────────────────────────────────────────
if $START_API; then
  echo "Starting kortix-api..."
  cd "$ROOT_DIR"
  exec pnpm run dev:api
fi
