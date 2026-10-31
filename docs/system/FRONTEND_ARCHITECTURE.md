# 前端架构

## Reader edge input ownership — 2026-11-01 candidate, not yet verified

Canonical online/offline Reader edge restoration snapshots the existing real
scroll-intent sequence. New wheel, touch, keyboard or scrollbar intent retires
the in-flight fixed-offset compensation; edge trimming is admitted only while
the captured sequence remains current, including after anchor-lease acquisition
and mounted-message waiting. Superseded work keeps the newly merged bounded
window and cannot pull the Reader to a stale viewport. No programmatic scroll
is counted as user input. Complete-turn loading, the 120-message cap,
settled-window trim policy, saved positions and exact target restoration stay
unchanged; Share edge loaders are separate.

Full CI `41218457967` caught the prior dynamic-offset attempt: immutable
baseline **9/9**, candidate **0/9**, with trim-time reversals across all three
profiles. That attempt is withdrawn. The intent-sequence correction awaits
fresh full CI; no runtime or production acceptance is implied.

## Release recovery follow-up — 2026-10-16

Confirmed cleanup choices release the write lease before independent metadata
refresh; a fresh preview still validates saved server choices. My Shares
revocation marks all cached list pages stale without fetching inactive pages
before refreshing the current one. Empty-last-page recovery therefore cannot
reuse a sibling page's stale total from the global 15-second cache. Existing
Share URLs, source data, query keys, confirmation and retry policies stay intact.
The [release record](../execution/UX_RELEASE_2026-10-16.md) owns the isolated
browser and installed-query lifecycle checks, not production acceptance.

Notebook 草稿读取只随草稿 key 或显式读取重试重启；界面语言切换只更新失败文案，
不重新读取并覆盖正在输入、尚待持久化的工作副本。两个实际组件受控回归覆盖
双向语言切换与待完成写入；这不代替真实键盘、IndexedDB 和 reload 验收。
草稿风险通知只随风险布尔值变化报告；卸载清理与正文对象更新分离，避免连续输入中
反复向父组件发送 false/true。`beforeunload` 监听同样只随风险状态挂载或移除。
保存只在草稿持久化仍进行时等待写入队列，并在等待后重新校验当前可写状态；
已经持久化且可写的草稿直接进入保存，避免空等待让无关后台读取抢占本次操作。
等待期间失去可写状态时保留草稿，不自动重放；仓库版本与权限校验保持不变。

## Cleanup candidate range editor — 2026-10-15, local source

`CleanupReviewWorkspace` retains its existing grouped/paged review while a
`range` intent mounts `CleanupRangeEditor`; returning restores list scroll and
trigger focus. The editor owns local ranges, dirty-close confirmation, a
synchronous request lease and mount/authentication-generation retirement.
`getCleanupOccurrence` and `saveCleanupRanges` share the existing 20-second
cleanup deadline. An unconfirmed write keeps the draft, requires a read-only
check and never automatically replays the write.

`cleanup-range-selection.ts` maps native textarea UTF-16/LF selection to original
Unicode code-point/CRLF bounds, merges added selections and computes retained
text without mutating source. Invalid mappings/ranges disable saving. No free-form
source replacement, new editor dependency, storage format or automatic rule
learning is introduced. Server-side version/protection checks remain authoritative.

Candidate checkboxes keep their stable accessible names; `aria-describedby`
links KEEP/DELETE/saving state. Row tint reinforces native checked state without
decorative side borders. Pending bulk choices affect only eligible rows until
the write acknowledgment. Follow-up metadata refresh is independent, keeping
candidate editing locked but not blocking a new authoritative preview.
Expanded after-context uses
the saved refinement rather than pretending the whole candidate will disappear.
The dated original batch had no browser claim; the separate
[release execution](../execution/UX_RELEASE_2026-10-16.md) owns newer synthetic
browser checks, not production or assistive-technology acceptance.

The marker follow-up (verified locally 2026-10-16) adds `candidateRemovalParts`
as the shared validated Unicode splitter for inline removal markers and
retained text. Only selected refined rows calculate marker parts, memoized by
item/selection; unselected rows keep the existing highlight. Invalid refinement
uses plain source and bounded recovery copy. The component independently
rejects checked/saving/tint state on ineligible rows, prioritizes completed/
rescan/protected descriptions, and suppresses stale warnings on APPLIED rows.
Real React server-markup tests do not exercise mounted state, focus, CSS or
browser input; no new dependency, API or schema change is involved.

## Adaptive import session action lifecycle — 2026-10-15, source only

The adaptive import workspace owns one synchronous session-changing action
lease and a monotonic token. Profile selection, invalid-artifact replacement,
group exclusion, legacy reanalysis, grouping confirmation and mapping save
must acquire it before starting. While held, competing session controls,
workspace navigation and commit are disabled. A response is published only if
its token still owns the workspace and its `import_id` matches the current
session; success and failure release the lease. Existing requests are not
aborted and the parent import API/session contract is unchanged.

`GroupResolver` rebuilds its local assignment map only when the ordered
artifact identity signature changes, so server reanalysis cannot leave stale
artifact IDs in the submitted grouping while ordinary typing remains local.
Format-health reads are paused while a session-changing action is in flight.
The [report](../execution/ux-audit-import-session-action-lifecycle-2026-10-15.md)
and extracted-source regression are source-only and unexecuted; this does not
prove mounted React, network ordering, API transaction serialization or
browser keyboard behavior.

## Share unlock lifecycle — 2026-10-15, source only

The password gate reuses the existing token-scoped navigation visit and one
memory-only owned attempt ref. Admission is synchronous before setting busy,
so rapid pre-render submissions coalesce. Only an active visit owning that
exact attempt may start the existing metadata refetch or publish failure/
password/final-busy updates. A separate small visit layout lifecycle resets
password/busy/error and retires the attempt, including layout replay.

The native form exposes busy state and disables its password input while
pending; the edit handler also guards pre-render edits and clears obsolete
feedback on a permitted edit. Raw password whitespace and current failed
input remain intact. Only a current successful metadata read clears input;
a successful POST alone, rejected read or error result does not. Existing
translated finite 429/other error copy and POST/query/auth policy remain.
No password persistence, retry, abort, timer, new query key or dependency.
Retirement cannot reverse a sent POST or its cookie/server effects.

The [report](../execution/ux-audit-share-unlock-lifecycle-2026-10-15.md) and
extracted-source regression remain source-only and unexecuted. Controlled
hooks, transport/query outcomes and static gate markup are not mounted React,
keyboard/password-manager, real session or browser acceptance.

## Share edge-window loading lifecycle — 2026-10-15, local verification

`loadPreviousPage` and `loadNextPage` reject an inactive visit at entry, before
loading/error setters or a new read. They also require the captured complete-turn
generation, direction and the token-scoped `navigationVisit.active` flag before
merging, capturing/restoring a real scroll anchor or publishing an edge error.
The same active-visit guard prevents final loading-state publication after the
reader retires; local refs and already-acquired leases still settle/release.
An in-flight transport is not aborted and no server effect is reversed.

The current merge/trim order, edge serialization, complete-turn API, lease,
stable DOM anchor and user-direction policy remain unchanged. A same-visit
direction reversal makes the old catch neutral instead of showing stale
“earlier/later” failure. A token switch already advances the window generation;
the added active-visit check also covers a full unmount before that request
returns.

The [report](../execution/ux-audit-share-edge-loading-lifecycle-2026-10-15.md)
records nine passing actual-loader adapter checks in the 2026-10-16 local run,
plus full Web lint and nonincremental typecheck. Controlled
transport, refs, anchor helpers and state setters are not mounted React,
real slow-response, scroll geometry, DOM or resource acceptance.

## Source-editor discard-and-switch cleanup — 2026-10-15, source only

The source-editor navigation banner now calls a local `discardAndSwitch`
lifecycle instead of invoking the parent target switch directly. It synchronously
claims a memory-only busy ref, marks every upload job cancelled, calls the
existing request cancel handle, deletes draft-only finalized attachments or
staging items through the existing APIs, invalidates the conversation-file
query and clears the job map before awaiting the parent switch. Cleanup failure
keeps the editor/target in place and shows finite localized feedback; repeated
clicks and competing banner actions are disabled while cleanup is pending.

The same extracted cleanup serves the existing close/discard path. A workspace
unmount also retires outstanding jobs and best-effort deletes their server-side
draft objects; this is cleanup ownership, not a claim that an already-sent
request or server effect is physically reversible. Save, “keep files and
close”, normal attachment removal, message versions, canonical Markdown,
offline packages and attachment protocol remain unchanged.

The [report](../execution/ux-audit-source-editor-discard-switch-2026-10-15.md)
and extracted-source regression remain source-only and unexecuted. Controlled
AST assertions do not establish mounted React, upload timing, server cleanup,
browser focus or resource acceptance.

## Source-editor attachment picker dialog — 2026-10-15, source only

`ConversationAttachmentPicker` now attaches the existing `useDialogFocus`
lifecycle to its outer modal root and passes the search field as the initial
focus target. Its backdrop button carries `data-dialog-backdrop`, so it is
excluded from the shared focusable set. Escape closes through the existing
`onClose`; Tab/Shift+Tab wrap through the unchanged shared hook and cleanup
restores the opener when the picker closes.

