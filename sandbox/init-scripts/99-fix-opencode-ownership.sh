#!/usr/bin/with-contenv bash
# Fix opencode data directory ownership.
#
# The linuxserver base image re-chowns /workspace (mapped to /config) to
# PUID:PGID (default 1000:1000) during its own init. But opencode serve
# runs as user abc (UID 911) via s6-setuidgid, so it can't create the
# SQLite database in a directory owned by UID 1000.
#
# This script runs AFTER all linuxserver migrations and re-sets correct
# ownership on the opencode data directory.

echo "[fix-opencode-ownership] Setting /workspace/.local/share/opencode to abc:abc..."
chown -R abc:abc /workspace/.local/share/opencode 2>/dev/null || true

# Also fix the .opencode config dir and .kortix state dir
chown -R abc:abc /workspace/.opencode 2>/dev/null || true
chown -R abc:abc /workspace/.kortix 2>/dev/null || true
