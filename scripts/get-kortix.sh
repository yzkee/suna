#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  Kortix — One-Click Installer                                             ║
# ║                                                                            ║
# ║  Install Kortix with a single command:                                     ║
# ║    curl -fsSL https://get.kortix.ai/install | bash                         ║
# ║                                                                            ║
# ║  Or run locally (for development / private repos):                         ║
# ║    bash /path/to/scripts/get-kortix.sh                                     ║
# ║                                                                            ║
# ║  What this does:                                                           ║
# ║    1. Checks for Docker + Git                                              ║
# ║    2. Gets the Kortix source to ~/kortix                                   ║
# ║    3. Runs the interactive setup (API keys, sandbox creds)                 ║
# ║    4. Starts all services via Docker Compose                               ║
# ║                                                                            ║
# ║  After install, manage with:                                               ║
# ║    kortix start | stop | logs | status | setup | update                    ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()    { printf "${BLUE}  [INFO]${NC} %s\n" "$*"; }
success() { printf "${GREEN}  [OK]${NC}   %s\n" "$*"; }
warn()    { printf "${YELLOW}  [WARN]${NC} %s\n" "$*"; }
error()   { printf "${RED}  [ERR]${NC}  %s\n" "$*" >&2; }
fatal()   { error "$*"; exit 1; }

# ─── Banner ──────────────────────────────────────────────────────────────────

echo ""
printf "${BOLD}${CYAN}"
cat << 'BANNER'
   _  __         _   _
  | |/ /___  _ _| |_(_)_ __
  | ' </ _ \| '_|  _| \ \ /
  |_|\_\___/|_|  \__|_/_\_\

BANNER
printf "${NC}"
echo "  ${DIM}One-Click Installer${NC}"
echo ""

# ─── Config ──────────────────────────────────────────────────────────────────

REPO_URL="${KORTIX_REPO:-https://github.com/kortix-ai/computer.git}"
INSTALL_DIR="${KORTIX_HOME:-$HOME/kortix}"
BRANCH="${KORTIX_BRANCH:-main}"

# Detect if this script is being run from inside an existing checkout
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" != "bash" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || true
fi

# If we're inside a checkout, use it as the source (no git clone needed)
LOCAL_SOURCE=""
if [ -n "$SCRIPT_DIR" ]; then
  PARENT_DIR="$(dirname "$SCRIPT_DIR")"
  if [ -f "$PARENT_DIR/docker-compose.local.yml" ] && [ -f "$PARENT_DIR/scripts/install.sh" ]; then
    LOCAL_SOURCE="$PARENT_DIR"
  fi
fi

# ─── Preflight ───────────────────────────────────────────────────────────────

info "Checking prerequisites..."
echo ""

# Docker
if ! command -v docker &>/dev/null; then
  fatal "Docker is required but not installed. Get it at: https://docs.docker.com/get-docker/"
fi
success "Docker installed"

# Docker running
if ! docker info &>/dev/null 2>&1; then
  fatal "Docker is not running. Start Docker Desktop and try again."
fi
success "Docker is running"

# Docker Compose v2
if ! docker compose version &>/dev/null 2>&1; then
  fatal "Docker Compose v2 is required. It's included with Docker Desktop."
fi
success "Docker Compose available"

# Git
if ! command -v git &>/dev/null; then
  fatal "Git is required but not installed. Get it at: https://git-scm.com/downloads"
fi
success "Git installed"

echo ""

# ─── Get the source ─────────────────────────────────────────────────────────

if [ -n "$LOCAL_SOURCE" ]; then
  # Running from inside an existing checkout — copy to install dir
  if [ "$LOCAL_SOURCE" = "$INSTALL_DIR" ]; then
    info "Already at $INSTALL_DIR"
  elif [ -d "$INSTALL_DIR/scripts/install.sh" ]; then
    info "Existing installation found at $INSTALL_DIR"
  else
    info "Copying from local checkout: $LOCAL_SOURCE"
    mkdir -p "$INSTALL_DIR"
    rsync -a --quiet \
      --exclude 'node_modules' \
      --exclude '.git' \
      --exclude '.nx' \
      --exclude '.next' \
      --exclude 'dist' \
      --exclude '.turbo' \
      "$LOCAL_SOURCE/" "$INSTALL_DIR/"
    success "Copied to $INSTALL_DIR"
  fi
else
  # Remote install — clone from GitHub
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Existing installation found at $INSTALL_DIR"
    info "Pulling latest changes..."
    (cd "$INSTALL_DIR" && git pull --ff-only 2>/dev/null) || warn "Could not pull latest — using current version"
    success "Repository up to date"
  else
    if [ -d "$INSTALL_DIR" ] && [ "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
      fatal "$INSTALL_DIR already exists and is not a git repo. Remove it or set KORTIX_HOME to a different path."
    fi

    info "Cloning Kortix to $INSTALL_DIR..."
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" 2>&1 | tail -1
    success "Repository cloned"
  fi
fi

echo ""

# ─── Hand off to the real installer ─────────────────────────────────────────

cd "$INSTALL_DIR"

if [ ! -f "scripts/install.sh" ]; then
  fatal "scripts/install.sh not found. The repository may be incomplete."
fi

chmod +x scripts/install.sh
exec bash scripts/install.sh --skip-preflight --skip-clone
