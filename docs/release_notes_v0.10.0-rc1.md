# Release Notes: v0.10.0-rc1

`chat-reader` `v0.10.0-rc1` is a local-first release candidate for reading, organizing, searching, editing, sharing, and exporting ChatGPT conversation exports.

## Core Features

- Import preview and raw artifact preservation.
- ChatGPT Exporter JSON and Markdown import.
- Official `conversations.json` primary-path import.
- Canonical conversation persistence.
- Reader UI with render blocks.
- Projects, pins, reading position, and recent items.
- Keyword search and generated TOC.
- Message editing, version history, and restore.
- Local read-only share links.
- Markdown and Canonical JSON export.

## Supported Imports

- ChatGPT Exporter JSON.
- ChatGPT Exporter Markdown.
- ChatGPT Exporter JSON + Markdown combo.
- Official ChatGPT `conversations.json`.
- Official single conversation JSON.

## Known Limitations

- Local single-user application only.
- No auth, cloud sync, collaboration, semantic search, embeddings, PDF, or DOCX export.
- Official alternate branches are not exposed as a reader branch UI.
- Share links are local-first and not hardened for public SaaS exposure.

## Upgrade Notes

Expected Alembic head:

```text
20260707_0005
```

Run:

```powershell
cd apps/api
alembic upgrade head
cd ../..
```

## Test Status

Release candidate requires:

- Backend pytest pass.
- Frontend typecheck pass.
- Frontend lint pass.
- `scripts/check-local.ps1` pass.
- `scripts/qa-local.ps1` pass.
- `scripts/release-check.ps1` pass after commit.
