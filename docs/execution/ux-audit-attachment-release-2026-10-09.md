# UX audit — attachment release blockers

Pre-edit checkpoint, 2026-10-09. This report precedes the corresponding runtime
repairs; later verification must be appended without rewriting this baseline.

## 1. Scope and evidence

Audited: ordinary-user attachment opening/retry/return from the conversation file
panel, local Blob reads and Office/ZIP routing. Platform: the existing responsive
Web app; mainstream readers, including phone use. Preserve the approved quiet
paper/graphite/sea-green system, font stack, 4px spacing grid, current fullscreen
phone Viewer and desktop modal. This is interaction recovery, not a redesign.

Source: `adaa8decf2b4f78cc3d950b59f9751b718362ea2`. Exact-source
[CI 37913851928](https://github.com/foolkking/chat-reader/actions/runs/37913851928),
attempt 1, completed with failed Web and passing API/settings. The original
non-deployable quality artifact is 11610445727 (27,740,608 bytes). The adjacent
[sanitized checkpoint](ux-audit-attachment-release-2026-10-09-evidence/fourth-ci.json)
records counts and trace excerpts; selected synthetic screenshots are retained
beside it. Traces are read as data; no local Web/API/worker/PG service or browser
is launched. Production UI and private content are not inspected.

The full-site review remains active but is not completed by this narrow report.
PDF/PWA gates did not execute after the attachment failure. This report makes no
accessibility-conformance, real-device CPU/RSS or full visual-acceptance claim.

## 2. Executive summary

Readers can see a phone attachment error but cannot click its Retry action
because the underlying file drawer receives the pointer event. Local cached JSON
also fails after retry because the document CSP blocks Blob fetches. A DOCX whose
detector reports the generic ZIP container opens its internal file directory
instead of readable document text. These are three product defects with distinct
causes, not one slow test. Separately, the Worker fault injection does not match
the production bundle, and timed-out fixture cleanup can mask the primary error.
The earlier mobile Reader/move repair now passes the 100-case mutation gate;
this does not compensate for the attachment failure or authorize deployment.

## 3. Quick wins

Allow local `blob:` fetches in `connect-src`, while retaining all external
network, script, Blob-worker and frame restrictions (STATE-AR02). Give the
existing complex-preview Worker a stable diagnostic name and inject its failure
by that identity, independent of bundler changes (TEST-AR01). Reuse the existing
bounded fixture-teardown pattern from `manual-markdown-fidelity.spec.ts`
(TEST-AR02). No new dependency or background workload is needed.

## 4. Findings

### FLOW-AR01 — phone file drawer intercepts the foreground Viewer

- Type/dimension: defect; core flow, input, focus and recovery.
- Severity: **Blocker** for attachment actions launched from the phone file panel.
- Confidence: **Observed (CI pointer-action trace + source + selected frame)**;
  the exact focus/scroll repair remains unverified in a browser.
- Location: `apps/web/components/mobile-reader-sheet.tsx:35`,
  `apps/web/features/attachments/attachment-viewer.tsx:242`.
- Evidence: 375px Chinese JSON test reaches the visible “重试” button, but repeated
  normal clicks report the “搜索文件” input in “当前对话文件” as intercepting the
  pointer. The [failure frame](ux-audit-attachment-release-2026-10-09-evidence/mobile-json-blocked.jpg)
  shows the foreground error; it does not by itself prove clickability. Vaul's
  modal uses body pointer blocking, a trapped focus scope and Overlay-owned
  RemoveScroll. The separately portalled Viewer lacks explicit pointer enablement.
- User consequence: the recovery action is visible but unusable; repeated taps
  may interact with the hidden underlying file panel.
- Recommendation: give the foreground Viewer pointer ownership and suspend
  interaction with the still-mounted drawer while it is open. Preserve drawer
  search, selection, scroll and opener. Remove only the drawer's scroll-locking
  Overlay during the nested Viewer; guard outside/Escape dismissal, make its
  content inert and hidden to accessibility, and restore it on Viewer close.
  Do not switch Vaul modal/nonmodal content types (which remounts the file panel),
  increase z-index alone or use forced clicks. Keep the existing open/close context
  identity stable and publish open state separately.
- Effort: **M**; shared mobile surface, so verify both nested and ordinary drawers.

### STATE-AR02 — enforcing CSP rejects local cached-file fetches

- Type/dimension: defect; offline state and recovery.
- Severity: **High**.
- Confidence: **Observed (CI browser console + source)**. Actual Dexie-package
  recovery still requires the separate offline matrix.
- Location: `apps/web/next.config.mjs:26`, `readPreviewText` in
  `attachment-viewer.tsx`, `readPreviewBytes` in `complex-attachment-viewer.tsx`.
- Evidence: the desktop Blob test reaches real `fetch(blob:...)` after its first
  deliberate read failure. Chromium reports a violation of `connect-src 'self'`.
  Preserving the Blob URL on retry is correct but cannot overcome that policy.
- User consequence: a file already on the device remains unreadable, and Retry
  repeats the same policy failure without any useful recovery.
- Recommendation: narrowly add `blob:` to `connect-src`; assert exact generated
  policy and successful original-byte Blob fetch under the enforcing header.
  Keep external-origin requests blocked and Blob workers prohibited. Update the
  CSP resource graph; this adds no external runtime origin or persistent cache.
- Effort: **S** plus full CSP/attachment/offline browser regression.

### DATA-AR03 — ZIP-container MIME obscures supported Office content

- Type/dimension: defect; data presentation and core reading.
- Severity: **High**.
- Confidence: **Observed (CI rendered directory + source)**.
- Location: `apps/web/features/attachments/preview-adapter-registry.ts:134`;
  detector fallback in `apps/api/app/services/assets/scanner.py:167`.
- Evidence: all four Office cases display “ZIP 压缩包 · DOCX” and the two fixture
  entries `[Content_Types].xml` and `word/document.xml`, shown in the
  [desktop frame](ux-audit-attachment-release-2026-10-09-evidence/docx-as-zip.jpg).
  The registry always lets detected `application/zip` win; ZIP-backed Office
  containers can legitimately receive that generic detector result.
- User consequence: opening an ordinary document presents packaging XML rather
  than its paragraph, despite an installed supported read-only parser.
- Recommendation: refine **only** generic ZIP MIME with the narrow existing
  ZIP-backed Office extensions `.docx/.odt/.xlsx/.ods/.pptx/.odp`. Keep strong
  PDF/image/other MIME authoritative, ordinary `.zip` unchanged and legacy `.doc`
  outside this exception. The existing bounded parser must validate actual
  members; a renamed arbitrary DOCX must fail when its required document member
  is absent, and no format may execute packaged content. This is not full OOXML/
  ODF schema validation or an expansion of the existing read-only parser.
- Effort: **S** with registry and real parser/browser checks.

### Test-evidence defects (not extra product UX findings)

**TEST-AR01.** `attachment-reading.spec.ts:145` injects a startup failure only
when `options.type === 'module'`. The locally emitted production chunk contains
`new Worker(...,{type:void 0})`; CI actually starts the Worker and shows the
archive. This is an **Observed (compiled local source + CI outcome)** test-path
defect, not evidence that the startup-error handler is broken. Use a stable Worker
name, keep the no-read-before-start assertion, then prove Retry starts the real
worker and renders DOCX text. Do not loosen the assertions to accept a ZIP view.

**TEST-AR02.** All five attachment test families delete synthetic conversations
inside `finally` using the exhausted test budget. The phone JSON trace's original
click waits approximately 87 seconds; cleanup then becomes the reported timeout.
This is **Observed (CI trace + source)**. Move cleanup to a fixture with its own
30-second teardown budget and 15-second request timeout, as the existing manual
Markdown test does. Keep the 90-second case and 20-minute gate budgets unchanged.

## 5. Prioritized implementation and acceptance

1. Capture failing local source/handler baselines, then repair FLOW-AR01 without
   unmounting its owner. Browser tests must prove normal click, Tab/Shift+Tab,
   scroll, topmost Escape, no hidden-panel action and return to the same opener.
2. Repair STATE-AR02 with both positive Blob and negative external/CSP tests.
3. Repair DATA-AR03 and TEST-AR01 together, retaining real worker parsing and
   malformed-container rejection. Repair TEST-AR02 without extending budgets.
4. Run lint, nonincremental types, complete Node suite, bounded Web build and
   E2E discovery locally. No local browser execution or policy bypass.
5. Submit one repair in the same authorized release cycle; require **all** CI
   gates and independent exact-source image acceptance before deployment.

## 6. Working paths and retained constraints

Mutation: **100 passed / 0 failed / 0 skipped / 0 timed out**. The reviewed
[mobile pending-move](ux-audit-attachment-release-2026-10-09-evidence/mobile-placement-pending.png)
and [quiet-autosave](ux-audit-attachment-release-2026-10-09-evidence/mobile-quiet-autosave.png)
screenshots show retained controls and uninterrupted reading at their captured
states. The latter is not by itself a save/geometry measurement; the CI test owns
those assertions. Gallery and desktop JSON/table/source/native-audio cases pass.

Retain the unified Viewer, resource budgets, metadata-only media loading,
read-only Office parser, existing visual tokens, source fidelity, stable reading
anchors, ownership checks and offline-package compatibility. No migration,
dependency, PDF engine upgrade or decoding-ahead workload is proposed.

## 7. Remaining evidence

- The candidate is not deployable: attachment gate **9 passed / 6 failed /
  6 timed out**, followed by four unverified gates; no image was built.
- New nested modal behavior needs actual browser verification; Node doubles do
  not reproduce native inert/focus/RemoveScroll interaction.
- Large table/text rendering, annotation request ordering and real decoded-image
  memory are separate follow-up candidates, not claims of completed repair here.
- No new CI/deployment is authorized after this cycle without the user's request.

## 8. Local repair checkpoint (after the report was delivered)

The new actual-source/handler baseline ran **71 tests: 54 passed / 17 failed /
zero skipped**, 1,145.9961 ms. After scoped implementation, the same 71 pass in
1,042.432 ms. These include real fflate/member parsing and generated CSP checks,
but explicit hook/DOM/Worker doubles are not browser evidence. The complete UX
Node suite then passes **659 / zero failed or skipped**, 7,859.8714 ms; lint and
nonincremental typecheck also pass. One initial Windows command passed an
unexpanded wildcard to Node and executed no tests; the recorded complete run
uses `rg --files` to supply actual test paths. No tests were skipped to fix it.

Mobile Content is retained with its original modal type. A lightweight visibility
context leaves Viewer commands stable; only foreground Viewer pointers remain
active, and drawer outside/Escape/auto-focus callbacks are suspended. CSP adds
only local Blob connections. Registry refinement is extension-bounded and leaves
strong MIME/legacy ZIP behavior unchanged. The parser/renderer size budgets and
all PDF canvas concurrency/allocation bounds are unchanged.

Attachment browser tests retain their original reading, failure, source and
permission assertions. They now target the named real Worker, have independent
bounded fixture cleanup, and additionally assert actual foreground focus/Tab,
wheel scrolling without background scroll, preserved file-panel DOM/search/
selection, topmost Escape and return to the exact preview action. These browser
assertions are **not yet executed**. The bounded one-worker/non-standalone build
passes; its emitted Worker keeps the diagnostic name with `type: void 0`.
Final discovery finds **149 cases in ten files**, retaining the earlier 144 and
adding the CSP and rich-attachment cases. The
[local ledger](ux-audit-attachment-release-2026-10-09-evidence/local-verification.json)
verifies 105 unchanged / five expected changes from the 110-source parent and
binds five additional sources (115 total). Earlier ledgers and unrelated buildinfo
are unchanged. Complete exact-source CI and deployment are not yet accepted.
