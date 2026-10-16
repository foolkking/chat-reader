# UX and editable cleanup ranges release — 2026-10-16

Status: release in progress; production is still the accepted `84988a2`/0050.
The user explicitly authorized commit, CI and deployment, then required local
GitHub-token/CLI use rather than login or the GitHub website. Credentials remain
in the system credential provider and per-process memory, not this record.

## Local preflight

- The earlier 63-file UX continuation passed 1,412 tests without skips.
- Full Web lint, typecheck and production build passed.
- Full local API suite: **1,129 passed / 159 skipped / 0 failed**, 2,622.35 s.
  PostgreSQL-only skips are not release acceptance.
- Local PWA built, then was stopped after two missing-API browser timeouts.
  It is not a passing gate.
- Source has the single head `20261015_0051`. The existing local database is at
  `20260823_0028`; it was not upgraded. A later disposable-browser fixture could
  not create its separate database because the local role lacks `CREATEDB`.
  That attempt created no database. A subsequent entirely separate PostgreSQL 17
  cluster under the task TEMP directory supplied a unique synthetic database;
  the fixture drops only its own database and stops its own cluster afterward.
  The existing local database and all user storage remain untouched.
- In that isolated PostgreSQL fixture, adaptive import passed **8 / 1 conditional
  real-input skip**. The focused real PostgreSQL range migration/concurrent-edit
  suite passed **2/2**, including safe downgrade/upgrade consent preservation.
  This is PostgreSQL 17 local evidence, not the required PostgreSQL 16 CI gate.
- Staged source/document whitespace checks exclude archived raw console
  transcripts in `*-evidence/`; emitted whitespace and initial failures remain
  intact there.

## Candidate and first CI findings

Candidate `97d0915254f1fd1e47a6399b7297c99e909184ad` was committed and pushed to
`master`. Local-token dispatch started run **38829804840**, attempt 1, against
that exact SHA.

- Web lint, typecheck, build and all **1,412** UX tests passed in CI.
- Settings initialization failed while pulling the pinned official PostgreSQL
  image from ECR Public: `toomanyrequests: Data limit exceeded`. No settings
  test ran in that attempt.
- The adaptive-import browser gate passed seven, skipped one conditional
  real-input case and failed one outdated error-copy assertion. A mutation
  503 now reports the intentionally unconfirmed outcome, not read-only service
  unavailability. The revised test requires the exact current recovery text,
  retained input, no conversion help and exactly one analysis request.
- The revised browser test passed targeted ESLint and nonincremental typecheck.
  Its browser execution still requires the complete disposable CI fixture.
- The first API job was subsequently cancelled after the obsolete source's
  other gates had failed. It stalled after the export API cases; the independent
  dependency-matched diagnosis below explains the test transport defect.
  Cancelled execution is not an API pass and produced no accepted image.

## Production boundary

Read-only King preflight confirmed the expected current/rollback pointers,
exact old API/Web image IDs and database head 0050. PostgreSQL and application
services were running. The operational checkout is independently modified and
must not be reset or replaced. No production backup, writer stop, image load,
migration or service replacement has run in this batch.

0051 adds only nullable `content_cleanup_occurrences.reviewed_ranges`; existing
NULL values retain the legacy whole-candidate choice. Before any replacement,
all five exact-source CI jobs, independent artifact checks, recovery-point
verification, capacity checks and a fresh stopped-writer backup must pass.
Migration acceptance must compare every pre-existing column and all four stores,
and separately verify that the added field is NULL on existing rows. Rollback
must stop writers and use the tested consent-revoking downgrade before old API
code is started; silently dropping the field is not safe.

## Second candidate and browser-adapter repairs

Follow-up `95abbfe8e30c18d2c9da3189c92c100a911a06b0` started exact-source
run **38830876406**, attempt 1. Its revised adaptive-import gate passed.
Web's Context gate passed **33 / 35**, with both failures in the transient
task-progress probe: its global fault counter could be consumed by Task Center
reads before the intended returned task. The repair scopes faults to the exact
returned task, keeps the outage until recovery feedback is observed, then
requires one package POST and eventual generation 4. Both repaired viewport
cases passed in the isolated browser fixture. API initialization hit the same
ECR Public data limit; settings was still running at this checkpoint.

Further local browser preflight found stale Chinese-only attachment/PDF labels
and insertion-503 copy. Assertions now require the exact configured locale and
the write's intentionally unconfirmed outcome, retained input and one request.
They do not change product behavior or relax MIME/security policies.

