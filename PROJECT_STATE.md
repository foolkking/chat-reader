# Project State

## Current release and active work — 2026-10-05

Production `https://chat.king.2bd.net` runs source
**3f1d539d82fdbaa5d4f7f0b7f8857870c13c1926**, built by successful
[CI 37259074167, attempt 2](https://github.com/foolkking/chat-reader/actions/runs/37259074167).
Alembic remains **20261003_0046**, the single head/current. Option B guidance is
deployed: optional three-step quick start, dismissible first Current/Index guide,
maintenance-package/Skill preparation and a quiet export-time link. Thresholds
count only messages outside Index ranges (100 nonblank messages or 60,000 Unicode
characters). Unknown/foreign/reordered ranges suppress numeric advice. Dismissal
is account/browser scoped; per-conversation suggestions can be muted and restored.

Backup `/opt/chat-reader/backups/chat-reader-20261005T042224Z` is verified.
PostgreSQL identity/start time, production environment, canonical counts and all
301 attachment checksums are unchanged. API/Web are healthy and the worker
heartbeat is alive. Real login, 12 read-only settings endpoints, two owned guidance
requests, three system Bundle downloads, logout/private 401 and public HTTPS pass.
The in-app browser reaches the live login form; this release's full authenticated
browser coverage is CI evidence, not a new live interactive acceptance claim.

Four superseded `5ef984a` image tags were removed after acceptance, freeing about
271 MiB. All backups and the verified `5ef984a` recovery archive remain; rollback
requires loading it before selecting rollback-images.env. Capacity preflight first
failed, then passed after bounded duplicate-transfer/build-cache cleanup.
Local workstation residues remain for the user.
[Deployment record](docs/execution/DEPLOYMENT_GUIDANCE_2026-10-05.md) owns provenance,
failed attempts, capacity cleanup, live checks and recovery details;
[implementation record](docs/execution/CORE_GUIDANCE_2026-10-05.md) owns behavior.

Follow-up source `2863a00` is committed/pushed and passed complete
[CI 37269234174](https://github.com/foolkking/chat-reader/actions/runs/37269234174).
It is not deployed: capacity preflight refuses the available space, and optional
backup-file deduplication awaits user authorization. Production services are unchanged.
Skill management now presents one system Bundle
per purpose, no cloning or language picker, and preserves personal files. Explicit
preferences apply across interface languages; divergent legacy choices remain
until the user selects one. System replacement/default selection applies to the
whole purpose and personal preference survives. Normalizer loading failures expose
retry without silently downloading another file. See
[Skill unification execution](docs/execution/SKILL_UNIFICATION_2026-10-05.md)
for verification, remaining work and release status.

The earlier Context/settings migration and 18 whole-site UX improvements remain
deployed; [previous release](docs/execution/DEPLOYMENT_UX_2026-10-04.md) retains
their evidence. Skill locale/clone cleanup and administrator quota/support-request
work from the later [usability review](docs/evidence/ux-audit-skills-help-2026-10-05.md)
are tracked separately; the guidance release does not complete them. Skill
unification awaits deployment capacity; administrator quota/support requests are
the current release candidate `ad82cf4465287caaf8daeb264f0eb8a785fa28a5`, committed
and pushed. Their backend, account limit enforcement, worker mail lifecycle and
archive extension passed all five jobs in [CI 37295004053](https://github.com/foolkking/chat-reader/actions/runs/37295004053)
against that exact source; deployment remains pending server capacity.
Local migration head is **20261005_0047**; production and staged Skill source stay
on **20261003_0046**. Core Help/admin request UI, protected drafts and the notification-
link destination are now implemented locally. Contextual import/merge limit links
retain selections and drafts; live deployment/acceptance remain. See [support execution](docs/execution/SUPPORT_REQUESTS_2026-10-05.md)
and [local support contract](docs/system/SUPPORT_REQUEST_CONTRACT.md).

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

## Verification and release status

Deployed implementation `3f1d539` passed the complete GitHub workflow: API 876
passed/3 skipped, Settings 126 plus 1 isolated PostgreSQL restore, Context browser
34, authentication 18, default PWA 134 passed/268 mode-specific skips and offline
negatives 17. Build/lint/typecheck, migration, image build and artifact inspection
passed. Gates overlap and skips are not passes. The first source's queued-import
fixture failure was corrected; a subsequent settings proxy reset passed the full
unchanged settings rerun. Both failures remain in the release record. Local
SQLite worker-lock failures remain separate from successful PostgreSQL CI evidence.
The prior production verification and cleanup are complete. Follow-up `2863a00`
passed API (883 passed/3 skipped), Context (35), authenticated settings (126 plus
1 fresh restore), PWA baseline (134 passed/269 opt-in skips), authentication (18),
offline negatives (17) and both image gates. Deployment awaits capacity recovery;
no new production replacement or backup cleanup has occurred.

The support checkpoint passed a fresh Web build, lint/typecheck, full API
**901 passed / 4 skipped**, the final **16/16** Help/request/contextual scenarios,
and baseline PWA **134 passed / 279 mode-specific skips**. The complete settings
matrix first returned **135 passed / 1 failed**; the accessible filter label was
fixed and the affected case passed the final focused rerun. Suites overlap; skips
are not passes. Single local migration head/current is `0047`. Earlier test and
environment failures remain in the support execution record. Exact-source CI then
passed API **902/3**, Context **35**, settings **136** plus **1** fresh restore,
PWA **134/279**, authentication **18**, offline negatives **17**, image build and
independent artifact inspection. Slash counts mean passed/skipped, not total.
The four-tag artifact is downloaded and all 50 content-addressed blobs verified
locally. Production still runs `3f1d539`/`0046`: last read-only capacity check was
**3,264,412 KiB** free and public health passed. Backup deduplication remains
unapproved. Additional optional browser probes and deployment remain; all
task-owned support test services are stopped.

## Work rules and navigation

Read [AGENTS.md](AGENTS.md). Default temporary root is
`C:/Users/86182/Desktop/wkkk`, with per-task directories and process-local TEMP/TMP.
The earlier auth-resume test batch had a one-time exception for
`E:/1project/chat-reader/.tmp/context-tests`; current guidance tests use the
default `wkkk/chat-reader-guidance-20261005` task directory. Current Skill work uses
`wkkk/chat-reader-skill-unification-20261005`; its isolated test processes are stopped.
Support backend/UI tests use `wkkk/chat-reader-support-20261005`; its execution
record tracks isolated process lifecycle. The committed support source is not
included in the older staged Skill artifact; complete its own release gates first.
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
