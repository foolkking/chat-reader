# UX quick review — project archive feedback

2026-10-09 · Existing Web sidebar action for ordinary readers · Report delivered before application edits.

## Scope and evidence

Review **Archive project / 归档项目**, its confirmation, acknowledgement and recovery.
This is a secondary organizing task for people who want to keep their conversations
but put a project aside. Evidence is the current `project-action-menu.tsx` on parent
a12ce9e, the sidebar/frame, project API/service and neighboring local recovery work.
No running application, production account, browser or PostgreSQL fixture was used.
Source statements are observed; rendering, focus and real failure frequency are inferred.
This is not a redesign, accessibility conformance audit or new task system. Deletion,
Reader, Share, offline formats, cross-tab admission and cross-navigation request
persistence are outside this patch.

## The three things that matter most

1. A confirmed archive stays busy until unrelated list refreshes finish.
2. A lost archive response is called a failure and offers a blind write retry.
3. Confirmation has no synchronous admission guard or current-scope recheck.

These are feedback and request-admission defects, not evidence of lost messages.
The API preserves project membership when archiving. Repeated archive PATCH does
update timestamps and related conversation revisions, so avoiding unnecessary
replay matters even when the final archived flag is the same.

## Findings and ordered backlog

| ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| FBK-01 | Confirmed archive waits for sidebar refreshes without independent acknowledgement | Feedback / perceived performance | Medium | Observed (code); visible delay Inferred | S |
| ERR-01 | Unknown write outcome has no read-only check and invites another PATCH | Recovery / state coverage | Medium | Observed (code); production frequency unknown | M |
| ERR-02 | Re-entered or stale confirmation lacks a fresh admission check | Error prevention | Medium | Observed (code); event timing Inferred | M |

### FBK-01 — separate acknowledged writes from follow-up reads

Location: `apps/web/features/projects/project-action-menu.tsx:35–38` and
`project-sidebar.tsx:343–350`. `await updateProject(...); await onChanged()` keeps
`pending` true until four invalidation promises settle. The canonical PATCH
response is discarded. A reader who has already archived a project must wait
through refresh retries before the menu finishes; with retained cached data,
the old project remains offered during that wait.

Acknowledge the confirmed response immediately and update existing project caches
before a detached, handled refresh. Keep the result outside the row and outside
the list's fetch-wide busy region. Ordinary `invalidateQueries` failures resolve
by default: **do not claim an ordinary GET 503 invokes this catch**. A thrown
`onChanged` is a separate defensive test, not a reproduced current transport path.

### ERR-01 — check an unknown result before replaying it

Location: the same menu `:37,65`. Any rejected PATCH shows **“Could not archive
this project. Try again.” / “归档失败，请重试。”**, then re-enables Archive. There
is no result check. A server may have committed before the response was lost,
so this instruction cannot establish that another archive is needed.
`apps/api/app/services/projects/project_service.py:178–187` resets the archive
timestamp and bumps related conversation revisions on each archive update.

Use **“Archive could not be confirmed. Check the result before retrying.” /
“暂时无法确认归档结果，请先核对再重试。”** and **Check archive result / 核对归档结果**.
Read the existing owner-scoped `getProjects({ includeArchived: true, sort:
"custom", direction: "asc" })` endpoint, without any PATCH. Distinguish archived,
still active and unavailable. Failed checks remain uncertain; only an explicit
new archive with confirmation may retry an active project.

The notice and request state must outlive the menu/row and closing the mobile
drawer. `ReaderSidebarFrame:31–58` renders separate mobile and desktop children;
keep one state owner in `ProjectSidebar`, not in each menu copy. This owner is
still instance-local, not durable across a full page navigation.

### ERR-02 — reserve before confirmation, then recheck scope

Location: `project-action-menu.tsx:30–35`. The initial guard reads captured
`pending`, which is set only after `dialog.confirm` resolves. It does not reserve
the action while confirming or check that the original project remains active
and accessible afterwards. The interaction provider has one resolver slot
(`components/interaction-dialog-provider.tsx:31,47–51`), making duplicate prompts
particularly undesirable; stranded browser promises have not been observed.

Reserve one sidebar archive action synchronously before showing confirmation.
After it resolves, recheck mounted ownership, latest project availability and the
active/non-default target. Ignore stale callbacks and late responses after owner
unmount. Keep existing confirmation wording about conversation preservation and
the normal menu keyboard/DnD boundary. This is not an atomic server precondition.

## Implementation brief and what stays unchanged

Intent: let an ordinary reader put a project aside, see what actually happened
and recover without repeating an uncertain write. Palette: the approved paper,
graphite and sea-green tokens, with existing semantic warning/danger meanings;
no new values. Depth/surfaces: a flat bordered notice beside the project section,
not another modal or global task. Typography: existing app stack, text-sm working
copy and existing labels. Spacing: the 4px scale and 44px recovery controls.
`.interface-design/system.md` remains the approved design.

Use a small local controller exported with the project-menu module and owned by
the existing sidebar, following neighboring archived-list recovery patterns.
Menus delegate archive requests and retain settings. Remove an acknowledged
archived target from active project caches; update existing include-archived
records without inventing missing records or reordering others. Never put an
archived target into active move/search choices. Fresh reads remain authoritative
for conversation membership and offline revisions.

