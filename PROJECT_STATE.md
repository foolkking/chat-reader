# Project State

Last updated: 2026-10-08. This is the current snapshot, not a release history.

## Release and active work

| Item | Verified state |
| --- | --- |
| Production | Source `b45f04939a728c86bbff769c36ea7574d6a1856d`; accepted [CI 37470769275](https://github.com/foolkking/chat-reader/actions/runs/37470769275), all five gates |
| Production database | `20261006_0048`; API/Web/PostgreSQL healthy and worker running at the latest read-only check |
| Current release candidate | Import-retry transport correction prepared; a new complete exact-source CI is required |
| Source migration | Single head `20261008_0050`, following 0049; not yet deployed |
| Latest completed candidate CI | `7825e60` / [37767854364](https://github.com/foolkking/chat-reader/actions/runs/37767854364): API and all 13 Web gates pass; settings **438 passed / 1 failed / 0 skipped**; images not built |
| Release owner | [Accumulated optimization release](docs/execution/OPTIMIZATION_RELEASE_2026-10-08.md) owns exact commits, every failed run, artifacts and acceptance |

The user authorized this order: commit accumulated improvements, pass complete
exact-source CI, deploy those verified images to King, then continue the
ordinary-user product audit. The persistent goal remains active. At least 15
improvements was not a ceiling; over 30 scoped batches are already accumulated.
Do not repeat the previously accepted Context/Skill/Task Center deployments.
Do not use subagents unless the user newly requests them.

All three cache-count cases now pass, including actual zero-cache, download,
cancellation and persistence assertions. The remaining import-retry case removed
its 503 interception before clicking, allowing background refresh to remove the
button. The candidate retains the outage until the real click and saves synthetic
recovery screenshots. CI must prove it; no production changes or deployable artifact exist yet.
The [search filter audit](docs/execution/ux-audit-search-filter-race-2026-10-08.md)
records the separately reproduced and CI-verified rapid-input/history repair.

## Verification boundaries and release safety

- Local lint, nonincremental typecheck, bounded Web build, 33 focused offline/task
  API cases and single source head 0050 have passing evidence. Latest full API CI:
  **1,181 passed / 3 skipped**. Suites overlap; do not add them as unique cases.
- In the latest completed candidate CI, all 13 Web gates pass, including the
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
- Before release, verify provenance, attachment storage, capacity and a consistent
  five-component backup. Stop API/worker writers for 0048→0050, not PostgreSQL.
  Use `--no-deps --no-build`; no automatic database downgrade or data restore.
- Current verified backups: `chat-reader-20261006T113958Z` and
  `chat-reader-20261006T141424Z`. Keep two verified points; a temporary third
  during acceptance is expected. Never prune before successful acceptance.
  No off-site or scheduled backup is configured.
- Current rollback points to the older 25c7f6a archive, which needs loading.
  The next accepted release must preserve the currently deployed b45f049 images
  as its rollback pair. Follow [deployment](docs/deployment.md), not old commands
  copied from dated execution records.

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
The follow-on product audit has not started; release acceptance comes first.

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

Next: finish candidate CI, inspect its original artifact, complete guarded release
acceptance, update this snapshot, then audit ordinary-user opportunities from
observed evidence before making further product changes.
