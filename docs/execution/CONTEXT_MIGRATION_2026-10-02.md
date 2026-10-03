# Context protocol migration — execution record

## Accepted scope

Replace paused settings stage five with file-oriented Skill Bundle and Context
Package support. Users perform semantic maintenance externally using their own
or provided Skills. The application does not call models or execute uploaded
scripts. Keep personal preferences; retain continuation members and bindings,
not duplicate Raw, attachment bytes or entire returned ZIPs. No production deploy.

## Implementation sequence

1. Contract/runtime compatibility, supplied-material audit and regression gates.
2. Personal/system Bundle upload, replacement, immutable versions and fallback.
3. Continuation member upload, validation, preview and atomic adoption.
4. Export reassembly and external Maintainer old/new-package workflow.
5. Import, invalidation, offline, archives, ownership and cleanup integration.
6. Rescue and legacy context skill migration.
7. Full checks, browser acceptance, documentation and release preparation.

## Current checkpoint

Stage 1 compatibility and stage 2 backend foundations are in progress. Stage 2
UI and distribution are wired, but browser acceptance, archive and cleanup work
and stages 3–7 are not complete.

- Added editable supplied Skill sources and synthetic EX-43/EX-49 fixtures under
  `tools/context-skills/`. No uploaded scripts are executed by application code.
- Normalized legacy scope/array file declarations without losing checksum entries;
  rejected conflicting identities and duplicate declarations.
- Added read-only CanJSON 2.1 projection adaptation, including inline attachment
  references. Original package bytes are not rewritten.
- Dedicated online exporter now emits conversation metadata and checksums for
  both Raw and included asset objects, retaining historical scope metadata.
- Added ZIP resource/path/link/encryption checks and removed quadratic tail lookup.
- Added deterministic Bundle builder with shared-runtime equality gate.
- Added migration `20261002_0043` with member objects and immutable personal/system
  revisions. Existing Markdown content remains a text projection; bundle identity
  is separate so equal instructions with different scripts are not deduplicated.
- Added personal Bundle upload/replacement, pinned downloads, member inspection,
  paginated revision history, stale-base refusal and duplicate retry handling.
- Added Root-only system upload/replacement/history downloads with audit; public
  system distribution serves only the active revision. Restore clears the active
  override without deleting history or personal Skills.
- Object writes roll back with the database; shared files survive failed writes.
- Fixed lazy built-in seeding overriding an administrator's newly selected default.
- Personal settings accept ZIP Bundles, download complete bundles, clone all members,
  and expose expandable replacement/history/member previews with pinned revision
  URLs. Resetting a personal preference now actually selects the system default.
  Shared source labels distinguish SYSTEM from USER; resolver caches invalidate.

## Evidence

- Runtime compatibility: 10 passed.
- Existing API export tests: 8 passed.
- Actual database-backed exporter to Acquisition integration: 1 passed (SQLite).
- Skill Bundle, existing Skill and admin-system suites: 24 passed after fixing
  competing lazy defaults. Includes authenticated A/B isolation, Root access,
  original bytes after replacement, script-sensitive identity and file rollback.
- Alembic reports one head: `20261002_0043`. Not applied to production.
- Web lint and typecheck pass for the personal Bundle controls; browser acceptance
  and full Web build remain pending, and the older parent settings UI still needs
  the planned complete localization/state review.
- Docker Desktop's Linux engine is unavailable locally; PostgreSQL migration
  execution remains unverified. This does not prevent other implementation work.
- Initial runtime run failed because the temporary parent directory did not exist;
  a subsequent test assertion used the wrong dataclass field. Both were corrected
  before the passing run. Neither failure was counted as a pass.

## Remaining verification and implementation

The materializer, full EX-43 semantics, two-package maintenance and broader archive
security/resource behavior are not fully verified. No claim of semantic conformance
or release readiness is made. New acquisition/maintenance Bundle URLs are wired;
old Markdown URLs remain available.
Full API/Web/PWA/PostgreSQL/browser checks remain pending.

