# Project State

Last synchronized: **2026-11-07**. Current facts and verification boundaries only;
dated implementation, CI failures and release narratives belong in execution records.
Start with [AGENTS](AGENTS.md), then [documentation navigation](docs/index.md).

## Current release — natural image sizing

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
