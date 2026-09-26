# Project State

## 0A. Deployed editor, attachment preview and reader performance release (2026-09-26)

The current working tree adds a bounded source-editor attachment tray so a
large set of pending files scrolls inside the tray instead of expanding the
footer indefinitely. The editor now uses an icon-only contextual Markdown
toolbar anchored to the active CodeMirror selection or explicitly requested
caret through Ctrl+Alt+C, plus an overlay live preview that does not shrink the
source editor and canonical-text handoff after save. Reader virtualized
blocks temporarily increase overscan during high-speed scrolling.

Attachment uploads are now configured for a 1 GiB per-file limit while Import
and Adaptive Import remain at their existing 500 MiB contracts. Browser
preview is capped at 50 MiB for previewable attachment types; larger files
remain downloadable. These changes are in the working tree and are not yet
deployed or production-verified.

The immutable release is deployed and production-verified from source
`094abf43aca1195377053a717603a5d3099ba30e` (GitHub Actions run
`36167970048`). The verified archive SHA-256 is
`a430b889d45592a52a630c30884b9a5a86e82c032c4987cf5daa991b2c8a66b0`.
API/worker image digest is
`sha256:b200ac80339200e9ada373e899b21450540af8c72d8891c367748d8946b95446`;
Web is `sha256:7d14c7364cc808a389a2fb3f647ec154cfe47a441881e95d96dfd66cc7495104`.
Production health, worker heartbeat, HTTPS entry and Alembic head
`20260902_0032` passed after rollout. PostgreSQL was not restarted. The
verified backup is `/opt/chat-reader/backups/chat-reader-20260925T180542Z`.

Attachment uploads use the explicit production 1 GiB limit and attachment-only
1040 MiB Nginx route; Import and Adaptive Import remain 500 MiB with 520 MiB
routes. Browser preview remains capped at 50 MiB. Authenticated 1 GiB browser
acceptance remains an operator verification step.

Last updated: 2026-09-26

## 0. Upload failure diagnosis and attachment limit update (2026-09-24)

Production evidence for a roughly 33 MiB attachment showed that the multipart
request reached 100%, then spent about 30 seconds in the attachment item route
before the reverse proxy returned 500. Nginx reported normal request-body
buffering and its Chat Reader server block still had a 60 MiB default body cap;
there was no 413, disk-full error, or kernel OOM event for the 33 MiB request.
Host memory was pressured (270 MiB available at the latest check). Attachment
staging incorrectly shared the import parser semaphore, but production probing
after that fix exposed the remaining decisive boundary: Next.js buffered only
the first 10 MiB of the same-origin rewrite request and then reset the API
connection. The final contract gives disk staging an independent nonblocking
slot and routes only the three large-upload endpoints from Nginx directly to a
loopback-only FastAPI port, bypassing Next's in-memory request clone.
All user upload entry points now use a 500 MiB cap with 520 MiB exact Nginx
allowances. Heavy import parsing still passes the memory-aware admission gate
and returns a retryable 429 when the small production host cannot safely
materialize the request. This update is deployed from immutable source
`b3039300c3df1001b5afe92d0849fe9fc9addeae`. The direct-upload gateway is part
of that immutable release rather than a server-only hotfix.

The server was cleaned without touching PostgreSQL, named volumes, import
storage, the active image, or the direct rollback image. Stale Chat Reader
images and build cache were removed after an explicit inventory. After the new
verified five-component backup and post-release cleanup, root free space is
3.6 GiB (91%). Current production health is OK and it runs immutable source
`b3039300c3df1001b5afe92d0849fe9fc9addeae`. The independent staging slot,
500 MiB limits and Nginx-to-loopback-API streaming routes are active in
production. CI run `36087943707` passed API/Web quality, browser/PWA gates,
image inspection and independent artifact inspection. A 65 MiB anonymous
gateway probe reached FastAPI without any Next.js body-limit, proxy-reset or
socket error; authenticated upload acceptance remains `NOT VERIFIED`. The
verified pre-deploy backup is
`/opt/chat-reader/backups/chat-reader-20260925T020553Z`; the direct rollback
generation is `050f257ceb702490885bae8aabcbf5a1ce60ba84`.

## 1. Project Snapshot

| Field | Current state |
|---|---|
| Project type | Web/API/worker monorepo for a private multi-account conversation archive |
| Primary languages | TypeScript/React/Next.js, Python/FastAPI, SQL/Alembic |
| Package manager | pnpm via Corepack; Python dependencies in `apps/api/pyproject.toml` |
| Main entry points | `apps/web`, `apps/api`, `docker-compose.production.yml` |
| Database | PostgreSQL with Alembic; working-tree head `20260902_0032` |
| Branch / baseline | `master`; deployed source SHA `094abf43aca1195377053a717603a5d3099ba30e` |
| Deployment | Production runs immutable `094abf43aca1195377053a717603a5d3099ba30e`; `b303930` remains the direct rollback generation |
| Docs status | `docs/system/` is authoritative; dated execution/release notes are historical |

## Current working-tree implementation (2026-09-22)

### Latest production deployment

