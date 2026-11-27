# Backend release review / fixes — 2026-11-25 (Asia/Shanghai)

Workspace: `<READER_REPO>`, existing `codex/reader-extension`.
Base HEAD: `c9cfb131d6704f2d2c095b93355629740e95cac5` plus the shared, uncommitted working tree.
No branch, commit, push, CI, network access or deployment performed. No Web/workflow/docs entry-point edits.
All temporary files and synthetic evidence stay in `<TASK_EVIDENCE>\backend`.

## Three confirmed blockers, now fixed

1. **Revoked Web authority creating fresh extension grants (P1).**
   `<READER_REPO>\apps\api\app\services\extension_access.py:53`
   now locks/reloads user → principal → actual Web session and checks credential generation, inactivity, revocation and account state before grant publication.
   Both old PKCE and short-code pairing use it; pairing takes these locks before the pairing row.
   `<READER_REPO>\apps\api\app\services\extension_pairing.py:52`.
   Original actual-PG red evidence: `pytest-audit-auth-03.log`, 2 failures (password/session invalidation after middleware authentication).
   Repository regression covers password/session/expiry/disabled account, both authorization flows, cached ORM state, concurrent quota and one-time approval.

2. **Large JSONL metadata allocated before the 64MiB workspace guard (P1).**
   `<READER_REPO>\apps\api\app\services\adaptive_import\reader_package.py:71`
   now reuses the incremental metadata reader in 64KiB chunks, with live checkpoints; fast path is restricted to the already-bounded chunk.
   `<READER_REPO>\apps\api\app\services\extension_import.py:38`
   uses that same reader for source receipts instead of another whole-line allocation.
   `<READER_REPO>\apps\api\app\services\adaptive_import\manifest_stream.py`
   supports the existing archive-byte budget and chunk-wise whitespace skipping.
   Original valid 96MiB-whitespace metadata fixture: first-check RSS delta **101,785,600 bytes**, beyond unchanged **67,108,864-byte** workspace.
   Fixed fixture observed **77,824 bytes** peak delta under the actual RSS guard (`pytest-metadata-green-02.log`).
   No body/message-count product cap reinstated. Archive byte, metadata scalar/depth, malformed JSON, UTF-8 and cancellation controls remain.
   Existing long-message regressions include >16MiB spool roundtrip, corruption/path checks and equal-semantics line splitting.

3. **Extension quick-context settings vs Web preset deadlock (P2).**
   `<READER_REPO>\apps\api\app\api\routes\reader_extension.py:275`
   takes the export-preset collection lock before preferences, matching existing Web writes.
   Original actual-PG deterministic red evidence: `pytest-audit-locks-02.log` (`40P01`, API500).
   Repository test retains the real locks and schedules the inversion; both operations now succeed.

New repository regressions:
- `<READER_REPO>\apps\api\tests\test_extension_release_postgres.py`
- `<READER_REPO>\apps\api\tests\test_reader_index_metadata.py`

## Device retry — implemented and focused / PostgreSQL regressions passed

Reader already has:
- `POST /api/tasks/{id}/retry`: failed analysis job / failed canonical task; not the same operation.
- `POST /api/adaptive-import/sessions/{id}/resume`: paused retained sources, explicit version confirmation.
- `POST /api/adaptive-import/sessions/{id}/reanalyze`: recoverable analysis states (not a universal failed-task retry).
- `POST /api/adaptive-import/sessions/{id}/rebuild-preview`: retained sources and compatible saved mapping.

New narrow facade:
- `POST /api/extension/v1/imports/{iid}/retry` (no options body).
- `capabilities.import_retry = true`.
- Response202: `{id, state, status, phase}`, with **the original import id**.
- Only the original owning user AND device, failed/paused state, retained complete sources and a released execution slot qualify.
- Failed analysis: retries the original analysis job; original upload receipt remains.
- Paused analysis: existing retained-resume path; original import/source/receipt, new analysis job.
- Failed canonical commit: existing preview rebuild only; **not** a canonical retry. Old `extension_decision` is removed, so partial/live-share/conflict require fresh existing `/commit` confirmation.
- Selective append, source edits requiring repair, incomplete uploads, active/committed tasks and unavailable sources are refused. Complex cases return409 `EXTENSION_IMPORT_RETRY_REVIEW`, `next_action: open_reader`.
- No new import record, replacement conversation, overwrite, implicit separate-copy approval, automatic commit, or second upload.
- Job-before-record locking and current device revalidation; concurrent attempts cannot queue two jobs. Lost response: read `/imports/{iid}` and `/requests/{key}`, not blind resubmission.

