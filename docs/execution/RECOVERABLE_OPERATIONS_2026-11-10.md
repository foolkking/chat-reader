# Recoverable operations and reading density — implementation ledger

Status synchronized **2026-11-11**: `3564cbf` passed exact CI `42828329240`
and was deployed. The [final release/cleanup receipt](RECOVERABLE_OPERATIONS_RELEASE_2026-11-11.md)
closes the requirement-by-requirement release checklist and retains the
post-acceptance malformed-request log warning. Pending labels in the dated
checkpoints below describe their original time, not the final release status.
Starting application: `865b0a6`; starting checkout: `1fb0912`, existing `master`.
Existing documentation, tsbuildinfo and historical evidence edits are preserved.

## Fifth CI and reading follow-up — November 10

- Exact run42804546886 / `aa21ea9dc5cbd483a8932285477da89cc025e994`
  failed Web's adaptive-import flow:11 pass,1 fail,1 existing private-fixture
  skip. API, Settings and candidate performance jobs passed; images skipped.
  Dispatch acknowledgement19:05:15+08:00; actual first status read19:55:38.
  User explicitly waived waiting for this run and requested reading fixes
  before the next dispatch. The early-read permission did not initiate a
  second run, cancellation, schedule or deployment.
- The failing768px conversion case reached a proxy `ECONNRESET` and never saw
  completion; API logs have no matching commit admission at that time. The
  old proxy used Node's pooled socket and discarded its unparsed request body.
  A stale-socket race is consistent with, not conclusively proved by, those
  logs. Correction uses a fresh connection, forwards bounded exact options
  and settles aborted responses. There is no automatic replay of a mutation.
  The pane now retains unknown submission controls through remount, reads the
  original result explicitly, and permits only an explicit same-ID/same-option
  retry after an adaptive previewed status. Legacy archive preview reads alone
  do not establish the same row-lock guarantee, so they retain checking/Tasks,
  not an unsafe POST retry. Uncertainty does not lock unrelated imports.
- Touch stop reproduced before changing Reader:3 extracted production tests
  failed; actual Chromium touch at an already-visible boundary kept turn reads
  at5 despite repeated movement. This occurs with short, nonvirtual messages:
  the IntersectionObserver has no new crossing, and touch lacked wheel's
  explicit edge request. Touch pointers were also mistaken for thumb dragging.
  The fix shares guarded loading and separates panning; it does not disable
  virtual rows or add a scroll-restoration timer. Four boundary and four dense
  virtual-formula directional cases pass at375/800px; reversal≤2px.
- Current progress was already local-first with revisioned server sync, not
  permanently local-only. However, a remote GET followed by coalescing could
  rebase a pending local edit onto the remote revision and bypass conflict.
  It now retains its original base until its own receipt. New entry resumes
  a confirmed clean server point; active readers receive an explicit handoff,
  not forced scrolling. Incoming/true conflict positions survive Later and
  exact-target retries. Stale applied receipts cannot accept a later remote
  point implicitly. Non-text offsets and initial query freshness are preserved.
- Local evidence:54 focused checks at the earlier checkpoint; final broad
  Node2345 pass, lint/typecheck pass; mounted Reader27 cases, cross-device
  Chromium/Dexie12 combinations, import-source recovery12 combinations pass.
  Final controlled tests include dialog detachment without discarding a dirty
  mapping and no unknown archive replay. Missing
  local browser-cache configuration, a test adapter's CJS default import,
  invalid wildcard/extra command-separator arguments and duplicate binding failed early and were
  corrected without weakening assertions; the original touch failures remain.
  All tests use synthetic content. No full local application service was
  started or forbidden launch retried. Physical tablet/WebKit acceptance and
  exact-source full CI remain outstanding at this checkpoint.
- No API model/migration, Dexie/package revision, stable URL, production data,
  workflow timeout/retry or existing64+12+4 stability requirement was changed.
  The separate handoff gate is mandatory and retains screenshots/results.
  Production capacity remains an independent unresolved deployment admission;
  this request did not authorize cleanup or storage changes.

The `ci-fix05-*` evidence preserves the original failed touch result, corrected
Reader27/real-Dexie12/import12 results and reviewed mobile/desktop screenshots.
`source-checkpoint-ci-fix05.json` uses LF-normalized SHA-256 for the changed
production/test/workflow subset; it does not bind earlier failures to new code.
The full Reader test uses real rendered content and native Chromium touch;
the separate handoff test's small paragraph scroller is only a navigation
adapter, not a second full-Reader stability measurement.

## Approved behavior and acceptance ledger

This table preserves the pre-CI implementation review. Its release-pending
entries are superseded by the eighteen-row final acceptance table in the
[release receipt](RECOVERABLE_OPERATIONS_RELEASE_2026-11-11.md).

The November 10 execution goal authorizes implementation, completion review,
correction, commit/push, full exact-source CI and deployment after acceptance.
Every CI dispatch has a fresh **50-minute minimum before its first status read**.
No schedules, production-source replays, production configuration replacement or
unrelated cleanup are authorized by that original execution goal. The later
explicit November10 storage approval separately authorized the reviewed A–D
items and exactly one retained backup; its execution is in the final receipt.

The final batch decision supersedes the briefly selected partial-import option:
**ordered per-unit analysis, whole-batch review and explicit commit**. One independent
file, JSON/Markdown pair, or ZIP dependency group is a processing unit; this does
not weaken canonical transaction atomicity or split individual messages.

