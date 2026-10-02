# Project State

## Settings completion status (2026-10-02, not deployed)

Stages 1–4 and 6–8 are complete. Stage 5 (personal/system Skill version editing)
remains paused by the user. Source `ad223cd4bcbbad7a4ff0c5ea5f33ed2846f3a3ca`
is pushed to master; [CI 36955004824](https://github.com/foolkking/chat-reader/actions/runs/36955004824)
passes API, Web, settings, image creation and independent artifact inspection.
Production has not been changed. Later closeout changes update documentation only.

- Personal settings include owner-scoped My shares, additive personal archive
  restore with preview and durable receipts, and password-checked email changes
  that preserve account UUID and revoke other sessions. Share controls prioritize
  copy/edit, opt-in batch actions and grouped content/access/appearance editing.
- System `.cr v5` archives restore identities, ownership and held configuration
  into an empty instance. Old v4 archives require explicit ownership mapping;
  existing v5 and conversation archives remain readable. Both restore flows
  use the worker, expiring private sources, preflight and failure recovery.
- Administration supports paginated account/invitation/audit management, audited
  complete-turn content viewing and background account deletion. Deletion keeps
  other accounts' shared resources and fences late personal writes; failed file
  cleanup remains separately retryable. Invitations are consumed once.
- Help offers manual whitelist-only diagnostics and actual account/offline
  capability status. Root runtime exposes bounded worker/queue/storage/backup/
  mail state, with unavailable/stale results and visibility-aware polling.
- Import controls follow account language and preserve unsaved mappings on
  cancellation/failure. Busy operations guard edits/closing. Concurrent default
  Inbox creation preserves callers' outer transactions through a savepoint.

Current Alembic head: **`20261002_0042`**. Dexie v2, offline package v3 and
v1/v2/v3 package readers remain unchanged. No new Skill version editing,
self-deletion, reminders, quotas, recycle bin or scheduled backups were added.

Current contracts: [Administration](docs/system/ADMINISTRATION_CONTRACT.md),
[Archives](docs/system/DATA_ARCHIVE_CONTRACT.md),
[Authentication](docs/system/AUTHENTICATION_CONTRACT.md),
[Offline/sync](docs/system/PWA_OFFLINE_RESILIENCE_CONTRACT.md),
[Import](docs/system/ADAPTIVE_IMPORT_CONTRACT.md), and
[Diagnostics/runtime](docs/system/OBSERVABILITY_CONTRACT.md).
The [dated execution log](docs/execution/SETTINGS_COMPLETION_2026-09-30.md)
records individual runs, failures, skips and follow-up evidence. Latest complete
API: **736 passed / 4 skipped** locally and **737 passed / 3 skipped** in CI,
with PostgreSQL integration enabled. Latest CI settings: **111 passed / 0
skipped**, plus **1 passed** for system archive recovery in a fresh instance.
Final CI default PWA: **133 passed / 203 mode-specific skips**; authentication:
**18 passed**; offline negative: **17 passed**. All twelve Web gates and both
settings gates report PASS; optional external-fixture skips are recorded
separately. Fast-Escape draft guards propagate before the next keyboard event.
Offline search caches actual compiled worker resources and serves their entries
inside the existing `/library` scope. HTTP-cache-free cold search and failure/
retry pass in CI. Playwright uses its pinned full Chromium to avoid the separate
headless-shell's native teardown crash. Local offline/CSP/negative tests pass
**32 / 0 skipped**, with **4 / 0 skipped** for download/identity recovery and a
complete **133 passed / 203 skipped** default PWA run. These suites overlap.

## Settings stages 1–4 checkpoint (2026-10-01, not deployed)

The approved settings/user/admin/offline plan remains active. Stages one through
four are implemented and verified locally and in GitHub CI.
The user paused stage five (personal/system Skill version editing):
continue directly with stages six, seven and eight after this checkpoint.
Production remains on the separately recorded deployed revision below.
Dated scope and evidence: `docs/planning/SETTINGS_COMPLETION_2026-09-30.md` and
`docs/execution/SETTINGS_COMPLETION_2026-09-30.md`.

- Account capabilities align personal settings with effective policy limits.
  Approval and email verification are independent; omitted policy fields are
  preserved. Email confirmation is an explicit POST with a purpose-bound,
  expiring one-use grant. SMTP is required to demand verification. See
  `docs/system/AUTHENTICATION_CONTRACT.md`.
- Learned formats and explicitly learned noise rules have revision-scoped
  account grants, equivalent-identity aliases and separate system publication.
  Withdrawal or source-account deletion preserves acquired versions. Personal
  controls cannot change global publication. Format health uses full-family
  validation. See `docs/system/ADAPTIVE_IMPORT_CONTRACT.md` and
  `docs/system/CONTENT_CLEANUP_CONTRACT.md`.
- Noise review defaults to KEEP, protects source syntax, persists cross-page
  selection, previews complete changes and rejects stale source revisions.
  Exceptions and learning require explicit confirmation; applied batches have
  durable markers and leases. Reader, search and export use new canonical
  message versions after an acknowledged apply.
- Settings and Library share the offline/sync center. Downloads retain durable
  job association, verify attachment tiers and preserve old copies on failure.
  Annotation/notebook outboxes, drafts and conflicts survive reload and newer
  edits. Account preferences use per-field server revisions; reading positions
  use durable idempotent operations and real anchors. Remote progress never
  scrolls the active Reader without an explicit choice.
- Expiry locks and retains account data; only the same verified UUID can reopen
  it. Signout and copy cleanup review pending changes, support a readable ZIP
  recovery export and recheck the snapshot. Failed physical signout cleanup
  stays locked and retryable; completion tokens protect new downloads from
  stale tabs. See `docs/system/PWA_OFFLINE_RESILIENCE_CONTRACT.md`.

At this stage-four checkpoint the Alembic head was `20261001_0040`. Existing Dexie v2 and offline package
v3 remain; v1/v2/v3 readers stay compatible. Migration/deployment boundaries are
in `docs/system/DEPLOYMENT_AND_ENVIRONMENT.md`.

Local evidence includes 42 real stage-four browser cases plus 13 authentication
fault contracts, 3 real auth/Share cases, full API **569 passed / 26 skipped**,
stage-four PostgreSQL **12 passed**, PWA negative **17 passed**, and long
Reader/Share **11 passed**. These suites overlap; counts are not additive. The
full default PWA rerun passes **132 / 169 mode-specific skips**. Lint, typecheck,
normal authenticated build and single migration head pass; detailed results are
recorded in the execution log.
`docs/testing.md` owns the required authenticated settings CI job and explicit
PostgreSQL integration gate. Pushing/building artifacts does not deploy them.

Checkpoint `0aef140` is pushed to master. Initial CI `36837780428` exposed a
new Next audit advisory, missing PostgreSQL fixture secret, obsolete appearance
setup and bundled-Chromium recovery races. The replacement locks Next `16.3.6`
and DOMPurify `3.4.16` (official audit: zero advisories), uses account appearance
fixtures and retains lock state on session transport failure. Replacement source
`7d24ce2362cc39f16a291265b3d6a74bf3f23bcc` is pushed to master; CI
[`36844395975`](https://github.com/foolkking/chat-reader/actions/runs/36844395975)
passed API, Web, settings, image creation and independent artifact inspection.
CI results include API **592 passed / 3 skipped**, settings **79 passed / 0
skipped**, default PWA **132 passed / 170 mode-specific skips**, authentication
**18 passed**, and PWA negative **17 passed**. The final local settings plus
authentication-recovery run passed **93 / 0 skipped** (79 real settings flows
and 14 fault contracts, counted separately). Skips are not passes; overlapping
suites are not additive. This is the stage-four GitHub checkpoint, not completion
of the full plan. Later stages are summarized in the current status above; stage five remains paused. Production is
unchanged and no deployment was performed.

## Deployed authentication recovery (2026-09-30)

The post-login private boundary no longer leaves session/network/storage
failures indefinitely at "Checking trusted device". Auth requests have a
10-second timeout, initialization a 15-second deadline, and recoverable error
states. Online login does not require opening IndexedDB. Abandoned checks,
cross-tab logout, offline expiry and legacy-account storage ownership are
guarded; the service worker starts after private initialization.

API authentication database I/O runs off the ASGI event loop. Password-change
cookie deletion is no longer overwritten by sliding renewal. Invalid email,
orphaned principal, session-list expiry and password-reset policy handling have
regression coverage. The CI auth gate now provisions the email required to
actually run its browser tests. No new migration is required. Details and test ownership are in
`docs/system/AUTHENTICATION_CONTRACT.md`.

Verification: full API suite **494 passed / 6 fixture/environment skips**;
authentication/recovery Web contracts **22 passed**; real PostgreSQL-backed
login, logout, Share and password-change browser tests **4 passed**; targeted
PWA account isolation, v1 package readability, transaction rollback, reload and
reconnect regressions **5 passed**. Web lint/typecheck/build and Alembic single
head `20260927_0033` pass. Browser failure screens were checked at 375px and
1440px. These are local synthetic-fixture results.

Production now runs source `5877558070311d1728974198f37a4500d25233b1` from
Actions run `36669226287`. CI passed API **497 / 3 skips**, authentication
browser **16**, default PWA **132 / 89 mode-specific skips**, and PWA negative
**17**, together with the other browser, build and independent artifact gates.
The release also patches the brace-expansion audit findings; the official npm
audit reports zero advisories.

Backup `/opt/chat-reader/backups/chat-reader-20260930T053642Z` passed all five
component checks. API/worker writes were briefly stopped for a consistent
backup after the live copy detected changing storage. Only API, worker and Web
were replaced; PostgreSQL identity/start time and `.env.production` were
unchanged. Runtime health, worker heartbeat, HTTPS, anonymous private-route 401,
attachment integrity and Alembic `20260927_0033` passed. The operator confirmed
successful login and library entry after Ctrl+F5. The full agent-driven
authenticated desktop/mobile/logout checklist remains separately unverified.

At the operator's request, the previous four application image tags and unused
layers were removed after verification, releasing about **263 MiB**. Including
the consumed image transfer archive, cleanup reclaimed about **446 MiB**; root
has about **12.3 GiB** available after retaining the new backup. Current images,
all backups, business volumes and server configuration remain. Release state
reports `rollback_revision=none`; deployment details are in `docs/deployment.md`.

## 0B. Deployed merge capacity and source-preview synchronization (2026-09-27)

This release fixes the production-observed Conversation Merge failure
where final attachment-integrity validation expanded every copied RenderBlock
ID into one PostgreSQL `IN` query and exceeded the protocol's 65,535 bind
parameter ceiling after all messages had been processed. Target validation is
now version-batched and checks the same version, occurrence, block and
Attachment invariants without an unbounded parameter list.

Migration `20260927_0033` adds the root-admin controlled
`maximum_merge_message_count` instance policy. The default is 1,000 active
messages across the selected conversations; merge admission counts canonical
non-deleted Message rows and rejects an oversized request with HTTP 422 before
queuing work. This is an application capacity guard, not an attempt to change
PostgreSQL's protocol limit. The control is shown only in the existing Admin
"Features & defaults" settings surface.

Markdown Source Preview now preserves mdast source offsets on rendered
semantic blocks. CodeMirror remains the scroll authority: its top visible
source position selects the smallest containing preview block and interpolates
within that block, so headings, lists, tables and code no longer drift as the
source editor scrolls. Preview scrolling is one-way and does not move the
source editor or add another visible control.

Production runs source `97146a69233b22da1caf250adac380e3802d764f`
from Actions run `36299691874`. API/worker digest is
`sha256:f53face550496986b2fdf6660298096c3bd3adda94f1775af20cd946bfa3a4d9`;
Web is `sha256:6f5afdd734ac3eb90c8ff32cd488024eff06c75b31b47db89fe5df0160580883`.
The full CI API/Web/PWA/browser matrix and independent artifact inspection
passed. Production health, worker heartbeat, HTTPS entry, anonymous admin
boundary and Alembic `20260927_0033` passed; PostgreSQL was not restarted.
The verified five-component backup is
`/opt/chat-reader/backups/chat-reader-20260927T064519Z`.

At the operator's direction no previous application image generation is
retained. Release state reports `rollback_revision=none`; the `2e7e7577` and
`027a148b` image sets, stale unversioned API image and superseded transfer were
removed after final verification. Only the current four Chat Reader tags
remain. Database backups, named volumes, user storage and `.env.production`
were not removed or replaced. Authenticated interactive Web acceptance remains
an operator verification step.

## 0A. Deployed split Markdown command surfaces (2026-09-26)

The current production deployment is source
`2e7e7577b9b6b44e392fed6c00800470ee0a90b4` from Actions run `36242345790`.
API/worker digest is `sha256:a2dd5439a8ce10c08dc85b95be6da165924d3e5087eaf477c23d709bb715aa5a`
and Web digest is `sha256:f5ad3416b4fbb6d868e84d57f1a637824aa8e09c3eac890da5df4e7fb72c70d0`.
The verified backup is `/opt/chat-reader/backups/chat-reader-20260926T130202Z`;
current/rollback release pointers are `2e7e7577` and `027a148b`. Runtime
health, HTTPS entry, worker heartbeat and Alembic `20260902_0032` passed.
The archive and failed-preflight temporary API image were removed; volumes,
PostgreSQL and `.env.production` were preserved.

The production release includes a bounded source-editor attachment tray so a
large set of pending files scrolls inside the tray instead of expanding the
footer indefinitely. Selection-only Markdown formatting remains in the compact
contextual toolbar anchored to the active CodeMirror selection. The header
magic-wand action and Ctrl+Alt+C now open a separate caret-oriented command
surface for commands that can insert useful Markdown without a selection. The
two surfaces share commands only where both selection wrapping and paired-caret
insertion are meaningful, avoid a nested overflow menu, and keep Chinese labels
in tooltips rather than inside the icon grid.

Attachment uploads are now configured for a 1 GiB per-file limit while Import
and Adaptive Import remain at their existing 500 MiB contracts. Browser
preview is capped at 50 MiB for previewable attachment types; larger files
remain downloadable. These changes are deployed. Authenticated interactive
Web acceptance remains an operator verification step.

The immutable release is deployed and production-verified from source
`027a148b509a4503a45e3d21036ad2edf72c5389` (GitHub Actions run
`36226227092`). API/worker image digest is
`sha256:56c7a2d6172ac5a21ca28a04e76cfecc04fd72b597535f0135ec20984326133c`;
Web is `sha256:de261f62dcfd64c5c4be7b92146f816cbb15dd0d9eb9c086f614ff0adb3afcf4`.
Production health, worker heartbeat, HTTPS entry and Alembic head
`20260902_0032` passed after rollout. PostgreSQL was not restarted. The
verified backup is `/opt/chat-reader/backups/chat-reader-20260926T102225Z`.

The release state records `027a148b` as current. At the operator's request the
superseded `3312f11` image set and stale rollback pointer were removed after
verification; recovery now uses the verified five-component backups. The
retained recovery set is the current `20260926T102225Z` backup, the immediately
preceding `20260926T055815Z` backup and the Root Admin baseline
`20260902T014223Z`, all independently verified before cleanup.

Cleanup removed 16 redundant historical backups, obsolete transfer archives,
unused BuildKit/base images, four inactive VS Code Server versions and archived
systemd journal beyond a 256 MiB bound. It did not remove named volumes,
PostgreSQL data, user files, `.env.production` or the three retained backups.
The loaded release archive was removed after verification while its manifest
and inspection report were retained. Root filesystem free space increased from
about 3.3 GiB to 18 GiB. Releasing page cache raised free physical memory from
about 79 MiB to 210 MiB; active services and swap were not forcibly restarted.

Attachment uploads use the explicit production 1 GiB limit and attachment-only
1040 MiB Nginx route; Import and Adaptive Import remain 500 MiB with 520 MiB
routes. Browser preview remains capped at 50 MiB. Authenticated 1 GiB browser
acceptance remains an operator verification step.

Last updated: 2026-09-27

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
| Database | PostgreSQL with Alembic; repository head `20261002_0042`; deployed head `20260927_0033` |
| Branch / baseline | `master`; deployed source SHA `97146a69233b22da1caf250adac380e3802d764f` |
| Deployment | Production runs immutable `97146a69233b22da1caf250adac380e3802d764f`; no previous application image generation is retained |
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

- Markdown source formatting is split into a compact selection toolbar and an
  explicit one-row command surface. Duplicate attachment/image/footnote/format
  actions were removed from the command surface, undo/redo live in the source
  header, and a math-block command covers technical authoring. CodeMirror's
  active-line layer no longer hides the first row of a multi-line selection.
- TOC, Attachment, Annotation and Markdown-source navigation now construct
  `NavigateTarget` through one front-end registry. Source positions are mapped
  from raw Markdown code-point offsets to stable render-block identity and
  block-local canonical offsets before Reader resolution; Reader-to-source
  mapping uses the same adapter in reverse.
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
| `corepack pnpm run test:api` | API suite | PASS locally: 483 passed, 6 skipped; release workflow also PASS |
| `corepack pnpm --filter web test:pwa` | PWA/browser suite | PASS in release workflow `36299691874`; local isolated source-preview/Markdown contracts also PASS |
| `cd apps/api; python -m alembic heads` | Migration head | `20260927_0033 (head)` in the repository and production |
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
| Production deployment | Implemented and deployed | CI-gated release `97146a6` is live; Alembic `20260927_0033` is current; no previous application image generation is retained by operator policy |
| Authenticated production browser | NOT VERIFIED | No approved owner session/browser evidence in this cycle; public health is reachable but exposes no release SHA, so it cannot bind TEST-001 evidence to this source |
| Backup failure notification | Closed as unconfirmed | Backup emits bounded stderr/non-zero failure; no authorized delivery channel exists, so no external hook was introduced |

## 8. Release and Recovery Contracts

- Build artifacts must come from the quality-gated external/CI builder; King
  loads immutable images and uses `--no-build`.
- Before rollout, retain a verified PostgreSQL dump and import/export/offline/
  asset storage archives. Never use `down -v`, broad image pruning or volume
  deletion.
- Operator release pointers belong in `/etc/chat-reader/release-state/`;
  verify the required current revision and optional direct rollback revision
  with `deploy/verify_release_state.sh`.
- Transfer cleanup is report-only by default. The operator must explicitly
  name retained artifacts and pass `--execute` after health, migration and
  browser gates.
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
2. Keep the deployed release pointer and any intentionally retained rollback
   pointer under the operator release-state directory; run the documented
   gates before the next rollout.

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
