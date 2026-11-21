#!/usr/bin/env bash
# CI-only: this gate never uses deployment SSH, a production namespace, or release secrets.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted && ( $# == 2 || ( $# == 3 && $3 == program ) ) ]]
archive=$(realpath -e "$1"); sha=$2
[[ "$archive" == "$RUNNER_TEMP/verified-release/chat-reader-images.tar.gz" && "$sha" =~ ^[0-9a-f]{40}$ ]]
root=$(pwd -P); lab="cr-update-lab-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"; work=$(mktemp -d "$RUNNER_TEMP/update-lab.XXXXXX")
export TMPDIR="$work" TMP="$work" TEMP="$work"
test ! -e "$work/login.json"
GOTOOLCHAIN=local go version
(cd deploy/updater && GOTOOLCHAIN=local go test ./... && CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -o "$work/updater" .)
python3 -m unittest discover -s scripts/ci -p 'test_update*.py'
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm --filter web exec playwright install --with-deps chromium
# No outer socket/volumes mounted and no TCP listener for either Docker API.
limits=()
if [[ ${3:-} == program ]]; then limits=(--cpus 2 --memory 1900m --memory-swap 1900m); fi
docker run -d --privileged --name "$lab" "${limits[@]}" --label "cr.rehearsal=${GITHUB_RUN_ID}" -p 127.0.0.1:32481:443 \
  public.ecr.aws/docker/library/docker:27-dind@sha256:aa3df78ecf320f5fafdce71c659f1629e96e9de0968305fe1de670e0ca9176ce \
  dockerd -H unix:///var/run/docker.sock >/dev/null
trap 'if [[ "$(docker inspect -f "{{index .Config.Labels \"cr.rehearsal\"}}" "$lab")" == "$GITHUB_RUN_ID" ]]; then docker stop "$lab" >/dev/null; fi' EXIT
for _ in $(seq 1 60); do docker exec "$lab" docker info >/dev/null 2>&1 && break; sleep 1; done
docker exec "$lab" sh -ec 'apk add --no-cache python3 nginx openssl coreutils tar gzip ca-certificates >/dev/null; ln -sf /usr/local/bin/docker /usr/bin/docker; mkdir -p /lab/source/deploy /lab/source/scripts/ci; printf disposable-nested-engine >/lab/dedicated-engine'
docker cp "$work/updater" "$lab:/lab/updater"
docker cp "$root/deploy/updater" "$lab:/lab/source/deploy/"
for name in backup.sh backup_volume_reader.sh backup_stream.py verify_backup.sh preflight_release_space.sh; do docker cp "$root/deploy/$name" "$lab:/lab/source/deploy/$name"; done
docker cp docker-compose.production.yml "$lab:/lab/source/docker-compose.production.yml"
for file in update-lab.py update-lab-negative.py update-program-lab.py update-program-negative.py; do docker cp "scripts/ci/$file" "$lab:/lab/source/scripts/ci/$file"; done
docker exec -i "$lab" docker load < "$archive" >/dev/null
docker exec "$lab" docker pull postgres:16-alpine >/dev/null
docker exec "$lab" python3 /lab/source/scripts/ci/update-lab.py setup "$sha"
umask 077; docker cp "$lab:/lab/browser-login.json" "$work/login.json"
UPDATE_LAB_LOGIN="$work/login.json" UPDATE_LAB_METRICS="$RUNNER_TEMP/update-timings.json" node scripts/ci/update-lab-browser.cjs
docker exec "$lab" python3 /lab/source/scripts/ci/update-lab.py verify
if [[ ${3:-} == program ]]; then
  docker exec "$lab" python3 -B /lab/source/scripts/ci/update-program-lab.py enroll 4352
  UPDATE_LAB_CONTAINER="$lab" UPDATE_LAB_LOGIN="$work/login.json" python3 scripts/ci/program-benchmark.py "$RUNNER_TEMP/program-samples"
  docker exec "$lab" python3 -B /lab/source/scripts/ci/update-program-negative.py |& tee "$RUNNER_TEMP/program-samples/faults.log"
  exit 0
fi
UPDATE_LAB_LOGIN="$work/login.json" node scripts/ci/update-lab-sidebar.cjs
docker exec "$lab" python3 /lab/source/scripts/ci/update-lab-negative.py
# Ship the same static updater executable that passed the isolated rehearsal.
mkdir -p "$work/bootstrap/deploy/updater"
install -m 0755 "$work/updater" "$work/bootstrap/deploy/updater/updater-linux-amd64"
for name in install.sh host.py api-socket.yml nginx.conf program-profile.yml prove_recovery.py program_scratch.py chat-reader-program-scratch.service chat-reader-updater.service chat-reader-update-status.service; do
  cp "deploy/updater/$name" "$work/bootstrap/deploy/updater/$name"
done
install -m 0644 "$RUNNER_TEMP/verified-release/program-evidence.json" "$work/bootstrap/deploy/updater/program-evidence.json"
for name in backup.sh backup_volume_reader.sh backup_stream.py verify_backup.sh preflight_release_space.sh; do cp "deploy/$name" "$work/bootstrap/deploy/$name"; done
tar -C "$work/bootstrap" -czf "$RUNNER_TEMP/chat-reader-updater-linux-amd64.tar.gz" deploy