| Requirement | Evidence / current status |
| --- | --- |
| Stable selection order through grouping, analysis, review and draft generation | Server-owned order and cross-family validation/draft passes implemented; interleaved-family and ZIP/loose-file regression tests pass. |
| Small-machine sequential units, bounded admission, honest per-unit progress, safe independent error isolation | Current-unit standard admission, object/traceback lifetime cleanup, per-pass progress and limited independent ZIP format-failure isolation implemented. Mixed ZIP uses standard materialization; full real-memory/performance acceptance pending. |
| Stop retains sources/configuration; explicit resume; separate confirmed disposal | API + Import pane implemented; six retained-stop cases and controlled frontend tests pass. Task Center now also requests retention. |
| Cancellation acceptance vs acknowledgement vs unknown result; finite requests and per-task locks | 20s control/read deadline, 30s stop-unconfirmed feedback, per-task cache locks and read-only reconciliation implemented; targeted Web tests and twelve-combination mounted Task Center matrix pass. |
| New import is not trapped by an old cancelling session; account-safe read-only reconciliation | Fresh file entry and explicit resume offer implemented; late account/session results fenced in controlled tests. |
| Cooperative cancellation, execution fences, truthful heartbeat/progress, safe orphan recovery | Bounded checkpoints and PostgreSQL live-writer lease implemented; expanded 24 PG cases pass, plus 89 worker/control cases with four POSIX-only skips. |
| Editable file selection, replacement after failure/pause, useful failure-specific actions | Ordered append/replace/remove before upload; version-bound replacement and explicit whole-source exclusion after failure/pause or in review implemented. Unknown responses persist across remount, with exact source revisions/identity for read-only reconciliation. Broader recovery review remains pending. |
| Bounded resource waiting, source checks, no automatic canonical commit or unknown-write replay | Existing 15/30/60s waits, max30min, extended to adaptive JSON/mixed analysis; explicit resume and old-job/new-source race tests pass. No canonical commit or upload is automatically replayed. Broader recovery review pending. |
| Offline per-conversation outcomes, global pause, capacity adjustment, old-copy retention | Implemented with a per-child ledger, shared-failure pause, unfinished-only/reduced-assets recovery and finite stream inactivity. Real Dexie/package browser matrix12 and Web regression pass locally; full authenticated PWA acceptance pending. |
| Direct/background export parameter continuity and explicit copy fallbacks | Implemented: same-option single-file background ZIP, read-only receipt lookup/explicit same-key retry, selection recovery and full-message copy-export fallback. Local API/PG/browser checks; final cross-surface acceptance pending. |
| Table copy/download icons, LaTeX once, spreadsheet protection, lazy export, bounded CSV preview | Implemented; 12 mounted width/locale/theme combinations and parser/export checks pass at the reading checkpoint. Full Reader stability acceptance remains pending. |
| Expiring success-only feedback without body reflow or loss of recovery data | Table/image/shared copy/citation and bookmark presentation implemented. Prepared copy, manual fallback, saved bookmarks and failures remain; local controlled-clock browser evidence, full reading stability still pending. |
| Code/Mermaid/attachment/export/task presentation density and accessible controls | Implemented: quiet code rail, one attachment open, optional presets after export, localized unfinished states, compact timestamps and no unchanged limit retry. Mermaid already has no generic header; authored accessibility descriptions/source recovery deliberately retained. Extended table/code/attachment and export/preset browser matrices pass. |
| Existing Reader/Share/Offline/read-together, package/Dexie and security compatibility | Original contracts preserved in code and targeted tests; actual Reader19 and Dexie/package recovery12 pass locally. Full authenticated cross-surface/64+12+4 gates remain required in CI. |
| Local static/API/PostgreSQL/browser checks, visual review, unchanged stability/performance gates | Latest lint/typecheck and **2,239** complete Web Node tests pass. Export API108/PG17 and prior import/worker/PG evidence below; six twelve-combination recovery matrices, image6 and Reader19. After an initial capacity refusal, a fresh admitted isolated source-hashed Next build passed; full release gates remain pending. |
| Requirement-by-requirement completion review and current contract documentation | Current contracts and this ledger synchronized; scoped review and corrections recorded. This is implementation readiness, not release acceptance. |
| Exact-source full CI, independent artifact acceptance, safe deployment and runtime verification | Pending |
| Additional ZIP reference recovery without filesystem/network bypass | Implemented: inert unresolved body references, optional explicit same-ZIP bindings, line/reason disclosure and preserved real-member security gates; API/rendering tests pass. |

## Starting evidence

Read-only source probes reproduced grouping `03,01,02` into `01,02,03` and
family-based draft iteration `01,02,03` into `01,03,02`. These were controlled
algorithm probes, not database, performance or browser acceptance.

The old import dialog automatically restores its saved session and has no new-file
entry in CANCELING. Task heartbeat includes cancelling tasks and does not prove
progress or completed cancellation. Legacy analysis cancellation deletes staged
sources after transaction commit; the new retain action must be explicit and
backward compatible. The historical user incident itself has not been reproduced
from production logs or private input.

## Local checkpoint — November 10, not a release

- Real user ZIP inspected **read-only**, not extracted/imported/uploaded/replayed:
  actual archive and manifest paths validate; two body links refer to one absent
  parent-relative Markdown resource. No verified in-archive target exists.
  Its private title, target path and conversation text are not recorded here.
