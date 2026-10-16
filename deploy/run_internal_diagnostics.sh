#!/usr/bin/env sh
# Explicit operator report, never a readiness/health probe.
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env.production}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
umask 077
compose() { docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# 256 MiB diagnostic cap + 256 MiB retained host headroom. Unknown is not safe.
available_kb="$(awk '/^MemAvailable:/ {print $2; exit}' /proc/meminfo)"
case "$available_kb" in ''|*[!0-9]*) available_kb=0 ;; esac
if [ "$available_kb" -lt 524288 ]; then
  echo "Full diagnostics deferred: at least 512 MiB known available RAM is required. Use verify_runtime_health.sh for readiness." >&2
  exit 75
fi
api_id="$(compose ps -q api)"
test -n "$api_id"
test "$(docker inspect -f '{{.State.Running}}' "$api_id")" = true
# Use only the already running immutable image, never latest/build/pull.
API_IMAGE="$(docker inspect -f '{{.Image}}' "$api_id")"
export API_IMAGE
case "$API_IMAGE" in sha256:*) ;; *) echo "Unverified runtime image identity." >&2; exit 1 ;; esac
name="chat-reader-diagnostics-$(date -u +%s)-$$"
test -z "$(docker ps -aq --filter "name=^/$name$")"
cleanup() {
  # The unique one-off belongs to this invocation. Never touch a serving service.
  oneoff="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.oneoff"}}' "$name" 2>/dev/null || true)"
  image="$(docker inspect -f '{{.Image}}' "$name" 2>/dev/null || true)"
  case "$oneoff" in
    True|true) if [ "$image" = "$API_IMAGE" ]; then docker rm -f "$name" >/dev/null 2>&1 || true; fi ;;
  esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# One host-wide lock also covers different release copies of this command.
command -v flock >/dev/null
lock="${DIAGNOSTICS_LOCK_FILE:-/run/lock/chat-reader-internal-diagnostics.lock}"
test ! -L "$lock"
exec 9>"$lock"
flock -n 9 || { echo "Another full diagnostics command is already running." >&2; exit 75; }
# Recheck admission after owning the lock, not only before waiting for Docker.
available_kb="$(awk '/^MemAvailable:/ {print $2; exit}' /proc/meminfo)"
case "$available_kb" in ''|*[!0-9]*) available_kb=0 ;; esac
test "$available_kb" -ge 524288 || { echo "Full diagnostics deferred: memory headroom changed." >&2; exit 75; }
timeout -k 5s 35s docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" \
  -f "$SCRIPT_DIR/diagnostics.resources.yml" run --rm --no-deps -T --name "$name" \
  -e CHAT_READER_DIAGNOSTICS_ISOLATED=1 api python -m scripts.internal_diagnostics
