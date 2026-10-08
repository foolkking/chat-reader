# Content Cleanup Contract

Content cleanup is a review workflow, not an automatic deletion facility. Its primary entry is the Markdown Source Editor: the owner selects persisted source text, chooses **Clean noise**, and reviews the exact selection in a central dialog. The same deterministic rule registry and scan engine serve this source-selection workflow and low-priority post-import scans.

## Rules

Rules have immutable revisions. Built-in rules reference versioned detector identifiers; user rules contain an explicit literal value, optional case-sensitivity, canonical role filter, match mode and boundary mode. User match modes are raw exact, NFKC/case/whitespace normalized, and bounded approximate. Boundary modes are anywhere, whole line and block end. Approximate matching is anchored and edit-bounded; arbitrary regular expressions, scripts, cross-message matching and LLM classification are not supported. Rule values are business configuration and must not be emitted to logs or documentation. The cleanup dialog owns the rule-library entry. Built-ins can be inspected or disabled; user literal rules can also be removed from the personal list while retaining acquired versions. Deleting a rule does not rewrite existing MessageVersion history.

## Detection and review

Detection is layered rather than a single global regular expression. Built-in syntax noise first uses exact structural grammar. Known short syntax tokens may then use NFKC normalization or at most one edit only when an exact citation-reference grammar anchors the candidate. User literals use their selected exact, normalized or bounded-approximate mode. Approximate scanning does not compare arbitrary full message windows and has bounded anchors, length and edit distance.

Each occurrence records detector version, match mode and evidence codes in addition to its location. Candidates default to `KEEP`; protected Markdown ranges remain `PROTECTED` and cannot be selected for batch deletion. Explicit decisions persist immediately and record their save time. Rules never modify source while scanning. Normal fields, tables and syntax examples do not become noise merely by containing marker keywords. Unknown and approximate markers remain suggestions requiring confirmation.

The review workspace groups by rule and conversation, uses a group-list/detail flow on small screens, and supports selected-only filtering. Filtered bulk decisions cover all matching pages, excluding protected and conflicted rows. Full before/after text is paged by message; the apply confirmation names conversation, message and fragment counts. A version/selection-bound preview token rejects changes made after preview. Legacy apply callers remain compatible, but cannot delete candidates without a recorded explicit decision.

## Review recovery (local, 2026-10-07)

### Validation work reuse (local, 2026-10-08)

Decision batches and candidate pages reuse source fingerprints/protected-region
analysis only within that operation. Preview/apply validate each admitted rule
revision once per message, then check individual offsets against its matching
ranges. Source binding, explicit consent, role filters and protected content
remain mandatory. Validation contexts never persist or cross source/role/request
boundaries. Protected intervals support indexed overlap lookup. Applied source is
assembled in one pass from retained pieces; version publication remains unchanged.
This reduces repeated detector work, not the number of reviewed candidates or
the scope of checks. No migration or public response change is introduced.

### Source identity and concurrent editing (local, 2026-10-08)

Candidates store SHA-256 of the exact UTF-8 source in `source_content_hash`.
Canonical content hashes normalize whitespace and cannot bind source offsets.
Version ID alone is insufficient because explicit `replace_current` keeps that
ID while changing source. Candidate display, decisions, exception learning and
apply all reject mismatched/unknown source fingerprints. Existing conflict/rescan
controls handle these cases; scan choices never grant consent over changed text.

Preview tokens include exact selected-source fingerprints, alongside selection,
version and lifecycle data. A source change while preparing the preview returns
409; a previous token also fails after same-ID or whitespace-only replacement.
The scan lock continues to serialize decisions and apply. Cleanup locks affected
messages in ID order before writing any message in a conversation. The shared
version writer checks ID, canonical hash, deletion and exact source again under
the message lock; concurrent edits cannot silently overwrite cleanup or vice versa.
Replacement, version selection and deletion use the same write guard. Version
ancestry remains independent: restoring historical content still creates a valid
new version based on the selected historical version.

Migration `20261008_0050` follows 0049. It adds the nullable source fingerprint and
backfills only targets whose conversation revision and current message version
still match the scan. It streams one source body at a time, without new extensions
or persisted source copies. Unknown legacy sources remain readable and require
rescanning; their choices and canonical text are not silently rewritten. Downgrade
removes only this column. Production remains at 0048; local migration and API
evidence belong to the dated source-safety record. Browser acceptance is pending.

### Unconfirmed selection writes (local, browser acceptance pending)