Next: integrate all new objects with archive/cleanup paths, complete personal UI
localization/draft navigation/rename and browser acceptance, and finish remaining
runtime gates before Continuation storage. Preserve existing uncommitted tsbuildinfo and pre-existing export storage.


## Follow-up checkpoint: Bundle distribution and default safety

- Added Root Bundle upload, replacement, member preview, history download and
  default controls; personal and Root controls use the same file viewer.
- Added CONTEXT_MAINTENANCE throughout category validation and selection.
  Acquisition and Maintainer now have generated static ZIPs plus Markdown
  previews; offline delivery uses cached built-in acquisition, never personal data.
- Export delivery downloads the selected revision and copies usage instructions.
  Context export decoupling from attachments remains stage-four work.
- Last-active system disable/delete is rejected. Personal resolution no longer
  depends on a usable system default. Creation serializes category default writes;
  concurrent built-in seeding isolates unique-key races with a savepoint.
- Added read-only Bundle/source consistency CI gate and LF checkout rules. The
  gate catches changed member bytes, unexpected members and stale previews.
- Runtime/distribution suite: 14 passed; source/distribution --check passed.
  Prior Skill/API/admin run: 27 passed. Latest expanded run: 28 passed, including
  preserved personal resolution with unavailable legacy system defaults.
- Web production build passed before the latest small legacy-preview changes;
  latest lint/typecheck passed afterward. Full browser/PWA acceptance remains open.
- Archive audit found that existing .cr serialization omits Bundle revisions and
  member objects, while additive restore deduplicates Skills by Markdown digest.
  These are release blockers, not completed backup support. Integration must retain
  old archives, validate physical members, restore references transactionally and
  deduplicate complete Bundles without merging equal text/different scripts.


## Follow-up checkpoint: Bundle archives

- Personal v1 and system v5 writers now declare an optional Skill Bundle extension,
  preserving all revision/member tables and deduplicated member bytes without
  leaking storage keys or counting Skill files as attachments.
- Preflight validates the entire graph and current projection. Old archives without
  the extension remain readable; nonzero pointers without history fail explicitly.
- Personal restoration distinguishes equal text/different scripts, merges missing
  history into an existing matching Bundle, and preserves its current revision.
  System restoration remaps account owners and restores both personal/system history.
- Skill object rollback now uses the existing archive transaction tracker, including
  nested transaction handling. Existing shared objects are integrity-checked.
- Initial new test failures were test-call mistakes (missing expected_digest and
  incorrect target_root parameter); corrected before passing. Legacy v5 fixture
  generation now removes the new extension declaration as well as its tables.
- Archive/Skill regression suite: 71 passed. Expanded Bundle archive suite: 6 passed
  (overlapping tests, not additive), including fresh independent DB/storage restore,
  injected failure with no surviving rows/files, distinct scripts, all revisions,
  duplicate restore, old format and preservation of existing current selection.
- Added migrated PostgreSQL counterparts to existing release CI; local run reports
  3 skipped because disposable PostgreSQL is not enabled. These are not passes.
- Still pending: resource deletion/cleanup integration, browser acceptance and
  remaining stages. Next implement safe cleanup on Skill/account deletion, then
  finish phase-two UI gates and proceed with Continuation storage/adoption.


## Follow-up checkpoint: Skill resource cleanup

- Personal/system DELETE locks the same owner row as replacement, detaches member
  references in bounded batches, and queues only unreferenced storage keys. The
  SQL deletion and cleanup receipt commit together; rollback leaves files intact.
- New owner-scoped `skill_object_cleanup` uses the existing single worker, task
  center and manual retry. File failure does not repeat logical deletion. Error
  messages and public task results omit private keys and backend paths.
- Account deletion detaches Skill history explicitly and uses its durable cleanup
  receipt. Previously queued Skill cleanup jobs transfer to the requesting admin
  before the deleted account's foreign-key cascade; shared files remain readable.
- Reuse takes PostgreSQL key-share locks; reference cleanup takes ordered locks.
  Added a member-object reference index to the not-yet-deployed 0043 migration.
