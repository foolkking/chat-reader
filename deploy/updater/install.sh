#!/bin/sh
# Run locally from an inspected checkout/bundle. Never downloads or starts a release.
set -eu
test "$(id -u)" = 0 && test "$(uname -sm)" = 'Linux x86_64'
test "$#" = 2 || { echo 'Usage: install.sh <verified-linux-amd64-binary> <nginx-worker-user>' >&2; exit 2; }
binary="$(realpath -e -- "$1")"; nginx_user="$2"
id "$nginx_user" >/dev/null
src="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
lib=/usr/local/lib/chat-reader-updater
getent group cr-update-control >/dev/null || groupadd --system cr-update-control
getent group cr-update-status >/dev/null || groupadd --system cr-update-status
getent passwd cr-update-status >/dev/null || useradd --system --gid cr-update-status --no-create-home --shell /sbin/nologin cr-update-status
usermod -a -G cr-update-status "$nginx_user"
install -d -m 0755 "$lib"
install -d -m 0700 /etc/chat-reader/updater /var/lib/chat-reader-updater /var/lib/chat-reader-updater/jobs
install -d -o root -g cr-update-status -m 2750 /var/lib/chat-reader-update-progress
install -m 0755 "$binary" "$lib/updater"
for file in host.py nginx.conf; do install -m 0644 "$src/$file" "$lib/$file"; done
for file in preflight_release_space.sh backup.sh backup_volume_reader.sh verify_backup.sh; do install -m 0644 "$src/../$file" "$lib/$file"; done
gid="$(getent group cr-update-control | cut -d: -f3)"
sed "s/__COMMAND_GID__/$gid/" "$src/api-socket.yml" > "$lib/api-socket.yml.new"
chmod 0644 "$lib/api-socket.yml.new"; mv -f "$lib/api-socket.yml.new" "$lib/api-socket.yml"
printf '%s\n' 'd /run/chat-reader-updater 0750 root cr-update-control -' \
  'd /run/chat-reader-update-status 0750 cr-update-status cr-update-status -' > /etc/tmpfiles.d/chat-reader-updater.conf
systemd-tmpfiles --create /etc/tmpfiles.d/chat-reader-updater.conf
for unit in chat-reader-updater chat-reader-update-status; do install -m 0644 "$src/$unit.service" "/etc/systemd/system/$unit.service"; done
systemctl daemon-reload
printf '%s\n' 'Files installed only. Configure trust, loopback ingress, API-only mount, nginx and a verified existing image baseline before enrollment.'
