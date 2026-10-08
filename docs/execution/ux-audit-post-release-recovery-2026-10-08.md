# UX follow-on audit — recovery and navigation

2026-10-08 · Accepted application source `30a0d32` · Report delivered before fixes.

## Scope and evidence

This is a focused follow-on sweep of the existing desktop/mobile Web application,
not another full-product or visual redesign audit. The audience is ordinary users
organizing private conversation archives and returning to reading. Recovery must
be explicit; an archive operation is reversible, but its result must not be
misrepresented. Scope: conversation/project batch archive undo, search selection
and project filters, and Recent reading's refresh/progress states.

Evidence is source inspection plus three executable synthetic checks against the
accepted Git source: [reproduction script](ux-audit-post-release-recovery-2026-10-08-evidence/reproduce.cjs)
and [baseline result](ux-audit-post-release-recovery-2026-10-08-evidence/baseline.json).
The script executes the actual batch/order helpers and installed QueryObserver;
it makes no network requests and does not render components. Application source
at the documentation-only HEAD 31517c4 is identical to 30a0d32.

No production webpage was used. The original local Web-start policy refusal is
still unresolved; no alternative launcher was attempted. Existing accepted CI
screenshots do not cover these newly identified failure states. Their appearance,
focus and mobile layout need isolated CI browser verification after repair.
No accessibility-conformance or real-user failure-rate claim is made.

## The three things that matter most

Batch undo currently treats returned failures as completion, removing the user's
immediate retry path. Even a successful final-row archive removes the containing
list before its Undo control can remain visible. Search stores selection by array
index even though subsequent pages can insert a higher-priority group before it.
These are recovery and navigation defects, not reasons to add another settings
area. Two smaller read-failure states lose usable context or hide a missing
dependency, and Recent's progress lacks a programmatic name. The existing
design tokens and inline recovery patterns are sufficient for these repairs.

## Findings and priority

All six findings are defects; none is a taste preference. Effort estimates are
relative to the inspected components, not promises of elapsed time.

| Order / ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| 1 · ERR-01 | Batch undo dismisses despite failed items; duplicate undo requests are unguarded | Error recovery / status | High | Observed (code + synthetic helper execution); rendered effect inferred | M |
| 2 · ERR-02 | Undo is hidden when the conversation list becomes empty or its refresh fails | Recovery / state coverage | Medium | Observed (code); rendered effect inferred | S |
| 3 · NAV-01 | Grouped pagination changes the document selected by the same index | Navigation | Medium | Observed (code + executed ordering); browser activation inferred | S |
| 4 · STATE-01 | Recent replaces cached reading cards with a raw refresh error | State coverage / recovery | Medium | Observed (code + QueryObserver execution); rendering inferred | S |
| 5 · STATE-02 | Failed project-filter loading is presented like an empty project list | State coverage / forms | Medium | Observed (code); rendering inferred | S |
| 6 · A11Y-01 | Recent progress bars have values but no accessible name | Accessibility | Medium | Observed (code); screen-reader output untested | S |

### ERR-01 — retain the outcome of each undo attempt

**Location:** `apps/web/lib/batch-selection.ts:6`;
`apps/web/features/conversations/conversation-list.tsx:339` and `:560`;
`apps/web/features/projects/project-conversation-list.tsx:287` and `:484`.
The helper catches every item failure and resolves with `succeededIds/failedIds`.
All three batch undo closures discard that result; the two local `UndoToast`
implementations unconditionally call `onDone()` after awaiting the closure.
There is no pending guard or error branch. The synthetic check returns one
success and one failure without rejecting. The initial zero-success case also
creates a zero-item Undo, so the outcome handling is inconsistent throughout.

**User cost:** the person cannot tell which conversations remain archived and
loses the immediate retry even though undo was not complete. Repeated clicks can
issue overlapping writes. This does not delete conversation content, so it is
not graded as irreversible data loss.

**Recommendation:** share the existing inline Undo presentation, acknowledge
pending work, retain only unresolved items, expose concise failed/remaining counts
and retry, and dismiss only on complete confirmed success. Do not offer a new
Undo for zero successful changes. Unknown write outcomes should be read-checked
before another mutation; confirmed writes must not be replayed because a list
refresh failed. Reader's existing recoverable undo at
`conversation-reader.tsx:2666` is a local feedback precedent, not an instruction
to change Reader or add a global notification system.

### ERR-02 — keep Undo outside replaceable list states

**Location:** `apps/web/features/conversations/conversation-list.tsx:173`, `:211`
and `:264`. Error and empty branches return before the JSX containing Undo.
Archiving the last active conversation, or restoring the last archived one,
therefore excludes the newly created Undo from the component's returned tree.
The project conversation page already keeps its Undo outside its inner list state.

**User cost:** the action that most obviously empties the list also removes its
immediate way back. Users can still navigate to the opposite archive state, so
this is Medium rather than a blocked core task.

**Recommendation:** mount the Undo owner above loading/error/empty/data branches,
without creating a second component copy that remounts on state transitions.
Keep pending and failed recovery usable across refetch and empty-state changes.

### NAV-01 — selection is a document identity, not its current position

