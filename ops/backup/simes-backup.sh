#!/usr/bin/env bash
# Daily, verified SIMES production backup.
#
# Creates:
#   - a root-only local archive under /var/backups/simes/daily;
#   - an encrypted CMS copy under the read-only offsite export directory.
#
# No production container, volume, network, or database is stopped or recreated.
set -euo pipefail
umask 077

CONFIG_FILE="${SIMES_BACKUP_CONFIG:-/etc/simes/backup.env}"
if [ -f "$CONFIG_FILE" ]; then
  # This file is installed root-owned and contains only operator-controlled
  # backup settings. Docker's .env is deliberately never sourced.
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

REPO_DIR="${SIMES_REPO_DIR:-/home/simes/simes-bf}"
COMPOSE_DIR="$REPO_DIR/infra/docker"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
ENV_FILE="$COMPOSE_DIR/.env"
BACKUP_ROOT="${SIMES_BACKUP_ROOT:-/var/backups/simes/daily}"
LOCAL_RETENTION_DAYS="${SIMES_LOCAL_RETENTION_DAYS:-14}"
OFFSITE_EXPORT_DIR="${SIMES_OFFSITE_EXPORT_DIR:-/srv/simes-backup-export/archives}"
OFFSITE_RETENTION_DAYS="${SIMES_OFFSITE_RETENTION_DAYS:-30}"
RECIPIENT_CERT="${SIMES_BACKUP_RECIPIENT_CERT:-/etc/simes/backup-recipient.crt}"
DEPENDENCY_SNAPSHOT="${SIMES_PG_DIRTYREAD_SNAPSHOT:-/var/backups/simes/pre-remediation-20260729T142520Z/dependencies/pg_dirtyread-pg16}"
STATUS_DIR="${SIMES_OPS_STATUS_DIR:-/var/lib/simes-ops}"
HELPER_IMAGE="${SIMES_BACKUP_HELPER_IMAGE:-redis:7-alpine}"
KEEP_DIRECTORY="${SIMES_BACKUP_KEEP_DIRECTORY:-false}"
LOCK_FILE="${SIMES_BACKUP_LOCK_FILE:-/run/lock/simes-backup.lock}"
CHECK_ONLY=false

usage() {
  cat <<'EOF'
Usage: simes-backup [--check] [--help]

  --check  Validate configuration and production prerequisites without writing.
  --help   Show this help.
EOF
}

for argument in "$@"; do
  case "$argument" in
    --check) CHECK_ONLY=true ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $argument" >&2
      exit 2
      ;;
  esac
done

log() {
  printf '%s [%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" "$2"
}