- Combined Bundle/cleanup/archive/admin regression: 28 passed, 1 PostgreSQL skip.
  Dedicated cleanup suite: 4 passed (overlap). Covers rollback, shared members,
  retry after storage failure, account deletion and private task access.
- Web lint and typecheck pass. Alembic remains single head 0043; diff whitespace
  check passes. No production deployment.
- Next: finish personal Bundle UI draft/state/localization and browser acceptance;
  continue fixed runtime and Continuation storage/adoption. Full PostgreSQL and
  release gates remain pending; stages 3–7 are not yet implemented.


## Follow-up checkpoint: personal Bundle UI

- Added personal rename using the shared prompt dialog; mutation/query failures
  are visible and initial load can retry. Category/language switching confirms
  unsaved drafts; active mutations disable conflicting controls. Replacement has
  an explicit discard action and failed stale-version writes preserve the file.
- Localized personal controls and source labels. Reused existing surface/accent
  tokens, focused settings shell and dialog focus lifecycle; no new design system.
- Preview traps focus, closes with Escape and returns focus to its trigger. File
  inputs clear after save; history refresh cannot force a new revision back to an
  old one. Child replacement busy state reaches parent controls.
- Browser uncovered a pre-write list response hiding the successful new upload;
  mutations now cancel obsolete queries and await post-write refetch. It also
  uncovered a real rename endpoint UnboundLocalError after commit, caused by an
  inner import shadowing selected_id. Fixed and added persisted-rename coverage.
- Latest Web build (test fixture environment), lint and typecheck pass.
  Bundle API tests: 17 passed. Browser suite: 7 passed / 0 skipped against real
  FastAPI/SQLite, not mocked success. Six viewport/locale cases verify upload,
  preference, rename, replacement, old/new download bytes and reopen persistence;
  the seventh exercises cancelled navigation and a real 409 version conflict.
  Keyboard preview focus/Tab/Escape assertions also pass in the six cases.
- Synthetic 375px dark and 1440px light screenshots were visually inspected under
  `.tmp/context-ui-shots/`. No real conversation content or credentials included.
- Initial browser failure used inconsistent Web/API auth configuration; corrected
  APP_ENV=test and AUTH_ENABLED=false for the disposable fixture. Subsequent UI
  failures exposed the two actual defects above; none counted as passing evidence.
- Test file: `apps/web/e2e/context-skill-bundles.spec.ts`, enabled only with
  E2E_CONTEXT_BUNDLES=1 against a disposable API. These local results do not claim
  authenticated multi-account browser or PostgreSQL acceptance, or CI execution.
- Remaining stage-two gates: Root Bundle browser coverage, authenticated end-to-end
  integration and PostgreSQL concurrency. Continuation stages 3–7 remain open.


## Follow-up checkpoint: authenticated system Bundle flows and API runtime

- Root panel now cancels obsolete list requests before refetch, propagates member
  replacement busy state and reports draft changes synchronously. Restored builtins
  can be selected as revision zero in the file viewer alongside retained history.
- Authenticated real-browser suite: 6 passed / 0 skipped at 375/768/1440px in
  Chinese/light and English/dark. Each creates a system Bundle, selects it as
  default, replaces it, verifies actual downloaded bytes, checks a separate normal
  user's personal preference survives, rejects that user's Root history access,
  overrides a builtin and restores its original revision-zero content.
- First run used an incorrect English menu selector (the existing menu says
  "Skills", while the focused panel says "System skills"). Corrected the test to
  the actual menu; the final six scenarios pass. No failed run counted as a pass.
- Latest Web build, lint and typecheck pass. Runs use isolated synthetic SQLite
  and true authentication, not production data or mocked success. PostgreSQL gates
  remain pending; no claim of CI execution or complete runtime conformance.
- Copied the fixed protocol modules into `apps/api/app/services/context_protocol`
  so they ship in the existing API image. Bundle build/check now enforces exact
  source equality between this application runtime and both distributed Skills.
  No uploaded scripts are imported or executed; no new upload endpoint is exposed.
