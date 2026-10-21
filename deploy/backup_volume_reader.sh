#!/usr/bin/env sh
# Sourced by backup/preflight. Never start application code or Compose one-offs.

backup_require_integer() {
  case "$2" in
    ''|*[!0-9]*)
      echo "$1 must be a non-negative integer." >&2
      return 1
      ;;
  esac
}

backup_source_init() {
  # Include stopped containers: the release backup deliberately stops writers.
  backup_source_container="$(compose ps -a -q api)"
  case "$backup_source_container" in
    ''|*[!0-9a-f]*) echo "Backup source requires exactly one existing API container." >&2; return 1 ;;
  esac
  if [ "${#backup_source_container}" -ne 64 ]; then
    echo "Backup source container identity is incomplete." >&2
    return 1
  fi
  backup_source_image="$(docker inspect --type container --format '{{.Image}}' "$backup_source_container")"
  case "$backup_source_image" in
    sha256:*) ;;
    *) echo "Backup source requires an immutable image ID." >&2; return 1 ;;
  esac
  backup_digest="${backup_source_image#sha256:}"
  case "$backup_digest" in
    ''|*[!0-9a-f]*) echo "Backup source image identity is invalid." >&2; return 1 ;;
  esac
  test "${#backup_digest}" -eq 64 || { echo "Backup source image identity is incomplete." >&2; return 1; }
  backup_local_image="$(docker image inspect --format '{{.Id}}' "$backup_source_image")"
  test "$backup_local_image" = "$backup_source_image" || { echo "Backup source image is not locally verified." >&2; return 1; }

  backup_mounts="$(docker inspect --type container --format '{{range .Mounts}}{{println .Destination}}{{end}}' "$backup_source_container")"
  for backup_component in imports exports offline assets; do
    if ! printf '%s\n' "$backup_mounts" | grep -Fqx "/data/$backup_component"; then
      echo "Backup source is missing a required business-volume mount." >&2
      return 1
    fi
  done
}

backup_volume_read() {
  case "$1" in imports|exports|offline|assets) ;; *) echo "Unknown backup component." >&2; return 1 ;; esac
  case "$2" in
    size) backup_read_command='exec du -sk "$1"' ;;
    archive) backup_read_command='exec tar -C "$1" -czf - .' ;;
    *) echo "Unknown backup read operation." >&2; return 1 ;;
  esac
  # No Compose/build/pull fallback, credentials, network, or writable data mounts.
  # If a concurrent cleanup removes the pinned source, Docker must fail closed.
  docker run --rm --pull=never --network none --read-only \
    --cap-drop ALL --security-opt no-new-privileges \
    --memory 64m --memory-swap 64m --pids-limit 32 \
    --volumes-from "$backup_source_container:ro" --entrypoint sh \
    "$backup_source_image" -c "$backup_read_command" sh "/data/$1"
}

backup_component_size_kb() {
  # Keep Docker failure outside a pipeline: POSIX sh does not have pipefail.
  backup_usage="$(backup_volume_read "$1" size)" || return "$?"
  backup_kb="$(printf '%s\n' "$backup_usage" | cut -f1)"
  backup_require_integer "$1 size" "$backup_kb" || return "$?"
  printf '%s\n' "$backup_kb"
}
