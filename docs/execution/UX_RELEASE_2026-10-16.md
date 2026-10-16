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
