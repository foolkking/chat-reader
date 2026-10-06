# Task And Offline Retention Contract

Last verified: 2026-10-06

## Scope

This document is the current authority for the retention semantics that connect
the global Task Center, server-built Offline Packages, and the downloaded
browser Offline Library, plus temporary download results. Automatic expired-export
reclamation is defined by the Artifact Lifecycle Contract; the manual Offline cleanup
boundary is unchanged. Server backup retention is defined in deployment.md.

## Current matrix

| Object | Current window | What expiry/replacement means |
| --- | --- | --- |
| Terminal Task Center result | `TASK_TERMINAL_RESULT_RETENTION_SECONDS`, default 600 seconds; accepted range 60 seconds to 24 hours | `/api/tasks/active` may return committed, failed, or cancelled jobs/imports completed inside this window so users can reopen a result after navigation or refresh. Falling outside the window removes it from this active-result view; it does not create or promise a permanent task history. |
| Completed account deletion with pending file cleanup | Until cleanup completes | Canonical deletion remains committed. `/api/tasks/active` includes a separate bounded window of up to 20 pending cleanup results beyond terminal retention, without consuming the active-job limit. Tasks groups them under Needs attention and retries only remaining cleanup; file keys stay in the worker payload. This is unfinished work, not a permanent completed-task history. |
| Temporary user-facing Export | Successful publication pins the Root policy: default 180 seconds, allowed 1–60 minutes | Explicit close requests early release when enabled. Active downloads are protected; expired files are reclaimed by the worker, and retained task metadata allows regeneration from current owned data. Legacy deadlines remain unchanged. |
| Current server Offline Package | No time-based expiry | One canonical `OfflinePackageArtifact` is retained per owner/scope. A successfully committed replacement becomes current; the prior row is removed in the same transaction and its file is eligible for best-effort post-commit cleanup. A failed replacement leaves the previous canonical package available. |
| Superseded/orphan/staging Offline files | No automatic retention deadline | `ARTIFACT_CLEANUP_GRACE_HOURS` defaults to 24 hours and is only a technical race-safety minimum. After the grace period, an unreferenced file may appear in a dry-run report. Deletion still requires an explicit category plus exact confirmed tokens and a fresh safety recheck. Automatic cleanup is disabled. |
| Downloaded browser Offline Library | Browser-managed, no server TTL | Imported data lives in the Library Dexie/Cache Storage boundary until the user updates/removes it or the browser evicts storage. Server package replacement or Task Center expiry does not delete an already imported local library. Persistent-storage approval reduces eviction risk but is not an infinite-retention guarantee. |

## Re-entry contract

- Task rows separate the localized operation from optional `source_label` and
  allowlisted `export_format`. Source titles are captured at submission; batch
  exports retain at most the first two titles in selection order, each bounded to
  160 characters. Missing legacy metadata remains absent rather than guessed.
  The compatibility `label` field remains. Reads never expose the whole payload.
- Submitted server time is shown through seconds, with full accessible date/time.
  In progress, Failed, Needs attention, Completed and Cancelled have distinct
  groups. Partial results belong under Needs attention. Only active work displays
  a progress bar; errors retain the full recovery text.
- Retry/cancel preserves keyboard focus when a row moves between groups, without
  stealing focus from another control. Dismissed terminal notifications are not
  reintroduced by the short-lived local completion state.

- Closing Tasks does not cancel work or delete canonical data. Explicitly closing
  a temporary export result releases its usage under the export policy; it does not
  delete the task record, an Offline Package or an already downloaded local file.
- Active work remains discoverable independent of the terminal-result window.
  The window starts only after `completed_at`.
- A recently completed Offline Package can reopen its download action while its
  terminal task result is visible. The canonical package itself remains
  downloadable after that UI window through its normal current-package flow.
- Task result visibility must never be described as permanent history.

## Related 24-hour values

The following values are separate and must not be inferred from the Task Center
or Offline Package contract:

- legacy Export artifacts keep their previously recorded deadline; new user-facing
  exports use the Root-controlled short lifetime above;
- archive restore uploads have their separate 24-hour admission lifetime and remain
  protected while an accepted restore uses them;
- Import drafts default to a 24-hour TTL;
- attachment upload sessions default to a 24-hour TTL;
- artifact cleanup grace defaults to 24 hours but grants no automatic deletion.

Changing any one of these values does not implicitly change the others.

## Operational evidence

Protected diagnostics expose the configured terminal-result window and only
aggregate visible counts/ages. Artifact diagnostics expose aggregate cleanup
categories and completeness, never paths or user filenames. The publication,
manual cleanup, and race-recheck details remain in
[Artifact Lifecycle Contract](ARTIFACT_LIFECYCLE_CONTRACT.md) and
[Cleanup Contract](CLEANUP_CONTRACT.md).