Windows' MIME fallback classifies CSV through an OS registry Excel entry.
The task-only synthetic API wrapper normalizes CSV/TSV fallback entries; the
production resolver is unchanged. With that explicitly bounded fixture, all
**24 attachment-reading cases** and **13 PDF cases** passed.

Two new mobile/desktop noise cases exercise multiple selected candidates,
two exact subranges, retained context, unchanged source before confirmation,
checkbox off/on preservation, exact removal markers, preview and canonical
post-apply source. An initial keyboard-based probe failed because this Windows
Chrome's native read-only textarea does not move a caret for Shift+Arrow; the
same behavior reproduced in a plain textarea without application code. The
test now uses real pointer selection and verifies native offsets, not a
programmatic selection mutation or synthetic event. A read-only UI diagnosis
confirmed both range controls and the two-range local draft.

The first complete local 241-case batch finished **235 passed / 6 failed**:
the initial keyboard probe failed twice and the already-loaded insertion-copy
assertion failed four times. The repaired six then passed **6/6**, including
actual save/checkbox/preview/apply and exact canonical source at both widths.
The two synthetic range screenshots were visually inspected: only the two
chosen fragments are struck, retained `turn2` stays plain, and checked rows
have distinct state text/tint. This is 235 plus six focused passes, not a
claim that one unbroken 241-case run passed. Targeted ESLint, nonincremental
typecheck and source/document whitespace checks passed after these edits.

## API dependency-matched transport diagnosis

The cancelled first CI installed FastAPI 0.143.2, Starlette 1.8.0 and AnyIO
4.15.1, unlike the existing workstation's Starlette 0.46.2. An isolated task
virtual environment installed those same current API dependency versions and
reproduced the export-retention probe: an immediate fake disconnect could
preempt the send-failure assertion, and an endlessly immediate fake
`http.request` starved the newer FileResponse disconnect listener. A 110-second
outer process bound stopped this diagnostic; a faulthandler stack identified
the fake receive loop. The old installed dependencies passed the original
20-case file, which did not establish compatibility with CI's dependencies.

The transport adapter now awaits a new event like a connected ASGI transport;
the send-failure case also asserts that a body chunk was actually attempted.
No response implementation, dependency constraint, download lease, expiry,
source-preservation assertion or test inclusion was changed. The repaired file
passed **20/20** with CI-matched dependencies (38.22 s) and **20/20** with the
existing dependency set (40.81 s).
The complete PostgreSQL-enabled CI API step now reports individual cases and
a 120-second faulthandler stack, with a 45-minute step bound. It still runs the
entire suite, without case filters or skip overrides.

Quality artifacts are now source/attempt-scoped rather than overwritten or
name-colliding on failed-job retries. The unchanged immutable image-source
contract, attempt-isolation and additive bounded-API regressions passed
**13/13** locally.
Task-only deployment guards separately passed **10** synthetic migration/data/
recovery checks and the independent artifact inspector passed **6** synthetic
corruption/path/provenance checks. These are helper checks, not CI, backup or
production acceptance; no helper has been executed against production.

## Settings matrix and bounded follow-up

The second settings job reached its 60-minute bound after starting **463**
cases (the accepted previous release had 439). Its preserved original quality
artifact **12019825502** contains 23 failed-case contexts, 157 PNGs and an
explicitly unfinished gate; this is not settings acceptance. The original ZIP
digest was checked independently. No gate was extended, skipped or relabelled.

Most failures were stale adapters: safe bounded scan/write/signout feedback,
the enclosing cleanup dirty-close prompt, a now-required complete turn in a
notebook fixture, and the additional summary row's range-editing controls.
The collapsed-row check now also verifies hidden context and expansion growth,
alongside its bounded viewport budget. Comment Tab intentionally enters the
explicit actions without saving, so its conflict probe activates Save. Notebook
probes wait for durable draft/current read readiness before explicit saving.
Their persistence, failure, version/conflict, no-replay and server-byte checks
remain intact.

Five product regressions were isolated and repaired without new architecture:

- A confirmed cleanup choice unnecessarily held its mutation lease while
  metadata reads waited. Acknowledgment now releases the write; candidate
  editing still waits on current page reads, while preview independently
  validates current saved choices.
