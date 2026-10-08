# Accumulated settings and offline improvements — 2026-10-08

## Accepted outcome

Source `30a0d321fe2d538b0fa0bbd61b3e982452f822cb` is deployed and accepted on
King, with single head/current `20261008_0050`. All five exact-source CI gates,
independent artifact verification, consistent backup, data preservation and
authenticated HTTP smoke passed. Finalization retains two verified backups and
loaded b45f049 rollback images. See the final sections and
[sanitized evidence](../evidence/optimization-release-2026-10-08.json).
Earlier pending/failed statements below are chronological checkpoints, not current
status. The goal continues with the authorized post-deployment product audit.

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

Source `7825e60a7a3fce670c7c2a2b224fe3fc25ce2305` ran full CI
[37767854364](https://github.com/foolkking/chat-reader/actions/runs/37767854364).
API passes **1,181 / 3 skipped**, and all 13 Web gates pass again. Settings now
finishes **438 passed / 1 failed / 0 skipped**. All three offline-center cases,
including actual Cache Storage zeroing and subsequent cancellation/download,
pass. Image build/inspection remain skipped; production is unchanged.

The single new failure is the 768px real-import recovery case: Playwright found
`Retry loading`, then it detached before a stable click. The fixture had removed
its 503 interception first. `ImportTaskMonitor` invalidates the import's query
when the real background scan completes, so restored transport can remove that
button before the intended explicit retry. The follow-up leaves the outage active
until a delegated capture listener observes the real Playwright click; the listener
changes only the test transport gate, not application/query state. At least one
post-click real read and disappearance of the alert are required. Real import,
selection, source protection and unrelated-conversation assertions remain intact.
Noise-selection and navigation screenshots now default to the test output directory
when no custom directory is supplied. No application code changes in this follow-up.
Changed-file ESLint, nonincremental TypeScript and 30-case discovery across the
two touched test files pass; browser execution still depends on the full rerun.
The correction and documentation reconciliation are committed as
`30a0d321fe2d538b0fa0bbd61b3e982452f822cb`; full CI
[37773748374](https://github.com/foolkking/chat-reader/actions/runs/37773748374)
is running. Do not substitute a previous run's success for this source.
Its API job passes **1,181 / 3 skipped / 16 warnings** in 646.38 seconds,
with separate 64-case Bundle and 53-case cleanup checks. Its downloaded Web
evidence records **13 passing gates**, zero failed or unverified gates; the
default-PWA 588 conditional skips and one adaptive-import skip remain explicit.
Settings and the two image gates are still pending at this checkpoint. Intermittent
GitHub TLS-read timeouts are transport failures, not workflow failures.

The eight formerly pending offline scenarios have ten synthetic screenshots in
the `7987132` artifact; all ten were inspected at their actual three widths and
two locales/themes. First/unrelated-copy failures do not claim a retained copy;
retained-copy guidance, focus and the real completed-download entry are visible.
The eight selection scenarios have CI assertion evidence but no saved screenshots
in those earlier artifacts; the new fallback addresses future evidence only.

Release-helper preparation is still separate from deployment. Three shell helpers
pass syntax checks; host guards target Python 3.6. **25 local synthetic helper
tests pass, zero skipped**, covering framed/file digests, path/pointer safety,
complete helper checksum inventory, migration/backfill/admitted-work mismatch,
and authenticated read-only smoke rejection/logout. HTTP document checks are not
browser interaction acceptance. Snapshot SQL/file hashes run only after API/worker
writers stop; post-start checks use bounded counts and attachment sizes/bindings,
not another full live hash sweep. One-off checks have a 0.5 CPU/384 MiB memory bound.
The prepared artifact verifier checksums all seven transferred task helpers and
exact-source support files. No helper has performed a production release yet.
Seven further pure synthetic archive-verifier tests pass: exact blob/config/tag
and helper/support inventories, failed gates, wrong producer, corrupted blob,
archive traversal/duplicate members and nonmatching Git support. These tests do
not use Docker, network access or application-image builds. The CI identity
collector reads completed run/job/artifact metadata directly from GitHub and
refuses missing gates, mixed attempts or mismatched source identity.

Current documentation entry points were compressed while preserving all original
647 Project State lines in a dated archive with rebased links. Eight touched docs
have 142 valid local links. Old local-only checkpoints remain historical; no failed
run is reclassified as passed and no future production result is pre-written.

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

## Exact-source CI acceptance and transfer

The seventh full workflow, **37773748374 / 30a0d32 / attempt 1**, completes all
five jobs successfully. Settings passes **439 / 0 failed / 0 skipped** in
2,257.147 seconds; the separate fresh-PostgreSQL archive restore passes its one
case. API passes **1,181 / 3 skipped / 16 warnings** and all 13 Web gates pass.
The preceding failed runs remain failed; no consumer-only rerun mixed sources.

Original image artifact **11550757701** is uniquely named
`chat-reader-images-30a0d321fe2d538b0fa0bbd61b3e982452f822cb-1`.
Independent verification binds all five successful jobs, the original producer,
50 content-addressed blobs, two linux/amd64 configurations, four tags, three
built-in Skill ZIPs, 17 exact-source support files and seven task helpers.
Archive SHA-256: `2d5d0def797e27a9d015b43b566e613b25561fc96d1b5e10b3803029e0b50561`.
API/worker/migrate: `sha256:cf45bd516a599618b35fee21b9c501ca8b8d5e776043f718bdd818755c5d930a`.
Web: `sha256:13871dfaebaed5d585573f82a7253971a1a8700f030509baea47d67da444efcb`.

The first independent support-file check correctly refused Windows Git's CRLF
conversion of all 17 text files. Byte comparison proves these were newline-only
changes. The rejected export remains in the task directory. Command-local
`core.autocrlf=false` and `core.eol=lf` produce original commit bytes without
changing Git's global settings or weakening comparison. Checksum lists are emitted
as LF bytes. All **eight** verifier tests pass, including explicit CRLF rejection,
and the complete real-artifact verification passes afterward.

All 12 newly saved selection-state images were inspected at 375/768/1440 widths:
unknown acknowledgements and failed reads retain a visible recovery action and
disable writes/preview; confirmed reads restore the correct one/zero selection.
These images cover six of the eight new selection cases; unsent and timed-out
requests have passing CI assertions but no dedicated screenshot. Four additional
import retry/completion images were inspected, including the former 768px failure.
This remains isolated-CI evidence, not local specified-Windows-Chromium acceptance.

The private server release directory is being populated from the explicit
checksummed allowlist. No production application service, database data or
configuration has changed at this transfer checkpoint. Next: guarded preflight,
fresh consistent backup, migration and release acceptance.

## Pre-migration Compose compatibility interruption

Transfer checksums, preserved PostgreSQL/configuration identity, old rollback
images, idle worker, capacity and both existing backups passed. Capacity measured
13,783,120 KiB available against 4,330,323 KiB required. All four new tags loaded
with the exact verified image IDs.

The first stop-write attempt failed **before any snapshot, backup or migration**:
King runs Docker Compose **2.27.0**, whose `run` command has no `--pull` option.
The attempted snapshot created only an empty output file. The pre-migration
recovery then hit another Compose dependency check: `start api import-worker`
refused because its completed `migrate` dependency container was absent.

The agent verified no migration marker existed, PostgreSQL/configuration were
unchanged, and both stopped containers still used the exact b45f049 image.
It then started only those two existing containers through Docker. API, Web and
PostgreSQL health plus the idle worker heartbeat all passed afterward. No
database migration or restore occurred; the interruption is not an accepted release.

Helper revision 2 uses Compose-supported `pull_policy: never` in the task-only
resource overlay instead of the unsupported CLI flag. It validates Compose and
runs the mounted evidence helper's `--help` before stopping writers. Automatic
pre-migration recovery now verifies old image/source identities and directly
starts only the existing API/worker; it refuses any started migration. **29 guard
tests and eight archive-verifier tests pass**, alongside LF shell syntax and
Python-3.6 host syntax checks. The complete original artifact is independently
reverified with the new helper hashes. The first helper/proof set and empty
snapshot output are retained in the private server release evidence. CI images,
source support, production configuration and business data are unchanged.

## Successful guarded deployment and acceptance

Helper revision 2 passed the actual King's configuration validation and mounted
one-off `--help` before stopping writers. Its limits were verified as 0.5 CPU,
384 MiB RAM, 768 MiB memory+swap and `pull_policy: never`. The second attempt
completed the consistent five-component backup at
`/opt/chat-reader/backups/chat-reader-20261008T134403Z`, then migrated
0048→0049→0050 with the independently verified API image. PostgreSQL was neither
stopped nor restarted. Acceptance marker: **2026-10-08T13:52:31.352498Z**.

| Acceptance | Verified result |
| --- | --- |
| Exact-source CI jobs | api-quality 113299389766; settings-quality 113299389961; web-quality 113299390166; build-images 113315391780; inspect-release-artifact 113316496905; all successful |
| Migration data | All 84 pre-existing table fingerprints identical while writers stopped; all four protected storage roots byte-identical |
| Intended backfill | Exactly 36 source hashes; actual count/digest match independently computed pre-migration expectation |
| Attachments | 310 object/file hashes verified, 304 active attachments, zero issues |
| After restart | 67 stable table counts unchanged; bounded attachment binding/size checks pass; no repeated full live hash sweep |
| Runtime | Exact 30a0d32 API/Web/worker image IDs; API/Web healthy, worker alive_idle; zero new restarts, OOM kills or error-keyword log lines |
| Preserved environment | PostgreSQL container identity/start/restarts and configuration hashes unchanged; operational checkout, production environment, Compose and Nginx preserved |
| Public transport | HTTPS health 200; HTTP redirect 301 to expected HTTPS origin |
| Authenticated smoke | Login; 17 read-only API routes; three HTML document routes; three system Skill categories and three exact ZIP downloads; logout 204 and subsequent private request 401 |

Attachment policy remains scanner disabled, unscanned allowed, basic preview
enabled and complex preview disabled. Integrity verification is not a malware
safety claim. HTTP document checks are not interactive production-browser tests.
Only sanitized aggregate evidence was downloaded; backup contents, credentials,
cookies and production conversation content were not copied into the repository.

## Finalized rollback and retention

`/etc/chat-reader/release-state/current-images.env` now selects 30a0d32;
`rollback-images.env` selects b45f049. The exact rollback images are already loaded:
API `sha256:c13e9171ba1c40e838d59ecedf5adddbda88cce13fad5ad8761f23c9f6d6889a`;
Web `sha256:886cd8e97cb41bacffc2d6b056e120c97000d44749dceb7506a597f9a113f216`.
The obsolete 25c7f6a load notice is archived as
`older-rollback-requires-load.before.txt` in this release's private directory.
It is no longer an active instruction beside the new rollback pointer.

After acceptance, the existing two-backup policy retained
`chat-reader-20261006T141424Z` and `chat-reader-20261008T134403Z`, and removed
only the verified older `chat-reader-20261006T113958Z` point. The user was told
that this old time point is no longer separately retained. Pruning unlinked
244,003,030 bytes (about 232.7 MiB). Its temporary `held=1` was its own operation
lock; the final read-only report is **verified=2, held=0, candidates=0**.
Available space after finalization: **12,938,032 KiB (12.34 GiB)**.
No production volume, import, unrelated application or retained backup was deleted.

The accepted release directory is
`/opt/chat-reader/releases/30a0d321fe2d538b0fa0bbd61b3e982452f822cb`.
It retains helper revision 2 and the rejected first helper/proof set separately.
Do not replay completed deployment/finalization/pruning, and do not reuse these
b45f049→30a0d32 task guards unchanged for another release. The subsequent
ordinary-user audit begins from this accepted source, with findings recorded
before application edits and no production browser testing.
