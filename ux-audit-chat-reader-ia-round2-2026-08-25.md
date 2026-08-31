# Chat Reader Product Information Architecture Audit
## Round 2 — Structural Deep Dive

## 1. Round 2 Scope

This round is deliberately limited to the Round 1 candidate gate:

1. `IA-R1-001` — global maintenance/security ownership hidden behind the “Appearance & language” preferences popover.
2. `IA-R1-002` — background work visible but owned visually by the Import/Search sidebar area rather than a stable global task context.
3. `IA-R1-003` — batch Import completion navigates to the first Conversation although the operation is multi-object.
4. `H-R1-001` — global search return context, revalidated and closed as an unconfirmed structural finding.

This is not a second whole-product audit. It does not repeat the Round 1 trunk test, full terminology inventory, full responsive sweep, or unrelated feature review. It uses the Round 1 report, its cited current code and screenshots, `PROJECT_STATE.md`, current routes/components, and a read-only public health check. No product source, schema, deployment, or user dirty file was modified.

## 2. Inherited Findings and Evidence

| Round 1 item | Revalidation result | Evidence status |
|---|---|---|
| `IA-R1-001` Settings/maintenance ownership | Remains a structural candidate. Current code still exposes Data and backup, Import Format settings, and Account Security inside `PreferencesPanel`, entered from a footer control labelled `appearanceLanguage`; outside pointer/Escape closes the parent popover. | Strong: current code and labels; screenshots establish shell. Authenticated task success not re-run. |
| `IA-R1-002` Global task ownership | Remains a structural candidate. `ImportTaskMonitor` handles import, merge, batch delete, export, and cleanup scans but is mounted below Import/Search on desktop and as a mobile fixed card. | Observed in supplied task screenshots + Strong current code. |
| `IA-R1-003` Batch Import completion | Remains a structural candidate. `finishCommittedImport` invalidates list queries and pushes the first `conversation_ids[0]`, although the response reports a batch count and the Import contract supports multiple Conversations. | Strong current code; batch user interpretation not observed this turn. |
| `H-R1-001` Global search return | Closed as a current structural finding. Search query/filter state is encoded in `/search` URL parameters and opening a result uses normal browser history. Scroll/active-index restoration is still unverified, but there is not enough evidence to design an IA change. | Hypothesis only; retain as a test question, not a backlog item. |

## 3. Candidates Closed During Revalidation

### H-R2-001 — Global search return context is not yet a confirmed IA defect

**Source:** `H-R1-001`.
**Status:** Closed — Not a Structural Problem on current evidence.
**Reason:** `SearchPage` serializes query, document type, role, project, status, and date filters into the `/search` URL; opening a result uses a normal route push, so the browser stack has a predictable route-level return. It is not proven that users lose the query or filters. The remaining question is whether remounting loses scroll position and active result selection, which is a behavioral recovery test rather than a current IA decision.
**Follow-up:** Verify once with an authenticated browser flow; only reopen if loss is reproducible and frequent enough to affect comparison work.

No other Round 1 candidate was closed. No adjacent observation changes the scope:

- Mixed English task labels are a localization/content issue, not a reason to create another task surface.
- The “Archived Conversation” versus `.cr` system archive naming debt remains low priority; it does not alter the chosen structure.

## 4. Structural Principles / Must Preserve

The target structure must preserve these current contracts:

- **Conversation remains the primary object.** Projects and Unclassified remain organization containers; Archived remains a Conversation lifecycle state.
- **Reader remains the main work surface.** Do not move source editing, local search, annotations, Files, Viewer, Share, or focus tools into a global dashboard.
- **Import remains progressive.** Known formats go directly to READY/import; mapping, grouping, drift repair, and diagnostics appear only for exception states; `.cr` restore remains a separate pipeline.
- **Share and Offline remain capability boundaries.** Public Share is share-scoped/read-only; Offline Library is a local reading boundary; neither becomes part of owner settings navigation by accident.
- **Background work remains non-blocking and recoverable.** Import, merge, deletion, export, and cleanup continue through the existing worker/task model; cancellation semantics and partial-result reporting remain explicit.
- **MessageVersion and reading-position contracts remain authoritative.** No settings/task/import change may trigger a full Reader reload or reset a valid reading anchor.
- **Destructive actions retain their current safety model.** Archive/delete/merge/cleanup continue to show progress, preserve failures, and distinguish cancellation of future work from interruption of the current item.
- **No multi-user, new product, or proactive optimization scope.** This is a structural consolidation of existing jobs, not a new account platform, command palette, or separate maintenance product.
- **Responsive changes preserve meaning, not geometry.** Desktop persistent surfaces may become mobile drawers/sheets, but object ownership, primary action, return target, and permission boundary must remain the same.