Source:
- `<READER_REPO>\apps\api\app\services\extension_retry.py`
- `<READER_REPO>\apps\api\app\api\routes\reader_extension.py:454`
- `<READER_REPO>\apps\api\tests\test_extension_retry.py`
- Actual-PG concurrency/revocation/held-lock tests added to `test_extension_release_postgres.py`.

Retry evidence retained:
- `pytest-retry-red-01.log`: exit1, 3 expected404 failures before endpoint existed.
- `pytest-retry-green-01.log`: exit1, 12 pass/1 fail; repository test caught the existing retry helper refreshing ORM state and restoring old consent. Clear consent moved **after** helper refresh; assertion unchanged.
- `pytest-pg-green-02.log`: exit0, **21 passed**, 109.21s, actual PostgreSQL including retry races and authority invalidation. One existing Alembic path-separator warning.
- `pytest-retry-green-02.log`: exit0, **32 passed**,473.83s; retry plus all existing reader-extension tests.
- `pytest-retry-green-03.log`: exit1,17 pass/1 fail in the new no-token test setup: the shared Web client supplies its Reader Origin, so the request hits the existing origin403 check before device-token401. Corrected the fixture request to provide the registered extension Origin for the missing-token case; retained both exact403 and exact401 assertions. No product authorization rule or threshold changed. Final expanded retry rerun is `pytest-retry-green-04.log`.
- `pytest-retry-green-04.log`: exit0, **18 passed**,285.18s. Covers multipart AND resumable receipts, failed/paused analysis, failed canonical partial consent, real changed-share/edited-source append failure, cross-owner/device/revocation, active execution, incomplete upload, selective append refusal and capture kill switch. Existing Reader cookie alone cannot authorize; registered origin plus no device token is401, invalid origin403.

## Other requested boundary: selective append has a 250-item business cap

Confirmed, **not modified**:
- `<READER_REPO>\apps\api\app\services\adaptive_import\append_choices.py:16,164`: `MAX_SELECTION = 250`.
- `<READER_REPO>\apps\api\app\api\routes\append_imports.py:115`: request `indexes` maximum length250.

This limits **one manually selected append confirmation batch**, not acquisition, the normal full-conversation import, or the selectable source index. It is a business/API cap, not a parser/workspace safety guard. The complete choices index is still generated and paged. Main agent must decide any UX/API removal; no unauthorized semantic change here.

## Verification commands and observed results

Shared setup for every command (process-only):

```powershell
$env:TEMP='<TASK_EVIDENCE>\backend'
$env:TMP=$env:TEMP
$env:PYTHONDONTWRITEBYTECODE='1'
$env:PYTHONPATH='<READER_REPO>\apps\api;<READER_REPO>\apps\api\tests'
Set-Location '<READER_REPO>\apps\api'
```

`E:\anaconda\python.exe -m pytest` with `-q -p no:cacheprovider --basetemp <unique child of TEMP>`:

| Log | Test inputs | Exit / result |
| --- | --- | --- |
| `pytest-baseline-01.log` | reader_extension, extension_transfer, reader_long_message_storage, memory_probe_windows, worker_model_registration | 0 / 126 passed, 395.78s; pre-fix baseline |
| `pytest-metadata-green-02.log` | reader_index_metadata, reader_long_message_storage (`-s`) | 0 / 102 passed, 7.21s |
| `pytest-focused-green-02.log` | reader_extension, extension_transfer, bounded_zip_streaming, small_zip_memory_budget, selective_append, memory_probe_windows, worker_model_registration | 0 / 129 passed, 2 original platform skips, 517.15s |
| `pytest-pg-green-01.log` | extension_release_postgres, extension_transfer_postgres, supervised_execution_postgres::test_control_migration_roundtrip_keeps_one_head | 0 / 15 passed, 66.65s; before retry addition |
| `pytest-pg-green-02.log` | same PG files/test, including new retry tests | 0 / 21 passed, 109.21s |
| `pytest-retry-green-02.log` | extension_retry + reader_extension (before extra transport/origin cases) | 0 / 32 passed,473.83s |
| `pytest-retry-green-04.log` | final extension_retry, both transport paths and explicit origin/token checks | 0 / 18 passed,285.18s |

