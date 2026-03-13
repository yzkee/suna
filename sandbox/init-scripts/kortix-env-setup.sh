#!/usr/bin/with-contenv bash
# Kortix environment setup — minimal version
# Just sets up the Kortix token for passthrough billing, no URL rewriting

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
