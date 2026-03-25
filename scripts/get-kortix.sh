#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  Kortix — One-Click Install                                               ║
# ║                                                                            ║
# ║  curl -fsSL https://kortix.com/install | bash                              ║
# ║                                                                            ║
# ║  Supports two modes (same stack, different bind address):                  ║
# ║    1. Local (laptop/desktop) — binds to 127.0.0.1                          ║
# ║    2. VPS / Server           — binds to 0.0.0.0 (world-accessible)        ║
# ║                                                                            ║
# ║  No reverse proxy included. Bring your own Caddy/nginx/Cloudflare if      ║
# ║  you want HTTPS.                                                           ║
# ║                                                                            ║
# ║  Database: Docker Supabase or external (bring your own).                   ║
# ║                                                                            ║
# ║  Requirement: Docker + Docker Compose v2.                                  ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────────────────────
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'; CYAN=$'\033[0;36m'; BOLD=$'\033[1m'
DIM=$'\033[2m'; NC=$'\033[0m'

info()    { echo "  ${BLUE}[INFO]${NC} $*"; }
success() { echo "  ${GREEN}[OK]${NC}   $*"; }
warn()    { echo "  ${YELLOW}[WARN]${NC} $*"; }
error()   { echo "  ${RED}[ERR]${NC}  $*" >&2; }
fatal()   { error "$*"; exit 1; }

# ─── Config ──────────────────────────────────────────────────────────────────
INSTALL_DIR="${KORTIX_HOME:-$HOME/.kortix}"
DEFAULT_KORTIX_VERSION="0.8.19"
KORTIX_VERSION="${KORTIX_VERSION:-$DEFAULT_KORTIX_VERSION}"
KORTIX_LOCAL_IMAGES="${KORTIX_LOCAL_IMAGES:-0}"
KORTIX_LOCAL_TAG="${KORTIX_LOCAL_TAG:-latest}"
KORTIX_BUILD_LOCAL_IMAGES="${KORTIX_BUILD_LOCAL_IMAGES:-0}"
KORTIX_PULL_PARALLELISM="${KORTIX_PULL_PARALLELISM:-4}"
# Always prefer /dev/tty for interactive reads — critical for
# `curl URL | bash` where stdin is the pipe, not the terminal.
TTY_AVAILABLE="0"
if [ -r /dev/tty ] && [ -w /dev/tty ]; then
  TTY_AVAILABLE="1"
fi
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
REPO_ROOT=""
if [ -n "$SCRIPT_SOURCE" ] && [ "$SCRIPT_SOURCE" != "bash" ] && [ -f "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
KORTIX_LOCAL_REPO_ROOT="${KORTIX_LOCAL_REPO_ROOT:-$REPO_ROOT}"

resolve_node_bin() {
  local nvm_latest
  nvm_latest=$(ls -1dt "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | head -1 || true)
  if [ -n "$nvm_latest" ] && [ -x "$nvm_latest" ]; then
    printf '%s' "$nvm_latest"
    return
  fi
  command -v node
}

NODE_BIN="$(resolve_node_bin || true)"
PNPM_BIN="$(command -v pnpm || true)"
BUN_BIN="$(command -v bun || true)"

compute_compose_project_name() {
  local raw
  raw="$(basename "$INSTALL_DIR")"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed 's/^[._-]*//; s/[^a-z0-9_-]//g')"
  [ -n "$raw" ] || raw="kortix"
  printf '%s' "$raw"
}

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(compute_compose_project_name)}"
SANDBOX_NETWORK="${SANDBOX_NETWORK:-${COMPOSE_PROJECT_NAME}_default}"

parse_query_param() {
  local raw="$1"
  local qs="${raw#*\?}"
  IFS='&' read -r -a pairs <<< "$qs"
  for pair in "${pairs[@]}"; do
    local key="${pair%%=*}"
    local value="${pair#*=}"
    case "$key" in
      v|version|tag)
        [ -n "$value" ] && KORTIX_VERSION="$value"
        ;;
    esac
  done
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --local)
        KORTIX_LOCAL_IMAGES=1
        shift
        ;;
      --build-local)
        KORTIX_LOCAL_IMAGES=1
        KORTIX_BUILD_LOCAL_IMAGES=1
        shift
        ;;
      --local-tag)
        [ "$#" -ge 2 ] || fatal "--local-tag requires a value"
        KORTIX_LOCAL_IMAGES=1
        KORTIX_LOCAL_TAG="$2"
        shift 2
        ;;
      --local-tag=*)
        KORTIX_LOCAL_IMAGES=1
        KORTIX_LOCAL_TAG="${1#*=}"
        shift
        ;;
      --version)
        [ "$#" -ge 2 ] || fatal "--version requires a value"
        KORTIX_VERSION="$2"
        shift 2
        ;;
      --version=*)
        KORTIX_VERSION="${1#*=}"
        shift
        ;;
      --query)
        [ "$#" -ge 2 ] || fatal "--query requires a value"
        parse_query_param "$2"
        shift 2
        ;;
      --query=*)
        parse_query_param "${1#*=}"
        shift
        ;;
      \?*|*'?'*)
        parse_query_param "$1"
        shift
        ;;
      -h|--help)
        cat <<'EOF'
Usage: get-kortix.sh [options]

Options:
  --local             Use local Docker images instead of pulling from registry
  --build-local       Rebuild local installer images before starting
  --local-tag <tag>   Local image tag to use (default: latest)
  --local-tag=<tag>   Same as above
  --version <tag>     Install a specific image tag (default: current stable release)
  --version=<tag>     Same as above
  --query "v=<tag>"   Query-style version override
  --query "version=<tag>"

Examples:
  bash get-kortix.sh
  bash get-kortix.sh --local
  bash get-kortix.sh --local --build-local
  bash get-kortix.sh --local --local-tag latest
  bash get-kortix.sh --version 0.7.14
  bash get-kortix.sh --query "v=0.7.14"
  KORTIX_VERSION=0.7.15 bash get-kortix.sh
EOF
        exit 0
        ;;
      *)
        fatal "Unknown option: $1"
        ;;
    esac
  done
}

parse_args "$@"

IMAGE_TAG="$KORTIX_VERSION"
SANDBOX_IMAGE_REPO="kortix/computer"
if [ "$KORTIX_LOCAL_IMAGES" = "1" ]; then
  IMAGE_TAG="$KORTIX_LOCAL_TAG"
  SANDBOX_IMAGE_REPO="kortix/computer"
fi

FRONTEND_IMAGE="${KORTIX_FRONTEND_IMAGE:-kortix/kortix-frontend:${IMAGE_TAG}}"
API_IMAGE="${KORTIX_API_IMAGE:-kortix/kortix-api:${IMAGE_TAG}}"
SANDBOX_IMAGE="${KORTIX_SANDBOX_IMAGE:-${SANDBOX_IMAGE_REPO}:${IMAGE_TAG}}"
FRONTEND_IMAGE_OVERRIDDEN="0"
API_IMAGE_OVERRIDDEN="0"
SANDBOX_IMAGE_OVERRIDDEN="0"
[ -n "${KORTIX_FRONTEND_IMAGE:-}" ] && FRONTEND_IMAGE_OVERRIDDEN="1"
[ -n "${KORTIX_API_IMAGE:-}" ] && API_IMAGE_OVERRIDDEN="1"
[ -n "${KORTIX_SANDBOX_IMAGE:-}" ] && SANDBOX_IMAGE_OVERRIDDEN="1"
SUPABASE_POSTGRES_IMAGE="supabase/postgres:15.8.1.085"
SUPABASE_GOTRUE_IMAGE="supabase/gotrue:v2.186.0"
SUPABASE_KONG_IMAGE="kong:2.8.1"
SUPABASE_REST_IMAGE="postgrest/postgrest:v14.5"

