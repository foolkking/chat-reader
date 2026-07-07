# Local Installation Guide

This guide targets Windows local development for `chat-reader`.

## Requirements

- Node.js 20+
- Corepack / pnpm
- Python 3.11+
- PostgreSQL 17.x installed locally

Recommended PostgreSQL paths:

```text
Install: E:\PostgreSQL\17
Data:    E:\PostgreSQL\data
PATH:    E:\PostgreSQL\17\bin
```

## Database

Create a local user and database:

```sql
CREATE ROLE chat_reader LOGIN PASSWORD 'chat_reader';
CREATE DATABASE chat_reader OWNER chat_reader;
GRANT ALL PRIVILEGES ON DATABASE chat_reader TO chat_reader;
```

Expected API database URL:

```env
DATABASE_URL=postgresql+psycopg://chat_reader:chat_reader@localhost:5432/chat_reader
```

## Install Dependencies

```powershell
corepack enable
corepack pnpm install

cd apps/api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
cd ../..
```

## Initialize Database

```powershell
cd apps/api
alembic upgrade head
alembic current
cd ../..
```

Expected head:

```text
20260707_0005
```

## Start Locally

Terminal 1:

```powershell
cd apps/api
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Terminal 2:

```powershell
corepack pnpm --filter web dev
```

Open:

```text
http://localhost:3000
```

## Verify

```powershell
.\scripts\check-local.ps1
.\scripts\qa-local.ps1
```
