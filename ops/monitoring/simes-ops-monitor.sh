#!/usr/bin/env bash
# Independent SIMES infrastructure, backup, and telemetry freshness monitor.
#
# Alerts are stored as deduplicated incidents in Core DB and emitted to the
# systemd journal. Telemetry freshness can be placed in maintenance mode while
# gateways are intentionally powered off.
set -euo pipefail
umask 077

CONFIG_FILE="${SIMES_MONITOR_CONFIG:-/etc/simes/monitor.env}"
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

BACKUP_STATUS_FILE="${SIMES_BACKUP_STATUS_FILE:-/var/lib/simes-ops/backup-last-success}"
STATUS_DIR="${SIMES_OPS_STATUS_DIR:-/var/lib/simes-ops}"
BACKUP_MAX_AGE_HOURS="${SIMES_BACKUP_MAX_AGE_HOURS:-36}"
FRESHNESS_ENABLED="${SIMES_FRESHNESS_ENABLED:-false}"
FRESHNESS_WARN_MINUTES="${SIMES_FRESHNESS_WARN_MINUTES:-30}"
FRESHNESS_CRITICAL_MINUTES="${SIMES_FRESHNESS_CRITICAL_MINUTES:-60}"
LOCK_FILE="${SIMES_MONITOR_LOCK_FILE:-/run/lock/simes-ops-monitor.lock}"
DRY_RUN=false
SELF_TEST=false

usage() {
  cat <<'EOF'
Usage: simes-ops-monitor [--dry-run] [--self-test] [--help]

  --dry-run    Execute checks and print decisions without changing incidents.
  --self-test  Create and immediately resolve a test incident.
  --help       Show this help.
EOF
}

for argument in "$@"; do
  case "$argument" in
    --dry-run) DRY_RUN=true ;;
    --self-test) SELF_TEST=true ;;
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

require_positive_integer() {
  local name="$1" value="$2"
  case "$value" in
    ''|*[!0-9]*|0)
      log ERROR "$name must be a positive integer."
      exit 1
      ;;
  esac
}

require_positive_integer SIMES_BACKUP_MAX_AGE_HOURS "$BACKUP_MAX_AGE_HOURS"
require_positive_integer SIMES_FRESHNESS_WARN_MINUTES "$FRESHNESS_WARN_MINUTES"
require_positive_integer SIMES_FRESHNESS_CRITICAL_MINUTES "$FRESHNESS_CRITICAL_MINUTES"
case "$FRESHNESS_ENABLED" in
  true|false) ;;
  *)
    log ERROR "SIMES_FRESHNESS_ENABLED must be true or false."
    exit 1
    ;;
esac
[ "$FRESHNESS_CRITICAL_MINUTES" -gt "$FRESHNESS_WARN_MINUTES" ] ||
  {
    log ERROR "Freshness critical threshold must exceed warning threshold."
    exit 1
  }

install -d -m 0700 "$STATUS_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log WARN "A monitor run is already active; skipping."
  exit 0
fi

core_db_available() {
  timeout -k 1s 5s docker exec simes-core-db sh -lc \
    'exec pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1
}

incident_upsert() {
  local source="$1" title="$2" description="$3" severity="$4" metadata
  metadata=$(python3 - "$description" <<'PY'
import json
import sys
from datetime import datetime, timezone

print(json.dumps({
    "checked_at": datetime.now(timezone.utc).isoformat(),
    "details": sys.argv[1],
    "managed_by": "simes-ops-monitor",
}, ensure_ascii=False))
PY
)

  if [ "$DRY_RUN" = true ]; then
    log "$severity" "DRY-RUN incident $source: $description"
    return 0
  fi

  docker exec -i simes-core-db sh -lc \
    'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh \
    -v ON_ERROR_STOP=1 \
    -v "source=$source" \
    -v "title=$title" \
    -v "description=$description" \
    -v "severity=$severity" \
    -v "metadata=$metadata" >/dev/null <<'SQL'
WITH existing AS MATERIALIZED (
  SELECT id, severity
  FROM incidents
  WHERE source = :'source'
    AND status IN ('open', 'acknowledged')
  ORDER BY created_at DESC
  LIMIT 1
),
updated AS (
  UPDATE incidents AS incident
  SET title = :'title',
      description = :'description',
      severity = :'severity'::incident_severity,
      metadata = :'metadata'::jsonb,
      updated_at = NOW()
  FROM existing
  WHERE incident.id = existing.id
  RETURNING incident.id, (existing.severity::text <> :'severity') AS notify
),
inserted AS (
  INSERT INTO incidents (
    title, description, severity, status, source, metadata
  )
  SELECT
    :'title',
    :'description',
    :'severity'::incident_severity,
    'open',
    :'source',
    :'metadata'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM existing)
  RETURNING id, TRUE AS notify
),
notification AS (
  SELECT notify FROM updated
  UNION ALL
  SELECT notify FROM inserted
)
INSERT INTO audit_logs (level, source, message, metadata)
SELECT
  CASE WHEN :'severity' = 'critical' THEN 'error' ELSE 'warn' END,
  'system',
  :'title' || ': ' || :'description',
  :'metadata'::jsonb
