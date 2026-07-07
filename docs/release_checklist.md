# Release Checklist

Release target: `chat-reader` `0.10.0-rc1`

## Required Checks

- [ ] PostgreSQL is ready: `pg_isready`.
- [ ] Alembic is current: `cd apps/api; alembic current`.
- [ ] Backend tests pass: `cd apps/api; pytest`.
- [ ] Frontend typecheck passes: `corepack pnpm --filter web typecheck`.
- [ ] Frontend lint passes: `corepack pnpm --filter web lint`.
- [ ] `scripts/check-local.ps1` passes.
- [ ] `scripts/qa-local.ps1` passes.
- [ ] Import smoke test passes.
- [ ] Reader smoke test passes.
- [ ] Search smoke test passes.
- [ ] Edit/version/restore smoke test passes.
- [ ] Share/export smoke test passes.
- [ ] Leak checks pass.
- [ ] `git diff --check` passes.
- [ ] `git status --short` is clean before tagging.

## Manual Smoke Path

1. Start API: `cd apps/api; uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`.
2. Start Web: `corepack pnpm --filter web dev`.
3. Open `http://localhost:3000`.
4. Upload a ChatGPT Exporter JSON sample.
5. Preview and commit.
6. Open the reader.
7. Search a known keyword.
8. Edit a message and verify version history.
9. Restore the imported version.
10. Create a share and open `/share/{token}`.
11. Revoke the share and verify it is inaccessible.
12. Export Markdown and Canonical JSON.
