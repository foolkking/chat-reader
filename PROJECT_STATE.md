# Project State

## Current release — 2026-10-06

Production `https://chat.king.2bd.net` runs application source
**25c7f6a16f72780b08b22f1f3bf23665ebfd300c**, built only by successful
[CI 37453812341](https://github.com/foolkking/chat-reader/actions/runs/37453812341).
All five gates passed. Original artifact **11409659316**, producer attempt **1**,
was independently verified, including all 50 archive blobs/configs. Alembic remains
**20261006_0048**, single head/current.
[Stage and release evidence](docs/execution/TASK_CENTER_CLARITY_2026-10-06.md)
records tests, operational interruptions, acceptance, cleanup and scope limits.
The documentation closeout is a separate commit.

Tasks now distinguish operation, source, format and server submission time. Failed
and partial results precede completed work; cancelled work is separate. Completed
work has no misleading full progress bar or redundant single-item counter. Retry
and cancel preserve keyboard focus. Same-generation background polling no longer
loses regenerated exports, and late task callbacks cannot repopulate another
account's cache. PostgreSQL single-export completion records one package consistently.

Production checks passed for task source/format/counters, real batch and attachment
ZIP downloads, **74 object checksums**, regeneration/idempotency and physical close
reclamation. Four direct formats, Context/Range, login/settings and three default
Skill Bundles also passed. Canonical data, personal Skill fingerprints, **301 attachment
checksums**, imports/offline fingerprints, PostgreSQL identity/start time, environment,
Compose and Nginx remain unchanged. API/Web are healthy and worker heartbeat is alive.

Latest verified backups: `chat-reader-20261006T093548Z` and
`chat-reader-20261006T113958Z`. Three identical components were reused, avoiding
**623,608,310 bytes**. After acceptance, one older backup and four replaced **f0e355a**
image tags were removed. Its verified recovery archive remains; rollback requires
loading it first. Final available server space: **15,674,314,752 bytes (14.60 GiB)**.
No local/server image builds, local cleanup, off-site copy or scheduled backups.

The preceding coherent attachment snapshot/export and three-minute Root-controlled
artifact lifetime releases remain in effect. No schema or package-format migration
was introduced by this Task Center stage.

## Active work

The Task Center stage is deployed and accepted. Do not repeat its backup, deployment
or cleanup. The continuous optimization goal remains active; the next stage should
start with a fresh evidence-based product/runtime review. No further implementation
is claimed by this release. The unrelated earlier Next stream-close observation
remains unproven and is not claimed fixed. Off-site copies remain deferred.

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

Exact-source CI 37453812341: API **1003 passed / 3 skipped**, settings **173** plus
**1** fresh PostgreSQL archive restore; Context **35**, authentication **18**, offline
negatives **17**, baseline PWA **135 / 321 gated skips**. Reader/Share/upload, source
editor, PDF/CSP, lint/typecheck/build, migration and image checks passed. Runtime/Bundle
**64** and cleanup **53** passed. Suites overlap; skips are not passes.

The initial 5f5126c CI failed one real maintenance regeneration case (169 passed /
1 failed); no images from that source were deployed. Source 25c7f6a fixes the race.
The original failure, deliberately delayed polling/option-change case, two
same-document account-switch races and persisted export counters all passed.
Final 375/768/1440px synthetic screenshots were inspected in both locales/themes.
Actual ZIP contents were checked by real API/PostgreSQL/worker browser tests.

Local follow-up TypeScript (nonincremental) and changed-file ESLint passed. No local
runtime/browser test is claimed for this stage: C-drive temporary capacity is exhausted,
and the unanswered batch-specific E-drive exception was not used. Image download and
release preparation ran in memory, streaming verified members to the server.

Production smoke is separate from CI; no full interactive production browser matrix
is claimed. SMTP remains unconfigured. Deployment initially recovered the old API/worker
after a mounted check script lacked non-root read permission; correcting those two
script modes and rechecking the recent backup allowed successful completion. Web's
initial health check was still starting; acceptance resumed after it became healthy.
Local residues remain for the user.

## Work rules and navigation

Read [AGENTS.md](AGENTS.md), then [docs index](docs/index.md). Temporary files use
`C:/Users/86182/Desktop/wkkk/<task>` with process-local TEMP/TMP. This stage uses
`wkkk/chat-reader-task-center-20261006` only as a process-local TEMP/TMP setting;
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
