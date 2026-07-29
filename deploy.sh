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
#   ./deploy.sh --retry-failed-jobs # retry failed jobs (requires admin token)
#   ./deploy.sh --pull-images # explicitly refresh referenced images
#   ./deploy.sh --check-pipeline # print pipeline/queue health after deploy
#
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR/infra/docker"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
ENV_FILE="$COMPOSE_DIR/.env"
SCHEMA_DIR="$SCRIPT_DIR/infra/db"
BACKUP_ROOT="${SIMES_BACKUP_DIR:-/var/backups/simes}"

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
RETRY_FAILED_JOBS=false
CHECK_PIPELINE=false
PULL_POLICY=never
for arg in "$@"; do
  case "$arg" in
    --no-build)          NO_BUILD=true ;;
    --db-only)           DB_ONLY=true ;;
    --repair-agg)        REPAIR_AGG=true ;;
    --retry-failed-jobs) RETRY_FAILED_JOBS=true ;;
    --pull-images)       PULL_POLICY=always ;;
    --check-pipeline)    CHECK_PIPELINE=true ;;
    --help|-h)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *) error "Unknown option: $arg" ;;
  esac
done

# ── .env check ───────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  error ".env not found at $ENV_FILE. Refusing to create production credentials from an example file."
fi

# Do not source this file: Docker Compose dotenv syntax is not shell syntax,
# and production secrets must never be evaluated as commands by this script.

