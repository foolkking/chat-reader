#!/usr/bin/env sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env.production}"
SOURCE_SHA="${SOURCE_SHA:-$(git rev-parse HEAD 2>/dev/null || printf 'unknown')}"
BACKUP_HEADROOM_KB="${BACKUP_HEADROOM_KB:-262144}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
PYTHON="${PYTHON:-python3}"
BACKUP_DEDUPLICATE="${BACKUP_DEDUPLICATE:-1}"

compose() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(CDPATH= cd -- "$BACKUP_DIR" && pwd -P)"
operation_lock="$BACKUP_DIR/.backup-operation.lock"
mkdir "$operation_lock" || { echo 'Another backup operation or unfinished operation lock exists.' >&2; exit 1; }
work_dir=""
cleanup() {
  case "$work_dir" in "$BACKUP_DIR"/.chat-reader-backup.*) rm -rf -- "$work_dir" ;; esac
  rmdir "$operation_lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

database_bytes="$(compose exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select pg_database_size(current_database())"')"
required_kb="$((database_bytes / 1024 + BACKUP_HEADROOM_KB))"
for component in imports exports offline assets; do
  component_kb="$(compose run --rm --no-deps -T api \
    sh -c "du -sk '/data/$component' | cut -f1")"
  required_kb="$((required_kb + component_kb))"
done
available_kb="$(df -Pk "$BACKUP_DIR" | awk 'NR == 2 {print $4}')"
if [ "$available_kb" -lt "$required_kb" ]; then
  echo "Backup refused: target has ${available_kb} KiB available; ${required_kb} KiB required." >&2
  exit 1
fi

work_dir="$(mktemp -d "$BACKUP_DIR/.chat-reader-backup.XXXXXX")"
final_dir="$BACKUP_DIR/chat-reader-$STAMP"
dump_path="$work_dir/postgres.dump"
postgres_tool_version="$(compose exec -T postgres pg_dump --version | tr -d '\r')"
compose exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$dump_path"

# Validate the custom dump using the same PostgreSQL image that produced it.
compose exec -T postgres pg_restore --list < "$dump_path" > "$work_dir/postgres.toc"
test -s "$work_dir/postgres.toc"

for component in imports exports offline assets; do
  compose run --rm --no-deps -T api \
    tar -C "/data/$component" -czf - . > "$work_dir/$component.tar.gz"
  tar -tzf "$work_dir/$component.tar.gz" >/dev/null
done

(cd "$work_dir" && sha256sum postgres.dump imports.tar.gz exports.tar.gz offline.tar.gz assets.tar.gz) \
  > "$work_dir/SHA256SUMS"

{
  printf 'schema_version=1\n'
  printf 'created_at=%s\n' "$STAMP"
  printf 'source_sha=%s\n' "$SOURCE_SHA"
  printf 'postgres_tool=%s\n' "$postgres_tool_version"
  printf 'source=postgres-and-business-volumes\n'
  printf 'components=postgres,imports,exports,offline,assets\n'
  cat "$work_dir/SHA256SUMS"
} > "$work_dir/MANIFEST"

if [ "$BACKUP_DEDUPLICATE" = 1 ]; then
  "$PYTHON" "$SCRIPT_DIR/backup_housekeeping.py" deduplicate --backup-dir "$BACKUP_DIR" \
    --staging "$work_dir" --postgres-image "${POSTGRES_IMAGE:-postgres:16-alpine}"
fi
# Publish the verified directory in one filesystem operation. Never expose a
# timestamped directory with only some of the five recovery components.
test ! -e "$final_dir"
mv -T -n "$work_dir" "$final_dir"
test ! -d "$work_dir"
work_dir=""

echo "Verified five-component backup written to $final_dir"
