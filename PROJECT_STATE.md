# Project State

Last updated: 2026-09-02

## 1. Project Snapshot

| Field | Current state |
|---|---|
| Project type | Web/API/worker monorepo for a private multi-account conversation archive |
| Primary languages | TypeScript/React/Next.js, Python/FastAPI, SQL/Alembic |
| Package manager | pnpm via Corepack; Python dependencies in `apps/api/pyproject.toml` |
| Main entry points | `apps/web`, `apps/api`, `docker-compose.production.yml` |
| Database | PostgreSQL with Alembic; working-tree head `20260902_0032` |
| Branch / baseline | `master`; starting source SHA `93751e52dc7089d0ccd51e6f6cf9cedb1f341fe1`; multi-account release is committed and pending deployment |
| Deployment | Existing production release remains `ba287e1`; administrator upgrade is committed locally and pending second deployment |
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
| `apps/api/app/api/routes/admin_access.py` | Root-only user lifecycle, registration and invitation controls |
| `apps/api/app/api/routes/admin_content.py` | Root-only cross-user content search, Reader and attachment access with audit |
| `apps/api/app/api/routes/admin_system.py` | Root-only feature policy, system Skill, backup and audit controls |
| `apps/web/features/import/adaptive-import-workspace.tsx` | Adaptive Import, Rescue and terminal result scope |
| `docs/system/CONTINUOUS_IMPROVEMENT_BACKLOG.md` | Candidate register and evidence-backed status |
| `docs/system/DEPLOYMENT_AND_ENVIRONMENT.md` | Deployment, verification and recovery boundaries |

## 5. Known Working Commands

| Command | Purpose | Current evidence |
|---|---|---|
| `corepack pnpm run lint` | Web lint | PASS 2026-09-01 |
| `corepack pnpm run typecheck` | Web typecheck | PASS 2026-09-01 |
| `corepack pnpm --filter web build` | Production Web build | PASS in this implementation cycle |
| `corepack pnpm run test:api` | API suite | PASS 471 passed, 6 skipped on 2026-09-02 |
| `corepack pnpm --filter web test:pwa` | PWA/browser suite | Full suite NOT VERIFIED locally; Service Worker/online startup timeouts and a CSP resource failure occurred. Targeted OFF-010 375px fixture run passed with Chromium 1234 + `APP_ENV=test` |
| `cd apps/api; python -m alembic heads` | Migration head | `20260901_0031 (head)` in the working tree |
| `git diff --check` | Patch whitespace | PASS |
| `corepack pnpm run ci:changed-area` | Changed-area local check suggestions | PASS; always retains full gate |
| `python deploy/cleanup_release_transfer.py ...` | Bounded transfer cleanup | Dry-run/execute temporary-directory smoke PASS |
| `sh deploy/verify_release_state.sh <state-dir>` | Current/rollback pointer check | Temporary-directory smoke PASS |
| `corepack pnpm run test:ci-tools` | Local CI helper tests | PASS 2026-09-01 |

## 6. Architecture Summary

### Current account boundary (working tree, 2026-09-01)

- The legacy `owner` principal is promoted to the single `ADMIN` account by
  migration `20260901_0030`; new registrations are `USER` accounts.
- Private rows are scoped by the server-authenticated `User.id` on
  conversations, projects, imports, jobs and learned profiles. Client-supplied
  owner or subject fields are ignored.
- Sessions remain opaque HttpOnly cookies with a 48-hour sliding inactivity
  limit. Registration supports `CLOSED`, `INVITE_ONLY` and `OPEN`; Share stays
  token-scoped and separate from owner authentication.
- User preferences, skills, annotations, reading positions and offline package
  metadata use the authenticated UUID subject. The migration backfills the
  legacy `local:default` subject to the migrated administrator UUID.
- The operator provisions the one administrator through the interactive
  `python -m scripts.owner_auth provision --email <admin-email>` command. The
  password is entered interactively, must satisfy the existing strength policy,
  and is never stored in repository files.

The deployment-managed administrator is the immutable Root Admin identified by
`ROOT_ADMIN_USER_ID`. Its email and password are provisioned from the server
`.env.production` pair `ADMIN_EMAIL` / `ADMIN_PASSWORD`; a changed pair is
applied by the next migration run, while a Web password change remains
authoritative until that pair is intentionally changed. Root-only administration
covers users and approvals, registration/invitations, audited cross-user
conversation and attachment access, feature policies, system Skill overrides,
application data archives and security audit events. Normal owner APIs remain
owner-scoped, and Share/Offline do not inherit Root Admin access.

