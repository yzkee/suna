#!/usr/bin/env bash
set -euo pipefail

# ─── Build Hetzner Snapshot for kortix-computer ──────────────────────────────
#
# Creates a Hetzner snapshot named kortix-computer-v{version} by:
#   1. Spinning up a cx23 (cheapest 40GB x86) server with Ubuntu 24.04
#   2. Cloud-init: installs Docker, daemon, sandbox-agent, fail2ban,
#      systemd services, pulls kortix/computer:{version} image
#   3. Cloud-init powers the server off after everything is ready
#   4. Waits for the server to reach status=off
#   5. Creates a snapshot with description kortix-computer-v{version}
#   6. Deletes the temporary server
#
# The snapshot contains everything EXCEPT machine-specific config:
#   - /etc/justavps/config.json (slug, token, callback_url)
#   - /etc/justavps/env (environment variables)
#   - SSH keys
#   - UFW rules (broker IPs)
# Those are written by cloud-init on each boot in ~5 seconds.
#
# Usage:
#   ./scripts/build-hetzner-snapshot.sh                  # uses version from release.json
#   ./scripts/build-hetzner-snapshot.sh 0.8.2            # explicit version
#   ./scripts/build-hetzner-snapshot.sh --yes 0.8.2      # non-interactive recreate
#
# Requires:
#   HETZNER_API_KEY env var (or reads from kortix-api/.env)
# ─────────────────────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── Args ──────────────────────────────────────────────────────────────────────
FORCE_RECREATE="false"
VERSION=""

for arg in "$@"; do
  case "$arg" in
    --yes|--force|-y)
      FORCE_RECREATE="true"
      ;;
    *)
      if [[ -z "$VERSION" ]]; then
        VERSION="$arg"
      else
        echo "Error: unexpected argument '$arg'"
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  VERSION=$(python3 -c "import json; print(json.load(open('$ROOT_DIR/sandbox/release.json'))['version'])")
fi
SNAPSHOT_DESC="kortix-computer-v${VERSION}"
DOCKER_IMAGE="kortix/computer:${VERSION}"

# ── Auth ─────────────────────────────────────────────────────────────────────
if [[ -z "${HETZNER_API_KEY:-}" ]]; then
  if [[ -f "$ROOT_DIR/kortix-api/.env" ]]; then
    HETZNER_API_KEY=$(grep '^HETZNER_API_KEY=' "$ROOT_DIR/kortix-api/.env" | cut -d= -f2-)
  fi
fi
if [[ -z "${HETZNER_API_KEY:-}" ]]; then
  echo "Error: HETZNER_API_KEY not set"
  exit 1
fi

API="https://api.hetzner.cloud/v1"
AUTH="Authorization: Bearer $HETZNER_API_KEY"

hcloud() { curl -sf -H "$AUTH" -H "Content-Type: application/json" "$@"; }

# ── Colors ───────────────────────────────────────────────────────────────────
G='\033[32m' R='\033[31m' Y='\033[33m' C='\033[36m' X='\033[0m'
ok()   { echo -e "  ${G}✓${X} $*"; }
fail() { echo -e "  ${R}✗${X} $*"; exit 1; }
info() { echo -e "  ${C}▸${X} $*"; }
warn() { echo -e "  ${Y}!${X} $*"; }

echo ""
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Build Hetzner Snapshot v${VERSION}"
echo "  Image:    ${DOCKER_IMAGE}"
echo "  Snapshot: ${SNAPSHOT_DESC}"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Check image exists on Docker Hub ─────────────────────────────────────────
info "Checking Docker Hub for ${DOCKER_IMAGE}..."
if ! curl -sf "https://hub.docker.com/v2/repositories/kortix/computer/tags/${VERSION}" > /dev/null; then
  fail "Image ${DOCKER_IMAGE} not found on Docker Hub — run pnpm ship first"
fi
ok "Image found on Docker Hub"

# ── Check snapshot doesn't already exist ─────────────────────────────────────
info "Checking for existing snapshot..."
EXISTING=$(hcloud "$API/images?type=snapshot&per_page=50" | \
  python3 -c "import json,sys; imgs=json.load(sys.stdin)['images']; \
  matches=[i for i in imgs if i['description']=='$SNAPSHOT_DESC']; \
  print(matches[0]['id'] if matches else '')" 2>/dev/null || true)

if [[ -n "$EXISTING" ]]; then
  warn "Snapshot $SNAPSHOT_DESC already exists (id: $EXISTING)"
  if [[ "$FORCE_RECREATE" != "true" ]]; then
    read -r -p "  Delete and recreate? [y/N] " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
      echo "  Aborted."
      exit 0
    fi
  else
    info "--yes enabled, recreating snapshot automatically..."
  fi
  info "Deleting existing snapshot $EXISTING..."
  hcloud -X DELETE "$API/images/$EXISTING" > /dev/null
  ok "Deleted"