- Body links outside the archive are now opaque inert identities, not a failed
  archive and not permission to read a parent directory. Review preserves text,
  reports source document/line/reason, and accepts an explicit binding only to a
  verified available member in the same owned, hash/revision-bound catalog.
  A missing target can remain inactive; supplying new bytes requires replacing
  the ZIP and reviewing again. Real unsafe members/manifest paths, CRC, scanning,
  source changes and limits still block their unsafe operation.
- Synthetic API checkpoint: **252 passed / 2 skipped** across analysis queue,
  stop/resume, ordering, references, bounded/small ZIP, task API, errors and
  liveness. Earlier focused ZIP/retention run: **53 passed**; broader old ZIP
  suites: **145 passed**. Counts overlap; they are not additive coverage.
- Disposable, task-owned PostgreSQL `127.0.0.1:55473`: initial cancellation,
  execution fencing and requeue suite **22 passed** initially; expanded
  claim/heartbeat/progress race suite **24 passed**. Worker/control regression
  **89 passed / 4 Windows POSIX-signal skips**. The owned test server was then
  stopped without deleting its data. No production database used.
- Web checkpoint: **158** ZIP/render/review cases and **79** recovery/deadline
  cases passed. After Task Center row isolation, **64** targeted cases and
  **2,191** complete Web Node cases passed. The subsequent CI-wiring check
  passed in the **31-case** Task Center suite (overlapping counts).
  Lint and TypeScript passed after removing a duplicate translation key.
- Mounted production Task Center/query-cache matrix **12 passed**:
  375/800/1440px, both locales/themes; synthetic transport/account and secondary
  dialog adapters. Covers independent controls, retained stop, unknown-write
  checks, close/reopen, keyboard, 30-second presentation and >=44px targets.
  Screenshots manually reviewed; a 42px-wide retry target was corrected and
  the whole matrix rerun. Added as a mandatory Web quality step, not dispatched.
  [Source-bound synthetic evidence](../evidence/recoverable-operations-2026-11-10/README.md).
- No full build, full-plan browser/performance matrix, exact-source CI, commit,
  push or deployment for this candidate yet. Per-unit resource isolation, editable
  failed sources, offline/export recovery, table/read feedback density and
  completion review remain genuine unfinished work.

## Sequential units and source repair checkpoint — November 10

- One existing parser lane now checks unchanged standard reserve/factor against
  the current JSON/mixed unit before opening source bytes; independent unopened
  files no longer count as simultaneously materialized. Full-family validation
  visits interleaved groups in source order and then aggregates results. Invalid
  exceptions retain safe diagnostics, not parser traceback/source objects.
  Controlled metadata/sensor and weak-reference probes verify these boundaries;
  these are not new real-RSS claims.
- Progress identifies the current archive/recognition/validation/draft pass and
  processing-unit index. Existing whole-batch review and atomic explicit commit
  are unchanged. Pure ZIP retains its checked workspace; mixed remains standard
  materialization, and a single oversized source can still need adjustment.
- Format-invalid independent ZIP sources remain blocking invalid review units,
  while other resolved units can be analyzed. Ambiguous pairing does not stop
  independent previews. ZIP-derived Markdown is never implicitly paired with
  loose JSON. Real unsafe paths, CRC/scanner/source/storage/resource errors
  remain blocking rather than being relabeled missing or accepted content.
- FAILED/PAUSED now expose original source metadata and version-bound
  replacement, including when the old file is missing. Rebuilding the first
  analysis creates missing groups. Replacement never edits a derived ZIP
  document or a canonical/active import. Old failed retry rechecks the locked
  record after a concurrent new task; the API now returns409 for that conflict
  instead of leaking an uncaught MessageEditError as500.
- ImportPanel uncertainty persists across close/reopen in an authentication-
  scoped query cache. Only a read confirming a new analysis identity or an
  acknowledged request clears it; no repeated upload/resume/retry is initiated.
- Final API boundary checkpoint: **243 passed / 2 optional skips**, including
  both old/new ZIP lanes, encoded/body references, missing resources, source
  repair, sequential processing and ambiguity isolation.
  Earlier worker/draft/task sweep: **195 passed / 2 optional skips**;
  independent-unit/old-adaptive sweep: **114 passed**. Counts overlap.
- Disposable PostgreSQL: **21 passed**, including a real two-transaction
  old-retry/new-source race and existing execution/cancellation fences.
  This is the analysis-only suite, not the prior24-case combined checkpoint.
  First start omitted the owned port options and failed before serving; explicit
  loopback/55473 options then started the owned cluster. After testing it was
  stopped, with no data deletion or production connection.
- **2,197 Web Node tests**, lint and typecheck pass. An intermediate TypeScript
  error in the nullable query-cache updater was fixed, then checks rerun.
- Actual ImportPanel/React Query **12** width/locale/theme browser combinations
  pass, with synthetic transport/account/secondary surfaces: keyboard/touch file
  chooser, versioned upload, unknown acknowledgement, close/reopen, check-only
  resolution, phase/ordinal progress, no horizontal overflow and44px actions.
  Mobile Chinese/light and desktop English/dark screenshots manually reviewed;
  invalid generic divide/warning tokens were corrected and matrix rerun.
  New mandatory CI step is wired but **not dispatched**.