- Revoking the last filtered Share page could reuse a 15-second sibling-page
  cache with the old total. Sibling pages are invalidated without background
  refetch before refreshing the current page/recovering its offset.
- A real worker transition between bounded active/terminal task queries
  returned the same job twice. The API now preserves order and one latest
  projection per task identity. Three independent-commit race cases cover jobs,
  imports and pending account cleanup; the full focused task API file passed
  **20/20** with CI-matched dependencies.
- Changing notebook locale restarted the local-draft read and could publish
  an older persisted snapshot over typing while storage was pending. Locale
  now controls failure copy without restarting that read. Two controlled
  actual-component regressions reproduced lost text before the repair and
  pass afterward in both language directions. These storage doubles are not
  browser latency evidence.
- The notebook risk effect cleared and re-reported parent risk on every draft
  object change, even within one pending-write interval. Task-only browser
  observation captured the actual input, React error 185 in its handler and
  React restoring the previous textarea value. Risk notification now follows
  boolean transitions, unmount cleanup is separate, and the unload listener
  follows that same risk boolean. An 80-edit pending-write regression fails
  before the repair and passes after it; all **81** annotation checks pass.

An authenticated task-only PostgreSQL 17/API/worker/SMTP fixture, using
CI-matched API dependencies, passed the **28** targeted settings probes in two
minutes. Its initial external build junction failed Next's runtime module
resolution; the ordinary repository build passed instead. That failed fixture
dropped only its own synthetic database, and the generated config edits were
reverted. A confirmation run passed **27/28**: the 375px rapid-input case lost
one character before reload. A locale-only repair still produced **26/28**;
it did not solve rapid input, and the later event observation isolated the
risk-effect problem above. The keyboard case now also requires no uncaught
page errors, alongside complete input/reload bytes, the unchanged second block
and exactly one server revision increment. Typing speed is unchanged.
After rebuilding the ordinary production Web output, rapid typing passed
**10/10** (five repetitions at each viewport), with zero page errors and all
original reload/save assertions. The complete serialized 64-file UX Node
run passed **1,419/1,419 / zero skipped**, full Web lint and nonincremental
typecheck passed, and CI source contracts passed **13/13**. Production, the
existing local database and all user import material remain untouched.

## Repeated CI failure and local reproduction

Run **38852898749** did not pass: Web service initialization hit the ECR
Public data limit, and settings had one connection-reset failure after 462
passing cases. The following exact-source run **38857719980**, attempt 1,
at `feba9560c625548097246b51b5c15d27fece9769` also failed. API passed;
settings finished **460 passed / 3 failed**, and the default PWA baseline
finished **137 passed / 2 failed / 737 conditional skips**. Image jobs
did not run. None of these runs is release acceptance.

- All three settings failures were an incorrect newly added test assertion:
  Playwright Response exposes `status()` rather than a numeric `status`
  property. The assertion now calls the method after awaiting the exact
  revocation response. Only the idempotent verification GET may retry a
  connection reset; the destructive POST still must occur exactly once.
  Route cleanup waits for in-flight handlers before disposing their contexts.
- Both PWA failures were a late IndexedDB fault injection. Installed Dexie
  binds the database transaction method when it opens, so patching the
  prototype afterward did not fail its reads. The test now installs a
  disarmed wrapper before navigation, arms it after seeding the retained
  copy, and disarms it for explicit recovery. It checks actual fault counts,
  a new failed read per Retry, retained content and zero package submissions.
  The original source reproduced **2/2 failures** locally; the repair passed
  **10/10** repetitions and the full offline file passed **15/15**. Both
  viewport screenshots were visually inspected.
- Account confirmed/unconfirmed revocation repetitions passed **20/20**.
  The initial full account/cleanup batch passed 14 and failed one scoped
  cleanup probe; a subsequent cleanup repetition passed nine and failed one
  at the same missing third outbox operation. These failed runs are retained,
  not combined into a clean result. Replacing synthetic button activation
  with real actionable clicks and waiting for durable/current draft state
  did not by itself establish a fix. Separate diagnostic copies passed
  10 and 20 cases; those passes alone do not disprove the intermittent issue.
- An actual-component regression isolated an unnecessary save admission gap:
  even an already-durable draft awaited a settled promise, allowing a
  background read to make the accepted save return without writing. The new
  regression failed before the repair (zero writes instead of one).
  Saving now waits only while draft persistence is pending; after a real
  wait, readiness is still rechecked. A second case requires no write while
  blocked, retained text and no automatic replay when reads recover.
  Both new cases and all **83** annotation component checks pass.