## 5. Deep Dive by Candidate

### 5.1 IA-R1-001 — Settings, maintenance, and security ownership

#### Desired Outcome

When the owner is in the global shell and wants to change a preference, prepare offline reading, manage import formats, back up/restore data, or manage the account, they should recognize a single **Settings** mental model, enter through a predictable global entry, and see the affected category before opening a consequential action. The task should complete in a focused surface; closing or cancelling should return to the same originating context without losing unsaved input or silently changing data.

#### Current Model

**Information objects**

- Appearance/language and Reader preferences are lightweight global settings.
- Offline Library is a distinct local-reading boundary.
- Data/backup owns a complete `.cr` system package.
- Import Formats owns persistent Built-in/Learned Profiles and revisions.
- Account Security owns password and logout.

These are not one user object, even though they are all global to the owner.

**Current entries**

- Primary: sidebar footer `Appearance & language`.
- Secondary: no explicit global Settings route or category entry.
- Contextual: Reader offline preparation; Import drift repair; login/security boundary.
- Desktop/mobile: same footer trigger in the sidebar/drawer.

**Current surfaces**

- `SidebarPreferences` is a transient `role=dialog` popover with outside-pointer and Escape dismissal.
- `PreferencesPanel` first shows theme and Offline Library; `More settings` reveals reader controls, then DataBackupPanel, ImportFormatSettings, and AccountSecurityPanel.
- The panel has a bounded scroll region and no separate persistent maintenance surface.

**Current flow**

```text
Global shell
→ “Appearance & language” footer
→ transient preferences popover
→ More settings
→ scroll to the relevant section
→ change preference / backup / import profile / password
→ popover closes or remains
→ return to shell
```

The Reader-to-Offline shortcut and Import-to-profile-repair shortcut are useful contextual paths and are not the problem.

**Current friction point**

The first label does not name four of the six job families. The same transient surface that is appropriate for theme and density also owns password change, backup, profile deletion/repair, and logout. A pointer outside the popover can close it while a multi-field action is in progress; this is code-supported risk, not a claim that every user has already lost input.

#### Root Cause

- `Ownership Ambiguity`: one entry owns unrelated global object families without naming them.
- `Maintenance vs Daily-Work Boundary Error`: appearance/preferences and consequential data/security operations share the same disclosure path.
- `Surface Type Mismatch`: a dismissible bounded popover owns operations that may be dirty, multi-step, or high consequence.
- `Progressive Disclosure Error`: “More settings” hides discoverability for actions whose frequency is low but whose recovery importance is high.

This is not primarily a button-placement bug. Renaming one string without changing ownership and dirty-state behavior would leave the structural problem intact.

#### Alternatives

| Option | Mental model / findability | Surface and flow | Context/recovery | Cost and risk | Decision |
|---|---|---|---|---|---|
| **Option 0 — Keep current** | Low discovery for backup/security/profile work; appearance label remains misleading. | No new surface or migration. | Highest risk of accidental dismissal and recall burden. | Lowest implementation cost, but preserves the root cause. | Reject for current evidence. |
| **Option A — Explicit Settings hub, focused consequential flows** | One predictable “Settings” entry; categories are recognized before action. | Keep existing popover as a lightweight hub for appearance, reader preferences, and Offline Library. Promote “Data & import” and “Account & security” as explicit category entries that open the existing focused panels in a persistent/route-backed dialog or sheet only when needed. | Dirty security/backup/profile work owns its own close/cancel contract; outside click does not discard active input. Contextual Reader/Import shortcuts remain. | Smallest structural change that fixes both ownership and surface type; requires state/return tests, not a new data model. | **Recommended.** |
| **Option B — Dedicated Settings page with sections** | Strongest deep-linking and category findability. | New `/settings` destination owns every global category; sidebar adds a permanent destination. | Best refresh/re-entry semantics, but more navigation breadth and a new top-level route. | Higher migration and discoverability cost; overkill without evidence that Option A cannot scale. | Keep as fallback if settings content grows or live tests show Option A insufficient. |

#### New-Surface Necessity Test

Option A does not add a new product object or permanent top-level destination. It reuses the existing preferences hub and existing panels, but changes which surface owns consequential state. A focused dialog/sheet is justified for password change, profile repair, and backup because the current dismissible popover cannot reliably protect dirty multi-step input; it is an existing interaction pattern in Chat Reader, not a new settings product. A dedicated page is not necessary unless Option A fails live re-entry or the settings inventory materially expands.

#### Decision — IA-R2-001

