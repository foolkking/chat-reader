# Project State

## Reliability candidate — 2026-11-14 (local repair verified; fresh full CI required)

The latest November13 instruction authorizes selective commit/push, the full
exact-source CI and deployment after CI success. The user owns acceptance of
the remaining product/device/recovery scenarios. This does not waive automated
release gates, stopped-writer backup, migration or runtime-health safeguards,
and does not authorize cleanup or replay of user inputs.

Focused repair **`74a1e8605bc00d64b543544041c3095566f2881f`** is selectively
committed and pushed: nineteen task files, thirteen unrelated files byte-preserved
and unstaged. Full exact CI **`43503483829`** was first read at
**05:28:55.244142 +08:00**, after its fresh fifty-minute wall-clock/monotonic
boundary. Independently confirmed **completed/failure at 05:39:07 +08:00**;
no cancellation was requested. API **6656 passed / 3 skipped / 5 warnings**,
Settings **470 passed plus independent restore1**; Web failed five cases and
Reader math10000 cold0 measured **213ms against the unchanged 150ms bound**.
Both release jobs were skipped. Four official logs and three official diagnostic
ZIPs are verified, not deployable artifacts.
[Failure receipt](docs/evidence/reliability-2026-11-14/ci-probe-pagination-failure.json)
preserves the [dispatch](docs/evidence/reliability-2026-11-14/ci-probe-pagination-dispatch.json)
and original failure; no earlier partial success is inherited.

The Web fixes align the old tests with the existing reference-caret, automatic
KEEP, sequential upload and original-receipt recovery contracts; application,
workflow, migration and deployment code are unchanged. Mounted editor **117**
(all original102 plus fifteen scenarios) and Files **15** pass with explicit
HTTP adapters, not authenticated server acceptance. The first mounted run's
final console-check failure is retained; every deliberate500 is now checked by
exact message, request URL and count, without suppressing unrelated errors.
Selected real API/TestClient checks **75** remain earlier local evidence with
unchanged API inputs, not an additional rerun. Final Reader **42** retains all
original39 scenarios plus three real-collector coordinate controls; Node UX
**2519**, CI scripts **64**, security/PWA unit **20**, lint/typecheck and a new
**548-input** same-installed-dependency isolated build pass. Final **1391**
source/test/config inputs were recaptured after the diagnostic fixture correction;
thirteen protected files and the empty index are verified. No local serving
stack or PostgreSQL restart. [Local verification and input manifests](docs/evidence/reliability-2026-11-14/ci-runtime-frame-verification.json)
do not replace a new full exact CI.

The unexplained213ms is not claimed fixed. Diagnostic-only full-sequence CPU run
**`43514182245`** completed/failure; its first read at **06:40:15.205718 +08:00**
passed the fresh fifty-minute wall-clock boundary and **3000.015** monotonic
seconds. All eighteen measurements and fifty-four cold profiles are retained.
Its three assertion failures concern raw scrollTop, not a proven TOC/GC/KaTeX
cause. Independent mounted evidence distinguishes legitimate whole-turn rebasing
from real backwards movement missed by the old wheel-only comparator.
Measurement **v4** uses shared connected real DOM anchors on every frame and
wheel sample, preserves raw reversals/all frames/long tasks, and retains the
original **2/34/150/250/40/120** budgets and **30×120px +34ms** inputs.
[Diagnostic result](docs/evidence/reliability-2026-11-14/ci-runtime-frame-diagnostic-result.json)
is not release acceptance. Only tests/fixtures and owned documentation changed;
no scheduler or production action. The two authorized old-import cancellations
are complete and are not reused for later imports.

