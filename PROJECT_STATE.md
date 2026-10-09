# Project State

Last updated: 2026-10-09. This is the current snapshot, not a release history.

## Release and active work

| Item | Verified state |
| --- | --- |
| Production | Source `30a0d321fe2d538b0fa0bbd61b3e982452f822cb`; accepted [CI 37773748374](https://github.com/foolkking/chat-reader/actions/runs/37773748374), all five gates; original artifact 11550757701 independently verified |
| Production database | Single head/current `20261008_0050`, migrated through 0049; API/Web/PostgreSQL healthy and worker `alive_idle` at acceptance |
| Data acceptance | 84 stopped-writer table fingerprints and four storage roots unchanged; 36 expected source hashes backfilled; 67 stable table counts unchanged after restart |
| Latest release CI | API **1,181 passed / 3 skipped**; all 13 Web gates pass; settings **439 passed / 0 failed / 0 skipped**, plus one passing fresh-instance restore case |
| Follow-up CI | Canonical-URL revision repair `a12ce9e287fdddfd4df8a6039a212cec04629568` passes all five jobs in [CI 37812290017](https://github.com/foolkking/chat-reader/actions/runs/37812290017); independently inspected artifact 11567238870 is **not deployed** |
| Active work | [Manual Markdown fidelity](docs/execution/ux-audit-manual-markdown-2026-10-09.md) and [bounded attachment reading](docs/execution/ux-audit-attachment-reading-2026-10-09.md), including earlier quiet-autosave/recovery batches; local checks pass, exact-source browser/CI acceptance pending |
| Authorized next release | [Attachment and recovery release](docs/execution/ATTACHMENT_READING_RELEASE_2026-10-09.md) owns the one newly authorized CI/deployment cycle; passing CI 37812290017 does not cover these changes |
| Release owner | [Accumulated optimization release](docs/execution/OPTIMIZATION_RELEASE_2026-10-08.md) owns exact commits, every failed run, artifacts and acceptance |

The user authorized this order: commit accumulated improvements, pass complete
exact-source CI, deploy those verified images to King, then continue the
ordinary-user product audit. The persistent goal remains active. At least 15
improvements was not a ceiling; over 30 scoped batches are already accumulated.
Do not repeat the previously accepted Context/Skill/Task Center deployments.
Do not use subagents unless the user newly requests them.

Latest user direction (2026-10-09): finish the current creation/insertion/editing
review, then review all attachment viewing paths, prioritizing high-value PDF
reading improvements without significant CPU/memory overhead. After implementing
and verifying that work, **one CI submission cycle and deployment after complete
exact-source CI acceptance are authorized**. Necessary fixes/retries belong to
that cycle. Do not publish before the attachment work is ready; subsequent
optimization requires a new explicit release request. This supersedes the earlier
release pause, not the deployment safety requirements. King stays at 30a0d32 until
the newly authorized release is independently accepted.

All three cache-count cases pass, including actual zero-cache, download,
cancellation and persistence assertions. The import-retry case now retains its
injected outage until the real click and also passes. Twelve new selection-state
screenshots across six cases and four import-completion/retry screenshots were
reviewed; the other two new selection cases have assertion-only evidence.
The release is accepted, including authenticated read-only smoke, exact runtime
image/source checks and backup finalization. Production configuration and
PostgreSQL were preserved. The follow-on audit is delivered before its scoped
repairs. The new Undo owner, identity-based search selection and read-state fixes
pass their 26-case mutation gate, including nine new cases, with eight reviewed
exact-source synthetic screenshots. The latest settings job passes all 439 matrix
cases and one fresh-instance restore. The canonical-URL revision repair passes
all 13 Web gates, including 18 negative PWA cases, plus API, settings, image build
and independent inspection. All nine expanded synthetic shell regressions, lint,
nonincremental typecheck and the bounded Web build also pass locally.
The newly authorized follow-up deployment is conditional on attachment-work and CI acceptance.
The [search filter audit](docs/execution/ux-audit-search-filter-race-2026-10-08.md)
records the separately reproduced and CI-verified rapid-input/history repair.

The local merge batch retains one owner/project-scoped request through uncertain
responses, offers read-only receipt checking and permits only explicit original-key
retry after a confirmed missing result. Retained failed/cancelled jobs do not
silently restart; changed payloads conflict. Confirmed admission no longer waits
for refresh to close its dialog. Page-level **Review merge request** recovery is
now independent of current selections and loading/empty/error list branches;
project 401/403/404 still hides it. Opening recovery does not automatically look
up or submit a merge; the existing account-capabilities read may still run.
The active/archive conversation lists now retain cached current-mode rows and
selection through transient read failures. Empty active lists point to Archive;
failed existence checks offer their own read-only Retry instead of claiming the
conversations are filed in projects. Archived projects now retain cached rows,
acknowledge confirmed restores before refresh and offer explicit read-only checking
for unknown outcomes. Current archived membership fences stale selection and is
rechecked after deletion confirmation; this is not an atomic server precondition.
The API already rejects deleting active projects; the client guard avoids stale
requests, not a demonstrated active-project deletion vulnerability. Sidebar
project, Unclassified and expanded-project reads now have scoped read-only retries,
retained cached links and explicit error/empty distinctions without changing DnD
placement. Project archiving now has one sidebar-owned controller across desktop
and mobile menus, acknowledgement before refresh, explicit read-only unknown-result
checks and current-scope confirmation guards. Active project caches exclude confirmed
archives; state survives menu/drawer closure, not full owner unmount/navigation.
Conversation metadata now retains a field-specific draft, allows an empty multiline
description, validates 500 Unicode code points without truncation and sends no-op
edits nowhere. Unknown writes offer explicit current-value comparison, not a receipt
or automatic retry. Rename recovery exposes differing stored/display titles and
compares the full pair before treating a reviewed save as a no-op; newer checks
retire older comparison actions. Confirmed metadata updates existing remote Reader/list/project/recent
caches before independent refresh; offline data and reading anchors are untouched.
Single-conversation placement now has one list/sidebar owner, explicit project
read states, current-visible destination guards and retained unknown-result recovery.
Checking only reads current location; another move requires explicit confirmation
with its newly read revision. A null summary may mean archived membership, not a
receipt for a move to Unclassified. Confirmed moves update existing remote caches
before independent refresh, preserving newer revisions, reading data and offline
copies. Recovery survives row/menu/drawer closure, not full owner navigation.
Pending-action focus recovery only targets lost/body focus, never a chosen control.
Reader recent-open responses now belong to one mounted conversation/data-source
visit and its authentication generation. Failed responses do not automatically
repost a non-idempotent open. Older summaries cannot lower the detail revision;
newer summaries request a full remote detail instead of relabelling old content.
Equal-revision reading time/progress advances only with a newer timestamp, allowing
progress to decrease while rereading. Valid remote replies independently invalidate
Recent and existing list keys; offline recording stays local. Reading anchors and
complete-turn queries are unchanged.
Remote detail-read failures now retain the matching cached Reader unless access is
denied/missing or the source is known to be merged. Localized recovery retries only
the detail GET, with current visit/auth and pending-read guards; normal first-load
dependent reads and the first recent-open may follow. A compact notice stays outside
scroll/header content. Lost focus returns without scrolling; chosen controls are not
interrupted. Denied/missing and wrong-id caches do not supply the document title.
Initial body errors now offer localized **Retry messages** on the same complete-turn
query/anchor. Current visit/auth/anchor, live read state, accepted-window and navigation
guards fence duplicate or stale actions; the existing apply-once rule protects newer
target windows. Obsolete initial errors disappear once current content is accepted.
Offline errors and complete-turn loading are unchanged. A subsequent readiness
repair follows the accepted current window, not the obsolete initial query. Input
and position listeners follow the available Reader surface; explicit non-restore
navigation retires the old saved-position decision. Saved-position restoration
and programmatic scrolling still do not manufacture user intent; stable DOM anchor
capture and position payload/throttling algorithms are unchanged.
Routine autosave pending/submitted/idle states, including normal offline queues,
now remain silent in Reader without a layout row, toast or repeated announcement.
Real storage/read/sync failures, conflicts and failed explicit locating retain
their existing recovery. Explicit sync-center detail still shows normal status;
current errors cannot also claim routine saved success. Exceptional notices can
still affect layout; real browser geometry has not been accepted.
Manual create/insert/edit now validates nonblank input without trimming accepted
Markdown. Whitespace-only edits count as real edits; canonical/edit/export source
retains leading/trailing whitespace. The separate paragraph projection in the
block builder is unchanged: this is not a claim that all indented-code rendering
or historical blocks are repaired.
PDF Fit Page keeps one page; continuous Fit Width/custom and thumbnails use the
installed virtualizer with overscan one, two concurrent renders per document,
4 Mi-pixel/4096-edge canvas budgets and settled cancellation/lease cleanup.
Direct page entry, actual fit zoom, current-page preservation, short-last-page
handling and page-local retry share the existing shell. Gallery shortcuts use
current identity and exclude editable/media/modifier events; replacing an image
resets its transform and restores only lost focus. JSON transport retry and
Raw/formatted switching are distinct; CSV parsing is memoized without changed
limits. Unsupported/empty/missing states do not mount a false renderer. Blob URLs
retain identity on retry. Office/ZIP worker startup and late callbacks recover
locally. Native audio/video remain metadata-only preload and no autoplay.

Latest local integrated checks: **601 Node passed / 0 failed / 0 skipped** and
**103 API passed / 0 failed / 0 skipped** in isolated SQLite TestClient; lint,
nonincremental typecheck, bounded one-worker Web build and single Alembic head
`20261008_0050` pass. Older checkpoint counts overlap and are not added. Discovery
finds **125 tests in six files**, including 79 recovery, 20 attachment, 12 PDF,
four manual-source, one Share-PDF and nine contract cases; **zero browser cases
executed locally**. No local service start, PostgreSQL concurrency, CPU/RSS
measurement, visual score or production acceptance is implied. The next complete
CI retains all 13 Web gates, full API/PostgreSQL and 439-case settings matrix plus
fresh-instance restore. Exact hashes and limitations are in the attachment ledger.

## Verification boundaries and release safety

- Local lint, nonincremental typecheck, bounded Web build, 33 focused offline/task
  API cases and single source head 0050 have passing evidence. Latest full API CI:
  **1,181 passed / 3 skipped**. Suites overlap; do not add them as unique cases.
- In the accepted release CI, all 13 Web gates pass, including the
  17-case mutation gate. Default PWA: **135 passed / 588 conditional skips**;
  adaptive-import recovery has one conditional skip. Skips are not passes.
- The 16 formerly pending selection/offline cases ran in isolated settings CI.
  This is not local acceptance with the user's specified Windows Chromium.
- One authorized original local Web start was rejected before process creation
  with only `blocked by policy`. Cause remains unknown. No alternate launcher
  was used; do not retry through a different route. See the
  [policy diagnosis](docs/execution/local-execution-policy-diagnosis-2026-10-08.md)
  and [Chromium checkpoint](docs/execution/specified-chromium-preflight-2026-10-08.md).
- Dependency policy passes with Next **16.3.8**, sharp **0.35.5** and the existing
  narrowly mitigated braces exception. This is not a zero-vulnerability claim.
- King is a low-memory host. Build images only in CI, never locally/on King.
  Preserve its operational checkout, Compose, `.env.production` and PostgreSQL.
  Stage exact-source support separately; never pull/reset the server checkout.
- The completed release verified provenance, 310 attachment hashes, capacity and
  a consistent five-component backup. Stop application writers, not PostgreSQL,
  when a future migration requires it; use `--no-deps --no-build`. Never replay
  completed release helpers or automatically downgrade/restore the database.
- Current verified backups: `chat-reader-20261006T141424Z` and
  `chat-reader-20261008T134403Z`. The exact older 113958Z point was pruned only
  after acceptance under the two-backup policy; final report has no candidates.
  No off-site or scheduled backup is configured.
- Current rollback points to b45f049; its exact API/Web images are already loaded.
  The superseded 25c7f6a load notice is archived with this release, not active.
  Follow [deployment](docs/deployment.md), not old commands from dated records.
- King Compose 2.27 does not accept `run --pull never`. Release-only overlays use
  `pull_policy: never`; validate configuration and mounted checks before stopping
  writers. The interrupted first attempt and verified recovery remain recorded.

## Project and source map

| Area | Authority / entry |
| --- | --- |
| Profile | Frontend/backend monorepo: Next.js 16, React 19, TypeScript; FastAPI, SQLAlchemy, Python 3.11+; PostgreSQL 16 |
| Packages | Corepack + pnpm 9.15.4; `package.json`, `pnpm-lock.yaml`, `apps/api/pyproject.toml` |
| Web | `apps/web/app/`, `features/`, `components/`, `lib/`; `apps/web/e2e/` |
| API | `apps/api/app/main.py`, routers/services/models/schemas; `apps/api/tests/` |
| Worker | `apps/api/app/workers/import_worker.py`; one concurrent background job |
| Data | PostgreSQL + `apps/api/alembic/versions/`; `schemas/` is reference material |
| Delivery | `.github/workflows/build-release-images.yml`, `docker-compose.production.yml`, `deploy/` |
| Current references | [System facts](docs/system/README.md), [API](docs/api-reference.md), [testing](docs/testing.md) |

Browser requests use same-origin `/api/*`; Next forwards them through
`API_INTERNAL_URL`, which matters at build time as well as runtime.
Canonical PostgreSQL data, Alembic and current code are the rendering authority.
Raw imports and Continuation files are not a second canonical data source.

## Current product decisions

| Area | Required behavior |
| --- | --- |
| Reading | Projects/Unclassified → Conversation → Reader; owner, public Share and Offline Reader retain separate access boundaries, complete turns and stable real DOM anchors |
| Offline | `/library`, Dexie v2, offline package v3; retain v1/v2/v3 reads and existing device data; failed replacement keeps the last readable copy |
| Authentication | One deployment-managed Root Admin plus isolated user accounts; server-authenticated UUID owns private data/tasks; public Share remains token/password scoped |
| Device boundary | Expired authorization locks local protected data; only the same verified account can resume it; signout/cleanup account for pending edits and drafts |
| Context | Current/Index read, edit and drop beside annotations; direct saves retain the other member and latest three snapshots; **no semantic validation, candidates or adoption** |
| Context return/export | Conversation-scoped `.context.zip`; returns do not modify Raw/assets; full export may include user-managed saved files without endorsing claims; restricted/Share exports exclude private Continuation |
| Skills | ZIP/Markdown upload and replacement; unchanged instructions and user-supplied Acquisition/Maintainer/Normalizer defaults; **no Skill viewer/editor/history UI** |
| External tooling | No application model calls or execution of uploaded scripts; reviewed external Bundles are separate from defaults; independent external-model behavior is unverified |
| Settings/archives | Personal settings before Root tools; `.cr` restore in Data & backup; additive personal restore previews/deduplicates; system v5 preserves ownership; old formats remain readable |
| Cleanup/rules | Default KEEP; explicit review creates normal versions; stable rule revisions, acquired permissions and explicit publication; source fingerprints prevent reuse of stale deletion consent |
| Recovery | Unknown writes require explicit read-only result checks; confirmed writes are not undone by failed refresh; retained tasks differ from browser downloads |
| Synchronization/admin | Field revisions, real reading anchors, outbox/conflict recovery; remote positions do not force Reader jumps; audited Root access does not weaken user ownership |

## Known limitations

SMTP remains unconfigured in the verified production snapshot; administrator reset
links remain available. Attachments are not malware-scanned under the accepted
low-memory deployment policy; integrity checks do not mean they are safe.
Browser eviction/quota and real-device variance remain operational risks.
Do not claim a full interactive production browser matrix, an external semantic
Skill trial, or a fix for the earlier unrelated Next stream-close observation.
The follow-on audit uses source, synthetic checks and isolated CI evidence, not
production browsing. Findings must be recorded before further product edits.

## Commands and workspace rules

| Check | Command |
| --- | --- |
| Web lint / typecheck | `corepack pnpm run lint` / `corepack pnpm run typecheck` |
| Web build | `corepack pnpm --filter web build` |
| API tests | `corepack pnpm run test:api` |
| Migration head | `cd apps/api; python -m alembic heads` |
| Playwright/PWA | `corepack pnpm --filter web test:pwa` |

Follow [AGENTS](AGENTS.md). Task temporary files belong under
`C:/Users/86182/Desktop/wkkk/chat-reader-release-resume-20261008`, with process-local
TEMP/TMP. The stopped isolated fixture remains under
`wkkk/chat-reader-offline-recovery-20261006`; preserve it, do not re-initdb.
Do not touch user imports, production volumes or unrelated local residues.
Existing unrelated `apps/web/tsconfig.tsbuildinfo` and the two auth-resume test
directories remain outside release commits.

## History and next action

[Archived entry checkpoints](docs/archive/PROJECT_STATE-before-release-2026-10-08.md)
retain the earlier batch summaries and their original failed/skipped/local-only
meaning. [Execution records](docs/execution/README.md) own dated evidence;
[documentation inventory](docs/documentation-inventory.md) owns document roles.
Historical “uncommitted/no deployment authorized” statements do not override the
current user-authorized release above.

Next: submit the locally verified attachment/manual-source and preceding recovery
changes to the one authorized exact-source complete CI cycle. Repair real failures,
review synthetic desktop/mobile screenshots, independently accept the resulting
images, then perform fresh King capacity/backup/rollback/data checks before
`--no-build` deployment. Do not retry the denied local service start. Keep accepted
30a0d32 production distinct until release acceptance. After this cycle, continue
the evidence-based ordinary-user audit without another CI/deployment unless the
user explicitly requests it. Extreme-size text/table rendering and actual image
decoded-memory measurements remain candidates, not completed improvements.