Individual and filtered KEEP/DELETE writes accept an abort signal and share the
20-second cleanup request deadline. The review aborts owned requests on unmount
and ignores late account-generation callbacks. A failed/unconfirmed save leaves
the last rendered choices non-actionable: further decisions, preview and rescan
pause until an explicit read of server state. The footer labels counts as needing
checking rather than presenting a stale count as confirmed.

Reload saved choices reads the scan, current candidate page and group page; it
does not resend PATCH or infer whether the earlier request caused the state.
Selected-only deselection can shrink pagination, so recovery fetches the valid
last page before publishing the new view. Failed reads keep recovery available;
successful reads show actual saved decisions and allow deliberate continuation.
Cache writes retain the filter/search keys used by the read. Closing still leaves
server decisions intact. This adds no API fields, migration or automatic replay.
Batch 26 browser acceptance remains pending; see its dated execution record.

### Scan execution and cancellation (local, 2026-10-08)

`BackgroundJob` owns execution state; a scan keeps its partial scanner cursor and
results. Reads project QUEUED/SCANNING/FAILED/CANCELLED from the bound job after
checking owner, type and payload scan identity. READY/APPLYING remain review
states. `background_job_status` is additive; worker errors now reach the review
even when its stored cursor still says QUEUED or SCANNING. No migration is needed.

The existing owner-scoped task cancel endpoint accepts `content_noise_scan`.
Queued cancellation is immediate; processing becomes cancelling and stops at the
current chunk boundary. Both chunk requeue and final result publication require
the job still to be processing. Losing that conditional update rolls back the
chunk, without undoing earlier partial chunks or changing canonical content.
Partial results remain non-READY and cannot be applied. A completed publication
can win the race, in which case cancellation cannot claim success. Existing stale
worker recovery finalizes cancelling jobs. Failed/cancelled cursors do not satisfy
new-scan deduplication; an explicit rescan creates a fresh review.

Task Center separates waiting/scanning/stopping under In progress, execution
failures under Failed and recent cancellations under Cancelled. Detail uses a
compact progress/result view, actual scanned counts and cancellation/recovery
beside the task. Acknowledged changes update caches before refresh; unknown
responses offer a bounded read-only task check and deliberate retry. Unmount and
account-generation guards reject late updates. Focus follows a removed control
or a moved task row only when it was lost, preserving deliberate navigation.

Cancellation never cancels an already committed import. Its completion entry
keeps the imported conversation available and identifies the stopped follow-up.
Cancelled rows use the existing terminal-result visibility window; an explicit
scan or latest-import scan remains readable after that window. Ending a cancelled
review uses the existing dismissal receipt, not a second deletion mechanism.

### Empty results and dismissal (local, 2026-10-08)

READY scans with zero occurrences remain viewable from import completion. Task
Center lists them under Completed only while their committed BackgroundJob is in
the existing active-result retention window. They do not create a sidebar reminder
or Needs attention item. The compact result states that the current rules found
no candidates, leaves Rules available, and offers Done. This is a scan result,
not a guarantee that the conversation contains no noise.

DELETE `/api/content-cleanup/scans/{id}` ends the review, without applying its
selections or changing canonical message versions. It refreshes/locks the owned
scan and its bound job, saves a `cleanup_dismissal` receipt, and removes the scan
and decisions in one transaction. The task becomes committed, including when
previously failed, so no orphan retry task remains. Active scan/apply jobs and
just-retried failed scans cannot be dismissed. Admission identity is preserved;
the existing job/index support this change without a new migration.

Repeated DELETE returns 204 only when the same account's dismissal receipt still
exists. Missing/foreign scans without that receipt remain 409. GET
`/scans/{id}/dismissal` returns DISMISSED with server time, REVIEW with a live scan,
or 404 if neither is available to that account. It never replays deletion. The
cleanup `/outcome` contract still returns 404 for dismissal rather than declaring
it a successful cleanup. Receipts contain no removed text and use existing job
storage; active-result expiry is a view limit, not a deletion deadline.

Empty-result Done and Task Center ignore share cancellable, 20-second requests.
Unknown results offer a read-only check; an existing review requires an explicit
retry. Failed reads remain beside their row/action. Confirmed removal updates
cached lists before background refresh; unmount/account-generation guards reject
late callbacks. Task Center captures the visible row before removal and restores
adjacent-row or result-notice focus, unless the user moved to another control.
Saved DELETE selections receive a conditional discard confirmation; closing the
dialog still preserves the review. Revisiting a dismissed review shows an ended
state and retains existing previous/newer navigation.

