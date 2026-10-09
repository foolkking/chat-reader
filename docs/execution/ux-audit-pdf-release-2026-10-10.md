# PDF release-blocker review — 2026-10-10

## 1. Scope and evidence

This is a scoped pre-edit continuation of the ordinary-reader attachment audit,
not a new visual direction. It reviews PDF orientation and page-local failure
recovery in the existing Web Viewer, at 375px and 1440px, for mainstream readers.
The user authorized repair/retry within this release cycle, with complete
exact-source CI and independent image acceptance before deployment.

Seen: exact source `36b656a5c1642989c9fc1796bfd4c21a6cbe7f9e`, sixth-run logs,
recorded PDF DOM/action traces, four inspected synthetic screenshots, and the
actual component/E2E-injection probe using the installed Virtualizer and explicit
hook/DOM/PDF doubles. The [CI extract](ux-audit-pdf-release-2026-10-10-evidence/sixth-ci.json)
retains status distinctions and sanitized PDF nodes. The
[probe](ux-audit-pdf-release-2026-10-10-evidence/probe.mjs) and
[results](ux-audit-pdf-release-2026-10-10-evidence/probes.json) bind their frozen
source; they are not browser geometry or real PDF rendering measurements.

Not seen: local live Web (the prior start remains denied), production UI,
physical-device CPU/RSS, or the three Web gates after PDF. No full visual or
accessibility-conformance score is claimed. Recorded screencast images are
downsampled; their capture viewport and image dimensions are not interchangeable.

## 2. Summary

The mobile attachment-return repair passes its real browser checks, and all
21 attachment cases now pass. The sixth complete run still fails: PDF has seven
passes and six assertion failures, not six timed-out cases. Four failures show
page 90 correctly rendered while the toolbar reports 89 after Fit width. A
subpixel scroll boundary causes the installed virtualizer's page lookup to
select the previous item. Two desktop retry cases inject a one-shot canvas
failure that is not stable through size-driven rendering. Preserve the existing
reading and resource contract, repair the page lookup, and make the test outage
last until the actual Retry click before repeating the complete release gate.

## 3. Findings and quick wins

### DATA-PDF01 · Fit width can report the preceding page

- Kind/dimension: **Defect**, data display and navigation orientation.
- Severity: **High**; effort **S**.
- Confidence: **Observed (CI actions, recorded DOM, screenshots, actual-source
  numerical probe)**. The probe uses an integer-scroll double, not native layout.
- Location: `apps/web/features/attachments/attachment-viewer.tsx:638`;
  `apps/web/e2e/pdfjs-migration.spec.ts:152`.
- Evidence: all four 375/1440px × Chinese/English long-PDF cases reach a rendered,
  visible page 90 after Fit width but report input value 89. The mobile trace has
  scrollTop 40930 and the target row near 40946.1; sampling scrollTop + 16 lands
  immediately before the target start. The probe's installed Virtualizer likewise
  reports 89 at integer offsets 40929/143666 while adding one CSS pixel to the
  sampling inset reports 90. The
  [mobile](ux-audit-pdf-release-2026-10-10-evidence/mobile-page90-reports89.jpg) and
  [desktop](ux-audit-pdf-release-2026-10-10-evidence/desktop-page90-reports89.jpg)
  screenshots visibly pair toolbar 89 with synthetic page 90.
- User consequence: changing scale misstates where the reader is and bases the
  next navigation action on the wrong page, although the PDF itself rendered.
- Recommendation: tolerate only the subpixel alignment boundary by sampling one
  CSS pixel inside the existing 16px page inset. Retain real user-scroll page
  updates and the short-final-page clamp. Test floor/round offsets, nearby genuine
  previous/next scrolling, fit/zoom/resize, direct entry and thumbnails. Do not
  pin the selected page indefinitely, debounce navigation, or render extra pages.

### TEST-PDF01 · A one-shot outage does not reliably exercise explicit Retry

- Kind/dimension: **Verification defect**, error recovery evidence, not a second
  demonstrated product failure. Release priority **High**; effort **S**.
- Confidence: **Observed (CI screenshot/final snapshot, source and controlled
  execution)**; the precise CI ResizeObserver callback sequence is **Inferred**.
- Location: `apps/web/e2e/pdfjs-migration.spec.ts:210–226`;
  `attachment-viewer.tsx:662–690`; `viewer-presentation.ts:62,104`.