The current query, retry/error copy, filtering, file-choice callbacks, layout,
attachment protocol and nested-modal arbitration remain unchanged. The
[report](../execution/ux-audit-source-editor-attachment-picker-dialog-2026-10-15.md)
and extracted-source regression remain source-only and unexecuted; source and
static hook checks do not prove browser keyboard, screen-reader or mobile
focus behavior.

## Share stored-position shape — 2026-10-15, source only

The existing `readSharePosition` boundary treats parsed JSON as unknown before
using it as a resume anchor. It requires a non-array record, nonblank string
message id, non-array anchor record, finite numeric pixel offset and an
optional/null or nonnegative safe-integer block index. Unusable data yields a
null anchor before initial query/restore use, without disabling accessible
storage or deleting/rewriting the key.

Accepted records are returned unchanged: no UUID requirement, exact-key
filter, new required timestamp/mode/anchor metadata, clamping or migration.
Both position modes, optional/numeric anchor hints, unknown metadata and
message-only fallback remain compatible. Existing SHA-256 keys/bytes,
query/restore order and later save/discard policies remain. Storage access
errors still reach the separate capability-failure boundary below.

The [report](../execution/ux-audit-share-position-shape-2026-10-15.md) and
extended actual-helper/initialization/query/restore regression are source-only
and unexecuted. Synthetic JSON and controlled digest/storage/query/DOM
adapters are not real browser/durability or restore accuracy evidence.
Well-shaped but stale/out-of-scope positions remain a separate policy concern.

## Share position-storage recovery — 2026-10-15, source only

The independent Share Reader treats device resume as optional. Current-visit
digest/storage-read rejection clears the in-memory key/anchor, tags readiness
for that visit and enables the existing unanchored first-window query.
`readSharePosition` treats bad JSON and the unusable shape described above as a
null anchor; storage access
failure reaches the containing initialization boundary instead of pretending
the store is empty. No raw-token key, alternative hash or automatic retry.

A visit-tagged memory-only disable ref retires persistence synchronously on
failure or permanent-access discard. A disabled visit's initialization replay
does not probe again; a new visit may initialize normally. Discard preserves
the existing status classification and disables writers before removal,
clearing the in-memory key/anchor on either outcome. A denied removal is not
represented as durable deletion. Later write failure clears the key, marks
finite unavailability and prevents another pre-commit or later storage probe.

Existing idle/cached-unload timing and exact serialized position bytes remain.
Deferred storage and tracking callbacks are fenced by effect lifetime/visit;
capture/write also require the current store. The existing fixed-height
read-only header line carries the current visit's finite translated warning,
without adding content-flow height. No server/API, Share access/URL, package/
Dexie, navigation anchor or query policy changes beyond settled readiness.
No new polling, timer, dependency, mid-reading retry/restore or persistence
format is introduced.

The [report](../execution/ux-audit-share-position-storage-recovery-2026-10-15.md)
and authored/updated extracted-source regressions remain unexecuted. DOM,
storage, digest, query snapshots and timer/layout adapters are not actual
browser, durability, scroll or announcement evidence. Shape validation has the
separate source-only follow-up above; well-shaped stale/out-of-scope positions
and indefinitely pending digest remain separate. Unlock and edge loading have
the separate source-only lifecycle follow-ups above, not runtime acceptance.

## Share tablet navigation dialog — 2026-10-15, source only

`ShareReadonlyReader` connects a stable tablet section ref to the existing
`useDialogFocus` hook only when the navigation sheet is actually visible and
the viewport is tablet. Existing metadata/current-storage render gates remain.
The section is a translated, labeled modal dialog with a negative fallback
tab index. The existing scoped open-change handler owns Escape dismissal.

The unchanged shared hook supplies initial focus, boundary Tab/Shift+Tab
wrapping, top-dialog key arbitration, listener cleanup and delayed
`preventScroll` restoration. Ordinary status/tab rerenders do not reinstall
its open-lifetime effect. Existing scrim/header close, phone/Vaul, desktop
rails, visual width and complete-turn/anchor/storage/access contracts remain.
No extra keyboard system or dependency is introduced; the existing hook's
active listener and cleanup timer are reused.

This is not background inertness or a guarantee against every pointer/
programmatic focus move. The [report](../execution/ux-audit-share-tablet-navigation-dialog-2026-10-15.md)
and actual-hook/extracted-wiring regression remain source-only and unexecuted,
with DOM/layout/event/focus ordering modeled. Real keyboard, screen-reader,
breakpoint/scroll, viewer and geometry acceptance remains pending.

## Reader navigation-sheet lifecycle — 2026-10-15, source only

Common online/offline `ConversationReader` navigation feedback has an effect-
owned scope for Reader surface availability, source-editor hiding, navigation
utility activation, tab, viewport and Reader visit. A scope ref connects it to
the stable internal `setUtilityPanel` callback: existing transition callers
retire the old action before selecting another surface. A memory-only counter
advances on explicit navigation opens, forcing a fresh scope even for a
same-batch close/reopen ending with the same utility value. Retained old
callbacks cannot regain admission. Layout cleanup retires sequence/pending key
and releases that ref only if it still owns it.

Index/TOC sheet content shares `navigateFromNavigationSheet`, retaining the
actual version/locator arguments. Admission and completion also use the
existing Reader visit/account guard. Latest action owns pending/outcome/close;
the same serialized pending caller target coalesces, and a different target
may supersede it. Feedback projection matches scope and sequence, including
effect replay. Cancellation is neutral, failures keep the surface available,
and finite feedback translates through the existing status JSX at render time.

Desktop rails, online/offline query and prefetch policies, complete turns,
true DOM anchors/budgets, saved positions and search return state remain.
This is not physical cancellation or ownership of delayed workspace-open/
source-editor confirmation helper internals. MobileReaderSheet, tablet focus/
presentation and other utility action lifetimes are unchanged. The
[report](../execution/ux-audit-reader-navigation-sheet-lifecycle-2026-10-15.md)
and authored extracted-source regression remain source-only and unexecuted;
real scheduler, remote/offline, geometry/focus/announcement and resource
acceptance is pending.

## Share navigation-sheet lifecycle — 2026-10-15, source only

The independent Share navigation sheet/drawer has an effect-owned scope for
actual visibility, tab, viewport and token visit. Visibility also follows the
existing metadata/local-readiness render gates; hidden/error/loading surfaces
cannot admit or publish a sheet action. Explicit open/close/tab paths retire
the scope synchronously. A memory-only activation counter advances on open
and participates in scope identity, including same-batch close/reopen or a
same-value explicit open; old callbacks are not reactivated. Layout cleanup
increments its action sequence.
Feedback projection checks both scope identity and sequence, so replaying the
same scope does not retain an obsolete pending/failure notice.

The four mobile/tablet index/TOC callers share `navigateFromNavigationSheet`.
One latest action owns pending/outcome/auto-close; the same serialized pending
caller target coalesces, while a different choice may supersede it. Current
failures keep the sheet open for another choice, cancellation is neutral, and
finite feedback translates at render time through the existing labels.
Existing mobile/tablet live-status placements and target arguments remain.

This is local feedback ownership, not physical cancellation of begun core
navigation. Desktop rails, MobileReaderSheet/Vaul/tablet presentation, complete
turns, real DOM anchors, Share access/URL, storage bytes and API remain. Common
Reader sheet completion and Share tablet modal/keyboard wiring have the
separate source follow-ups above; runtime acceptance remains pending.
The [report](../execution/ux-audit-share-navigation-sheet-lifecycle-2026-10-15.md)
and authored extracted-source regression remain source-only and unexecuted;
real overlay/focus/announcement and resource acceptance is pending.

## Share navigation and saved-position retirement — 2026-10-15, source only

`ShareReadonlyReader` owns a token-scoped effect visit alongside its existing
navigation token. Admission and exposed resolver/neighborhood/lease/mounted-
alignment/settle boundaries check both; retired rejection becomes cancellation.
Lease release remains in `finally`. One highlight timer is cleared on the next
navigation or visit cleanup, and its callback cannot clear a newer highlight.
Cleanup increments the token, including effect replay of the same visit.

Explicit navigation marks the saved-position decision settled and advances
the existing intent sequence. Restoration passes an optional internal fifth
argument instead of inventing user intent; its existing candidate order and
character/block offsets remain. The effect stops on cancellation or changed
intent, and its live-visit cleanup fences completion. A later initial-window
result cannot restart restoration after an explicit choice.

Local storage readiness is tagged by the visit that settled initialization,
including the separate optional-storage degradation above.
The initial complete-turn query uses only that visit's saved anchor and waits
for current readiness. Token change resets restore/window/active/highlight
state; late old key completion cannot label the new visit ready. SHA-256
namespace, stored bytes, Share URLs/access, optional old-server resolver
fallback, request budgets and real DOM anchors remain unchanged. Begun work
is not physically aborted. Navigation-sheet feedback has the separate source
follow-up above; crypto/storage failure has the separate source-only follow-up
above; unlock has its own source-only follow-up above. Edge loading remains
separate.
The [report](../execution/ux-audit-share-navigation-retirement-2026-10-15.md)
and authored regression remain source-only and unexecuted.

## Reader navigation retirement — 2026-10-15, source only

