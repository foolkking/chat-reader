# Testing

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
