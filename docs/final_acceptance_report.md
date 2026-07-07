# Final Acceptance Report

Release candidate: `chat-reader` `0.10.0-rc1`

## Stage Summary

- Stage 00: Foundation monorepo, Next.js, FastAPI, PostgreSQL, Alembic.
- Stage 01: Source detection, raw artifacts, import records.
- Stage 02: ChatGPT Exporter JSON/Markdown preview import.
- Stage 03: Official `conversations.json` preview import.
- Stage 03B: Local Windows PostgreSQL verification.
- Stage 04: Canonical persistence and read APIs.
- Stage 05: Basic reader UI.
- Stage 06: Projects, pins, reading position, recent items.
- Stage 07: Search, TOC, and reader performance guardrails.
- Stage 08: Message editing, version history, restore.
- Stage 09: Local shares, Markdown/Canonical JSON export, packaging scripts.
- Stage 10: Hardening, leak checks, error contracts, large fixture QA, release docs.

## Feature Matrix

| Area | Status |
|---|---|
| ChatGPT Exporter JSON import | Complete |
| ChatGPT Exporter Markdown import | Complete |
| JSON + Markdown combo import | Complete |
| Official conversations import | Complete for primary path |
| Canonical persistence | Complete |
| Reader UI | Basic complete |
| Projects / pins / reading position | Basic complete |
| Search / TOC | Keyword search and generated TOC complete |
| Editing / version history | Basic complete |
| Sharing | Local read-only links complete |
| Export | Markdown and Canonical JSON complete |

## Known Limitations

- Local single-user application; no auth or multi-user permissions.
- No semantic search, embeddings, cloud sync, PDF, or DOCX export.
- Official branch alternatives are preserved as source references but are not exposed as a branch UI.
- Reader uses windowed loading, not a full virtual scroll engine.
- Share links are local-first and should not be treated as public SaaS links.

## Test Status

- Backend pytest: expected at least 88 tests; Stage 10 adds security, error, full-flow, large fixture, and migration tests.
- Frontend typecheck: required.
- Frontend lint: required.
- Scripts: `check-local.ps1`, `qa-local.ps1`, and `release-check.ps1`.

## Migration Head

Expected Alembic head: `20260707_0005`.

## Security Notes

- Share raw tokens are returned only when created.
- Database stores share `token_hash`, not raw tokens.
- Public/read/export/search/edit responses are covered by leak checks for paths, DB URLs, token hashes, and raw artifact fields.
- Imported content is rendered through canonical render blocks, without `dangerouslySetInnerHTML`.

## Verdict

Release readiness verdict: `READY_FOR_RC`, assuming final Stage 10 checks pass in the local PostgreSQL environment.