The release workflow `35703956105` passed API/Web quality, dependency audit,
focused browser/security, PWA, authentication, image build and independent
artifact inspection. Production loaded the exact artifact for source
`1b81b49609f1b955c8d85ec426e898938dcfc90a`; API/worker image digest is
`sha256:10bb6145e2a884a8a63680d4e8d639f540c3d0b75841a273d5e91b284a611997`
and Web is
`sha256:9a0b67ef0d05ae42353f55d18739c7ad0b54ec2a8a39453d6f106ab68d40258c`.
The five-component backup `chat-reader-20260922T084555Z` passed checksum and
archive verification. Attachment storage audit was read-only and clean
(279 active attachments, 223 asset objects, zero issues). PostgreSQL was not
restarted; its container identity and start time were unchanged. Alembic is
`20260902_0032 (head)`, application health and worker heartbeat are healthy,
HTTPS health is 200, port 80 redirects to HTTPS, and anonymous private access
is 401. Authenticated production UI acceptance remains `NOT VERIFIED`; the
operator will perform that browser check.

Deployment did not change `.env.production`, production volumes, imported
conversation data or scanner policy. The release transfer archive remains in
the versioned release directory until the operator-approved retention cleanup.

This change set starts from source SHA `6edc25e4b75479b12d28ba1a7c17e16fd1f6e4f7`
on `master`. Existing dirty files were preserved; the pre-existing
`apps/web/tsconfig.tsbuildinfo` change remains untouched. Deployment status is
established by the immutable runtime image revision and release evidence, not
by this source snapshot alone.

Implemented in the working tree:

- Tablet Reader navigation now uses one focus-managed dialogue/section drawer,
  with explicit loading/error/empty states and stable message/version/block
  locator data.
- Version selection/deletion returns the canonical mutation immediately and
  queues idempotent derived search/TOC refresh work; the Web panel updates its
  local history without waiting for a full refetch.
- User uploads default to 500 MiB per file. Imports and attachment staging use
  bounded reads; uploads above 10 MiB are admitted through a single-slot,
  memory-aware in-process admission gate with explicit retryable 429 states.
  This is not a durable upload queue and does not provide re-entry or a queue
  position. Adaptive batches keep their 512 MiB aggregate limit.
- Import completion queues a linked noise-review task. Task Center shows the
  noise task/scan relationship and invalidates sidebar, project, Reader, TOC,
  search and Offline caches after merge completion. A Reader opened on an
  absorbed conversation receives a target-conversation recovery action.

Verification for this working tree: Web lint, typecheck, production build,
Alembic single-head check and whitespace check pass. Tablet/task refresh
contracts pass 5/5, focused upload/version/task tests pass 28/28, and the exact
full API suite passes 477 with 6 environment/fixture skips. Full authenticated
PWA acceptance is not verified in this environment because the Playwright
server had no API at
`127.0.0.1:8000`; local authenticated acceptance remains not verified. The
release has since been deployed through the CI artifact workflow documented
above.

The release candidate uses Next `16.3.3`, Sharp `0.35.4` and js-yaml `4.3.2`.
The official npm audit policy reports zero advisories and no exceptions.

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
| `corepack pnpm run lint` | Web lint | PASS in this implementation cycle |
| `corepack pnpm run typecheck` | Web typecheck | PASS in this implementation cycle |
| `corepack pnpm --filter web build` | Production Web build | PASS in this implementation cycle |
| `corepack pnpm run test:api` | API suite | PASS 477 passed, 6 skipped in this implementation cycle |
| `corepack pnpm --filter web test:pwa` | PWA/browser suite | Full authenticated suite NOT VERIFIED locally because no API was listening at `127.0.0.1:8000`; tablet/task source-contract tests PASS 5/5 |
| `cd apps/api; python -m alembic heads` | Migration head | `20260902_0032 (head)` in the working tree and production |
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

Implementation status is `implemented / automated-tested / deployed`; authenticated
production browser acceptance remains `NOT VERIFIED` for the operator's own Web
verification.

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
| Deployment admin reconciliation | Implemented and deployed | Production `migrate` consumes the server `.env.production` `ADMIN_EMAIL`/`ADMIN_PASSWORD` pair; only a changed pair is applied, while the database stores a derived digest and Argon2id hash rather than plaintext |
| Attachment Range characterization | Implemented and deployed | Synthetic image/PDF/video/text Range and retry measurement reports aggregates only; production media/network measurement remains NOT VERIFIED |
| Production deployment | Implemented and deployed | CI-gated release `1b81b496` is live; Alembic `20260902_0032` is current; previous `7101f6a` remains the rollback image |
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

### Root administrator deployment identity

The production administrator is the single immutable Root Admin. Its deployment
identity is configured only on the server in `/opt/chat-reader/.env.production`
using `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The migration command consumes that
pair during deployment; unchanged values do not overwrite a password changed in
the Web UI. To intentionally change the deployment identity, update both values
together in the server environment and rerun the normal immutable-image
migration/deployment sequence. Credentials are never written to Git, logs,
documentation, image labels or release manifests.

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