### Administrator publication recovery

System-rule list/state reads expose a `publication_token` over the canonical rule
and public name/revision/publication timestamps. It is a concurrency base, not an
authorization credential. New Web includes `base_publication_token` on publish
and withdraw. The server compares after taking the canonical Rule lock and
refreshing already loaded Publication objects; stale writes return 409. Personal
labels, enablement and newly learned private revisions do not change this base.
Legacy callers may omit it; this does not make their writes concurrency-safe.

GET `/api/admin/noise-rules/{id}` is a Root-only, read-only current-state check.
PUT publication keeps existing fields and adds the committed `rule` state.
DELETE accepts an optional JSON base and `return_state=true` for a 200 state
response; legacy bodyless DELETE keeps 204 behavior. Acknowledgements are built
before the write lock is released; audit and state commit together. No migration.

Web acknowledges before background list/history refresh. A lost response retains
the intended change and offers a bounded read-only check, never automatic replay.
Matching current state is reported as matching, not proof that this request made
the change. Differences show current and intended names/versions. Keeping a draft
adopts the explicitly reviewed base and still requires a new confirmation; using
current state discards only the draft. Reads and writes have a 20-second deadline.
Reopened history refreshes, and state checks also refresh the expanded history so
newly published match text is visible. Failed reads retain text but disable cached
choices. Match-role/mode/boundary labels are localized. Personal grants, admitted
scans, KEEP defaults and canonical source remain governed by the existing rules.

### Selection scope

GET `/scans/{id}/review` adds `selection_summary` with `selected`,
`selected_elsewhere` and `protected`. One SQL aggregate statement counts the
entire rule/conversation/selected-only filter and the remaining DELETE decisions
in the same owned scan; pagination never changes the totals. Protected counts
describe stored classifications, not a promise that all other candidates are
safe to delete. The existing source/version checks still govern mutations.

The review shows the current scope's selected/protected counts and, when relevant,
states how many selections lie in other groups beside the preview command.
“View all selections” clears rule/conversation filters, group search and pagination,
opens selected-only detail and transfers keyboard focus there without changing a
decision. Failed or in-progress reads suppress precise scope counts; an older
server without the additive summary retains the explicit all-scan preview scope
and navigation. Group rows disclose nonzero protected/conflict counts.

### Global scan admission recovery

The rule library's explicit global scan sends an optional UUID `Idempotency-Key`
to POST `/rules/scan-existing`. With a key, an account/key-scoped PostgreSQL
transaction advisory lock serializes admission. The existing BackgroundJob
idempotency column initially retains the request receipt; the private payload
also preserves `cleanup_request_key` when completion replaces that column's key.
A retry finds that exact task
before selecting current conversations, including after source revisions change.
No extra task or new scan snapshot is created for the same retained receipt.
When its review was deleted, POST returns 409 rather than recreating it.

GET `/rules/scan-existing/requests/{request_id}` returns `{found:false}` for a
missing or other-account request, or `{found:true, job_id, status, scan}` for the
owner. `scan` may be null after a review ends/closes. This endpoint neither admits
a job nor changes a review decision. It uses existing task-record retention,
not a new permanent request table. No credentials or conversation content enter
the receipt key. An invalid UUID is rejected by normal request validation.

A new explicit key requests a fresh current snapshot, including updated personal
exceptions even when message/rule revisions did not change. Distinct deliberate
requests are not silently merged. Old callers without the header retain the prior
source/rule/current-revision reuse behavior. Archived conversations remain excluded;
scans still pin applicable rule revisions and create only KEEP/protected candidates.

GlobalCleanupScan stores only the unconfirmed request UUID in account-namespaced
sessionStorage. Closing/reloading the page does not automatically resubmit it.
Reopening offers a bounded read-only check: a found task is acknowledged, a missing
task permits explicit retry using the same key. Storage failure falls back to
memory with an inline warning while the result is uncertain. The server performs
all ownership checks; browser storage is not authorization. Requests consume an
abort signal and 20-second deadline; late callbacks after authentication changes
cannot clear another account's record or update its cache.

Acknowledgement appears beside the start command and does not await pending/task
list refresh. It links to the existing task center; settings/review overlays close
first. A closed review has truthful terminal guidance instead of a broken review
link. Empty scope/no active rules create no task and explain the next action;
no-active-rule failure also refreshes displayed rule settings. No auto-rescan,
automatic cleanup or new worker is introduced. Migration 0049 below indexes the
independent admission lookup.

