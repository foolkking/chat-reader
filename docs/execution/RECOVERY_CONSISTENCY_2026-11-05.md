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

## CI follow-up: guidance persistence before refresh

The user explicitly reported `web-quality` failed, so its result was inspected
on 2026-11-05 before the original scheduled first-check time. Exact source
`784286317f500f77ad75ae993266018414c91a25`, run `41962480064`, Web job
`127031825765`: lint, TypeScript, build and the earlier Web gates passed.
The Context-files gate had **35 passed / 1 failed**. Later Web gates were skipped;
other jobs were still running at the initial inspection. This is not full CI
acceptance, and the accepted base run does not cover this source.

The 768px guidance test timed out looking for the restore-maintenance action.
Its failure snapshot shows the guide open with that action absent. Source review
identified a concrete persistence race: the hint and query cache were dismissed
before the IndexedDB read-write transaction completed, while the fixture
immediately reloaded. Its subsequent negative hint assertion could also pass
while the setting was still loading. The snapshot does not by itself prove the
exact IndexedDB abort ordering; that gate had tracing disabled.

The bounded fix:
- publish the setting only after transaction settlement and cancel any older
  setting query before publishing;
- retain account-epoch checks across both asynchronous boundaries;
- hide a maintenance hint only after its save settles, while opening Current
  remains immediate;
- retain session-only dismissal if device storage fails, returning
  `persisted: false` rather than claiming durability;
- inspect the active account's actual IndexedDB row after UI completion, after
  reload and after restoring reminders. The assertion reads once, not a polling
  workaround for early completion, and does not create a missing database.

Nine deterministic regressions execute the production hook/component with a
controlled transaction-commit barrier and the real QueryClient cancellation:
commit acknowledgement, late reads, storage failure, account changes, delayed
dismissal and immediate Current navigation. They are included by the existing
`scripts/ux/*.test.mjs` CI gate. The existing browser mute/reload/restore flow,
real package checks, viewports, timeouts and assertions remain.

These new tests are **authored, not locally executed**. This repair uses static
review and `git diff --check`; browser/runtime verification belongs to the next
exact-source full CI. No skipped-test allowance, timeout increase, retry increase,
workflow-gate change, dependency change, migration or deployment is introduced.
The original buildinfo hash and prior untracked audit artifacts remain unchanged.

## CI follow-up: awaited sidebar entry and coherent pagination fixtures

The user explicitly reported the new `web-quality` failure, allowing immediate
inspection of **run `41965280758`, attempt 1**, exact source
`0c3ee4eb81a4cebcfd5a31be326bf6194d817364`, Web job `127040756283`.
The handoff's normal first-check threshold was not reused for another run.
Context files/export/recovery now passed **36/36**, including the preceding
guidance-persistence repair. The UX script gate passed **1,990/1,990**.
Source Editor/mutation had **115 passed / 2 failed**; later Web gates did not
execute. API and reading-performance comparison passed at inspection; settings
was still running. This failed candidate is not full-CI acceptance.

Exact failure logs and the uploaded Playwright snapshots identify:

- The 375px sidebar-rename fixture waited for Manage inside a drawer that was
  never open in the failure snapshot. Its one-shot localized-opener `count()`
  could silently skip the necessary click before that control was available.
  The snapshot does not prove which initial-render/locale ordering occurred.
  Reader sidebar entry now awaits the actual mobile header control; desktop
  entry first waits for either the real rail opener or expanded Tasks control.
  The same unsafe pattern in sibling Reader-recovery fixtures is removed.
  Exactly one visible sidebar and its Tasks control are required. Rename also
  verifies that the original Reader DOM and complete message count survive
  acknowledgement while refresh reads remain held.
- The mixed-type search fixture returned one item but declared `limit: 50`,
  `total: 2`, and omitted `has_more`. Under server-offset pagination that
  describes the last page, so the absent Load more button was correct. The
  fixture now declares its actual one-item page boundary and runs both explicit
  `has_more` and legacy omitted-field variants. Both require offsets `[0, 1]`,
  no final-page Load more, stable selected document after regrouping, and the
  actual Enter destination. The sparse-page same-query regression separately
  requires offsets `[0, 50, 0]`, preventing unique-item-count pagination.

Failure-only traces are retained for the two affected flows as well as the
existing sidebar-placement flow. No production behavior, workflow gate,
timeout, retry count, skip policy, dependency or migration is changed.
Regressions are authored and statically reviewed, **not locally executed**;
the next exact-source full CI owns runtime acceptance. No local API/Web/worker,
production operation, original ZIP replay or deployment is authorized.
The task handoff is archived and replaced on submission, with the next first
result check at least 50 minutes after verifying the new dispatch identity.

## CI follow-up: settle repeated annotation navigation before point sampling