# Installer state
DEPLOY_MODE=""          # "local" or "vps"
DB_MODE=""              # "docker" or "external"
SERVER_IP=""


# Supabase — generated for docker mode, provided for external
SUPABASE_URL=""
SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""
SUPABASE_JWT_SECRET=""
DATABASE_URL=""
POSTGRES_PASSWORD=""

# Generated secrets
CRON_SECRET=""
INTERNAL_SERVICE_KEY=""

# Computed URLs
PUBLIC_URL=""
API_PUBLIC_URL=""

# Optional integrations
INTEGRATION_AUTH_PROVIDER="disabled"
PIPEDREAM_CLIENT_ID=""
PIPEDREAM_CLIENT_SECRET=""
PIPEDREAM_PROJECT_ID=""
PIPEDREAM_ENVIRONMENT=""
SLACK_CLIENT_ID=""
SLACK_CLIENT_SECRET=""
SLACK_SIGNING_SECRET=""

# ─── Helpers ─────────────────────────────────────────────────────────────────
open_browser() {
  local url="$1"
  if command -v open &>/dev/null; then open "$url" 2>/dev/null || true
  elif command -v xdg-open &>/dev/null; then xdg-open "$url" 2>/dev/null || true
  elif command -v wslview &>/dev/null; then wslview "$url" 2>/dev/null || true
  fi
}

prompt_read() {
  local __var_name="$1"
  if [ "$TTY_AVAILABLE" = "1" ]; then
    IFS= read -r "$__var_name" </dev/tty
  else
    IFS= read -r "$__var_name"
  fi
}

warm_local_sandbox() {
  [ "$DEPLOY_MODE" = "local" ] || return 0

  local warm_url="${API_PUBLIC_URL}/v1/setup/local-sandbox/warm"
  local status_url="${API_PUBLIC_URL}/v1/setup/local-sandbox/warm/status"

  info "Pre-warming local sandbox..."
  curl -sf -X POST "$warm_url" >/dev/null || {
    warn "Could not start sandbox warmup yet — onboarding will start it lazily."
    return 0
  }

  local attempts=0
  local max_attempts=180
  while [ $attempts -lt $max_attempts ]; do
    local payload status progress message
    payload=$(curl -sf "$status_url" 2>/dev/null || true)
    status=$(JSON_PAYLOAD="$payload" python3 -c 'import json, os; data=json.loads(os.environ.get("JSON_PAYLOAD") or "{}"); print(data.get("status", ""))')
    progress=$(JSON_PAYLOAD="$payload" python3 -c 'import json, os; data=json.loads(os.environ.get("JSON_PAYLOAD") or "{}"); print(data.get("progress", ""))')
    message=$(JSON_PAYLOAD="$payload" python3 -c 'import json, os; data=json.loads(os.environ.get("JSON_PAYLOAD") or "{}"); print(data.get("message", ""))')

    case "$status" in
      ready)
        success "Local sandbox is warm and healthy"
        return 0
        ;;
      error)
        warn "Local sandbox warmup reported an error: ${message:-unknown}"
        return 0
        ;;
      pulling|creating)
        info "Sandbox warmup: ${message:-starting} ${progress:+(${progress}%)}"
        ;;
      *)
        info "Sandbox warmup: waiting for sandbox bootstrap..."
        ;;
    esac

    sleep 2
    attempts=$((attempts + 1))
  done

  warn "Sandbox warmup timed out — the UI can still continue waiting for sandbox boot."
}

verify_local_image() {
  local image="$1"
  docker image inspect "$image" >/dev/null 2>&1 || fatal "Local image not found: ${image}. Build or tag it first, or run without --local."
}

ensure_local_build_requirements() {
  [ -d "$KORTIX_LOCAL_REPO_ROOT/apps/frontend" ] || fatal "Local repo root not found at ${KORTIX_LOCAL_REPO_ROOT}."
  [ -x "$PNPM_BIN" ] || fatal "pnpm is required for --build-local."
}

rebuild_local_images() {
  ensure_local_build_requirements
  local build_script="$KORTIX_LOCAL_REPO_ROOT/scripts/build-local-images.sh"
  [ -f "$build_script" ] || fatal "Local build script not found: ${build_script}"

  info "Rebuilding local installer images from ${KORTIX_LOCAL_REPO_ROOT}"
  echo ""
  bash "$build_script" --tag "$KORTIX_LOCAL_TAG"
  success "Local images rebuilt"
}

generate_password() {
  local seg1 seg2 seg3
  seg1=$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 4)
  seg2=$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 4)
  seg3=$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 4)
  echo "kx-${seg1}-${seg2}-${seg3}"
}

