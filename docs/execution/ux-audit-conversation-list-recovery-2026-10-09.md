# UX audit — conversation-list read and empty-state recovery

2026-10-09 · Local worktree after merge re-entry · Recorded before application edits.

## Scope and evidence

The existing `/` active-conversation list and `/archived` list for ordinary
archive readers on Web. Focus: failed reads, retained selection/navigation and
empty-state truthfulness. No Reader, Share, offline storage, mutation contract,
project list, design-system or deployment redesign is in scope.

Evidence is actual source, installed TanStack QueryObserver subscription/refetch
and cache transitions, and transpiled `ConversationList` static React markup.
The [baseline](ux-audit-conversation-list-recovery-2026-10-09-evidence/baseline.json)
is **11 pass / 17 fail / 0 skip**, 652.9394ms across 28 desired-contract cases.
Network, seeded selection and unrelated child components are explicit doubles.
No services or browser were started; no production or user conversations were
accessed. Real DOM continuity, keyboard focus, layout, timing and usage frequency
remain unverified. There is no accessibility conformance claim.

## What matters most

A temporary list refresh failure removes known reading links and selection
controls even though QueryObserver still retains their data. The same app already
preserves cached content in Recent and the locally repaired project list.
Separately, an empty active list reports that conversations were filed in
projects when the remaining record is archived, or even when the secondary
existence check failed. That explanation disagrees with the actual `scope=all`
request, which includes project conversations. Both problems can be addressed
inside the existing list's states and retry controls. Keep first-run import,
access-denial hiding, source ownership and the newly independent merge/Undo
owners intact.

## Findings and prioritized repair

| ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| STATE-01 | A failed refresh replaces retained reading links/selection with a full error | State coverage / recovery | Medium | Observed (code + QueryObserver + static markup); actual browser continuity Inferred | S |
| STATE-02 | Archived-only and failed-existence states are misreported as project filing | State coverage / navigation / copy | Medium | Observed (source + static markup); user reaction Inferred | S |

Both are defects, not taste calls. The 17 failed assertions are cases covering
these two findings, not 17 independently established UX defects.

### STATE-01 — keep the last readable list through a transient read failure

**Location:** `apps/web/features/conversations/conversation-list.tsx:204–226`,
`:72–75` and `:567–586` at the baseline hash.
`isError` returns before rendering rows regardless of retained query data.
The executed observer contains one cached row, but actual component markup has
no reading link or selected-row controls and prints the synthetic raw error
message. Its retry is not disabled while a held read is in flight. The generic
placeholder callback also accepts an archived/existence query as an active-list
placeholder; status filtering prevents wrong-status rows but does not make the
placeholder itself belong to the current list scope.

**User cost:** someone refreshing or returning to their archive loses the
already available navigation and apparent selection context until a successful
read. They also get a raw upstream message rather than a localized explanation
of whether known content is still available. Existing Retry works, so this is
not a no-exit or irreversible data-loss finding.

**Recommendation:** reuse the project/Recent pattern: retain current-query rows
for transient failures, place a compact **“Could not update conversations.
Previously loaded items are shown.” / “对话更新失败，仍显示上次内容。”** notice
beside them, and retry only that read. Disable Retry while fetching and expose
status semantics. Without retained rows, show a localized load error, not a
confirmed empty state. Preserve the existing HTTP 401/403/404 hiding boundary;
restrict placeholders to the same active/archived mode. Do not create a second
cache or promise retention across a new sort key's final error.

### STATE-02 — say what is actually known after the active list is empty

**Location:** the same file `:79–95` and `:241–287`;
`apps/api/app/api/routes/conversations.py:150–198`;
`apps/web/components/app-shell.tsx:22–26`.
The main request asks for active conversations with `scope=all`. The secondary
query includes archived conversations. When that query returns an archived row,
actual markup says **“No unfiled conversations”** and **“Existing conversations
are filed in projects. Expand a project in the sidebar to view them.”** The same
fallback appears after a failed secondary query, with no retry for that read.
The Chinese branch makes the equivalent claim. The API applies project-filing
exclusion only to `scope=history`, not to this `scope=all` request.

**User cost:** someone who just archived the last active conversation is directed
to projects instead of the archive; a failed existence check is presented as
known organization rather than uncertainty. No deletion or lost source content
has been observed.

**Recommendation:** retain the confirmed first-run import state. Otherwise use
**“No active conversations” / “暂无活动对话”** and a real **“View archive” /
“查看归档”** link to the existing `/archived` page, without claiming that every
saved record is archived. If the secondary check failed, explicitly say
**“Could not check saved conversations. Retry, or open the archive.”** and offer
Retry for that query only. Do not infer first-run emptiness from a failed secondary
result. Successful cached reads keep their existing freshness policy; this repair
does not add a second cache. Keep the archived page's own empty state distinct.