- Application exporter -> packaged runtime integration: 1 passed; external runtime
  and distribution suite: 14 passed; static Bundle/source check passes.
- Next: implement stage-three Continuation bindings, immutable revisions, candidate
  member uploads, validation records and atomic adoption. The protocol/runtime's
  remaining performance/negative-case audit and PostgreSQL integration gates must
  stay open until verified. Stages 3–7 are not complete.

## Follow-up checkpoint: return-upload runtime prerequisite hardening

Before exposing stage-three return uploads, fixed resource and integrity defects
in the shared runtime (all three copies and rebuilt builtin ZIPs):

- Sparse sequence gaps no longer enumerate arbitrarily large integer spans.
- Deep reference chains use iterative DFS; cycle reports are bounded.
- ZIP normalized paths map back to real stored names; path/file conflicts,
  members outside the single package root and ambiguous directories are rejected.
- Directory inputs enforce size/count and link/reparse-point restrictions.
- Buffered reads, JSONL records and path depth/length have explicit limits.
- Protocol JSON rejects duplicate keys, nonfinite numbers and excess nesting.
- An oversized first Raw record returns a failed inspection rather than escaping
  as an uncaught exception. Raw integrity failures cannot qualify a Pair for
  continuation restore even if Raw inspection offers degraded readability.

Validation: `python -m pytest tools/context-skills/tests -q --basetemp
.tmp/context-resource-tests`: 34 passed / 1 skipped. The skipped directory-link
case cannot create a symlink on this Windows host; Linux CI must execute it.
Actual API exporter/runtime integration: 1 passed. Deterministic Bundle `--check`
and `git diff --check` pass. No new Web or database change was made in this slice;
previous Web/Bundle acceptance is not counted as new runtime or PostgreSQL evidence.
One intermediate new test failed because first-record parser errors were
classified as unsupported; classification was fixed and the rerun passed.

Stage-three persistence/API/UI remains unimplemented. Next work remains bindings,
revisions, candidates, validation receipts and atomic adoption. Stage-one broader
bounded-memory parsing, hash/CRC recovery, semantic examples and complete
conformance audit remain open. No commit or production deployment in this slice.


## Stage-three checkpoint: persistence and member-draft API

Implemented seven model tables and frozen Alembic 0044 after 0043. Added private
conversation-scoped draft status/list/create/member replacement/read endpoints.
Partial Pair persistence, explicit base-revision inheritance, generation checks,
input revision conflicts and request idempotency are real database operations.
No endpoint adopts a Pair or claims validation success. Object bytes are private,
content-addressed and removed on transaction rollback; no uploaded script runs.

Verification: candidate tests 8 passed; combined candidate/Skill Bundle/actual
exporter runtime regression 26 passed, PostgreSQL candidate concurrency 1 skipped
(disposable instance not configured). Tests verify persisted files, unchanged
canonical versions, request retry identity, stale-write preservation, selected
base inheritance, same-conversation revision checks, authenticated cross-account
read/write denial, failed-file-write rollback, and SQLite migration up/down parity.
`python -m alembic heads` returns only 20261002_0044. Bundle distribution check and
`git diff --check` pass. Initial fixture failures (wrong MessageVersion attribute
and auth fixture using queued imports) were corrected; the passing run is separate.
No new Web changes; browser acceptance for Continuation is still unimplemented.

Next: integrate fixed-runtime validation against an actual canonical export,
whole-package temporary extraction with Raw/attachment comparison, validation job
receipts, safe preview and atomic adoption. Then build the Reader panel. Candidate
cleanup, archive/remapping, account deletion physical cleanup and receipts must be
connected before release; new table definitions alone do not complete those flows.
All work remains local and uncommitted; no production change.


## Stage-three checkpoint: canonical temporary snapshot and validation worker

