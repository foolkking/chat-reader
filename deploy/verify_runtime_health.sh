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

diagnostics="$(compose exec -T api python -m scripts.internal_diagnostics)"
printf '%s' "$diagnostics" | compose exec -T api python -c '
import json
import sys

payload = json.load(sys.stdin)
state = payload["system"]["worker_state"]
if state not in {"alive_idle", "alive_busy"}:
    raise SystemExit(f"Worker heartbeat is {state}")
print(f"import-worker heartbeat={state}")
'

echo "Runtime services and worker heartbeat are healthy"