Run **`41970074135`, attempt 1**, source
`0451733a2177551e469df502451f07aba784e52b`, was first read at
**2026-11-05 05:45:49.590Z**, after its **05:45:49.287Z** boundary.
API, settings and reading-performance comparison passed. Web job `127056001685`
failed focused online/security **44 passed / 1 failed**; image and artifact
inspection jobs were skipped. Context passed again; the preceding mutation
fixture repairs were **not reached** and are not accepted by this run.

The uploaded Playwright trace, not a guessed delay, identifies the failure:
the first annotation navigation settled, but clicking the same annotation again
started another local alignment without a new `reader-turn` request. The
fixture only checked that the block remained visible before sampling pointer
coordinates. Trace snapshots show `aligning` through the outside dismissal,
then `resolved` by the failed second text click. Both clicks used the same
coordinates while the locating banner disappeared and the text moved.

The fixture now requires the real `settled` stage and the existing **24px**
reading-line geometry bound after repeated navigation and before reopening the
actions menu. The quote-range point must hit the actual target block; no forced
click or synthetic application event is used. Outside-dismiss focus, Escape
source-anchor focus and the still-open workspace assertions remain; zero extra
locator requests is also checked after the entire interaction.

Only the fixture and current/history documentation change. No production
behavior, timeout, retry, skip or workflow gate is changed. Static review and
syntax/diff checks are local; no local application test/process runs. The next
exact-source dispatch receives a fresh identity-verified 50-minute first-read
boundary and must pass all jobs/artifact gates before acceptance. No deployment.

## CI follow-up: preserve search selection beneath a stationary pointer

Run **`41976927392`, attempt 1**, source
`82d637ddfde21eaa13820fc42eda0f59a455631f`, was first read at
**2026-11-05 06:44:29.240Z**, after **06:44:28.942Z**. API, settings and
performance passed; focused Web passed **45/45**, including the repaired
annotation interaction. Mutation had **117 passed / 1 failed**; the sidebar
rename and explicit pagination variant passed, but legacy pagination changed
the selected message into the newly prepended annotation. Later gates and
images/artifact inspection remain unaccepted.

The exact failed Web job `127077827630` supplies a failure-only trace.
It shows Load more clicked at `(784,590)`, a new annotation group inserted
under that position, and the selected href changing to that annotation while
the fixture moved the pointer away. The component selected on `mouseenter`,
which also arises when layout changes beneath an unmoved pointer. Stable
document identity in the parent cannot prevent that handler from overwriting
the user's prior selection.

Search result rows now change the active candidate on real mouse movement,
not boundary entry or zero-displacement movement. Normal link clicks and batch
selection are unchanged. A production-component regression covers regrouping,
zero movement and real horizontal/vertical movement. Both browser pagination
variants hold the second response, place the real pointer over the existing
result, then insert the new group beneath it without moving the pointer.
They require the original selected document, verify that the inserted link
actually occupies that point, then check a real one-pixel move can select it
and keyboard navigation/Enter still reaches the original message.

The previous offset/final-page, mixed-type grouping and destination assertions
are retained. No workflow, timeout, retry or skip change; no local application
tests/processes or deployment. These additions await the next exact-source
full CI under a fresh 50-minute identity-verified result-read boundary.

## CI follow-up: deferred confirmation cleanup respects newer field focus

Run **`41988369535`, attempt 1**, source
`a16e2c9ba34f0ab5c18cd18241c7008c58caab4a`, was first read at
**2026-11-05 08:26:08.145Z**, after **08:26:07.792Z**. API, settings and
performance passed. Both stationary-pointer pagination variants passed, but
mutation remained **117 passed / 1 failed**. Image/artifact jobs were skipped;
this failed run is not acceptance for the candidate.

Web job `127114427107` and its uploaded failure snapshot show that, after
cancelling the discard confirmation, filling the assistant field appended its
text to the already-filled user field. Tracing was disabled for that flow, so
the snapshot alone does not establish the exact scheduling order. Source review
finds a concrete race: the shared dialog hook defers returning focus to the
opener by a zero-delay timer. Its existing top-modal guard permits restoration
to the first field even after another field in that same remaining form has
taken focus. The two controlled text values and setters are otherwise separate.

The hook now preserves connected focus outside the closing root when it belongs
to the surviving top modal, or to the page if no modal remains. Body/document,
disconnected and still-closing focus continue to restore the opener/fallback.
The existing top-modal fence still prevents returning focus to the page beneath
another dialog.

Eight deterministic timer-barrier cases execute the actual shared hook through
the existing Share focus harness: another field in the surviving form, four
unowned/closing focus states, a newer page control, top-modal priority and a
removed opener's fallback. These adapters are not mounted React or a browser.
The existing six viewport/locale browser flows retain their exact field-value,
failed-save, retry and persistence assertions, add the assistant-focus check,
and retain failure-only traces. No wait is added before the problematic fill.

