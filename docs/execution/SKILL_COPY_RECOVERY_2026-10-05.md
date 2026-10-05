# Skill handoff copy recovery — 2026-10-05

Status: implementation after `5ed981c`; full release gates in progress. The inspected release
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
Baseline PWA and exact-source CI remain pending at this source checkpoint.

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
