# UX follow-on audit — recovery and navigation

2026-10-08 · Accepted application source `30a0d32` · Report delivered before fixes.

## Scope and evidence

This is a focused follow-on sweep of the existing desktop/mobile Web application,
not another full-product or visual redesign audit. The audience is ordinary users
organizing private conversation archives and returning to reading. Recovery must
be explicit; an archive operation is reversible, but its result must not be
misrepresented. Scope: conversation/project batch archive undo, search selection
and project filters, and Recent reading's refresh/progress states.

Evidence is source inspection plus three executable synthetic checks against the
accepted Git source: [reproduction script](ux-audit-post-release-recovery-2026-10-08-evidence/reproduce.cjs)
and [baseline result](ux-audit-post-release-recovery-2026-10-08-evidence/baseline.json).
The script executes the actual batch/order helpers and installed QueryObserver;
it makes no network requests and does not render components. Application source
at the documentation-only HEAD 31517c4 is identical to 30a0d32.

No production webpage was used. The original local Web-start policy refusal is
still unresolved; no alternative launcher was attempted. Existing accepted CI
screenshots do not cover these newly identified failure states. Their appearance,
focus and mobile layout need isolated CI browser verification after repair.
No accessibility-conformance or real-user failure-rate claim is made.

## The three things that matter most

Batch undo currently treats returned failures as completion, removing the user's
immediate retry path. Even a successful final-row archive removes the containing
list before its Undo control can remain visible. Search stores selection by array
index even though subsequent pages can insert a higher-priority group before it.
These are recovery and navigation defects, not reasons to add another settings
area. Two smaller read-failure states lose usable context or hide a missing
dependency, and Recent's progress lacks a programmatic name. The existing
design tokens and inline recovery patterns are sufficient for these repairs.

## Findings and priority

All six findings are defects; none is a taste preference. Effort estimates are
relative to the inspected components, not promises of elapsed time.

| Order / ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| 1 · ERR-01 | Batch undo dismisses despite failed items; duplicate undo requests are unguarded | Error recovery / status | High | Observed (code + synthetic helper execution); rendered effect inferred | M |
| 2 · ERR-02 | Undo is hidden when the conversation list becomes empty or its refresh fails | Recovery / state coverage | Medium | Observed (code); rendered effect inferred | S |
| 3 · NAV-01 | Grouped pagination changes the document selected by the same index | Navigation | Medium | Observed (code + executed ordering); browser activation inferred | S |
| 4 · STATE-01 | Recent replaces cached reading cards with a raw refresh error | State coverage / recovery | Medium | Observed (code + QueryObserver execution); rendering inferred | S |
| 5 · STATE-02 | Failed project-filter loading is presented like an empty project list | State coverage / forms | Medium | Observed (code); rendering inferred | S |
| 6 · A11Y-01 | Recent progress bars have values but no accessible name | Accessibility | Medium | Observed (code); screen-reader output untested | S |

### ERR-01 — retain the outcome of each undo attempt

**Location:** `apps/web/lib/batch-selection.ts:6`;
`apps/web/features/conversations/conversation-list.tsx:339` and `:560`;
`apps/web/features/projects/project-conversation-list.tsx:287` and `:484`.
The helper catches every item failure and resolves with `succeededIds/failedIds`.
All three batch undo closures discard that result; the two local `UndoToast`
implementations unconditionally call `onDone()` after awaiting the closure.
There is no pending guard or error branch. The synthetic check returns one
success and one failure without rejecting. The initial zero-success case also
creates a zero-item Undo, so the outcome handling is inconsistent throughout.

**User cost:** the person cannot tell which conversations remain archived and
loses the immediate retry even though undo was not complete. Repeated clicks can
issue overlapping writes. This does not delete conversation content, so it is
not graded as irreversible data loss.

**Recommendation:** share the existing inline Undo presentation, acknowledge
pending work, retain only unresolved items, expose concise failed/remaining counts
and retry, and dismiss only on complete confirmed success. Do not offer a new
Undo for zero successful changes. Unknown write outcomes should be read-checked
before another mutation; confirmed writes must not be replayed because a list
refresh failed. Reader's existing recoverable undo at
`conversation-reader.tsx:2666` is a local feedback precedent, not an instruction
to change Reader or add a global notification system.

### ERR-02 — keep Undo outside replaceable list states

**Location:** `apps/web/features/conversations/conversation-list.tsx:173`, `:211`
and `:260`. Error and empty branches return before the JSX containing Undo.
Archiving the last active conversation, or restoring the last archived one,
therefore excludes the newly created Undo from the component's returned tree.
The project conversation page already keeps its Undo outside its inner list state.

