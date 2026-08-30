#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <chat-reader-images.tar.gz>" >&2
  exit 2
fi

RELEASE_ARCHIVE="$1"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_HEADROOM_KB="${BACKUP_HEADROOM_KB:-262144}"
RELEASE_IMAGE_HEADROOM_KB="${RELEASE_IMAGE_HEADROOM_KB:-524288}"
RELEASE_TRANSFER_HEADROOM_KB="${RELEASE_TRANSFER_HEADROOM_KB:-131072}"

compose() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

ceil_kb() {
  awk -v bytes="$1" 'BEGIN { printf "%.0f\n", int((bytes + 1023) / 1024) }'
}

filesystem_device() {
  df -Pk "$1" | awk 'NR == 2 { print $1 }'
}

filesystem_available_kb() {
  df -Pk "$1" | awk 'NR == 2 { print $4 }'
}

require_non_negative_integer() {
  case "$2" in
    ''|*[!0-9]*)
      echo "$1 must be a non-negative integer, got: $2" >&2
      exit 2
      ;;
  esac
}

require_non_negative_integer BACKUP_HEADROOM_KB "$BACKUP_HEADROOM_KB"
require_non_negative_integer RELEASE_IMAGE_HEADROOM_KB "$RELEASE_IMAGE_HEADROOM_KB"
require_non_negative_integer RELEASE_TRANSFER_HEADROOM_KB "$RELEASE_TRANSFER_HEADROOM_KB"

if [ ! -s "$RELEASE_ARCHIVE" ]; then
  echo "Release preflight refused: archive is missing or empty: $RELEASE_ARCHIVE" >&2
  exit 1
fi
if [ ! -d "$BACKUP_DIR" ]; then
  echo "Release preflight refused: backup directory does not exist: $BACKUP_DIR" >&2
  exit 1
fi

gzip -t "$RELEASE_ARCHIVE"
tar -tzf "$RELEASE_ARCHIVE" >/dev/null

archive_bytes="$(wc -c < "$RELEASE_ARCHIVE" | tr -d ' ')"
expanded_bytes="$(gzip -dc "$RELEASE_ARCHIVE" | wc -c | tr -d ' ')"
archive_kb="$(ceil_kb "$archive_bytes")"
expanded_kb="$(ceil_kb "$expanded_bytes")"

database_bytes="$(compose exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select pg_database_size(current_database())"')"
require_non_negative_integer database_bytes "$database_bytes"
database_kb="$(ceil_kb "$database_bytes")"
backup_required_kb="$((database_kb + BACKUP_HEADROOM_KB))"
for component in imports exports offline assets; do
  component_kb="$(compose run --rm --no-deps -T api \
    sh -c "du -sk '/data/$component' | cut -f1")"
  require_non_negative_integer "${component}_kb" "$component_kb"
  backup_required_kb="$((backup_required_kb + component_kb))"
done

image_required_kb="$((expanded_kb + RELEASE_IMAGE_HEADROOM_KB))"
archive_dir="$(dirname "$RELEASE_ARCHIVE")"
docker_root="$(docker info --format '{{.DockerRootDir}}')"
if [ ! -d "$docker_root" ]; then
  echo "Release preflight refused: Docker root does not exist: $docker_root" >&2
  exit 1
fi

backup_device="$(filesystem_device "$BACKUP_DIR")"
docker_device="$(filesystem_device "$docker_root")"
transfer_device="$(filesystem_device "$archive_dir")"

check_device() {
  device="$1"
  probe_path="$2"
  required_kb=0
  components=""

  if [ "$backup_device" = "$device" ]; then
    required_kb="$((required_kb + backup_required_kb))"
    components="backup=${backup_required_kb}KiB"
  fi
  if [ "$docker_device" = "$device" ]; then
    required_kb="$((required_kb + image_required_kb))"
    components="${components}${components:+, }images=${image_required_kb}KiB"
  fi
  if [ "$transfer_device" = "$device" ]; then
    required_kb="$((required_kb + RELEASE_TRANSFER_HEADROOM_KB))"
    components="${components}${components:+, }transfer_headroom=${RELEASE_TRANSFER_HEADROOM_KB}KiB"
  fi

  available_kb="$(filesystem_available_kb "$probe_path")"
  require_non_negative_integer available_kb "$available_kb"
  printf 'filesystem=%s available=%sKiB required=%sKiB components=%s\n' \
    "$device" "$available_kb" "$required_kb" "$components"
  if [ "$available_kb" -lt "$required_kb" ]; then
    echo "Release preflight refused: filesystem $device has ${available_kb} KiB available; ${required_kb} KiB required ($components)." >&2
    exit 1
  fi
}

check_device "$backup_device" "$BACKUP_DIR"
if [ "$docker_device" != "$backup_device" ]; then
  check_device "$docker_device" "$docker_root"
fi
if [ "$transfer_device" != "$backup_device" ] && [ "$transfer_device" != "$docker_device" ]; then
  check_device "$transfer_device" "$archive_dir"
fi

printf 'release_archive=%s staged=%sKiB expanded=%sKiB\n' \
  "$RELEASE_ARCHIVE" "$archive_kb" "$expanded_kb"
echo "Release disk-space preflight passed; no files, images, containers, or volumes were removed."
