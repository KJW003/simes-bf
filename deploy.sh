#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# SIMES – deploy.sh
# One-command deployment: builds, starts, and initialises DBs.
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh              # full deploy (build + up + init DB)
#   ./deploy.sh --no-build   # skip Docker build (use cached images)
#   ./deploy.sh --db-only    # only run DB init (containers must be up)
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR/infra/docker"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
ENV_FILE="$COMPOSE_DIR/.env"
SCHEMA_DIR="$SCRIPT_DIR/infra/db"

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Parse flags ──────────────────────────────────────────────
NO_BUILD=false
DB_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=true ;;
    --db-only)  DB_ONLY=true ;;
  esac
done

# ── .env check ───────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$COMPOSE_DIR/.env.example" ]; then
    warn ".env not found – copying from .env.example"
    cp "$COMPOSE_DIR/.env.example" "$ENV_FILE"
    warn "REVIEW $ENV_FILE before pressing Enter."
    read -rp "Press Enter to continue..."
  else
    error ".env not found at $ENV_FILE. Copy .env.example and fill in your values."
  fi
fi

# Source .env so we can use the vars for psql
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# ── Docker compose up ────────────────────────────────────────
if [ "$DB_ONLY" = false ]; then
  info "Starting SIMES stack..."

  BUILD_FLAG=""
  if [ "$NO_BUILD" = false ]; then
    BUILD_FLAG="--build"
  fi

  cd "$COMPOSE_DIR"
  docker compose -f docker-compose.yml up -d $BUILD_FLAG
  ok "Containers started."
fi

# ── Wait for databases to be healthy ─────────────────────────
info "Waiting for core-db to be ready..."
RETRIES=30
until docker exec simes-core-db pg_isready -U "${CORE_DB_USER}" -d "${CORE_DB_NAME}" >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then error "core-db did not become ready in time."; fi
  sleep 2
done
ok "core-db is ready."

info "Waiting for telemetry-db to be ready..."
RETRIES=30
until docker exec simes-telemetry-db pg_isready -U "${TELEMETRY_DB_USER}" -d "${TELEMETRY_DB_NAME}" >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then error "telemetry-db did not become ready in time."; fi
  sleep 2
done
ok "telemetry-db is ready."

# ── Run schema-core.sql ──────────────────────────────────────
info "Applying core-db schema..."
docker exec -i simes-core-db psql \
  -U "${CORE_DB_USER}" \
  -d "${CORE_DB_NAME}" \
  -v ON_ERROR_STOP=1 \
  < "$SCHEMA_DIR/schema-core.sql"
ok "core-db schema applied."

# ── Run schema-telemetry.sql ─────────────────────────────────
info "Applying telemetry-db schema..."
docker exec -i simes-telemetry-db psql \
  -U "${TELEMETRY_DB_USER}" \
  -d "${TELEMETRY_DB_NAME}" \
  -v ON_ERROR_STOP=1 \
  < "$SCHEMA_DIR/schema-telemetry.sql"
ok "telemetry-db schema applied."

# ── Summary ──────────────────────────────────────────────────
echo ""
ok "═══════════════════════════════════════════════════"
ok "  SIMES deployed successfully!"
ok "═══════════════════════════════════════════════════"
echo ""
info "Services:"
info "  UI         → http://localhost/"
info "  API        → http://localhost/api"
info "  Ingestion  → http://localhost/ingest"
info "  Traefik    → http://localhost:8080 (if dashboard enabled)"
echo ""
info "Default admin: admin@simes.bf / admin1234"
echo ""