After the save repair, the serialized 64-file UX Node suite passed
**1,421/1,421**, without failed/skipped/cancelled cases. Production Web build
and **15/15** CI/source-evidence contracts passed. Cleanup repetitions then
passed **20/20**, but the expanded real 35-case settings run still passed
34 and failed one at the same third outbox operation. A 105-case diagnostic
copy and six stress cases with 15 cross-tab edits each also passed; these are
not treated as proof that the original fixture was reliable.

The cleanup probe now owns its deliberately failed sync response while the
second tab creates the changed snapshot. Previously, every immediate abort
could trigger an unrelated background notebook reload during the edit/save.
A finite response barrier holds only that edit interval, releases before
cleanup verification, and always releases/waits for route handlers during
teardown. The real actionable save, exact three-operation precondition,
stale-export rejection, retained other conversation, final outbox counts and
unchanged server notebook assertions remain. Automatic read/write recovery
is separately exercised by the annotation/notebook probes; no save or
destructive request is automatically retried.

Final checks of the actual repository files, without diagnostic copies:

| Local check | Result |
| --- | --- |
| Complete account recovery, notebook drafts, scoped cleanup, independent annotation reads and annotation writes (five files, three repetitions) | **105 passed / 0 failed / 0 skipped / 0 flaky**, 265.48 s |
| Default PWA baseline, including both resource-inspection cases | **139 passed / 0 failed / 737 conditional skips / 0 flaky**, 130.79 s |
| Complete serialized UX Node suite | **64 files / 1,421 passed / 0 failed / 0 skipped** |
| Annotation component subset, included in that Node suite | **83/83** |
| CI/source-evidence contracts | **15/15** |
| Full Web lint, nonincremental typecheck and production build | Passed |

## Latest exact-source CI attempt

Run **38867774061**, attempt 1, used the exact pushed source
`dc865c1402d4be6423e92fd7c44451d46b6c96d5`.

- `settings-quality` completed successfully, including the real settings
  matrix and the fresh-instance system archive restore.
- `api-quality` and `web-quality` both failed in `Initialize containers` before
  checkout. The runner retried the pinned
  `public.ecr.aws/docker/library/postgres:16-alpine` pull three times and each
  returned `toomanyrequests: Data limit exceeded`. No API or Web source test
  ran, and image build/independent inspection were skipped.
- The Web job's `if: always()` summary step then reported
  `apps/web/e2e/gate-summary.mjs` as missing because checkout had never run.
  The tracked file exists at that path in this source; this is a cascading
  infrastructure diagnostic, not a source-path failure.

This is an external registry-service failure, not a passing or product
regression result. The pinned official-image contract is intentionally
unchanged; replacing it with an unverified registry or bypassing the service
container would invalidate the release gate. A fresh exact-source retry is
required before artifact verification or King deployment.

The browser fixture used Windows Chrome, task-only PostgreSQL 17 and API
dependencies matched to the failed CI. Its assertion bound was 10 seconds;
the repository/CI bounds were not increased. Each run removed only its unique
synthetic database and stopped its own cluster/API/worker. Existing local
data, user imports and production remain untouched.

These remain local bounded results, not full settings/PostgreSQL 16/CI
acceptance. No API, migration, dependency or workflow gate changed; no
existing test was omitted or timeout extended. After the next dispatch, do
not watch CI or deploy until the user supplies its result.

## Authentication copy adapter after registry recovery

Run **38874465008**, attempt 1, uses exact pushed source
`a1322b6642e0676dc027f204e618d06034fbb605`. Container initialization succeeded
in all three quality jobs, so the earlier registry failure did not recur.
The PostgreSQL 16 API suite passed **1,288 / 3 skipped**, and migration
validation reported single head/current `20261015_0051`.

Web passed the preceding browser gates, including Context **35**, mutation
**100**, cleanup **3**, attachment **25**, PDF **13**, and default PWA
**139 / 737 conditional skips**. Authentication finished **16 passed /
1 failed / 1 not run**. The obsolete assertion expected “Incorrect share
password.”; the current bounded recovery message deliberately states that
the password was incorrect or the share could not be unlocked right now.
The later negative PWA gate was not reached. The settings job is still
running at this checkpoint; this is not complete CI acceptance.