fi

# ── Cloud-init script ─────────────────────────────────────────────────────────
CLOUDINIT_FILE=$(mktemp)
trap 'rm -f "$CLOUDINIT_FILE"' EXIT
cat > "$CLOUDINIT_FILE" <<'CLOUDINIT'
#!/bin/bash
set -e

export DEBIAN_FRONTEND=noninteractive

# ── Create user account ──────────────────────────────────────────────────────
if ! id user &>/dev/null; then
  useradd -m -s /bin/bash -G sudo,docker user 2>/dev/null || useradd -m -s /bin/bash user
fi
mkdir -p /home/user/.ssh
chown -R user:user /home/user

# ── Install Docker ───────────────────────────────────────────────────────────
apt-get update -qq
apt-get install -y -qq ca-certificates curl fail2ban
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io

# ── Install justavps-daemon ──────────────────────────────────────────────────
DAEMON_URL="https://pub-caf7762051b942d5a801397d750a0dc3.r2.dev/daemon/dev/latest/justavps-daemon-linux-amd64"
curl -fsSL -o /usr/local/bin/justavps-daemon "$DAEMON_URL"
chmod +x /usr/local/bin/justavps-daemon

# ── Install sandbox-agent ────────────────────────────────────────────────────
curl -fsSL https://releases.rivet.dev/sandbox-agent/0.3.x/install.sh | sh || true
sandbox-agent install-agent --all 2>/dev/null || true

# ── Install OpenCode (for non-Docker mode) ───────────────────────────────────
su - user -c 'curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path' || true

# ── Configure fail2ban ───────────────────────────────────────────────────────
cat > /etc/fail2ban/jail.local << 'FAIL2BANEOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
backend = systemd

[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
FAIL2BANEOF
systemctl enable fail2ban

# ── Docker guard script ──────────────────────────────────────────────────────
cat > /usr/local/bin/justavps-docker-guard.sh << 'DOCKERGUARDEOF'
#!/bin/bash
set -euo pipefail
command -v iptables >/dev/null 2>&1 || exit 0
iptables -N JUSTAVPS-DOCKER-GUARD 2>/dev/null || true
iptables -F JUSTAVPS-DOCKER-GUARD
iptables -A JUSTAVPS-DOCKER-GUARD -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -A JUSTAVPS-DOCKER-GUARD -i docker0 -j RETURN
iptables -A JUSTAVPS-DOCKER-GUARD -i br+ -j RETURN
iptables -A JUSTAVPS-DOCKER-GUARD -o docker0 -j DROP
iptables -A JUSTAVPS-DOCKER-GUARD -o br+ -j DROP
iptables -A JUSTAVPS-DOCKER-GUARD -j RETURN
iptables -C DOCKER-USER -j JUSTAVPS-DOCKER-GUARD 2>/dev/null || iptables -I DOCKER-USER 1 -j JUSTAVPS-DOCKER-GUARD
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -N JUSTAVPS-DOCKER-GUARD 2>/dev/null || true
  ip6tables -F JUSTAVPS-DOCKER-GUARD
  ip6tables -A JUSTAVPS-DOCKER-GUARD -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
  ip6tables -A JUSTAVPS-DOCKER-GUARD -i docker0 -j RETURN
  ip6tables -A JUSTAVPS-DOCKER-GUARD -i br+ -j RETURN
  ip6tables -A JUSTAVPS-DOCKER-GUARD -o docker0 -j DROP
  ip6tables -A JUSTAVPS-DOCKER-GUARD -o br+ -j DROP
  ip6tables -A JUSTAVPS-DOCKER-GUARD -j RETURN
  ip6tables -C DOCKER-USER -j JUSTAVPS-DOCKER-GUARD 2>/dev/null || ip6tables -I DOCKER-USER 1 -j JUSTAVPS-DOCKER-GUARD
fi
DOCKERGUARDEOF
chmod +x /usr/local/bin/justavps-docker-guard.sh

# ── Systemd services ────────────────────────────────────────────────────────
cat > /etc/systemd/system/justavps-docker-guard.service << 'EOF'
[Unit]
Description=JustAVPS Docker ingress guard
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/justavps-docker-guard.sh
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/justavps-daemon.service << 'EOF'
[Unit]
Description=JustAVPS Daemon
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
ExecStart=/usr/local/bin/justavps-daemon --config /etc/justavps/config.json
Restart=always
RestartSec=2
StartLimitIntervalSec=0
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/sandbox-agent.service << 'EOF'
[Unit]
Description=Sandbox Agent (coding agent API)
After=network.target
[Service]
Type=simple
User=user
ExecStart=/usr/local/bin/sandbox-agent server --no-token --host 127.0.0.1 --port 2468
Restart=always
RestartSec=3
Environment=HOME=/home/user
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/opencode-web.service << 'EOF'
[Unit]
Description=OpenCode Web UI
After=network.target
[Service]
Type=simple
User=user
Environment=HOME=/home/user
Environment=PATH=/home/user/.opencode/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WorkingDirectory=/home/user
ExecStart=/home/user/.opencode/bin/opencode serve --port 3456
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF

# ── Watchdog script + timer ──────────────────────────────────────────────────
cat > /usr/local/bin/justavps-watchdog.sh << 'WATCHDOGEOF'
#!/bin/bash
DAEMON_URL="https://pub-caf7762051b942d5a801397d750a0dc3.r2.dev/daemon/dev/latest/justavps-daemon-linux-amd64"
if [ ! -x /usr/local/bin/justavps-daemon ]; then
  curl -fsSL -o /usr/local/bin/justavps-daemon "$DAEMON_URL" 2>/dev/null && \
    chmod +x /usr/local/bin/justavps-daemon || true
fi
if ! systemctl is-enabled --quiet justavps-daemon 2>/dev/null; then
  systemctl enable justavps-daemon 2>/dev/null || true
fi
if ! systemctl is-active --quiet justavps-daemon 2>/dev/null; then
  systemctl start justavps-daemon 2>/dev/null || true
fi
if command -v fail2ban-server &>/dev/null; then
  if ! systemctl is-active --quiet fail2ban 2>/dev/null; then
    systemctl enable fail2ban 2>/dev/null || true
    systemctl start fail2ban 2>/dev/null || true
  fi
fi
if command -v ufw &>/dev/null; then
  if ! ufw status | grep -q "Status: active" 2>/dev/null; then
    ufw --force enable 2>/dev/null || true
  fi
fi
WATCHDOGEOF
chmod +x /usr/local/bin/justavps-watchdog.sh

cat > /etc/systemd/system/justavps-watchdog.service << 'EOF'
[Unit]
Description=JustAVPS self-healing watchdog
[Service]
Type=oneshot
ExecStart=/usr/local/bin/justavps-watchdog.sh
EOF

cat > /etc/systemd/system/justavps-watchdog.timer << 'EOF'
[Unit]
Description=JustAVPS watchdog timer (every 2 minutes)
[Timer]
OnBootSec=60
OnUnitActiveSec=120
AccuracySec=30
[Install]
WantedBy=timers.target
EOF

# ── Docker start script ──────────────────────────────────────────────────────
cat > /usr/local/bin/justavps-docker-start.sh << 'DOCKERSTARTEOF'
#!/bin/bash
set -euo pipefail

DOCKER_IMAGE="${JUSTAVPS_DOCKER_IMAGE:-kortix/computer:latest}"
ENV_FILE="/etc/justavps/env"

resolve_host_port() {
  case "$1" in
    80) echo 8080 ;;
    443) echo 8443 ;;
    22) echo 22222 ;;
    *) echo "$1" ;;
  esac
}

