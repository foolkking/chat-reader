# UX quick review — Share navigation-sheet lifecycle

2026-10-15 · pre-edit source evidence, following the separate Share navigation/
saved-position retirement batch. Full ordinary-user goal remains active.

## Scope and evidence

Web app, mainstream visitors of a public or unlocked Share, phone navigation
sheet and tablet navigation drawer. This review concerns the local lifetime of
index/section navigation feedback and successful auto-close, not Share access,
position persistence or a visual redesign. Orientation and deliberate dismissal
matter; there are no new writes or irreversible actions.

SEEN: `apps/web/features/sharing/share-readonly-reader.tsx:43–76,133–139,
221–355,613,673–701,859–882`; `MobileReaderSheet` open/unmount, close and live
status wiring; index/TOC navigation caller contracts; actual locator-target
helper; search-panel effect-scope/activation precedent. Owner Reader has similar
sheet callbacks; its independent utility-panel lifecycle is outside this batch.
NOT SEEN: mounted React/Vaul, real API/Share transitions, browser/device focus,
announcements, scroll, breakpoint geometry or CPU/RSS. Code facts are Observed;
rendered consequences and occurrence frequency are Inferred. No conformance or
browser acceptance is claimed. Tests/gates, services and release remain off.

## The things that matter

The Share navigation callback now retires old core positioning work by visit
and navigation token. Its sheet callers still await that work and then publish
local feedback or close whatever sheet is currently open. Closing, reopening,
changing tabs or moving between mobile and tablet does not own that completion.
An obsolete result can therefore overwrite a newer pending notice or close a
reopened surface. The tablet displays the same status region but never starts
or finishes its local pending/error state. Mobile also labels expected
cancellation as failure. Reuse the local effect-scope/sequence precedent, not a
new navigation or overlay system.

## Findings

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| NAV-SHARE-SHEET-01 | Defect / navigation; state coverage | Medium | Observed (code); rendered consequence Inferred | M |
| FBK-SHARE-SHEET-01 | Defect / feedback; error recovery | Medium | Observed (code); rendered consequence Inferred | S |

**NAV-SHARE-SHEET-01.** Location: pre-edit
`share-readonly-reader.tsx:673–701`, especially mobile await/completion at
680–689 and tablet auto-close at 698. These callers do not capture the sheet
activation, tab, viewport or latest action. Close/header/scrim paths write only
`navigationOpen`; changing a tab writes only `navigationTab`. A visitor who
dismisses/reopens or chooses a second target can receive an obsolete error,
lose the newer pending notice or have the new surface auto-close. Give the
visible sheet one effect-owned scope and latest-action sequence, retire it
synchronously on close/tab change and in layout cleanup, and fence admission,
feedback and auto-close. Coalesce the same pending caller-produced target
without blocking a different choice. Keep already-started core navigation
separate: UI dismissal is not physical request/scroll cancellation.

**FBK-SHARE-SHEET-01.** Location: pre-edit
`share-readonly-reader.tsx:678–698`. Both tablet callbacks only await navigation
and close on success, although the drawer renders a pending/error region.
Neither sets those states, so current slow/failing tablet navigation has no
local outcome. Mobile maps every unsuccessful result, including `cancelled`,
to `locateFailed`. A visitor cannot distinguish waiting from an ignored tap,
and deliberate takeover is presented as an error. Route the four sheet
index/section callbacks through the same scoped feedback handler; keep current
failure visible and the sheet open for another choice, make cancellation
neutral, and translate finite feedback at render time. Retain the existing
status location/live region and index/TOC read-only retry controls.

## Ordered repair and acceptance

1. Add an in-memory scope for actual sheet visibility, tab, viewport and Share
   visit; gate old feedback and synchronously retire explicit dismiss/tab paths.
2. Share one bounded activation handler across mobile/tablet index and TOC,
   including pending duplicate coalescing, finite failure and neutral cancel.
3. Author extracted-source regressions for current outcomes, reversed
   completion, duplicate/newer choice, close/reopen/tab/viewport/visit/unmount,
   effect replay and all four JSX callers. Do not run them.
4. After authorization, use task-specific TEMP/TMP for focused and relevant
   Web checks, then public/unlocked phone/tablet real-anchor, rapid tap, slow/
   failing navigation, manual takeover, dismiss/reopen and focus/announcement
   acceptance.

## What stays and open questions

Keep the existing MobileReaderSheet/Vaul and tablet presentation, responsive
thresholds, labels, index/TOC loaders and complete-turn/real-anchor callback.
Desktop rails are not sheet-owned. Share URLs/password/expiry, storage key/
position bytes, optional old-server resolver fallback, packages and API/schema
remain. No new timer, polling, subscription, dependency or persistent field.