- File selection/removal, offlining/export recovery, table/actions/success
  density, full-plan review, full build/stability/performance gates and release
  remain unfinished. No source candidate commit/push/CI/deployment yet.

## Reading-density checkpoint — November 10

- Two 44px table icons replace the persistent label/settings row. Their fixed
  rail is outside the cell scroller; hover/focus changes only opacity and touch
  retains visible actions. Pending actions keep keyboard focus while guarding
  duplicate activation. No table-text traversal or export serialization runs
  on reading/hover. All headers/security escaping remain enabled.
- The complete cell bound is established before extracting values. TeX is
  exported once, not concatenated with visual/MathML duplicates. A large or
  unsupported table offers an explicit complete Markdown-segment fallback;
  the surrounding-content scope is disclosed. Clipboard errors keep a selected
  manual field, download errors remain actionable, and downloads are described
  as browser requests rather than verified disk writes.
- Inline CSV had a real grammar mismatch: its split-by-line/column code broke
  quoted commas and multiline values. It now reuses the bounded Viewer parser
  with smaller admission limits. Logical record counts govern 8/28-row
  expansion, and visible columns remain bounded without changing source bytes.
- Image success uses the cache acknowledgement's absolute three-second
  deadline, including across virtual remounts. It changes the existing scale
  trigger only; pending/uncertain/error results and confirmed sizes survive.
  An initial over-image badge overlapped the open slider during visual review;
  it was replaced with trigger-local feedback, not accepted as finished.
- Local table matrix: **12 combinations** (375/800/1440 × both languages/themes)
  using actual Reader Markdown/math/table components and CSS, with explicit
  assistant-ui/preference/IO adapters. Covers exact CSV/segment downloads,
  successful/denied clipboard, scope retirement, keyboard/touch, no overlap/
  hover reflow, 44px targets and oversized recovery. The oversized AST is a
  controlled export-boundary fixture, **not** 50k-cell render performance.
  The first test run exposed native textarea CRLF-to-LF normalization; the
  assertion was corrected only for that field. Downloads still require exact
  bytes and full cell/quote contents. Added mandatory CI gate, not dispatched.
- Full Web checkpoint: **2,202 Node tests**, lint and typecheck pass. Existing
  slider gate also passed **six cases** after adding controlled-clock expiry,
  unchanged body geometry, remount and non-expiring pending/unknown checks.
  Source-bound evidence is recorded separately from previous checkpoints.
- This is not complete-plan acceptance. File selection/exclusion, offline and
  export recovery, shared copy/citation/bookmark feedback, other presentation
  density, full stability/performance/build review, exact CI and deployment
remain unfinished. No candidate commit/push/CI/deployment has occurred.

## Source selection/exclusion checkpoint — November 10

- Before upload, append preserves the existing order; per-file replacement
  retains its slot and removal keeps siblings. Same filenames remain distinct
  inputs, and empty/unsupported/oversized sources have row-local explanations
  instead of duplicate error blocks. Upload and source-method controls lock
  during submission. No file is sent before the explicit analysis action.
- Editable review and FAILED/PAUSED sessions now expose original-source
  exclusion with an explicit whole-source confirmation and observed revision.
  A ZIP is excluded as a whole, never accepted after silently skipping an unsafe
  entry. The remaining sources are hash checked under prospective admission.
  Last-source, stale, foreign, active/canonical and derived-document guards
  remain enforced. Explicit commit remains one atomic batch after review.
- Unchanged group identities and source order survive. A retained half-pair is
  reinterpreted under its own remaining format and can require fresh mapping;
  a test initially expected READY and was corrected to require that honest
  RESOLVING/MAPPABLE result, not change the parser to make it pass.
- Excluded staged bytes/actual versioned ZIP catalogs are deleted only after
  outer commit. Savepoints transfer cleanup intent; rollback, failed analysis
  and cancellation retain the old sources. Missing excluded files are allowed,
  but changed siblings and symlink indirection fail closed. Cleanup failure
  after a successful edit is an orphan/recovery concern, not a false write
  failure. User local files are never touched.
- Replacement now increments a server-owned source revision, preserved across
  ZIP preparation/classification. A fresh read can reconcile a legacy synchronous
  replacement even when its task ID stays the same. A changed session timestamp
  alone is insufficient. Exact source absence reconciles synchronous exclusion.
  Unknown writes stay locked across remount; late acknowledgements update the
  current account's query cache rather than leaving a newly reopened pane stale.
- API boundary sweep: **144 passed / 4 optional Windows skips**.
  The earlier broader adaptive/order/stop/reference sweep passed **137** before
  the additional cleanup/catalog tests; counts overlap, not additive coverage.
  The first source-only run exposed SOURCE_CHANGED being redacted to TASK_FAILED;
  its fixed safe code is now projected without private exception text. One
  invocation named a nonexistent test file and collected no tests; the corrected
  invocation is the144-case result.
- Final review found the legacy fixed draft filename could still be overwritten
  before a final commit/cancellation failure. Source exclusion now publishes a
  fresh v1 filename, retains the old draft until outer commit and does not erase
  possibly committed output on an uncertain acknowledgement. The corrective
  source/draft sweep passed **41 / 2 optional skips**, including both an actual
  rejected commit and a simulated lost acknowledgement after a real commit in
  worker and synchronous paths; canonical conversations remain untouched.