Preceding repair **`7f8a6425a1d3b9f5c255925ce55340a406a3e063`** is selectively committed
and pushed: nineteen task files, thirteen unrelated files byte-preserved and
unstaged. Exact full CI **`43483733253`** was confirmed at
**02:33:11.802991 +08:00**; the first read at **03:23:11.814857 +08:00**
respected the 50-minute wall-clock/monotonic boundary. API hit its original
45-minute full-suite limit; Web's conflict-recovery test timed out waiting for
a nonexistent nested-footer `contentinfo` landmark. One cancellation request at
**03:26:36.093662 +08:00** was independently confirmed **03:27:03.210582**.
Settings is cancelled/incomplete; its retained log also contains one real
pagination failure (20 rather than 21 unique IDs across two changing snapshots).
Both release jobs executed zero steps.
Three existing job logs and two official diagnostic ZIP digests are verified,
not deployable artifacts. No repeated cancellation, scheduler or deployment.
The [single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md) owns the focused
repair, evidence and local test limitations; production is unchanged.
The focused repair preserves strict retention checks while avoiding unnecessary
full-heap GC, scopes comparison to the actual nested footer, and waits within
the existing 20-second boundary for the original insertion's materialization
before pagination. Final selected API/PG regression passes **39**; a fresh full
exact-source CI is still required, not inherited from any earlier run.
Mounted editor **102**, Node UX **2510**, CI scripts **62**, security/PWA unit
tests **20**, lint/typecheck and a fresh **548-input** same-installed-dependency
isolated build pass. Final **1391** inputs and thirteen protected files are
verified; the owned test PostgreSQL is stopped with its data retained.
[Repair provenance](docs/evidence/reliability-2026-11-14/ci-probe-pagination-verification.json)
is selected local evidence, not release acceptance.

Preceding API fixture-port repair **`5fcb835b23bb76779f203519ce6346422544e14a`** was
selectively committed and pushed. Exact full CI **`43459604614`** was dispatched
at **00:07:59.560391 +08:00**; the first read at
**00:58:03.927117 +08:00** respected the 50-minute boundary. API and reading
comparison succeeded, Web failed, and Settings reached its original 60-minute
job limit after four failures. No cancellation request was sent for this run;
both release jobs were skipped. Recovery-test and exact synthetic-task closeout
repairs are locally verified; the new full CI above does not inherit its results.
No deployment is claimed.
The [single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md) owns progress;
thirteen unrelated files remain preserved, and no scheduler was created.

Two later, separate November14 instructions authorized safely ending the old
stalled import and a different newly stalled import before CI completion.
Both rolled back through the old worker's own failure path; all source bytes
were hash-verified and retained. The latest independent **00:44:39 +08:00**
snapshot had no active/queued tasks, leases or lock waits and a fresh idle
heartbeat. Services/configuration/volumes remain unchanged; this is incident
recovery, not deployment or a permanent fix to production's legacy code.

Focused repair **`a8d859b`** was committed and pushed, but was not dispatched.
Pre-dispatch validation found that API CI's default PostgreSQL port conflicted
with the guarded synthetic scan fixture. The follow-up confines API quality to
the existing dedicated **65438** port; all six jobs and every other workflow
field/bound remain unchanged. The same **39** cases pass on that owned port,
and CI fixture/source checks pass **62**. Exact-source CI is still required.

Fixture repair **`2ae0ed0ff26d1bc4cfe49b617cb6a08981f99a51`** is selectively
committed and pushed. Full CI **`43436935411`** was first read at
**22:38:46.069844 +08:00**, after the fresh 50-minute boundary. Web failed;
one cancellation was requested at **22:39:58 +08:00** and independently confirmed.
Settings had five pre-cancellation failures, not a 60-minute timeout; release
jobs never started. The focused repair passes API/PG **39**, source contracts
**9** and five rejection controls. It preserves synthetic-task/source receipts
and the original worker/gate bounds. A fresh **548-input** same-installed-dependency
isolated build passed; the old build was not inherited. Full CI is required; no deployment.

