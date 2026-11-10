# Recoverable operations and reading density — implementation ledger

Status: implementation and scoped completion review complete; release acceptance pending.
Starting application: `865b0a6`; starting checkout: `1fb0912`, existing `master`.
Existing documentation, tsbuildinfo and historical evidence edits are preserved.

## Approved behavior and acceptance ledger

The November 10 execution goal authorizes implementation, completion review,
correction, commit/push, full exact-source CI and deployment after acceptance.
Every CI dispatch has a fresh **50-minute minimum before its first status read**.
No schedules, production-source replays, production configuration replacement or
unrelated cleanup are authorized.

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