**User cost:** the action that most obviously empties the list also removes its
immediate way back. Users can still navigate to the opposite archive state, so
this is Medium rather than a blocked core task.

**Recommendation:** mount the Undo owner above loading/error/empty/data branches,
without creating a second component copy that remounts on state transitions.
Keep pending and failed recovery usable across refetch and empty-state changes.

### NAV-01 — selection is a document identity, not its current position

**Location:** `apps/web/features/search/search-page.tsx:41`, `:80`, `:96` and
`search-results.tsx:8`. Selection is only `activeIndex`; appending pages reruns
type ordering without reconciling selection. Executing the actual order helper
with a message followed by a later annotation changes index 0 from the message
to the annotation. `openSelected()` reads that new index target.

**User cost:** loading more can redirect the next Enter to a result the person
did not select. It costs orientation and another navigation; it does not mutate
content. Existing pagination tests use message-only results, which cannot expose
the cross-type insertion.

**Recommendation:** retain `document_id` and search scope, derive the visible
index, and clear selection when that identity disappears or scope changes.
Keep the existing grouping, arrow-key ordering, result links and history behavior.
Test mixed-type pagination and the actual Enter destination.

### STATE-01 — a failed refresh must not erase a usable recent list

**Location:** `apps/web/features/reading/recent-items.tsx:22`, `:64`.
`isError` unconditionally returns the raw exception before examining cached data.
The installed QueryObserver synthetic check retains one previous row while
`isError=true`; the component hides that usable row. `StateLine` exposes a
status role only for loading, not an alert for the failure.

**User cost:** an intermittent refresh blocks an already-known route back to
reading and presents technical error text. Initial no-data failure still needs
a distinct retry state.

**Recommendation:** keep cached cards and exact saved-position URLs visible,
add a short localized refresh alert/retry, and distinguish no-data from failed
refresh. The existing search error at `search-page.tsx:123` already retains old
results while explaining them. Do not cache new private data or relax auth locks.

### STATE-02 — a project request failure is not “no projects”

**Location:** `apps/web/features/search/search-page.tsx:61`, `:116`.
The dedicated project-filter query feeds `projects.data ?? []`, with no loading,
error, or retry handling around its select. A URL's active `project_id` can then
have no corresponding option even though the search request still uses it.
Sidebar project recovery belongs to another query and is not a substitute for
feedback beside this filter, especially when the mobile sidebar is closed.

**User cost:** the person cannot tell why a project is missing or what scope is
still applied. They may unnecessarily clear a valid filter to continue.

**Recommendation:** preserve the current selection with a neutral fallback label;
state project loading/failure locally and retry just that read. Leave keyword,
other filters, history and previously loaded results intact. Never display an
opaque project ID as user-facing copy.

### A11Y-01 — identify recent reading progress

**Location:** `apps/web/features/reading/recent-items.tsx:44`.
Each `role="progressbar"` sets min/max/current but no `aria-label` or labelledby.
Conversation and project lists already use localized “Reading progress”.

**User cost:** assistive-technology users have a value without an explicit name
for what it measures. This is a source-level Name/Role/Value issue, not a claim
that a particular screen reader was exercised.

**Recommendation:** reuse the same localized progress name; keep its existing
bounded numeric value. No new label needs to clutter the visible card.

## What works and what stays unchanged

Initial batch operations already retain failed selections and summarize counts.
Search keeps prior results on read failure, uses local-day date boundaries, and
its rapid From/To/history race was fixed and accepted in 30a0d32. Recent URLs
retain message/block/character anchors. Project list Undo already survives its
empty inner list. Native filter controls, fonts, spacing, colors and existing
navigation are not defects and will remain in the approved system.

The accepted offline/selection work is not being repeated. Context candidates,
adoption/semantic validation and Skill viewing/editing remain excluded. No new
feature, dependency, schema, archive format or production-policy change is needed.

## Verification backlog and open limits

Implement in the order above, sharing only the duplicated Undo owner and keeping
changes in existing components/services. Small read-state and accessible-name
repairs can be verified in the same pass. Add isolated browser regressions for
partial/all-failed undo, pending double clicks, final-row empty states, failed
refresh, mixed-type pagination and missing project options. Inspect synthetic
375px/1440px evidence, with Chinese/light and English/dark where applicable.
Run lint, nonincremental typecheck and relevant CI gates. Never count test
discovery or the three Node baseline checks as browser acceptance.

Real occurrence rates, physical-device behavior and specified Windows Chromium
application acceptance remain unknown. The findings' code mechanisms are
confirmed; rendered fixes still need their own evidence. This report is the
pre-fix audit, not a claim that the follow-up has shipped.

