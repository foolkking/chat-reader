# Reading tools implementation — 2026-11-08

Status: **local implementation closed out; CI paused pending explicit user
instruction; not deployed**.
Later same-day checkpoint: the user requested a completion audit and authorized
the seven targeted corrections. See [audit](ux-audit-reading-tools-completion-2026-11-08.md)
and [correction record](READING_TOOLS_AUDIT_FIXES_2026-11-08.md). This earlier
closeout is not a claim that the audited gaps were absent.
Base: existing master `adc7c308aba7ab693ea8383ea0e22b270c76e79d`.
Current behavior: [source contract](../system/READING_TOOLS_CONTRACT.md).

## Scope delivered in the working tree

1. Upward single-slider image disclosure, adjacent fit action, compact small
   image controls, shared write recovery and stale-read fence.
2. Once-only optional adaptive-import fit with original commit-lane snapshot,
   authorization/scanning, bounded conversions, API/worker transaction slot
   and rollback-tracked derivatives. Existing stored images are not bulk reset.
3. Grouped responsive Reader tools, title tag strip, removed lineage/update
   toolbar entries and eight-tab/two-mounted-pane read-together workspace.
4. Active-pane search/navigation/position ownership, real DOM lease hand-off,
   search state snapshots, precise text/non-text hand-offs and auth retirement.
5. Deduplicated location bookmarks, separated annotation/bookmark views,
   read-first cards and saved-scope bilingual online/offline v2 exports.
6. Private tag management, union-preserving bulk association, atomic CAS merge
   with saved-search redirects, and query-free tag member listing.

## Review corrections

- A late size GET must not overwrite a newer save or clear its write state.
- Pane selection/click invalidates a pending remote jump but does not create
  reading-progress intent. Geometry/Viewer/passive scroll cannot consume an old
  gesture twice. Block leases release only after geometry ownership hand-off.
- Active reading message is sampled from its own scroller. Initial annotation
  choices open the correct pane/workspace. Closing tabs drops snapshots.
- Text bookmark quotation is code-point based. Missing block text is fetched,
  non-text locations retain block offsets, and API/offline deduplication does
  not collapse different image positions or alter sync receipt IDs.
- Annotation tab initialization, saved-only exports, offline ordering, literal
  context and escaped headings were reviewed together, not as isolated labels.
- Search labels/IDs are scoped per pane. Small-image controls no longer require
  long text labels that overflow their 44px interaction area.
- Tag merge is identity-fenced, CAS-protected and requires read-only checking
  after an unconfirmed result; tag/list writes cannot overlap through the
  selection toolbar.

## Verification actually performed

- Static `corepack pnpm run lint`: passed again on the final source candidate.
- Static `corepack pnpm --filter web exec tsc --noEmit --incremental false`:
  passed again on the final source candidate, without incremental writes.
- Python AST parsing (19 files) and Node `--check` (8 changed/new modules)
  passed again on the final candidate; these are **syntax checks**, not
  application tests.
- Normal repository `git diff --check` passed. An initial check mistakenly
  disabled Windows CRLF conversion and reported CR characters as whitespace;
  the normal-config repeat passed. No mass line-ending rewrite was performed.
- The pre-existing `apps/web/tsconfig.tsbuildinfo` SHA256 remains
  `FCC39CFD4093A15DC2CF9F8E80ACBE12E7A858FCAEB961EE2B47D8A08E960AFC`.
- No local application test suite or application build was run. Local service
  was authorized by the user, but a tool-policy block prevented the attempted
  startup; it was not bypassed. No local/production UI or visual pass is claimed.
- No web search, production access, deployment, migration, user-import mutation
  or automation/schedule creation. Existing cleanup documentation/evidence and
  unrelated user changes are preserved.

## CI acceptance still required

The user's latest instruction is to stop after local completion and wait for
an explicit request before submitting CI. No commit, push, workflow dispatch
or deployment has been performed for this candidate. This record is a local
handoff, not authorization to resume CI automatically.

Full exact-source six-job release workflow, including API/PostgreSQL tests,
Web quality, original reading **64+12+4** frame evidence and Viewer/Share/Offline
gates, settings recovery, performance and exact-image memory gate. New contracts
and browser cases supplement these gates; none of their stability thresholds
are relaxed. The first status read must be at least **50 minutes after dispatch**,
unless the user separately changes that instruction. No run has been dispatched
at this documentation checkpoint.

New/updated tests cover import-fit byte identity/alpha/default-once/safety skips,
shared conversion locks, immutable commit options, tag merge CAS/limits/privacy,
bookmark deduplication/remapping/non-text offsets, v1/v2 byte parity, real slider
transactions, pane leases, annotation recovery and 375/800/1440px together tabs.
These test changes have not yet established a runtime pass.

Visual acceptance must inspect CI screenshots of real text/diagrams/transparent
images and all toolbar widths/themes/locales; source review cannot establish
absence of overlap or good touch/screen-reader behavior. Full tab sessions do
not survive browser refresh; unsupported chooser result kinds open the full
Reader explicitly. Import safety skips keep original intrinsic output until a
later explicit size save.

The design skill's rendered-output checklist was read but cannot be scored
honestly without rendered evidence. No numerical “full score” or WCAG conformance
claim is made; existing project tokens/reading metrics take precedence over
generic typography/layout prescriptions.
