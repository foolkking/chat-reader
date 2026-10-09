# UX audit — archived-project read and restore recovery

2026-10-09 · Local continuation after the 121-case list checkpoint · Report before application edits.

## Scope and evidence

This is the existing Web `/archived` project section for ordinary readers
organizing a private conversation archive. Scope: retained read states, project
restore acknowledgement and recovery, and the existing shared batch-result
owner. The confirmed container-deletion result uses that same owner; deletion
semantics, conversation data, auth, Reader, Share, offline storage, backend,
dependencies, design tokens and deployments are not being redesigned.

Evidence is source, installed QueryObserver/MutationObserver transitions,
compiled component callbacks and React static markup. The
[pre-edit baseline](ux-audit-archived-project-recovery-2026-10-09-evidence/baseline.json)
records **9 pass / 21 fail / 0 skip / 0 cancelled**, 650.7178ms across 30 desired
contract cases. State/ref/effect scheduling, transport/server rows and unrelated
children are explicit doubles. A simulated server row is not a PostgreSQL or
real-browser result. No services, production data or browser were accessed.
Focus continuity, layout, real usage frequency and accessibility conformance
are not established by these tests.

## What matters most

A failed project-list refresh hides cached archived rows and their selection.
Successful single restoration waits for follow-up reads and has no persistent
completion message. Bulk results exist but disappear when the last archived
project leaves the list. A lost restore acknowledgement says the project is
still archived even when the synthetic transport model already applied it.
These are recoverable secondary-path problems, not observed data loss. The
smallest useful repair reuses existing project caches, read-only list refresh
and the current inline status pattern.

## Findings and priority

| ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| STATE-01 | Read failure hides known archived projects and selection | States / recovery | Medium | Observed (source + QueryObserver + static markup); browser continuity Inferred | S |
| FBK-01 | Confirmed restore waits for reads and completion disappears on the last row | Feedback / recovery | Medium | Observed (source + MutationObserver/callback + static markup); perceived wait Inferred | M |
| ERR-01 | Lost acknowledgement is presented as known non-restoration with a blind retry | Recovery / copy | Medium | Observed (source + simulated transport + callback/static markup); real outage unobserved | M |
| ERR-02 | A project leaving the archive stays in actionable selection, including through deletion confirmation | Recovery / selection | Medium | Observed (source + QueryObserver/callback/static markup); cross-device/browser race unobserved | S |

The original 21 failed cases cover the first three findings and defensive callback
contracts; ERR-02 was recorded later, before its own correction. The failed cases
are not separate UX defects. Work in table order, with shared result
ownership implemented once.

### STATE-01 — preserve known rows during transient refresh errors

Location at the baseline hash: `apps/web/features/projects/archived-project-list.tsx:39,118–125`.
The `isError` early return renders only **“Could not load archived projects”**
even when the actual query observer still holds the prior project array.
Selected rows disappear from static markup too. A person checking an archive
temporarily loses their known project context until the read succeeds.

Reuse the project-conversation/Recent/list pattern: retain cached archived rows,
show **“Could not update archived projects. Previously loaded projects are shown.” /
“项目更新失败，仍显示上次内容。”**, and provide read-only **Retry / 重试**.
No cached rows means an initial error, not known emptiness. Preserve HTTP
401/403/404 hiding and keep the successful empty/no-notice section compact.

### FBK-01 — acknowledge canonical writes independently of refresh

Locations: the same component `:27–38,73–85,106–124,151`.
After a successful single PATCH, an actually held observer read leaves the real
MutationObserver `pending`. Existing project cache variants still hold archived
metadata until their own reads finish. The last-row single success has no result;
the seeded batch completion and actual batch-container-deletion result disappear
through the empty branch. Someone who restored the last project cannot tell
the result from the section simply vanishing.

Publish confirmed ProjectRead responses to existing caches after cancelling older
reads, announce **“Project restored.” / “项目已恢复。”**, and refresh independently.
Keep one inline result owner outside loading/empty/error content. Preserve
confirmed bulk counts and failed-item selection; remove only acknowledged deleted
containers from cache, keeping the existing conversation-preservation wording.
Keep pending writes distinct from background fetching. Restore only lost focus
when an affected control disappears; never pull it from a newly chosen control.

### ERR-01 — check uncertain restoration before offering another write

Locations: the same component `:29,30,76–82,166–173`;
`apps/web/lib/api.ts:763–780`; `apps/api/app/api/routes/projects.py:45–65,87–98`.
The write transport double changes its synthetic row, then loses the response.
The rendered message still says **“Restore failed. The project is still archived;
try again.”** and leaves Restore enabled. The result is unknown, not proof of
either state, and the existing owner-scoped full project-list GET can check it.