Rejected alternatives: recovery in a disappearing row loses its entry; waiting
for whole-sidebar refresh confuses read and write completion; automatic PATCH
replay cannot establish that a write is needed. No new dependency, API, migration,
global registry, token, route or format is required. Preserve DnD placement/revision
functions and existing hrefs.

## Verification plan and open questions

First execute the current component with synthetic transport, confirmation and
hook scheduling. Preserve the failing baseline and passing controls. Then verify
actual compiled controller/menu callbacks, installed QueryClient/Observer transitions
and static markup: held writes/reads, exact PATCH scope, one confirmation, cancel,
late completion, current-scope fencing, read-only recovery and cache separation.
Add discoverable browser assertions to the existing synthetic follow-up suite;
do not launch it under the current local Web restriction.

Real focus restoration, responsive layout, announcements and cross-device timing
remain **NOT_VERIFIED**. No rendered checklist score is justified. Older source
hashes remain historical; a new checkpoint owns changed shared-file hashes.
No commit, push, CI, deployment, service startup or fixture restart is authorized.

## Controlled pre-edit baseline

The [baseline](ux-audit-project-archive-feedback-2026-10-09-evidence/baseline.json)
records **4 passed / 16 failed / 0 skipped / 0 cancelled**, 697.2523ms across
20 checks. These are three findings, not sixteen defects. The tests execute the
actual original menu callbacks/static JSX and an installed subscribed QueryObserver;
confirmation, transport, hook scheduling, portals and focus are explicit doubles.
The four passing controls preserve healthy PATCH scope, cancellation, held-write
disabling and ordinary non-throwing GET invalidation failure. The latter directly
limits FBK-01: a held refresh delays completion, but an ordinary GET failure does
not establish a false archive-failure message. The report's initial combined patch
failed to match an index line and made no changes; it was reapplied correctly before
this baseline. Application code was unchanged until after the report and baseline.

## Local implementation and checkpoint

All three findings are locally repaired. One `useProjectArchive` owner in
`ProjectSidebar` serves both menu copies; the flat `ProjectArchiveFeedback` stays
outside the project list's fetch-wide busy region. Confirmed responses update
existing project caches before detached refresh. Active move/search choices remove
the archived target; existing include-archived records retain canonical metadata.
No absent cache is invented and conversation data is not optimistically rewritten.

Unknown outcomes allow only an explicit owner-scoped full-project GET. Failed
checks stay uncertain; active results allow another explicit confirmed action;
missing results remove only that target from existing project caches. Menu closure
and mobile drawer closure do not erase the owner. Owner unmount fences callbacks,
but does not cancel a request already sent or retain recovery across navigation.
Source-level guards are not atomic server or cross-tab admission guarantees.

| Check | Result / boundary |
| --- | --- |
| First repair, unchanged baseline checks | **20 passed / 0 failed / 0 skipped / 0 cancelled**, 686.5225ms |
| Expanded project-archive checks | **43 passed / 0 failed / 0 skipped / 0 cancelled**, 823.0833ms |
| Combined local Node suites | **248 passed / 0 failed / 0 skipped / 0 cancelled**, 2937.0355ms; new 43 + preceding 205 |
| Web lint | Passed after final application/browser-test edits |
| Independent typecheck | `corepack pnpm --filter web exec tsc --noEmit --incremental false` passed |
| Bounded Web build | Next 16.3.8, `NEXT_BUILD_CPUS=1`, `NEXT_STANDALONE=0`; compile 19.6s, built-in TypeScript 9.5s, 14 pages generated |
| Previous API evidence | 41 SQLite passes apply only to unchanged backend files; not rerun here |
| PostgreSQL concurrency | Two earlier skipped cases remain **NOT_VERIFIED** |
| Browser discovery | **43 discovered / 0 executed**; six new cases at 375px Chinese/light and 1440px English/dark |
| Source/evidence consistency | 34 current hashes, seven unchanged API hashes and 17 unchanged placement/query declarations; one owner and feedback outside fetch-busy section verified from AST, not runtime |
| Documentation/diff | 22 files / 266 local links / 0 missing; diff check passed with existing CRLF notices only |
| Visual checklist | **NOT_VERIFIED**, no rendered score, focus/drag or accessibility acceptance claim |
| Release state | Uncommitted; no push, CI or deployment; accepted production remains 30a0d32 |

The six browser cases require confirmed feedback while actual reads remain held,
the removed project's notice/focus, and no fetch-busy ancestor. Applied/unapplied
response-loss cases close/reopen menus or the mobile drawer, fail a read-only check,
then distinguish existing archive from a still-active project requiring explicit
retry. They assert original PATCH payloads, preserved synthetic message JSON and
project relations, Unclassified visibility and exactly one applied revision bump.
Only discovery ran: no screenshot, browser request, server start or fixture write
was produced by this batch.

The first combined run passed 248 checks in 3471.0667ms. Final test review added
an explicit disabled-archive assertion during a held write and rerendered after
an attempted busy dismissal; the same 248 cases passed again as recorded above.
No application or browser-test code changed after lint, typecheck and build.

The [local evidence](ux-audit-project-archive-feedback-2026-10-09-evidence/local-verification.json)
owns exact current source hashes. Older 54/93/121/161/205 snapshots remain historical
as shared source/test files advance. The design skills kept the existing tokens and
flat status pattern; the document skill separates current behavior from checkpoints.