### Rescan recovery (local, 2026-10-07)

POST `/scans/{id}/rescan` accepts an optional UUID `Idempotency-Key`. Its receipt
key includes the original scan, request and account, and is serialized by a
PostgreSQL transaction advisory lock. Retries resolve the retained task before
accessing the original scan or reevaluating current source/rules. New keys create
fresh scans of the original active targets; import parent bindings survive.
Legacy no-header calls still create fresh scans.

GET `/scans/{id}/rescan-requests/{request_id}` checks the owner's receipt without
writing. A found task returns `{found:true, job_id, status, scan}`; `scan:null`
means the new review has ended/closed, including after real apply. A missing
request requires access to the original review and returns `{found:false}`;
foreign/inaccessible originals return 404. Retrying a retained ended request
returns 409. Receipts use existing task retention, not indefinite deduplication.

Migration `20261007_0049` adds an owner/type/JSON-expression index for the private
`cleanup_request_key`. New global and rescan jobs retain the key in payload;
completion preserves a legacy job's original key before replacing it. Previously
completed jobs whose original key was never retained cannot be reconstructed.
The completion lookup remains compatible. No scan, source or decision is rewritten
by this migration. The tested downgrade removes only this index.

`previous_scan_id` is additive scan metadata from the owned task. The panel owns
one rescan controller shared by the footer, conflict preview and FAILED/STALE
entry. Unconfirmed request UUIDs use account/original-review sessionStorage; no
automatic replay occurs. Bounded reads/writes, unmount abort and authentication
generation checks protect callbacks. Unknown results offer read-only checking,
then explicit same-key retry if missing. Ended reviews are acknowledged rather
than silently queued again. Task-list refresh never delays opening a confirmed
new review. Storage failure is disclosed beside recovery.

When saved selections exist, confirmation explains that they remain in the old
review and the new review starts with KEEP. No decisions are copied to new source
offsets. Navigation offers the previous review and a return to newer reviews,
even when the previous review is unavailable. Each revisit reads fresh scan,
group and page data; failed scan reads cannot leave actionable stale candidates.
Keyboard focus returns to the review heading. Footer feedback occupies its own
row so the preview command keeps a stable position on narrow screens.

### Import entry and review navigation

Import completion includes the latest existing noise scan for that import. It can
open the shared review without closing the completion summary; Escape restores
the same trigger, including after rescan. Loading failure offers a read-only retry
and does not invalidate the completed import or enqueue another scan. Running
scans show progress without blocking Reader navigation. An empty result means
no pending scan, not a claim that the content is noise-free.

GET `/scans/pending?import_id=<UUID>` checks ownership of the import and returns
at most its latest owner-scoped `content_noise_scan` job's pending scan. It uses
the existing job `parent_task_id` association, never a title/time guess. Rescans
of an import retain this association and source. Completed/dismissed latest scans
do not reveal older scans as current; those older records keep their existing
Task Center lifecycle. The unfiltered pending endpoint remains compatible.

GET `/scans/{id}/groups` accepts optional `q` (max 200 characters). Search trims
the title query, matches case-insensitively with literal wildcard characters,
and filters before counting/paging. It is scoped to the already authorized scan.
Search discovers groups only: it never changes the review filter or decisions.
Web debounces searches, cancels obsolete reads and retains manual error retry.

Candidate detail explicitly names the current conversation/rule, total candidates
in that scope and selected-only mode. A conversation group can expand to every
rule for that conversation, or return to all candidates in this scan. All these
filters reuse the same server-side, cross-page decision path. Preview always
includes all saved selections in the scan, including selections outside the
currently displayed group. Desktop groups stay beside the long candidate list;
small screens retain the existing group/detail return control.

Entering preview focuses its Back action. Returning retains candidate page,
decisions, expanded contexts, scroll position and the preview trigger. The hidden
selection view stays mounted while the preview is active; this does not keep
candidate queries polling or expose hidden controls to keyboard navigation.
Scope and loading changes do not acquire or delete source text.

### Candidate and result presentation

The full-message preview additionally returns optional `removed_ranges` entries
with `start_offset`/`end_offset` in Unicode code points. These are the already
selected, safety-checked occurrences, in source order; conflicted messages return
an empty list and identical before/after text. Server preview construction joins
the retained slices once rather than recopying the message per occurrence.
The preview token, apply gate, full text and pagination contract are unchanged.

