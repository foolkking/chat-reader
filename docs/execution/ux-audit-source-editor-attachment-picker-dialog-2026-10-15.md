# UX quick review — Source-editor attachment picker dialog

2026-10-15 · pre-edit source evidence. Full ordinary-user goal remains active.

## Scope and evidence

Mainstream responsive Web, the source editor's current-conversation
attachment picker. This review covers dialog focus, keyboard dismissal and
focus restoration only; file filtering, query/retry, upload protocol and
attachment permissions remain unchanged.

SEEN: `apps/web/features/editing/source-editor-workspace.tsx:487–535`,
the existing `useDialogFocus` implementation and its use in neighboring
attachment/dialog components. NOT SEEN: mounted React, keyboard/screen-reader
behavior, browser geometry, production or CPU/RSS. Missing lifecycle is
Observed (code); user impact is Inferred. Tests/gates, services, browser
operation and release remain off.

## Executive summary

The picker declares `role="dialog"` and `aria-modal="true"` and autofocuses its
search field, but its source file does not use the shared dialog-focus
lifecycle. Escape is therefore not owned by the picker, Tab is not bounded to
its controls, and closing can leave focus restoration to browser/unmount
behavior. The backdrop is also a focusable button without the shared
`data-dialog-backdrop` exclusion. A keyboard user can leave the modal while
choosing a file or land on an unrelated control after closing. Reuse the
existing hook at the picker root, mark the backdrop as non-tab-stop, and use
the search field as the existing initial-focus target without changing layout
or query behavior.

## Finding and quick win

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| A11Y-SOURCE-ATTACH-01 | Defect / accessibility; navigation | High | Observed (code); runtime consequence Inferred | S |

**A11Y-SOURCE-ATTACH-01.** Pre-edit location:
`ConversationAttachmentPicker:504–535`. The outer element is a modal dialog,
but there is no `useDialogFocus` call, root ref or focus restoration callback;
the backdrop `<button>` is in the dialog's DOM and lacks
`data-dialog-backdrop`. Escape and Tab therefore use the browser/document
defaults rather than the project's shared modal rules. A keyboard visitor can
tab behind the picker, press Escape without closing it, or lose their place
after choosing/closing a file. Attach the shared hook to the outer dialog,
exclude the backdrop from the focusable list and pass the search input as
initial focus. Preserve the existing close callback and current opener when
possible.

## Ordered repair and acceptance

1. Add the existing `useDialogFocus` with a stable root/search ref and
   `data-dialog-backdrop`; keep current backdrop/header close callbacks and
   search/query/selection markup.
2. Author an extracted-source regression for root/ref/hook wiring, initial
   focus, backdrop exclusion, Escape/Tab behavior through the unchanged shared
   hook and delayed focus restoration. Do not execute it.
3. After authorization, run focused editor/dialog checks with task TEMP/TMP,
   then actual keyboard, screen-reader, mobile and nested-modal acceptance.
   Static/source checks do not prove browser focus behavior.

## What stays and open questions

No new modal library, query, retry, timer, network request, attachment
protocol, storage, `.cr`, offline package, Share URL or API change. The shared
hook's existing top-dialog arbitration remains authoritative; this does not
add background inertness or claim complete browser/assistive isolation.

## Implemented source checkpoint

The picker now uses the existing `useDialogFocus` with its outer dialog root
and search input ref, marks the backdrop with `data-dialog-backdrop`, and
removes the competing native `autoFocus`. The current `onClose` handles
backdrop, header and Escape dismissal; the shared hook owns focus entry,
Tab/Shift+Tab boundaries and delayed opener restoration.

`scripts/ux/source-editor-attachment-picker-dialog.test.mjs` is authored but
**unexecuted**. It extracts the actual picker and checks the shared hook call,
root/search refs, backdrop exclusion and unchanged Escape/Tab/restoration
branches. This is not mounted React or browser/assistive acceptance.