Original quality artifact **12035294907** was downloaded through the local
credential provider, its ZIP SHA256 matched the API digest
`5755d476554a2493e91d2f6e16e93f53c93df000ffa741a318fd869005126fef`, and its
gate summary matches this source. The trace confirms the attempted unlock
actually returned **401**, with the password gate still present and current
recovery text visible. The failure is a stale browser adapter, not a failed
Share protection check.

Only `auth-gate.spec.ts` changes. It requires the exact current error text
and additionally checks the rejected **401**, retained input, no protected
heading, one POST per explicit attempt, accepted **200**, and a guest with
no owner-session cookie. Correct password, `/library` rejection, public Share,
session-revoking password change and all recovery cases remain included.
No product/auth/API, dependency, migration, workflow, test selection or timeout
is changed.

The original actual files reproduced the failure locally (**16 passed /
1 failed / 1 not run**, 91.92 s). After the test repair, both actual auth
files passed **18/18 / zero skipped / zero flaky**, 85.48 s. A separate
five-repetition protected-Share run passed **5/5**, 70.85 s. The existing
Share-unlock lifecycle Node file passed **23/23**; full Web lint, targeted
test lint, nonincremental typecheck and diff whitespace passed.

These used the task-only PostgreSQL 17/API/worker fixture and an existing
production Web build; no new Web build is claimed for this test-only repair.
Each run dropped only its uniquely named synthetic database and stopped its
own services. Original logs/ZIPs remain in the task TEMP directory, not the
repository. Existing data, imports and production remain untouched. New
exact-source full CI is still required; after dispatch, stop for the user
instead of watching or deploying.

## Negative PWA Viewer locale adapter

After the user reported the specific failed Web job, run **38879420622**,
attempt 1, was read through the existing local credential provider. It used
exact source `59ce9d73e0168150c3c7c0e565382a9d18fff3bc` and completed:

- API **1,288 passed / 3 skipped**, with single migration head/current 0051.
- Settings **463 passed / zero skipped**, plus **one** passing fresh-instance
  system archive restore. The previously pending settings job in run
  38874465008 also finished successfully.
- The first **12 Web gates passed**, including repaired authentication
  **18/18**, default PWA **139 / 737 conditional skips**, attachment **25**
  and PDF **13**.
- Only the final production-build negative PWA gate failed:
  **17 passed / 1 failed / zero skipped**. Image build and independent
  inspection were skipped; no release artifact was accepted or deployed.

Original Web quality artifact **12038312446** matched its API ZIP SHA256
`a096d22cfe7329b1f2a5d8b24640b9b202f96a9fd00a9ad9b4251ffa328bbd76`;
settings artifact **12038274782** matched
`3fbd826f46541130ba2987ed71a84d253296f9d0fc1f24d3968b978515fee1a1`.
Their source/attempt-scoped summaries and the failed browser context were
checked. The Viewer showed the correct English uncached-attachment message,
Retry and Close controls; the test still required Chinese-only text and
button labels. This is a stale locale adapter, not a cache-recovery defect.
The original actual case reproduced locally as **one failed case**, 21.52 s,
using a 10-second assertion bound rather than CI's unchanged 60-second bound.

Only `pwa-negative.spec.ts` changes. The original Viewer case now runs once
per real server locale (`en-US`, `zh-CN`), checking the rendered document locale,
exact full recovery message and localized controls. It also requires successful
deletion of the existing cached resource, a visible/enabled Retry button and
initial modal focus. Escape closure and return focus to the original file
button remain mandatory. The synthetic server's previous locale is restored
in `finally`; product code, API, migration, dependencies, workflow, test
selection and timeouts are unchanged. The complete matrix grows from 18 to
19 cases; none is removed or skipped.

Local verification used the actual repository test file, fresh task-only
PostgreSQL 17 databases, isolated API/worker/storage and a newly built
production negative-test bundle:

| Check | Result |
| --- | --- |
| Complete negative PWA matrix, including v1/v2 compatibility, shell/cache faults, transaction rollback, restart and recovery | **19 passed / 0 failed / 0 skipped / 0 flaky**, 60.71 s |
| Chinese/English Viewer case, five repetitions each, separate fresh fixture | **10 passed / 0 failed / 0 skipped / 0 flaky**, 52.09 s |
| Attachment reading, inline locale and offline-query Node files | **65/65**, no skips |
| Full Web lint, targeted test lint, nonincremental Web typecheck, negative-test production build and diff whitespace | Passed |