**Source Round 1 findings:** `IA-R1-001`
**Status:** Adopt (structural recommendation; implementation not started)
**Root cause:** global ownership ambiguity plus transient-surface mismatch.
**Desired outcome:** a user can predict where global settings, data/import administration, and security live without remembering an appearance-specific label; consequential work cannot be lost by an incidental outside click.
**Chosen structural change:** rename the global entry to **Settings** (or the product’s canonical Chinese equivalent), make the hub’s categories explicit, keep appearance/reader/offline controls lightweight, and route Data & import and Account & security into focused state-owning panels with explicit completion/cancel/return contracts. Keep contextual Reader/Import shortcuts.
**Why this option:** it fixes the object/surface boundary without adding a new permanent navigation destination or duplicating existing contextual entries.
**Alternatives rejected:** Option 0 preserves the defect; Option B is a valid fallback but introduces more navigation than current evidence requires.
**Must preserve:** theme/language and Reader preference behavior, Offline Library route, `.cr` backup boundary, Import Format revision semantics, password/session safety, and Reader opener context.
**Acceptance evidence required:** browser task tests for finding each category from shell, focused password/profile/backup flows, outside-click/escape with dirty input, refresh/re-entry, desktop drawer equivalence, and no regression to Reader→Offline or Import→profile repair.
**Open risks:** category naming and whether a focused panel is a dialog or route-backed sheet need product copy validation; do not claim a final label from this audit alone.

#### Target Flow and State Contract

```text
Shell
→ Settings
→ choose Appearance & reading | Data & import | Account & security
→ focused category surface
→ initial / loading / ready state
→ action
→ success or actionable error
→ explicit close/return to Settings or original opener
```

Required states only:

- **Loading:** existing preference/data query or backup task is pending; do not imply completion.
- **Dirty:** password/profile repair/backup options have changed; close, Escape, and outside pointer require a clear preserve/discard decision where input exists.
- **Error:** identify the affected category, preserve entered values where safe, and provide retry or operator recovery path.
- **Success:** show the actual side effect (profile revision saved, backup task queued/committed, password changed) and return to the category hub; never silently jump to Reader.
- **Interrupted/re-entry:** a refresh may restore a route-backed category or safely discard a non-persisted draft with an explicit explanation; persistent profiles and committed backup tasks remain discoverable.

#### Surface Contract — Settings Hub

**Primary responsibility:** choose a global settings/maintenance category.
**Object/context owned:** owner-wide preferences and entry to global maintenance objects.
**May contain:** theme, language, Reader preferences, Offline Library link, category links, current task summary.
**Must not contain:** full multi-step password forms, destructive data operations, or long diagnostic output directly in the lightweight popover.
**Entry conditions:** authenticated owner shell; library mode may show the online/offline boundary only.
**Persistent state:** selected category may be URL/session-represented if a focused surface opens; lightweight preferences remain immediate.
**Dirty/unsaved state:** none for hub itself.
**Close/cancel:** closes to the exact opener; does not silently cancel a focused dirty panel.
**Completion:** category surface reports completion; hub remains available.
**Return target:** original shell, Reader, or Import context.
**Back/Escape:** focused panel handles first; then returns to hub; then closes hub.
**Desktop behavior:** compact hub/popover is acceptable.
**Mobile behavior:** same categories in the sidebar drawer; focused work uses a full-height sheet or equivalent.
**Permission/read-only variants:** owner-only; offline/library mode must not show unavailable server maintenance as if it were local.
**Refresh/re-entry:** committed changes persist; uncommitted sensitive input is never silently claimed as saved.

#### Responsive Contract

Desktop and mobile must expose the same category concepts and priority. Desktop may keep a compact popover hub; mobile may use a sheet/drawer. Password/profile/backup flows must have a reachable footer/action area above the keyboard and a visible close/back path. Contextual Reader and Import entries remain valid shortcuts but point to the same category-owned contracts rather than bypassing them.

#### Acceptance Criteria

- From any authenticated shell, “Settings” is recognizable without first interpreting it as appearance-only.
- Backup, Import Formats, and Account Security are findable without scrolling through unrelated Reader preferences.
- Starting a password/profile/backup action and clicking outside cannot silently lose dirty input.
- Completion returns to the settings category or original Reader/Import opener, not an arbitrary Conversation.
- Reader→Offline and Import→repair shortcuts remain one contextual step.
- Desktop and mobile expose the same category names and permission boundaries.
- No new settings object, user-account model, or duplicate maintenance workflow is introduced.

### 5.2 IA-R1-002 — Global background task ownership and re-entry

#### Desired Outcome

When delayed work is running, the owner should know **what is running, why it exists, where it came from, whether it can be stopped, and how to reopen its result** without remembering that all work happens under Import. The same task concept should be predictable on desktop and mobile, while contextual surfaces may continue to show a shortcut.

#### Current Model

