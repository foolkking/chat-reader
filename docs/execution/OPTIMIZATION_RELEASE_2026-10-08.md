# Accumulated settings and offline improvements — 2026-10-08

## Scope and authorization

The user explicitly requested recovery of task
`01a0f1c6-52e7-7a42-ab33-61d52e1d7bcb`, commitment and CI of its accumulated work,
production deployment after verification, then a further evidence-based product
audit. The original goal remains active. Earlier checkpoints saying that no
commit or deployment was authorized describe their original local-only batches;
this request supersedes that release restriction.

The release includes the accumulated settings, sharing, archive, support,
administration, noise-review and offline recovery changes since `975c1ee`.
Migration 0049 adds the cleanup-request lookup index; 0050 adds and conservatively
backfills exact source fingerprints. Current/Index remain directly managed files;
the three default Skill ZIPs, existing Share URLs, archives, Dexie v2 and offline
package v1/v2/v3 compatibility remain required boundaries.

## Local checkpoint

- The original loopback Web start was attempted once in the new task. The tool
  rejected it before process creation with only `blocked by policy`. No rejecting
  rule or automatic-review rationale was supplied. No alternate local launcher
  was used, and the existing isolated database/storage remain preserved.
- Local lint, nonincremental typecheck, bounded production build and single
  Alembic head `20261008_0050` pass. The first typecheck invocation incorrectly
  forwarded an extra `--`; it executed zero type checks. The corrected invocation
  passed. No product defect is inferred from that command error.
- The current offline target/task/attachment gate passes **33 tests, zero skips**
  in **58.37 seconds**. All temporary output is under
  `C:/Users/86182/Desktop/wkkk/chat-reader-release-resume-20261008`.
- Settings discovery finds **439 cases in 57 files**, including the 16 formerly
  pending selection/offline cases. Discovery is not execution. Existing release
  CI will execute them against its isolated authenticated PostgreSQL/API/worker
  fixture. This is not a local specified-Chromium acceptance claim.
- Earlier local full-API and PostgreSQL evidence is retained in its dated records;
  it does not substitute for the new source's complete CI.

GitHub access was verified using the existing repository credential in process
memory; no credential was displayed or saved. The production read-only preflight
found healthy API/Web/PostgreSQL, a running worker and source `b45f049` images.
The server checkout has older operational modifications: deployment must preserve
its Compose and environment, and stage exact-source support files separately.

## Release gates and remaining work