Use **“Restore could not be confirmed. Check the result before retrying.” /
“暂时无法确认恢复结果，请先核对再重试。”** and an explicit **“Check restore result” /
“核对恢复结果”** action. Keep unresolved ids in this mounted section and fence new
restores/deletes while checking is required. A successful full-list read can
distinguish restored, still archived and unavailable; unavailable is not a claimed
restore. Failed reads keep uncertainty. Only an explicit new user action may retry
known still-archived projects. No new API, idempotency store, task or persistence
layer is needed for this idempotent metadata change.

**Important counter-evidence:** a real Query invalidation with a failing query
passes the baseline control: default `invalidateQueries` swallows read errors,
so it does not invoke mutation `onError`. The earlier source hypothesis that
ordinary refresh failure itself caused the “still archived” message is rejected.
Held refresh delays and lost-write-response misreporting are separate evidence.
Same-turn duplicate callbacks and deleting while restore is pending are controlled
callback checks, not independently observed browser races.

## Narrow implementation brief

Intent: a person returning a project to their reading workspace needs a truthful
result, with the previously known archive still available during a read failure.
The existing Web direction is already established; no platform or visual redesign
decision is being reopened. Reuse paper `bg-surface`/`bg-subtle`, graphite
`text-secondary`, `border-ui`, existing semantic danger and sea-green actions.
Flat bordered working rows and one inline status preserve the archive-workbench
hierarchy. Keep existing font stack, text-sm/text-xs, 4px spacing, and 44px
recovery targets. No new color, shadow, typeface or component library.

Rejected alternatives: full-page errors discard useful context; silent stale rows
hide read failure; a separate local data cache adds account/lifecycle ambiguity.
For restoration, automatic retries hide uncertainty, a blocking dialog interrupts
an already complete write, and a new backend receipt service is disproportionate
to an existing idempotent boolean PATCH. Use the existing query and inline result.

## What stays intact and verification backlog

Keep the current permanent-deletion confirmation and its promise that conversations
remain in Unclassified. The delete API and retry semantics are not redesigned;
only shared busy/result/cache handling is covered. Preserve project ownership,
archived filtering, failure selection, all earlier merge/list changes and existing
files. A successful empty section with no result still takes no extra space.

Run this 30-case suite with the four earlier Node suites, lint, nonincremental
typecheck and the bounded one-worker Web build. Add local-only browser assertions
to the existing isolated follow-up suite for retained rows, held-refresh
acknowledgement, lost-response read-only checking and source-message invariance at
375/1440px. Discovery is not execution. No Web/fixture restart, CI or deployment
is authorized. Visual checklist, real focus and PostgreSQL acceptance remain
**NOT_VERIFIED**; keep exact failed and passing source checkpoints separate.

## First implementation and review checkpoint

The first repair passes all **30 cases**, 733.7758ms, and Web lint. Follow-up
review adds six narrower contracts; **33 pass / 3 fail**, 751.0355ms. The
[review baseline](ux-audit-archived-project-recovery-2026-10-09-evidence/review-baseline.json)
was saved before correcting them: the result region is still under fetch-wide
`aria-busy`, explicit Check is unnecessarily disabled behind an older background
read, and the controlled focus callback clears its owner before delayed row
removal. Scope busy semantics to the data region, allow the explicit check to
cancel an older read, and retain the focus owner until removal or another chosen
control. These refine FBK-01/ERR-01; the semantics and focus doubles do not prove
actual screen-reader or browser timing. Unmount fencing, no focus stealing and
same-turn Check deduplication already pass the added controls.

### ERR-02 — scope selection and confirmed deletion to current archived rows

Locations before this correction: `archived-project-list.tsx:21,42–46,78–101,166–169,189–204,255–271`.
A successful query refresh changes a synthetic selected project to active while
another archived row remains. The actual static toolbar still counts the old
selection, and retained single/bulk Restore callbacks still submit it. Holding
the existing confirmation callback, refreshing that membership, then confirming
also invokes container deletion for the now-active project. These are source and
controlled QueryObserver/callback observations, not a reproduced cross-device race.
The [additional baseline](ux-audit-archived-project-recovery-2026-10-09-evidence/selection-baseline.json)
is **36 pass / 4 fail**, 782.8356ms, with no skipped/cancelled cases.

The user consequence is stale action scope: the visible list no longer shows the
project they are about to operate on. Container deletion is irreversible even
though conversation contents are preserved, so a cached invisible selection is
not a valid reason to continue. Derive actionable selection from visible archived
ids, fence retained callbacks against the latest rendered membership, and recheck
all requested ids after confirmation. If the scope changed, issue no deletion and
say **“The project list changed. Review the current selection and try again.” /
“项目列表已更新，请检查当前选择后重试。”**. Do not silently change a confirmed
bulk scope or turn a transient read error into deselection; retained rows remain
valid until a successful current read or an access-denial boundary says otherwise.
This is a latest-rendered-scope guard, not an atomic server-side precondition or
a claim to prevent every cross-device change between a read and a write.

## Final local implementation and verification checkpoint

