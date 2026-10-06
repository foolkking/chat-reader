# Project State

## Current release — 2026-10-06

Production `https://chat.king.2bd.net` runs application source **bdfb7257341f0f74685de4ad80e339fbde525ab7** from
successful [CI 37411587470](https://github.com/foolkking/chat-reader/actions/runs/37411587470).
All five jobs passed. A consumer-only rerun also passed using the same immutable
artifact **11389837379**; the producer remained attempt 1 and images were built
only once. Alembic remains **20261006_0048**, the single head/current.

`source-map-js` is now upstream **1.2.2**, resolving GHSA-68fv-2mgg-jv7q without
adding an audit exception. Nine dependency regressions and the full CI gate pass.
Production login, settings, exact Skill ZIPs, export Range/ZIP, close/reclamation,
idempotent regeneration and runtime checks pass. PostgreSQL identity/start,
canonical counts, personal Skill aggregates, all 301 attachment checksums, imports
and offline fingerprints are unchanged. Environment, Compose and Nginx are unchanged.
[Deployment evidence](docs/execution/DEPLOYMENT_SOURCE_MAP_2026-10-06.md) owns exact provenance and limits.

Latest two verified backups: `chat-reader-20261006T025905Z`, `chat-reader-20261006T043843Z`.
The new backup reused three byte-identical components, avoiding **623,608,310 bytes**
of duplication. Older verified backup retention and four replaced **6b4ee0a** image
tag removals completed after acceptance. Its verified recovery archive remains;
rollback requires loading it first. These are two logical recovery points that can
share physical files. No scheduled backup or off-site copy was added.
Final available server space is **14.39 GiB**. No local/server image build,
business-volume deletion or local-residue cleanup occurred.

Temporary exports retain the previously deployed three-minute default and explicit
close release, with active-download protection, expiration and regeneration. Root
controls 1–60 minutes and release-on-close; legacy exports keep their deadline.
The earlier 57-file reclamation is recorded in the
[export retention release](docs/execution/DEPLOYMENT_EXPORT_RETENTION_2026-10-06.md),
not counted again as this release's cleanup.

## Active work

Direct Markdown/CanJSON/legacy JSON downloads now prepare bytes from one
PostgreSQL read-only repeatable-read snapshot and release the connection before
delivery. A private spool spills above 1 MiB and closes on completion/failure;
storage failures return retryable 503. The download control retains Reader,
supports cancel/retry, and fences account/option changes. This follow-up is
**local, not yet deployed**; production remains the source above.
[Implementation and acceptance](docs/execution/DIRECT_EXPORT_SNAPSHOT_2026-10-06.md)
records the real concurrent-edit reproduction, checks and remaining release work.

The export/backup stage and this dependency/CI retry follow-up are delivered.
The long-running continuous optimization goal remains active. Off-site copies are
explicitly deferred; do not ask for a destination or upload them.

[Retry evidence](docs/execution/CI_ARTIFACT_RETRY_2026-10-06.md) records 25 local
contract checks and the successful real consumer-only rerun. GitHub creates new
records for carried-forward successful jobs; unchanged timestamps/steps/runner and
byte-identical build logs establish that they were not executed again.

The first source `f59247b`, CI `37409815492`, failed the newly matched source-map-js
advisory; API/settings passed and build/inspection were skipped. The final source
upgrades only the affected dependency and regression gate, preserving unrelated
lock metadata. [Security evidence](docs/execution/SOURCE_MAP_SECURITY_2026-10-06.md)
records local failures/corrections, successful final CI and the completed release.

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

Exact deployed-source CI: API **929 / 3 skipped**,
Context **35**, authenticated settings **147** plus **1** fresh
PostgreSQL restore, authentication **18**, offline negatives **17**, baseline PWA
**134 / 295 skipped**, plus Reader/Share/upload/PDF/CSP, lint, typecheck,
build, migration and image checks. Suites overlap; skips are not passes.
Local legacy-download browser verification passed; previous baseline was **138 / 294 skipped**.
Production HTTP/data checks are separate from CI browser coverage; no full interactive
production browser matrix is claimed. SMTP is unconfigured; actual mail delivery
remains unavailable. Earlier stream-close observations are not claimed fixed here.

## Work rules and navigation

Read [AGENTS.md](AGENTS.md), then [docs index](docs/index.md). Temporary files use
`C:/Users/86182/Desktop/wkkk/<task>` with process-local TEMP/TMP. This release uses
`wkkk/chat-reader-ci-artifact-retry-20261006`. The earlier E-drive test exception was batch
specific. Do not scan the local workstation, build images locally/on King, modify
user imports, delete production volumes or overwrite the server environment.
Existing unrelated tsbuildinfo and auth-resume test directories remain untouched.

Required checks are `corepack pnpm run lint`, `corepack pnpm run typecheck`,
`corepack pnpm --filter web build`, `corepack pnpm run test:api`,
`cd apps/api; python -m alembic heads` and `corepack pnpm --filter web test:pwa`,
plus risk-appropriate authenticated, PostgreSQL, Reader/Share/offline suites.

Current facts belong here or in `docs/system/`; dated plans/execution/evidence are
historical. Follow the [documentation inventory](docs/documentation-inventory.md).
