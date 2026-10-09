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
