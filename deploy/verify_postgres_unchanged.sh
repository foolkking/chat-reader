#!/usr/bin/env bash
set -euo pipefail

container="${1:-}"
expected_started_at="${2:-}"
expected_container_id="${3:-}"

if [ -z "$container" ] || [ -z "$expected_started_at" ]; then
  echo "usage: $0 <postgres-container> <expected-started-at> [expected-container-id]" >&2
  exit 2
fi

actual_id="$(docker inspect -f '{{.Id}}' "$container" 2>/dev/null)" || {
  echo "postgres container could not be inspected" >&2
  exit 2
}
actual_started_at="$(docker inspect -f '{{.State.StartedAt}}' "$container" 2>/dev/null)" || {
  echo "postgres start time could not be inspected" >&2
  exit 2
}

if [ "$actual_started_at" != "$expected_started_at" ]; then
  echo "postgres container was restarted: expected StartedAt $expected_started_at, got $actual_started_at" >&2
  exit 1
fi
if [ -n "$expected_container_id" ] && [ "$actual_id" != "$expected_container_id" ]; then
  echo "postgres container identity changed" >&2
  exit 1
fi

printf 'postgres_unchanged=1\nstarted_at=%s\n' "$actual_started_at"
