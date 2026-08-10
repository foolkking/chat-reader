# Testing Addendum 2026-08-09

## Attachment Inline Layout System

- Focused Playwright policy tests: `13 passed` across InlinePresentation mapping, six centralized lane contracts, justified last-row bounds, progressive disclosure, runtime FileList fallback, CSV/TSV Table/Raw behavior and unchanged adaptive Viewer behavior.
- Web lint, typecheck and production build: PASS.
- API regression: `216 passed, 3 skipped`; skipped fixture-gated cases are not PASS.
- PWA default matrix: `28 passed, 21 skipped` (`PARTIAL_PASS`). Online/fixture-gated upload, full Reader and restoration scenarios require explicit services/flags.
- Alembic: one head `20260806_0021`; no migration.
- Production Chrome evidence: the deployed acceptance conversation verified group-owned lanes, one Viewer shell, CSV Table default, Raw toggle and return to Table. The broader visual matrix (all requested formats and mobile widths) remains `NOT_PRODUCTION_VERIFIED` unless separately captured; skipped cases are not PASS.

Local checks for the conversation, import and viewer addendum:

- `pytest -q` API suite: `216 passed, 3 skipped`.
- Real JSON + Markdown fixture (`CHAT_READER_E2E_FIXTURE_DIR=<EXAMPLES_DIR>`): 398-message preview, commit and repeated commit passed; local test harness elapsed 17.7 seconds.
- Web lint, typecheck and production build: PASS.
- Attachment renderer policy/presentation Playwright tests: PASS.
- Full King browser verification of new message dialogs and complex Office/ZIP viewers: `NOT_PRODUCTION_VERIFIED` until a dedicated deployment test is run. Skipped scenarios are not PASS.
