# Attachment reading and ordinary-user recovery release — 2026-10-09

## Authorization and current state

The user authorized one complete CI cycle, then deployment after the current
creation/insertion/editing and attachment improvements are ready. PDF reading is
the priority; usability improvements must avoid significant additional CPU or
memory. Necessary failure repairs/retries belong to this cycle. After acceptance,
the full ordinary-user audit goal stays active, but no further CI or deployment
is authorized without a new explicit user request.

At this pre-commit checkpoint, master and origin/master are
`a12ce9e287fdddfd4df8a6039a212cec04629568`. Its passing CI 37812290017 does not
cover the new working-tree changes. Last accepted production remains
`30a0d321fe2d538b0fa0bbd61b3e982452f822cb`, head/current `20261008_0050`;
production has not been rechecked or changed in this checkpoint.

## Included scope

The release collects the earlier project/list/merge-admission/archive/sidebar/
metadata/placement/Reader recovery batches, quiet routine autosave, exact manual
Markdown source preservation and bounded attachment reading. Audits were written
before their scoped repairs. The [attachment audit](ux-audit-attachment-reading-2026-10-09.md)
and its adjacent local ledger are the latest checkpoint; earlier baselines and
source hashes retain their original meaning. No new migration, dependency,
storage format, automatic retry of uncertain writes or new server job is added.

## Local verification

- One complete Node run: **601 passed, zero failed/skipped**, 6.688 seconds.
- One isolated SQLite API integration run: **103 passed, zero failed/skipped**,
  260.62 seconds. It covers changed service/routes without starting local services.
- Web lint, nonincremental TypeScript, bounded one-worker/non-standalone production
  build and single Alembic head `20261008_0050` pass.
- Six-file discovery: **125 tests, zero browser executions**. CI owns real browser,
  layout/focus/canvas and PostgreSQL-concurrency acceptance. Local callback/DOM
  doubles and canvas calculations do not measure device CPU/RSS.
- Initial E2E typing mistakes (canvas `this`, media-element types) were corrected;
  final independent typecheck passes. A later diff check accidentally disabled
  CRLF normalization, producing false line-ending whitespace reports; the normal
  CR-at-EOL-aware check passes. Neither is claimed as a product defect.

The original policy-denied local Web start is not retried or bypassed. No local
PostgreSQL/API/worker fixture, production UI browsing, subagents or local/King
Docker build is used. Task temporary files remain under the designated `wkkk`
task directory. Existing buildinfo and two unrelated auth-test directories are
excluded from staging; user imports and all production configuration/data remain
untouched.

## Required release acceptance

Commit/push the explicit allowlist, dispatch the complete workflow for that
source, retain all failures and fix genuine failures. Require all 13 Web gates,
full API and PostgreSQL concurrency, 439 settings cases plus fresh-instance
restore, image build and independent image inspection. Review synthetic mobile/
desktop screenshots before claiming visual acceptance. Retain skips separately.

Download the immutable exact-source artifact and independently verify its run,
producer attempt, image IDs/architecture and inspection evidence. On King, inspect
the current operational checkout/configuration without modifying it; stage
exact-source support separately. Complete capacity/attachment integrity/rollback
checks, stop application writers only when ready, create and verify a fresh
five-component backup, compare stable data, run migration preflight and deploy
only accepted CI images with `--no-deps --no-build`. Never overwrite `.env`,
restart PostgreSQL to make build room, delete volumes or auto-restore/downgrade
the database. Do not replay old one-off release helpers. Production remains the
previous accepted source until health/image/data acceptance succeeds.

Exact commits, Actions runs, image provenance, screenshot review and deployment
outcomes will be appended chronologically to this record.

## Candidate eca207f — complete CI started

Source `eca207ffe14dd117aa3a938878777ae45a385500` was committed and pushed on
2026-10-09. The explicit staging allowlist contains 132 source/test/evidence files;
no import storage, environment file, buildinfo or auth-test residue is included.
The initial commit command lacked local author configuration and created no
commit; the successful command reused the repository's existing author identity
through command-local configuration, with no global Git configuration changes.

