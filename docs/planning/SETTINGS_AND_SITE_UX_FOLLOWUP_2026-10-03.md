# Settings cleanup and site UX follow-up — 2026-10-03

Status: user-requested scope and execution order, pending implementation.
This adds to the active Context migration; it does not replace unfinished work.
Screenshots supplied in the conversation are visual references. Do not copy their
account values, conversation names, business identifiers or tokens into evidence.

## Required sequence and deployment authorization

1. Complete the approved Context migration under the latest user overrides:
   direct Current/Index saves, last three snapshots, own Skills preserved,
   ZIP distribution with automatic same-name Markdown wrapping, no Skill viewer,
   exact three supplied default ZIPs, no uploaded script execution or model calls.
2. Revisit every user/admin settings feature against the original settings plan
   and current user decisions, from the user's perspective. Complete functionality
   and the screenshot-specific cleanup below, including similar unmarked cases.
3. Complete appropriate tests, commit and deploy this completed work. This explicit
   user instruction authorizes this deployment and supersedes the earlier no-deploy
   boundary at this point in the sequence. Do not deploy the current incomplete tree.
   Follow the existing release/backup/config preservation process, verify CI and
   actual deployed behavior, and never overwrite server configuration with local .env.
4. After that deployment, audit all pages and layouts, identify and implement at least
   15 valuable usability improvements, prioritizing the most consequential problems.
   Fifteen is a floor, not a quota of cosmetic edits. More may be fixed when valuable.
   The later audit's fixes require tests and evidence; do not assume an additional
   production release is included in the explicitly sequenced first deployment.

## Screenshot-specific acceptance

- Settings menu: remove permanent preference-sync success, persistent global limit
  footnotes, duplicated file explanations and descriptions beneath small feature
  entries. Keep actual failures/pending changes actionable where they occur.
- Help/diagnostics: remove the highlighted connected-server introduction block,
  explanatory offline paragraph and checked-at label. Move version/build/offline
  availability/lease facts to quiet small text at the bottom. Keep real capability
  restrictions and useful help accessible; no fake healthy state.
- Import: remove the .cr archive tab/choice from the import-data dialog. Archive
  restore remains reachable through settings Data & Backup, with appropriate user/
  administrator scope. No loss of restore function or old archive compatibility.
- My shares: remove the introductory sentence and repeated source-title subtitle.
  Hide link mode, scope and exact expiry by default; show them from the visible
  active/expired/revoked status on hover, keyboard focus and touch activation.
  Preserve source-conversation navigation elsewhere if removal would lose it.
  Popovers must be dismissible, not depend on pointer hover, and not contain token
  leaks. Revoke and expiry behavior remains unchanged.
- Account/security: remove highlighted explanation text. Move administrator/role
  badge beside Account identity heading, eliminating a dedicated status row.
  Show email and username on the same row when width allows; stack cleanly on
  narrow/reflow layouts. Preserve labels, real editability, errors and save behavior.
- Skills: remove duplicated panel title and introductory/default-policy text,
  repeated source phrases and redundant file-picker labels/empty-file text.
  Use concise upload/replacement controls for ZIP/Markdown; automatic wrapping and
  unchanged names still work. Do not restore a Skill viewer.
- Import formats: remove the duplicated title and tutorial paragraph. Replace raw
  uppercase source modes and verbose validation/version prose with concise readable
  format labels/status. Details belong in an intentional version/details action.
  Preserve learning, repair, personal preferences and system publication isolation.
- Noise rules: remove highlighted policy and exception explanations from default
  view. Learning still needs explicit consent; exceptions/rules never silently
  change global settings or rewrite existing content. Explain consequences only
  when needed at the actual action.
- Runtime status: remove highlighted implementation/refresh/statistics explanations.
  Keep accurate states, refresh and incomplete/unavailable indicators. Put any
  needed metric definition behind an intentional detail affordance.
- Apply the same principles to unmarked settings: remove repetitive introductions,
  obvious instructions, duplicate headings and internal implementation descriptions.
  Do not remove necessary labels, actionable errors, destructive-action consequences
  or meaningful state solely to make the page visually shorter.

## Functional re-audit scope

Ordinary user, Root Admin, offline and lease-expired states. Compare every existing
setting with the initial approved plan: entry, permission, real effect, persistence,
failure/retry and browser behavior. Use the current corrected Skill/Context design
in place of original paused stage five. Recheck import formats/rule ownership,
offline/sync, account preferences and reading positions, backup/restore, sharing,
email/authentication, administration and diagnosis/runtime status. Explicit user
exclusions (recycle bin, self-delete, unsolicited backup reminders, etc.) remain.
Maintenance threshold reminders remain a separate design proposal, not implicitly
approved by this screenshot cleanup request.

## Whole-site audit method and evidence

Inventory real routes/surfaces including library/sidebar, projects/recent/archive,
Reader and source/annotation/attachment workspaces, search, import/mapping/noise,
export/share, public Share, offline library/Reader/sync, authentication/account,
user/admin settings, tasks and backup/restore. Prioritize blocked tasks, misleading
state, lost work, unclear recovery, navigation and difficult small-screen operation
before superficial spacing changes.

For each finding record: actual surface and reproducible trigger, user harm,
severity, confidence, proposed fix, implementation and after-fix verification.
Do not pre-fill 15 findings from assumptions, split one fix into many quota items,
or count unsupported aesthetic preferences as independent usability defects.
Verify 375/768/1440 layouts, long labels/data, Chinese/English, light/dark, keyboard,
reflow, loading/empty/error and applicable offline/locked states. Use synthetic
content in screenshots and tests. Record untested cases separately, not as passes.

## Deliverables

Dated requirement-to-evidence checklist for the settings plan; screenshot-change
acceptance; source commit/CI/deployment evidence and release verification; subsequent
whole-site audit with at least 15 implemented high-value improvements and concrete
before/after evidence. Update current contracts/state/index only after implementation.
