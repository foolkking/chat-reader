#!/usr/bin/env sh
set -eu

PUBLIC_URL="${1:?public HTTPS base URL is required}"
case "$PUBLIC_URL" in
  https://*) ;;
  *)
    echo "HTTPS entry verification refused: URL must start with https:// (never use http://host:443)." >&2
    exit 2
    ;;
esac

https_origin="$(printf '%s' "$PUBLIC_URL" | sed -E 's#^(https://[^/]+).*$#\1#')"
http_origin="http://${https_origin#https://}"

health_code="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$https_origin/api/health")"
if [ "$health_code" != "200" ]; then
  echo "HTTPS entry verification failed: /api/health returned $health_code." >&2
  exit 1
fi

redirect="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code} %{redirect_url}' "$http_origin/")"
redirect_code="${redirect%% *}"
redirect_url="${redirect#* }"
case "$redirect_code" in
  301|302|307|308) ;;
  *)
    echo "HTTPS entry verification failed: HTTP entry returned $redirect_code instead of a redirect." >&2
    exit 1
    ;;
esac
case "$redirect_url" in
  "$https_origin"|"$https_origin"/*) ;;
  *)
    echo "HTTPS entry verification failed: HTTP redirects outside the expected HTTPS origin." >&2
    exit 1
    ;;
esac

printf 'https_health=200 http_redirect=%s target=%s\n' "$redirect_code" "$redirect_url"
