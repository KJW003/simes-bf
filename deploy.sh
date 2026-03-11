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
#   ./deploy.sh --repair-agg # after deploy, re-aggregate all historical data
#   ./deploy.sh --check-pipeline  # print pipeline/queue health after deploy
#
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
REPAIR_AGG=false
CHECK_PIPELINE=false
for arg in "$@"; do
  case "$arg" in
    --no-build)       NO_BUILD=true ;;
    --db-only)        DB_ONLY=true ;;
    --repair-agg)     REPAIR_AGG=true ;;
    --check-pipeline) CHECK_PIPELINE=true ;;
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

  # Stop previous containers and remove orphans
  docker compose -f docker-compose.yml down --remove-orphans 2>/dev/null || true

  # Remove old project-prefixed networks that conflict with named networks
  docker network rm docker_edge docker_internal 2>/dev/null || true

  # Prune corrupted BuildKit layer cache (prevents "parent snapshot does not exist" errors)
  if [ "$NO_BUILD" = false ]; then
    docker builder prune --all -f 2>/dev/null || true
  fi

  docker compose -f docker-compose.yml up -d --force-recreate $BUILD_FLAG
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

# ── Run migrations via the migration runner ──────────────────
# Wait for api-core container to be running (needed for docker exec)
info "Waiting for api-core container..."
RETRIES=15
until docker inspect --format='{{.State.Status}}' simes-api-core 2>/dev/null | grep -q 'running'; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then error "api-core container not running — cannot run migrations."; fi
  sleep 2
done

# Copy migration files into the api-core container (which has pg installed)
info "Copying migration runner into api-core container..."
docker cp "$SCHEMA_DIR/migrate.js" simes-api-core:/app/migrate.js
docker cp "$SCHEMA_DIR/migrations" simes-api-core:/app/migrations

info "Running core-db migrations..."
docker exec -w /app simes-api-core node migrate.js --db core 2>&1 || warn "Core migrations had warnings"
ok "Core migrations done."

info "Running telemetry-db migrations..."
docker exec -w /app simes-api-core node migrate.js --db telemetry 2>&1 || warn "Telemetry migrations had warnings"
ok "Telemetry migrations done."

# Cleanup
docker exec simes-api-core rm -rf /app/migrate.js /app/migrations 2>/dev/null || true

# ── Wait for api-core to be healthy ──────────────────────────
info "Waiting for api-core to be healthy..."
RETRIES=30
until docker inspect --format='{{.State.Health.Status}}' simes-api-core 2>/dev/null | grep -q 'healthy'; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    warn "api-core did not become healthy in time."
    warn "Last logs from api-core:"
    docker logs --tail 30 simes-api-core 2>&1 || true
    break
  fi
  sleep 3
done
if [ $RETRIES -gt 0 ]; then ok "api-core is healthy."; fi

# ── Quick status check for remaining services ────────────────
for svc in simes-ingestion simes-worker-jobs simes-ml-service simes-frontend-web; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$svc" 2>/dev/null || echo "not found")
  if [ "$STATUS" = "running" ]; then
    ok "$svc is running."
  else
    warn "$svc status: $STATUS"
    warn "Last logs from $svc:"
    docker logs --tail 15 "$svc" 2>&1 || true
  fi
done

# ── Verify API is responding ─────────────────────────────────
info "Verifying API health..."
RETRIES=10
API_OK=false
until curl -sf http://localhost/api/health >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then break; fi
  sleep 2
done
if [ $RETRIES -gt 0 ]; then
  ok "API is responding."; API_OK=true
else
  warn "API health check failed (may still be starting)."
fi

# ── Post-deploy: repair aggregations (--repair-agg) ─────────
if [ "$REPAIR_AGG" = true ]; then
  info "Triggering aggregation repair via API..."
  REPAIR_FROM=$(date -d '60 days ago' '+%Y-%m-%dT00:00:00Z' 2>/dev/null || date -v-60d '+%Y-%m-%dT00:00:00Z' 2>/dev/null || echo "2025-01-01T00:00:00Z")
  REPAIR_TO=$(date '+%Y-%m-%dT23:59:59Z')
  REPAIR_RESP=$(curl -sf -X POST http://localhost/api/admin/pipeline/repair-aggregations \
    -H "Content-Type: application/json" \
    -d "{\"from\":\"$REPAIR_FROM\",\"to\":\"$REPAIR_TO\"}" 2>&1) || true
  if [ -n "$REPAIR_RESP" ]; then
    ok "Aggregation repair response: $REPAIR_RESP"
  else
    warn "Could not trigger aggregation repair (API may not be ready)"
  fi
fi

# ── Post-deploy: retry failed jobs in all queues ─────────────
if [ "$API_OK" = true ]; then
  info "Checking for failed jobs in queues..."
  for QUEUE in telemetry ai reports; do
    RETRY_RESP=$(curl -sf -X POST http://localhost/api/admin/pipeline/retry-failed-jobs \
      -H "Content-Type: application/json" \
      -d "{\"queue\":\"$QUEUE\",\"limit\":500}" 2>&1) || true
    RETRIED=$(echo "$RETRY_RESP" | grep -o '"retried":[0-9]*' | grep -o '[0-9]*' || echo "0")
    if [ "$RETRIED" != "0" ] && [ -n "$RETRIED" ]; then
      ok "Retried $RETRIED failed jobs in $QUEUE queue"
    fi
  done
fi

# ── Post-deploy: pipeline health check (--check-pipeline) ───
if [ "$CHECK_PIPELINE" = true ] || [ "$API_OK" = true ]; then
  info "Pipeline health check..."
  HEALTH_RESP=$(curl -sf http://localhost/api/health/pipeline 2>&1) || true
  if [ -n "$HEALTH_RESP" ]; then
    echo "$HEALTH_RESP" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_RESP"
  else
    warn "Could not fetch pipeline health."
  fi
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
ok "═══════════════════════════════════════════════════"
ok "  SIMES deployed successfully!"
ok "═══════════════════════════════════════════════════"
echo ""
info "Services:"
info "  UI         → http://localhost/"
info "  API        → http://localhost/api"
info "  API Docs   → http://localhost/api/api-docs"
info "  Ingestion  → http://localhost/ingest"
info "  pgAdmin    → http://localhost:5050"
info "  Portainer  → https://localhost:9443"
info "  Traefik    → http://SERVER_IP:8080/dashboard/ (admin panel)"
echo ""
info "Default credentials:"
info "  App        → admin@simes.bf / admin1234"
info "  pgAdmin    → ${PGADMIN_EMAIL} / ${PGADMIN_PASSWORD}"
echo ""
info "Database connection info (configure in pgAdmin):"
info "  Core DB:"
info "    Hostname: core-db"
info "    Port: 5432"
info "    DB: ${CORE_DB_NAME}"
info "    User: ${CORE_DB_USER}"
info "    Password: ${CORE_DB_PASSWORD}"
echo ""
info "  Telemetry DB (TimescaleDB):"
info "    Hostname: telemetry-db"
info "    Port: 5432"
info "    DB: ${TELEMETRY_DB_NAME}"
info "    User: ${TELEMETRY_DB_USER}"
info "    Password: ${TELEMETRY_DB_PASSWORD}"
echo ""