- Isolated PostgreSQL: **23 passed**, rerun after draft correction, including real outer transaction visibility,
  savepoint rollback/commit cleanup and previous concurrency/execution fences.
  The task-owned loopback55473 cluster was stopped afterward without deleting
  data. No production database or real user ZIP was used.
- Web Node **2,206 passed**, lint/typecheck and diff whitespace checks pass.
  An invalid React file-input `onCancel` property was caught by TypeScript and
  replaced with a native event listener before final checks.
- Expanded actual ImportPanel/React Query browser matrix: **12 combinations**,
  controlled transport/account/secondary UI. Tests include exact multipart
  order, same-name duplicates, row removal focus, replacement, upload locks,
  explicit exclusion, unknown results/remount, legacy revision/absence checks
  and late acknowledgement without another GET. One initial locator confused
  native file-input buttons with remove buttons; semantic names fixed it.
  A later native chooser run timed out in one case; the final harness explicitly
  foregrounds its page and dispatches Enter through the focused input, retaining
  event diagnostics. No retry loop or increased timeout was added.
  Mobile Chinese/light selection and desktop English/dark exclusion screenshots
  were manually inspected. This is not full authenticated application acceptance.
- API-client review caught the new DELETE's missing JSON Content-Type (the
  synthetic transport used one). It now uses the existing `jsonRequest` helper;
  an executed real-client test verifies headers, observed revision, authentication
  context, no-store and the20-second deadline rather than relying on the adapter.
- Remaining work: offline per-conversation outcomes/global pause/capacity choices;
  direct-export/background option continuity; copy/citation/bookmark feedback;
  other density cleanup; full Reader/Share/Offline/Together, stability, memory
  and build gates; completion review; exact-source CI/artifacts and deployment.
  No candidate commit, push, CI dispatch or deployment has happened.

### Next inspected seams at source-selection checkpoint (historical)

`offline-downloads.ts` already serializes children and retains the completed
cursor, but its outer catch stops the whole batch on the first child failure.
Retry can rebuild the target list from cursor0 while skipping known revisions;
there is not yet a per-child failure ledger or failed-only selection.
The library has capacity guidance but no in-place asset-policy adjustment.
`direct-export-download.tsx` explains the direct-size limit but offers only the
same Retry button, not a configured handoff to background export. These are
the next bounded work items, not reasons to skip integrity failures or lower
existing resource limits.

## Offline recovery checkpoint — November 10

- Existing per-conversation packages remain the atomic unit. Child failures are
  stored separately from completed results, and a processed cursor no longer
  implies every child succeeded. Independent package/generation failures allow
  siblings to finish; malformed/integrity/capacity failures publish nothing.
  Unknown admission, network, auth, local quota/storage and server asset-I/O
  pause the queue. Inaccessible scope still requires explicit fresh review.
- Retry only handles unfinished work; legacy committed prefixes and successful
  receipts remain. Unchanged capacity failures stay unresolved while other
  failures retry. A deliberate attachment-tier reduction affects unfinished
  children only, preserves old copies until atomic replacement and retains
  cancellation of possibly admitted old jobs with their exact original keys.
  It does not weaken content checks or promise text-only will fit every device.
- Queue pause is visible from Copies, Library and the failure ledger. The UI
  names the stopped conversation, distinguishes completed/failed/pending counts,
  reveals ten failure reasons at a time, and uses44px recovery actions.
  A stop action explicitly releases subsequent work, without claiming this
  item succeeded. Stale policy confirmation and account-switch guards remain.
  Child task links can find the containing project/all batch after retry.
- Cancellation can interrupt an idle response body immediately. Every received
  chunk renews a30-second inactivity deadline rather than imposing a total-time
  limit. Failed/header-rejected bodies are cancelled; no unread large response
  is intentionally left running beside the next child. Existing byte limits,
  package versions and Dexie2 are unchanged.
- The first unit sweep exposed two real defects: same-millisecond queue records
  could execute in reverse order, and some paused categories could create a
  duplicate on enqueue. A persisted local enqueue sequence and pause-aware
  reuse fixed both. The first whole-suite command used a Windows-unexpanded
  wildcard and collected nothing; explicit PowerShell file enumeration ran
  the suite. No failing checks were disabled.
- Full Web Node checkpoint: **2,231 passed**. Stream probes execute the actual
  bounded reader/deadline with controlled clocks and real ReadableStreams;
  coordinator tests use deterministic storage/HTTP adapters. Counts overlap
  preceding checkpoints and must not be added together.
- Browser: **12 combinations**,375/800/1440 × zh/en × light/dark. Actual API
  client, queue, Dexie, Web Locks, package parsing, Sync Center and shared
  confirmation/focus; HTTP and preference/identity setup are controlled.
  v1/v2 seeds stay unchanged after malformed/capacity rejection. Network pause
  survives page reload and blocks later rows, failed-only retry leaves success
  alone, explicit policy change generates just the remaining child, and all
  six final conversations/messages are present. This does not replace full
  authenticated PWA-shell or physical-device gates. Mobile light/Chinese and
  desktop dark/English screenshots were visually inspected.
- Remaining: direct/background export option continuity and unknown submission
  recovery; copy/citation/bookmark feedback; other density cleanup; full
  Reader/Share/Offline/Together, memory/build/stability checks; completion review;
  exact-source CI/artifact acceptance and deployment. No candidate commit,
  push, CI dispatch or deployment yet.

## Export, feedback and final density checkpoint — November 10

