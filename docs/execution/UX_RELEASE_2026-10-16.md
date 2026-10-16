# UX and editable cleanup ranges release — 2026-10-16

Status: release in progress; production is still the accepted `84988a2`/0050.
The user explicitly authorized commit, CI and deployment, then required local
GitHub-token/CLI use rather than login or the GitHub website. Credentials remain
in the system credential provider and per-process memory, not this record.

## Local preflight

- The earlier 63-file UX continuation passed 1,412 tests without skips.
- Full Web lint, typecheck and production build passed.
- Full local API suite: **1,129 passed / 159 skipped / 0 failed**, 2,622.35 s.
  PostgreSQL-only skips are not release acceptance.
- Local PWA built, then was stopped after two missing-API browser timeouts.
  It is not a passing gate.
- Source has the single head `20261015_0051`. The existing local database is at
  `20260823_0028`; it was not upgraded. A later disposable-browser fixture could
  not create its separate database because the local role lacks `CREATEDB`.
  No new database was created and no existing database was modified.
- Staged source/document whitespace checks exclude archived raw console
  transcripts in `*-evidence/`; emitted whitespace and initial failures remain
  intact there.

## Candidate and first CI findings

Candidate `97d0915254f1fd1e47a6399b7297c99e909184ad` was committed and pushed to
`master`. Local-token dispatch started run **38829804840**, attempt 1, against
that exact SHA.

- Web lint, typecheck, build and all **1,412** UX tests passed in CI.
- Settings initialization failed while pulling the pinned official PostgreSQL
  image from ECR Public: `toomanyrequests: Data limit exceeded`. No settings
  test ran in that attempt.
- The adaptive-import browser gate passed seven, skipped one conditional
  real-input case and failed one outdated error-copy assertion. A mutation
  503 now reports the intentionally unconfirmed outcome, not read-only service
  unavailability. The revised test requires the exact current recovery text,
  retained input, no conversion help and exactly one analysis request.
- The revised browser test passed targeted ESLint and nonincremental typecheck.
  Its browser execution still requires the complete disposable CI fixture.
- The first API job is still running at this checkpoint; no full CI success or
  deployable image is claimed.

## Production boundary

Read-only King preflight confirmed the expected current/rollback pointers,
exact old API/Web image IDs and database head 0050. PostgreSQL and application
services were running. The operational checkout is independently modified and
must not be reset or replaced. No production backup, writer stop, image load,
migration or service replacement has run in this batch.

0051 adds only nullable `content_cleanup_occurrences.reviewed_ranges`; existing
NULL values retain the legacy whole-candidate choice. Before any replacement,
all five exact-source CI jobs, independent artifact checks, recovery-point
verification, capacity checks and a fresh stopped-writer backup must pass.
Migration acceptance must compare every pre-existing column and all four stores,
and separately verify that the added field is NULL on existing rows. Rollback
must stop writers and use the tested consent-revoking downgrade before old API
code is started; silently dropping the field is not safe.
