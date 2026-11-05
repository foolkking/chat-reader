# Recovery consistency implementation — 2026-11-05

## Scope and preservation

Approved follow-up to the two-round project audit; existing `master`, base
`46cb51845c100ba9a6e613de0e604405db0729c4`. The implementation checkpoint was
local only. The subsequent explicit “提交ci” request on 2026-11-05 authorizes
commit/push and exact-source CI on existing `master`, not deployment or production
operations. No new branch, source ZIP replay, dependency change or migration.
Original modified `apps/web/tsconfig.tsbuildinfo` and untracked audit/evidence
are preserved. Task-owned fixtures/logs use the AGENTS-mandated task temp root.

Accepted **base** CI `41918053083` passed all six required jobs; copied audit
receipt verifies the exact base SHA. This is not CI for the changes below and
does not change production `be58b12` / rollback `3b839dc` / schema 0058.
Current schema remains a single candidate head `20261105_0059`.

## Approved audit mapping

| ID | Implementation | Boundary |
| --- | --- | --- |
| REC-01 | 300-ms source-draft coalescing, undo-baseline retirement, close/hidden flush, ID+hash base and bounded read-only comparison | Legacy bases remain unverified; no automatic submit or hard-crash durability guarantee |
| SEARCH-01 | Local notebook/description wins over stale index; cleared fields and conflict notebooks handled; exact Library panel navigation | Existing v1/v2/v3 and Dexie v2 remain; unknown legacy data is retained |
| REC-02 | Source/draft states separated; list/detail agree; observed-timestamp preview rebuild queues existing worker and preserves mapping/group IDs | Explicit user action only; no automatic reupload, reanalysis or import commit |
| REC-03 | Preview/admission/worker capacity checks, ordered collection locks, actionable overflow; input parser no longer masks business errors | No raised limits, silent dropping, selective restore or merge policy |
| REC-04 | External account-epoch Share intent store and original-key check/retry; fingerprint/source/request guards on preview | Same-tab close/reopen only; full reload persistence intentionally not added; passwords memory-only |
| DATA-01 | Owner/key PostgreSQL serialization; key bound to normalized conversation/selection across statuses | Existing task retry and artifact regeneration retained; scanner rules unchanged |
| SEARCH-02 | New generation for explicit same-query refresh and confirmed batch changes; replace pages; server offset progression | No server snapshot cursor or automatic replay |
| REC-05 | Tags use existing collection recovery; retained create UUID, check/retry/conflict review, read retry and cache invalidation | No second write engine; original association draft retained for manual review, never force-applied |
| PERF-01 | Measure actual backfill, per-item durable cursor and bounded cooperative worker turns | No extra concurrency; not a production latency or throughput claim |
| DOC-01 | Source/accepted CI/production distinguished; feature inventory and current contract corrected | Historical audit/release records not rewritten |

