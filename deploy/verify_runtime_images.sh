#!/usr/bin/env sh
set -eu

EXPECTED_REVISION="${1:?expected release revision is required}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env.production}"

compose() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

for service in api import-worker web; do
  container_id="$(compose ps -q "$service")"
  if [ -z "$container_id" ]; then
    echo "Runtime verification failed: $service has no running container." >&2
    exit 1
  fi
  revision="$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$container_id")"
  if [ "$revision" != "$EXPECTED_REVISION" ]; then
    echo "Runtime verification failed: $service revision is $revision, expected $EXPECTED_REVISION." >&2
    exit 1
  fi
  image_id="$(docker inspect -f '{{ .Image }}' "$container_id")"
  printf '%s revision=%s image=%s\n' "$service" "$revision" "$image_id"
done

echo "Runtime image revisions match $EXPECTED_REVISION"