The prior core-navigation batch remains source-only and unexecuted; it does
not verify this local feedback batch. Sheet dismissal does not abort begun
core navigation. Tablet modal/keyboard behavior, Owner Reader utility-sheet
completion, crypto/storage failure, edge loading and unlock lifecycle remain
separate reviews; this report does not imply those are accepted. Real device
geometry, focus and announcements still require browser evidence.

## Implemented source checkpoint

The Share sheet/drawer now has a visibility/tab/viewport/token-visit scope,
including existing metadata and local-readiness render gates. Explicit close
and tab change retire it synchronously; layout cleanup advances its sequence.
Feedback projection checks both scope and action sequence, including cleanup/
setup of the same scope, rather than allowing an old pending notice to survive
an effect replay.

The four mobile/tablet index/section callers share one activation handler.
The same serialized pending caller target is coalesced; different targets can
supersede it. Only the latest live activation publishes feedback or auto-close.
Current exceptions/failures retain a finite flag, cancellation is neutral,
and existing status placements translate it at render time. Desktop callbacks,
TOC target helper arguments and begun core positioning are unchanged.

`scripts/ux/share-navigation-sheet-lifecycle.test.mjs` reuses the actual scope/
state/effect/handlers, four JSX callers, TOC helper and both status fragments.
It is **unexecuted**. Hooks/layout scheduling, parent state and navigation are
controlled; fragment static-markup assertions do not prove mounted Vaul,
focus, announcements, transport or true DOM alignment. The preceding core
regression remains unexecuted and is not claimed as acceptance here.
Current architecture/flows, state/index/testing and document inventory are
synced. No tests/gates, build, services, browser, commit, CI, deployment or
CPU/RSS measurement ran. Formatting-only review is recorded separately below.

Formatting-only `git diff --check` for the edited tracked Share source and
six current-fact/navigation/testing/inventory documents exited **0**. Existing
LF→CRLF working-copy warnings remain; no line-ending normalization was done.
The new untracked report/regression were not covered by that command.
This is not syntax, lint, type, test or browser validation.

## Follow-up pre-edit evidence — same-batch reopening

2026-10-15 · source-only follow-up, recorded before its product edit. Scope,
audience and runtime exclusions above remain. SEEN:
`share-readonly-reader.tsx:43,130–158`; the extracted-source regression's
`close/reopen` case commits an intermediate closed render. NOT SEEN: an actual
React/Vaul close/open batch or its frequency in ordinary use.

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| NAV-SHARE-SHEET-02 | Defect / navigation; state coverage | Medium | Observed (code); scheduler/rendered consequence Inferred | S |

**NAV-SHARE-SHEET-02.** At the locations above, explicit close sets the scope
inactive, but open only writes the boolean. If close/open finish in one batch
with the previous visible/tab/viewport/visit values, the memo and layout
dependencies are unchanged. The prior scope remains inactive and the next
index/TOC choice returns without starting navigation or feedback. The visitor
can be left with an apparently open but unresponsive navigation panel until
another effective scope transition. The existing regression covers sequential
renders, not this boundary.

Reuse the common Reader's memory-only activation counter: retire on each
explicit open/close, advance the counter on open, and include it in the scope
identity. Do not set the old scope active again, because a retained old
navigation callback could then admit fresh work. Add unexecuted regressions
for same-batch close/open and same-value explicit open: old admission stays
retired before/after render, a fresh choice works, and old completion cannot
close the new surface or clear its pending feedback. This changes neither core
navigation nor stored/API fields. Real scheduler/overlay acceptance remains
pending; no tests or runtime checks are authorized in this follow-up.

## Same-batch reopening source checkpoint

The Share explicit-open handler now retires its prior sheet scope on either
boolean value and advances an in-memory activation counter on open. The memo
includes that counter, so a same-batch close/open or same-value open creates a
fresh scope at the next render without making an old callback active again.
No storage/API field, query, anchor, core navigation or overlay contract
changed.

The existing unexecuted regression now authors both boundaries for mobile and
tablet. It retains the real extracted handler/memo/effect/state and controls
the parent/activation setters: no intermediate render is forced, old
admission is checked before/after commit, a new choice can publish pending,
and old completion cannot clear it or close the new surface. These are
authored assertions, not executed results; the controlled setter/layout model
does not establish real React batching or Vaul event ordering. Current facts,
flows, testing/navigation and document inventory are synchronized.

No tests/gates, syntax check, lint, typecheck, build, services, browser, commit,
CI, deployment or resource measurement ran. Full ordinary-user goal remains
active. Formatting-only review for this follow-up is recorded below.

Follow-up formatting-only `git diff --check` for the tracked Share source
and six current documents exited **0**. Existing LF→CRLF warnings remain;
no normalization was performed. This untracked report and the untracked
regression are excluded from that command. No syntax, lint, type, test or
browser result is implied.
