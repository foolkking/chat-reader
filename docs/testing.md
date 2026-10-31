# Testing

## Reading reliability — 2026-10-31 (candidate, CI only)

No local gates run for this batch. First CI `41098242354` was read after the
50-minute threshold: settings 463 plus independent restore 1 passed; API
fixture setup and the Web stale-auth route race failed. Fresh-source runs and
their permitted first-read times are tracked in the implementation record.

The additive `reading-performance.yml` comparison runs baseline `43a714f`
then candidate on the same disposable runner with the same harness. It retains
47/470 catalog SQL measurements and 398/1,000/10,000 Reader tiers, three cold
runs plus warm revisit, across plain/math/mixed bodies. Both phases are
collected if a capacity assertion fails, but either failure fails the gate;
images require this gate in addition to the existing API/Web/settings gates.
Frame p95 34 ms, maximum long task 150 ms, total long tasks 250 ms and stricter
far-target mounted-DOM budgets are unchanged. The attempt-3 artifact and its
bounded interpretation are recorded below; source changes alone are not treated
as measurements.

Run `41119273117` passed the full API (5,966 / three skipped), but failed Web,
settings (462 / one failure) and capacity. Its version-1 capacity receipt is
retained as a failure, not retrospectively relabeled. The next identical
baseline/candidate harness uses measurement version 2: no per-action DOM
trace/screencast, one pointer setup before the timed wheel window, disconnected
observers/cancelled RAF at its end, and explicit duration/frame/request counts.
It no longer discards >=1-second frames. Fixture, three cold runs, warm revisit,
30 x 120px wheels, 34ms sample delay, readiness and all budgets remain unchanged.
Version-1 and version-2 timings are different protocols, not direct product
speedup evidence; same-runner version-2 baseline/candidate is required.
Other correctness/browser gates retain their diagnostic tracing.

Regressions cover six repaired Context pairs in a 47-conversation v3 package,
actual read/export/offline after isolated archive restoration (also PostgreSQL),
unsafe/truncated audit classification, attachment/Context preflight errors,
bounded private collection summaries, equal-sized distinct assets and one-query
account tag mapping. Browser coverage includes 375/1440 collection/focus states,
orphan review-only links, body identity/geometry, hidden navigation reads,
hover/drag/scrollbar boundaries, keyboard ownership and lost-response recovery.
Synthetic CI package/restore acceptance is not production download acceptance.
Additional source tests execute index-window coverage/recentering and bounded
catalog-read retry/account fences. The first-copy browser flow now injects a
transient pre-admission catalog 500 as well as its existing worker failure,
retaining exactly-one-admission, no false retained-copy and explicit rebuild
assertions. Package admission itself is never automatically replayed.

Run `41128941676` attempt 1 was first read at **06:00:46 +08** after dispatch
at 05:10 +08. API/settings passed, Web cleanup failed **4/6** because the
shared helper waited for a Task summary hidden in the default-collapsed Reader
sidebar; the performance job was not started due to account billing/spending
limits. Attempt 2 had zero steps. Attempt 3 completed the full API
(**5,966 / three skipped**), settings (**463 plus independent restore 1**),
Web **1,899 UX / 110 mutation**, and the performance comparison. Both v2
capacity phases passed **9/9**; catalog SQL counts were baseline **283/2,821**
and candidate **7/7** for 47/470 synthetic conversations. The synthetic
SQLite timings are retained in the implementation record and are not production
PostgreSQL latency. The Web cleanup gate still failed **4/6** on the same old
helper; later PWA/auth gates did not run, and image/artifact jobs were skipped.

`978080e` changes the shared helper to explicitly reveal the actual sidebar
before opening Task Center, preserving the existing cleanup review and
mutation/range assertions. `09f820c` sets an explicit expanded preference only
for the workspace soft-navigation test, preserving same-node and
single-document assertions; default-collapsed coverage remains separate.
Run `41183167236` on `53d0e22` subsequently passed Web cleanup **6/6** and
soft-navigation, but failed the full run. API passed; settings had **436
passes / 27 mobile failures** at the shared helper, whose floating summary
was obscured by the mobile drawer. Default PWA had **178 passes / two timed
out / 760 conditional skips**: the annotation Type combobox existed in its
snapshot, but the exact `getByLabel` did not resolve it. Capacity baseline
passed **6/9**, candidate **8/9**; failures were 120px scroll reversals, not
performance thresholds. Both failures remain failures; the prior 9/9 receipt
does not override them.

`0bd8de6` chooses the actual sidebar Tasks entry (opening mobile/desktop
navigation only if needed), locates inbox filters by accessible combobox role,
waits for an existing saved-position restore before an intentional benchmark
reset, and records bounded reversal context. Warm setup waits for an existing
edge transition to finish. The actual 30-wheel timing window and every numeric
budget/assertion remain unchanged. This is a diagnostic correction, not proof
that all reversal causes are fixed. Standalone run `41192399714` was dispatched
on this exact SHA on the existing master.

The latest artifact now includes reading-list, 375/1440 annotation and focus
screenshots. Its mobile inbox screenshot shows a real squeezed keyword field;
the follow-up shared layout gives search its own narrow-screen row and tests
actual editing/submission plus a readable input width. Screenshot existence is
not final-source visual acceptance. Inspection also catches an empty desktop
aside covering the real 375px focus sheet; its follow-up keeps desktop panels
closed in compact mode, adds the sheet's visible close header and requires
real index-row hit testing plus close/focus recovery. The full workflow
`41193214379` dispatched at 18:33:09 +08 covers `0f5c78a`, before that focus
correction, and is not a final-source receipt. Later auth/negative gates, full production
47-conversation offline generation/download and a coherent post-repair backup
remain outstanding. No local gate or alternate-runner workaround was used.

## Current accepted release — 2026-10-30

Exact `127eae589ae3f9703d9a3dbf9bbf04a4f2a178d5` passed all five jobs in
full CI `41041436271`, attempt 1. Dispatch **10:31:58Z**, first result read
**11:22:04Z**, final green **11:28:27Z**; the 50-minute gate was respected.
API: **5,937 passed / 3 skipped**. Settings: **463 plus independent restore 1**.
Web: **1,875/1,875 UX**, feature browsers 9, default PWA 174 and all other
required browser/security gates passed. No failure gate, assertion or timeout
was weakened. Notebook/cleanup/mobile CI debugging ran no local gates.
The earlier inventory-only correction did run one local inventory regression;
the initial feature implementation's local checks remain recorded below.

Official artifact `12974040048` independently passed 35 blobs, 23 layers,
351 embedded API files, compiled Web revision and forbidden-path checks.
Production acceptance at **11:52:12Z** and independent recheck **11:53:11Z**
passed health, exact images, HTTPS/privacy/denials, 50 page-method probes,
unchanged PostgreSQL/config/canonical migration counts and zero new OOM/errors.
The new five-component backup was independently rehashed, not restore-drilled.
Authenticated production UI, physical clipboard, sustained load and the
original offline-download network trace remain unclaimed.

## Historical completion follow-up — 2026-10-30 (pre-release checkpoints)

New focused API tests cover no-side-effect scoped previews, frozen source edits
and deletes, snapshot locator/scope/revoke/expiry/reclamation, unsupported options
and attachments, explicit identity baselines including 1,000-row boundaries,
private normalized tags, offline tag projection/revision and title lookup scope.
Reader Escape tests now inject the new utility callback into the real-handler
harness and cover tags/updates plus IME; no guard or assertion was removed.
Comparison browser fixtures now return genuine paged index/TOC contracts rather
than conversation details for those endpoints. The initial run had 7 passes and
2 fixture-shape failures; it is not counted as a pass. Final results and fresh CI
receipts belong in the implementation record. Earlier successful CI below only
certifies `0d1efac`, not the new 0057/0058 source.

Final local follow-up: lint, typecheck and production build passed; UX tests
passed **1,865/1,865**; `web-opportunity-features.spec.ts` passed **9/9**
(including independent 375/1440px comparison panes). The focused API selection
passed **84 with 4 conditional skips** in 158.24 seconds; Alembic has one head,
`20261030_0058`. These focused checks do not replace full PostgreSQL/PWA CI.
The pre-existing buildinfo was restored byte-for-byte and remains excluded.

Full follow-up CI `41014403002` for `a87bf96` failed its mounted Viewer/mobile
sheet gate: the real Reader effect referenced new utility states/callbacks that
the browser harness had not supplied. The component never mounted, so
`#open-files` timed out. Supply those explicit synthetic dependencies; retain
all existing Viewer, focus, Escape, touch and identity assertions. This is a
test-adapter correction, not a passing CI receipt. The user reported the failure
before the 50-minute deadline and requested continuation, so failure diagnosis
was read early; subsequent dispatches still retain the 50-minute gate.

The same run also failed settings email-change recovery (462 passed, 1 failed):
the API logged `email_changed` and then returned 401 for that confirmation.
Session/principal/user were read separately and could straddle a credential
commit, falsely rejecting or revoking the retained session. A joined,
identity-refreshing snapshot preserves all security checks. Two deterministic
PostgreSQL event-barrier cases commit a real email change at the former split
read boundaries and require one coherent read, current-session survival and
other-session revocation. This fix is not locally executed for CI debugging;
the existing full API and real SMTP/browser gates must certify the new source.

CI `41020776603` passed the coherent-authentication API and settings gates.
After registering the comparison feature's test owner, `41026649429` passed
Web and API but settings returned 461 passes / two failures. Notebook save
can silently stop when a read fence changes while local draft storage drains;
both fences now retain the draft and explain the unfulfilled save. No write
is replayed when reads recover. Cleanup's old raw IndexedDB inspection could
recreate a database deleted after listing, then throw outside its promise.
It now aborts creation and rejects blocked, failed or unsettled reads, closing
late connections. Deterministic helper regressions and retained synthetic
failure traces improve diagnosis; cleanup assertions/timeouts are unchanged.
The old evidence does not identify the exact timeout stage, so cleanup is not
claimed fixed before fresh CI.

Run `41034600829` passed Web/API and the prior notebook/cleanup cases, with
462 settings passes / one failure waiting for mobile Settings after reload.
Cached Library HTML initially shows a sidebar, but its deep-link passive
effect can close it after a visibility check. Apply that same state transition
in layout and wait for the actual applied destination before opening settings.
Deterministic tests execute the real effect and preserve no-query behavior;
the original first-copy/rebuild/content assertions and timeouts are unchanged.
Readiness starts false for both cached no-query HTML and deep-link hydration,
then records the applied request in layout; it is not derived from the URL on
the initial render. This avoids introducing an attribute hydration mismatch.

## Fifth full CI and accepted deployment — 2026-10-30

Exact `0d1efacaa8145dff0c8c70ceda82460af5883854` passed all five jobs in
`40992509041`, attempt 1. It was dispatched at **02:34:47Z**, first read at
**03:24:47Z** after the required 50-minute wait, and all five jobs were green
by **03:36:35Z**. API passed **5,924 / 3 skipped**; settings **463 plus one
independent restore**; Web passed **1,863/1,863 UX** and all adaptive/CSP/
Context/focused/Share/mutation/cleanup/upload/Markdown/PDF/default-PWA/auth/
negative gates. The image and independent artifact jobs also passed.

Artifact `12952232763` matched its GitHub digest; ZIP SHA-256 is
`1aced2fef34f87d9886a34c8445bf3fe4267474edc24416aa7392322734d0730`.
Independent artifact checks passed 35 blobs, 23 layers, 346 embedded API files,
exact Web revision and forbidden-path checks. Production acceptance completed at
**04:01:19Z** after maintenance **03:51:39–04:01:19Z**. The new backup
`chat-reader-20261030T035153Z` was independently rehashed; schema stayed at
`20261030_0056`, with current/direct rollback `0d1efac`/`f8a6a06` and older
protected set `b4effda`.

The independent recheck at **04:35:55Z** passed health, exact images, release
state, PostgreSQL/config/Nginx invariants, HTTPS/denial/privacy, 50 page-method
probes, zero startup error keywords and zero new OOM. This does not claim
authenticated production UI, physical clipboard, sustained load or restore-drill
acceptance. The previous failed replacement and its recovery remain historical.

## Two-round Web features — 2026-10-30 local integration

The [implementation record](execution/WEB_FEATURE_OPPORTUNITIES_IMPLEMENTATION_2026-10-30.md)
separates 19 bounded source implementations from five unimplemented contract
items. Earlier in this task, complete Web lint/typecheck/build passed; the
full explicit `scripts/ux/*.test.mjs` list passed **1,853/1,853**, the Reader
location/folding/queue browser file **8/8**, example plus feature inventory
**3/3**, and offline lease tests **6/6**. Test adapters were updated to inject
new production dependencies rather than ignoring the callbacks under test.

Final review then corrected unread-on-add, inaccessible/failed reading-list
reads, continuation beyond 20 entries, collection limits and concurrent
membership, account-isolated queue keys and safe return URLs, deterministic
lineage pagination, transient lookup recovery and Quick Actions focus/IME/
keyboard behavior. Final reruns are recorded below; the earlier counts are not evidence
for these later changes. New PostgreSQL tests use explicitly selected disposable
databases, including different-ID duplicate additions and the final capacity slot.
Schema head is `20261030_0056`; complete PostgreSQL, full PWA and artifact gates
were certified by exact-source CI `40992509041`, followed by production acceptance.

One attempted local `test:pwa` run lacked `APP_ENV=test` and backend services:
its authentication/proxy failures caused interruption, not product acceptance.
Mocked browser runs explicitly set test mode and do not replace real-service CI.
No authenticated production UI, physical clipboard, target spreadsheet, load
test or original user's offline network trace is claimed; production deployment
acceptance is owned by the release record above.
The user requires waiting 50 minutes after each CI dispatch before inspecting
that run; failure diagnosis is followed by a fresh exact-source run and wait.

Final local receipts:

| Gate | Result / boundary |
| --- | --- |
| Web lint / typecheck / production build | Passed after the final UI corrections. Original pre-task buildinfo restored, SHA-256 `210FF4B7E3E63D0CD5301321AE8CC4EA095F21DA14692C6A4A4B59D05120F5D7`; excluded from submission. |
| All explicit UX Node files | **1,856 passed**, no failures/skips; includes real version-diff bounds, account queue keys and safe return route validation. |
| Reader location + opportunity flows + inventory Playwright | **15 passed**, including two helper checks and one inventory check; 12 mounted mock-backed cases cover 375/1440px example, no writes, TSV denial, real CSV download, keyboard/focus, unread-on-add, 21st item, search return and folding. |
| User feature entries / offline transfer leases / split API files | **21 passed**, including final headers-to-open cleanup assertion and owner/collection/capacity/membership checks. |
| Duplicate review API file | **2 passed** after moving group pagination/counts into SQL. |
| Alembic heads | Sole head **`20261030_0056`**; this is not production migration evidence. |
| Full local API (earlier collected source) | **5,724 passed / 192 conditional skips / 2 failed**, 4,772.10 seconds. Module-import-time lease-test clocks expired before execution; fixed to per-case clocks and focused files reran successfully. Not a full final-source pass. |
| New PostgreSQL concurrency / full real-service PWA / CI | Certified in exact-source CI `40992509041`; local-only rows above remain local evidence. |

First full CI `40956346174`, exact `bb5d4f4`, was first read at
2026-10-30 06:06:22 +08:00 after its 50-minute gate. API **5,924 passed /
3 skipped**; Web focused-online **44 passed / one failed** and settings
**462 passed / one failed**. Remaining Web gates, independent settings restore
and images did not pass. No deployment followed.
The old table source assertion now follows the real wrapper/scroller chain.
A mounted mock-backed project case reproduced duplicate merge portals caused by
colliding sibling React keys for New/Merge dialogs. Distinct project-scoped
keys fix the product; the strengthened regression rejects duplicate dialogs,
checks exactly two titles, keyboard reordering, retained title, complete close
and reopening. Final fix validation: lint/build/TypeScript, **1,856 UX** and
**19 Playwright** (two helper, three source/inventory, 14 mounted flows) passed.
The real authenticated matrix must pass again in a fresh complete CI run.

Second full CI `40965493242`, exact `b6fe9c3`, was first read at
2026-10-30 07:13:32 +08:00 after its wait gate. API and settings passed;
Web Release H Source Editor/mutation failed four recovery tests because they
selected a `p` although the focused result notice is a `div[role=status]`, and
one 375px project-sort case because an ancestor sticky header's `backdrop-filter`
made the fixed menu out-of-viewport. Other Web stages and images did not pass.
The test now follows the actual notice element; the mobile translucent header
uses an isolated decorative blur layer, preserving a viewport-positioned menu.
The focused regression checks mobile menu viewport, Escape restoration and
trigger focus. Post-fix build, lint, **1,856 UX** and **19 Playwright** pass.
The next full CI `40973535996`, exact `75177a0`, was first read at
2026-10-30 08:20:03 +08:00 after its 50-minute gate. API and settings passed;
Web had 170 passed and one failure in `task-center-dismissal.spec.ts`: the test
incorrectly required the sort trigger to reclaim focus after an outside pointer
click. The component intentionally leaves focus to that clicked target and only
restores the trigger for Escape. The test now clicks the sidebar search input
and asserts it retains focus, then separately asserts Escape restoration.
Focused Playwright **1/1** and file lint pass. The complete local file attempt
had 21 passes and 12 preference-persistence failures because the local API was
not running; these are not product acceptance. A fresh exact-source complete CI
and 50-minute wait are required; no deployment occurred.

## Two-round Web feature batch 1 — 2026-10-30 (local source checks)

The [implementation record](execution/WEB_FEATURE_OPPORTUNITIES_IMPLEMENTATION_2026-10-30.md)
tracks all 24 candidates plus the reported offline-package download failure.
This batch covers WEB-15/17/18/24 only. `node --test
scripts/ux/web-opportunity-primitives.test.mjs` passed all five cases for source
citation formatting/private target, HAST table extraction and bounded TSV/CSV,
formula-text handling, and explicit pasted Markdown file creation. Full Web
lint and typecheck passed. The pre-existing `apps/web/tsconfig.tsbuildinfo` was
backed up and restored with the same SHA256.

These checks do not exercise the rendered controls, authenticated import API,
physical clipboard, CSV download, 375/1440px layout, or prove the example makes
zero runtime writes. No Web build, Playwright/PWA, API/PostgreSQL, CI, commit,
or deployment has run yet. Do not treat this source batch as acceptance.

## Next-batch project, batch and split — 2026-10-29 source-only

The [implementation record](execution/UX_NEXT_BATCH_IMPLEMENTATION_2026-10-29.md)
maps all 15 findings to source and regression artifacts. No tests or commands in
this section were executed for this batch; the user prohibited local validation,
CI dispatch, commit and deployment.

Authored Node cases cover:

- `scripts/ux/batch-selection-progress.test.mjs`: definite 4xx versus unknown
  outcomes, four in-flight requests, stop admission, progress conservation.
- `scripts/ux/batch-action-recovery.test.mjs`: export 4,999/5,000/5,001
  boundaries and preservation of a pending safe retry key; list-owned
  read-only current-state checks and retired scope/account work; explicit,
  frozen, rapid-repeat-safe bulk move confirmation.
- `scripts/ux/project-recovery.test.mjs`: 499/500/501 ordering boundary,
  partial 500-item scope, actual query-option pagination to item 5,001,
  continuation retry and empty project state.
- `scripts/ux/sidebar-read-recovery.test.mjs`: project and Unclassified sidebar
  query pagination, continuation failure retention, no false tail and item 5,001.
- `scripts/ux/conversation-placement-recovery.test.mjs`: page-shaped caches
  across loaded pages, preserving offsets and not manufacturing target rows.
- Existing conversation-list, merge-reentry and archived-project recovery
  sources were adapted to the new cache/outcome contracts.

Authored API cases cover same-key replay, request mismatch, distinct new keys,
no-key legacy compatibility and persisted row counts in
`apps/api/tests/test_split_merge_api.py`. The opt-in
`apps/api/tests/test_split_receipts_postgres.py` adds a real PostgreSQL
same-key concurrency barrier, owner rejection, conflict, schema upgrade from
0053 and downgrade row-preservation check. It was not run.

The two 375/1440px flows in
`apps/web/e2e/ux-recovery-followup.spec.ts` exercise real server commits followed
by dropped acknowledgements, separate empty/failed project reads, check-read
failure/recovery, split same-key replay, parent selection reset, reverse range
validation, focus wrapping/restore, project-scoped empty create/import, mobile
sort and outside-pointer focus. They are authored, not browser evidence. No
React mount, Node/Python test, pytest, lint, typecheck, build, Alembic command,
browser, service or database was run.

Required next acceptance remains full unchanged CI, including API/PostgreSQL,
single Alembic head, Web UX and mutation/PWA/browser flows, followed only with
separate release authorization by exact artifact, fresh stopped-writer backup,
migration compatibility and deployment gates. Do not treat test discovery or
these authored cases as passes; do not downgrade 0054 automatically.

## Search/recovery release CI correction — 2026-10-28

The [release record](execution/SEARCH_RECOVERY_RELEASE_2026-10-28.md) owns the
current execution evidence; source-only sections below preserve their earlier
checkpoints. Exact `56fa45c` run `40656487189` passed API/settings quality but
failed six recovery browser cases after 94 passes in the source-editor/mutation
step. The old UI mocks intercepted `limit=5000`, not the current paged list's
`limit=101&offset=0`. Corrected interceptors explicitly check status/scope and
first-page boundaries; initial primary/existence hit assertions prevent silent
fixture bypass. All retained-node/focus, held Retry, selection, no-write and
Archive-destination requirements remain. No local tests/build/browser/service
commands validate this correction; require the unchanged complete CI and
release gates. Official quality evidence is not a deployable image artifact.

Run `40666671235` (exact `1dcd9f9`) was first read at **2026-10-28
18:43:47 Beijing**, after its 18:35:02 gate. Settings passed. API had
5,826 passes / 75 failures / three skips; the failing synthetic imports were
rejected by memory admission. The shared `test_import_preview_api.py` client
now controls only `uploads.available_memory_bytes`, following the existing
streaming/analysis fixtures. Admission, production thresholds, core host/cgroup
probe tests and explicit pressure overrides stay intact. New parameterized
HTTP regressions require zero/unknown memory to reject commit without canonical
writes or source changes, then accept the same retained import after the scoped
override ends. This does not measure runner memory or certify resource usage.

Web's Context step had 34 passes / one failure. Verified official quality
evidence shows `Replaced` together with `Discard unsaved changes?`; the child
and aggregate dirty notifications previously crossed passive-effect commits.
Personal/system Skill aggregates now publish in layout effects. Browser
regressions require immediate Escape after confirmed success (including lost
response recovery), immediate protection of a selected unsaved replacement,
and retention of a separate unsaved upload after another file is saved.
These additions are authored, not locally executed; no sleeps, forced clicks,
discard-on-success workaround, timeout or retry changes are introduced.
The earlier six list-interceptor fixes were not reached in this run and remain
unaccepted. Require a new complete exact-source CI and all release gates.

Run `40676535658` (exact `d1b8965`) was first read at **2026-10-28
20:34:38 Beijing**, after its 19:50:17 gate. API/settings passed. Web's Context
matrix passed 36 and source-editor/mutation matrix passed 100, including the
previous six list fixes. Default PWA had 157 passes / four failures / 750
conditional skips. The failed count assertion still expected `1 results`;
the actual panel correctly disclosed `1 of 1 results loaded · 1 locations`.
Its replacement asserts the complete loaded/total/location text, retaining
the 300 decoys, scoped role and title/type exclusion checks.

The other three failures reported `target-not-aligned`. Verified official
trace evidence shows a six-message offline window clamped at its lower scroll
boundary and a single-message fallback page with no scrollable height.
`reader-navigation.ts` now also accepts an actually clamped endpoint only
when the selected element/Range anchor remains visible below scroll padding.
Normal 24px alignment, three consecutive frames / 240ms, cancellation,
timeouts, stale fallback disclosure and no false exact pulse are retained.
The boundary is re-evaluated each frame if content grows.
`reader-navigation-alignment.test.mjs` authors 12 cases against the actual
navigation module with controlled DOM/Range/RAF/resize adapters: interior
alignment, Reader/window upper and lower boundaries, offscreen/occluded/
stalled/zero-height failures, growth, missing-range fallback and cancellation.
It does not validate mounted browser geometry or the text-range resolver.
The stale-version browser case additionally requires its short Reader to be
visible, non-scrollable and at scroll zero. Existing offline body/file/
annotation, repeat-navigation/same-DOM, URL and pulse assertions remain.
These corrections are **not run locally**; the unchanged complete CI and
all release gates remain required. Auth/negative browser steps were not
reached and the failed run produced no deployable image artifact.

Run `40692514416` (exact `4402635`, attempt 1) was first read at
**2026-10-28 21:50:25 Beijing**. The user explicitly removed waiting for the
failed Web diagnosis; this read also happened after the original 21:50:13
checkpoint. Web's ordinary-user UX gate had **1,816 passes / one failure**.
The new covered-endpoint fixture placed its target at 100px relative to a
120px reading line, inside the normal 24px tolerance, so it never tested the
endpoint exception. The other 11 navigation-alignment cases passed; no Web
browser gate was reached. API passed; settings was still running at 21:55:40.
A **22:01:44 Beijing** follow-up confirmed API/settings success, Web failure
and both image jobs skipped.

Only the faulty fixture is corrected: an exact Range starts at 32px in a
non-scrollable window, with explicit preconditions that it is outside the
normal tolerance. The same geometry must succeed without header padding and
fail `target-not-aligned` when 56px padding fully covers that Range. Both stay
at scroll zero. This preserves and strengthens the rejection assertion;
production code, alignment tolerance/stability, timeouts, retries and browser
assertions are unchanged. Static review only, **not locally executed**.
The unchanged complete exact-source CI and all artifact/deployment gates remain
required; the previous browser corrections are not promoted to passed evidence.
The fixture correction is pushed as `99ecb93`; complete run `40701765161`,
attempt 1, targets that exact source.
At **2026-10-28 22:06:03 Beijing**, official job/step metadata confirmed the
previously failed ordinary-user UX gate succeeded (22:04:33–22:05:43).
Web/API/settings were still running. This is early-gate evidence, not a full
Web/PWA, exact mounted geometry, image-artifact or deployment acceptance.

Run `40701765161` was read again at **2026-10-28 22:46:42 Beijing**;
**22:58:02** confirmed API/settings success, Web failure and both image jobs
skipped. The full Web log confirms **1,817 UX passes**, Context 36 passes,
source-editor/mutation 100 passes and Default PWA **158 passes / three failures /
750 conditional skips**. Auth/negative gates were not reached.
Official trace evidence is independently matched to run/source and SHA-256
in the release record; no local browser is substituted.

The initial exact body navigation and stale-version fallback now reach their
expected settled states. The three whole browser cases still fail later:
two replay setups assume one wheel consumes not-yet-mounted next turns;
the stale-version test incorrectly requires the whole frame to have no
overflow. Earlier descriptions of a wholly non-scrollable fallback fixture
are superseded by the actual upper-endpoint geometry, not deleted history.
The corrected replay setup waits for message 10 and `next:settled`, then
uses another real 600px wheel. Departure must be finite and >200px, so a
missing/unmounted target returning Infinity cannot satisfy it. Same DOM/URL,
navigation transitions, exact pulse and <36px return remain required.
The fallback case requires scroll zero and its actual message anchor to be
visible in the viewport, below scroll padding and more than 24px above the
120px reading line. Total `scrollHeight <= clientHeight` is not part of the
navigation contract. Content preservation, `settled:fallback` and no exact
text pulse remain. No product code, timeout, retry, tolerance or workflow
gate changed. These test corrections are authored, **not locally executed**;
require a fresh complete exact-source CI and all release gates.

Run `40711849550` targets exact `a967c01`. Attempt 1 was dispatched at
**2026-10-28 23:02:05 Beijing**, then cancelled for a source follow-up before
the turn was interrupted; the uncommitted follow-up was not in CI. Attempt 2
started **2026-10-29 00:04:37 Beijing** against the same source. At
**00:48:12**, Web failed, API passed and settings was running. Web retained
1,817 UX / 36 Context / 100 mutation passes. Default PWA had **159 passes /
two failures / 750 conditional skips**: the fallback case and real-wheel
departure now pass, but both body/file/annotation workflows fail before the
repeat body click.

Verified official traces show initial offline RSC failure followed by a cached
HTML document load; the transient query is empty, so the old result button is
absent. The browser cases now explicitly repeat body/file/annotation queries
before testing their same-URL reactivation. Source review also found that the
parent emitted a replay and still unconditionally replaced the equivalent
URL. Equivalent targets now skip routing; body/file/annotation regressions
require no additional route request, while changed identities still route.
This new path is not yet browser-accepted. The interrupted text-index change
also excludes explicitly marked renderer-only UI; controlled TreeWalker/Range
cases check canonical Unicode code offsets, legacy quote recovery and no
anchor from UI-only text. These adapters do not validate browser geometry.
The browser probe independently builds the code-word Range inside `pre code`,
checks both initial/replayed pulse position and assigned size within 2px, and
measures return against the code text, not its toolbar. It installs on current
and new documents and captures pulse insertion without extending its lifetime.
Same root/URL, finite >200px departure, <36px return, exact/fallback separation,
timeouts, retries and full release gates remain. No local execution is used.

The correction is pushed as exact `7a58de20bdd08e2785abc9d8813dcfa31b651956`.
Complete run **`40731382479`**, attempt 1, was created at
**2026-10-29 00:59:41 Beijing**. At **01:09:16**, Web/API/settings remained
in progress; early ordinary-user UX step 18 succeeded at **01:04:17**.
This confirms that early gate only, not mounted browser geometry, full PWA,
image or deployment acceptance. A documentation-only checkpoint does not
change that exact source/run/attempt chain.

The prior attempt-2 final result, read at **01:00:46**, was API success,
Web/settings failure and both image jobs skipped. Its settings matrix had
**462 passes / one failure** at the blocked-deletion signout fixture's
database-existence assertion. The official artifact identity/digest is
recorded in the release record. A connection/navigation race is a hypothesis,
not a verified cause; no settings source correction or passed rerun is claimed.

Run `40731382479` failed Web at the **2026-10-29 01:36:43 Beijing** read;
**01:42:10** confirmed API success and settings still running. Web passed
**1,822 UX / 36 Context / 100 mutation** cases; Default PWA retained
**159 passes / two failures / 750 conditional skips**. Both cases fail the
new initial pulse probe before replay: official DOM snapshots contain
`"😀 needle\n"`, but its guard required `"😀 needle"`, so it records no sample.
`Infinity` is absence of measurement, not an accepted geometry deviation.
The corrected fixture checks that exact raw text, retains the trailing newline
and requires its independent Range to select only `"needle"`. The 2px pulse,
same Reader/URL, departure/return and all later assertions remain unchanged.

The independent earlier blocked-signout fixture now holds an existing native
database connection in an inert same-origin tab, outside app navigation/hooks.
It aborts accidental database creation, requires the actual native deletion
request and reads the retained record before explicitly closing the connection.
Authentication/private-UI fences, Retry, final database/cache removal and
unrelated-cache protection remain. No product auth/cleanup source changes,
mocked delete-block outcome, longer timeout or retry allowance is introduced.
Both fixture corrections are authored, not locally executed or CI-accepted;
require a fresh full exact-source workflow and all release gates.

At **2026-10-29 01:53:39 Beijing**, the previous run's final result was API/
settings success, Web failure and both image jobs skipped. Settings passed
463 matrix cases and one independent new-instance restore case. The earlier
blocked-fixture failure did not recur, but this is not evidence for the new
fixture or a proven cause of the earlier failure.

Both corrections are pushed as exact `f8a6a060ddcaf6bd3a6ce14ece78403c70ffc713`.
Full run **`40738934749`**, attempt 1, was created at **01:46:46 Beijing**.
At **01:59:52**, Web/API/settings were still running. Web early ordinary-user
UX step 18 passed at **01:51:15**; mounted code-pulse/replay, full PWA,
new settings fixture and image/deployment acceptance remain pending.
A documentation-only checkpoint preserves this exact source/run/attempt.

#### Exact-source CI acceptance — 2026-10-29

Run **`40738934749`**, attempt **1**, exact
**`f8a6a060ddcaf6bd3a6ce14ece78403c70ffc713`**, completed with **all five jobs
successful**. First all-green metadata was read at **02:49:49 Beijing**;
the complete source/run/attempt/job chain was verified at **02:50:36**.
Web finished at **02:24:34**, with **1,822 UX**, **36 Context**,
**45 focused online**, **two Share focus**, **100 mutation**, **six cleanup**,
**18 upload**, **31 Markdown/image**, **13 PDF**, **161 Default PWA**,
**18 authentication** and **19 negative PWA** passes. The Default PWA matrix
retains 750 conditional skips.

Both 375/1440px offline body/file/annotation cases passed, including initial/
replayed code-word Range geometry within 2px, same Reader/URL, finite >200px
departure and <36px return. The corrected raw-code newline precondition did
not relax those assertions. The Web quality evidence artifact was independently
matched to run/source/attempt and downloaded digest in the release record;
it is not a deployable image.

API passed **5,903 / three skipped**. Settings passed **463 matrix cases**
and **one independent new-instance restore**. The strengthened native blocked
deletion fixture passed in 8.0s, including the observed delete request,
retained-record read, Retry/removal and authentication/cache protections.
All source/fixture changes were verified by official CI only; no local
tests/lint/typecheck/build/browser/services/database or dependency diagnostics
ran in this correction cycle.

CI image build/inspection and independent downloaded-image/source acceptance
passed. Fresh actual-artifact capacity/rollback/idle-queue preflight and
stopped-writer five-component backup `chat-reader-20261028T192159Z` passed.
Production acceptance completed at **2026-10-29 03:31:15 +08:00**;
the **03:32:31** independent operational recheck rehashed all five components
and repeated exact images, health/worker heartbeat, release pointers,
HTTP/privacy, PostgreSQL/configuration, logs and OOM checks, all passing.
Runtime/direct rollback is `f8a6a06`/`b4effda`, schema `20261022_0053`.
See the [release record](execution/SEARCH_RECOVERY_RELEASE_2026-10-28.md)
for the 9m32s maintenance window, exact identities and preserved evidence.
Documentation-only commits do not change the accepted application source.
No authenticated production browser, physical-clipboard, sustained-load or
isolated restore-drill acceptance is claimed. Source-only sections below retain
their earlier checkpoints; these later CI/operational results supersede only
their submission/release status, not their stated test-double or fidelity limits.

## Completeness follow-up optimization — 2026-10-28 (source only)

The [nine-finding implementation](execution/UX_AUDIT_COMPLETENESS_IMPLEMENTATION_2026-10-28.md)
follows the completeness review. All cases below are **authored, not executed**.
No local tests, lint, typecheck, build, browser, services or database commands,
CI dispatch, commit, push or deployment ran. Static diff checks are not runtime
acceptance.

| Area | Authored regression sources | Evidence boundary |
| --- | --- | --- |
| Rename derivation | `apps/api/tests/test_attachment_upload_api.py`: placed/unplaced attachments, name search, offline revision/catalog, normalized no-op and failure after actual index writes | Real route/indexer with the existing SQLite fixture and injected failure, not PostgreSQL transaction or offline-delta acceptance |
| Discard recovery | `scripts/ux/annotation-comment-drafts.test.mjs`: failed deletes, scoped intent retry and newer CAS writes; `annotation-workspace-reads.test.mjs`: explicit local retry before hydration and leave guard until deletion confirms | Actual helper/workspace with serialized storage and React/event adapters, not real IndexedDB failure, forced-refresh durability or multi-tab proof |
| Custom ordering | `conversation-list-recovery.test.mjs`: active/archived 499/500/501 boundaries, incomplete pages, ascending/descending rank conversion and pinned timestamp groups | Actual component handler with API/drag adapters and a server-order comparator, not real HTTP refetch or browser DnD evidence |
| TOC position | `toc-pagination.test.mjs`: owner/offline/Share append and cache publication preserve manual position; changed active row/source can recenter | Actual effect with controlled frame/geometry adapters, not measured DOM scrolling or reading-position restoration |
| Office/ZIP precision | `complex-preview-bounds.test.mjs`: manifest relationships/order, absent-manifest warnings, invalid/external/duplicate relationship failure, sparse/self-closing/invalid/far coordinates, empty/shared-string references and typed ZIP caps | Actual worker handler and installed fflate with synthetic inputs, not full Office/ODS fidelity, hostile-file safety or performance acceptance |

Later authorized gates must include the unchanged Web/API/UX requirements,
then real IndexedDB delete failure/retry and same-runtime A→B→A timing, newer
edits during deletion, account retirement, forced-refresh warnings, browser
drag-save-refetch for both sort directions and pinned priorities, owner/offline/
Share TOC at 375/1440px, PostgreSQL rename rollback/search and offline revision
consumption. A failed storage transaction cannot make an in-memory delete
intent durable across a forced reload or crash; do not turn that limitation
into an unverified guarantee. Office malformed-input and Viewer error/download
acceptance also remain pending. No migration or offline-format change is made.

## Reader completeness and recovery — 2026-10-28 (source only)

The [implementation record](execution/UX_AUDIT_OPTIMIZATION_2026-10-28.md)
follows the 12-direction review. **All new/updated cases below are authored,
not executed.** No local tests, lint, typecheck, build, browser, services,
database, CI dispatch, commit, push or deployment ran. A clean textual diff
check, if recorded, is not runtime acceptance.

| Area | Authored regression sources | Evidence boundary |
| --- | --- | --- |
| Share expiry/copy | `scripts/ux/share-expiry-and-copy.test.mjs`: empty/malformed/rollover/past values issue no create; presets/custom/Never; finite-share edit; clipboard absent/rejected/success/unmount | Actual component handlers/hook with controlled React/query/API adapters; no native date-control, focus, DST UI or physical clipboard evidence |
| Durable comments | `annotation-comment-drafts.test.mjs`: account/mode/tab separation, CAS, retired access, rapid return waiting for writes; `annotation-workspace-reads.test.mjs`: failed save A→B→A, newer input and conflict/old-scope assertions retained | Actual helper/workspace source with serialized table/transaction or repository doubles, not real IndexedDB durability or multi-tab browser acceptance |
| Search freshness | `reader-search-cache.test.mjs`: closed-cache reset, scoped preservation and late query cancellation; `offline-search-lifecycle.test.mjs` fixture updated for post-index invalidation | Installed QueryClient/observer and actual helper; no server mutation/index timing or browser lifecycle acceptance |
| Search continuation | `conversation-search-selection.test.mjs`, `offline-search-scope.test.mjs`, `offline-search-ranges.test.mjs`; API `test_search_api.py` | Actual panel/matcher/worker and installed FlexSearch with adapters; 121 result documents, exact 50, exact 100/101 matches, retained occurrence identity; PostgreSQL performance not measured |
| TOC/offline references | `toc-pagination.test.mjs`, `conversation-toc-stale-read-recovery.test.mjs`, `offline-file-references.test.mjs` | Actual owner/offline/Share source keys, page metadata, heading 201 active, retry/empty/source changes; reference 4 through 54 canonical targets. No rendered scrolling or package migration claim |
| Upload recovery | `attachment-upload-queue.test.mjs` | Actual callbacks with API/XHR/setter doubles: third-file retry, same-name identity, cancel/no automatic finalize, explicit receipt confirmation, unknown/expired/committed check, refresh failure and retirement; no real HTTP/XHR proof |
| Large lists | `conversation-list-recovery.test.mjs`, `conversation-metadata-recovery.test.mjs`, `conversation-placement-recovery.test.mjs` | Installed infinite observer and actual component options; offsets through item 5,001, loaded-only labels, retained read-error/selection cases and confirmed metadata/placement publication into pages; not a measured large-DOM/layout claim |
| Complex preview bounds | `complex-preview-bounds.test.mjs` | Actual ZIP/XML worker handler and installed fflate; paragraph/row/column/slide/line/text cap versus cap+1, not Office visual fidelity or hostile-file security proof |

Existing replay/capability/modal fixtures are synchronized with the scoped files
workspace, per-entry upload APIs and paged contracts. Prior three search batches'
browser cases remain authored, unexecuted and unaccepted; their coverage is not
silently promoted by this batch.

Before later submission, obtain execution authorization and run the unchanged
required Web lint/typecheck/build, API and `node --test scripts/ux/*.test.mjs`
gates in the authorized environment, followed by relevant PWA/Playwright cases.
Additional real-browser acceptance must cover native custom expiry/focus,
clipboard fallback, same-tab draft refresh and storage failure/account lock,
search edits while open and closed, 201+ owner/offline/Share headings at
375/1440px, offline reference navigation, cancelled/unknown uploads and layout.
Historical offline package v1/v2/v3, Dexie v2 data and real-DOM reading positions
must remain intact. No new migration or format acceptance is claimed.

`STATE-SEARCH-SCALE` remains conditional. The implementation record defines a
synthetic PostgreSQL measurement matrix and result-equivalence gate; no query
rewrite or latency/RSS improvement is claimed without those measurements.

## Search lifecycle and replay — 2026-10-27 (source only)

The [implementation record](execution/SEARCH_LIFECYCLE_2026-10-27.md) covers
NAV-REPLAY, OFFLINE-FRESHNESS and OFFLINE-DUPLICATE. Cases below are **authored,
not executed**. No local test/lint/typecheck/build/browser/service/migration
command or CI dispatch ran; no submission or deployment acceptance is implied.

- `scripts/ux/offline-search-documents.test.mjs` loads the actual transpiled
  read-only projection: canonical/local duplicates, tombstones, known legacy
  prefixes, distinct entity/conversation identities, opaque legacy retention,
  saved anchors and non-mutation. It does not import or migrate a real package.
- `offline-search-lifecycle.test.mjs` extracts actual LibraryShell callbacks
  and effects. Controlled Dexie notifications, access generations, timers and
  worker transport check rapid edits, old timers versus explicit refresh,
  serialized initialization, deletion, subscription/capture/worker failure,
  retry/reattachment, auth retirement/reauthorization, unmount and old query
  replies. The liveQuery adapter does not execute the transactional read
  callback; this is not real Dexie notification or React acceptance.
- `search-result-target.test.mjs` and
  `offline-library-search-navigation.test.mjs` add equivalent target identity,
  explicit repeat intent and different-target isolation using actual extracted
  parent/list functions. `reader-search-replay.test.mjs` exercises actual Reader
  navigation and panel effects with controlled hooks/DOM: bookmark once,
  same-target replay, file visibility/focus ownership, annotation filter reset,
  delayed rows and one-time single-item review alignment. These adapters are
  not a typecheck or rendered focus/scroll proof.
- The existing default PWA suite's `library-offline.spec.ts` extends disconnected
  375/1440px body navigation with real user scrolling and a second activation,
  navigation-stage/pulse/alignment assertions, unchanged URL and the same
  connected Reader root. Desktop file/annotation cases hide then reactivate the
  target. A separate desktop case edits/deletes through the real annotation UI
  and repository, asserting fresh unique Library hits without page reload.
  Canonical duplicate seed documents are synthetic. Native IndexedDB seeding
  does not stand in for Dexie write notifications; mutations use the real UI.
  Mobile panel replay and expanded single-item review have controlled source
  coverage here, not new browser acceptance.
- `offline-library-local-read-state.test.mjs` retains the ready-before-optional-
  search source contract against the extracted rebuild entry point.

Only source inspection and Git whitespace checks are available for this batch.
The normal full UX/Web/API/PWA and release gates remain required when authorized;
no new workflow is added. No rendered/contrast design checklist score or
large-corpus performance result is claimed. Older green CI covers none of the
three unsubmitted search batches.

## Scoped search and offline entries — 2026-10-27 (source only)

The [follow-up implementation](execution/SEARCH_RECALL_OFFLINE_2026-10-27.md)
is **unverified, unsubmitted and undeployed**. All cases below are authored,
not executed. The user's no-local constraint still excludes tests, lint,
typecheck, build, browser, services and migration commands; no CI was dispatched.
The declared optional offline version field closes the source omission, not the
real typecheck gate.

- `apps/api/tests/test_search_api.py` adds three identical assistant answers in
  one conversation, two matches per message and distinct paged message targets;
  the same corpus still folds globally with a count of two conversations.
- `scripts/ux/offline-search-scope.test.mjs` executes the actual transpiled
  worker handler and installed FlexSearch when run. Synthetic out-of-scope,
  wrong-role and wrong-type documents precede the final target beyond the old
  window. It checks every partial filter combination, field domains, legacy
  filename content, bounded union and reinitialization. Only `self`/message
  delivery are adapters; this is not a real Worker thread or IndexedDB test.
- `offline-search-readiness.test.mjs` checks bridge scope/limit delivery with
  the existing transport adapter. `offline-search-ranges.test.mjs` uses the
  extracted shared projection/matcher and controlled Dexie/recall/access reads:
  raw ranges, indexed versions, later heading/code blocks, legacy block fallback,
  wrong-conversation rejection, access retirement and non-body target domains.
- `search-result-target.test.mjs` adds offline-route body/file/annotation URLs.
  `offline-library-search-navigation.test.mjs` exercises actual extracted list
  activation and parent opening with controlled hooks/layout, projection,
  routing and storage: double-clicks, latest choice, query/result/route/unmount
  retirement, failure/retry and unchanged description/notebook behavior.
- The existing default PWA suite's `library-offline.spec.ts` adds real-worker
  scoped recall after 300 unrelated documents, title/type exclusion and
  disconnected 375/1440px Library body/file/annotation destinations using
  synthetic IndexedDB rows. Later-block/range URLs and non-fallback navigation,
  file-row focus/no automatic viewer or download, and saved annotation anchors
  are asserted. This does not extend the existing exact-pulse geometry case or
  prove historical package migration.

Existing full API, `node --test scripts/ux/*.test.mjs`, Web typecheck/lint/build,
PWA and release gates remain required. No workflow or schema is added. No
browser output exists to score rendered design/contrast; older green CI cannot
accept the unsubmitted search work.

## Search correctness and exact navigation — 2026-10-27 (source only)

The [implementation record](execution/SEARCH_CORRECTNESS_2026-10-27.md) is
**unverified, unsubmitted and undeployed**. The user forbids local test/build/
browser/service execution for this batch; no lint, typecheck, migration command
or CI dispatch ran either. The cases below are authored, not passing receipts.

- `apps/api/tests/test_search_api.py`: literal `%/_/\\` API queries, attachment
  target fields, original casefold/whitespace ranges and the 100-match cap.
  `test_annotation_search_index.py` asserts that comment text is not a body range.
- `test_search_correctness_postgres.py` exercises the actual PostgreSQL
  ILIKE/full-text candidate branch through the existing disposable-database
  fixture, only when `SETTINGS_POSTGRES_INTEGRATION=1`. It is included by the
  unchanged API full-suite CI gate; a local conditional skip is not acceptance.
- The ordinary `node --test scripts/ux/*.test.mjs` gate includes the shared
  URL/canonical-anchor, Unicode matcher, rendered attachment group and offline
  method regressions, including the existing primary-table fallback for an
  empty legacy block index. Existing sidebar/conversation selection and Reader
  readiness/retirement adapters track the added dependencies and destinations.
  Text-anchor Range/TreeWalker, hooks, FlexSearch and Dexie adapters are explicit;
  these cases do not prove real DOM geometry, focus, worker recall or migration.
- The default browser gate's `reader-location-failure.spec.ts` adds exact
  Unicode/repeated-range and stale-version checks with explicit API adapters.
  The isolated `E2E_RICH_MARKDOWN_ATTACHMENT=1` gate's
  `attachment-reading.spec.ts` adds 375/1440px file-target focus and no automatic
  preview/content-read checks against its existing synthetic upload fixture.
  These cases are also unexecuted. The senior-designer rendered/contrast
  checklist is not scored without actual rendered evidence.

Existing full lint/typecheck/build/API/PWA and release gates remain required;
no new workflow, migration, offline-package version or Dexie version is added.

## Noise protection renderer contract — 2026-10-27 (local only)

`scripts/ux/fixtures/noise-renderer-protection.json` is shared by
`apps/api/tests/test_noise_renderer_protection_contract.py` and
`scripts/ux/chatgpt-rich-text.test.mjs`. The latter loads the actual app
remark/rehype plugins, display-math normalization and rich-layout projection,
then checks source-restored code/math node positions in LF/CRLF. The Python
test independently checks detector evidence/decisions for the same source.
Run both after changes to those ownership rules; neither replaces browser,
PostgreSQL, Share/PWA or complete Markdown-extension acceptance.
The existing `test_content_cleanup.py` and `test_cleanup_safety.py` also check
ordinary batch selection, exact preview/apply source and old/forged choices.
See the [dated review-fix receipt](execution/ux-audit-noise-matching-2026-10-25.md#37-review-fixes-and-application-renderer-contract--2026-10-27)
for actual run results; older counts below remain their own checkpoints.
Scoped isolated API regression completed after temporary-disk recovery. Its
recorded Windows symlink-capability skip belongs to an additional artifact-cleanup
test, not a skipped noise-protection assertion; interrupted attempts remain historical.

## ChatGPT reading compatibility — 2026-10-25 (local only)

The [continuation and synthetic receipts](execution/CHATGPT_READING_REMAINING_2026-10-25.md)
own the current v7/display and exporter-v6 results, residual failures and limits.
The [original audit](execution/ux-audit-chatgpt-reading-2026-10-25.md) remains the
historical two-implemented/eighteen-deferred checkpoint, not the current backlog.
Use process-local TEMP/TMP under the task's `wkkk` subdirectory for every command;
pytest cache/basetemp, browser artifacts and temporary Playwright config also
belong there. Use synthetic input; the optional private paired fixture is excluded.

- `node --test scripts/ux/chatgpt-rich-text.test.mjs`: **43 passed**, including
  inert visible HTML, nested/unclosed code, budget fallback and prior canonical
  preservation. The expanded pre-edit check was 40 passed / 3 failed.
- The complete service-free gate: **75 files, 1,589 passed, zero failed/skipped**.
  On Windows PowerShell, enumerate `Get-ChildItem scripts/ux -Filter '*.test.mjs' -File`
  into an array and pass it to `node --test --test-concurrency=1 @tests`.
- `node scripts/ux/source-editor-table-browser.mjs`: **86 passed** in local
  Chrome, no page/console errors. Actual renderer/DOM/CSS check 1440/375px,
  inert source, Mermaid descriptions/source/error recovery and fixed-source
  parse reuse. API/Next-loader/assistant-ui source-forwarding and surrounding UI
  adapters are explicit; this gate is not authenticated three-chain acceptance.
- `chatgpt-reading-acceptance.spec.ts`: **2 passed** against an isolated local
  API/worker/fresh PostgreSQL and production Web build, using installed Edge
  Chromium and a task-local Playwright config. One exercises actual authenticated
  Reader, guest Share and downloaded Offline Reader/reload with the same complete
  turn/message DOM anchors, plus real bounded mapping preview and zero saves
  from its display toggle. The other checks all six completion warnings through
  the actual archive UI with explicit preview/commit/cleanup response adapters;
  it does not validate archive parsing.
  Run only with `E2E_CHATGPT_READING=1` and an isolated synthetic account supplied
  through `E2E_AUTH_EMAIL`/`E2E_AUTH_PASSWORD`. The local resource-limited harness
  used process-only 64 MiB upload reserve / analysis factor 1; product defaults
  and memory probes are unchanged. No capacity conclusion follows.
- Focused API import/mapping/type/source tests use `python -m pytest`,
  `-k 'not real_paired_fixture'`, task-local `--basetemp` and `-p no:cacheprovider`.
  Exact files, final counts and the broader `corepack pnpm run test:api`
  failures are in the continuation. The full API gate is **not green** and is
  not superseded by these focused checks. Official-graph rejection is unchanged.
- Playwright source contracts `ai-rich-markdown-contract.spec.ts` and
  `import-compatibility-contract.spec.ts`: **4 passed**, with a task-local
  source-only config and no browser/webServer; not a PWA gate.
- `corepack pnpm run lint`, `corepack pnpm --filter web exec tsc --noEmit
  --incremental false` and the standard `corepack pnpm --filter web build` pass.
  Build uses `NEXT_BUILD_CPUS=1`, `NEXT_STANDALONE=0`, default `.next`; the
  preexisting unrelated `tsconfig.tsbuildinfo` hash is unchanged.
  `cd apps/api; python -m alembic heads`: one **`20261022_0053`** head;
  a fresh task-local PostgreSQL cluster also migrated from zero to that head.

At that local checkpoint, no complete PWA/offline-version/position-restoration matrix, physical device,
production, screen-reader audit, clipboard or CPU/RSS/sustained-load acceptance
is claimed. Eight source-dependent adapters remain unimplemented with explicit
prerequisites; no missing data or private protocol is guessed.
Those are local implementation-stage receipts, not the subsequent release.
After user authorization, exact source `c7dc074` passed all five jobs of full
CI `40199643009`, including the API full-suite and settings/Web gates. This
does not erase the earlier local failures or turn skipped local browser tests
into passes. The first release run failed an obsolete trimmed-literal assertion
and ordinal textarea locator; the retry preserves the exact literal and targets
both localized message inputs explicitly, including draft recovery assertions.
The [combined release record](execution/CHATGPT_NOISE_RELEASE_2026-10-25.md)
owns independent artifact/backup/production runtime acceptance and its limits.
The noise audit's **100 passed** local API checks and **six skipped** local
rule-learning browser checks retain their original environment scope.
No production authenticated UI, physical clipboard or sustained-load pass is
implied by a green CI or runtime-health check.

## Optimization review and pruning — 2026-10-24 (local)

The [dated review](execution/SYSTEM_OPTIMIZATION_REVIEW_2026-10-24.md) owns this
batch's targeted regression results and limits. The extra release-document
snapshot checker has been removed; `corepack pnpm run test:ci-tools` retains
the original changed-area selector tests, without weakening the full release
gate. Original health endpoint tests remain. Task recovery coverage exercises
the writer, persisted row and actual detail/list endpoints; private suffixes and
dynamic scanner values must still be redacted. Earlier receipts below are not
new full-suite or production acceptance.

Subsequent publication is accepted at exact source `3fbf79d`: full CI
`40095860923` passes API, Web, settings, image build and independent artifact
inspection. Fresh pre-submit API regression is 213 passed; runtime/backup and
50-minute gate evidence belong to the
[release record](execution/SYSTEM_OPTIMIZATION_RELEASE_2026-10-24.md).
The local synthetic receipts below retain their narrower scope; production
authentication UI, physical clipboard and sustained load were not exercised.

## Code-block clipboard recovery — 2026-10-24 (local)

`node --test scripts/ux/code-copy-recovery.test.mjs` exercises the actual
component functions and shared hook with controlled scheduling/device adapters:
**8 passed**. `node scripts/ux/code-copy-browser.mjs`, with process-local
TEMP/TMP in the task's `wkkk` directory, runs **5 local Chrome component
scenarios** using real React/DOM/CSS and explicit preferences/highlighting/
clipboard adapters. It checks complete selected source, missing/denied access,
retry, pending state and 375px Chinese recovery. The final service-free UX
suite passed **1,582/1,582**; no physical clipboard, permission prompt or full
authenticated Reader/Share/Offline E2E is claimed. The
[scoped review and synthetic evidence](execution/ux-audit-code-copy-recovery-2026-10-24.md)
record the first failed SSR-fixture import and its correction, not a skipped
product assertion. Web lint, nonincremental typecheck and one-worker production
build passed. The two rich-Markdown Playwright source-contract checks also
passed without a browser/server; those are not rendered E2E acceptance.

## Import-analysis resource isolation — 2026-10-24 (local)

The kilobyte-source lifecycle/transaction tests in
`apps/api/tests/test_import_analysis_queue.py` use a module-local synthetic
headroom sensor, matching the existing draft-streaming suite. The real
admission context and worker still run; only the machine-dependent sensor is
controlled. Production limits and memory probes are unchanged. Negative worker
tests override the sensor with zero, 64 MiB or unknown headroom and verify that
analysis does not start and original sources remain available.

A test-process fault installed a zero-headroom sensor **before fixture setup**:
the old suite produced **4 failures / 1 pass** in the selected correctness/
rejection cases; the scoped fixture then passed all **34** analysis cases under
the same fault. Independent upload-admission, compressed-input and draft
regressions passed **44/44**, retaining concurrency, fail-closed and expanded-
input safety checks. These are deterministic functional tests, not memory
capacity, OOM prevention, PostgreSQL or production acceptance. The transient
fault plugin lives only in this task's `wkkk` directory.

## Noise rules and thinking summaries — 2026-10-23 (local only)

The [current contract](system/CONTENT_CLEANUP_CONTRACT.md) owns behavior;
the [release record](execution/NOISE_SUMMARY_RELEASE_2026-10-23.md) tracks the
subsequent submission/deployment authorization, not a local-test release claim.
All temporary services/configs/results use the task directory under `wkkk`,
process-local TEMP/TMP and synthetic source only.

- `corepack pnpm run test:api` with all `test_cleanup*.py` plus the noise,
  thinking, block builder, import/alignment, archive, Reader, Share and offline
  modules: **61 modules, 467 passed / 50 conditional skipped**, in six fresh
  process batches. Supplemental `test_noise_rule_regressions.py`,
  `test_reader_api_contract.py` and `test_my_shares.py`: **44 passed**, including
  repeated coverage and four new positive-consent/role-aware preview cases.
  Supply task-local `--basetemp` and `-o cache_dir`; PostgreSQL-only conditional
  skips are not local PostgreSQL acceptance.
- `node --test --test-concurrency=1 scripts/ux/*.test.mjs`: **72 files,
  1,560 passed / zero skipped**. API/Web share the synthetic summary corpus in
  `apps/api/tests/fixtures/thinking-summary-cases.json`; it covers safe prefixes,
  LF/CRLF, inline answers, ordinary introductions, code and bare labels.
- `corepack pnpm --filter web test:pwa ... thinking-summary.spec.ts
  content-cleanup.spec.ts library-offline.spec.ts`, with
  `E2E_THINKING_SUMMARY=1 E2E_CONTENT_CLEANUP=1`: **21 passed** using real Next,
  isolated SQLite API/single-worker and Chrome at 1440/375px. It checks source
  retention, shared folding, stale offline flags, ordinary preview prefixes,
  long normalized candidate editing and trial exception/coverage explanations.
  The cached offline data comes from real API source/blocks seeded into
  IndexedDB; it is not a package-download or authenticated PostgreSQL fixture.
  Final focused rerun: **6 passed**, additionally verifying that saving an
  edited rule retains its all-role filter on the server.
- A separate `NEXT_PUBLIC_PWA_NEGATIVE_TESTS=1 E2E_PWA_NEGATIVE=1` production
  build runs six selected `pwa-negative.spec.ts` package cases: **6 passed** for
  v1/v2/v3 ingestion/retention, malformed replacements, bounded writes and
  transaction recovery. The full negative matrix remains a release CI gate.
- `node scripts/ux/image-scale-slider-browser.mjs`: **4 passed** combinations
  of desktop/mobile and light/dark, using actual controls/query cache/CSS with
  explicit persistence/Reader adapters. Existing slider source was retained.
- Image-source/PostgreSQL-service CI contracts plus offline-shell regressions:
  **67 passed**. Web lint, typecheck and bounded standard build pass.
  `cd apps/api; python -m alembic heads`: one `20261022_0053` head.

Initial failed runs are retained task-locally, not counted as passes. Scanner
cursor/underscore and inherited rich-formatting regressions were fixed.
Browser fixture auth/worker/message-count/locator mistakes and cross-run saved
exception reuse were corrected without bypassing production checks. The new
summary browser cases are enabled in the existing `source-editor-cleanup` CI
gate. No production-account UI, full accessibility, native clipboard or
sustained-load acceptance is implied.

## Original-relative image scale — 2026-10-23

- `cd apps/api; python -m pytest tests/test_image_display.py
  tests/test_message_markdown_copy.py -q --basetemp="$env:TEMP/pytest-scale"`:
  original preservation, stable URL 50/25/100%, no publication on size save,
  source/expected-percentage conflicts, EXIF orientation, metadata stripping,
  animation/bounds rejection, owner/auth checks, concurrency admission, and
  missing-derivative fail-closed/repair.
- Existing `E2E_MESSAGE_MARKDOWN_COPY=1` real Next/API/disposable-PostgreSQL
  tests now exercise the lower-right 1–100% slider at 1440/375px, unchanged
  public URL, persisted width after reload, selecting 100%, original bytes, no
  page overflow, and Share editing-control absence. Clipboard is still an
  explicit adapter.
- `node --test scripts/ux/image-scale-snap.test.mjs` covers velocity attraction,
  finite release, all 100 slow-drag integer values, bounds and timestamps.
  `node scripts/ux/image-scale-slider-browser.mjs` mounts the actual owner
  control/slider/query cache/CSS at 1440/375px in light/dark mode: mouse/touch
  commit/cancel, pause-at-stop, slow and keyboard escape, one write per release,
  unknown-write read recovery, 44px presets, translated-containing-block
  placement, sticky-rail avoidance and edge clamping.
  `image-display-position.test.mjs` adds five pure geometry checks.
  The first-CI repair rerun has **1,565 service-free checks**, **4 actual-control
  browser combinations**, and **2 API import checks** passing. API persistence
  and surrounding Reader/image layout are explicit adapters. This is local
  component integration, not API-backed Reader/Share or production acceptance.
- `E2E_IMPORT_FLOW=1` verifies ordinary workspace drops do not import, the
  dimmed/blurred overlay exposes the explicit central target, and central/sidebar
  targets retain destination capture. `E2E_ATTACHMENT_UPLOAD=1` verifies source
  editor file drops still create attachment drafts without opening Import.
- Run attachment bundle/integrity/range/upload/storage and offline regressions,
  Reader/Share copy, service-free UX tests, Viewer modal and table browser gates,
  lint, nonincremental typecheck and bounded production build.

Use only the task TEMP/TMP directory and synthetic data. Counts, screenshots,
known skips and exact release state belong to the
[original dated record](execution/IMAGE_DISPLAY_SCALE_2026-10-23.md) and
[compact-selector/drop release](execution/IMAGE_SCALE_DROP_RELEASE_2026-10-23.md).
The latter passed all five exact-source CI jobs in `39897308692`; the user
stopped further local validation before submission. These checks are not
installed Obsidian, full WCAG, production authenticated UI or peak-memory acceptance.

## Single-message Markdown copy — 2026-10-22

The [current contract](system/MESSAGE_MARKDOWN_COPY_CONTRACT.md) owns limits;
[dated results](execution/MESSAGE_MARKDOWN_COPY_2026-10-22.md) own exact counts,
source receipts and release status. Use synthetic fixtures only.

- `cd apps/api; python -m pytest tests/test_message_markdown_copy.py -q
  --basetemp="$env:TEMP/pytest-copy"`: full source/no publication, image reads,
  live revocation, exact anonymous boundary, stale-version/mixed-batch atomicity,
  bounded PNG validation, attachment-scoped previews and retry/repair.
- On an explicitly disposable PostgreSQL only, set
  `SETTINGS_POSTGRES_INTEGRATION=1` and run
  `python -m pytest tests/test_message_markdown_copy_postgres.py -q
  --basetemp="$env:TEMP/pytest-copy-postgres"`. It creates/drops only uniquely named
  fixture databases: real 0052→0053→0052→0053 source preservation, concurrent
  stable capabilities/FK deletion and concurrent preview reuse. Never select
  production with this fixture.
- `node --test scripts/ux/message-markdown-copy.test.mjs`: installed parser and
  positional source fidelity, complete tail, code/math/HTML non-publication,
  reference/nested labels, file omission, MIME/path/budget failures.
- `node scripts/ux/message-markdown-copy-browser.mjs`: real MessageItem, copy
  hook/parser/canvas/API client and synthetic SQLite API/store; body display,
  preferences/history and Clipboard API are explicit adapters. Desktop/375px,
  fallback, focus, version/auth retirement, unsafe SVG and anonymous image
  decoding are local integration evidence, not full Reader acceptance.
- `E2E_MESSAGE_MARKDOWN_COPY=1` enables
  `apps/web/e2e/message-markdown-copy.spec.ts` against isolated Next/API/PostgreSQL.
  It uses real uploads, canonical edit, Reader/mobile actions, anonymous PNG
  decode, Share action absence, in-use deletion protection and file-removal
  revocation; only Clipboard API is a deterministic adapter. Full CI includes
  it in the existing Markdown/image Viewer gate, without relaxing other gates.

Run lint/typecheck/build, broad API and UX regressions plus the existing Reader
selection-copy/Share and cached-offline checks. Set process-local TEMP/TMP under
the task's `C:\Users\86182\Desktop\wkkk` directory before commands; all pytest,
browser configs/outputs and one-off services must use that directory. No
installed Obsidian/native OS clipboard or production-account UI PASS is implied.

## Shared body tables / compact structure controls — 2026-10-22

The [implementation record](execution/TABLE_BODY_SHARED_PRESENTATION_2026-10-22.md)
binds the current shared body/tool primitives, structural commands and compact
header. On local Windows/Chrome, the final gates pass:

- `node --test --test-concurrency=1 scripts/ux/*.test.mjs`: **69 files,
  1,522 passed / zero skipped**, including the **105 focused** table/context/
  reference/rich-rendering cases (not additive counts).
- `node scripts/ux/source-editor-table-browser.mjs`: **81 scenarios**. The five
  added cases measure actual ordinary body rendering at 1440/768/375px and
  validate specific whole-column deletion/Undo, paged-row targeting, final data
  row/column boundaries, stale source, newer raw edits and 375px Chinese touch.
  Existing edge hit tests remain unchanged. The 24px-gutter experiment failed
  them and was withdrawn; the final 44px gutters pass.
- A task-local Playwright config runs only `ai-rich-markdown-contract.spec.ts`:
  **two passed**. These are source-contract checks, not browser interactions.
- `corepack pnpm run lint`, `corepack pnpm --filter web exec tsc --noEmit
  --incremental false --pretty false`, and `NEXT_BUILD_CPUS=1
  NEXT_STANDALONE=0 corepack pnpm --filter web build`: exit **0**.

The browser harness uses real MarkdownRenderer, Table tool, workspace/form and
CodeMirror with explicit API/Next-loader/assistant-ui source-forwarding and
unrelated rich-view/cleanup adapters. It does not prove authenticated
Reader/Share/Offline end-to-end, Safari/Firefox, real-device, assistive-technology,
server RSS/OOM, or production acceptance. No new performance profile was
requested; old long-task observations are not marked resolved. All fixtures
are synthetic. TEMP/TMP and the temporary Playwright config live under this
task's `C:\Users\86182\Desktop\wkkk` directory; the normal Next build uses its
required project-local `.next` output. The pre-existing dirty
`apps/web/tsconfig.tsbuildinfo` was regenerated by an early incremental check,
is excluded from this work, and was unchanged by the final build. No migration,
CI, push or deployment.

## Attachment Viewer / mobile Sheet Escape regression — 2026-10-21

CI run `39561847297` localized the first release failure to the 375px English
and Chinese file-panel Escape-return cases. The mounted isolated Chromium gate
`node scripts/ux/attachment-modal-browser.mjs` uses the actual Reader Escape
effect, Viewer, Vaul Sheet and synthetic attachment/capabilities adapters; it
passes 12 mouse/touch/keyboard scenarios across both locales. It asserts retained
panel DOM identity, selection, search and focus, the subsequent Sheet Escape,
IME (composing and legacy 229) and child-prevented Escape. This is a UI lifecycle
regression, not API/auth, offline, or real attachment-service acceptance. The
API-backed attachment-reading Playwright spec also checks IME/child Escape; it
still requires the isolated PostgreSQL fixture and complete CI execution.
Release continuation and limits are in
[`TABLE_TOOL_RELEASE_2026-10-21.md`](execution/TABLE_TOOL_RELEASE_2026-10-21.md).

## Table closeout / operator-shell continuation — 2026-10-21

The [closeout review](execution/ux-audit-table-closeout-2026-10-21.md) rechecks
20 table source/test hashes and 29 existing evidence artifacts, not another
browser run. Keep the 122 focused / 1,513 service-free / 76 Chrome acceptance
below; extreme-table performance is deferred, not passed.
The [bounded backup/preflight repair](execution/OPS_BACKUP_READERS_2026-10-21.md)
runs `test_backup_shell_safety.py`, `test_runtime_health_scripts.py`,
`test_backup_retention_report.py` and `test_recovery_preflight.py`:
**67 passed / 1 skipped** (Linux flock contention cannot run on Windows).
The 27 new cases execute actual Git/MSYS POSIX shells with synthetic Docker;
tar/gzip/SHA-256 use real synthetic files. Docker mounts/cgroups, PostgreSQL
dump/restore and production are not exercised. Three backup shells pass
`bash -n`; this is a local-only gate, not CI or a deployment.

## Withdrawn raw Markdown input trial — 2026-10-21

The [trial/correction record](execution/ux-audit-table-raw-input-2026-10-21.md)
preserves green 123/1,514 content tests separately from a later actual-event
probe: React received `textInput` without `inputType`, the new path ran zero
times and fallback ran five times. The experiment and its dedicated test were
removed, restoring all 20 delimiter-fix source/test hashes. Those trial checks
are not proof of a working optimization, nor current acceptance counts.

## Latest local delimiter-content regression — 2026-10-21

The [delimiter-content review](execution/ux-audit-table-delimiter-content-2026-10-21.md)
adds real GFM-rendered fixtures for dash-shaped header/data cells, selection and
cursor discovery, simple and incremental drafts, plus actual desktop/375px
workspace Apply/Undo. **122 focused**, **69 files / 1,513 service-free cases**,
**76 Chrome scenarios**, lint, nonincremental typecheck and one-worker
non-standalone build pass. The focused tests are included in the broad count.
All evidence is synthetic/local; no CI, push, deployment, full Reader/Share/
Offline or production-resource acceptance.

## Latest local Table input/content continuation — 2026-10-21

The [input/layout continuation](execution/ux-audit-table-input-layout-2026-10-21.md)
retains Unicode-normalization failures, an intermediate trimming-watchdog
regression and a CRLF workspace-fixture correction separately from final
acceptance. Conservative source-draft reuse and canonical-row indexing remain;
the unproven direct-table renderer and DOM/frame write queue do not. Every
displayed table still passes through the shared GFM/math/sanitization chain.
All six gates pass against 20 unchanged source/test hashes: **117 focused**,
**69 files / 1,508 service-free cases**, **72 Chrome scenarios**, Web lint,
nonincremental typecheck and one-worker non-standalone build. The focused cases
are included in the broader count, not additional distinct cases. New desktop
scenarios cover rich-syntax typing, repeated Unicode raw/grid edits after CRLF
paste, exact boundary whitespace through Apply/Undo and horizontal edge focus;
existing 320/375px touch and native Chrome composition scenarios remain.

The final five-input synthetic profile still observes large-table long tasks:
10×4,000 grid/tail next-frame medians are 61.6/62.5ms, and 200×248 are
47.7/51.8ms. These are unthrottled local observations, not INP, physical paint,
a latency pass threshold or evidence that server OOM is resolved. Final receipts,
partial log excerpts and before/after hashes are linked from
`evidence/table-tool-input-layout-2026-10-21.json`; no API/PWA, authenticated-server,
cross-browser or real-device acceptance is implied. No new migration or release.

## Preceding local Table row-boundary continuation — 2026-10-21

The [row-navigation review](execution/ux-audit-table-page-navigation-2026-10-21.md)
preserves two separate mounted failures: missing boundary commands, then focus
falling to BODY in the first implementation. The fix adds First/Last within the
existing bounded pager and retains focus on an enabled adjacent control. Three
added scenarios cover exact tail edits, one-page/model-shrink behavior and actual
320/375px touch workspace Apply/Undo with no API writes. Four pager controls stay
44×44 and hit-testable; row-page changes do not change Markdown.
All six gates pass against 20 unchanged source/test hashes: **111 focused**,
**69 files / 1,502 service-free cases**, **67 Chrome scenarios**, lint,
nonincremental typecheck and one-worker non-standalone build.

The opt-in profile now includes tail cells and phase-scoped task records, plus
separate raw-textarea value/next-frame and rendered-header/next-frame observations.
The final synthetic large-narrow run still has 51ms grid and 54ms tail tasks.
Old unsegmented task counts also covered later source editing/GC, not only grid
input. No hardware-dependent performance gate, physical-device/INP, server
RSS/OOM, full PWA or authenticated-server acceptance is implied.

## Preceding local Table parsing-safety continuation — 2026-10-21

The [pending-parse review](execution/ux-audit-table-pending-parse-2026-10-21.md)
records a mounted Chrome failure after 18 passes: raw Markdown parsing was
suspended, the old table stayed visible, and Apply incorrectly remained enabled.
Two added scenarios independently hold the actual draft parser rather than the
rich renderer. They verify pending protection, latest-input application and
invalid-input recovery without replacing parser results. The hold is injected
only by the temporary test loader; production source has no test scheduling seam.
After the fix, all six local gates pass: **111 focused**, **69 files / 1,502
service-free cases**, **64 Chrome scenarios**, lint, nonincremental typecheck
and single-worker non-standalone build. The run and archived evidence bind 20
unchanged source/test hashes. Existing workspace Apply/Undo, keyboard, Chinese
and 375px touch coverage remains, but the two new parsing-hold scenarios run at
desktop width; they are not mislabeled as native-mobile acceptance.

The [adaptive continuation](execution/TABLE_TOOL_ADAPTIVE_PREVIEW_2026-10-20.md)
archives the preceding source-parsing/row-serialization/page-budget work and its
own 62-scenario checkpoint. Its sequential profiles do not isolate individual
causes. That checkpoint's source-bound profile still records 52ms/51ms main-thread long
tasks; it has no performance pass threshold, server RSS/OOM or real-device claim.
No migration, push, CI, deployment or authenticated/full-PWA acceptance occurred.

## Local editable Table tool — 2026-10-20

The [initial continuation](execution/TABLE_TOOL_EDITING_2026-10-20.md) preserves
the focused **42/42** parser/SSR and initial **13/13** component scenarios.
The [real workspace continuation](execution/TABLE_TOOL_WORKSPACE_2026-10-20.md)
adds actual SourceEditorWorkspace/EditMessageForm/CodeMirror; **20/20** Chrome
scenarios pass after reproducing/fixing toolbar Undo/Redo, nested-modal shortcut
focus theft and the stale Insert-table label. It also checks explicit client
save payloads, no saving from table Enter/submit, stale source and real 375px touch.
This is not authenticated server, Reader/Offline/Share/PWA or assistive-technology
acceptance. That post-repair serial service-free run passes **67 files / 1,450 cases / zero
failed or skipped**, plus full Web lint, nonincremental typecheck and a
single-worker Web build; current rerun receipts are in the workspace record.
The earlier 1,449-case checkpoint predates the mixed-newline regression.

The [large-table continuation](execution/TABLE_TOOL_PERFORMANCE_2026-10-20.md)
passed **22/22** scenarios, adding cell-syntax repair/interleaved edits and
oversized-cell rejection. It reruns the same 42 focused and 1,450 broader cases,
lint, typecheck and build after the performance changes. Earlier 13/20-scenario
records retain their own source bindings. Optional `TABLE_TOOL_PROFILE=1`
observes five inputs for each of four bounded synthetic sizes after functionality;
its `performance.json` contains timings/long tasks/explicit-GC JS heap, with no
hardware-dependent pass threshold, server-memory claim or long-run guarantee.

The [content-integrity checkpoint](execution/TABLE_TOOL_CONTENT_INTEGRITY_2026-10-20.md)
passes **61 focused checks**, **27/27 Chrome scenarios**, all **68 UX files /
1,469 cases / zero failures or skips**, full lint, nonincremental typecheck and
single-worker build. Math-bar/code/reference failures are recorded separately
from two harness errors. The assistant-ui adapter now forwards source into the
actual MarkdownRenderer core, making source-preview assertions meaningful; it
is still an adapter, not upstream assistant-ui or full Reader acceptance.
New context-limit copy is checked at 1440px and 375px. The read-only context
collector's source/UTF-8/definition bounds are tested without remote requests.

The separate [long-cell continuation](execution/TABLE_TOOL_LONG_CELL_2026-10-20.md)
adds three browser cases using a 40,000-character synthetic cell, checks the
400-cell wide-table mount bound, and passes **30/30** workspace/browser scenarios.
It checks display-only shortening, full Markdown/editor values, exact source
preservation on untouched Apply and changes that checkpoint's focused total to **62**.
Its final service-free suite is **68 files / 1,470 cases / zero failures or skips**,
plus Web lint, nonincremental typecheck and single-worker build.
Repository-wide gates are independently rerun and bound in
`evidence/table-tool-long-cell-2026-10-20.json`; no server or real-device resource
conclusion is implied.

The [parser-reuse continuation](execution/TABLE_TOOL_PARSER_REUSE_2026-10-20.md)
reproduces unchanged-source re-entry on a callback-only render (one unnecessary
parser component entry) and removes it without freezing live cell callbacks.
Its **35/35** Chrome scenarios add a transparent counting wrapper around the
installed `react-markdown` and test-only promise holds for deferred-render races.
Latest/invalid drafts, an active input, Escape focus, stale action blocking and
explicit source refresh are deterministic checks, not CPU-speed-dependent sleeps.
That rerun passes all **62** focused and **1,470** service-free checks, full
lint, nonincremental typecheck and single-worker build. Optional profiling now
reports grid-to-Markdown paint and preview-settled observations separately,
plus parser-entry counts; do not equate the former with a fully updated rich
preview. These small synthetic samples are not a cross-device performance gate.

The latest [bracket-index continuation](execution/TABLE_TOOL_BRACKET_INDEX_2026-10-20.md)
replaces quadratic nested-image lookahead with a lazy linear suffix index. Its
**67/67** focused checks include seeded small-input legacy equivalence, 6,000
balanced nested images and a test-only Node Worker with a 10-second anti-hang
watchdog for 240,000-code-unit malformed input. The watchdog is not a latency SLA.
The same continuation removes exponential fence-regex backtracking on ordinary
deeply quoted prose, with 500 mixed LF/CRLF legacy comparisons and an isolated
6,000-level quote-prefix watchdog that failed before the repair.
The **37/37** Chrome gate preserves malformed Markdown, blocks invalid Apply,
recovers to valid content and rejects oversized grid pastes without changing the
accepted draft; deep quoted prose still permits table editing and exact Undo.
All **68 files / 1,475 service-free cases**, lint, nonincremental
typecheck and single-worker build pass on the final source. Node profile samples
remain diagnostic; no product worker, dependency, protocol or migration is added.
The six-gate rerun initially had 36 browser scenarios; the added deep-quote
workspace scenario was then verified in a separate 37-scenario browser rerun.
The subsequent micro-UX pass rechecked the same 67 focused and 37 Chrome
scenarios plus lint, nonincremental typecheck and single-worker build after
reusing the UTF-8 encoder and adding the settled-preview shape error state.

The [keyboard/focus continuation](execution/TABLE_TOOL_NAVIGATION_2026-10-20.md)
extends the existing Chrome scenarios with forward/backward cross-page navigation,
focus after all four edge additions, and Shift+up/down selection in an input.
An intermediate last-row Enter regression and a separate failing selection baseline
remain recorded as failures, not passing attempts. The final rerun passes the same
**67 focused / 1,475 service-free / 37 Chrome** cases, plus lint, nonincremental
typecheck and one-worker build. These are strengthened existing cases, not extra
scenario counts.
Separately, five synthetic GFM fence/container-context mismatches were discovered
at that checkpoint. Their original failures remain separate from passing suites.

The latest [code-context continuation](execution/TABLE_TOOL_CODE_CONTEXT_2026-10-20.md)
repairs those five mismatches against identical actual GFM renderer output and
passes **71 focused / 68 files and 1,479 service-free / 41 Chrome** cases,
plus full Web lint, nonincremental typecheck and one-worker build.
The existing 500-case fence check now compares code-block output from installed
GFM rather than perpetuating the old scanner's known wrong semantics; the earlier
legacy-equivalence result stays historical. New tests cover source-bound tree
reuse, stale/incomplete context, header-only fallback, LF/CRLF and indented code.
The real workspace adds protected examples, outside-container recovery, nested-list
indentation and explicit code-table editing; transparent parser-call observation
checks reuse without substituting a fake parser. No comprehensive code-context,
real-device, full-app, server-memory or OOM acceptance is inferred.

The [edge-reachability continuation](execution/TABLE_TOOL_VIEWPORT_EDGES_2026-10-20.md)
retains failing wide-row/long-column baselines and expands Chrome to **45** cases.
New tests use actual coordinates, `elementFromPoint` and direct mouse/touch
actions, deliberately avoiding locator auto-scroll that could conceal offscreen
controls. Horizontal/vertical start, middle and end, 1440px/375px, 44px targets,
nonoverlap with the cell viewport, whole-draft additions and new-cell focus are
checked. Short landscape permits normal vertical scrolling of the dialog body,
not simultaneous visibility of an arbitrarily tall working area. Final local
gates rerun **71 focused / 68 files and 1,479 service-free**, lint,
nonincremental typecheck and one-worker build. Real-device/assistive-technology,
authenticated server, full Reader/Share/Offline/PWA and OOM boundaries remain.

The [literal-context checkpoint](execution/TABLE_TOOL_LITERAL_CONTEXT_2026-10-20.md)
adds three table and one reference checks for parser-recognized HTML/comment/
processing-instruction blocks, real tables outside them and offset-preserving
CRLF parsing. Its pre-edit **72 pass / 1 fail** and intermediate **72/1** and
expanded **72/3** attempts remain failures. Its then-authored gates passed **75 focused /
68 files and 1,483 service-free / 49 Chrome**, lint, nonincremental typecheck and
one-worker build. Browser checks use the actual full-source preview, not only an
isolated table; explicit selection still edits a sample without changing
`skipHtml` or its wrapper. Desktop/375px recovery copy is inspected.
Later actual-workspace probes exposed textarea-after-blank-line tables,
definition leakage and an introduced refusal of a real quoted table. Those
diagnostics stay separate: the smaller green gate did not establish HTML parity.

The [GFM-context continuation](execution/TABLE_TOOL_GFM_CONTEXT_2026-10-20.md)
uses an actual mounted ReactMarkdown/remark probe for frozen sources containing
`<`, with no output DOM or direct component-as-parser invocation. Source-bound
literal/definition ranges override the incompatible editor HTML grammar; absent,
stale, incomplete or oversized proof fails closed. Ordinary Markdown still
reuses the editor tree. Existing display-math/rich-layout projections are mapped
back to original source coordinates. The input limit is 1 MiB UTF-8, traversal
100,000 nodes and retained ranges 8,192; these are not parser-time/heap guarantees.
The newly authored browser baseline failed after 32 passes on an incorrectly
enabled textarea Apply. After repair, six local gates pass **83 focused /
69 files and 1,491 service-free / 56 Chrome**, lint, nonincremental typecheck and
one-worker build, with 18 affected source/test hashes unchanged during the run.
New cases exercise actual full-source previews, textarea/quoted boundaries,
reference captions, source preservation, Apply/Undo, proof reuse across grid/raw
edits, stale refresh, composed offsets and oversized-context explicit selection.
No server/real-device/full Reader/Offline/Share/PWA/OOM acceptance is inferred.

The [compact empty-state continuation](execution/TABLE_TOOL_EMPTY_STATE_2026-10-20.md)
retains 83 focused and 69 files/1,491 service-free cases, expands Chrome to **57**
and reruns the six Web gates. Its baseline passed the prior 56 scenarios before
finding the inert empty Markdown field. Existing protection checks now require
the field to be absent while Apply remains disabled; invalid identified-table
drafts still stay editable. New assertions cover the linked disabled reason,
Back to source, focus return and <300px dialog height at verified 1440/375px.
An intermediate green run had its intended mobile viewport reset by the shared
workspace helper; that screenshot is desktop evidence only. The final run sets
the viewport afterwards and asserts/records actual width instead of trusting
the test name or requested dimensions.

The [recovery-action follow-up](evidence/table-tool-recovery-actions-2026-10-20.json)
keeps the same 57 scenarios and six gates, but now requires unavailable Apply
to be absent and the explanation to describe the dialog. Its failing baseline
passed the preceding 56 scenarios before finding the dead action. Only
unavailable-table assertions changed; invalid/stale identified drafts still
require a present, disabled Apply, editable Markdown and unchanged source.
The preceding empty-state receipts remain historical, not relabelled.

The [input review](execution/ux-audit-table-input-2026-10-20.md) reproduces a
composing Escape closing the modal after the preceding 57 passing scenarios;
the shared-hook baseline is 17 passed / 3 failed. After fixing the common
keyboard owner, the focused run is **103/103**, including **20** common-focus
cases; all **69 files / 1,494 service-free cases**, **59 Chrome scenarios**, full
lint, nonincremental typecheck and single-worker build pass. Twenty affected
source/test hashes are unchanged during these gates. In addition to the DOM
event test, Chrome CDP starts composition in the cell and Markdown field and
observes trusted `isComposing` Escape; both retain focus/draft, then normal
Escape semantics are checked. Pre/post screenshots, traces and gate logs live
beside the audit. No physical candidate-window, Safari/Firefox, complete Share
browser or accessibility certification is claimed. Ad-hoc selector/asset-path
test-construction mistakes are recorded separately, not counted as product bugs.

The [HTML-cell review](execution/ux-audit-table-html-cells-2026-10-20.md) retains
the next baseline: 35 unit cases passed / 2 failed, then the 59 existing Chrome
scenarios passed before a literal HTML-code cell was refused. The complete and
incremental scanners now share structural-tag checks without rejecting code,
escaped tags or attribute prose. Final six gates pass **106 focused** (including
20 common-focus), **69 files / 1,497 service-free cases**, **61 Chrome scenarios**,
lint, nonincremental typecheck and single-worker build; 20 affected source/test
hashes stay unchanged. Real desktop Apply/Undo and 375px Chinese touch correction
are checked, as is one isolated large whitespace/angle fixture. An intermediate
104-pass/1-failure run had a mistaken link-caption versus reference-ID fixture;
its output and correction are preserved separately. Single-line CDP input
diagnostics are not native clipboard/TSV acceptance. HTML rendering remains inert,
and no broad code-grammar, resource or complete 43-point design certification
is claimed.

The [literal-backtick review](execution/ux-audit-table-code-span-2026-10-20.md)
retains an expanded **70-pass/4-failure** pre-fix baseline. The row scanner and
pipe serializer now distinguish unmatched literal runs from real code spans.
Final six local gates pass **111 focused** (42 table, 34 shared-renderer,
10 reference, five context and 20 common-focus checks), all **69 files / 1,502
service-free cases**, **62 Chrome scenarios**, lint, nonincremental typecheck
and single-worker build; 20 affected source/test hashes remain unchanged.
Independent seeded matching checks include escaped opening-run suffixes; an
isolated Node Worker preserves a full cell with 1,000 distinct unmatched runs.
Its 10-second watchdog is an anti-hang boundary, not a product latency SLA.
Actual installed GFM renders all 900 synthetic backtick/backslash/escaped-pipe
combinations identically before/after normalization, with idempotent output.
Raw unescaped pipes after literal ticks remain column delimiters; malformed rows
retain excess cells through the existing maximum-width padding, not an assertion
of identical truncated rendering. Desktop grid/raw editing, Apply/Undo and 375px
Chinese touch pass. The opt-in five-workload profile still sees large-table long
tasks. These receipts do not accept arbitrary Markdown, authenticated server,
cross-browser, clipboard, full PWA or server-memory/OOM behavior.

After setting task-specific process `TEMP` and `TMP` under the required `wkkk`
root:

```powershell
node --test scripts/ux/source-editor-table-context.test.mjs scripts/ux/source-editor-table-tools.test.mjs scripts/ux/source-editor-table-references.test.mjs scripts/ux/chatgpt-rich-text.test.mjs scripts/ux/share-tablet-navigation-dialog.test.mjs
node scripts/ux/source-editor-table-browser.mjs
```

The browser script compiles the actual workspace/form/CodeMirror, table dialog,
focus hook, renderer/parser, React Query and local CSS into a temporary loopback
harness using installed dependencies. API reads/writes, Next's client loader,
cleanup and unrelated assistant-ui/Shiki/Mermaid/preferences are explicit
synthetic adapters, not authenticated HTTP or Next routing acceptance.
The draft-parser and Markdown-renderer Promise holds are explicit transparent
test scheduling probes. They execute the actual implementation on release and
are not present in production files.
Installed Chrome is required. Generated assets/screenshots/results stay in the
task temp directory; result status is reset before each run and only becomes
passed after all scenarios and zero page/console errors. No API, login, user data,
CI, push or deployment.

## Accepted OOM release — 2026-10-19

Exact-source **50f6de4**, CI **39231559224** attempt 1, passes all five existing
jobs. Deployed image digests, API/Web/PostgreSQL health, worker heartbeat,
HTTPS/login-page smoke and current/direct-rollback markers passed independent
audit at **2026-10-19 12:27:23 UTC**. Applications still had zero restarts/OOM
at the post-cleanup **12:50 UTC** recheck. This is not authenticated browser,
Linux PID 1, full data comparison or 2 GiB/60-minute load acceptance.
See [actual release checks and preserved failures](execution/OOM_RELEASE_2026-10-19.md)
and [sanitized evidence](evidence/oom-release-2026-10-19.json).
The local failures below remain failures, not totals rewritten by later CI.

## OOM release preparation — 2026-10-19, historical checkpoint

The [release preparation](execution/OOM_RELEASE_2026-10-19.md) separates the
failed local single-process run (**1392 passed / 49 failed / 185 skipped**)
from a fresh-process, read-only-observed rerun of those 49 cases
(**49 passed / zero failures/errors/skips**). No production admission threshold
was lowered. Available host memory was sampled at 411.4 MiB while pytest's
working set was 2790.6 MiB, but the original assertions did not retain response
details: resource pressure is not asserted as the proven cause of every failure.
Local Web typecheck/lint and the source's single 0052 head pass. The existing
development database remains at 0028; it was not upgraded or used as a substitute
for CI's disposable PostgreSQL validation.

PowerShell checks now reject a nonzero native exit immediately, restore their
working directory on API/migration failures, and do not run subsequent gates
after failure. Nine isolated mocked-command failure/success paths pass.
These are script control-flow tests, not a new passing full release check.
The user authorized CI/deployment; pause after CI dispatch for their result.

## Local search/gzip OOM continuation — 2026-10-19, not released

This section preserves the pre-release audit checkpoint, not the subsequent
release authorization above.

The [continuation record](execution/OOM_SEARCH_GZIP_FOLLOWUP_2026-10-19.md)
and separate [index allocation](evidence/search-retention-2026-10-19.json) /
[compressed-input probe](evidence/compressed-admission-2026-10-19.json)
own this batch's measurements and correctness boundaries. Fifteen related API
modules pass **170/170** in three serial fresh-process batches (97 import,
54 search/draft/export-memory, 19 offline/edit/export). Six additional native
PostgreSQL 17 cases pass against an explicitly disposable database; the task
instance is stopped and its port closed.

The first combined run stopped at **160 passed / 2 failed**, with two small
import commits returning 400. Both cases pass in a separate two-test rerun and
in the complete 19-test related batch. A further combined rerun of the same
15 modules, with a read-only synthetic response observer and no admission
overrides added by that observer, passes **170/170**. The original failure is
not reproduced, is not counted as a pass, and is not attributed to memory
pressure without its response evidence.
These focused results do not rerun the earlier 219-module API checkpoint below.

New regressions are `tests/test_canjson_memory_bounds.py`,
`tests/test_search_memory_bounds.py` and
`tests/test_search_memory_bounds_postgres.py`. They cover bounded body/ID
reads, projected joins and newest-ready extracts, rollback and caller-held ORM
state, bounded gzip reads and expansion admission, resource-vs-mapping error
classification, and an actual initial-analysis task that fails safely then
retries the same ID to READY. No Web files or migration changed. Web/PWA,
Linux PID 1, cgroup/RSS and 2 GiB/60-minute acceptance remain unexecuted.
All 21 changed/new Python files compile, Alembic remains single head 0052,
and diff whitespace checks pass. No push, CI or deployment.

## Authorized local OOM follow-up — 2026-10-19, not released

This is the previous local source checkpoint, not a full rerun after the
search/gzip continuation above.
The [local repair record](execution/OOM_IMPORT_EXPORT_FOLLOWUP_2026-10-19.md)
and [allocation evidence](evidence/server-body-retention-2026-10-19.json) separate
small-fixture Python allocations/live bodies from server RSS/capacity.
Focused draft/body-bound regressions passed 30; fresh native PostgreSQL 17
snapshot and cursor/COPY regressions passed 9 + 1. All 219 API modules ran in
16 serial fresh-process batches: 1,416 passed / 179 conditional skips, no failures.
The interrupted one-process attempt is not a pass; its limits and fixture
headroom isolation are recorded in the closeout report.
Alembic remains single head 0052; no migration,
CI, push, deployment or production stress test.

The new regressions live in `tests/test_export_memory_bounds.py` and
`tests/test_import_draft_streaming.py`. PostgreSQL execution additionally uses
`tests/test_direct_export_snapshot_postgres.py`,
`tests/test_offline_snapshot_postgres.py` and `tests/test_cr_archive_postgres.py`
against an explicitly disposable database, not the development/production one.
Docker Linux is unavailable locally; Linux PID 1 and 2 GiB/60-minute acceptance
remain unexecuted, not passing or substituted by the Windows tests.

## Accepted exact-source release — 2026-10-19

CI **39135555660**, source **f3b331a**, attempt 1 passes all five jobs:
API **1562 passed / 3 real-fixture skips**, single PostgreSQL head/current
**20261017_0052**, all 13 Web/two settings gates. Default PWA is
**151 passed / 738 conditional skips**; adaptive recovery has **9 passed /
1 conditional skip**; settings is **463/0**, fresh-instance restore **1/0**.
Other gate counts and original artifact checks are in the
[release record](execution/FEATURE_RELEASE_2026-10-19.md).
Actual Linux signal/external POSIX worker tests passed in CI. Production
stopped-writer migration/data, lightweight health, HTTPS and authenticated
read-only acceptance pass. This does **not** complete Docker PID 1 shutdown,
60-minute/2 GiB soak, full production browser or production import stress tests.

## Authorized CI repair — 2026-10-18

[Run 39130940184 repair](execution/CI_QUALITY_REPAIR_2026-10-18.md) separates the
passing API job, pre-test ECR container failure, and six default-PWA fixture
failures. The background-import matrix now reads the initial fixture
preferences without writing them and returns a complete snapshot with newer
language/theme field revisions. It retains every lifecycle assertion and adds
explicit DOM language/theme assertions. All **12/12** combinations pass locally
with SSR language/theme revisions 73/78, using installed Chrome and synthetic
API responses; this is not a full-PWA or real-backend import acceptance.

The three CI quality jobs use `scripts/ci/postgres-service.sh start|stop`
instead of pre-checkout service pulls. **34/34** Node source/synthetic-shell
cases pass, including ECR exhaustion, same-digest official fallback, both-source
failure, readiness failure/timeout, identity guards and cleanup. No real Docker
or registry operation is performed by those tests. Web lint, nonincremental
typecheck, Bash syntax, pinned Actionlint 1.7.12 (without optional shellcheck/
pyflakes), and parsed old/new workflow preservation pass. Those were the local
repair checkpoint; the exact-source CI and accepted deployment above now
supersede its then-pending release boundary, not its local-test limits.

## Import/noise stability implementation record — 2026-10-18

The following section preserves the original local test evidence and its
limitations. Exact-source CI and production acceptance are recorded separately
in the [accepted release report](execution/FEATURE_RELEASE_2026-10-19.md).

[Stability evidence](execution/IMPORT_STABILITY_2026-10-18.md) distinguishes
read-only production OOM evidence from synthetic repair validation. Initial
import regressions passed 50, then 61; the final upload/admission plus actual
ASGI responsiveness suite passes **21** after adding the first-use semaphore
lock and all seven stored-source pressure paths. A controlled eight-thread
red test constructed eight independent gates per kind before repair; the
fixed test constructs one, with independent staging/analysis gates preserved.

Noise normalization reuse, Unicode/raw source offsets, protection confirmation,
reviewed deletion ranges and preview/apply validation pass **130**. An additional
**2** ORM-load/weak-reference cases prove only the current source row remains
live while loading the next in 20-message scans, at chunk sizes 1/20.
Candidate page projection has an independent query/allocation regression; a
100-candidate synthetic page now fetches one display-text projection, not
100 full MessageVersion entities. A 120-hit CRLF/LF fixture verifies the
constant-memory line/column cursor matches the old code-point offsets.
Late-corrupt streamed drafts are tested against real canonical persistence and
must leave no earlier conversation behind; the SQLite outer-transaction
regression and final larger checkpoints are recorded in the linked evidence.
These are not Linux/cgroup/RSS or 60-minute/2 GiB soak results. No production
stress, proactive CI, push or deployment was performed.

Memory-admission hardening adds a targeted **37 passed** checkpoint for host vs.
nested cgroup-v1/v2 available-memory selection, input-scaled estimated headroom,
immediate retryable rejection and fail-closed behavior when the memory probe is
unknown. It also verifies that the configured multipart spool threshold causes
an over-threshold file to spill before the endpoint runs, closing the
pre-admission multi-file memory path. This is functional guard coverage, not a
measured bound on Python JSON object expansion or a resource-load acceptance.

The synthetic `analyze_json` allocation probe is source-hash-bound in
`evidence/import-analysis-memory-2026-10-18.json`: transcript-like input was
4.47× and dense small-object input 25.01× the input size in peak traced
allocations. The configured admission factor is 32 as a conservative margin
over these examples; it is not a hard bound or a production/RSS measurement.

## Local Unicode normalization — 2026-10-17

The [Unicode follow-up](execution/NOISE_UNICODE_NORMALIZATION_2026-10-17.md)
reproduced **23 failed / 5 passed** before the repair. Final related cleanup
regression passes **237 / 1 skipped** across 22 non-PostgreSQL modules, including
43 new cases. The outside-symlink capability skip and Starlette/httpx warning
remain explicit. Runtime Unicode 14.0.0 checks enumerate every scalar with
decomposition metadata, nonzero combining class, changed casefold, or a
precomposed Hangul value: 18,859 scalars in three contexts/two case settings
(**113,154 comparisons**), plus 2,000 deterministic mixed cases. Separate
vectors cover Hangul Jamo composition. These compare the complete shadow key to
standard-library NFKC → optional casefold → whitespace collapse; they are not
the external Unicode conformance corpus.

Additional tests cover nonmonotonic source spans, stable equal-class ordering,
interleaved composition, bounded work on an 8,193-code-point combining run,
raw exact non-normalization, normalized/fuzzy protection, and four real API
trial/learn/refine/preview/apply workflows. Pre-repair partial-match consent
conflicts under current validation instead of expanding to newly matched text.
Separate fresh PostgreSQL 17 Unicode/range/source suites pass **10/10**,
including canonical version history and offline revision publication; both
task clusters stop cleanly. Synthetic function-only timing/allocation retains
the first implementation's higher costs and the compact-origin follow-up;
ordinary fast-path and full-provenance costs are distinguished.

No full API/PostgreSQL 16, Web/build/browser, Reader/Share/Offline package,
Linux PID 1, service RSS/load or production acceptance is implied. Schema stays
0051; existing databases, imports and production are untouched. No CI, push or
deployment occurred.

## Local literal matching — 2026-10-17

The [literal follow-up](execution/NOISE_LITERAL_MATCHING_2026-10-17.md) passes
**194 / 1 skipped** across all 20 cleanup non-PostgreSQL modules, including
18 new cases. The skip is the existing environment-dependent outside-symlink
case; the Starlette/httpx deprecation warning remains. This includes 3,000
differential Unicode boundary samples and real API trial/learning, cross-page
selection, two-range refinement, preview and canonical application of 51
actionable candidates while preserving the protected match.

Separate fresh PostgreSQL 17 range/source suites pass **7/7** after the final
implementation; both task clusters stopped cleanly. Neither existing databases
nor production were used. Synthetic boundary-only allocation/timing evidence
records both improvements and the long-whitespace timing tradeoff; it is not
service RSS or OOM/load acceptance. Three probes still reproduce cross-character
NFKC equivalence misses at that checkpoint; the Unicode follow-up above owns
their later repair. No full API/PostgreSQL 16,
Web/browser/build, Reader/Share/Offline or Linux PID 1 gate is claimed for this
batch. Syntax, links, source-bound JSON and diff checks pass. No CI, push or
deployment occurred.

## Local cooperative worker shutdown — 2026-10-17

The [source-only follow-up](execution/WORKER_SHUTDOWN_2026-10-17.md) passes
**127 / 4 skipped** across eight related API modules: shutdown, liveness,
import queue, context return, export retention, tasks, observability and offline
task recovery. Real Python SIGTERM/SIGINT dispatch, early-import stop, handler
restoration, idle deadlines and import/job/noise claim/drain boundaries pass;
SQLite compensation additionally preserves independently committed cancellation,
non-processing/missing rows and attempt floors. Four external POSIX signal
process cases are explicitly skipped on Windows. Separate disposable
PostgreSQL 17 coverage passes **4/4**: real cancellation row-lock waits and the
reverse compensation-then-cancellation order for ordinary/noise jobs. Its
initial missing-owner fixture errors were fixed without weakening constraints.
Both fresh clusters stopped cleanly; existing databases were not used.
Docker Desktop's Linux engine is unavailable and was not started; Linux PID 1,
full API/PostgreSQL, memory/load and Web gates are not claimed for this batch.
Cold CLI import does not load ORM/services; six Python syntax checks, links
and diff checks pass. One existing Starlette/httpx deprecation warning remains.
No CI, push, deployment or production change was made for this batch; at that
checkpoint production remained 3e68d1f/0051. The later accepted release and
current production state are in the
[release report](execution/FEATURE_RELEASE_2026-10-19.md).

## OOM stability repair and release — 2026-10-17

The follow-up record distinguishes established kernel `global_oom` cause from
broader unproven memory-leak hypotheses. Targeted application/API and synthetic
script tests pass **112 / 3 skipped**, a separate disposable PostgreSQL 17 test
passes **2/2** (transaction-local read-only/timeouts plus the exact production
heartbeat SQL), and Linux synthetic shell tests pass **27** with zero Docker
calls. These focused checks remain distinct from the subsequent full workflow:
exact-source **3e68d1f**, CI **38933466143** attempt 2 now passes all five jobs.
Original artifact **12082341034**, 50 OCI blobs, embedded repair source and
exact-source support independently pass. King accepted this source on
2026-10-17 at 00:53:53 UTC with no migration/PostgreSQL restart/configuration
change. Docker images, lightweight worker heartbeat, HTTPS/redirect and public
diagnostics 404 pass; all three applications have zero restarts/OOM/startup
error-keyword lines at acceptance. No production full diagnostic, new full
data-hash sweep or interactive browser verification is claimed. See
[acceptance and backup limits](execution/OOM_STABILITY_2026-10-17.md#accepted-release).

## Exact-source CI and production boundary — 2026-10-16

Source `aea13fe4ed3a725b0c88138702248eab5c8dac5b` passes all five jobs
of run **38902167421**, attempt 2. API is **1,288 passed / 3 skipped**,
PostgreSQL 16 single head/current 0051; concurrent range saves and the
consent-revoking downgrade both pass. All **13 Web gates** pass, including
dedicated noise-range mobile/desktop cases **2/2**, authentication **18/18**,
negative PWA **19/19**, and default PWA **139 / 737 conditional skips**.
Adaptive import has one separate conditional skip. Settings is **463/463**
plus one fresh-instance restore; its successful attempt-1 artifact is retained,
not relabelled as newly executed in attempt 2.

Original Web/settings ZIP digests, image artifact **12050797955**, all 50 OCI
blobs, embedded source/support and 14 selected synthetic screenshots were
independently checked. These supersede earlier “new exact-source CI required”
checkpoints only for this exact source. Production acceptance subsequently
passed on 2026-10-16: verified original backup, user-authorized non-deleting
isolation of 12 files, exact 0050→0051 upgrade, 84-table all-old-column comparison,
four storage roots, 313 attachment hashes and 67 live stable counts. HTTPS,
18 authenticated read API routes, three HTML documents, three exact Skill ZIPs,
logout 204 and private-after-logout 401 pass. New services have zero restarts/OOM
and startup error-keyword lines; PostgreSQL/configuration remain unchanged.
The earlier old-API OOM and blocked preflight are historical, not erased.
Task artifact/guard tests pass 9/11, and the new isolation helper passes all
14 Linux synthetic regressions (Windows: 13 pass / one Linux-only skip).
These are operation-helper checks, not reruns of the application CI.
No production interactive-browser/real-device/assistive acceptance or live
full-hash sweep is claimed. See the [accepted release](execution/UX_RELEASE_2026-10-16.md#accepted-low-memory-deployment).

## Full service-free UX continuation — 2026-10-16

The [continuation record](execution/ux-audit-service-free-regression-2026-10-16.md)
owns initial failures, adapter repairs, the separately reproduced Share entry
defect, and adjacent evidence. All **63** current UX Node files passed
**1,412/1,412**, with zero failed/skipped/cancelled cases. Full
`corepack pnpm run lint` and nonincremental Web typecheck passed. Prior
“unexecuted” notes below describe their original batch; the exact Node file
manifest in this record supplies the newer result, not acceptance of other
tests or browser/runtime paths.

For the explicitly authorized 2026-10-16 release path, Web build passed and full
local API tests finished **1,129 passed / 159 skipped / 0 failed** in 2,622.35 s.
The skips include PostgreSQL-only cases; CI must run them against its isolated
PostgreSQL. The local PWA attempt built successfully, then stopped after two
90-second browser timeouts because the API at `127.0.0.1:8000` was not running.
This is not PWA acceptance; CI owns the complete-service browser gate.
`alembic heads` has one head, `20261015_0051`. The existing local database remains
at `20260823_0028`, so `verify_migration_state.py --require-current` did not pass;
no upgrade of that pre-existing database was attempted.
An entirely separate task-local PostgreSQL 17 cluster then supplied unique
disposable databases: adaptive import **8 passed / 1 conditional skip**, and
real range migration/concurrent-edit tests **2 passed**. Local browser repair
and fixture differences are recorded in the [release execution](execution/UX_RELEASE_2026-10-16.md);
the 241-case batch passed 235 and initially failed six; those six passed after
adapter repairs. These are separate runs, not one 241-case clean result.
Dependency-matched API transport reproduction and its retained download/expiry
assertions are recorded there too. These do not replace PostgreSQL 16/full CI
acceptance.
The subsequent settings follow-up preserves its failed 27/28 and 26/28 runs.
After the notebook risk-effect repair, real keyboard/reload/save cases passed
**10/10** repetitions at 375/1440px without typing delays or uncaught page
errors. The current serialized 64-file UX Node suite passes **1,419/1,419**
without skips; lint, nonincremental typecheck, production build and 13 CI
source contracts pass. The focused task API file passes **20/20**, including
three real independent-commit transitions. These are local, bounded checks,
not complete PostgreSQL 16/settings/PWA/CI acceptance.
The later CI-failure repair is separately recorded in the same execution
record: run 38857719980 passed API but failed settings (460/3) and baseline
PWA (137/2). Local fault injection reproduced both offline failures before
repair. The durable-notebook save admission regression also failed before
repair; its pending-storage counterpart preserves the readiness recheck and
no-replay rule. After that repair all **64 UX Node files / 1,421 cases**,
**15 CI contracts**, lint, nonincremental typecheck and production build pass.
After the scoped-cleanup failed-sync fixture was given an explicit finite
response barrier, the actual five associated settings files passed **105/105**
(three repetitions); the default PWA baseline passed **139 / 737 conditional
skips / zero failed**. Earlier intermittent failures and diagnostic-copy
results are listed separately; these do not assert full CI or deployment
acceptance.
Run 38874465008 (`a1322b6`) then passed the full PostgreSQL 16 API suite
**1,288 / 3 skipped**, head/current 0051, and default PWA **139 / 737 conditional
skips**, but its authentication gate passed 16, failed one obsolete Share-unlock
error-copy assertion and did not run the final serial case. The negative PWA
gate was not reached. Original ZIP digest/trace verification proves the actual
unlock returned 401 and kept content protected with the current bounded copy.
The original assertion also reproduced locally (**16 passed / 1 failed /
1 not run**). Its test-only repair requires that exact current copy plus
rejected/accepted statuses, retained input, one POST per explicit attempt and
no owner-session cookie for the guest. The actual full auth files then passed
**18/18**; a separate protected-Share repetition passed **5/5**, Share lifecycle
Node checks **23/23**, full lint and nonincremental typecheck passed.
Production code, API/auth behavior, test inclusion and CI bounds are unchanged;
new-source full CI remains required.

The following run **38879420622** (`59ce9d7`) passed API **1,288 / 3 skipped**,
head/current 0051, settings **463 plus one fresh-instance restore**, and the
first 12 Web gates, including all **18** authentication cases. Its last
negative PWA gate passed 17 and failed a Chinese-only Viewer assertion against
the correct English uncached-resource message. Both original quality ZIP
digests and the failed browser context were verified. That original case also
failed locally before editing. The first test-only follow-up ran the Viewer
case with real `en-US` and `zh-CN` server preferences, restoring the original
locale in `finally`; its local fixture had API authentication disabled.
Run 38885644480 attempt 2 subsequently exposed the private preference calls'
401 responses after the authenticated API restart. The current test instead
sets browser `Accept-Language` and checks the actual SSR document language,
without private preference/session reads or writes. It still requires actual
cache deletion, exact localized text, visible and enabled Retry, modal focus,
Escape and trigger-focus restoration.
The complete actual negative file passed **19/19**, with a separate bilingual
five-repetition run **10/10**, no skips or flaky cases. Attachment Node checks
passed **65/65**; full lint, nonincremental typecheck and the production
negative-test build passed. This does not accept the failed CI or replace the
next exact-source complete run; no product, API, schema, workflow or timeout
changed.

The corrected fixture was also run with CI's actual post-auth split:
API authentication enabled, ordinary PWA Web mode, and an explicit anonymous
preferences precondition of **401**. Unmodified `cb223d7` Viewer tests reproduced
**two 401 failures**; the corrected complete file passed **19/19** (58.66 s),
with a separate five-repetition bilingual run **10/10** (50.74 s). The earlier
auth-disabled corrected runs passed **19/19 + 10/10** separately. These use
the existing production negative-test bundle because no application source
changed; they are not a new build or complete CI pass.

The staged source/document whitespace check excludes archived `*-evidence/`
console transcripts: those raw logs intentionally retain emitted whitespace
and initial-failure output rather than being rewritten as clean test results.

Reproduce in PowerShell with task-specific process-local TEMP/TMP:

```powershell
$tests = Get-ChildItem -LiteralPath scripts/ux -Filter '*.test.mjs' |
  Sort-Object Name | ForEach-Object { $_.FullName }
node --test --test-concurrency=1 @tests
```

These are source, installed-library and controlled-hook/DOM/transport adapters
(some include actual React server markup), not mounted React, real
IndexedDB/Worker, browser/focus/assistive, PostgreSQL migration/concurrency,
full PWA or CPU/RSS acceptance. The newer release preflight is listed separately
above and does not relabel the earlier service-free batch. CI and deployment
were explicitly authorized on 2026-10-16 and remain pending; no production
acceptance is claimed.

## Noise candidate exact inline markers — 2026-10-16, local checks

The [source audit](execution/ux-audit-noise-candidate-range-markers-2026-10-15.md)
was recorded on October 15 before editing; final verification crossed local
midnight into October 16. `node --test scripts/ux/cleanup-range-selection.test.mjs
scripts/ux/cleanup-candidate-markers.test.mjs` passed **13/13**: six actual-helper
cases and seven real React server-markup cases. They cover exact Unicode/CRLF
parts, malformed refinements, retained text, full/null legacy choices, stable
summary/name/description semantics, eligible pending choices, ineligible states,
APPLIED-with-stale completion and escaped HTML-like text. React hooks/dependencies
are real, not mocked; the rows remain in their default collapsed SSR state.

Targeted Web ESLint (candidate, helper, range editor, zero warnings),
nonincremental Web typecheck and diff whitespace passed. The existing layout
E2E's unselected highlight assertion was preserved, not weakened, but E2E
did not run. No API or migration changed, so the prior 65-case API result was
not rerun or relabelled as a new result. No service, auth, browser/CSS,
mounted-event, expanded-row/focus/assistive verification, PostgreSQL migration,
build, commit, push, new CI or deployment ran.

## Noise candidate editable ranges — 2026-10-15, local checks

The [range-editing report](execution/ux-audit-noise-range-editing-2026-10-15.md)
records the focused results and limitations. The synthetic API batch runs
`test_cleanup_safety.py`, `test_cleanup_source_replacement.py`,
`test_cleanup_validation_work.py`, `test_cleanup_selection_summary.py`,
`test_cleanup_reviewed_ranges.py` and `test_cleanup_preview_ranges.py` using
in-process TestClient/SQLite, not a listening API. It checks refined Unicode
ranges, preserved detector/source/version data before apply, whole-range reset,
KEEP/reselect, cross-page bulk choices, stale source/token, malformed ranges,
protection and exact preview/apply equivalence. Final result: **65 passed**
(67.41 s), including 60 candidates across two pages and two conversations, with
61 effective removal intervals. This supersedes the intermediate 61-case run.

`node --test scripts/ux/cleanup-range-selection.test.mjs` passed **4/4** over
the actual TypeScript helper: retained text, fail-closed validation, native
UTF-16/LF → canonical Unicode/CRLF mapping and nonmutating merge.
Targeted Web ESLint and `pnpm --filter web exec tsc --noEmit --incremental false`
passed. The initial typecheck exposed an impossible loading comparison in the
earlier import restore error branch; the minimal correction retains its separate
loading status. The earlier API failure was an invalid test setup attempting to
replace the immutable initial version; the fixture now creates version 2 before
testing same-ID replacement. Product immutability was not relaxed.

`test_cleanup_ranges_postgres.py` authors competing-edit and safe-downgrade
checks; the updated owner-isolation case is in `test_cleanup_access.py`.
Neither ran. `alembic heads` reports only `20261015_0051`; this is revision-graph
inspection, **not migration execution**. No PostgreSQL, Web/API service,
authentication flow, browser/render/focus/assistive test, build, full release
gate, commit, CI or deployment was run. Future separately authorized acceptance
must include PostgreSQL upgrade/downgrade/concurrency and keyboard/touch review,
dirty close, unknown saves, selected-only pagination and all theme/viewport states.
Task temporary data stays under the batch-specific desktop `wkkk` directory;
no user import storage was changed.

## Adaptive import session action lifecycle — 2026-10-15, source only

The [session-action report](execution/ux-audit-import-session-action-lifecycle-2026-10-15.md)
records the pre-edit concurrent full-snapshot publication and stale grouping
assignment evidence. `scripts/ux/adaptive-import-session-action-lifecycle.test.mjs`
extracts the actual adaptive workspace, mapping workspace and health-check
source. It checks the single action lease/token, current import ownership,
success/failure release path, disabled competing controls and grouping
resynchronization. It remains **unexecuted**.

The source check does not mount React, exercise Query mutation timing, call the
API, establish server transaction ordering or prove browser keyboard/
screen-reader behavior. After authorization, use task TEMP/TMP for the focused
import checks and related Web gates, then slow-response, rapid-control,
reanalysis and keyboard acceptance. No tests/gates, syntax check, build,
services, product browser, commit, CI, deployment or resource measurement ran.

## Source-editor attachment picker dialog — 2026-10-15, source only

The [dialog report](execution/ux-audit-source-editor-attachment-picker-dialog-2026-10-15.md)
records the picker’s missing shared focus lifecycle. `scripts/ux/source-editor-attachment-picker-dialog.test.mjs`
extracts the actual picker and checks the shared hook import/call, outer dialog
ref, initial search focus, backdrop exclusion and the unchanged hook's
Escape/Tab/restoration branches.

All assertions are **unexecuted**. Static source and shared-hook checks are not
mounted React, browser keyboard, screen-reader, mobile or nested-modal
acceptance. After authorization, use task TEMP/TMP for focused editor/dialog
checks and related Web gates, then real focus/close/scroll acceptance. No
tests/gates, syntax check, build, services, browser, commit, CI, deployment or
resource measurement ran.

## Source-editor discard-and-switch cleanup — 2026-10-15, source only

The [source-editor report](execution/ux-audit-source-editor-discard-switch-2026-10-15.md)
records that the navigation banner bypassed the editor's existing attachment
cleanup path. `scripts/ux/source-editor-discard-switch.test.mjs` extracts the
actual workspace cleanup, close handler, discard-and-switch handler, unmount
effect and pending-banner JSX, then checks cancellation/deletion/invalidation,
busy-ref coalescing, finite failure feedback and parent switching only after
cleanup.

All assertions are **unexecuted**. This is an AST/source binding, not mounted
React, real upload/cancel timing, server-object cleanup, browser focus or
resource evidence. After authorization, use task TEMP/TMP for the focused
editor/attachment checks and related Web gates, then slow-upload, navigation
switch, retry/focus and server-object acceptance. No tests/gates, syntax check,
build, services, browser, commit, CI, deployment or resource measurement ran.

## Share edge-window loading lifecycle — 2026-10-15, local verification

The [edge-loading report](execution/ux-audit-share-edge-loading-lifecycle-2026-10-15.md)
records the missing active-visit/error-owner guard in the previous/next
complete-turn loaders, followed by the 2026-10-16 retired-entry finding.
`scripts/ux/share-edge-loading-lifecycle.test.mjs`
extracts both actual nested loaders and asserts current success, unmount
completion/rejection, same-visit direction reversal, no stale edge error,
merge/capture/restore suppression, retired-entry zero-work and current-failure
positive controls. All **9/9** passed in the full 2026-10-16 local run.

Transport, refs, anchor helpers, leases,
state setters and layout are controlled adapters, not mounted React, browser
scroll geometry, real slow response or CPU/RSS evidence. Full Web lint and
nonincremental typecheck also passed. Actual edge scroll/reversal/unmount and
stable-anchor acceptance remain open. No build, services, browser, commit, CI,
deployment or resource measurement ran.

## Share unlock lifecycle — 2026-10-15, source only

The [unlock report](execution/ux-audit-share-unlock-lifecycle-2026-10-15.md)
records pre-edit duplicate/stale submit and gate-state evidence.
`scripts/ux/share-unlock-lifecycle.test.mjs` extracts the actual visit factory,
complete visit layout lifecycle, unlock state/ref/reset/edit/submit callbacks
and actual parent gate JSX/helper. Authored cases cover pre-render duplicate
admission and pending edit, unchanged whitespace, finite current 401/429/500
feedback in both locales, error-clearing edit/retry, success versus failed
metadata read, and delayed POST/read completion or rejection after visit,
unmount or layout replay. Old finally must not clear a newer owned attempt.
Native form submission/default prevention and busy/input/label/autocomplete
markup are included.

All assertions are **unexecuted**. Hook scheduling, unrelated Reader resets,
transport/query outcomes and static markup are controlled adapters, not mounted
React, real authentication/cookies, password-manager, keyboard or announcements.
After authorization, use task TEMP/TMP for the focused regression, related
Share checks and relevant Web gates, then actual slow-response/token-switch
and keyboard/password-manager acceptance. No tests/gates, syntax check, build,
services, browser, commit, CI, deployment or resource measurement ran.

## Share stored-position shape — 2026-10-15, source only

The [shape report](execution/ux-audit-share-position-shape-2026-10-15.md)
records pre-edit unchecked parsed records reaching query/anchor dereference
and numeric alignment. `scripts/ux/share-navigation-retirement.test.mjs`
extends its actual helper/initialization/query/restore extraction with
synthetic invalid root/message/anchor/offset/index cases, valid overflow JSON,
normal store readiness and unanchored-query/restore-skip assertions.
Current v2, legacy v1, numeric anchor hints, minimal message-only records,
nullable/missing block index, finite pixels and extra metadata have authored
unchanged-record/query/restore/no-read-time-write assertions.

All additions are **unexecuted**. Digest/storage/queries, hooks, transport,
DOM/leases/mounted positioning and timers remain controlled adapters. No
browser storage or accuracy/geometry/CPU result is asserted. After
authorization, use task-specific TEMP/TMP for the shared regression, existing
Share storage/sheet/tablet checks and relevant Web gates, then real corrupt/
current/legacy browser records and true-anchor/no-jump acceptance. This does
not validate well-shaped stale or out-of-scope targets. No tests/gates,
syntax check, build, services, browser, commit, CI or deployment ran.

## Share position-storage recovery — 2026-10-15, source only

The [storage-recovery report](execution/ux-audit-share-position-storage-recovery-2026-10-15.md)
records pre-edit blocked digest readiness, silent/uncaught storage failure and
post-discard writer resurrection evidence.
`scripts/ux/share-navigation-retirement.test.mjs` is updated but **unexecuted**:
its actual initialization/key/read/query extraction now authors digest/read
failure settlement, unchanged corrupt-JSON fallback, retired rejection,
disabled-visit replay without probing and a fresh visit recovering normally.
The fixture adds only the required failure-ref/setter/read adapters.

`scripts/ux/share-position-storage-recovery.test.mjs` is authored but
**unexecuted**. It reuses exact persistence/discard effects, status
classification/error class and the actual fixed-header status JSX. Proposed
cases cover unchanged idle timing/key/bytes and cached unload without capture,
one contained quota/access failure before/after rerender, successful/denied
permanent removal that cannot be undone by retained writers, password/
transient retention, stale visit/store/effect timer/frame/unload guards and
finite translated current-visit feedback in the original fixed-height line.

Hooks/commit scheduling, position capture, DOM/layout, query snapshots,
digest/storage and time/events remain controlled adapters. No real crypto,
blocked/quota browser storage, durable deletion, mounted React, scroll or
announcement result is asserted. After authorization use task-specific
TEMP/TMP for both files, existing Share sheet/tablet regressions and relevant
Web checks, then actual denied/quota/crypto, reload/restore/access/password,
no-document-shift and announcement acceptance. Position shape has the separate
source-only follow-up above; well-shaped stale/out-of-scope targets,
indefinitely pending digest and edge/unlock lifetimes remain separate.
No tests/gates, syntax check, build, services, browser, commit, CI, deployment
or resource measurement ran.

## Share tablet navigation dialog — 2026-10-15, source only

The [tablet-dialog report](execution/ux-audit-share-tablet-navigation-dialog-2026-10-15.md)
records pre-edit missing modal semantics/focus-lifecycle evidence.
`scripts/ux/share-tablet-navigation-dialog.test.mjs` is authored but
**unexecuted**. It extracts the actual Share visibility/ref/hook call and
section attributes and reuses the entire unchanged `useDialogFocus` module.
Proposed cases cover translated modal name/ref/fallback tab index, visible
tablet-only ownership, initial focus and boundary Tab wrapping, current close
handler/Escape, rerenders without refocus, top-dialog arbitration, cleanup
on close/viewport/hidden/unmount, no-scroll opener restoration and a newer
modal retaining focus during delayed restoration.

Hooks/layout/ref attachment, DOM geometry/modal ordering, keyboard/focus and
timers are controlled adapters. No mounted React/Vaul, true tab order,
background inertness, screen-reader, browser, transport, anchor or resource
result is asserted. The existing `e2e/share-drawer-focus.spec.ts` exercises
owner share creation, not this public navigation drawer. After authorization,
use task-specific TEMP/TMP for the new regression, existing Share sheet/core
regressions and relevant Web checks, then public/unlocked tablet keyboard/
screen-reader, close/reopen/breakpoint and no-reading-anchor-movement
acceptance. No tests/gates, build, services, browser, commit, CI or deployment ran.

## Reader navigation-sheet lifecycle — 2026-10-15, source only

The [Reader sheet report](execution/ux-audit-reader-navigation-sheet-lifecycle-2026-10-15.md)
owns pre-edit cross-utility auto-close, stale feedback and cancellation evidence.
`scripts/ux/reader-navigation-sheet-lifecycle.test.mjs` is authored but
**unexecuted**. It extracts actual scope/ref/state/effect, stable utility/tab/
activation callbacks and the existing visit/account guard. Actual shared
index/TOC JSX callers, TOC target helper and both status fragments are reused.
Proposed cases cover current outcomes in mode/viewport adapters, duplicate/
newer targets, reversed completion, every utility transition before parent
render, batched/sequential close/reopen, tab/viewport/source/conversation/
account/editor/hidden/unmount retirement, same-scope replay, stable callback,
version/locator/query-policy wiring and render-time translated flags.

Core navigation, hooks/layout scheduling, parent/activation state, availability and
account clock are controlled adapters; mode labels do not prove real offline
reads. Fragment static markup is not a mounted overlay, focus or announcement
result. No pass count or real API/QueryClient/Vaul/DOM/resource result is
asserted. After authorization, use task-specific TEMP/TMP, run the new file,
existing Reader retirement and offline query-policy checks/relevant Web gates,
then online/offline phone/tablet real-anchor, rapid/slow/failing selection,
manual takeover and navigation-to-other-utility/browser acceptance. Delayed
workspace-open/source-editor confirmation work remains separate. No tests/
gates, build, services, browser, commit, CI or deployment ran.

## Share navigation-sheet lifecycle — 2026-10-15, source only

The [sheet-lifecycle report](execution/ux-audit-share-navigation-sheet-lifecycle-2026-10-15.md)
records pre-edit stale completion and uneven feedback evidence.
`scripts/ux/share-navigation-sheet-lifecycle.test.mjs` is authored but
**unexecuted**. It extracts actual Share visibility/scope/state/effect/handlers,
all four mobile/tablet index/TOC JSX callers, the TOC target helper and both
status JSX placements. Proposed cases include current success/failure/
exception/cancel, pending coalescing/newer choice, reversed completion,
synchronous close/tab retirement, reopen/viewport/visit/hidden-state/unmount,
same-scope effect replay, unchanged desktop routing and translated status.
The source-only follow-up adds phone/tablet same-batch close/open and
same-value explicit open: each gets a fresh activation scope, retained old
callbacks cannot admit before/after render, and old completion cannot clear
the new pending state or close the new surface.

Hooks/layout scheduling, parent/activation state and core navigation are controlled
adapters; authored static-markup assertions concern only extracted status
fragments, not mounted React/Vaul or announcements. No real API, QueryClient,
DOM alignment, browser geometry, physical cancellation or CPU/RSS result is
asserted. After authorization, use task-specific TEMP/TMP, run the new file,
`scripts/ux/share-navigation-retirement.test.mjs` and relevant Web checks, then
public/unlocked phone/tablet slow/failing/rapid choice, manual takeover,
dismiss/reopen, breakpoint and focus/announcement acceptance. Common Reader
sheet completion and Share tablet modal/keyboard wiring have the separate
source follow-ups above; runtime acceptance remains pending. No tests/
gates, build, services, browser, commit, CI or deployment ran.

## Share navigation and saved-position retirement — 2026-10-15, source only

The [Share retirement report](execution/ux-audit-share-navigation-retirement-2026-10-15.md)
records evidence before product edits. The new
`scripts/ux/share-navigation-retirement.test.mjs` remains **unexecuted**.
It extracts the actual Share navigation callback, visit/storage/initial-window/
restore effects, nested manual-intent callback and local key/position/window
helpers. Authored cases cover exposed stage success/rejection after replacement,
unmount/token/input and effect-replay retirement, inactive admission, lease/
timer cleanup, current finite failures, optional resolver compatibility,
legacy four-argument navigation, same-intent restore fallback order/offsets,
cancellation/takeover, early explicit choice and scoped/delayed storage keys.
The position-storage follow-up above extends its initialization/error cases
and required controlled adapters; those additions also remain unexecuted.

Hooks, query snapshots, digest bytes, storage, transport, leases, DOM lookup,
alignment/settling and timers are controlled adapters, not mounted React,
real Web Crypto/localStorage/QueryClient, browser geometry or physical abort.
No pass count, focus/announcement or resource result is asserted. After
authorization, use task-specific TEMP/TMP, run the new file and relevant
existing Reader/Share/Web gates, then public/unlocked Share real-anchor,
rapid choice/manual takeover, token switch and close/reopen acceptance.
Sheet-owned completion and crypto/storage failure recovery have separate
source-only follow-ups above; edge/unlock remain separate. No tests/gates,
build, services, browser, commit, CI, deployment or CPU/RSS measurement ran.

## Reader navigation retirement — 2026-10-15, source only

The [retirement report](execution/ux-audit-reader-navigation-retirement-2026-10-15.md)
records evidence before editing. The new
`scripts/ux/reader-navigation-retirement.test.mjs` remains **unexecuted**.
The updated `scripts/ux/conversation-search-selection.test.mjs` was later run
as a shared adapter and passed 48/48, but that result does not verify the
Reader-retirement-specific cases below.
The focused new adapter extracts actual navigation/search publication/clear
callbacks, visit guard, source reset effect and local locator/window helpers.
Proposed cases cover late context/neighborhood/fallback reads, lease/mount/
settle completion and rejection, newer-in-progress protection, visit/account/
unmount admission and predicates, current finite failures and server locator
reasons, local/remote/offline paths, footer dismiss/replace/visit retirement,
normal footer publication, source/conversation locator-validation reset and
reset-cleanup token retirement even when the same owner becomes active again.

Hooks, timing, state publication, transport/neighborhood loading, leases,
geometry, mounting/alignment and layout settling are controlled adapters.
No mounted React, physical request cancellation, true DOM geometry, actual
device focus/announcements or resource result is asserted. The older
`scripts/ux/reader-navigation-readiness.test.mjs` remains important acceptance
coverage but was not rerun; its historical pass count does not verify this
batch. After authorization, use task-specific TEMP/TMP, run all three focused
files plus relevant Web gates, and accept remote/offline/Share real-anchor,
rapid selection, old rejection, source switch, retry and footer dismissal in
the browser. No tests/gates, build, services, browser, commit, CI, deployment
or CPU/RSS measurement ran.

## Conversation-search navigation lifecycle — 2026-10-15, source only

The [lifecycle report](execution/ux-audit-conversation-search-navigation-lifecycle-2026-10-15.md)
records evidence before edits. The shared
`scripts/ux/conversation-search-selection.test.mjs` now includes controlled
pending duplicate activation, newer-intent supersession, raw-query/filter/
source/conversation retirement, desktop hide/return, close/Escape/unmount,
finite bilingual failure/retry and cancellation cases. It also extracts the
actual Reader search adapter for preflight, late-publication, reversed
completion, optional two-argument compatibility and exact locator checks.
The existing offline-search-retry adapter now supplies the layout hook.
The shared component file was executed on 2026-10-16 as part of the selection
continuation and passed 48/48; the offline-retry file remains **unexecuted**.

The harness adapts real source but controls hooks/layout effects, query state,
timers, navigation promises and publication setters. It does not mount React,
exercise real QueryClient/Worker/API/DOM anchors, actively cancel navigation,
verify focus/announcements or measure resources. After authorization, use
task-specific TEMP/TMP, run the offline-retry file/relevant Web gates, then
remote/offline rapid tap/Enter, query/filter edits, close/reopen and
source-editor hide/return browser acceptance. No tests/gates, build, services,
browser, commit, CI, deployment or CPU/RSS measurement ran.

## Conversation-search occurrence selection — 2026-10-15, local verification

The [conversation-search report](execution/ux-audit-conversation-search-selection-2026-10-15.md)
records source evidence before editing.
On 2026-10-16, `scripts/ux/conversation-search-selection.test.mjs` passed
**48/48** with no failures or skips. Cases cover document/within-document
match reorder, missing target and shrink, visible-index arrows, default/legacy
numeric restore, activation publication before navigation and return-state
restore, query/role/type reset, debounce/IME, changed locator identity,
context-only refresh and existing exact/fallback navigation targets and
offline query mode.

The adapter would transpile the actual component but controls hooks/effects,
query results, timers and navigation without issuing a search. It is not
mounted React, real QueryClient cache/refetch, API/Worker, keyboard/focus,
touch, scroll or resource evidence. Targeted ESLint, nonincremental Web
typecheck and `git diff --check` also passed. The separate
`scripts/ux/offline-search-retry.test.mjs` and navigation-lifecycle report
remain unexecuted; real remote/offline reorder, keyboard, touch and
return-to-search acceptance remain open. No services, browser, build, full
API/PWA suite, commit, CI, deployment or CPU/RSS measurement ran.

## Conflict resolution recovery — 2026-10-15, source only

The [resolution recovery report](execution/ux-audit-offline-conflict-resolution-recovery-2026-10-15.md)
records source evidence before editing. The shared
`scripts/ux/offline-conflict-merge-draft-refresh.test.mjs` is updated but
**unexecuted**. Proposed additions cover initial and post-failure marker read
errors, unconfirmed-state action suppression, read-only recovery to comparison/
pending/STALE, failed merge and locale retention, and retirement while
confirmation, prepare, retry, recovery lookup or invalidation waits. A
controlled unmount case checks that a retired failure does not begin a lookup,
publish state or return from a later view.

This adapter would transpile the actual component; hooks, confirmation,
requests and storage remain controlled, not mounted React/Dexie/browser or
server receipt evidence. No pass count is asserted. After authorization, use
task-specific TEMP/TMP, run the shared focused Node file and relevant Web gates,
then actual conflict double-failure/status recheck, saved-operation retry,
switch/close/reopen, locale, dirty protection and focus acceptance.
No tests, lint/types, build, services, browser, commit, CI, deployment or
resource measurement ran.

## Conflict merge draft refresh protection — 2026-10-15, source only

The [conflict-draft report](execution/ux-audit-offline-conflict-merge-draft-refresh-2026-10-15.md)
records source evidence before editing.
`scripts/ux/offline-conflict-merge-draft-refresh.test.mjs` is authored but
**unexecuted**. Proposed cases cover stored/local initialization, failed and
pending draft writes across comparison refresh, annotation comment retention,
a newer edit during a read, failed reads, locale-only feedback changes,
conflict-key retirement of old reads/saves and the existing merge-submit path.

The actual component is transpiled in memory, but hooks, confirmation,
requests and local storage are controlled adapters. This does not mount React
or verify Dexie transactions, actual focus, cross-tab writers, resolution
receipts, browser navigation or device resources. No pass count is asserted.
After authorization, set task-specific TEMP/TMP, run the focused Node file
and relevant Web gates, then exercise actual annotation/notebook comparison,
quota failure, save retry, locale/focus and exit protection in the browser.
No tests, lint/types, build, services, product browser, commit, CI, deployment
or resource measurement ran.

## Sync-center visible inspection coalescing — 2026-10-15, source only

The [coalescing report](execution/ux-audit-sync-center-inspection-coalescing-2026-10-15.md)
records source evidence before editing.
`scripts/ux/sync-center-hidden-inspection.test.mjs` is updated but
**unexecuted**. The actual extracted effect is adapted with synthetic promises
for serialized latest-page publication, a burst replacing intermediate pending
work, cleanup/failure/page-clamp queue retirement and a rejected sibling that
must wait for another started verifier before the next page begins.

These proposed checks do not mount React or verify Cache Storage bytes,
task-progress notifications, cross-effect cancellation, browser behavior or
device CPU/RSS. After authorization, use task-specific TEMP/TMP, run both
sync-center Node files and relevant Web gates, then observe actual progress,
Refresh, tab/subview return, failures and resource use. No pass count is asserted.
No tests, lint/types, build, services, product browser, commit, CI, deployment or
performance measurement ran.

## Sync-center partial local reads — 2026-10-15, source only

The [partial-read report](execution/ux-audit-sync-center-partial-read-recovery-2026-10-15.md)
records evidence before editing. The existing
`scripts/ux/sync-center-tab-read-scope.test.mjs` and
`scripts/ux/sync-center-hidden-inspection.test.mjs` are updated but
**unexecuted**. Synthetic cases cover synchronous/asynchronous section failures,
successful siblings, scope/empty/render guards, failed deep-link lookup,
incomplete count protection, asset-error priority, local Retry and required-
read guards for cleanup/combined export. Earlier fixture/result expectations
were adapted to the new section-result shape rather than bypassed.

These extract actual source with controlled readers/setters/emissions; they do
not mount React or exercise Dexie, Cache Storage, browser focus, cross-tab
notifications or device resources. After authorization, set task-specific
TEMP/TMP, run both Node files and relevant Web gates, then exercise real
partial failure/Retry, deep-link, paging, cleanup and export transitions.
No pass count is asserted. No tests, lint/types, build, services, product browser,
commit, CI, deployment or CPU/RSS measurement ran.

## Conversation TOC stale-read recovery — 2026-10-15, source only

The [conversation-TOC report](execution/ux-audit-conversation-toc-stale-read-recovery-2026-10-15.md)
records source evidence before editing.
`scripts/ux/conversation-toc-stale-read-recovery.test.mjs` is authored but
**unexecuted**. It checks stale-refresh versus initial-empty branches, the local
alert and query-only Retry; it does not mount React, call the TOC API or
exercise heading parsing, navigation, focus, scrolling, browser or screen-reader
behavior.

After authorization, use task-specific TEMP/TMP and run the new Node file,
relevant Web gates and real TOC refresh failure, Retry, stale-content and
navigation acceptance. No pass count is asserted; no tests, lint/types, build,
services, product browser, commit, CI, deployment or resource measurement ran.

## Conversation index read recovery — 2026-10-15, source only

The [conversation-index report](execution/ux-audit-conversation-index-read-recovery-2026-10-15.md)
records source evidence before editing.
`scripts/ux/conversation-index-read-recovery.test.mjs` is authored but
**unexecuted**. It checks the interactive jump/page error alert, same-intent
Retry wiring and separation of loader failures from `onNavigate`; it does not
mount React, call the index API or exercise navigation, focus, scrolling,
browser or screen-reader behavior.

After authorization, use task-specific TEMP/TMP and run the new Node file,
relevant Web gates and real jump/page failure, retry, focus and anchor
acceptance. No pass count is asserted; no tests, lint/types, build, services,
product browser, commit, CI, deployment or resource measurement ran.

## Conversation-files capability read — 2026-10-15, source only

The [conversation-files capability report](execution/ux-audit-conversation-files-capability-read-2026-10-15.md)
records source evidence before editing.
`scripts/ux/conversation-files-capability-read.test.mjs` is authored but
**unexecuted**. It checks the pending/error capability gate, local retry wiring
and unchanged upload session/item/finalize calls; it does not mount React, call
`/api/capabilities`, upload files or exercise a browser.

After authorization, use task-specific TEMP/TMP and run the new Node file,
relevant Web gates and real capability pending/success/error, stale-data, Retry
and upload transitions. No pass count is asserted; no tests, lint/types, build,
services, product browser, commit, CI, deployment or resource measurement ran.

## Offline export attachment-count read — 2026-10-15, source only

The [offline export count report](execution/ux-audit-offline-export-attachment-count-read-2026-10-15.md)
records source evidence before editing.
`scripts/ux/offline-export-attachment-count-read.test.mjs` is authored but
**unexecuted**. It checks separate loading/success/error branches, bilingual
uncertainty copy, local read-only Retry wiring and the fact that export generation
does not depend on the informational count query; it does not mount React, run
Dexie/IndexedDB or create an export artifact.

After authorization, use task-specific TEMP/TMP and run the new Node file,
relevant Web gates and real empty/error/retained-count/Retry/export transitions.
No pass count is asserted; no tests, lint/types, build, services, product browser,
commit, CI, deployment or resource measurement ran.

## Import commit status recovery — 2026-10-15, source only

The [import status report](execution/ux-audit-import-status-recovery-2026-10-15.md)
records source evidence and the implementation boundary.
The authored import status/state regressions remain **unexecuted**. They cover
terminal pending cleanup, explicit retry, state-read Retry and stable error
classification at source level; they do not call the API, run the worker,
mount React or exercise a browser.

After authorization, use task-specific TEMP/TMP and run the relevant Node files,
API/Web gates and real queued/processing/committed/failed/cancelled/status-read
failure transitions. No pass count is asserted; no tests, lint/types, build,
services, product browser, commit, CI, deployment or resource measurement ran.

## Inline attachment locale feedback — 2026-10-15, source only

The [locale report](execution/ux-audit-inline-attachment-locale-2026-10-15.md)
records source evidence before editing.
`scripts/ux/inline-attachment-locale.test.mjs` is authored but **unexecuted**.
It checks locale propagation, English control/ARIA alternatives and localized
attachment type metadata; it does not mount React, change locale, open a
Viewer or run a browser/screen reader.

After authorization, use task-specific TEMP/TMP and run the new Node file,
relevant gates and real Chinese/English locale, attachment state, Viewer and
screen-reader transitions. No pass count is asserted; no tests, lint/types,
build, services, product browser, commit, CI, deployment or resource
measurement ran.

## Source editor attachment-picker read recovery — 2026-10-15, source only

The [attachment picker report](execution/ux-audit-source-editor-attachment-picker-read-recovery-2026-10-15.md)
records source evidence before editing.
`scripts/ux/source-editor-attachment-picker-read-recovery.test.mjs` is authored
but **unexecuted**. It checks the query-error branch, stale-row feedback,
successful-empty gating and read-only Retry; it does not mount React, call the
attachment API, use Query cache or exercise a browser dialog.

After authorization, use task-specific TEMP/TMP and run the new Node file,
relevant gates and real empty/error/stale-cache/Retry/focus transitions. No
pass count is asserted; no tests, lint/types, build, services, product browser,
commit, CI, deployment or resource measurement ran.

## Adaptive import-session restore — 2026-10-15, source only

The [restore report](execution/ux-audit-import-session-restore-recovery-2026-10-15.md)
records source evidence before editing.
`scripts/ux/import-session-restore-recovery.test.mjs` is authored but
**unexecuted**. It checks finite restore state, pointer retention after
transient read failure, terminal/new-file cleanup boundaries, status feedback
and Retry wiring; it does not mount React, call the API, use sessionStorage or
exercise a browser refresh.

After authorization, use task-specific TEMP/TMP and run the new Node file,
relevant gates and real remount/network-failure/Retry/terminal transitions.
No pass count is asserted; no tests, lint/types, build, services, product
browser, commit, CI, deployment or resource measurement ran.

## Offline library download status read — 2026-10-15, source only

The [status-read report](execution/ux-audit-offline-library-download-status-read-2026-10-15.md)
records source evidence before editing.
`scripts/ux/offline-library-download-status-read.test.mjs` is authored but
**unexecuted**. It checks subscription error/recovery ownership, stale progress
retirement, uncertainty copy and status-only Retry wiring; it does not run
Dexie/liveQuery, background downloads, React or a browser.

After authorization, use task-specific TEMP/TMP and run the new Node file,
relevant gates and real subscription-failure/recovery/download transitions.
No pass count is asserted; no tests, lint/types, build, services, product
browser, commit, CI, deployment or resource measurement ran.

## Offline library local read state — 2026-10-15, source only

The [local-read report](execution/ux-audit-offline-library-local-read-state-2026-10-15.md)
records pre-edit evidence and limits.
`scripts/ux/offline-library-local-read-state.test.mjs` is authored but
**unexecuted**. Its source checks cover finite state, list-before-search
publication, empty-state gating, retained refresh feedback, Retry wiring and
catalog download deep-link preservation. It does not mount React, run Dexie,
simulate real storage faults or establish browser/screen-reader acceptance.

After authorization, use task-specific TEMP/TMP and run the new Node file,
relevant gates and real cold-start, failed/empty/retained-refresh and local
Retry scenarios. No pass count is asserted; no tests, lint/types, build,
services, product browser, commit, CI, deployment or resource measurement ran.

## Sync-center tab-owned local reads — 2026-10-15, source only

The [tab-scope report](execution/ux-audit-sync-center-tab-read-scope-2026-10-15.md)
records source evidence before editing.
`scripts/ux/sync-center-tab-read-scope.test.mjs` is authored but
**unexecuted**. It extracts the actual `liveQuery` callback and uses synthetic
chainable Dexie adapters to check hidden reads, visible tab owners, displayed
failure existence, all-scope bounded existence, initial-job task reads and
offset/limit preservation. It does not execute Dexie, React, a browser,
subscriptions or CPU/RSS measurement.

After authorization, set task-specific TEMP/TMP and run the new suite plus
`scripts/ux/sync-center-hidden-inspection.test.mjs`, relevant gates and actual
tab/task/cleanup/error navigation. No pass count is asserted. No tests, lint/
types, build, service, product browser, commit, CI, deployment or performance
measurement ran.

## Sync-center scoped local read states — 2026-10-15, source only

The [read-state report](execution/ux-audit-sync-center-read-states-2026-10-15.md)
records evidence before changes. The shared
`scripts/ux/sync-center-hidden-inspection.test.mjs` is extended but remains
**unexecuted**. Additional cases propose actual scope/view-expression checks,
first-read failures on each tab, scope-entry marker retirement, retained matching refresh views, failed
ledger/late-inspection ownership, independent action feedback, the actual
local-only Retry callback and JSX empty/pagination ancestry guards.

These use controlled setters/emissions/promises, not mounted React. The inner
Dexie query is captured, not run; there is no browser, physical-storage,
access-lock, focus or performance acceptance. After authorization, set
task-specific TEMP/TMP and run the shared Node file, relevant gates and actual
cold/refresh/error/tab/page/mode transitions with download/sync work.
No pass count is asserted. No tests, lint/types, build, service, product browser,
commit, CI, deployment or CPU/RSS measurement ran for this follow-up.

## Sync-center hidden resource inspection — 2026-10-15, source only

The [inspection report](execution/ux-audit-sync-center-hidden-inspection-2026-10-15.md)
records source findings before editing.
`scripts/ux/sync-center-hidden-inspection.test.mjs` is authored but
**unexecuted**. It extracts the actual local-read effect/task helpers and
adapts live-query emissions, setters and inspection promises. It proposes tab/
subview ownership, empty/error, late/superseded result, task-navigation and
dependency checks. The combined Dexie read is captured, not run; separate
fixtures are not mounted React transition or browser/cache/performance evidence.

After authorization, set task-specific TEMP/TMP and run
`node --test scripts/ux/sync-center-hidden-inspection.test.mjs`, relevant gates,
then real settings navigation, conflict/cleanup return, downloads and device
resource acceptance. No pass count is asserted. No test, lint/types, build,
service, product browser, commit, CI, deployment or CPU/RSS measurement ran.

## Offline continuation read states — 2026-10-15, source only

The [read-state report](execution/ux-audit-offline-continuation-read-states-2026-10-15.md)
records pre-edit source findings and bindings.
`scripts/ux/offline-continuation-read-states.test.mjs` is authored but
**unexecuted**. It proposes pending/error/missing states, retained cached views,
locked/wrong-id content, member/source choices, query null/access fencing and
actual offline QueryObserver Retry/coalescing checks with synthetic adapters.
Child-element inspection does not render Markdown/Index or mount React.

After authorization, set task-specific TEMP/TMP and run
`node --test scripts/ux/offline-continuation-read-states.test.mjs`, relevant
gates, then disconnected Current/Index retry, missing-copy, access-lock,
source-toggle and real reference-return/focus/anchor acceptance. No pass count
is asserted. No tests, lint/types, build, service, product browser, commit, CI,
deployment or CPU/RSS measurement ran for this batch.

## Offline attachment query scheduling — 2026-10-15, source only

The [attachment-policy report](execution/ux-audit-offline-attachment-query-policy-2026-10-15.md)
records four source-derived local query scheduling gaps.
`scripts/ux/offline-attachment-query-policy.test.mjs` is authored but
**unexecuted**: actual option expressions, synthetic state/loaders, installed
QueryClient/Observer. It proposes local offline, remote scope/defaults, lazy
gates, lifetimes, refetch/reconnect and empty-versus-error checks; no pass count.

After authorization, use task-specific TEMP/TMP, run
`node --test scripts/ux/offline-attachment-query-policy.test.mjs`, relevant
gates, then real disconnected files/inline/Viewer/gallery acceptance, including
missing bytes, URL lifetime and revoked access. Adapters do not verify those
browser/storage paths. No tests, lint/types, build, service, product browser,
commit, CI, deployment or CPU/RSS measurement ran for this batch.

## Offline Reader query scheduling — 2026-10-15, local verification

The [query-policy report](execution/ux-audit-offline-reader-query-policy-2026-10-15.md)
records source evidence from the Reader, navigation components and installed
Query retryer/default-option merge. On 2026-10-16,
`node --test scripts/ux/offline-reader-query-policy.test.mjs` passed **10/10**
with no failed or skipped cases. Targeted Web ESLint, nonincremental Web
typecheck and `git diff --check` also passed.

The extracted-option, compiled navigation, QueryClient/Observer and static JSX
adapters do not establish IndexedDB, complete-turn content, React lifecycle,
focus or browser correctness. Mounted offline conversation switching, saved
DOM-anchor restoration and desktop/mobile navigation remain open. No service,
product browser, full API/PWA suite, full build, commit, CI or deployment ran
for this batch. Prior rich-text acceptance does not cover these later changes.

## Offline search readiness/retry — 2026-10-15, source only

The [readiness report](execution/ux-audit-offline-search-readiness-2026-10-15.md)
records source-derived absent-index and offline-query-gate defects.
`scripts/ux/offline-search-readiness.test.mjs` and
`scripts/ux/offline-search-retry.test.mjs` were authored before the later
continuation. On 2026-10-16 they ran with the actual compiled bridge/panel and
passed **19/19**, with no skipped cases.
Their bridge/component/clock/access adapters do not establish actual Worker,
IndexedDB, React lifecycle or browser behavior. The QueryClient and AST cases
are included in the 19-case result, but remain adapter evidence rather than
browser evidence.

Targeted Web ESLint, nonincremental Web typecheck and `git diff --check` also
passed. Outputs are retained under
`execution/ux-audit-offline-search-readiness-2026-10-15-evidence/`.
Real disconnected Reader/Library recovery, mounted focus/geometry,
IndexedDB/Worker behavior, build, CI and deployment remain unexecuted; the
rich-text checkpoint below does not cover these later source changes.

## Sidebar search selection — 2026-10-15, source only

[The selection report](execution/ux-audit-sidebar-search-selection-2026-10-15.md)
records source-derived reorder/shrink scenarios and the local verification
boundary. On 2026-10-16,
`node --test scripts/ux/sidebar-search-selection.test.mjs` passed **12/12**
with no skips. It uses the actual compiled sidebar component/handlers with
controlled hooks, query results, timers and routing; it does not execute
transport or mount React. Targeted ESLint, nonincremental Web typecheck and
`git diff --check` also passed. The evidence is retained under
`execution/ux-audit-sidebar-search-selection-2026-10-15-evidence/`.

The result does not establish live QueryClient/network, mounted React,
browser keyboard/focus, screen-reader or mobile acceptance. No service, build,
full API/PWA suite, product browser, CI or deployment ran in this continuation.

## Local ChatGPT rich-text fallback and resumed gates — 2026-10-15

The [rich-text report](execution/ux-audit-chatgpt-rich-text-2026-10-15.md)
retains the pre-edit 0/2 passing baseline and final **26 focused checks**.
The actual installed React/Markdown/remark/rehype/KaTeX stack and compiled shared
components run in SSR; assistant-ui, hooks unrelated to parsing and virtualizer
geometry have explicit adapters. This is not Reader/Share/offline DOM acceptance.

Five selected Node files pass **106/106 / 0 skipped**: rich text, resumed gates,
manual Markdown fidelity, message-version recovery and confirmation lifecycle.
The first combined run was 101/105; four stale fixture failures are explained in
the [gate report](execution/ux-audit-resumed-source-gates-2026-10-15.md), not
silently discarded. An added thinking branch first failed and now passes.
Pure parser tests pass **5 / 1 deselected** (three new source/hash/block/task
cases and two existing exporter cases); the excluded real paired fixture is not
a pass. Full lint and nonincremental Web types pass.

Exact commands, failures and final logs are in the report/evidence directory.
TEMP/TMP and pytest basetemp/cache use only this task's `wkkk` child. No Web/API
server, full API suite, build, Playwright/PWA execution, production, commit, CI
or deployment occurred. Only official research pages were visited through the
in-app browser; no Web Search. Historical broader source-only work is not
collectively accepted by this limited run.

## Local personal archive ownership and metadata recovery — 2026-10-14

The [personal archive report](execution/ux-audit-personal-archive-scope-2026-10-14.md)
records a pre-edit **1 pass / 10 fail** baseline. The final **36 focused checks**
use the actual compiled personal panel, archive helpers and installed query cache/
observers with controlled hook, transport, confirmation, account and DOM scheduling.
They cover retired callbacks, post-confirmation guards, immediate live acknowledgement,
retained File/original-key retries, cancellation, size validation, metadata-only
recovery and conditional no-scroll focus. An intermediate 28-case expansion found
the retry control disappearing during loading (27 pass / 1 fail); it is fixed and
the original failed log is retained.

All **33 script files / 926 cases / 0 failed / 0 skipped** pass; lint and
nonincremental types pass. Three archive browser files discover **19 cases**,
including two new 375px Chinese/1440px English limit-read regressions; none execute.
Planned screenshots and real authentication/focus/layout acceptance remain pending.
No new Web build, API run, commit, CI or deployment occurred. The already-dirty
buildinfo hash remains equal to the preceding task-status checkpoint.

## Local task-status recovery — 2026-10-14

The [task-status report](execution/ux-audit-task-status-recovery-2026-10-14.md)
records 1 passing/8 failing pre-edit checks, then 22 passing focused checks using
actual compiled components and installed QueryObserver. They cover query-cache
immutability, final GET/manual retry, repeated/partial failures, deduplicated held
reads, late obsolete results, account/unmount fences and accurate stale/package
feedback. An expanded intermediate run found one additional read-independence
failure (20 pass/1 fail); that failure is retained and fixed.

All **32 script files / 890 cases / 0 failed / 0 skipped** pass; lint and
nonincremental types pass. The three affected task/context browser files discover
24 cases, execute zero. Two new synthetic 375/1440px cases exercise final-result
checking without task mutation. Screenshots are planned, not captured.
No new Web build, API run, CI or deployment occurred. Buildinfo matches the
previous local checkpoint; old incremental-check side effects remain documented.

## Local resource inspection and share reads — 2026-10-14

The [offline check report](execution/ux-audit-offline-resource-check-2026-10-13.md)
records a 10-case compiled-sidebar baseline (5 pass/5 fail), followed by 10 pass.
The separate [sharing report](execution/ux-audit-share-transient-read-2026-10-13.md)
has 10 actual QueryObserver/component checks for retries, exhaustion, selection,
manual refresh and permanent failures. Together with the existing scripts, all
31 test files pass **868 / 0 failed / 0 skipped**. Lint and nonincremental types
pass. There is no new Web build or API run for this local Web-only batch.

`library-offline.spec.ts` adds 375/1440px inspection-failure/retry cases;
`settings-shares.spec.ts` retains manual recovery and adds a transient retry.
The two files discover 26 cases; none executed. The in-app browser returned local
connection refusal. Test doubles do not prove browser IDB, layout or CPU/memory
performance; the user requested continuing without login. No new CI/deployment.

An earlier sharing intermediate check used incremental typecheck and changed the
already-dirty `tsconfig.tsbuildinfo`; it remains excluded from task source edits.
This final check uses `tsc --noEmit --incremental false`. Historical notebook
cache/build claims below describe that earlier checkpoint, not the current cache.

## Local notebook draft write queue — 2026-10-13

The [draft queue audit](execution/ux-audit-notebook-draft-write-queue-2026-10-13.md)
records the failing pre-edit callback probe and local coalescing repair. Three new
compiled-component regressions cover a 100-edit burst behind a held write, ordered
Markdown/Unicode content, latest-write-before-save ordering and explicit recovery
without advancing a failed version. All 29 script files pass **848 / zero failed /
zero skipped**, including 78 focused cases. Lint, nonincremental types and the
one-worker/1024 MiB heap Web build pass. User buildinfo remains unchanged.

Six browser files discover 54 cases (two new typing/reload/save cases), executed zero.
Storage latency is doubled only in Node; no browser timing or CPU/RSS claim follows.
The initial Corepack attempt reported cache ENOSPC; a direct Node baseline confirmed
the queue assertion independently. A later disk check recovered available space
without task cleanup. Original evidence is retained; no CI or deployment was started.

## Local notebook editor accessible name — 2026-10-13

The [notebook editing audit](execution/ux-audit-notebook-editing-2026-10-13.md)
localizes the title field name and updates Chinese/English test locators. The
compiled component test checks both accessible-name attributes. All 29 script
files pass **845 / zero failed / zero skipped**, including 75 focused annotation
cases. Lint, nonincremental types and the bounded one-worker/1024 MiB Web build
pass.

Six associated browser files discover 52 cases, executed zero; an existing
Chinese/English draft browser case now asserts each exact role name but remains
unrun locally. This is not a screen-reader voice test. Workflow and budgets are
unchanged; no API rerun, CI submission or deployment occurred.

## Local annotation creation and note addition — 2026-10-13

The [composition audit](execution/ux-audit-annotation-composition-2026-10-13.md)
adds 16 callback regressions for one creation request, retained input, original-ID
recovery, newer-selection ownership and missing-reference addition against the
latest notebook. All 29 script files pass 844 cases, including 74 focused cases,
with zero failures/skips. Run `node --test --test-concurrency=1` with every
`scripts/**/*.test.mjs` file. The concurrency cap limits test processes, not
application behavior. Lint and nonincremental types also pass.

The full Web build passes with `NEXT_BUILD_CPUS=1`, `NEXT_STANDALONE=0` and
`NODE_OPTIONS=--max-old-space-size=1024`. Compilation, its TypeScript check and
all 14 page generations remain enabled. A prior default-parallel script run and
4096 MiB build failed with V8 native Zone memory exhaustion; a zero-free-space
attempt produced incomplete logging. These failures are not product assertions
or passing checks. Later temporary evidence disappeared for an unknown reason;
the fresh complete verification writes its generated logs into the adjacent
repository evidence directory. Old checkpoint ledgers are not rewritten.

`settings-annotation-composition.spec.ts` adds four English/Chinese cases;
discovering it with the previous five files yields 52 cases in six files.
Executed: zero; new screenshots: zero. Its authored text-selection scenarios use
a real DOM Range, not native touch gestures. API/schema/workflow/budgets are
unchanged. No new CI/deployment, local service or image build was started.

## Local annotation write recovery — 2026-10-13

The [write-recovery audit](execution/ux-audit-annotation-writes-2026-10-13.md)
adds preserved comment input, independent saved-draft cleanup, partial style and
delete recovery, and stable-ID bookmark creation. All 29 script test files pass
828 cases / zero failures / zero skips, including 58 annotation cases (overlapping
earlier totals). Lint, nonincremental types and the one-worker build pass.
The callback tests use explicit React/repository/DOM doubles; they do not prove
real browser scheduling, resource usage, focus or visual layout.

`settings-annotation-writes.spec.ts` adds eight English/Chinese synthetic browser
cases. Discovering it with `settings-annotation-reads.spec.ts`,
`settings-notebook-drafts.spec.ts`, `attachment-reading.spec.ts` and
`attachment-inline-layout.spec.ts` yields 48 cases in five files. Executed: zero;
new screenshots: zero. Existing assertions and CI budgets stay intact; the
settings workflow's existing filename pattern includes the new file. API/schema
are unchanged and were not rerun. No new CI or deployment was submitted.

## Local annotation and CSV follow-up — 2026-10-13

The [pre-edit audit and implementation evidence](execution/ux-audit-followup-2026-10-13.md)
bind five reproduced findings to accepted 84988a2 and record the newer local repair.
All 29 `scripts/**/*.test.mjs` files pass **806 / 0 failures / 0 skips**, including
36 annotation ownership/recovery/selection cases and 14 table parser/page cases.
These run real compiled functions with explicit scheduling/DOM/repository doubles.
Lint, nonincremental typecheck and one-worker Web build pass. No API/schema change
or API rerun. Four browser files discover 40 cases, including 12 new cases (eight
annotation recovery/selection and four CSV). Discovery is not execution; local
browser execution, new screenshots and device CPU/RSS remain NOT_VERIFIED.
Previous browser assertions, budgets and release gates remain intact. No new CI
dispatch or deployment is authorized by this local work.

## Accepted attachment release — 2026-10-12

Exact source 84988a2 passes all five jobs in CI 38255213036: API 1,239 passed /
3 skipped; all 13 Web gates PASS, including Context 35, mutation 100, attachment
21 and PDF 13. Settings 439 plus one independent fresh restore pass. Conditional
skips: adaptive import 1 and default PWA 699; default PWA has 135 passing cases.
Fourteen original synthetic screenshots were reviewed. Original image artifact
11752048475 and deployed runtime were independently accepted; see the
[release evidence](execution/ATTACHMENT_DEPLOYMENT_2026-10-12.md).
No local or interactive production browser run is claimed. Further local changes
are not covered by this release and require new authorization for CI/deployment.

## Immediate Context draft protection — 2026-10-12

Eleventh CI 37995454022 passes API 1,239 / three skips, settings 439 and one
fresh-instance restore. Web Context fails one of 35 cases: a dropped replacement
advances generation despite a pending draft and intended decline. Ten later
Web gates do not run and both image jobs are skipped. The
[pre-edit diagnosis](execution/ux-audit-context-drop-2026-10-12.md) records this
and the missing trace; original browser scheduling is not established.

`node --test scripts/ux/continuation-drop-guard.test.mjs` executes actual TSX
callbacks with controlled hook/render/effect timing. The first 12 go from four
passes/eight failures to all passing; four additional lifecycle cases bring the
suite to 16. The unchanged workflow automatically includes this new regression
file. All 27 script suites pass 756 with no failure/skip. Lint, nonincremental
types and bounded one-worker Web build pass; no API rerun or local browser run.
The three Context browser files discover 11 cases. The drop case now requires
the confirmation, adds a saved-file readback and retains failure traces without
loosening old assertions, timeouts or gates. Full exact-source CI and image/
screenshot acceptance remain required. The user requested a pause after dispatch.

## Official CI image sources — 2026-10-10

Tenth run 37991317201 failed before checkout because all three PostgreSQL
service pulls hit Docker Hub's anonymous rate limit. No product test ran and
no artifact exists. The [registry repair](execution/CI_REGISTRY_SOURCE_2026-10-10.md)
pins the same official image indexes from ECR Public without changing test
versions, quality steps, timeouts or acceptance conditions. Dockerfile defaults
remain the original Hub references; CI alone supplies immutable base arguments.

The additive `node --test scripts/ci/release-image-sources.test.mjs` checks all
three service pins, both build inputs/defaults, the built-in Docker driver and
explicit Linux/amd64 targets. Ten source-contract assertions fail before the
configuration change and all ten pass afterward. All 26 repository-script test
files pass **740 / zero failed / zero skipped** in 7797.545ms; this overlaps the
prior 730 cases, not 740 additional cases. Parsed-workflow comparison proves
that all 13 Web gates and all existing job steps/conditions/budgets are unchanged,
apart from the documented source/build arguments and one additive check.
Actionlint 1.7.12 passes workflow/expression validation; optional shellcheck and
pyflakes are not used. This is not container, browser or release acceptance.
Complete exact-source CI, fresh screenshots and image inspection remain required.

## Ninth-CI archived-project contract repair — 2026-10-10

[CI 37986179840](https://github.com/foolkking/chat-reader/actions/runs/37986179840),
source 87eae8d, passes API **1239 / three skipped**, mutation **100**, upload
**18**, attachment **21** and PDF **13**. Default PWA has **134 passed / one
failed / 699 conditional skips**; auth and negative-PWA are not reached. The
settings matrix passes **439** (39.7m), and independent fresh-instance restore
passes **one** (35.0s); both image jobs are skipped. The
[pre-edit report](execution/ux-audit-archive-contract-2026-10-10.md) identifies
an obsolete `await refreshProjects()` string assertion, not a PDF failure.

Without starting Web or using browser fixtures, 18 source-only Playwright cases
across six files reproduce **17 passes / one failure**, then all **18** pass.
The five deletion/API/confirmation assertions remain, and guarded background
refresh replaces the obsolete expectation. Four added compiled-callback/real
QueryObserver cases cover single/bulk deletion under held/failed refreshes,
including all affected query families. That suite grows from **40** to **44**
passes. All 25 repository-script suites pass **730 / zero failed / zero skipped**,
9097.6598ms; lint and nonincremental types pass. These are not local browser
acceptance. Product/API, workflow, dependencies and budgets are unchanged;
preceding build/API evidence is retained, not rerun or added to these counts.
The [ledger](execution/ux-audit-archive-contract-2026-10-10-evidence/local-verification.json)
preserves previous evidence and unrelated buildinfo. Another complete exact-source
run, new-source screenshot review and independent image acceptance are required.

## Eighth-CI upload fixture cleanup repair — 2026-10-10

[CI 37979802613](https://github.com/foolkking/chat-reader/actions/runs/37979802613),
source 96b31b0, passes API **1239 / three skipped**, mutation **100**. Upload is
**17 passed / one failed / zero timedOut / zero skipped / zero interrupted**:
the final business assertion completes before DELETE cleanup loses its response
with ECONNRESET. PDF/Markdown and the later three Web gates did not run. Settings
finishes with **439 passed** (39.1m), plus **one** fresh-instance restore (34.9s).
Both image jobs are skipped. This is not acceptance of the PDF repair.

The [pre-edit report](execution/ux-audit-upload-cleanup-2026-10-10.md) precedes the
test-only change. The actual E2E helper, compiled with transport/timer doubles,
has **21 passes/nine failures** across 30 cases before repair; all **30** pass
afterward. A lost DELETE response permits one GET for the same synthetic fixture;
only 404 is accepted. Present/denied/failed reads preserve the original failure,
unrelated exceptions are not swallowed, and no blind DELETE retry is added.
The existing three-attempt HTTP-500/250ms behavior is separately covered.
Confirmed cleanup preserves any prior business assertion failure.

All 25 repository-script suites pass **726 / zero failed / zero skipped**,
9432.6716ms. Lint and nonincremental TypeScript pass. The 149 browser cases in ten
files remain discovery only, zero local executions. No product/API source,
business assertion or case/gate time budget changed; the preceding successful
build and API checks were not rerun locally. The
[additive ledger](execution/ux-audit-upload-cleanup-2026-10-10-evidence/local-verification.json)
preserves prior evidence/buildinfo and binds the two test-file deltas. Full
exact-source CI, actual screenshots and independent image acceptance still
precede deployment. The socket-reset cause and eighth-run DELETE outcome remain
unknown; readback recovery is not a claim to have repaired the proxy connection.

## Seventh-CI PDF session/geometry repair — 2026-10-10

[CI 37967470601](https://github.com/foolkking/chat-reader/actions/runs/37967470601)
passes API **1,239 / three skipped**, settings **439** plus **one** independent
restore, mutation **100** and attachment **21**. PDF is **seven passed / six
failed / zero timedOut / zero skipped**, 408445ms; later three gates and images
are unverified. The [pre-edit report](execution/ux-audit-pdf-session-2026-10-10.md)
distinguishes recorded browser failures from explicit Node scheduling doubles.

The new 48-case baseline has **41 passes/seven failures**. Expanded coverage is
**53 passed**; all 25 repository-script test files pass **699 / zero failed /
zero skipped**, 9413.6934ms. This broader run is not added to the earlier
666-case selection. Lint, nonincremental types and one-worker/non-standalone
build pass. Discovery remains **149 in ten files**, zero local browser cases.
An intermediate exact floating-point assertion and private-library-API type
errors were corrected, not presented as passing checkpoints.

Regressions deliver layout-scroll feedback before the next reconciliation,
including growth against a stale DOM extent, multiple scales, rounded native
offsets and scrollbar resize. Callback-only redraw, disposed callbacks, explicit
close and page/document-scoped CSS geometry are separate cases. Real input can
cancel pending alignment, with listener cleanup and reserved/editing key guards.
E2E retains all assertions/budgets and adds actual PDF DOM identity through
resize, post-zoom viewport checks and zoom/resize screenshots. The
[additive ledger](execution/ux-audit-pdf-session-2026-10-10-evidence/local-verification.json)
inherits 115 bindings and preserves earlier evidence and unrelated buildinfo.
Full exact-source CI and image/screenshot acceptance still precede deployment.

## Sixth-CI PDF orientation/retry repair — 2026-10-10

[CI 37936101205](https://github.com/foolkking/chat-reader/actions/runs/37936101205)
passes API **1,239 / three skipped**, settings **439** plus **one** independent
restore, mutation **100** and attachment **21**. PDF is **seven passed / six
failed / zero timedOut / zero skipped**, 417,967ms. Three later Web gates and both
image jobs remain unverified. The [pre-edit PDF report](execution/ux-audit-pdf-release-2026-10-10.md)
separates a real fractional-offset page-number defect from a one-shot fault that
can recover on the desktop shell's size-driven redraw.

The 41-case actual-component baseline is **37 passed / four failed**, repaired to
**41 passed**. The complete suite passes **666 Node / zero failed / zero skipped**,
8,567.6464ms; lint, nonincremental types and one-worker/non-standalone build pass.
Discovery stays **149 in ten files**, no local browser execution. The installed
virtualizer is exercised with controlled integer scrolling and its actual
post-layout reconciliation; hook/DOM/PDF doubles do not prove native geometry.

The visible-page lookup samples one pixel inside its existing 16px inset.
Browser checks retain every old assertion and add real wheel navigation,
persistent page-local fault evidence through resize, the actual Retry click and
a recovered-page screenshot. No case/gate budget, dependency or migration changes.
The [new ledger](execution/ux-audit-pdf-release-2026-10-10-evidence/local-verification.json)
inherits all 115 bindings, with three expected source/test deltas, and preserves
prior ledgers, synthetic screenshots and unrelated buildinfo. API code is
unchanged/not rerun locally; complete exact-source CI and independent image
acceptance remain mandatory before deployment.

## Fifth-CI mobile return-layer repair — 2026-10-09

[CI 37924985537](https://github.com/foolkking/chat-reader/actions/runs/37924985537)
passes API **1,239 / 3 skipped**, settings **439** plus **one** fresh-instance
restore and mutation **100**. Attachment is **15 passed / 0 failed / 6 timed out**;
the six timed-out mobile multi-file cases are not six additional failures.
Their second normal Preview click is intercepted by a transparent reinserted
Overlay at the same z-index as retained Content. Later four gates and both image
jobs are unverified. See the [pre-edit report](execution/ux-audit-attachment-release-2026-10-09.md).

Only Content's layer and two test files change: Content must remain above its
scrim regardless of portal insertion order. The browser helper retains focus,
inert, Overlay and subsequent real-click assertions, adding actual computed
layer order, exposed-page interception and Preview-center hit tests. No forced
click, timeout increase, assertion removal, dependency or migration is used.

The 37-case baseline is **36 passed / 1 failed**, repaired to **37 passed**.
One complete Node run passes **660 / 0 failed / 0 skipped**, 8,763.8816 ms.
Lint, nonincremental typecheck and one-worker/non-standalone build pass.
Discovery remains **149 in ten files, zero local browser execution**.
The [return-layer ledger](execution/ux-audit-attachment-release-2026-10-09-evidence/return-layer-verification.json)
inherits 115 bindings: 112 unchanged and three expected changes. Earlier ledgers,
pre-edit screenshots and unrelated buildinfo are retained. The API is unchanged
and not rerun locally; complete exact-source CI must rerun all API/PostgreSQL,
13 Web gates and settings checks before independent image/deployment acceptance.

## Third-CI gesture-readiness test correction — 2026-10-09

CI 37906779236 completed: API **1,239 passed / 3 skipped / 20 warnings** in
870.04 seconds; settings **439 passed** in 41.7 minutes plus one fresh-instance
restore in 35.9 seconds. Web mutation was **99 passed / 1 failed / no timed-out,
skipped or interrupted cases**, 579,266 ms. Later gates and images did not run.
The mobile placement test failed at its first `scrollTop > 100`, before any move.
Its only preparation was a visible title, which precedes body readiness.

The E2E-only correction waits for real message count, the existing settled
`chat-reader:first-content` mark and more than 500px of actual scrollable range
before the unchanged wheel gesture. No original position/payload/focus assertion
is removed. Only these two viewport cases manually record a trace, retaining it
on failure. A first attempt at describe-level `test.use({ trace })` was rejected
by discovery before execution because tracing is worker-scoped; the final scoped
fixture passes discovery. No browser ran locally and no product code changed.

Final lint/nonincremental types, 622 integrated Node cases and eight-file/144-case
discovery pass. API and Web build were not rerun locally for this test-only delta;
their runtime sources are unchanged from the preceding successful build checks.
The [readiness ledger](execution/ux-audit-mobile-release-2026-10-09-evidence/readiness-verification.json)
inherits 110 source hashes, with only the E2E file changed. The original third-CI
checkpoint retains its then-running settings state; final totals live here and
in the release record. Full exact-source CI/image acceptance remains required.

## Second attachment-release CI repair — 2026-10-09

[CI 37897405546](https://github.com/foolkking/chat-reader/actions/runs/37897405546),
source `3e82323668a7843a5bfbebc7ea1d03a5dca61c1e`, failed Web's mutation gate:
**97 passed / 2 failed / 1 timed out / zero skipped or interrupted**, 857,735 ms.
This did not reach the 20-minute gate timeout. Later attachment/PDF/PWA gates and
both image jobs were skipped. API passed **1,239 / 3 skipped / 20 warnings** in
840.05 seconds, including both PostgreSQL merge-admission cases. Settings passed
**439** cases in 38.4 minutes, plus **one** fresh-instance restore in 34.7 seconds.
Separate Bundle/cleanup checks overlap the API suite and are not added to it.

The [pre-edit mobile audit](execution/ux-audit-mobile-release-2026-10-09.md)
distinguishes an observed header/guide pointer obstruction, mobile pending-focus
loss whose exact second-click target is inferred, and an obsolete archive test
path. The unchanged 81-case local baseline had **68 passed / 13 failed**; the
repair passes **81**, including nine measured-header callback probes and four
new pending-pointer probes. One complete integrated run passes **622 / zero
failed/skipped** in 9,482.2517 ms. Lint, independent nonincremental typecheck and
the bounded one-worker/non-standalone build pass. No API source changed here.

Discovery adds `ux-whole-site.spec.ts` to the seven-file command: **144 tests in
eight files, zero local browser executions**. The actual manual first-message
click keeps the wrapped offline guide and checks header/action geometry before
clicking, in both mobile locales. A scoped teardown budget preserves the original
UI failure while cleaning up synthetic data. Placement retains double-click,
single PUT, disabled submit and keyboard-cycle assertions; its screenshot and
focus/geometry attachment precede the focus assertion. Archive/restore now checks
unknown outcomes read-only before explicit retries and asserts all four PATCHes.

The [new local ledger](execution/ux-audit-mobile-release-2026-10-09-evidence/local-verification.json)
inherits 107 hashes (102 unchanged / five expected changes), then binds three
new files for 110 sources. Earlier evidence is not rewritten. All 13 Web gates,
full API/PostgreSQL, settings and independent image acceptance remain required.
No local service start, browser execution, CPU/RSS measurement or visual score
is claimed; CI retries remain within the user's single authorized release cycle.

## First attachment-release CI repair — 2026-10-09

[CI 37889682904](https://github.com/foolkking/chat-reader/actions/runs/37889682904)
failed: full API **1,239 passed / 3 skipped**, Web `source-editor-mutation`
reached its 20-minute limit, and settings **438 passed / 1 failed**. The mutation
gate discovered 100 cases and left 21 failure contexts without a final suite
count; its later attachment/PDF/PWA gates did not execute. Settings' fresh-instance
restore and both image jobs did not execute. This is not release acceptance.

The [interaction repair](execution/ux-audit-release-interaction-2026-10-09.md)
records the pending-placement dismissal defect separately from test setup and
selector corrections. Six initial pending-action checks expanded the 60-case
placement suite to 66: **61 passed / 5 failed** before the product edit. Two further
live-guard/disabled-focus probes bring it to **68 passing** cases. The complete
Node suite now passes **609 / 0 failed / 0 skipped**; do not add old checkpoint
counts. Lint, nonincremental typecheck and bounded one-worker/non-standalone build
pass. The new [ledger](execution/ux-audit-release-interaction-2026-10-09-evidence/local-verification.json)
inherits the original 106-file checkpoint without rewriting it.

Discovery adds `settings-offline-conflicts.spec.ts` to the six-file command below:
**129 cases in seven files, zero local browser executions**. All original payload,
position/outbox, conflict, retained-Reader and double-submit assertions remain.
The next complete workflow must run all 13 Web gates, API/PostgreSQL and all
439 settings cases plus fresh-instance restore. No timeout increase or skipped
failure is used as a repair. The denied local service start is not retried.

## Attachment/manual-source integrated checkpoint — 2026-10-09

The [attachment ledger](execution/ux-audit-attachment-reading-2026-10-09-evidence/local-verification.json)
extends, without rewriting, the preceding 72-file Reader checkpoint. One complete
local Node execution passes **601 / 0 failed / 0 skipped**: the preceding 527,
26 exact-Markdown, 34 attachment and 14 PDF-policy checks. Tests execute production
callbacks/components and the installed virtualizer with explicit DOM/transport/
hook doubles; numerical allocation bounds are not observed CPU/RSS.

An isolated SQLite TestClient batch passes **103 / 0 failed / 0 skipped** across
manual/edit/split-merge/version, project/metadata/placement/merge recovery and
recent/reading-position contracts. No PostgreSQL/API/worker service is started.
Lint, `pnpm --filter web exec tsc --noEmit --incremental false`, a one-worker
non-standalone Web build and the single Alembic head `20261008_0050` pass.

`playwright test --list` discovers **125 cases in six files**, executing none:
`attachment-reading` 20, `manual-markdown-fidelity` four, `pdfjs-migration` 12,
`pdfjs-share` one, `ux-recovery-followup` 79 and `release-stabilization-contract`
nine. The authorized complete CI keeps all 13 existing Web gates and adds the
new files to their existing mutation/attachment gates. Full API retains the
PostgreSQL concurrency opt-in; settings retains its 439-case matrix and separate
fresh-instance restore. Browser/visual acceptance and exact-source images remain
pending, as recorded in the [release record](execution/ATTACHMENT_READING_RELEASE_2026-10-09.md).
The earlier denied local Web start is not retried through another launcher.

## Local-only optimization — 2026-10-09

The latest [Reader quiet-autosave/readiness checkpoint](execution/ux-audit-reader-navigation-readiness-2026-10-09.md)
passes **527 Node checks**: 31 autosave, 29 navigation/readiness and the preceding
467. Set task-local TEMP/TMP, collect `$uxScripts = @(rg --files scripts/ux -g '*.test.mjs')`,
then run `node --test --test-reporter=tap @uxScripts`. Both initial baselines had
29 cases: autosave 10 passed / 19 failed, readiness 11 passed / 18 failed; both
same-script repairs passed 29. Autosave's final 31 include two unread-snapshot
checks and a corrected storage-failure fixture using an actual undefined snapshot.
Historical baseline/repair records and source hashes are retained separately.

Autosave compiles the complete production component and uses real React static
markup; hooks/lifecycle, Dexie, transport and browser events are doubles. Readiness
executes four actual AST-extracted callbacks and seven effects with real complete-
turn helpers, block registry, active-target resolver and position payload builder.
Query snapshots, hook/effect scheduling, DOM geometry, time, transport, block
leases and target alignment are explicit doubles. These checks do not mount a
full Reader or prove real browser/React scheduling, anchoring or network saving.

Final lint, nonincremental typecheck and bounded one-worker Web build pass.
Playwright discovery finds **79 tests / 0 executed**: four new 375px Chinese/light
and 1440px English/dark autosave cases, plus two strengthened index-recovery cases.
They intend to verify real wheel input, queued local positions, stable Reader
bounds, eventual server/outbox completion and scoped storage failure/retry. Index
recovery additionally asserts settled navigation, one first-content mark and a
real subsequent position save while the original body read stays failed. These
browser assertions and screenshots remain unexecuted; no visual score is claimed.
No API change/rerun, service/browser start, commit, CI or deployment occurred.

The preceding [Reader initial-window checkpoint](execution/ux-audit-reader-initial-window-2026-10-09.md)
passes **467 Node checks**: 32 initial-window and the preceding 435. Use an explicit
Windows array, `$initialScripts = @(rg --files scripts/ux -g '*.test.mjs')`, then
`node --test --test-reporter=tap @initialScripts`, after setting task-local TEMP/TMP.
The initial 24-case baseline was 5 passed / 19 failed; all 24 passed after repair,
then all 32 expanded cases passed. An earlier extractor-construction assertion
failed before those cases ran; it is recorded separately, not a product failure.

The harness runs real query options, initial-state JSX, retry/focus callbacks and
the apply-once effect using installed QueryObserver and the actual complete-turn
helper. Other Reader UI, hooks, transport, owner/auth, navigation and DOM focus are
excluded or explicit doubles. The paused-query guard is a controlled cache-state
test, not a real offline simulation. Whole turns, original/saved anchors, fallback,
stale action guards and late results are checked; browser scheduling is not.

Final lint, nonincremental typecheck and bounded one-worker Web build pass. The
browser file discovers **75 tests / 0 executed**, adding six intended cases: initial
retry with/without saved position and alternate index navigation, at 375px Chinese/light
and 1440px English/dark. Source message/root preservation, read-only scope, focus
and stale-error retirement are unexecuted assertions. The separate first-paint/
position-readiness candidate is not accepted by these tests. No API change/rerun,
server/browser start, new CI or deployment occurred; prior SQLite counts remain separate.

The preceding [Reader detail-read checkpoint](execution/ux-audit-reader-detail-recovery-2026-10-09.md)
passes **435 Node checks**: 27 detail recovery and the preceding 408. Run an explicit
Windows script array, `$detailScripts = @(rg --files scripts/ux -g '*.test.mjs')`, then
`node --test --test-reporter=tap @detailScripts`, with task-local TEMP/TMP. The 22-case
baseline was 5 passed / 17 failed, then 22 passed; expanded 27 cases also pass. The
test executes exact AST-extracted early returns, ReaderState/recovery JSX and retry,
title and focus callbacks with installed QueryClient/Observer. The rest of Reader
is an explicit retained-surface marker; hooks, owner/auth, transport and focus are
doubles. Separate AST checks inspect the notice's real JSX placement. This is not
full React lifecycle, DOM identity, scroll or browser acceptance.

Lint, nonincremental typecheck and the bounded one-worker Web build pass after final
edits. Browser discovery finds **69 tests / 0 executed**, adding four cases at 375px
Chinese/light and 1440px English/dark. They cover initial failure/retry and a real
sidebar rename followed by failed detail refresh, held read retry, original DOM
nodes/scroll position, focus and no repeated write/open. The mobile test uses a real
upward gesture to reveal the auto-hiding header before recording its scroll baseline.
These assertions, selectors and screenshots remain unexecuted. No server/browser
started, no CI/deployment is authorized, and API contracts were not changed or rerun.
The earlier 11/18/19/41-case SQLite checkpoints remain separate and non-additive.

The preceding [Reader recent-open checkpoint](execution/ux-audit-reader-recent-2026-10-09.md)
passes **408 Node checks**: 37 recent-open cases plus the preceding 371. On Windows,
use `$recentScripts = @(rg --files scripts/ux -g '*.test.mjs')`, then
`node --test --test-reporter=tap @recentScripts`, with process-local TEMP/TMP in this
task's `wkkk` directory. The initial 24-case baseline had 7 passes / 17 failures;
all 24 passed after repair, then all 37 expanded cases passed. The harness compiles
the real Reader effect/owner AST statements and uses installed QueryClient/Observer;
hooks, scheduling, transport and authentication are explicit doubles. It verifies
revision/time ordering, exact full-detail refresh including failed/older in-flight
GETs, cache age, same-visit retry prevention, owner/auth retirement and offline scope.
It does not mount the whole Reader or verify real React lifecycle.

`python -m pytest tests/test_recent_items_api.py tests/test_reading_positions_api.py tests/test_reading_position_sync.py`
passes **11 tests** (5 recent, 2 position, 4 sync) on disposable SQLite TestClient,
with task-local storage and a unique `--basetemp`. The sync suite uses its existing
test-auth fixture; this is not production-auth or PostgreSQL concurrency evidence.
The new recent tests preserve canonical content/revision and establish that repeated
POSTs increment count, reading progress has independent time and can decrease, and
a recent summary is not a full detail. No API implementation or migration changed.

Lint, nonincremental typecheck and the bounded one-worker Web build pass. The
follow-up browser file discovers **65 tests / 0 executed**, adding four recent-open
cases at 375px Chinese/light and 1440px English/dark. They use real fixture recent
POSTs with delayed/lost replies and actual sidebar rename, holding subsequent GETs.
An intentionally intercepted, non-applied message insertion probes the real dialog's
expected revision; assertions also check one open and unchanged source. These tests
remain unexecuted: selectors, scheduling, rendering, focus and screenshots are not
accepted. `--list` started no service or browser. No CI/deployment is authorized.

The preceding [single-conversation placement checkpoint](execution/ux-audit-conversation-placement-2026-10-09.md)
passes **371 Node checks**, including 60 placement and the preceding 311 cases.
On Windows, pass an explicit script array: `$placementScripts = @(rg --files scripts/ux -g '*.test.mjs')`,
then `node --test --test-reporter=tap @placementScripts`. Set process-local TEMP/TMP
to this task's `wkkk` directory first. Node does not expand the wildcard itself.
The placement baseline was 3 passed / 19 failed; the recovery-edge baseline was
38 passed / 6 failed; the final focus baseline was 58 passed / 2 failed. All failures
and separate harness/integration corrections remain in the adjacent evidence.
Actual compiled callbacks/static JSX and installed QueryClient/Observer are used;
hooks/effects, transport, focus and portals are explicit doubles, not React lifecycle.

`python -m pytest tests/test_conversation_placement_recovery.py tests/test_projects_api.py`
passes **18 tests** (8 placement + 10 project) with disposable SQLite TestClient,
task-local storage and a unique `--basetemp`. It verifies canonical acknowledgement,
revision conflicts/no-ops, preserved reading/message data, inactive targets and the
default-versus-archived null-summary distinction. The first run's single failure
used the wrong test response field (`messages` instead of `items`); it is recorded
as a test correction, not an API fix. No backend implementation or migration changed.
The prior 19- and 41-case API checkpoints are separate, not newly rerun or additive.

Lint, nonincremental typecheck and the bounded one-worker Web build pass. The
follow-up browser file discovers **61 tests / 0 executed**: eight new placement
cases at 375px Chinese/light and 1440px English/dark. Intended assertions cover
failed picker reads, Home/End/search/session selection, confirmed sidebar moves
while GETs are held, unchanged real Reader position/source, one-click Unclassified,
read-only unknown checks and explicit fresh-revision retry. Held move/check phases
also assert restored Close focus and Tab/Shift+Tab containment. These DOM/focus,
IME, screenshot and PostgreSQL concurrency claims remain **NOT_VERIFIED**. Discovery
starts no service or browser; no additional CI submission or deployment is authorized.

The preceding [conversation metadata checkpoint](execution/ux-audit-conversation-metadata-2026-10-09.md)
passes **311 Node checks**: run the nine scripts in its adjacent verification
ledger, adding `scripts/ux/conversation-metadata-recovery.test.mjs` (63 cases) to
the preceding 248-case set below. The initial metadata baseline was 5 passed / 15
failed, then 20 passed; a separate harness-construction failure is not product evidence.
The recovery-edge checkpoint was 58 passed / 5 failed, then all 63 passed; it
covers complete title comparisons, untouched initial no-ops and stale check actions.
These tests execute real compiled callbacks/JSX and Query behavior, with explicit
hook/effect, transport, focus, authentication and portal doubles, not React lifecycle.

`python -m pytest tests/test_conversation_metadata.py tests/test_conversation_management_api.py`
passes **19 tests** on disposable SQLite (11 new metadata + 8 management). Set
process-local TEMP/TMP and storage roots under the task directory, and supply a
unique `--basetemp` there. No API implementation or migration changed. Prior 41-case
API and two skipped PostgreSQL concurrency checkpoints retain their separate meaning.
Lint, nonincremental typecheck and the bounded one-worker Web build pass. Browser discovery
finds **53 tests / 0 executed**, adding ten metadata cases at 375px Chinese/light
and 1440px English/dark: retained/Unicode/cleared input, real Reader updates while
refresh GETs are held, complete stored/display title comparison and applied/unapplied
unknown outcomes with failed read checks. The Reader case waits for its initial
visible title before inspecting the sidebar toggle.
Their focus, DOM, screenshot and source-invariance assertions remain unexecuted.
No further CI submission or deployment is authorized.

The preceding project-action/sidebar/archive/list/merge checkpoint passed **248 Node checks**
with `node --test scripts/ux/project-archive-recovery.test.mjs scripts/ux/sidebar-read-recovery.test.mjs scripts/ux/project-fixture-cleanup.test.mjs scripts/ux/archived-project-recovery.test.mjs scripts/ux/conversation-list-recovery.test.mjs scripts/ux/merge-admission.test.mjs scripts/ux/project-recovery.test.mjs scripts/ux/merge-reentry.test.mjs`:
43 archive-action, 41 sidebar, 3 synthetic fixture-cleanup, 40 archived-project, 28 list, 43 admission,
21 project and 29 re-entry cases. They execute actual
hook/callback/static JSX code and subscribed QueryObserver/MutationObserver transitions with
explicit scheduling, transport/storage/portal/selection doubles; they are not
React lifecycle or browser evidence. Coverage includes cached-read recovery,
truthful active-empty states, read-only retries, no-selection merge recovery,
permission hiding and old callbacks before passive cleanup. Archived-project checks
add confirmed restore/cache publication, unknown-result read-only checking, surviving
result ownership, focus-owner callbacks and current-selection/deletion-confirmation
guards. Focus and lifecycle scheduling are doubles, not browser acceptance. Lint, separate
nonincremental typecheck and bounded one-worker Web build pass at this checkpoint.
Sidebar checks retain actual link/drop identifiers in static markup, distinguish
initial/empty/error states, hide denied-access rows and verify scoped original GETs.
The cleanup helper checks enforce the existing archived-before-delete rule through
a transport double; they are not API or browser execution.
Archive-action checks exercise the real compiled controller/menu/feedback with
synthetic confirmation and transport: one owner across menu copies, held-read
acknowledgement, active/archive cache separation, stale-confirmation/late-response
fencing and explicit read-only unknown-result recovery. Their focus tests use DOM
doubles, not real layout. No full-navigation or cross-tab persistence is claimed.

The previous **41 API passes** (disposable SQLite; admission/history/cancellation/
split-merge/project settings) apply to unchanged backend files, not a rerun here.
The earlier 54-, 85-, 93-, 121-, 157-, 161- and 205-case Node runs overlap these 248; do not sum them.
Failed baselines remain intact, including the 19 re-entry failures and eight
render-fence failures, plus 17 list contract failures across two findings.
Archived-project evidence preserves the original 9-pass/21-fail baseline, first
30-pass repair, 33-pass/3-fail review and 36-pass/4-fail selection review.
Sidebar evidence records its initial harness setup error separately, a 2-pass/33-fail
desired-contract run, an 8-pass/33-fail run with six passing controls, and the
41-pass repair. Fixture cleanup separately had 1 pass/2 failures before correction.
Archive-action evidence preserves its 4-pass/16-fail baseline, 20-pass first repair
and 43-pass expansion. Its ordinary failed-GET control prevents misreporting a
default non-throwing invalidation as an archive mutation failure.
The audit corrects the earlier confirmed-close inference:
callback-only failure did not prove a permanently stuck rendered dialog.

`test_merge_admission_postgres.py` adds two concurrent same-key cases; both are
**skipped**, not passed, with `SETTINGS_POSTGRES_INTEGRATION=0`. No PostgreSQL
fixture is restarted. At that checkpoint, `playwright test --config=playwright.config.ts
ux-recovery-followup.spec.ts --list` discovered **43 cases**: the nine prior cases,
four merge, six list-recovery, ten archived-project, eight sidebar and six project-archive cases.
No browser case ran in this local batch.
The merge cases use the isolated mutation
fixture and intended real POST/worker/reload checks, original-key retry and failed
GET. Recovery now opens without selection; project cases remove only synthetic
source memberships, while all-list cases explicitly double empty/failed list reads.
Result visibility/focus must complete while an actual task refresh is held;
source-message invariance and 375/1440 synthetic screenshots remain required.
The six list cases require actual reading-node/focus and selection continuity,
held read-only Retry, unchanged synthetic messages/status, and a real Archive
destination. Empty active/existence responses are explicit read doubles; an
injected 503 is not a real outage. Ten archived-project cases add selected-node
continuity, single/bulk acknowledgement while reads are held, applied/unapplied
lost-response checks with failed GET recovery, and single/bulk deletion cancellation
after actual refreshed membership changes. They assert unchanged synthetic source
messages and membership; final-row responses explicitly filter real results and do
not claim an empty database. Discovery starts no server and does not execute
these assertions. The eight sidebar cases require retained actual DOM/focus through
failure, held scoped Retry without other reads/writes, initial-project error versus
empty guidance, unchanged synthetic source/membership and 375/1440 screenshots.
Sidebar/archive reconnect probes advance beyond QueryProvider's existing 15-second
stale time. Synthetic project cleanup re-archives only its created fixture before
DELETE; earlier discovery did not exercise this missing precondition. The six new
archive-action cases require acknowledgement/focus while actual reads are held,
recovery after menu/drawer closure, failed result-check recovery and explicit retry
only after an active result. They assert the original PATCH payload, unchanged
synthetic messages/relations and exactly one applied archive revision bump. These
assertions and their screenshots have not run. No new CI is authorized. See
[merge evidence](execution/ux-audit-merge-admission-2026-10-09.md) and the separate
[earlier list checkpoint](execution/ux-audit-conversation-list-recovery-2026-10-09.md)
and [archived-project checkpoint](execution/ux-audit-archived-project-recovery-2026-10-09.md),
then [the sidebar checkpoint](execution/ux-audit-sidebar-read-recovery-2026-10-09.md)
and [the project-archive checkpoint](execution/ux-audit-project-archive-feedback-2026-10-09.md).

Local-only project recovery (2026-10-09): `node --test scripts/ux/project-recovery.test.mjs`
passes 21 callback/query/static-markup checks. The project settings API suite
passes 7 cases; the combined settings/projects/ownership batch passes 20, including
those same 7 (do not sum them). Lint, nonincremental typecheck and the bounded
one-worker Web build pass. No local Web server, PostgreSQL fixture or browser was
started; real layout/focus acceptance remains NOT_VERIFIED. This batch is excluded
from CI 37812290017 and remains uncommitted. See the
[verification ledger](execution/ux-audit-project-recovery-2026-10-09.md#verification-ledger).

## Current release verification — 2026-10-08

The [release record](execution/OPTIMIZATION_RELEASE_2026-10-08.md) owns exact-source
CI and every failed attempt. Accepted source `30a0d32` / 37773748374 passes all
five CI jobs: API **1,181 passed / 3 skipped**, all 13 Web gates, settings
**439 passed / 0 failed / 0 skipped**, plus one separate fresh-instance restore.
The earlier `7825e60` import-retry failure remains a failed historical checkpoint.
The 16 formerly pending selection/offline cases did execute in isolated CI.
Default PWA retains 588 conditional skips; adaptive-import recovery retains one.
Production HTTP/data acceptance is recorded separately from browser execution.
No local specified-Chromium application acceptance is inferred. Other dated
sections below retain their original checkpoint meaning.

### Follow-up CI acceptance — a12ce9e

[CI 37812290017](https://github.com/foolkking/chat-reader/actions/runs/37812290017)
passes all five jobs at a12ce9e: API **1,181 passed / 3 skipped / 16 warnings**;
all 13 Web gates, including **18 negative PWA / 26 mutation passes**; settings
**439 passed** plus one fresh-instance restore; image build and independent
inspection. Default PWA has **135 passes / 597 conditional skips**, adaptive
import **8 passes / 1 conditional skip**. Eight exact-source synthetic recovery
screenshots were reviewed. This completes the authorized CI repair cycle.
Artifact 11567238870 is **not deployed**, and excludes the new local project/merge
batches. No more commit/push, CI or deployment without explicit user direction.
Exact IDs/digests are in [the acceptance evidence](execution/ux-audit-post-release-recovery-2026-10-08-evidence/ci-a12ce9e.json).

### Earlier follow-up checkpoints — historical

The [follow-on recovery audit](execution/ux-audit-post-release-recovery-2026-10-08.md)
adds `e2e/ux-recovery-followup.spec.ts` to the existing `source-editor-mutation`
gate, under its existing isolated `E2E_MUTATION_FLOW=1` boundary. Nine cases cover
partial/unknown undo, lost acknowledgement plus failed refresh, zero-success
batch handling, mixed-type search pagination, Recent refresh/anchor preservation
and project-filter read recovery. An injected failure precedes each recovery;
read checks assert no duplicate writes. Synthetic 375/1440 screenshots are saved
to the gate output. At source 56930fe / CI 37795767145, all nine new cases and
all 26 mutation cases pass; eight screenshots were reviewed. The full run fails
one negative PWA case (16 passed / 1 failed), while settings is cancelled and
image jobs are skipped. Default PWA: 135 passed / 597 conditional skips; adaptive
import: 8 passed / 1 conditional skip. Do not promote this source to acceptance.
The separate three Node baseline checks use accepted source and do not count as
browser tests.

The same-revision shell fix adds `scripts/pwa/offline-shell.test.mjs` to Web CI.
Run it with `node --test scripts/pwa/offline-shell.test.mjs`: six synthetic regressions
exercise actual worker/client code, targeted repair, failure/retry, preservation
and the complete-cache fast path. They pass locally after a 2-pass/4-fail baseline.
`PWA-NEG-026` adds an optional-only online reload case to the existing negative
gate, preserving all original assertions. Full browser verification of this
repair is pending. Settings' total job budget is now 60 minutes: the failed run
logged 439 passes in 41.8 minutes and one restore pass before the former 45-minute
job limit cancelled its final step. Individual case timeouts/requirements remain
unchanged. The user's latest instruction permits finishing this CI cycle only;
later CI submissions and all follow-up deployment require a new explicit request.

At eceadc6 / CI 37805638620, the original negative recovery passes, but the
new optional-only case fails its same-revision assertion: **17 passed / 1 failed**.
The trace contains identical 101-asset manifests with different revisions.
The client hashed duplicates introduced after raw-URL deduplication. Nine
expanded Node checks reproduce that defect (**6 passed / 3 failed** before
repair); canonical-URL-first deduplication makes all **9 pass** locally. The
existing negative browser assertions are unchanged. That run's settings job
finishes successfully: **439 passed / 0 failed / 0 skipped** and **1 passed**
fresh-instance restore. API passes **1,181 / 3 skipped / 16 warnings**; both
image jobs are skipped because Web failed. Full CI acceptance of the revision
repair is still pending; this fix must not include the separate local-only
project audit/tests. See the [failed-source evidence](execution/ux-audit-post-release-recovery-2026-10-08-evidence/ci-eceadc6.json).

For Windows paths in `PYTEST_ADDOPTS`, use forward slashes, for example
`C:/Users/86182/Desktop/wkkk/<batch>/pytest`. Its shell-like parser consumes
unquoted backslashes. TEMP/TMP alone cannot correct malformed `--basetemp` or
`--junitxml` arguments; verify the intended task directory after launch.

## Historical local selection and attachment-failure checkpoint (2026-10-08)

The new [release continuation](execution/OPTIMIZATION_RELEASE_2026-10-08.md) is
explicitly authorized to commit, run CI and deploy verified images. Its single
original-command local Web attempt was again rejected before process creation.
The 16 cases remain locally unexecuted; they are included in the existing release
CI's **439-case settings matrix**. Current local lint, nonincremental typecheck,
bounded build, head 0050 and 33 offline/task API tests pass. Do not count discovery
or eventual CI execution as a specified-Chromium local acceptance run.

The settings CI PostgreSQL service uses loopback **65438**, matching the guarded
synthetic task seeders; the separate API/Web jobs retain 5432. The first accumulated
run's 11 port-guard failures and 226 cascading login-limit failures are retained
in the release record. Login limits and synthetic-owner guards are unchanged.
The noise-review helper can reopen a review from the still-visible Task Center;
its recovery case explicitly checks that Escape closed only the nested review.

Latest direction: use the user's exact task-owned Chromium executable against
local services only. Chromium 151.0.7922.34 launched and closed on `about:blank`;
this is a runtime preflight with zero application cases. A task-local config
inherits the repository test configuration, pins that executable, disables the
channel override and sets `webServer: undefined` so it cannot launch a fallback.
The 16-case list succeeds. Explicitly reauthorized loopback Web startup was still
rejected before process creation. See the
[preflight record](execution/specified-chromium-preflight-2026-10-08.md); the earlier
[blocked checkpoint](execution/local-browser-acceptance-block-2026-10-08.md) is historical.

The [policy diagnosis](execution/local-execution-policy-diagnosis-2026-10-08.md)
confirms effective full access / Never and no matching local deny rule. The
precise rejecting policy is unknown; previous automatic-review attribution is
not established. No further authorization or successful application run is implied.
After the user-reported Codex restart, one original-command retry returned the
same pre-process rejection. All four fixture ports remain idle and the 16 cases
remain unexecuted. Restarting the client is therefore not a verified resolution.

`settings-cleanup-recovery.spec.ts` has eight pending acknowledgement-loss cases.
`settings-offline-recovery.spec.ts` has eight attachment-guidance cases: two retain
existing copies, four cover empty/unrelated-copy libraries, and two exercise Task
Center entry to an actual download on this device. Retained-copy cases enter the
matching failure page from Task Center; the wide case adds 20 synthetic failed
metadata rows to exercise page two. Opening must not admit or retry a download.
The new-device cases require explicit admission, worker ZIP, IndexedDB persistence,
reopening the existing record and actual Library content, without generic task
retry. Only failure transport/display and paging metadata are injected; successful
downloads remain real. These are intended assertions, not passing browser evidence.

The 16 cases pass discovery (`--list`), not execution. Current lint, nonincremental
TypeScript and bounded build pass. After the user's continuation, the execution tool
again rejected loopback `next start`; no substitute server was launched. The new
isolated database reached 0050 and all owned fixture services stopped. Use the same
`API_INTERNAL_URL` when building and serving: fallback rewrites are stored in the
build manifest. Current prepared build points to the isolated API on port 8008.
See [failure-guidance evidence](execution/offline-error-guidance-2026-10-08.md) and
the [task recovery follow-up](execution/offline-task-recovery-2026-10-08.md).

`test_offline_task_recovery.py` has 11 passing cases: four scope projections, six
invalid/legacy/unrelated payloads, and one real HTTP/worker/ZIP failure-to-repair
flow. The last case checks fresh/idempotent admission, bytes, unchanged message
versions and another owner's denied task/admission/download access. Its server
principal is supplied by synthetic middleware; this is not a login/browser test.
The fixture uses SQLite with foreign keys, not PostgreSQL. With task API and
attachment-integrity regressions, the focused gate is **33 passed, zero failures,
errors or skips**. Earlier full API/PostgreSQL gates predate this response-field
change and are not claimed as a new full gate. Local Alembic remains head 0050.

## Cleanup validation work (2026-10-08, local)

`test_cleanup_validation_work.py` checks real select/preview/apply output and
version persistence while counting full-source work for 32/128 candidates.
Each message/rule is detected once, protected content remains intact and different
sources/revisions remain separate. Final union with cleanup, safety, access,
selection, learning and outcome regressions: **85 API cases and 11 actual
PostgreSQL cases passed, zero skipped**. Baseline failures and single-sample
timings are retained in the [execution record](execution/cleanup-validation-work-2026-10-08.md).
Browser/PWA acceptance remains pending; API timing is not browser or production
performance evidence. No Web change, new migration or release in this batch.

## Cleanup source identity (2026-10-08, local)

`test_cleanup_source_replacement.py` uses real edit/replace/preview/apply APIs to
verify exact source binding, including whitespace-only changes whose normalized
hash and version ID remain unchanged. `test_cleanup_source_postgres.py` covers
unchanged/unknown migration backfill, upgrade/downgrade, edit/cleanup blocking,
cached same-ID source rejection and edits during preview using actual PostgreSQL.
Source/version counts verify results. With related cleanup, message history,
Reader/locator, attachment, split/merge and repair regressions, **84 API cases and
11 PostgreSQL cases pass, zero skipped**. See the
[source-safety record](execution/cleanup-source-safety-2026-10-08.md) for failures
and evidence. Local head is 0050; production remains 0048. Browser/PWA acceptance
is pending the recorded automatic loopback Web-start rejection, not counted as passed.

## Noise scanning lifecycle (2026-10-08)

`test_cleanup_scan_lifecycle.py` verifies actual worker failure projection,
queued/repeated cancellation, source preservation, fresh rescan, incomplete-apply
rejection, retention and account isolation. Shared task/merge/worker regressions
cover the expanded cancellable-job set. `test_cleanup_scan_lifecycle_postgres.py`
uses real threaded transactions for cancellation versus both chunk requeue and
final publication, completion-first behavior and stale cancellation recovery.

`settings-noise-scan-lifecycle.spec.ts` covers live/cancelling/cancelled/failed
details, rescan, uncertain-response checks, explicit retry, focus and account
changes, plus retained imported content. Claimed intervals use guarded synthetic
jobs with current heartbeats; missing heartbeats let real stale recovery finish
them and invalidate the intended setup. API writes/reads and worker completion
are real; long wall-clock scans are represented by the separate threaded tests.
The browser fixtures accept loopback PostgreSQL ports 65438 and 45438 only; use
an available one without changing system port policy or unrelated processes.
Run with dismissal, rescan, noise navigation and Task Center regressions. Record
failed preparation and product failures separately in the
[batch audit](execution/ux-audit-noise-scan-lifecycle-2026-10-08.md).

## Noise dismissal and empty results (2026-10-08)

`test_cleanup_dismissal.py` verifies persisted idempotent dismissal, read-only
receipt lookup, source-version preservation, failed-task completion, running-state
rejection, rollback and account isolation. Run with cleanup access, rescan/scan
requests and outcomes. `test_cleanup_dismissal_postgres.py` uses an isolated real
schema for concurrent deletion, cached-row refresh and transaction rollback;
rescan/outcome PostgreSQL regressions preserve admission and completion behavior.

`settings-noise-dismissal.spec.ts` covers 375/768/1440px and both locales/themes,
zero-result retention/no reminder, real import, failed-task dismissal, conditional
selection confirmation, lost/undelivered responses, read failures, held refresh
and focus restoration without stealing focus. Failure/expiry fixtures update only
guarded synthetic rows in the disposable PostgreSQL. Writes and checks use actual
API/worker; transport failures are explicit fault injection. Run with rescan,
noise-navigation, global-scan, cleanup-completion and Task Center regressions.

Browser startup must set `AUTH_ENABLED=true` in addition to `APP_ENV=test` and
`E2E_SETTINGS_MAILBOX=1`; API-only fixtures may require a different auth mode.
Do not carry that API override into the Web process: it bypasses the private
browser boundary and invalidates account-switch acceptance. Capture synthetic
images with `SETTINGS_SCREENSHOT_DIR` under the AGENTS task TEMP/TMP directory.
The [batch audit](execution/ux-audit-noise-dismissal-2026-10-07.md) separates initial
product failures, environment mistakes and final evidence. No full PWA/API or
production acceptance is implied; local Alembic remains single head 0049.

## Rescan recovery (2026-10-07)

`test_cleanup_rescan_requests.py` exercises real admission retries, read-only
lookup, account/original-scan isolation, import parent/active scope, old selections,
new exceptions, actual apply and ended reviews. Global apply includes pre-update
pending jobs without a payload key. Run with scan-request/outcome/access/group
tests. `test_cleanup_rescan_postgres.py` verifies concurrent admission, actual
version counts after apply and 0048→0049→0048→0049 index/data/model equivalence;
run with scan-request/outcome PostgreSQL suites in an isolated database.

`settings-rescan-recovery.spec.ts` covers 375/768/1440px, both locales/themes,
conditional/cancelled confirmation, old-choice return, reload, dropped/undelivered
responses, deadlines, held task reads, ended/missing reviews and conflict/failed
entry recovery. Failure status is explicitly injected in one UI case; writes and
checks use actual API/PostgreSQL/worker. Run with noise-navigation and cleanup-
recovery specs for real import, source-protection, selection and preview regressions.
Use AGENTS C-drive TEMP/TMP/basetemp. This batch's source findings, failed checks,
resource-limited builds and final evidence belong to the
[rescan audit](execution/ux-audit-rescan-recovery-2026-10-07.md), not an inferred
full API/PWA or production pass. Local head is 0049; production remains 0048.

## System noise publication recovery (2026-10-07)

`test_cleanup_publication_recovery.py` verifies stale publish/withdraw, name-only
and withdrawal/republish bases, current-state reads, Root isolation, legacy DELETE,
acknowledgement consistency and audit rollback. Run with rule-grants/access/learning
and personal-edit suites; anonymous fixtures require AUTH_ENABLED=false, while
the auth fixture provisions its own enabled environment. Use the task's C-drive
TEMP/TMP and pytest basetemp as specified in AGENTS.

`test_cleanup_publication_postgres.py` runs three competing writes with preloaded
ORM state against disposable PostgreSQL. Run with `test_cleanup_rule_postgres.py`
and `test_cleanup_edit_postgres.py`, SETTINGS_POSTGRES_INTEGRATION=1.

`settings-publication-recovery.spec.ts` contains 18 real browser/API scenarios.
Run with `settings-rule-publication.spec.ts` and `settings-noise-navigation.spec.ts`
on the isolated settings API/worker/PostgreSQL fixture, E2E_SETTINGS_MAILBOX=1.
Recovery checks assert persisted state and absence of repeat writes; conflict
cases also assert freshly published match text. Route holds/lost responses are
fault injection, not mock success. The
[audit](execution/ux-audit-rule-publication-2026-10-07.md) preserves failed baseline,
environment/test corrections, passing gates and visual evidence separately.

## Personal rule-edit concurrency (2026-10-07)

`test_cleanup_edit_concurrency.py` covers name-only changes before/after trial,
explicit rebase, omitted-token signature safety, legacy unchanged submissions,
concurrent disablement and preserving a disabled switch. With learning/grants/
access regressions, 18 cases pass. `test_cleanup_edit_postgres.py` preloads stale
ORM objects in two concurrent sessions and proves one save/one conflict without
creating matcher revisions; a shared-identity test proves independent account
bases. Alongside existing PostgreSQL cleanup/rule suites, eight cases pass.

`settings-rule-edit-concurrency.spec.ts` uses two real browser pages at each of
375/768/1440 widths. Six cases cover remote name edits before/after trial, disabled
rules, draft comparison, keyboard focus and explicit save while retaining one
matcher revision. Combined with rule recovery/actions/learning/publication and
selection-scope tests, the final gate has 51 passes, zero skips. A learning-case
rerun is additional verification, not a 52nd distinct case. Two transient Web
proxy resets during unrelated list reads are documented in the
[audit](execution/ux-audit-rule-edit-concurrency-2026-10-07.md); their origin was
not proven. Full API/PWA and all offline negatives were not rerun.

## Noise selection scope (2026-10-07)

`settings-noise-selection-scope.spec.ts` adds five real API/PostgreSQL browser
cases: cross-group/cross-page selection and canonical apply at 375/768/1440,
failed scope reads and legacy responses without summary metadata. Keyboard
navigation, close/reopen, selected-only empty groups and protected text are
asserted. Run with noise-navigation (including real import), noise-diff,
cleanup-recovery/completion/layout and content-cleanup suites; enable
`E2E_SETTINGS_MAILBOX=1` and `E2E_CONTENT_CLEANUP=1` with the isolated fixture.
The final combined gate has 45 passes and no skips. The initial three failures
were a test wrongly reopening Task Center while it remained open; two cases did
not run in that first gate. Both reports are retained in the
[audit](execution/ux-audit-noise-selection-scope-2026-10-07.md).

`test_cleanup_selection_summary.py` checks whole-scope totals across page offsets,
empty scopes, rule filtering and independent clearing. It runs with cleanup
group-search/access/safety/preview-ranges (40 passes), plus existing PostgreSQL
cleanup/rule concurrency and migration suites (6 passes). The browser tests also
exercise the new aggregate query in PostgreSQL. This does not certify full PWA,
all offline negatives or the entire API suite.

## Personal noise-rule action recovery (2026-10-07)

`settings-rule-actions.spec.ts` uses the isolated authenticated
PostgreSQL/API/worker fixture with `E2E_SETTINGS_MAILBOX=1`. Sixteen browser cases
cover held post-save reads, lost status/version/delete responses, read failure,
unsubmitted/timeout actions, stale history, removed rules, failed post-save list
refresh and reopening. The real scan-cycle case verifies selected versions and
enablement affect new scans while old occurrences/decisions and canonical message
text remain unchanged. Three widths include Chinese/light and English/dark.

Run alongside rule-learning, rule-recovery, rule-publication, global-scan-recovery,
noise-navigation, exception-recovery and cleanup suites. Backend regression uses
cleanup_rule_grants, cleanup_learning, cleanup_access and the real PostgreSQL
cleanup_rule_postgres / cleanup_postgres suites. These remain scoped tests, not
full PWA/API certification. Finish build and static checks sequentially before
starting the resource-sensitive browser fixtures. Preserve failure evidence; see
the [audit](execution/ux-audit-rule-actions-2026-10-07.md).

## Global noise-scan admission recovery (2026-10-07)

`settings-global-scan-recovery.spec.ts` uses the authenticated isolated
PostgreSQL/API/worker fixture with `E2E_SETTINGS_MAILBOX=1`. Its ten cases cover
confirmed admission with a held list read, lost response/read failure/reload,
same-key retry, closed reviews, empty scope, disabled rules followed by enabling
one, the actual 20-second deadline and scanning from an embedded rule library.
Three widths exercise focus inside Task Center, Shift+Tab, opening a real review
and Escape back to its trigger. Failures are injected around actual API writes;
the tests check persisted task counts rather than a mocked success alone.

Run with noise-navigation, exception-recovery, rule-learning, rule-recovery and
cleanup suites. The shared focus repair additionally runs task-center and
presentation suites. `test_cleanup_scan_requests.py` covers five API scenarios;
`test_cleanup_scan_requests_postgres.py` runs concurrent same-key admission in
real PostgreSQL alongside the existing cleanup concurrency suite. No new schema.
Use process-local TEMP/TMP and pytest basetemp below the task's C-drive wkkk
directory; finish build before running resource-sensitive browser fixtures.
The [dated audit](execution/ux-audit-global-scan-recovery-2026-10-07.md) preserves
baseline failures, the caught focus defect and the interrupted environment run.

## Exception recovery (2026-10-07)

`settings-exception-recovery.spec.ts` adds 11 isolated browser cases: stale
scope refusal, held last-page refresh after a committed revoke, lost save
responses/read retry at three widths, undelivered saves at two widths, uncertain
revoke plus list failure/retry, expired confirmation, an actual 20-second read
deadline, and selected-only save preserving other decisions. All mutations and
final counts/body/version assertions use the real API/PostgreSQL fixture; only
the named network failure/held response/invalid token is injected.

With the rule recovery/learning/publication, navigation, differences and cleanup
suites, 60 distinct cases have passing evidence. The first complete run was
59 passed/1 rule-return focus failure; after restoring focus in the committed
list's layout effect, the affected 35 cases passed/0 skipped. No unchanged
navigation/diff/cleanup rerun is implied. Lint, nonincremental TypeScript and
ordinary Web build passed after the last code edit. API learning/access/grants
11 plus safety 28 passed; PostgreSQL cleanup/rule 6 passed under isolated schemas.
Head remains `20261006_0048`. See the
[audit](execution/ux-audit-exception-recovery-2026-10-07.md) for two genuine
baseline failures, preparation failures and aggregate evidence. The 0-test
missing-file command is retained separately. Full API/PWA, independent offline/
Share matrices, external Skill and production checks were not rerun.

## Rule learning recovery (2026-10-07)

`settings-rule-recovery.spec.ts` adds twelve isolated authenticated cases: a
confirmed save while list refresh is held; three-width lost-response checks with
a failed GET/retry and no second write; three-width real revision conflict,
readable field comparison and focus return; failed fresh comparison; new-rule
result lookup; an unsent save; server rejection of a timestamp-modified trial
token; and the actual 20-second trial deadline. Synthetic match text is unique
per fixture so global configuration deduplication does not invalidate assumptions
about new revision ordinals. Successful mutations and final reads use real API/
PostgreSQL data. Fault injection affects only the specified request/response.

Run with `settings-rule-learning`, `settings-rule-publication`,
`settings-noise-navigation`, `settings-noise-diff` and `settings-cleanup` under
`E2E_SETTINGS_MAILBOX=1`: **49 passed, zero skipped** on the final build. This
also exercises shared editor use from a review, explicit exceptions, publication,
retained grants, real import/global scans, protection, preview and actual cleanup.
Use the existing process-local synthetic auth fixture and set `API_INTERNAL_URL`
at build and start.

API: `test_cleanup_learning`, `test_cleanup_rule_grants`, `test_cleanup_access`
(11 passed). The anonymous fixture requires `AUTH_ENABLED=false` in the runner;
the dedicated ownership tests enable auth themselves. PostgreSQL:
`test_cleanup_rule_postgres`, `test_cleanup_postgres` (6 passed), with
`SETTINGS_POSTGRES_INTEGRATION=1` and disposable schemas. The
[audit](execution/ux-audit-rule-learning-recovery-2026-10-07.md) preserves initial
environment/locator/shared-identity assertion failures and corrected runs. This
is no new full API/PWA, independent Share/offline, external Skill or production
gate. Only aggregate test evidence and synthetic screenshots belong in docs.

## Noise difference preview (2026-10-07)

`settings-noise-diff.spec.ts` adds eight authenticated-fixture cases: three-width
long Unicode messages with exact text/markers, previous/next positioning in both
panes and actual saved new versions; three missing/mismatched/malformed metadata
fallbacks; a real source-version conflict; and eleven-message paged preview.
The mobile case checks that the active after-boundary remains in the viewport.
Only the three fallback cases alter GET metadata; scan/selection and remaining
responses come from the real PostgreSQL/API/worker. Before confirmation, source
text remains unchanged. After confirmation, exact expected text is read back.

Run with `settings-noise-navigation`, `settings-cleanup-recovery`,
`settings-cleanup-completion`, `settings-cleanup` and `content-cleanup`, using
`E2E_SETTINGS_MAILBOX=1`, `E2E_CONTENT_CLEANUP=1` and the existing isolated fixture.
Set `API_INTERNAL_URL` at both build and start. API coverage is
`test_cleanup_preview_ranges`, `test_cleanup_safety`, `test_cleanup_access`,
`test_cleanup_outcomes` (40 passed); PostgreSQL coverage is `test_cleanup_postgres`
and `test_cleanup_outcomes_postgres` (6 passed).

Browser evidence is 42 regression passes followed by eight final difference
passes, comprising seven reruns and one new malformed-metadata case: **43 distinct
cases**, zero skipped. The last pass follows shorter mobile panes and stronger
metadata guards; unchanged navigation/recovery cases were not repeated again.
The [dated audit](execution/ux-audit-noise-diff-2026-10-07.md) retains the expected
baseline failure, all four browser summaries, API/PG summary and reviewed images.
No full PWA/API, production, external Skill, performance benchmark or formal
accessibility acceptance is inferred from this scoped batch.

## Import/global noise navigation (2026-10-07)

`settings-noise-navigation.spec.ts` has eleven isolated authenticated cases:
real file import and scoped completion entry at three widths, conversation-wide
rules/bulk application at three widths, preserved preview scroll/focus/expanded
contexts at three widths, 102-conversation paged search, and actual rule-library
global admission excluding archives. The import case checks failed metadata reads
and rescan return focus. It asserts real final message text, protected source and
unrelated-conversation preservation. Run with the six existing cleanup/layout/
recovery/completion/learning suites, using `E2E_SETTINGS_MAILBOX=1` and
`E2E_CONTENT_CLEANUP=1`. Set `API_INTERNAL_URL` for both build and Next start;
the test fixture serves API8008, not the default8000.

API: `test_cleanup_group_search`, `test_cleanup_access`, `test_cleanup_safety`,
`test_cleanup_outcomes`, `test_content_cleanup`, `test_import_queue`: 70 passed.
PostgreSQL: `test_cleanup_postgres`, `test_cleanup_outcomes_postgres`: 6 passed.
Final browser coverage is 44 distinct passing cases, obtained as 43 in delivery
and one corrected fresh-global-admission rerun. The first global fixture reused
the existing scan and incorrectly expected its old exclusion count to update;
the corrected fixture explicitly dismisses that seed before fresh admission.
An earlier source-flow skip was subsequently run successfully, not counted as
passed while skipped. Intermediate failures, 3 baseline/65 final screenshots
and full limitations are in the [dated audit](execution/ux-audit-noise-navigation-2026-10-07.md).
No new full API/PWA, production or external Skill pass is inferred.

## Registration-policy recovery (2026-10-07)

`settings-registration-recovery.spec.ts` adds twelve authenticated-fixture cases:
three-width conflicts and lost real responses, actual pending-account/login refusal,
failed reads, second mode conflict, invitation draft retention, unsent saves, real
request deadlines, unavailable mail discovery and remote language changes. The mail
browser case changes discovery only; API tests independently remove actual SMTP config.
The existing `settings-registration.spec.ts` covers real SMTP confirmation/approval
and settings dismissal/scroll. `account-access-settings.spec.ts` remains two UI mocks
plus a source-contract check; its authenticated-gate setup now supplies the server
session before mocking browser reads and follows changed-field request contracts.
These mocks are not evidence of server permission enforcement.

Use the existing `E2E_SETTINGS_MAILBOX=1` fixture, synthetic admin, isolated upstream
and explicit disposable database, with task-local TEMP/TMP. Final browser gates total
22 distinct checks: 19 integration flows, 2 UI mocks, 1 source-contract check; no skips.
The audit retains failed baseline and wrong-fixture runs as failures.

`test_registration_policy_recovery`, `test_registration_verification`, `test_auth`,
`test_admin_users` and `test_admin_invitation_audit` have 62 distinct passing cases
across the regression run and corrected seven-case suite. The original regression
had 61 passes plus a wrong exception-vs-HTTP assertion; only affected tests were rerun.
`test_registration_policy_postgres` has three actual disposable-PostgreSQL checks
for cached ORM contention, legacy partial writers and initial mode preservation,
enabled by `SETTINGS_POSTGRES_INTEGRATION=1`. All tests use actual persistence;
application middleware's 500 handling and rollback are checked directly.

## Feature-policy recovery (2026-10-07)

`settings-feature-recovery.spec.ts` uses the real authenticated settings fixture
with eleven cases: stale multi-window edits at three widths, lost real PUT
responses, failed recheck, another same-field conflict, explicit server choice,
an unsent save, matching remote values, and actual 20-second GET/PUT deadlines.
Assertions inspect the partial request, persisted policy, effective capabilities,
keyboard focus and absence of automatic repeat writes. Held/aborted requests
simulate network faults without substituting successful mutations.

Run with `E2E_SETTINGS_MAILBOX=1`, synthetic Root credentials, explicit disposable
`DATABASE_URL`, the isolated `API_INTERNAL_URL`, and task-local TEMP/TMP. Related
browser regressions are `settings-shares`, `settings-export-retention` and
`settings-help-runtime`. The latter exercise actual downloads/reclamation and
cached offline capability boundaries. Gate outcomes and reviewed screenshots are
recorded in the [audit](execution/ux-audit-feature-policy-recovery-2026-10-07.md).

API suites: `test_feature_policy_recovery`, `test_admin_system`,
`test_registration_verification`, `test_export_retention`, `test_support_requests`.
`test_feature_policy_postgres` requires `SETTINGS_POSTGRES_INTEGRATION=1` and an
explicit disposable PostgreSQL URL; the shared fixture creates its own database,
applies migrations, tests real row/advisory locks and drops only that database.
It covers cached ORM races, legacy disjoint writes and initial read/write creation.
SQLite timestamp metadata is normalized in comparisons, not treated as a product
revision change. This does not constitute a new full API/PWA or release gate.

Final evidence: 58 API and 3 PostgreSQL passes; 40 distinct browser-gate cases
(39 real browser flows and one diagnostic serializer case), zero skips. The
combined 40-case gate precedes only the final feature action-row placement;
all eleven affected feature cases passed again with viewport assertions.
Unchanged Share/export/help regressions were not needlessly repeated. All 46
retained final screenshots were reviewed; initial failures remain in the audit.

## Skill replacement recovery (2026-10-07)

`settings-skill-recovery.spec.ts` adds 14 cases on the authenticated isolated
PostgreSQL/API fixture. It tests personal/system acknowledgement during held and
failed list reads at three widths, real lost-response retry without another revision,
malformed ZIP replacement, retained files through conflict/read failure/another
update, and system restore to revision 0. Actual downloaded member bytes, persisted
revision counts and keyboard recovery are checked; writes are never mock successes.

Run with `context-skill-bundles.spec.ts`, `E2E_SETTINGS_MAILBOX=1` and
`E2E_CONTEXT_BUNDLES=1`, plus the documented synthetic admin/upstream/database and
task-local TEMP/TMP. The consumer regression replaces a selected Normalizer then
reopens the existing failed import in the same browser, proving the old resolved
cache does not supply the download. Final browser result: **23 passed / 0 skipped**.

The four API suites `test_skill_bundles`, `test_skill_zip_defaults`,
`test_skill_unified_preferences` and `test_skills_api` have **34 passes / 0 skips**.
Their SQLite/file fixtures are separate from the real PostgreSQL browser checks.
The [dated audit](execution/ux-audit-skill-replacement-recovery-2026-10-07.md) retains
all six browser gates, initial fixture errors, the reproduced revision-0 implementation
gap and 30 reviewed final screenshots. It is not full API/PWA or production acceptance.

## Account settings recovery (2026-10-07)

`settings-account-recovery.spec.ts` runs 13 cases with actual registration and
PostgreSQL-backed identity/session mutations. At 375/768/1440px it checks independent
read failures, preserved username/password drafts and focus, newer input during
save, failed-save retry, and late identity/session responses. Another real session
must become unauthorized after logout-others while the current device stays signed
in. A lost response is injected only after a real 204; Refresh verifies actual
state without a second POST. English/dark and Chinese/light are covered.

Use the existing isolated authenticated settings fixture with
`E2E_SETTINGS_MAILBOX=1`, synthetic admin credentials, `API_INTERNAL_URL`, explicit
disposable `DATABASE_URL`, and task-local TEMP/TMP. Run the account suite together
with `settings-email-change.spec.ts`, `settings-pending-signout.spec.ts` and
`settings-signout-cleanup.spec.ts`. The final gate has **25 passes / 0 skips**;
the latter suites exercise SMTP, retained offline data and explicit signout recovery.
Fault injection never substitutes a mock success for a mutation/persistence check.

The [dated audit](execution/ux-audit-account-security-recovery-2026-10-07.md) retains
four gate summaries, three valid baseline and 31 final synthetic screenshots. Its
first run's device-label assumption is a fixture failure, not a product regression.
Intermediate overlapping gates are not added to the final count. This frontend
batch does not claim a new full API/PWA, migration or production acceptance.

## Cleanup layout (2026-10-07)

`settings-cleanup-layout.spec.ts` uses two real conversations and seven real
occurrences at 375/768/1440px. It checks visible source identity, the exact match
with a nontransparent highlight, initially collapsed rule actions, keyboard
disclosure, complete server context, persisted selection and unchanged canonical
text. Disclosure stays open after selection refresh and closing it keeps the
saved decision. Short fixture rows have a bounded height; full match text is
never truncated to satisfy that check.

The completion suite additionally checks compact height, absence of obsolete
full-scan actions, result focus and real Task Center reentry. At 375/768px width
it shrinks height to 360px, then checks header visibility, focused action bounds
and actual successful retry/close. This is a short-viewport check, not a complete
browser-zoom or assistive-technology audit.

Run with `settings-cleanup-completion`, `settings-cleanup-recovery`,
`settings-cleanup`, `content-cleanup` and `settings-rule-learning` under the
isolated settings fixture documented below. The final gate has **33 passes and
zero skips**; learned exceptions/rule versions are persisted through real APIs.
The [layout audit](execution/ux-audit-cleanup-layout-2026-10-07.md) keeps failed
baseline and intermediate evidence, final three-width screenshots and scope
limits. Backend/schema were unchanged, so no new full API/PostgreSQL/PWA pass is
inferred from this presentation batch.

## Cleanup completion (2026-10-07)

`settings-cleanup-completion.spec.ts` uses real registration, source, scans,
decisions and commits at 375/768/1440px. It aborts an apply response only after a
real 200, fails/retries outcome reads, reloads into the completed Task Center
result, and separately fails/retries source-editor reloads. Each path verifies
the actual version/text and exactly one browser apply. Mobile editing checks
action-sheet dismissal and focus on the first editor selection. Use
`E2E_SETTINGS_MAILBOX=1`, `E2E_CONTENT_CLEANUP=1`, synthetic admin credentials,
`API_INTERNAL_URL`, **explicit `DATABASE_URL` for the disposable fixture**, and
process-local TEMP/TMP. Task Center's Python fixture refuses a missing database
environment value so it cannot fall back to a developer's local configuration.

Run with `settings-cleanup-recovery`, `settings-cleanup`, `content-cleanup`,
`settings-rule-publication` and `settings-task-center`. The final six-suite gate
has 35 passes / 0 skips. `test_cleanup_outcomes` checks real persistence,
POST replay, missing receipts, partial failure/rollback, terminal window and
Reader/Share/TOC/search/offline consistency; `test_cleanup_access` checks another
account both before and after completion. `test_cleanup_outcomes_postgres`
checks final-message/receipt atomicity, concurrent HTTP replay and actual FK
account deletion alongside the existing cleanup PostgreSQL suites.

The dated [audit](execution/ux-audit-cleanup-completion-2026-10-07.md) records
101 API and 8 PostgreSQL passes, all failed gates, screenshot review and exact
limits. These counts are scoped; no new whole-site API/PWA or production pass
is inferred. The previous batch's PWA results remain historical evidence.

## Noise-review recovery (2026-10-07)

`settings-cleanup-recovery.spec.ts` requires the isolated authenticated PostgreSQL/
API/worker fixture and `E2E_SETTINGS_MAILBOX=1`. It checks 51-selection page shrink,
keyboard/group return, real single/bulk acknowledgement during delayed or failed
reads, saved choices after reopening, cached preview failures, source conflicts,
rescan and exact persisted text. Run with `settings-cleanup.spec.ts` and the source
editor `content-cleanup.spec.ts` (`E2E_CONTENT_CLEANUP=1`). Route overrides inject
only read failures/delays; saves, conflicts, scans and applies use the real backend.

Corresponding API checks: `test_content_cleanup`, `test_cleanup_safety`,
`test_cleanup_access`, `test_cleanup_learning`, `test_cleanup_rule_grants`.
`test_cleanup_postgres` and `test_cleanup_rule_postgres` require
`SETTINGS_POSTGRES_INTEGRATION=1` and the explicitly disposable database.
Use nonempty synthetic endings instead of assuming creation preserves trailing
blank lines. Repeated failed Playwright tests recreate workers and can exhaust the
existing administrator login throttle; retain failed evidence and wait its window,
never weaken production limits. The dated audit records exact gate outcomes.

## Offline download recovery (2026-10-07)

`settings-offline-recovery.spec.ts` uses an isolated authenticated PostgreSQL/API/
single-worker fixture with `E2E_SETTINGS_MAILBOX=1`. It checks actual admission keys
and task IDs, persisted IndexedDB messages, damaged-package rebuilding, offline
cancellation/removal, terminal-query outages, lost receipts, cancellation backoff,
desktop search focus and shrinking pagination. Route fault injection only creates
failures/delays; success is supplied by the real API and worker. Gate evidence and
synthetic screenshots belong to the dated offline recovery audit.

Run alongside `settings-offline-center`, `settings-offline-lock`,
`settings-offline-sync`, `settings-offline-conflicts` and `settings-reading-sync`.
Run `auth-gate` separately: its password-change test deliberately rotates the
fixture owner's password. Reusing the old credential for a following settings
batch causes real 401 responses and login throttling. Reset/recreate the synthetic
fixture between those gates, or explicitly use its rotated credential; do not
disable production authentication/rate-limit behavior to make tests pass.

The standard build/default PWA matrix uses an auth-disabled fixture. The negative
matrix requires its separate `NEXT_PUBLIC_PWA_NEGATIVE_TESTS=1` build and covers
real v1/v2/v3 ingestion, quota, interrupted writes, damaged resources and restarts.
Preserve conditional skips separately from pass counts. On Windows, all task
profiles and temporary fixture data follow AGENTS.md's process-local TEMP/TMP.

## Whole-site UX gate (2026-10-04)

`e2e/ux-whole-site.spec.ts` runs under `E2E_MUTATION_FLOW=1` in the required
source-editor mutation CI gate. It uses real isolated API/worker writes for draft
recovery, 60-result pagination, filtering/history/focus, file rename/removal, same-job
export recovery, IME/stale search, phone projects and bounded noise-task summaries.
375/768/1440px cover Chinese-light and English-dark. Failure injection is followed
by actual persistence checks; it is not a mock-success gate.

Related regressions are DnD, Task Center, Share modal focus, Source Editor atomic
uploads, Context offline parity and authenticated offline identity locking. The
legacy/mock shell and auth-enabled shell are separate modes. Source references
are compared by explicit identity, not incidental inter-message emission order.
See [execution](execution/WHOLE_SITE_UX_2026-10-04.md) for successful, failed,
interrupted and skipped runs. Screenshots require loaded content; hydration/loading
frames do not count as a reviewed final layout.


2026-10-04 upload gateway: required Web CI runs
`python scripts/verify-context-upload-proxy.py` with nginx-light. It starts isolated
listeners from the shipped Context/Skill locations and verifies five 12 MiB body
hashes, Origin/Cookie forwarding, two 413 limits and four unchanged non-upload
routes. It fails if Nginx is unavailable. Application ZIP/authorization/persistence
tests remain separate; this transport probe does not modify production config.

2026-10-03 dependency regression: `node --test scripts/security/braces-depth.test.mjs`
checks the installed Tailwind/micromatch/chokidar paths, deep braces/parentheses,
unterminated patterns, direct AST calls and valid glob outputs. It is required
before the official audit gate. Frozen installation and the Web Docker build must
apply the checked-in pnpm patch. The exact advisory accounting is in the
[release safety contract](system/RELEASE_SAFETY_BASELINE.md).

The Playwright-managed Web server binds to `127.0.0.1`; it is started for the
selected test run and stopped by Playwright. Reuse an existing server only
when it has the matching build-time API rewrite, auth mode and optional PWA
fault seam. Auth-disabled/fault-injection builds are local synthetic fixtures,
not deployable release artifacts.

## Context direct-file browser gate (2026-10-03)

`python -m pytest tools/context-skills/tests -q` covers reviewed OLD/NEW comparison
and materialization, actual writer/reader synthetic flows, stale Evidence, history
repair, bounded asset copying, source/output races and Bundle distribution. The
Windows symlink case may skip; Linux CI must exercise it. `build.py --check` compares
the three shared source trees and exact pinned defaults; `build.py --review` emits
separate review artifacts. Neither command deploys or updates system defaults.
The authored `semantic-walkthrough-v1.json` and its writer/reader preservation test
cover qualified adoption, version-specific test claims, corrected history, scoped
exceptions, unknown evidence and complete Hot Tail delivery. Agent review is
recorded separately; a passing golden test is not an independent semantic model
evaluation. Path-safety cases include Unicode-equivalent duplicate names and
file/directory collisions; accepted Unicode spellings/bytes remain unchanged.
`test_context_external_roundtrip.py` runs actual export/return worker code around
external writer subprocesses and checks persistent rows/member bytes after a full
A → maintain → B → dual maintain → return → C cycle. The external Candidate/Trace
are test-authored semantic inputs, not the removed application candidate flow.

`library-offline.spec.ts` now checks the cached Acquisition ZIP instead of the
retired Markdown viewer. Cold reload/export asserts attachment bytes, default ZIP
hash, English/Chinese usage text, clipboard denial/retry and independent package
download. `release-security-baseline.spec.ts` checks all three actual ZIP responses
and legacy Markdown URLs; `pwa-negative.spec.ts` removes the real cached ZIP when
testing optional resource recovery. This does not assert arbitrary model behavior.

The `context-files` step uses the existing isolated auth-disabled API and worker
with `E2E_CONTEXT_EXPORT=1`. It runs direct updates, whole-package returns, drag/drop,
export options, reading tools, durable drafts and actual offline ingestion parity.
`context-offline-parity.spec.ts` exercises real Normalizer import and worker downloads,
then disconnects/reloads before exporting. Its legacy case removes only optional
members from a real download. `tools/testing/inspect_context_export.py` uses the fixed
app reader plus the canonical graph parser; it never loads uploaded scripts.
The ordinary PWA baseline
also covers cached Continuation reading/export. `E2E_LONG_READER=1` is required
for Reader restoration regressions; skipped cases do not satisfy that gate.
Draft cases assert real IndexedDB text/base versions, real server conflicts,
two-tab local fork preservation, direct-save cleanup and downloaded recovery
member bytes. These do not replace the authenticated account-isolation, expiry,
quota, signout and scoped deletion gates. `settings-context-drafts.spec.ts` adds
those scenarios to the existing authenticated `settings-*.spec.ts` selector:
actual worker downloads, expiry/reload/account switching, 375px IndexedDB put/delete
faults, real recovery ZIP bytes, two-tab signout fingerprint checks and failed
logout recovery. Trace is disabled and all content is synthetic. A local gate with
this suite, `settings-offline-lock.spec.ts` and `settings-pending-signout.spec.ts`
passed eight cases again after the backend account fence.

`test_continuation_candidates_postgres.py` now checks stale authenticated writes
after a separately committed account disable for direct save, return admission
and worker application, alongside same-update concurrency. The disk-full interrupted
run is retained as a failure in the execution record; its corrected E: rerun passes
30 cases. `test_context_return_postgres.py` exercises actual file/DB writes followed
by a separately committed cancellation or an injected failure. It checks rollback
of generation, offline revision, objects and selected files, then explicit retry
with exact Current/Index bytes. Cleanup/archive/return PostgreSQL coverage passes
13 cases. This does not replace the full API/release gate.
Ordinary API fixtures require `AUTH_ENABLED=false`; the PostgreSQL auth cases
explicitly enable it themselves. Do not reuse the browser fixture's auth setting
for the mixed API suite. CI execution remains unproven until run.

CI `context-files` explicitly enables `E2E_CONTEXT_BUNDLES=1` and selects the
personal Bundle suite. It is also required by `PLAYWRIGHT_EXPECTED_GATES`, so a
missing Context evidence report fails the release summary. The authenticated settings step enables `E2E_CONTEXT_ADMIN=1`
and adds the six Root Bundle cases. Neither suite is silently accepted through its
opt-in skip. Full API runs should also enable `POSTGRES_EXPORT_INTEGRATION=1` when
the isolated PostgreSQL service is available; report all platform/optional skips.
The auth-disabled PWA baseline must clear `E2E_AUTH_EMAIL`/`E2E_AUTH_PASSWORD`;
those variables activate a separate authenticated matrix. The parity suite works
with both inline and queued import, waiting for real committed status in either
case. Context's authenticated fixture cleanup uses confirmed account-deletion jobs
and waits for completion; an ignored DELETE response is not evidence of cleanup.
The PWA negative restart probe uses the configured browser/channel/executable for
both launches, preserving its real profile and worker restart. Its Reader helper
waits for a visible action and recognizes both languages before opening files.
Fault-injection builds change generated `next-env.d.ts` type paths; restore the
normal `.next/types` references after those builds before ordinary typechecking.

## Settings stages 1–4 CI gate (2026-10-01)

Stage-seven help/runtime additions: `test_admin_runtime.py` verifies access,
whitelists, real aggregate results, storage budgets, worker liveness, immutable
build metadata and PostgreSQL timeout recovery in a read-only transaction.
`settings-help-runtime.spec.ts` verifies three viewports, real capability data,
clipboard denial/manual recovery, offline reload/account isolation/expiry,
runtime stale-result recovery and visibility-based polling. The bundled
Chromium replacement renderer requires reapplying real CDP network emulation
after service-worker navigation, as in the existing email-change offline test;
this does not mock navigator values or bypass authorization. Multiline clipboard
comparison normalizes Windows CRLF only. These run through the existing full API
and authenticated settings selectors; skips remain separately reported.

`Build release images` is manually dispatched and does not deploy. Its required
`settings-quality` job uses its own PostgreSQL service, authenticated API,
loopback SMTP sink and single worker. `tests/settings_browser_fixture.py` requires
both `APP_ENV=test` and `E2E_SETTINGS_MAILBOX=1`; its mailbox is administrator-only
and is absent from application images. Synthetic import commits run inline;
scans, downloads and deletion still exercise the worker. The job executes all
`e2e/settings-*.spec.ts` with real API and browser persistence. Its evidence is
uploaded separately from the default/fault-injection browser matrices.

The full API job explicitly enables `SETTINGS_POSTGRES_INTEGRATION=1` so account,
grant, revision, outbox and migration concurrency tests do not silently skip.
Stage-seven `test_user_deletion_postgres.py` verifies shared assets, rollback,
durable storage-cleanup retry, post-commit exceptions and stale authenticated
preference/Skill/annotation/reading writes after deletion. Existing Skill guards
do not implement the paused stage-five editing feature.
`test_invitation_postgres.py` verifies simultaneous token consumption creates one
account; `test_admin_invitation_audit.py` covers status/filter/pagination and
credential-free history. `settings-admin-invitations-audit.spec.ts` runs the real
invitation UI, clipboard failure recovery, revoke persistence, audit filters,
cross-user Reader and invitation registration at three viewport sizes. Transient
links are kept in memory; screenshot evidence is captured after they are hidden.
Stage-six archive cases also use this gate: `test_system_archive_postgres.py`
checks new-instance FK/identity/password-reset recovery, full configuration
restoration with rollback/commit failure and personal export snapshot consistency.
`test_archive_export_limits.py` verifies restore-compatible repetitive content,
capacity failure without publication and bounded repack cancellation.
`test_system_archive_configuration.py` covers configuration integrity, policy
admission and historical v5 compatibility. `test_personal_restore_postgres.py` and
`test_personal_archive_jobs_postgres.py` cover real FK remapping, concurrent
restore/confirmation, late cancellation, rollback and migration round trips.
Personal API/job/auth tests and `settings-personal-backup.spec.ts` verify actual
download/upload/preflight/restore and re-entry at 375/768/1440px. The latter is
included by the existing `settings-*.spec.ts` CI selector. Dated local evidence
does not establish GitHub CI, production or full system recovery UI acceptance.
Image creation requires API, Web and settings jobs to succeed. Local commands
must use an explicitly disposable PostgreSQL database and storage directories;
do not use repository imports or a production environment for these fixtures.

## 多账户 owner 验证（工作树，2026-09-01）

认证、owner scope、projects、conversation management、cleanup、export、archive
和 system-archive 的聚焦 API 测试已通过。源码 Alembic head 为
`20260901_0030_multi_account_users.py`，仍待部署。认证生产浏览器验收和真实
PostgreSQL migration 为 `NOT VERIFIED`；本地 API fixture 不代表生产数据迁移。

## Existing-conversation rule-library scan (2026-08-23)

The current local implementation adds the explicit `BATCH / ALL_ACTIVE` rule
library scan, project/unclassified target accounting, archived-target
exclusion, per-scan rule revision snapshots, and no-confidence occurrence
responses. Focused cleanup coverage is `28 passed`; migration integrity is
`4 passed / 1 skipped`; Web lint, typecheck and production build pass; and
local Alembic current/heads are both `20260823_0028`. The full API suite was
started but exceeded the five-minute local command limit without a completed
result, so it is `NOT VERIFIED` for this historical local invocation. The
resulting source was subsequently covered by the exact-source GitHub Actions
run and deployed; current production authority is recorded in
`PROJECT_STATE.md` and `docs/deployment.md`.

## Layered content-noise detection (2026-08-23)

Content cleanup coverage now separates structural exact, normalized exact,
bounded fuzzy and manual-selection evidence. Built-in citation tests cover
complete private markers, damaged private wrappers, visible references,
full-width syntax tokens, one-edit syntax damage and ordinary-prose false
positives. User literal tests cover exact, NFKC/case/whitespace normalized and
anchored approximate matching with a bounded candidate budget. All detections
are explicit review items and actionable matches default to `DELETE`; no confidence or similarity
classification is part of the current cleanup contract.

Source Editor browser coverage uses a non-BMP character before the selected
citation to verify that CodeMirror UTF-16 positions are converted to the
server's Unicode code-point offsets. It also verifies detector evidence,
rule-library access, apply behavior, desktop presentation and the 390 x 844
mobile toolbar. Markdown protection tests cover variable fenced and inline
code delimiters, separate inline-code spans, indented code, math, link
destinations, reference definitions, autolinks and asset URLs.

The completed local quality gates for this scope are: focused cleanup API
`17 passed`; full API `368 passed / 5 skipped`; Web lint, typecheck and
production build PASS; browser/PWA `76 passed / 71 conditional skipped`;
dependency policy PASS with zero high or critical advisories; Alembic single
head/current `20260823_0027`; and `git diff --check` PASS. These are historical
pre-scan and local/production-equivalent results; production deployment is
recorded separately in `PROJECT_STATE.md` and `docs/deployment.md`.

## Adaptive Import (2026-08-22)

Recovery coverage verifies that malformed input remains an item-level
`INVALID` Family while valid Families continue Mapping in the same session.
The API matrix covers in-place source replacement, Group exclusion,
last-Group rejection, regrouping from `READY`, reanalysis and
commit-before-cleanup storage behavior. Browser coverage performs Mapping with
two malformed siblings, excludes one, replaces the other and reaches `READY`
without reopening Import. Desktop 1440 px, narrow 900 px and mobile 390 px
layouts were rendered in Chromium with no horizontal overflow; diagnostic
locations are read-only outside Mapping so the UI does not expose a fake
navigation action.

Current local evidence for this recovery scope is `24 passed` focused Adaptive
Import API tests, `349 passed / 6 skipped` for the full API suite, and `3 passed
/ 1 conditional skipped` for the Adaptive Import browser file. The related
Import contract and PWA/Offline browser regression is `11 passed`. The three
reported desktop files also reached a two-conversation `READY` plan in a
read-only browser acceptance run in about 2.1 seconds; the source conversations
were not committed. Web lint, typecheck, the production build, dependency
policy and `git diff --check` pass.

GitHub Actions run `32550720450` passed on attempt 2, including the dedicated
Adaptive Import flow and all existing browser, auth, PWA, API, migration and
image-build gates. Attempt 1 passed the Import gate but the bundled Chromium
headless shell crashed with `SIGSEGV` while creating the final CSP test context;
the same CSP matrix passed on the exact-source rerun, confirming a recoverable
browser-runner failure rather than a product assertion failure. Production
health is 200 after deployment, worker diagnostics report `alive_idle`, and
anonymous Adaptive Import session/recovery mutations are denied. Authenticated
production Mapping is not claimed because this execution session has no owner
credential or connected browser-control surface; the real three-file browser
acceptance was completed against the isolated production build before deploy.

The release workflow runs `e2e/import-markdown.spec.ts` with
`E2E_IMPORT_FLOW=1` as a dedicated gate after the API starts. This is separate
from the broad default PWA matrix and adds only the focused import workflows.

Focused API coverage is in `apps/api/tests/test_adaptive_import_api.py`. It
covers UNKNOWN Mapping through direct commit, second-use exact matching,
Built-in native JSON, Family-level batch reuse, full-family rejection,
DRIFTED revision creation with old-revision compatibility, disabled/deleted
profiles, Markdown role/noise behavior, ORDER/ID/ROLE_TIMESTAMP relations,
unknown-role blocking, ambiguous mixed-file grouping and explicit session
cancellation. `.cr` archive regression remains in
`test_system_archive_api.py`; the removed `.crbundle` route is asserted `404`.

Markdown adaptive-import regressions also cover Chinese line-label roles,
emphasized model-name decoration in role headings, and body headings/colon-ended
sentences that must remain inside the current message. A mixed three-file
session verifies explicit grouping into one JSON/Markdown pair plus one
standalone Markdown Family, full-Family Mapping, and transition to `READY`
without a false `BLOCKED` state.

For the deployed fix, focused Adaptive Import coverage passed `20/20` and the
full API suite passed `345 passed / 6 skipped`. Web lint, typecheck, production
build, Alembic single-head validation and `git diff --check` passed. GitHub
Actions run `32544978132` then passed the complete quality and image-build jobs.
The production image accepted the reported source shapes as a five-message
paired draft and a two-message standalone Markdown draft; this check did not
commit either source to the business database.

Required gates for this change are the full API suite, migration single-head,
Web lint/typecheck/build, focused Adaptive Import browser flow, PWA regression,
dependency/security policy and `git diff --check`. Results are recorded only
after the commands execute; this section defines scope rather than claiming
unrun production acceptance.

The exact-source CI run `32534425663` passed both quality and image-build jobs
on commit `8b5b0e454ea244936eafa1b6f921d5c66ee5a873`; the image build completed
at `2026-08-21T22:57:53Z`. Production health and migration checks passed after
deployment. No manual artifact checksum confirmation is used as a release
report gate; security/content hashes generated by the application remain
covered by their existing tests.

## 2026-08-21 Deployment acceptance boundary

The exact CI run for the large-import and semantic-copy scope passed quality,
API, lint, typecheck, production build, browser/PWA and image-build jobs. The
Desktop pair was previewed locally with 66 messages and `exact_match` in about
1.2 seconds. Production health, schema current/head and running service health
passed after deployment; anonymous import-preview requests remain denied.

Production authenticated import-preview and real clipboard checks are not
claimed without an approved logged-in browser-control session. No credential,
cookie or token was copied into test output.

## Large paired imports and semantic Reader copy (2026-08-21)

The import regression covers unique ordered role/timestamp pairing with
untimed body headings, verifies that the linear path does not instantiate
`SequenceMatcher`, and keeps timed extras, duplicates, ambiguity and bounded
failure handling on the conservative path. API boundary tests cover no more
than two files, the exact configured per-file limit and the route-specific
110 MiB Nginx allowance. The user-supplied desktop pair is Preview-only and is
never added to repository fixtures or committed as a conversation.

`reader-markdown-copy.spec.ts` covers complete blocks, cross-block and
cross-message selections, partial bold text, links, inline code, fenced code
and lists for Owner and public Share. The long Offline Reader fixture verifies
that selection pinning crosses the virtualized block threshold, that metadata
and controls do not enter either clipboard representation, and that rows are
released after selection cleanup.

Current local evidence is `17 passed` for the focused Adaptive Import API suite,
`342 passed / 6 skipped` for the full API suite, `2 passed / 1 conditional
skipped` for the real Adaptive Import browser flow, and `75 passed / 70
conditional skipped` for the default production-build browser/PWA matrix. The
known-profile, unknown-to-Mapping, learned-profile reuse and batch-family
flows all executed; the `.cr` archive regression passed and the removed
`.crbundle` endpoint is covered by a `404` assertion. Web lint, typecheck,
production build, dependency policy and `git diff --check` pass. The official
dependency audit contains zero high or critical findings (one low and one
moderate advisory remain in the dependency tree).

## Public Share and exact conversation search (deployed and accepted, 2026-08-18)

The focused API coverage now exercises passwordless public Share access,
independent Share-password hashing/unlock rotation, owner-session separation,
revocation and per-occurrence search anchors:

```powershell
$env:PYTHONPATH='apps/api'
pytest -q apps/api/tests/test_sharing_api.py apps/api/tests/test_search_api.py apps/api/tests/test_auth.py apps/api/tests/test_migration_integrity.py
```

The focused search regression is `9 passed`; the full API suite is `325 passed
/ 7 skipped`. Web lint, typecheck and the Webpack production build pass, and
the normal CI run completed successfully for the deployed runtime.

Production acceptance used only disposable QA content. It verified a direct
passwordless Share, a password-protected Share's generic wrong-password denial
and successful Share-scoped unlock, revocation, and owner-route isolation.
It also verified exact current-conversation occurrence navigation, persistent
previous/next controls and return-to-results state. The QA conversations and
Shares were removed through the product UI after acceptance.

## Release N authentication verification and production acceptance (2026-08-17)

The focused gate exercises one owner principal, independent device sessions,
the exact 48-hour expiry boundary, rate-limited activity touch, bounded login
backoff, logout, password-change global revocation, default API protection,
Private-route protection, public Share capability scoping and same-origin
mutation checks:

```powershell
cd apps/api
python -m pytest -q tests/test_auth.py tests/test_migration_integrity.py
```

An auth-enabled isolated PostgreSQL environment upgrades to Alembic
`20260817_0024` and runs the production-build Playwright gate:

```text
apps/web/e2e/auth-gate.spec.ts
```

It covers a fresh device login, generic failure, HttpOnly server credential,
logout cache purge, Share-token non-bypass, two independent device sessions and
password-change invalidation. It uses a generated test credential only; no
production credential is written to test output. The final isolated source
passes `8` focused auth tests, `319` API tests (`7` skipped), `3` browser auth
tests, the default PWA matrix (`72` passed, `69` scoped skips), and the Release
E PWA negative matrix (`10` passed). Web lint,
typecheck, the Next 16.3.1 Webpack production build, dependency/security policy,
migration head/current and `git diff --check` also pass. Exact-SHA CI,
operator password provisioning, deployment and production acceptance passed.

## Release M disaster-recovery verification (2026-08-17)

Release M used the current five-part production backup and restored it into
two fresh isolated Compose projects. `deploy/recovery_preflight.py` passed the
database, filesystem, port, network and volume-isolation checks before each
restore; its tests pass `9/9`. `deploy/recovery_integrity.py` found matching
aggregate/storage snapshots, zero canonical dangling references, zero missing
required files and 228 physical objects with zero missing, size or hash
mismatches on both targets. The second fresh target matched critical
aggregates, proving repeatability. The recovery runbook is
`docs/system/DISASTER_RECOVERY_RUNBOOK.md`.

The drill also verified that restored historical worker heartbeat state is
stale until a new worker emits a heartbeat, then observed recovery `alive_idle`
and a normal QA job transition `alive_busy -> alive_idle`. Production health,
runtime image identity and business volumes remained unchanged; no production
resource was removed. Browser smoke was limited to aggregate Library, Reader
and Source Editor availability and did not persist user content.

## Release L observability verification and production closure (2026-08-16)

The deterministic focused gate is:

```text
cd apps/api
python -m pytest -q tests/test_worker_liveness.py \
  tests/test_diagnostics.py tests/test_observability.py tests/test_health.py
```

Current result: `27 passed`. The matrix controls timestamps and thread/event
barriers rather than waiting for wall-clock stale intervals. It covers recent
idle, busy, stale, unavailable, restart recovery, old-instance fencing, both
task families, blocked long-job pulses, task-heartbeat failure isolation,
privacy, public denial, loopback authorization, no-store headers, request IDs
and Scanner-disabled semantics.

The final migration was applied to an isolated PostgreSQL 16 environment,
downgraded to `20260806_0021`, upgraded again, and verified at single
head/current `20260816_0022`. Migration integrity is `3 passed`. The full API
suite against that isolated final-head database is `303 passed / 6 skipped`.
An initial full run used the unrelated local default database at 0021 and had
one migration-current environment failure; no shared/default database was
migrated, and the explicit isolated rerun is the release evidence.

Production closure used Actions run `31948357231` and immutable artifact
`9264075894` from source `baca93bdf6f2965c4f5614e296c12d337efc1a0a`.
The API/worker image ID was
`sha256:818c37bc703344ff6ce291c79a805832ad6ab4f24433323c6193622b24857395`
and the Web image ID was
`sha256:83ee77cc5b7b69b90fda804555f6eb3803063491f34aa19f4db50df968ae39a8`.
Production diagnostics returned `alive_idle` with a recent heartbeat through
the SSH plus API-container loopback boundary; a disposable product QA rebuild
observed `alive_busy` and then `alive_idle`. Public diagnostics returned a
concealed 404 with `Cache-Control: no-store` and `nosniff`. Response inspection
found no message, attachment, token, credential, payload or full-path fields.
The QA conversation was deleted through the product API. Production health,
Alembic head/current, image identity and post-deploy API/worker error counts
all passed.

## Release K residual production verification (2026-08-16)

Release K retained the reconciled 40-item inventory and executed only its seven
current production verification records. Production remains immutable Release I
runtime `7bcd686...`; Release J Actions run `31936666151`, artifact `9260977100`,
running image identity and Alembic `20260806_0021` remain authoritative. No
runtime or test-tooling source changed, so there was no production redeploy and
the historical Web/API/PWA matrices were not mechanically rerun.

The final inventory is:

| Classification | Count | Current interpretation |
| --- | ---: | --- |
| Current verification debt | 0 | All seven Release K records now have production evidence |
| Superseded/already closed | 26 | 19 closed by Releases A-J plus seven closed by Release K |
| Deferred by design | 8 | Release L/N/O or explicit architecture deferral |
| Conditional/external future | 6 | No current defect or unconditional product gate |
| Unknown | 0 | Every discovered logical candidate has an owner and classification |

### Native Chrome page zoom

The dedicated Chrome profile was changed with Chrome's native Page Zoom. The
controlled production page independently verified exact state changes relative
to the original 100% baseline:

| Chrome state | DPR | CSS viewport width | Ratio to baseline | Result |
| --- | ---: | ---: | ---: | --- |
| 100% baseline | 1.05 | 1830 px | 1.00 | PASS |
| 125% | 1.3125 | 1464 px | 1.25 | PASS |
| 150% | 1.575 | 1220 px | 1.50 | PASS |
| 200% | 2.10 | 915 px | 2.00 | PASS |
| 100% restored | 1.05 | 1830 px | 1.00 | PASS |

CSS zoom, transforms, device scale, viewport-only resizing and CDP page-scale
emulation were not used. Library, Reader, Source Editor, Files Panel, Viewer,
Share and core dialogs passed at 125% and 150%. The 200% matrix additionally
verified long Reader content, image/Markdown/PDF Viewers, preferences dialog,
Tab/Shift+Tab/Esc focus behavior, trigger focus restoration and reachable Save,
upload, Close and Download actions. Every checkpoint reported zero page-level
horizontal overflow; only intrinsic document/table/code surfaces retain local
scrolling. The PDF Viewer rendered a visibly nonblank canvas with its real
toolbar while the browser remained at 200%.

### Production Viewer fixtures

The Mermaid fixture rendered a complete data-URI SVG image with nonzero natural
and displayed dimensions, including the expected Upload, Canonical and Reader
nodes. DOCX, ODT, XLSX, ODS, PPTX and ODP all selected the expected online
Viewer path, rendered supported content, exposed Download and exactly one
accessible Close, closed with Esc and restored focus to the trigger. The
fixture matrix recorded zero CSP violations and no fatal Viewer error.

One React hydration warning already known from the earlier Offline Library path
was observed during initial setup; it did not recur as a Release K fixture or
zoom failure. An offline cached-blob DOCX fetch observation was excluded from
the online Viewer contract rather than used as production Viewer evidence.

The disposable Mermaid QA Conversation was permanently deleted through the
product UI and was absent after a fresh navigation. Chrome extension-popup and
OneTab handoff interruptions were recovered with a fresh controlled tab; no
product data or runtime changed. `TEST_RESULTS.md` does not exist at repository
root, while `docs/execution/TEST_RESULTS.md` remains dated historical evidence.

## Release J cleanup first-apply closure (2026-08-16)

No cleanup runtime code changed. Four explicit fixture gaps were added to
`tests/test_cleanup_execution.py`: recent generated staging protection,
retained conversation Export protection, wrong-category token rejection and
canonical DB-state preservation on partial unlink failure.

The focused local gate is:

```text
cd apps/api
python -m pytest -q \
  tests/test_cleanup_execution.py \
  tests/test_artifact_lifecycle.py \
  tests/test_artifact_transaction_boundary.py
```

Result: `32 passed / 1 skipped`. The skip is the Windows host's inability to
create the path-escape symlink fixture; exact-SHA Linux Actions executed the
cleanup safety step without a scoped skip. Actions run `31936666151` on
`81fb441f51984330042625aac4dabddfd78b0ebc` also passed lint, typecheck, Next
`16.3.1` Webpack build, full API, Alembic, dependency policy, browser matrices,
default PWA, scoped PWA negative and image inspection/package/upload.

Production evidence is not count-only. Dry-runs A/B plus the pre-apply scan
returned the same four opaque `ORPHAN_FINAL` tokens and `659,673` bytes. Apply
deleted exactly four with zero failures/skips; two post-apply scans had zero
eligible objects. Replaying the old token authority deleted zero and reported
four changed/stale skips. Before/after canonical counts and Export/Offline file
size checks were identical.

Isolated production Chrome passed Library, Reader, Source Editor real upload
and canonical save, Markdown Viewer, Files Panel, Share focus, Offline catalog,
committed Export download and zero CSP violations. A targeted production
classifier proved the new committed Export existed, matched its declared size
and was not a cleanup candidate. QA cleanup used the product API with 404
readback. The recent final file left by that disposable lifecycle is protected
by the 24-hour grace window and was not deleted.

The first two attempts to create the QA through Node `APIRequestContext`
encountered HTTPS `ECONNRESET` before the route reached API logs. Browser
same-origin `fetch`, which matches the application boundary, completed the
flow. This is recorded as recovered test transport behavior, not a cleanup or
product failure.

## Release I upload-token atomicity closure (2026-08-16)

The focused API gate is:

```text
cd apps/api
python -m pytest tests/test_attachment_scanner.py \
  tests/test_attachment_upload_api.py -q
```

Final result: `15 passed`. It proves structured rejection and
transaction rollback for active transient references at PATCH, conversation
create and message insert; acceptance of canonical references and occurrence
creation; allowance of bare/inline/fenced/indented code literals; idempotent
finalize; and concurrent optional MIME detection.

The browser gate uses the existing production build and no runtime fault
bridge:

```text
PLAYWRIGHT_USE_BUNDLED_CHROMIUM=1
E2E_ATTACHMENT_UPLOAD=1
corepack pnpm --filter web exec playwright test \
  --config=playwright.config.ts \
  e2e/source-editor-upload-atomicity.spec.ts \
  e2e/attachment-upload-flow.spec.ts
```

Final result: `18 passed / 0 failed / 0 scoped skipped`. Playwright route
barriers hold and release real upload/finalize/save requests; elapsed sleeps
are not the correctness authority. The matrix asserts zero PATCHes before
canonicalization, canonical-only payload/version reads, exact occurrence
counts, chooser/drop/paste convergence, fast/slow and B-before-A completion,
partial failure and single-flight retry, typing/cursor/selection/scroll,
delete-before-completion, undo/redo, and canonical drafts after 409/500.
`I-RACE-002A` additionally holds the lazy CodeMirror chunk, selects a file
before `.cm-content` exists, then releases editor creation and upload finalize;
this covers the exact real-production ordering that the first candidate
exposed.

The remaining final-source regression set passed: full API `285 passed / 5
skipped`, CSP `4/4`, focused Reader/Rich/security `36/36`, Share `2/2`,
mutation `2/2`, Markdown/image Viewer `1/1`, PDF `3/3`, default PWA `72 passed
/ 65 unrelated conditional skipped`, and scoped PWA negative `10/10` with
zero scoped skips. Lint, typecheck, Next `16.3.1` Webpack production build,
dependency policy and the zero high/critical gate also passed.

The historical attachment tests now wait for actual PATCH completion rather
than a transient `Saving...` button label. Cleanup retries only a transient
HTTP 500 caused by the test worker committing `conversation_derived_rebuild`
at the same instant, then requires a successful product API delete and a 404
readback. This retry is test cleanup, not upload correctness synchronization.

Actions run `31934088629` passed this gate and all release gates on exact SHA
`7bcd686b59d62fb9907ba09d644637b7af2b3d86`. The same immutable images passed
production identity checks. Standalone production Chrome then passed three
independent real chooser/upload/save/reload cycles: each captured PATCH and
canonical version contained `cr-asset://` and no `cr-upload://`, reload rendered
the attachment and Markdown Viewer opened it. The isolated PWA shell also
started offline and reconnected. Legitimate-path CSP violations were zero.
All disposable Conversations were deleted through the product API and returned
404. The post-deploy source-aware aggregate audit reported zero active
transient references in all and current MessageVersions without exposing
content, tokens or IDs.

## Release H CSP enforcement closure (2026-08-16)

Release H adds a production-build browser hard gate:

```text
corepack pnpm --filter web exec playwright test --config=playwright.config.ts \
  e2e/csp-enforcement.spec.ts
```

The four tests must all execute. They verify the exact enforcing response,
production absence of `'unsafe-eval'` and broad sources, controlled external
script/connect/image/object blocking, blob-worker blocking, real
`frame-ancestors` enforcement from a second origin, inline event-handler
blocking, and allowed same-origin/data/blob/style/manifest/Service Worker
resources. The harness records only directive/disposition and bounded URI
classifications; it does not persist raw URLs or content.

The Release E scoped PWA command remains a separate zero-skip gate. It now also
asserts the synthetic offline-incomplete 503 CSP:

```text
E2E_PWA_NEGATIVE=1
NEXT_PUBLIC_PWA_NEGATIVE_TESTS=1
NEXT_DIST_DIR=.next-pwa-negative
corepack pnpm --filter web build
corepack pnpm --filter web exec playwright test --config=playwright.config.ts \
  e2e/pwa-negative.spec.ts
```

Final Actions run `31906595581` on source
`da160a9c9a34dfe670fc67262cf3c8c9eedba07a` passed CSP `4/4`, Release C
`30/30`, full API `282 passed / 4 skipped`, PWA negative `10/10` with zero
scoped skips, default PWA `72 passed / 53 unrelated conditional skipped`,
focused Reader/Rich/Security `36/36`, PDF `3/3`, Markdown/image unified Viewer
`1/1`, Source Editor/mutation `2/2`, and Share `2/2`. Locked install,
lint/typecheck/Next `16.3.1` Webpack build, Alembic and dependency policy also
passed before images were built. Rich Markdown requires a real Shiki
highlighted token span plus zero enforced violation events, in addition to
KaTeX, MathML and sanitizer assertions.

A Windows Chromium process repeatedly exited when the desktop Share test tried
to create a new context after the long Reader group; all preceding tests and
the next worker's mobile Share passed, and the isolated Share suite passed six
times. This is treated as a deterministic test-process lifecycle defect, not a
rerun-based product PASS. CI therefore keeps CSP, long Reader/focused paths,
Share, mutation, Markdown/image Viewer, PDF and scoped PWA as separate hard
steps.

Production acceptance used an isolated Chrome profile and browser same-origin
`fetch` for disposable QA setup/cleanup. It did not use a logged-in user
profile, direct SQL, or Node APIRequestContext as release evidence. The final
scoped product run passed `3/3`: Reader scroll/Rich Markdown/Source Editor
mutation and reload; Markdown/image/PDF unified Viewer with a real PDF.js
worker and authenticated `206` Range; desktop and 390x844 Share single-dialog
and focus restoration. A separate clean-profile PWA offline/reconnect run
passed `1/1`. The deployed CSP block probes passed for external script/connect/
image/blob-worker/object and frame embedding, and legitimate paths produced
zero `securitypolicyviolation` events. A final product-API cleanup pass verified
zero Release H disposable Conversation titles remained.

The production smoke initially exposed a pre-existing Source Editor timing
race where an attachment upload can display ready before its `cr-upload://`
marker is replaced in the submitted document; the API safely rejects it with
422. This is not a CSP regression and is already represented by overlapping
uncommitted user editor work. Release H preserves those files and validates
Viewer data by upload-session/finalize plus insertion of the committed
Conversation attachment. Do not convert the exploratory 422 into a release
PASS or silently stage the user's editor changes.

## Release G PDF.js migration closure (2026-08-16)

Release G uses official `pdfjs-dist 6.2.108` with the modern ESM library and a
same-origin `pdf.worker.min.mjs`. The target requires Node `>=22.13.0`, so run
Release G Web commands under Node `22.13.1`. The production build remains
Webpack:

```text
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm --filter web build
```

The dedicated browser suite is `apps/web/e2e/pdfjs-migration.spec.ts` and is
explicitly enabled so its disposable API data is never created by the default
PWA matrix:

```text
E2E_PDFJS_MIGRATION=1
corepack pnpm --filter web exec playwright test e2e/pdfjs-migration.spec.ts --config=playwright.config.ts
```

It must prove a real Worker event and local worker response, library/worker
version `6.2.108`, non-empty canvas pixels, single/multi-page fit/navigation,
authenticated `206` Range, maximize/Escape/focus behavior, malformed PDF
isolation and no JavaScript execution from a controlled malicious fixture.
The fixture Conversation and attachments are synthetic and must be removed
through the product API.

Release G also requires:

```text
corepack pnpm run test:api
cd apps/api; python -m alembic heads
cd apps/api; python -m alembic current
corepack pnpm --filter web test:pwa
E2E_PWA_NEGATIVE=1
NEXT_PUBLIC_PWA_NEGATIVE_TESTS=1
NEXT_DIST_DIR=.release-e-negative-next
corepack pnpm --filter web exec playwright test e2e/pwa-negative.spec.ts --config=playwright.config.ts
```

The default PWA matrix reports unrelated conditional skips separately. The
Release E scoped negative matrix must execute with zero scoped skips and must
cover the local PDF worker/original missing offline path. Focused regressions
must retain unified non-PDF Viewer behavior, Reader scroll stability, Rich
Markdown/KaTeX/MathML, Source Editor and the 390x844 Mobile Share
single-dialog/Escape/focus contract.

Current-source local evidence is PASS: Web lint/typecheck/Next 16 Webpack
build; API `280 passed / 6 skipped`; Alembic current/head single
`20260806_0021`; and dependency policy with zero blocked and zero unapproved
findings. The combined owner/Share/security PDF gate is `10/10`, including
real worker, exact version match, nonblank single/multi canvas, authenticated
Range, lazy loading, focus, malicious script isolation and corrupt-file
recovery. Broader focused browser regression remains `38/38`, and Source
Editor/mutation is `2/2`.

The final CI default PWA matrix is `68 passed / 53 conditional skipped`;
three additional conditional skips are the opt-in Release G PDF suites and
were executed separately. The Release E scoped negative matrix is `10 passed
/ 0 scoped skipped`, including local PDF worker inventory and missing-worker
recovery. Skips remain skips and are not counted as PASS.

Actions run `31896564657` tested frozen source
`1b752b77063893feefef01756af9deda559f30a5`. It passed locked install,
lint/typecheck/Next Webpack build, API `282 passed / 4 skipped`, Alembic,
dependency policy, focused browser `38/38`, maintained PDF `3/3`, default PWA
and scoped negative PWA before image construction. The Docker log explicitly
records `next build --webpack` and `Next.js 16.3.1 (webpack)`.

Production acceptance used installed Chrome `151.0.7922.138` through isolated
Playwright contexts and the public HTTPS origin. It verified real worker,
version match, single/multi canvas, owner/Share Range `206`, Share scope,
Fit Page/Width, 110% zoom, page navigation, maximize/Escape/focus, and a real
offline package/IndexedDB/service-worker PDF open followed by reconnect.
Separate production smokes passed Rich Markdown/KaTeX/MathML, image/Markdown
unified Viewer, Source Editor input/backspace, desktop Share and the mandatory
390x844 single-dialog/Escape/focus contract. Synthetic QA Conversations were
deleted through the product API; no direct SQL cleanup was used.

The first zoom evidence attempt used an over-broad icon selector and timed
out after all earlier PDF assertions passed. Its QA Conversation was then
deleted through the product API. The corrected accessible-name selector
passed in `21.4s`; the failed attempt is retained as test-harness evidence and
is not classified as a product failure.

An exploratory `E2E_RICH_MARKDOWN_ATTACHMENT` production run exposed an
existing upload-placement timing race: the editor can still contain a
transient `cr-upload://` reference when save begins. This path is outside the
PDF.js change, the relevant runtime files are byte-identical to Release F, and
the required Source Editor type/backspace/close regression passed. Keep the
race as separate follow-up work; do not use the optional failed run as Release
G PDF evidence or conceal it as a PASS.

## Release F Next 16 final closure (2026-08-15)

The Release F worktree used locked Next `16.3.1`, React/ReactDOM `19.2.8`,
Node 20.13.1 and the explicit `next build --webpack` path. Final local gates
passed lint, typecheck, Webpack build, API `280 passed / 6 skipped`, Alembic
`20260806_0021` current/head and dependency policy (`unapproved=0`).

The focused browser command was rerun against the current source after the
async `headers()`/route-param and React 19 ref fixes. It passed 38/38 tests,
including Rich Markdown/KaTeX/MathML, Viewer, Reader wheel/thumb/TOC and
restoration, security/CSP-equivalent checks, desktop Share and the mandatory
390x844 More -> Share single-dialog/Escape/focus contract. The Reader
restoration subset was run with the isolated API import worker because those
fixtures require committed imports.

The current-source default PWA baseline is `68 passed / 50 unrelated
conditional skipped`; the dedicated Release E scoped negative matrix is
`9 passed / 0 scoped skipped`. Normal production chunks contain no PWA test
fault bridge or benchmark fixture. Final Actions run `31887198941` passed
quality, image inspection, packaging and checksum generation; the artifact
SHA-256 is `739435634b6a4ebe52597d9db6887c3599c10a6fb5441f1032b01981923e5b84`.
King recomputed the same hash, verified backup
`/opt/chat-reader/backups/release-f-final-20260815T134803Z-c9ddae1`, and
confirmed running image identities match the manifest. Isolated production
Chromium passed PWA shell/offline/reconnect, Reader KaTeX/MathML, 390x844
Share single-dialog/Escape/focus, mutation/Source Editor, attachment Viewer
and disposable PDF canvas acceptance. `RELEASE_F = PASS`; unrelated default
PWA skips remain skips.

## Release E PWA negative matrix (2026-08-15)

Release E adds a dedicated production-build browser matrix for scoped
Offline/PWA negative paths:

```text
E2E_PWA_NEGATIVE=1
NEXT_PUBLIC_PWA_NEGATIVE_TESTS=1
NEXT_DIST_DIR=.release-e-negative-next
corepack pnpm --filter web exec playwright test e2e/pwa-negative.spec.ts --config=playwright.config.ts
```

The matrix uses real Cache Storage, Service Worker, IndexedDB, offline network
state, Chromium quota override and an isolated persistent browser profile. It
covers critical and optional shell misses, online recovery, shell cache quota,
offline attachment and Viewer misses, corrupted cached bytes, quota/cache put
failure after a partial write, Dexie transaction abort, truncated package,
browser/SW restart, idempotent retry, package identity preservation,
offline-to-online recovery and bounded network flapping. Current local result:
9 passed / 0 scoped skipped.

The prior default PWA baseline was 67 passed / 50 skipped. The current full
local run is 68 passed / 50 skipped because it includes the normal production
bundle fault-bridge assertion added in Release E. Those skips remain unrelated
conditional fixture/production-copy flows and are not counted as Release E
PASS. The normal production bundle is separately checked to ensure
window.__chatReaderPwaNegativeTest is absent.

Final CI run `31874712687` executed the scoped negative matrix in the quality
job before image construction and passed all 9 browser tests with zero scoped
skips. The same run passed Web lint/typecheck/build, the API full suite,
Alembic, Release A/B/C/D regressions, the default PWA matrix, image inspection
and archive checksum generation.

Post-deploy production Chromium used an isolated disposable profile rather than
the operator's normal browser data. It verified the active Service Worker,
75/75 critical cached shell resources, offline `/library` HTTP 200, 390px
reflow, reconnect, zero CSP violations, Reader KaTeX/MathML and the single
mobile Share dialog/focus contract. Quota, interruption and cache-corruption
faults remained confined to the production-build CI/local matrix; production
did not receive fault injection. The unrelated 50 default-matrix conditional
skips remain reported as skips.

## Release D performance and capacity characterization (2026-08-15 final)

The Release D workflow is an external Linux characterization run, not a
production stress test:

```text
quality
  -> Reader capacity (398/1k/10k x plain/math/mixed/real attachment metadata)
  -> import/export RSS and elapsed measurements
  -> isolated .cr v4 export/restore (current/2x/10x)
  -> PostgreSQL EXPLAIN (ANALYZE, BUFFERS)
  -> Release A/B/C, Rich Markdown, Reader, and default PWA regression
```

The deterministic fixture uses seed `20260814`. Attachment metadata fixtures
use real business Attachment rows with distinct identities, one shared
AssetObject, and current occurrences; they are reconciled through the API after
import. API/worker RSS is sampled from Linux `/proc`, browser working set is
measured by DOM/Playwright telemetry, and no source text is recorded. Both
`api-quality` and `web-quality` jobs must pass before any characterization
job starts. API-only schema/backend gates run in `api-quality`; Web lint,
typecheck, build and browser integration run in `web-quality`. Conditional
skips remain separate from pass counts.

The final Actions run `31865404393` completed successfully after an unchanged
regression rerun. Reader capacity and backend measurements passed the functional
and bounded-working-set gates; 10k Markdown export and few-huge import are
explicit WARNING capacity boundaries. Release D does not weaken the historical
Reader budgets, add a migration, run large workloads on King, change the `.cr`
format, or perform a product architecture rewrite. See [the capacity contract](system/PERFORMANCE_CAPACITY_CONTRACT.md)
and [the dated evidence report](evidence/PERFORMANCE_CHARACTERIZATION_REPORT_2026-08-14.md)
for classification and final numbers.

## Release C observability and cleanup (2026-08-14)

The Release C safety suite is part of the release workflow before the API full
suite and therefore before image construction:

```text
cd apps/api
pytest -q tests/test_observability.py tests/test_diagnostics.py \
  tests/test_artifact_lifecycle.py tests/test_cleanup_execution.py \
  tests/test_artifact_transaction_boundary.py tests/test_import_queue.py
```

Coverage includes UUID request IDs for success/400/404/409/500, route-template
logging, query/header redaction, logging failure isolation, diagnostics default
disablement and bounded queries/scans, path-scoped/chunked cleanup lookups,
current/active/recent/unknown/AssetObject protection, Offline superseded
classification, dry-run, explicit apply, canonical/active race recheck,
idempotence and partial unlink failure. Release B publication and bounded Import
retry tests run in the same focused gate.

Current Windows focused result is `28 passed / 1 skipped`; full API is
`279 passed / 6 skipped`; Web lint/typecheck/production build PASS; Alembic is
the single `20260806_0021` head; default PWA is `67 passed / 37 conditional
skipped`. The focused skip is symlink path-escape coverage because this host
cannot create the test symlink. Linux CI must execute it; no skip is a PASS.

Final Release C workflow run `31789905868` passed quality, image inspection,
artifact packaging/checksum, full API, focused browser and default PWA jobs for
source `8d0ad66`: Release C focused `30 passed`, API `282 passed / 4 skipped`,
focused browser `28 passed`, and PWA `67 passed / 37 skipped`. Production
recheck verified one request-completion event for
both a successful request and a controlled 404, with no raw query marker or
Uvicorn access line. The first post-deploy check found that production INFO
events were not emitted by the unconfigured application logger; the bounded
logger-handler fix added a subprocess regression and was rebuilt before final
deployment. Production dry-run was repeated twice with no deletion and stable
aggregate counts; manual apply remains unexecuted.

## Release A safety baseline (2026-08-13)

The release workflow runs the default commands plus a real PostgreSQL service, `alembic upgrade/current`, the official npm-registry audit policy, a live API/worker, focused production-build browser tests, and the default PWA baseline before any image build. API schema/backend gates run in `api-quality`; Web and browser gates run in `web-quality`; `build-images` requires both jobs to succeed. Diagnostic quality evidence is explicitly non-deployable.

Every release browser invocation writes gate-scoped evidence under `apps/web/test-results/<gate-id>/gate-evidence.json`. An `always()` workflow step aggregates all 12 expected release gates into `apps/web/test-results/release-gate-summary.json`, with only `PASS`, `FAIL`, `SKIPPED`, and `NOT_VERIFIED` states. Missing, unreadable, still-running, or zero-test evidence is `NOT_VERIFIED`, never inferred as success; the quality artifact retains both the summary and per-gate traces.

Focused regressions cover production secret rejection/acceptance, Alembic `%` and encoded credentials, actual HTTP security headers, absence of `X-Powered-By`, CSP Report-Only, the single PDF.js `isEvalSupported=false` path, Mermaid strict mode, the long import commit proxy, and workflow ordering. Local results are lint PASS, typecheck PASS, build PASS, API `251 passed / 4 skipped`, Alembic `20260806_0021 (head/current)`, focused browser `6/6`, and default PWA `67 passed / 36 skipped`. The 36 Playwright skips are conditional online-write/fixture/production-copy flows and are not counted as PASS; the release workflow explicitly enables its focused online subset.

The production secret regression rejects missing, empty, development-default and known-placeholder values. It accepts custom values without imposing a length threshold, following the approved Release A policy revision. Tests use synthetic values and never read a production secret.

Release workflow evidence is three-layered rather than inferred from YAML. Runs `31705576354` and `31706041697` failed at early and late quality stages respectively; both skipped `build-images` and produced no deployable archive. Run `31706522862` passed every quality step and only then built, inspected, checksummed and uploaded the release archive. Production headers are not marked PASS because deployment was stopped by the production-secret gate.

## Manual TOC refresh (2026-08-13)

`test_toc_api.py` 覆盖只更新对话目录、只更新当前对话章节目录、同时更新且章节范围为全部对话、幂等 key、未选择任何目标的 `422`，并断言派生重建不会提升 Conversation revision。`toc-refresh-contract.spec.ts` 固定 Reader 右上角 More 入口、两个默认选中目标、当前对话默认范围、全部对话选项、统一 Dialog focus、worker polling 和精确 query invalidation。

本轮结果：TOC route `3 passed` + builder `1 passed`，Web contract `1 passed`，全 API `236 passed / 4 fixture-gated skipped`，PWA/Playwright `59 passed / 36 environment-gated skipped`，lint/typecheck/build PASS，Alembic single head `20260806_0021`。PWA 的 API-dependent 场景因默认矩阵未启动 API 而 skip，不计为 PASS。

生产 Chrome 使用隔离 QA Conversation 验证 combined/current、dialogue-only、section-only 三种提交、默认值、all-scope 选择器、initial focus、single accessible Close、Esc focus restore、完成 live status 与刷新稳定性。生产没有执行 all-conversations section rebuild，因为它会重建真实业务对话的派生 Heading；该分支由实际 API/worker 集成测试执行，不将其冒充为生产 PASS。

## Import compatibility v5 (2026-08-12)

The import regression matrix now covers Prompt-only/Response-only paired Markdown, arbitrary single-role Markdown rejection, blank JSON messages at head/middle/tail, empty Markdown sections, missing non-empty messages at head/middle/tail, normalized matches without timestamps, duplicate ambiguity, timestamp mismatch, lossy JSON plus rich Markdown, old Markdown repair and the existing full-flow contract.

The user-supplied pair is read directly from `CHAT_READER_IMPORT_PAIR_JSON` and `CHAT_READER_IMPORT_PAIR_MARKDOWN`; the tests perform Preview only and never change the source directory or commit the conversation. Current results: exact supplied-pair compatibility `61 passed / 2 fixture-gated skipped`; isolated production-build file-chooser Preview `1/1 PASS`; real 398-message preview/commit/idempotent-retry matrix `12 passed / 1 fixture-gated skipped`; full API `235 passed / 4 fixture-gated skipped`; Web contract `2/2`; default PWA `57 passed / 36 environment-gated skipped`; Web lint/typecheck/build PASS. Skips are reported separately and are not PASS.

The final production multipart Preview of the supplied pair returned HTTP `200` in about 1.5 seconds with one non-empty exact-match message, `can_commit=true` and no warning. It was not committed. The resulting preview-only ImportRecord is left to the existing TTL because the product does not expose a safe immediate-delete endpoint; tests and cleanup must not substitute direct SQL deletion.

Unique role/timestamp identities use the linear alignment regression in `test_exporter_aligner.py`. The 398-message preview assertion must remain under 20 seconds. Structured logs split JSON parsing, Markdown parsing and alignment so a future proxy timeout can be assigned to the actual stage.

## Archived project deletion (2026-08-12)

`test_projects_api.py` verifies that active/default projects cannot be deleted, an archived project can be deleted, its conversations remain under Unclassified with a new offline revision, and a repeated delete returns `404`. `archived-project-delete.spec.ts` freezes the single/batch UI, irreversible confirmation copy, retained-conversation wording, API call and cache refresh contract. Current results: focused API `9/9`, Web contract `1/1`, lint/typecheck/build PASS, full API `220 passed / 3 fixture-gated skipped`, Alembic head `20260806_0021`.

## AI Rich Markdown release (2026-08-12)

The current parser/browser matrix is split by evidence level:

| Suite | Current result |
| --- | --- |
| `ai-rich-markdown-parser.spec.ts` + static contract | `4/4 PASS` |
| Reader/Editor/security/109-formula stress + attachment flow | `8/8 PASS` |
| Real `.md` chooser/upload/save/inline/Viewer | `1/1 PASS` |
| Heavy Owner/Share Reader restoration and wheel regression | `8/8 PASS` |
| Offline KaTeX font inventory + cold start | `1/1 PASS` |
| Default PWA matrix | `45 passed / 31 conditional skipped`; skips are not PASS |

Release browser command (API and production Web server must already be running):

```powershell
$env:PLAYWRIGHT_REUSE_EXISTING_SERVER='1'
$env:E2E_RICH_MARKDOWN='1'
$env:E2E_RICH_MARKDOWN_ATTACHMENT='1'
corepack pnpm --filter web exec playwright test `
  e2e/ai-rich-markdown.spec.ts `
  e2e/ai-rich-markdown-attachment.spec.ts `
  e2e/ai-rich-markdown-parser.spec.ts `
  e2e/ai-rich-markdown-contract.spec.ts `
  --config=playwright.config.ts
```

The browser fixture creates a QA-only two-message Conversation through the canonical create API, validates Reader and Source Editor semantics, and deletes the Conversation through the product API. The attachment fixture waits for upload resolution, then requires the first message PATCH to return 2xx before asserting inline and Viewer semantics. This specifically guards the resolved-draft race where CodeMirror had replaced `cr-upload://` but React still held the stale marker.

The compatibility matrix covers all four math delimiters, golden boxed limit, aligned/matrix/cases/Chinese text, invalid LaTeX, 109 formulas in one message, currency, inline/fenced code exclusion, GFM table/task/strike/autolink, cross-block footnotes, unsafe HTML/URL, untrusted KaTeX command, remote image non-fetch, MathML and 360px local overflow. Screenshot evidence is synthetic QA data only.

KaTeX offline readiness requires the active shell record to contain current `KaTeX_Main` and `KaTeX_Math` font URLs. CSS import alone is insufficient evidence. `library-offline.spec.ts` performs a real service-worker cold start after asserting those required assets.

Production commit `4d07ce4` was exercised with a disposable synthetic Conversation in real Chrome. DOM evidence recorded five KaTeX/MathML expressions, two display expressions, one semantic table, namespaced footnote reference/backlink, code isolation, inert unsafe HTML/link handling, literal currency, and zero page-level horizontal overflow. Source Editor preserved the raw bracket delimiter and selection offset across type/backspace. The QA Conversation was removed through the product API.

The exact 360/390/768 suite remains production-build browser evidence. The external Chrome extension advertised viewport control but did not return a callable override in this session, so it is not relabeled as exact production viewport evidence. A production screenshot timed out; this does not replace the passing DOM/source assertions, and local synthetic screenshots remain the visual evidence. The `/library` DOM reported an active 78-resource offline shell; exact `KaTeX_*` cache membership is asserted by the production-build service-worker cold-start test because Cache Storage is not exposed by the Chrome read-only page evaluator.

The reported production ChatGPT fixture adds distinct compatibility regressions: outer backslashes may already be gone, delimiters may be `/[`/`]/`, the surviving formula may span paragraph and heading API RenderBlocks, and inline `\(n^6\)` may arrive as bare `(n^6)`. `ai-rich-markdown-parser.spec.ts` asserts strict source-range recognition, compact inline/bracket expressions, slash delimiters, bounded Setext normalization and prose/date/version/code/currency exclusion. `ai-rich-markdown.spec.ts` asserts Reader/Editor semantics, MathML, canonical-source preservation and Preview-default-collapsed behavior. `production-rich-markdown-copy.spec.ts` accepts an ephemeral UTF-8 Base64 source, creates a QA-only copy, expands Source Preview for full semantic coverage and deletes the copy through the product API.

Current v4 focused results: parser/shared contract `14/14`, Reader/Editor/security/stress `5/5`, two exact reported-source copies `1/1` each, and Markdown attachment shared renderer `1/1`. The default PWA matrix is `58 passed / 36 conditional skipped`; skipped online/fixture-gated cases are not PASS. The first full-source preview rendered 108 display formulas and at least 108 MathML trees. The second renders 41 display formulas/MathML, includes common scientific commands and the eight bounded conceptual labels, and leaves zero formula errors or bracket paragraphs. Earlier v1/v2/v3 evidence remains historical rather than final v4 production proof.

## Formula scroll stabilization (2026-08-13)

Focused Reader block estimator and Rich Markdown parser regressions pass `17/17`. Coverage includes display formula bounded-height estimation, aligned multi-row estimation, code/currency exclusion, ChatGPT delimiter compatibility and canonical parser behavior. Web typecheck, production build and focused ESLint pass. The full browser Rich Markdown suite was skipped because the local run lacked its API/fixture server; those cases are not counted as PASS. Production frame interval, long-task, cache-hit and long-reader wheel metrics remain `NOT_PRODUCTION_VERIFIED` until a production-equivalent fixture run is executed.

Production Chrome v3 evidence is an intermediate release check: the first reported page rendered one visual heading formula without exposing the hidden MathML/annotation layers, and the second rendered 33 scientific display formulas with zero errors. That check discovered eight standalone conceptual labels still displayed as brackets, so v3 is not the final PASS.

Final v4 production evidence is PASS. Read-only Source Preview audits began collapsed and were expanded explicitly. The first reported page retained 108 display formulas, zero errors and one semantic/visual heading formula. The second produced `41/41` display formulas and MathML trees, all eight bounded conceptual labels exactly once, zero errors and zero residual literal bracket paragraphs. Both editors were returned to reading mode without saving. The default PWA matrix remains `58 passed / 36 conditional skipped`; those skipped online/fixture-gated cases remain separate verification debt rather than PASS.

## Offline/context delivery regression coverage (2026-08-11)

`apps/web/e2e/library-offline.spec.ts` covers active-shell immediate startup, failed update preservation, built-in Acquisition ZIP caching and bilingual usage instructions, read-only current-conversation files, cached/missing attachment handling, local CanJSON/Markdown/`.context.zip` export, clipboard rejection with independent package download, and exact 360x800, 390x844 and 768x1024 reflow. It checks actual ZIP members and bytes; there is no Skill viewer or manual checksum confirmation in the UI.

The full local matrix completed with `41 passed / 27 skipped`. The skips are conditional API/fixture-backed flows (upload/import/online reader/share) because the PWA web server was intentionally run without an API at `127.0.0.1:8000`; they are not counted as PASS. Offline quota exhaustion, interrupted package writes, reconnect synchronization and production network interception remain `NOT_PRODUCTION_VERIFIED`.

The local offline exporter is intentionally bounded to the downloaded snapshot and does not replace the server export contract. Any future change to manifest compatibility must add an API/import round-trip test before release.

## Reader wheel stabilization 2026-08-10

The production-equivalent fixture contains three heavy Assistant messages with 402, 389 and 501 mixed paragraph, CJK, emoji, heading, list, table and short/long-code blocks. It may be created by the suite or reused explicitly:

```powershell
$env:E2E_LONG_READER='1'
$env:E2E_LONG_READER_CONVERSATION_ID='<qa-conversation-id>'
$env:E2E_LONG_READER_TARGET_MESSAGE_ID='<qa-message-id>'
$env:E2E_LONG_READER_TARGET_BLOCK_INDEX='180'
$env:E2E_LONG_READER_ANNOTATION_QUOTE='<qa-quote>'
corepack pnpm --filter web exec playwright test e2e/reader-restoration.spec.ts e2e/reader-block-layout.spec.ts --config=playwright.config.ts
```

The suite asserts estimator bounds, direct/search/annotation navigation, refresh restoration, TOC virtualization, preference anchoring, Owner and Share reuse, 30 monotonic wheel steps, at most six mounted messages, bounded virtual rows, no row gaps/overlap, no middle-window turn fetch, no save during wheel input and exactly one save after idle. Current result: `9 passed`.

Performance gating is opt-in so slow CI hardware does not hide functional failures:

```powershell
$env:E2E_READER_PERF_BUDGET='1'
corepack pnpm --filter web exec playwright test e2e/reader-restoration.spec.ts --config=playwright.config.ts --grep 'continuous wheel' --repeat-each=3
```

Current production-build Chromium results were `16.7ms` p95 frame interval in all three runs; longest task was `72/68/70ms` and five-second long-task total was `72/68/70ms`. Budgets are p95 `<=34ms`, no task `>150ms`, and total long-task time `<=250ms`.

Release checks for this change: Web lint/typecheck/build PASS; API `216 passed / 3 skipped`; Alembic one head `20260806_0021`; PWA default `37 passed / 22 conditional skips`. Conditional PWA skips remain `PARTIAL_PASS`, not PASS.

## Release-Readiness Audit 2026-08-10

- Required local baseline: lint, typecheck and production Web build passed; API `216 passed, 3 conditional skips`; PWA `30 passed, 21 conditional skips`; Alembic has one head `20260806_0021`. Conditional skips are not PASS.
- Real production Chrome acceptance was read-only for existing business data. QA-only conversations verified creation, insertion, source task toggle, deletion/undo, restricted Share/revocation and the direct API import follow-up. Existing acceptance fixture verified attachment Renderers, Range and adaptive visible Viewer panels.
- The supplied JSON + Markdown pair previewed exactly 398 nonempty messages and committed without a 500 through the production multipart API. Browser chooser interaction remains `NOT_PRODUCTION_VERIFIED` because this Chrome integration cannot inject chooser selections.
- Release blockers: active unreferenced Attachments missing from Files Panel filters and a non-functional delete-undo toast. The detailed report, QA cleanup record and redacted evidence are in [UX_RELEASE_READINESS_AUDIT_2026-08-10.md](evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md).
- Production negative offline/weak-network faults, 360px and browser zoom matrix, QA export/restore round trip and conditional PWA scenarios remain `NOT_PRODUCTION_VERIFIED` until separately executed.

## Release Stabilization 2026-08-10

- Root-cause fixes: delete/restore now return the committed conversation revision; edit/task/version responses do the same; Web seeds the create response, applies insert/edit/task/version/delete/restore revisions immediately, and preserves a retryable Undo state. Restore is idempotent.
- Attachment API rows expose `current_occurrence_count` as a projection. Active zero-reference rows remain eligible for All/Unreferenced; detached rows remain excluded. No occurrence/AssetObject merge or migration was introduced.
- Managed dialogs use `useDialogFocus` for synchronous meaningful focus, Tab/Shift+Tab trapping, Escape and logical trigger restoration after pointer defaults. Backdrops are pointer-only `aria-hidden` surfaces, so each dialog has one accessible visible close button. Attachment Viewer restoration falls back to the current connected Attachment trigger if React replaced the opener node.
- Disabled Scanner messaging is neutral `Info` + `未扫描`; it is not rendered as clean/safe or as an attachment fault. Project creation uses Chinese `新建项目` labels and autofocuses the inline field.
- Verification: targeted API `10 passed`; full API `216 passed / 3 skipped`; Web lint/typecheck/build PASS; focused stabilization contracts `4 passed`; PWA default `30 passed / 21 skipped`. Production Chrome on final commit `ed9116a` passes Viewer initial focus, keyboard loop, Esc/X/backdrop restoration, single close/Shell, and Project-create autofocus/Escape restoration. The bridge's requested 390px viewport rendered at 433px without page horizontal overflow. Exact 360/390, real 125/150/200% zoom and forced-offline negative paths remain `NOT_PRODUCTION_VERIFIED`; skips are not release PASS.

## Attachment Inline Layout System

- Focused Playwright policy tests: `13 passed` across InlinePresentation mapping, six centralized lane contracts, justified last-row bounds, progressive disclosure, runtime FileList fallback, CSV/TSV Table/Raw behavior and unchanged adaptive Viewer behavior.
- Web lint, typecheck and production build: PASS.
- API regression: `216 passed, 3 skipped`; skipped fixture-gated cases are not PASS.
- PWA default matrix: `28 passed, 21 skipped` (`PARTIAL_PASS`). Online/fixture-gated upload, full Reader and restoration scenarios require explicit services/flags.
- Alembic: one head `20260806_0021`; no migration.
- Production Chrome evidence: the deployed acceptance conversation verified group-owned lanes, one Viewer shell, CSV Table default, Raw toggle and return to Table. The broader visual matrix (all requested formats and mobile widths) remains `NOT_PRODUCTION_VERIFIED` unless separately captured; skipped cases are not PASS.
- Caption follow-up: focused policy tests `6 passed`; final production Chrome found zero legacy `Attachment:`/`附件：` captions duplicating Preview-header filenames. All three CSV Table actions remained available.

Local checks for the conversation, import and viewer addendum:

- `pytest -q` API suite: `216 passed, 3 skipped`.
- Real JSON + Markdown fixture (`CHAT_READER_E2E_FIXTURE_DIR=<EXAMPLES_DIR>`): 398-message preview, commit and repeated commit passed; local test harness elapsed 17.7 seconds.
- Web lint, typecheck and production build: PASS.
- Attachment renderer policy/presentation Playwright tests: PASS.
- Full King browser verification of new message dialogs and complex Office/ZIP viewers: `NOT_PRODUCTION_VERIFIED` until a dedicated deployment test is run. Skipped scenarios are not PASS.

## Reader Wheel Performance Regression

- `reader-block-layout.spec.ts` verifies paragraph, CJK/emoji, explicit-line, heading, code and empty-block estimates against stable layout metrics.
- `reader-restoration.spec.ts` verifies monotonic 30-step wheel input, bounded warmed height correction, no middle-window turn request, one idle position write, TOC follow, preference anchoring, annotation/refresh restoration and Share Reader reuse.
- Performance budgets run on a production build three times; report the median and every raw run. Functional invariants must never be skipped because a CI host is slow. Timing-budget failure may be reported as environment-specific only when all functional invariants still pass.
- 2026-08-10 local production-build result: p95 frame interval 16.7ms; longest task 72/68/70ms; total long-task time 72/68/70ms. Production Chrome read-only wheel evidence was monotonic with zero reverse steps and an 85px warmed height correction over about 1,080px.

## Reader Scrollbar Jump Regression

- `reader-restoration.spec.ts` changes an upstream virtual height after a heavy message has cached its absolute margin, jumps into that message, and requires a visible block plus reading-line coverage within the recovery budget. A visible Message shell without a visible block is a failure.
- The pointer-drag regression holds an active pointer while moving the Reader to the edge. It asserts that no `reader-turn` request starts while the pointer is held, then that exactly one request starts after release.
- Run the production-equivalent path with `E2E_LONG_READER=1`; the default PWA matrix intentionally reports these fixture-gated cases as skipped rather than PASS.

## Final Release Closure 2026-08-11

### Current command results

| Check | Result |
| --- | --- |
| Web lint / typecheck / production build | PASS |
| Full API | PASS: 218 passed, 3 skipped |
| Alembic | PASS: one head `20260806_0021` |
| Default PWA | PARTIAL_PASS: 37 passed, 27 conditional skipped |
| Mutation lifecycle/stabilization | PASS: 5/5 |
| Long Reader restoration | PASS: 8/8 |
| Offline baseline | PASS: 6/6 |
| File chooser/upload lifecycle | PASS: 5/5 |
| Flagged import/task/DnD | PASS: 3/3 |
| Sharing/system archive/manual targeted | PASS: 13/13 |

The default 27 skips are classified, not erased: 18 long-Reader/layout cases are environment/fixture-gated, 8 upload/import/task/DnD/mutation cases are online environment-gated, and 1 attachment case is fixture-gated. Release runs explicitly enabled the meaningful mutation, upload, import/task/DnD and long-Reader suites. A local reader-layout attempt using a production-only conversation ID produced four fixture-resolution failures; it is not a product PASS or failure and is superseded by exact production viewport checks and the valid long-Reader fixture.

### Release test status rules

- API PASS does not imply a complete user-flow PASS.
- Latest higher-level production E2E overrides older component/API evidence.
- A conditional skip remains unverified until its required service, fixture and flag are supplied.
- Device-scale-factor is not accepted as browser 125/150/200% zoom.
- Production bridge chooser limitations are recorded separately from Playwright's real `setInputFiles` coverage.
- `.cr v4` restore runs only in an empty production-equivalent instance, never by clearing production.

Actual browser zoom and the Offline negative matrix (runtime chunk miss, original/derivative miss, quota, interrupted package and reconnect) remain `NOT_PRODUCTION_VERIFIED`; therefore the strict Core and PWA release gates remain `PARTIAL_PASS`.

## Attachment Workspace And Markdown Source Regression 2026-08-11

- `release-stabilization-contract.spec.ts` freezes `reader-floating`, `left/top` CSS geometry, the whole-header drag handle, `grab/grabbing`, the accent `Paperclip`, stable CodeMirror setup/update callbacks, external `editorDocument` ownership and the Reader editable-target keyboard guard.
- `release-mutation-lifecycle.spec.ts` reads the real CodeMirror selection through the host's `data-cursor-offset`. DOM `Range` is not valid evidence for the whole source because CodeMirror virtualizes lines. The test moves to the bottom of a long source, types one character, deletes it and asserts exact cursor restoration plus no backward scroll correction.
- Current release results: API `218 passed / 3 skipped`; Alembic one head `20260806_0021`; default PWA/Playwright `39 passed / 27 conditional skipped`; static stabilization contract `6/6` PASS; production-equivalent source cursor/mutation flow `2/2` PASS. Production Chrome repeated the type/delete path at source offset 21860 with an unchanged 41091px scrollTop and unchanged active message.
- Production Chrome verified the attachment workspace default geometry, visible accent icon and computed `cursor: grab`. The bridge does not expose a physical pointer API; real drag/persistence/reset remains covered by the Playwright `reader-layout` mouse test and must not be reported as a production-bridge pointer PASS.

## Release A Production Closure 2026-08-13

| Evidence | Result |
| --- | --- |
| Final GitHub Actions quality and image gate | PASS, run `31713379831` from `1d366fb` |
| Quality-failure artifact block | PASS, retained controlled-failure runs `31705576354` and `31706041697` did not publish deployable images |
| Official registry provenance | PASS, exact Mermaid `11.16.1` and PostCSS `8.5.26` lockfile integrities match npm registry metadata |
| Production secret guard | PASS, tests and value-safe production preflight; no secret value observed |
| Alembic percent-URL handling | PASS, focused encoded URL tests and production current/head `20260806_0021` |
| Production HTTP headers | PASS, `nosniff`, referrer, permissions, CSP Report-Only; no `X-Powered-By` |
| Production Library/PWA availability | PASS, Library reports a ready offline shell and no page overflow |
| Production Rich Markdown/KaTeX | PASS, KaTeX/MathML present, no math error or page overflow |
| Production PDF Viewer | PASS, canvas rendered; one accessible close; Esc returned focus to `打开 sample.pdf` |
| CSP Report-Only browser smoke | PASS, no CSP violation in Library, Reader/KaTeX or PDF Viewer |
| Production Mermaid renderer | NOT_PRODUCTION_VERIFIED, no safe Mermaid QA fixture; strict-mode CI regression remains PASS |

The desktop Share utility drawer opened successfully, but Esc restoration landed on `body` rather than the Share trigger. This is an observed P2 accessibility defect, deferred by user direction to the next round. It is not counted as a Share-focus PASS and does not alter the Release A security/provenance gate.

## Release B Artifact Integrity Closure 2026-08-14

- `tests/test_artifact_lifecycle.py` covers same-filesystem staging, ZIP validation, atomic rename failure, outer rollback preservation, cleanup debt and protected dry-run classification.
- `tests/test_artifact_transaction_boundary.py` invokes the real BackgroundJob publication path with an injected outer commit failure. The previous Offline package remains referenced and downloadable; the new published file is allowed to remain an unreferenced orphan. Export commit failure leaves no committed artifact row and does not expose a download.
- `tests/test_import_queue.py` covers stale recovery below the ceiling, terminal failure at three attempts, scanner non-recovery of terminal records and an explicit bounded manual retry lifecycle.
- Local final result: focused `.cr`/transaction tests `10 passed / 1 PostgreSQL-gated skip`; full API `264 passed / 5 skipped`; Web lint/typecheck/production build PASS; Alembic remains `20260806_0021`. The local build uses `NEXT_DIST_DIR=.release-b-next` backed by the user-approved disposable build-cache directory. Skips remain separate from PASS.
- `share-drawer-focus.spec.ts` creates and deletes its own QA Conversation and asserts initial focus plus `document.activeElement` after Esc, X and backdrop. It runs only in the full online matrix via `E2E_SHARE_DRAWER_FOCUS=1`, never in the lightweight PWA matrix. The previous Release A production failure is preserved as historical evidence and is not overwritten.
- Final Actions run `31736593196` uses PostgreSQL and `POSTGRES_EXPORT_INTEGRATION=1`: API `265 passed / 4 skipped`, including the actual `.cr` Attachment query; focused browser `28 passed`, including Share focus; default PWA `67 passed / 37 skipped`. Earlier run `31735786444` failed one valid retained-shell status assertion and produced no deployable image, preserving quality-gate evidence.
- Production QA separately passed Offline A/B publication/download, committed `.cr` immediate download/archive sanity, and normal Import preview/commit. Fault injection remains production-equivalent only. The operator later completed manual production Chrome Share focus verification for Esc/X/backdrop/remounted-trigger restoration; this evidence is user-provided rather than browser-bridge automation.


## System archive task and fresh-instance gates (2026-10-02 working tree)

The required settings CI job includes `settings-system-backup.spec.ts` alongside
the existing settings suite: 375/768/1440 layouts, paginated persisted ownership,
offline state, lost upload response, stale choice and Task Center re-entry.
The separate `system-archive-new-instance` gate provisions a fresh PostgreSQL
database, migrates it to head and starts the normal API/worker with isolated
storage. It runs `system-archive-new-instance.spec.ts` against actual v5 input,
checking restored accounts/configuration, duplicate receipts and real downloads.
The expiry UI uses a fixed browser clock; backend expiry is tested independently.
Both gate results are required in the settings evidence summary. The dated
settings execution record tracks their completed CI runs and exact source
revisions; skips and earlier failed runs remain separate from passing evidence.

`APP_ENV=test`, `E2E_SETTINGS_MAILBOX=1` and a new `E2E_SYSTEM_ARCHIVE_SOURCE=.cr`
path explicitly enable `python tests/build_system_archive_browser_fixture.py`
(from `apps/api`). This builder creates synthetic source data in temporary local
storage, exports through the actual archive service, and never edits the target
PostgreSQL database. The new-instance test must run against a separate empty
disposable database, not the shared settings fixture or a user instance. It
requires the existing synthetic admin login variables and authenticated Web
build. Missing opt-in skips this test, never counts as passing.

Backend coverage: `test_system_archive_tasks.py` exercises real auth/API/worker,
choice persistence/revision, expiry, cancellation and records; the matching
`_postgres.py` covers real FK/migration, concurrent export/restore admission,
late cancellation and preference/table lock order. Use
`SETTINGS_POSTGRES_INTEGRATION=1` with a disposable PostgreSQL URL for those
integration tests. The declared head is `20261002_0042`.

The legacy preference API test now uses the existing isolated database fixture
and verifies persisted GET data; it must not write preferences to the configured
development database. The diagnostics gateway test recognizes both new exact
archive upload paths without increasing ordinary route limits.


## Stage-seven account and content tests

`tests/test_admin_users.py` covers literal pagination, effective status filters,
ordinary-account isolation and deletion idempotency/retry. `test_admin_reader.py`
exercises complete-turn boundaries, scoped attachment hydration, search anchors,
audit and real worker rebuilds after insert/delete/restore. The ordinary-user
delete path is exercised rather than only Root-owned fixtures.

With `SETTINGS_POSTGRES_INTEGRATION=1`, `test_user_deletion_postgres.py` uses a
disposable migrated database for concurrent confirmations, injected transactional
rollback, real worker retry and shared asset/format/rule preservation. The full
API CI gate already opts into these PostgreSQL tests.

`settings-admin-users.spec.ts` runs actual PostgreSQL-backed account inspection,
conversation pagination, Reader navigation/search, attachment viewing/download
and deletion at 375/768/1440. It also covers approval, disable/enable, session
revocation, password reset-link generation and an accepted deletion whose network
response is lost. The existing settings CI regex includes this file. Browser
screenshots contain synthetic fixtures only. Current counts and unfinished
acceptance are in the dated settings execution record.

## Local integration temp storage

`settings-archive-recovery.spec.ts` captures an actual preflight admission response
as a delayed history snapshot, then fails history reads while the real worker and
task-detail API finish. It verifies failed-state recovery, same-task retry and a
new queued run outranking stale failure while refresh is held. Three widths cover
both personal and Root panels. The phone cases also reject false empty-history
copy on initial read failure. Existing personal/system archive suites retain the
real download, additive restore, duplicate receipt, ownership and reentry checks.
The API job suites check current preflight availability after expiry/removal;
their PostgreSQL counterparts remain the transaction/migration gate. All test
content is synthetic; detailed local results and initial failures are in the
[archive recovery audit](execution/ux-audit-archive-recovery-2026-10-07.md).

### Administrator account recovery

`settings-admin-recovery.spec.ts` uses the existing isolated authenticated
PostgreSQL/API/worker fixture with `APP_ENV=test`, `AUTH_ENABLED=true`,
`E2E_SETTINGS_MAILBOX=1`, explicit test `DATABASE_URL`/API upstream, and synthetic
Root credentials. Run with `settings-admin-users.spec.ts` and
`settings-admin-invitations-audit.spec.ts`. The test waits for the real navigation
entry after hydration; viewport guesses do not substitute for observed visibility.

Six new cases cover 375/768/1440px, Chinese/light and English/dark. Acknowledged
disable/enable operations remain usable while subsequent GETs are held, and
persisted status/session rejection is verified independently. A deliberately
failed GET must return the expected 503 before testing its error state. Retrying
restores real account data; deleting a synthetic account then refreshing must
remove old detail and its generated reset link. Two 21-account fixtures verify
filtered last-page shrink and actual row focus after return. Lost deletion
responses are held until the real worker commits, then aborted; checks reuse the
original key, tolerate a seeded check failure, and verify single queue/completion
audit records. No successful write or task result is mocked.

`test_admin_users.py` compares the action snapshot with a fresh detail read and
persisted status, independent approval/verification and session revocation.
SQLite timestamp comparisons normalize its missing timezone metadata to UTC;
all remaining fields must match exactly. PostgreSQL deletion/verification tests
also require an explicit synthetic `AUTH_SESSION_SECRET` in the test process.
Intermediate failures and final gates belong to the
[account recovery audit](execution/ux-audit-admin-account-recovery-2026-10-07.md).

### Invalid archive replacement and expiry recovery

`settings-archive-replacement.spec.ts` uses the authenticated settings fixture with
the real API, single worker and independent PostgreSQL database. Run it with
`settings-archive-recovery.spec.ts`, `settings-personal-backup.spec.ts`,
`settings-system-backup.spec.ts` and `settings-task-center.spec.ts`. Explicitly set
**APP_ENV=test**, **AUTH_ENABLED=true**, **E2E_SETTINGS_MAILBOX=1** and an isolated
**DATABASE_URL**, in addition to the synthetic account and API upstream variables.
The helper process must inherit that same database URL. APP_ENV=test alone does
not enable Web authentication; API authentication does not substitute for it.

The six replacement scenarios cover personal/system panels at 375/768/1440px,
Chinese/light and English/dark. They create actual exports, upload invalid bytes,
then choose valid files for real worker preflight. Personal restores assert the
new conversations' persisted message contents. Keyboard focus, offline-disabled
replacement, empty selection, original-upload retention and Task Center re-entry
are checked. No mutation is expected merely from opening the replacement form.

`archive-test-helper.ts` seeds only expiry or a retryable terminal failure. It
requires test/mailbox flags and a synthetic test owner (or matching test Root),
refuses active and non-preflight tasks, and never creates successful output.
Delayed reads are held after the real retry response; the worker must validate
the same valid upload before success. Existing recovery tests use a seeded unknown
failure to retain generic-retry coverage; retrying their corrupt input still fails
for the actual file. These are controlled negative seeds, not reproduced disk or
scanner outages. A new empty-instance system restore is outside this batch.

The [replacement audit](execution/ux-audit-archive-replacement-2026-10-07.md) records
the final 26 passes, inspected screenshots, unsuccessful runs, runtime observation
and unexecuted broader gates. Keep temporary profiles/logs under the task's C-drive
`wkkk` directory. No new API, schema or package-format behavior is introduced.

### Support inbox navigation recovery

`settings-support-navigation.spec.ts` uses the same isolated authenticated
PostgreSQL/API/worker fixture as `settings-support.spec.ts`, with
`E2E_SETTINGS_MAILBOX=1` and the synthetic Root credentials supplied in the process
environment. Run it together with `settings-support.spec.ts` and
`settings-support-contextual.spec.ts`; production accounts are not fixtures.

The new suite covers 375/768/1440px, Chinese/light and English/dark. It holds or
fails GETs after real requests exist: refresh retains mounted rows/focus, its
error remains in the viewport, and returning from detail restores the actual row.
Two synthetic owners create eight active issues each; Root resolves the last
filtered page through the UI, then reads the remaining fifteen persisted rows.
Twenty real replies exercise failed next-page reads and successful retry without
incorrect page labels. Delayed filters and a real cross-account 404 check that
unrelated or inaccessible snapshots cannot reappear. The latter deliberately
replays the 404 to the view and is not an account-disable end-to-end claim.

Only this suite's synthetic accounts are removed by the existing fixture helper.
Temporary profiles/logs remain in the task's C-drive `wkkk` directory; synthetic
screenshots and sanitized gate summaries are retained in the
[navigation audit](execution/ux-audit-support-navigation-2026-10-07.md). Failures,
reruns and other gates not executed are recorded separately.

`settings-shares.spec.ts` uses the authenticated PostgreSQL settings fixture to
exercise real conflict/merge/discard, remote revocation, policy-change recovery,
per-item retry retention and filtered-page shrink. It verifies persisted owner
settings and public capabilities, including unchanged Share URLs. Network/partial
failure injection does not replace successful mutations. Three-width conflict
screenshots use synthetic content only. `test_my_shares_postgres.py` preloads two
independent sessions before a concurrent-write barrier to catch stale ORM identity
maps; exactly one settings write may succeed for the same base revision. Ordinary
API cases cover visitor reads, password revision, ownership, legacy partial PATCH
and revoked targets. These are scoped checks; full API/PWA and independent Skill
coverage must not be inferred. Run `share-drawer-focus.spec.ts` separately with
`E2E_SHARE_DRAWER_FOCUS=1` and its anonymous fixture; the authenticated settings
fixture is not a substitute for those default unauthenticated browser contexts.

`PLAYWRIGHT_USE_BUNDLED_CHROMIUM=1` selects Playwright's pinned full Chromium
with the `chromium` channel (new headless mode), including the persistent-profile
restart probe. The separate headless-shell binary produced native teardown
crashes on Windows and Linux CI. This changes the browser executable only:
test coverage, assertions, required gates and retry count are unchanged.

For long Windows browser/API matrices, set process-local `TEMP` and `TMP` to a
writable disposable directory with enough free space before starting pytest,
Playwright, the API and worker. Chromium downloads and pytest's temporary SQLite
fixtures use that directory independently of `*_STORAGE_DIR`. A cancelled
browser download alone does not prove an application failure; check its actual
failure and available space, retain the failed run, then rerun against real data.
Do not clear user storage or change global environment variables to run tests.
Authenticated tests require `AUTH_ENABLED=true` and `API_INTERNAL_URL` both at
Web build and Playwright startup: the dedicated import-commit proxy reads its
runtime upstream in addition to Next's built rewrite.

`test_default_project_postgres.py` reproduces concurrent first-login/default
Inbox creation with a real transaction barrier. The winner is reused and both
callers' pre-existing transaction writes must survive. It runs under the existing
`SETTINGS_POSTGRES_INTEGRATION=1` opt-in and full API CI gate.

`library-offline.spec.ts` verifies the actual compiled search worker and its
imports in the critical shell inventory, clears the ordinary browser HTTP cache,
then searches retained documents in a new offline page. Cache Storage is kept
intact. A separate injected worker-error case verifies the visible failure and
real worker/IndexedDB retry. The final PWA negative suite also exercises account
cache isolation and an independent browser/Service Worker restart.

## Follow-up CI inventory correction — 2026-10-30

The `76d277d` run passed API and settings, but its Default PWA inventory found
that the new `features/compare` directory lacked an explicit browser test owner.
It is now registered against `web-opportunity-features.spec.ts`; the comparison
browser contract remains active. The run did not produce an accepted artifact.
