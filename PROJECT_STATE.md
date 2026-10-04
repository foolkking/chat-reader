# Project State

## Current release and active work — 2026-10-04

Production `https://chat.king.2bd.net` runs source
**0219fd5c5facfd6c57a5d651e74e7e58ff6b62eb**, built by successful
[CI 37143028696](https://github.com/foolkking/chat-reader/actions/runs/37143028696).
Alembic is **20261003_0046**, the single repository head and verified production current.
The Context migration and settings cleanup are deployed. Production checks cover
backup, immutable image provenance, unchanged database identity/environment,
canonical counts, all 301 attachment checksums, the three pinned Skill ZIPs,
authentication/logout and settings at 375/768/1440px.
[Deployment record](docs/execution/DEPLOYMENT_CONTEXT_2026-10-04.md) records attempts,
limits and retained rollback `ad223cd`.

The **subsequent whole-site UX round** implements 18 separate usability improvements.
Input protection, project settings/menu/appearance, phone project creation, search,
attachment recovery and bounded task summaries are implemented and locally verified (14 final focused browser cases; API
867 passed/4 skipped). Complete CI is the separate release gate for this commit. This round is **not deployed**.
[Audit](docs/evidence/ux-audit-whole-site-2026-10-04.md) owns findings and evidence;
[execution](docs/execution/WHOLE_SITE_UX_2026-10-04.md) owns verification and failures.
Do not treat the earlier release's CI as proof for the new changes.

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

Long-conversation maintenance guidance remains a
[proposal](docs/planning/CONTEXT_MAINTENANCE_GUIDANCE_2026-10-03.md).
No threshold reminder has been implemented. The original Skill inline-version
editing stage was superseded by the confirmed replacement-only Bundle design.
SMTP is unconfigured in the verified production snapshot; email delivery remains
unavailable until the operator configures it. Administrator reset links remain.

## Verification and next action

The deployed source passed API 868/3 skipped, Context browser 30, authenticated
browser 18, settings 126 plus fresh restore, PDF 5 and offline negatives 17.
Default PWA: 134 passed/250 mode-specific skips. Suites overlap; do not sum them.
The current UX round passes build/lint/typecheck, API 867/4 skipped and focused
UX 14/14; related offline/Share/source/Task Center/DnD checks pass as recorded
in its execution record. CI for the committed revision owns the full PWA gate.

The UX implementation is complete; its committed source must pass the complete
GitHub release workflow before release. A second
production deployment is a separate step; it has not been performed or authorized
for this UX round. No new migration is introduced by its presentation changes.

## Work rules and navigation

Read [AGENTS.md](AGENTS.md). Default temporary root is
`C:/Users/86182/Desktop/wkkk`, with per-task directories and process-local TEMP/TMP.
This test batch has explicit permission for `E:/1project/chat-reader/.tmp/context-tests`.
Do not touch user imports, delete production volumes, overwrite server environment,
clean unrelated caches or include credentials/private content in evidence.

| Command | Purpose |
|---|---|
| `corepack pnpm run lint` | Web lint |
| `corepack pnpm run typecheck` | Web TypeScript |
| `corepack pnpm --filter web build` | Production Web build |
| `corepack pnpm run test:api` | API tests |
| `cd apps/api; python -m alembic heads` | Single migration head |
| `corepack pnpm --filter web test:pwa` | Browser/PWA baseline; optional flows have dedicated gates |

[Docs index](docs/index.md) routes to current Context, Skill, authentication,
Reader, frontend, import, cleanup, offline, archive and deployment contracts.
`apps/web/features/` owns product surfaces; `apps/web/lib/` owns client/offline
contracts; `apps/api/app/api/routes/`, `services/`, `models/` and `workers/` own
server behavior. `apps/web/e2e/`, `apps/api/tests/` and `.github/workflows/` own checks.
Plans/execution/evidence are dated records, not living product contracts.
The pre-closeout state is preserved in
[historical snapshot](docs/archive/PROJECT_STATE-history-2026-10-04.md).