`navigateToTarget` now combines its existing navigation token with the
existing `ownsReaderReadRecovery` visit/account guard. Retired admission
does not start timing/state work; context and neighborhood completion,
fallback-turn reads, lease acquisition, mounted alignment, layout settling
and rejection handlers check the same ownership before further caller work
or publication. Mounted/settle/pulse predicates also use it. Started-work
performance bookkeeping and lease release remain; the in-progress ref is
cleared only by its own navigation token, never by an older token.

Current-search context has one state/ref publisher and a synchronous clear.
Footer previous/next uses captured-context identity plus visit ownership at
admission and completion; dismiss/replacement cannot be undone by an old
success. Source/conversation layout reset clears old search context/highlight,
failure/retry target, pulse/timer and per-source annotation validation memory,
without resetting the panel's ephemeral query/selection return state.
Reset cleanup increments the navigation token, so effect replay cannot revive
a retired transaction by reactivating the same owner. Existing complete-turn loading, locator rules,
budgets and true DOM anchoring remain. No transport or helper-internal abort
is added. The [report](../execution/ux-audit-reader-navigation-retirement-2026-10-15.md)
and authored/adapted regressions are source-only and unexecuted, not browser
or resource acceptance.

## Conversation TOC stale-read recovery — 2026-10-15, source only

`ConversationToc` distinguishes an initial empty/error state from a failed
refresh with usable `visibleItems`. The latter retains the existing
`placeholderData`/`cachedItems`/`activeItems` fallback and renders a compact
localized stale-read alert with a Retry that only calls `tocQuery.refetch()`.
The control is disabled while the query is fetching.

The query key, fallback precedence, heading/block DOM ids, navigation callback,
real DOM scroll anchoring and Reader/Share/offline boundaries are unchanged.
The [report](../execution/ux-audit-conversation-toc-stale-read-recovery-2026-10-15.md)
and unexecuted source regression own the acceptance limits. No API, data,
storage, migration or deployment boundary changed.

## Conversation index read recovery — 2026-10-15, source only

`ConversationIndex` keeps interactive jump and sheet page reads separate from
the initial TanStack Query state. A loader failure retains the current
`remotePage`, records the exact ordinal or previous/next intent with its
bounded `offset`/`limit`, and renders a local alert plus a same-intent Retry.
Successful page reads clear the local error before the existing jump
`onNavigate` callback runs; navigation failure is not relabeled as a loader
failure.

The existing loader contract, query key, initial query retry, filtering,
pagination, real DOM scroll anchoring and Reader/Share/offline boundaries are
unchanged. The [report](../execution/ux-audit-conversation-index-read-recovery-2026-10-15.md)
and unexecuted source regression own the acceptance limits. No API, data,
storage, migration or deployment boundary changed.

## Conversation-files capability read — 2026-10-15, source only

`ConversationFilesPanel` treats the attachment capability query as an
explicit upload gate. Pending and initial error-without-data states disable
only the upload affordance and expose localized local Retry; a stale
successful capability result continues to authorize the existing upload path.
Attachment session/item/finalize calls, list reads and permission boundaries
are unchanged. The [report](../execution/ux-audit-conversation-files-capability-read-2026-10-15.md)
and unexecuted source regression own the acceptance limits.

## Library download-status subscription — 2026-10-15, source only

`LibraryShell` keeps download-status subscription failure separate from action
errors and local-library read state. On failure it retires only unverifiable
progress/failure UI and exposes a status-only Retry generation; it never
enqueues or cancels a download. A later live emission restores normal mapping.
The [report](../execution/ux-audit-offline-library-download-status-read-2026-10-15.md)
and unexecuted source regression own the acceptance limits. No worker, storage,
package, API or deployment boundary changed.

## Library local read feedback — 2026-10-15, source only

`LibraryShell` tracks local conversation/message read availability independently
from search-index preparation. The first list read gates empty claims; failed
initial reads offer local Retry, while a failed refresh preserves successfully
read rows. Retry reuses the existing serialized reload owner rather than starting
downloads or navigating. Catalog download deep links retain their existing path.
The [report](../execution/ux-audit-offline-library-local-read-state-2026-10-15.md)
owns authored, unexecuted source checks; actual React/Dexie/browser states remain
unaccepted. No data, package, API, schema or deployment boundary changed.

## Noise scan lifecycle (local, 2026-10-08)