Current behavior authority:
[consolidated contract](../system/COMPREHENSIVE_OPTIMIZATION_CONTRACT.md#recovery-consistency-follow-up).

## Measured backfill and draft behavior

Synthetic SQLite, 105 conversations, 1,500-character private descriptions,
actual `process_background_job`/`sync_personal_content`, this Windows machine:

| Snapshot | First worker turn | Indexed | State after turn |
| --- | --- | --- | --- |
| Before | 0.971 s | 105 | committed |
| After | 1.394 s | 100 | queued, durable cursor |

This fixture demonstrates **yielding and checkpointing**, not a speedup.
Per-item checkpoint overhead is visible; bounded fairness is the objective.
The two-second check happens only between items. A large notebook may exceed the
budget in one item; sustained PostgreSQL/real-library load remains unmeasured.
The regression resumes remaining items and checks 105 unique index documents,
terminal counts, and a single completed job.

The actual draft hook under deterministic lifecycle/storage adapters coalesces
100 text changes before the delay to one write, rather than the audit's 100.
Undo to the saved baseline leaves no own draft after close/reopen; hash changes
detect replace-current without requiring a new version ID. These are controlled
logic tests, not a browser timing claim.

## Verification and review

| Check | Result | Scope |
| --- | --- | --- |
| API full suite | 5,859 passed / 207 conditional skips / 4 warnings, 4,721.66 s | `pytest tests -q -p no:cacheprovider`; dedicated task basetemp, SQLite default; PostgreSQL-only cases separately exercised below |
| Final recovery regressions | 6 passed, 41.17 s | Actual import rebuild/expiry, capacity admission/receipt/errors, download identity, backfill yield and injected-failure checkpoint resume |
| PostgreSQL affected suites | 10 passed, 77.92 s | New concurrency tests plus existing personal archive jobs/restore and optimization migration, disposable PostgreSQL 17 |
| Final PostgreSQL recheck | 3 passed, 22.44 s | New concurrency cases and migration/backfill; subset of the 10 above, not 3 additional unique cases |
| UX/PWA Node tests | 1,992 passed / 0 skipped | All `scripts/ux/*.test.mjs` and `scripts/pwa/offline-shell.test.mjs`; final source after review |
| Web lint | Passed | `corepack pnpm run lint`, zero warnings |
| Web TypeScript | Passed | `corepack pnpm --filter web exec tsc --noEmit --incremental false`, preserves prior buildinfo |
| Production build | Passed | `corepack pnpm --filter web build`, loopback-only test API target |
| Alembic heads | `20261105_0059 (head)` | No new migration |
| Browser discovery | 6 tests listed | Discovery only, **not executed** |
| Diff / documentation links | Passed | `git diff --check`, changed documentation relative-path validation |
| Prior buildinfo preservation | Exact SHA-256 match | Original `FCC39CFD4093A15DC2CF9F8E80ACBE12E7A858FCAEB961EE2B47D8A08E960AFC` unchanged |

The long full-suite run began before final review adjustments; affected backend
cases were rerun afterward in the six-case recovery and three-case PostgreSQL
checks, rather than claiming the original process dynamically reloaded changes.
The four warnings are SQLite expression-index reflection limitations, not test
failures; PostgreSQL migration/constraint behavior has its separate evidence.
Conditional skips retain existing environment-specific requirements and do not
make the whole PostgreSQL/browser matrix accepted.

The first focused API run had a **test fixture** path error (91 passed / 1 failed):
the fixture attempted to unlink the portable storage URI rather than its resolved
task-owned source. It now resolves via the real source helper and verifies the
tmp-path boundary before deleting only that synthetic fixture.

The first combined UX/PWA Node run found four test integration failures:
three Share test adapters lacked the new real intent module; one legacy Library
test still asserted that notebook/description clicks should open only a generic
conversation. Adapters now load the real store; the navigation test asserts the
new intended panel and still checks that a late body result cannot take over.
All 50 directly affected checks passed after correction; gates were not weakened.

Review also corrected:
- saved-search capacity locking now acquires the tag lock even when the archive
  contains no tags, matching normal saved-search writes and preventing reversed
  lock order;
- a previously restored archive does not need room for its collections again;
- replaced canonical notebook identities retire old non-conflict index entries;
- a confirmed Share receipt removes its password from retained intent memory;
- retained tag conflicts preserve the requested association draft for comparison.
- same-query refresh preserves failed/unconfirmed batch identities but enables
  actions only for currently loaded conversations;
- a Share result check has a shared checking phase, preventing close/reopen from
  starting a competing check/retry; reopened unresolved requests display the
  retained original scope, not fresh default options.

## Browser and production acceptance

Starting the local Next Web server was rejected by execution policy. No alternate
launch path was used to bypass it. Browser checks are **not run / not accepted**,
including screenshots, responsive layout, real focus/keyboard behavior, actual
IndexedDB cold/reload flows and late-preview transport races. New browser cases
are assigned to the existing CI mutation gate, not a weaker substitute gate.

This candidate is not ready to claim full acceptance until the
Reader/Share/PWA browser gates execute against it. Original user ZIP, authenticated
production UI, real 47-conversation offline update and production restore remain
outside this task's execution.

## CI submission boundary

The submission preflight confirmed base `master` matches `origin/master` and
the original buildinfo hash is unchanged. Stage only this implementation and its
tests/documentation; preserve the original buildinfo and prior untracked audit
artifacts outside the commit. The workflow is manual-dispatch only.

Record the resulting exact commit/run in the task-owned CI handoff. The first
result check must wait at least 50 minutes after dispatch identity verification;
if a required gate fails, diagnose that exact run and resubmit fixes without
weakening gates. The previously paused CI monitor should follow this new handoff,
not the accepted base run. No deployment is authorized.
