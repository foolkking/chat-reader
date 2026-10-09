# UX audit — attachment reading

2026-10-09. Pre-change review, following the manual Markdown fidelity repair.

## Scope and evidence

An existing Web reader for ordinary personal-archive users. Scope: the unified
attachment shell, PDF, images/gallery, Markdown/text/code, JSON/CSV, audio/video,
Office/ODF/ZIP and unavailable/unsupported paths. Reviewed owner, Share and offline
access routing without opening production or reading user attachments. Evidence is
current source, existing contract/tests and subsequent synthetic callback tests.
No local Web/browser start is permitted after the earlier policy refusal. Rendered
geometry, mobile gestures, screen readers and actual CPU/RSS are not measured here.
No accessibility conformance or rendered-design score is claimed.

## Summary

The unified viewer and its existing lazy PDF/Office runtimes are worth retaining.
The largest avoidable resource cost is PDF continuous mode retaining every page it
has visited, while the thumbnail rail starts work for the entire document at once.
PDF page rendering also swallows failures, which can leave a blank page without
the recovery already available for document-loading errors. Page selection and
fit/zoom controls can be more predictable without adding another parser or worker.
Gallery keyboard navigation closes over an old index, and shortcuts do not guard
editable/media targets or browser modifiers. JSON read errors are misclassified as
format complexity, and switching to Raw removes the way back. Fixing these specific
paths provides more value than adding OCR, full-document search or new codecs.

## State coverage (source, not visual acceptance)

| View | Loading / failure | Scale / long data | Retained behavior |
| --- | --- | --- | --- |
| PDF | Document retry exists; page failures swallowed | One-way lazy pages, eager thumbnails, no pixel budget | One PDF.js document, 64 KiB ranges, no WASM |
| Image/gallery | Image retry exists; failed overview metadata can spin | Native image lazy loading; stale keyboard index | SVG as image, no DOM insertion, original download |
| Markdown/text/code | Abortable reads and retry; missing content URL can wait forever | 50 MiB file ceiling, local scroll/wrapping | Shared inert Markdown, code remains text |
| JSON | Failed reads become invalid text; no read retry | Existing 8 MiB formatting/depth/node bounds | Raw original source, no script execution |
| CSV/TSV | Shared text read/retry | Bounded table parser and local horizontal scroll | Raw/table modes and original download |
| Audio/video | Retry and codec distinction exist | Metadata preload, no autoplay | Native controls and inline video |
| Office/ODF/ZIP | Worker errors and download; synchronous worker startup can throw | Source/entry/expanded/preview bounds exist | Read-only parsing; no recursive archive execution |
| Unsupported/missing | Unsupported shell fallback currently treats bytes as text | No extra parser is justified | Download/close should remain the truthful action |

## Findings and priority

### PERF-01 — PDF work grows with pages visited or rail size (defect, High, M)

Observed (code); device memory/CPU impact Inferred. At review,
`apps/web/features/attachments/attachment-viewer.tsx:525` creates every thumbnail;
`:527` creates every continuous page; `:539` disconnects its observer after first
visibility, never releasing off-screen canvases. `:553` caps device scale at two,
but not canvas area or dimension. Readers of a long/high-resolution document pay
for already invisible pages and may encounter stalls. Reuse the installed
virtualizer for continuous pages and thumbnails, cap each canvas, cancel obsolete
work and keep a small bounded render queue. Do not pre-render the document.

### ERR-01 — PDF page failures disappear and late loads outlive closure (defect, High, M)

Observed (code); blank-page appearance Inferred. `attachment-viewer.tsx:566` and
`:586` swallow all page/thumbnail rendering failures. At `:451`, a delayed PDF.js
import still starts `getDocument` after effect cleanup. A failed lazy import also
remains cached in `pdfjs-runtime.ts:11`. Readers need a retry for the failed page,
and closing must not start fresh work afterward. Add page-local recovery,
attachment-lifetime cancellation, canvas release and retryable module loading.

### NAV-01 — PDF navigation/zoom lacks predictable current-page handling (opportunity, Medium, M)

Observed (code); usability/geometry Inferred. `attachment-viewer.tsx:496` exposes
only a page-count span and previous/next; `:499` switches fit mode without a
current-page scroll request. The zoom label at `:502` reports the custom value
even in fit modes. Add labelled direct page entry, retain the page across fit/zoom,
show actual rendered scale and zoom from it. Wrap the existing toolbar groups
at narrow widths; do not add a second viewer or a permanently expanded rail.

### NAV-02 — Gallery shortcuts retain an old index and intercept other controls (defect, Medium, S)

Observed (code). The document listener at `attachment-viewer.tsx:175` depends only
on item count but calls `setActiveIndex`, which reads the render's old index at
`:199`. It also accepts arrows and +/- while typing, operating native media, or
holding browser modifiers. Use a current-key state update and scope shortcuts to
the active viewer, excluding editable/media targets, modified and already handled
events. Reset the image transform when changing items; preserve browser zoom.

Repair follow-up (Observed in code; focus behavior not yet rendered): keyed
renderer replacement removes the clicked zoom/next control. The shared dialog
hook manages opening/closing, not focus after a child is replaced, and the
scoped shortcut listener rejects a subsequent event targeted at `body`.
Restore only lost/body focus to the stable close control when the active item
changes or its metadata arrives. Do not move focus from another chosen control.
The CI gallery case deliberately zooms before pressing repeated direction keys.

### ERR-02 — JSON failure/raw states hide the useful next action (defect, Medium, S)

