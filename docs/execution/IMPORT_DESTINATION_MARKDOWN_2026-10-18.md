# Plain Markdown and contextual file-drop enhancement — 2026-10-18

## Scope

This is a local continuation of the adaptive-import stability work. It adds:

- a deterministic fallback for ordinary Markdown with no reliable repeated
  message boundary;
- default `assistant` role for that fallback, with the complete source retained
  as one message;
- route-aware file dropping on the owner shell and its sidebar Import button;
- persisted import destination selection for an adaptive session;
- server-side ownership and archived-project validation.

No migration, CI run, push or deployment was performed.

## Destination rules

| Entry surface | Initial destination |
| --- | --- |
| All-conversations surface | Unclassified |
| Project page | That active project |
| Reader opened with `projectId` context | That project |
| Direct Reader URL after its conversation metadata loads | The conversation's actual project, or unclassified |
| Sidebar Import button | The same route/project context |
| `.cr` file | Existing archive preview/restore flow, with the captured destination |

The import dialog displays the destination and permits choosing unclassified or
an active custom project. For an adaptive session, a change is saved through
`PUT /api/adaptive-import/sessions/{id}/destination`. After canonical commit
starts, the destination is locked. The API rechecks ownership and archive
status; the browser is not the authority.

## Markdown fallback

The analyzer only uses this path after the normal Markdown parser reports
`NO_MESSAGE_STRUCTURE`. It does not override instruction/context package
guards, empty input, encoding errors or an unclosed fence. The complete UTF-8
source becomes one assistant message, and the first H1/filename title logic is
reused. The special built-in mapping avoids inventing a boundary and remains
compatible with the existing normalization and canonical persistence path.

## Verification

- `apps/api/tests/test_adaptive_import_api.py`: **37 passed**.
  This includes direct plain-Markdown normalization, worker-completed
  single-assistant sessions, initial project placement, destination changes
  before commit, unavailable destination rejection, and the existing artifact
  replacement cases.
- Web lint: **passed**.
- Web typecheck: **passed**.
- Web production build: **passed**.
- Import lifecycle/source regression files
  (`import-background-analysis.test.mjs` and
  `import-session-restore-recovery.test.mjs`): **17 passed**.
- Alembic heads: one head, `20261017_0052`.
- `git diff --check`: passed.
- A Playwright drag/drop case was added to
  `apps/web/e2e/import-markdown.spec.ts`, but was not accepted as executed in
  this environment. The local PostgreSQL schema is behind the current ORM:
  starting the worker failed because `export_artifacts.lifecycle_state` is
  absent. No migration was run against that database. Therefore mounted
  browser behavior remains pending a disposable/current-schema environment.

## Safety and remaining boundary

The implementation keeps the existing durable background-analysis flow; it
does not move all adaptive routes into the worker. It also does not claim that
the earlier production OOM was caused only by noise scanning. The new browser
drop path is source-verified and has an authored real-interaction test, but
production data, current-schema browser execution and release acceptance remain
outside this local continuation.