Source `a31a1f8ee5ed730da291a295395f885bfb583d38` was committed and pushed. CI
[37748221325](https://github.com/foolkking/chat-reader/actions/runs/37748221325)
started the complete gates. Its Web gate passed lint/typecheck/build and then
failed the official dependency audit: new high advisories affect Next and sharp.
No images from this failed gate are deployable. The API gate subsequently passed:
**1,181 passed / 3 skipped** in the full suite, plus the separate 64-case Bundle
and 53-case cleanup gates and migration validation. These suites overlap. The
settings gate continues independently; its result is not yet accepted.

The follow-up adopts advisory-defined **Next 16.3.8** and **sharp 0.35.5**;
registry metadata and the published advisory ranges were checked. No audit
exception or threshold is changed. Locked installation, the bounded Next 16.3.8
production build and all **9 dependency regression tests** pass locally. The
official-registry audit policy passes with three advisories, one existing approved
high-severity braces exception, and zero unapproved blockers/policy errors; this
is not a zero-vulnerability claim. A new exact-source full CI is required.
Source `c779517` includes those upstream patches; its full CI is
[37750154439](https://github.com/foolkking/chat-reader/actions/runs/37750154439).
The first run's settings gate then finished **201 passed / 238 failed / 0 skipped**.
Inspection of all 238 failure reports identifies 11 fixture-port assertion
failures, 226 subsequent login-429 failures (including one UI login), and one
incorrect nested-dialog test action. These are failures, not unexecuted passes.

The guarded seeders intentionally accept only isolated loopback ports. The CI
settings service is aligned to **65438**; API/Web gates keep 5432. No seeder guard,
production authentication limit or assertion is relaxed. The review helper now
uses an already-open Task Center after Escape instead of clicking the obscured
background trigger; the regression additionally asserts both dialog states before
reopening. Application code and product behavior are unchanged by this follow-up.
A fresh full run is required to establish whether any product defects remain.

The fixture correction is source `1badec1`, full CI
[37753088570](https://github.com/foolkking/chat-reader/actions/runs/37753088570).
The preceding `c779517` Web job passed the dependency policy, Context (35), focused
online/security (45) and Share-focus (2) checks before its mutation gate reported
**15 passed / 1 failed**. That older whole-site regression still expected immediate
retry after an unconfirmed dismissal, contrary to the accumulated explicit
read-before-retry design. Its follow-up now checks the disabled repeat-write
control, the actual read-only dismissal result, unchanged write count during that
check, one explicit retry and the final server dismissal receipt. The original
seven-remaining-scans assertion is retained. This corrects the regression contract,
not the application, and does not turn the failed run into a pass.

Source `b18aced` contains that dismissal correction; its full CI is
[37754402200](https://github.com/foolkking/chat-reader/actions/runs/37754402200).
Its API gate passes; Web reaches the mutation gate and reports **15 passed /
1 failed**, now exposing a real rapid-search-filter input-loss defect. The
[scoped audit](ux-audit-search-filter-race-2026-10-08.md) retains the synthetic
failure excerpt before repair. Filter-only navigation now composes from the
synchronous URL through Next's native History integration; a deterministic
rapid-edit/Back/Forward/reload regression is added. Browser acceptance is pending.

The `1badec1` settings gate completed **433 passed / 6 failed / 0 skipped**.
All six failure reports were reviewed: one in-flight review route was removed
before `route.fetch` finished; two offline-recovery tests assumed a transient
summary existed after a fresh load; three cache-cleanup assertions read Cache
Storage immediately after releasing a held coordinator lock. Tests now drain
route handlers, use the permanent Tasks entry, and wait for the actual cleanup
operation/durable zero-cache state. No cleanup behavior, download assertion,
authentication guard or production task-visibility rule is weakened. These are
proposed test corrections, not six claimed passes; the full rerun must prove them.
The `b18aced` settings gate independently repeats **433 passed / 6 failed /
0 skipped** with the same six failing cases; both failed artifacts are retained
locally. Its image build and inspection jobs are skipped because the gates failed.
The follow-up's local lint, nonincremental typecheck, one-worker bounded build and
37-case discovery across the four touched test files pass. Discovery does not run
the browser or establish the proposed fixes' runtime correctness.

Source `79871329cc8f8bb7b6e01fb94deac89d32bc8b60` ran full CI
[37760561693](https://github.com/foolkking/chat-reader/actions/runs/37760561693).
API and Web gates pass. All 13 Web browser gates pass, including the 17-case
mutation suite with the new search regression. The default PWA suite retains
588 conditional skips and adaptive-import recovery retains one; overlapping
suites are not added into a unique-test total. The dependency policy passes
with the existing approved high-severity braces exception, not zero advisories.

Settings completes **436 passed / 3 failed / 0 skipped**. All three failures are
the offline-center widths, now at a newly added text assertion: bare `0/1`
also matches the renewed offline authorization date `10/10`. The reports show
both the correct `Cached files 0/1` / `已缓存附件 0/1` row and the date. The other
three previously failing cases now pass. The follow-up qualifies every 0/1 and
1/1 attachment-count locator with its actual localized label and a numeric word
boundary. Strict matching, the coordinator-lock check, actual zero-cache check,
download/cancellation/persistence assertions and production behavior are retained.
The zero-cache check after that assertion was not reached in the failed run;
its acceptance still requires the next full CI. Image build and inspection were
skipped, and no deployable artifact or production change resulted.
Changed-file ESLint, nonincremental TypeScript and three-case discovery pass for
the locator-only follow-up; none is counted as browser execution.

The read-only production attachment audit found **310 verified object hashes**,
304 active attachments and no issues; the production application remains intact.

No production change has occurred at this checkpoint. Record the source commit,
all CI job outcomes, original artifact/producer identity and independent image
inspection before deployment. Verify attachment storage, a consistent backup,
capacity and rollback image availability; stop old application writers for 0050,
keep PostgreSQL running, migrate with the exact new API image and recreate only
API/worker/Web with `--no-build`.

Afterward verify runtime source, single current/head, service health, worker
heartbeat, aggregate canonical/file preservation and relevant read-only endpoints.
Application testing must use isolated data; production pages are not a substitute
for the blocked local browser gate. Preserve failed runs and report skipped or
unverified cases separately. Only then continue the next product audit.