Added exporter options for private non-recording snapshots and a context manager
that removes temporary exports on failure/success. Validation does not create
ExportArtifact or ConversationEvent rows. Fixed runtime validation now assembles
the saved Pair against canonical Raw, stores sanitized receipts and rechecks input
and Raw revisions before publication. Queue requests bind the expected input and
reuse an idempotency key; changed drafts cannot be validated under an older task.
Private receipt history exposes revision matching. Task centre has a localized
Context validation label and uses the existing cancel/retry flow.

Verification: Context snapshot/worker/candidate/exporter integration 12 passed.
Tests exercise actual export files, real worker processing, malformed Pair failure,
receipt persistence, member preservation, stale queued input rejection and receipt
invalidation after replacement. Typecheck passed. Positive valid-Pair adoption,
PostgreSQL snapshot/concurrency, full cancellation scenarios and browser flows have
not been run and are not counted as passing. No migration change after 0044.

Next: valid verified/provisional synthetic Pair fixtures, supplementary-context
binding, safe preview/atomic adoption, whole-package temporary extraction and
comparison, then Reader UI. Exporter still has pre-existing eager message loading;
this must be addressed in the broader bounded-export work before release. All work
is local/uncommitted; production unchanged.


## Stage-three checkpoint: valid Pair, supplementary binding and adoption

Implemented valid verified/provisional fixtures built from actual canonical
exports and matched prefix/segment fingerprints. Neither source declaration
claims semantic review by the application. Added a separate supplementary digest
for description/summary, project context and personal annotation/notebook rows.
The digest is captured in the canonical snapshot, rechecked before validation
publication and at adoption. It does not change the protocol fingerprint profile.

Added private full before/after preview, atomic adoption, revision history and
pinned member reads. Adoption locks the conversation and checks generation,
validation ownership, input digest/revision, Raw revision, supplementary digest
and both persisted members. Repeats do not create another revision. Conflicting
protocol identifiers preserve the prior revision and candidate. Revision parent
records the selected base or previous adopted state. No Raw/attachment write.

Validation: 19 member/validation/adoption tests passed (SQLite, actual object files).
Scenarios include declared verified/provisional, source description change without
message-revision bump, display-title-only change, stale competing candidates,
changed content under the same protocol revision, corrupted Index, preview and
history readback, idempotent adoption and cross-account API denial. One intermediate
test edit had an indentation error; fixed before the recorded passing run.
Alembic remains one 0044 head; diff whitespace check passes. No new Web changes.
PostgreSQL adoption/concurrency and browser acceptance are not claimed.

Next: whole-package return extraction/comparison, runtime/source binding for
re-export, current validity status, Reader panel and subsequent offline/archive/
cleanup integration. Supplementary changes after adoption must be re-evaluated by
those consumers; adding the stored digest alone does not finish that lifecycle.
No commit, CI or production deployment in this checkpoint.


## Stage-three checkpoint: whole-package return and temporary lifecycle

Added source ZIP safety/hash checks, explicit Raw/locator comparison and extraction
of only Pair members plus compact whitelisted source metadata. Actual attachment
bytes must match Raw object declarations even when manifest.files omits them.
Complete supported Pairs are also checked against their returned Raw before
candidate creation. Unknown identities are rejected for later explicit mapping;
manual selection cannot bypass target ownership or source consistency.

Added POST returns and context_return worker tasks. API streams into existing
private expiring artifact storage; it does not parse ZIP. Same-key requests compare
bytes and base generation. Success persists members and removes upload DB/file
state after transaction commit; failure retains input for bounded 24-hour retry.
Worker iteration expires up to 25 non-processing/non-cancelling uploads and uses
existing post-commit cleanup. Return ZIPs cannot be downloaded through exports.
The task centre has a localized return label.

Validation: combined Context return/candidate/validation/adoption 26 passed;
worker liveness 13 passed; typecheck and diff whitespace check passed. A worker
reporter-only test initially failed because its minimal fake session lacks query;
it now isolates cleanup while real expiry/file deletion tests verify the actual
storage effect. No failed run is counted as passing. Tests verify member-only
persistence, unchanged canonical versions, reduced metadata, partial return,
identity refusal, corrupt Raw, unlisted attachment checksum mismatch, job replay,
private download rejection, success deletion and failed-upload expiry.

