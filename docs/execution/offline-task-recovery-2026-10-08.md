# Task Center offline recovery — 2026-10-08

Status: implemented locally; focused API/static/build checks passed, browser
acceptance pending. No commit, CI, deployment or production access.

## Finding and selected flow

Source review showed that the Task Center Retry command called the generic server
job retry endpoint. A failed IndexedDB download stays failed, while the local
coordinator resumes only active states. Consequently, successful server regeneration
did not resume that device's failed download. This is code-path evidence, not a
completed browser reproduction or a user study.

Offline task rows now enter the existing Offline & sync panel. Entry performs no
new admission or automatic retry. It finds the exact job or the latest matching
local scope/attachment-mode retry, opens the relevant state and failure page, and
focuses the actual row. Intervening pointer/keyboard actions cancel delayed entry
navigation. Existing local recovery remains responsible for download/write state.

When this device has no matching record, the panel offers Download to this device
using the task's target and the current catalog. The user chooses the attachment
mode and explicitly starts the existing enqueue pipeline. Missing legacy target
metadata retains a manual Library route. An empty/deleted/unavailable source or
unavailable catalog cannot start the targeted action. A completed local record
opens the Library. Server cancellation is labelled Cancel server generation.

The Task Center no longer uses generic server Retry or raw ZIP result controls for
offline jobs. Their backend endpoints remain compatible. Old failed server jobs
remain historical entries governed by normal retention; they are not relabelled
as the state of a newly recovered local copy.

## API and compatibility

`BackgroundTaskRead.offline_target` is nullable and projected only from an owned
offline-package job's allowed scope, matching UUID and attachment-mode fields.
Invalid/legacy payloads return null. Other payload values, known revisions and
storage metadata are not exposed. The target is navigation information: current
source ownership is checked again during ordinary offline admission.

No persisted model, migration, Dexie or package-version change. Local head remains
`20261008_0050`; production is unchanged at 0048. Existing data, canonical message
versions, attachment bytes, offline v1/v2/v3 reads and Share semantics are preserved.
New Web works with an old API by locating the job if it exists locally or providing
the manual route. API first enables the targeted new-device action.

## Completed verification

- Focused API gate: **33 passed, 0 failures/errors/skips**, JUnit 60.138 seconds.
  `test_offline_task_recovery.py`: 11; `test_tasks_api.py`: 17;
  `test_offline_asset_integrity.py`: 5.
- The new recovery test uses actual HTTP handlers, persisted jobs, worker execution
  and ZIP bytes. It corrupts an attachment, observes a committed failure record,
  repairs the source, checks fresh/idempotent admission and verifies downloaded
  bytes. Message versions remain identical. Another owner cannot inspect the task,
  admit its target or download its result. Synthetic middleware supplies the
  authenticated principal; it is not a real-login or browser test. The fixture
  uses SQLite with foreign keys, not PostgreSQL.
- Full Web lint, nonincremental TypeScript and final focused ESLint checks passed.
  Final ordinary Web build passed with one worker and a 2 GiB Node heap. The final
  build follows the empty-project availability guard, superseding the earlier build.
- Alembic reports the single existing `20261008_0050 (head)`.
- Playwright discovery lists **16 cases in two files**, with **zero executions**.
- Closeout matched all three recorded artifact hashes, checked the evidence JSON
  against JUnit and verified the new record links. `git diff --check` passed;
  staging stayed empty and the four isolated test ports had no listeners.

The API invocation was `python -B -m pytest tests/test_offline_task_recovery.py
tests/test_tasks_api.py tests/test_offline_asset_integrity.py -q`, with explicit
task `--basetemp` and `--junitxml`, forward-slash paths and process-local TEMP/TMP.
Logs/JUnit/build/discovery output remain in the task directory under desktop
`wkkk/chat-reader-offline-task-recovery-20261008`. The repository keeps only
[aggregate evidence](offline-task-recovery-2026-10-08-evidence/results.json).

Earlier full API (1,020 pass/153 skip) and PostgreSQL supplement (149 distinct
passes) predate this change. They are not counted as new full gates for this code.

## Pending browser evidence and execution block

Eight offline cases cover retained copies, first copies with empty/unrelated
libraries, and Task Center entry. Retained-copy tests now require correct row/page
focus and no admission on entry; the wide case adds 20 synthetic failed metadata
rows for page two. Task Center new-device cases require explicit admission, real
worker ZIP, IndexedDB completion, reopening the existing record and readable
Library content without calling generic task retry. Only failure presentation
and paging metadata are injected; successful downloads are real. Eight noise
selection-response cases remain in the same pending gate.

After the user's earlier explicit continuation, automatic approval again rejected
the loopback Web start with only `blocked by policy`. No alternate launcher,
port/server, managed test startup or further retry was attempted in this follow-up.
The previously started owned fixture services stopped cleanly. No browser result,
screenshot or production verification is claimed. The build's upstream remains
the isolated API on port 8008; any future permitted serve must use that same
`API_INTERNAL_URL`. The historical-fixture/Windows-symlink exclusions remain separate.

Next required step is the real focused browser gate and visual/focus review when
execution policy permits it. The wider optimization goal is still active.