## Implementation checkpoint (after report delivery)

The scoped repair reuses existing tokens and list patterns. Both list pages and
single-item menu actions now use one keyed `ConversationUndoNotice`. It preserves
remaining IDs, prevents duplicate pending clicks, checks uncertain responses with
GET, and separates confirmed writes from refresh. A new action identity prevents
an older completion from clearing its replacement. No new dependency or backend
contract was introduced. Search uses scope/document identity; Recent retains
cached links and names progress; the project filter retains an unresolved scope.

Full Web lint, nonincremental typecheck and a one-worker Web build pass. Nine new
browser cases were discovered and added to the existing isolated mutation gate;
discovery is not execution. During test review, refetch-on-focus was confirmed
disabled globally, so the Recent fixture uses real client navigation back to a
stale cached list, not a synthetic focus event. Full CI and visual acceptance
remain pending; the repair is not described as browser-verified or deployed.

The implementation is committed as `56930fe94576318ed30946d77f395bb55cc8234a`;
full CI [37795767145](https://github.com/foolkking/chat-reader/actions/runs/37795767145)
is in progress. It does not replace the accepted 30a0d32 production source.
Local document validation checks 165 links across 12 scoped documents, with none
missing. [Computed contrast](ux-audit-post-release-recovery-2026-10-08-evidence/contrast.json)
of the reused Undo text/background and button tokens passes normal-text AA in
both themes; this is CSS-value computation, not measured rendered contrast or
a whole-page accessibility score. No tokens or fonts were changed.

The API job **113374702691** passes **1,181 / 3 skipped / 16 warnings** in
847.74 seconds. Its separate 64-case Bundle and 53-case cleanup runs overlap
the full suite and are not summed. The Web mutation step has completed
successfully and advanced to the default PWA baseline; exact new-case counts and
screenshots still require its artifact. Settings job **113374702451** and Web
job **113374702969** are the remaining quality owners at this checkpoint.
One CLI watch ended with a GitHub TLS handshake timeout; a subsequent direct
status request and completed-job log download succeeded. That transport error
is not a workflow failure. No local or production application was launched for
browser acceptance, and the goal remains active pending CI and visual review.

## Failed-CI follow-up, recorded before the next application edit

The completed Web job's artifact **11559752583** verifies **12 passed gates /
1 failed gate**. The mutation gate passes **26 cases**, including all nine new
recovery/navigation cases. Default PWA passes **135 / 597 conditional skips**;
adaptive import passes **8 / 1 conditional skip**. The negative PWA gate passes
**16 and fails 1**, at `pwa-negative.spec.ts:141`: after reconnect, the original
critical chunk and optional Skill do not both return to the active cache within
60 seconds. The later critical-set and optional-only assertions were not reached.
This source is not release-accepted or deployed. Settings CI is still running
at this checkpoint; the accepted 30a0d32 production release is unchanged.

All eight new synthetic screenshots were reviewed: two pending-undo states,
two final-row empty states, mixed-type search selection, two retained Recent
lists and a failed mobile project filter. The visible new surfaces retain their
actions/content without overlap in these frames. This does not certify the
whole application, other states or the specified Windows Chromium. The
zero-success case has assertion evidence only. Baseline screenshots are retained
beside this report with a `56930fe-` prefix.

### ERR-03 — same-revision readiness skips repair of missing optional assets

**Dimension:** error recovery / offline state. **Severity:** Medium.
**Confidence:** Observed (CI trace + code + executable synthetic regression).
**Effort:** S. **Location:** `apps/web/lib/offline-shell.ts:414` and
`apps/web/public/library-sw.js:99` at failed source 56930fe.

**Evidence:** the trace records initial preparation of 101 resources, deletion
of one critical script and `/skills/context-acquisition.zip`, an explicit offline
503, then online reload. The critical script returns HTTP 200 again; neither
Skill ZIP is requested after reconnect. All 62 cache-repair polls return null.
Both same-revision fast paths accept `ready` without checking `missing`.
`ready` intentionally checks only critical assets, so it does not prove the
inventory is complete. The new `scripts/pwa/offline-shell.test.mjs` executes the actual
worker and transpiled client module with in-memory browser doubles: the baseline
has 2 passes / 4 failures, including both skipped-repair branches. One of those
failures separately records unnecessary refetch of intact resources during a
same-revision critical repair. These are synthetic checks, not local browsers.

**User cost:** a person can read offline, but a missing built-in Skill remains
unavailable even after the normal online recovery. The complete manifest count
does not reveal that the repair was skipped. This is not a blocked Reader or
loss of conversation data; optional absence must remain non-blocking.

**Recommendation:** require an empty missing set before taking either
same-revision no-work path. Repair only missing allowlisted resources in the
existing same-revision cache, preserving its record, intact bytes and other
accounts. Failed repair retains the usable shell and explicit retry. Keep the
original negative-test assertions and add a deterministic optional-only online
reload case so correctness does not depend on which script sorts first.

### COPY-01 — singular counts use plural-only Undo copy

**Dimension:** content / microcopy. **Severity:** Low.
**Confidence:** Observed (synthetic CI screenshots + code). **Effort:** S.
**Location:** `conversation-undo.tsx:91`, `conversation-list.tsx:345`,
`project-conversation-list.tsx:293` at source 56930fe.
The English screenshots display “1 results need checking” and
“1 conversations archived”. Use singular/plural agreement (including restore)
without changing the approved typography, spacing, tokens or action hierarchy.
The cost is minor reading friction, not a functional failure. Correct this in
the already-required PWA revision rather than starting another visual redesign.

## Same-revision repair and latest execution boundary

Both same-revision fast paths now require no missing resources. The worker
repairs only missing entries from the requested allowlist, preserving metadata,
intact bytes and other account caches; different-revision staging is unchanged.
All six synthetic regressions now pass. The new optional-only online reload
case supplements the unchanged original negative assertion. The English Undo
counts now agree or use count-neutral wording, with explicit browser assertions.
The bounded one-worker Web build and nonincremental typecheck pass. The first
lint of the new Node test failed because browser-like globals were undeclared
in an `.mjs` file; it was corrected with explicit Node imports/global bindings,
not a rule disable. The subsequent full lint and all six Node regressions pass;
nine UX cases are rediscovered, which does not rerun those browsers.

Run 37795767145 is now complete and **failed**. Settings job 113374702451 is
**cancelled**, not passed: its log reports **439 passed (41.8m)** and the separate
fresh-instance restore reports **1 passed (36.1s)**, but the job's 45-minute limit
interrupts finalization. The job ran from 14:50:34Z to 15:35:44Z. The next revision
budgets 60 minutes for this serial matrix, setup, restore and evidence collection;
individual test deadlines, assertions and required cases are not relaxed. Both
image jobs were skipped on this failed source. See the
[sanitized failed-source evidence](ux-audit-post-release-recovery-2026-10-08-evidence/ci-56930fe.json).

The user's latest instruction supersedes further release automation: finish
this CI repair/verification cycle, **do not deploy it**, then continue local
evidence-backed optimization. After this cycle passes, additional commit/push/CI
submissions and deployment wait for the user's explicit request. Production
remains at accepted source 30a0d32; the persistent optimization goal stays active.

At 2026-10-09 00:02 China time, repair source
`eceadc622fb880ffaaa0ad4ceab69db4cd48b757` was pushed and exact-source
[CI 37805638620](https://github.com/foolkking/chat-reader/actions/runs/37805638620)
was dispatched. Local validation checks 169 file links across 13 scoped documents,
with none missing. Eighteen negative PWA cases are discovered; discovery is not
execution. Subsequent audit/status notes stay local and are not another CI
submission. No follow-up deployment is authorized.

## Further CI finding, 2026-10-09, before the next source repair

Run 37805638620's Web job **113409059140** fails one of thirteen gates. The
original mixed critical/optional recovery now passes. The new optional-only case
`PWA-NEG-026` repairs the cache but fails the unchanged-revision assertion;
negative results are **17 passed / 1 failed / 0 skipped**. Artifact **11562784677**
also confirms all 26 mutation cases and the other twelve gates pass. Settings is
still running at this checkpoint; API is successful. No image/deployment
acceptance follows from these partial results.

### ERR-04 — equivalent resource inventories produce different shell revisions

**Dimension:** offline recovery / perceived performance. **Severity:** Medium.
**Confidence:** Observed (CI trace + code + synthetic execution). **Effort:** S.
**Location:** `apps/web/lib/offline-shell.ts:479` at source eceadc6.

**Evidence:** the trace's initial and reloaded active records each have exactly
101 assets and 98 critical assets, with identical ordered asset arrays. Their
revisions nevertheless change from `ad7556814a5b60cb81c0619d` to
`914a2b920abb95fcc7f3538e`. Before reload the worker correctly reports ready with
only the optional ZIP missing. The collector deduplicates raw URLs, then
normalizes them; absolute DOM URLs and relative runtime URLs can therefore
become duplicates after that deduplication. Revision hashing includes those
duplicates, while the worker's recorded manifest removes them.

Nine expanded synthetic shell checks yield **6 passed / 3 failed** before this
repair. They reproduce duplicate canonical URLs, changed same-manifest revisions
and an unnecessary PREPARE request after runtime rediscovery. All existing worker
repair/preservation checks still pass. This is not a test timeout or a reason to
remove the same-revision assertion.

**User cost:** an unchanged runtime can be treated as a new shell, replacing
its cache and fetching intact resources instead of doing a missing-only repair.
This adds avoidable work and quota exposure; no conversation data loss is observed.

**Recommendation:** normalize allowed same-origin URLs before deduplication and
sorting. Preserve distinct query strings, rejected origins/paths, the worker's
existing staging and account boundaries, and all original browser assertions.
Keep the unrelated project audit and its new tests outside this CI repair commit.

## Canonical-inventory repair checkpoint

Run 37805638620 is complete and **failed**, with exactly one failing Web gate.
Settings job 113409058674 is **successful**: **439 passed (39.6m)**, followed by
**1 passed (37.1s)** in the fresh-instance restore, and finalized artifact
**11564908071**. API job 113409059155 is **successful**, with **1,181 passed /
3 skipped / 16 warnings** in 730.26 seconds. Both image jobs are **skipped**.
These final states supersede the running-settings checkpoint above; see
[sanitized evidence](ux-audit-post-release-recovery-2026-10-08-evidence/ci-eceadc6.json).

The client now deduplicates normalized URLs before sorting and hashing. All
**9 synthetic shell checks pass**, including equivalent URL/fragment discovery,
distinct queries, rejected paths/origins, no-work fast paths and missing-only
repair. Full Web lint, nonincremental TypeScript and a one-worker Next build
pass. Eighteen negative browser cases are discovered, **not locally executed**.
No browser assertion or workflow configuration changed for this repair.

Only the canonical-inventory fix, its synthetic regressions and this cycle's
documentation/evidence belong in the repair commit. The separate project
settings/read-recovery audit and its intentionally failing baseline tests stay
local. Full exact-source CI for the next candidate remains pending. Once that
cycle passes, retain further optimization and verification notes locally;
do not dispatch another CI or deploy without a new explicit user request.

Repair source `a12ce9e287fdddfd4df8a6039a212cec04629568` is committed and pushed;
[CI 37812290017](https://github.com/foolkking/chat-reader/actions/runs/37812290017)
was dispatched once for that source. All seven committed files belong to this
repair; project-recovery source/tests/docs and unrelated residues were excluded.
The local document check resolves 172 links across 13 scoped documents, with
none missing. This running candidate is not accepted or deployed.

## CI cycle accepted; further work is local-only

At 2026-10-09 China time, exact-source run **37812290017** completed successfully.
All five jobs pass: API **1,181 passed / 3 skipped / 16 warnings**; all **13 Web
gates**; settings **439 passed (38.0m)** plus fresh-instance restore **1 passed
(34.6s)**; image build; and the independent original-artifact inspection.
The negative PWA gate passes all **18** cases, including the original mixed
critical/optional recovery and the new unchanged-revision optional-only case.
Mutation passes **26**, including all nine UX additions. Default PWA retains
**135 passed / 597 conditional skips**, and adaptive import **8 / 1 conditional
skip**. No skip is counted as a pass.

Image artifact **11567238870**, producer attempt **1**, was independently
downloaded with its matching GitHub SHA-256 and inspected in CI. It has not been
deployed. See [exact-source acceptance](ux-audit-post-release-recovery-2026-10-08-evidence/ci-a12ce9e.json)
for job/artifact IDs, digests and limits. A corrupt CLI cached-log ZIP did not
indicate a failed job; direct read-only retrieval succeeded.

Eight exact-source synthetic screenshots were reviewed and retained beside this
report with `a12ce9e-` prefixes. Pending/checking Undo, final-row Undo, selected
search identity, retained Recent cards and project-filter recovery remain visible
without overlap in these frames. English Undo singular agreement is corrected.
The separate “1 conversations” project heading is minor copy polish, not a CI
blocker. These screenshots are not full-app accessibility or local Chromium
acceptance; zero-success Undo still has assertion evidence only.

This closes the authorized CI repair cycle. **No further commit, push, CI dispatch
or deployment is authorized without another explicit user request.** Acceptance
notes and the separate project/merge audits remain uncommitted. Production stays
at accepted **30a0d32**; its release helpers, backups, configuration and database
were not replayed or changed. The optimization goal remains active for useful
local work.