PORT_ARGS=()
HOST_PORTS=()
while IFS= read -r exposed; do
  [ -n "$exposed" ] || continue
  port="${exposed%/*}"
  [ -n "$port" ] || continue
  host_port="$(resolve_host_port "$port")"
  PORT_ARGS+=("-p" "${host_port}:${port}")
  HOST_PORTS+=("$host_port")
done < <(docker image inspect "$DOCKER_IMAGE" --format '{{range $port, $_ := .Config.ExposedPorts}}{{println $port}}{{end}}' 2>/dev/null || true)

if [ ${#PORT_ARGS[@]} -eq 0 ]; then
  PORT_ARGS=(
    -p 3000:3000
    -p 8000:8000
    -p 8080:8080
    -p 6080:6080
    -p 6081:6081
    -p 3111:3111
    -p 3210:3210
    -p 3211:3211
    -p 9223:9223
    -p 9224:9224
    -p 22222:22
  )
  HOST_PORTS=(3000 8000 8080 6080 6081 3111 3210 3211 9223 9224 22222)
fi

docker rm -f justavps-workload 2>/dev/null || true

RUN_ARGS=(
  docker run --rm
  --name justavps-workload
  --env-file "$ENV_FILE"
  --cap-add SYS_ADMIN
  --shm-size=2g
  "${PORT_ARGS[@]}"
  -v /workspace:/workspace
  "$DOCKER_IMAGE"
)

mkdir -p /etc/justavps
printf '%s\n' "${HOST_PORTS[@]}" > /etc/justavps/docker-host-ports

exec "${RUN_ARGS[@]}"
DOCKERSTARTEOF
chmod +x /usr/local/bin/justavps-docker-start.sh

cat > /etc/systemd/system/justavps-docker.service << 'EOF'
[Unit]
Description=JustAVPS Docker workload
After=docker.service
Requires=docker.service
[Service]
Type=simple
EnvironmentFile=-/etc/justavps/docker-env
ExecStart=/usr/local/bin/justavps-docker-start.sh
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

# ── Enable services (but don't start — no config yet) ────────────────────────
systemctl daemon-reload
systemctl enable justavps-docker-guard
systemctl enable justavps-watchdog.timer
systemctl enable justavps-docker

# ── Prepare directories ─────────────────────────────────────────────────────
mkdir -p /etc/justavps /workspace
chown user:user /workspace

# ── Lock down password auth ──────────────────────────────────────────────────
passwd -d root 2>/dev/null || true
chage -M -1 root 2>/dev/null || true
chage -E -1 root 2>/dev/null || true
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
rm -f /etc/ssh/sshd_config.d/50-cloud-init.conf 2>/dev/null || true

CLOUDINIT

# Append the Docker pull + shutdown (these use the VERSION variable)
cat >> "$CLOUDINIT_FILE" <<EOF

# ── Pull sandbox image ───────────────────────────────────────────────────────
docker pull ${DOCKER_IMAGE}
docker tag ${DOCKER_IMAGE} kortix/computer:latest

# ── Clean up to minimize snapshot size ───────────────────────────────────────
apt-get clean
rm -rf /var/cache/apt/archives/* /tmp/* /var/tmp/* /root/.cache
journalctl --vacuum-size=5M 2>/dev/null || true

# ── Power off ────────────────────────────────────────────────────────────────
touch /tmp/kortix-snapshot-ready
shutdown -h now
EOF

USER_DATA=$(cat "$CLOUDINIT_FILE")

# ── Create build server ───────────────────────────────────────────────────────
info "Creating cx23 build server (Ubuntu 24.04, nbg1)..."
SERVER_RESP=$(hcloud -X POST "$API/servers" -d "{
  \"name\": \"kortix-snapshot-builder-${VERSION//\./-}\",
  \"server_type\": \"cx23\",
  \"image\": \"ubuntu-24.04\",
  \"location\": \"nbg1\",
  \"user_data\": $(echo "$USER_DATA" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  \"public_net\": {\"enable_ipv4\": true, \"enable_ipv6\": false}
}")

SERVER_ID=$(echo "$SERVER_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['server']['id'])")
ok "Server created: id=$SERVER_ID"

# ── Wait for cloud-init to complete ──────────────────────────────────────────
info "Waiting for setup + Docker pull to complete (this takes ~10-15 mins)..."
ELAPSED=0
TIMEOUT=1200  # 20 min max
while true; do
  sleep 30
  ELAPSED=$((ELAPSED + 30))

  STATUS=$(hcloud "$API/servers/$SERVER_ID" | python3 -c "import json,sys; print(json.load(sys.stdin)['server']['status'])" 2>/dev/null || echo "unknown")

  if [[ "$STATUS" == "off" ]]; then
    ok "Build complete, server powered off (${ELAPSED}s)"
    break
  fi

  if [[ $ELAPSED -ge $TIMEOUT ]]; then
    fail "Timeout after ${TIMEOUT}s — server may still be setting up. Check server $SERVER_ID manually."
  fi

  echo -n "  ... ${ELAPSED}s (status: $STATUS)"$'\r'
done

# ── Create snapshot ───────────────────────────────────────────────────────────
info "Creating snapshot '$SNAPSHOT_DESC'..."
SNAP_RESP=$(hcloud -X POST "$API/servers/$SERVER_ID/actions/create_image" -d "{
  \"type\": \"snapshot\",
  \"description\": \"$SNAPSHOT_DESC\"
}")
SNAP_ID=$(echo "$SNAP_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['image']['id'])")

# Wait for snapshot to be created
for i in $(seq 1 60); do
  SNAP_STATUS=$(hcloud "$API/images/$SNAP_ID" | python3 -c "import json,sys; print(json.load(sys.stdin)['image']['status'])")
  [[ "$SNAP_STATUS" == "available" ]] && break
  sleep 10
done
ok "Snapshot created: id=$SNAP_ID description=$SNAPSHOT_DESC"

# ── Delete build server ───────────────────────────────────────────────────────
info "Deleting build server..."
hcloud -X DELETE "$API/servers/$SERVER_ID" > /dev/null
ok "Build server deleted"

echo ""
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Done! Snapshot ready:"
echo "    ID:   $SNAP_ID"
echo "    Desc: $SNAPSHOT_DESC"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Snapshot includes:"
echo "    - Docker + kortix/computer:${VERSION}"
echo "    - justavps-daemon (latest dev)"
echo "    - sandbox-agent + fail2ban"
echo "    - All systemd services (daemon, docker, watchdog, guard)"
echo "    - OpenCode web runtime"
echo ""
echo "  Cloud-init only needs to write machine-specific config (~5s)"
echo ""
