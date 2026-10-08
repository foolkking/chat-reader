# Chat Reader Interface System

Last synchronized: 2026-10-07.

## Direction

Chat Reader is a quiet personal archive workbench. Its domain is reading,
source documents, cataloging, structure families, mappings, validation ledgers
and recoverable imports. The interface should feel like working at a carefully
organized reading desk: calm enough for long sessions, dense enough to scan,
and explicit when an operation changes canonical data.

The color world is paper, raised paper, graphite, muted ink, sea-green action,
amber review and restrained red danger. All implementation colors must use the
existing application variables (`bg-page`, `bg-surface`, `bg-raised`,
`bg-subtle`, `text-primary`, `text-secondary`, `border-ui`, `--accent`,
`--color-semantic-warning`, `--mark-bg`, `--mark-text`, `--danger`, `--focus`) so light and dark modes remain one system.

The product signature is a source-to-canonical progression: compact source
identity at left, deliberate Mapping in the center and validated canonical
output at right. It appears in Import Overview status rows, conditional Group
Resolver, the three-pane Mapping Workspace, actionable diagnostics and the
Import Format revision ledger.

## Rejected Defaults

- Generic dashboard cards are replaced by divided, scan-friendly ledger rows.
- A mandatory multi-step wizard is replaced by automatic recognition with
  progressive disclosure only for ambiguity, drift or a new format.
- A fully expanded raw JSON inspector is replaced by Analyzer candidates and
  diagnostic-driven source navigation; raw details remain secondary.

## Structure And Depth

- Depth strategy: borders and subtle surface shifts for working content;
  `shadow-2xl` is reserved for the global modal layer.
- Page and sidebar share the same visual world; `border-ui` creates quiet
  separation.
- Dialog radius follows the existing system: mobile top sheet `rounded-t-2xl`,
  desktop workspace `rounded-xl`; controls use `rounded-md` or `rounded-lg`.
- Never nest decorative cards. Repeated data uses `divide-y` and `border-y`.

## Typography And Spacing

- Preserve the application font stack. Use `text-lg` for workspace titles,
  `text-sm` for working content, and `text-xs` for labels and metadata.
- Use semibold weight for hierarchy; monospace only for JSON selectors and
  source role values.
- Base spacing unit is 4px. Working sections use 12/16/20px intervals; modal
  padding is 20px; controls have a stable 36-44px minimum height.
- Letter spacing remains zero except existing brand treatments.

## Reusable Patterns

- Noise rescans: one request owner serves selection, conflict and failed-scan
  views. Keep the primary preview command in its row and show recovery feedback
  below. Explain fresh KEEP only when old choices exist; provide previous/newer
  navigation with fresh reads and heading focus. Missing earlier reviews retain
  the return path. Never guess or copy decisions onto changed source offsets.

- System rule publication: show the public version on the ledger row. Acknowledge
  saved state before refreshing lists; lost responses get a read-only check beside
  the affected row. Compare current and intended name/version in two columns;
  refresh history to show new match text. Retaining a draft changes only its base
  and requires confirmation again. Use readable role/mode/boundary labels and
  disable cached choices after a failed read.

- Global noise scanning: show admission/check/retry beside the start command.
  Preserve one unconfirmed request per account/tab; reopening offers a read,
  never an automatic resubmission. Acknowledged tasks link to the shared task
  center after closing the current overlay. Empty scope and disabled-rule errors
  explain recovery and must agree with the current rule rows.

- Exception scopes: highlight exact matched text with mark tokens, localize
  message roles and keep scope rules in an expandable disclosure. Preserve the
  selection subtree during learning/exception edits. A confirmed write returns
  immediately; slow reads must not delay acknowledgement or later steal focus.
  Unknown saves get a read-only state check; uncertain revocations use an explicit
  idempotent retry. Read errors never leave cached scope confirmation enabled.

- Primary command: existing `btn-primary`; secondary command:
  `btn-secondary`. Disable while requests are pending and preserve the label's
  action meaning in the loading text.
- Status: compact semantic badge with icon/text; never rely on color alone.
- Error/warning: left semantic rule plus concise cause and a real recovery or
  navigation action.
- Copy actions: confirm only an actual completed write; reveal a labelled,
  selectable read-only field on failure. Keep download actions available and
  avoid making fallback instructions a permanent introductory block.
  Focus/select the fallback and keep it inside the visible scroll viewport.
- Loading: inline contextual spinner without replacing the entire workspace.
- Empty state: state what is absent and identify the next useful action.
- Forms: label above input, inset `bg-surface`, `border-ui`, visible `--focus`.
- Data rows: stable alignment, quiet separators, hover state and explicit
  selected/current state.
- Settings: keep the shell entry lightweight; consequential categories use a
  focused state-owning dialog with explicit dirty dismissal and return-to-opener
  focus restoration.
- When one modal opens another, its delayed close must not return focus to the
  page underneath. Restore nested actions within the remaining top modal; normal
  dismissal still returns to the logical opener.
- Background tasks: one global Tasks owner may have sidebar/mobile summaries,
  but those are representations of the same monitor rather than separate task
  products.
- Import completion: a committed batch stays on the Import surface until the
  user chooses Library, the first conversation, or close; do not auto-collapse
  a multi-item result into one Reader.
- Guidance: optional, flat three-step lists beside the real task. Current/Index
  explains its purpose once per account/browser, with close and manual reopen.
  Maintenance advice appears only during Context export and counts uncovered
  Index ranges; it never blocks export or interrupts reading. Respect dismissal
  and per-conversation mute; use existing tokens and 44px action targets.

## Adaptive Import Rules