**Information objects:** `BackgroundTask` (import, merge, batch delete, export) and `CleanupScan` (IMPORT/BATCH review). They are global jobs with server status, progress, retry/cancel, and sometimes result IDs/download URLs.

**Current entries:** Import button/sidebar monitor is the apparent primary; Reader More, Archived batch actions, cleanup rules, and export actions are contextual creators. Mobile exposes a fixed bottom monitor card.

**Current surfaces:** one `ImportTaskMonitor` component, rendered in two placements; task cards are persistent only while returned by active-task polling, with completed status shown transiently or dismissed in local storage. Cleanup review is opened from the same monitor but uses separate summary language.

**Current flow:**

```text
Contextual action (Import / Reader / Archived / Rules)
→ worker task queued
→ monitor beneath Import/Search or mobile bottom card
→ progress / cancel / retry
→ completed/failed summary
→ open conversation, download, or cleanup review
```

**Current friction point:** the object is global but its primary visible owner is contextual and Import-centric. Mobile placement improves visibility but makes the same global object feel like a transient interruption.

#### Root Cause

- `Ownership Ambiguity`: a cross-domain object is visually owned by Import.
- `State Model Gap`: active, terminal, dismissed, and re-openable states do not have one named global re-entry contract.
- `Interruption / Re-entry Gap`: the task can outlive the page that created it, but the user’s route back is implicit.
- `Responsive Semantic Divergence`: desktop/sidebar and mobile/fixed-card placements expose the same data with different apparent responsibilities.

This is not an implementation bug in progress polling; the monitor already updates, cancels, retries, and surfaces partial failures. The structural issue is where the task object belongs in the product model.

#### Alternatives

| Option | Mental model / ownership | Flow and recovery | Cost/risk | Decision |
|---|---|---|---|---|
| **Option 0 — Keep Import-owned monitor** | Lowest discovery for non-import tasks; preserves current placement. | Existing progress/cancel/retry remain, but return depends on origin memory. | No migration; root cause persists. | Reject. |
| **Option A — Promote existing monitor to a global Task/Activity center** | One global job object with contextual creation links; users can predict “Tasks.” | Keep small contextual cards as shortcuts; add a stable global launcher/badge to open the existing monitor in expanded form. Each task retains origin, scope, result, cancel/retry, and return link. | Reuses task API/component; adds an ownership entry, not a new job system. | **Recommended.** |
| **Option B — Dedicated `/tasks` page with history** | Strongest persistence and auditability. | Full route owns active/recent/failed jobs and all re-entry. | New top-level destination and terminal-history product; exceeds current need and may retain sensitive cleanup history longer than desired. | Not recommended without measured task volume/recovery failures. |

#### New-Surface Necessity Test

The current task monitor already is the required surface; it is misplaced, not absent. Option A reuses it and gives it a stable global entry plus contextual summaries. No new page, persistent history object, or task subsystem is required. Option B fails the “reduces surfaces” test unless future task volume proves a route is necessary.

#### Decision — IA-R2-002

**Source Round 1 findings:** `IA-R1-002`
**Status:** Adopt (structural recommendation; implementation not started)
**Root cause:** global task ownership and re-entry are implicit, while the task engine itself is adequate.
**Desired outcome:** every delayed job is findable as a Task/Activity regardless of its origin and can be reopened without recalling the originating surface.
**Chosen structural change:** promote the existing monitor to a named global Task/Activity owner with a stable shell launcher/badge; keep contextual task cards in Import, Reader, Archived, and cleanup surfaces as shortcuts to the same task.
**Why this option:** solves ownership with the least duplication and preserves the existing worker/progress/cancel model.
**Alternatives rejected:** Option 0 leaves non-import recovery ambiguous; Option B adds a route and terminal-history scope not supported by evidence.
**Must preserve:** low-priority noise scheduling, deletion cancellation semantics, partial failure reporting, task IDs/results, and cleanup scan expiry.
**Acceptance evidence required:** start import/merge/delete/export/cleanup from different surfaces, leave the originating route, open global Tasks on desktop/mobile, retry/cancel, complete, fail, refresh, and use result links.
**Open risks:** the exact stable entry location and whether completed tasks remain until explicit acknowledgement require usage and security/privacy review.

#### Target Flow and State Contract

```text
Any contextual creator
→ task queued
→ global Tasks indicator (with type/scope/progress)
→ open task center/expanded monitor
→ processing / cancelling / failed / committed
→ result action or dismiss presentation
→ return to opener or task result context
```

Applicable states:

