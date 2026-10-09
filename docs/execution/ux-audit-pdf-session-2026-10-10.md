# PDF session and geometry review — 2026-10-10

## Scope and evidence

Scoped pre-edit continuation for mainstream readers of the existing Web attachment
Viewer, not a new visual direction. Review covers the seventh complete release
CI's PDF zoom and resize failures. Repair and complete rerun remain inside the
user's one authorized attachment release cycle; deployment is still conditional
on all gates, screenshot review and independent exact-source image acceptance.

Seen: source `2f046f9fa2017e6c1d50833860b81f29896dbc60`, run
[37967470601](https://github.com/foolkking/chat-reader/actions/runs/37967470601),
recorded Chinese/English 375px and 1440px PDF action/DOM traces, two inspected
synthetic screencast frames, and the actual components executed with explicit
hook/DOM/PDF doubles and installed Virtualizer 3.17.7. The frozen
[probe](ux-audit-pdf-session-2026-10-10-evidence/probe.mjs) reads its own committed
baseline, so later product changes cannot rewrite the
[results](ux-audit-pdf-session-2026-10-10-evidence/pre-edit-probe.json).

Not seen: local running Web (the prior denied start is not retried), production
UI, other browser engines, physical-device CPU/RSS or an accessibility conformance
evaluation. Screencasts are downsampled; image size is not capture viewport size.
The exact CI callback ordering is inferred, not instrumented in these recordings.

## Summary and quick wins

The original page-90 indicator boundary now passes, as do all 21 attachment cases.
The seventh run reaches later PDF steps and exposes two remaining defects.
Zooming a mobile mixed-size PDF leaves the viewport near page 94 instead of 90.
Resizing the desktop window closes the entire preview without a close action.
The controlled source probe reproduces both mechanisms, including the mobile
90-to-94 result, while retaining the distinction from native browser execution.
Stabilizing session ownership is the smaller repair; geometry must also be made
current before anchoring and reporting page changes. No dependency, render-budget
increase, new notification or visual redesign is justified.

## Findings

### STATE-PDF02 · A parent redraw can close the active attachment

- Kind/dimension: **Defect**, state continuity and responsive behavior.
- Severity: **High**; effort **S**.
- Confidence: **Observed (code, controlled component execution and recorded
  disappearance)**; association of the recorded resize to this exact callback
  sequence is **Inferred**.
- Location: `apps/web/features/attachments/attachment-viewer.tsx:806` and
  `apps/web/features/attachments/conversation-files-panel.tsx:358`.
- Evidence: the file panel creates a new `onClose` function per render. The
  bridge's effect depends on that function; changing it runs `viewer.close()`
  during cleanup, notifying the parent to clear its selected preview. The probe
  performs one callback-only redraw and records **two opens, one close and one
  old close callback**, with no user close. Four desktop long-PDF/retry cases
  lose the Viewer after a 1440-to-1180 resize; the inspected
  [desktop frame](ux-audit-pdf-session-2026-10-10-evidence/desktop-resize-closes-viewer.jpg)
  shows the underlying file panel, not a PDF error.
- User consequence: resizing to read more comfortably discards the reading
  session and forces reopening and relocating the page.
- Recommendation: retain the latest close callback separately from session
  identity. Callback-only parent renders must neither close nor reopen the
  document. Keep explicit close, true unmount and attachment replacement
  behavior, and test them separately. Reuse the existing provider and shell.

### NAV-PDF02 · Zoom anchoring consumes stale measurements and feeds them back

- Kind/dimension: **Defect**, reading orientation, state and perceived performance.
- Severity: **High**; effort **M**.
- Confidence: **Observed (recorded actions/DOM/frame, code and controlled
  installed-Virtualizer execution)**; precise browser scheduling **Inferred**.
- Location: `attachment-viewer.tsx:607–704`; installed
  `@tanstack/virtual-core/src/index.ts:1744,1799,1958`.
- Evidence: after real wheel navigation to 91 and direct return to 90, both
  mobile cases fail after Zoom in. The inspected
  [mobile frame](ux-audit-pdf-session-2026-10-10-evidence/mobile-zoom-leaves-page90.jpg)
  reports 94 at 53% and shows later synthetic pages. `measure()` invalidates size
  caches, but the immediately following `scrollToIndex()` reads the old
  `measurementsCache`. A native scroll callback can then overwrite current page
  before the scrollbar-driven height update anchors it again. The probe at
  375px retains offset 40930 while the refreshed page-90 start changes to
  39015.8; an intermediate scroll plus height update settles on **94**. At the
  wider synthetic viewport the same schedule drifts to 109; that number is
  probe evidence, not an observed desktop CI result. Separately, actual PdfPage
  output keeps its old 343×265.05 CSS size during queued zoom work when the new
  layout requires 422.2×326.25, exposing obsolete geometry to measurement.
- User consequence: an ordinary zoom loses the document location, especially
  when mixed page sizes change the estimated total. This undermines the core
  reading action even though the PDF bytes remain intact.
- Recommendation: compute geometry from current scale independently of the
  asynchronous bitmap, refresh virtual measurements before deriving the target,
  and do not reinterpret intermediate programmatic alignment as a new reading
  choice. Keep genuine forward/backward scrolling and short-final-page behavior.
  Cover scroll feedback before reconciliation and delayed rendering; no permanent
  page lock, polling loop or eager rendering of the entire document.

## Priority, design checkpoint and acceptance

1. Add failing actual-source regressions for callback churn, intermediate scroll
   delivery, synchronous page geometry and true close/unmount semantics.
2. Narrowly repair both findings using the current components. Preserve every
   existing E2E assertion and case/gate time budget; strengthen resize/zoom
   identity and recovery coverage where necessary.
3. Run relevant Node checks, lint, nonincremental types, one-worker Web build and
   discovery; inherit all 115 source bindings in an additive evidence ledger.
4. Run complete exact-source CI in this same release cycle. Inspect real
   synthetic desktop/mobile screenshots and independently verify the images
   before fresh production capacity/backup/rollback/data checks and deployment.

Intent: readers keep their document and place through layout changes, with no
extra attention demand. Palette remains paper, raised paper, graphite, muted
ink and sea-green action through existing semantic tokens. Depth remains quiet
borders/subtle surfaces with the existing modal elevation. Typography stays on
the current app stack, spacing on the 4px system. This repair changes behavior
and geometry ownership, not those approved choices. A new Reader, a fixed-page
lock and an eager all-page render are rejected because they respectively expand
scope, hide genuine navigation and violate the user's low-resource constraint.

## Working paths and verification boundary

The [original artifact identity](ux-audit-pdf-session-2026-10-10-evidence/artifact-meta.json)
is bound to this source. Its original ZIP size and GitHub digest were checked;
this is diagnostic evidence, not a release-image artifact. The
[Web summary](ux-audit-pdf-session-2026-10-10-evidence/web-gates.json) records
**nine PASS / one FAIL / three NOT_VERIFIED**. Mutation: **100 passed**, 492383ms;
attachment: **21 passed**, 57084ms; PDF: **seven passed / six failed / zero
timedOut / zero skipped / zero interrupted**, 408445ms. Adaptive import has
eight passes and one conditional skip, not nine passes. Default PWA, auth,
negative PWA and both image jobs were not executed after the failure.

API full-suite log: **1239 passed / three skipped / 20 warnings**, 1310.44s.
Settings full matrix: **439 passed**, plus **one** independent fresh-instance
restore, all from this run. Earlier run counts are not substituted or added.
The previous PDF boundary, rendering leases/budgets, gallery/JSON/Office recovery,
quiet Reader autosave, tokens and permissions are intentionally left intact.
The previous report and frozen evidence are unchanged. The next-batch
annotation/CSV report remains outside this blocking repair. Browser rendering,
resource use and full visual/accessibility scores remain unaccepted until actual
evidence supports them. This report is delivered before product/test edits.

## Local repair checkpoint (after report delivery)

The bridge stores the latest callback without tying its effect lifetime to that
function. Session callbacks notify once while active, and cleanup retires them
before closing. PdfPage stores intrinsic size with document/page ownership and
computes both wrapper and bitmap CSS size from the current layout. Existing
cached intrinsic sizes also seed remounted pages. Bitmap/lease cancellation and
budgets are unchanged.

The continuous list keeps a pending page while the new extent commits, refreshes
measurements through `getTotalSize()` and uses public `getOffsetForIndex()` for
one native scroll. Existing measurement renders finish a pending size change;
no new scheduled loop is added. Scroll feedback during that pending commit is
ignored. Wheel/touch/pointer/scrolling-key input clears pending alignment and
the four added local listeners are removed on unmount. Reader saved-position
and user-intent algorithms are not changed.

The first 48-case regression run is **41 passed / seven failed**, 1173.0601ms.
An intermediate repair passes 47/48 but reveals an exact-floating-point test
comparison (397.99999999999994 versus 398); its new geometric assertion now uses
a 1e-8 numerical tolerance. Initial typecheck also rejects four private Virtualizer
member accesses; the final implementation uses only public APIs and native
scrolling, without casts or type suppression. Expanded focused coverage passes
**53**, 1278.5135ms. Full repository-script coverage is **699 passed / zero
failed / zero skipped**, 9413.6934ms across 25 files; it is broader than the
preceding 666-case selection and is not additive. Lint, nonincremental types and
one-worker/non-standalone Web build pass. Browser discovery is unchanged at
**149 in ten files**, zero executed locally. E2E now additionally checks the
same actual PDF DOM through resize and captures zoom/resize views, retaining
all previous assertions and budgets. New source still needs complete CI and
rendered acceptance; no visual/CPU/RSS score or production acceptance is claimed.