- Ordinary import shows JSON / Markdown. `.cr` restoration belongs to Settings → Data & backup; `.context.zip` returns belong beside conversation annotations.
- Overview names matched profiles; internal Family A/B labels are not primary
  user-facing identity.
- Group Resolver appears only when pairing cannot be proven.
- Mapping always applies to the whole Family; sample switching must not imply
  per-conversation Mapping.
- Diagnostics must scroll/focus the actual source, locator, role or relation
  control. No inert “locate” buttons.
- Preview shows canonical output, while validation covers every Family member.
- At desktop widths the three panes remain balanced and independently
  scannable; narrower layouts collapse naturally into source, mapping, preview
  document order without horizontal page overflow.

## Source Cleanup Rules

- Content cleanup begins from a real selection in the Markdown Source Editor,
  not from a global Reader drawer. The selection is the visible authority for
  what may change; dirty source must be saved first.
- Source tools use stable 40px icon buttons on narrow screens. Desktop labels
  are reserved for Add attachment, Preview and Clean noise; Choose file and
  Locate remain familiar icon commands with accessible names and tooltips.
- Review opens as one centered, compact document dialog on desktop and a
  bottom sheet on mobile. It shows the selected text, exact candidates and the
  apply command without decorative nested cards or unused vertical space.
- Rules are a secondary view inside the review dialog, not a duplicate Settings
  destination. Repeated candidates and rules use divided ledger rows. Deletion
  of a user rule requires inline confirmation; built-in rules are never
  deletable.
- Personal rule actions show progress and confirmed state beside the row; a slow
  list refresh does not extend the saving state. Uncertain writes offer read-only
  checking before another choice. Confirmed removal announces the result above
  the list and moves focus in visible row order. Version history translates
  configuration labels and keeps long text keyboard-scrollable; failed refreshes
  keep the old text readable but disable version selection.
- Candidates lead with the exact highlighted match and a short context excerpt.
  Multi-conversation rows retain visible source identity. Full context and
  deliberate exception/learning actions expand per row; collapsing never changes
  a choice. Complete changes remain in the required apply preview.
- Confirmed completion is a compact, focused result; source-read failures retry
  only reads. Remove old source selection and scan/rule commands from this state.
  A lost response can be checked, and the result can reopen within the existing
  Task Center terminal window. Normal successful source refresh may close the
  review; explicit ignore removes it. Do not add cleanup-only undo UI; existing
  MessageVersion history remains the recovery authority.
- Multi-conversation review names the current conversation/rule scope above bulk
  actions. Group search finds titles across pages without changing selection scope.
  Preview keeps the hidden selection view mounted, preserving expanded contexts
  and returning to its previous scroll/focus. Import completion links its own
  existing scan with a stable trigger; it never queues a duplicate on a read retry.
- A filtered review discloses selections in other groups beside the preview
  command. Offer a direct all-selected view without changing decisions. Use
  server counts across pages; failed/pending reads show scope meaning rather than
  old exact numbers. Protected/conflict group counts appear only when nonzero.
- Full-message differences mark exact server-selected removals with the shared
  highlight colors and strikethrough. Verify Unicode ranges against the complete
  after text before drawing markers; otherwise show complete plain text. Previous/
  next moves only the two text panes to the corresponding removal. Keep mobile
  panes short enough to compare them, and never add marker text to copied content.
- Rule editing compares localized server/draft values by field, side by side on
  mobile as well as desktop. A failed fresh read removes the prior actionable
  comparison. Selecting a base returns focus to trial; saving or cancelling in
  the library returns to the edited rule or new-rule action. Confirmed saves
  are acknowledged before metadata refresh; unknown results keep a read-only
  check beside the retained draft instead of enabling another blind write.

## Usability recovery surfaces

Background noise scanning distinguishes waiting, scanning, stopping, failed and
cancelled. Keep live work in In progress, never Needs attention. Progress/detail
uses compact paper surfaces, existing text-sm/text-xs, real counts and 44px
controls. Cancellation preserves source and imported content; unknown responses
get a local read-only check. Restore only lost focus when an action disappears or
a row moves between sections; do not pull it back from another chosen control.

Noise scans with no candidates use a compact result with Rules and Done, and
appear under recent Completed tasks without an attention badge. Dismissal errors
belong beside the owning action. Saved choices need a conditional discard
confirmation; closing still preserves them. Capture the visible row before
removal, restoring an adjacent action or result notice only when focus is lost.

Dirty composition uses the shared confirmation; short dialogs keep title/actions fixed and scroll only their fields. Touch project menus remain visible; nested menu keys must not start drag sorting. Search filters disclose on demand without remounting focused inputs. Retry states preserve the query, failed draft or selected items. One bounded task launcher opens the existing Task Center; detailed phases remain bilingual. Keep these changes in the paper/graphite/sea-green token system.

Mobile bottom sheets size their working area to the active visible snap height.
Keep the title available while the tools or fields scroll, including short screens.

Limit requests open a focused Settings dialog above the existing import/merge,
retaining files, title and order. Returning refreshes limits without automatically
submitting work. Bulk-toolbar groups wrap according to available space; scrollable
actions start at the leading edge so narrow project columns cannot hide them under
the selection summary. Merge order offers 44px handles and up/down buttons with
quiet border-ui rows; keyboard users can reorder without a drag gesture.

Format conversion uses one short three-step guide before and after analysis.
Before analysis it stays collapsed by default; opening it compacts the source
drop area. Show the selected Bundle and real retry/manual-copy recovery. A nested
conversion dialog owns keyboard focus and returns to its original action. Do not
recommend format conversion as a fix for permission, quota or connection failures.
