#!/usr/bin/env sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env.production}"

compose() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

for service in postgres api web; do
  container_id="$(compose ps -q "$service")"
  test -n "$container_id"
  status="$(docker inspect -f '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}{{ .State.Status }}{{ end }}' "$container_id")"
  if [ "$status" != "healthy" ]; then
    echo "Runtime health verification failed: $service is $status." >&2
    exit 1
  fi
  printf '%s health=%s\n' "$service" "$status"
done

worker_id="$(compose ps -q import-worker)"
test -n "$worker_id"
worker_status="$(docker inspect -f '{{ .State.Status }}' "$worker_id")"
if [ "$worker_status" != "running" ]; then
  echo "Runtime health verification failed: import-worker is $worker_status." >&2
  exit 1
fi

# Read only the singleton heartbeat. A health check must not launch a second
# API interpreter or scan storage/business tables in the serving API cgroup.
stale_after="$(compose exec -T import-worker sh -c 'printf "%s" "${WORKER_HEARTBEAT_STALE_AFTER_SECONDS:-120}"')"
case "$stale_after" in
  ''|*[!0-9]*) echo "Worker heartbeat threshold is invalid." >&2; exit 1 ;;
esac
test "${#stale_after}" -le 5 || { echo "Worker heartbeat threshold is too large." >&2; exit 1; }
if [ "$stale_after" -lt 1 ] || [ "$stale_after" -gt 86400 ]; then
  echo "Worker heartbeat threshold is outside the supported range." >&2
  exit 1
fi
heartbeat="$(compose exec -T -e PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000" postgres \
  sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"' sh \
  "SELECT CASE
     WHEN heartbeat_at IS NULL OR heartbeat_at > CURRENT_TIMESTAMP
       OR heartbeat_at <= CURRENT_TIMESTAMP - make_interval(secs => $stale_after)
       THEN 'stale'
     WHEN state = 'busy' THEN 'alive_busy'
     WHEN state = 'idle' THEN 'alive_idle'
     ELSE 'unavailable' END
   FROM worker_runtime_states WHERE worker_key = 'primary'")"
case "$heartbeat" in
  alive_idle|alive_busy) printf 'import-worker heartbeat=%s\n' "$heartbeat" ;;
  *) echo "Runtime health verification failed: worker heartbeat is unavailable or stale." >&2; exit 1 ;;
esac

echo "Runtime services and worker heartbeat are healthy"
