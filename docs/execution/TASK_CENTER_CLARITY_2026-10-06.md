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

Source **5f5126cbfbc78a69b9d4c22e3f20afa3c2f3c2ea** is committed and pushed.
[CI 37448984796](https://github.com/foolkking/chat-reader/actions/runs/37448984796)
was dispatched once for that exact source. API quality and Web quality have
completed successfully. Settings integration finished with **169 passed / 1 failed**;
the existing 768px Chinese maintenance regeneration case lost the accepted new
job while a background continuation poll unmounted its download control. Image
gates were skipped, so this source has no deployable artifact. Do not rerun it
unchanged. Production was independently rechecked and remains
healthy on f0e355a, with 15,886,852,096 available server bytes.

- First changed-file lint and TypeScript check passed. After adding tests, lint
  passed; the Corepack typecheck wrapper reported ENOSPC while saving its cache
  despite exit zero. This second command is not counted as clean verification.
  Direct Node invocation of the same TypeScript compiler with no incremental
  output subsequently passed; six changed Python files parsed successfully.
- Added real persisted API read/retry/source snapshot/ownership assertions and
  rendered group/focus regressions. Added a PostgreSQL/worker browser flow for
  repeated exports at 375/768/1440, both locales/themes, exact downloads, CanJSON
  checksums, refresh and dismissal; all three new Task Center cases passed.
- Exact-source CI API: **1003 passed / 3 skipped**, including the new presentation
  and persisted source/owner assertions. Runtime/Bundle **64**, cleanup **53**.
  Web baseline **135 passed / 318 gated skips**, with the new rendered partial
  grouping/focus case explicitly passed. Context **35**, authentication **18**,
  offline negatives **17**, lint/typecheck/build and other required Web gates pass.
  Suites overlap; skipped settings tests in the baseline are not passes.
- C drive has zero free space. The requested batch-specific E-drive test exception
  has not been answered. Do not write local test temporary files there without it.
  CI is available for the full suites and browser screenshots.
- Production remains f0e355a. No deployment or cleanup in this stage yet.

## Follow-up fixes awaiting exact-source CI

- Keep immutable delivery mounted during same-generation background polling.
  Bind an accepted regeneration to its owner before global query invalidations,
  including after the child unmounts following an option change. Preserve the
  original captured options and recheck account generation before global events.
- Fence retry/cancel/dismiss and disappeared-task callbacks by authentication
  generation so late successes cannot repopulate another account's cache.
- Screenshot inspection found completed exports showing 2 / 1: PostgreSQL progress
  reports use a separate session while terminal code reused a stale in-memory
  message count. Commit both single-export counters as one package and omit
  redundant single-item terminal counts in the UI.
- Add real delayed-response/polling/option-change and same-document account-switch
  regressions, plus persisted PostgreSQL and browser counter assertions. These
  follow-up runtime tests have not yet run. Direct no-output TypeScript and
  changed-file ESLint both passed after the edits; no local build/runtime test is
  claimed because C-drive temporary capacity is exhausted.
- Three screenshots under `docs/evidence/task-center-2026-10-06/` came from the
  successful new cases in failed run 37448984796, artifact 11406718713. They are
  **intermediate, pre-counter-fix evidence**, not final release screenshots.

## Next steps

Commit/push the follow-ups, run all five CI gates on that new source, inspect final
browser evidence and fix actual failures. Release only the verified source using
fresh source-bound helpers and the live production baseline. Keep two verified
backups, protect production data/configuration/PostgreSQL, and remove only replaced
image tags after acceptance. Do not clean local files or build images locally/on
the server. The broad optimization goal remains active.
