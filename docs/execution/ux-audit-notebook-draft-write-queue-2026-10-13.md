# UX quick review - Notebook draft persistence

2026-10-13. Scoped review of the existing notebook editor's local-draft write path using source code, API schema and existing isolated browser-test coverage. No local web service or browser was started; no rendered timing or device resource measurement is claimed.

Platform: Web app, including online and offline Reader. Audience: ordinary readers
writing personal notes. Preserving their input takes precedence over reducing
write counts; this repair does not change the stored draft schema or version guard.
The preceding preference/synchronization source sweep found no new confirmed
defect; its existing tests were inspected, not rerun in a browser.

## The three things that matter most

1. Rapid edits can queue redundant whole-notebook IndexedDB writes; the user waits for that queue before the explicit save starts.
2. The effect is bounded for small notes but scales with note size and storage latency; source permits up to 5,000 blocks and 50,000 characters per Markdown block.
3. The targeted repair is to retain at most one active write and the newest pending snapshot, preserving version checks and waiting for the newest snapshot before remote save.

## Findings

| ID | Finding | Dimension | Severity | Confidence | Effort |
|---|---|---|---|---|---|
| PERF-NOTE-01 | Every editor change appends a complete draft snapshot to a serial write queue | Perceived performance / core task flow | Medium | Observed (code and compiled callback probe); device impact Inferred | S |

`NotebookView` calls `retain` on each title or text input change (`notebook-view.tsx:135,143`). `retain` appends a promise callback that closes over the complete `Working` value (`notebook-view.tsx:69-77`); it does not replace snapshots that have not started writing. The notebook save waits for the current chain (`notebook-view.tsx:79-86`). The API accepts up to 5,000 blocks and each Markdown block up to 50,000 characters (`apps/api/app/schemas/annotation.py:98-116`). On a large note or slower local storage, rapid typing can therefore retain and serialize redundant whole-note snapshots and make an explicit save wait behind them. This is a source-backed risk, not a measured slowdown. Keep one write in flight and replace the pending snapshot with the newest value; preserve the expected-version contract, final text and save-before-submit ordering.

## Quick wins

Replace queued intermediate snapshots with the newest pending draft while preserving the in-flight write and monotonically advancing local version.

---

*A scoped source review, not a rendered or device-performance audit. Existing browser coverage exercises draft persistence, reload and revision comparison at 375px and 1440px, but does not exercise a burst of edits while IndexedDB is slow. No browser test was run locally.*

## Appendix - evidence log

See [pre-edit source evidence](ux-audit-notebook-draft-write-queue-2026-10-13-evidence/pre-edit.json)
and [baseline probe result](ux-audit-notebook-draft-write-queue-2026-10-13-evidence/baseline-probe.json).
The baseline compiled-component probe actually produced the first, intermediate
and latest writes, failing the two-write expectation. Hooks, repository and storage
were explicit doubles. This proves the queue behavior, not browser responsiveness.

## Local repair and verification

`retain` now starts one write immediately and replaces a single pending snapshot
while that write is active. The same draining promise covers newer snapshots before
remote save or draft cleanup proceeds. Each successful write advances the existing
expected version; a failed write does not. Only the latest input's outcome updates
the existing saved/failed feedback. A new input or the existing explicit retry can
start another drain. No timer, worker, dependency or background retry was added.

The compiled-component tests cover a held first write followed by 100 real callback
changes (two writes), a held final write that delays the remote save, ordered Markdown
blocks with Unicode/newlines, failed writes, explicit retry and a subsequent burst.
All 78 focused and 848 full Node checks pass, with no failures or skips. Lint and
nonincremental TypeScript pass. A one-worker/1024 MiB heap Web build passes compilation,
TypeScript, all 14 static page generations and dependency collection. Two browser cases were added for actual keyboard
typing, durable reload and final save at 375px/zh-CN and 1440px/en-US. Six files
discover 54 cases; zero ran. They do not assert a particular write count because
real storage latency is not controlled by those cases.

The first Corepack probe also reported ENOSPC during its cache write, and C: had zero
free bytes. Direct Node independently reproduced the assertion. A later read-only
check found about 9 GB available; no cleanup was performed by this task. The report
preserves both observations without attributing the space recovery to a cause.

The API schema, draft expected-version transactions, reload/revision comparisons,
existing save feedback and Reader position logic are unchanged. Whole-note serialization
and rendering cost remains for each actual write/render; no device CPU/RSS improvement
percentage is claimed. Browser behavior and real storage performance remain pending.

The [additive local checkpoint](ux-audit-notebook-draft-write-queue-2026-10-13-evidence/local-verification.json)
binds the current sources and verification logs. Previous ledgers remain unchanged.
No commit, CI submission or deployment was performed; the broader goal remains active.
