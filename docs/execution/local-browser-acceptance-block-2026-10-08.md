# Local browser acceptance checkpoint — 2026-10-08

Subsequent user authorization resumed the goal and specified a Chromium binary.
The [runtime preflight follow-up](specified-chromium-preflight-2026-10-08.md)
records that newer state. The blocked status below describes this checkpoint.

Status: goal blocked pending an allowed local Web startup; not complete.
The user explicitly requires local-only testing and permits the in-app browser.
No commit, CI, deployment or local image build occurred.

## What was verified

The preceding goal turn made progress: Task Center recovery was implemented,
33 focused API cases passed, Web static/build checks passed, and contracts and
aggregate evidence were reconciled. Those completed checks are retained in
[the recovery record](offline-task-recovery-2026-10-08.md).

The current follow-up inspected the pending noise selection/reload path, local
download retry/ownership guards, new Task Center entry and test configuration.
There is no live process handle to wait on. The isolated test ports were checked
and had no listeners; staging was empty and HEAD remained unchanged. No speculative
product change or repeated completed test gate was used to replace runtime evidence.

The in-app browser connected. Before the user's local-only clarification, it
opened the deployed login and email-verification pages without submitting forms,
entering credentials or changing remote data. Both tabs were closed immediately
after the clarification. These observations do not validate the current worktree.
The request to sign in online is withdrawn; no production login is needed.

After the clarified local direction, the original command was attempted once:

```text
corepack pnpm --filter web exec next start --hostname 127.0.0.1 -p 3107
```

It used the existing task TEMP/TMP, test authentication and the already-built
loopback API upstream on port 8008. Automatic review rejected it before process
creation with only `blocked by policy`. No reason beyond that string was supplied.
No alternate launcher, port, container or test-managed startup was attempted. API,
worker and PostgreSQL were not restarted after this rejection.

## Remaining work and resumption

- Eight noise-selection and eight offline-recovery cases remain unexecuted.
  Their actual saves, ZIP downloads, IndexedDB state, failure-page focus and
  responsive layouts require the local instance; discovery is not a pass.
- Earlier API/PostgreSQL evidence remains valid for its recorded scope. Three
  historical real-data fixture cases and the Windows symlink case still require
  their separate unavailable prerequisites. Do not replace them with invented
  fixtures or weaken the assertions.
- The wider user/system UX optimization objective remains open. Current source
  checks are not evidence that every requested page is satisfactory.

The same startup blocker has persisted across three resumed goal turns, including
the two turns that made independent code/test/documentation progress. The next
required verification cannot proceed without an external change allowing the local
Web startup. Marking the goal blocked records this prerequisite; it does not mark
the features or overall objective complete.

On resumption, inspect actual listeners/process handles before starting anything.
Reuse the named task-owned database after checking its existing 0050 migration;
do not reinitialize it, delete data, or rerun a database-creation script that
deliberately refuses an existing database. Keep `API_INTERNAL_URL` consistent with
the build and use the in-app browser only for the local target. Existing worktree,
temporary evidence, imports and unrelated files remain untouched.