## Narrow implementation brief and what stays intact

Intent: a person organizing a private reading archive can continue from known
content during a refresh failure, and can find the archive after archiving their
last active conversation. Retain the quiet reading-workbench system: existing
paper `bg-surface`, graphite `text-secondary`, `border-ui` and restrained danger
text for read failures. Use the existing font stack, text-sm working copy, 4px
spacing and native 44px secondary actions. Existing `StateBlock` handles empty
and initial-error content; a flat inline notice handles cached errors. No new
tokens, typography, nested cards or dependencies are needed.

Rejected alternatives: a full-page error unnecessarily removes known navigation;
a silent cached list hides staleness; a second local cache adds lifecycle and
account-boundary costs. New archive restore/import UI is unnecessary because
the existing archive page and first-run import flow already provide those tasks.

Keep one merge recovery and Undo owner outside list branches. Preserve source
message contents, all mutation calls and status filtering. Maintain six baseline
access-denial controls, two existing successful-retry/selection controls, two
status-filter controls and first-run import. No backend change or migration is
required by this repair.

## Verification backlog and open questions

Run the 28-case focused suite, the merge/project/re-entry regression suites,
lint, nonincremental typecheck and bounded one-worker build. Add browser cases
to the existing isolated mutation suite for active/archived retained reads,
selection, retry, archive navigation and failed secondary checks at 375/1440px.
Only discovery is currently allowed: do not start the blocked local service,
restart fixtures, trigger another CI or deploy to obtain browser evidence.

Actual browser node/focus continuity and layout remain **NOT_VERIFIED**; the
visual scored checklist must not be reported as complete. A sort-key change that
ends in error may still have no cached result for that new key; this batch keeps
the error/retry path explicit rather than adding a separate cache. The audit is
local-only and not covered by passing a12ce9e CI or accepted 30a0d32 production.

## Implementation and verification ledger

The list now keeps current-mode cached rows/selection during transient errors,
uses a compact localized stale-content notice, and retries only the failed read.
Initial and empty-cache failures are explicit errors; 401/403/404 still hides
cached data and bulk controls. Same-mode placeholders, sort guarding, StateBlock
alert/status/busy semantics and the archive link implement the scoped brief.
No backend, mutation, cache architecture, token, dependency or migration changed.

The first repaired run was **24 pass / 4 fail**, 694.0581ms. Those four failures
were test-harness Retry counts: JSX created for an unused branch was counted even
though React never rendered it. Recording only the rendered Retry component
corrected the harness without removing assertions. The earlier unsubscribed-
observer baseline correction remains in `baseline.json`.

| Check | Result and boundary |
| --- | --- |
| Combined Node suite | **121 pass / 0 fail / 0 skip**, 2471.5196ms: 28 list + 43 admission + 21 project + 29 re-entry |
| Web lint | Pass after the current application/browser-test changes |
| Separate typecheck | `corepack pnpm --filter web exec tsc --noEmit --incremental false` passed after this list batch |
| Bounded Web build | Pass; Next 16.3.8, `NEXT_BUILD_CPUS=1`, `NEXT_STANDALONE=0`; 14 pages generated |
| Browser discovery | **19 cases**: original nine + four merge + six list cases; no browser execution in this batch |
| Earlier API evidence | 41 passes, disposable SQLite; seven source/test hashes unchanged, not rerun here |
| PostgreSQL concurrency | Two earlier skips; not rerun, **NOT_VERIFIED** |
| Release | HEAD/origin remain a12ce9e; all newer work uncommitted, no CI or deployment |

The [separate exact-source checkpoint](ux-audit-conversation-list-recovery-2026-10-09-evidence/local-verification.json)
owns current hashes. Older merge `local-verification.json` and
`reentry-verification.json` retain their original 54/93-case snapshots, even where
the now-expanded list/browser files differ. Their earlier “no HTTP” shorthand
means no automatic **merge lookup/POST**; opening the dialog can still read
account capabilities. It does not promise zero unrelated requests.

The six new browser cases cover active/archived × 375px Chinese/light and 1440px
English/dark, plus two empty-active/existence-error cases. They require actual
reading-node/focus retention, checked selection during held Retry, real successful
reads and unchanged synthetic messages/status. An offline/online transition is
used to request a refetch; the 503 is an explicit injected response. Empty active
reads do not claim database emptiness. The archived synthetic row and destination
are real fixture requirements. These assertions and their screenshots are
**discovered only**, not generated, observed or accepted.

Next audit candidate: archived-project read/restore recovery. Source inspection
suggests similar early-return and acknowledgement concerns; reproduce and record
them before any changes. Existing fixtures, user imports and unrelated worktree
residues remain untouched. No Web/API/worker/PostgreSQL restart or production
browsing was used. Visual scored verification remains **NOT_VERIFIED**.
