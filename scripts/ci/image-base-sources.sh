#!/usr/bin/env bash
# CI-only base preparation. Never build an application image or change its pin.
set -euo pipefail

if [[ "$#" != 0 || "${GITHUB_ACTIONS:-}" != true || "${GITHUB_JOB:-}" != build-images \
  || ! "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ || ! -f "${GITHUB_ENV:-}" || ! -w "$GITHUB_ENV" ]]; then
  echo "An existing build-images CI environment file and run identity are required." >&2
  exit 1
fi

validate_pin() {
  local repository="$1" pin="$2"
  if [[ ! "$pin" =~ ^public\.ecr\.aws/docker/library/(python|node):[a-zA-Z0-9_.-]+@sha256:[a-f0-9]{64}$ \
    || "$pin" != "public.ecr.aws/docker/library/${repository}:"* ]]; then
    echo "Expected a digest-pinned official ${repository} source." >&2
    return 1
  fi
}

# Validate both inputs before any pull or environment-file change.
validate_pin python "${PYTHON_BASE_IMAGE:-}"
validate_pin node "${NODE_BASE_IMAGE:-}"

selected_source=""
prepare_base() {
  local primary="$1" source retry platform
  local sources=("$primary" "docker.io/${primary#public.ecr.aws/docker/}")
  selected_source=""
  for source in "${sources[@]}"; do
    for retry in 1 2 3; do
      if timeout --kill-after=10s 60s docker pull --platform linux/amd64 "$source"; then
        if ! platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$source")"; then
          echo "Unable to verify the pulled base image platform." >&2
          return 1
        fi
        if [[ "$platform" != linux/amd64 ]]; then
          echo "Refusing a base image with an unexpected platform: $platform" >&2
          return 1
        fi
        selected_source="$source"
        return 0
      fi
      echo "Official base pull failed (attempt $retry/3): $source" >&2
      if [[ "$retry" != 3 ]]; then sleep "$((retry * 2))"; fi
    done
  done
  echo "Both pinned official base sources failed; no application build may start." >&2
  return 1
}

prepare_base "$PYTHON_BASE_IMAGE"
python_source="$selected_source"
prepare_base "$NODE_BASE_IMAGE"
node_source="$selected_source"

# Publish only after BOTH pulls and platform checks succeed. The existing
# builds consume these exact references; never retry arbitrary build failures.
printf 'PYTHON_BASE_IMAGE=%s\nNODE_BASE_IMAGE=%s\n' \
  "$python_source" "$node_source" >> "$GITHUB_ENV"
printf 'Verified API base: %s\nVerified Web base: %s\n' "$python_source" "$node_source"
