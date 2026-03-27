#!/bin/bash
#
# start-sandbox.sh — Kortix sandbox Docker workload setup
#
# Sets up the systemd service, pulls the image, and starts the container.
# Runs once during image build; the snapshot preserves everything for future boots.
#
# Usage: start-sandbox.sh <docker-image>
#   e.g. start-sandbox.sh kortix/computer:0.8.20
#
set -euo pipefail

DOCKER_IMAGE="${1:?Usage: start-sandbox.sh <docker-image>}"

CONFIG_FILE="/etc/justavps/config.json"
# Do not bind host port 3456: the JustAVPS host already runs opencode-web there.
HOST_PORTS=(3000 8000 8080 6080 6081 3111 3210 3211 9223 9224 22222)

stage_callback() {
  local stage="$1" message="$2"
  if [ -f "$CONFIG_FILE" ]; then
    local slug callback_url machine_token
    slug="$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['slug'])" 2>/dev/null || true)"
    callback_url="$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['callback_url'])" 2>/dev/null || true)"
    machine_token="$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['machine_token'])" 2>/dev/null || true)"
    [ -n "$callback_url" ] && curl -sf -X POST "${callback_url}/api/v1/internal/stage" \
      -H "Content-Type: application/json" \
      -d "{\"slug\":\"${slug}\",\"machine_token\":\"${machine_token}\",\"stage\":\"${stage}\",\"message\":\"${message}\"}" \
      >/dev/null 2>&1 || true
  fi
}

# ── Docker run script ─────────────────────────────────────────────────────
cat > /usr/local/bin/justavps-docker-start.sh << DOCKERSTARTEOF
#!/bin/bash
set -e

ENV_FILE="/etc/justavps/env"
for i in \$(seq 1 60); do
  [ -s "\$ENV_FILE" ] && break
  sleep 1
done
if [ ! -s "\$ENV_FILE" ]; then
  touch "\$ENV_FILE"
fi

docker rm -f justavps-workload 2>/dev/null || true

exec docker run --rm \\
  --name justavps-workload \\
  --env-file "\$ENV_FILE" \\
  --cap-add SYS_ADMIN \\
  --security-opt seccomp=unconfined \\
  --shm-size 2g \\
  -v justavps-data:/workspace \\
  -v justavps-data:/config \\
  -p 3000:3000 \\
  -p 8000:8000 \\
  -p 8080:8080 \\
  -p 6080:6080 \\
  -p 6081:6081 \\
  -p 3111:3111 \\
  -p 3210:3210 \\
  -p 3211:3211 \\
  -p 9223:9223 \\
  -p 9224:9224 \\
  -p 22222:22 \\
  ${DOCKER_IMAGE}
DOCKERSTARTEOF
chmod +x /usr/local/bin/justavps-docker-start.sh

# ── Systemd service ───────────────────────────────────────────────────────
cat > /etc/systemd/system/justavps-docker.service << 'DOCKERSERVICEEOF'
[Unit]
Description=JustAVPS Docker workload
After=network-online.target docker.service
Requires=docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/justavps-docker-start.sh
Restart=always
RestartSec=5
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
DOCKERSERVICEEOF

# ── Write host ports for readiness checks ─────────────────────────────────
mkdir -p /etc/justavps
printf '%s\n' "${HOST_PORTS[@]}" > /etc/justavps/docker-host-ports

# ── Pull image ────────────────────────────────────────────────────────────
stage_callback "docker_pulling" "Pulling Docker image..."
echo "[kortix] Pulling $DOCKER_IMAGE..."
docker pull "$DOCKER_IMAGE"

# ── Host SSH bridge into the sandbox container ───────────────────────────
# JustAVPS only guarantees public SSH reachability on host port 22. Exposing
# the container directly on 22222 is not sufficient because provider/network
# firewalls may block custom inbound ports. To make `ssh abc@<ip>` land inside
# the Docker sandbox while preserving host admin access for root, install a
# host-side SSH bridge for user `abc`:
#   - auth keys are read from the container's /config/.ssh/authorized_keys
#   - every abc session is force-commanded into the container as user abc

id -u abc >/dev/null 2>&1 || useradd -m -s /bin/bash abc
passwd -l abc >/dev/null 2>&1 || true
usermod -aG docker abc >/dev/null 2>&1 || true

cat > /usr/local/bin/kortix-authorized-keys << 'AUTHORIZEDKEYSEOF'
#!/bin/bash
set -euo pipefail

USER_NAME="${1:-}"
[ "$USER_NAME" = "abc" ] || exit 0

docker exec justavps-workload sh -lc 'cat /config/.ssh/authorized_keys 2>/dev/null' || true
AUTHORIZEDKEYSEOF
chmod +x /usr/local/bin/kortix-authorized-keys

cat > /usr/local/bin/kortix-container-shell << 'CONTAINERSHELLEOF'
#!/bin/bash
set -euo pipefail

TTY_ARGS=(-i)
if [ -t 0 ] && [ -t 1 ]; then
  TTY_ARGS+=(-t)
fi

if [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
  exec docker exec -i \
    -u abc \
    -w /workspace \
    -e HOME=/config \
    -e USER=abc \
    -e LOGNAME=abc \
    -e TERM="${TERM:-xterm-256color}" \
    justavps-workload \
    sh -lc "$SSH_ORIGINAL_COMMAND"
fi

exec docker exec "${TTY_ARGS[@]}" \
  -u abc \
  -w /workspace \
  -e HOME=/config \
  -e USER=abc \
  -e LOGNAME=abc \
  -e TERM="${TERM:-xterm-256color}" \
  justavps-workload \
  bash -l
CONTAINERSHELLEOF
chmod +x /usr/local/bin/kortix-container-shell

mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/kortix-sandbox.conf << 'SSHEOF'
Match User abc
    PasswordAuthentication no
    PubkeyAuthentication yes
    AuthorizedKeysCommand /usr/local/bin/kortix-authorized-keys %u
    AuthorizedKeysCommandUser root
    PermitTTY yes
    X11Forwarding no
    PermitTunnel no
    GatewayPorts no
    ForceCommand /usr/local/bin/kortix-container-shell
SSHEOF

systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true

# ── Enable and start ──────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable justavps-docker 2>/dev/null || true
systemctl restart justavps-docker

# ── Wait for container ────────────────────────────────────────────────────
echo "[kortix] Waiting for Docker workload..."
for i in $(seq 1 120); do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q justavps-workload; then
    stage_callback "docker_running" "Docker container started"
    break
  fi
  sleep 2
done

# ── Wait for services ────────────────────────────────────────────────────
stage_callback "services_starting" "Services booting..."
echo "[kortix] Waiting for Kortix Master on :8000..."
for i in $(seq 1 120); do
  if curl -sf "http://localhost:8000/kortix/health" >/dev/null 2>&1 \
    || curl -sf "http://localhost:8000/" >/dev/null 2>&1; then
    stage_callback "services_ready" "All services are up"
    break
  fi
  sleep 2
done

echo "[kortix] Sandbox ready."