`CleanupChangePreview` verifies ordered, nonoverlapping ranges and checks that
removing them exactly reproduces `after`. Only then does it highlight and strike
the marked text. Previous/next controls move the two local text panes to the
same deletion boundary, without scrolling Reader or changing selections. Full
text remains selectable/copyable; zero-text after-boundary markers do not enter
copied text. Mobile panes are shorter to keep the two views close. Missing,
malformed or inconsistent metadata falls back to complete plain text, with no
guessed markers; existing conflict warnings and confirmation guards still apply.

Candidate rows show the entire exact match with the shared mark colors, a short
surrounding excerpt, detection reason, localized role and source line. Excerpts
collapse whitespace and retain up to 64 Unicode code points on each side; they
never change the exact match or server offsets. Multi-conversation scans show
each row's conversation title without requiring expansion.

“Context and rules” expands the full returned context, selected after-context,
explicit exception/learning actions and any available Reader locator. It is a
44px keyboard-operable disclosure; same-row selection refresh preserves its open
state. Collapsing details does not change a decision or learn a rule. Complete
before/after message text remains in the mandatory preview before applying.

Confirmed results use a content-sized dialog, bounded to 88dvh, with a fixed
title and scrolling result body. They remove the former selection, scan command,
rules entry and review instructions. The result receives focus; failed source
reads retain their own retry without another apply. Preview omits old selection
save feedback and duplicate application-error text. This presentation does not
change detection, write/recovery behavior or the bounded task-result lifetime.

Decision PATCH responses acknowledge committed selection separately from follow-up
reads. The single-item/batch decision endpoint retains the existing `CleanupScanRead`
shape, computed inside the transaction and returned after commit. Filtered bulk
decisions preserve `matched`, `skipped_protected`, `scope`, and `decision`, adding a
`scan` snapshot with the same authoritative counts. Neither response adds source
text. Ownership and explicit-decision validation are unchanged.

Web cancels older review/scan reads before a decision, applies confirmed counts
immediately, then refreshes lists independently. Closing during a write does not
discard the same-account query update. Old candidates cannot be edited/learned
while refreshing or after a failed refresh; the latter labels the displayed list
as the previous read and offers retry. A fresh preview remains available using the
confirmed count. No client-side guess converts a requested deletion to a saved
decision: the server can instead mark a changed source as conflicted.

Selected-only lists clamp out-of-range pages after a successful read, then restore
focus to a real candidate. Small-screen group/detail navigation restores the source
group control. Review pages, groups, scan detail and preview reads consume cancellation
signals and a 20-second deadline; workspace list/preview retries are explicit.

A failed preview refresh keeps any old preview visibly identified as such and disables
confirmation. An apply error also pauses confirmation until **Refresh changes** succeeds.
Refreshed differences retain source-conflict warnings and the existing rescan flow;
they never relocate a stale selection. Completion recovery is defined below; a
missing scan alone never proves success.

## Completion recovery (local, 2026-10-07)

Completed applies keep a small owner-bound receipt in the original
`content_noise_scan` BackgroundJob, indexed by `cleanup-apply:<scan UUID>`.
The task must match the scan owner, type and payload binding; a missing task can
be replaced by a minimal receipt task. There is no new table, content copy or
cleanup-specific version history. The final conversation's changes, APPLIED
markers, receipt and scan deletion share the caller's final transaction. Earlier
conversations keep their existing independently committed resumable markers.

`GET /api/content-cleanup/scans/{id}/outcome` returns COMPLETED, REVIEW or APPLYING,
with applied/conflict/remaining counts and nullable completion time. Live state is
read under a scan lock; a completed receipt is checked again when the scan has
disappeared. Unknown, dismissed and foreign scans return 404, never assumed success.
Completed counts are cumulative across interrupted attempts. Repeated POST apply
returns the last successful POST's original applied/conflicts response without
creating versions; this per-attempt count can differ from the cumulative outcome.
Old GET scan remains 404 after successful application.

Task Center exposes the completion only within its ordinary terminal-result
window, starting at cleanup completion. Owner outcome/replay can use the underlying
task after that view window; there is no permanent history UI or new notification.
Public task responses omit the receipt's internal POST replay field. Account
deletion cascades its task/receipt normally.

