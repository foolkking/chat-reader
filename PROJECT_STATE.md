# Project State

## Current release — 2026-10-06

Production `https://chat.king.2bd.net` runs application source **6b4ee0aec8bf399d2bd5eefabfb9c538f2933632** from
successful [CI 37366294097](https://github.com/foolkking/chat-reader/actions/runs/37366294097).
All five jobs passed. Alembic is **20261006_0048**, the single head/current.
Temporary exports default to three minutes and explicit-close release, with real
download protection, expiration status and idempotent regeneration. Root controls
the duration (1–60 minutes) and release-on-close; legacy exports keep their deadline.

Historical expired exports: **57**, **1,118,258,860 bytes**, now
physically reclaimed with no remaining files or retries. Production HTTP, Range/ZIP,
close/reclamation/regeneration and runtime checks pass. PostgreSQL identity/start,
canonical data, personal Skills, all 301 attachment checksums, imports and offline
file fingerprints are unchanged. Environment, Compose and Nginx remain unchanged.
[Deployment evidence](docs/execution/DEPLOYMENT_EXPORT_RETENTION_2026-10-06.md) owns exact provenance and limits.

Latest two verified backups: `chat-reader-20261005T162912Z`, `chat-reader-20261006T025905Z`. Byte-identical components may be shared;
these are two logical recovery points, not independent physical copies. Backup tools
are installed; after release acceptance, the retention command removes older verified
points. No scheduled backup or off-site copy was added. Four replaced `5d48b68`
image tags and this task's unused candidate transfer were removed; the verified
5d48b68 rollback archive remains and must be loaded before rollback. Final available
space is **14.63 GiB**. No local/server image build or business-volume deletion occurred.

## Active work

[Export retention and backup plan](docs/planning/EXPORT_RETENTION_AND_BACKUP_2026-10-06.md)
is delivered. [Implementation history](docs/execution/EXPORT_RETENTION_2026-10-06.md)
records failed gates, corrections and local evidence. The user explicitly deferred
off-site copies; do not ask for a destination or upload them. The long-running
continuous optimization goal remains active; this release completes this stage.

The next scoped improvement fixes independent CI artifact retries. The workflow
now passes the successful builder's immutable artifact ID and original attempt
to its consumer instead of guessing a filename from the retry's attempt. Local
execution of the actual guards/filters passed **25** positive/negative cases
without Docker; exact-source full CI and a consumer-only rerun are still pending.
See [retry verification](docs/execution/CI_ARTIFACT_RETRY_2026-10-06.md). This changes
release tooling only; the production application source above is unchanged.

That first CI attempt (`37409815492`, source `f59247b`) was blocked by the official
npm audit: newly matched GHSA-68fv-2mgg-jv7q affects source-map-js 1.2.1 through
PostCSS. The follow-up pins upstream **1.2.2**, preserves the existing platform
metadata and adds bounded behavior regressions. Local audit has no unapproved
high/critical findings; 9 dependency regressions, lint and typecheck pass.
The local production build also passes. Final CI, consumer-only retry and the dependency release remain pending;
[security evidence](docs/execution/SOURCE_MAP_SECURITY_2026-10-06.md) records the scope.

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
`wkkk/chat-reader-export-final-20261006`. The earlier E-drive test exception was batch
specific. Do not scan the local workstation, build images locally/on King, modify
user imports, delete production volumes or overwrite the server environment.
Existing unrelated tsbuildinfo and auth-resume test directories remain untouched.

Required checks are `corepack pnpm run lint`, `corepack pnpm run typecheck`,
`corepack pnpm --filter web build`, `corepack pnpm run test:api`,
`cd apps/api; python -m alembic heads` and `corepack pnpm --filter web test:pwa`,
plus risk-appropriate authenticated, PostgreSQL, Reader/Share/offline suites.

Current facts belong here or in `docs/system/`; dated plans/execution/evidence are
historical. Follow the [documentation inventory](docs/documentation-inventory.md).
