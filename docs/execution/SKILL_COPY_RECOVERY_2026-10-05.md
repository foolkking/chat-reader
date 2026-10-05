# Skill handoff copy recovery — 2026-10-05

Status: application source `5d48b68` passed complete CI; image verified, deployment
blocked by capacity. Later changes affect test fixtures/documentation only. The inspected release
`daf759d` and its CI are unchanged and do not contain this follow-up. Production
capacity recovery and backup deduplication authorization remain pending.

## Evidence and change

`ContextPackageDelivery` accessed `navigator.clipboard.writeText` before attaching
a Promise rejection handler. With no Clipboard API, the click threw synchronously.
A rejected write only offered retry, although the instructions were not otherwise
visible. The component serves online Acquisition, maintenance preparation and
offline delivery, so all three entry paths had the same recovery gap.

- The existing delivery layout remains flat, with package download first and Skill
  download/copy alongside. Only failure reveals a labelled read-only textarea.
  Focus selects its complete instructions for native manual copy. A successful
  retry hides the fallback and reports success only after the write resolves.
- A small shared hook catches missing APIs, synchronous exceptions and rejected
  writes. Feedback is bound to the exact instruction text, so another locale or
  purpose cannot inherit an unrelated success. Pending writes disable repeat clicks;
  an older asynchronous completion cannot override a newer copy attempt.
- Normalizer uses the same hook and retains its existing failure text and manual
  template. No Skill bytes, personal selection, default, Context package content,
  account data or permission contract changes.
- Visual review of the first passing run found a real mobile failure: Vaul's
  viewport-based translation combined with a 92vh content height left the scroll
  area below the visible screen. Focusing the textarea could also scroll the fixed
  title away. The drawer now separates its full-height surface from the working
  area at the active 60%/92% snap. Tools have bounded scrolling on short screens.
  Copy failure focuses/selects and reveals the manual field automatically.
- Maintenance controls preserve their intrinsic width and wrap between actions,
  with normal-weight secondary text. They do not add a permanent explanation.

The interface uses the existing paper/ink/action/danger tokens, subtle borders,
application font stack, 4px spacing scale and 44px buttons. The fallback uses the
same inset field treatment as Normalizer. There is no new panel, notification or
permanent explanatory block.

## Verification

Task root: `C:/Users/86182/Desktop/wkkk/chat-reader-skill-copy-20261005`.
An isolated PostgreSQL cluster on loopback port 55949 migrated to the single
`20261005_0047` head/current. API/worker use private task storage and port 8015;
Web uses the corresponding production build. TEMP/TMP are process-local.

Lint, typecheck and production build passed. The browser matrix extends existing
real export/guidance and offline tests, plus Normalizer regression coverage:

- Missing Clipboard API, synchronous throw and permission rejection.
- No permanently exposed template; failure shows the exact appropriate text.
- Native keyboard copy from selected fallback text, read back from the real
  browser Clipboard after a sentinel value. Retry also writes actual Clipboard.
- Actual Context/Skill downloads, Raw content and offline attachment checks remain.
- Three widths, both languages, and screenshots of failure recovery.

The initial browser matrix passed **40 / 1 skipped**, but visual review failed
mobile fallback visibility; it was not accepted on assertions alone. After fixing
visible snap height, **42 / 1 skipped** passed including Share focus. A final
production-build run at shorter phone sizes also passed **42 / 1 skipped**.
The skip is the existing optional external JSON/Markdown fixture, not a pass.
Final short-height tools/drag coverage plus Context export/guidance passed **12**
after making the tools grid scrollable. This includes 375x480, expanding the
drawer, closing/reopening at the initial snap and a visible final tool/close button.
Baseline PWA and exact-source CI were pending at the implementation checkpoint;
their final results follow below.

Screenshots in `apps/web/test-results/skill-copy-acceptance/` were inspected at
375px (740px export/844px maintenance heights), 768px and 1440px in both themes
and languages across the matrix. Assertions require the entire fallback inside
the viewport, actual hit-testing, automatic focus/selection, native keyboard copy
and a still-visible mobile close button. They retain Raw/attachment/ZIP checks.

An earlier batch logged Next's `The destination stream closed early`; the
upstream cancellation handler was identified, but no request-level causal proof
or application fix exists. It was not reproduced in the 42-case acceptance run;
this is not a claim that the unrelated logging issue is fixed or harmless.
Process shutdown and exact-source CI will be recorded after final acceptance.
Test injections affect failure paths only; positive package/Clipboard results are
not mocked. External AI execution is not part of this deterministic UI test.

