#!/bin/sh

service_manager_gate_file() {
  local service_id="$1"
  local gate_dir="${KORTIX_SERVICE_GATE_DIR:-/workspace/.kortix/services/enabled}"
  mkdir -p "$gate_dir"
  if [ "$(id -u)" -eq 0 ]; then
    chown abc:users "$gate_dir" 2>/dev/null || true
  fi
  printf '%s/%s.enabled' "$gate_dir" "$service_id"
}

service_manager_require_enabled() {
  local service_id="$1"
  local label="${2:-$service_id}"
  local gate_file
  gate_file="$(service_manager_gate_file "$service_id")"

  if [ ! -f "$gate_file" ]; then
    echo "[$label] Managed by Kortix Master ServiceManager — holding s6 slot until enabled"
    exec sleep infinity
  fi
}


