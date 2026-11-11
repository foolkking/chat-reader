# Project State

## Ongoing small-host improvements — 2026-11-11 (not deployed)

Block A separates single-flight housekeeping from worker heartbeats without
increasing user-job concurrency. Local synthetic/real-PostgreSQL checks:
121 passed, four Windows POSIX-signal skips. Exact CI42868364815 passed API,
Web and Settings but failed a plain-10000 Reader long task (180ms >150ms);
release CI is paused pending diagnosis, not a threshold relaxation.
Block B adds durable explicit-disposal receipts and original-task cleanup retry;
paused/canceled/unknown runtime states are counted honestly. Local API/PG and
12 mounted Task Center cases pass; no automatic source purge or migration.
C adds bounded/auth-scoped turn reads; D makes runtime reads recoverable and
labels application archive history honestly. Local Reader30/Runtime12,
UX Node2269, API runtime11 and isolated production build pass.
E reclaims protected complete-turn intervals without rebasing under active
input; F bounds stale recovery and protects canonical writers/progress updates.
Reader36/Node2279, targeted API/PG and the exact local production build pass.
The unexplained full-CI 180ms task remains open: neither single-case nor full
nine-case exact-failed-source diagnostics reproduced it. A new full release
CI must validate each materially repaired candidate; no threshold is relaxed.
E/F source08b5011 has now passed all six jobs in full CI42900162201;
downloaded quality/memory summaries agree, without a production release.
G retains private Context-upload cleanup receipts until confirmed removal,
using the same bounded maintenance lane. Local API/PG93 and94 checks
(overlapping, four Windows skips), Runtime12 and Node2279 pass;
this additional work requires its own exact-source CI.
[Plan](docs/planning/SMALL_HOST_OPERATIONS_2026-11-11.md) /
[execution and limits](docs/execution/SMALL_HOST_OPERATIONS_2026-11-11.md).
The latest user instruction allows major-block commits/CI without waiting;
inspect the preceding CI before each dispatch. No new deployment, schedule
or production deletion is authorized. Production remains3564cbf below.

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
| Production / retained rollback images | `897ba78` / `9cf235f`; older `67e6336` also retained; accepted **2026-11-07 13:38:56Z**, independently rechecked **13:39:40Z** |
| Runtime recheck | API, Web and PostgreSQL healthy; worker `alive_idle`; canonical HTTPS health and login return 200 |
| Database | Production single head/current `20261105_0059`, unchanged this release; prior private-search backfill remains committed, 52/52 |
| Verification / delivery | New stopped-writer five-component backup `chat-reader-20261107T133202Z` independently verified; attachment audit 390/390 hashes, zero issues. No local application tests, production build, raw ZIP replay or cleanup |

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

This deployment retains all **three** backup points (November 7, 6 and 5) and
all **twelve** role tags for `897ba78`, `9cf235f` and `67e6336`. No cleanup was
authorized or performed. The separately authorized November 6 cleanup remains
historical in its [receipt](docs/execution/IMAGE_READING_STABILITY_RELEASE_2026-11-06.md#subsequent-authorized-cleanup).
Direct rollback `9cf235f`
supports the same 0059 schema, but still needs stopped-writer/job/data checks.
Never automatically downgrade. Post-deployment disk check: **92% used,
3,457,056 KiB free** at **2026-11-07 13:40:37Z**; capacity is tight.
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
This deployment did not authorize cleanup. November 6's earlier bounded cleanup
authorization does not authorize a new deletion or replaying the user's source ZIP.
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
