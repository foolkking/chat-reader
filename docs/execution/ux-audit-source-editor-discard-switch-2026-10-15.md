# UX quick review — Source editor discard-and-switch cleanup

2026-10-15 · pre-edit source evidence. Full ordinary-user goal remains active.

## Scope and evidence

Mainstream responsive Web, the Reader Markdown source editor when reading
navigation moves to another message while the current source has unsaved
changes. This review covers only the local discard-and-switch lifecycle and
its already-existing attachment upload cleanup; it does not change message
editing, upload protocol or attachment retention policy.

SEEN: `apps/web/features/conversations/conversation-reader.tsx:1788–1819,
2807–2813`; `apps/web/features/editing/source-editor-workspace.tsx:66,
89–218,289–299,343–348`; `apps/web/features/editing/edit-message-form.tsx:
824–845,1054–1063`. The existing close/discard path already calls the
workspace attachment-cancel handler. NOT SEEN: mounted React, real upload
timing, server attachment state, browser focus, production or CPU/RSS.
Lifecycle facts are Observed (code); orphaning/user-visible consequences are
Inferred. Tests/gates, services, browser operation and release remain off.

## Executive summary

The editor correctly warns before closing a dirty draft and already cleans
staged or finalized attachment work through its discard path. The navigation
banner's “Discard and switch” action bypasses that path: the parent directly
changes the source target and clears the dirty flag. The old workspace has no
unmount cleanup for `uploadJobsRef`, so a queued or in-flight attachment job
can continue after the editor has switched, and a finalized attachment that
belonged only to the discarded draft is not sent through the existing deletion
branch. The visible action therefore means “discard this draft” while its
attachment side effects can survive. Reuse the existing cleanup logic before
switching, retain a finite local error if cleanup cannot complete, and keep
the switch target/state unchanged until cleanup has settled.

## Finding and quick win

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| FORM-SOURCE-ATTACH-01 | Defect / error recovery; trust | Medium | Observed (code); user consequence Inferred | S |

**FORM-SOURCE-ATTACH-01.** Pre-edit locations: the banner button
`source-editor-workspace.tsx:294–296`, parent handler
`conversation-reader.tsx:2807–2813`, and cleanup implementation
`source-editor-workspace.tsx:203–218`. The banner invokes
`onDiscardAndSwitch` directly; unlike the close-dialog discard button, it
does not call `handleAttachmentCancel(false, ...)`. Because the workspace has
no equivalent unmount cleanup for `uploadJobsRef`, switching can leave a
staging upload running or a draft-only finalized attachment retained. The
visitor may later find an unexpected file or consume upload/storage budget
after explicitly discarding the draft. Route this action through the same
best-effort cancellation/deletion and attachment-list invalidation before
calling the parent switch; keep the current editor open with finite feedback
if cleanup cannot be completed.

## Ordered repair and acceptance

1. Extract the existing attachment-job cleanup into a reusable local helper.
   Use it for the current close path and for the banner's discard-and-switch
   path with `preserve=false`; do not alter normal save or “keep files and
   close” semantics.
2. Disable the discard-and-switch control during its cleanup and show a
   localized finite error if cleanup/revalidation cannot finish. Only invoke
   the parent switch after cleanup settles; retain the pending target and
   draft otherwise.
3. Author an extracted-source regression for queued upload, in-flight upload,
   finalized draft attachment, cleanup rejection, retry after rejection and
   ordinary close/save paths. Do not execute it.
4. After authorization, run focused editor/attachment checks with task
   TEMP/TMP, then browser slow-upload, navigation-switch, server-object and
   focus acceptance. Source adapters do not prove server cleanup.

## What stays and open questions

No attachment protocol, upload size, retry, message version, `.cr`, offline
package, Share URL, canonical data or persistence policy changes. “Keep files
and close” remains distinct from discard. Already-started transport is asked
to cancel through the existing upload request handle where available; server
effects are not claimed reversible until the delete/cleanup calls confirm.
Whether the server reclaims every interrupted staging object remains a
runtime/storage question.

## Implemented source checkpoint

The banner now routes through `discardAndSwitch`, which claims a synchronous
busy ref, disables competing banner actions, reuses `cancelAttachmentJobs(false)`
and awaits it before the parent changes target. It reports a finite localized
cleanup failure and leaves the editor open. The existing close/discard path
uses the same helper; a workspace unmount marks old jobs cancelled, invokes
their request cancel handle and best-effort deletes known draft objects.

`scripts/ux/source-editor-discard-switch.test.mjs` is authored but
**unexecuted**. It extracts the actual workspace functions/effect/JSX and parent
switch handler, covering cancellation/deletion/invalidation, duplicate
admission, cleanup-before-switch order, finite feedback and unmount retirement.
This is not mounted React, upload timing, server-object or browser acceptance.