WHERE EXISTS (SELECT 1 FROM notification WHERE notify);
SQL
  log "$severity" "Incident active $source: $description"
}

incident_resolve() {
  local source="$1" resolution="$2" metadata
  metadata=$(python3 - "$resolution" <<'PY'
import json
import sys
from datetime import datetime, timezone

print(json.dumps({
    "resolved_at": datetime.now(timezone.utc).isoformat(),
    "resolution": sys.argv[1],
    "managed_by": "simes-ops-monitor",
}, ensure_ascii=False))
PY
)

  if [ "$DRY_RUN" = true ]; then
    log INFO "DRY-RUN resolve $source: $resolution"
    return 0
  fi

  docker exec -i simes-core-db sh -lc \
    'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh \
    -v ON_ERROR_STOP=1 \
    -v "source=$source" \
    -v "resolution=$resolution" \
    -v "metadata=$metadata" >/dev/null <<'SQL'
WITH resolved AS (
  UPDATE incidents
  SET status = 'resolved',
      resolved_at = NOW(),
      updated_at = NOW(),
      description = description || ' — ' || :'resolution',
      metadata = COALESCE(metadata, '{}'::jsonb) || :'metadata'::jsonb
  WHERE source = :'source'
    AND status IN ('open', 'acknowledged')
  RETURNING id
)
INSERT INTO audit_logs (level, source, message, metadata)
SELECT
  'info',
  'system',
  'Alerte résolue (' || :'source' || '): ' || :'resolution',
  :'metadata'::jsonb
WHERE EXISTS (SELECT 1 FROM resolved);
SQL
}

if [ "$SELF_TEST" = true ]; then
  core_db_available || {
    log ERROR "Core DB is unavailable; self-test cannot write an incident."
    exit 1
  }
  incident_upsert \
    ops_monitor_self_test \
    "Test supervision SIMES" \
    "Incident de test créé par la supervision indépendante." \
    warning
  incident_resolve ops_monitor_self_test "Auto-résolu après validation du canal d’alerte."
  log OK "Incident self-test was created and resolved."
  exit 0
fi

infrastructure_issues=()

if [ "$(pgrep -xc dockerd 2>/dev/null || true)" != "1" ]; then
  infrastructure_issues+=("nombre de daemons Docker différent de 1")
fi

if command -v snap >/dev/null 2>&1 &&
  snap list docker >/dev/null 2>&1; then
  infrastructure_issues+=("le paquet Docker Snap est installé")
fi

snap_docker_unit_state=$(
  systemctl is-enabled snap.docker.dockerd.service 2>/dev/null || true
)
if [ "$snap_docker_unit_state" != "masked" ]; then
  infrastructure_issues+=(
    "la barrière anti-Docker-Snap n'est plus active (${snap_docker_unit_state:-inconnue})"
  )
fi

