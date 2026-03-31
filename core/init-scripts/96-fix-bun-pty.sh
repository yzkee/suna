#!/bin/bash
# Patch all bun-pty .so files to use the musl-compatible version.
# The musl-compiled .so is baked into the image at /opt/bun-pty-musl/librust_pty.so.
# We must replace it everywhere bun-pty exists, including the workspace volume
# which persists across container restarts and may have the old glibc .so.

echo "[fix-bun-pty] ── bun-pty health check ──"

# ── Prerequisite: Bun runtime ────────────────────────────────────────────────
if ! command -v bun >/dev/null 2>&1; then
    echo "[fix-bun-pty] ERROR: bun not found in PATH! PTY will not work."
    echo "[fix-bun-pty]   PATH=$PATH"
    echo "[fix-bun-pty]   Expected: /opt/bun/bin/bun"
    ls -la /opt/bun/bin/ 2>/dev/null || echo "[fix-bun-pty]   /opt/bun/bin/ does not exist!"
else
    BUN_VER=$(bun --version 2>/dev/null || echo "unknown")
    echo "[fix-bun-pty] Bun runtime: v${BUN_VER} ($(which bun))"
fi

# ── Prerequisite: musl .so ───────────────────────────────────────────────────
MUSL_SO="/opt/bun-pty-musl/librust_pty.so"
if [ ! -f "$MUSL_SO" ]; then
    echo "[fix-bun-pty] WARNING: No musl .so found at $MUSL_SO — skipping musl patch."
    echo "[fix-bun-pty]   PTY may fail on Alpine/musl. Rebuild the Docker image."
fi

# ── Prerequisite: bun-pty node_modules ───────────────────────────────────────
BUN_PTY_PKG="/opt/kortix-master/node_modules/bun-pty/package.json"
if [ -f "$BUN_PTY_PKG" ]; then
    BUN_PTY_VER=$(python3 -c "import json; print(json.load(open('$BUN_PTY_PKG'))['version'])" 2>/dev/null || echo "unknown")
    echo "[fix-bun-pty] bun-pty installed: v${BUN_PTY_VER}"
else
    echo "[fix-bun-pty] ERROR: bun-pty not found at $BUN_PTY_PKG!"
    echo "[fix-bun-pty]   Run: cd /opt/kortix-master && bun install"
fi

# ── Patch musl .so into all bun-pty locations ────────────────────────────────
ARCH=$(uname -m)
REPLACED=0

if [ -f "$MUSL_SO" ]; then
    for PTY_DIR in \
        /opt/kortix-master/node_modules/bun-pty/rust-pty/target/release \
        /opt/bun/install/cache/bun-pty@*/rust-pty/target/release \
        /workspace/.cache/opencode/node_modules/bun-pty/rust-pty/target/release; do
        [ -d "$PTY_DIR" ] || continue
        if [ "$ARCH" = "x86_64" ]; then
            TARGET="$PTY_DIR/librust_pty.so"
        else
            TARGET="$PTY_DIR/librust_pty_arm64.so"
        fi
        if [ -f "$TARGET" ]; then
            # Check if already patched (compare file size as a quick heuristic)
            if ! cmp -s "$MUSL_SO" "$TARGET"; then
                cp "$MUSL_SO" "$TARGET"
                chown abc:abc "$TARGET" 2>/dev/null
                REPLACED=$((REPLACED + 1))
                echo "[fix-bun-pty] Patched: $TARGET"
            fi
        fi
    done

    if [ "$REPLACED" -gt 0 ]; then
        echo "[fix-bun-pty] Replaced $REPLACED glibc .so file(s) with musl version."
    else
        echo "[fix-bun-pty] All bun-pty .so files already patched."
    fi
fi

# ── Ensure OpenCode wrapper cache points at musl-compatible binary ───────────
# opencode-ai postinstall creates bin/.opencode from the non-musl package on Linux,
# which breaks on Alpine. Overwrite it with the musl binary at startup.
if [ "$ARCH" = "x86_64" ]; then
    MUSL_OPENCODE="/usr/local/lib/node_modules/opencode-linux-x64-musl/bin/opencode"
else
    MUSL_OPENCODE="/usr/local/lib/node_modules/opencode-linux-arm64-musl/bin/opencode"
fi

OPENCODE_CACHE_BIN="/usr/local/lib/node_modules/opencode-ai/bin/.opencode"
if [ -f "$MUSL_OPENCODE" ] && [ -f "$OPENCODE_CACHE_BIN" ]; then
    if ! cmp -s "$MUSL_OPENCODE" "$OPENCODE_CACHE_BIN"; then
        cp "$MUSL_OPENCODE" "$OPENCODE_CACHE_BIN"
        chmod +x "$OPENCODE_CACHE_BIN"
        echo "[fix-bun-pty] Replaced OpenCode cache binary with musl build."
    else
        echo "[fix-bun-pty] OpenCode cache binary already uses musl build."
    fi
fi

# ── Write BUN_PTY_LIB to s6 container environment ───────────────────────────
# Belt-and-suspenders — the Dockerfile ENV should already set it globally.
S6_ENV_DIR="/run/s6/container_environment"
if [ -d "$S6_ENV_DIR" ] && [ -f "$MUSL_SO" ]; then
    echo -n "$MUSL_SO" > "$S6_ENV_DIR/BUN_PTY_LIB"
    echo "[fix-bun-pty] Set BUN_PTY_LIB=$MUSL_SO in s6 container environment."
fi

# ── Smoke test: verify bun can load bun-pty ──────────────────────────────────
if command -v bun >/dev/null 2>&1 && [ -d /opt/kortix-master/node_modules/bun-pty ]; then
    echo "[fix-bun-pty] Running bun-pty smoke test..."
    SMOKE_RESULT=$(cd /opt/kortix-master && bun -e "
      try {
        const m = require('bun-pty');
        const keys = Object.keys(m);
        console.log('OK: bun-pty exports: ' + keys.join(', '));
        if (m.spawn) console.log('OK: spawn function available');
        else console.log('WARN: spawn function NOT found in exports');
        if (m.Terminal) console.log('OK: Terminal class available');
        else console.log('WARN: Terminal class NOT found in exports (monkey-patch will skip)');
      } catch(e) {
        console.log('FAIL: ' + e.message);
      }
    " 2>&1)
    echo "[fix-bun-pty] Smoke test: $SMOKE_RESULT"
else
    echo "[fix-bun-pty] Skipping smoke test (bun or bun-pty not available)"
fi

echo "[fix-bun-pty] ── health check complete ──"
