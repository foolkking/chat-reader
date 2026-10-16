# Task status recovery review — 2026-10-14

Web app, ordinary users tracking existing background tasks. This is a source
review on production base 84988a2 plus preserved local upload-recovery edits.
No browser was reached, no production action is authorized, and no new CI or
deployment is planned. This report precedes the product edit.

## Findings and priority

### ERR-TASK-01 · Failed final-result lookup mutates the task query's data

Error recovery / data consistency; High; Observed (code), browser consequence
inferred; M. Location: `import-task-monitor.tsx:136–172`.

The completion effect assigns `previousTasks.current = current`, where `current`
is `tasksQuery.data`. When an absent task's final GET fails, the catch calls
`previousTasks.current.push(task)`. This changes the query-owned result array
without `setQueryData`, inserting a previous processing row into the latest
server response. It conflates last-known work with a fresh list and can leave
other observers using silently mutated data.

The person should be able to check that task's result without submitting it
again. Keep unresolved final reads separately from the query cache, retry their
read-only GETs explicitly even when the list is structurally unchanged, and
retire them only after confirmed resolution. Deduplicate concurrent checks,
fence old-account/unmounted callbacks, preserve terminal-result handling.

### FBK-TASK-01 · Cached results are presented as current progress during failure

Feedback / stale states; Medium; Observed (code), rendering inferred; S.
Locations: `import-task-monitor.tsx:202–251` and
`continuation-panel.tsx:173`.

With cached data and a failed list read, compact task summaries still show the
cached percentage and spinning activity icon. A cached empty task/scans list can
render “no active tasks” despite the read failure. The center status says
“existing tasks continue running”, and the package status says “the upload task
is still running in the background”. Neither is proved by a failed GET: the task
may already have completed, failed or been cancelled.

Preserve last-known rows, describe their age and unknown latest state, suppress
false live progress/empty confirmation, and retain a read-only refresh. Do not
introduce frequent notifications or new background polling. Existing admitted
work and its confirmed terminal receipts stay intact.

## What's working and left alone

The monitor already distinguishes task types, retained failures, cancellation
and successful completion. Its mutations are user-triggered, and terminal
callbacks have authentication-generation guards. Keep these, the current
visual tokens, the single worker, and original retry/polling budgets.

The Context task query already stops polling after a confirmed terminal state.
Do not turn a later read failure into a claim that a confirmed completion failed.

## Verification plan and boundaries

Compile the actual monitor with installed QueryObserver and controlled transport,
hooks and events. Reproduce query-array mutation and stale empty/summary states.
Then test independent final GET retry, multiple unresolved tasks, in-flight
deduplication, known completion, repeat failure, account change and unmount.
These doubles are not browser lifecycle, network timing or visual acceptance.

Review the package-status JSX with controlled query results; do not resubmit
uploads. Add local browser regressions where the existing synthetic fixtures
allow; discovery is not execution. Keep exact pre/post evidence beside this report.

## Pre-edit reproduction

The actual compiled monitor and QueryObserver probe produced **1 passed / 8
failed / 0 skipped**, 862.1603 ms. It reproduced insertion of the prior processing
task into the query-owned empty array, and only one final GET despite the explicit
Retry (expected two). Both compact placements displayed `Import conversations ·
42%` after a failed read. Both cached-empty query failures and both localized
overconfident messages failed their assertions. The existing old-account result
guard passed.

Pre-edit SHA-256: monitor
`87e5af6eafbbe13a2babe7fadcfb7a5e429538f265afd9ce4f809c99453da116`;
package panel `3bc65c90008a89236d2c825a0f0f002cc73fa49ab52af65739d4dc9c484146b6`.
This confirms the callback/cache behavior, not production frequency or rendering.

## Local repair and verification

Final-result checks now have a separate authentication-scoped, mounted-monitor
owner. The previous snapshot is a copied array, never mutable query storage.
Unresolved IDs survive failed reads in that owner; explicit Retry schedules their
GETs even if the active list is unchanged or still unavailable. In-flight reads
are deduplicated. A confirmed terminal result retires its pending entry; a
nonterminal result remains pending rather than inventing completion. Confirmed
list results retire older lookups. Existing completion handling/reader refresh
remains deduplicated, and old-owner/unmounted callbacks cannot publish feedback.

Cached errors suppress live compact percentages/spinners and false empty
confirmation. The center keeps previous rows with a quiet last-known-state notice
and an explicit read retry. Initial load failures and unconfirmed final results
retain actionable error states. Package feedback no longer promises continued
execution; a confirmed committed/failed/cancelled receipt remains visible and
still stops polling.

The first repair passed nine focused checks. An expanded run then exposed an
independence gap while the active list itself remained failed (20 passed/1
failed, 924.5887 ms); that guard was corrected. Final focused result: **22 passed /
0 failed / 0 skipped**, 877.9391 ms. The complete **32-file/890-case** script suite
passes with zero failures/skips, 13923.8549 ms. Lint and nonincremental types pass.

Two synthetic browser cases at 375/1440px assert independent final GET retry,
retired stale rows and zero task mutation. The three affected task/context files
discover 24 cases; zero executed. No screenshots were created/inspected. The new
owner is intentionally in-memory per mounted monitor, not durable task history.
No actual React/browser lifecycle, focus, device CPU/RSS or production timing
measurement is claimed.

Original pre-edit and intermediate/final logs are retained in the adjacent evidence
directory, including the failed expanded probe. The [final checkpoint](ux-audit-task-status-recovery-2026-10-14-evidence/local-verification.json) binds this
batch's files on top of the preceding offline/share checkpoint, without rewriting
that ledger. API, worker, migrations and existing polling/retry intervals are
unchanged. No new build, API run, commit, CI or deployment was performed.
