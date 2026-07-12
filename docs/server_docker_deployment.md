# Docker Server Deployment

This deployment exposes only the Next.js web service. FastAPI and PostgreSQL remain on the private Docker network, and browser API calls continue to use the same-origin `/api/*` proxy.

## Server requirements

- Linux server with Docker Engine 24+ and Docker Compose v2.
- At least 2 CPU cores, 4 GB RAM, and sufficient disk space for PostgreSQL and imported archives.
- A domain name pointing to the server for HTTPS and installable PWA support.
- Firewall ports `22`, `80`, and `443` open. Do not expose `5432` or `8000`.

## First deployment

```bash
git clone <repository-url> chat-reader
cd chat-reader
cp .env.production.example .env.production
```

Edit `.env.production`:

- Set a long URL-safe random `POSTGRES_PASSWORD` (letters, numbers, `_`, and `-` avoid connection URL escaping problems).
- Set `PUBLIC_WEB_BASE_URL` to the final HTTPS origin, such as `https://chat.example.com`.
- Keep `WEB_BIND_ADDRESS=127.0.0.1` when Nginx or Caddy runs on the host.

Build and start:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml build
docker compose --env-file .env.production -f docker-compose.production.yml up -d
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

The one-shot `migrate` service runs `alembic upgrade head` before the API starts.

Verify real business APIs through the web origin:

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/conversations
curl -fsS http://127.0.0.1:3000/api/projects
```

## HTTPS reverse proxy

Copy `deploy/nginx-chat-reader.conf` to `/etc/nginx/sites-available/chat-reader`, replace `chat.example.com`, enable the site, and validate Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/chat-reader /etc/nginx/sites-enabled/chat-reader
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d chat.example.com
```

After HTTPS is active, verify:

```bash
curl -fsS https://chat.example.com/api/health
curl -I https://chat.example.com/manifest.webmanifest
```

## Updating

```bash
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.production.yml build
docker compose --env-file .env.production -f docker-compose.production.yml up -d --remove-orphans
docker image prune -f
```

Compose recreates `migrate`; it safely applies only pending Alembic migrations.

## Backup and restore

Database backup:

```bash
chmod +x deploy/backup.sh
POSTGRES_DB=chat_reader POSTGRES_USER=chat_reader ./deploy/backup.sh
```

Also back up the named volume `chat-reader_import-storage`, which contains imported source artifacts. PostgreSQL data and import storage are intentionally separate volumes.

Restore a database dump into an empty database:

```bash
cat backups/chat-reader-YYYYMMDDTHHMMSSZ.dump | \
  docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres \
  pg_restore -U chat_reader -d chat_reader --clean --if-exists
```

## Operations

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs -f web api
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml restart web api
```

Persistent volumes must not be removed during routine updates. Avoid `docker compose down -v` unless permanently deleting all stored data.

## Security notes

- The current application does not provide user authentication. Put it behind a VPN, private network, or reverse-proxy authentication if the archive must not be public.
- Share URLs are bearer links. Anyone with a valid link can read its configured content until it expires or is revoked.
- Use HTTPS in production. Service workers and installable PWA behavior require a secure context.
- Keep `.env.production` outside version control and rotate the database password if it is exposed.
