# Project State

Last updated: 2026-09-01

## 1. Project Snapshot

| Field | Current state |
|---|---|
| Project type | Web/API/worker monorepo for a single-owner conversation archive |
| Primary languages | TypeScript/React/Next.js, Python/FastAPI, SQL/Alembic |
| Package manager | pnpm via Corepack; Python dependencies in `apps/api/pyproject.toml` |
| Main entry points | `apps/web`, `apps/api`, `docker-compose.production.yml` |
| Database | PostgreSQL with Alembic; repository head `20260829_0029` |
| Branch / baseline | `master`; review baseline SHA `1f7117fe509fccb09331b669f2b719ae82f8cf49` plus dirty worktree changes |
| Deployment | Prebuilt OCI artifacts and `docker compose --no-build`; no deployment in this cycle |
| Docs status | `docs/system/` is authoritative; dated execution/release notes are historical |

## 2. Current Purpose

Chat Reader is a personal conversation archive and reference workspace. The
canonical object relationship is:

```text
Project / Unclassified
  -> Conversation
       -> Reader
```

Conversation is the primary user object. Import, Share, Offline, Export,
Backup, cleanup and BackgroundTask are boundary workflows around it. Reader
remains the canonical conversation surface; public Share and Offline Reader
have separate permission/data boundaries.

## 3. Repository Map