Repair **`829e1b794a795e4bee9a456717825089e88dd354`** is selectively committed
and pushed. Full CI **`43424349497`** failed API/Web and was cancelled at the
user's request, confirmed **21:14:35 +08:00**. The first valid result read at
**21:12:16 +08:00** respected the 50-minute boundary; the initial TLS read
failure is retained. Four test-fixture repairs now pass selected regression:
API/PG **34 passed / 4 Windows POSIX skips**, mounted editor **99** and **20**
exact Unicode repetitions. Application/workflow/deploy code and all **548**
previously built Web inputs are unchanged. Fresh full CI is still required;
no deployment is claimed. The preceding candidate `adc80ac` and
full CI **`43389645130`** failed: API/Web failed, Settings reached
its original 60-minute timeout, and downstream release jobs were skipped.
The first read at **16:48:50 +08:00** respected the 50-minute minimum.
CI-blocking repairs now pass local regression: PostgreSQL modules, 99 mounted
editor scenarios, twenty picker repetitions, twelve scan-recovery groups,
2591 Node cases and the 548-input isolated build. The editor repairs address
both initial-value replay and repeated header history commands, not merely
picker deduplication. The single ledger owns evidence and limitations;
no new accepted CI or deployment is claimed. Thirteen unrelated dirty files
remain byte-identical and unstaged. Waiting-period production checks found a
legacy import/progress/heartbeat lock chain and capacity risk; they are not fresh
release admission. Do not force-restart that import into automatic replay.

The user has now authorized implementation of the four-block reliability plan.
The earlier pause below remains historical; it does not prohibit this local work.
The [single current ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md) owns
implementation, regression evidence and outstanding acceptance items.

- Source snapshots/exact content baselines, original-request receipts, multiple
  references and missing-file editing are implemented locally.
- The worker now supervises one fresh execution process with an independent stop
  record, bounded auxiliary writes, business checkpoints and outcome reconciliation.
- Candidate schema head is **`20261112_0061`**; production remains **`3564cbf /
  20261108_0060`**. This work does not inherit any earlier CI result.
- Local synthetic/API/PostgreSQL/browser checks are recorded in the ledger.
  Linux combined-process320/640MiB and the full original frame matrix await
  a successful full repair CI. Physical tablet and host-backup restoration remain
  **not accepted**; the user will perform remaining acceptance.
- Preserve earlier M/N/O edits and evidence. The November 12 follow-up authorizes
  one local checkpoint commit and continuation of the next batch, without waiting
  for CI. No push, CI dispatch, deployment, production cleanup or real-user-source
  replay is authorized by this checkpoint.
- Checkpoint **`a0faa85`** preceded the following administrator batch, now included
  in `adc80ac`. The batch adds Root's on-demand execution stop/result-check flow, exact execution
  fencing and atomic audit receipts; account-deletion interruption retains its
  original recovery path. No CI or production action was performed.
- The November13 continuation adds owner-task interruption recovery: existing
  cancellation permissions, batch-deletion checkpoint/receipt preservation and
  independent stopping in Tasks/noise scans. The same ledger owns verification
  and recovered working preferences. The subsequent release authorization
  supersedes the earlier local-only commit restriction; the exact-source CI
  above failed and is not accepted.

## Small-host goal closeout — 2026-11-12

**Paused for the user's next decision, not declared complete.** One current
[status / completed areas / remaining route](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md)
replaces the repeated running summaries. Historical sections below are provenance.

- Production remains `3564cbf`; schema `20261108_0060`.
- Committed candidate `7a4d61b` (A–L): exact CI `43025451379` passed all six jobs,
  not deployed. Later work does not inherit that result.
- M/N/O and the latest heartbeat skip-lock correction remain uncommitted.
  Their local results and limitations are in the overview; exact CI is pending.
- The November12 authorized queue recovery finished: one blocked import safely
  failed with its two source files hash-verified, two waiting exports completed,
  no active tasks or lock waits, worker heartbeat resumed. No restart/deployment,
  direct task-row rewrite, user-file deletion or automatic import replay.
  [Incident receipt](docs/execution/SERVER_QUEUE_RECOVERY_2026-11-12.md).
- Stop new exploration, commits, CI, deployments and cleanup after this closeout;
  preserve the user's work and evidence. The old continuous-work instructions
  below do not override the latest request to stop and summarize.

## Current release — recoverable operations — 2026-11-11

