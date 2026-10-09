# UX quick review — sidebar read recovery

2026-10-09 · Existing Web navigation for ordinary readers · Source report before application edits.

## Scope and evidence

Audit the existing sidebar's project list, expanded project conversations and
Unclassified list. Readers use these to resume reading or organize their saved
conversations without leaving the current page. Evidence is the current
`project-sidebar.tsx` on parent a12ce9e and the neighboring locally repaired
conversation/project/archive lists. Source conditions are observed; rendering,
focus, drag timing and real outage frequency are inferred, not measured. No
production, local service, browser or PostgreSQL fixture was accessed.

This is a narrow state/recovery review, not a sidebar redesign, a full product
audit or an accessibility conformance claim. Mutation admission, project creation,
archive-menu lifecycle, drag placement and the Reader are not redesigned here.

## The three things that matter most

1. A failed Unclassified refresh removes already known reading links and drop
   rows, with only “加载失败” and no local read retry.
2. A failed initial expanded-project read displays “拖动对话到这里”, the same
   hint used for a successfully empty project. A stale failure has no notice.
3. Project-list failure exposes `error.message` but offers no in-place Retry.

These are recoverable navigation defects, not observed loss of conversation
data. Keep the existing current-query caches and the current reading route.
Each affected region should retry only its own GET, retain known rows during
temporary failures, and distinguish unavailable access from retained stale data.

## Findings

| ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| STATE-01 | Failed Unclassified refresh hides cached reading links and drop rows | State coverage / recovery | Medium | Observed (code + QueryObserver/static markup); runtime continuity Inferred | S |
| STATE-02 | Failed expanded-project read claims a drop-ready empty result, or silently retains stale content | State coverage / copy | Medium | Observed (code + QueryObserver/static markup); browser effect Inferred | S |
| ERR-01 | Sidebar project errors lack a scoped retry and use upstream message text | Error recovery / copy | Medium | Observed (code + synthetic error/static markup); real error wording Inferred | S |

### STATE-01 — keep known Unclassified rows

Location: `apps/web/features/projects/project-sidebar.tsx:338,472,735–740`.
`HistoryDropZone` requires `!loading && !error` before rendering cached rows or
their insert slots. The error path has only “加载失败”. A reader loses the known
way back to a conversation until another read succeeds, even though Query still
has the data. This also removes the existing drag targets; actual drag behavior
has not been reproduced.

Render current-query rows independently of transient error and show
**“Could not update conversations. Previously loaded items are shown.” /
“对话更新失败，仍显示上次内容。”** with **Retry / 重试**. With no cached rows, use
**“Could not load conversations.” / “对话加载失败。”** instead of an empty-state
claim. Scope retries to the history query; never clear the cache, navigate away,
invoke a mutation or replay placement as a retry. Keep permission-denial hiding.

### STATE-02 — separate project read failure from empty guidance

Location: the same file `:695–715`. `ProjectBranch` renders its drop hint whenever
it is not loading and has no rows; it does not inspect `isError`. A first read
failure therefore enters the same branch as a successfully empty project. With
cached rows, failure is silent. The person cannot tell whether their project's
conversations were read at all and has no retry beside the project.

Only a successful empty read should show **“Drag conversations here” /
“拖动对话到这里”**. A failed read gets **“Could not load project conversations.” /
“项目对话加载失败。”**; with retained rows, use **“Could not update project
conversations. Previously loaded items are shown.” / “项目对话更新失败，仍显示上次内容。”**.
Retry only this project's read, preserve its expanded state and real links, and
localize the existing loading text. Do not change project membership or drag
placement contracts.

### ERR-01 — make project-list read recovery local and understandable

Location: the same file `:337,469,647–668`. Known project rows already remain
mounted during a read refresh, which is intentional for sorting. A failure adds
`projectsQuery.error.message` in a paragraph but no Retry. Readers can keep using
some old rows, but cannot request a new project list without another navigation
or browser refresh. An upstream message is not a localized recovery instruction.

Reuse the same small inline read-error treatment: **“Could not update projects.
Previously loaded items are shown.” / “项目更新失败，仍显示上次内容。”** or, without
cached rows, **“Could not load projects.” / “项目加载失败。”**. Retry only this
project-list GET. Hide retained private rows at HTTP 401/403/404 rather than
treating those as transient stale content. This is a defensive UI boundary, not
a claim that a production authorization leak has been observed.

## Quick wins and implementation brief

Work in the table order, sharing one small local error/retry component across
the three regions. The neighboring conversation-list and archived-project code
already use this retained-read pattern; no new data cache, dependency, API or
page is needed. Busy indicators belong to the affected data region; a read retry
does not need to block navigation or other project queries.

Intent: let a reader keep their place and deliberately refresh the affected
part of the reading desk. Palette: existing paper `bg-surface`, graphite
`text-secondary`, `border-ui` and the existing sea-green action tokens, so both
themes remain coherent. Depth/surfaces: the current flat sidebar with a quiet
bordered error region, not another dialog. Typography: existing text-sm rows and
text-xs helper copy, preserving the app font stack. Spacing: the existing 4px
scale, with a 44px Retry target. No new tokens or visual direction is proposed.

Rejected alternatives: a global refresh unnecessarily reloads unrelated regions;
silent cached content conceals read failure; a full-sidebar error discards useful
navigation. The local Retry and explicit retained-content message meet the same
goal with the existing architecture.