**Location:** `apps/web/features/search/search-page.tsx:41`, `:80`, `:96` and
`search-results.tsx:8`. Selection is only `activeIndex`; appending pages reruns
type ordering without reconciling selection. Executing the actual order helper
with a message followed by a later annotation changes index 0 from the message
to the annotation. `openSelected()` reads that new index target.

**User cost:** loading more can redirect the next Enter to a result the person
did not select. It costs orientation and another navigation; it does not mutate
content. Existing pagination tests use message-only results, which cannot expose
the cross-type insertion.

**Recommendation:** retain `document_id` and search scope, derive the visible
index, and clear selection when that identity disappears or scope changes.
Keep the existing grouping, arrow-key ordering, result links and history behavior.
Test mixed-type pagination and the actual Enter destination.

### STATE-01 — a failed refresh must not erase a usable recent list

**Location:** `apps/web/features/reading/recent-items.tsx:22`, `:69`.
`isError` unconditionally returns the raw exception before examining cached data.
The installed QueryObserver synthetic check retains one previous row while
`isError=true`; the component hides that usable row. `StateLine` exposes a
status role only for loading, not an alert for the failure.

**User cost:** an intermittent refresh blocks an already-known route back to
reading and presents technical error text. Initial no-data failure still needs
a distinct retry state.

**Recommendation:** keep cached cards and exact saved-position URLs visible,
add a short localized refresh alert/retry, and distinguish no-data from failed
refresh. The existing search error at `search-page.tsx:123` already retains old
results while explaining them. Do not cache new private data or relax auth locks.

### STATE-02 — a project request failure is not “no projects”

**Location:** `apps/web/features/search/search-page.tsx:61`, `:116`.
The dedicated project-filter query feeds `projects.data ?? []`, with no loading,
error, or retry handling around its select. A URL's active `project_id` can then
have no corresponding option even though the search request still uses it.
Sidebar project recovery belongs to another query and is not a substitute for
feedback beside this filter, especially when the mobile sidebar is closed.

**User cost:** the person cannot tell why a project is missing or what scope is
still applied. They may unnecessarily clear a valid filter to continue.

**Recommendation:** preserve the current selection with a neutral fallback label;
state project loading/failure locally and retry just that read. Leave keyword,
other filters, history and previously loaded results intact. Never display an
opaque project ID as user-facing copy.

### A11Y-01 — identify recent reading progress

**Location:** `apps/web/features/reading/recent-items.tsx:44`.
Each `role="progressbar"` sets min/max/current but no `aria-label` or labelledby.
Conversation and project lists already use localized “Reading progress”.

**User cost:** assistive-technology users have a value without an explicit name
for what it measures. This is a source-level Name/Role/Value issue, not a claim
that a particular screen reader was exercised.

**Recommendation:** reuse the same localized progress name; keep its existing
bounded numeric value. No new label needs to clutter the visible card.

## What works and what stays unchanged

Initial batch operations already retain failed selections and summarize counts.
Search keeps prior results on read failure, uses local-day date boundaries, and
its rapid From/To/history race was fixed and accepted in 30a0d32. Recent URLs
retain message/block/character anchors. Project list Undo already survives its
empty inner list. Native filter controls, fonts, spacing, colors and existing
navigation are not defects and will remain in the approved system.

The accepted offline/selection work is not being repeated. Context candidates,
adoption/semantic validation and Skill viewing/editing remain excluded. No new
feature, dependency, schema, archive format or production-policy change is needed.

## Verification backlog and open limits

Implement in the order above, sharing only the duplicated Undo owner and keeping
changes in existing components/services. Small read-state and accessible-name
repairs can be verified in the same pass. Add isolated browser regressions for
partial/all-failed undo, pending double clicks, final-row empty states, failed
refresh, mixed-type pagination and missing project options. Inspect synthetic
375px/1440px evidence, with Chinese/light and English/dark where applicable.
Run lint, nonincremental typecheck and relevant CI gates. Never count test
discovery or the three Node baseline checks as browser acceptance.

Real occurrence rates, physical-device behavior and specified Windows Chromium
application acceptance remain unknown. The findings' code mechanisms are
confirmed; rendered fixes still need their own evidence. This report is the
pre-fix audit, not a claim that the follow-up has shipped.

## Implementation checkpoint (after report delivery)

The scoped repair reuses existing tokens and list patterns. Both list pages and
single-item menu actions now use one keyed `ConversationUndoNotice`. It preserves
remaining IDs, prevents duplicate pending clicks, checks uncertain responses with
GET, and separates confirmed writes from refresh. A new action identity prevents
an older completion from clearing its replacement. No new dependency or backend
contract was introduced. Search uses scope/document identity; Recent retains
cached links and names progress; the project filter retains an unresolved scope.

Full Web lint, nonincremental typecheck and a one-worker Web build pass. Nine new
browser cases were discovered and added to the existing isolated mutation gate;
discovery is not execution. During test review, refetch-on-focus was confirmed
disabled globally, so the Recent fixture uses real client navigation back to a
stale cached list, not a synthetic focus event. Full CI and visual acceptance
remain pending; the repair is not described as browser-verified or deployed.
