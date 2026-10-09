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