Observed (code). `attachment-viewer.tsx:362` turns any read rejection into text;
`:373` calls it overly complex. The early Raw return at `:364` removes both mode
buttons. Separate transport failure from invalid/too-complex content, keep explicit
retry, and keep source/formatted controls reachable. Memoize formatting by text
and mode, preserving existing size/complexity limits and inert output.

### STATE-01 — Absent/unsupported sources can enter a false preview (defect, Medium, S)

Observed (code); reachability depends on the entry path. `ViewerBody`'s final
fallback at `attachment-viewer.tsx:264` opens a text reader even for a null
capability. Missing content URLs also return from read effects without a terminal
state. The files-panel compatibility entry can open the shell independently of
the inline RenderPlan. Gate unavailable, empty and unsupported states before
mounting any renderer; show concise download/close recovery, without decoding
binary bytes as text. Child recovery must honor the session's download permission.
Preserve actual unavailable Share/offline restrictions, never fall back to owner URLs.

### ERR-03 — Offline retry changes Blob identity; worker failures escape recovery (defect, Medium, S)

Observed (code + extracted-function tests), browser impact not yet rendered.
`attachment-viewer.tsx:retryableUrl` and `complex-attachment-viewer.tsx:withAttempt`
append HTTP retry queries to Blob URLs. The original cached resource no longer
has the same URL. Keep non-HTTP URLs unchanged; the explicit renderer retry still
starts a new read/player/document. `ComplexAttachmentViewer` also constructs its
Worker outside recovery and accepts late bytes/messages after cleanup. Catch
startup errors before reading bytes and fence callbacks with the existing abort
signal. Four added reproductions fail against the pre-repair code; the original
13 targeted cases now pass. See [recovery baseline](ux-audit-attachment-reading-2026-10-09-evidence/recovery-baseline.json).

The original 13-case baseline remains distinct and is not overwritten. The first
repair also passes a nonincremental TypeScript check; wider integration and real
browser/visual acceptance remain pending.

### NAV-03 — A short final PDF page loses its selected page number (defect, Medium, S)

Observed (extracted callback + installed virtualizer); browser geometry Inferred.
`attachment-viewer.tsx:PdfPageList` derives the current page only from the top
scroll offset. In a 375 × 640 synthetic viewport with 120 pages and a short final
page, the browser's maximum scroll offset leaves earlier pages above the last
page. The production callback reports page 118 instead of the selected page 120.
This makes the end of a document appear not to have been reached. At the actual
bottom of a scrollable document, report the final page; elsewhere retain the
offset lookup. Do not add blank tail space or render extra pages. The focused
baseline has 0 passed / 1 failed / 33 name-filtered skips; the skips are not
executed tests. See [end-page baseline](ux-audit-attachment-reading-2026-10-09-evidence/end-page-baseline.json).

## Implementation order and design brief

1. Reproduce the failures in production callbacks; retain failure evidence.
2. Bound PDF page/thumbnail work, add recoverable page errors and direct navigation.
3. Fix shell/gallery keyboard ownership and JSON/unsupported recovery.
4. Verify static/types/build/API scope, then run synthetic browser and visual
   acceptance in the one newly authorized exact-source CI/release cycle.

Intent: a reader should stay oriented in a document and read for a long time
without a growing resource cost. Keep paper/graphite surfaces and sea-green
selection from existing tokens, quiet borders, the established font stack and
4px spacing; 44px toolbar targets make the frequent commands usable on touch.
The content leads, navigation follows, download/close remain secondary. No new
palette, font, dependency, persistent preference or server job is proposed.
Use the current single shell; reject separate PDF windows and full-document
pre-rendering because they increase context switching and resource use. Keep fit
page plus continuous fit width/custom; do not remove scrolling to obtain a budget.

## Working behavior and deferred items

Keep native audio/video controls and metadata preload; they already avoid autoplay
and custom decode costs. Keep CSV/Office/archive bounds and inert HTML/SVG handling.
Fix a synchronous complex-worker startup failure locally if reproduced, but do
not expand format support. No OCR, thumbnail pre-generation, full-document search,
PDF text-selection layer, media transcoding or background indexing is added.
Text/table extreme-size rendering and image decoded-pixel measurements remain
separate candidates; no device performance claim is made without measurements.

## Verification

The [integrated local ledger](ux-audit-attachment-reading-2026-10-09-evidence/local-verification.json)
records one complete **601-pass / zero-fail / zero-skip Node run**, including 34
attachment and 14 PDF-policy cases, 26 manual-source cases and the earlier 527.
All 72 previous bound source/test files remain unchanged; the new checkpoint
binds 106 files. The three original attachment failure baselines remain distinct.
The short-final-page reproduction now reports page 120; queue, cancellation,
lease failure/retry, per-canvas limits and installed virtualizer behavior have
synthetic runtime evidence, not a real-device CPU/RSS benchmark.

The combined isolated SQLite API batch passes **103**, with no failures/skips;
lint, nonincremental typecheck, one-worker/non-standalone production build and
single Alembic head 0050 pass. Browser/contract discovery finds **125 cases in
six files**, executing no browser locally. New cases cover 375/1440 and Chinese/
English appearance, long mixed-size PDFs, page-local retry, image zoom/keys,
JSON/CSV/inert HTML, Worker startup, ZIP, Blob retry, empty/unsupported files and
native audio. The Blob injection is not full offline/Dexie acceptance.

No local service is started or policy restriction bypassed. No visual checklist
score, real focus/geometry, PostgreSQL concurrency or production acceptance is
claimed. The [one authorized release cycle](ATTACHMENT_READING_RELEASE_2026-10-09.md)
owns subsequent CI, synthetic screenshot review and safe deployment; earlier
passing CI 37812290017 does not contain these changes.