The Web distinguishes an unconfirmed apply from a confirmed apply whose source
reload failed. **Check cleanup result** reads only; its failures allow retry.
**Reload source** also reads only, with cancellation and a 20-second limit. A
completed task can reopen the saved result after page reload. Authentication
generation checks prevent late mutation callbacks from updating another account.

Preview counts name selected fragments rather than promise removals. When the
returned preview contains all selected messages and all conflict, confirmation
is disabled and rescan is available directly. Larger paged previews do not imply
that unseen messages have been checked by the browser; the server always rechecks.
On mobile, opening source editing closes the originating message-action sheet so
its outside-click handler cannot steal the editor's first text selection.

## Scan Scope

Source selection scans include `message_id`, `selection_start_offset` and `selection_end_offset`. All three fields are required together, the range must be non-empty and inside the current persisted MessageVersion, and active detectors are evaluated inside that range before the manual fallback is considered. A fully selected structural occurrence keeps its detector identity and evidence. A partial structural selection expands to the exact candidate boundary and is kept by default for explicit review. A selection with no rule match remains a manual candidate. Selection text is never copied into scan persistence. Unsaved editor changes must be saved before scanning so the offsets have stable server authority.

General review scans support the current conversation, a selected set of active conversations, or a one-time snapshot of all active conversations. The Rule Library can explicitly queue a low-priority scan of all active conversations, including project and unclassified conversations. Archived and deleted conversations are rejected when targets are created and again when the worker reads targets or applies a decision.

Import commit is independent from review. A successful import queues a `content_noise_scan` job that yields between bounded message batches and has lower scheduling priority than imports and normal background work.

## Position Authority

An occurrence stores a rule revision, conversation/message/version identity, Unicode code-point offsets, display line/column, reason and review decision. It does not store message bodies, Markdown copies, context, file names or attachment content. Context is generated from the referenced `MessageVersion.display_text` only when a review is opened. Scans and targets retain the account ownership needed for access checks.

Variable-length fenced and inline code, indented code blocks, dollar and LaTeX-delimited math, Markdown link destinations, reference definitions/uses, autolinks and attachment references are protected. Both decision writes and apply recheck protected regions; source editing is the explicit way to change them. A changed current MessageVersion, an archived target, overlapping ranges, or a deletion that would empty the message creates a conflict instead of changing content. Application reruns the detector and role guard against the immutable MessageVersion range; a stale or no-longer-matching candidate cannot be deleted.

## Apply

Only explicit `DELETE` decisions are applied. The service revalidates target and version authority, creates a normal MessageVersion, rebuilds render blocks, attachment occurrences, annotation anchors, search and TOC, and advances the offline revision. Existing MessageVersion history remains the sole recovery mechanism; there is no cleanup-specific or batch undo.

Each conversation commits its versions and `APPLIED` occurrence markers together. A retry skips those completed markers. A scan row lock and renewable five-minute apply lease prevent simultaneous requests; failures return the remaining work to review, and an expired lease can be recovered without replaying completed changes. Successful apply deletes the completed scan, occurrences and its rule snapshot. A zero-match scan retains a readable completion until dismissed, preventing the client from polling a deleted result. Explicit ignore deletes the scan. Closing a dialog keeps saved selections, including source-selection scans. A rescan creates a new scan over the original active conversations and never guesses positions after source changes.
# Personal built-in rule switches (working tree, 2026-09-30)

`content_cleanup_rule_preferences` stores per-user enablement separately from
the global built-in registry. The existing rule PATCH accepts only `status`
for a built-in and writes the requesting account's preference; name/matcher
changes are rejected. List responses show effective personal status and new
scans exclude that user's disabled rules. A different user or Root Admin sees
their own preference, and existing scan revision snapshots remain pinned.
Migration `20260930_0036` adds explicit decision timestamps and apply leases.
Legacy `DELETE` candidates reset to `KEEP` because old records cannot prove
whether selection was automatic or deliberate; content and candidate locations
remain intact. The new detector version is `noise-v4`.

## Personal exceptions and learning (working tree, 2026-10-01)

### Exception recovery (local, 2026-10-07)

GET the occurrence exception preview additionally returns `exception_saved`,
`decision` and `scan: CleanupScanRead`. Exact-scope existence is owner-scoped;
the current decision is independently reported. The read does not save an
exception or change a decision. POST retains `id` and adds a scan summary
serialized before the save transaction commits. A later DELETE choice must not
be mistaken for a successfully kept candidate merely because its exception exists.
Source changes still reject preview/save; no guessed source positions.

