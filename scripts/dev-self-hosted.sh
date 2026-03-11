#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_DIR="${KORTIX_HOME:-$HOME/.kortix}"

OWNER_EMAIL="${KORTIX_OWNER_EMAIL:-marko@kortix.ai}"
OWNER_PASSWORD="${KORTIX_OWNER_PASSWORD:-password1112}"

usage() {
  cat <<'EOF'
Usage: dev-self-hosted.sh [up|frontend|api|stop]

Commands:
  up        Ensure installer stack exists, then run frontend locally on 13737
  frontend  Stop frontend container and run local Next dev on 13737
  api       Stop API container and run local API dev on 13738
  stop      Stop local dev processes and restart normal containers if present

Env:
  KORTIX_HOME
  KORTIX_OWNER_EMAIL
  KORTIX_OWNER_PASSWORD
EOF
}

stop_dev_processes() {
  pkill -f 'next dev --port 13737' >/dev/null 2>&1 || true
  pkill -f 'next dev --turbopack --port 13737' >/dev/null 2>&1 || true
  pkill -f 'bun run --hot src/index.ts' >/dev/null 2>&1 || true
}

ensure_install() {
  if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    printf '1\n\n\n' | env \
      KORTIX_HOME="$INSTALL_DIR" \
      KORTIX_OWNER_EMAIL="$OWNER_EMAIL" \
      KORTIX_OWNER_PASSWORD="$OWNER_PASSWORD" \
      bash "$REPO_ROOT/scripts/get-kortix.sh" --local
  fi
}

run_frontend() {
  ensure_install
  docker compose -f "$INSTALL_DIR/docker-compose.yml" stop frontend
  cd "$REPO_ROOT/apps/frontend"
  set -a
  . "$INSTALL_DIR/.frontend-dev.env"
  export NEXT_PUBLIC_ENV_MODE=local
  exec node ./node_modules/next/dist/bin/next dev --port 13737
}

run_api() {
  ensure_install
  docker compose -f "$INSTALL_DIR/docker-compose.yml" stop kortix-api
  cd "$REPO_ROOT/kortix-api"
  set -a
  . "$INSTALL_DIR/.api-dev.env"
  exec bun run --hot src/index.ts
}

case "${1:-up}" in
  up)
    ensure_install
    echo "Installer stack is ready at http://localhost:13737"
    echo "Run '$0 frontend' for fast frontend iteration or '$0 api' for API dev mode."
    ;;
  frontend)
    run_frontend
    ;;
  api)
    run_api
    ;;
  stop)
    stop_dev_processes
    test -f "$INSTALL_DIR/docker-compose.yml" && docker compose -f "$INSTALL_DIR/docker-compose.yml" up -d frontend kortix-api >/dev/null 2>&1 || true
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
