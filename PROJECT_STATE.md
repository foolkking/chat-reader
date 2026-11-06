# Project State

Last synchronized: **2026-11-06**. Current facts and verification boundaries only;
dated implementation, CI failures and release narratives belong in execution records.
Start with [AGENTS](AGENTS.md), then [documentation navigation](docs/index.md).

## Release and runtime

**Current release (2026-11-06):** image presentation, reading viewport ownership
and seven follow-up audit items passed exact-source CI and were subsequently
authorized for deployment. The required `reading-stability` gate passed 23/23
cases with 64 complete frame traces; earlier partial successes are not acceptance.
[Source contract](docs/system/IMAGE_READING_STABILITY_CONTRACT.md) /
[implementation history](docs/execution/IMAGE_READING_STABILITY_2026-11-06.md) /
[release receipt](docs/execution/IMAGE_READING_STABILITY_RELEASE_2026-11-06.md).
No migration or Dexie upgrade; existing offline copies retain their own snapshots.

| Boundary | Verified snapshot |
| --- | --- |
| Source / branch | Existing `master`; deployed application source `9cf235f3730aae0f3ae747fe0e36763056a624c0`; subsequent documentation-only receipts are not new application releases |
| Accepted / deployed-source CI | `42217357688`, attempt 1, exact `9cf235f`; six jobs and all five artifact contents passed after the 50-minute first-read gate |
| Production / retained rollback images | `9cf235f` / `67e6336`; accepted **2026-11-06 14:07:48Z** (**22:07:48 +08:00**), independently rechecked **14:10:03Z**; later authorized cleanup removed only the older `be58b12`/`3b839dc` tags |
| Runtime recheck | API, Web and PostgreSQL healthy; worker `alive_idle`; canonical HTTPS health and login return 200 |
| Database | Production single head/current `20261105_0059`, unchanged this release; prior private-search backfill remains committed, 52/52 |
| Verification / delivery | API 6072 passed / 3 optional skipped; Web Node 2092/2092 and 14/14 gates; reading 23/23 with 64 traces; settings 463 plus isolated restore 1; capacity baseline/candidate 9/9; exact-image 320 MiB memory gate passed. No local application tests, production build or raw ZIP replay; separately authorized retention is recorded below |

The current release adds fixed image previews, explicit reading-size suggestions,
offline dimension snapshots and unified reading compensation, retaining the
consolidated authentication/offline and recovery consistency work, bounded small-ZIP memory path and structured failure/retry
handling. Qualifying single-document archives use 192 MiB effective-free admission,
a 128 MiB reserve and a 64 MiB workspace-growth budget; other imports keep standard
admission. Real exact-image 320 MiB worker CI is not proof of success on user data.
[Release receipt](docs/execution/IMAGE_READING_STABILITY_RELEASE_2026-11-06.md) owns official
artifact hashes, OCI/config identity, stopped-writer backup, deployment and preservation
evidence. [Adaptive ZIP contract](docs/system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md)
owns qualification and compatibility details.

Deployment initially kept all four backup points and sixteen role tags. The
subsequent explicit cleanup request retained the two newly reverified backups
`chat-reader-20261106T140111Z` and `chat-reader-20261105T160504Z`, removing only
two older verified points and eight unreferenced old image tags (four image configs).
Current/direct rollback role tags remain; release archives/evidence and user data
were not deleted. See the [cleanup receipt](docs/execution/IMAGE_READING_STABILITY_RELEASE_2026-11-06.md#subsequent-authorized-cleanup).
Direct rollback `67e6336`
supports the same 0059 schema, but still needs stopped-writer/job/data checks.
Never automatically downgrade. Post-cleanup disk check: **85% used,
6,167,416 KiB free** at **14:53:09Z**, approximately **2.18 GiB** more filesystem
space available.
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
Exact `9cf235f` is fully green. The subsequent explicit “部署” request authorized
the accepted release above; deployment and independent recheck are complete.
The CI recheck remains paused; no schedule was created or resumed.
Deployment itself did not authorize cleanup. A later explicit request authorized
only the bounded old-backup/image retention above, not broader cleanup or replaying
the user's source ZIP.
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
