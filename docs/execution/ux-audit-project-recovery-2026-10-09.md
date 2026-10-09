# UX audit — project settings and read recovery

2026-10-09; baseline source `eceadc622fb880ffaaa0ad4ceab69db4cd48b757`.
This report was written before this batch's application edits. Subsequent test
and repair evidence is appended without converting the baseline into acceptance.

## Scope and evidence

This is a scoped review of the existing Web project's settings save and
conversation-list read paths, for ordinary people organizing their personal
conversation archive. Stakes are preservation of entered metadata, trustworthy
save feedback and access to previously loaded reading links. It is not a redesign
or a review of every settings category. Evidence is source, the installed query
library and disposable synthetic API tests; initial findings below distinguish
code observations from runtime effects that still need reproduction.

Seen: `project-settings-dialog.tsx`, `project-conversation-list.tsx`, their live
sidebar/action-menu callers, the project route/schema/model/service, existing
project tests, and the established Recent recovery pattern. Design authority is
the existing `.interface-design/system.md`; fonts, tokens and native controls
remain unchanged.

Not seen: these new failure states in a running application, Windows Chromium,
mobile keyboard/focus behavior, production pages or production data. The local
Web-start policy refusal remains in force; no alternate launcher or fixture
restart is authorized. No accessibility-conformance claim or full design score
is made. The current repair candidate a12ce9e / CI 37812290017 contains the
preceding offline-shell batch, not these changes. After that CI cycle passes,
further CI submissions and all deployment require a new explicit user request.

## Executive summary

Clearing a description submits a value that the API currently discards.
A settings save also resubmits untouched metadata from the opening snapshot,
which can undo an unrelated edit made elsewhere. The save lifecycle includes
subsequent reads, extending the locked form after the write has succeeded.
The project list has a related read-state problem: it keeps cached rows in query
data but excludes them from its error render. These are data/feedback defects,
not reasons to add a new settings surface. Existing partial-PATCH and inline
recovery patterns provide a small, consistent repair direction.

## Findings and priority

All four are defects. Severity reflects user consequence on these secondary
organization paths; effort is an estimate within the current architecture.

| Order / ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| 1 · FORM-01 | Explicitly clearing project metadata is ignored | Forms / data integrity | Medium | Observed (code); persisted result pending reproduction | S |
| 2 · FORM-02 | Saving an edited field also overwrites untouched opening values | Forms / error prevention | Medium | Observed (code); two-client effect inferred | S |
| 3 · FBK-01 | Confirmed save waits for refresh; callback failure can become save failure | Status / recovery | Medium | Observed (code); query-library execution pending | S |
| 4 · STATE-01 | Failed list refresh hides cached rows and offers no local retry | State coverage / recovery | Medium | Observed (code); rendered effect inferred | S |

### FORM-01 — distinguish omitted fields from explicit clearing

**Location:** `apps/web/features/projects/project-settings-dialog.tsx:31`;
`apps/api/app/schemas/project.py:17`;
`apps/api/app/api/routes/projects.py:94`;
`apps/api/app/services/projects/project_service.py:175`.

**Evidence:** the form sends `description.trim() || null`. The route preserves
explicit null via `model_dump(exclude_unset=True)`, and description/color/icon
are nullable in both schema and model. The service nevertheless skips every
update whose value is null, including these three nullable fields.

**User cost:** someone removing an obsolete description can receive a normal
save response without the stored description being cleared. The value can be
replaced with nonempty text, so this is not irreversible loss or a blocked Reader.

**Recommendation:** apply explicit null only to the declared nullable metadata;
keep omission as “unchanged” and preserve existing non-nullable-field behavior.
Test the HTTP response and an independent fresh read, unrelated metadata and
linked conversation offline revision behavior. No migration is needed.

### FORM-02 — send only fields edited in this draft

**Location:** `apps/web/features/projects/project-settings-dialog.tsx:27` and `:30`.

**Evidence:** the component already retains an opening `base` to protect dirty
drafts. Its mutation ignores that base and always submits name, description,
color and icon, including fallback color/icon values that were never stored.
`ProjectUpdate` already supports partial updates.

**User cost:** changing only a description can reset a name/color/icon changed
in another tab. It can also turn an untouched null icon/color into a default.

**Recommendation:** compare normalized edited values against the corresponding
opening display values and submit only changes. Use the returned canonical
project for confirmed local state. This protects unrelated fields; it is **not**
a same-field concurrent-edit conflict protocol and must not be described as one.

### FBK-01 — acknowledge a confirmed save before refreshing views

**Location:** `apps/web/features/projects/project-settings-dialog.tsx:36`.

**Evidence:** async `onSuccess` awaits project invalidation and `onChanged`
before `onClose`. The fieldset and dismissal controls depend on mutation pending
state. The installed query-library lifecycle must be exercised to distinguish
pending refresh from an actual rejected mutation.

**User cost:** a completed metadata save can leave the form locked during a slow
read; a rejecting follow-up callback can make it look like the save failed and
invite repetition.

**Recommendation:** seed existing cached projects with the confirmed response,
acknowledge/close immediately and refresh independently with handled errors.
Retain the current duplicate-submit guard. Test held and rejecting follow-up
reads; neither may repeat or reverse the completed write. Existing personal-rule
and Recent recovery patterns establish the intended distinction.

### STATE-01 — retain same-project content through transient read failure

**Location:** `apps/web/features/projects/project-conversation-list.tsx:71`,
`:350` and `:355`.

**Evidence:** the query retains previous data, but rows render only when
`isSuccess`; errors render `error.message` through a StateBlock without a retry.
The selection toolbar is outside that branch. The installed QueryObserver can
retain data alongside an error; this needs a focused execution before repair.