Application **`3564cbfdc1157cddcec53e85462b8e0a410fc4a2`**, exact CI
**42828329240**, six jobs/five official artifacts independently verified.
Deployed **November11 00:08:06 +08:00**; schema **20261108_0060** unchanged.
Ordered import recovery, retained stop/resume, source repair, quiet table/image
feedback, touch-boundary loading and explicit cross-device handoff are released.
Runtime health/images/config preservation passed; one later malformed static
Server Action request produced a retained warning, not a clean-log claim.

The separately approved A–D cleanup is complete. **Exactly one** verified backup
remains: **`chat-reader-20261110T155821Z`** (November10 23:58:21 +08:00).
Current images and that backup's matching recovery images remain; no direct
old-worker rollback, scheduled purge, production config replacement or user ZIP
replay. Successful sources, the recent failed source and live data are protected.
[Release, cleanup and eighteen-requirement receipt](docs/execution/RECOVERABLE_OPERATIONS_RELEASE_2026-11-11.md) /
[machine evidence](docs/evidence/release-2026-11-11/recoverable-operations-deployment-summary.json).
Physical tablet/production authenticated UI and backup restore/off-site recovery
remain unverified. Follow-up is a local documentation commit, not another CI or deployment.

Earlier candidate runs are retained in the
[implementation ledger](docs/execution/RECOVERABLE_OPERATIONS_2026-11-10.md).
All older release/backup counts below are historical; this section is authoritative.

## Previous release — reading interaction / missing ZIP assets — 2026-11-09

Application **`865b0a6e381bb3d5c2afba06b5c3aa4c59a61092`**, full CI
**42594459199**: six jobs, five official artifacts and independent acceptance.
API6199, Web Node2175, Web14 gates, Settings470+restore1, Reader19 groups,
candidate performance9, original64+12+4 traces and cold Viewer, five real-memory cases.
Formula reading, canonical header/tags, focus tools, timed Return and nonblocking
missing-asset ZIP imports are deployed; no migration/offline format change.
Final maintenance **18:48:16–18:55:46 +08:00**; runtime recheck **18:56:43**,
backup/preservation **19:01:13**. Schema **20261108_0060** unchanged.
First maintenance safely aborted on task-verifier mount-order/JSON comparison;
old services restored before corrected preflight/redeployment. Full history in
[receipt](docs/execution/READING_INTERACTION_ZIP_RELEASE_2026-11-09.md).
Three verified backups and three image generations remain, no cleanup/direct
rollback. Final free-space snapshot **7,819,320 KiB**. Original config/PG retained.
No real-user ZIP replay or authenticated production UI acceptance.
The candidate/pending/previous-current sections below are historical checkpoints;
this release and receipt supersede their status, not their preserved evidence.


## Release candidate — reading interactions / missing ZIP assets — 2026-11-09

Candidate: formula-cost virtualization, scoped hover/geometry reads,
canonical current-message header/title tag editing, focus-mode search and
timed Return presentation; missing ZIP resources import as honest fileless
attachments with warnings, without bypassing integrity/scanner/source checks.
No migration or portable/offline schema change. Local static/synthetic checks
and limitations: [implementation record](docs/execution/READING_INTERACTION_ZIP_FIXES_2026-11-09.md).
Local lint/typecheck, 2174 Web cases, 186 API cases (3 Windows symlink skips),
13 Reader and 12 Viewer browser groups passed. Full Next build passed in a
task-local, source-hashed copy with the same installed dependency versions;
earlier cross-drive/junction build failures remain in the record.
Full PWA/64-frame CI remains unrun.
The current release below is unchanged. The subsequent user goal authorizes
completion review, corrections, commit/push and full CI through successful
deployment. Each dispatch requires a fresh **50-minute minimum before the
first status read**; no schedules or real-user source replay.
[Review](docs/execution/ux-audit-reading-interaction-zip-2026-11-09.md)
identified missing CI wiring and incomplete language/theme cross-coverage;
the additional required browser gate does not replace the original matrix.

## Current release — bounded ZIP and reading tools — 2026-11-09

