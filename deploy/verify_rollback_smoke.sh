#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-}"
migration_container="${2:-}"
expected_revision="${3:-}"

if [ -z "$base_url" ] || [ -z "$migration_container" ] || [ -z "$expected_revision" ]; then
  echo "usage: $0 <base-url> <migration-container> <expected-revision>" >&2
  exit 2
fi

health_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$base_url/api/health")"
if [ "$health_status" != "200" ]; then
  echo "health check failed with HTTP $health_status" >&2
  exit 1
fi

private_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$base_url/api/preferences")"
if [ "$private_status" != "401" ]; then
  echo "anonymous private boundary failed with HTTP $private_status (expected 401)" >&2
  exit 1
fi

migration_output="$(docker exec "$migration_container" python -m alembic current 2>&1)" || {
  echo "migration current check failed" >&2
  exit 1
}
case "$migration_output" in
  *"$expected_revision"*"(head)"*|*"$expected_revision"*"head"*) ;;
  *)
    echo "migration revision does not match expected head" >&2
    exit 1
    ;;
esac

printf 'rollback_smoke=PASS\nhealth_status=%s\nprivate_status=%s\nmigration_revision=%s\n' \
  "$health_status" "$private_status" "$expected_revision"
