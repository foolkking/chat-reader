# Task And Offline Retention Contract

Last verified: 2026-08-31

## Scope

This document is the current authority for the retention semantics that connect
the global Task Center, server-built Offline Packages, and the downloaded
browser Offline Library. It does not authorize automatic cleanup or define
backup retention.

## Current matrix

| Object | Current window | What expiry/replacement means |
| --- | --- | --- |
| Terminal Task Center result | `TASK_TERMINAL_RESULT_RETENTION_SECONDS`, default 600 seconds; accepted range 60 seconds to 24 hours | `/api/tasks/active` may return committed, failed, or cancelled jobs/imports completed inside this window so users can reopen a result after navigation or refresh. Falling outside the window removes it from this active-result view; it does not create or promise a permanent task history. |
| Current server Offline Package | No time-based expiry | One canonical `OfflinePackageArtifact` is retained per owner/scope. A successfully committed replacement becomes current; the prior row is removed in the same transaction and its file is eligible for best-effort post-commit cleanup. A failed replacement leaves the previous canonical package available. |
| Superseded/orphan/staging Offline files | No automatic retention deadline | `ARTIFACT_CLEANUP_GRACE_HOURS` defaults to 24 hours and is only a technical race-safety minimum. After the grace period, an unreferenced file may appear in a dry-run report. Deletion still requires an explicit category plus exact confirmed tokens and a fresh safety recheck. Automatic cleanup is disabled. |
| Downloaded browser Offline Library | Browser-managed, no server TTL | Imported data lives in the Library Dexie/Cache Storage boundary until the user updates/removes it or the browser evicts storage. Server package replacement or Task Center expiry does not delete an already imported local library. Persistent-storage approval reduces eviction risk but is not an infinite-retention guarantee. |

## Re-entry contract

- Closing Tasks only dismisses its presentation; it does not cancel work or
  delete server truth.
- Active work remains discoverable independent of the terminal-result window.
  The window starts only after `completed_at`.
- A recently completed Offline Package can reopen its download action while its
  terminal task result is visible. The canonical package itself remains
  downloadable after that UI window through its normal current-package flow.
- Task result visibility must never be described as permanent history.

## Related 24-hour values

The following values are separate and must not be inferred from the Task Center
or Offline Package contract:

- user-facing Export artifacts currently receive a 24-hour `expires_at`;
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
