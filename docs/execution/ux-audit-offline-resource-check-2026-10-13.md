# Offline resource-check recovery — 2026-10-13

Scope: the existing Web offline-library sidebar's bulk-update resource check.
This source review precedes the product edit. Production remains 84988a2; this
batch is local only, with no new CI or deployment authorization.

## Finding OFFLINE-CHECK-01

Medium severity, observed in source, high confidence. `LibrarySidebar` initializes
`knownRevisions` to null, reads `usableOfflineRevisions(assetMode)`, and silently
discards rejection. Null also means “Checking offline resources” and disables
bulk update. An IndexedDB read rejection or offline-access invalidation can thus
leave that label indefinitely, until a dependency changes or the sidebar remounts.
The lower-level function reads conversations, inspects each copy, and asserts
offline access; it does not catch these failures. This is not evidence that a
particular user's stored files are corrupt or a measured production incident.

The existing active-effect flag already rejects completions after cleanup. Keep
that protection and also scope displayed results to the current asset mode and
conversation snapshot, so the render before effect cleanup cannot briefly offer
an update based on obsolete inspection results.

## Planned narrow repair

Distinguish checking, failed and ready. Failure gets a quiet inline explanation
and explicit “Retry resource check” in the existing sidebar action area. Retry
only repeats the existing inspection; it never queues downloads, invokes removal
of conversations or changes selection. The existing inspection can discard cached
responses whose sizes fail validation; that lower-level behavior is unchanged.
Disable bulk update until a successful current-scope result. No
automatic retry loop, new dependency, timer, schema or package-format change.

Before editing, run the actual compiled sidebar against a controlled rejected
inspection and record the missing recovery control. Then cover manual success,
repeated failure, mode/data changes and late completions. Hook scheduling and
storage are doubles, not browser IndexedDB/cache or layout acceptance.

The in-app browser could not reach the local service (`ERR_CONNECTION_REFUSED`).
The user explicitly asked to move on without logging in. No login or production
upload is needed for this local repair; real browser acceptance remains pending.

## Pre-edit reproduction

`library-shell.tsx` SHA-256 before repair:
`40095112fa5d10f35bdbdaf77f3125ae1f68d981ab81110bc63eee5a00169c0c`.
The new 10-case actual-component probe passed five existing behaviors and failed
five required recovery/scope behaviors: both localized failure states, repeated
failure recovery, asset-mode invalidation, and conversation-snapshot invalidation.
The separate 10 sharing checks passed. Combined baseline: 15 passed / 5 failed /
0 skipped, 1254.4147 ms. Raw output is retained in this task's temp directory as
`resource-check-baseline.log`; no private user data is included.

## Local result — 2026-10-14

Inspection now stores a terminal success/failure with its asset mode, conversation
snapshot and explicit retry attempt. Only a matching result can enable update.
Changing scope immediately returns to checking, and cleaned-up effects cannot
replace newer results. Failure offers localized inline feedback and manual
reinspection; existing downloaded rows and selection stay available. There is no
timer, new automatic retry or new network request from the retry action itself.

All 10 compiled-sidebar cases pass after repair; the adjacent share query has 10
passing focused cases. The complete 31-file Node suite passes **868 / 0 failed /
0 skipped** in 14889.644 ms. Web lint and nonincremental TypeScript pass. No new
Web build or API test run was needed for this scoped Web-only state repair.

Two new browser cases at 375/1440px inject an attachment-table read failure, retry
while failure persists, then recover. They check retained rows and no package
admission. Together with the modified sharing file, 26 cases are discovered and
zero executed. Their screenshots have not been produced or inspected. No browser
layout, real IndexedDB timing or memory/CPU result is claimed.

The [new checkpoint](ux-audit-offline-resource-check-2026-10-13-evidence/local-verification.json)
binds this batch's six source/test files and retained logs. It does not rewrite
historical ledgers. The notebook report's linked `local-verification.json` was
absent when checked; this record does not recreate or claim verification of that
missing predecessor. Earlier source changes and unrelated files are preserved.
The broad goal remains active; no commit, CI submission or deployment occurred.