generate_token() {
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

get_server_ip() {
  curl -4 -sf --connect-timeout 5 https://ifconfig.me 2>/dev/null \
    || curl -4 -sf --connect-timeout 5 https://api.ipify.org 2>/dev/null \
    || curl -4 -sf --connect-timeout 5 https://icanhazip.com 2>/dev/null \
    || echo ""
}

get_host_docker_socket() {
  docker context inspect --format '{{ (index .Endpoints "docker").Host }}' 2>/dev/null || echo "${DOCKER_HOST:-}"
}

docker_manifest_exists() {
  local image="$1"
  # Check locally first, then Docker Hub registry
  docker image inspect "$image" >/dev/null 2>&1 && return 0
  docker manifest inspect "$image" >/dev/null 2>&1
}

resolve_release_images() {
  [ "$KORTIX_LOCAL_IMAGES" = "1" ] && return 0

  info "Resolving release images for ${KORTIX_VERSION}..."

  if ! docker_manifest_exists "$FRONTEND_IMAGE"; then
    if [ "$FRONTEND_IMAGE_OVERRIDDEN" = "1" ]; then
      fatal "Configured frontend image not found: ${FRONTEND_IMAGE}"
    fi
    local fallback_frontend="kortix/kortix-frontend:latest"
    if docker_manifest_exists "$fallback_frontend"; then
      warn "Frontend image ${FRONTEND_IMAGE} not found; falling back to ${fallback_frontend}"
      FRONTEND_IMAGE="$fallback_frontend"
    else
      fatal "Frontend image not found for ${KORTIX_VERSION}, and latest fallback is unavailable."
    fi
  fi

  if ! docker_manifest_exists "$API_IMAGE"; then
    if [ "$API_IMAGE_OVERRIDDEN" = "1" ]; then
      fatal "Configured API image not found: ${API_IMAGE}"
    fi
    local fallback_api="kortix/kortix-api:latest"
    if docker_manifest_exists "$fallback_api"; then
      warn "API image ${API_IMAGE} not found; falling back to ${fallback_api}"
      API_IMAGE="$fallback_api"
    else
      fatal "API image not found for ${KORTIX_VERSION}, and latest fallback is unavailable."
    fi
  fi

  if ! docker_manifest_exists "$SANDBOX_IMAGE"; then
    if [ "$SANDBOX_IMAGE_OVERRIDDEN" = "1" ]; then
      fatal "Configured sandbox image not found: ${SANDBOX_IMAGE}"
    fi
    local fallback_sandbox="${SANDBOX_IMAGE_REPO}:latest"
    if docker_manifest_exists "$fallback_sandbox"; then
      warn "Sandbox image ${SANDBOX_IMAGE} not found; falling back to ${fallback_sandbox}"
      SANDBOX_IMAGE="$fallback_sandbox"
    else
      fatal "Sandbox image not found for ${KORTIX_VERSION}, and latest fallback is unavailable."
    fi
  fi

  success "Release images resolved"
}

pull_images_parallel() {
  local -a images=("$@")
  [ ${#images[@]} -gt 0 ] || return 0

  printf '%s\n' "${images[@]}" | python3 -c 'import sys; print("\n".join(sorted(set(line.strip() for line in sys.stdin if line.strip()))))' \
    | xargs -r -n1 -P "$KORTIX_PULL_PARALLELISM" docker pull
}

# Free ports used by Kortix (local mode)
# Usage: free_kortix_ports [project_name]
# If project_name is provided, only cleans containers from that project
free_kortix_ports() {
  local project_name="${1:-}"
  local is_local=0
  
  # Determine if we're in local mode
  if [ -n "$project_name" ]; then
    # Called from CLI with project name
    is_local=1
  elif [ "$DEPLOY_MODE" = "local" ]; then
    # Called during install
    is_local=1
  fi
  
  [ $is_local -eq 1 ] || return 0
  
  local ports=(13737 13738 13740 13741)
  local freed=0
  
  # First, clean up any lingering containers that might hold ports
  # Use project-specific pattern if project_name is provided
  if [ -n "$project_name" ]; then
    # Clean up containers from this specific project (including old Created state containers)
    docker ps -a --format '{{.Names}}' | grep -E "^${project_name}-" | xargs -r docker rm -f 2>/dev/null || true
  fi
  
  # Kill any processes using the ports
  for port in "${ports[@]}"; do
    local pid
    pid=$(lsof -t -i:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
      kill -9 $pid 2>/dev/null || true
      freed=1
    fi
  done
  
  [ $freed -eq 1 ] && info "Freed Kortix ports" || true
}

# Generate a Supabase JWT (anon or service_role)
# Usage: generate_supabase_jwt <role> <jwt_secret>
generate_supabase_jwt() {
  local role="$1" secret="$2"
  local header payload header_b64 payload_b64 signature
  header='{"alg":"HS256","typ":"JWT"}'
  # iat: 2022-01-01, exp: 2037-01-01 (same as Supabase defaults)
  payload="{\"role\":\"${role}\",\"iss\":\"supabase\",\"iat\":1641024000,\"exp\":2114380800}"

  header_b64=$(echo -n "$header" | base64 | tr '+/' '-_' | tr -d '=\n')
  payload_b64=$(echo -n "$payload" | base64 | tr '+/' '-_' | tr -d '=\n')
  signature=$(echo -n "${header_b64}.${payload_b64}" | openssl dgst -sha256 -hmac "$secret" -binary | base64 | tr '+/' '-_' | tr -d '=\n')

  echo "${header_b64}.${payload_b64}.${signature}"
}

# ─── Banner ──────────────────────────────────────────────────────────────────
banner() {
  echo ""
  echo "${BOLD}${CYAN}"
  cat << 'EOF'
   _  __         _   _
  | |/ /___  _ _| |_(_)_ __
  | ' </ _ \| '_|  _| \ \ /
  |_|\_\___/|_|  \__|_/_\_\
EOF
  echo "${NC}"
  echo "  ${DIM}One-Click Installer${NC}"
  echo ""
}

# ─── Preflight ───────────────────────────────────────────────────────────────
preflight() {
  info "Checking prerequisites..."
  echo ""

  command -v docker &>/dev/null || fatal "Docker is required. Get it at: https://docs.docker.com/get-docker/"
  success "Docker installed"

  docker info &>/dev/null 2>&1 || fatal "Docker is not running. Start Docker Desktop and try again."
  success "Docker is running"

  docker compose version &>/dev/null 2>&1 || fatal "Docker Compose v2 is required. Included with Docker Desktop."
  success "Docker Compose available"

  command -v openssl &>/dev/null || fatal "openssl is required (for JWT generation)."
  success "openssl available"

  echo ""
}

# ─── Mode Selection ──────────────────────────────────────────────────────────
prompt_mode() {
  echo "  ${BOLD}Where are you running Kortix?${NC}"
  echo ""
  echo "    ${CYAN}1${NC}) Local machine ${DIM}(laptop/desktop — binds to localhost)${NC}"
  echo "    ${CYAN}2${NC}) VPS / Server  ${DIM}(cloud VM — binds to 0.0.0.0)${NC}"
  echo ""
  printf "  Choice [1]: "
  prompt_read mode_choice

  case "${mode_choice:-1}" in
    2)
      DEPLOY_MODE="vps"
      SERVER_IP=$(get_server_ip)
      if [ -n "$SERVER_IP" ]; then
        info "Detected server IP: ${BOLD}${SERVER_IP}${NC}"
      else
        printf "  Enter server IP or hostname: "
        prompt_read SERVER_IP
        [ -z "$SERVER_IP" ] && fatal "Server IP is required for VPS mode."
      fi
      ;;
    *) DEPLOY_MODE="local" ;;
  esac

  echo ""
}

# ─── Database Setup ──────────────────────────────────────────────────────────
prompt_database() {
  echo "  ${BOLD}Database setup${NC}"
  echo ""
  echo "    ${CYAN}1${NC}) Docker ${DIM}(spin up Supabase locally via Docker)${NC}"
  echo "    ${CYAN}2${NC}) External ${DIM}(provide Supabase project URL or database URL)${NC}"
  echo ""
  printf "  Choice [1]: "
  prompt_read db_choice

  case "${db_choice:-1}" in
    2)
      DB_MODE="external"
      echo ""
      echo "  ${BOLD}Supabase credentials${NC}"
      echo "  ${DIM}From your Supabase project: Settings → API${NC}"
      echo ""
      printf "    Supabase URL ${DIM}(e.g. https://xxx.supabase.co)${NC}: "
      prompt_read SUPABASE_URL
      printf "    Anon Key: "
      prompt_read SUPABASE_ANON_KEY
      printf "    Service Role Key: "
      prompt_read SUPABASE_SERVICE_ROLE_KEY
      printf "    JWT Secret: "
      prompt_read SUPABASE_JWT_SECRET
      echo ""
      echo "  ${DIM}From: Settings → Database → Connection string (URI)${NC}"
      printf "    Database URL ${DIM}(postgresql://...)${NC}: "
      prompt_read DATABASE_URL
      echo ""

      if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ -z "$DATABASE_URL" ]; then
        fatal "All Supabase credentials are required for external mode."
      fi

      success "External Supabase configured"
      ;;
    *)
      DB_MODE="docker"
      info "Supabase will run in Docker (auto-configured)"
      ;;
  esac

  echo ""
}



# ─── Integrations (Pipedream) ────────────────────────────────────────────────
# Pipedream creds are optional — the sandbox can send its own via request headers.
prompt_integrations() {
  INTEGRATION_AUTH_PROVIDER="pipedream"
}



# ─── Compute URLs ────────────────────────────────────────────────────────────
compute_urls() {
  if [ "$DEPLOY_MODE" = "vps" ]; then
    PUBLIC_URL="http://${SERVER_IP}:13737"
    API_PUBLIC_URL="http://${SERVER_IP}:13738"
  else
    PUBLIC_URL="http://localhost:13737"
    API_PUBLIC_URL="http://localhost:13738"
  fi
}