Current application **`d61b9c69004c3c482fd915fd6f77481fa1920ae7`**, full CI
**42522644855**: all six jobs, five artifacts, 14 Web gates and five real-memory
cases independently accepted. Production single head/current **20261108_0060**.
Maintenance **05:55:56–06:03:02 +08:00**; independent runtime check **06:03:30**,
backup/preservation recheck **06:06:22**. API/Web/PostgreSQL healthy, worker alive_idle.
Original production configuration, PostgreSQL and seven other containers unchanged.
Two verified backups and two image generations remain; **no direct rollback** to
the old worker after v2 drafts/0060. Available-space snapshot: **10,756,356 KiB**.
No cleanup, local application tests or user-ZIP replay; CI heartbeat is paused.
[Release receipt](docs/execution/BOUNDED_ZIP_IMPORT_RELEASE_2026-11-09.md) /
[contract](docs/system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md).

**Historical release checkpoints below:** the November 7–8 production/candidate,
pending-CI and former authorization statements before “Project and source map”
remain provenance, not current release instructions. The current section above
supersedes them; existing user-written cleanup history is retained verbatim.


Last synchronized: **2026-11-08**. Current facts and verification boundaries only;
dated implementation, CI failures and release narratives belong in execution records.
Start with [AGENTS](AGENTS.md), then [documentation navigation](docs/index.md).

**Additional unreleased candidate (2026-11-08):** disk-backed ZIP import,
message-indexed internal draft v2, async recovery and durable resource waiting.
Candidate migration **0060** adds queue eligibility fields; production remains
**0059**. On November 8 the user authorized committing this candidate and
submitting it with local reading-tools commit `2bb6ef0` to full CI on `master`.
CI acceptance is pending; no deployment or user-ZIP replay is authorized.
Static and pending runtime gates are separated in the
[record](docs/execution/BOUNDED_ZIP_IMPORT_2026-11-08.md) and
[contract](docs/system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md).
The user's existing local reading-tools commit and unrelated changes are preserved.

## Current release — natural image sizing

**Unreleased local candidate (2026-11-08):** compact image slider and
once-only adaptive-import fit; reorganized Reader tools, read-together tabs,
location bookmarks/contextual exports and private tag management. Static checks
have passed at review checkpoints; full exact-source CI and visual acceptance
are still pending. The November 8 completion audit found seven source-level
gaps; the user then authorized targeted corrections (draft guards, real-line
capture, manual-upload/default-fit semantics, search destinations and annotation
filter/export context). Corrections are in local checkpoint `2bb6ef0` and
require runtime/visual acceptance. The subsequent November 8 instruction
authorizes pushing that commit together with the bounded-ZIP candidate and
dispatching full CI once; it does not authorize deployment or automatic polling.
This does not change the production release below.
[Candidate contract](docs/system/READING_TOOLS_CONTRACT.md) /
[verification record](docs/execution/READING_TOOLS_2026-11-08.md).
[Audit](docs/execution/ux-audit-reading-tools-completion-2026-11-08.md) /
[correction record](docs/execution/READING_TOOLS_AUDIT_FIXES_2026-11-08.md).

Exact **`897ba788fd89e18c9634ca2271ba6146339939a0`** passed full CI
**`42371615326`** and was deployed after the user's separate “成功，部署”
authorization on **2026-11-07**. Source-bound original geometry, one saved
percentage, natural wrapping and width-preserving long-image folding replace
fixed preview cells. Controls commit on release; Viewer zoom measures intrinsic
CSS pixels. Optional offline v3 geometry preserves Dexie v2 and older packages.
The Skill panel retains its opening-language query hint while labels localize;
all three controlled preference-hydration regressions passed.
[Current contract](docs/system/IMAGE_READING_STABILITY_CONTRACT.md) /
[implementation and CI history](docs/execution/IMAGE_NATURAL_FLOW_2026-11-07.md) /
[release receipt](docs/execution/IMAGE_NATURAL_FLOW_RELEASE_2026-11-07.md).

