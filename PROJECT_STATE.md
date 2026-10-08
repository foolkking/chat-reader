# Project State

## Current release — 2026-10-06

Production `https://chat.king.2bd.net` runs application source
**b45f04939a728c86bbff769c36ea7574d6a1856d**, built only by successful
[CI 37470769275](https://github.com/foolkking/chat-reader/actions/runs/37470769275).
All five gates passed. Original artifact **11419041245**, producer attempt **1**,
was independently verified, including 50 image archive blobs/configs and 17 exact-source
support paths. Alembic remains **20261006_0048**, single head/current.
[Stage and release evidence](docs/execution/CONTEXT_EXPORT_INTEGRITY_2026-10-06.md)
records the reproduced defects, tests, release, reviewed interruptions and limitations.
The documentation closeout is a separate commit.

Context export now verifies copied attachment bytes, removes failed staging/results,
streams message bodies and JSONL, respects selected-range limits, and rejects source
or access changes during publication. Permanent exports read one PostgreSQL snapshot;
final live checks and transaction-owned file cleanup protect delivery. Progress no
longer drops from serialization to packaging, and actionable failures are localized.
Missing objects remain explicitly partial; saved Current/Index are still user-managed
files without semantic validation, candidates or adoption.

Production checks passed for login/settings, all three default Skill ZIPs, direct
exports, batch exports, three attachment/Context formats with **148 object checksum
checks**, Range/ZIP delivery, regeneration and physical close reclamation. Canonical
counts, personal Skill state, **301 stored attachment checksums**, imports/offline
fingerprints and private Context tables remained unchanged. The private Context
snapshot was empty; nonempty member preservation is covered by CI. PostgreSQL
identity/start time, environment, Compose and Nginx were preserved. API/Web are healthy
and worker heartbeat is alive/idle.

Latest verified backups: `chat-reader-20261006T113958Z` and
`chat-reader-20261006T141424Z`. After acceptance, one older backup and four replaced
**25c7f6a** image tags were removed. The verified 25c7f6a rollback archive remains;
load it before rollback. Final available server space: **15,477,846,016 bytes
(14.41 GiB)**. No local/server image builds, local cleanup, off-site copy or scheduled
backups. One malformed Server Action reference was rejected with 404 and reviewed;
no unreviewed startup error, restart or OOM remained at acceptance.

The preceding [Task Center release](docs/execution/TASK_CENTER_CLARITY_2026-10-06.md),
attachment bundle consistency and Root-controlled three-minute artifact lifetime
remain in effect. This stage introduces no schema or package-format migration.

## Active work

The user explicitly authorized committing the accumulated work, running full CI,
deploying verified images, and then continuing the broader product audit. The
original goal was recovered into the new task and remains active. The
[release record](docs/execution/OPTIMIZATION_RELEASE_2026-10-08.md) owns current
commit/CI/deployment progress; older no-release statements below are historical.

One original-command Web-start attempt in this task again returned only
`blocked by policy` before process creation. Its origin remains unidentified;
no alternate local launcher was used. Current lint, nonincremental typecheck,
bounded Web build, single head 0050 and **33 offline/task API tests** pass.
Settings discovery finds **439 cases**, including all 16 pending cases. They will
run in the existing isolated release CI; no local browser pass is claimed.
Production is still b45f049/0048 and healthy. Server operational modifications,
environment, PostgreSQL and business data must be preserved during release.

Accumulated source `a31a1f8` is committed and pushed. Its first CI passed the full
API gate (**1,181 passed / 3 skipped**) but the Web dependency audit found newly
published Next/sharp high advisories. The follow-up pins Next **16.3.8** and sharp
**0.35.5** without weakening audit policy. Its local build, nine dependency
regressions and official-registry audit policy pass; complete exact-source CI and
deployment remain pending. Do not deploy the first run's failed source.

### Preserved local checkpoints before release preparation

Testing remains **local only**, using the user's specified Chromium
**151.0.7922.34**. Its [launch preflight](docs/execution/specified-chromium-preflight-2026-10-08.md)
passed on `about:blank`; **16 focused browser cases are discoverable but unexecuted**.
All four fixture ports remain idle. The existing isolated database is at 0050;
the prepared supervisor's guarded reuse path has not run. Preserve it and the
task-local browser configuration for resumption. Three historical real-pair
fixture tests and one Windows symlink case also remain unavailable. Earlier
[blocked checkpoints](docs/execution/local-browser-acceptance-block-2026-10-08.md)
are historical; neither substitute fixtures nor browser launch count as acceptance.

[Task Center offline recovery](docs/execution/offline-task-recovery-2026-10-08.md)
now opens the existing Offline & sync panel instead of retrying only server
generation. It locates the matching device record/page; without a local record,
the user can explicitly download the owned source to this device. Nullable task
target metadata is navigation only; admission rechecks ownership. **33 focused API
tests passed, zero skipped**, including real failed-worker recovery, ZIP bytes,
idempotency and cross-owner rejection. Web lint, nonincremental typecheck, bounded
build and the single head 0050 check passed. The two Task Center browser cases now
target actual admission/download/IndexedDB persistence; all 16 focused browser
cases remain **unexecuted**. No new migration, commit, CI or deployment.

[Offline failure guidance](docs/execution/offline-error-guidance-2026-10-08.md) now
preserves recognized attachment failure categories through download persistence
and manual rebuild decisions, with shared localized Offline/Task Center messages.
The follow-up fixes a false retained-copy claim for first downloads and unrelated
local copies, using indexed checks for the displayed failure page. Eight offline
browser cases now cover retained/first/unrelated copies and Task Center recovery;
their task response binding uses the actual `job_id` contract. Five prior backend
cases passed. Current Web lint, nonincremental typecheck and bounded build pass;
browser persistence/retry/layout acceptance remains pending alongside eight noise
selection cases. No commit or deployment.

The [API integration gate](docs/execution/api-integration-2026-10-08.md) after batch
31 completed with exit 0: **1,020 passed, 153 skipped, no failures/errors**, 4
warnings. Of the skips, 148 require dedicated PostgreSQL; the remaining five
require symlink capability, external fixtures or the expected database head.
The [PostgreSQL integration gate](docs/execution/postgres-integration-2026-10-08.md)
now covers 149 of those skips with passing evidence: first run 148 passed/1 test
setup failure; corrected migration setup rerun 2 passed (one overlapping case).
Zero PostgreSQL skips. Four external-fixture/symlink cases and browser acceptance
remain outstanding. The disposable database is removed and cluster stopped. Test session
57116 is finished; do not restart it. The interrupted first run's misplaced task
directory remains after an automatic cleanup rejection. No commit/CI/deployment.

The thirty-first [offline attachment repair](docs/execution/offline-asset-integrity-2026-10-08.md)
prevents corrupted asset bytes from publishing a successful offline package and
replacing the previous download. Bounded copying verifies actual size/hash and
checks cancellation between chunks. 17 distinct tests pass (16 integration plus
one chunk-cancellation case), zero skips; damaged/missing files preserve the old
package and repaired files can be downloaded again. No migration or deployment;
browser acceptance remains pending.

The thirtieth [offline snapshot repair](docs/execution/offline-snapshot-consistency-2026-10-08.md)
reproduced mixed old-revision/new-body offline ZIPs during concurrent source edits.
Packaging now reuses the PostgreSQL read-only repeatable snapshot, separate from
worker progress/artifact writes. 19 API and 5 PostgreSQL tests pass, zero skipped,
including actual ZIP body/search/revision checks and progress-session commits.
No protocol or migration changes; browser acceptance pending, no commit/deployment.

The twenty-ninth [offline revision repair](docs/execution/offline-revision-concurrency-2026-10-08.md)
reproduced and fixed stale-session lost increments across all current increment
sites. Deferred database expressions preserve transaction boundaries and rollback.
Concurrent edit testing also exposed a message-lock/search-FK deadlock; source and
cleanup locks now use NO KEY UPDATE while retaining source conflict protection.
49 API and 12 PostgreSQL tests pass, zero skips; a supplemental concurrent search
check passes. No migration, commit, CI or deployment; browser acceptance remains
pending and the broader optimization goal remains active.

The twenty-eighth [cleanup validation-work batch](docs/execution/cleanup-validation-work-2026-10-08.md)
reduces repeated same-source detection. The 128-candidate synthetic preview now
uses one detector call instead of 128; measured preview time fell from 975 ms to
42 ms, apply from 1052 ms to 154 ms. These are local samples, not production
guarantees. **85 distinct API and 11 PostgreSQL cases passed, zero skipped**,
including source/cross-rule isolation and the preceding concurrency protection.
No new migration; local head remains 0050. Browser acceptance is still pending;
test services are observed stopped. All changes remain uncommitted, with no CI,
deployment or production change. The wider optimization goal remains active.

The twenty-seventh [cleanup source-safety batch](docs/execution/cleanup-source-safety-2026-10-08.md)
has reproduced and fixed same-ID replacement consent reuse and a PostgreSQL
edit/cleanup overwrite race. Candidates bind exact source fingerprints; version
writes recheck the current source under a lock. Local single head is now
**20261008_0050**, following 0049; unchanged legacy candidates are backfilled,
unknown sources require rescanning. **84 API-related and 11 PostgreSQL cases pass,
zero skipped**; intermediate migration/initial-creation failures remain recorded.
Browser acceptance remains pending alongside batch 26. No commit, CI, deployment
or production change. Do not treat earlier 0049 verification as current head.

The twenty-sixth [selection-response recovery batch](docs/execution/ux-audit-noise-selection-recovery-2026-10-08.md)
is in progress. Unconfirmed individual/bulk choices now pause further changes and
offer an explicit read of saved selections, including selected-only page recovery.
Eight browser cases were added; acceptance remains pending because automatic
approval rejected starting the loopback Web test server. Do not count those cases
as passed. No migration, commit, CI or deployment is part of this batch.

The twenty-fifth [noise scan lifecycle batch](docs/execution/ux-audit-noise-scan-lifecycle-2026-10-08.md)
is complete locally. Import/global scans show actual queued, running, cancelled
and failed states; cancellation preserves imported content, and guarded worker
publication cannot revive cancelled work. Task Center grouping and focus recovery
follow the real outcome. **55 authenticated browser / 79 distinct API / 9 actual
PostgreSQL cases passed, 0 skipped**; the final browser gates contain 26, 18 and
11 cases, with a separate successful focused reproduction. All 79 final synthetic
screenshots were reviewed. Lint, nonincremental TypeScript, bounded Web build,
diff and single local Alembic head 0049 passed. Baseline failures, fixture errors,
the reproduced mobile focus race and disk interruptions remain separately recorded.
The final task-delivery gate did not reproduce earlier stream-close diagnostics.
Isolated services are stopped; all 25 batches remain uncommitted, without CI,
deployment or a new migration. Production remains 0048. The wider goal is active.

The twenty-fourth [noise-result/dismissal batch](docs/execution/ux-audit-noise-dismissal-2026-10-07.md)
is complete locally on October 8. Import and recent Completed tasks now expose
compact zero-result reviews without attention reminders. Ending a review has
atomic, owner-scoped recovery, preserves canonical content, and removes orphan
failed tasks. Row-owned recovery and keyboard restoration passed **59 authenticated
browser / 31 API / 7 PostgreSQL checks, 0 skipped**. Fifteen intermediate and
89 final synthetic screenshots were reviewed. Lint, nonincremental TypeScript,
bounded-memory Web build, diff and single local Alembic head 0049 passed.
Baseline defects, initial focus failures and the mistaken browser auth setting
are recorded separately; corrected final regression passed. An earlier stream-
close diagnostic did not recur. Test services stopped; all 24 batches remain
uncommitted, with no CI/deployment or new migration. Production remains 0048.
The wider optimization goal remains active; this is a completed bounded batch.

The twenty-third [noise-rescan batch](docs/execution/ux-audit-rescan-recovery-2026-10-07.md)
is complete locally. Import/global rescans preserve earlier choices, provide
previous/newer navigation, and recover lost responses without duplicate jobs.
Completion preserves admission identity. A browser-reproduced stale-cache defect
was fixed; missing earlier reviews retain a working return route. **35 browser,
24 API and 5 PostgreSQL checks passed / 0 skipped**. Final 53 and intermediate
19 synthetic screenshots were reviewed. Lint, nonincremental TypeScript, bounded-
memory Web build and single Alembic head passed. New local head **20261007_0049**
adds only a request lookup index; actual upgrade/downgrade/model checks pass.
Disk exhaustion, rejected cleanup, test-path mistakes, OOM builds and the first
browser failure are recorded separately. Services stopped; 23 local batches remain
uncommitted with no CI/deployment. Production above remains 0048. The wider goal
continues; empty-result dismissal recovery is the next source-backed candidate.

The twenty-second [system noise-publication batch](docs/execution/ux-audit-rule-publication-2026-10-07.md)
is complete locally. Publishing/withdrawal acknowledge before refresh; unknown
responses get read-only checks and stale windows compare retained choices before
confirming again. Fresh locked publication bases protect name/version/withdrawal;
personal grants and admitted scans remain intact. History refreshes alongside
state checks and uses readable match labels. **35 distinct browser, 27 API and
7 PostgreSQL cases have passing evidence / 0 skipped**; after the final history
change, all 24 affected publication browser cases passed again. Baseline defects,
auth-fixture/test-expectation failures and the intermediate status-locator failures
are recorded separately. Ninety-eight synthetic images were reviewed. Lint,
nonincremental TypeScript, ordinary build, diff and single Alembic head pass.
No migration; new Web sends the base, while legacy callers may omit it. Owned
services are stopped. Twenty-two batches remain uncommitted, with no CI/deployment;
the wider optimization goal continues with evidence before further changes.

The twenty-first [personal rule-edit batch](docs/execution/ux-audit-rule-edit-concurrency-2026-10-07.md)
is complete locally. Name-only edits now carry an account-scoped base token through
trial, confirmation and explicit draft comparison, even when matcher revision is
unchanged. Locked writes refresh cached preferences; editing preserves a disabled
switch. Both name overwrite and unintended reenablement were reproduced before
fixing. **51 browser, 18 API and 8 PostgreSQL checks passed / 0 skipped**, with one
additional learning-case rerun. Sixty synthetic images were reviewed. Two transient
Web proxy resets on unrelated list reads were recorded: API recorded no 5xx in
2,301 requests inspected, services stayed alive, and the targeted rerun passed
without a reset; their original cause remains unproven. Final lint, nonincremental
TypeScript, ordinary build, diff and single head passed. No migration; old direct
PATCH may omit the base, while new Web always sends it. Services are stopped;
twenty-one batches remained uncommitted at that checkpoint, no CI/deployment.
The subsequent publication batch above resolves its follow-up investigation.

The twentieth [noise-selection scope batch](docs/execution/ux-audit-noise-selection-scope-2026-10-07.md)
is complete locally. Import/global review now discloses selections in other groups
beside preview, with a keyboard-accessible all-selected view. Scope counts cover
all pages; failed/pending reads omit exact counts. Group rows show nonzero
protected/conflict counts. **45 browser, 40 API and 6 PostgreSQL checks passed,
zero skipped**, including actual source changes and protected-text preservation.
The first browser run's three test-navigation failures and two unrun cases are
retained separately; the corrected final gate is green. Seventy-three synthetic
images were reviewed via seven contact sheets and key full-size views. Final
lint, nonincremental TypeScript, ordinary build, diff and single head passed.
The API addition is read-only metadata, with no migration. Services are stopped;
twenty batches remain uncommitted, with no CI/deployment. Name-only rule editing
and administrator publication recovery remain outside this completed scope.

The nineteenth [personal rule-action recovery batch](docs/execution/ux-audit-rule-actions-2026-10-07.md)
is complete locally. Enablement/version changes acknowledge actual responses
before list refresh; removal updates the list and restores focus in visible order.
Lost responses offer read-only current-state checks, not automatic repeated writes.
Reopened history refreshes; failed reads retain text but disable stale choices.
Role/match/boundary labels are localized and long matches remain readable.
**78 browser, 11 API and 6 PostgreSQL checks passed / 0 skipped**, including a real
scan cycle proving old reviews/source are unchanged after selection, disablement
and removal. Two baseline and 96 final synthetic images were reviewed; three
browser reports and one API/PG summary retain expected failures, the history-cache
failure and a corrected TypeScript/OOM preparation failure. Final lint,
nonincremental TypeScript, ordinary build, diff and single head passed. No schema
or backend behavior change; owned services are stopped. Nineteen batches remain
uncommitted, with no CI/deployment. Name-only edit concurrency and administrator
publication recovery still need separate evidence before completion claims.

The eighteenth [global-scan recovery batch](docs/execution/ux-audit-global-scan-recovery-2026-10-07.md)
is complete locally. Global scans acknowledge immediately beside their command;
lost responses survive reload and use read-only checks and same-request retry.
Task Center navigation preserves modal focus, and disabled-rule errors refresh
the actual personal rule state. Fresh explicit scans reevaluate exceptions while
same-key retries retain the original task. **67 browser, 9 API and 5 PostgreSQL
checks passed**, with zero skips; two additional one-case browser reruns also
passed. Seven browser summaries, one API/PG summary, one baseline and 74 reviewed
final synthetic images retain evidence, including the initial 53/56 focus failure,
an interrupted disk-reserve environment run and a reviewed stream-close diagnostic.
Lint, nonincremental TypeScript, ordinary build, diff and single head passed.
No migration; owned services are stopped. Personal rule switch/version/removal
recovery remains the next scoped batch. Eighteen batches remain uncommitted;
no CI, deployment or production change.

The seventeenth [noise-exception recovery batch](docs/execution/ux-audit-exception-recovery-2026-10-07.md)
is complete locally. Confirmed exceptions immediately keep the candidate and
update counts; lost responses get read-only scope/state checks. Failed scope
refresh cannot confirm stale data. Revocations acknowledge before list refresh,
recover shrinking pages and support safe retry. Review context survives editor
return; scope details are compact and keyboard readable. A caught rule-return
focus failure now restores focus after the list commits.
**60 distinct browser, 39 API and 6 PostgreSQL checks have passing evidence**:
the 60-case browser run had 59 passes/1 focus failure; the final affected 35-case
rerun passed with zero skips. It is not a single green 60-case gate. Seven browser
summaries, one API/PG summary, 2 baseline and 72 reviewed final synthetic images
retain evidence and preparation failures. Final lint, nonincremental TypeScript,
ordinary Web build, diff and single head passed. No migration; owned services are
stopped. Seventeen batches remain uncommitted, with no CI/deployment.

The sixteenth [rule-learning recovery batch](docs/execution/ux-audit-rule-learning-recovery-2026-10-07.md)
is complete locally. Confirmed rule saves update the cached row and leave the
editor before background refresh. Lost responses keep the draft for a read-only
result check; differences require a new trial and confirmation. Comparison uses
fresh localized server/draft fields, never an actionable stale snapshot. Mobile
fields compare side by side; base adoption and editor return restore focus.
**49 browser, 11 API and 6 PostgreSQL checks passed / 0 skipped**. Four browser
summaries, an API/PG summary, 2 baseline and 57 reviewed final images retain
evidence. Initial textarea-label, shared-identity revision assumptions and API
authentication-environment failures are recorded separately. Final lint,
nonincremental TypeScript, ordinary build, diff and single head passed. No schema
or server behavior change; owned services are stopped. Sixteen local batches
remain uncommitted; no CI, deployment or production changes.

The fifteenth [noise-difference batch](docs/execution/ux-audit-noise-diff-2026-10-07.md)
is complete locally. Full-message previews mark the exact selected removals and
provide previous/next positioning in both text panes. Unicode offsets are checked
against the complete after text; missing, malformed or inconsistent metadata falls
back to plain text. Conflicts retain the existing source and apply guards. Mobile
panes keep before/after close together; preview construction joins retained slices
once. **40 API, 6 PostgreSQL and 43 distinct browser cases passed / 0 skipped**.
The browser evidence is a 42-case regression pass followed by an eight-case final
diff pass (seven reruns plus one new malformed-metadata case), not 50 cases.
One expected baseline failure, four gate summaries, an API/PG summary and
1 baseline/64 final reviewed synthetic images are retained. Final lint,
nonincremental TypeScript, ordinary build, diff and single head passed. Owned
services are stopped; fifteen batches remain uncommitted, no CI or deployment.

The fourteenth [import/global noise-navigation batch](docs/execution/ux-audit-noise-navigation-2026-10-07.md)
is complete locally. Import completion opens its own latest scan; read failures
retry without reimporting, and rescans retain the import binding and return focus.
Group title search covers all pages without changing selections. Detail names the
current scope and offers all rules for one conversation. Preview returns to the
same page, expanded contexts, scroll and focus. Default KEEP/protected-source,
archived exclusions, canonical versions and single-worker behavior remain.
**70 API-suite, 6 PostgreSQL and 44 distinct browser checks passed**, with 3 baseline
and 65 reviewed final screenshots. Final browser evidence is 43 passes plus one
corrected fresh-global-scan fixture pass; it is not a single green 44-case gate.
The earlier one-case environment skip was subsequently exercised. Initial proxy
build configuration, sidebar locator/breakpoint, queued-dismissal fixture and
rescan focus failures are preserved in the audit. Lint, nonincremental TypeScript,
ordinary Web build, diff and single head passed. Owned services are stopped;
fourteen batches remain uncommitted, with no CI or release action.

The thirteenth [registration-policy recovery batch](docs/execution/ux-audit-registration-recovery-2026-10-07.md)
is complete locally. Changed-field writes and a fresh locked revision check prevent
old forms removing new approval requirements. Conflict/unknown-result recovery
preserves registration and invitation drafts; reads and writes are bounded.
Remote language changes keep drafts, and unavailable SMTP does not block unrelated
edits to an already configured policy. Success audit and policy commit together.
**62 distinct API, 3 PostgreSQL and 22 Playwright checks passed**, zero skips.
The latter are 19 integration flows, 2 UI mocks and 1 source-contract check.
Initial default-mode assumptions, a nonexistent test-file command, an incorrect
exception expectation and missing mock server-session setup are recorded in the
audit. Corrected API checks were rerun as a seven-case suite, not a claimed single
62-case green gate. Two baseline/19 reviewed final images and all gate summaries
are retained. Final lint, nonincremental TypeScript, ordinary build, diff and
single head passed. Services are stopped; no migration or release action.

The twelfth local [feature-policy recovery batch](docs/execution/ux-audit-feature-policy-recovery-2026-10-07.md)
is complete. Stale administrator forms use partial writes and a locked
base-revision check; conflicts and unconfirmed saves retain input and can
read/compare current policy. Identical current values resolve without another
write. Recovery has a 20-second bound, and comparison/Save stay together in view.
**58 API, 3 PostgreSQL and 40 distinct browser-gate cases passed / 0 skipped**
(39 browser flows plus one diagnostic serializer case). The final 11 feature
cases were rerun after the last action-row refinement; other regression paths
did not change. Four browser gate summaries, an API/PG summary, two baseline and
46 reviewed final synthetic screenshots retain evidence. Initial SQLite timestamp
assertion failures and an unattributed proxy ECONNRESET are recorded separately.
Final lint, nonincremental TypeScript, ordinary build and single head passed.
Owned services are stopped; no schema, full API/PWA, external Skill or release pass
is inferred. The thirteenth batch above subsequently reproduced and resolved the
registration-policy concurrency hypothesis.

2026-10-07 worktree: twenty-three completed local batches remain uncommitted. Batch
improvements and verification; do not commit, push, trigger CI or deploy after each
finding. Release waits for a new explicit user request. HEAD remains 975c1ee and
production above is unchanged; the pre-existing tsbuildinfo remains unstaged.

[Offline recovery audit](docs/execution/ux-audit-offline-recovery-2026-10-06.md):
disconnected cancellation and durable server receipts, retained failure feedback,
damaged-package rebuild, shrinking pagination, resource refresh, desktop reopening
and focus. Completed copies expose only meaningful cancellation recovery. New
recovery **6**, authentication **18**, related sync/reading **20** distinct cases,
PostgreSQL admission **1**, baseline PWA **135 passed / 329 conditional skips**, and
negative PWA **17 passed** have evidence. Initial disk-full, rotated test-password,
throttle and locator failures are preserved in the audit. The baseline precedes
only the final completed-row button condition; the recovery/negative gates cover it.

[Share recovery audit](docs/execution/ux-audit-share-recovery-2026-10-07.md):
owner-only latest settings reads and an optional settings revision checked under a
fresh row lock prevent stale saves. Visitor reads do not change that revision.
The editor submits only changed fields, retains drafts on conflict, compares current
server settings, and supports explicit discard or merge followed by Save. Revocation
cannot be undone through merging. Policy errors now refresh capabilities and have
accurate recovery copy. Retrying one batch failure preserves the others; filtered
lists return to a valid page after revocation. No Share URL/token or migration change.

Share API **19 passed**, including **2** actual PostgreSQL concurrency tests;
**11** settings and **2** drawer browser cases have passing evidence. Three widths,
Chinese/light and English/dark, conflict focus, failed latest read, same-field
comparison, draft discard, remote revocation, policy changes and actual persisted
capabilities are covered. Initial fixtures lacked paired messages; a later test
misidentified the More-menu revoke action. Both failed runs and corrected reruns
are recorded, not hidden. Two initially gated drawer tests passed separately on
their proper anonymous fixture. No new whole-site/API/PWA or external Skill pass
is inferred. Full lint, nonincremental TypeScript, final ordinary Web build and
diff checks passed; declared migration remains single head **20261006_0048**.

[Archive recovery audit](docs/execution/ux-audit-archive-recovery-2026-10-07.md):
reproduced an old history snapshot hiding a real failed preflight. Personal and
system panels now reconcile server execution times, acknowledge cancel/retry
without waiting for history, bound metadata/actions to 20 seconds, and distinguish
read failure from an empty history. Preflight detail reports current upload
availability. No archive serialization, restore rule or migration change.
**29 API + 8 PostgreSQL** checks and **15 distinct browser cases** passed, including
actual personal roundtrips and system ownership review. Initial build/lint issues
were corrected and recorded. Final build, lint, nonincremental TypeScript and
single migration head passed. All six recovery screenshots were inspected.
Damaged-input replacement is covered by the later local batch below.

[Support navigation audit](docs/execution/ux-audit-support-navigation-2026-10-07.md):
same-query/account snapshots survive refresh, return restores the actual row,
filtered last pages recover after resolution, and failed reply pagination retains
the correct page label. Inaccessible reads discard old details; delayed query
responses cannot replace another filter. Refresh errors appear beside the action.
**21 browser checks passed** (11 new, 7 support, 3 contextual), with 15 inspected
three-width screenshots. Initial product/focus failures, a test-label mismatch,
and the offscreen error reproduction are preserved. Final lint, nonincremental
TypeScript, ordinary build and single migration head passed. No backend business
or schema change; this is not a new full API/PWA or production verification.

[Archive replacement audit](docs/execution/ux-audit-archive-replacement-2026-10-07.md):
known invalid uploads offer a fresh file selection, expired previews offer reupload,
and unknown failures retain retry. Keyboard focus enters the cleared file input;
opening replacement preserves the original task/upload. Failed/cancelled archive
tasks can reopen their settings panel; stale failed results cannot deliver old files.
**26 browser cases passed / 0 skipped** across replacement, earlier recovery,
personal/system archives and Task Center. All 15 screenshots were inspected.
Real worker preflight and PostgreSQL personal additive restore were checked;
expiry/runtime faults are explicitly seeded. Initial locator, fixture-count and
Web-auth startup failures are preserved; one mobile click timeout did not recur.
An ECONNRESET during the offline/teardown sequence remains unattributed, not fixed.
Final lint, ordinary build, nonincremental TypeScript, diff checks and single head
passed. No new full API/PWA, empty-instance system restore or production pass is
inferred; this batch changes frontend recovery, not backend or archive format.

The user cleared C and explicitly kept tests there. The earlier navigation batch used
`wkkk/chat-reader-noise-navigation-20261007` and reuses the independent fixture in
`wkkk/chat-reader-offline-recovery-20261006`: PostgreSQL 17 loopback 65438, API 8008,
one worker. Authenticated tests and the separate `offline_pwa` database run in
sequence. All owned services are stopped. Resume the cluster, never re-initdb;
existing development PostgreSQL and local residues remain untouched. No E-drive
exception, Docker build, production change or local cleanup occurred.

[Admin account recovery audit](docs/execution/ux-audit-admin-account-recovery-2026-10-07.md):
status/approval responses preserve id/status and add the authoritative account
snapshot after commit. Actions acknowledge it without waiting for metadata reads;
stale requests are cancelled. Filtered last pages recover their valid offset and
row focus. Temporary read failure pauses new writes; unavailable accounts remove
old details/reset links. A lost confirmed deletion can reattach its original task
after the account is gone, including a failed check and retry with the same key.
**51 distinct API cases, 4 PostgreSQL concurrency/deletion cases and 14 browser
cases passed**; 12 final synthetic screenshots were inspected. Initial SQLite
timezone expectations, missing synthetic test-secret configuration, navigation
readiness and network-injection timing failures are recorded separately. Final
lint, ordinary build, nonincremental TypeScript and single migration head passed.
No new full API/PWA, external Skill or production verification is inferred.

[Noise-review recovery audit](docs/execution/ux-audit-cleanup-recovery-2026-10-07.md):
confirmed selection counts update before metadata refresh; filtered bulk responses
add the committed scan snapshot. Selected-only last pages recover their valid page
and candidate focus, and small-screen return restores the group control. Failed
preview reads keep explicitly labelled old differences but block confirmation;
refresh rechecks source conflicts. Failed candidate reads label the old list and
pause editing/learning while retaining retry and fresh preview. No detector,
apply, canonical data or migration change. **69 API, 6 PostgreSQL, 18 browser
cases passed**, with all 17 final screenshots inspected. Initial reproduced
product defects, fixture trailing-newline assumptions and consequent synthetic
login throttling are preserved. Final lint, nonincremental TypeScript and ordinary
Web build passed; single head remains 20261006_0048. Services are stopped.
No new full API/PWA or production pass is inferred. The subsequent eighth batch
below addresses lost apply results, source refresh and conflict-only previews.

[Cleanup completion audit](docs/execution/ux-audit-cleanup-completion-2026-10-07.md):
owner-scoped outcomes and completed POST replay reuse the original scan task.
The final conversation, applied markers and completion receipt commit atomically;
earlier conversation checkpoints remain resumable. Source reload failure is
separate from confirmed cleanup and retries only reads. Completed tasks reopen
their result within the ordinary terminal window. Known all-conflict previews
disable confirmation; mobile source editing closes the old action sheet so first
selection keeps focus. No new schema, notification or permanent task history UI.
**101 API, 8 PostgreSQL and 35 browser cases passed**, including actual canonical
Reader/Share/search/TOC/offline consistency, rollback, replay and owner isolation.
Five gate summaries, two baseline and 35 final synthetic screenshots are retained;
new result/conflict screens were individually checked and all final screens
reviewed in contact sheets. Wrong fixture entry points, the real mobile focus
failure and two missing-database fixture failures are recorded separately. The
latter failed at the first SELECT without writes; a new guard prevents fallback
to local database configuration. Lint, nonincremental TypeScript, ordinary Web
build, diff check and single migration head passed. No new full API/PWA or
production pass is inferred. That eighth batch remains uncommitted; the ninth
batch below addresses dense candidates and oversized completion surfaces.

[Cleanup layout audit](docs/execution/ux-audit-cleanup-layout-2026-10-07.md):
candidate rows lead with exact highlights, compact context, reason and source;
full context and rule actions expand explicitly. Mixed scans retain visible
conversation identity, and saved selection refresh preserves expanded details.
Confirmed results use compact content height, hide old selection/scan/rule controls
and receive focus. Previews omit stale selection feedback and duplicate errors.
The missing highlight token was replaced with existing light/dark mark colors.

**33 browser cases passed / 0 skipped**, covering actual selection, cleanup,
recovery, rule learning and version changes at three widths, both locales/themes,
keyboard operation and 360px-high result screens. Three gate summaries, four
baseline and 45 final synthetic screenshots are retained and reviewed. The
baseline's failed long editor measurement is recorded without inventing another
product defect. Final lint, nonincremental TypeScript, ordinary Web build, diff
check and single migration head passed. No backend/schema change or new full
API/PostgreSQL/PWA, external Skill or production acceptance is claimed.

[Account security recovery audit](docs/execution/ux-audit-account-security-recovery-2026-10-07.md):
identity/device reads fail independently; Refresh preserves username/password
drafts and focus. Saves preserve newer input, and obsolete reads cannot overwrite
the saved baseline. Confirmed logout-others survives a failed following read;
unconfirmed responses require a fresh list before another revoke. Current-device,
email/password and offline-signout behavior remain intact; no backend/schema change.
**25 browser cases passed / 0 skipped**, including 13 new recovery cases and 12
email/pending-signout/cleanup regressions. Four gate summaries, three valid baseline
and 31 final synthetic screenshots retain the evidence and initial device-label
fixture failure. All final screens were reviewed. Lint, nonincremental TypeScript,
ordinary build, diff check and single migration head passed. No new whole-site
API/PWA, migration, external Skill or production verification is inferred.

[Skill replacement recovery audit](docs/execution/ux-audit-skill-replacement-recovery-2026-10-07.md):
confirmed replacements update file metadata/downloads before independent list
refresh; resolved content is reset without changing personal selection. Conflicts
retain the file, offer current-version download and require explicit replacement.
Another update conflicts again, and restored built-ins at revision 0 remain usable.
Lost responses retry through existing digest idempotency. **23 browser / 34 API
checks passed, zero skipped**; six browser summaries, one API summary, four baseline
and 30 reviewed final screenshots retain all evidence. Incorrect system-label and
resumed-import fixture assumptions, plus the first revision-0 implementation gap,
are recorded separately. Final lint, nonincremental TypeScript, ordinary build,
diff check and single migration head passed. Default ZIPs and backend/schema did
not change. No full API/PWA, independent migration, external Skill or production
acceptance is claimed. All eleven batches remain uncommitted; owned services are
stopped and residues retained.

The Context export stage is deployed and accepted. Do not repeat its backup,
deployment or cleanup. The broad optimization goal remains active; the next stage
must begin with a fresh product/runtime audit and prioritize demonstrated user value.
This scoped stage does not close every page, offline UX or external semantic Skill
review. The unrelated earlier Next stream-close observation remains unproven and
is not claimed fixed. Off-site copies remain deferred.

## System and boundaries

- Next.js 16 / React 19 / TypeScript Web; FastAPI / SQLAlchemy API; PostgreSQL;
  one concurrent background worker. Corepack + pnpm 9.15.4, Python 3.11+.
- Browser requests use same-origin `/api/*`. `API_INTERNAL_URL` supplies Next
  rewrites at build time as well as runtime; local test builds must use their
  isolated API address. Production uses prebuilt, CI-gated images.
- Canonical PostgreSQL data, current code and Alembic are the authority. Raw
  import files and Continuation are not a second source of rendered truth.
- Projects/Unclassified → Conversation → Reader. Owner, public Share and Offline
  Reader retain separate access boundaries, complete turns and real DOM anchors.
- `/library` uses Dexie version 2 and offline package v3, retaining v1/v2/v3 reads
  and existing local data. Failed replacement preserves the last readable copy.
- Server-authenticated UUID scopes private rows, tasks and downloads. The single
  deployment-managed Root Admin has audited cross-account tools; normal accounts
  cannot inherit identity from a client-supplied ID. Share URLs remain separate
  token-scoped capabilities with their existing password/expiry semantics.
- Authorization expiry locks protected local data. The same server-verified UUID
  can resume it; another account cannot read or claim it. Signout and destructive
  cleanup account for pending edits and durable Continuation drafts.

## Current product decisions

| Area | Current behavior |
|---|---|
| Context files | The conversation workspace beside annotations reads/edits/drops Current and Index; updates save directly, preserving the other member and the latest three snapshots. No semantic validation, candidate or adoption UI. |
| Context return | A `.context.zip` belongs to that conversation workspace, separate from ordinary import. Returns extract members without changing Raw or attachments. No global Context page. |
| Context delivery | Always `.context.zip`, independent of attachment inclusion. Full export may include saved files without endorsing their claims; restricted scope excludes private Continuation. Share excludes it. |
| Skills | Personal/system upload and replacement accept ZIP or Markdown; Markdown becomes a same-name compatibility ZIP without rewriting instructions. No Skill viewer/editor/history UI; personal choices survive system updates. |
| System defaults | Only the user-supplied Acquisition, Maintainer and Normalizer ZIPs, unchanged bytes. External reviewed runtime Bundles are separate deliverables, not defaults. |
| External maintenance | No model calls or execution of uploaded scripts. Reviewed tooling supports OLD continuation + NEW Raw comparison and out-of-place output preserving NEW Raw/assets. Independent external model use is not verified. |
| Settings | Personal settings precede Root tools. Redundant introductions are removed; failures, conflicts and destructive consequences remain. Help metadata is a footer; share details open on hover/focus/tap. |
| Archives | `.cr` restore belongs to Settings → Data & backup. Personal additive restore previews and deduplicates; system v5 preserves ownership. Prior archive formats remain readable. |
| Learned formats/rules | Stable revisions, acquired permissions and explicit system publication/withdrawal. Personal controls do not alter global defaults. Noise defaults to keep; explicit review creates normal message versions. |
| Synchronization | Account preference field revisions, real reading anchors, outbox confirmation/retries/conflicts and offline account fences. Remote position changes do not force the active Reader to jump. |
| Admin | Search/paginated users, approval/status/session/reset/delete, invitations/audit, read-only cross-user Reader and bounded runtime state. Shared objects survive when others still reference them. |

Production includes the guidance described above. The original
[threshold proposal](docs/planning/CONTEXT_MAINTENANCE_GUIDANCE_2026-10-03.md) is
superseded by the user's uncovered-Index-range rule. Skill inline-version
editing stage was superseded by the confirmed replacement-only Bundle design.
SMTP is unconfigured in the verified production snapshot; email delivery remains
unavailable until the operator configures it. Administrator reset links remain.

## Verification

Exact-source CI 37470769275: API **1042 passed / 3 skipped**, settings **176** plus
**1** fresh PostgreSQL restore; Context **35**, authentication **18**, offline negatives
**17**, baseline PWA **135 / 324 gated skips**. Reader/Share/upload, source editor,
PDF/CSP, lint/typecheck/build, migration and image checks passed. Runtime/Bundle
**64** and cleanup **53** passed. Suites overlap; skips are not passes. New Context
coverage includes **26 integrity/streaming** and **13 actual PostgreSQL publication**
cases, including source changes after physical publication.

The first d89c3d7 CI failed one archive fixture duplicate-account setup
(**1041 passed / 1 failed / 3 skipped**); no failed-source images were deployed.
The follow-up fixes fixture ownership without weakening account checks and preserves
monotonic export progress. Final three-width corruption → repair → real ZIP download
screenshots were inspected in both locales/themes. Actual object hashes, persisted
results, cleanup, selected sequence numbers and large-source cancellation were checked.

For that deployed Context-integrity stage, local nonincremental TypeScript and
changed-file ESLint passed. Isolated synthetic
SQLite/file/worker tests ran in networkless disposable containers using the existing
CI image with source overlays. No local runtime/browser test or local image build
is claimed: C-drive temporary capacity is exhausted; no new E-drive exception was
assumed. Transfers stayed in memory and the private server release directory.

Production smoke is separate from CI; no full interactive production browser matrix
or independent external-model semantic trial is claimed. SMTP remains unconfigured.
Finalization initially stopped on a malformed Server Action reference. Nginx showed
its rejection at `/login` with 404; only that exact reviewed log was allowed, with
all others still blocking. A stale short source label in the post-cleanup evidence
helper was replaced with the actual release directory name and the read-only check
rerun. Neither correction changed application images or production configuration.

## Work rules and navigation

Read [AGENTS.md](AGENTS.md), then [docs index](docs/index.md). Temporary files use
`C:/Users/86182/Desktop/wkkk/<task>` with process-local TEMP/TMP. The latest batch uses
`wkkk/chat-reader-offline-task-recovery-20261008`. The stopped isolated cluster remains
under `wkkk/chat-reader-offline-recovery-20261006`.
The earlier E-drive test exception was batch
specific. Do not scan the local workstation, build images locally/on King, modify
user imports, delete production volumes or overwrite the server environment.
Existing unrelated tsbuildinfo and auth-resume test directories remain untouched.

Required checks are `corepack pnpm run lint`, `corepack pnpm run typecheck`,
`corepack pnpm --filter web build`, `corepack pnpm run test:api`,
`cd apps/api; python -m alembic heads` and `corepack pnpm --filter web test:pwa`,
plus risk-appropriate authenticated, PostgreSQL, Reader/Share/offline suites.

Current facts belong here or in `docs/system/`; dated plans/execution/evidence are
historical. Follow the [documentation inventory](docs/documentation-inventory.md).
