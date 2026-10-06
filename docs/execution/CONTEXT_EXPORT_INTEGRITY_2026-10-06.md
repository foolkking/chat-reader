# Context export integrity and bounded processing — 2026-10-06

## Scope and baseline

Production source remains `25c7f6a`, accepted under CI `37453812341`. That release
must not be redeployed as if it covered these changes. The broad optimization goal
remains active. This stage follows the [scoped audit](ux-audit-context-export-2026-10-06.md)
and its synthetic pre-fix runtime reproduction; it is not a completed whole-site audit.

Reproduced outcomes: same-size corrupt attachment published with complete status;
interrupted copying left a staging ZIP; rollback left a published file with no DB
artifact; account/asset revocation during packaging still published a result.

## Changes

- Hash the actual bounded attachment stream against stored SHA/size; preserve
  missing-object partial Raw output and metadata-only exports.
- Own staging files from allocation through cleanup; track unique final paths with
  the existing transaction cleanup service, retaining normal download filenames.
- Stream JSONL immediately and query message bodies/references in batches of 100;
  use SQL subqueries instead of a giant ID parameter list. Stream attachment metadata,
  historical annotation anchors and annotations. Keep bounded message identity and
  exported-object metadata, and subject individual records to existing line limits.
- Count only the selected reading range against the message budget, preserving
  original sequence numbers. Enforce existing compressed/expanded/entry/object limits.
- Permanent builds read one PostgreSQL snapshot, then recheck live source/account,
  asset availability and source/dependency/file generation before and after publication
  I/O. Final shared locks follow owner → conversation → ordered objects. Read-only
  temporary exports take no row locks.
- Localize actionable Context failures in Export and Tasks. Extend the actual browser
  corrupt-object → repair → download/checksum matrix to Context at 375/768/1440px.

No schema, package version, Share authorization, Skill Bundle, Current/Index validation,
candidate or adoption change. No model execution, local/server image build or local
cleanup. Off-site/scheduled backups remain excluded; any eventual production release
retains the latest two verified backups and preserves data/configuration/PostgreSQL.

## Verification checkpoint

- Original 23 integrity cases passed again after streaming changes, using the existing
  CI-produced API image with working-tree overlays in a networkless, read-only,
  disposable container. Real SQLite foreign keys, worker, files and ZIPs were used.
- Local nonincremental TypeScript passed. No local runtime/browser test is claimed:
  C-drive temporary capacity is exhausted and no new E-drive exception was assumed.
- Added selected-range, 602-message streaming/cancellation and PostgreSQL two-session
  races at serialization and after physical publication.
- One auxiliary invocation named a nonexistent test file and ran zero tests; it is
  not counted as passed. The corrected actual suite names are used for the follow-up.
- Full API/Context/external Bundle/browser/PWA/PG/migration gates and exact-source CI
  remain pending. Deployment and production acceptance have not occurred for this stage.

Focused final results: **26 integrity/streaming cases passed** (21.21s), including
actual 602-message bodies, a serialized prefix already on disk while processing,
bounded retained ORM bodies, cancellation with no output, and selected-range original
sequence preservation. **20 Context export/return compatibility cases passed** (25.14s).
Outputs are retained in the audit evidence directory. Changed-file ESLint and Python
AST checks also passed. These are separate suites; no PostgreSQL/browser result is
claimed from the isolated SQLite runs.

The first expanded compatibility run failed because the historical import fixture
assigned a legacy administrator UUID without creating its account. Its fixture now
seeds the real administrator shape from migration 0030; production account checks
remain strict. An interrupted combined run produced no complete summary and is not
counted. Clean split reruns produced the final counts above. Only synthetic data and
the existing CI image were used, with networkless read-only disposable containers,
0.5 CPU / 512 MiB and bounded tmpfs; no host data/configuration was mounted.

Evidence stays synthetic. Existing `apps/web/tsconfig.tsbuildinfo` remains unstaged;
old untracked auth-test directories are neither inspected nor cleaned.
