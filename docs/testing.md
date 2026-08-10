# Testing Addendum 2026-08-09

## Reader wheel stabilization 2026-08-10

The production-equivalent fixture contains three heavy Assistant messages with 402, 389 and 501 mixed paragraph, CJK, emoji, heading, list, table and short/long-code blocks. It may be created by the suite or reused explicitly:

```powershell
$env:E2E_LONG_READER='1'
$env:E2E_LONG_READER_CONVERSATION_ID='<qa-conversation-id>'
$env:E2E_LONG_READER_TARGET_MESSAGE_ID='<qa-message-id>'
$env:E2E_LONG_READER_TARGET_BLOCK_INDEX='180'
$env:E2E_LONG_READER_ANNOTATION_QUOTE='<qa-quote>'
corepack pnpm --filter web exec playwright test e2e/reader-restoration.spec.ts e2e/reader-block-layout.spec.ts --config=playwright.config.ts
```

The suite asserts estimator bounds, direct/search/annotation navigation, refresh restoration, TOC virtualization, preference anchoring, Owner and Share reuse, 30 monotonic wheel steps, at most six mounted messages, bounded virtual rows, no row gaps/overlap, no middle-window turn fetch, no save during wheel input and exactly one save after idle. Current result: `9 passed`.

Performance gating is opt-in so slow CI hardware does not hide functional failures:

```powershell
$env:E2E_READER_PERF_BUDGET='1'
corepack pnpm --filter web exec playwright test e2e/reader-restoration.spec.ts --config=playwright.config.ts --grep 'continuous wheel' --repeat-each=3
```

Current production-build Chromium results were `16.7ms` p95 frame interval in all three runs; longest task was `72/68/70ms` and five-second long-task total was `72/68/70ms`. Budgets are p95 `<=34ms`, no task `>150ms`, and total long-task time `<=250ms`.

Release checks for this change: Web lint/typecheck/build PASS; API `216 passed / 3 skipped`; Alembic one head `20260806_0021`; PWA default `37 passed / 22 conditional skips`. Conditional PWA skips remain `PARTIAL_PASS`, not PASS.

## Release-Readiness Audit 2026-08-10

- Required local baseline: lint, typecheck and production Web build passed; API `216 passed, 3 conditional skips`; PWA `30 passed, 21 conditional skips`; Alembic has one head `20260806_0021`. Conditional skips are not PASS.
- Real production Chrome acceptance was read-only for existing business data. QA-only conversations verified creation, insertion, source task toggle, deletion/undo, restricted Share/revocation and the direct API import follow-up. Existing acceptance fixture verified attachment Renderers, Range and adaptive visible Viewer panels.
- The supplied JSON + Markdown pair previewed exactly 398 nonempty messages and committed without a 500 through the production multipart API. Browser chooser interaction remains `NOT_PRODUCTION_VERIFIED` because this Chrome integration cannot inject chooser selections.
- Release blockers: active unreferenced Attachments missing from Files Panel filters and a non-functional delete-undo toast. The detailed report, QA cleanup record and redacted evidence are in [UX_RELEASE_READINESS_AUDIT_2026-08-10.md](evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md).
- Production negative offline/weak-network faults, 360px and browser zoom matrix, QA export/restore round trip and conditional PWA scenarios remain `NOT_PRODUCTION_VERIFIED` until separately executed.

## Release Stabilization 2026-08-10