Local verification is syntax parsing, static review and diff/preservation checks
only; the new regressions are **not locally executed**. No test gate, action
timeout, retry/skip policy, dependency, migration or deployment changes.
Submission archives the old handoff and assigns the new exact source/run a
fresh first-check boundary at least 50 minutes after identity verification.

## CI follow-up: non-task blocks avoid unrelated task-handler invalidation

Run **`41998961573`, attempt 1**, exact source
`be72cedd71ee11b62d35f5a3d945711e9f618b31`, was first read at
**2026-11-05 09:51:26.531Z**, after **09:51:26.195Z**. API, Web and settings
passed. The exact-source Web summary reports **13/13 gates PASS**, including
mutation **118/118**, focused **45/45**, and Context **36/36**. The original
conditional test routing is unchanged; this is not a claim of zero conditional
skips in the default umbrella run.

The same-runner capacity job `127161334958` failed **8 passed / 1 failed**:
plain 10,000 messages, cold run index 1, longest task **197 ms** and cumulative
long tasks **314 ms**, against unchanged **150 / 250 ms** limits. That sample
retained monotonic wheel positions, 34 messages/51 blocks, no horizontal
overflow and 16.8-ms frame p95. The other two cold samples had no long task;
image/artifact inspection was skipped. No previous success replaces this run.

The probe reports 1,431 Markdown invocations in the failing cold run and 408
additional invocations on its warm revisit. Source review localizes an avoidable
invalidation chain: Reader host updates render MessageItem, which recreates the
task handler; BlockSlot passes that handler through even when its block has no
tasks. The existing BlockElement/BlockRenderer comparators consequently invalidate
ordinary prose and the newly allocated attachment inputs invalidate Markdown.
The old numeric telemetry is not a CPU profile and cannot establish whether
that particular 197-ms task was parsing, GC, layout or runner scheduling.

The bounded correction removes task callback/pending-state props at the existing
BlockSlot boundary only when the block has no task items. Current task handlers,
pending/checked state, task addition/removal, changed source/identity/highlights,
canonical block anchors and render data remain live. There is no new cache,
callback-ignoring comparator, changed window size, navigation or storage model.
Five deterministic regressions execute the actual slot/element bodies and memo
comparators, including 100 irrelevant callback updates and retained task updates.
They establish invalidation behavior, not browser CPU timing.

The capacity harness also writes the existing full measurement JSON into its
uploaded output path before assertions. The former body-only attachments were
absent from the downloaded artifact because only list/gate reporters run there;
the log still supplied the measurements above. Baseline and candidate use the
same harness. No threshold, fixture, wheel workload, repetition, trace policy,
retry/skip rule or workflow gate is relaxed.

Only static source review, syntax parsing and diff/preservation checks run
locally. The new exact-source CI must provide the after measurement and every
required job/artifact gate; the source fix alone is not performance acceptance.
The next dispatch receives its own identity-verified 50-minute boundary. No
local API/Web/worker/application test, production action or deployment.

## CI follow-up: saved support drafts and close guards share a commit

Run **`42008141724`, attempt 1**, source
`1faec643b9e1d5793364e3650adbebf85dd11ff7`, was first read at
**2026-11-05 10:58:10.834Z**, after **10:58:10.535Z**. API/Web/performance
passed. Capacity candidate passed **9/9**; the persisted plain-10k measurements
record 69 Markdown invocations in each cold run, zero warm-revisit delta, zero
long tasks and 16.7/16.8/16.7-ms frame p95. The preceding run had 1,431
invocations in its failed cold sample and 408 warm delta. Those run-to-run
observations support reduced invalidation, not a universal latency claim;
each workflow retains its own same-runner historical baseline.

Settings job `127180029622` failed **462 passed / 1 failed**. The contextual
import-limit flow saw “Draft saved on this device”, pressed Escape, then found
the expected return control blocked by an unsaved-changes confirmation.
Its snapshot/logs identify the incorrect dialog, but no trace was captured.
`useSupportDraft` publishes `saving=false` in a rendered status before its
passive effect updates the parent's dirty flag. Escape can therefore see a
stale close guard despite the completed local write.

The dirty-state callback now runs in the layout phase of that same commit,
before paint/input. Saving and error states still protect pending/failed writes;
the storage queue, version checks, exact retry payload and account fences are
unchanged. Five deterministic actual-hook regressions hold passive effects and
storage completion: pending protection, committed-save release, queued revisions,
failed save/explicit retry, and a replaced host callback.

The browser flow additionally reads its actual account-scoped draft row, requires
closing the request dialog without a discard prompt, and retains all selected-file,
request/approval, focus-return and explicit-only-upload assertions. Its own
context now retains a failure-only trace. There is no added sleep, forced click,
confirmation bypass or increased action timeout.

New cases remain **authored, not locally executed**. Static parsing/review and
diff/preservation checks precede the new commit; full exact-source CI remains the
acceptance authority under another fresh 50-minute dispatch boundary. The image
jobs skipped in the failed run do not count as accepted. No deployment.
