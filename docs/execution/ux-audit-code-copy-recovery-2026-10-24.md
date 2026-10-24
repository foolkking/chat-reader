# UX quick review — code-block copy recovery

## Scope and evidence

2026-10-24; existing Web app, mixed readers including people copying technical
snippets. This is one secondary action, not a new UI/design or whole-product
audit. Code reviewed: `ShikiCodeBlock` and `CodeAction` in
`apps/web/features/conversations/markdown-renderer.tsx:883-973`;
`apps/web/components/use-clipboard-copy.ts:1-36`; neighbouring manual-copy
flows in `format-conversion-guide.tsx` and `use-message-markdown-copy.tsx`.
No rendered product, physical-device clipboard, responsive, timing or
screen-reader evidence was collected for this pre-edit review. No accessibility
conformance or cross-browser success is claimed.

## What matters

The **Copy code** handler directly awaits `navigator.clipboard.writeText`
without catching access or permission failures. `CodeAction` discards the
returned promise, so a denial has no application recovery state. The repository
already has a bounded, source-scoped clipboard hook and a labelled, read-only
manual-copy fallback in adjacent flows. Reusing those is smaller and more
consistent than adding a second clipboard implementation. Normal code rendering,
highlighting, wrapping and expansion should remain untouched.

## Findings

| ID | Finding | Dimension | Severity | Confidence | Effort |
|---|---|---|---|---|---|
| ERR-01 | Code copying has no handled failure/manual alternative | Error recovery and feedback | Medium | Observed (code); browser manifestation inferred | S |

**ERR-01 evidence.** The handler at line 945 awaits `writeText`, then marks
success; there is no catch, feature detection or failure branch. The wrapper at
line 973 invokes it with `void`. Readers denied clipboard permission get no
explanation, and long collapsed snippets are awkward to select completely.
Use the existing `useClipboardCopy(code)` controller; show success only for its
matching source, catch unsupported/denied access through that hook, and render
an in-context labelled read-only source field on failure. Keep the current
toolbar and tokens; do not introduce deprecated copy commands or automatic
retries.

## Quick win / ordered backlog

1. **#125 / ERR-01:** reuse the shared clipboard state and manual field. Verify
   successful, denied, unavailable, retry, changing-source and pending outcomes.
   This is the only implementation item in this round.

## Working / deliberately unchanged

The existing copy text is the complete `code` prop, not syntax-coloured DOM.
The shared hook catches synchronous Clipboard access and asynchronous rejection,
scopes feedback to source, and selects a manual field. Keep that precedent.
Do not redesign toolbar spacing, wrapping/expand controls, palette, fonts,
highlighting, Reader navigation, Share permissions or offline data formats.
Their visual/accessibility quality was not assessed here.

## Open checks

Browser verification must distinguish a real clipboard write from an injected
write adapter. Real OS permission prompts, installed clients and non-Chromium
clipboard support remain unverified unless separately exercised.

## Post-change verification — 2026-10-24

ERR-01 is locally repaired by reusing the existing clipboard hook. It catches
missing/denied access, disables the copy action while pending, and exposes the
complete source in a labelled read-only field on failure. Feedback belongs to
the exact source and latest attempt. The shared hook's success state persists
until another attempt or source change, replacing this button's old timer.
Highlighting, expansion and wrapping are unchanged.

- `scripts/ux/code-copy-recovery.test.mjs`: **8/8 passed**, from a red baseline
  of **1 passed / 7 failed**. Actual component functions and shared hook run
  with controlled scheduling/device adapters.
- `scripts/ux/code-copy-browser.mjs`: **5/5 passed** in local Chrome. Actual
  React/DOM/CSS verifies the selected full long-source fallback, retry, pending
  state, source retirement and 375px Chinese missing-API recovery; no page
  errors. Preferences, highlighting and device clipboard are explicit adapters.
- The final **1,582/1,582** service-free UX regression passed. Its first run
  exposed the existing rich-text SSR fixture's missing new hook import; that
  fixture now loads the actual hook rather than stubbing its behavior.
- Web lint, nonincremental typecheck and one-worker production build passed.
  Both existing rich-Markdown Playwright source-contract tests and all nine
  CI-tool tests passed; release-document binding and diff checks passed. The
  source-contract tests run without a browser or server, not as rendered E2E.

Final browser receipts are retained with this report:
[source hashes and case results](ux-audit-code-copy-recovery-2026-10-24-evidence/result.json),
[desktop denial](ux-audit-code-copy-recovery-2026-10-24-evidence/desktop-denied.png),
[375px unavailable API](ux-audit-code-copy-recovery-2026-10-24-evidence/mobile-unavailable.png).
Both final screenshots were visually reviewed: the fallback remains outside
the collapsed-code crop, full-width within the existing block and without
horizontal page overflow at 375px. All displayed source is synthetic.

These checks do not establish physical OS clipboard access, real permission
prompts, complete authenticated Reader/Share/Offline E2E, screen-reader
conformance, other browsers or production acceptance. Full release gates remain
required before any later publication.
