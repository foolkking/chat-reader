# Durable batch exports — 2026-10-06

Status: implemented and locally verified; new source CI and deployment pending.
Production remains e27f415 / migration 20261006_0048 until acceptance is recorded.

## Reproduction and scope

The archived list selected three synthetic conversations. One direct CanJSON
request returned 503, but all three requests ran, the browser raised an unhandled
`Export failed (503)` error, and the page showed no failure. Both list handlers
used the same Promise.all / ArrayBuffer / main-thread zipSync path.

Both conversation and project lists now submit one owner-scoped background job.
The ZIP still contains numbered CanJSON files in the submitted order, with no
binary attachments, annotations, notebook or Continuation. It is not a `.cr`
backup or Context Package. Selection remains after failure. A lost response
retains its key in the mounted submitter for safe retry. Tasks remains the
re-entry point after refresh; there is no new permanent task history.

The existing single worker writes entries sequentially under one PostgreSQL
read-only repeatable-read snapshot for the complete batch. Source ownership and
account state are checked before admission, inside the snapshot and before
publication. Final publication is atomic at the existing job/artifact boundary.
Cancellation and ordinary rollback/commit failure remove the task's new files;
process crashes still use the existing orphan-cleanup contract. No migration.

The job participates in Task Center cancellation/retry, the Root-controlled
three-minute default export lifetime, explicit result close, protected transfer
leases, expiry/reclamation and regeneration against current sources. Closing a
list does not cancel admitted work. The client discards late responses after an
account change. Admission waits at most 20 seconds before offering safe retry.

## Local evidence

- Baseline: 3 requests despite failure, 1 unhandled error, 0 error alerts.
- New batch + retention suites: 43 passed, including 7 actual PostgreSQL cases.
- Expanded batch suite: 17 passed (the original 13 plus entry/compressed/expanded
  limits with retry, and queued cancellation). A final retry-helper verification
  passed: 3 passed / 14 deselected using the actual retry service. These suites overlap; do not sum them.
- Related snapshot/artifact/cleanup: 24 passed, 1 Windows symlink skip.
- Actual browser: 6 passed across 375/768/1440px, Chinese/light and English/dark,
  archived/project lists, HTTP failure, real admitted response loss, same-key
  retry, refresh, keyboard, actual ZIP entries/order/content, and regeneration.
- Additional actual account-switch browser test: 1 passed. The old account's
  late response cannot open or populate the new account's Tasks; server returns
  404 for its job. Screenshots show bounded layouts and visible failure recovery.
- Web lint, typecheck and build passed. Alembic has the single head `20261006_0048`.
- Full API/PWA and broad authenticated release gates belong to the upcoming CI;
  they have not yet been claimed for this source. No production acceptance yet.

Initial test corrections are not passes: mkdir exposed an exception outside the
storage-error wrapper and was fixed; a regeneration test incorrectly supplied
an ID instead of an artifact row. Browser setup initially matched Next's route
announcer as a second alert and reused a unique project name; selectors/fixtures
were corrected before the six-case passing run. One related-suite command named
a nonexistent test file and collected no tests; the corrected run is above.

Temporary files are confined to
`C:/Users/86182/Desktop/wkkk/chat-reader-batch-export-20261006`; browser evidence
is in ignored `apps/web/test-results/batch-export-local-2` and `batch-export-auth`.
Only synthetic data is used. No local/server Docker build, production data
mutation, off-site backup or local-residue cleanup was performed.

## Remaining boundaries

One read snapshot remains open while the single worker prepares the batch;
temporary disk capacity and selected conversations' serialized sizes determine
duration. A browser connection is not held during generation. The 1–5000 source
bound and existing entry/compressed/expanded limits reject an oversized batch
without partial download. An accepted retry after source edits is a new current
snapshot, not a replay of old bytes. Ordinary direct-download and background
attachment-bundle scope limits from the previous release remain unchanged.

The continuous optimization goal remains active. CI, source-bound release,
backup/image retention and post-acceptance verification remain to be recorded.