All six jobs and five official artifact ZIP digests/content checks passed.
Reading/image cases **35/35**, original **64** frame traces plus **12** collapse,
**4** passive-wheel guards and a cold Viewer shell trace passed without relaxing
thresholds. API **6078 passed / 3 optional skipped**, Web Node **2111/2111**,
Web gates **14/14**, Settings **466/466** plus isolated restore **1/1**,
performance baseline/candidate **9/9**, exact-image **320 MiB** memory gate passed.
Synthetic CI is not authenticated production UI or physical-device acceptance.

## Release and runtime

Maintenance lasted **21:31:35–21:38:56 +08:00** (7m21s). Independent runtime
recheck passed at **21:39:40**; backup/preservation recheck completed at
**21:40:37**. No migration or Dexie upgrade; existing offline copies retain their
own snapshots. Only API/worker/Web were recreated from verified CI images.

| Boundary | Verified snapshot |
| --- | --- |
| Source / branch | Existing `master`; deployed application source `897ba788fd89e18c9634ca2271ba6146339939a0`; subsequent documentation-only receipts are not new application releases |
| Accepted / deployed-source CI | `42371615326`, attempt 1; six jobs and all five artifact contents passed after the 50-minute first-read gate |
| Production / retained rollback images | `897ba78` only after separately authorized November 8 cleanup; four current role tags and verified current archive retained; no direct local rollback |
| Runtime recheck | API, Web and PostgreSQL healthy; worker `alive_idle`; canonical HTTPS health and login return 200 |
| Database | Production single head/current `20261105_0059`, unchanged this release; prior private-search backfill remains committed, 52/52 |
| Verification / delivery | Stopped-writer five-component backup `chat-reader-20261107T133202Z` independently reverified after November 8 cleanup; original release attachment audit 390/390 hashes, zero issues. No local application tests, production build or raw ZIP replay |

The deployed release adds natural image sizing, explicit pixel/column feedback,
offline geometry snapshots and unified reading compensation, retaining the
consolidated authentication/offline and recovery consistency work, bounded small-ZIP memory path and structured failure/retry
handling. Qualifying single-document archives use 192 MiB effective-free admission,
a 128 MiB reserve and a 64 MiB workspace-growth budget; other imports keep standard
admission. Real exact-image 320 MiB worker CI is not proof of success on user data.
[Release receipt](docs/execution/IMAGE_NATURAL_FLOW_RELEASE_2026-11-07.md) owns official
artifact hashes, OCI/config identity, stopped-writer backup, deployment and preservation
evidence. [Adaptive ZIP contract](docs/system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md)
owns qualification and compatibility details.

The deployment initially retained three backups and three image generations.
On **2026-11-08**, the user separately approved latest-only retention and all
items in the reviewed cleanup table. Only `chat-reader-20261107T133202Z`,
the four current `897ba78` role tags and its verified image archive remain for
Chat Reader. Two older backups, eight old role tags, twelve old transfer
archives, four inactive VS Code Server versions and bounded caches were removed.
Mixed-transfer receipts/helpers were preserved and hashed; logs, business data,
volumes, unrelated images and the live VS Code launcher were not removed.
The old rollback pointer was archived, not falsely replaced with the current
revision. **No direct local rollback remains**; restoring an older application
requires reacquiring verified exact images and fresh stopped-writer/job/data
checks. Never automatically downgrade.
Independent check **2026-11-08 01:42:13 +08:00**: **66% used,
13,680,388 KiB available**, an observed increase of **9.78 GiB** from the
pre-cleanup snapshot. All eleven container identities/start times/restart counts,
mount sets, runtime configurations and volumes were unchanged. Retained backup
SHA/tar/PG TOC and current image-archive verification passed; this is not a
restore drill or redundant/off-site protection.
[Cleanup receipt](docs/execution/KING_STORAGE_CLEANUP_2026-11-08.md).
Future releases need fresh capacity admission, not automatic cleanup or reduced budgets.
Capacity and aggregate data counts are time-point
observations, not invariants. Writers resumed after deployment; do not claim all
canonical row counts stayed unchanged or restore data to make them match.
Production environment/Compose/Nginx and PostgreSQL were not replaced.