# ─── Generate Secrets ────────────────────────────────────────────────────────
generate_secrets() {
  info "Generating security credentials..."

  CRON_SECRET=$(generate_password)
  INTERNAL_SERVICE_KEY=$(generate_token)
  API_KEY_SECRET=$(generate_token)

  # Generate Supabase credentials for Docker mode
  if [ "$DB_MODE" = "docker" ]; then
    POSTGRES_PASSWORD=$(generate_token | head -c 32)
    SUPABASE_JWT_SECRET=$(generate_token)$(generate_token)  # 64 chars
    SUPABASE_ANON_KEY=$(generate_supabase_jwt "anon" "$SUPABASE_JWT_SECRET")
    SUPABASE_SERVICE_ROLE_KEY=$(generate_supabase_jwt "service_role" "$SUPABASE_JWT_SECRET")

    # Internal Supabase URL (kong gateway inside Docker network)
    SUPABASE_URL="http://supabase-kong:8000"
    DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@supabase-db:5432/postgres"

    success "Supabase credentials generated"
  fi

  success "All secrets generated"
  echo ""
}



# ─── Write Kong Config ──────────────────────────────────────────────────────
write_kong_config() {
  [ "$DB_MODE" != "docker" ] && return

  mkdir -p "$INSTALL_DIR/volumes/api"
  cat > "$INSTALL_DIR/volumes/api/kong.yml" << 'KONGEOF'
_format_version: '2.1'
_transform: true

consumers:
  - username: anon
    keyauth_credentials:
      - key: $SUPABASE_ANON_KEY
  - username: service_role
    keyauth_credentials:
      - key: $SUPABASE_SERVICE_KEY

acls:
  - consumer: anon
    group: anon
  - consumer: service_role
    group: admin

services:
  ## Open Auth routes (no key required)
  - name: auth-v1-open
    url: http://supabase-auth:9999/verify
    routes:
      - name: auth-v1-open
        strip_path: true
        paths:
          - /auth/v1/verify
    plugins:
      - name: cors
  - name: auth-v1-open-callback
    url: http://supabase-auth:9999/callback
    routes:
      - name: auth-v1-open-callback
        strip_path: true
        paths:
          - /auth/v1/callback
    plugins:
      - name: cors
  - name: auth-v1-open-authorize
    url: http://supabase-auth:9999/authorize
    routes:
      - name: auth-v1-open-authorize
        strip_path: true
        paths:
          - /auth/v1/authorize
    plugins:
      - name: cors

  ## Secure Auth routes
  - name: auth-v1
    url: http://supabase-auth:9999/
    routes:
      - name: auth-v1-all
        strip_path: true
        paths:
          - /auth/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon

  ## Secure REST routes
  - name: rest-v1
    url: http://supabase-rest:3000/
    routes:
      - name: rest-v1-all
        strip_path: true
        paths:
          - /rest/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: true
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon
KONGEOF

  success "Saved Kong config"
}

# ─── Write DB Init SQL ──────────────────────────────────────────────────────
write_db_init() {
  [ "$DB_MODE" != "docker" ] && return

  mkdir -p "$INSTALL_DIR/volumes/db"

  # Roles init (required for GoTrue + PostgREST)
  cat > "$INSTALL_DIR/volumes/db/roles.sql" << 'ROLESEOF'
-- Supabase roles required by GoTrue and PostgREST
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE CREATEDB;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin LOGIN NOINHERIT CREATEROLE CREATEDB REPLICATION BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
END
$$;

-- Grant roles
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;
GRANT supabase_auth_admin TO authenticator;
GRANT supabase_admin TO postgres;

-- Auth schema
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO postgres;
ALTER ROLE supabase_auth_admin SET search_path = 'auth';

-- Set passwords (will be replaced by entrypoint)
ALTER ROLE supabase_auth_admin WITH PASSWORD 'POSTGRES_PASSWORD_PLACEHOLDER';
ALTER ROLE authenticator WITH PASSWORD 'POSTGRES_PASSWORD_PLACEHOLDER';
ALTER ROLE supabase_admin WITH PASSWORD 'POSTGRES_PASSWORD_PLACEHOLDER';
ROLESEOF

  # Kortix extensions and schemas
  cat > "$INSTALL_DIR/volumes/db/kortix.sql" << 'KORTIXEOF'
-- Kortix bootstrap: extensions and schemas
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE SCHEMA IF NOT EXISTS kortix;
CREATE SCHEMA IF NOT EXISTS basejump;

-- Scheduler helper (pg_cron → tick endpoint)
CREATE OR REPLACE FUNCTION kortix.configure_scheduler(api_url TEXT, tick_secret TEXT)
RETURNS void AS $$
BEGIN
  PERFORM cron.unschedule('kortix_global_tick')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kortix_global_tick');
  PERFORM cron.schedule(
    'kortix_global_tick',
    '* * * * *',
    format(
      'SELECT net.http_post(url := %L, headers := ''{"Content-Type": "application/json", "x-cron-secret": "%s"}''::jsonb, body := ''{"source": "pg_cron"}''::jsonb, timeout_milliseconds := 30000)',
      api_url || '/v1/cron/tick',
      tick_secret
    )
  );
END;
$$ LANGUAGE plpgsql;

-- PostgREST needs these grants
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
KORTIXEOF

  success "Saved DB init scripts"
}

