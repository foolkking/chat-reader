# Context maintenance guidance proposal — 2026-10-03

Status: proposal for user review, not implemented. Scope supplements the active
Context migration and supersedes the earlier absence of maintenance reminders only
for this user-requested contextual guidance. No model calls or semantic validation.

## Evidence and intent

Current export delivery resolves EXPORT_CONTEXT only. The adjacent-to-annotations
Continuation workspace supports direct files, whole-package return and three saved
snapshots; it has no first-maintenance handoff. Maintenance needs a Raw package as
input, so requiring maintenance before any export would deadlock first use.

## Recommended threshold hypothesis

Count active canonical exported message bodies, including code and tool text,
excluding deleted/unselected content, transport metadata and attachment bytes.
Use Unicode code points (not UTF-8 bytes or JavaScript UTF-16 length). Proposed
initial normal threshold: 60,000 characters OR 100 nonempty messages. A message is
not a conversation or a guaranteed user/assistant pair. These are conservative
product defaults to test, not model context-window or quality guarantees.
After a known maintenance baseline, suggest again for 20,000 newly added characters
OR 40 messages. Historical body edits use a separate factual changed-since-baseline
notice, never a fabricated semantic-invalid verdict. Comparing different export
scopes must not reuse a whole-conversation baseline or disclose excluded content.
Do not rely on file modification times or upload time as evidence of coverage.

## Interaction

Show a single quiet inline recommendation in For AI export when threshold applies;
never block the download button, auto-open a modal, or interrupt reading. Show
actual message/character counts and reason. Actions: Prepare maintenance; Export
anyway; dismiss/snooze controls in a secondary menu. The adjacent Reader continuation
entry may show a subtle status label, no red notification badge.

Prepare maintenance expands a small three-step section in the same export surface:
1. Download the current Context Package (Raw-only first time; saved files included
   on later maintenance without claiming correctness).
2. Download the resolved personal/system CONTEXT_MAINTENANCE Skill and copy a
   maintenance request. Skills are installed/attached per the external AI runtime;
   never put the Skill ZIP inside the Context Package.
3. Return later to the continuation workspace beside annotations. Upload the output
   Context Package or individual Current/Index. Save directly, retain last 3 updates.
No automatic external transmission. Preserve export options and reading anchor
when moving between surfaces; do not stack two dialogs.

The user can hand the external maintained package directly to another AI without
returning it to Chat Reader. Return is required only to reuse those saved files in
future Chat Reader exports. After local save, offer an explicit Export with saved
files action; do not auto-download or claim semantic verification.

## State model

Below threshold/no files: no recommendation; manual preparation remains available.
Threshold reached/no files: suggest first maintenance, export remains available.
Only one member: show which member is missing; save/export remain possible.
Both members: show saved files and baseline facts, not verified/complete semantics.
New content since known baseline: show counts and suggest update at delta threshold.
Unknown imported lineage/coverage: files saved, coverage unknown; no inferred tail.
Old member inherited in a partial update does not mark the pair as maintained.
Only an explicit user statement may advance a maintenance baseline without source
comparison; record it as user-confirmed, never verified. UI edits/saves alone do not
prove full-conversation maintenance or suppress every future reminder.
Whole-package task pending/failure: old saved pair remains; maintain progress in
existing Task Center. Failure/refresh cannot erase drafts or export options.

## Preferences and responsive contract

Recommend default contextual reminders enabled, because the user now explicitly
requested this guidance. Allow account preference off, per-conversation mute and
remind after additional content. Persist dismissal against account/conversation/
source revision; opening the same unchanged export repeatedly must not re-prompt.
Expose threshold customization under expanded preferences; never require users to
configure tokenizers or model windows. No backup reminders or unrelated alerts.

Wide: one inline recommendation above the export action, one primary action, at
most one secondary action; steps expanded below. Narrow: stacked actions, content
wraps, no side-by-side multi-card grid, export action remains reachable. Keyboard
focus transfers to the target workspace title and returns to the trigger. No
background announcement loops. English/Chinese and light/dark retain hierarchy.

## Offline, permissions and accounting

Offline uses known snapshot counts and labels freshness. Can export/download cached
system Skill if available, cannot upload or claim server-save. Missing maintenance
Bundle must be stated; raw export still works. Cache only the necessary builtin
maintenance Bundle, never personal Skills in offline conversation packages.
All settings/baselines are account-isolated and protected by lease lock. Share has
no private continuation/reminder data. Admin read-only Reader must not mutate a
user's maintenance state. Backups may restore preferences/history but recompute
local baseline applicability after ID remapping. Task progress reuses existing jobs.
Counts unavailable: say unavailable, keep export usable, do not display zero/fake OK.

## Delivery order and acceptance

1. Finalize counting/baseline/dismissal contracts and API bounded statistics.
2. Add nonblocking inline guidance and resolved maintenance Skill handoff.
3. Link back to adjacent continuation workspace with state/anchor preservation.
4. Account preferences, repeat reminder suppression and historical change states.
5. Offline/cache, permissions, backup and bilingual responsive acceptance.

Tests: threshold edges; emoji/code/tool counts; same-role adjacency; zero/short/
very-long messages; changed content without count changes; source changes during
export; partial scope; partial Pair saves; unknown external coverage; stale response;
disabled/dismissed reminders across refresh/devices; personal Skill override/fallback;
actual downloaded Raw/Pair and copied request; external maintenance and return;
375/768/1440 widths, keyboard, locale/theme; no upload in export; offline locked and
missing-resource states. External semantic Skill success must be separately observed,
not inferred from app tests. This document is not implementation or user approval.