## Project and source map

| Area | Authority / entry |
| --- | --- |
| Runtime stack | Next.js **16.4.1**, React **19.2.8**, TypeScript; FastAPI, SQLAlchemy, Python 3.11+; PostgreSQL 16 |
| Dependencies | `pnpm-lock.yaml`, API `requirements-{runtime,test,build}.lock` with hashes; Corepack + pnpm **9.15.4**; Web CI/image Node **22.13.1** |
| Web | `apps/web/app/`, `features/`, `components/`, `lib/`; browser checks in `apps/web/e2e/` |
| API | `apps/api/app/main.py`, `api/routes/`, services/models/schemas; `apps/api/tests/` |
| Worker | `apps/api/app/workers/import_worker.py`; one concurrent background job |
| Data | PostgreSQL and `apps/api/alembic/versions/`; `schemas/` is reference material |
| Delivery | `.github/workflows/build-release-images.yml`, `docker-compose.production.yml`, `deploy/` |
| Detailed facts | [System index](docs/system/README.md), [API](docs/api-reference.md), [testing](docs/testing.md) |

The browser uses same-origin `/api/*`; Next forwards through `API_INTERNAL_URL`,
which matters at build time as well as runtime. Current canonical PostgreSQL data,
Alembic and code are rendering truth; raw imports and Continuation files are not.

## Stable product boundaries

| Area | Required behavior / current capability |
| --- | --- |
| Import | Adaptive JSON/Markdown/ZIP and separate `.cr` restore; preview and explicit commit precede worker canonical writes; never silently retry a user's source |
| Reader | Owner, public Share and Offline retain separate access; complete turns, stable real DOM anchors and no programmatic-scroll-as-user-scroll |
| Reading UX | Conversation favorites use a star beside search; existing `reading-list` route/API/data stay compatible; keyboard/help, collapsible sidebar and geometry corrections are deployed, not universal device acceptance |
| Rendering | Rich Markdown policy **v13**: bounded sanitized static HTML/details/media, Obsidian callouts/highlights and existing GFM/math/code; no arbitrary HTML/script execution or claim of all Obsidian plugins |
| Collections | Owner-scoped favorites/read state, saved searches, private annotation inbox, tags, new-message baseline and bounded read-only comparison; synthetic-example entry removed |
| Offline | `/library`, Dexie **v2**, package **v3**; retain v1/v2/v3 reads and existing device data; failed replacement keeps the last readable copy |
| Accounts | One deployment-provisioned administrator plus isolated users; private owner UUID comes from the session; explicit public Share remains capability/password scoped |
| Device boundary | Explicit trusted-browser permission keeps downloaded copies readable after online expiry; new/unupgraded devices retain legacy protection; explicit revocation/local lock and account switching still fence access |
| Context | Current/Index view, edit and drop beside annotations; saves retain the other member and latest three snapshots; no semantic validation/candidates/adoption |
| Context exchange | Conversation-scoped `.context.zip`; return does not modify Raw/assets; restricted/Share exports exclude private Continuation |
| Source tables | Rendered table/Markdown editing uses bounded paging, stale/pending guards and one undoable CodeMirror transaction; historical focused tests do not prove arbitrary extreme-table performance |
| Skills | ZIP/Markdown upload and replacement with user-supplied defaults; no Skill viewer/editor/history UI, uploaded-script execution or application model calls |
| Archives | Personal v1/system v5 accept additive `user_features_version:1` for collections and reading baselines; old formats remain readable; sessions, device trust, browser drafts and Share links are excluded |
| Cleanup / sync | Default KEEP, explicit source-bound review and versions; revision/outbox/conflict recovery; remote positions do not force Reader jumps |
| Recovery | Unknown writes require explicit read-only result checks; failed refresh does not undo confirmed writes; browser downloads differ from retained server tasks |