- Ordinary export preserves the actual selected messages and all serializer
  options in a single-file ZIP. The original direct route remains compatible.
  Same-key admission compares the full intent across terminal states under the
  existing PostgreSQL lock. Unknown submissions retain their key/options across
  pane remount; checking is read-only, retry is explicit and uses the same key.
  Browser-size failure can hand off to background generation. A server413 or
  known task limit instead requires changed options, not a futile unchanged retry.
- Review also removed unchanged limit retries from Tasks; the row routes back
  to the conversation/list. Nonretryable analysis failures retain the source
  review/repair entry instead of a misleading generic Retry. Transient failures
  and independent task controls remain available.
- Shared copy/citation success expires after3s without inserting a body row;
  prepared Markdown/publication receipts and manual failure text remain.
  Copy-size failure offers an explicit complete **single-message** ordinary
  Markdown export, not silently truncated text or extra public publication.
  A bookmark receipt expires after5s, pausing while focused; saved positions,
  pending operations and failures do not expire.
- Code actions use a44px fixed rail with hover/focus opacity only and a visible
  touch path. The meaningless default `text` label and decorative header band
  are removed; meaningful language, wrapping, full-source copy and expansion
  remain. Attachment text has one full-preview entry, not duplicate open buttons.
  Optional export presets are collapsed after the main export action; a closed
  disclosure still exposes “Needs attention” for an unresolved save/read.
  Unfinished imports use localized task meanings rather than internal enums;
  timestamps omit visible seconds but retain the complete value on disclosure.
- Review discovered that inline text's Range request still called unbounded
  `response.text()`. It now retains at most128KiB, cancels an ignored range,
  bounds preparation/stream inactivity to30s, verifies range/truncation, fences
  retired source results and discloses partial content. This is a **preview**
  prefix, never a truncated import/download. Existing full Viewer policies are
  unchanged and not covered by that new prefix-reader claim.
- Export API **108 passed**, isolated PostgreSQL **17 passed** (advisory
  deduplication, source/account revocation, repeatable snapshot and regeneration).
  Existing task-owned cluster stopped after the run. Counts overlap the earlier
  67-case export checkpoint and are not additive.
- Latest complete Web Node **2,239 passed**, lint/typecheck passed.
  The first density sweep had five stale native-`disabled` assertions after
  converting code actions to focus-preserving `aria-disabled`; assertions now
  exercise the actual duplicate-click guard and preserved keyboard trigger.
  No test or threshold was removed.
- Export/preset browser **12**, copy/citation/bookmark **12**, expanded
  table/code/attachment **12**, final Task Center **12** combinations pass;
  375/800/1440 × zh/en × light/dark. Source-repair and offline have their own
  preceding12 matrices. Actual Reader **19** groups also passed at the feedback
  checkpoint; those results precede final code/attachment changes, so the full
  final-source Reader/stability gates remain required.
- Browser harness corrections are not hidden: one focus assertion sampled
  before the scheduled frame and now waits for the actual focused element;
  the expanded attachment fixture initially pulled an unrelated Word Viewer
  dependency and now explicitly adapts that Viewer; its HTTP origin lacked
  native randomUUID and was changed to intercepted synthetic HTTPS. The actual
  prefix reader and code/table components remain exercised. Mobile Chinese/
  light density/export and desktop English/dark feedback screenshots reviewed.
- Full local Next build **not run**: the fresh task-local build precheck found
  less than2GiB free on C and stopped before copying dependencies/compilation.
  A cleanup request for only completed synthetic fixtures was rejected by the
  execution policy; no deletion or alternate deletion method was attempted.
  Other tasks/user files and production are untouched. Existing production/
  previous-candidate builds do not validate this source. Complete build, Linux
  API/PG, PWA/Share/Together, original64+12+4 traces and real-memory gates must
  pass exact-source CI before release.
- No candidate commit/push/CI/deployment at this checkpoint. The user goal
  authorizes them after completion review, with the50-minute first-read rule.

## Final pre-CI build checkpoint — November 10

- The original low-space refusal remains valid historical evidence. A later
  read-only capacity check found about6.2GiB free on C; no task cleanup or
  alternate deletion command was used to obtain it.
- A new task-owned build directory copied537 Web/config source files and the
  installed dependencies. All source copies were SHA-256 checked;49,268
  dependency files (1,004,006,426bytes) were copied, none hard-linked.
  Junctions were rebased within that directory; no `.env`, private imports or
  old output was copied. The build used the installed Next16.4.1 and Webpack,
  two build workers, no application service or production database.
- Full compile, TypeScript,22 prerendered pages and build traces passed.
  This local Windows build does not replace the Linux exact-source image,
  API/PG, PWA, original reading-stability or real-memory release gates.
- The actual Reader interaction/formula gate was rerun against final source
  in a separate task subdirectory:19 groups passed. The earlier feedback
  checkpoint remains unchanged; `reader-final-local.json` is the new evidence.
  It still does not replace original64+12+4, Share/Together or full PWA gates.

## First exact CI dispatch and waiting-period review — November 10

- Candidate `65db720d639fb34270ae782c7753adbe435e6c0a` was committed and
  pushed on existing master. Nine unrelated/mixed tracked working files were
  SHA-256 checked unchanged; historical storage-cleanup and user audit evidence
  were not staged.