docker_root=$(timeout -k 1s 5s docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
if [ "$docker_root" != "/var/lib/docker" ]; then
  infrastructure_issues+=("Docker data root inattendu: ${docker_root:-indisponible}")
fi

for container in \
  simes-traefik \
  simes-frontend-web \
  simes-api-core \
  simes-ingestion \
  simes-worker-jobs \
  simes-core-db \
  simes-telemetry-db \
  simes-redis \
  simes-minio \
  simes-ml-service; do
  state=$(timeout -k 1s 5s docker inspect --format '{{.State.Status}}' "$container" 2>/dev/null || true)
  if [ "$state" != "running" ]; then
    infrastructure_issues+=("$container n'est pas running (${state:-absent})")
  fi
done

traefik_ports=$(
  timeout -k 1s 5s docker inspect \
    --format '{{json .HostConfig.PortBindings}}' \
    simes-traefik 2>/dev/null || true
)
if [[ "$traefik_ports" == *'"8080/tcp"'* ]]; then
  infrastructure_issues+=("Traefik publie encore le port dashboard 8080")
fi
if ss -H -lnt '( sport = :8080 )' 2>/dev/null | grep -q .; then
  infrastructure_issues+=("un processus écoute encore sur TCP 8080")
fi

for probe in \
  "UI|http://127.0.0.1/login" \
  "API|http://127.0.0.1/api/health" \
  "Ingestion|http://127.0.0.1/ingest/health"; do
  name=${probe%%|*}
  url=${probe#*|}
  code=$(curl --silent --show-error --max-time 5 \
    --output /dev/null --write-out '%{http_code}' "$url" 2>/dev/null || true)
  if [ "$code" != "200" ]; then
    infrastructure_issues+=("$name répond HTTP ${code:-aucun}")
  fi
done

if [ "${#infrastructure_issues[@]}" -gt 0 ]; then
  infrastructure_description=$(IFS='; '; printf '%s' "${infrastructure_issues[*]}")
  if core_db_available; then
    incident_upsert \
      ops_infrastructure_monitor \
      "Infrastructure SIMES dégradée" \
      "$infrastructure_description" \
      critical
  else
    log CRITICAL "Infrastructure issue and Core DB unavailable: $infrastructure_description"
  fi
else
  if core_db_available; then
    incident_resolve ops_infrastructure_monitor "Tous les services et probes HTTP répondent."
  fi
  log OK "Infrastructure and HTTP probes are healthy."
fi

backup_issue=""
backup_severity="warning"
if [ ! -s "$BACKUP_STATUS_FILE" ]; then
  backup_issue="aucune sauvegarde automatique réussie n'est enregistrée"
else
  backup_age_seconds=$(( $(date +%s) - $(stat -c %Y "$BACKUP_STATUS_FILE") ))
  backup_max_age_seconds=$(( BACKUP_MAX_AGE_HOURS * 3600 ))
  if [ "$backup_age_seconds" -gt "$backup_max_age_seconds" ]; then
    backup_age_hours=$(( backup_age_seconds / 3600 ))
    backup_issue="dernière sauvegarde réussie âgée de ${backup_age_hours}h (seuil ${BACKUP_MAX_AGE_HOURS}h)"
    if [ "$backup_age_seconds" -gt $(( backup_max_age_seconds * 2 )) ]; then
      backup_severity="critical"
    fi
  fi
fi

if [ -n "$backup_issue" ]; then
  if core_db_available; then
    incident_upsert \
      ops_backup_monitor \
      "Sauvegarde SIMES en retard" \
      "$backup_issue" \
      "$backup_severity"
  else
    log "$backup_severity" "$backup_issue"
  fi
else
  if core_db_available; then
    incident_resolve ops_backup_monitor "La sauvegarde automatique est dans le délai attendu."
  fi
  log OK "Automated backup freshness is within threshold."
fi

if [ "$FRESHNESS_ENABLED" = "true" ]; then
  latest_epoch=$(
    timeout -k 1s 10s docker exec simes-telemetry-db sh -lc \
      'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "
        SELECT COALESCE(EXTRACT(EPOCH FROM max(time))::bigint, 0)
        FROM acrel_readings;
      "' 2>/dev/null || true
  )
  if [[ "$latest_epoch" =~ ^[0-9]+$ ]] && [ "$latest_epoch" -gt 0 ]; then
    age_minutes=$(( ($(date +%s) - latest_epoch) / 60 ))
    if [ "$age_minutes" -ge "$FRESHNESS_WARN_MINUTES" ]; then
      freshness_severity="warning"
      if [ "$age_minutes" -ge "$FRESHNESS_CRITICAL_MINUTES" ]; then
        freshness_severity="critical"
      fi
      incident_upsert \
        ops_freshness_monitor \
        "Télémétrie SIMES en retard" \
        "aucune nouvelle mesure depuis ${age_minutes} minutes" \
        "$freshness_severity"
    else
      incident_resolve ops_freshness_monitor "Les mesures arrivent dans le délai attendu."
      log OK "Telemetry freshness is ${age_minutes} minutes."
    fi
  else
    incident_upsert \
      ops_freshness_monitor \
      "Fraîcheur télémétrie invérifiable" \
      "la date de dernière mesure n'a pas pu être lue" \
      critical
  fi
else
  if core_db_available; then
    incident_resolve ops_freshness_monitor "Surveillance de fraîcheur en maintenance planifiée."
  fi
  log INFO "Telemetry freshness alerting is in maintenance mode."
fi

status_tmp="$STATUS_DIR/monitor-last-run.partial"
{
  printf 'completed_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'infrastructure_issues=%s\n' "${#infrastructure_issues[@]}"
  printf 'backup_issue=%s\n' "${backup_issue:-none}"
  printf 'freshness_enabled=%s\n' "$FRESHNESS_ENABLED"
} > "$status_tmp"
chmod 0600 "$status_tmp"
mv -- "$status_tmp" "$STATUS_DIR/monitor-last-run"

log OK "SIMES operations monitor completed."
