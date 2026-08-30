#!/usr/bin/env sh
set -eu

BACKUP_DIR="${1:?backup directory is required}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"

test -d "$BACKUP_DIR"
for required in MANIFEST SHA256SUMS postgres.dump postgres.toc imports.tar.gz exports.tar.gz offline.tar.gz assets.tar.gz; do
  test -f "$BACKUP_DIR/$required"
done

(cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS)
test -s "$BACKUP_DIR/postgres.toc"
for archive in imports.tar.gz exports.tar.gz offline.tar.gz assets.tar.gz; do
  tar -tzf "$BACKUP_DIR/$archive" >/dev/null
done

# pg_restore reads only the dump stream; no database, volume, or network is used.
toc_path="$(mktemp "$BACKUP_DIR/.postgres-verify.XXXXXX")"
trap 'rm -f "$toc_path"' EXIT INT TERM
docker run --rm -i --network none "$POSTGRES_IMAGE" pg_restore --list - \
  < "$BACKUP_DIR/postgres.dump" > "$toc_path"
test -s "$toc_path"

echo "Verified backup: $BACKUP_DIR"
