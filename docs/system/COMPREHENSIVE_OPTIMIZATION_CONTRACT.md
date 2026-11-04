# Consolidated optimization contract

Source candidate: 2026-11-05. This is not a deployment receipt.

## Authentication and local reading

Server session, device permission and connectivity are separate. The shared
session read coalesces concurrent requests; route changes do not restart it.
Visible focus checks reuse a valid result for five minutes; hidden tabs skip
periodic checks. Session queries do not renew the 48-hour inactivity deadline.
Task/status/catalog polling and explicitly marked background GET/HEAD reads do
not renew it either. User reads/writes retain the existing activity throttle.
Successful private responses expose account-bound expiry metadata; this can
extend only the already verified same-account runtime, not authenticate a user.

`/library` HTML is a non-private shell and is allowed without a presence cookie.
An intact cached shell is served before network work; login redirects cannot
replace it. Trusted local content starts before session probing. Missing/expired
cookies, transport errors and 503 retain opened content and pause server access.
A normal resource 403 does not sign the account out. Backend authorization,
ownership, same-origin writes and transaction-sensitive security checks remain.

Long-term local reading requires an explicit private-device confirmation after
successful same-account verification. Permission stores identity and consent time,
not server tokens/passwords. Legacy data is not deleted or silently upgraded.
Explicit revocation, account restriction, credential changes and local locking
revoke permission but preserve unsynced data. A fresh password login is required
to unlock a retained lock; a background valid-cookie check cannot unlock it.
Offline locking is not a successful server logout. Explicit logout still reviews
pending work and performs its confirmed, recoverable cleanup. Account namespaces,
cross-tab fencing and stale-response epochs remain mandatory.

Anyone with access to the browser profile may read its authorized local copies.
An offline device cannot immediately learn remote revocation. Local permission
never grants server permissions.

## Deletion, attachments and sharing

The conversation tombstone and cleanup job commit together. A failed cascade is
recoverable by the existing worker; retry does not restore public availability.
All Share subresources, including frozen content, reject tombstoned sources.
Tags and favorites drop invalid conversation references during cleanup.

Batch attachment admission, each source read, prepublication and retained ZIP
download recheck the same availability/deletion/scanning policy as direct reads.
Detached files remain readable through authorized historical message versions,
but cannot re-enter the current file selection or public-image links.
The existing background ZIP service drives progress and retained delivery;
expired artifacts can be explicitly regenerated from the original selection.

Share creation accepts an optional intent key, serialized per conversation/key
on PostgreSQL and protected by a unique index. The same key/options returns the
same link; different options conflict. Unknown outcomes require a read-only
receipt query before explicit same-key retry. A deliberate fresh creation uses
a new key. Partial-message shares explicitly state that notebook inclusion is
the entire notebook; preview is bounded and labels truncation.

## Recoverable user workflows

`GET /api/adaptive-import/sessions` returns owner-scoped unfinished imports with
bounded offset pagination, source availability and expiry. It is independent of
the short terminal-task display period. Resume reads the original session and
does not re-upload or re-analyze. Browser session pointers are account scoped;
legacy unscoped pointers are not assigned to an unknown user.

Search includes owner notebooks/descriptions, tag filters and paged duplicate
locations. Title dates fall back to import time in index metadata only. Migration
backfills missing title dates without changing source/canonical times, and queues
a bounded private-content index backfill. Ranking/tie-break and duplicate meaning
are preserved while representatives/counts are grouped in SQL; only page bodies
are loaded into Python. This does not replace the search engine.

Personal/system archives have an optional `user_features_version:1` extension:
favorites, tags, saved searches, presets/checklists and reading baselines.
Preflight validates references/ownership; additive restore maps IDs and tag
references, resolves tag-name collisions and retains archive-receipt deduplication.
Old archives remain readable. Preview distinguishes declared collections from
old absent data and explicitly excludes sessions, credentials, device permission,
browser drafts and Share links.

Source-editor drafts persist in the existing account-scoped Dexie settings store,
with original message/version and per-editor revision. Recovery never submits;
stale-base recovery asks for comparison. Confirmed saves and explicit discard
retire queued draft writes. Drafts participate in pending-work review/export and
scoped cleanup. Dexie stays v2; offline packages stay v1/v2/v3 compatible.

Library progress/list reconciliation runs at each committed conversation cursor,
not only the end of a batch. Failed replacement keeps the previous readable copy.
Reader identity no longer changes with download revision; its queries invalidate
in place. Header reconciliation iterates records without retaining all bodies.
Reused verified attachment object URLs avoid another Blob materialization.

## Engineering and measurement boundaries

API runtime, test and build dependencies have separate hash-checked universal
locks. CI and images install them without a second dependency resolution.
`pytest` is not a runtime dependency. API full-suite ownership replaces two
duplicated subset invocations; browser/auth/PWA/migration/image gates remain.
Update locks deliberately with uv from `pyproject.toml`, preserving selected
constraints, and verify the target Python/platform before release.

`test_backup_restore_drill_postgres.py` actually dumps/restores migrated synthetic
data and copies/verifies assets between random loopback-only disposable databases.
It checks current/historical versions and account-scoped favorites. This is not
a production backup restore, nor merely a checksum check. `PG_BIN` can select a
matching client directory; CI uses PostgreSQL 16 clients for its 16 server.

Synthetic search/decompression/Blob characterization is recorded in the dated
execution receipt. No percentage performance claim or real-library capacity
guarantee follows from those measurements. The existing per-conversation archive
capacity limits stay enforced; streaming package redesign is not introduced.