User deletion is an audited background task. Shared `AssetObject` rows are
retained; exclusive physical files are removed only after the database deletion
commits. System backup is the existing application `.cr` archive: it excludes
secrets, environment and logs, restores only into an empty instance, and is not
a PostgreSQL or host-volume snapshot.

Implementation status is `implemented in working tree / automated-tested /
deployment pending`; authenticated production browser acceptance and a real
PostgreSQL migration run remain `NOT VERIFIED`.

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
- `.cr` restore, Share and Offline remain separate boundaries. This working
  tree adds only the account/ownership migration `20260901_0030`; no worker or
  domain-model rewrite is included.

## 7. Implementation Status

| Area | Status | Notes |
|---|---|---|
| Settings ownership | Implemented and deployed | Hub categories, focused consequential actions, dirty dismissal protection |
| Global Tasks | Implemented and deployed | Stable owner, re-entry, dismissal vs cancellation, truthful results |
| Adaptive Import/Rescue | Implemented and deployed | SUPPORTED/MAPPABLE/NOT_MAPPABLE and static bilingual Rescue Skills |
| Attachment merge integrity | Implemented and deployed | Multi-occurrence mapping, canonical field rebuild, fail-closed checks and repair audit |
| Reader locator | Implemented and deployed | Owner, Share and Offline resolver paths; focused API/browser contracts pass |
| Sidebar/project DnD | Implemented and deployed | Custom project order, source-sized overlays and row state feedback |
| Offline resilience | Implemented and deployed | Bounded atomic import, quota/malformed/count validation and retry surface |
| Release evidence | Implemented and deployed | Explicit cache evidence, artifact inspection, health/rollback/HTTPS checks |
| CI quality ownership | Implemented and deployed | Release and performance workflows expose separate `api-quality` and `web-quality` jobs; image/characterization jobs require both, while browser integration remains in Web quality with disposable API services |
| Auth cookie/inactivity contract | Implemented in working tree | API exact-boundary tests and authenticated browser cookie attribute assertion; production-equivalent owner run remains NOT VERIFIED |
| Deployment admin reconciliation | Implemented in working tree | Production `migrate` consumes `ADMIN_EMAIL`/`ADMIN_PASSWORD`; only a changed pair is applied, while the database stores a derived digest and Argon2id hash rather than plaintext. Deployment remains pending |
| Attachment Range characterization | Implemented and deployed | Synthetic image/PDF/video/text Range and retry measurement reports aggregates only; production media/network measurement remains NOT VERIFIED |
| Production deployment | Existing release only | Production remains on `93751e5` / Alembic `20260829_0029`; account migrations `20260901_0030` and `20260901_0031` are not deployed |
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
2. Keep the deployed release and direct rollback pointers under the operator
   release-state directory; run the documented gates before the next rollout.

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
  2026-09-01 and the production containers report the exact deployed image
  revisions for `93751e5`; this still does not prove `TEST-001` because no
  approved owner-authenticated browser session was used.
- The operator-provided Chromium executable was validated with
  `scripts/verify-chromium.mjs` (Chrome-compatible file version 151.0.7922.34).
- `block_index` alone is an attachment identity; occurrence/version fields are
  required for precise navigation.
- DOM text matching is not a locator authority.
- A `.cr` archive is an Adaptive Import document, or an Archived conversation.
- Current dirty-worktree changes belong to one author or one release; inspect
  before modifying and never reset/clean/stash them.
- The 2026-09-01 CSS-only release has been deployed; authenticated owner UI
  acceptance remains `NOT VERIFIED`.

## 13. Knowledge and workspace closeout (2026-09-01)

- Reconciled the current deployment facts in this file,
  `docs/deployment.md`, and `docs/system/DEPLOYMENT_AND_ENVIRONMENT.md`.
- Removed generated repository artifacts: `apps/web/.next`,
  `apps/web/test-results`, `apps/api/.pytest_cache`, and the root
  `.pytest_cache`; the final Web build/test run regenerated and the closeout
  cleanup removed them again, along with API `ruff` cache, egg-info and
  26 `__pycache__` directories.
- Removed only project/tool-generated entries from the user's Windows Temp
  directory (`mdi_phase*`, Playwright temporary profiles, Chat Reader release
  artifacts/manifests/logs, and temporary deployment folders) plus two stale
  desktop `~WRL*.tmp` files. No system-wide Temp purge was performed.
- Deliberately preserved `node_modules`, `storage`, `examples`, user import
  data, environment files, production backups, and the pre-existing dirty
  `apps/web/tsconfig.tsbuildinfo` file.
- No new memory file or duplicate historical document was created. Dated
  planning, execution, evidence, and audit records remain historical.