## Complete baseline follow-up

Implementation was pushed as `5d48b686893d44f98092dfffbfa32a4464e8ede1` and CI
`37323431809` was dispatched using the existing Git credential in child-process
memory. No interactive login or credential output was needed.

The first complete local baseline returned **126 passed / 8 failed / 284 skipped**
with the isolated account still using Chinese after the guidance tests. Seven
failures were old selector defects: ambiguous email/cache text, a corrupted Chinese
annotation label, and English-only Reader/Task Center/bulk-action expectations.
Selectors now identify the exact field/file row and accept the actual bilingual
labels. Their value, result counts, width, portal, preserved Reader and complete
Clipboard/package assertions remain. No application behavior was changed to make
these tests pass.

One legacy Service Worker upgrade timed out at shell preparation. The unchanged
case passed the subsequent full affected-file run; no cause or application fix is
claimed. That rerun returned **32 passed / 2 failed** because the first selector
repair used the toolbar's short Done label instead of the batch toggle's accessible
name, and omitted the full Chinese merge label. Both were corrected from the
actual source and failure snapshots before the final complete rerun. All failed
logs/traces are retained separately from later results.

The next full run passed **137 / 1 failed / 284 skipped**. Legacy upgrade timed
out again; trace requests showed the application's current worker being registered
21 ms after the synthetic legacy script, before navigation to Library. The fixture
had mounted the application homepage while installing its historical worker.
It now installs/activates the old worker on an isolated same-origin static page,
asserts that old script is active, then navigates to the actual Library. No runtime
worker code changed. The case passed **5/5** repetitions; the final complete
baseline passed **138 / 284 skipped** (four additional CSP cases compared with the
CI baseline). English-only fallback assumptions were not restored to obtain a pass.
The cancellation log also recurred in the failed baseline; it remains unproven.

## CI, artifact and release boundary

[CI 37323431809](https://github.com/foolkking/chat-reader/actions/runs/37323431809)
passed all five jobs against application source
`5d48b686893d44f98092dfffbfa32a4464e8ede1`. API **902/3 skipped**, runtime **64**,
worker/cleanup **53**, settings **136** plus **1** fresh PostgreSQL restore,
Context **35**, import recovery **8/1 skipped**, Reader/security **45**, Share **2**,
source mutation **16**, source cleanup **1**, upload atomicity **18**, image Viewer
**1**, PDF **5**, CSP **4**, authentication **18**, offline negatives **17** and
baseline PWA **134/284 skipped** passed. Lint/typecheck/build, migration and both
image gates passed. Counts overlap across suites. Subsequent bilingual/setup test
repairs were verified locally and do not change the application or image source;
they are not claimed to have run in that earlier CI.

Downloaded artifact under the task root's `release/artifact/`:

- Source/run/attempt: `5d48b68` / `37323431809` / `1`.
- Archive: 196,647,521 bytes; SHA-256
  `5737b14069ed2a105edb0c5a10b25189f679eb4209b5f1c245dc502c53991cde`.
- API: `sha256:d905eabd6420c3fe176942487aefee32ea451b9aadeaec11f3429e9d3dafa9cb`.
- Web: `sha256:2163878a261a1de1f5fefa4a90920b853e157678ea8eb4e831ec01b3d9de1c8e`.
- All 50 content-addressed blobs, four tags, Linux/amd64 and source labels were
  independently checked without extracting paths or loading Docker locally.

The task's `release/` contains 13 source-bound helpers; Python/shell syntax and all
16 `support.tar` members match the exact Git source, using LF archive output.
They are prepared locally only. Production remains healthy at `3f1d539`/`0046`;
the read-only capacity check found **3,326,108 KiB** free. The existing deployment
preflight needs about **5.03 GiB**. No override, backup deduplication, upload, image
load, migration or service replacement was performed. The previous proposed
byte-identical backup deduplication remains unapproved; no old image is eligible
for post-replacement cleanup yet. Use this release's helpers/artifact after capacity
recovery, refresh the live baseline, then follow the established release gates.

API/worker PID plus creation-time/command identities were rechecked before stopping;
the dedicated PostgreSQL data directory was stopped with `pg_ctl`. Ports
8015/55949/3107 have no remaining test listeners. Local task files remain for the
user; original repository residue and user imports were neither staged nor removed.