Remaining: external lineage/identity mapping, append-only/locator comparison
matrix and cancelled-job races; frontend Reader flow; export reuse, dual-package
Maintainer, offline/archive/cleanup integration and PostgreSQL full acceptance.
No commit or production deployment. Migration remains 0044.


## Stage-four checkpoint: dedicated online export reuses adopted Continuation

Added carry_continuation to compare the actual written Raw projection with the
adopted Pair using the distributed fixed adapter/fingerprint profile. Matching
prefixes carry unchanged members/coverage; new canonical messages form Hot Tail.
Manifest declares both checksummed members and source trust. Changes to content,
locators, supplementary context or selected coverage cause explicit Raw-only
output rather than stale reuse. Optional corrupt members also degrade to Raw-only.

Added publication guards for Raw revision, supplementary digest and adopted-state
generation. Private validation snapshots disable carry explicitly. Annotation and
notebook dependency reads refresh cached ORM rows when computing the digest.

Validation: 21 exporter/return/validation/runtime integration tests passed. Actual
emitted packages pass fixed-runtime valid_provisional validation both unchanged
and after append; coverage remains 1–2 while new message 3 becomes Hot Tail.
Negative tests check actual ZIP membership and manifest statuses for partial
scope, changed history/description, locator replacement and corrupt Current.
An export interrupted by source change leaves no final or staging file. Initial
cleanup assertion included the test fixture database/imports; narrowed it to the
new export attempt directory, preserving the actual cleanup assertion.
Bundle source/distribution check and diff whitespace check pass. No migration or
Web change in this slice, no commit/CI/deployment.

Remaining stage four: export receipts, explicit Raw-only/repair UI/API strategies,
attachment policy decoupling, safe unique locator repair, external Maintainer
two-package update and all-exporter fingerprint parity. Reader Context UI and
external identity mapping also remain open. Do not treat dedicated exporter
success as completed offline/Share/archive or full protocol acceptance.


## Stage-four checkpoint: Context purpose and independent export options

Implemented context_attachment_policy and continuation_policy end to end through
API schema, durable queue, worker and dedicated exporter. The online panel defaults
to For AI; Context ZIP no longer depends on selecting attachments. Raw-only is an
explicit choice, preserving adopted state. Metadata-only retains references and
hashes, reporting intentionally omitted assets separately from unavailable ones.
Context idempotency reuse with different scope/options now rejects the request.

Verification recorded from the preceding implementation slice: 11 targeted API
cases passed; lint, typecheck and Web build passed. Real isolated API/worker browser
acceptance passed 6 cases (375/768/1440px, zh-CN/light and en-US/dark), downloading
and unzipping output to verify policies and Raw. Desktop and mobile screenshots
were inspected; the mobile screenshot was scrolled to delivery controls. Full
keyboard acceptance and full visual checklist scoring are not claimed.

Follow-up inspection found validation-history freshness omitted supplementary
context. It now checks dependency and candidate digests consistently with preview
and adoption. Actual persisted description changes invalidate history while title
changes do not. Validation/adoption regression: 11 passed, no skips (local SQLite).

Reader return UI, external identity mapping, export receipts, explicit repair,
Maintainer dual-input workflow, other exporters, offline/archive/deletion Context
integration, PostgreSQL and full release gates remain open. No stage completion,
CI success, commit or production deployment is claimed by this checkpoint.


## User correction: direct Current/Index updates, latest three snapshots

The user explicitly removed validation and candidates during Reader implementation.
The earlier UI/negative-browser result (6 passed) is superseded and must not be
counted as acceptance of the new product behavior. Removed that panel and replaced
it with direct update, history and plain-text viewing. Added direct member PUT,
partial snapshot support (0045), latest-three retention, inherited unchanged
members, harmless exact retries and base-generation conflict protection. Direct
exports carry files without checking semantics/fingerprints and record
included_without_validation; partial exports exclude these files to preserve scope.