Detailed behavior and limits live in [product](docs/product.md),
[feature inventory](docs/system/FEATURE_INVENTORY.md),
[rich Markdown](docs/system/AI_RICH_MARKDOWN_CONTRACT.md),
[Context](docs/system/CONTEXT_PACKAGE_CONTRACT.md) and
[data/storage](docs/system/DATA_AND_STORAGE.md).

Implementation, measurements, review and CI receipts:
[comprehensive optimization](docs/execution/COMPREHENSIVE_OPTIMIZATION_2026-11-05.md),
[recovery/consistency follow-up](docs/execution/RECOVERY_CONSISTENCY_2026-11-05.md).
Current cross-module behavior:
[optimization contract](docs/system/COMPREHENSIVE_OPTIMIZATION_CONTRACT.md).

## Pending verification and operational limits

- **Original user ZIP:** production retry and canonical import result await an
  explicit user retry; deployment did not silently re-import it.
- **Real 47-conversation offline update:** bounded per-conversation recovery is
  deployed and CI-tested; the actual user download/update has not been repeated.
  See [diagnosis](docs/execution/OFFLINE_LARGE_PACKAGE_DIAGNOSIS_2026-11-01.md).
- Authenticated production UI, physical clipboard, screen-reader/real-device
  interactions and sustained load remain unverified. A real pg_dump/pg_restore
  drill against isolated synthetic PostgreSQL/asset data passed on 2026-11-05;
  this does not establish recovery of a production backup or off-site recovery.
- Scanner-disabled attachments are **unscanned**, not safe. Bounded previews are
  not hostile-document certification. Device quota/eviction remains a risk.
- Server-local backup points may share hardlinks; independent off-site recovery
  and scheduled backups remain unconfigured in the verified release snapshot.
- SMTP is unconfigured in the verified release snapshot; administrator reset
  grants remain available. Source-editor drafts now survive reload in the
  account-scoped browser store; other unknown-write/draft protections remain
  scope-bound, not a universal promise of crash durability.
- Noise detection is bounded recognition, not exhaustive Markdown/adapter parity
  or a universal latency/RSS guarantee. [Risk contract](docs/system/KNOWN_ISSUES_AND_UNCERTAINTIES.md)
  owns detailed limits and preserves older checkpoint provenance.

## Work and verification boundary

Follow the command and temporary-directory rules in [AGENTS](AGENTS.md).
Use process-local TEMP/TMP under `C:/Users/86182/Desktop/wkkk/<task-name>`.
Do not modify user imports, production volumes/configuration or unrelated residues.
The server operational checkout is dirty: do not pull/reset it or replay completed
release helpers; future releases need exact-source staging and fresh preflight.

Documentation/governance closeout and the subsequently approved bounded local
cleanup are complete. Only the merged local branch and reviewed regenerable
caches/empty directory were removed; no remote branch or production data changed.
The later image/reading plan includes all seven follow-up audit items and
commit/push on existing master. Each submitted run obeyed its fresh minimum
50-minute first-read boundary except explicit user-reported failure diagnoses.
Exact `897ba78` is fully green. The subsequent explicit “成功，部署” request
authorized the accepted release above; deployment and independent recheck are complete.
The CI recheck remains paused; no schedule was created or resumed.
The later November 8 cleanup was separately authorized and is complete; it does
not authorize future deletion, automatic retention changes or replaying the user's source ZIP.
The unrelated `apps/web/tsconfig.tsbuildinfo` modification and release/test
evidence remain preserved.
[Closeout receipt](docs/execution/KNOWLEDGE_CLOSEOUT_2026-11-04.md) records checks,
six-facet status, post-report approval and the verified cleanup result.

## History

The [pre-closeout state](docs/archive/PROJECT_STATE-history-2026-11-04.md) preserves
all earlier checkpoint text with source hash and rebased links. Use the
[execution index](docs/execution/README.md) and
[documentation inventory](docs/documentation-inventory.md) for dated evidence.
Historical “local-only”, “uncommitted” or “next action” instructions are not current
work orders and do not override the runtime/authorization boundaries above.
