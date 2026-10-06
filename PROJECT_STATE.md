# Project State

## Current release — 2026-10-06

Production `https://chat.king.2bd.net` runs application source
**b45f04939a728c86bbff769c36ea7574d6a1856d**, built only by successful
[CI 37470769275](https://github.com/foolkking/chat-reader/actions/runs/37470769275).
All five gates passed. Original artifact **11419041245**, producer attempt **1**,
was independently verified, including 50 image archive blobs/configs and 17 exact-source
support paths. Alembic remains **20261006_0048**, single head/current.
[Stage and release evidence](docs/execution/CONTEXT_EXPORT_INTEGRITY_2026-10-06.md)
records the reproduced defects, tests, release, reviewed interruptions and limitations.
The documentation closeout is a separate commit.

Context export now verifies copied attachment bytes, removes failed staging/results,
streams message bodies and JSONL, respects selected-range limits, and rejects source
or access changes during publication. Permanent exports read one PostgreSQL snapshot;
final live checks and transaction-owned file cleanup protect delivery. Progress no
longer drops from serialization to packaging, and actionable failures are localized.
Missing objects remain explicitly partial; saved Current/Index are still user-managed
files without semantic validation, candidates or adoption.

Production checks passed for login/settings, all three default Skill ZIPs, direct
exports, batch exports, three attachment/Context formats with **148 object checksum
checks**, Range/ZIP delivery, regeneration and physical close reclamation. Canonical
counts, personal Skill state, **301 stored attachment checksums**, imports/offline
fingerprints and private Context tables remained unchanged. The private Context
snapshot was empty; nonempty member preservation is covered by CI. PostgreSQL
identity/start time, environment, Compose and Nginx were preserved. API/Web are healthy
and worker heartbeat is alive/idle.

Latest verified backups: `chat-reader-20261006T113958Z` and
`chat-reader-20261006T141424Z`. After acceptance, one older backup and four replaced
**25c7f6a** image tags were removed. The verified 25c7f6a rollback archive remains;
load it before rollback. Final available server space: **15,477,846,016 bytes
(14.41 GiB)**. No local/server image builds, local cleanup, off-site copy or scheduled
backups. One malformed Server Action reference was rejected with 404 and reviewed;
no unreviewed startup error, restart or OOM remained at acceptance.

The preceding [Task Center release](docs/execution/TASK_CENTER_CLARITY_2026-10-06.md),
attachment bundle consistency and Root-controlled three-minute artifact lifetime
remain in effect. This stage introduces no schema or package-format migration.

## Active work

The Context export stage is deployed and accepted. Do not repeat its backup,
deployment or cleanup. The broad optimization goal remains active; the next stage
must begin with a fresh product/runtime audit and prioritize demonstrated user value.
This scoped stage does not close every page, offline UX or external semantic Skill
review. The unrelated earlier Next stream-close observation remains unproven and
is not claimed fixed. Off-site copies remain deferred.

## System and boundaries

- Next.js 16 / React 19 / TypeScript Web; FastAPI / SQLAlchemy API; PostgreSQL;
  one concurrent background worker. Corepack + pnpm 9.15.4, Python 3.11+.
- Browser requests use same-origin `/api/*`. `API_INTERNAL_URL` supplies Next
  rewrites at build time as well as runtime; local test builds must use their
  isolated API address. Production uses prebuilt, CI-gated images.
- Canonical PostgreSQL data, current code and Alembic are the authority. Raw
  import files and Continuation are not a second source of rendered truth.
- Projects/Unclassified → Conversation → Reader. Owner, public Share and Offline
  Reader retain separate access boundaries, complete turns and real DOM anchors.
- `/library` uses Dexie version 2 and offline package v3, retaining v1/v2/v3 reads
  and existing local data. Failed replacement preserves the last readable copy.
- Server-authenticated UUID scopes private rows, tasks and downloads. The single
  deployment-managed Root Admin has audited cross-account tools; normal accounts
  cannot inherit identity from a client-supplied ID. Share URLs remain separate
  token-scoped capabilities with their existing password/expiry semantics.
- Authorization expiry locks protected local data. The same server-verified UUID
  can resume it; another account cannot read or claim it. Signout and destructive
  cleanup account for pending edits and durable Continuation drafts.

## Current product decisions

| Area | Current behavior |
|---|---|
| Context files | The conversation workspace beside annotations reads/edits/drops Current and Index; updates save directly, preserving the other member and the latest three snapshots. No semantic validation, candidate or adoption UI. |
| Context return | A `.context.zip` belongs to that conversation workspace, separate from ordinary import. Returns extract members without changing Raw or attachments. No global Context page. |
| Context delivery | Always `.context.zip`, independent of attachment inclusion. Full export may include saved files without endorsing their claims; restricted scope excludes private Continuation. Share excludes it. |
| Skills | Personal/system upload and replacement accept ZIP or Markdown; Markdown becomes a same-name compatibility ZIP without rewriting instructions. No Skill viewer/editor/history UI; personal choices survive system updates. |
| System defaults | Only the user-supplied Acquisition, Maintainer and Normalizer ZIPs, unchanged bytes. External reviewed runtime Bundles are separate deliverables, not defaults. |
| External maintenance | No model calls or execution of uploaded scripts. Reviewed tooling supports OLD continuation + NEW Raw comparison and out-of-place output preserving NEW Raw/assets. Independent external model use is not verified. |
| Settings | Personal settings precede Root tools. Redundant introductions are removed; failures, conflicts and destructive consequences remain. Help metadata is a footer; share details open on hover/focus/tap. |
| Archives | `.cr` restore belongs to Settings → Data & backup. Personal additive restore previews and deduplicates; system v5 preserves ownership. Prior archive formats remain readable. |
| Learned formats/rules | Stable revisions, acquired permissions and explicit system publication/withdrawal. Personal controls do not alter global defaults. Noise defaults to keep; explicit review creates normal message versions. |
| Synchronization | Account preference field revisions, real reading anchors, outbox confirmation/retries/conflicts and offline account fences. Remote position changes do not force the active Reader to jump. |
| Admin | Search/paginated users, approval/status/session/reset/delete, invitations/audit, read-only cross-user Reader and bounded runtime state. Shared objects survive when others still reference them. |

Production includes the guidance described above. The original
[threshold proposal](docs/planning/CONTEXT_MAINTENANCE_GUIDANCE_2026-10-03.md) is
superseded by the user's uncovered-Index-range rule. Skill inline-version
editing stage was superseded by the confirmed replacement-only Bundle design.
SMTP is unconfigured in the verified production snapshot; email delivery remains
unavailable until the operator configures it. Administrator reset links remain.

## Verification

Exact-source CI 37470769275: API **1042 passed / 3 skipped**, settings **176** plus
**1** fresh PostgreSQL restore; Context **35**, authentication **18**, offline negatives
**17**, baseline PWA **135 / 324 gated skips**. Reader/Share/upload, source editor,
PDF/CSP, lint/typecheck/build, migration and image checks passed. Runtime/Bundle
**64** and cleanup **53** passed. Suites overlap; skips are not passes. New Context
coverage includes **26 integrity/streaming** and **13 actual PostgreSQL publication**
cases, including source changes after physical publication.

The first d89c3d7 CI failed one archive fixture duplicate-account setup
(**1041 passed / 1 failed / 3 skipped**); no failed-source images were deployed.
The follow-up fixes fixture ownership without weakening account checks and preserves
monotonic export progress. Final three-width corruption → repair → real ZIP download
screenshots were inspected in both locales/themes. Actual object hashes, persisted
results, cleanup, selected sequence numbers and large-source cancellation were checked.

Local nonincremental TypeScript and changed-file ESLint passed. Isolated synthetic
SQLite/file/worker tests ran in networkless disposable containers using the existing
CI image with source overlays. No local runtime/browser test or local image build
is claimed: C-drive temporary capacity is exhausted; no new E-drive exception was
assumed. Transfers stayed in memory and the private server release directory.

Production smoke is separate from CI; no full interactive production browser matrix
or independent external-model semantic trial is claimed. SMTP remains unconfigured.
Finalization initially stopped on a malformed Server Action reference. Nginx showed
its rejection at `/login` with 404; only that exact reviewed log was allowed, with
all others still blocking. A stale short source label in the post-cleanup evidence
helper was replaced with the actual release directory name and the read-only check
rerun. Neither correction changed application images or production configuration.

## Work rules and navigation

Read [AGENTS.md](AGENTS.md), then [docs index](docs/index.md). Temporary files use
`C:/Users/86182/Desktop/wkkk/<task>` with process-local TEMP/TMP. This stage uses
`wkkk/chat-reader-context-integrity-20261006` only as a process-local TEMP/TMP setting;
release transfers use memory and the server release directory. The earlier E-drive test exception was batch
specific. Do not scan the local workstation, build images locally/on King, modify
user imports, delete production volumes or overwrite the server environment.
Existing unrelated tsbuildinfo and auth-resume test directories remain untouched.

Required checks are `corepack pnpm run lint`, `corepack pnpm run typecheck`,
`corepack pnpm --filter web build`, `corepack pnpm run test:api`,
`cd apps/api; python -m alembic heads` and `corepack pnpm --filter web test:pwa`,
plus risk-appropriate authenticated, PostgreSQL, Reader/Share/offline suites.

Current facts belong here or in `docs/system/`; dated plans/execution/evidence are
historical. Follow the [documentation inventory](docs/documentation-inventory.md).
