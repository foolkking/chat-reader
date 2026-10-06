# Project State

## Current release — 2026-10-06

Production `https://chat.king.2bd.net` runs application source
**e27f415024252eaffa527957a37766699a6962a9**, built only by successful
[CI 37419965889](https://github.com/foolkking/chat-reader/actions/runs/37419965889).
All five gates passed; artifact **11392973308**, producer attempt **1**, was
independently checked. Alembic remains **20261006_0048**, single head/current.
[Release evidence](docs/execution/DIRECT_EXPORT_SNAPSHOT_2026-10-06.md) owns exact
provenance, acceptance, cleanup and the remaining scope limits.

Direct Markdown/CanJSON/legacy JSON downloads now prepare one PostgreSQL
read-only repeatable-read snapshot. A private spool spills above 1 MiB; the
database connection is released before download delivery. Completion, cancellation
and failures close the spool. Storage errors return retryable 503. The Web
download action retains Reader, supports cancel/retry and fences account/option
changes. Actual UTF-8 filenames and file contents passed local, CI and production
checks. Background attachment bundles do not gain a new full-snapshot guarantee.

Production settings, Skill Bundles, four direct formats, Context ZIP/Range,
close/reclamation/regeneration and runtime checks passed. Canonical data counts,
personal Skill fingerprints, 301 attachment checksums, imports/offline fingerprints,
PostgreSQL identity/start time, environment, Compose and Nginx remain unchanged.

Latest verified backups: `chat-reader-20261006T043843Z` and
`chat-reader-20261006T061915Z`. The new backup reused three identical components,
avoiding **623,608,310 bytes**. Post-acceptance retention removed one older backup
and the four replaced **bdfb725** image tags. Its verified recovery archive remains;
rollback requires loading that archive first. Final server available space:
**15.18 GiB**. No local/server image builds or local-residue cleanup occurred.

Temporary retained exports keep the three-minute default and explicit close
release, active-transfer protection and regeneration. Root controls 1–60 minutes
and release-on-close. Direct-download spools close immediately after transfer;
they are not retained artifacts. Existing deadlines remain unchanged. The source-map-js
1.2.2 security fix and immutable-artifact retry support from the
[previous release](docs/execution/DEPLOYMENT_SOURCE_MAP_2026-10-06.md) remain.

## Active work

Batch export recovery is implemented locally and awaiting its own CI/release.
Conversation/project lists now queue one durable CanJSON ZIP job, with selection
retention, same-key admission retry, account fencing and Task Center delivery.
The worker prepares the whole batch under one PostgreSQL snapshot and reuses
export cancellation/expiry/regeneration. No migration. This code is not yet
deployed. [Stage evidence](docs/execution/BATCH_EXPORT_RECOVERY_2026-10-06.md)
records the real failure, local tests and remaining release checks.

The direct-export snapshot/download-recovery stage is delivered. The long-running
continuous optimization goal remains active. Off-site copies are explicitly
deferred; do not ask for a destination or upload them. No scheduled backups were
added. Snapshot preparation needs temporary capacity and delays first byte;
the unrelated earlier Next stream-close observation is not claimed fixed.

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

Exact-source CI: API **940 passed / 3 skipped**, Context **35**, authenticated
settings **157** plus **1** fresh PostgreSQL archive restore, authentication **18**,
offline negatives **17**, baseline PWA **134 / 305 skipped**, and Reader/Share,
upload/PDF/CSP, lint, typecheck, build, migration and image gates all passed.
Suites overlap; gated-off cases and missing external fixtures are not passes.
Local focused backend: **60 / 1 skipped** (Windows symlink unavailable); browser:
**10 passed**, 375/768/1440px, Chinese/light and English/dark, with real files,
retry/cancel/options/closure and account changes. Initial fixture failures were
corrected and recorded. No full interactive production browser matrix is claimed.
SMTP remains unconfigured; actual external mail delivery remains unavailable.

## Work rules and navigation

Read [AGENTS.md](AGENTS.md), then [docs index](docs/index.md). Temporary files use
`C:/Users/86182/Desktop/wkkk/<task>` with process-local TEMP/TMP. This release uses
`wkkk/chat-reader-export-snapshot-20261006`. The earlier E-drive test exception was batch
specific. Do not scan the local workstation, build images locally/on King, modify
user imports, delete production volumes or overwrite the server environment.
Existing unrelated tsbuildinfo and auth-resume test directories remain untouched.

Required checks are `corepack pnpm run lint`, `corepack pnpm run typecheck`,
`corepack pnpm --filter web build`, `corepack pnpm run test:api`,
`cd apps/api; python -m alembic heads` and `corepack pnpm --filter web test:pwa`,
plus risk-appropriate authenticated, PostgreSQL, Reader/Share/offline suites.

Current facts belong here or in `docs/system/`; dated plans/execution/evidence are
historical. Follow the [documentation inventory](docs/documentation-inventory.md).