- Root-cause fixes: delete/restore now return the committed conversation revision; edit/task/version responses do the same; Web seeds the create response, applies insert/edit/task/version/delete/restore revisions immediately, and preserves a retryable Undo state. Restore is idempotent.
- Attachment API rows expose `current_occurrence_count` as a projection. Active zero-reference rows remain eligible for All/Unreferenced; detached rows remain excluded. No occurrence/AssetObject merge or migration was introduced.
- Managed dialogs use `useDialogFocus` for synchronous meaningful focus, Tab/Shift+Tab trapping, Escape and logical trigger restoration after pointer defaults. Backdrops are pointer-only `aria-hidden` surfaces, so each dialog has one accessible visible close button. Attachment Viewer restoration falls back to the current connected Attachment trigger if React replaced the opener node.
- Disabled Scanner messaging is neutral `Info` + `未扫描`; it is not rendered as clean/safe or as an attachment fault. Project creation uses Chinese `新建项目` labels and autofocuses the inline field.
- Verification: targeted API `10 passed`; full API `216 passed / 3 skipped`; Web lint/typecheck/build PASS; focused stabilization contracts `4 passed`; PWA default `30 passed / 21 skipped`. Production Chrome on final commit `ed9116a` passes Viewer initial focus, keyboard loop, Esc/X/backdrop restoration, single close/Shell, and Project-create autofocus/Escape restoration. The bridge's requested 390px viewport rendered at 433px without page horizontal overflow. Exact 360/390, real 125/150/200% zoom and forced-offline negative paths remain `NOT_PRODUCTION_VERIFIED`; skips are not release PASS.

## Attachment Inline Layout System

- Focused Playwright policy tests: `13 passed` across InlinePresentation mapping, six centralized lane contracts, justified last-row bounds, progressive disclosure, runtime FileList fallback, CSV/TSV Table/Raw behavior and unchanged adaptive Viewer behavior.
- Web lint, typecheck and production build: PASS.
- API regression: `216 passed, 3 skipped`; skipped fixture-gated cases are not PASS.
- PWA default matrix: `28 passed, 21 skipped` (`PARTIAL_PASS`). Online/fixture-gated upload, full Reader and restoration scenarios require explicit services/flags.
- Alembic: one head `20260806_0021`; no migration.
- Production Chrome evidence: the deployed acceptance conversation verified group-owned lanes, one Viewer shell, CSV Table default, Raw toggle and return to Table. The broader visual matrix (all requested formats and mobile widths) remains `NOT_PRODUCTION_VERIFIED` unless separately captured; skipped cases are not PASS.
- Caption follow-up: focused policy tests `6 passed`; final production Chrome found zero legacy `Attachment:`/`附件：` captions duplicating Preview-header filenames. All three CSV Table actions remained available.

Local checks for the conversation, import and viewer addendum:

- `pytest -q` API suite: `216 passed, 3 skipped`.
- Real JSON + Markdown fixture (`CHAT_READER_E2E_FIXTURE_DIR=<EXAMPLES_DIR>`): 398-message preview, commit and repeated commit passed; local test harness elapsed 17.7 seconds.
- Web lint, typecheck and production build: PASS.
- Attachment renderer policy/presentation Playwright tests: PASS.
- Full King browser verification of new message dialogs and complex Office/ZIP viewers: `NOT_PRODUCTION_VERIFIED` until a dedicated deployment test is run. Skipped scenarios are not PASS.

## Reader Wheel Performance Regression

- `reader-block-layout.spec.ts` verifies paragraph, CJK/emoji, explicit-line, heading, code and empty-block estimates against stable layout metrics.
- `reader-restoration.spec.ts` verifies monotonic 30-step wheel input, bounded warmed height correction, no middle-window turn request, one idle position write, TOC follow, preference anchoring, annotation/refresh restoration and Share Reader reuse.
- Performance budgets run on a production build three times; report the median and every raw run. Functional invariants must never be skipped because a CI host is slow. Timing-budget failure may be reported as environment-specific only when all functional invariants still pass.
- 2026-08-10 local production-build result: p95 frame interval 16.7ms; longest task 72/68/70ms; total long-task time 72/68/70ms. Production Chrome read-only wheel evidence was monotonic with zero reverse steps and an 85px warmed height correction over about 1,080px.

## Reader Scrollbar Jump Regression

- `reader-restoration.spec.ts` changes an upstream virtual height after a heavy message has cached its absolute margin, jumps into that message, and requires a visible block plus reading-line coverage within the recovery budget. A visible Message shell without a visible block is a failure.
- The pointer-drag regression holds an active pointer while moving the Reader to the edge. It asserts that no `reader-turn` request starts while the pointer is held, then that exactly one request starts after release.
- Run the production-equivalent path with `E2E_LONG_READER=1`; the default PWA matrix intentionally reports these fixture-gated cases as skipped rather than PASS.