# ─── Write docker-compose.yml ───────────────────────────────────────────────
write_compose() {
  info "Writing docker-compose.yml..."

  # Port bindings — local binds to 127.0.0.1, VPS binds to 0.0.0.0
  local bind_addr="127.0.0.1"
  [ "$DEPLOY_MODE" = "vps" ] && bind_addr="0.0.0.0"

  local frontend_ports="    ports:
      - \"${bind_addr}:13737:3000\""
  local api_ports="    ports:
      - \"${bind_addr}:13738:8008\""
  local supabase_ports="    ports:
      - \"${bind_addr}:13740:8000\""
  local db_ports="    ports:
      - \"${bind_addr}:13741:5432\""

  # Supabase services (Docker mode only)
  local supabase_services="" supabase_volumes="" api_depends frontend_supabase_env
  local supabase_url_env supabase_db_env

  if [ "$DB_MODE" = "docker" ]; then
    supabase_services="
  supabase-db:
    image: ${SUPABASE_POSTGRES_IMAGE}
${db_ports}
    volumes:
      - supabase-db-data:/var/lib/postgresql/data
      - ./volumes/db/roles.sql:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:Z
      - ./volumes/db/kortix.sql:/docker-entrypoint-initdb.d/init-scripts/99-kortix.sql:Z
    environment:
      POSTGRES_HOST: /var/run/postgresql
      POSTGRES_PORT: \"5432\"
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: postgres
      JWT_SECRET: \${SUPABASE_JWT_SECRET}
      JWT_EXP: \"3600\"
    command:
      - postgres
      - -c
      - config_file=/etc/postgresql/postgresql.conf
      - -c
      - log_min_messages=fatal
    healthcheck:
      test: [\"CMD-SHELL\", \"pg_isready -U postgres -h localhost\"]
      interval: 5s
      timeout: 3s
      retries: 15
      start_period: 10s
    restart: unless-stopped

  supabase-auth:
    image: ${SUPABASE_GOTRUE_IMAGE}
    depends_on:
      supabase-db:
        condition: service_healthy
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: \"9999\"
      API_EXTERNAL_URL: \${SUPABASE_PUBLIC_URL}
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:\${POSTGRES_PASSWORD}@supabase-db:5432/postgres
      GOTRUE_SITE_URL: \${PUBLIC_URL}
      GOTRUE_URI_ALLOW_LIST: \"\"
      GOTRUE_DISABLE_SIGNUP: \"false\"
      GOTRUE_JWT_ADMIN_ROLES: service_role
      GOTRUE_JWT_AUD: authenticated
      GOTRUE_JWT_DEFAULT_GROUP_NAME: authenticated
      GOTRUE_JWT_EXP: \"3600\"
      GOTRUE_JWT_SECRET: \${SUPABASE_JWT_SECRET}
      GOTRUE_EXTERNAL_EMAIL_ENABLED: \"true\"
      GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: \"false\"
      GOTRUE_MAILER_AUTOCONFIRM: \"true\"
      GOTRUE_SMTP_ADMIN_EMAIL: admin@localhost
      GOTRUE_SMTP_HOST: localhost
      GOTRUE_SMTP_PORT: \"587\"
      GOTRUE_SMTP_USER: unused
      GOTRUE_SMTP_PASS: unused
      GOTRUE_SMTP_SENDER_NAME: Kortix
      GOTRUE_MAILER_URLPATHS_INVITE: /auth/v1/verify
      GOTRUE_MAILER_URLPATHS_CONFIRMATION: /auth/v1/verify
      GOTRUE_MAILER_URLPATHS_RECOVERY: /auth/v1/verify
      GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: /auth/v1/verify
    healthcheck:
      test: [\"CMD\", \"wget\", \"--no-verbose\", \"--tries=1\", \"--spider\", \"http://localhost:9999/health\"]
      timeout: 5s
      interval: 5s
      retries: 3
    restart: unless-stopped

  supabase-rest:
    image: ${SUPABASE_REST_IMAGE}
    depends_on:
      supabase-db:
        condition: service_healthy
    environment:
      PGRST_DB_URI: postgres://authenticator:\${POSTGRES_PASSWORD}@supabase-db:5432/postgres
      PGRST_DB_SCHEMAS: public
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: \${SUPABASE_JWT_SECRET}
      PGRST_DB_USE_LEGACY_GUCS: \"false\"
      PGRST_APP_SETTINGS_JWT_SECRET: \${SUPABASE_JWT_SECRET}
      PGRST_APP_SETTINGS_JWT_EXP: \"3600\"
    command: [\"postgrest\"]
    restart: unless-stopped

  supabase-kong:
    image: ${SUPABASE_KONG_IMAGE}
${supabase_ports}
    volumes:
      - ./volumes/api/kong.yml:/home/kong/temp.yml:ro
    depends_on:
      supabase-auth:
        condition: service_healthy
    environment:
      KONG_DATABASE: \"off\"
      KONG_DECLARATIVE_CONFIG: /home/kong/kong.yml
      KONG_DNS_ORDER: LAST,A,CNAME
      KONG_PLUGINS: request-transformer,cors,key-auth,acl,basic-auth
      KONG_NGINX_PROXY_PROXY_BUFFER_SIZE: 160k
      KONG_NGINX_PROXY_PROXY_BUFFERS: 64 160k
      SUPABASE_ANON_KEY: \${SUPABASE_ANON_KEY}
      SUPABASE_SERVICE_KEY: \${SUPABASE_SERVICE_ROLE_KEY}
    entrypoint: bash -c 'eval \"echo \\\"\$\$(cat ~/temp.yml)\\\"\" > ~/kong.yml && /docker-entrypoint.sh kong docker-start'
    restart: unless-stopped
"
    supabase_volumes="  supabase-db-data:"

    api_depends="    depends_on:
      supabase-db:
        condition: service_healthy
      supabase-auth:
        condition: service_healthy"

    # Frontend env vars for Supabase connection.
    #
    # CRITICAL: The server-side SUPABASE_URL MUST match the client-side
    # NEXT_PUBLIC_SUPABASE_URL. The @supabase/ssr library derives cookie
    # names from the URL hostname. If they differ, auth breaks (redirect loop).
    #
    # Both modes use the same HTTP-based pattern: Kong is exposed on host port
    # 13740 via the bind address. The frontend container uses extra_hosts to
    # resolve localhost to the host gateway.
    frontend_supabase_env="      - KORTIX_PUBLIC_SUPABASE_URL=\${SUPABASE_PUBLIC_URL}
      - KORTIX_PUBLIC_SUPABASE_ANON_KEY=\${SUPABASE_ANON_KEY}
      - KORTIX_PUBLIC_BACKEND_URL=\${API_PUBLIC_URL}/v1
      - KORTIX_PUBLIC_BILLING_ENABLED=false
      - KORTIX_PUBLIC_ENV_MODE=local
      - KORTIX_PUBLIC_APP_URL=\${PUBLIC_URL}
      - SUPABASE_URL=\${SUPABASE_PUBLIC_URL}
      - SUPABASE_SERVER_URL=http://supabase-kong:8000
      - SUPABASE_ANON_KEY=\${SUPABASE_ANON_KEY}
      - BACKEND_URL=\${API_PUBLIC_URL}/v1"

    supabase_url_env="      - SUPABASE_URL=http://supabase-kong:8000"
    supabase_db_env="      - DATABASE_URL=postgresql://postgres:\${POSTGRES_PASSWORD}@supabase-db:5432/postgres"

  else
    # External mode — no Supabase containers
    api_depends="    # External Supabase — no local dependencies"
    frontend_supabase_env="      - KORTIX_PUBLIC_SUPABASE_URL=\${SUPABASE_URL}
      - KORTIX_PUBLIC_SUPABASE_ANON_KEY=\${SUPABASE_ANON_KEY}
      - KORTIX_PUBLIC_BACKEND_URL=\${API_PUBLIC_URL}/v1
      - KORTIX_PUBLIC_BILLING_ENABLED=false
      - KORTIX_PUBLIC_ENV_MODE=local
      - KORTIX_PUBLIC_APP_URL=\${PUBLIC_URL}
      - SUPABASE_URL=\${SUPABASE_URL}
      - SUPABASE_ANON_KEY=\${SUPABASE_ANON_KEY}
      - BACKEND_URL=\${API_PUBLIC_URL}/v1"
    supabase_url_env="      - SUPABASE_URL=\${SUPABASE_URL}"
    supabase_db_env="      - DATABASE_URL=\${DATABASE_URL}"
  fi

  cat > "$INSTALL_DIR/docker-compose.yml" << COMPOSE
# Kortix — auto-generated by get-kortix.sh
# Mode: ${DEPLOY_MODE} | Database: ${DB_MODE}
services:
${supabase_services}
  frontend:
    image: ${FRONTEND_IMAGE}
${frontend_ports}
    extra_hosts:
      - "localhost:host-gateway"
    environment:
${frontend_supabase_env}
    depends_on:
      kortix-api:
        condition: service_started
    restart: unless-stopped

  kortix-api:
    image: ${API_IMAGE}
    user: "0:0"
${api_ports}
    environment:
      - PORT=8008
${supabase_url_env}
${supabase_db_env}
      - SUPABASE_SERVICE_ROLE_KEY=\${SUPABASE_SERVICE_ROLE_KEY}
      - ALLOWED_SANDBOX_PROVIDERS=local_docker
      - KORTIX_LOCAL_IMAGES=\${KORTIX_LOCAL_IMAGES}
      - DOCKER_HOST=unix:///var/run/docker.sock
      - KORTIX_URL=http://kortix-api:8008/v1/router
      - SANDBOX_NETWORK=${SANDBOX_NETWORK}
      - INTERNAL_SERVICE_KEY=\${INTERNAL_SERVICE_KEY}
      - FRONTEND_URL=\${PUBLIC_URL}
      - API_KEY_SECRET=\${API_KEY_SECRET}
      - CORS_ALLOWED_ORIGINS=\${PUBLIC_URL}
      - SANDBOX_IMAGE=\${SANDBOX_IMAGE}
      - SANDBOX_VERSION=\${KORTIX_VERSION}
      - KORTIX_ROUTER_INTERNAL_ENABLED=false
      - KORTIX_BILLING_INTERNAL_ENABLED=false
    env_file:
      - .env
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
${api_depends}
    restart: unless-stopped

volumes:
${supabase_volumes}
COMPOSE

  success "Saved docker-compose.yml"
}

# ─── Write .env ──────────────────────────────────────────────────────────────
write_env() {
  cat > "$INSTALL_DIR/.env" << ENVEOF
# ──────────────────────────────────────────────────────────────────────────────
# Kortix — Environment Configuration
# Auto-generated by get-kortix.sh on $(date -u '+%Y-%m-%d %H:%M:%S UTC')
# ──────────────────────────────────────────────────────────────────────────────

# ─── Mode ────────────────────────────────────────────────────────────────────
DEPLOY_MODE=${DEPLOY_MODE}
DB_MODE=${DB_MODE}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}
KORTIX_LOCAL_IMAGES=${KORTIX_LOCAL_IMAGES}
KORTIX_LOCAL_TAG=${KORTIX_LOCAL_TAG}
KORTIX_LOCAL_REPO_ROOT=${KORTIX_LOCAL_REPO_ROOT}

# ─── URLs ────────────────────────────────────────────────────────────────────
PUBLIC_URL=${PUBLIC_URL}
API_PUBLIC_URL=${API_PUBLIC_URL}
SUPABASE_PUBLIC_URL=${SUPABASE_PUBLIC_URL:-http://localhost:13740}

# ─── Supabase ────────────────────────────────────────────────────────────────
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
SUPABASE_JWT_SECRET=${SUPABASE_JWT_SECRET}
DATABASE_URL=${DATABASE_URL}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# ─── Security ────────────────────────────────────────────────────────────────
INTERNAL_SERVICE_KEY=${INTERNAL_SERVICE_KEY}
API_KEY_SECRET=${API_KEY_SECRET}

# ─── Integrations (Pipedream) ────────────────────────────────────────────────
INTEGRATION_AUTH_PROVIDER=${INTEGRATION_AUTH_PROVIDER}
PIPEDREAM_CLIENT_ID=${PIPEDREAM_CLIENT_ID}
PIPEDREAM_CLIENT_SECRET=${PIPEDREAM_CLIENT_SECRET}
PIPEDREAM_PROJECT_ID=${PIPEDREAM_PROJECT_ID}
PIPEDREAM_ENVIRONMENT=${PIPEDREAM_ENVIRONMENT:-production}

# ─── Channels (Slack) ───────────────────────────────────────────────────────
SLACK_CLIENT_ID=${SLACK_CLIENT_ID}
SLACK_CLIENT_SECRET=${SLACK_CLIENT_SECRET}
SLACK_SIGNING_SECRET=${SLACK_SIGNING_SECRET}

# ─── Sandbox ─────────────────────────────────────────────────────────────────
KORTIX_VERSION=${KORTIX_VERSION}
SANDBOX_IMAGE=${SANDBOX_IMAGE}
SANDBOX_NETWORK=${SANDBOX_NETWORK}
KORTIX_SANDBOX_VERSION=${KORTIX_VERSION}
ENVEOF

  chmod 600 "$INSTALL_DIR/.env"
  success "Saved .env"
}

write_dev_env_files() {
  local host_addr="localhost"
  [ "$DEPLOY_MODE" = "vps" ] && host_addr="${SERVER_IP}"
  local api_port="13738"
  local host_supabase_url="http://${host_addr}:13740"
  local host_database_url="postgresql://postgres:${POSTGRES_PASSWORD}@${host_addr}:13741/postgres"
  local host_docker_host="$(get_host_docker_socket)"
  local host_sandbox_network="${SANDBOX_NETWORK}"

  cat > "$INSTALL_DIR/.api-dev.env" << ENVEOF
PORT=${api_port}
SUPABASE_URL=${host_supabase_url}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
SUPABASE_JWT_SECRET=${SUPABASE_JWT_SECRET}
DATABASE_URL=${host_database_url}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DOCKER_HOST=${host_docker_host}
ALLOWED_SANDBOX_PROVIDERS=local_docker
KORTIX_LOCAL_IMAGES=${KORTIX_LOCAL_IMAGES}
KORTIX_URL=${API_PUBLIC_URL}/v1/router
SANDBOX_NETWORK=${host_sandbox_network}
INTERNAL_SERVICE_KEY=${INTERNAL_SERVICE_KEY}
ENVEOF

  cat > "$INSTALL_DIR/.frontend-dev.env" << ENVEOF
NEXT_PUBLIC_ENV_MODE=local
NEXT_PUBLIC_BACKEND_URL=${API_PUBLIC_URL}/v1
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_PUBLIC_URL:-http://localhost:13740}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
NEXT_PUBLIC_BILLING_ENABLED=false
ENVEOF

  chmod 600 "$INSTALL_DIR/.api-dev.env" "$INSTALL_DIR/.frontend-dev.env"
  success "Saved dev env files"
}



# ─── Fixup DB init SQL (replace password placeholder) ───────────────────────
fixup_db_init() {
  [ "$DB_MODE" != "docker" ] && return
  # Replace placeholder with actual password in roles.sql
  if [ -f "$INSTALL_DIR/volumes/db/roles.sql" ]; then
    sed -i.bak "s/POSTGRES_PASSWORD_PLACEHOLDER/${POSTGRES_PASSWORD}/g" "$INSTALL_DIR/volumes/db/roles.sql"
    rm -f "$INSTALL_DIR/volumes/db/roles.sql.bak"
  fi
}



# ─── Write CLI ───────────────────────────────────────────────────────────────
write_cli() {
  cat > "$INSTALL_DIR/kortix" << 'CLIPATH'
#!/usr/bin/env bash
set -euo pipefail
# Resolve symlinks so DIR points to the actual install directory
SELF="$0"
[ -L "$SELF" ] && SELF="$(readlink -f "$SELF" 2>/dev/null || readlink "$SELF")"
DIR="$(cd "$(dirname "$SELF")" && pwd)"
cd "$DIR"

G=$'\033[0;32m'; R=$'\033[0;31m'; C=$'\033[0;36m'; Y=$'\033[1;33m'
B=$'\033[1m'; D=$'\033[2m'; N=$'\033[0m'

prompt_read() {
  local __var_name="$1"
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    IFS= read -r "$__var_name" </dev/tty
  else
    IFS= read -r "$__var_name"
  fi
}

# Installed release metadata is persisted in .env so updates stay pinned.
VERSION=$(grep -m1 '^KORTIX_VERSION=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || echo "unknown")
SANDBOX_IMAGE=$(grep -m1 '^SANDBOX_IMAGE=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || echo "kortix/computer:${VERSION}")
LOCAL_IMAGES=$(grep -m1 '^KORTIX_LOCAL_IMAGES=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || echo "0")
LOCAL_TAG=$(grep -m1 '^KORTIX_LOCAL_TAG=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || echo "latest")
LOCAL_REPO_ROOT=$(grep -m1 '^KORTIX_LOCAL_REPO_ROOT=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || echo "")

_open() {
  if command -v open &>/dev/null; then open "$1" 2>/dev/null
  elif command -v xdg-open &>/dev/null; then xdg-open "$1" 2>/dev/null
  elif command -v wslview &>/dev/null; then wslview "$1" 2>/dev/null
  fi
}

_url() {
  if [ -f "$DIR/.env" ]; then
    grep -m1 '^PUBLIC_URL=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || echo "http://localhost:13737"
  else
    echo "http://localhost:13737"
  fi
}

_mode() {
  if [ -f "$DIR/.env" ]; then
    grep -m1 '^DEPLOY_MODE=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || echo "local"
  else
    echo "local"
  fi
}

_project_name() {
  if [ -f "$DIR/.env" ]; then
    grep -m1 '^COMPOSE_PROJECT_NAME=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || echo "kortix"
  else
    echo "kortix"
  fi
}

# Free ports used by Kortix (local mode)
_free_kortix_ports() {
  local project_name
  project_name=$(_project_name)
  local ports=(13737 13738 13740 13741)
  local freed=0

  # Clean up any lingering containers from this project
  docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E "^${project_name}-" | xargs -r docker rm -f 2>/dev/null || true

  # Kill any processes using the ports
  for port in "${ports[@]}"; do
    local pid
    pid=$(lsof -t -i:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
      kill -9 $pid 2>/dev/null || true
      freed=1
    fi
  done

  [ $freed -eq 1 ] && echo "  ${Y}Freed Kortix ports${N}" || true
}

_sync_supabase_passwords() {
  [ -f "$DIR/.env" ] || return 0

  local db_mode db_password escaped_password attempts
  db_mode=$(grep -m1 '^DB_MODE=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || echo "")
  [ "$db_mode" = "docker" ] || return 0

  db_password=$(grep -m1 '^POSTGRES_PASSWORD=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || echo "")
  [ -n "$db_password" ] || return 0

  escaped_password=${db_password//\'/\'\'}

  docker compose up -d supabase-db >/dev/null 2>&1 || return 0

  attempts=0
  until docker compose exec -T supabase-db sh -lc 'pg_isready -U postgres -h localhost >/dev/null 2>&1'; do
    attempts=$((attempts + 1))
    [ $attempts -ge 30 ] && return 0
    sleep 1
  done

  printf "SET ROLE supabase_admin;\nALTER ROLE supabase_auth_admin WITH PASSWORD '%s';\nALTER ROLE authenticator WITH PASSWORD '%s';\nALTER ROLE supabase_admin WITH PASSWORD '%s';\n" \
    "$escaped_password" "$escaped_password" "$escaped_password" \
    | docker compose exec -T supabase-db sh -lc 'psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null' >/dev/null 2>&1 || true
}

_using_local_images() {
  [ "$LOCAL_IMAGES" = "1" ]
}

_rebuild_local_images() {
  [ -n "$LOCAL_REPO_ROOT" ] || { echo "  ${R}KORTIX_LOCAL_REPO_ROOT is not set${N}"; exit 1; }
  local build_script="$LOCAL_REPO_ROOT/scripts/build-local-images.sh"
  [ -f "$build_script" ] || { echo "  ${R}Build script not found: ${build_script}${N}"; exit 1; }
  bash "$build_script" --tag "$LOCAL_TAG"
}

_reset_stack() {
  local yes_flag="${1:-}"
  if [ "$yes_flag" != "--yes" ]; then
    printf "  Reset local data and recreate the stack? [y/N]: "
    prompt_read reset_confirm
    echo "$reset_confirm" | grep -qi '^y' || {
      echo "  ${Y}Reset cancelled.${N}"
      exit 0
    }
  fi

  echo "  ${C}Stopping and removing stack...${N}"
  docker compose down -v --remove-orphans 2>/dev/null || true
  docker rm -f kortix-sandbox 2>/dev/null || true
  docker volume rm kortix-sandbox-data 2>/dev/null || true
  [ "$(_mode)" = "local" ] && _free_kortix_ports

  echo "  ${C}Starting fresh stack...${N}"
  docker compose up -d || true
  echo "  ${G}Reset complete.${N}"
}

case "${1:-help}" in
  start)
    # Free ports and clean up lingering containers before starting
    [ "$(_mode)" = "local" ] && _free_kortix_ports
    _sync_supabase_passwords
    docker compose up -d || true
    echo ""
    echo "  ${G}Kortix is running!${N}"
    echo "  Dashboard: ${B}$(_url)${N}"
    echo ""
    ;;
  stop)
    docker compose down
    docker stop kortix-sandbox 2>/dev/null || true
    echo "  ${G}Stopped.${N}"
    ;;
  restart)
    docker compose down 2>/dev/null || true
    # Free ports and clean up lingering containers before restarting
    [ "$(_mode)" = "local" ] && _free_kortix_ports
    _sync_supabase_passwords
    docker compose up -d || true
    echo "  ${G}Restarted.${N}"
    ;;
  logs)
    shift
    docker compose logs -f "$@"
    ;;
  status)
    docker compose ps
    ;;
  setup)
    echo "  ${C}Opening sign-in in browser...${N}"
    _open "$(_url)/auth"
    echo "  ${D}If it didn't open: ${B}$(_url)/auth${N}"
    ;;
  update)
    shift
    if [ "${1:-}" = "--build-local" ]; then
      _rebuild_local_images
    fi
    if _using_local_images; then
      echo "  ${C}Using local Docker images from compose config...${N}"
    else
      echo "  ${C}Pulling configured release images in parallel...${N}"
      docker compose config --images | python3 -c 'import sys; print("\n".join(sorted(set(line.strip() for line in sys.stdin if line.strip()))))' | xargs -r -n1 -P 4 docker pull
    fi
    echo ""
    echo "  ${C}Restarting services...${N}"
    [ "$(_mode)" = "local" ] && _free_kortix_ports
    _sync_supabase_passwords
    docker compose down 2>/dev/null || true
    docker compose up -d || true
    echo "  ${G}Updated.${N}"
    ;;
  reset)
    shift
    _reset_stack "${1:-}"
    ;;
  uninstall)
    echo "  ${C}Stopping services...${N}"
    docker stop kortix-sandbox 2>/dev/null || true
    docker rm -f kortix-sandbox 2>/dev/null || true
    printf "  Delete all data (Docker volumes)? [y/N]: "
    prompt_read del_volumes
    if echo "$del_volumes" | grep -qi '^y'; then
      docker compose down -v --remove-orphans 2>/dev/null || true
      docker volume rm kortix-sandbox-data 2>/dev/null || true
      docker volume rm kortix_supabase-db-data 2>/dev/null || true
      docker volume rm supabase_db_kortix-local 2>/dev/null || true
      echo "  ${G}Volumes removed.${N}"
    else
      docker compose down 2>/dev/null || true
    fi
    [ -L "/usr/local/bin/kortix" ] && rm -f /usr/local/bin/kortix 2>/dev/null || true
    rm -rf "$DIR"
    echo "  ${G}Uninstalled.${N}"
    ;;
  open)
    _open "$(_url)"
    ;;
  version)
    echo "  kortix ${VERSION}"
    ;;
  *)
    echo ""
    echo "  ${B}${C}Kortix CLI${N} ${D}v${VERSION}${N}"
    echo ""
    echo "  ${C}start${N}         Start all services"
    echo "  ${C}stop${N}          Stop all services"
    echo "  ${C}restart${N}       Restart all services"
    echo "  ${C}logs${N}          Tail logs (kortix logs sandbox)"
    echo "  ${C}status${N}        Show service status"
    echo "  ${C}setup${N}         Open sign-in page"
    echo "  ${C}update${N}        Update to the configured release"
    echo "  ${C}reset${N}         Wipe local stack state and recreate it"
    echo "  ${C}uninstall${N}     Remove Kortix completely"
    echo "  ${C}version${N}       Show version"
    echo ""
    ;;
 esac
CLIPATH

  chmod +x "$INSTALL_DIR/kortix"
}

