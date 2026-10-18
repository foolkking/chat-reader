#!/usr/bin/env bash
# Disposable GitHub-hosted CI fixture only; never a production database helper.
set -euo pipefail

action="${1:-}"
run_id="${GITHUB_RUN_ID:-}"
attempt="${GITHUB_RUN_ATTEMPT:-1}"
job="${GITHUB_JOB:-}"
port="${CI_POSTGRES_PORT:-5432}"
if [[ ! "$run_id" =~ ^[0-9]+$ || ! "$attempt" =~ ^[0-9]+$ || ! "$job" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "A valid GitHub run, attempt and job identity is required." >&2
  exit 1
fi
if [[ "$port" != 5432 && "$port" != 65438 ]]; then
  echo "Only the existing disposable CI PostgreSQL ports are allowed." >&2
  exit 1
fi
name="chat-reader-ci-postgres-${run_id}-${attempt}-${job}"
owner="${run_id}:${attempt}:${job}"
label="chat-reader.ci-postgres"

if [[ "$action" == stop ]]; then
  if ! record="$(docker container inspect --format "{{.Id}} {{index .Config.Labels \"$label\"}}" "$name" 2>/dev/null)"; then
    exit 0
  fi
  read -r container_id actual_owner <<< "$record"
  if [[ ! "$container_id" =~ ^[0-9a-f]{64}$ || "$actual_owner" != "$owner" ]]; then
    echo "Refusing to remove a container not owned by this CI job." >&2
    exit 1
  fi
  docker logs "$container_id" || true
  docker rm --force "$container_id"
  exit 0
fi
if [[ "$action" != start ]]; then
  echo "Usage: postgres-service.sh start|stop" >&2
  exit 1
fi
if docker container inspect "$name" >/dev/null 2>&1; then
  echo "This CI job already has a PostgreSQL container; refusing to replace it." >&2
  exit 1
fi

# Both official distribution services were verified to publish this exact index.
# A registry failure never permits a floating tag, different digest or fake DB.
digest="sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
sources=(
  "public.ecr.aws/docker/library/postgres:16-alpine@$digest"
  "docker.io/library/postgres:16-alpine@$digest"
)
image=""
for source in "${sources[@]}"; do
  for retry in 1 2 3; do
    if timeout --kill-after=10s 60s docker pull --platform linux/amd64 "$source"; then
      image="$source"
      break
    fi
    echo "Official PostgreSQL pull failed (attempt $retry/3): $source" >&2
    if [[ "$retry" != 3 ]]; then sleep "$((retry * 2))"; fi
  done
  if [[ -n "$image" ]]; then break; fi
done
if [[ -z "$image" ]]; then
  echo "Both pinned official PostgreSQL sources failed; no quality gate can run." >&2
  exit 1
fi

container_id="$(docker run --detach --rm --pull=never --platform linux/amd64 \
  --name "$name" --label "$label=$owner" \
  --publish "127.0.0.1:${port}:5432" \
  --env POSTGRES_DB=chat_reader --env POSTGRES_USER=chat_reader \
  --env POSTGRES_PASSWORD=chat_reader_ci \
  --health-cmd "pg_isready -U chat_reader -d chat_reader" \
  --health-interval 5s --health-timeout 5s --health-retries 20 \
  "$image")"
if [[ ! "$container_id" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Docker did not return a valid disposable container identity." >&2
  exit 1
fi
cleanup_unready() {
  docker logs "$container_id" >&2 || true
  docker rm --force "$container_id" >/dev/null || true
}
trap cleanup_unready EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for check in $(seq 1 120); do
  state="$(docker container inspect --format '{{.State.Health.Status}}' "$container_id")"
  if [[ "$state" == healthy ]]; then
    trap - EXIT INT TERM
    echo "Disposable PostgreSQL is healthy: $image"
    exit 0
  fi
  if [[ "$state" != starting ]]; then
    echo "Disposable PostgreSQL failed its health check: $state" >&2
    exit 1
  fi
  sleep 1
done
echo "Timed out waiting for disposable PostgreSQL readiness." >&2
exit 1