## Verification and what stays unchanged

Add controlled actual-component/QueryObserver checks before editing application
code. Cover each region's initial, cached, empty, held-retry and recovered states;
localized copy; no raw upstream detail; access-denial hiding; unchanged query
scope and read-only retry; and retained actual links/drop identifiers. Static
markup and callback tests cannot establish real DOM identity, focus or drag
timing. Add browser assertions to the existing isolated follow-up file, but only
discover them while the local Web start restriction remains.

Keep the existing DnD sensors, placement mutations/revision checks, sort keys,
route links, project creation, archive actions, shared query ownership and user
data intact. `AddToProjectControl` has no current call sites and is deliberately
not treated as a user-facing defect. Archive-menu feedback needs a separate
evidence-backed review; it is not folded into this patch. Visual checklist,
real-browser and PostgreSQL acceptance remain **NOT_VERIFIED**. No commit, CI,
deployment, service startup or fixture restart is authorized.

## Controlled baseline before application changes

The [baseline](ux-audit-sidebar-read-recovery-2026-10-09-evidence/baseline.json)
records **8 passed / 33 failed / 0 skipped / 0 cancelled**, 1472.9144ms across
41 contract and control cases. These are three findings, not 33 separate defects.
The actual compiled full sidebar and its inner branch/history markup execute
against installed subscribed QueryObservers. Actual query callbacks call explicit
synthetic transport; expansion, DnD, effects and unrelated children are doubles.
Passing controls preserve successful real links/drop ids/query scopes, the
already-retained project/branch caches and collapsed-branch query disabling.

The first test setup failed before contract execution because an AST visitor did
not handle destructuring declarations without initializers. That harness error is
recorded, corrected and excluded from product findings. The first desired-contract
run then had 2 passes/33 failures; adding six passing controls produced the above
41-case baseline without changing application code or weakening any assertion.

## Local implementation and final checkpoint

All three scoped findings are repaired locally. Existing query caches and stable
row keys are retained, read errors are localized with a shared small Retry region,
and each retry repeats only its owning GET. Named regions expose their own fetch
state without disabling navigation. Permission-denied rows and archived/default
project records do not masquerade as available active rows. A failed initial
project read no longer shows empty drop guidance; Unclassified's unknown count
does not claim zero. DnD sensors, placement/revision code and mutation callbacks
are unchanged. Retention is current-query scoped, not a guarantee after a new sort
key fails with no cached data.

| Check | Result / boundary |
| --- | --- |
| First sidebar repair | **41 passed / 0 failed / 0 skipped / 0 cancelled**, 1229.619ms |
| Combined local Node suites | **205 passed / 0 failed / 0 skipped / 0 cancelled**, 3541.3467ms; 41 sidebar + 3 fixture-cleanup + previous 161 |
| Web lint | Passed after final application/browser-test changes |
| Independent typecheck | `corepack pnpm --filter web exec tsc --noEmit --incremental false` passed |
| Bounded Web build | Next 16.3.8, `NEXT_BUILD_CPUS=1`, `NEXT_STANDALONE=0`; compile 26.2s, built-in TypeScript 9.1s, 14 pages generated |
| Previous API evidence | 41 SQLite passes apply to unchanged backend implementation/test files; no rerun or PostgreSQL restart |
| PostgreSQL concurrency | Two earlier skipped cases remain **NOT_VERIFIED** |
| Browser discovery | **37 discovered / 0 executed in this batch**; eight sidebar assertions added to the previous 29 |
| Source/evidence consistency | 32 current hashes and seven unchanged API hashes verified; 17 placement/query declarations match HEAD text, not runtime drag proof |
| Documentation/diff | 21 files / 261 local links / 0 missing; diff check passed, existing CRLF notices only |
| Visual checklist | **NOT_VERIFIED**, no score or accessibility/DOM/focus/drag acceptance claim |
| Release state | All new changes uncommitted; no push, CI or deployment; production remains 30a0d32 |

The eight new browser cases use 375px Chinese/light and 1440px English/dark.
The intended scenarios require each region to retain an actual link node and focus
through an injected read failure, then require held Retry's own busy state, the
same node, unchanged other read counters and zero mutation requests. Two initial expanded-project cases reject
empty guidance and recover within the expanded branch. The intended checks compare
synthetic message JSON and real project/Unclassified membership. They generate
screenshots only when eventually executed; no image or live browser evidence was
produced here. Reconnect clocks explicitly exceed the unchanged 15-second default.

Review also corrected the earlier browser fixture cleanup: the existing backend
requires an archived project before deletion, including after a successful restore.
The [preceding audit's counter-evidence and helper baseline](ux-audit-archived-project-recovery-2026-10-09.md#subsequent-fixture-review-and-backend-counter-evidence)
preserve that discovery and its 1-pass/2-fail test result. Three actual helper
callback checks now pass with an explicit transport double; no product deletion
guard was weakened and no browser assertion was removed. The first application
patch attempt matched an incorrect function signature and made no changes; the
corrected patch was applied before the passing run.

The [current local evidence](ux-audit-sidebar-read-recovery-2026-10-09-evidence/local-verification.json)
owns exact source hashes and final verification totals. Older 54/93/121/161-case
snapshots remain historical even though their shared browser file has moved on.
Continue with separately scoped project-action feedback review; do not treat the
unverified browser/DnD behavior as accepted or trigger another release cycle.
