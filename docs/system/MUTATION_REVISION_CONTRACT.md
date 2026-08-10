# Mutation / Revision Contract

## Canonical handoff

Every successful conversation mutation returns the transaction's post-commit revision. The Web client treats that response as canonical authority, immediately patches the conversation query revision and the affected message projection, then refreshes only derived queries that cannot be represented locally. A subsequent mutation must use the returned revision; it must not use the revision captured before the request.

This applies to conversation creation and insertion, message edit, task toggle, current-version selection, version deletion/restoration, soft delete and short undo restore. A 409 remains a real optimistic-concurrency conflict: the draft stays in the editor, the stale state is not overwritten, and the user is offered a localized reload/retry path.

## Delete and undo

Message delete is a soft lifecycle transition, not Trash. Delete returns `conversation_revision`; the Undo action stores that revision and sends it to restore. Restore returns the next canonical revision and the restored message. Restore is idempotent after success, so duplicate clicks do not create or reorder a second row. Undo is not complete until the restore request succeeds and a refreshed Reader still contains the message. A failed restore keeps a visible retry action and an alert/status live region.

## Attachment lifecycle

An Attachment is a conversation-owned business identity independent of occurrences and AssetObjects. Current occurrence count is a projection, not the Attachment status:

- active + current count > 0 = referenced;
- active + current count = 0 = unreferenced and visible in All/Unreferenced;
- detached = hidden from the active Files Panel by contract;
- missing = visible in the Missing state and never silently treated as detached.

Two active Attachments may share one AssetObject and must remain two business rows. Keeping the last removed reference makes the Attachment unreferenced; explicit detach hides it without deleting historical version relationships or immediately deleting the physical object.

## Dialog focus

All managed dialogs use the shared focus controller: initial focus goes to the first meaningful control (or an explicitly marked control), Tab and Shift+Tab stay inside the dialog, Escape/X/backdrop share close semantics, and close restores the connected trigger or a deterministic Reader fallback. The backdrop is pointer-only and `aria-hidden`; each dialog exposes one visible accessible close control.

## Scanner wording

`scanner_disabled` and `unscanned` render as neutral `未扫描`. They do not imply clean/safe/approved and never change renderer capability. Missing, upload failure and preview failure retain the stronger error treatment.