case "$BACKUP_ROOT" in
  /*) ;;
  *) error "SIMES_BACKUP_DIR must be an absolute path." ;;
esac
BACKUP_ROOT=$(realpath -m -- "$BACKUP_ROOT")
case "$BACKUP_ROOT" in
  /|/etc|/home|/mnt|/opt|/root|/srv|/tmp|/usr|/var|/var/backups)
    error "Backup directory is too broad: $BACKUP_ROOT"
    ;;
  "$SCRIPT_DIR"|"$SCRIPT_DIR"/*)
    error "Backup directory must be outside the Git repository."
    ;;
esac

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# ── Production safety checks ────────────────────────────────
if [ -n "${DOCKER_HOST:-}" ] &&
  [ "$DOCKER_HOST" != "unix:///var/run/docker.sock" ]; then
  error "Unexpected DOCKER_HOST: $DOCKER_HOST. Expected the system Docker socket."
fi

DOCKER_CONTEXT=$(docker context show 2>/dev/null || true)
DOCKER_ENDPOINT=$(docker context inspect "$DOCKER_CONTEXT" \
  --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)
if [ "$DOCKER_ENDPOINT" != "unix:///var/run/docker.sock" ]; then
  error "Unexpected Docker endpoint: ${DOCKER_ENDPOINT:-unknown}. Expected unix:///var/run/docker.sock."
fi

DOCKER_ROOT=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
if [ -z "$DOCKER_ROOT" ]; then
  error "Docker daemon is unavailable."
fi
if [ "$DOCKER_ROOT" != "/var/lib/docker" ]; then
  error "Unexpected Docker data root: $DOCKER_ROOT (expected /var/lib/docker). Refusing deployment."
fi

DOCKERD_COUNT=$(pgrep -xc dockerd 2>/dev/null || true)
if [ "${DOCKERD_COUNT:-0}" -ne 1 ]; then
  error "Expected exactly one Docker daemon; found ${DOCKERD_COUNT:-0}."
fi

if command -v snap >/dev/null 2>&1 &&
  snap list docker >/dev/null 2>&1; then
  error "Docker Snap is installed. Remove it before deploying SIMES."
fi

if command -v systemctl >/dev/null 2>&1 &&
  systemctl is-active --quiet snap.docker.dockerd.service 2>/dev/null; then
  error "Docker Snap daemon is active. Refusing deployment against an ambiguous daemon."
fi

if [ -n "$(git -C "$SCRIPT_DIR" status --porcelain)" ]; then
  error "Repository has uncommitted changes. Commit or discard them before deployment."
fi

if { [ "$REPAIR_AGG" = true ] || [ "$RETRY_FAILED_JOBS" = true ]; } &&
  [ -z "${SIMES_ADMIN_TOKEN:-}" ]; then
  error "Admin operation requested but SIMES_ADMIN_TOKEN is not set."
fi

compose config --quiet
ok "Single Docker daemon, clean repository, and Compose configuration verified."

# ── Pre-deployment database backup ──────────────────────────
# Existing databases are dumped before any application container is changed.
# On a first installation the containers do not exist yet, so this is skipped.
BACKUP_STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
BACKUP_DIR="$BACKUP_ROOT/pre-deploy-$BACKUP_STAMP"
BACKUP_WORK_DIR="$BACKUP_DIR.partial"
BACKUP_CREATED=false

container_exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

container_is_running() {
  docker inspect --format='{{.State.Running}}' "$1" 2>/dev/null | grep -q true
}

compose_container_matches() {
  local service="$1" container="$2" actual_id compose_id
  actual_id=$(docker inspect --format='{{.Id}}' "$container")
  compose_id=$(compose ps -q "$service" 2>/dev/null || true)
  if [ -z "$compose_id" ] || [ "$actual_id" != "$compose_id" ]; then
    error "$container is not the container managed by this Compose project."
  fi
}

compose_volume_exists() {
  docker volume ls -q \
    --filter "label=com.docker.compose.volume=$1" |
    grep -q .
}

validate_dump() {
  local container="$1" local_file="$2" remote_file
  remote_file="/tmp/simes-validate-$BACKUP_STAMP-$(basename "$local_file")"
  docker cp "$local_file" "$container:$remote_file" >/dev/null
  docker exec -u 0 "$container" chmod 0444 "$remote_file"
  if ! docker exec "$container" pg_restore --list "$remote_file" >/dev/null; then
    docker exec -u 0 "$container" rm -f "$remote_file" >/dev/null 2>&1 || true
    error "pg_restore could not read $local_file."
  fi
  docker exec -u 0 "$container" rm -f "$remote_file" >/dev/null
}

backup_database() {
  local container="$1" output="$2"
  info "Backing up $container..."
  docker exec "$container" sh -lc \
    'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    > "$BACKUP_WORK_DIR/$output"
  test -s "$BACKUP_WORK_DIR/$output" ||
    error "Backup is empty: $BACKUP_WORK_DIR/$output"
  validate_dump "$container" "$BACKUP_WORK_DIR/$output"
}

CORE_EXISTS=false
TELEMETRY_EXISTS=false
container_exists simes-core-db && CORE_EXISTS=true
container_exists simes-telemetry-db && TELEMETRY_EXISTS=true

if [ "$CORE_EXISTS" != "$TELEMETRY_EXISTS" ]; then
  error "Only one production database container exists. Refusing to treat this as a first installation."
fi

if [ "$CORE_EXISTS" = true ]; then
  compose_container_matches core-db simes-core-db
  compose_container_matches telemetry-db simes-telemetry-db
  container_is_running simes-core-db || error "simes-core-db exists but is not running."
  container_is_running simes-telemetry-db || error "simes-telemetry-db exists but is not running."

  install -d -m 700 "$BACKUP_ROOT"
  if [ -e "$BACKUP_DIR" ] || [ -e "$BACKUP_WORK_DIR" ]; then
    error "Backup path collision for timestamp $BACKUP_STAMP."
  fi

  AVAILABLE_KB=$(df -Pk "$BACKUP_ROOT" | awk 'NR == 2 {print $4}')
  if [ "${AVAILABLE_KB:-0}" -lt 2097152 ]; then
    error "Less than 2 GiB is available under $BACKUP_ROOT."
  fi
  install -d -m 700 "$BACKUP_WORK_DIR"

  backup_database simes-core-db core.dump
  backup_database simes-telemetry-db telemetry.dump
  docker exec simes-core-db sh -lc \
    'exec pg_dumpall --globals-only -U "$POSTGRES_USER"' \
    > "$BACKUP_WORK_DIR/core-globals.sql"
  docker exec simes-telemetry-db sh -lc \
    'exec pg_dumpall --globals-only -U "$POSTGRES_USER"' \
    > "$BACKUP_WORK_DIR/telemetry-globals.sql"
  test -s "$BACKUP_WORK_DIR/core-globals.sql" ||
    error "Core globals backup is empty."
  test -s "$BACKUP_WORK_DIR/telemetry-globals.sql" ||
    error "Telemetry globals backup is empty."

  cp "$COMPOSE_FILE" "$BACKUP_WORK_DIR/docker-compose.yml"
  cp "$ENV_FILE" "$BACKUP_WORK_DIR/docker.env"
  git -C "$SCRIPT_DIR" archive --format=tar.gz \
    --output="$BACKUP_WORK_DIR/repository-head.tar.gz" HEAD
  git -C "$SCRIPT_DIR" rev-parse HEAD > "$BACKUP_WORK_DIR/git-commit.txt"
  docker ps --no-trunc --format \
    '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}' \
    > "$BACKUP_WORK_DIR/containers-before.txt"

  chmod 600 "$BACKUP_WORK_DIR"/*
  (
    cd "$BACKUP_WORK_DIR"
    find . -type f ! -name SHA256SUMS -print0 |
      sort -z |
      xargs -0 sha256sum > SHA256SUMS
    chmod 600 SHA256SUMS
    sha256sum -c SHA256SUMS >/dev/null
  )
  mv -- "$BACKUP_WORK_DIR" "$BACKUP_DIR"
  BACKUP_CREATED=true
  ok "Restorable database backups and rollback metadata verified in $BACKUP_DIR"
else
  if [ "$DB_ONLY" = true ]; then
    error "--db-only requires existing database containers."
  fi
  if compose_volume_exists core_db_data ||
    compose_volume_exists telemetry_db_data; then
    error "Database volumes exist without their containers. Refusing to treat this as a first installation."
  fi
  warn "No database containers exist; treating this as a first installation."
fi

# ── Docker compose up ────────────────────────────────────────
if [ "$DB_ONLY" = false ]; then
  info "Starting SIMES stack..."

  COMPOSE_UP_ARGS=(up -d --pull "$PULL_POLICY")
  if [ "$NO_BUILD" = false ]; then
    COMPOSE_UP_ARGS+=(--build)
  fi

  # Reconcile in place. Do not stop the whole stack or remove shared networks:
  # Traefik must stay attached to simes-edge throughout a routine deployment.
  # On an existing installation, persistent data and admin services are never
  # reconciled by this routine script. Handle them through a dedicated,
  # full-backup maintenance procedure.
  if [ "$CORE_EXISTS" = true ]; then
    COMPOSE_UP_ARGS+=(
      --no-deps
      frontend-web
      api-core
      ingestion-service
      worker-jobs
      ml-service
      traefik
    )
  fi
  compose "${COMPOSE_UP_ARGS[@]}"
  ok "Containers started."
fi

# ── Wait for databases to be healthy ─────────────────────────
info "Waiting for core-db to be ready..."
RETRIES=30
until docker exec simes-core-db sh -lc \
  'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then error "core-db did not become ready in time."; fi
  sleep 2
done
ok "core-db is ready."

info "Waiting for telemetry-db to be ready..."
RETRIES=30
until docker exec simes-telemetry-db sh -lc \
  'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then error "telemetry-db did not become ready in time."; fi
  sleep 2
done
ok "telemetry-db is ready."

# ── Run schema-core.sql ──────────────────────────────────────
info "Applying core-db schema..."
docker exec -i simes-core-db sh -lc \
  'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' \
  < "$SCHEMA_DIR/schema-core.sql"
ok "core-db schema applied."

# ── Run schema-telemetry.sql ─────────────────────────────────
info "Applying telemetry-db schema..."
docker exec -i simes-telemetry-db sh -lc \
  'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' \
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

MIGRATION_RUNNER_DIR="/app/.simes-migrate-$BACKUP_STAMP"
cleanup_migration_runner() {
  docker exec simes-api-core rm -rf "$MIGRATION_RUNNER_DIR" \
    >/dev/null 2>&1 || true
}
trap cleanup_migration_runner EXIT

info "Copying migration runner into api-core container..."
docker exec simes-api-core mkdir -p "$MIGRATION_RUNNER_DIR"
docker cp "$SCHEMA_DIR/migrate.js" \
  "simes-api-core:$MIGRATION_RUNNER_DIR/migrate.js"
docker cp "$SCHEMA_DIR/migrations" \
  "simes-api-core:$MIGRATION_RUNNER_DIR/migrations"

info "Running core-db migrations..."
docker exec -w "$MIGRATION_RUNNER_DIR" \
  simes-api-core node migrate.js --db core
ok "Core migrations done."

info "Running telemetry-db migrations..."
docker exec -w "$MIGRATION_RUNNER_DIR" \
  simes-api-core node migrate.js --db telemetry
ok "Telemetry migrations done."

# Cleanup migration files even if a migration failed.
cleanup_migration_runner
trap - EXIT

# ── Mandatory post-deployment verification ───────────────────
wait_for_running() {
  local container="$1" retries=30 status
  while [ "$retries" -gt 0 ]; do
    status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || true)
    if [ "$status" = "running" ]; then
      ok "$container is running."
      return 0
    fi
    retries=$((retries - 1))
    sleep 2
  done
  docker logs --tail 30 "$container" 2>&1 || true
  error "$container did not reach the running state."
}

wait_for_healthy() {
  local container="$1" retries=30 health
  while [ "$retries" -gt 0 ]; do
    health=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || true)
    if [ "$health" = "healthy" ]; then
      ok "$container is healthy."
      return 0
    fi
    retries=$((retries - 1))
    sleep 2
  done
  docker logs --tail 30 "$container" 2>&1 || true
  error "$container did not become healthy."
}

wait_for_http_200() {
  local name="$1" url="$2" retries=30 code
  while [ "$retries" -gt 0 ]; do
    code=$(curl --silent --show-error --max-time 3 \
      --output /dev/null --write-out '%{http_code}' "$url" 2>/dev/null || true)
    if [ "$code" = "200" ]; then
      ok "$name responded with HTTP 200."
      return 0
    fi
    retries=$((retries - 1))
    sleep 2
  done
  error "$name failed its HTTP probe (last status: ${code:-none})."
}

for svc in \
  simes-frontend-web \
  simes-ingestion \
  simes-worker-jobs \
  simes-pgadmin \
  simes-traefik; do
  wait_for_running "$svc"
done

for svc in \
  simes-core-db \
  simes-telemetry-db \
  simes-redis \
  simes-minio \
  simes-ml-service \
  simes-api-core; do
  wait_for_healthy "$svc"
done

TRAEFIK_NETWORK_ID=$(docker inspect \
  --format='{{with index .NetworkSettings.Networks "simes-edge"}}{{.NetworkID}}{{end}}' \
  simes-traefik)
EXPECTED_EDGE_NETWORK_ID=$(docker network inspect --format='{{.Id}}' simes-edge)
if [ "$TRAEFIK_NETWORK_ID" != "$EXPECTED_EDGE_NETWORK_ID" ]; then
  error "Traefik is not attached to the declared simes-edge network."
fi

TRAEFIK_HASH_OUTPUT=$(compose config --hash traefik)
TRAEFIK_DESIRED_HASH=$(echo "$TRAEFIK_HASH_OUTPUT" |
  awk 'NF == 1 { print $1; exit } $1 == "traefik" { print $2; exit }')
TRAEFIK_RUNTIME_HASH=$(docker inspect \
  --format='{{index .Config.Labels "com.docker.compose.config-hash"}}' \
  simes-traefik)
if [ -z "$TRAEFIK_DESIRED_HASH" ] || [ -z "$TRAEFIK_RUNTIME_HASH" ]; then
  error "Could not determine Traefik Compose hashes."
fi
if [ "$TRAEFIK_RUNTIME_HASH" != "$TRAEFIK_DESIRED_HASH" ]; then
  error "Traefik runtime configuration does not match docker-compose.yml."
fi
ok "Traefik network and Compose hash verified."

wait_for_http_200 "UI login" "http://localhost/login"
wait_for_http_200 "API health" "http://localhost/api/health"
wait_for_http_200 "Ingestion health" "http://localhost/ingest/health"
wait_for_http_200 "pgAdmin" "http://localhost:5050/misc/ping"

docker exec simes-api-core node -e \
  "fetch('http://minio:9000/minio/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" ||
  error "MinIO is not reachable from the application network."
ok "MinIO is reachable from api-core."

# ── Post-deploy: repair aggregations (--repair-agg) ─────────
if [ "$REPAIR_AGG" = true ]; then
  info "Triggering aggregation repair via API..."
  REPAIR_FROM=$(date -d '60 days ago' '+%Y-%m-%dT00:00:00Z' 2>/dev/null || date -v-60d '+%Y-%m-%dT00:00:00Z' 2>/dev/null || echo "2025-01-01T00:00:00Z")
  REPAIR_TO=$(date '+%Y-%m-%dT23:59:59Z')
  REPAIR_RESP=$(curl --silent --show-error --fail-with-body \
    -X POST http://localhost/api/admin/pipeline/repair-aggregations \
    -H "Authorization: Bearer $SIMES_ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"from\":\"$REPAIR_FROM\",\"to\":\"$REPAIR_TO\"}")
  ok "Aggregation repair accepted: $REPAIR_RESP"
fi

# ── Post-deploy: retry failed jobs when explicitly requested ─
if [ "$RETRY_FAILED_JOBS" = true ]; then
  info "Retrying failed jobs in queues..."
  for QUEUE in telemetry ai reports; do
    RETRY_RESP=$(curl --silent --show-error --fail-with-body \
      -X POST http://localhost/api/admin/pipeline/retry-failed-jobs \
      -H "Authorization: Bearer $SIMES_ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"queue\":\"$QUEUE\",\"limit\":500}")
    RETRIED=$(echo "$RETRY_RESP" | grep -o '"retried":[0-9]*' | grep -o '[0-9]*' || echo "0")
    if [ "$RETRIED" != "0" ] && [ -n "$RETRIED" ]; then
      ok "Retried $RETRIED failed jobs in $QUEUE queue"
    fi
  done
fi

# ── Post-deploy: pipeline health check (--check-pipeline) ───
if [ "$CHECK_PIPELINE" = true ]; then
  info "Pipeline health check..."
  HEALTH_RESP=$(curl --silent --show-error --fail-with-body \
    http://localhost/api/health/pipeline)
  echo "$HEALTH_RESP" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_RESP"
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
info "  Traefik    → routing, network, and Compose hash verified"
echo ""
if [ "$BACKUP_CREATED" = true ]; then
  info "Pre-deploy backup → $BACKUP_DIR"
fi
info "Credentials and database passwords are intentionally not printed."