```text
.
|-- apps/web/                 Next.js owner, Share and Offline surfaces
|-- apps/api/                 FastAPI routes, services, worker and tests
|-- docs/system/              current contracts and improvement backlog
|-- docs/archive/             preserved historical project-state snapshots
|-- deploy/                   read-only release/recovery helpers
|-- scripts/                  local and CI verification helpers
|-- .github/workflows/        release and performance workflows
|-- docker-compose*.yml       local/production service topology
`-- PROJECT_STATE.md          this compact current-state snapshot
```

## 4. Important Files

| Path | Why it matters |
|---|---|
| `apps/web/features/conversations/conversation-reader.tsx` | Owner Reader target navigation, window loading and locate feedback |
| `apps/web/lib/reader-data-source.ts` | Remote/Offline Reader data source and locator resolution |
| `apps/api/app/services/reader_locator.py` | Canonical message/version/block/occurrence resolver |
| `apps/api/app/api/routes/conversations.py` | Owner Reader APIs, including `resolve-locator` |
| `apps/api/app/api/routes/shares.py` | Token-scoped Share Reader and resolver |
| `apps/api/app/services/editing/attachment_integrity.py` | Merge/reference integrity validation |
| `apps/api/app/services/offline_packages.py` | Offline package generation and phase timing |
| `apps/web/lib/offline-db.ts` | Dexie v1-compatible Offline package import/read path |
| `apps/web/features/projects/project-sidebar.tsx` | Project/conversation shell, custom order and DnD |
| `apps/web/features/import/adaptive-import-workspace.tsx` | Adaptive Import, Rescue and terminal result scope |
| `docs/system/CONTINUOUS_IMPROVEMENT_BACKLOG.md` | Candidate register and evidence-backed status |
| `docs/system/DEPLOYMENT_AND_ENVIRONMENT.md` | Deployment, verification and recovery boundaries |

## 5. Known Working Commands

| Command | Purpose | Current evidence |
|---|---|---|
| `corepack pnpm run lint` | Web lint | PASS 2026-09-01 |
| `corepack pnpm run typecheck` | Web typecheck | PASS 2026-09-01 |
| `corepack pnpm --filter web build` | Production Web build | PASS in this implementation cycle |
| `corepack pnpm run test:api` | API suite | PASS 446 passed, 6 skipped in this cycle |
| `corepack pnpm --filter web test:pwa` | PWA/browser suite | Full suite NOT VERIFIED locally; Service Worker/online startup timeouts and a CSP resource failure occurred. Targeted OFF-010 375px fixture run passed with Chromium 1234 + `APP_ENV=test` |
| `cd apps/api; python -m alembic heads` | Migration head | `20260829_0029 (head)` |
| `git diff --check` | Patch whitespace | PASS |
| `corepack pnpm run ci:changed-area` | Changed-area local check suggestions | PASS; always retains full gate |
| `python deploy/cleanup_release_transfer.py ...` | Bounded transfer cleanup | Dry-run/execute temporary-directory smoke PASS |
| `sh deploy/verify_release_state.sh <state-dir>` | Current/rollback pointer check | Temporary-directory smoke PASS |
| `corepack pnpm run test:ci-tools` | Local CI helper tests | PASS 2026-09-01 |

## 6. Architecture Summary

- Owner shell keeps Sidebar, global Tasks and workspace boundaries mounted
  across supported client-side navigation; Login, Share, Offline and Library
  remain explicit boundaries.
- Reader target navigation uses a shared `LocatorTarget`/`ResolvedLocator`
  contract. The server or local Offline resolver chooses canonical
  `MessageVersion`/`RenderBlock` and Unicode offsets; DOM Range is presentation
  alignment only.
- Attachment targets require conversation-scoped `attachment_id`,
  `message_version_id` and `occurrence_key` when available. Missing or stale
  identity fails closed without clearing the Reader.
- Import is deterministic and progressive: known Native Markdown is direct,
  stable unknown structures are MAPPABLE, and documents without reliable
  message boundaries are NOT_MAPPABLE with Conversation Rescue guidance.
- BackgroundTask is global delayed work. Task Center re-entry, cancellation,
  retry, partial results and retention reuse the existing worker/model; no
  permanent history product was added.
- Offline package v1 reads remain supported. v2+ imports validate required
  stores/counts before atomic Dexie replacement and preserve the previous
  readable copy on AbortError.
- `.cr` restore, Share, Offline, auth, backup and cleanup remain separate
  boundaries; no schema migration was added in the current local changes.

## 7. Implementation Status

| Area | Status | Notes |
|---|---|---|
| Settings ownership | Implemented locally | Hub categories, focused consequential actions, dirty dismissal protection |
| Global Tasks | Implemented locally | Stable owner, re-entry, dismissal vs cancellation, truthful results |
| Adaptive Import/Rescue | Implemented locally | SUPPORTED/MAPPABLE/NOT_MAPPABLE and static bilingual Rescue Skills |
| Attachment merge integrity | Implemented locally | Multi-occurrence mapping, canonical field rebuild, fail-closed checks and repair audit |
| Reader locator | Implemented locally | Owner, Share and Offline resolver paths; focused API/browser contracts pass |
| Sidebar/project DnD | Implemented locally | Custom project order, source-sized overlays and row state feedback |
| Offline resilience | Implemented locally | Bounded atomic import, quota/malformed/count validation and retry surface |
| Release evidence | Implemented locally | Explicit cache evidence, artifact inspection, health/rollback/HTTPS checks |
| CI quality ownership | Implemented locally | Release and performance workflows expose separate `api-quality` and `web-quality` jobs; image/characterization jobs require both, while browser integration remains in Web quality with disposable API services |
| Auth cookie/inactivity contract | Implemented locally | API exact-boundary tests and authenticated browser cookie attribute assertion; production-equivalent owner run remains NOT VERIFIED |
| Attachment Range characterization | Implemented locally | Synthetic image/PDF/video/text Range and retry measurement reports aggregates only; production media/network measurement remains NOT VERIFIED |
| Production deployment | Not performed | Deliberately separate from this local implementation cycle |
| Authenticated production browser | NOT VERIFIED | No approved owner session/browser evidence in this cycle; public health is reachable but exposes no release SHA, so it cannot bind TEST-001 evidence to this source |
| Backup failure notification | Closed as unconfirmed | Backup emits bounded stderr/non-zero failure; no authorized delivery channel exists, so no external hook was introduced |

## 8. Release and Recovery Contracts

- Build artifacts must come from the quality-gated external/CI builder; King
  loads immutable images and uses `--no-build`.
- Before rollout, retain a verified PostgreSQL dump and import/export/offline/
  asset storage archives. Never use `down -v`, broad image pruning or volume
  deletion.
- Operator release pointers belong in `/etc/chat-reader/release-state/`;
  verify current and direct rollback revisions with
  `deploy/verify_release_state.sh`.
- Transfer cleanup is report-only by default. The operator must explicitly
  name current and rollback artifacts and pass `--execute` after health,
  migration and browser gates.
- Production health, production-equivalent acceptance and owner-authenticated
  acceptance must be reported separately as PASS/NOT_VERIFIED/BLOCKED.
- `.cr` restore and attachment round-trip behavior is covered by temporary-root
  API fixtures; full two-environment Docker recovery remains an operator
  rehearsal, not an automated production claim.

## 9. Current Backlog

The improvement register contains 134 discovered candidates: 133 completed,
1 remaining, and 0 blocked. The remaining evidence-backed candidate is:

- `TEST-001` authenticated browser acceptance for deployed SHA;

The backlog row is the status authority. Do not promote Hypothesis, inferred,
or unavailable browser evidence to PASS without the required measurement.

## 10. Documentation Map

| Document | Purpose |
|---|---|
| `docs/index.md` | Short documentation entry point |
| `docs/system/BACKEND_AND_API.md` | API/data-boundary contracts |
| `docs/system/FRONTEND_ARCHITECTURE.md` | Shell, Reader and client boundaries |
| `docs/system/USER_FLOWS.md` | Durable user flow contracts |
| `docs/system/ADAPTIVE_IMPORT_CONTRACT.md` | Import classification and Rescue |
| `docs/system/RETENTION_CONTRACT.md` | Task/offline/artifact retention |
| `docs/system/DEPLOYMENT_AND_ENVIRONMENT.md` | Runtime and release operations |
| `docs/system/CONTINUOUS_IMPROVEMENT_BACKLOG.md` | Candidate evidence register |
| `docs/troubleshooting.md` | Current failure diagnosis and recovery |
| `docs/archive/PROJECT_STATE-history-2026-09-01.md` | Pre-compression historical snapshot |

## 11. Next Best Tasks

1. Obtain owner-authenticated browser access against the deployed SHA for
   `TEST-001`; keep unavailable production UI evidence `NOT_VERIFIED`.
2. When the user explicitly requests deployment, run the documented release
   gates, preserve current/rollback state, and perform post-deploy checks.

## 12. Do Not Assume

- A green API/unit/build gate is not production UI acceptance.
- The local PWA suite is not PASS while its Service Worker/CSP environment
  times out.
- OFF-010 375px offline acceptance passed locally on Chromium 1234 with
  `APP_ENV=test`: Library readiness, seeded Reader content, TOC Section 20
  navigation, and offline file access all passed. The test is explicitly gated
  to the fixture shell because the normal authenticated PWA environment cannot
  seed this disposable data; owner-authenticated/production browser evidence
  remains `NOT_VERIFIED`.
- The public `https://chat.king.2bd.net/api/health` probe returned HTTP 200 on
  2026-09-01, but only reported the service stage and no release SHA. Health
  reachability is therefore not evidence for `TEST-001`. `origin/master`
  currently resolves to the same local HEAD, but that still does not prove the
  running service was built from it.
- The operator-provided Chromium executable was validated with
  `scripts/verify-chromium.mjs` (Chrome-compatible file version 151.0.7922.34).
- `block_index` alone is an attachment identity; occurrence/version fields are
  required for precise navigation.
- DOM text matching is not a locator authority.
- A `.cr` archive is an Adaptive Import document, or an Archived conversation.
- Current dirty-worktree changes belong to one author or one release; inspect
  before modifying and never reset/clean/stash them.
- Deployment has happened in this cycle; it has not.
