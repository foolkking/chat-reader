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

Ensure API configuration includes the Web origin:

```env
CORS_ORIGINS=http://localhost:3000
```

Restart the API after changing environment values.

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
