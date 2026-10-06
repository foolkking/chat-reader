# Project State

## Current release — 2026-10-06

Production `https://chat.king.2bd.net` runs application source
**aee64ff6146d3ac915b2a281aac3bc040268ffed**, built only by successful
[CI 37429071820](https://github.com/foolkking/chat-reader/actions/runs/37429071820).
All five gates passed. Original artifact **11396964056**, producer attempt **1**,
was independently verified. Alembic remains **20261006_0048**, single head/current.
[Release evidence](docs/execution/BATCH_EXPORT_RECOVERY_2026-10-06.md) owns provenance,
local/CI/production checks, cleanup and the remaining scope limits.

Conversation and project lists now submit one durable batch CanJSON ZIP job.
Failed submission retains selection; a lost response can safely retry the same
key. Task Center provides progress, cancellation, retry and download after page
closure/refresh. Late responses cannot populate another account's task cache.
The single worker streams all selected conversations under one PostgreSQL
read-only repeatable-read snapshot. Ordinary failures/cancellation/commit rollback
remove new files. Entry/compressed/expanded limits bound the batch. Its numbered
CanJSON files preserve the previous output format, without binary attachments,
annotations, notebook or Continuation. No schema migration was introduced.

Direct Markdown/CanJSON/legacy JSON snapshot preparation and private spooling
from e27f415 remain. Background attachment bundles do not gain a new full-snapshot
guarantee. Temporary exports retain Root-controlled three-minute default expiry,
explicit close, active-transfer protection and regeneration. Direct spools close
after transfer. Existing export deadlines remain unchanged.

Production batch ZIP/order/content, idempotent submission, physical close release,
private access, settings, three default Skill Bundles, four direct formats,
Context ZIP/Range and regeneration passed. Canonical counts, personal Skill
fingerprints, 301 attachment checksums, imports/offline fingerprints, PostgreSQL
identity/start time, environment, Compose and Nginx remain unchanged.

Latest verified backups: `chat-reader-20261006T061915Z` and
`chat-reader-20261006T075948Z`. The new backup reused three identical components,
avoiding **623,608,310 bytes**. After acceptance, one older backup and the four
replaced **e27f415** image tags were removed. Its verified recovery archive remains;
rollback requires loading that archive first. Final server available space:
**16,091,594,752 bytes (14.99 GiB)**. No local/server image builds or local cleanup.

## Active work

The durable batch-export stage is delivered. The continuous optimization goal
remains active. Follow-up observations: repeated exports in Task Center can be
hard to distinguish; background attachment-bundle snapshot consistency needs its
own reproduction. Neither is claimed fixed here. Off-site copies remain deferred;
no scheduled backups were added. The unrelated earlier Next stream-close
observation remains unproven and is not claimed fixed.

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

Exact-source CI: API **964 passed / 3 skipped**, settings **164** plus **1** fresh
PostgreSQL archive restore; Context **35**, authentication **18**, offline negatives
**17**, baseline PWA **134 / 312 gated skips**. Reader/Share/upload, source editor,
PDF/CSP, lint/typecheck/build, migration and image gates passed. Runtime/Bundle
checks **64** and cleanup **53** passed. Suites overlap; skipped/gated cases are
not passes. External sample requirements remain documented by their tests.

Local batch API: **17**; batch PostgreSQL: **7**; related snapshot/artifact/cleanup:
**24 / 1 Windows symlink skip**. Shared retention and actual retry service also
passed. Browser: **7**, including 375/768/1440px, Chinese/light, English/dark,
keyboard, real downloaded contents/order, lost-response retry, refresh,
regeneration and account switching. Initial test/setup corrections are recorded.
No full interactive production browser matrix is claimed. SMTP is unconfigured;
actual external delivery remains unavailable.

## Work rules and navigation

Read [AGENTS.md](AGENTS.md), then [docs index](docs/index.md). Temporary files use
`C:/Users/86182/Desktop/wkkk/<task>` with process-local TEMP/TMP. This release uses
`wkkk/chat-reader-batch-export-20261006`. The earlier E-drive test exception was batch
specific. Do not scan the local workstation, build images locally/on King, modify
user imports, delete production volumes or overwrite the server environment.
Existing unrelated tsbuildinfo and auth-resume test directories remain untouched.

Required checks are `corepack pnpm run lint`, `corepack pnpm run typecheck`,
`corepack pnpm --filter web build`, `corepack pnpm run test:api`,
`cd apps/api; python -m alembic heads` and `corepack pnpm --filter web test:pwa`,
plus risk-appropriate authenticated, PostgreSQL, Reader/Share/offline suites.

Current facts belong here or in `docs/system/`; dated plans/execution/evidence are
historical. Follow the [documentation inventory](docs/documentation-inventory.md).
