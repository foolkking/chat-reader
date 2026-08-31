#!/usr/bin/env sh
set -eu

STATE_DIR="${1:-${RELEASE_STATE_DIR:-/etc/chat-reader/release-state}}"
CURRENT_FILE="$STATE_DIR/current-images.env"
ROLLBACK_FILE="$STATE_DIR/rollback-images.env"

case "$STATE_DIR" in
  ''|/|.)
    echo "Release state verification refused: state directory is too broad: $STATE_DIR" >&2
    exit 2
    ;;
esac

if [ -L "$STATE_DIR" ]; then
  echo "Release state verification refused: state directory is symlinked: $STATE_DIR" >&2
  exit 2
fi

for file in "$CURRENT_FILE" "$ROLLBACK_FILE"; do
  if [ ! -f "$file" ] || [ -L "$file" ]; then
    echo "Release state verification failed: missing or symlinked state file: $file" >&2
    exit 1
  fi
done

read_value() {
  key="$1"
  file="$2"
  value="$(awk -F= -v key="$key" '$1 == key { value = substr($0, index($0, "=") + 1) } END { print value }' "$file")"
  case "$value" in
    ''|*[!A-Za-z0-9._:/-]*)
      echo "Release state verification failed: $key is missing or contains unsafe characters in $file" >&2
      exit 1
      ;;
  esac
  printf '%s' "$value"
}

current_revision="$(read_value RELEASE_SHA "$CURRENT_FILE")"
rollback_revision="$(read_value RELEASE_SHA "$ROLLBACK_FILE")"
if [ "$current_revision" = "$rollback_revision" ]; then
  echo "Release state verification failed: current and rollback revisions are identical" >&2
  exit 1
fi

printf 'state_dir=%s\ncurrent_revision=%s\nrollback_revision=%s\n' \
  "$STATE_DIR" "$current_revision" "$rollback_revision"
echo "Release state ownership and recovery pair verified"