The build's generated `next-env.d.ts` path change was restored, not committed.
Each fixture dropped only its uniquely named synthetic database and stopped
its own services. Original CI ZIPs and local evidence remain in the task TEMP
directories; no user data, import storage or production configuration changed.
Local results do not accept the failed CI. The next complete exact-source
run remains required; dispatch once, then stop and wait for the user's result
without watching CI or deploying.

## Post-authentication negative PWA fixture correction

Run **38885644480** used exact source
`cb223d7da02e4d62ef6105a96c2d239369252db5`. Its first attempt again failed API
and Web container initialization on ECR Public's data limit, before checkout.
Settings passed **463** cases plus the independent fresh-instance restore.
After the user returned, only failed jobs/dependents were retried, preserving
that source's successful settings result.

Attempt **2** completed the API suite **1,288 / 3 skipped**, single migration
head/current 0051, and the first **12 Web gates**, including authentication
**18/18** and default PWA **139 / 737 conditional skips**. The final negative
PWA file passed **17** and failed both new locale cases immediately at their
private `/api/preferences` GET: expected 200, received **401**. Build and
independent image inspection were skipped; nothing was deployed.

Web quality artifact **12044955127**, producer attempt 2, matched API ZIP SHA256
`96def4f4248eeb915d7ff3233b56d40ee597b31d34ed579996846003d50c49d1`.
The retained settings artifact **12042240149**, producer attempt 1, matched
`5fa1b977d538d84575a57b54eee18953b034e4785cbbde5caec3748ea67d567e`.
Their source-scoped summaries and both failed error contexts were checked.
The older and newer quality attempts were not overwritten or conflated.

The authentication gate restarts the API in the same shell that still has
`AUTH_ENABLED=true`; the following PWA step starts Web without that step-level
setting. The API therefore correctly rejects an unauthenticated private
preference request while the ordinary test PWA remains readable. The previous
local fixture had API authentication disabled and did not expose the new test
dependency. This was an error in the prior test repair, not a reason to disable
authentication, accept 401 as a successful preference read or relax the gate.

Only the browser test changes. Both locale cases set actual browser
`Accept-Language` and require the rendered SSR document language before opening
the Viewer. They no longer read or mutate private preferences. Successful
cache deletion, exact complete localized error text, visible/enabled Retry,
initial modal focus, Escape closure and restored trigger focus all remain.
Product behavior, API authentication, workflow/process lifecycle, dependencies,
migration, case inclusion and timeout bounds are unchanged.

The task-only fixture now provisions a synthetic owner, starts the real API
with authentication enabled, verifies anonymous preferences return **401**,
and separately starts Web in the workflow's ordinary PWA mode. No route is
mocked and no auth request is treated as successful. Its unique PostgreSQL 17
database and four storage roots remain isolated from existing user data.

| Local check | Result |
| --- | --- |
| Unmodified `cb223d7` Viewer test source, same post-auth fixture | **2 failed on 401 / 0 passed**, 5.91 s |
| Corrected actual full negative file, same post-auth split | **19 passed / 0 failed / 0 skipped / 0 flaky**, 58.66 s |
| Corrected actual bilingual Viewer, separate post-auth fixture, five repetitions each | **10 passed / 0 failed / 0 skipped / 0 flaky**, 50.74 s |
| Corrected file with API authentication disabled | **19/19**, 59.09 s; separate Viewer repetitions **10/10**, 50.43 s |
| Attachment reading, inline locale and offline-query Node files | **65/65**, no skips |
| Browser-gate summary and immutable-image/CI source contracts | **15/15**, no skips |
| Full Web lint, targeted test lint, nonincremental typecheck and diff whitespace | Passed |

The first copied-source diagnostic used an incompatible file filter and
discovered no tests; it is not counted as a red test or a pass. After fixing
the task-only filter, both original cases ran unchanged and failed on the
same 401 as CI. The positive runs use the actual repository test file, not
a diagnostic copy. They reuse the existing production negative-test bundle;
no application source or new build is claimed in this correction.

All task services stopped and only each fixture's unique database was dropped.
The existing local database, import materials and King production remain
untouched at the accepted source/0050 boundary. These local checks do not
accept the failed CI. Commit the correction, dispatch one complete exact-source
CI, then stop and wait for the user without watching or deploying.
