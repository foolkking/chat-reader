# UX quick review — Reader navigation-sheet lifecycle

2026-10-15 · pre-edit source evidence; continuation of the full ordinary-user
goal, following the separate Share sheet batch.

## Scope and evidence

Responsive Web app, mainstream readers using the common online/offline
`ConversationReader`. The scope is its index/section navigation sheet/drawer
feedback and successful auto-close, including transition to another utility
surface. Reading orientation and preservation of the user's chosen surface
matter. No content write, new access policy or visual redesign is proposed.

SEEN: `apps/web/features/conversations/conversation-reader.tsx:133–186,
327–354,497–503,976–989,1297–1326,2095–2127,2266–2302,2323–2325,
2471–2498,2768–2791`; the source-editor hide/close and utility transition
callers; `MobileReaderSheet` and local `TabletReaderNavigationDrawer` close/
live-status contracts; index/TOC callback types, actual TOC locator helper;
the separate source-only Share/search scope precedents.
NOT SEEN: mounted React/Vaul, actual remote/offline data, source-editor
confirmation timing, real device/browser focus, announcements, scrolling,
cache scheduling or CPU/RSS. Code facts are Observed; rendered consequences
and frequency are Inferred. No accessibility-conformance claim or test/gate,
service, browser or release is part of this batch.

## The things that matter

Core Reader navigation now checks its visit/account and navigation token.
Its navigation-sheet callbacks still publish local pending/error state and
call `setUtilityPanel(null)` after awaiting positioning, without owning the
current utility activation. A successful old jump can close search/files or a
reopened navigation surface; an obsolete result can replace a newer wait.
The two callbacks also treat cancellation as failure and keep translated error
text as state. Retain existing positioning and add local surface ownership,
using the same scope/sequence discipline as the independent Share batch.

## Findings

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| NAV-READER-SHEET-01 | Defect / navigation; state coverage | Medium | Observed (code); rendered consequence Inferred | M |
| FBK-READER-SHEET-01 | Defect / feedback; recovery | Medium | Observed (code); rendered consequence Inferred | S |

**NAV-READER-SHEET-01.** Location: pre-edit
`conversation-reader.tsx:2482–2497`, both sheet callbacks; utility changes at
2095–2127 and close paths at 2266–2275/2478/2768–2791. Each callback awaits
`navigateToTarget`, then unconditionally publishes local outcome and closes
the current `utilityPanel` on success. Neither current tab/viewport nor a
close/reopen or switch to another utility is represented. The visitor can
lose a newly selected search/file surface or have a later wait disappear.
Give the visible navigation sheet one effect-owned scope and latest-action
sequence, retain current Reader visit/account ownership, and retire the
intent synchronously through the common utility transition and tab paths.
Gate feedback by scope plus sequence, including same-scope effect replay;
only the latest live activation may auto-close.

**FBK-READER-SHEET-01.** Location: pre-edit
`conversation-reader.tsx:2484–2494,2774,2788`. Every false result, including
`reason="cancelled"`, becomes `t("locateFailed")`; repeated identical pending
targets start new positioning, and error text is frozen at completion locale.
A reader taking over sees a false alarm and repeated taps may restart the
same wait. Reuse one activation handler for both index/TOC callers, coalesce
the same serialized pending caller target, treat cancellation neutrally and
store a finite failure flag translated by the existing status JSX at render.
Keep current failures visible with the sheet open for another choice.

## Ordered repair and acceptance

1. Preserve the existing utility state but route its internal transitions
   through a stable callback backed by a navigation-scope ref. Retire old
   sheet actions before another surface is selected; preserve same-batch
   close/reopen eligibility with a new sequence, not revival of an old action.
2. Scope visibility by existing Reader surface availability, source-editor
   hiding, mobile/tablet navigation activation and visit; retire tab/layout/
   viewport/unmount changes and gate the shared activation callback.
3. Author extracted-source synthetic cases for current outcomes, duplicate/
   newer choices, reversed completion, every utility transition, close/reopen,
   tabs, viewport/source/conversation/account/hide/unmount and effect replay,
   plus actual caller/target/status wiring. Leave all unexecuted.
4. After authorization, use task-specific TEMP/TMP for focused and relevant
   Web gates, then online/offline phone/tablet rapid/slow/failing choice,
   manual takeover, other-utility transition, real-anchor and focus/
   announcement acceptance.

## Working behavior, boundaries and open questions

Keep query/prefetch keys, local offline scheduling policy, target/version/TOC
locator arguments, complete turns, real DOM anchors, budgets, position bytes,
search return state and existing mobile/tablet presentation/focus helpers.
No API/schema/package/Dexie/migration, timer, subscription or dependency.
The generic positioning transaction and the independent Share controller are
not redesigned or actively aborted by dismissing the sheet.

This does not accept delayed workspace-open/source-editor confirmation work,
file/annotation/export action lifetimes, tablet/device geometry, permission/
access transitions or the source-only positioning batch as browser evidence.
The common utility transition wrapper is a synchronous local intent fence,
not cancellation of a helper already running. Device focus, announcements
and actual scheduler ordering still need runtime evidence. Full goal active.

## Implemented source checkpoint

Source-review refinement before the follow-up edit: reactivating the same
scope object for a batched close/reopen would fence an already-awaiting action
by sequence, but a retained old callback could still admit a fresh invocation.
Use a local activation counter on explicit navigation opens instead. It forces
a fresh effect scope even if the utility state ends with the same value; the
old callback remains retired. This is source reasoning, not an executed case.

Existing internal utility transitions now use a stable callback backed by the
effect-owned navigation-scope ref. They retire the prior sequence before any
other surface is selected. A local activation counter on navigation opens
forces a fresh scope even for batched close/reopen with the same final utility
value, so retained old callbacks cannot regain admission.
The scope follows Reader availability, source-editor hiding, activation/tab/
viewport/visit; cleanup retires it and conditionally clears its ref.

Both shared sheet-content callers use one activation handler with the existing
visit/account guard, latest-action completion, pending-target coalescing,
finite failure and neutral cancellation. Feedback projection checks scope and
sequence, including replay of the same effect scope. Both existing status
fragments translate finite flags at render. Core navigation, query/prefetch,
target/version/TOC payloads, saved positions and overlay presentation remain.

`scripts/ux/reader-navigation-sheet-lifecycle.test.mjs` extracts the actual
callbacks/effect/state/ref and guard, caller/TOC helper and status fragments.
It remains **unexecuted**; hook scheduling, availability/account clock,
parent/activation state and core navigation are adapters. Mode labels and fragment
static markup are not actual remote/offline/React/Vaul/QueryClient/browser,
geometry, focus or announcement evidence. Current state/index/testing,
architecture/flows and inventory are synced. No tests/gates, build, services,
browser, commit, CI, deployment or CPU/RSS measurement ran. Formatting-only
review is recorded separately below.

Formatting-only `git diff --check` over the edited tracked Reader source and
six state/navigation/testing/inventory documents exited **0**. Existing
LF→CRLF working-copy warnings remain; no normalization was performed. The
new untracked report and regression were not covered by that command.
This is not syntax, lint, type, test, browser or resource validation.