`CleanupScanProgress` and `CleanupScanCancelAction` share compact progress,
cancellation acknowledgement and bounded read-only recovery. Task Center groups
live/failed/cancelled scans by real execution state; live scans are not attention
items. Cancellation preserves imported content and exposes fresh rescan. Lost
focus follows a removed live control or moved row; completed-review dismissal
retains its own adjacent-row/result restoration. Deliberate navigation and
account changes fence delayed responses. Details and retention belong to the
[cleanup contract](CONTENT_CLEANUP_CONTRACT.md#scan-execution-and-cancellation-local-2026-10-08).

## Empty noise results and dismissal (local, 2026-10-08)

`CleanupDismissAction` serves compact empty results and Task Center ignore.
It owns conditional selection confirmation, bounded/cancellable requests,
read-only unknown-result recovery and account-generation guards. Confirmed
removal cancels stale list reads and updates both caches before background
invalidation. The parent captures the row before removal for focus restoration;
intentional focus elsewhere is preserved. Reopening an ended scan uses its
dismissal receipt rather than a stale workspace or generic missing-result error.

Import completion exposes View result for zero matches. Task Center places only
recent zero-result scans in Completed, respecting the existing job-result window;
they create no sidebar reminder. Rules remain available in the compact result.
See [cleanup](CONTENT_CLEANUP_CONTRACT.md#empty-results-and-dismissal-local-2026-10-08)
and [retention](RETENTION_CONTRACT.md#re-entry-contract).

## System noise publication (local, 2026-10-07)

`AdminNoiseRuleSettings` owns the paginated ledger and dirty-dismissal boundary;
`AdminNoisePublicationRow` owns one base-bound draft and its publication recovery.
Committed responses update cached rows before background refresh. A failed/lost
write keeps the intended action and reads current Root-only state. The comparison
requires explicit base adoption and a new confirmation; it never resubmits itself.
History refreshes on reopen and after state checks, while failed reads disable
cached choices. Input/confirmation/read flows retain authentication-generation and
unmount guards, with a 20-second client deadline. See the
[cleanup contract](CONTENT_CLEANUP_CONTRACT.md#administrator-publication-recovery).

## Noise selection scope (local, 2026-10-07)

`CleanupReviewWorkspace` uses the optional server `selection_summary` for scope
counts. Other-group selections are disclosed next to preview, with a direct
selected-only view across the scan. Navigation clears only filters/search/pages,
preserves decisions, opens mobile detail and transfers focus. Precise counts are
hidden during failed/pending reads; legacy responses retain a general all-scan
scope statement. The same component serves import and global scans; group rows
show protected/conflict counts only when nonzero.

`CleanupRuleEditor` also captures the personal `edit_token` with its matcher
revision. Trial/save and explicit base adoption retain this token so name-only
remote edits enter the same draft-preserving comparison flow. It is request
metadata, not another user-visible version field or a new confirmation step.

## Personal noise-rule actions (local, 2026-10-07)

CleanupRuleRow owns enablement, version selection and removal recovery. Confirmed
results update the rules cache before background invalidation; unknown results
require a read-only state check. The settings parent owns removal acknowledgement
and focus based on rendered order. Row writes are cancellable, time bounded and
guarded against account changes. Failed rule-list reads keep existing rows readable
but disable changes. History uses a fresh read on expansion, localized configuration
labels and bounded text; stale/error history cannot be selected. See the
[cleanup contract](CONTENT_CLEANUP_CONTRACT.md#personal-rule-actions-local-2026-10-07).

## Rescan recovery (local, 2026-10-07)

ContentCleanupPanel owns one `useCleanupRescan` for its displayed scan. Selection
and conflict-preview controls share it even when the selection subtree is hidden;
FAILED/STALE uses the same controller. Account/original-scan sessionStorage retains
unconfirmed request IDs; checks are read-only and retry reuses that ID. Confirmed
scan responses seed the cache before navigation and background list refresh.
Saved old choices get a conditional explanation and previous/newer navigation.
Revisits read fresh scan/group/page data; unavailable reads keep the return route
but cannot leave a cached review actionable. Feedback is separate from the stable
footer command row. See the [cleanup contract](CONTENT_CLEANUP_CONTRACT.md#rescan-recovery-local-2026-10-07).

## Global scan recovery (local, 2026-10-07)

GlobalCleanupScan owns admission acknowledgement, uncertain-result checks and
same-request retry beside the rule-library command. Account-namespaced
sessionStorage preserves only an unconfirmed UUID across reload; it never
automatically resubmits or supplies authorization. Reads/writes are cancellable
and bounded; authentication-generation guards protect callbacks. Successful
admission is independent of task-list reads. Settings and review parents close
their overlay before opening the shared task center. Empty scope and no-rule
errors have actionable localized feedback; the latter refreshes stale rule rows.
Shared modal focus restoration respects the top visible modal. A closing sibling
cannot restore focus to an underlying settings trigger after Task Center opens;
nested confirmations can still return to their opener inside the remaining modal.
See the [cleanup contract](CONTENT_CLEANUP_CONTRACT.md#global-scan-admission-recovery).

## Exception recovery (local, 2026-10-07)

CleanupExceptionEditor distinguishes current scope, unknown save and failed
result read. Confirmed responses update scan/candidate caches after cancelling
older reads; refreshing a list does not delay acknowledgement. The review keeps
its selection subtree mounted during exception/learning edits and restores
context and focus. CleanupExceptionList preserves readable rows on refresh
failure, immediately removes confirmed revocations, recovers shrinking pages,
and offers idempotent retry for uncertain deletion. Exact scope is scrollable
and keyboard accessible; extra instructions are expandable. The
[cleanup contract](CONTENT_CLEANUP_CONTRACT.md#exception-recovery-local-2026-10-07)
owns the response fields, state checks and authentication guards.

## Registration settings recovery (local, 2026-10-07)

AdminRegistrationSettings uses the existing bounded admin client and a four-field
patch. Saved policy is independent of SMTP discovery and draft state. Recovery
messages/comparison and their actions precede invitations; reading latest policy
keeps the invitation subtree mounted. The local patch is reapplied only for review,
with another explicit Save required. A latest read that already matches resolves
without another mutation. Locale is presentation state and does not trigger policy
reload. Draft-discard guards include existing invitation state; no persistent policy
draft cache or automatic mutation retry is introduced. See the
[authentication contract](AUTHENTICATION_CONTRACT.md#registration-policy-recovery-local-2026-10-07).

## Feature settings recovery (local, 2026-10-07)

AdminFeaturesPanel derives a whitelist patch from the displayed baseline, sends
its opaque revision, and owns distinct conflict/unconfirmed/read-failure states.
Bounded reads preserve input and compare only deliberate edits against current
server settings. Reconciliation updates untouched fields without another write;
an explicit Save or Use server policy completes the choice. Matching current
values resolve without a redundant mutation. Focus moves to recovery feedback,
and Save follows the comparison in document order. Existing UI tokens and settings
dismissal guards remain; details live in the
[administration contract](ADMINISTRATION_CONTRACT.md#feature-policy-recovery-local-2026-10-07).

## Skill replacement recovery (local, 2026-10-07)

SkillBundleFiles owns the retained file, base revision, latest-version read and
explicit conflict replacement. It shares file-metadata acknowledgement across
personal/system lists through skill-cache; resolved content is reset independently.
Successful writes settle before background refresh. List failures remain separate
from write results, and late reads are cancelled before applying acknowledgement.
System metadata updates preserve account preferences. Read, compare/download and
retry are inline actions with focus recovery; no file viewer/editor is introduced.
The [Skill contract](CONTEXT_SKILL_MIGRATION.md#bundle-replacement-recovery-local-2026-10-07)
defines revision-0 recovery, bounded reads and idempotent retries.

## Account settings recovery (local, 2026-10-07)

AccountSecurityPanel separates identity and session reads/loading/errors. A nullable
username draft derives untouched input from the saved profile; saving updates that
baseline without overwriting newer input. Device Refresh leaves identity/password
forms mounted and preserves focus. Local errors provide the matching read/save
retry. Both reads cancel obsolete requests and check the authentication generation;
profile writes cancel prior reads and suppress identity refresh while pending.

Logout-others acknowledgement updates the list before its independent refresh.
A failed refresh preserves confirmed completion; a lost mutation response requires
fresh reads before another revoke. Feedback sits beside its action and the saved
form identifies any newer unsaved input. Existing settings sections, responsive
identity columns and email/password/pending-signout flows are retained. See the
[authentication contract](AUTHENTICATION_CONTRACT.md#account-form-and-device-recovery-local-2026-10-07).

## Cleanup completion recovery (local, 2026-10-07)

CleanupReviewWorkspace stores confirmed application separately from the source
reload mutation; reload failure never offers another apply. The owner can check
an unconfirmed result and retry a failed read. ContentCleanupPanel reopens saved
completion from Task Center after the scan is gone. Mobile MessageItem closes
its action sheet when handing focus to the source editor. Recovery, preview
conflict limits and task lifetime are defined in the
[cleanup contract](CONTENT_CLEANUP_CONTRACT.md#completion-recovery-local-2026-10-07).

CleanupCandidate owns per-row disclosure, using exact match highlights and compact
context before expanding full context and optional rule actions. Mixed scans keep
the conversation title visible. CleanupCompletion focuses the confirmed result;
the workspace/panel report result state to ContentCleanupDialog so only that state
uses content height and a narrower desktop width. Source selection and scan/rule
controls disappear on completion. The header remains fixed while the result body
scrolls on short screens. Review/preview still use the full workspace, and rules
view cannot display an unrelated scan-error/completion panel.

## Share settings recovery (local, 2026-10-07)

The shared ShareEditor submits only fields changed from its baseline, plus an
opaque settings revision. Both My shares and the conversation Share drawer use
this editor. A conflict retains the draft, reads the owner's latest settings and
focuses the comparison. Loading server values requires explicit draft discard;
merging keeps only locally changed fields and still requires a separate Save
confirmation. Revoked links cannot be merged or saved. Exact untouched expiry
and selected-message grants are retained; password values are never shown.

Save/latest reads have a 15-second bound. Authentication, permission, missing
target, invalid settings and rate-limit errors have distinct recovery copy;
permission failures refresh capabilities. My shares merges per-item revoke
results so retrying one failure does not hide the others. Successful list reloads
clamp a now-invalid page offset and restore list focus/scroll. These changes do
not alter public URL or capability semantics. The server concurrency/compatibility
contract is in [API reference](../api-reference.md#shares); acceptance and known
limits are in [the dated audit](../execution/ux-audit-share-recovery-2026-10-07.md).

## Mobile sheets and copy recovery (2026-10-05)

MobileReaderSheet keeps its working area within the active 60%/92% viewport snap,
with a fixed title and bounded child scrolling. The offscreen Vaul surface must
not determine content height or scroll the title away. The tools grid scrolls
independently on short screens; navigation, Share and export retain their existing
focus ownership and return targets.

Skill handoff copying shares text-bound pending/success/failure state. Missing or
denied Clipboard access reveals, focuses and selects a read-only manual field,
scrolling it into view while keeping download available. A later successful write
hides that fallback. UI feedback never treats a rejected write as success.

## Whole-site interaction contracts (2026-10-04)

New/inserted-message and project-setting forms share dirty-close confirmation and
in-flight write guards. Project settings use bounded scrolling inside fixed
header/footer; disabled fieldsets sit inside the scroll container. Modal keyboard
ownership follows the highest visible dialog layer, comparing ancestor modal
layers before each nested dialog's local z-index, with DOM order breaking ties.
An inner noise review owns Escape while its Task Center stays open; unsaved rule
confirmation keeps both layers and the draft intact until explicitly discarded.
Project menus are body-level, touch-visible and keyboard-operable; activation
must not reach an ancestor DnD sensor. Named project symbols and validated colors
fall back for unknown legacy values. Phone project creation uses the existing API.

Search scope and accumulated pages are keyed together without remounting filter
controls. All status is a non-default scope. Button submit searches; Enter opens
a result after deliberate keyboard selection on the current query. Stale debounced
results and IME confirmation cannot navigate. Visual/keyboard order agrees;
load/error/empty states are distinct and retry preserves the query.

Sidebar quick search preserves its initial first-result shortcut, but explicit
keyboard/hover selection follows `document_id` across same-query refreshes.
If that selected result disappears, no replacement is silently selected; Enter
opens the existing full-results route and arrows restart from a visible row.
A query edit clears explicit selection. The debounce, eight-result bound,
fresh-query/IME guards, query key and result URL parameters remain unchanged.
The compiled handler regression passed **12/12** on 2026-10-16; targeted
ESLint, nonincremental Web typecheck and diff whitespace also passed. The
adapter does not establish mounted React, live transport or browser/focus
acceptance. Details remain in [the selection report](../execution/ux-audit-sidebar-search-selection-2026-10-15.md).

Current-conversation search separately retains an explicit occurrence key
(document/message/version, block, match range and quote), so reordered matches
inside one document remain distinct. A disappeared selection has no highlight
or Enter target, with a neutral notice after a successful refresh; arrows use
the current visible index or restart at the first row. Query/role/type edits
clear the identity. The optional `activeOccurrenceKey` travels only through
the existing in-memory `ConversationSearchPanelState`; old numeric initial
state remains readable. Activation publishes the chosen key before waiting for
navigation, including click/tap without hover. Request bounds, ordering,
debounce, retry preparation, offline network mode and true-anchor navigation
remain unchanged. This [follow-up](../execution/ux-audit-conversation-search-selection-2026-10-15.md)
passed 48/48 controlled-component cases on 2026-10-16; targeted ESLint,
nonincremental Web typecheck and diff whitespace also passed. It is not
browser/focus/touch/scroll or measured-resource acceptance, and the separate
navigation-lifecycle/offline-retry regressions remain independent.

Search activation additionally owns a layout-effect scope keyed by raw query,
role/type, source/conversation and active visibility. Close/unmount or a scope
change retires completion; only the latest activation may publish feedback or
close the panel. An optional `isCurrent` callback fences the Reader adapter's
search context/highlight publication before/after navigation without storing
that callback in `SearchNavigationContext`. Desktop search receives the
source-editor visibility gate because the drawer retains hidden children;
closed mobile sheets already unmount them. Repeated activation of the same
pending occurrence is ignored before rebuilding targets; a different target
can supersede it. Localized pending/failure feedback keeps results usable,
contains rejection and treats cancellation neutrally. No automatic retry or
active cancellation of begun Reader loads/scrolls is added. Footer search
previous/next is covered by the separate Reader-retirement section above.
This [lifecycle follow-up](../execution/ux-audit-conversation-search-navigation-lifecycle-2026-10-15.md)
has a shared component result of 48/48 through the selection continuation;
the Reader-retirement-specific regression and browser/cancellation acceptance
remain unexecuted.

Attachment/export counts stay unknown on failure. File operations retain failed
names/selections; copying waits for clipboard completion. Export status retry
reuses the existing job. Task Center keeps detailed progress/actions; sidebar and
mobile show one bounded launcher. Zero-hit ready scans are not review prompts.
Reads/actions report errors and both languages retain offline packaging phases.

## Settings presentation (2026-10-03, local)

Settings entry rows display names without duplicated descriptions. Preference sync
success stays quiet; pending changes, conflicts and failed saves remain actionable.
Help places environment/version/offline facts in a small footer. Account identity
shows the role beside its heading and uses two field columns when space allows.
My shares exposes access/scope/expiry from the status through hover, focus or tap;
the disclosure stays inside the modal focus boundary, supports Escape and outside
dismissal, and avoids covering the row actions. Source navigation stays in More.
Import-format details carry version/verification information rather than default
row prose. Skill selectors retain ZIP/Markdown upload and replacement without a
viewer; native file inputs are operated by labeled buttons.

Ordinary transcript import and the initial empty state no longer offer `.cr`.
Settings Data & backup owns personal restore and the existing single-conversation
archive entry. Both use existing services; the latter opens the shared import
component in archive-only mode with an explicit restore title. Context returns
remain beside Reader annotations. Wrong files receive a correct-entry message.

## IA Round 2 shell ownership (2026-08-25, local)

`SidebarPreferences` is a lightweight, non-modal region that expands upward
from the persistent sidebar footer without changing the shell layout. It does
not close on main-content clicks; its footer trigger and Escape own collapse
and focus restoration. Data/backup, learned
Import Format management and Account Security are rendered in the shared
focused dialog pattern (`SettingsFocusedDialog`) so dirty state, Escape/close
and focus restoration are owned by the focused surface rather than a transient
popover. Existing Reader and import contextual shortcuts still call the same
underlying panels.

Project containers are fetched and rendered with the existing custom-order
contract only; legacy project-sort preferences remain readable for
compatibility but are not a Web presentation authority. New projects receive
the next spaced `sort_order`. Conversation sorting remains independent within
Projects and Unclassified. DnD overlays use the measured source-row geometry,
disable native Link dragging and remain presentation-only.

Reader navigation keeps canonical target resolution separate from visual
feedback. Exact quote/offset targets produce a fixed, short-lived first-line
pulse after alignment; message fallback produces a left marker. Message and
block components no longer receive a persistent full-surface navigation ring
from the owner Reader; search match highlighting remains its own layer.

All feature entry points construct targets through
`features/conversations/reader-locator-target.ts`. TOC, Attachment, Annotation
and Markdown source navigation therefore carry the same stable
message/version/block identity and fallback policy before entering the Reader
executor. The Markdown adapter translates CodeMirror code-point positions and
Markdown syntax into block-local canonical offsets; it must not send a global
raw-source offset to the API resolver. Target construction, server resolution,
virtualized mounting/alignment and short-lived locate feedback remain separate
layers so a feature cannot silently invent its own positioning contract.

`ProjectSidebar` exposes a stable `Tasks` launcher. `TaskCenterDialog` renders
the existing `ImportTaskMonitor` in a global surface; sidebar and mobile
representations are shortcuts to that same monitor, not separate task stores.
No worker, queue or task-history model was added.

`ImportPanel` keeps a committed import open long enough to present a truthful
terminal summary. The response's existing conversation IDs are used for
compact direct links and Library return; no ImportBatch entity or persistent
results route is introduced.

When the ImportPanel remounts, its saved adaptive-session UUID has an explicit
restore state. A transient `getAdaptiveImportSession` failure retains the
sessionStorage pointer and exposes a read-only Retry; it does not create,
commit, cancel or retry a server task. Only a confirmed terminal session or
explicit new-file selection removes that pointer. The restore state is separate
from commit/status errors.

`ImportNoiseReview` links that completion to the latest existing scan of the
same import, with bounded reads, independent progress/retry and nested-dialog
focus restoration. `CleanupReviewWorkspace` adds server-paged group title search,
explicit current scope and conversation-wide rule review; selection remains
mounted but hidden during preview so expanded contexts and return position survive.
See [cleanup navigation](CONTENT_CLEANUP_CONTRACT.md#import-entry-and-review-navigation).

`ConversationAttachmentPicker` distinguishes a successful empty attachment list
from a failed or stale list read. A failed read keeps cached available rows
visible when present and offers a read-only Query Retry; it never inserts,
uploads or deletes an attachment. The empty state is only shown after a
successful read.

Inline attachment blocks read the resolved interface locale once at the block
boundary and pass it to their loading, error, preview, media, file-row and
download labels. Shared attachment type metadata accepts the same locale
without changing the render plan or attachment access contract.

`CleanupRuleEditor` acknowledges a confirmed saved rule before list refresh,
preserves unconfirmed drafts for an explicit read-only result check, and compares
localized configuration fields. Comparison reads never reuse stale actionable
data. Library return restores the edited-row/new-rule focus; see
[rule editor recovery](CONTENT_CLEANUP_CONTRACT.md#rule-editor-recovery-local-2026-10-07).

`CleanupChangePreview` verifies code-point removal metadata against complete
before/after text, marks exact removals and offers keyboard-operable local-pane
navigation. Missing/malformed/inconsistent ranges fall back to plain full text;
conflicts never draw proposed removals. No Reader anchor or selection write is
performed by difference navigation. See the
[presentation contract](CONTENT_CLEANUP_CONTRACT.md#candidate-and-result-presentation).

## Skill registry (2026-08-29, local)

`SkillSettings` is rendered inside `SettingsFocusedDialog` and consumes the
owner-authenticated `/api/skills` registry. Metadata and revision-bound Bundle
downloads use the selected user Skill; Offline keeps cached built-in defaults.
No Skill viewer/editor is exposed. See the current [Context contract](CONTEXT_PACKAGE_CONTRACT.md).

## Reader semantic Markdown copy (current)

Owner Reader, public Share and Offline Reader use one copy boundary. Complete
render blocks contribute the same Markdown source used by their renderer;
partial DOM selections are serialized semantically so emphasis, strikethrough,
links, inline/fenced code, headings, lists, quotations and tables remain useful
Markdown. Message metadata, role labels, toolbars and controls are excluded,
and cross-message bodies are separated by one blank line.

For long virtualized messages, the virtualizer temporarily pins the inclusive
block interval between the selection anchor and focus. It releases those rows
when the selection collapses or leaves the message, so semantic copy does not
disable the existing long-message virtualization contract. If a selection
cannot be represented reliably, the boundary leaves the browser's native copy
behavior untouched rather than returning truncated content.

## PWA negative-path resilience (2026-08-15)

Release E keeps the existing /library Service Worker architecture but makes
offline negative states explicit. A cached Library navigation is served only
when the active shell's critical resources are still present; missing critical
JavaScript or stylesheet resources return a standalone offline-incomplete page
with retry guidance. Optional built-in Skill ZIP assets do not block Library or
Reader startup.

Offline package updates preserve the last committed conversation package.
Attachment bytes are written to immutable attachment id plus sha256 cache keys,
validated before use, and only supersede old cache entries after the Dexie
transaction commits. Cache quota errors, truncated packages, Dexie aborts,
browser/SW restarts and corrupted bytes cannot mark partial data ready.

## Offline shell and offline Reader attachments (2026-08-11)

Sync-center follow-up (2026-10-15, source only): parent local-ledger reads pause
while conflict/cleanup subviews replace the center, and resume on return.
Pending/Failures publish their ledgers without inspecting cached attachments;
only visible Copies invokes the existing mode-specific asset checks. Background
download/sync managers, cache-validation rules and late-publication guards remain.
Already-started checks cannot be actively cancelled by these helpers. The
[inspection report](../execution/ux-audit-sync-center-hidden-inspection-2026-10-15.md)
records unexecuted regressions; no device cost reduction is claimed as measured.

Its separate [read-state follow-up](../execution/ux-audit-sync-center-read-states-2026-10-15.md)
binds local result readiness/error to tab/page/asset mode. Ledger rows, empty
claims and pagination require matching success; that success may remain visible
during refresh with a loading status. A new scope retires the prior marker before
shared ledger fields are republished. Storage/assets errors are independent of
action feedback. Local Retry reopens only the local subscription, and ledger
failures invalidate older asset-check publication. Preference status and
download/catalog controls remain independent. The partial-read follow-up below
supersedes that batch's aggregate-failure boundary; all related adapter/source-
guard regressions remain unexecuted.

The [tab-read-scope follow-up](../execution/ux-audit-sync-center-tab-read-scope-2026-10-15.md)
(source only) conditions that same live-query reader on the visible tab.
Copies keeps conversation page/count and download tasks; Pending keeps
operations, draft prefixes and conflicts; Failures keeps tasks, conflicts,
failed rows/count and bounded displayed-copy existence. Initial-job task
targeting remains on Pending. Existing ordering, paging, read-state markers,
visible asset checks, managers and writes remain; no runtime/resource
measurement or reader-suite execution occurred.

The [partial-read follow-up](../execution/ux-audit-sync-center-partial-read-recovery-2026-10-15.md)
(same date, source only) settles each tab-owned section independently inside
the same local subscription. Successful siblings publish after settlement even
when another section fails; the scoped marker records failed section names.
Each ledger renders only its own confirmed result, missing sections are named,
and empty/pagination claims require all reads that establish their count.
Initial-task lookup resolves only from a successful task read. Asset checks
remain Copies-only with late-result fencing and specific feedback. Cleanup
requires confirmed download status and combined export requires its full
pending-read scope. Retry only reopens the subscription; no polling, stored
record, package, API or background-manager change. Both existing regressions
are updated but unexecuted; no runtime/resource acceptance follows.

The [visible-inspection coalescing follow-up](../execution/ux-audit-sync-center-inspection-coalescing-2026-10-15.md)
(same date, source only) keeps one running Copies page and one replaceable
latest pending page per effect lifetime. All started sibling verifiers settle
before that page slot is released, even after rejection. New emissions retire
intermediate pending work; failed ledger/copy reads, navigation returns and
cleanup retire it without starting another scan. Existing verifier policy,
row order, mode and sequence/access guards remain; this is not a result cache.
Already-started work cannot be actively cancelled, including across effect
lifetimes. No new watcher/timer or measured CPU/RSS benefit; the shared
extracted-effect regression is updated but unexecuted.

The [conflict merge draft follow-up](../execution/ux-audit-offline-conflict-merge-draft-refresh-2026-10-15.md)
(same date, source only) initializes the manual merge from the stored draft
or local comparison once per conflict visit. Later comparisons refresh both
versions but retain the current merge, including failed/pending saves or edits
made after a read began. Finite error categories are translated at render time;
locale changes no longer reload/refocus comparison. An actual conflict-key
change resets visit state, and generation/version guards retire old read/save
completions. Explicit local/server-as-draft controls, persistence keys,
save/retry, dirty protection and underlying resolution services are unchanged. This
does not cancel existing writes or reconcile cross-tab drafts. The controlled
component regression is authored but unexecuted; browser/focus/storage
acceptance remains pending.

Its separate [resolution recovery follow-up](../execution/ux-audit-offline-conflict-resolution-recovery-2026-10-15.md)
(same date, source only) represents an unconfirmed marker as neither comparison
nor pending. Failed initial marker reads and failed post-action recovery
lookups show finite localized status feedback and a read-only recheck; new
choices and request retry wait for confirmed status. Recheck reads the marker
and, if eligible, comparison without preparing/submitting a resolution.
Current merge memory and dirty protection remain. Submit captures the existing
generation before confirmation and checks it across awaits, so retired work
does not start its next step, update the later visit or call the old `onBack`.
Already-started writes/requests are not cancelled. There is no new queue,
receipt, watcher, API or storage change; the shared regression is updated but
unexecuted, not browser/storage acceptance.

Offline continuation read-state follow-up (2026-10-15, source only): the existing
local query distinguishes waiting/error from missing copies/members, normalizes
missing rows to null and offers non-cancelling local Retry. Matching cached
content survives transient refresh errors with a notice; locked-access read
errors hide it. Captured database and access checks fence the awaited read.
Current/Index choice, source mode, child renderers and reference navigation are
unchanged. The [read-state report](../execution/ux-audit-offline-continuation-read-states-2026-10-15.md)
owns source evidence and unexecuted regressions, not browser/focus acceptance.

Source-only follow-up (2026-10-15): core Offline Reader metadata, saved-position,
initial complete-turn and dialogue/section queries/prefetches use an explicit
local `always` network mode, passed through all four navigation placements.
Shared components omit an unspecified override to retain remote/Share caller
defaults; QueryProvider, keys, enabled conditions, limits and anchor semantics
are unchanged. Local utility subpanels are separate query owners. The
[query-policy report](../execution/ux-audit-offline-reader-query-policy-2026-10-15.md)
records the source evidence and the focused 2026-10-16 regression (**10/10**),
plus targeted ESLint, nonincremental Web typecheck and diff whitespace checks;
mounted browser/offline-device acceptance remains open.

Attachment follow-up (same date, source only): local file-list, inline metadata,
Viewer shell and lazy Viewer-item queries execute independently of the online
gate; remote/Share/admin defaults and scope arguments remain inherited.
Query lifetimes, enablement, read helpers, verified bytes and URL cleanup are
unchanged. The [attachment scheduling report](../execution/ux-audit-offline-attachment-query-policy-2026-10-15.md)
records separate source bindings and unexecuted regressions. The sampled
annotation/notebook direct reads and already-local offline continuation query
needed no scheduling edits; broader recovery acceptance is not implied.

`offline-shell.ts` separates shell availability from background update phase. A complete active service-worker shell is usable immediately; dynamic viewer warming and deterministic shell reconciliation never gate Library interaction or conversation-package downloads. The inventory contains document scripts/styles/icons, the offline search worker, declared viewer runtime chunks and the optional built-in Acquisition ZIP. It deliberately excludes API responses, images and historical `performance` resource entries. If reconciliation fails, the previous active shell remains ready and the UI exposes a retryable background-update state.

Offline Reader uses `ReaderDataSource.capabilities.attachments = "read-only"`. The same `current conversation files` action opens the existing `reader-floating` workspace (or mobile sheet), but the panel reads only `offlineDb.attachments`, displays occurrence locations and offers cached Viewer/download actions. It cannot upload, insert, rename, detach or delete and never enumerates server attachments. Missing cached originals resolve to `offline-unavailable`; Object URLs are released after consumption. Viewer opening still follows the single `AttachmentViewerProvider -> AttachmentViewerShell` path.

Offline export is a browser-local projection of the downloaded snapshot. It does not call export APIs, workers, search, derivatives or batch ZIP. The local `.context.zip` follows the [Context contract](CONTEXT_PACKAGE_CONTRACT.md), includes optional cached saved members and only cached assets; missing assets stay explicit records. Delivery downloads the built-in Acquisition ZIP and copies usage instructions in the selected language. Clipboard denial is retryable and does not block package download. No Skill viewer or uploaded script execution is involved; legacy Markdown URLs remain compatible.

## Reader wheel and virtual-layout contract (2026-08-10)

The Reader keeps the existing six-message window and TanStack block virtualization. Wheel responsiveness depends on stable row estimates and a single hot path rather than disabling virtualization or weakening navigation accuracy.

- `ReaderBlockLayoutMetrics` is derived from the stable Reader content width, computed font size/line height and density. It changes only after mount, font readiness, explicit Reader layout events or real width/preference changes; ordinary wheel input cannot invalidate it.
- `estimateReaderBlockSize` estimates paragraph visual lines with explicit newlines and Unicode display width, derives heading geometry by level and line count, and derives code geometry from actual source lines plus the renderer header/padding/collapse cap. Empty content uses the real minimum rhythm. Tables, media and attachments retain bounded type-specific estimates.
- A measured virtual row remains authoritative. Measurement compensation is allowed only for rows wholly above the current reading line; first measurement of partially visible or later rows cannot rewrite the active wheel displacement.
- `ActiveReadingTarget` is resolved at the reading line with `elementsFromPoint()`. Only whitespace misses use the bounded rendered-block registry and mounted-message fallback; the scroll frame never scans every mounted block.
- Owner and Share readers use one passive listener per scroll owner. Active sampling runs at most every 80ms plus one trailing sample. Reading-position persistence is one idle write after approximately one second; the full character anchor is not calculated during dense wheel input.
- Edge loading is sentinel-IntersectionObserver driven. The listener records direction only; an already-visible sentinel can consume that intent once, but no pixel threshold issues a second request.
- The virtual total-size container is not a Reader layout observer target. Per-row measurement remains enabled, while `scrollMargin` is recalculated only for mount/window merge/prepend and explicit layout changes.
- TOC rows are memoized and receive the derived active heading. Auto-follow is scheduled in a frame and changes the TOC's own scroll only when the heading is outside its viewport. Conversation Index updates only when the active message changes.

Public APIs, persistence formats, Reader width, revision semantics and stable DOM navigation anchors are unchanged.

## Attachment inline lanes (2026-08-09)

`AssistantMessageRenderer` groups adjacent attachment RenderBlocks without crossing ordinary text. `AttachmentInlineGroup` resolves each Attachment through the shared access/query and RenderPlan registry, partitions consecutive semantic runs, and mounts one centralized lane. The six primitives are RichPreview, DataPreview, ImageGallery, AudioList, VideoPreview and FileList.

Geometry is centralized in `app/globals.css`: 45rem reading, 55rem data, full-width gallery, 38rem audio/file and 43rem video. Individual Renderer components only render group-internal rows/panels. Runtime image/media failure reports back to the group and moves the item to FileList without changing static capability. The unified adaptive Viewer remains unchanged except that the inline `+N` tile requests its existing Overview mode.

## Source workspace performance boundary (2026-08-04)

- `ConversationReader` owns only the active source message and dirty/cross-message state. Same-message cursor follow is dispatched imperatively once per animation frame with an offset threshold; wheel input no longer increments a React state counter.
- `FloatingWorkspacePanel` has a source-specific `left-overlay` placement. Its first desktop frame already has `clamp(560px, 32vw, 720px)` width; pointer movement mutates panel width directly, while React state and localStorage update on pointer-up. The Reader captures its unshifted left edge once per editor session and uses that stable baseline for width changes.
- `EditMessageForm` passes `theme="none"` to `@uiw/react-codemirror`. A CodeMirror `Compartment` reconfigures the complete theme extension so document, selection, undo history, and unsaved source survive runtime theme changes.

最后核验：2026-08-05

## 技术与目录

| 类别 | 实现 |
| --- | --- |
| 框架 | Next.js 16.3.6 App Router、React 19.2.8、TypeScript、Webpack production build |
| 服务端状态 | TanStack Query |
| 长消息虚拟化 | TanStack Virtual（动态测量 RenderBlock） |
| 本地状态 | React context/state；局部 Zustand |
| 样式 | Tailwind CSS 3 + `app/globals.css` CSS variables |
| 交互 | Lucide、Vaul、dnd-kit |
| Markdown | react-markdown、remark/rehype、Shiki、KaTeX、Mermaid |
| 离线 | Dexie、FlexSearch、fflate、Service Worker/Cache API |
| 测试 | ESLint、TypeScript、Playwright 1.62.0 |

```text
apps/web/
├── app/          route segments、root providers、loading、globals.css
├── components/   全局壳、可调框架、drawer/sheet/dialog、preferences
├── features/     annotations/conversations/editing/exporting/import/
│                 offline/projects/reading/search/sharing/toc
├── lib/          API、types、ReaderDataSource、Dexie、offline repository
├── public/       manifest、Service Workers、icons
└── e2e/          reader-layout、reader-restoration、library-offline
```

页面列表见 [PAGE_AND_ROUTE_MAP.md](PAGE_AND_ROUTE_MAP.md)。根 layout 提供 Query、Preferences、InteractionDialog、ImportDialog、Shortcut、OfflineSync 和 ServiceWorkerRegistration。

## 数据与状态边界

- API client 始终使用相对 `/api/*`；普通请求由 `next.config.mjs` 通过
  `API_INTERNAL_URL` rewrite。生产 Nginx 仅将三个精确的大文件上传路径直接流式
  转发到 loopback FastAPI，以绕开 Next 的请求正文内存克隆；浏览器 URL 和权限
  合同保持同源不变。
- TanStack Query 管理在线列表、详情、TOC、位置和 mutation invalidation。
- `ReaderDataSource` 统一 remote/offline 合同；`capabilities` 控制编辑、Share、Export 等入口。
- PreferencesProvider 从当前账户 Dexie settings 恢复偏好，再通过 `/api/preferences/sync` 按字段 revision 同步。旧 localStorage 仅按已绑定 UUID 一次迁移；窗口几何仍留在设备。存储失败保留内存草稿并显示重试，详见 PWA 离线合同。
- Reader 的阅读进度以现有真实锚点写入同一账户 readingPositions/outbox，服务端按 revision 比较。远端更新不移动当前 Reader；冲突需明确选择，恢复、程序导航和布局补偿不计为用户滚动。
- Reader target 包含 source identity/revision、conversation/message/block/offset/quote，防止在线、离线和旧 revision 混用。
- 选择控制器统一 Project、未归类和归档列表的桌面/移动批量状态。

## 主要组件关系

```text
RootLayout + providers
├── AppShell
│   ├── ProjectSidebar
│   └── routed list content
├── ConversationReader
│   ├── ReaderSidebarFrame
│   ├── complete-turn window -> MessageItem -> Markdown renderers
│   ├── ConversationIndex + ConversationToc
│   ├── ReaderUtilityDrawer(search/share/export)
│   ├── ConversationFilesPanel -> upload sessions / attachment picker
│   ├── SourceEditorWorkspace -> FloatingWorkspacePanel -> CodeMirror
│   └── AnnotationWorkspace(floating/docked/expanded)
└── LibraryShell -> OfflineReaderDataSource -> ConversationReader
```

## Reader 与渲染

AI Rich Markdown 使用一个共享 semantic core：Reader、Source Editor live preview 与 Markdown 附件 inline/Viewer 均复用 `rich-markdown-config.ts`。`remarkAiMathCompatibility` 在 mdast 阶段恢复 ChatGPT `\(...\)` / `\[...\]`，`remark-math` 处理 dollar delimiters，GFM/footnote/code/link 安全策略保持一致。canonical Markdown 不改写；KaTeX 使用本地 CSS/font、MathML、`trust=false` 与有界 expansion/size。详细合同见 [AI_RICH_MARKDOWN_CONTRACT.md](AI_RICH_MARKDOWN_CONTRACT.md)。

`ai-rich-markdown-v5` 为已识别的 ChatGPT box/row/text/badge/divider 文本增加有界、
只读展示投影；不是启用 HTML 或接入 widget runtime。完整消息检测结果仅作为临时
metadata 传给各 block 和思考折叠区，保留源码、复制内容、task key 和真实 DOM 锚点。
源码预览只映射本次新增投影的偏移；既有数学预处理偏移边界不扩大承诺。

- 在线/Share 读取 `reader-turn`；Offline 从 Dexie 组装同一 response。完整轮次水合后才加入 DOM。
- 初始/位置恢复窗口最多 5 轮，用真实相邻正文为短消息目标提供阅读线对齐空间；边缘滑动 settled 后通常裁剪为 3 轮。用户进入首/末已加载轮次或接近 sentinel 时预取，返回轮次先按 `turn_key` 合并，锚点恢复后再按整轮裁剪。边缘事务持有阅读 block lease，继续同方向滚动不会取消事务，反向滚动才取消。
- 上下边缘都保留已加载正文直到新轮次挂载完成；加载中不伪造大块空白，只有 `has_more=false` 的真实会话末尾保留底部阅读留白。
- 普通消息完整挂载；仅 `block_count > 160` 或 `char_count > 50000` 的单条消息使用动态块虚拟化，overscan 为目标上下各 8 blocks，正文数据仍全部水合。
- 虚拟导航会先固定目标 block 到 range extractor，再挂载、测量和校正到 120px 阅读线；事务 settled/failed/cancelled 后才释放固定，避免测量过程中目标卸载。
- 单一 RAF sampler 根据 120px 阅读线决定活动位置；程序 scroll 不建立用户意图。
- ReadingPosition 写入 block-relative-v2，恢复按 block id、block/message index、order key、scroll ratio 逐级降级；导航或测量未稳定时不保存。
- Markdown 禁止 raw HTML 执行；链接协议受控。Shiki/Mermaid 失败回退为可读文本，代码/表格/图表在自身容器滚动。
- `reader_density_mode` 作用于 Markdown block 的垂直节奏；`reader_font_size_px` 通过相对字号保持 heading/code/table 层级。

## 响应式与工具面板

- 桌面侧栏、章节 TOC 和 utility drawer 可调宽并 clamp；批注浮窗可拖动/缩放/重置。源码工作区固定覆盖桌面左侧且占满视口高度，只允许拖动右边缘调整宽度；正文以打开前的稳定左边界向右让位，关闭后恢复原布局。移动端固定为顶栏下方全宽面板。
- 搜索、Share、Export 共用 `ReaderUtilityDrawer` 的宽度、Esc、焦点恢复和视口纠偏。Share trigger 在 More 菜单因 React 重渲染而失联时，Drawer 通过稳定 action identity 回退到当前 More trigger，绝不把焦点落到 `body`。
- 桌面“当前对话文件”复用批注式右侧 `reader-floating` 工作区：默认位于 Reader 右上安全区域，整个 header 可拖动，边缘可缩放，位置/尺寸可复位并持久化。header 使用 `grab`/`grabbing` 光标和强调色 `Paperclip`，不再默认占据左侧整高区域。移动端仍退化为顶栏下方全宽 sheet。
- 源码、搜索、批注等工作区互斥显示但保留已挂载状态。源码编辑不替换 `MessageItem` 正文；Reader 只在最近真实滚动输入且没有导航/恢复/边缘事务时，将活动 block 单向映射到源码。Reader 的全局键盘滚动意图明确忽略 CodeMirror、表单和可编辑目标。CodeMirror 使用稳定 memoized setup/update callback，并将外部基线文档与逐键 draft state 分离，避免输入或删除一个字符时重配置、回放旧 value 或切换活动消息。脏状态跨消息锁定，保存通过局部消息替换和 DOM 锚点补偿完成。实时预览保留 mdast 源码起止偏移；CodeMirror 顶部可见偏移选择最小包含语义块，并在块内插值驱动预览滚动。同步为源码到预览的单向关系，不把预览滚动解释为编辑意图。
- 专注模式隐藏主侧栏、对话索引、章节 TOC、离线提示和普通工具；退出恢复原锚点/面板状态。
- 移动端使用 Vaul/自定义 Sheet；无 desktop separator/rail。首页保留继续阅读，桌面隐藏。

## 浏览器持久化

### Formula-heavy Reader performance

Formula rendering continues to use the shared AI Rich Markdown pipeline with local KaTeX `htmlAndMathml`, `trust=false`, bounded expansion and local error isolation. The Reader now memoizes cross-block math projections and block/rendering subtrees so ordinary scroll updates do not re-run Markdown parsing for unchanged formula blocks. Virtual block estimation recognizes display math separately from code and currency, caps multi-row environments, and treats long display formulas as local horizontal surfaces. `.katex-display` owns horizontal overflow and uses layout/paint containment; the Reader body width and MathML accessibility output are unchanged.

| Key/存储 | 用途 |
| --- | --- |
| `chat-reader:user-preferences` | 服务器偏好的启动缓存 |
| `chat-reader:reader-default-focus` | 默认专注；旧 focus key 仅迁移一次 |
| `chat-reader:reader-sidebar-expanded`、`sidebar-width` | 侧栏状态/宽度 |
| `chat-reader:section-toc-width`、`reader-navigation-width` | 导航 pane 宽度 |
| `chat-reader:reader-utility-panel-width` | 搜索/Share/Export drawer 宽度 |
| `chat-reader:annotation-workspace-mode/panel` | 批注形态、位置和尺寸 |
| `chat-reader:source-editor-panel` | 源码工作区持久化宽度 |
| `chat-reader:conversation-files-workspace-floating-v2` | 当前对话文件浮窗的位置与尺寸 |
| `chat-reader:last-library-conversation` | 最近离线对话 |
| `chat-reader:share-position:<hash>` | Share 访客本地位置 |
| Dexie | 离线 conversation/messages/blocks/search/annotations/positions/outbox |
| Cache API | Library active/staging shell revisions |

`chat-reader:*` 中部分值是窗口间事件名，不一定是持久化 key。代码未发现认证 Cookie 管理。

## PWA

- manifest `scope/start_url` 都是 `/library`；`library-sw.js` 不控制普通管理页面或 API。
- 壳资源先写 staging cache，完整校验后原子切换 active revision；失败保留旧壳。
- `/sw.js` 负责注销旧 root-scope worker 和清理 legacy cache。
- 离线搜索以当前 Worker 的 init promise 和访问代次判定就绪，不把新建空 Worker
  误当成无结果。Reader 搜索的显式重试通过现有 Library 队列重建一次，再执行本次
  查询；普通输入不重建。本地搜索 query 使用 `networkMode: "always"`，远程策略
  不变。2026-10-16 无服务回归 19/19 通过，相关 ESLint 与非增量类型检查通过；
  真实 Worker/IndexedDB、浏览器和设备验收仍未运行，见
  [就绪与恢复记录](../execution/ux-audit-offline-search-readiness-2026-10-15.md)。
- 离线数据更新与壳更新独立：前者是 v3 conversation delta（兼容读 v1/v2/v3），后者是 Cache API revision。Dexie v2 保存附件 metadata/occurrence，小型或全量对象按 `asset_mode` 进入 Cache Storage。

## 附件 UI

- Reader“更多”中的“当前对话文件”复用 `FloatingWorkspacePanel` 的 `reader-floating` 形态。桌面默认在 Reader 右上侧显示约 400x620 的注释式浮窗；整个表头可拖动，左/右/下边缘可缩放，几何状态持久化且支持复位。表头使用抓手光标并显示强调色附件图标；若源码编辑器已打开则保留其状态，文件面板关闭或完成插入后回到源码。移动端使用覆盖式全宽文件抽屉。面板按已使用、未使用、缺失分组，支持搜索、上传、预览、下载、重命名、定位、插入和移除未引用文件。
- Markdown 源码工作区提供上传与选择已有文件；新文件先独立上传并显式提升为当前对话 Attachment，已有文件通过 `application/x-chat-reader-attachment` 只传递业务 ID，在光标或消息末尾插入 `cr-asset://` 引用。用户无需手写内部协议；若光标位于已有的独立附件行内，插入点移动到该行末尾，避免破坏原引用。
- 源码工作区的 CodeMirror DOM 事件只接受真实 `DataTransfer.files`；拖放通过 `posAtCoords` 显示插入光标，粘贴读取剪贴板文件，二者和文件选择共用 `AttachmentDraftCallbacks`。临时标记拥有独立进度/错误/重试/移除状态，完成后通过命令式文档替换保持阅读位置和源码光标。
- 代码围栏落点返回明确的调整意图并显示选择条；链接内部落点自动放到链接节点后。编辑器滚动和拖放位置不反向驱动 Reader，保存前任何 unresolved upload 均阻止提交。
- `AttachmentViewerProvider` 在根 layout 中只挂载一个 `AttachmentViewerShell` portal；旧 `AttachmentPreviewDialog` 仅是无 DOM 的兼容适配器。统一 shell 负责焦点、Esc/backdrop、共享 body scroll lock、滚动恢复和文件类型内核，Files Panel、Reader、Gallery 与旧入口不再创建第二套预览 DOM。
- Registry 将数据状态、静态 capability、单次 runtime 状态和 RenderPlan 分离。正文只使用 `media`、`preview-panel`、`file-row` 三种皮肤；missing、empty、unsupported、preview-failed 和 offline-unavailable 都是 FileRow variant。SVG 始终使用 `<img>`，Markdown 使用 inert renderer，Office/ZIP/CAD/3D 保持可靠下载降级。
- 连续图片仅在同一当前 MessageVersion 内组团；普通正文立即断组。2–6 张完整展示，超过 6 张显示前 5 张与 `+N` 入口。Viewer identity 使用 `message_version_id + occurrence_key`，`block_index` 只用于顺序和 DOM 定位。完整合同见 [Attachment Renderer Contract](ATTACHMENT_RENDERER_CONTRACT.md)。
- 附件继续只使用一个 `AttachmentViewerProvider -> AttachmentViewerShell`。Shell 前增加纯 UI `ViewerPresentationResolver`：音频为 compact，Markdown/Text/Code/JSON 为 reading，PDF 为 document，图片/视频为 media，CSV 与 Gallery Overview 为 workspace；桌面按内容自适应，移动端统一 100vw × 100dvh。最大化只改变 Shell CSS 状态，第一次 Esc 退出最大化、第二次关闭，不持久化到 Attachment 或 occurrence。
- Viewer Shell 的内容区保持 `min-height: 0; overflow: hidden`，具体 Renderer 是唯一滚动所有者。PDF page/fit/zoom 工具挂载到同一 Shell 顶栏；Fit Page 单页完整居中且不产生纵向滚动，Fit Width/自定义缩放由 PDF viewport 滚动。
- Owner Reader 的 GFM task checkbox 由 `MarkdownRenderer` 的 `interactiveTasks` 合同驱动，点击后进行局部 optimistic update 并调用稳定 task key 接口；Share、Offline 和附件 Markdown renderer 不传写回调，因此保持只读。
- 对话导出面板将格式与附件作为一级选项；简介、批注、笔记和 CanJSON 来源引用位于折叠的二级选项。普通导出与附件 ZIP 使用同一组参数。
- 离线导出面板的附件数量是信息性 Dexie 查询：loading、成功数量和 error 分支分别渲染；error 只重开该查询并保留导出操作，不把本地计数读失败转成零条，也不改变导出参数或离线包合同。
- 消息保存使用服务端返回的局部 message/version/blocks/occurrences 投影更新 TanStack Query；不重新加载整场对话，受影响消息单独重测布局，其他 MessageItem 引用保持稳定。
# 2026-08-09 Addendum: Conversation Editing And Complex Viewers

- The sidebar exposes a New Conversation dialog with title, project, User and Assistant fields. Both message bodies are required and submitted atomically.
- Reader message actions expose insertion before/after (single or User -> Assistant pair) and soft delete with an undo toast. Insert/delete mutations refresh only the affected reader data; no Trash UI is introduced.
- The single `AttachmentViewerProvider -> AttachmentViewerShell` remains the only body-level viewer. `ViewerKind` now includes document, spreadsheet, presentation and archive. A lazy `ComplexAttachmentViewer` starts a module Worker only after opening one of these supported attachments.
- The complex Worker enforces source, ZIP-entry, expanded-size and preview-byte caps before extracting read-only DOCX/ODT paragraphs/tables, XLSX/ODS bounded grids, PPTX/ODP static slide text, or ZIP directory entries with bounded text/image previews. Unsupported formats keep a reliable download row.

## Reader Scroll Hot Path

- `ReaderBlockLayoutMetrics` is derived from stable content width, font size, line height and density. Paragraph and code estimates are content-aware; the metrics cache changes only for width, font, density, font-load or explicit Reader layout events.
- TanStack Virtual owns measured row sizes. Automatic scroll compensation is limited to rows wholly above the 120px reading line, preventing partially visible rows from counter-moving a wheel gesture.
- `resolveActiveReadingTarget` uses `elementsFromPoint()` at the reading line and falls back to a bounded rendered-block registry only when the line is in whitespace. Owner and Share Readers use the same resolver.
- One passive listener coordinates direction, 80ms active-position sampling and a trailing sample. Reading-position persistence uses one trailing idle timer and calculates the full character anchor after scrolling stops. The container's changing total height is not observed.
- Previous/next sentinel IntersectionObservers are the only reader-window loading triggers. TOC receives the derived active heading and scrolls its own list asynchronously only when that item is out of view.
- Native scrollbar-thumb dragging is an explicit Reader gesture. Mounted virtual messages rebase their absolute coordinate before movement; edge-window fetch/merge is deferred until pointer release so `scrollHeight` cannot change underneath the captured thumb.
- A virtual message whose shell intersects the Reader viewport but whose mounted rows all miss that viewport is treated as a stale-coordinate gap. It reads its real absolute offset once and repairs `scrollMargin` without clearing TanStack's measured-size cache. This bounded recovery also covers Home/End, accessibility tooling and programmatic large jumps without adding layout reads to the ordinary wheel hot path.
