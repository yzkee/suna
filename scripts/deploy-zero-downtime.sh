#!/usr/bin/env bash
set -euo pipefail

# ─── Zero-Downtime Deploy for Kortix API ─────────────────────────────────────
#
# Blue/green deployment using nginx as the traffic switcher:
#
#   1. Build new image (old container still serving traffic)
#   2. Start new container on the standby port
#   3. Health check the new container
#   4. Swap nginx upstream to the new port
#   5. Stop the old container
#   6. On failure: rollback (keep old container, don't swap)
#
# Port allocation:
#   Blue = 8008, Green = 8009
#   nginx always proxies to whichever is "active"
#
# State file: ~/.kortix-deploy-slot tracks which slot is active (blue|green)
# ─────────────────────────────────────────────────────────────────────────────

COMPOSE_FILE="scripts/compose/docker-compose.yml"
STATE_FILE="$HOME/.kortix-deploy-slot"
NGINX_CONF="/etc/nginx/sites-available/kortix-api"
HEALTH_TIMEOUT=60
HEALTH_INTERVAL=2

cd ~/computer

# ── Resolve active/standby slots ─────────────────────────────────────────────
ACTIVE_SLOT="blue"
[ -f "$STATE_FILE" ] && ACTIVE_SLOT=$(cat "$STATE_FILE")

if [ "$ACTIVE_SLOT" = "blue" ]; then
  STANDBY_SLOT="green"
  ACTIVE_PORT=8008
  STANDBY_PORT=8009
else
  STANDBY_SLOT="blue"
  ACTIVE_PORT=8009
  STANDBY_PORT=8008
fi

echo "┌─────────────────────────────────────────┐"
echo "│ Zero-Downtime Deploy                    │"
echo "│ Active: $ACTIVE_SLOT (port $ACTIVE_PORT)               │"
echo "│ Deploy: $STANDBY_SLOT (port $STANDBY_PORT)               │"
echo "└─────────────────────────────────────────┘"

# ── 1. Pull latest code ──────────────────────────────────────────────────────
echo "[1/6] Pulling latest code..."
git -c fetch.recurseSubmodules=false fetch origin main
git reset --hard origin/main
git submodule sync --recursive
git submodule update --init --recursive --remote

# ── 2. Build new image (old container still serving) ─────────────────────────
echo "[2/6] Building new image (traffic still on $ACTIVE_SLOT:$ACTIVE_PORT)..."
docker compose --project-directory . -f "$COMPOSE_FILE" build --no-cache kortix-api

# ── 3. Start standby container ───────────────────────────────────────────────
echo "[3/6] Starting $STANDBY_SLOT on port $STANDBY_PORT..."

# Stop standby if it's somehow still running from a previous failed deploy
docker rm -f "kortix-api-$STANDBY_SLOT" 2>/dev/null || true

docker run -d \
  --name "kortix-api-$STANDBY_SLOT" \
  --env-file kortix-api/.env \
  -p "$STANDBY_PORT:8008" \
  --restart unless-stopped \
  "$(docker compose --project-directory . -f "$COMPOSE_FILE" config --images | grep kortix-api | head -1)"

# ── 4. Health check standby ──────────────────────────────────────────────────
echo "[4/6] Health checking $STANDBY_SLOT on port $STANDBY_PORT..."
ELAPSED=0
while [ $ELAPSED -lt $HEALTH_TIMEOUT ]; do
  if curl -sf "http://localhost:$STANDBY_PORT/v1/health" > /dev/null 2>&1; then
    echo "  ✓ Healthy after ${ELAPSED}s"
    break
  fi
  sleep $HEALTH_INTERVAL
  ELAPSED=$((ELAPSED + HEALTH_INTERVAL))
done

if [ $ELAPSED -ge $HEALTH_TIMEOUT ]; then
  echo "  ✗ FAILED — rolling back"
  docker rm -f "kortix-api-$STANDBY_SLOT" 2>/dev/null || true
  echo "  Standby container removed. Active ($ACTIVE_SLOT:$ACTIVE_PORT) unchanged."
  exit 1
fi

# ── 5. Swap nginx to standby port ────────────────────────────────────────────
echo "[5/6] Swapping nginx: $ACTIVE_PORT → $STANDBY_PORT..."
sudo sed -i "s|proxy_pass http://127.0.0.1:[0-9]*;|proxy_pass http://127.0.0.1:$STANDBY_PORT;|" "$NGINX_CONF"
sudo nginx -t 2>&1 && sudo nginx -s reload

# Verify the swap worked
sleep 1
if curl -sf "https://localhost:443/v1/health" -k > /dev/null 2>&1; then
  echo "  ✓ nginx serving from $STANDBY_SLOT:$STANDBY_PORT"
else
  # Revert nginx
  echo "  ✗ nginx swap failed — reverting"
  sudo sed -i "s|proxy_pass http://127.0.0.1:[0-9]*;|proxy_pass http://127.0.0.1:$ACTIVE_PORT;|" "$NGINX_CONF"
  sudo nginx -s reload
  docker rm -f "kortix-api-$STANDBY_SLOT" 2>/dev/null || true
  exit 1
fi

# ── 6. Stop old container ────────────────────────────────────────────────────
echo "[6/6] Stopping old $ACTIVE_SLOT container..."
docker rm -f "kortix-api-$ACTIVE_SLOT" 2>/dev/null || true

# Also stop the compose-managed container if it exists from before this script was used
docker compose --project-directory . -f "$COMPOSE_FILE" --profile backend down --remove-orphans 2>/dev/null || true

# Save active slot
echo "$STANDBY_SLOT" > "$STATE_FILE"

# Cleanup
docker image prune -af --filter "until=24h" 2>/dev/null || true

echo ""
echo "┌─────────────────────────────────────────┐"
echo "│ ✓ Deploy complete — zero downtime       │"
echo "│ Active: $STANDBY_SLOT (port $STANDBY_PORT)               │"
echo "│ Commit: $(git log -1 --oneline | head -c 50) │"
echo "└─────────────────────────────────────────┘"
