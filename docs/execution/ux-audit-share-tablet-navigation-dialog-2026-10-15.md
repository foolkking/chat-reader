# UX quick review — Share tablet navigation dialog

2026-10-15 · source evidence recorded before the product edit. Full ordinary-
user goal remains active; this does not repeat accepted CI or deployment.

## Scope and evidence

Mainstream visitors using public/unlocked Share in the existing tablet Web
breakpoint (768–1279 CSS px), specifically the index/section drawer's modal
keyboard contract. This is an existing-interface repair, not a visual
redesign. The drawer is read-only; orientation and returning to reading matter,
with no new data writes or irreversible action.

SEEN: `apps/web/features/sharing/share-readonly-reader.tsx:735–744,902–923`;
the common Reader's `TabletReaderNavigationDrawer` at
`apps/web/features/conversations/conversation-reader.tsx:3468–3501`;
`apps/web/components/use-dialog-focus.ts` and `mobile-reader-sheet.tsx`.
The existing `apps/web/e2e/share-drawer-focus.spec.ts` targets the owner's
share-creation drawer, not this public Share navigation drawer.

NOT SEEN: mounted React/Vaul, real browser keyboard order, screen-reader
announcements, background browse-mode isolation, focus-ring pixels, responsive
geometry, real Share access or CPU/RSS. Code facts are Observed; actual focus,
announcement and user consequences are Inferred. No WCAG conformance claim
or executed regression result is made. Tests/gates, services and release are
not run in this source-only batch.

## Executive summary

The tablet Share navigation renders a full-screen scrim and right-hand panel.
Unlike the common Reader equivalent, its panel has no dialog role/name or
modal focus lifecycle. Opening it leaves keyboard focus wherever it was, and
Tab is not contained by the drawer. There is also no Escape handler on this
Share surface. Keyboard users can therefore continue through obscured reading
controls instead of entering the navigation they opened, and closing has no
deliberate no-scroll focus restoration. Reuse the installed shared dialog hook
and complete the existing panel's attributes; keep layout and navigation work
unchanged.

## Finding and quick win

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| A11Y-SHARE-TABLET-01 | Defect / accessibility; keyboard navigation | High | Observed (code); rendered/assistive consequence Inferred | S |

**A11Y-SHARE-TABLET-01.** Location: pre-edit
`share-readonly-reader.tsx:735–744`. The conditional tablet markup contains a
scrim close button and an ordinary `<section>` with no ref, `role`, modal/name
attributes, focusable fallback or focus hook. `NavigationTabs` supplies native
buttons, but neither it nor the enclosing Share Reader owns Escape/Tab or
opening/closing focus. A visitor using a keyboard can stay behind the scrim,
lose their orientation, and encounter underlying controls while the visual
navigation is open. The common Reader already implements the desired local
pattern with `useDialogFocus`, a labeled `role="dialog"` section,
`aria-modal="true"` and `tabIndex={-1}`.

Reuse that hook for the actually visible tablet navigation only, with a stable
panel ref and the existing scoped close handler. Give the section the existing
translated navigation title, modal role and fallback tab index. Preserve the
hook's topmost-dialog arbitration, boundary Tab wrapping, Escape close,
listener cleanup and delayed no-scroll restoration rather than adding a
second keyboard system. Related sampled criteria: 2.4.3 Focus Order (A) and
4.1.2 Name, Role, Value (A); this source review is not a compliance verdict.

## Ordered repair and acceptance

1. Add the local ref, visible-tablet hook wiring and panel semantics; leave
   phone/Vaul, desktop rails, dimensions, index/TOC loaders and target args.
2. Author source-based regressions using the actual hook and Share call/site
   attributes, with controlled DOM/layout/event adapters: admission only when
   visible/tablet, initial focus, Tab boundaries, Escape/latest close handler,
   cleanup/restoration and another modal retaining focus. Do not run them.
3. After authorization, use task-specific TEMP/TMP for the new regression,
   existing Share sheet/core regressions and relevant Web checks; then test
   public/unlocked Share with a keyboard and screen reader, real Tab order,
   close/reopen/breakpoint transitions and no movement of the reading anchor.

## What stays and open questions

The existing native close/tab controls, polite feedback region, sheet action
ownership and complete-turn/real-DOM navigation remain. No data, token,
Share URL, storage bytes, package/Dexie, API/schema or dependency change.
No new visual width, resize affordance, body-scroll lock or global focus
architecture is introduced. The shared hook itself remains unchanged.

The shared hook handles boundary Tab navigation and top-dialog arbitration;
this batch does not claim to make the background inert or to redirect every
programmatic/pointer focus move. Screen-reader browse mode, cross-browser
focus, body scrolling, attachment-viewer interaction and tablet geometry need
real runtime evidence. Storage/crypto failure, edge loading, unlock and delayed
workspace-confirmation lifetimes remain separate work.

## Implemented source checkpoint

The Share Reader now owns a stable section ref and calls the unchanged shared
`useDialogFocus` unconditionally in hook order, with `open` limited to actual
sheet visibility and tablet viewport. Its close callback forwards to the
existing current sheet open-change handler. The section has the existing
translated navigation name, dialog/modal semantics and negative fallback tab
index; the scrim carries the existing dialog-backdrop marker. Original panel
classes/dimensions, all four mobile/tablet index/TOC callers, feedback, core
navigation and storage/access contracts are unchanged.

`scripts/ux/share-tablet-navigation-dialog.test.mjs` is authored but
**unexecuted**. It reuses the exact Share visibility/ref/hook call/section
attributes and the entire actual hook module. Controlled adapters cover the
proposed gates, opening focus/Tab boundaries, latest handler and top-modal
Escape, no refocus on ordinary rerender, cleanup on close/viewport/hidden/
unmount, no-scroll opener restoration and newer-modal focus ownership.
The fixture's controlled ref attachment and focus/event/geometry/timer model
are not real React, DOM tab order, Vaul, assistive technology or browser proof.
The existing Share sheet/core regressions remain unexecuted; their extraction
boundaries were inspected, not run.

Current architecture/flows, project state, navigation/testing and document
inventory are synchronized. No tests/gates, syntax check, lint, typecheck,
build, services, browser, commit, CI, deployment or resource measurement ran.
The full goal remains active; formatting-only review is recorded below.

Formatting-only `git diff --check` for the tracked Share Reader and six edited
current documents exited **0**. Existing LF→CRLF warnings remain; no line-ending
normalization was done. This untracked report and the untracked regression
were not covered by that command. It is not syntax, lint, type, test or browser
validation. Status inspection showed no change to the shared dialog hook.
