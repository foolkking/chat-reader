# Chat Reader Interface System

Last synchronized: 2026-08-22.

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
`--warning`, `--danger`, `--focus`) so light and dark modes remain one system.

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

- Primary command: existing `btn-primary`; secondary command:
  `btn-secondary`. Disable while requests are pending and preserve the label's
  action meaning in the loading text.
- Status: compact semantic badge with icon/text; never rely on color alone.
- Error/warning: left semantic rule plus concise cause and a real recovery or
  navigation action.
- Loading: inline contextual spinner without replacing the entire workspace.
- Empty state: state what is absent and identify the next useful action.
- Forms: label above input, inset `bg-surface`, `border-ui`, visible `--focus`.
- Data rows: stable alignment, quiet separators, hover state and explicit
  selected/current state.

## Adaptive Import Rules

- Keep the first screen light: only `JSON / Markdown` and `.cr`.
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
