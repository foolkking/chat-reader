# Administration contract

## Account directory and access

Root-only APIs hide administration from ordinary authenticated accounts with
404; anonymous/invalid sessions are rejected by authentication first. The new
`GET /api/admin/access/users/page` accepts a literal, case-insensitive email/name
query, `ALL|ACTIVE|DISABLED|PENDING|UNVERIFIED|REJECTED` state, offset and limit
(default 20, maximum 100). ACTIVE means the account can actually log in.
Approval and verification remain independent, so their waiting filters can
overlap. Counts and storage references are aggregated only for the current page.
The legacy `/users` array remains compatible. `/users/{id}` returns the same
account record, including the latest deletion task and data counts.

Settings opens a focused account detail from the directory, retaining the list's
search/filter/page/scroll. Approval, enable/disable, session revocation and password
assistance have explicit results. Password-reset links are temporary UI state,
never stored in the browser or logs. Account deletion has a separate impact
preview. Root cannot be deleted; all account-deletion confirmations are explicit.

## Account deletion

`GET /users/{id}/deletion-impact` counts owned projects, conversations (including
archived/deleted records), attachment references, jobs, Skills, annotations,
notebooks and format/rule grants. `POST /users/{id}/delete` requires a matching
`confirm_user_id`; an optional bounded `Idempotency-Key` identifies retries.

Confirmation locks the account and revokes its sessions, then queues the existing
single-worker `user_account_delete` job. It does not mean deletion has completed.
The directory and Task Center expose queued/processing/failed/completed state;
the UI removes the account only after successful completion. Task Center can
reopen an unfinished account deletion. Refresh reconstructs state from the server.

PostgreSQL serializes the same request key and target account. Different keys
from concurrent windows reattach to the pending job; the same key for another
target is rejected. The original key can retrieve a completed task after the
target account is gone. Failed deletion remains locked and retryable, and retry
resets both the job and deletion request. Access changes cannot re-enable an
account with an unfinished deletion.

Canonical deletion, its result and completion audit commit together. Failure
rolls back canonical data, then saves a failure state and bounded error code.
Attachment references are processed in batches; asset-row locks and reference
checks preserve attachments used by other accounts, leases or derivatives.
Exclusive asset files are removed only after the canonical transaction commits.
Pending keys are persisted in the private worker payload in that transaction;
public results expose only `account_deleted`, `asset_cleanup_status` and the
remaining count. Cleanup checkpoints batches of at most 100 objects. Storage
failure leaves deletion completed and shows a separate retry action in Tasks.
`POST /api/tasks/{id}/retry` requeues this cleanup on the same worker/job without
repeating deletion or its audit. The deletion request remains COMPLETED. A worker
failure after the canonical commit never relabels it as a rolled-back deletion.
Keys now referenced by retained/restored asset objects are preserved.
Tasks retains up to 20 pending cleanup results beyond the normal terminal-result
window, separately from the active-job limit; the Task Center groups them under
Needs attention and keeps their retry entry even if a transient toast was hidden.
Account-local preference/reading/annotation receipts are removed. Format/rule
identities and immutable revisions remain with nullable source ownership; other
accounts' grants and system publications survive source-account deletion.
Audit targets are historical UUID snapshots without a target-user FK.

Authenticated preference, existing Skill, annotation and reading-state writes
recheck account availability under a transaction-held shared user-row lock.
Account disable/deletion waits for already-accepted writes; requests arriving
after it cannot recreate subject-key records, even with a stale ORM identity.
Preferences keep their advisory-lock-before-user-lock order. System restore can
explicitly restore preferences to existing inactive accounts; auth-disabled
development retains its legacy subject namespace. This adds no Skill editing or
version feature (stage five remains paused).

## Invitations and audit inspection

`GET /api/admin/access/invitations/page` accepts state
`ALL|PENDING|USED|EXPIRED|REVOKED`, offset and limit (default 20, maximum 100).
Statuses use server time, with revoked/used taking precedence over expiry.
Creation accepts 1–2160 hours and reveals the URL only in the creation response.
History contains no token/digest/URL. Settings separates creation, current-link
actions and history. Clipboard failure preserves the link for manual copying;
an uncopied link participates in the settings dismissal guard. Hiding it does
not revoke it. Revocation is confirmed, idempotent and serialized with token
consumption. Both invite-only and open registration consume a supplied valid
invitation once; expired/revoked/reused invitations cannot create an account.
The legacy invitation array remains available.

`GET /api/admin/audit/page` accepts action, actor and target literal email/name
queries (or complete historical UUIDs), optional actor_user_id/target_user_id,
result `ALL|SUCCESS|FAILURE|DENIED`, created_after/created_before with explicit
timezones, offset and limit (default 20, maximum 100). Invalid/inverted time
ranges are rejected. Rows include current actor/target display information;
deleted target UUIDs remain searchable without an account join. Stable creation
time/UUID ordering supports pagination. `/api/admin/audit/actions` returns at
most 200 existing codes; manual entry remains available. Legacy `/audit` keeps
its array response. Audit inspection does not itself create audit events.

Settings keeps account/time filters and record identifiers secondary. Content
search is opened explicitly within user management, with its own pagination and
real read-only Reader links; it is no longer mixed into the audit panel.

## Cross-user read-only content

Conversation and attachment lists support literal queries and offset pagination.
Their reads are audited even without a search query. Content search also audits
unfiltered result access, without retaining the query or snippets in audit data.

`/admin/users/{userId}/conversations/{conversationId}` is a separate read-only Web
surface opened from account details. It reuses `MessageItem`, complete-turn
hydration and real `message-*` anchors; it never saves an owner's reading position,
edits messages or writes an offline copy. Cross-user messages are labelled User,
rather than implying they were written by the current administrator.

The matching `/api/admin/content/users/{id}/conversations/{conversationId}`
metadata and `/reader-turn?anchor_message_id=…` APIs authorize the target owner.
`/search?q=…&limit=20&offset=0` returns only current message-index documents,
with a message anchor and bounded snippet. Index rebuild remains on the worker:
manual insertion now enqueues it, and normal-user message deletion passes the
correct ownership scope when enqueueing. Deletion/restore tests run the real
derived-data job before asserting final search results.

Embedded attachments and the shared Viewer use the same explicit administrator
access context. Metadata, content, download and Range requests use Root-only,
owner-checked routes, not private owner URLs. Body reads/downloads are audited
and `private, no-store`. Attachment query caches include the access kind and
target account; owner, Share and Offline branches retain their prior paths.

## Delivery boundary

This account/content slice adds no migration; the current head remains
`20261002_0042`. No production deployment is included. Help diagnostics and
operational status remain subsequent stage-seven work. Stage five remains paused.
Dated test results and remaining
acceptance belong to the settings execution record, not this contract.
