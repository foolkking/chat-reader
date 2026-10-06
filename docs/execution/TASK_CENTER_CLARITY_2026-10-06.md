# Task Center clarity — 2026-10-06

## Scope and findings

The preceding attachment release f0e355a is already deployed and accepted; its
backup and cleanup must not be replayed. This stage addresses repeated export
results with indistinguishable labels, incorrect archive/publication phases,
terminal 100% bars, buried failures, and partial/cancelled results filed as complete.

## Implementation

- Preserve owner filtering, exact artifact delivery, retry/cancel and retention.
  Add nullable source/format metadata without a migration. Snapshot the first two
  batch source titles in one bounded query; retain original identity on replay.
- Quiet divided rows use existing theme tokens. Localized operation and format
  precede source, state and server submission time through seconds. Full errors
  remain readable; active progress has accessible values. Cancelled work is separate;
  failures and partial results precede successful results.
- Restore focus if a retry/cancel moves its focused row. Do not reintroduce a
  dismissed result from the temporary completion notification.

## Verification status

- First changed-file lint and TypeScript check passed. After adding tests, lint
  passed; the Corepack typecheck wrapper reported ENOSPC while saving its cache
  despite exit zero. This second command is not counted as clean verification.
  Direct Node invocation of the same TypeScript compiler with no incremental
  output subsequently passed; six changed Python files parsed successfully.
- Added real persisted API read/retry/source snapshot/ownership assertions and
  rendered group/focus regressions. Added a PostgreSQL/worker browser flow for
  repeated exports at 375/768/1440, both locales/themes, exact downloads, CanJSON
  checksums, refresh and dismissal. These have not run yet.
- C drive has zero free space. The requested batch-specific E-drive test exception
  has not been answered. Do not write local test temporary files there without it.
  CI is available for the full suites and browser screenshots.
- Production remains f0e355a. No deployment or cleanup in this stage yet.

## Next steps

Finish static review, commit/push explicit task files, run the existing five CI
gates, inspect real browser evidence, and fix failures. Release only the verified
source using fresh source-bound helpers and the live production baseline. Keep
two verified backups, protect production data/configuration/PostgreSQL, and remove
only replaced image tags after acceptance. Do not clean local files or build images
locally/on the server. The broad optimization goal remains active.
