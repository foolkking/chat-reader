# Final independent host / original five findings review — frozen handoff

## Outcome and scope
Current working-tree review: 49/49 tests passed, 0 failures, 0 skips, exit 0. The source manifest captured before/after hashes with zero changes during this run. This is not complete CI, live-source or production acceptance.

Only tests/reader-center-lifecycle.test.cjs was changed in this final review. The already-reviewed host.js and reader-host.test.cjs fixes were unchanged. No new branch, commit, push, network access, CI, deployment, agent, or PostgreSQL operation.

## Original five red reproductions, checked against current source
1. **Cancellation versus resume:** same per-item OPFS operation lock. The queued check re-reads the cancelled ledger; cancellation-first produces no POST and no iid. Upload-first cannot cancel an accepted receipt. A failed DELETE preserves the resumable package/binding. reader-host.test.cjs includes both deterministic schedules and a separate stale-check snapshot test.
2. **Cross-window cancellation:** two actual center controllers share simulated storage/locks; cancelling the second item during the first build leaves exactly one build/submission, no second receipt request or job. source-starting is pending; current plan is re-read when claiming each item.
3. **Cancelled/stale source ticket:** the real background handler accepts a matching fixed item and rejects cancelled/skipped items, changed owner/plan/source id/workspace/target. Existing current tests were re-run without editing their assertions.
4. **Cleanup snapshot race:** both startup and detached-device cleanup preserve a package sealed between an earlier snapshot and OPFS lock acquisition. Unowned unfinished directories are still removed. The current ledger is re-read inside reader-local-{key}.
5. **Per-page large parser cache:** the actual parser reprocessed 12 x 3 MiB pages; after GC no large parser buffers remained retained, versus 12 buffers / 37,750,096 bytes in the original failure evidence. Shared small-window and large-record-no-cache tests passed.

## Four added center safety tests
- Reading/selecting a source and refreshing destinations makes no sources/status request. Explicit Check saved references sends only selected ids, in source order, on the owned device; no unselected id/body/attachment payload is sent.
- Hold the first lookup response, change Reader device/user, then release it: old result is not displayed and the next old-account lookup is not sent.
- Remove the selected destination and refresh twice: selection remains unavailable, confirmation stays disabled; no fallback to unclassified and no new task/plan.
- Refresh after changing saved defaults/mappings and reordering/renaming project choices: preserve the currently reviewed per-project targets, attachment checkbox and remember checkbox.

## Reproducible evidence
Current run: final-regressions-01.log, exact command/UTC/HEAD/branch/hashes recorded.

node --test tests/reader-host.test.cjs tests/reader-center-lifecycle.test.cjs tests/reader-center-selection.test.cjs tests/reader-batch.test.cjs tests/reader-batch-ticket.test.cjs tests/reader-source-cache.test.cjs

Original failures are unchanged and retained:
- <TASK_EVIDENCE>\backend\extension-unresolved\reproductions-01.log (five bugs successfully reproduced; that exit 0 was NOT a passing safety gate).
- <TASK_EVIDENCE>\backend\host-p1-fixes\focused-red-02.log (12 pass / 4 failures / exit 1 against the old host).
- focused-red-01.log retained separately: one assertion was initially a VM cross-realm fixture error, not cancellation proof.

The main Edge report <TASK_EVIDENCE>\main\center-layout-J8tOY4\report.json was read only: 16 reported passes, no runtime errors, real Edge with synthetic directory/journal, not real accounts. This subagent did not rerun or claim that browser execution.

## Residual risks / unverified boundaries
- Host regressions execute actual host/upload code against simulated runtime, Web Locks, OPFS and HTTP. Native extension shutdown, browser kill/power-loss scheduling, real OPFS quota/IO failures, and actual ChatGPT account capture were not independently rerun here.
- GC retention checks prove removal of the reported per-page buffer cache. They do not establish a browser-wide RSS bound or guarantee no OOM for arbitrary single messages.
- Complete CI, actual API authorization across devices, release artifacts and deployment remain the main pipeline's gates. No new blocker was found within these five original cases and the four requested center boundaries.

## Frozen owned-file hashes
- `<EXTENSION_REPO>\reader\host.js` SHA-256 `BB2E16C10152C96B09E78139E1C11C68EA01E10806E067A01190A7A2F488B7F1`
- `<EXTENSION_REPO>\tests\reader-host.test.cjs` SHA-256 `B1447764CB658DF011957E597E23E482BB338538ECC789CB0773C70357903D3D`
- `<EXTENSION_REPO>\tests\reader-center-lifecycle.test.cjs` SHA-256 `3BF6445C3FF410DA87FBB0C758154A4092A4B6003946C5DC0C0D82C364B0719F`
`nVerified UTC: 11/25/2026 10:10:48; HEAD: be5e8dabd772809635db345a51c8c15c26b468ed; branch: codex/reader-extension; diff-check exit: 0
