#!/bin/bash
#
# start-sandbox.sh — Kortix sandbox Docker workload setup
#
# Runs once during image build. The snapshot preserves everything for future boots.
# On boot from snapshot, the systemd service waits for fresh env vars before starting.
#
# Usage: start-sandbox.sh <docker-image>
#
set -euo pipefail

DOCKER_IMAGE="${1:?Usage: start-sandbox.sh <docker-image>}"

# ── Provider config (change these when switching providers) ───────────────
PROVIDER_CONFIG="/etc/justavps/config.json"
ENV_FILE="/etc/justavps/env"
PORTS_FILE="/etc/justavps/docker-host-ports"
CONTAINER="justavps-workload"
VOLUME="justavps-data"
SERVICE="justavps-docker"

# ── Sandbox port map ─────────────────────────────────────────────────────
PORTS=(
  3000:3000 3456:3456 8000:8000 8080:8080
  6080:6080 6081:6081 3111:3111 3210:3210
  3211:3211 9223:9223 9224:9224 22222:22
)

# ── Helpers ───────────────────────────────────────────────────────────────
stage_callback() {
  [ -f "$PROVIDER_CONFIG" ] || return 0
  local stage="$1" msg="$2"
  local slug cb token
  slug=$(python3 -c "import json; print(json.load(open('$PROVIDER_CONFIG'))['slug'])" 2>/dev/null) || return 0
  cb=$(python3 -c "import json; print(json.load(open('$PROVIDER_CONFIG'))['callback_url'])" 2>/dev/null) || return 0
  token=$(python3 -c "import json; print(json.load(open('$PROVIDER_CONFIG'))['machine_token'])" 2>/dev/null) || return 0
  curl -sf -X POST "${cb}/api/v1/internal/stage" \
    -H "Content-Type: application/json" \
    -d "{\"slug\":\"${slug}\",\"machine_token\":\"${token}\",\"stage\":\"${stage}\",\"message\":\"${msg}\"}" \
    >/dev/null 2>&1 || true
}

wait_for() {
  local desc="$1"; shift
  echo "[kortix] Waiting for ${desc}..."
  for i in $(seq 1 120); do
    "$@" && return 0
    sleep 2
  done
  echo "[kortix] Timed out waiting for ${desc}"
}

# ── Build port args ───────────────────────────────────────────────────────
PORT_ARGS=""
HOST_PORTS=()
for mapping in "${PORTS[@]}"; do
  PORT_ARGS="${PORT_ARGS} -p ${mapping}"
  HOST_PORTS+=("${mapping%%:*}")
done

# ── Write docker start script (baked into snapshot) ───────────────────────
cat > /usr/local/bin/${SERVICE}-start.sh << STARTEOF
#!/bin/bash
set -e
BOOT_TIME=\$(stat -c %Y /proc/1 2>/dev/null || echo 0)
for i in \$(seq 1 120); do
  [ "\$(stat -c %Y "${ENV_FILE}" 2>/dev/null || echo 0)" -gt "\$BOOT_TIME" ] && break
  sleep 1
done
[ -s "${ENV_FILE}" ] || touch "${ENV_FILE}"
docker rm -f ${CONTAINER} 2>/dev/null || true
exec docker run --rm --name ${CONTAINER} --env-file "${ENV_FILE}" \\
  --cap-add SYS_ADMIN --security-opt seccomp=unconfined --shm-size 2g \\
  -v ${VOLUME}:/workspace -v ${VOLUME}:/config ${PORT_ARGS} \\
  ${DOCKER_IMAGE}
STARTEOF
chmod +x /usr/local/bin/${SERVICE}-start.sh

# ── Systemd service ───────────────────────────────────────────────────────
cat > /etc/systemd/system/${SERVICE}.service << SVCEOF
[Unit]
Description=Kortix sandbox workload
After=network-online.target docker.service
Requires=docker.service
Wants=network-online.target
[Service]
Type=simple
ExecStart=/usr/local/bin/${SERVICE}-start.sh
Restart=always
RestartSec=5
TimeoutStartSec=0
[Install]
WantedBy=multi-user.target
SVCEOF

# ── Metadata files ────────────────────────────────────────────────────────
mkdir -p "$(dirname "$PORTS_FILE")"
printf '%s\n' "${HOST_PORTS[@]}" > "$PORTS_FILE"

docker volume create ${VOLUME} 2>/dev/null || true
WS=$(docker volume inspect ${VOLUME} --format '{{.Mountpoint}}')
mkdir -p "${WS}/.kortix"
cat > "${WS}/.kortix/container.json" << CFGEOF
{
  "image": "${DOCKER_IMAGE}",
  "name": "${CONTAINER}",
  "volumes": ["${VOLUME}:/workspace", "${VOLUME}:/config"],
  "ports": ["3000:3000", "3456:3456", "8000:8000", "8080:8080", "6080:6080", "6081:6081", "3111:3111", "3210:3210", "3211:3211", "9223:9223", "9224:9224", "22222:22"],
  "caps": ["SYS_ADMIN"],
  "shmSize": "2g",
  "envFile": "${ENV_FILE}",
  "securityOpt": ["seccomp=unconfined"]
}
CFGEOF

# ── Disable conflicting host services ─────────────────────────────────────
systemctl disable --now opencode-web 2>/dev/null || true

# ── Pull and start ────────────────────────────────────────────────────────
stage_callback "docker_pulling" "Pulling Docker image..."
echo "[kortix] Pulling $DOCKER_IMAGE..."
docker pull "$DOCKER_IMAGE"

systemctl daemon-reload
systemctl enable ${SERVICE} 2>/dev/null || true
systemctl start ${SERVICE}

wait_for "container" sh -c "docker ps --format '{{.Names}}' 2>/dev/null | grep -q ${CONTAINER}"
stage_callback "docker_running" "Docker container started"

stage_callback "services_starting" "Services booting..."
wait_for "services" sh -c "for p in ${HOST_PORTS[*]}; do curl -sf http://localhost:\$p/ >/dev/null 2>&1 && exit 0; curl -sf http://localhost:\$p/health >/dev/null 2>&1 && exit 0; done; exit 1"
stage_callback "services_ready" "All services are up"

echo "[kortix] Sandbox ready."
