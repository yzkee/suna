#!/bin/bash
# Daytona entrypoint — launches all services without s6-overlay.
# Daytona runs its own agent as PID 1, so s6 can't be used.
# This script writes per-service launcher scripts, runs them as user abc,
# and stays alive with sleep infinity.

set -e

export HOME=/config
export PATH="/opt/bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

echo "[startup] Starting Kortix sandbox services..."

# ── 1. Init scripts (run once) ──────────────────────────────────────────────

# Cloud-mode SDK URL routing
if [ "$ENV_MODE" = "cloud" ] || [ "$ENV_MODE" = "production" ]; then
    echo "[startup] Cloud mode — enabling API proxy routing"
    if [ -n "$KORTIX_API_URL" ]; then
        export TAVILY_API_URL="${KORTIX_API_URL}/tavily"
        export SERPER_API_URL="${KORTIX_API_URL}/serper"
        export FIRECRAWL_API_URL="${KORTIX_API_URL}/firecrawl"
        export REPLICATE_API_URL="${KORTIX_API_URL}/replicate"
        export CONTEXT7_API_URL="${KORTIX_API_URL}/context7"
        echo "[startup] SDK URLs routed through ${KORTIX_API_URL}"
    else
        echo "[startup] WARNING: KORTIX_API_URL not set in cloud mode"
    fi
else
    echo "[startup] Local mode — proxy routing disabled"
fi

# Desktop customization
if [ -x /custom-cont-init.d/99-customize ]; then
    echo "[startup] Running desktop customization..."
    bash /custom-cont-init.d/99-customize || true
fi

# Ensure workspace dirs exist and fix ALL permissions
# Daytona may create dirs as root/dockremap before our entrypoint runs.
mkdir -p /config/Desktop /config/workspace /config/workspace/.kortix \
    /config/.agent-browser /config/.browser-profile /config/.lss \
    /config/.local/share/opencode /config/.local/share/konsole
chown -R abc:abc /config 2>/dev/null || true

# ── 2. Write shared env file ────────────────────────────────────────────────
# All services source this so env vars propagate correctly.

cat > /tmp/kortix-env.sh << ENVEOF
export HOME=/config
export PATH="/opt/bun/bin:/usr/local/bin:/usr/bin:/bin"
export OPENCODE_CONFIG_DIR=/opt/opencode
export KORTIX_API_URL="${KORTIX_API_URL}"
export KORTIX_TOKEN="${KORTIX_TOKEN}"
export OPENCODE_SERVER_USERNAME="${OPENCODE_SERVER_USERNAME}"
export OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD}"
export TAVILY_API_URL="${TAVILY_API_URL}"
export SERPER_API_URL="${SERPER_API_URL}"
export FIRECRAWL_API_URL="${FIRECRAWL_API_URL}"
export REPLICATE_API_URL="${REPLICATE_API_URL}"
export CONTEXT7_API_URL="${CONTEXT7_API_URL}"
export OPENAI_API_KEY="${OPENAI_API_KEY}"
export AGENT_BROWSER_SOCKET_DIR="/config/.agent-browser"
ENVEOF
chmod 644 /tmp/kortix-env.sh

# ── 3. Write per-service scripts ────────────────────────────────────────────

# Kortix Master
cat > /tmp/svc-kortix-master.sh << 'EOF'
#!/bin/bash
source /tmp/kortix-env.sh
export KORTIX_MASTER_PORT=8000
export OPENCODE_HOST=localhost
export OPENCODE_PORT=4096
echo "[kortix-master] Starting on port 8000"
exec /opt/bun/bin/bun run /opt/kortix-master/src/index.ts
EOF

# OpenCode API Server
cat > /tmp/svc-opencode-serve.sh << 'EOF'
#!/bin/bash
source /tmp/kortix-env.sh
sleep 3
cd /config/Desktop
echo "[opencode-serve] Starting on port 4096"
exec opencode serve --port 4096 --hostname 0.0.0.0
EOF

# OpenCode Web UI (no auth)
cat > /tmp/svc-opencode-web.sh << 'EOF'
#!/bin/bash
source /tmp/kortix-env.sh
export OPENCODE_SERVER_USERNAME=
export OPENCODE_SERVER_PASSWORD=
sleep 5
cd /config/Desktop
echo "[opencode-web] Starting on port 3111"
exec opencode web --port 3111 --hostname 0.0.0.0
EOF

# Agent Browser Viewer
cat > /tmp/svc-browser-viewer.sh << 'EOF'
#!/bin/bash
source /tmp/kortix-env.sh
echo "[agent-browser-viewer] Starting on port 9224"
exec node -e "
const http = require('http');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync('/opt/agent-browser-viewer/index.html');
const socketDir = '/config/.agent-browser';
function getSessions() {
  try {
    const files = fs.readdirSync(socketDir);
    const sessions = [];
    for (const f of files) {
      if (f.endsWith('.stream')) {
        const name = f.replace('.stream', '');
        const port = parseInt(fs.readFileSync(path.join(socketDir, f), 'utf8').trim(), 10);
        if (port > 0 && files.includes(name + '.sock')) sessions.push({ name, port });
      }
    }
    return sessions;
  } catch(e) { return []; }
}
http.createServer((req, res) => {
  if (req.url === '/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getSessions()));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }
}).listen(9224, '0.0.0.0', () => console.log('[agent-browser-viewer] Ready on port 9224'));
"
EOF

# LSS Sync
cat > /tmp/svc-lss-sync.sh << 'EOF'
#!/bin/bash
source /tmp/kortix-env.sh
export LSS_DIR=/config/.lss
export PATH="/lsiopy/bin:$PATH"
echo "[lss-sync] Starting file watcher"
exec lss-sync \
    --watch /config/Desktop \
    --watch /config/workspace/.kortix \
    --exclude node_modules \
    --exclude .git \
    --exclude __pycache__ \
    --startup-delay 15 \
    --debounce 2
EOF

chmod +x /tmp/svc-*.sh

# ── 4. Launch all services as user abc ──────────────────────────────────────

echo "[startup] Launching services as user abc..."

su -s /bin/bash abc -c "/tmp/svc-kortix-master.sh"   > /var/log/kortix-master.log   2>&1 &
su -s /bin/bash abc -c "/tmp/svc-opencode-serve.sh"   > /var/log/opencode-serve.log  2>&1 &
su -s /bin/bash abc -c "/tmp/svc-opencode-web.sh"     > /var/log/opencode-web.log    2>&1 &
su -s /bin/bash abc -c "/tmp/svc-browser-viewer.sh"   > /var/log/browser-viewer.log  2>&1 &
su -s /bin/bash abc -c "/tmp/svc-lss-sync.sh"         > /var/log/lss-sync.log        2>&1 &

echo "[startup] All services launched. Logs in /var/log/. Staying alive..."

# Stay alive — Daytona expects the entrypoint to be long-running
exec sleep infinity