Two new real database/object-store tests pass: updates create no candidates or
validation records, preserve canonical messages, retain three revisions and inherit
the unchanged member. Direct export helper accepts Current-only without metadata;
partial scope excludes it. Typecheck passes. Isolated synthetic browser database
was stamped to its pre-existing 0044 schema and upgraded to 0045 successfully;
this is SQLite evidence, not PostgreSQL migration acceptance. Source head is 0045.

Pending: new browser suite, whole-ZIP direct update, old pipeline retirement,
orphan cleanup and the rest of the seven-stage migration. No production deployment.


Direct-file acceptance follow-up: 11 direct-file/dedicated-export tests passed,
including an actual ZIP containing Current-only with no verified claim. Six real
browser cases passed at 375/768/1440px in Chinese/light and English/dark: direct
save, refresh/readback, keyboard preview, four updates retaining exactly three,
unchanged Current while Index changes, and no candidate/adoption controls or
candidate rows. Screenshots inspected at 375px and 1440px; full scored visual
certification is not claimed. Lint, typecheck, Web build and diff whitespace pass.
Whole-package direct return, cleanup and full migration acceptance remain pending.


## Direct whole-return and Reader entry checkpoint

Moved Continuation out of Export and beside desktop Annotations; mobile More
keeps these actions adjacent. Added a separate workspace with mobile full-screen,
desktop expansion, close focus restoration and unsaved-file guard. Plain-text
viewing remains temporary; human-readable Current/Index and editing are next.

Converted context_return worker to direct-file extraction/save. Only Current and
Index are persisted, with unchanged member inheritance and latest-three history.
No snapshot generation, Raw/fingerprint comparison, candidate or validation task
is involved. Private temporary upload hashing, ZIP/member resource safety, owner
checks, generation conflicts, task cancellation/retry and expiry remain.

Validation: eight return tests pass, including actual worker storage and upload
cleanup and a plain Current with no protocol metadata. An initial reporter call
omitted processed/total parameters; corrected to the existing worker signature
and reran successfully. Six real browser scenarios pass at three widths/two
locale/theme combinations, exercising whole/direct updates and verifying actual
member bytes and three saved rows, adjacent desktop entry and focus restoration.
Screenshots inspected at 375px and 1440px. Lint/typecheck/Web build pass. Full
visual/anchor-switching certification is not claimed; no PostgreSQL evidence,
CI run or production deployment in this slice.


## Reader-first layout and inline editing

User rejected the form-led workspace layout. The revised interaction starts with
Current/Index reading, with separate Update files and History destinations.
Design brief: people return to understand the continuation alongside a conversation;
use existing paper/ink/secondary-text/border/subtle-surface/green-accent tokens,
a flat reading surface, existing Reader typography, and 4/8px spacing increments.
Content, history, source, citations and continuation are the domain; the signature
is a directly editable Current/Index pair with three saved snapshots. Upload forms,
stacked instructional boxes and always-visible history no longer lead the page.

Current uses the existing safe Markdown renderer, preserves full source when
editing, and folds leading metadata only in the display. Index exposes segment
summaries/expandable records, with unknown objects still readable and complete
source editing available. Saves use direct PUT, support Ctrl/Cmd+S, retain drafts
on failures/conflicts, and never generate candidates or semantic validation.
Index JSON checks are file-format checks only. Member download uses the viewed
revision bytes. Read-only source toggle and initial empty states are available.

Initial browser acceptance found stale generation after cancelling a conflicting
edit then entering upload. Upload entry now refreshes authoritative state before
accepting file selections; cancelling editing also refreshes queries. Six revised
browser scenarios passed across three widths and two locale/theme combinations,
with actual Current/Index saved-byte inspection, frontmatter preservation, invalid
JSON recovery, competing-window refusal and retained local draft, whole return,
three-version history, keyboard actions and focus restoration. After screenshot
inspection, scoped paragraph/heading spacing was expanded; final rerun recorded
below. These tests do not establish full visual or accessibility certification.