- Evidence: the desktop trace screenshot actually shows
  [the page-local error](ux-audit-pdf-release-2026-10-10-evidence/desktop-transient-page-error.jpg)
  about 548ms after Preview. Its final failed assertion snapshot instead has a
  visible, non-busy page-one canvas. The injector throws only once. The actual
  PdfPage effect depends on container dimensions and re-renders after a size
  change; the actual-injector probe changes height 720→722, recovers on its second
  render and records zero Retry clicks. The existing desktop shell transitions
  dimensions as PDF page count becomes known. Both mobile retry cases pass, with
  [an inspected error screenshot](ux-audit-pdf-release-2026-10-10-evidence/mobile-page-error.png).
- User consequence: this gate cannot reliably verify that a reader can recover
  a persisting page failure; it can fail after a successful automatic redraw.
- Recommendation: retain a page-one-only synthetic failure until a real Retry
  click on that page, with counters proving failure and retry. Preserve the
  existing localized error, rendered-canvas, page-two and close assertions. Add a
  resize-before-retry check; keep all case/gate time budgets. Do not force the
  production Viewer to preserve an error after it has genuinely recovered.

## 4. Priority and acceptance

1. Record the new failing actual-source regressions, then narrowly repair
   DATA-PDF01 and TEST-PDF01.
2. Run the full local Node suite, lint, nonincremental types, one-worker build and
   browser discovery. Preserve the previous 115 source bindings in a new ledger;
   do not rewrite historical evidence or unrelated buildinfo.
3. Commit only this repair/evidence, then run **all** CI jobs in the same authorized
   cycle. Re-review synthetic screenshots and independently validate the
   exact-source images before any production operation.

Design checkpoint: readers are keeping their place in a document, not operating
a new control. Retain paper/graphite/sea-green semantic tokens, border/subtle
surface depth, current shell elevation, font stack and 4px spacing system. No
new UI surface, timer, observer, fetch, canvas, dependency or render concurrency
is needed. The sampled inset is numerical tolerance, not a visual spacing token.

## 5. Working paths and remaining boundaries

Sixth run [37936101205](https://github.com/foolkking/chat-reader/actions/runs/37936101205),
attempt one: API **1,239 passed / three skipped / 20 warnings**, 844.17 seconds;
settings **439 passed**, plus **one** independent fresh-instance restore. Web has
nine passing gates, one failing gate and three not verified. Mutation passes
**100** in 544,082ms; attachment passes **21** in 72,460ms. PDF is **seven passed /
six failed / zero timedOut / zero skipped / zero interrupted**, 417,967ms.
The adaptive-import gate's one conditional skip is not a pass.

The real-worker, version, Range, malicious/corrupt-file and Share checks reached
by this run remain passing evidence for this exact source. Later long-document
steps after the failed page-value assertion remain unexecuted, not accepted.
Default PWA, authentication and negative PWA remain unverified in this run;
both image jobs were skipped. The diagnostic artifact is not a release artifact,
and production remains on accepted 30a0d32.

Open questions are bounded: real-device performance and other browser engines
need independent evidence; this numerical fix does not claim to measure them.
The separately delivered annotation/CSV audit stays outside this blocking repair.
This report and its evidence are delivered before product/test modification.

## 6. Local repair checkpoint (after report delivery)

Only the visible-page sample changes in product code: 16→17, with its subpixel
intent documented. The real short-final-page logic, observers, scroll handlers,
render queue, canvas budgets, engine and permissions are unchanged. The E2E fault
is page-one-only, persists through resize, and restores the original getContext
only on a trusted Retry click. Failure/retry counters are test-only. All original
assertions and time budgets remain; wheel navigation and a recovered screenshot
add coverage rather than weakening the old tests.

The installed Virtualizer regression pumps its real reconciliation after the
hook double re-renders. An initial unpumped harness was corrected before using
it as the alignment oracle; its intermediate stale sizes are not an additional
product finding. Final pre-repair baseline: **41 tests / 37 passed / four failed**,
1,076.4816ms. The same suite after repair is **41 passed**, 1,040.4194ms. New cases
cover floor/round alignment at both widths, custom scale, resize, repeat
navigation, genuine forward/backward updates, wrong-page/untrusted clicks and
persistent failure through resize followed by the actual component Retry.

Full Node: **666 passed / zero failed / zero skipped**, 8,567.6464ms. Lint,
nonincremental types and one-worker/non-standalone build pass. Discovery remains
**149 cases in ten files**, no local browser execution. API is unchanged/not
rerun locally; source migration head remains 0050. The additive
[ledger](ux-audit-pdf-release-2026-10-10-evidence/local-verification.json) keeps all
115 source bindings and preserves its parents and pre-edit evidence.

The next full CI must establish actual PDF rendering/scrolling/retry on the
repaired source and pass the previously unreached gates. No full visual score,
CPU/RSS result, image acceptance or deployment is implied by these local checks.
