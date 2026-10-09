# UX audit — manual Markdown fidelity

2026-10-09. Pre-implementation source review of the current creation/insertion/editing batch.

## Scope and evidence

Web application, ordinary personal-archive readers editing Markdown on desktop
or mobile. Inspected NewConversationDialog, MessageInsertDialog, EditMessageForm,
SourceEditorWorkspace, the create/insert/edit API contracts, message_edit_service,
the canonical block builder and existing tests. Baseline is the uncommitted working
tree after the [quiet autosave/readiness checkpoint](ux-audit-reader-navigation-readiness-2026-10-09.md),
not published a12ce9e. No production content was read.

No browser was started: the earlier denied local Web start is not retried or
bypassed. Rendering, real CodeMirror scheduling, mobile keyboard and focus remain
unverified. No accessibility conformance or rendered checklist score is claimed.

## Summary

The highest-value small correction is preserving what the user actually wrote.
New-conversation submission strips both message bodies, and the shared API validator
also strips every accepted message. The editor compares trimmed drafts with trimmed
baselines, so a change consisting only of leading indentation can be classified as
unchanged. This can suppress saving and the existing unsaved-change protection.
The fix should separate nonblank validation from exact source preservation, retaining
length, transient-upload and version-conflict checks. It does not require a new editor,
storage format, request receipt system or dependency.

## Observed flow

| Step | Create | Insert | Edit |
| --- | --- | --- | --- |
| Enter | Title/project and two required bodies | Anchor, side, role/mode and body | Existing source in CodeMirror |
| Check | Nonblank bodies, pending reservation | Nonblank bodies, pending reservation | Nonblank, unchanged and upload checks |
| Commit | Create POST with trimmed bodies | Insert POST with raw bodies | PATCH callback with trimmed body |
| API | Shared `_validate_text` strips source | Same validator | Same validator, version guard |
| Outcome | Open confirmed conversation | Apply revision and reload affected window | Install returned canonical source |

## Finding

### FORM-01 — Markdown source whitespace is silently discarded (defect)

- Dimension: forms, content fidelity and error prevention.
- Severity: High; core editing can lose intentional source or suppress a real edit.
- Confidence: Observed (code); rendered Markdown consequences are Inferred.
- Effort: S for source-preservation repair and focused regressions.
- Location at review: `apps/web/features/conversations/new-conversation-dialog.tsx:60`,
  `apps/web/features/editing/edit-message-form.tsx:166` and `:774`,
  `apps/api/app/services/editing/message_edit_service.py:909`.
- Evidence: create sends `content_markdown: userText.trim()`; editor compares
  `trimmedText === baselineText.trim()` and submits `authoritativeSource.trim()`;
  API returns `text.strip()`. Insert already passes the original body but the API
  removes the whitespace. Edit dirty/close/rebase effects depend on the same comparison.
- Consequence: adding four spaces before the first line may neither enable save nor
  warn on close; leading/trailing source, including unfinished fenced code, cannot
  round-trip exactly. The source preview and later exported/reopened source may differ.
- Recommendation: use whitespace checks only to reject blank input. Compare and submit
  the exact source; calculate limits on the exact accepted body and run upload-reference
  validation at original line offsets. Keep title/reason normalization and all ownership,
  version, attachment-removal and pending controls.

## Priority and what stays unchanged

1. Reproduce exact-source, whitespace-only-edit, unchanged, empty and protected-upload
   cases against the actual callbacks and API, then repair FORM-01.
2. Run related manual/edit/version tests and add real browser assertions to the
   authorized CI; discovery alone is not execution.
3. Continue the user-prioritized attachment review before committing this release.

Keep the existing form layout, paper/graphite/sea-green tokens, font stack, 4px spacing,
busy/dirty confirmation and attachment workflow. Intent: a reader editing their own
archive must not have source normalized without consent. No new visual treatment is
needed, so no visual redesign or token change is proposed.

Create/insert unknown-result receipts and changing project context require a separate
state-lifecycle reproduction; they are not implemented by this small fidelity repair.
The canonical block builder separately strips paragraph projections. This batch
preserves canonical source but does not claim to repair all indented-code rendering
or change historical blocks, parser versions, imported originals or migrations.

## Verification

The [pre-repair baseline](ux-audit-manual-markdown-2026-10-09-evidence/baseline.json)
records 26 Node cases (7 pass / 19 fail) and 12 SQLite/API cases (3 pass / 9 fail),
with source/test hashes. The unchanged Node script now passes 26/26. The API
repair plus existing manual-message and message-editing suites pass 22/22.
Only synthetic content was used. The Node harness executes actual AST-extracted
submit/dirty/close logic; hooks, transport, CodeMirror and attachment parsing are
doubles. SQLite TestClient executes the real service/routes and version history.
This is not browser, PostgreSQL-concurrency or complete rendering acceptance.
Final integrated evidence belongs to the
[attachment ledger](ux-audit-attachment-reading-2026-10-09-evidence/local-verification.json):
601 Node and 103 isolated SQLite API cases pass, including this fidelity batch.
Lint, nonincremental types and bounded build pass. Four new browser source-fidelity
cases are discovered within the 125-case selection, but not executed locally.
They check create payload/canonical source, a real CodeMirror whitespace-only edit
and single/pair insertion at 375/1440 in both locales. The unchanged paragraph
projection remains a limitation, not an accepted rendering fix.
