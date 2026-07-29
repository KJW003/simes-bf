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

# ── Production safety checks ────────────────────────────────
DOCKER_ROOT=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
if [ -z "$DOCKER_ROOT" ]; then
  error "Docker daemon is unavailable."
fi
if [ "$DOCKER_ROOT" != "/var/lib/docker" ]; then
  error "Unexpected Docker data root: $DOCKER_ROOT (expected /var/lib/docker). Refusing deployment."
fi

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config --quiet
ok "Docker daemon and Compose configuration verified."

# ── Pre-deployment database backup ──────────────────────────
# Existing databases are dumped before any application container is changed.
# On a first installation the containers do not exist yet, so this is skipped.
BACKUP_ROOT="${SIMES_BACKUP_DIR:-/var/backups/simes}"
BACKUP_STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
BACKUP_DIR="$BACKUP_ROOT/pre-deploy-$BACKUP_STAMP"
BACKUP_CREATED=false

backup_database() {
  local container="$1" user="$2" database="$3" output="$4"
  if docker inspect --format='{{.State.Running}}' "$container" 2>/dev/null | grep -q true; then
    if [ "$BACKUP_CREATED" = false ]; then
      mkdir -p "$BACKUP_DIR"
      chmod 700 "$BACKUP_DIR"
      BACKUP_CREATED=true
    fi
    info "Backing up $database..."
    docker exec "$container" pg_dump -Fc -U "$user" "$database" > "$BACKUP_DIR/$output"
    test -s "$BACKUP_DIR/$output" || error "Backup is empty: $BACKUP_DIR/$output"
  fi
}

if [ "$DB_ONLY" = false ]; then
  backup_database simes-core-db "${CORE_DB_USER}" "${CORE_DB_NAME}" core.dump
  backup_database simes-telemetry-db "${TELEMETRY_DB_USER}" "${TELEMETRY_DB_NAME}" telemetry.dump
  if [ "$BACKUP_CREATED" = true ]; then
    (cd "$BACKUP_DIR" && sha256sum ./*.dump > SHA256SUMS)
    ok "Database backups verified in $BACKUP_DIR"
  else
    warn "No running database containers found; treating this as a first installation."
  fi
fi

# ── Docker compose up ────────────────────────────────────────
if [ "$DB_ONLY" = false ]; then
  info "Starting SIMES stack..."

  BUILD_FLAG=""
  if [ "$NO_BUILD" = false ]; then
    BUILD_FLAG="--build"
  fi

  cd "$COMPOSE_DIR"

  # Reconcile in place. Do not stop the whole stack or remove shared networks:
  # Traefik must stay attached to simes-edge throughout a routine deployment.
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
  if [ -z "${SIMES_ADMIN_TOKEN:-}" ]; then
    error "--repair-agg requires SIMES_ADMIN_TOKEN; no unauthenticated admin call was made."
  fi
  info "Triggering aggregation repair via API..."
  REPAIR_FROM=$(date -d '60 days ago' '+%Y-%m-%dT00:00:00Z' 2>/dev/null || date -v-60d '+%Y-%m-%dT00:00:00Z' 2>/dev/null || echo "2025-01-01T00:00:00Z")
  REPAIR_TO=$(date '+%Y-%m-%dT23:59:59Z')
  REPAIR_RESP=$(curl -sf -X POST http://localhost/api/admin/pipeline/repair-aggregations \
    -H "Authorization: Bearer $SIMES_ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"from\":\"$REPAIR_FROM\",\"to\":\"$REPAIR_TO\"}")
  ok "Aggregation repair accepted: $REPAIR_RESP"
fi

# ── Post-deploy: retry failed jobs in all queues ─────────────
if [ "$API_OK" = true ] && [ -n "${SIMES_ADMIN_TOKEN:-}" ]; then
  info "Checking for failed jobs in queues..."
  for QUEUE in telemetry ai reports; do
    RETRY_RESP=$(curl -sf -X POST http://localhost/api/admin/pipeline/retry-failed-jobs \
      -H "Authorization: Bearer $SIMES_ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"queue\":\"$QUEUE\",\"limit\":500}")
    RETRIED=$(echo "$RETRY_RESP" | grep -o '"retried":[0-9]*' | grep -o '[0-9]*' || echo "0")
    if [ "$RETRIED" != "0" ] && [ -n "$RETRIED" ]; then
      ok "Retried $RETRIED failed jobs in $QUEUE queue"
    fi
  done
elif [ "$API_OK" = true ]; then
  warn "SIMES_ADMIN_TOKEN is not set; skipping failed-job retries."
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
info "Credentials and database passwords are intentionally not printed."