The editor's reads and writes have cancellation and a 20-second deadline.
Failed/refreshing scope and failed saves cannot confirm cached preview tokens.
Unknown save responses offer a read-only result check. Only a fresh matching
exception plus KEEP resolves as current desired state, not proof of a particular
request; otherwise the user reviews a fresh scope and explicitly confirms again.
Failed checks retain recovery. Confirmed results update the scan and cached
candidate decision before returning, independently of list refresh. A selected-only
page removes only the confirmed occurrence. Old absent fields remain readable
but never establish saved-state evidence.

The review subtree remains mounted while exception/rule editors are shown;
expanded contexts, filters and paging survive. Return restores scroll/focus unless
the user has already interacted with the review. The list separates known
revocation from background-read failure, removes confirmed rows, clamps shrinking
pages and provides explicit refresh. Unconfirmed revocation offers an idempotent
retry; a list refresh alone does not claim a write succeeded. A repeat after a
fresh list already omitted the row does not decrement the remaining total again.
Revocation return focuses the next available row or section heading without
waiting for an unrelated slow read. Authentication-generation checks prevent
late cache/parent writes after account changes.

Scope highlights use the shared mark tokens and localized roles. Exact text is
fully available in a keyboard-scrollable bounded region; detailed scope and
revocation instructions are expandable. No semantic scope, automatic learning,
default KEEP, source text, schema or package-format changes.

### Rule editor recovery (local, 2026-10-07)

Rule trial, save, list and revision reads consume optional cancellation signals
and a 20-second deadline. The editor cancels its request on unmount and guards
cache/parent callbacks against an authentication-generation change. Confirmed
saves cancel older list/revision reads, patch an existing owner list with the
returned rule and close the editor. Background invalidation does not delay that
acknowledgement. An absent list cache is not seeded with a falsely complete
single-rule result. Returning to the library focuses the edited rule or the
new-rule action and announces the confirmed save.

An unconfirmed save keeps the submitted draft and disables another trial/save
until **Check save result** reads the existing owner rule list. Exact agreement
across name, text, role, case, mode and boundary confirms that the intended
configuration is current; this is state convergence, not attribution to a
particular request. New-rule checks additionally require that exact revision's
personal grant. The Web follows the server's trimmed name/text normalization.
Otherwise the current selected rule is compared with the draft; no read writes a
rule or source. Read failures retain the pending check and permit another read.
A missing/inaccessible rule keeps the draft with an unavailable message.

Comparison uses fresh explicit reads, removes the previous comparison when a
read starts, and never offers a stale base after read failure. Localized field
rows show the server and draft values, including name and case handling. Selecting
the base leaves the draft intact, discards the old trial and focuses **Preview and
test**. Only a new trial plus explicit confirmation can write it. Expired trials
have a localized rerun path. These changes do not alter rule identity, grants,
revision creation, review decisions or automatic-deletion policy.

### Exceptions and explicit learning

Migration `20260930_0037` adds account-owned exceptions. An explicit preview and
confirmation bind the selected rule revision, canonical role, literal text and
up to 48 Unicode code points on each side, including message-edge flags. The
scope must match exactly; a rule revision or context change is reviewed again.
Exceptions run after detector precedence, so an overlapping generic detector
cannot recreate the same ignored hit. They apply to future scans and set only
the confirmed current candidate to KEEP; other existing decisions stay intact.
Ordinary KEEP never learns a persistent exception. Settings list and revoke
exceptions with pagination. Tokens bind the account, source version and scope,
expire after ten minutes, and cannot be used by another account. Confirming the
same scope concurrently creates one exception. Manual selections have no
automatic rule to exempt. Scopes over 4,096 characters require a smaller match.

The review and rule settings use the same learning/editor flow: explicit text,
role, case handling and boundary, then a deterministic trial, then confirmation.
The default matcher is EXACT. Trials check at most 100 active messages and
250,000 characters; messages over 20,000 characters are skipped. The UI reports
scanned, skipped, matched and protected counts and up to ten contextual examples.
A current-conversation trial is available when learning from a review. This is
a bounded trial, not a claim that every conversation was checked; a normal
low-priority full scan remains available from the rule library. Trials do not
persist source examples or alter rules/content. Confirmation tokens bind the
account, normalized configuration and edit base and expire after ten minutes.