- Full CI `42764243257` was acknowledged at13:46:46.187+08:00. Its first
  status read is prohibited before14:36:48.187+08:00. The first CLI attempt
  had no CLI authentication and did not dispatch; the existing configured Git
  credential then authenticated a process-only invocation without saving or
  printing credentials. No schedule was created.
- Waiting-period review found an old full-app table-export test still locating
  removed text-button names and the old inline manual-copy label. The test now
  locates the actual44px icons and modal, verifies selected full manual content,
  closes with Escape and checks real-trigger focus before the same CSV byte
  assertions. This does not relax content, focus or download checks. Lint and
  typecheck pass. A task-local full-app reproduction command was rejected before
  execution by tool policy; it was not retried through another launcher. The
  final exact-source CI, not a claimed local full-app result, must verify it.
- A preliminary read-only production capacity check at14:01:52+08:00 found
  5,550,204KiB available but6,137,236KiB required by the unchanged backup
  calculation alone. Candidate transfer, unpacked image and image/transfer
  headrooms are additional. No jobs/imports were active; schema remained0060.
  This is not deployment admission: no service was stopped, configuration
  changed, backup/image pruned or user data modified. Capacity must be resolved
  and freshly checked before any deployment.

## First CI results and corrections — November 10

- First status read14:36:48.814+08:00,50m2.6s after dispatch acknowledgement.
  Exact65db720 run42764243257 failed. API6305 passed /3 failed /3 skipped;
  Web stopped at the offline recovery confirmation focus assertion. Settings
  reached456 completed cases with31 failures before the unchanged60-minute
  job limit cancelled the remainder. No acceptance or release images resulted.
- API failures were stale test fixtures/expectations, not suppressed resource
  errors: ordered validation now receives real group/artifact shape; compressed
  analysis asserts bounded queued resource wait, expiry then explicit same-task
  retry with retained bytes. Local108 pass /2 optional Windows skips.
- The offline confirmation opener was natively disabled by its parent action
  lock before the shared dialog captured focus. Its two policy actions now use
  guarded `aria-disabled`, keeping the real trigger. The existing Escape/focus
  assertion remains, with added lock/no-submission checks. FullChromium12 pass.
- Settings failure families:6 export POST watchers ignored `?background=true`;
 8 Context download assertions exposed a real loss of the context-specific
  button name;1 regeneration watcher had the same URL issue;6 format-health
  tests wrongly expected implicit session reopening;6 wrong-format tests exposed
  missing row-local alert semantics;1 limit-recovery test inspected the cleared
  native chooser instead of retained selection;3 identity tests expected distinct
  minute labels rather than full time disclosure. Fixes retain all source,
  checksum, canonical-no-auto-import, retention and focus assertions.
- Context export naming is restored in the actual shared control. Row-level
  source errors expose alerts. Format-health reload explicitly resumes the
  exact retained import; it still checks all groups, persisted health and actual
  mapping repair. The limit-recovery test additionally verifies zero uploads
  before explicit analysis and the submitted source's complete byte length/SHA.
  A pinned-Chromium synthetic multipart probe independently confirmed full bytes
  are observable without launching the application or importing user data.
- Waiting review also corrected the table-export full-app locator and the
  existing whole-site export status recovery probe. The two newly added browser
  harnesses now consistently use pinned fullChromium, not headless-shell.
  Initial missing-browser/shell launches failed before execution and remain
  task-local logs; no browser assertion was weakened.
- Latest lint/typecheck and2324Node checks pass (all scripts tests, broader
  than2239Web). Pinned-Chromium matrices pass12 each for offline, export,
  source repair, reading feedback and table/code/attachment. This does not
  assert full Settings/application acceptance. The rejected local full-app
  command was not retried via another launcher; next exact-source CI owns it.
- No workflow timeout, per-case timeout, retry policy or existing performance/
  frame/memory threshold changed. The original failed run finished itself;
  no cancellation was sent. A corrected commit/new full run is the next step.

## Second CI results and corrections — November 10

- Candidate `b7b1102cd4761d554569891eb83104748239f5ce`, run42775496659:
  dispatch acknowledgement15:28:11.5105884+08:00, first read
  16:18:40.2820804+08:00 (50m28.8s). API6308 pass /3 skips and the
  reading-performance comparison job passed. Settings469 pass /1 failure
  completed in42.1m. Web stopped at the adaptive import flow:10 failed,
  2 passed,1 existing private-fixture skip. Images/inspection did not run.
- All10 Web failures referenced obsolete UI contracts:3 implicit reopening,
  2 unscoped duplicate filename locators,4 native chooser/file-retention
  assertions and1 successive chooser test that silently expected replacement.
  Corrections require explicit retained-session reopening and use the actual
  ordered selection list; independent invalid formats are explicitly removed.
  Same-task retry counts, no reupload, real converted Markdown import and
  valid mapping retention remain asserted. A later attachment test now uses
  the retained single full-preview action instead of the removed header icon.
- The remaining Settings failure counted only uploads for which Chromium
  provided `postDataBuffer()`. Its real successful201 upload had no observed
  body, so the test counted zero. The previous small intercepted multipart
  probe did not establish observability on this real unintercepted transport.
  Installed Playwright only populates this buffer from exposed protocol
  `postDataEntries`; lack of telemetry is not lack of upload.