- **Queued/processing:** show truthful phase, progress, scope, and whether cancellation affects only future items.
- **Cancelling:** explain that the current item finishes and future work stops when that is the contract.
- **Failed/partial:** preserve failed-item details and offer retry; do not represent partial success as total failure or success.
- **Committed:** show result link(s) appropriate to task type; dismissal hides presentation, not an unacknowledged failure.
- **Refresh/re-entry:** active task remains discoverable from the global indicator; a task opened from a contextual card can be reopened without returning to that origin.
- **Offline/public Share:** owner tasks are not exposed in public Share; Offline may show only local package status, not server task claims.

#### Surface Contract — Global Task Center

**Primary responsibility:** monitor and recover delayed owner work.
**Object/context owned:** BackgroundTask and active CleanupScan status, not the underlying Conversation itself.
**May contain:** active/failed/recently completed task summaries, origin label, scope, progress, cancel/retry, result links, cleanup review entry.
**Must not contain:** full Import mapping workspace, Conversation editing, destructive action composition, or permanent cleanup history by default.
**Entry conditions:** authenticated shell; contextual task creator may deep-link to one task.
**Persistent state:** task status is server-authoritative; presentation dismissal is local/UI state.
**Dirty/unsaved state:** task decisions such as cancel/retry require confirmation only where the existing contract needs it; opening the center must not mutate work.
**Close/cancel:** close returns to opener; cancel stops only cancellable future work and states current-item behavior.
**Completion:** task-specific result or review link; no generic “done” without consequence.
**Return target:** opener when available, otherwise shell/library.
**Back/Escape:** closes the expanded monitor, never cancels the task implicitly.
**Desktop behavior:** stable shell launcher plus expandable monitor; contextual cards remain.
**Mobile behavior:** bottom card is a notification/shortcut to the same task center; full-height sheet may be used for detailed multi-task review.
**Permission/read-only variants:** owner-only; public Share never shows it.
**Refresh/re-entry:** active and failed tasks remain discoverable by task ID; dismissed presentation does not erase server result.

#### Responsive Contract

Desktop and mobile both expose a named Tasks/Activity concept. Desktop can use a sidebar/header indicator; mobile can use a bottom card and a sheet. The visual placement may differ, but labels, task type, scope, cancellation meaning, result link, and return target must be the same. A mobile user must not need to reopen Import merely because a merge or deletion began elsewhere.

#### Acceptance Criteria

- Starting any supported delayed job from Reader, Archived, Import, or cleanup rules exposes the same global Tasks entry.
- Leaving the creator route does not hide the active task or its recovery actions.
- Task cards identify type and scope before showing progress; cancellation semantics are explicit.
- Failed and partial tasks remain reopenable and retryable until dismissed according to the existing retention policy.
- Completed cleanup opens the existing review dialog; completed import/export opens the correct result, not a generic task page.
- Desktop and mobile use equivalent task vocabulary and return behavior.
- No new permanent task-history data is retained unless a separate evidence-backed decision authorizes it.

### 5.3 IA-R1-003 — Batch Import completion and return contract

#### Desired Outcome

When a user imports multiple Conversations or Families, the completion state should acknowledge the batch as a batch, make all imported results discoverable, and still offer a fast path to the first Conversation. The user should not have to infer that “the first Conversation opened” means “all selected items committed.” Closing, refresh, failure, or re-entry should preserve the import result scope.

#### Current Model

**Information objects:** ImportSession/InputGroup/Family produce multiple canonical Conversations; `CommitImportResponse` includes `conversation_count` and `conversation_ids`.

**Current entries:** global Import dialog, list/empty-state Import action, and adaptive mapping/repair entry. Known formats can reach READY directly; unknown formats resolve then commit directly.

**Current surface:** `ImportPanel` owns the commit mutation and reports `已导入 N 个对话`, then `finishCommittedImport` invalidates queries, closes the dialog through `onImportCommitted`, and pushes the first Conversation route.

**Current flow:**

```text
Import files
→ analyze/group/profile resolve
→ READY
→ commit batch
→ invalidate conversations/projects/tasks
→ close dialog
→ open conversation_ids[0]
```

**Current friction point:** the operation has a batch result but the dominant completion surface is a singular Reader. The commit result is transient component state and is not a durable user-facing result set.

#### Root Cause

- `Entry/Result Mismatch`: batch entry resolves to one object as the dominant next step.
- `State Model Gap`: completed Import has a count and IDs in response but no explicit “batch result” state in the user-facing flow.
- `Context Preservation Gap`: closing the dialog and navigating to one Conversation discards the visible scope of the batch.

This is not a reason to redesign Adaptive Import, add a new import format, or change the canonical database model. It is a completion/return contract problem.

#### Alternatives

