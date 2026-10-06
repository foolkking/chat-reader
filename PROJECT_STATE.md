# Project State

## Current release — 2026-10-06

Production `https://chat.king.2bd.net` runs application source
**f0e355af4169ff593da8134b8148c7dc5c25425d**, built only by successful
[CI 37439899921](https://github.com/foolkking/chat-reader/actions/runs/37439899921).
All five gates passed. Original artifact **11401429587**, producer attempt **1**,
was independently verified. Alembic remains **20261006_0048**, single head/current.
[Release evidence](docs/execution/ATTACHMENT_EXPORT_INTEGRITY_2026-10-06.md) owns provenance, tests, production checks,
cleanup and remaining scope limits. The documentation closeout is a separate commit.

Markdown/CanJSON attachment bundles now read one PostgreSQL snapshot across
messages, versions/order, notes, annotations and attachment mappings. Copied object
bytes are checked against SHA-256 and size; corrupt or newly revoked objects fail
without publishing a misleading download. Missing files remain explicit. Bounded
writes, nested iterator closure and transaction-owned files cover ordinary write,
rename and commit failures. Filenames retain `100x`; portable Markdown destinations
escape spaces, parentheses and fragments. The export panel and Tasks explain failures.

Prior durable batch CanJSON jobs, consistent direct-download preparation and the
Root-controlled three-minute export lifetime remain. No new schema or export-format
migration. The separate Context exporter and attachment-only downloader keep their
own contracts; this release does not claim new guarantees for those paths.

Production checks passed for both attachment formats and **74 object checksums**,
manifest counts, physical close reclamation, regeneration, batch and four direct
formats, Context/Range, login/settings and three default Skill Bundles. Canonical
counts, personal Skill fingerprints, **301 attachment checksums**, imports/offline
fingerprints, PostgreSQL identity/start time, environment, Compose and Nginx remain
unchanged. API/Web are healthy; worker heartbeat is alive; startup error checks pass.

Latest verified backups: `chat-reader-20261006T075948Z` and
`chat-reader-20261006T093548Z`. Three identical backup components were reused,
avoiding **623,608,310 bytes**. After acceptance, one older backup and four replaced
**aee64ff** image tags were removed. The verified aee64ff recovery archive remains;
rollback requires loading it first. Final server available space: **15,887,081,472 bytes
(14.80 GiB)**. No local/server image builds, local cleanup or off-site copy.

## Active work

The attachment-integrity stage is delivered. The continuous optimization goal
remains active. The next Task Center stage separates operation, source, file format
and server submission time, brings failures/partial results before completed work,
and removes terminal progress bars. CI 37448984796 passed API/Web but failed one
maintenance regeneration race (settings 169 passed / 1 failed); no image was built.
Follow-ups fix polling/regeneration, late callbacks after account changes and
PostgreSQL terminal export counters. New regressions await exact-source CI; none
of this stage is deployed. See the [stage record](docs/execution/TASK_CENTER_CLARITY_2026-10-06.md).
Off-site copies remain deferred,
and no scheduled backups were added. The unrelated earlier Next stream-close
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

Exact-source CI: API **993 passed / 3 skipped**, settings **167** plus **1** fresh
PostgreSQL archive restore; Context **35**, authentication **18**, offline negatives
**17**, baseline PWA **134 / 315 gated skips**. Reader/Share/upload, source editor,
PDF/CSP, lint/typecheck/build, migration and image checks passed. Runtime/Bundle
checks **64** and cleanup **53** passed. Suites overlap; skips are not passes.

Local final attachment/PostgreSQL suite: **29 passed** (20 attachment and 9 actual
PostgreSQL cases). Related Context/export/retention/batch/transaction suite: **71**,
overlapping the attachment cases. Browser: **3**, 375/768/1440px, Chinese/light and
English/dark, real upload/corruption/error/retry/download/hash verification and
keyboard submission. First build hit Windows page-file/thread limits; the same
source passed with process-local thread limits. All task-owned test services stopped.

Production smoke is recorded separately; no full interactive production browser
matrix is claimed. SMTP remains unconfigured. C-drive log writing failed during
closeout; the authoritative server completion records were read directly, without
replaying completed cleanup or deleting local files. Local residues remain for the user.

## Work rules and navigation

Read [AGENTS.md](AGENTS.md), then [docs index](docs/index.md). Temporary files use
`C:/Users/86182/Desktop/wkkk/<task>` with process-local TEMP/TMP. This release uses
`wkkk/chat-reader-attachment-export-20261006`. The earlier E-drive test exception was batch
specific. Do not scan the local workstation, build images locally/on King, modify
user imports, delete production volumes or overwrite the server environment.
Existing unrelated tsbuildinfo and auth-resume test directories remain untouched.

Required checks are `corepack pnpm run lint`, `corepack pnpm run typecheck`,
`corepack pnpm --filter web build`, `corepack pnpm run test:api`,
`cd apps/api; python -m alembic heads` and `corepack pnpm --filter web test:pwa`,
plus risk-appropriate authenticated, PostgreSQL, Reader/Share/offline suites.

Current facts belong here or in `docs/system/`; dated plans/execution/evidence are
historical. Follow the [documentation inventory](docs/documentation-inventory.md).