- The corrected test counts every exact upload POST independently of its
  body. Before explicit analysis it still requires zero. After the sole201
  submission, a read-only Python helper verifies the sole saved artifact's
  name, byte count and SHA plus the real stored file's complete length/SHA.
  It requires CI/test/Settings flags, loopback65438/test database, fixed
  synthetic storage root, the newly created synthetic owner and import,
  one expected filename and a2MiB bounded read. No real user file is read,
  no production path is permitted, no database/file writes are performed.
  Python syntax and six rejection guards pass locally; its positive upload
  integration must run in exact-source CI, not a local substitute.
- Local lint/typecheck pass. The first all-tests Node sweep had2323 pass /
  1 failure: the mocked PostgreSQL shell readiness case hit its unchanged
  10-second subprocess limit under default concurrent load. A complete
  bounded-concurrency rerun (`--test-concurrency=4`) passes2324/2324.
  Neither the test timeout nor workflow concurrency/thresholds were changed.
  Initial failure and bounded rerun are separate task-local transcripts.
- No application source change in this correction, no local full-app launch,
  no real-user source replay, no production modification and no automatic
  cleanup. New exact-source CI is required before artifact acceptance and
  a fresh successful deployment-capacity precheck.

## Third CI results and corrections — November 10

- Commit `19a825354f199e5aa0d4caa0a6fdbfb426c6462e` was pushed via the
  existing HTTPS credential after two SSH connection resets; no remote config
  was changed. Run42784946090 acknowledged16:44:04.3777620+08:00;
  first read17:34:21.0978404+08:00 (50m16.7s). No intermediate status read
  or schedule. Nine unrelated/mixed working files remained byte-identical.
- API6308/3 optional skips, performance, Settings470 and independent
  fresh-instance restore1 passed. Adaptive import12 passed/1 existing
  optional private-fixture skip, CSP4 passed. Context35 passed/1 failed;
  later Web gates/images were not reached. No release acceptance or deployment.
- The remaining Context test changed the selected conversion Bundle, then
  reopened Import and incorrectly expected its failed source to resume
  automatically. It now records the actual201 import identity, requires the
  fresh entry not to show old conversion actions, and explicitly selects
  that exact retained row. Its original selected Bundle, revision2 bytes,
  no silent fallback, clipboard failure, focus return and keyboard trap checks
  are unchanged; an added counter requires exactly one source upload.
- Cross-test review covered Import open/close, Skills, format-health, Tasks
  and empty-project entries. Tasks already use explicit View analysis and
  format-health was corrected previously; no unrelated controls were rewritten.
  Lint/typecheck and full bounded2324 Node suite pass. No local full-app launch
  or replay of private sources; next exact full CI remains required.

## Fourth CI acceptance, visual follow-up and capacity — November 10

- Candidate `5f0b1daec1a0d265297bfd03098b14765d1809fa`, run42792558409,
  acknowledged17:39:34.5270794+08:00; first read18:30:35.6586041+08:00
  (51m1.1s). All six jobs ultimately passed. API6308/3 optional skips,
  Web Node2239,14 full-app gates, Settings470+independent restore1.
  No workflow timing, retries, source safety or frame/memory thresholds changed.
- Five immutable artifacts were downloaded by ID, checked against official
  digest/revision and bounded safe ZIP members. Independent inspection verified
  377 API source files against exact Linux Git source, Web embedded revision,
  tags/platform/config/layer hashes/diff-ID chains and no forbidden paths.
  The task-only verifier initially rejected OCI-index image identity, then
  Windows `git archive` CRLF normalization. Neither was ignored: it now binds
  exact tagged index to its single linux/amd64 manifest/attestations and uses
  command-local Linux checkout settings. Eleven synthetic valid/tampered
  verifier checks pass; original failures are retained, no image/source mutated.
- Independently rechecked35 reading-stability cases, original64 plus12 collapse
  and4 passive traces/cold Viewer, six12-combination recovery matrices,
  image slider6/modal12/Reader19, and five real cgroup/no-swap/no-OOM cases.
  Maximum memory delta57,417,728bytes (<64MiB); Reader pointer cases reparse0,
  maximum frame p95~16.8ms/no long tasks. Performance candidate9/9 passed;
  immutable diagnostic baseline43a714f had8 pass/1 failure. That historical
  failure is preserved, not represented as a clean baseline or speedup proof.
  Default PWA's822 feature-gated skips and1 optional private-source import
  skip remain distinct from the explicit14 gate executions.
- Final screenshot inspection found12 missing English source/paste labels and
  explanations in ImportPanel, including Choose files/Paste text and upload
  privacy/size limits. Added the missing translations without changing upload
  behavior. Two actual-production-call translation tests require all static
  labels in ImportPanel/AdaptiveImportWorkspace to translate and retain their
  placeholders. The real ImportPanel browser gate now checks localized source
  choices/paste placeholder and zero submissions when switching input type.
  Static checks,2326 Node cases and12 pinned Chromium combinations pass;
  the corrected375px English selection screenshot was visually checked.
  This changes source after the green run, so a new full CI is required.
- Fresh read-only production check18:32:48+08:00: current865b0a6/schema0060,
  no queued/active work, API/Web/PostgreSQL healthy. Worker running/no OOM,
  existing restart counter4 (not evidence of a restart by this task).
  Available5,527,340KiB vs backup-only6,147,100KiB: deficit619,760KiB
  before the candidate archive, actual561,411,584 uncompressed layer bytes,
  512MiB image and128MiB transfer headroom. No admission/stop/transfer/load,
  cleanup, production data modification or deployment was attempted.