Skipped tests are the two existing data/index native symlink cases on Windows lacking symlink permission; no skips added. Mocked path/symlink rejection tests passed but do not replace native Linux symlink verification.

Actual PG runs additionally set `SETTINGS_POSTGRES_INTEGRATION=1` and a loopback disposable database connection to the instance below. Each integration fixture creates/drops its own database. SQLite runs above are **not** PostgreSQL certification.

`E:\anaconda\python.exe -m alembic heads`: exit0, **`20261125_0065 (head)`**, `alembic-heads-final.log`.
`git diff --check -- apps/api` from repository root: exit0, `git-diff-check-final.log`.
`backend-verified-source-manifest.json` records SHA256 of the reviewed/fixed source and regression files; the base commit alone does not identify this shared working tree.

Original failed evidence preserved: `pytest-audit-01.log` (metadata failure plus one audit-fixture subject-namespace typo, not two product defects), `pytest-audit-locks-02.log`, `pytest-audit-auth-03.log`.
`pytest-existing-pg-01.log` exit4 was a mistyped test selector; corrected `pytest-existing-pg-02.log` passed3 real-PG tests. None hidden or substituted.

## Actual PostgreSQL name-query check

Existing `<READER_REPO>\scripts\bench_extension_names.py`, 10,000 conversations /100,000 search documents, 20 hot samples; synthetic transaction rolled back.
`name-benchmark.json.log`: name-query project **29/29**, body-only term **0**, exact title1; P95 **11.8 /10.08 /10.56ms** respectively. SQL assertions reject accesses to `search_documents`.
Old full search project0; body-only first page40 with more, P95≈14.25s.
This is local server-query evidence, not browser input-to-paint or production network performance.

## Keep PostgreSQL running for main agent

- PostgreSQL17 binaries: `E:\PostgreSQL\17\bin`.
- Bind **127.0.0.1**, port **56349**.
- Data directory: `<TASK_EVIDENCE>\backend\pg-review-data`.
- Server log: sibling `pg-server.log`.
- Startup flags: `pg_ctl -D <data> -l <log> -o "-h 127.0.0.1 -p 56349" -w start`.
- Local disposable role `audit`, trust authentication, no password; management DB `postgres`.
- Main agent can create independent `reader_batch_e2e`; tests create their own randomly named DBs and will not touch it. Do not stop this shared temporary cluster during integration.
- Confirmed accepting connections at 2026-11-25 16:36:11+08:00.

## Release / compatibility boundaries, not waived

- `0065` adds nullable device name + pairing rows. Actual0065→0064→0065 preserves old issued-device identity and credential/token hashes; no claim that SQL roundtrip proves worker-job downgrade compatibility.
- Current production status is **documented**, not live checked here: v0.1.7 /schema0064. Candidate schema0065 requires the existing full maintenance path, not Web-only fast update.
- API and worker must upgrade together. New `RecordSpool.text_sidecars:1` cannot be read by old workers; retained pending draft jobs make a blind manual downgrade unsafe. Updater schema compatibility prevents automatic0065→0064 rollback. Do not reset/replace user jobs or sources to bypass this.
- No full API suite/CI, real extension-to-running-API browser batch,640MiB Linux worker or production release qualification claimed by this report. Main agent owns those remaining gates.

**Handoff conclusion:** all three reproduced blockers are fixed with retained red/green evidence; new device retry passed the focused and real-PG checks above. No known unresolved blocker in these reviewed/fixed backend paths. This is not an authorization to skip main-agent full-suite/CI/release gates. PostgreSQL remains running for the main agent's separate browser/API/worker test database.
