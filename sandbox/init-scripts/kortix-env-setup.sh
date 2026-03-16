#!/usr/bin/with-contenv bash
# Kortix environment setup — minimal version
# Just sets up the Kortix token for passthrough billing, no URL rewriting

# ── Git identity ──────────────────────────────────────────────────────────────
# Required for createProject() git commits and OpenCode project discovery.
# Without this, `git commit` fails silently in sandboxes → repos have no commits
# → OpenCode can't derive a project ID → everything falls back to "global".
if ! git config --global user.email >/dev/null 2>&1; then
    git config --global user.email "agent@kortix.ai"
    git config --global user.name "Kortix Agent"
    echo "[Kortix] Git identity configured"
fi

# ── Workspace git init ────────────────────────────────────────────────────────
# /workspace/ is the main workspace root. Init it as a git repo so OpenCode
# resolves a real project ID instead of falling back to id="global".
if [ ! -d /workspace/.git ] || [ -z "$(git -C /workspace rev-list --max-parents=0 --all 2>/dev/null)" ]; then
    cd /workspace
    [ ! -d .git ] && git init
    # Ensure at least one commit exists (OpenCode needs root commit for project ID)
    if [ -z "$(git rev-list --max-parents=0 --all 2>/dev/null)" ]; then
        # Stage .kortix and .opencode config only — don't commit user projects
        git add .kortix .opencode .gitignore 2>/dev/null || true
        git commit --allow-empty -m "Workspace init" >/dev/null 2>&1
    fi
    chown -R abc:users /workspace/.git 2>/dev/null || true
    echo "[Kortix] Workspace git repo initialized"
fi

# ── Dev server crash protection ─────────────────────────────────────────────
GUARD_PATH="/opt/kortix-master/econnreset-guard.cjs"
if [ -f "$GUARD_PATH" ]; then
    EXISTING_NODE_OPTIONS="${NODE_OPTIONS:-}"
    if echo "$EXISTING_NODE_OPTIONS" | grep -q "$GUARD_PATH" 2>/dev/null; then
        echo "[Kortix] NODE_OPTIONS ECONNRESET guard already present"
    else
        printf '%s' "${EXISTING_NODE_OPTIONS:+$EXISTING_NODE_OPTIONS }--require=$GUARD_PATH" > /run/s6/container_environment/NODE_OPTIONS
        echo "[Kortix] NODE_OPTIONS ECONNRESET guard enabled"
    fi
fi

# ── Tool dependencies ─────────────────────────────────────────────────────────
# OpenCode bundler resolves modules from /workspace/.cache/opencode (its runtime
# package cache). Pre-seed tool deps there so external tool imports work offline.
CACHE_DIR="/workspace/.cache/opencode"
if [ -d /opt/opencode/node_modules ] && [ ! -d "$CACHE_DIR/node_modules/@mendable" ]; then
    mkdir -p "$CACHE_DIR"
    cp -r /opt/opencode/node_modules "$CACHE_DIR/" 2>/dev/null || true
    # Copy package.json so bun treats it as a valid project
    [ -f /opt/opencode/package.json ] && cp /opt/opencode/package.json "$CACHE_DIR/" 2>/dev/null || true
    [ -f /opt/opencode/bun.lock ] && cp /opt/opencode/bun.lock "$CACHE_DIR/" 2>/dev/null || true
    chown -R abc:users "$CACHE_DIR" 2>/dev/null || true
    echo "[Kortix] Tool deps seeded into $CACHE_DIR"
fi

echo "[Kortix] Environment setup complete"