| Option | Mental model / result | Flow/recovery | Cost/risk | Decision |
|---|---|---|---|---|
| **Option 0 — Keep first Conversation navigation** | Fast for one item; ambiguous for batches. | Existing direct path and query invalidation remain. | No change, but batch scope is lost. | Reject for multi-item completion. |
| **Option A — Batch completion summary in existing Import surface** | Import remains the owner of “what was imported”; all IDs/counts are visible; opening first is a secondary shortcut. | Keep dialog open at completion with summary and compact result list/Library link; close returns to original context. Task monitor can reopen the same summary for background commit. | Smallest change; no new persistent object or route required if result IDs are retained for the session/task. | **Recommended.** |
| **Option B — Dedicated Import Results route** | Strongest deep link and large-batch browsing. | New route owns batch result history and filtering. | Adds a new destination and retention problem; not warranted by current evidence. | Reject unless batch volume or recovery data proves Option A insufficient. |

#### New-Surface Necessity Test

Option A reuses the Import dialog and existing Library. A new Results page is not needed to express a count, list, open-first shortcut, and “view in Library” link. A route is justified only if large batches require pagination, long-lived sharing, or re-entry after the session/task result has expired; those are evidence gaps, not current requirements.

#### Decision — IA-R2-003

**Source Round 1 findings:** `IA-R1-003`
**Status:** Adopt (structural recommendation; implementation not started)
**Root cause:** the batch completion state is collapsed into a single-object Reader transition.
**Desired outcome:** users understand the whole batch committed and can reach every result while retaining a one-click path to the first Conversation.
**Chosen structural change:** make **Import complete** an explicit state in the existing Import surface, show count plus a compact list or Library-scoped result link, make “查看第一条” secondary, and let close return to the original context. The task monitor may reopen this same completion summary when commit is asynchronous.
**Why this option:** it changes only result ownership and return behavior; it preserves direct import, Adaptive mapping, current invalidation, and Reader as the Conversation owner.
**Alternatives rejected:** Option 0 hides batch scope; Option B creates a new route and history model without evidence.
**Must preserve:** known-format direct import, unknown-format mapping once per Family, `.cr` independence, duplicate policy, project/list invalidation, and first-Conversation fast path.
**Acceptance evidence required:** disposable two-, five-, and multi-Family imports; complete/failed/partial/refresh/reopen cases; result count matches committed IDs; all results are findable; first item remains one click; closing preserves opener.
**Open risks:** exact result-list density and whether IDs remain available after task/dialog unmount need a product-state decision; do not invent permanent batch history yet.

#### Target Flow and State Contract

```text
Select files
→ analyze/group/resolve
→ READY
→ commit queued/processing
→ Import complete summary
   ├── view imported set in existing Library
   ├── open first Conversation (secondary shortcut)
   └── close and return to original opener
```

Applicable states:

- **Ready:** count and expected scope are visible before commit.
- **Processing:** dialog/task monitor states that the batch is still running; no premature success.
- **Completed:** count, imported set or a Library-scoped link, warnings/duplicates if any, and first-item shortcut.
- **Partial/failed:** distinguish committed IDs from failed groups/items; preserve retry or replacement path without claiming all succeeded.
- **Interrupted/re-entry:** if the dialog closes, the task center can reopen the completion summary while its result is retained; if no result is retained, route to Library with a clear imported-time sort rather than silently open an arbitrary Conversation.
- **Cancel:** before commit, cancel leaves no Conversations; during background commit, use existing task cancellation semantics and report committed versus not-started items.

#### Surface Contract — Import Completion Summary

**Primary responsibility:** communicate and expose the result scope of one ImportSession commit.
**Object/context owned:** the just-completed ImportSession and its committed Conversation IDs, not long-term Conversation management.
**May contain:** count, status, warnings, duplicate policy result, compact result links, Library shortcut, first-item shortcut, close.
**Must not contain:** source editing, full Project management, profile administration, or a second mapping editor.
**Entry conditions:** commit has reached a truthful terminal state.
**Persistent state:** session/task result only for the existing retention window; canonical Conversations remain in Library/Projects.
**Dirty/unsaved state:** no source draft is owned here.
**Close/cancel:** close returns to the Import opener; before commit, cancel uses current session cancellation.
**Completion:** count and result scope are explicit; success is not inferred solely from route navigation.
**Return target:** original shell/list or task center; first Conversation is an explicit shortcut.
**Back/Escape:** before commit follows existing session safety; after commit closes summary without deleting results.
**Desktop behavior:** existing dialog/overlay can show a compact result list and Library action.
**Mobile behavior:** same summary in a scrollable sheet with primary “查看导入结果” and secondary first-item shortcut.
**Permission/read-only variants:** owner-only; imported Conversations retain normal owner permissions; Share/Offline are not auto-created.
**Refresh/re-entry:** active session remains recoverable through existing session storage; terminal result is reopenable through the task center only while the current task/result retention contract allows it.

#### Responsive Contract

