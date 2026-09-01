#!/usr/bin/env sh
set -eu

revision=${1:?release revision is required}
images="chat-reader-api:${revision} chat-reader-import-worker:${revision} chat-reader-migrate:${revision} chat-reader-web:${revision}"
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

printf '{\n  "schema_version": 1,\n  "revision": "%s",\n  "images": [\n' "$revision" > image-inspection.json
has_previous_image=""

for image in $images; do
  image_revision=$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")
  image_created=$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.created" }}' "$image")
  architecture=$(docker image inspect -f '{{ .Architecture }}' "$image")
  image_id=$(docker image inspect -f '{{ .Id }}' "$image")
  command=$(docker image inspect -f '{{ json .Config.Cmd }}' "$image")

  test "$image_revision" = "$revision"
  test -n "$image_created"
  test "$architecture" = "amd64"
  case "$image" in
    chat-reader-web:*) printf '%s' "$command" | grep -F 'apps/web/server.js' >/dev/null ;;
    *) printf '%s' "$command" | grep -F 'uvicorn' >/dev/null ;;
  esac

  container=$(docker create "$image")
  docker export "$container" > "$work_dir/image.tar"
  docker rm "$container" >/dev/null

  if tar -tf "$work_dir/image.tar" | grep -E '(^|/)(\.env($|\.)|\.git/|\.next/cache/|node_modules/\.cache/|storage/imports/)' >/dev/null; then
    echo "Forbidden release path detected in $image" >&2
    exit 1
  fi

  if [ -n "$has_previous_image" ]; then
    printf ',\n' >> image-inspection.json
  fi
  printf '    {"name":"%s","id":"%s","built_at":"%s","architecture":"%s","command":%s}' \
    "$image" "$image_id" "$image_created" "$architecture" "$command" >> image-inspection.json
  has_previous_image="1"
done

# Worker and migration images intentionally share the API filesystem image;
# production Compose owns their explicit command overrides.
grep -F 'command: ["sh", "-c", "alembic upgrade head && python -m scripts.owner_auth ensure-initial"]' docker-compose.production.yml >/dev/null
grep -F 'command: ["python", "-m", "app.workers.import_worker"]' docker-compose.production.yml >/dev/null

printf '\n  ],\n  "forbidden_paths_present": false\n}\n' >> image-inspection.json
jq empty image-inspection.json