# ─── Add to PATH ─────────────────────────────────────────────────────────────
setup_path() {
  if [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
    ln -sf "$INSTALL_DIR/kortix" /usr/local/bin/kortix 2>/dev/null && {
      success "Linked 'kortix' -> /usr/local/bin/kortix"
      return
    }
  fi

  local shell_rc=""
  case "${SHELL:-}" in
    */zsh)  shell_rc="$HOME/.zshrc" ;;
    */bash) shell_rc="$HOME/.bashrc" ;;
    *)      shell_rc="$HOME/.profile" ;;
  esac

  if [ -f "$shell_rc" ] && grep -q "$INSTALL_DIR" "$shell_rc" 2>/dev/null; then
    return
  fi

  echo "" >> "$shell_rc"
  echo "# Kortix CLI" >> "$shell_rc"
  echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$shell_rc"
  success "Added 'kortix' to PATH (restart terminal or: source $shell_rc)"
}

# ─── Pull & Start ───────────────────────────────────────────────────────────
pull_and_start() {
  echo ""
  cd "$INSTALL_DIR"

  if [ "$KORTIX_LOCAL_IMAGES" = "1" ]; then
    if [ "$KORTIX_BUILD_LOCAL_IMAGES" = "1" ]; then
      rebuild_local_images
      echo ""
    fi
    info "Using local Docker images (skip registry pulls)..."
    verify_local_image "$FRONTEND_IMAGE"
    verify_local_image "$API_IMAGE"
    verify_local_image "$SANDBOX_IMAGE"
    success "Local installer images found"
  else
    info "Pulling Docker images in parallel..."
    echo ""
    local -a images_to_pull=("$FRONTEND_IMAGE" "$API_IMAGE" "$SANDBOX_IMAGE")
    if [ "$DB_MODE" = "docker" ]; then
      images_to_pull+=("$SUPABASE_POSTGRES_IMAGE" "$SUPABASE_GOTRUE_IMAGE" "$SUPABASE_REST_IMAGE" "$SUPABASE_KONG_IMAGE")
    fi
    pull_images_parallel "${images_to_pull[@]}"
    success "Docker images ready"
  fi

  echo ""
  info "Starting Kortix..."
  echo ""

  # Free ports in local mode to avoid conflicts
  free_kortix_ports

  docker compose up -d || true

  # Wait for frontend
  local attempts=0 max_wait=30
  info "Waiting for services..."
  while [ $attempts -lt $max_wait ]; do
    curl -sf "${PUBLIC_URL}" >/dev/null 2>&1 && break
    sleep 2
    attempts=$((attempts + 1))
  done

  echo ""
  echo "  ${BOLD}${GREEN}Kortix is running!${NC}"
  echo ""
  echo "  ${CYAN}Dashboard:${NC}  ${BOLD}${PUBLIC_URL}${NC}"
  echo "  ${CYAN}API:${NC}        ${BOLD}${API_PUBLIC_URL}${NC}"
  echo ""

  if [ "$DEPLOY_MODE" = "local" ]; then
    echo ""
    warm_local_sandbox
    echo ""
    info "Opening sign-in page..."
    open_browser "${PUBLIC_URL}/auth"
  fi

  if [ "$DEPLOY_MODE" = "vps" ]; then
    echo ""
    echo "  ${DIM}Want HTTPS? Point a reverse proxy (Caddy, nginx, Cloudflare) at these ports:${NC}"
    echo "    ${CYAN}Frontend:${NC}  ${BOLD}13737${NC}"
    echo "    ${CYAN}API:${NC}       ${BOLD}13738${NC}"
    echo "    ${CYAN}Supabase:${NC}  ${BOLD}13740${NC}"
  fi

  echo ""
  echo "  ${BOLD}Next:${NC} Open the dashboard and create your owner account."
  echo ""
  echo "  ${DIM}Commands:${NC}"
  echo "    ${CYAN}kortix start${NC}    Start services"
  echo "    ${CYAN}kortix stop${NC}     Stop services"
  echo "    ${CYAN}kortix setup${NC}    Open sign-in page"
  echo "    ${CYAN}kortix update${NC}   Update to the configured release"
  echo "    ${CYAN}kortix logs${NC}     Tail logs"
  echo ""
}