Desktop and mobile both lead with the batch result, not the first item. Mobile may use a sheet and a vertically stacked result list; desktop may use a two-column summary/list. Both retain the same primary “view imported set” concept, secondary “open first,” explicit close, and partial-failure explanation.

#### Acceptance Criteria

- A two-Conversation import visibly reports two committed results, not only one opened Reader.
- A batch user can open the imported set in the existing Library/list without re-uploading or searching from scratch.
- “Open first” remains available but is not the only completion action.
- Partial/failed items are distinct from committed items and remain actionable.
- Closing returns to the Import opener; Reader reading position and other unrelated context do not reset.
- Refresh/re-entry does not claim success before commit and does not silently discard a committed result scope.
- `.cr` restore and single-Conversation imports remain understandable and are not forced through a new batch page.

## 6. Target IA Delta

| Delta | Related finding | Target change | Explicitly not changing |
|---|---|---|---|
| **Rename** | IA-R1-001 | Footer global entry becomes a canonical Settings label rather than Appearance & language. | Theme/language controls and existing translation system. |
| **Promote** | IA-R1-001 | Data & import and Account & security become recognizable category ownerships in the Settings hub. | Reader contextual Offline and Import profile-repair shortcuts. |
| **Change Surface ownership** | IA-R1-001 | Consequential multi-step panels own dirty state and close/return; lightweight popover remains a hub. | Existing backup/profile/password domain contracts. |
| **Keep / reuse** | IA-R1-002 | Existing `ImportTaskMonitor` becomes the global task owner; contextual cards remain shortcuts. | Worker, low-priority scheduling, cancellation, retry, partial failure, cleanup retention. |
| **Promote** | IA-R1-002 | Add a stable shell-level Tasks/Activity entry or indicator. | No new task history object or `/tasks` route by default. |
| **Change return path** | IA-R1-003 | Import terminal state becomes a batch completion summary in the existing Import surface. | Direct known-format import, Adaptive mapping, `.cr` pipeline. |
| **Demote** | IA-R1-003 | Opening the first Conversation becomes a secondary shortcut after batch completion. | The one-click first-item path itself. |
| **No change** | H-R1-001 | Keep normal global search URL/history path pending behavior verification. | No new search page or persistent search workspace. |
| **No change** | IA-R1-004 | Keep Archived and `.cr` as distinct objects and pipelines. | Only consider qualified terminology clarification later. |

## 7. Terminology Decisions

| Current term | Proposed canonical term | Where it appears | Compatibility / risk |
|---|---|---|---|
| Appearance & language | **Settings** / **设置** | Sidebar footer, dialog label, hub heading | Existing appearance/language translation keys can remain internally during migration; user-facing label must match broader ownership. |
| More settings | **Preferences** or category links | Inside lightweight Settings hub | Avoid a single catch-all disclosure for backup/security/import administration. Exact Chinese copy requires product wording validation. |
| Data and backup | **Data & backup** / **数据与备份** | Settings category and focused panel | Keep `.cr` explanation and “restore through Import” boundary. |
| Import formats | **Import formats** / **导入格式** | Settings category and repair flow | Keep Profile/Revision technical terms out of routine copy; show them in diagnostics/settings detail only. |
| Account security | **Account & security** / **账户与安全** | Settings category and focused panel | Password/change/logout remains owner-only and separate from Share password. |
| Import task cards | **Tasks** / **任务** or **Activity** / **活动** | Global shell indicator and contextual summaries | Choose one noun after a short owner wording check; task type remains visible. |
| Open first Conversation | **Open first** / **打开第一条** | Secondary Import completion action | Must not be the only success wording for a batch. |
| View imported set | **View imported conversations** / **查看导入的对话** | Import completion primary action | Target is existing Library/list, not a new result product. |
| Archived vs `.cr` archive | Keep distinct object-qualified phrases | Lifecycle page versus Import/backup | Do not collapse the concepts; low-priority copy clarification only. |

## 8. Must-Not-Regress

- Reader remains the canonical Conversation work surface; no settings/task/import change may make Reader feel like a subpage of a maintenance center.
- Existing Reader close, Escape, focus restoration, source-to-reader locate, and reading-anchor behavior remain intact.
- Adaptive Import known-format direct path, unknown-format mapping, Family reuse, drift repair, diagnostics, and direct import remain progressive rather than always visible.
- `.cr` archive restore remains independent from Adaptive JSON/Markdown mapping and from Conversation lifecycle Archived.
- Project/Unclassified organization, current-project drop target, menu movement, and mobile alternatives remain intact.
- Public Share remains a share-scoped read-only capability and never gains owner Settings/Tasks actions.
- Offline Library remains a local reading boundary; server-only backup/security/import-format actions are not presented as local offline operations.
- Background deletion keeps “stop future items, finish current item” semantics, immediate list updates, retryable failures, and no production-volume/data-loss shortcuts.
- Cleanup scans remain candidate/review workflows with no silent deletion, no confidence model, and no retained completed/ignored scan history beyond the current contract.
- Auth/session, password recovery, worker heartbeat, protected diagnostics, and backup compatibility remain unchanged.
- Existing dirty user worktree and single `master` branch policy are preserved.