All four findings are implemented locally. Cached rows and selection survive
transient reads; canonical restore responses update existing cache entries after
cancelling older reads. Single/bulk acknowledgements no longer wait for refresh.
An independent inline result survives the final row and is outside data-region
`aria-busy`. Unknown restore outcomes require an explicit full-list GET; a failed
check keeps uncertainty, missing projects are unavailable rather than "restored",
and only an explicit later action retries known archived projects. Synchronous
guards fence duplicate callbacks; unmounted responses cannot publish local results.
Derived current selection and the confirmation-time recheck prevent actions on
ids absent from the latest rendered archive without claiming server atomicity.

| Check | Result / boundary |
| --- | --- |
| Combined Node suites | **161 passed / 0 failed / 0 skipped / 0 cancelled**, 2943.401ms; 40 archived + 28 list + 43 merge + 21 project + 29 re-entry |
| Earlier local run | 161 passed, 2616.3969ms, before adding the two browser-only confirmation cases; not additional unique coverage |
| Web lint | Passed after the final application and browser-test changes |
| Independent typecheck | `corepack pnpm --filter web exec tsc --noEmit --incremental false` passed |
| Bounded Web build | Next 16.3.8, `NEXT_BUILD_CPUS=1`, `NEXT_STANDALONE=0`; compile 15.7s, built-in TypeScript 6.9s, 14 pages generated |
| Earlier API evidence | 41 SQLite cases remain applicable to seven unchanged implementation/test files; not rerun here |
| PostgreSQL concurrency | Two earlier skipped cases remain **NOT_VERIFIED**; no fixture restarted |
| Browser discovery | **29 cases discovered / 0 executed in this batch**; ten archived-project cases added to the previous 19 |
| Visual scored checklist | **NOT_VERIFIED**; no rendered score, accessibility-conformance or actual focus-timing claim |
| Source/evidence consistency | 26 current hashes verified; seven prior API hashes unchanged; 54/93/121-case evidence retained |
| Documentation/diff | 20 scoped Markdown files, 256 local links, no missing targets; `git diff --check` passed with existing CRLF notices only |
| Release authority | Uncommitted, no CI and no deployment; accepted production remains 30a0d32 |

The ten browser cases cover 375px Chinese/light and 1440px English/dark: retained
checkbox node/focus/selection during injected failure and held Retry; confirmed
single/bulk restoration before held refresh completes; applied and unapplied
lost-response recovery with a failed check followed by read-only resolution; and
single/bulk confirmation after another synthetic client restores the target.
The latter require a real refreshed list before confirming, assert zero browser
mutation requests and preserve synthetic project membership/message JSON. These
are intended assertions, not executed evidence. The final-row tests filter actual
GET results to one fixture row as an explicit view double, not database emptiness.
Lost-response tests distinguish an actual synthetic PATCH applied before abort
from a request aborted before application. No screenshots were generated here.

The [final local evidence](ux-audit-archived-project-recovery-2026-10-09-evidence/local-verification.json)
owns exact checkpoint hashes, commands, failure history and validation totals.
Older merge/re-entry/list hashes remain unchanged historical snapshots; the shared
browser file has intentionally moved on. Default Query invalidation still swallows
ordinary read errors: held refresh and lost-write response remain distinct cases.
Do not turn these controlled callback checks into a claim of live React lifecycle,
screen-reader behavior, cross-device safety or a newly verified production release.

## Subsequent fixture review and backend counter-evidence

The next sidebar review inspected `project_service.py:204–207` and
`projects.py:103–111`: the existing API rejects deletion of a currently active
project with HTTP 422. ERR-02's controlled callback proves a stale deletion
**request attempt**, not successful deletion of an active project. Its client
guard avoids an invalid out-of-scope request and unnecessary rejection; it is
not the first protection against deleting an active project. The server check
does not establish a fully atomic cross-device transaction contract.

That same rule exposes a flaw in the unexecuted browser cleanup helper: after
restoration it tries to delete the synthetic active project without archiving it
again. The partial-creation cleanup has the same issue. A separate
[three-case helper baseline](ux-audit-archived-project-recovery-2026-10-09-evidence/fixture-cleanup-baseline.json)
has **1 pass / 2 fail**, 420.1489ms, using the actual compiled helpers and an
explicit transport double enforcing the existing rule. This is a test-fixture
defect, not a fourth/fifth product finding or a real API/browser test. Re-archive
only the exact synthetic fixture before cleanup DELETE; do not relax the service
guard or any behavioral assertion. The original 161-case/29-discovery snapshot
remains historical and is not rewritten to claim these browser cases had run.
Both helper failures now pass locally (**3 passed**, 409.8689ms). Reconnect probes
also advance 20 seconds, exceeding QueryProvider's existing 15-second stale time;
the previous 11-second advance alone could not establish staleness. This is a
source-driven test correction, not an observed browser failure or a change to the
application's cache policy. Subsequent aggregate acceptance belongs to the new
sidebar checkpoint, not this earlier source snapshot.