# ─── Main ────────────────────────────────────────────────────────────────────
main() {
  banner
  preflight

  # Clean up any stale Docker volumes from a previous install that was
  # manually removed (rm -rf ~/.kortix) without running `docker compose down -v`.
  # Without this, fresh installs reuse old Postgres data with old passwords,
  # causing supabase-auth to fail with SASL auth errors.
  if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    docker volume rm kortix_supabase-db-data 2>/dev/null || true
    docker rm -f kortix-sandbox 2>/dev/null || true
    docker volume rm kortix-sandbox-data 2>/dev/null || true
  fi

  # Existing install?
  if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    warn "Existing installation found at $INSTALL_DIR"
    printf "  Reinstall? [y/N]: "
    prompt_read answer
    if [ -z "$answer" ] || ! echo "$answer" | grep -qi '^y'; then
      info "Starting existing installation..."
      cd "$INSTALL_DIR"
      docker compose up -d
      echo ""
      success "Kortix is running!"
      local existing_url
      existing_url=$(grep -m1 '^PUBLIC_URL=' "$INSTALL_DIR/.env" 2>/dev/null | cut -d= -f2- || echo "http://localhost:13737")
      echo "  Dashboard: ${BOLD}${existing_url}${NC}"
      echo ""
      exit 0
    fi
    info "Stopping old services..."
    cd "$INSTALL_DIR"
    # Down with -v to remove volumes (especially supabase-db-data).
    # Without this, old Postgres data retains old passwords while the
    # installer generates new ones, causing supabase-auth to fail with
    # "password authentication failed for user supabase_auth_admin".
    docker compose down -v 2>/dev/null || true
    docker rm -f kortix-sandbox 2>/dev/null || true
    # Also remove any leftover named volumes from previous installs
    docker volume rm kortix_supabase-db-data 2>/dev/null || true
    docker volume rm supabase_db_kortix-local 2>/dev/null || true
    docker volume rm kortix-sandbox-data 2>/dev/null || true
    echo ""
  fi

  # ─── Interactive setup ──────────────────────────────────────────────────
  prompt_mode
  prompt_database

  compute_urls

  # Set SUPABASE_PUBLIC_URL for Docker mode
  if [ "$DB_MODE" = "docker" ]; then
    if [ "$DEPLOY_MODE" = "local" ]; then
      SUPABASE_PUBLIC_URL="http://localhost:13740"
    else
      SUPABASE_PUBLIC_URL="http://${SERVER_IP}:13740"
    fi
  fi

  echo "  ${BOLD}What gets installed:${NC}"
  echo ""
  if [ "$DB_MODE" = "docker" ]; then
    echo "    ${CYAN}Frontend${NC}  -> ${CYAN}API${NC}  -> ${CYAN}Sandbox${NC}"
    echo "    ${DIM}Dashboard    Router   AI Agent${NC}"
    echo "                 ${DIM}|${NC}"
    echo "            ${CYAN}Supabase${NC} ${DIM}(DB + Auth + REST)${NC}"
  else
    echo "    ${CYAN}Frontend${NC}  -> ${CYAN}API${NC}  -> ${CYAN}Sandbox${NC}"
    echo "    ${DIM}Dashboard    Router   AI Agent${NC}"
    echo "                 ${DIM}|${NC}"
    echo "          ${CYAN}External DB${NC} ${DIM}(your Supabase)${NC}"
  fi
  echo ""

  prompt_integrations
  generate_secrets
  resolve_release_images

  mkdir -p "$INSTALL_DIR"

  write_kong_config
  write_db_init
  fixup_db_init
  write_compose
  write_env
  write_dev_env_files
  write_cli
  setup_path
  pull_and_start
}

main "$@"