Edits append/reuse immutable matcher revisions and check the supplied base revision
under a rule-row lock. Rule reads additionally return an opaque account-scoped
`edit_token`, covering the effective revision, personal name/switch/hidden state
and persisted preference update time. Web trial/learn supplies `base_edit_token`;
name-only changes therefore invalidate an old editor even when matcher revision
is unchanged. Lock acquisition refreshes already loaded Rule/Preference/Publication
objects before comparison. Explicit learning and hiding use the same rule lock.
Responses capture the saved rule/token before releasing the commit lock.

Trial signatures bind this personal base too. Legacy trial callers may omit it:
the server binds the observed base and returns it. Confirmation without the field
recomputes the current base and verifies the signature, so omitting it cannot
bypass a change after trial. Old in-flight edit trials issued before this update
must be rerun. Direct legacy PATCH may still omit concurrency metadata; clients
that need stale-form protection must send the returned base token. No migration
or duplicate matcher revision is needed for name-only edits. Editing preserves
the existing switch unless `status` is explicitly supplied; explicit new/repeated
learning continues to enable/recover the user's rule.

Explicit null clears a role filter. Conflicts preserve the Web
draft, show the current server configuration and allow adopting that base before
another trial. Settings expose paginated revision history. The legacy explicit
create/PATCH endpoints remain compatible; the new Web uses trial/learn for
configuration changes. Personal enablement remains independent of built-ins.

Bulk selection reclassifies legacy protected KEEP rows instead of failing the
whole batch. Balanced/escaped parentheses in Markdown destinations are protected.
## Acquired revisions and system publication (working tree, 2026-10-01)

### Personal rule actions (local, 2026-10-07)

Personal enable/disable, selecting an entitled immutable revision and hiding a
rule retain the existing PATCH/DELETE contracts. Web requests consume cancellation
signals and a 20-second deadline. A confirmed response cancels older list/history
reads and immediately patches the actual returned rule or removes the confirmed
row; background invalidation does not delay acknowledgement. Removal restores the
next visible row (or previous row/new-rule action) and announces the result.

An unconfirmed action blocks further writes for that row and offers a fresh
read-only list check. Matching status/revision or an absent removed row establishes
current desired state, not proof of the original request's causality. A mismatch
shows the latest settings and requires another explicit choice; it never toggles
back or repeats deletion automatically. Failed checks keep recovery available.
Unmount aborts requests, and authentication-generation guards prevent late cache
or parent updates after switching accounts. Reopening/reloading reads current
rules and never replays an action. This is not a durable offline operation queue.

History reopens with a fresh read. Failed/refreshing history can show prior values
but cannot select them. List-read failures retain confirmed rows and disable
changes until a successful retry; local acknowledgement remains distinct from the
refresh error. History uses localized role/match/boundary labels, exposes case
handling, and bounds long text in a keyboard-scrollable region. Scans already
admitted retain their pinned source/rule revisions, decisions and content.

Migration `20261001_0038` establishes existing literal revisions as personal
grants before changing source-account deletion to SET NULL. It adds explicit
system publication, old-ID aliases and personal label/current-version/hidden
preferences. Historical rules are not automatically published. Equivalence
includes matcher version, literal, role, case, boundary, normalization, distance
and scope; only identical complete historical revision sets receive aliases.
Old revision parents, exceptions and pinned scan references remain intact.

Equivalent explicit learning reuses a canonical identity and immutable revision
under a PostgreSQL configuration lock. Editing locks that identity, checks the
base version (including optional UUID), reuses an equivalent version within the
identity or appends one, and grants/selects it for this user only. Independent
historical lineages are not silently merged after a converging edit. Personal
history exposes only entitled versions, with the current effective version first.

Root Admin publishes a specified validated configuration and public name. The
candidate list contains matcher configuration, validation state and source-account
existence, never a private label, sample context, filename or source conversation.
Publication and withdrawal are audited. A scan retains its admitted immutable
revision after withdrawal; a successfully applied literal match grants that version
in the same transaction as MessageVersion and the durable APPLIED marker. Merely
listing, selecting, scanning or keeping a public match does not acquire it.

One personal row combines held/public availability. An acquired/learned selected
version remains selected when a newer public version appears; the user may select
another entitled version explicitly. Withdrawal falls back to a held version if
the selected public version was never acquired. Removing a personal rule only
hides/disables it and keeps history, grants and ongoing reviews; learning again
restores it. Personal names and switches do not alter anyone else's configuration.
Deleting the author retains shared rules, versions and grants and clears source
links. Full-family format health behavior is in `ADAPTIVE_IMPORT_CONTRACT.md`.