## 9. Implementation Impact Boundary

This section describes the possible scope of a later implementation, not an authorization to implement it.

### IA-R2-001

- Likely surfaces: `SidebarPreferences`, `PreferencesPanel`, DataBackupPanel, ImportFormatSettings, AccountSecurityPanel, existing dialog/sheet focus and dirty-state contracts.
- Likely impact: UI ownership/labels and local route/session state; no new database migration or user object is required by the recommended Option A.
- Tests needed: settings entry/trunk tasks, password/profile/backup dirty-state dismissal, desktop/mobile re-entry, Reader/Import contextual shortcuts.
- Avoid: a new account schema, new global settings backend, or moving contextual actions out of Reader/Import.

### IA-R2-002

- Likely surfaces: `ImportTaskMonitor`, ProjectSidebar shell placement, task summary links, mobile task card, existing active-task and cleanup-scan queries.
- Likely impact: one stable launcher/expanded presentation and explicit origin/result metadata; existing worker/API task contracts should be reused.
- Tests needed: cross-origin task creation, route change/reload, progress/cancel/retry/partial failure, mobile task-center parity.
- Avoid: a new worker architecture, permanent task-history table, or a separate cleanup product.

### IA-R2-003

- Likely surfaces: ImportPanel, ImportDialogProvider, Adaptive Import completion state, task monitor result link, existing Library/list navigation.
- Likely impact: preserve `conversation_ids`/count as a terminal result scope and choose a Library-scoped return path; no new persistent batch entity is required initially.
- Tests needed: single, multi-item, multi-Family, duplicate, partial/failure, refresh/re-entry, desktop/mobile completion.
- Avoid: a new result route, re-upload workflow, or changing canonical Conversation persistence.

No recommendation in this report requires a database migration, new dependency, new external service, or deployment change. Whether a route-backed focused panel is needed for settings is an implementation/design decision to validate with the existing modal/router contract.

## 10. Unresolved Design Decisions

1. **Settings category wording:** “Settings,” “Preferences,” and “Data & security” need a short owner wording check in the product’s Chinese/English locale pair. The structural decision does not depend on the exact translation.
2. **Focused settings surface mechanism:** Option A requires a state-owning focused panel for consequential work, but this report does not choose between an existing dialog, route-backed sheet, or a small dedicated settings route. Choose the smallest mechanism that survives dirty-state, refresh, and mobile keyboard tests.
3. **Global task indicator placement:** sidebar, header, or a combined shell status must be tested against current dense desktop layout and mobile thumb reach. The invariant is stable discoverability, not a particular icon location.
4. **Terminal task retention:** determine how long completed/failed task results remain reopenable without creating unwanted history or exposing sensitive cleanup details.
5. **Batch result scope:** determine whether a Library query/selection can represent the just-imported set without a new persistent ImportBatch object. If not, revisit Option B only with evidence.
6. **Global search restoration:** run the browser test before reopening `H-R1-001`; do not preemptively add persistent search state.

## 11. Final Prioritized Change Set

Only evidence-supported structural changes are included:

| Priority | Decision | Change | Scope | Verification gate |
|---|---|---|---|---|
| 1 | `IA-R2-001` Adopt | Rename and restructure the global Settings hub; give Data & import and Account & security explicit ownership; move consequential dirty work into focused state-owning panels while retaining contextual shortcuts. | Settings shell and adjacent panels only. | Authenticated desktop/mobile findability and dirty-state/re-entry flows; no Reader/Import regression. |
| 2 | `IA-R2-002` Adopt | Promote the existing task monitor to a stable global Tasks/Activity owner; keep contextual cards as shortcuts and use one task/result vocabulary across desktop/mobile. | Shell placement and task monitor presentation only. | Cross-origin task start, route change, refresh, cancel/retry/partial failure, mobile parity. |
| 3 | `IA-R2-003` Adopt | Make Import completion a batch summary in the existing Import surface; show the imported set/Library path, keep first Conversation as a secondary shortcut, and preserve close/return context. | Import terminal state and result navigation only. | Single/batch/multi-Family/partial/re-entry flows; no new result route unless evidence later requires it. |

`H-R1-001` is closed pending browser evidence. `IA-R1-004` remains a low-priority terminology observation and is not part of the structural change set.

**Round 2 complete. No implementation started.**