Still pending: in-document search, reliable historical-reference navigation,
full history diff/restore, durable draft recovery/offline editing, large-file
render performance, complete workspace switching and remaining migration stages.


Final layout rerun: 6 browser cases passed, 0 skipped; updated reading and editing
screenshots inspected at desktop/mobile sizes. Final lint, typecheck, Web build
and whitespace checks passed. Scope remains the new workspace; no full migration,
authentication/Share/offline suite or production deployment is implied.

### Direct-history storage follow-up

Added durable unreferenced Context member cleanup after three-snapshot pruning,
worker/task integration and account-deletion shared-reference preservation.
Fixed SQLite outer transaction handling before member-insert savepoints so a
rollback cannot leave a committed object record pointing at a removed file.
Migration parity now runs 0044 then 0045 and downgrades in reverse order.

Focused cleanup, direct-file, Skill cleanup, return and candidate regression:
25 passed. Lint passed; Alembic reports only 20261002_0045. This follow-up did not
rerun browser tests; existing six-case layout evidence above remains the UI
checkpoint. PostgreSQL concurrency, historical orphans and comprehensive deletion
coverage are pending. No deployment or commit was performed.

### Canonical deletion and PostgreSQL cleanup acceptance

Connected the shared conversation deletion service to Context graph detachment
and durable object cleanup, under the same conversation lock used for updates.
Added real deletion assertions for shared/private members and three PostgreSQL
scenarios, each migrating a disposable database from empty to head.

Results: cleanup SQLite 4 passed; conversation management/ownership 11 passed;
PostgreSQL 17 cleanup 3 passed (retention/rollback, conversation deletion, account
deletion). Initial unconfigured run skipped the three PostgreSQL cases; the later
configured run executed all three. An initial local port bind failed; an alternate
loopback port succeeded. No existing database was used. Git whitespace check
passed. Full concurrency, archives and offline migration remain incomplete.

### Context .cr extension

Implemented optional personal/system archive tables, object streaming, integrity
preflight, reference checks, additive ID remapping, unchanged Pair bytes, source
bindings and unverified restored state. Temporary returns/candidates/receipts are
excluded. Restore reuses transactional storage, heartbeats and streamed parent
restoration.

Evidence: 41 Context/personal/system-integrity cases passed; earlier combined
Context/Skill-archive regression passed 8. Final disposable PostgreSQL run passed
3 personal/system/rollback cases, including expanded Pair/binding assertions.
No deployment. UI inclusion text, concurrent export/cleanup, performance, offline
and remaining external maintenance work are pending.

### Offline selected-file cache and reading

Added optional v3 continuation metadata, bounded server member reads, byte/hash
checks, catalog estimate and offline revision updates. Client parsing runs before
existing atomic import; the existing conversation row stores the optional files.
Added a read-only workspace using the existing Reader entry and document renderer.
No database version bump or personal Skill caching.

Evidence: 9 offline/direct-file API tests passed, plus a rerun after estimate
changes. Build with TypeScript passed. Disconnected desktop browser reading and
Index expansion passed; screenshot inspected. Optional-member parser test passed.
Initial browser run disconnected before Reader initialization and timed out;
the final test waits for the Reader then verifies disconnected local access.
The panel query explicitly uses networkMode=always. This is not cold-start proof.
Full importer persistence/security matrix, cold-start/lease, mobile and export
parity remain pending. No production deployment.

### Offline Context ZIP export

Decoupled Context output from attachments, retained standalone CanJSON/Markdown,
added optional cached Pair inclusion and source metadata propagation. Metadata
uses online continuation status extension and attachment policy. Added consistent
Dexie read transaction, attachment byte integrity checks and aggregate size bound.

Final build/TypeScript and lint passed. Backend optional-file package test passed.
Disconnected browser test downloaded two actual ZIPs: Pair included without
attachments, then Raw-only by user choice. Member bytes/checksums and unchanged
message records passed. This is one desktop browser flow, not complete mobile,
cold-start, lease or fingerprint-parity acceptance. No production deployment.
