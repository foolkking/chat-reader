# UX audit — merge admission and recovery

2026-10-09 · Baseline application source a12ce9e · Written before application edits.

Latest local result: [ERR-03 checkpoint](#err-03-local-implementation-checkpoint).
Earlier failures, counts and limitations below retain their checkpoint meaning.

## Scope and evidence

This is a focused review of the existing conversation/project merge flow for
ordinary users organizing private archives on desktop/mobile Web. The goal is
one deliberate, non-destructive merge in the chosen order, with trustworthy
feedback after a connection failure. It is not a redesign, a new task history,
or a change to copying canonical messages, attachments or source ownership.

Evidence: [exact-source callback/JSX reproduction](ux-audit-merge-admission-2026-10-09-evidence/reproduce.mjs),
[baseline results](ux-audit-merge-admission-2026-10-09-evidence/baseline.json),
and real FastAPI admission requests in
`apps/api/tests/test_merge_admission.py` against disposable SQLite. The five
frontend desired-behavior checks fail; API baseline is **5 pass / 7 fail**.
Frontend transport/state/portal dependencies are explicit doubles. No actual
network response was dropped, no local Web/API/worker was started, and neither
production nor PostgreSQL concurrency was exercised. Rendered layout, effects,
focus and real-device behavior remain **NOT_VERIFIED**.

## What matters most

The current retry button can submit the same intended merge with a different
request key after a lost response. Executing both list callbacks confirms this,
and a real API control confirms that distinct keys correctly admit distinct jobs.
The defect is the lost connection between one user intention and its retry, not
the legitimate ability to merge the same sources twice. Keeping a key alone is
insufficient because server replay currently ignores payload differences and
does not retain failed/cancelled admissions. Two smaller problems make the wait
less trustworthy: confirmed admission waits for a task-list refresh, and the
still-editable title can accept text that completion then discards. Existing
inline result-checking, task receipts and design tokens are adequate for repair.

## Findings and priority

All entries are defects. Effort is an engineering estimate against inspected code.

| Priority / ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| 1 · ERR-01 | A lost-response retry creates a new admission identity | Recovery / forms | High | Observed (code + executed callbacks + API control); real-network frequency unknown | M |
| 2 · ERR-02 | Same-key admission does not consistently identify the original request | Recovery / trust | Medium | Observed (code + SQLite API); concurrent PostgreSQL behavior unverified | M |
| 3 · FBK-01 | Confirmed admission remains pending behind task refresh | Status / performance | Medium | Observed (executed callbacks); rendered wait inferred | S |
| 4 · FORM-01 | Title accepts edits that completion discards | Forms / state | Medium | Observed (actual JSX/callback execution); physical input unverified | S |

### ERR-01 — preserve one intention through an unknown response

**Location:** `conversation-list.tsx:323`,
`project-conversation-list.tsx:274`, `merge-conversations-dialog.tsx:61` under
`apps/web/features/`. Both list callbacks call `crypto.randomUUID()` every time.
After simulated admission followed by response loss, a second invocation posts
the same ordered IDs/title with a second key. The dialog catches the first error
and permits the next attempt. Neither the API client nor dialog has a read-only
request lookup. The existing bounded active-task list cannot prove absence.

**User cost:** someone retrying an apparently failed operation can queue an
additional merged conversation and additional worker work. Sources are preserved;
this is not irreversible source loss.

**Recommendation:** retain the original request and its scope, freeze its payload
while pending/unconfirmed, and offer **“Check merge result” / “检查合并结果”**.
That action must only read the owned receipt. A found receipt acknowledges the
original task regardless of status; a missing receipt permits explicit original-
key resubmission, never an automatic POST. Preserve recovery across dialog close
and reopen; account changes must fence old callbacks. Reuse the global-noise
request pattern rather than introducing another task product.

### ERR-02 — make the server receipt safe to use for recovery

**Location:** `apps/api/app/services/background_jobs.py:57`;
`apps/api/app/models/background_job.py:48`; conversation merge route `:230`.
Replay tests pass for queued/processing/cancelling/committed, but failed and
cancelled requests each produce a new job. Reusing a key with changed order,
title or project returns 202 with the old task, not a conflict. Archiving a source
after admission makes the same request fail source validation before its receipt
can be returned. There is no transaction admission lock; the key indexes are
nonunique. The latter is a source-level concurrency risk, not a measured race.

**User cost:** a recovery action can unexpectedly restart cancelled work or
misrepresent which title/order/project was admitted. Users cannot reliably
reconcile an uncertain response from these inconsistent cases.

**Recommendation:** use the existing owner/key PostgreSQL advisory-lock precedent
from offline package admission, compare ordered payload fields, and read retained
jobs across statuses before mutable source validation. Changed payload gets 409
with an explicit code. Add owner-scoped read-only lookup; return only the normal
task projection, not raw payload/paths. Keep task-center visibility TTL unchanged;
receipt recovery lasts only while the underlying job exists. Deliberate new keys,
legacy optional headers and existing task retry/cancel semantics remain available.

### FBK-01 — acknowledge admission independently of later reads

**Location:** both list callbacks above. Each awaits `invalidateQueries` after a
successful POST and input reset. A held refresh keeps the actual callback promise
unsettled. A rejecting follow-up can therefore enter the dialog's mutation-error
path after admission was already confirmed.

**User cost:** a person waits on work that is already accepted, with no reliable
distinction between task admission and refreshing its representation.

**Recommendation:** acknowledge the known task immediately; refresh independently
with handled failures. A refresh failure must not enable or repeat the write.
This uses the project's existing confirmed-write contract and the locally repaired
project-settings pattern.

### FORM-01 — the pending title must describe the submitted request

**Location:** `merge-conversations-dialog.tsx:46`. Reordering and buttons honor
`busy`, but the input has neither `disabled` nor `readOnly`. Executing its actual
onChange accepts new text; executing successful admission then resets it to the
default in the parent. The new text was never part of that request.

**User cost:** a person can spend time correcting a title that is neither sent nor
kept. The scope is one short field, so this is Medium rather than a long-form
data-loss claim.

**Recommendation:** keep title/order immutable during submission and uncertain-
result recovery, with the submitted count/title visible. Restore editing only
when rejection is certain or the previous request has been resolved.

## Quick wins, existing strengths and repair brief

FBK-01 and FORM-01 are small fixes, verified together with the admission owner so
the UI cannot suggest a false safe retry. Existing source-preserving merge,
message-count limits, keyboard reorder, shared modal focus, task cancellation,
worker rollback and account ownership are retained. Different deliberate keys
are intentionally **not** deduplicated by payload. Native controls, font choices,
tokens and the task-center information architecture stay unchanged.

The user remains at the quiet archive workbench: title and ordered source rows
lead; request feedback stays beside the action. Reuse paper/graphite surfaces,
sea-green action and restrained danger tokens, quiet `border-ui` layering,
the existing font stack and 4px spacing scale. No new dependency, palette,
decorative card, background launcher or visual direction is required. The
alternatives of silent resubmission, payload-based deduplication of deliberate
merges, and a separate merge-history screen do not meet this scoped contract.

## Verification backlog and limits

Implement the existing receipt/check pattern in the shared dialog and admission
service, then test original-key replay, changed payload, every job status,
archived/deleted sources, missing/failed reads, account isolation, stale callbacks,
duplicate clicks and refresh independence. Preserve failed baselines. Add a
PostgreSQL concurrent test but do not restart the forbidden local fixture;
discovery or a skip is not a pass. Add browser cases for both entry points and
375px/1440px title/recovery states; no new CI is authorized to execute them now.
Use local lint/typecheck/build and bounded SQLite/Node checks as available.

Real usage rates, physical-device rendering and cross-process admission remain
unknown until relevant execution evidence exists. This batch stays local-only,
outside passing CI **37812290017**, with no commit, dispatch or deployment.

## Local implementation review — confirmed-close boundary

Before the final application correction, two new tests execute the actual
`MergeConversationsDialog` callbacks captured with `isMerging=true` / `busy="merge"`.
Both acknowledge the task but never call `setMergeOpen(false)`; the desired
behavior is **0 pass / 2 fail**, with 31 other tests excluded by name. This is a
follow-up to FBK-01 in the uncommitted implementation, not a claim that the
exact-source a12ce9e baseline already had the new callback API.
The [captured baseline](ux-audit-merge-admission-2026-10-09-evidence/confirmed-close-baseline.json)
retains the pre-correction source/test hashes and explicit evidence boundary.

**FBK-02 · Medium · S · Observed (executed captured callbacks); React timing and
rendering Inferred.** Locations: `conversation-list.tsx:550` and
`project-conversation-list.tsx:491`. The successful response may settle before
the parent's queued busy-state update renders; the prior close callback still
refuses dismissal. A user could then see an inert confirmed form rather than
returning to the acknowledged list. Recommendation: let the confirmed-admission
callback close the owning dialog directly, independently of stale busy props.
Keep the ordinary close callback guarded during a pending request. No new
layout, token or user-input behavior is needed.

Reproduction: `node --test --test-name-pattern='closes confirmed admission'
scripts/ux/merge-admission.test.mjs`. This deliberately executes one captured
callback pair; it does **not** simulate a React render/effect race. The four
unexecuted browser recovery cases also require the dialog to close before the
held task-list refresh is released.

## Local implementation checkpoint

The four original findings and FBK-02 have scoped local corrections:

| Finding | Current implementation |
| --- | --- |
| ERR-01 | Shared admission hook captures original key, ordered IDs and normalized title before POST. Owner/project-scoped session recovery and memory fallback retain the request. A read-only check precedes any explicit same-key retry. |
| ERR-02 | Owned oldest-retained receipt lookup covers every status; ordered payload differences return 409. PostgreSQL transaction advisory lock precedes lookup/new admission. Source/project/limit validation occurs only for a new request. |
| FBK-01 / FBK-02 | Confirmed task acknowledgement is separate from independent task refresh. The accepted callback closes its dialog without waiting for the parent's prior busy render to change. Ordinary pending dismissal remains guarded. |
| FORM-01 | Submitted title/order stay read-only; late input/reorder callbacks are guarded. The primary action keeps one React key through submit/check/retry; labels state the action and pending state. |

The new GET returns only the existing task projection, filtered by current owner.
It does not return raw payload or source text. Recovery does not reset failed or
cancelled tasks. Explicit new keys remain independent operations, the legacy
optional header remains valid, and no table schema, migration, worker copy
behavior, archive format or retention/purge policy changed. API requests use the
existing 20-second abort/deadline pattern. Closing/unmounting/locking aborts the
client wait and fences late callbacks; it does not claim to cancel an admitted job.

### Verification ledger

[Local verification and exact source hashes](ux-audit-merge-admission-2026-10-09-evidence/local-verification.json)
bind these results to the uncommitted checkpoint, not the earlier project-only hashes.

| Check | Result / boundary |
| --- | --- |
| Original a12ce9e frontend desired behavior | 0 pass / 5 fail, retained in the exact-source baseline |
| Original a12ce9e SQLite API | 5 pass / 7 fail, 24.21s |
| Initial repaired API subset | 12 pass, 24.04s; superseded by the combined batch below |
| Combined API admission/history/cancellation/split-merge/project settings | **41 pass / 0 fail / 0 skip**, 83.43s, disposable SQLite |
| Confirmed-close pre-correction callbacks | 0 pass / 2 fail / 31 name-filter skips; real React scheduling not exercised |
| Merge + project Node regressions | **54 pass / 0 fail / 0 skip**, 1645.4637ms; 33 merge + 21 project checks |
| Web lint / nonincremental TypeScript | Pass after the confirmed-close correction |
| Bounded one-worker Web build | Pass after the confirmed-close correction; Next 16.3.8, one CPU, standalone disabled |
| PostgreSQL same-key concurrency | **2 skipped**, 2.22s, explicitly disabled; not a passing concurrency result |
| Migration source | Single `20261008_0050` head; no migration added |
| Browser discovery | **13 found** in `ux-recovery-followup.spec.ts`, including four new merge cases; no execution |
| New real browser / focus / layout / real-network-loss cases | **NOT_VERIFIED** |

The API and Node suites overlap earlier checkpoints; do not add repeats as
distinct passing cases. The Node hook harness explicitly doubles React
state/effect scheduling, storage and transport; installed React static rendering
does not validate interactive lifecycle, focus, visual appearance or performance.
The four new browser cases keep the original nine cases intact and require real
isolated admission/worker checks, reload recovery, failing then successful GET,
same-key retry only after absence, held task refresh, unchanged synthetic source
messages and screenshots at English/dark 1440px and Chinese/light 375px. They
have only been discovered, not executed. PostgreSQL cases were collected and
skipped without restarting the fixture.

The interface review retains the approved paper/graphite/sea-green system, native
controls, existing font stack and 4px spacing. The visual/scored checklist remains
**unverified**, not a fabricated full score. This local checkpoint is not ready
for release, is not covered by a12ce9e CI and has not been committed or deployed.

### Open local finding — recovery entry still depends on selection

**ERR-03 · Recovery/navigation · Medium · M · Observed (code); rendering Inferred.**
Locations: `conversation-list.tsx:174–253,550` and
`project-conversation-list.tsx:227,488–491` under `apps/web/features/`.
The merge dialog is still owned by the selected-items toolbar. Its opening button
requires at least two current selected rows, and the all-conversations list
returns loading/error/empty content before rendering that toolbar. A retained
request therefore cannot always be reopened if sources disappear or fewer than
two conversations remain selectable, despite the server receipt remaining valid.

**User cost:** someone returning after a connection loss may have to reselect
unrelated rows—or cannot enter at all—to check the original result. The default
task window is not a durable substitute, and reading the original receipt must
not depend on new selection.

**Recommendation / next local action:** keep one merge dialog/recovery owner at
the page level, outside selection/loading/empty branches, and expose a compact
account-scoped pending-request entry. Opening should only restore the original
request, not read or POST automatically. Preserve source/project/account access
boundaries, missing-label fallbacks and existing focus behavior. Add empty-list,
failed-refresh, source-removal and no-current-selection tests before broadening
the browser matrix. This finding is **not fixed at this checkpoint**; the goal
remains active.

## ERR-03 continuation — pre-edit evidence and narrow repair brief

The next local continuation rechecked the current worktree before application
edits. Actual page/dialog static execution now covers loading, empty, initial-error,
cached-error, one-row and populated states for both entry points without selecting
anything. The new 22-case contract baseline is **3 pass / 19 fail** (1638.7654ms).
The three passing controls preserve HTTP 401/403/404 project hiding. Failures show
the missing page-level owner/recovery entry; they are desired-contract checks,
not 19 distinct UX findings. Admission hydration, state setters, transport and
portals are explicit doubles; this does not prove browser timing or focus.
See [re-entry baseline](ux-audit-merge-admission-2026-10-09-evidence/reentry-baseline.json).

**Correction to FBK-02's user-impact inference:** both old bulk components also
have an effect that closes the dialog when selected count drops below two.
The earlier captured-callback failure is real, but successful selection clearing
would subsequently run that effect. It therefore did **not** prove a persistently
stuck rendered dialog. Treat the previous explicit accepted-close correction as
a defensive callback improvement, not a separately established Medium UI defect.
Its historical failure evidence remains intact. That selection-driven effect
instead strengthens ERR-03: a pending recovery can be dismissed when its current
source rows disappear, independently of its retained original request.

Repair direction: keep one existing dialog owner on each page, outside the
selection toolbar and loading/empty/error content. Restore the saved request
while closed, without opening or an automatic merge lookup/POST, and show a compact **“Review merge request” /
“核对原合并”** action only when an unresolved request exists. Opening restores the
original title/order; only the existing explicit check/retry buttons perform merge
lookup/submission. The dialog's existing account-capabilities GET may still run
on open. Closed/currently stale merge callbacks cannot read or write. Project
access-denied/missing states continue to hide cached project data and merge UI;
do not turn receipt recovery into a permission bypass.

Keep successful feedback outside the all-list early returns too. Reuse the shared
dialog's logical-focus extension for returning to the pending entry on close or
the result notice after acknowledgement; this is a focus target contract until
real browser execution. A project change must not briefly reopen another project's
dialog. Preserve fresh-merge two-selection validation, existing pending disabling,
original-key replay and all API semantics.

Intent: an ordinary archive reader returns after a connection loss and can find
their original operation without selecting unrelated content. The closed entry
uses an existing flat paper surface, quiet `border-ui`, `text-sm`/`text-secondary`
and a native 44px secondary action; these match the reading-workbench hierarchy
without adding a new task product. Spacing stays on the approved 4px scale,
the font stack/palette remain unchanged, and no extra overlay, library or token is
introduced. The existing modal still owns title/order and explicit result checks.

### ERR-03 implementation review — render-to-cleanup fencing

Before the next hook correction, eight bounded callback tests fail: **0 pass /
8 fail / 35 name-filter skips**, 610.7292ms. After rendering `open=false` or a
different project, the returned state masks the old request, but captured
start/check/retry callbacks and a late receipt still use the old effect-owned
context until passive cleanup. `callbacks.current` has already received the new
parent callbacks during that render. Location: `use-merge-admission.ts:44–50`,
`103–110` and `135–143` under `apps/web/features/conversations/`.
See [render-fence baseline](ux-audit-merge-admission-2026-10-09-evidence/reentry-render-fence-baseline.json).

This is **Observed (code + controlled callback execution)** for the missing
scope guard; occurrence in real React scheduling is **Inferred**, not measured.
It is a correction within ERR-03, not eight defects or a new user-impact count.
Someone changing context must not receive an old merge acknowledgement in their
new workspace or let an old callback submit with the new parent's project.
Recommendation: check the latest rendered open flag and storage scope in the
existing callback ref, alongside the effect-owned context/account/generation.
Retain late requests for recovery; keep cleanup aborts as the secondary guard.
No new state owner, visual treatment, dependency or backend change is needed.

## ERR-03 local implementation checkpoint

Both pages now retain the existing merge dialog outside their selection and
loading/empty/error branches. The closed hook reads only its own saved request;
**Review merge request / 核对原合并** opens it without checking or resubmitting.
Fresh merge still requires two selected rows. Missing source rows use neutral
ordered labels, never raw IDs. Project-unavailable responses still hide merge UI.
The project-owned open scope and component key prevent another project's dialog
from opening. The latest rendered scope/open state now also gates old callbacks
before passive cleanup; the existing account/generation and abort checks remain.

The page-level result notice survives empty/error content. The shared focus hook
is unchanged: a manual close targets the recovery entry and acknowledgement targets
the result notice. Static callback checks establish the chosen targets only;
browser focus timing, layout and performance are still **NOT_VERIFIED**.

[Separate re-entry verification](ux-audit-merge-admission-2026-10-09-evidence/reentry-verification.json)
records current source hashes without overwriting the earlier 54-case checkpoint.

| Check | Result / boundary |
| --- | --- |
| Before page ownership repair | 3 pass / 19 fail / 0 skip; 22 contract checks, not 19 findings |
| Before closed-owner hydration | 2 pass / 1 fail / 32 name-filter skips in the preceding continuation |
| First combined harness integration | 67 pass / 11 fail: four obsolete callback signatures/JSX setup and seven project-only mocks that assumed the dialog was unmounted; assertions retained when updating those doubles |
| Initial re-entry implementation | 85 pass / 0 fail / 0 skip, before the eight render-fence checks |
| Before immediate render fence | 0 pass / 8 fail / 35 name-filter skips, 610.7292ms; controlled callbacks, not browser scheduling |
| Current combined Node suite | **93 pass / 0 fail / 0 skip**, 2336.8826ms: 43 admission + 21 project + 29 re-entry |
| Web lint / nonincremental TypeScript / bounded Web build | Pass after the render-fence correction; Next 16.3.8, one CPU, standalone disabled |
| API | Previous **41 pass**, 83.43s; seven backend implementation/test hashes unchanged, not rerun here |
| PostgreSQL concurrency | Previous **2 skipped**; still unverified, fixture not restarted |
| Browser discovery | **13 cases**, original nine preserved and four merge cases strengthened; none executed in this batch |

The four browser cases now reopen from the entry without selecting new rows.
Project cases remove only their two synthetic memberships via the actual API;
all-list cases explicitly double empty/failed list reads, not database state.
They require original payload/key reuse, no automatic check/POST, original source
message invariance, manual-close return focus, and visible/focused acknowledgement
while an observed task refresh is held. The expected receipt must identify the
same real job. These assertions and intended 375px Chinese/light and 1440px
English/dark screenshots have only passed discovery, not execution.

ERR-03 is locally implemented with the above limits. The earlier FBK-02 inference
correction remains in force; no extra Medium finding is counted for it. Continue
evidence-backed local audit beyond merge re-entry. No commit, push, CI trigger,
service restart or follow-up deployment occurred; production remains at 30a0d32.