**User cost:** an intermittent refresh hides known reading links and selected
rows, while unrelated selection controls may remain. Raw transport messages do
not explain recovery.

**Recommendation:** keep same-project cached rows mounted for transient failures,
with “项目对话更新失败，仍显示上次内容。” / “Could not update project
conversations. Previously loaded items are shown.” and a read-only “重试” /
“Retry”. Initial failure uses “项目对话加载失败，请重试。” / “Could not load
project conversations. Try again.” Do not treat missing/forbidden projects as
stale-readable, or reuse another project's placeholder rows. Preserve row keys,
selection, existing Reader links and the stable Undo owner.

## Prioritized work and quick wins

All four fixes are small enough to keep in one local batch: reproduce FORM-01,
then dirty-field and confirmed-save behavior, then read recovery. Save and list
changes should have independent regression tests. A new full conflict protocol,
job admission behavior and design-token changes are outside this batch.

## What works and stays unchanged

The settings form already preserves a dirty draft during parent refresh,
provides a shared unsaved-close guard, and prevents synchronous duplicate submits.
The API enforces ownership and duplicate project names. The project list already
keeps Undo above replaceable read states. Preserve those protections, project
ordering, default Inbox constraints, Share/package compatibility and canonical
conversation content. Recent's accepted retained-cache pattern is the local
precedent, not a reason to restyle this page.

## Open questions

- **Hypothesis, outside this batch:** can a lost merge-admission response followed
  by a new random retry key create a second merge? The two list call sites and
  queue implementation warrant a separate synthetic admission check before edits.
- Same-field concurrent metadata edits have no version/conflict contract. Dirty
  fields alone do not settle this; keep it explicit when assessing this repair.
- New component appearance, real focus retention and the small-screen failure
  states remain unverified until an authorized browser run can exercise them.

## Verification ledger

Baseline reproductions and repair outcomes will be recorded here. A collected or
listed browser test is not an executed test. This local batch is not committed,
submitted to CI, deployed or accepted as a production release.

### Baseline, before application changes

[Sanitized baseline](ux-audit-project-recovery-2026-10-09-evidence/baseline.json):
seven FastAPI/disposable-SQLite cases yield **3 passed / 4 failed / 0 skipped**.
All four corrected-baseline failures reproduce ignored null metadata. The first
attempt also had one test-construction error (a single message instead of the
required user/assistant pair); that is not a fourth product defect. Its corrected
test reaches the intended failed description assertion. Independent fresh reads
confirm persistence; no existing PostgreSQL or application process was started.

Nine Node checks execute the actual transpiled components with installed React
static rendering and TanStack MutationObserver/QueryObserver: **1 passed / 8
failed / 0 skipped**. These confirm FORM-02, FBK-01 and STATE-01 at callback/query/
markup level. The cross-project placeholder also returns the wrong scope; the
404 guard passes and must remain intact. APIs, portals and unrelated children are
explicit doubles, so this is not a user-input, effect, focus or layout test.
Runtime confidence is now **Observed (synthetic execution / HTTP persistence)**
for these mechanisms; browser appearance and actual focus remain unverified.

### Scoped design checkpoint before repair

Both components keep the already-approved Web archive-workbench system. The
person is editing project metadata or returning to a known conversation; the
intended feedback is calm and explicit about what has actually been saved/read.
Paper/raised-paper surfaces, graphite text and the existing semantic tokens keep
recovery in the same reading environment. Borders separate list states; the
existing shadow remains exclusive to the modal layer. Preserve the application
font stack, text-sm working copy, existing title hierarchy and 4px spacing base
with 20px panel padding. The list's only added control is the existing secondary
Retry pattern with a 44px minimum target; the settings layout is unchanged.

No new palette, font, navigation, modal or persistent draft feature is proposed.
The full rendered senior-designer checklist remains **NOT_VERIFIED**, because
these local states cannot be opened under the existing Web-start restriction.

### Local repair and verification

All four scoped mechanisms are repaired locally. The API accepts explicit null
for the three already-nullable fields only. Settings sends normalized dirty
fields, cancels old reads, publishes the canonical response into existing project
cache variants and closes before independent refresh. Failed writes still retain
the draft. The list retains same-project data and selection for transient errors,
offers a read-only Retry, and hides cached metadata/rows/actions for 401/403/404.
Native controls, fonts, tokens, row keys and the Undo owner remain unchanged.

[Sanitized local verification](ux-audit-project-recovery-2026-10-09-evidence/local-verification.json):

| Check | Result / boundary |
| --- | --- |
| New project settings HTTP tests | 7 passed / 0 failed / 0 skipped, 14.64s; explicit null, partial updates, duplicate-name rejection, independent persistence and unchanged messages |
| Combined settings/projects/ownership | 20 passed / 0 failed / 0 skipped, 39.84s; includes the same 7 above |
| Expanded component/query checks | 21 passed / 0 failed / 0 skipped; held/rejected reads, late cancelled responses, failed writes, cache variants, 401/403/404, selection, retry and Chinese copy |
| Web lint / nonincremental typecheck | Pass |
| One-worker Web build | Pass; no Web server or image build |
| Real browser, focus, visual layout | NOT_VERIFIED; no local server/fixture restart or new CI for this batch |

The tests use disposable SQLite and actual installed query/React code with
explicit API/input/portal/child doubles. Static markup is not interaction or
visual acceptance. No production state or imports were accessed. These changes
remain uncommitted and are not part of a12ce9e / CI 37812290017.
