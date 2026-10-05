# Project State

## Current release — 2026-10-06

Production `https://chat.king.2bd.net` runs application source
**5d48b686893d44f98092dfffbfa32a4464e8ede1**, built by successful
[CI 37323431809](https://github.com/foolkking/chat-reader/actions/runs/37323431809),
attempt 1. Alembic is **20261005_0047**, the single head/current. Skill unification,
private support/limit requests, Normalizer discovery, copy recovery and mobile
sheet sizing are deployed, together with the earlier optional core guidance.
Subsequent test/documentation commits do not replace that application image identity.

Real login, 14 read-only settings/request endpoints, two owned guidance requests,
six resolved Bundle downloads across three purposes, exact public ZIP bytes,
logout/private 401, anonymous large-upload 401 and HTTPS checks pass. API/Web are
healthy; worker heartbeat is alive. PostgreSQL identity/start, server environment,
canonical counts and all 301 attachment checksums are unchanged. Compose only adds
two explicit import-limit declarations. The first mixed-newline helper failure
restored the old services before a fresh backup and successful retry.
[Deployment record](docs/execution/DEPLOYMENT_SUPPORT_2026-10-06.md) owns the evidence.

Latest two verified backups are `chat-reader-20261005T162104Z` and
`chat-reader-20261005T162912Z` (UTC names; local date October 6). Earlier backups
were removed under the user's explicit authorization. Four replaced `3f1d539`
image tags were deleted; its checked recovery archive remains. Rollback requires
loading that archive before using rollback-images.env. Final available space is
**12,737,072 KiB**, about **12.15 GiB**. No local or server image build was used.
Local residues remain for the user; no production volume or user import was deleted.

## Active work

Latest code is **6b4ee0aec8bf399d2bd5eefabfb9c538f2933632**. Final CI
**37366294097**, attempt 3, is waiting for hosted runners. Exact-source API
**929 passed / 3 skipped**, Web (including Context **35**, PWA **134 / 295 skipped**)
and settings **147** plus fresh PostgreSQL restore **1** passed. Attempt 2 built
the images, but independent inspection never started and was cancelled with
"The job was not acquired by Runner of type hosted even after multiple attempts".
Attempt 3 preserves successful quality gates and reruns build plus dependent
inspection so their artifact attempt identifiers match. GitHub's public status
reports **Actions major outage**, with Hosted Runner failures (2026-10-05 UTC).
Do not rebuild locally/on King or deploy an unverified candidate. Final release
helpers and detailed continuation notes are in
`C:/Users/86182/Desktop/wkkk/chat-reader-export-final-20261006/CONTINUE.md`.
No production replacement, migration or cleanup from this follow-up has run yet.

[Export retention and backup plan](docs/planning/EXPORT_RETENTION_AND_BACKUP_2026-10-06.md)
is authorized and unfinished. Server backups have been reduced to two manually.
[Local export implementation](docs/execution/EXPORT_RETENTION_2026-10-06.md) adds
policy inputs, download/usage fences, recoverable physical reclamation, task status
and regeneration APIs; local single migration head is **20261006_0048**.
Client downloads/close/regeneration and verified two-backup retention with byte-identical
component reuse are implemented and have passed the exact-source quality gates above.
Browser retention **10**, related backup/help **11**, PostgreSQL/backup **11**, final
API core **35 / 1 skipped** are earlier local evidence. First CI 37354343891 found a
historical-schema test setup and ambiguous copy-status selectors; subsequent fixes
retain the underlying migration and clipboard assertions. **Final artifact inspection
and production acceptance remain unfinished; none of this follow-up is deployed.**
The user deferred off-site backups; do not ask
for a destination or upload recovery copies. Existing expired exports remain
protected by DB references until the new lifecycle safely reclaims them.

[Backup review](docs/execution/BACKUP_STORAGE_REVIEW_2026-10-05.md) and
[server storage review](docs/execution/SERVER_STORAGE_REVIEW_2026-10-05.md) are
historical measurements, not current deletion lists. The long-running user goal
remains active; a successful release does not complete these remaining tasks.

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

Exact deployed-source CI passed all five jobs: API **902 passed / 3 skipped**,
Context **35**, authenticated settings **136** plus **1** fresh PostgreSQL restore,
authentication **18**, offline negatives **17**, baseline PWA **134 / 284 skipped**,
and the Reader/Share/source/upload/PDF/CSP, build, lint, typecheck, migration and
image gates. Suites overlap; skips are not passes. Fifty image blobs were checked.

Later test-only fixes passed the local baseline **138 / 284 skipped**, including
four CSP cases; those fixes were not executed by the earlier CI. The recurring
`The destination stream closed early` log has no established root cause and is
not claimed fixed. See [copy recovery](docs/execution/SKILL_COPY_RECOVERY_2026-10-05.md).
Production HTTP/data acceptance is separate from CI browser coverage; no fresh
full interactive production browser matrix is claimed. SMTP is unconfigured, so
actual mail delivery is unavailable; the station's private request workflow works.

## Work rules and navigation

Read [AGENTS.md](AGENTS.md), then [docs index](docs/index.md). Temporary files use
`C:/Users/86182/Desktop/wkkk/<task>` with process-local TEMP/TMP. This release uses
`wkkk/chat-reader-release-20261006`. The earlier E-drive test exception was batch
specific. Do not scan the local workstation, build images locally/on King, modify
user imports, delete production volumes or overwrite the server environment.
Existing unrelated tsbuildinfo and auth-resume test directories remain untouched.

Required checks are `corepack pnpm run lint`, `corepack pnpm run typecheck`,
`corepack pnpm --filter web build`, `corepack pnpm run test:api`,
`cd apps/api; python -m alembic heads` and `corepack pnpm --filter web test:pwa`,
plus risk-appropriate authenticated, PostgreSQL, Reader/Share/offline suites.

Current facts belong here or in `docs/system/`; dated plans/execution/evidence are
historical. Follow the [documentation inventory](docs/documentation-inventory.md).