fail() {
  log ERROR "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

require_absolute_safe_path() {
  local variable_name="$1" raw_path="$2" resolved_path
  case "$raw_path" in
    /*) ;;
    *) fail "$variable_name must be an absolute path: $raw_path" ;;
  esac
  resolved_path=$(realpath -m -- "$raw_path")
  case "$resolved_path" in
    /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/media|/mnt|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var|/var/backups)
      fail "$variable_name is too broad: $resolved_path"
      ;;
  esac
  printf '%s\n' "$resolved_path"
}

require_positive_integer() {
  local name="$1" value="$2"
  case "$value" in
    ''|*[!0-9]*) fail "$name must be a positive integer." ;;
    0) fail "$name must be greater than zero." ;;
  esac
}

require_command docker
require_command flock
require_command git
require_command openssl
require_command python3
require_command realpath
require_command sha256sum
require_command tar

REPO_DIR=$(realpath -m -- "$REPO_DIR")
BACKUP_ROOT=$(require_absolute_safe_path SIMES_BACKUP_ROOT "$BACKUP_ROOT")
OFFSITE_EXPORT_DIR=$(require_absolute_safe_path SIMES_OFFSITE_EXPORT_DIR "$OFFSITE_EXPORT_DIR")
STATUS_DIR=$(require_absolute_safe_path SIMES_OPS_STATUS_DIR "$STATUS_DIR")
require_positive_integer SIMES_LOCAL_RETENTION_DAYS "$LOCAL_RETENTION_DAYS"
require_positive_integer SIMES_OFFSITE_RETENTION_DAYS "$OFFSITE_RETENTION_DAYS"

repo_git() {
  GIT_OPTIONAL_LOCKS=0 \
    git -c safe.directory="$REPO_DIR" -C "$REPO_DIR" "$@"
}

case "$BACKUP_ROOT" in
  "$REPO_DIR"|"$REPO_DIR"/*) fail "Backup root must be outside the repository." ;;
esac
case "$OFFSITE_EXPORT_DIR" in
  "$REPO_DIR"|"$REPO_DIR"/*) fail "Offsite export directory must be outside the repository." ;;
esac

[ -f "$COMPOSE_FILE" ] || fail "Compose file is missing: $COMPOSE_FILE"
[ -f "$ENV_FILE" ] || fail "Docker environment file is missing: $ENV_FILE"
[ -r "$RECIPIENT_CERT" ] || fail "Backup recipient certificate is missing: $RECIPIENT_CERT"
[ -d "$DEPENDENCY_SNAPSHOT" ] || fail "pg_dirtyread dependency snapshot is missing: $DEPENDENCY_SNAPSHOT"
[ -z "$(repo_git status --porcelain)" ] ||
  fail "Production repository is dirty; the backup would not contain an exact source tree."

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  fail "Another SIMES backup is already running."
fi

if [ -n "${DOCKER_HOST:-}" ] && [ "$DOCKER_HOST" != "unix:///var/run/docker.sock" ]; then
  fail "Unexpected DOCKER_HOST: $DOCKER_HOST"
fi
[ "$(docker context show)" = "default" ] || fail "Docker context must be default."
[ "$(docker info --format '{{.DockerRootDir}}')" = "/var/lib/docker" ] ||
  fail "Docker data root is not /var/lib/docker."
[ "$(pgrep -xc dockerd 2>/dev/null || true)" = "1" ] ||
  fail "Exactly one dockerd process is required."
if command -v snap >/dev/null 2>&1 && snap list docker >/dev/null 2>&1; then
  fail "Docker Snap is installed."
fi

compose config --quiet
docker image inspect "$HELPER_IMAGE" >/dev/null 2>&1 ||
  fail "Local helper image is unavailable: $HELPER_IMAGE"

container_matches_compose() {
  local service="$1" container="$2" compose_id container_id
  compose_id=$(compose ps -q "$service")
  container_id=$(docker inspect --format '{{.Id}}' "$container")
  [ -n "$compose_id" ] && [ "$compose_id" = "$container_id" ] ||
    fail "$container is not managed by the expected Compose project."
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = "true" ] ||
    fail "$container is not running."
}

container_matches_compose core-db simes-core-db
container_matches_compose telemetry-db simes-telemetry-db
container_matches_compose redis simes-redis
container_matches_compose minio simes-minio

openssl x509 -in "$RECIPIENT_CERT" -noout -checkend 2592000 >/dev/null ||
  fail "Backup recipient certificate is invalid or expires in less than 30 days."

if [ "$CHECK_ONLY" = true ]; then
  log OK "Backup configuration, Docker daemon, containers, helper image, and encryption certificate are valid."
  exit 0
fi

install -d -m 0700 "$BACKUP_ROOT" "$STATUS_DIR"
install -d -m 0750 "$OFFSITE_EXPORT_DIR"

available_kb=$(df -Pk "$BACKUP_ROOT" | awk 'NR == 2 { print $4 }')
[ "${available_kb:-0}" -ge 5242880 ] ||
  fail "Less than 5 GiB is available under $BACKUP_ROOT."

stamp=$(date -u '+%Y%m%dT%H%M%SZ')
backup_name="daily-$stamp"
work_dir="$BACKUP_ROOT/$backup_name.partial"
backup_dir="$BACKUP_ROOT/$backup_name"
archive_path="$BACKUP_ROOT/$backup_name.tar.gz"
archive_partial="$archive_path.partial"
archive_checksum="$archive_path.sha256"
export_path="$OFFSITE_EXPORT_DIR/$backup_name.tar.gz.cms"
export_partial="$export_path.partial"
export_checksum="$export_path.sha256"
redis_remote="/tmp/simes-backup-$stamp.rdb"
helper_containers=()

safe_remove_tree() {
  local target="$1" resolved_target
  [ -e "$target" ] || return 0
  resolved_target=$(realpath -m -- "$target")
  case "$resolved_target" in
    "$BACKUP_ROOT"/daily-*.partial|"$BACKUP_ROOT"/daily-[0-9]*T[0-9]*Z)
      find "$resolved_target" -depth -mindepth 1 -delete
      rmdir -- "$resolved_target"
      ;;
    *)
      log ERROR "Refusing to remove unexpected path: $resolved_target"
      return 1
      ;;
  esac
}

cleanup() {
  local status=$? container
  docker exec -u 0 simes-redis rm -f "$redis_remote" >/dev/null 2>&1 || true
  for container in "${helper_containers[@]:-}"; do
    case "$container" in
      simes-backup-helper-"$stamp"-*) docker rm -f "$container" >/dev/null 2>&1 || true ;;
    esac
  done
  if [ "$status" -ne 0 ]; then
    safe_remove_tree "$work_dir" >/dev/null 2>&1 || true
    rm -f -- "$archive_partial" "$export_partial"
    log ERROR "Backup failed; partial artifacts were cleaned."
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

[ ! -e "$work_dir" ] && [ ! -e "$backup_dir" ] &&
  [ ! -e "$archive_path" ] && [ ! -e "$export_path" ] ||
  fail "Backup path collision for $backup_name."
install -d -m 0700 \
  "$work_dir/data" \
  "$work_dir/config" \
  "$work_dir/dependencies" \
  "$work_dir/inventory"

validate_dump() {
  local container="$1" dump_path="$2" remote_path
  remote_path="/tmp/simes-validate-$stamp-$(basename "$dump_path")"
  docker cp "$dump_path" "$container:$remote_path" >/dev/null
  docker exec -u 0 "$container" chmod 0444 "$remote_path"
  docker exec "$container" pg_restore --list "$remote_path" >/dev/null
  docker exec -u 0 "$container" rm -f "$remote_path"
}

backup_database() {
  local container="$1" output_path="$2"
  log INFO "Creating logical dump from $container."
  docker exec "$container" sh -lc \
    'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$output_path"
  [ -s "$output_path" ] || fail "Database dump is empty: $output_path"
  validate_dump "$container" "$output_path"
}

backup_database simes-core-db "$work_dir/data/core.dump"
backup_database simes-telemetry-db "$work_dir/data/telemetry.dump"
docker exec simes-core-db sh -lc \
  'exec pg_dumpall --globals-only -U "$POSTGRES_USER"' > "$work_dir/data/core-globals.sql"
docker exec simes-telemetry-db sh -lc \
  'exec pg_dumpall --globals-only -U "$POSTGRES_USER"' > "$work_dir/data/telemetry-globals.sql"
[ -s "$work_dir/data/core-globals.sql" ] || fail "Core globals dump is empty."
[ -s "$work_dir/data/telemetry-globals.sql" ] || fail "Telemetry globals dump is empty."

read_dotenv_value() {
  local key="$1"
  python3 - "$ENV_FILE" "$key" <<'PY'
import ast
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
for raw_line in path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    current, value = line.split("=", 1)
    if current.strip() != key:
        continue
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        try:
            value = ast.literal_eval(value)
        except (SyntaxError, ValueError):
            value = value[1:-1]
    print(value, end="")
    raise SystemExit(0)
raise SystemExit(1)
PY
}

redis_password=$(read_dotenv_value REDIS_PASSWORD) ||
  fail "REDIS_PASSWORD could not be read from Docker .env."
[ -n "$redis_password" ] || fail "REDIS_PASSWORD is empty."
log INFO "Creating authenticated Redis RDB snapshot."
printf '%s\n' "$redis_password" |
  docker exec -i simes-redis sh -c '
    IFS= read -r password
    export REDISCLI_AUTH="$password"
    exec redis-cli --rdb "$1"
  ' sh "$redis_remote" >/dev/null
unset redis_password
docker cp "simes-redis:$redis_remote" "$work_dir/data/redis-dump.rdb" >/dev/null
docker exec -u 0 simes-redis rm -f "$redis_remote"
[ "$(head -c 5 "$work_dir/data/redis-dump.rdb")" = "REDIS" ] ||
  fail "Redis RDB snapshot has an invalid header."

archive_volume() {
  local volume="$1" output_name="$2" helper_name
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    log WARN "Skipping absent optional volume: $volume"
    return 0
  fi
  helper_name="simes-backup-helper-$stamp-${volume//[^a-zA-Z0-9_.-]/-}"
  helper_containers+=("$helper_name")
  log INFO "Archiving volume $volume."
  docker run --rm --pull never \
    --name "$helper_name" \
    --network none \
    --read-only \
    --user 0:0 \
    --cap-drop ALL \
    --cap-add DAC_READ_SEARCH \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    -v "$volume:/source:ro" \
    -v "$work_dir/data:/backup" \
    "$HELPER_IMAGE" \
    tar -C /source -czf "/backup/$output_name" .
  tar -tzf "$work_dir/data/$output_name" >/dev/null
}

archive_volume docker_redis_data redis-volume-crash-consistent.tar.gz
archive_volume docker_minio_data minio-data-crash-consistent.tar.gz
archive_volume docker_ml_models_data ml-models-crash-consistent.tar.gz
archive_volume docker_pgadmin_data pgadmin-data-crash-consistent.tar.gz
archive_volume portainer_data portainer-data-crash-consistent.tar.gz

cp "$COMPOSE_FILE" "$work_dir/config/docker-compose.yml"
cp "$ENV_FILE" "$work_dir/config/docker.env"
cp "$REPO_DIR/deploy.sh" "$work_dir/config/deploy.sh"
repo_git archive --format=tar.gz \
  --output="$work_dir/config/repository-head.tar.gz" HEAD
repo_git rev-parse HEAD > "$work_dir/inventory/git-commit.txt"
repo_git status --short --branch > "$work_dir/inventory/git-status.txt"
docker ps --no-trunc --format \
  '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}' > "$work_dir/inventory/containers.txt"
docker volume ls --format '{{.Name}}|{{.Driver}}' > "$work_dir/inventory/volumes.txt"
cp -a "$DEPENDENCY_SNAPSHOT" "$work_dir/dependencies/pg_dirtyread-pg16"

cat > "$work_dir/MANIFEST.txt" <<EOF
SIMES-BF automated daily backup
Created UTC: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
Source host: $(hostname -f)
Source repository: $REPO_DIR
Source commit: $(repo_git rev-parse HEAD)

Consistency:
- Core and Telemetry: validated PostgreSQL custom-format logical dumps.
- Redis: authenticated point-in-time RDB plus crash-consistent volume archive.
- MinIO, ML models, pgAdmin, and Portainer: crash-consistent read-only volume archives.
- docker.env contains secrets; local archive is root-only and offsite export is encrypted.
- pg_dirtyread PostgreSQL 16 runtime and exact source snapshot are included for restore.

Production containers, volumes, networks, and databases were not stopped or recreated.
EOF

chmod -R go-rwx "$work_dir"
(
  cd "$work_dir"
  find . -type f ! -name SHA256SUMS -print0 |
    sort -z |
    xargs -0 sha256sum > SHA256SUMS
  sha256sum -c SHA256SUMS >/dev/null
)
mv -- "$work_dir" "$backup_dir"

log INFO "Creating verified local archive."
tar -C "$BACKUP_ROOT" -czf "$archive_partial" "$backup_name"
tar -tzf "$archive_partial" >/dev/null
mv -- "$archive_partial" "$archive_path"
(
  cd "$BACKUP_ROOT"
  sha256sum "$(basename "$archive_path")" > "$(basename "$archive_checksum")"
  sha256sum -c "$(basename "$archive_checksum")" >/dev/null
)
chmod 0600 "$archive_path" "$archive_checksum"

log INFO "Creating encrypted offsite export."
openssl cms -encrypt \
  -binary \
  -aes-256-cbc \
  -outform DER \
  -in "$archive_path" \
  -out "$export_partial" \
  "$RECIPIENT_CERT"
openssl cms -cmsout -inform DER -in "$export_partial" -out /dev/null
mv -- "$export_partial" "$export_path"
(
  cd "$OFFSITE_EXPORT_DIR"
  sha256sum "$(basename "$export_path")" > "$(basename "$export_checksum")"
  sha256sum -c "$(basename "$export_checksum")" >/dev/null
)
chmod 0640 "$export_path" "$export_checksum"
if getent group simes-backup >/dev/null 2>&1; then
  chgrp simes-backup "$OFFSITE_EXPORT_DIR" "$export_path" "$export_checksum"
  chmod 0750 "$OFFSITE_EXPORT_DIR"
fi

if [ "$KEEP_DIRECTORY" != "true" ]; then
  safe_remove_tree "$backup_dir"
fi

find "$BACKUP_ROOT" -maxdepth 1 -type f \
  \( -name 'daily-*.tar.gz' -o -name 'daily-*.tar.gz.sha256' \) \
  -mtime "+$LOCAL_RETENTION_DAYS" -delete
find "$OFFSITE_EXPORT_DIR" -maxdepth 1 -type f \
  \( -name 'daily-*.tar.gz.cms' -o -name 'daily-*.tar.gz.cms.sha256' \) \
  -mtime "+$OFFSITE_RETENTION_DAYS" -delete

status_tmp="$STATUS_DIR/backup-last-success.partial"
{
  printf 'completed_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'archive=%s\n' "$archive_path"
  printf 'export=%s\n' "$export_path"
  printf 'archive_sha256=%s\n' "$(sha256sum "$archive_path" | awk '{ print $1 }')"
  printf 'export_sha256=%s\n' "$(sha256sum "$export_path" | awk '{ print $1 }')"
} > "$status_tmp"
chmod 0600 "$status_tmp"
mv -- "$status_tmp" "$STATUS_DIR/backup-last-success"

log OK "Backup complete: $archive_path"
log OK "Encrypted offsite export ready: $export_path"

trap - EXIT INT TERM
exit 0
