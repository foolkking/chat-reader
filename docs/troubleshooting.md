# Troubleshooting

## `psql` Not Found

Add PostgreSQL to PATH:

```powershell
$env:Path = "E:\PostgreSQL\17\bin;" + $env:Path
```

Persist the PATH entry in Windows Environment Variables when needed.

## `pg_isready` Failing

Confirm the PostgreSQL Windows service is running. Then retry:

```powershell
pg_isready -h localhost -p 5432
```

## Alembic Connection Error

Check `apps/api/.env` or environment variables:

```env
DATABASE_URL=postgresql+psycopg://chat_reader:chat_reader@localhost:5432/chat_reader
```

Verify credentials:

```powershell
psql -U chat_reader -d chat_reader -c "SELECT current_database(), current_user;"
```

## Port 8000 Occupied

Find the process:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen
```

Stop the process or run API on a different port.

## Port 3000 Occupied

Start Next.js on another port:

```powershell
corepack pnpm --filter web dev -- --port 3001
```

## CORS Issue

The browser normally calls the Next.js origin through `/api/*`; Next.js proxies those requests to FastAPI using `API_INTERNAL_URL`. Do not set a browser-visible API URL to `localhost:8000`.

Local development uses:

```env
API_INTERNAL_URL=http://127.0.0.1:8000
```

With Docker Compose, the web container uses `http://chat-reader-api:8000` automatically.

Direct browser-to-FastAPI calls are not part of the normal Web flow. If such a separate integration is added, ensure API configuration includes its exact Web origin:

```env
CORS_ORIGINS=http://localhost:3000
```

Restart the API after changing environment values.

## LAN Web Loads But API Requests Fail

In browser Network tools, business requests should target the same Web origin, for example:

```text
http://192.168.1.20:3000/api/conversations
```

They must not target `http://localhost:8000`, `http://127.0.0.1:8000`, or `http://0.0.0.0:8000`. Restart the Next.js development server after changing `next.config.mjs` or `API_INTERNAL_URL`.

## Import Unsupported Format

Stage 10 supports the implemented import formats from prior stages:

- ChatGPT Exporter JSON
- ChatGPT Exporter Markdown
- JSON + Markdown combo
- Official `conversations.json`
- Official single conversation JSON

Unsupported extensions return `400`.

## Share 410 Expired Or Revoked

`410 Gone` means the share exists but is expired or revoked. Create a new share from the reader page if access is still desired.

## Export Download Issue

Check that the conversation exists and the format is valid:

```text
markdown
canonical_json
```

Selected message ids must belong to the exported conversation.
