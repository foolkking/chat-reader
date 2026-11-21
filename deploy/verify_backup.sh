#!/usr/bin/env sh
set -eu

BACKUP_DIR="${1:?backup directory is required}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"

test -d "$BACKUP_DIR"
for required in MANIFEST SHA256SUMS postgres.dump postgres.toc imports.tar.gz exports.tar.gz offline.tar.gz assets.tar.gz; do
  test -f "$BACKUP_DIR/$required"
done

if [ "${UPDATER_BATCH_READER:-0}" = 1 ]; then
  SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
  "${PYTHON:-python3}" "$SCRIPT_DIR/backup_stream.py" verify "$BACKUP_DIR"
else
(cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS)
for archive in imports.tar.gz exports.tar.gz offline.tar.gz assets.tar.gz; do
  tar -tzf "$BACKUP_DIR/$archive" >/dev/null
done
fi
test -s "$BACKUP_DIR/postgres.toc"

# pg_restore reads only the dump stream; no database, volume, or network is used.
toc_path="$(mktemp "$BACKUP_DIR/.postgres-verify.XXXXXX")"
trap 'rm -f "$toc_path"' EXIT INT TERM
docker run --rm -i --network none "$POSTGRES_IMAGE" pg_restore --list \
  < "$BACKUP_DIR/postgres.dump" > "$toc_path"
test -s "$toc_path"

echo "Verified backup: $BACKUP_DIR"