[CI 37889682904](https://github.com/foolkking/chat-reader/actions/runs/37889682904)
was dispatched once for master; the run's `headSha` equals the full candidate
above. An immediately following CLI list query misquoted its JSON-field list;
the read-only corrected run query confirmed the existing run, without dispatching
a duplicate. API, Web and settings jobs started. No CI result, image or deployment
acceptance is claimed yet. The immutable pre-commit local ledger remains unchanged.

The API job subsequently passed **1,239 tests / 3 skipped / 20 warnings** in
823.75 seconds. Both `test_merge_admission_postgres.py` concurrency cases executed
and passed. Separate Bundle and cleanup gates passed 64 and 53 cases; these are
not added to the overlapping full-suite count. Web and settings remain running.

Read-only King preflight confirms the accepted 30a0d32 runtime, 0050 head, healthy
Web/API/PostgreSQL and `alive_idle` worker. All application restart counts are
zero; PostgreSQL retains its 2026-09-30 start and image. Production Compose and
environment hashes are captured privately without exposing values. The existing
modified operational checkout is preserved. Available root space was 12,873,956
KiB and memory 217 MiB; these are point-in-time readings, not final release
capacity acceptance. The same two verified backup directory names are present.
No writer was stopped, image loaded, backup pruned or production file changed.

While the first browser run is still active, source review found an error in the
new manual-source test itself: at 375px, message edit/insert actions are behind
`mobile-message-actions-trigger`; the test tried the hidden desktop controls
directly. The follow-up will open the real mobile action menu when needed before
each command. It will retain the exact source/payload/dirty-state assertions and
the full viewport matrix. This is code-backed test-path correction, not evidence
that the first run passed or that the application needs its mobile menu removed.

## First CI failed; scoped repair locally verified

The run completed with Web and settings failures; both image jobs were skipped.
Web passed its preceding lint/types/build/601-Node, dependency and browser gates,
but `source-editor-mutation` hit its 20-minute limit. It discovered 100 cases;
21 failure contexts are retained, with no complete suite count. Later attachment,
PDF and PWA gates did not execute. Settings completed **438 passed / 1 failed /
0 skipped** in 42.6 minutes; its fresh-instance follow-up did not run. API's
1,239-pass/3-skip result above remains separate. No candidate image is accepted.

The [pre-edit interaction report](ux-audit-release-interaction-2026-10-09.md)
and adjacent original-artifact summary distinguish a real pending-placement
dismissal hazard from eight test-path/setup categories. The repair retains a
disabled submit with its original label, protects a pending backdrop using live
state and preserves focus without trapping explicit Close/Back/Escape. It does
not retain a stale reviewed comparison or change placement requests/revisions.
Tests now use the real mobile menus/exposed scrim/upward header reveal, fail the
project read before the shared cache is populated, inspect the auth-disabled
fixture's existing DB, respect safe 503 mapping, check merge titles and ordinals
separately, and choose All for a specific annotation-conflict test. No original
data, conflict, keyboard, duplicate-write or position assertion was dropped.

The pending-action baseline was **61 passed / 5 failed of 66**; after repair and
two extra probes all **68 placement checks pass**. Latest integrated Node is
**609 passed / zero failed/skipped**, 7.861 seconds. Lint, independent
nonincremental TypeScript and the bounded one-worker/non-standalone Web build pass.
Discovery is **129 cases in seven files, zero local browser executions**. API was
unchanged and not rerun locally for this UI/test delta; exact-source complete CI
will rerun it. The repair ledger inherits 106 source hashes (102 unchanged, four
expected changes) and adds the settings-conflict file. Original ledgers and the
unrelated buildinfo hash remain unchanged. The 20-minute mutation gate is not
increased. The next submission is a repair within this same authorized cycle.

## Repair 3e82323 — complete CI started

Committed and pushed `3e82323668a7843a5bfbebc7ea1d03a5dca61c1e` using an explicit
15-file allowlist. Every one of the 107 checkpoint source hashes was verified
before staging; staged scope and whitespace checks passed. No unrelated buildinfo,
auth-test residues or user imports were included. The command-local existing
Git author identity was reused without changing global configuration.

[CI 37897405546](https://github.com/foolkking/chat-reader/actions/runs/37897405546)
was dispatched once; its `headSha` equals the full repair commit above. API, Web
and settings jobs started. The repair ledger remains a pre-commit checkpoint,
not a claim that this new browser run or deployment has passed. King has not
been modified.

## Second CI failed; mobile repair locally verified

CI 37897405546, producer attempt 1, completed with API/settings successful and
Web failed. The mutation gate finished **97 passed / 2 failed / 1 timed out /
zero skipped or interrupted** in 857,735 ms, below its 20-minute gate limit.
Earlier Web gates passed; later attachment/PDF/PWA gates and both image jobs did
not execute. The original quality artifact is **11601831277**, name
`release-a-quality-evidence-3e82323668a7843a5bfbebc7ea1d03a5dca61c1e`, 13,552,602 bytes.
An initial timeout interpretation was explicitly corrected from the completed
log. The first run's actual 20-minute timeout remains a separate failed record.

The full API result is **1,239 passed / 3 skipped / 20 warnings**, 840.05 seconds,
including both PostgreSQL merge-admission concurrency cases. Separate Bundle 64
and cleanup 53 checks passed but overlap the full suite. Settings passed **439**
cases in 38.4 minutes and the independent fresh-PostgreSQL restore **one** case
in 34.7 seconds. Initial API/settings log downloads returned EOF; read-only
retries succeeded. This was an evidence-download failure, not a product failure.

The [pre-edit mobile report](ux-audit-mobile-release-2026-10-09.md) was delivered
before the two product repairs. The Reader now reserves actual wrapped-header
height with one owned size observer; the pending move submit prevents a subsequent
pointer-down's default blur while preserving explicit exits and chosen focus.
The obsolete archive test now performs read-only unknown-result checks before
explicit retries. Manual-source cleanup has its own budget, and mobile first-action
geometry is asserted with the offline guide present. Placement captures pending
geometry/focus before retaining its original keyboard assertions.

The 81-case local failure baseline (68 passed / 13 failed) now passes completely.
Integrated Node is **622 passed / zero failed/skipped**, 9,482.2517 ms; lint,
nonincremental typecheck and bounded build pass. Discovery is **144 tests in eight
files, zero local browser executions**. The new ledger inherits 107 source hashes
(102 unchanged / five expected changes), adds three sources and preserves older
evidence and the unrelated buildinfo hash. No API source, dependency, migration
or CI gate timeout changed. No local services, browser fixture, subagents or
Docker builds were used; King was not accessed or changed in this repair.

The third complete CI still requires all original gates and independent image
inspection. This is a repair in the same authorized release cycle, not permission
for a later unrelated release. No candidate image has been accepted or deployed.

## Repair 2ac23ce — third complete CI started

Committed and pushed `2ac23ceb638b7e8912b5c67f29ffdd2c7c0ab27b` using an explicit
18-file allowlist. The 110 source hashes, unchanged earlier/pre-edit ledgers and
unrelated buildinfo were checked before staging. All 147 links in seven scoped
documents resolve; staged scope and whitespace checks pass. The two unrelated
auth-test directories remain unstaged. No product file changed after acceptance
of these local checks.

[CI 37906779236](https://github.com/foolkking/chat-reader/actions/runs/37906779236)
was dispatched exactly once on 2026-10-09 at 08:44 UTC. The run's `headSha` matches
the full repair commit. This is the third complete run of the same authorized
release cycle, not a new release authorization. The local ledger remains an
immutable pre-commit checkpoint. CI, image inspection and deployment acceptance
are not claimed while the run is queued/running; King remains unchanged.

## Third CI failed; Reader preparation test corrected

The run finished with API **1,239 passed / 3 skipped / 20 warnings** in 870.04
seconds, settings **439 passed** in 41.7 minutes plus one fresh-instance restore
in 35.9 seconds, and failed Web mutation: **99 passed / 1 failed / zero timed
out, skipped or interrupted**, 579,266 ms. Later Web gates and both image jobs
did not run. Original quality artifact **11605961476**, 13,249,511 bytes, belongs
to source 2ac23ce, producer attempt 1. The initial run-log command was unavailable
while settings still ran; the artifact and completed-job API logs were readable.

The sole failure is the mobile placement test's pre-move scroll predicate. It
awaited only the title, not the asynchronously loaded scrollable body. Exact
event timing is inferred because the original file disabled tracing. The
[mobile report](ux-audit-mobile-release-2026-10-09.md) recorded this before editing.
The scoped test now awaits actual articles, settled first-content and overflow
before the same wheel gesture; all later move/focus/position assertions remain.
Only these two viewport tests capture failure traces. An unsupported nested trace
configuration was caught and corrected by local discovery before any new CI.

Final lint, nonincremental types, 622 Node regressions and 144-test discovery pass;
no browser executed locally. No product code changed and local API/build were
not rerun. The new ledger verifies 109 unchanged hashes and the single changed
E2E file against the 110-source parent. Two mobile first-message screenshots and
the passing desktop pending-dialog screenshot were actually reviewed and retained;
the mobile pending action still has no passing result in this run.

A read-only King probe still found accepted 30a0d32/0050 healthy, worker idle,
unchanged PostgreSQL start and both backups. It stopped/replaced nothing. The
probe's final shell line rejected a PowerShell-added CR after all checks; this
is not a production failure or a complete capacity acceptance. Its disposable
helper was corrected, not the operational checkout. Fresh release preflight,
backup, rollback and data checks remain necessary after candidate acceptance.

## Repair adaa8de — fourth complete CI started

Source `adaa8decf2b4f78cc3d950b59f9751b718362ea2` was committed/pushed using a
12-file allowlist containing one E2E file plus documentation and synthetic
evidence. All 110 bound hashes, unchanged prior checkpoints, 153 scoped links
and staged whitespace/scope passed before commit. Unrelated buildinfo/auth-test
residues remain unstaged. No runtime source changed from 2ac23ce.

[CI 37913851928](https://github.com/foolkking/chat-reader/actions/runs/37913851928)
was dispatched exactly once on 2026-10-09 at 09:50 UTC; its full `headSha` matches
the repair. It is a complete fourth run within the same authorized repair cycle.
No passing CI, deployable image or deployment is claimed at this start checkpoint.

## Fourth CI failed; attachment blockers recorded before repair

The completed fourth run passes API **1,239 / 3 skipped / 20 warnings** in
876.53 seconds, single head/current 0050, settings **439 / zero failed/skipped**
and one independent fresh-instance restore. Web mutation now passes **100 / zero
failed, skipped or timed out** in 501,616 ms. The attachment gate completes below
its 20-minute limit with **9 passed / 6 failed / 6 timed out**, 944,130 ms. Four
later gates (PDF, default PWA, auth, negative PWA) do not run; both image jobs are
skipped. Original quality artifact 11610445727 is 27,740,608 bytes, attempt 1.

The [pre-edit attachment blocker report](ux-audit-attachment-release-2026-10-09.md)
and adjacent sanitized checkpoint distinguish actual drawer pointer interception,
Blob-fetch CSP rejection and Office-as-ZIP routing from Worker injection and
fixture-cleanup defects. Selected failed frames and two passing mobile
Reader/placement screenshots were actually viewed and retained. This is not
full visual acceptance. No runtime code was edited before this report.

API/settings logs were downloaded with the existing scoped CLI helper. No local
service/browser was launched, no new workflow was dispatched and King was not
accessed or modified during this diagnosis. The next repair/retry remains inside
the same authorized release cycle; deployment remains prohibited until complete
exact-source acceptance.

The scoped repair now passes its unchanged 71-case baseline (previously
54 passed / 17 failed) and the complete **659-case Node suite**, zero failed or
skipped. Lint, nonincremental TypeScript and bounded one-worker Web build pass.
The emitted Worker retains the diagnostic name despite Webpack's `type: void 0`.
Discovery is **149 cases in ten files, zero local browser executions**, retaining
the earlier 144 plus CSP and rich-attachment coverage. API sources were not
changed or rerun locally; complete CI will rerun the full PostgreSQL suite.
The unrelated buildinfo hash is unchanged. No dependency, migration, original
assertion removal or case/gate timeout increase is included.

## Repair f4719c9 — fifth complete CI started

Committed/pushed `f4719c96d3b2da4bcf2629872ed330ee50510142` with an explicit
23-file allowlist. Remote master was checked before staging; all 115 bound
source hashes, preserved earlier ledgers/buildinfo, 84 links in seven scoped
documents and staged whitespace/scope passed. No unrelated auth-test residue,
imports or environment file was staged. Command-local existing author identity
was reused without changing global Git configuration.

[CI 37924985537](https://github.com/foolkking/chat-reader/actions/runs/37924985537)
was dispatched exactly once at 11:38 UTC on 2026-10-09. Its complete `headSha`
matches the repair. The fifth run is still within the same authorized release
cycle; no passing CI, candidate image or deployment is claimed at dispatch.
The local verification ledger remains its immutable pre-commit checkpoint.

## Fifth CI failed; returned mobile scrim identified before editing

CI 37924985537/attempt 1 completes with API **1,239 passed / 3 skipped / 20
warnings**, 878.43 seconds, single current/head 0050; settings **439 passed**
and independent fresh-instance restore **one passed**. Web mutation passes
**100**, 545,980 ms. Attachment is **15 passed / zero failed / 6 timed out**,
594,796 ms; the console's six-failed summary is not six extra failures.
The later PDF/default-PWA/auth/negative-PWA gates are unverified and both image
jobs skipped. Original diagnostic artifact is 11614434251, 30,517,520 bytes.

The [pre-edit report](ux-audit-attachment-release-2026-10-09.md#9-fifth-ci-transparent-returned-overlay-intercepts-the-next-file-pre-edit)
records actual layer order reversal: a transparent remounted Overlay follows
retained mobile Content with equal z-50, intercepting the second file click.
The preceding first-file JSON/Office recovery and all ten desktop cases pass
their reached assertions; the six full mobile cases remain timed out. Four
new synthetic screenshots and recorded snapshot topology were inspected and
retained. A narrow layer fix is next; no unrelated follow-up product change,
candidate image or deployment is included. No King access or local service
start occurred during diagnosis.

## Mobile return-layer repair — local verification complete

The narrow product delta makes mobile Content explicitly higher than its scrim
(51 versus 50), without changing the foreground Viewer or modal lifecycle.
The new 37-case source/handler baseline fails **one** layer assertion; the same
suite passes all **37** after repair. The complete Node suite passes **660**,
zero failures/skips, in 8,763.8816 ms. Lint, nonincremental TypeScript and bounded
one-worker/non-standalone build pass. Browser discovery remains **149 in ten
files**, none executed locally. Added real-browser hit tests retain all original
assertions and subsequent normal clicks; no time budget increases.

The [additive checkpoint](ux-audit-attachment-release-2026-10-09-evidence/return-layer-verification.json)
inherits 115 bound sources and permits only the three reported product/test
changes. Prior ledgers, fifth-run evidence and unrelated buildinfo remain intact.
The API is unchanged and not rerun locally. Next is one full exact-source workflow
for this repair within the same authorization; no image/deployment is yet accepted.
The separately delivered follow-up annotation/table report is evidence only,
not additional product changes in this candidate or another release permission.

## Repair 36b656a — sixth complete CI started

Committed/pushed `36b656a5c1642989c9fc1796bfd4c21a6cbe7f9e` with an explicit
20-file allowlist: the three reported runtime/test files and scoped evidence/docs.
All 115 source bindings, historical ledgers, fifth-run evidence, unrelated
buildinfo and 166 links in nine documents were checked before staging. Remote
master matched the parent; no unrelated residue or user import was included.
The existing command-local commit author identity was reused.

[CI 37936101205](https://github.com/foolkking/chat-reader/actions/runs/37936101205)
was dispatched exactly once at **13:20:09 UTC, 2026-10-09**. Its full head SHA
matches the repair, with API, Web and settings started. This is a complete run,
not a failed-job-only retry; all thirteen Web gates and both image jobs remain
required. The local ledger stays an immutable pre-commit checkpoint. Production
has not been accessed or deployed during this repair/dispatch segment.

## Sixth CI failed at PDF; scoped repair locally verified — 2026-10-10

CI 37936101205/attempt one, source 36b656a, completed with API **1,239 passed /
three skipped / 20 warnings**, 844.17 seconds; settings **439** plus **one**
independent fresh-instance restore. Web mutation passes **100** (544,082ms), and
attachment now passes **21** (72,460ms), including the actual mobile return layer.
PDF is **seven passed / six failed / zero timedOut / zero skipped / zero
interrupted** (417,967ms). Default PWA/auth/negative-PWA and both image jobs are
unverified. Diagnostic artifact 11621760314 is not a deployable image artifact.

The [new pre-edit report](ux-audit-pdf-release-2026-10-10.md) and adjacent evidence
were delivered before product/test edits. Four long-document cases show page 90
with input 89 at a fractional scroll boundary. Two desktop retries inject only
one failure, which need not survive the size-driven re-render. The actual-source
probe reproduces both mechanisms, with explicit non-browser doubles and honest
limits on inferred CI callback timing.

The product delta is one-pixel sampling tolerance within the existing continuous
PDF inset. E2E keeps its original assertions/budgets, adds wheel navigation, and
holds page-one canvas failure until a trusted click on that page's Retry control;
resize and failure/click counters prove the fault was not consumed prematurely.
The 41-case baseline has **37 passes / four failures**, then all **41** pass.
Complete local Node is **666 / zero failed / zero skipped**, 8,567.6464ms. Lint,
nonincremental types and bounded one-worker build pass; discovery is still **149
cases in ten files**, zero locally executed. API source remains unchanged and was
not rerun locally; Alembic source has single head 0050.

The [PDF checkpoint](ux-audit-pdf-release-2026-10-10-evidence/local-verification.json)
inherits all 115 source bindings with only three expected deltas and preserves
historical evidence and unrelated buildinfo. Next is precise commit/push and one
seventh **complete** CI within this cycle. No candidate image, King mutation or
deployment has occurred; later annotation/table optimization stays separate.

## Repair 2f046f9 — seventh complete CI started

Committed/pushed `2f046f9fa2017e6c1d50833860b81f29896dbc60` with an explicit
19-file allowlist: three runtime/test files plus scoped documentation/evidence.
Verified all 115 source bindings, prior ledgers and screenshots, unrelated
buildinfo, 169 links in nine documents and the unchanged remote parent before
staging. No imports, API test residue or unrelated file was staged.

[CI 37967470601](https://github.com/foolkking/chat-reader/actions/runs/37967470601)
was dispatched once, created **17:36:28 UTC on 2026-10-09** (2026-10-10 locally).
The run's full head SHA matches the repair; API/Web/settings are in progress.
This is the seventh complete run in the current authorized cycle, not a partial
retry. The local checkpoint remains immutable; no candidate image or production
change has been accepted.

## Seventh CI failed; PDF session/geometry repair locally verified

Run 37967470601/attempt one completes with API **1239 passed / three skipped /
20 warnings**, 1310.44s; settings **439 passed** plus **one** independent restore.
Web mutation passes **100**, attachment **21**; PDF is **seven passed / six failed /
zero timedOut / zero skipped / zero interrupted**, 408445ms. Default PWA/auth/
negative PWA and both image jobs remain unverified. Original diagnostic ZIP
11635037421 is 24065430 bytes and matches its GitHub SHA256 digest.

The [new pre-edit report](ux-audit-pdf-session-2026-10-10.md) and frozen evidence
preceded edits. Callback-only redraw closes the file-panel preview; stale
measurement plus intermediate scroll feedback reproduces the mobile 90-to-94
drift. Current repair retains session identity, fences disposed callbacks, and
computes current CSS geometry from page/document-scoped intrinsic size. Native
alignment uses public measurement APIs after the sizer commits; real input
interrupts immediately. No polling, dependency or render-budget increase.

Baseline: **48 tests / 41 passes / seven failures**; expanded focused result:
**53 passed**. All 25 repository-script suites pass **699 / zero failed / zero
skipped**, 9413.6934ms; lint, nonincremental types and bounded one-worker build
pass. An intermediate floating-point assertion and private-API type error are
retained as failed checks before correction. Discovery stays **149 in ten files**,
zero local browser cases. E2E retains every assertion/time budget and adds actual
DOM identity and zoom/resize screenshots. The
[additive ledger](ux-audit-pdf-session-2026-10-10-evidence/local-verification.json)
inherits 115 bindings with three expected changes; older evidence/buildinfo are
unchanged. Next is a precise commit/push and the eighth **complete** CI in this
same authorized cycle. No candidate image or production deployment is accepted.
