# Administration contract

## System noise publication recovery (local, 2026-10-07)

The Root rule ledger uses an explicit publication base for publishing and
withdrawal. It acknowledges committed state before background refresh, preserves
drafts on conflict/response loss, and reads current state before allowing another
submission. Public name/version comparisons and refreshed matcher history support
an explicit choice. Read failures never enable cached publication actions.
Personal grants and already admitted scans remain independent. API compatibility,
locking, audit atomicity and the 20-second request bound are defined in the
[cleanup contract](CONTENT_CLEANUP_CONTRACT.md#administrator-publication-recovery).

## Feature policy recovery (local, 2026-10-07)

Root `GET/PUT /api/admin/features` adds an opaque `revision`, derived from the
canonical policy field values, independently of timestamps. PUT optionally accepts
`base_revision`. PostgreSQL serializes writers and initial singleton creation;
writers refresh ORM state under a row lock before comparing. A stale base returns
409 `FEATURE_POLICY_CHANGED` without updating fields or recording a success audit.
The committed response is captured inside the transaction. No migration is needed.

Legacy requests that omit the revision keep partial-field behavior; they do not
gain optimistic conflict protection. New UI writes send only edited fields and
the displayed base revision. No-op or rolled-back default reads preserve the
content revision. Success audits include changed field names only.

The feature panel preserves its draft after conflict or an unconfirmed response.
**Read latest policy** merges only locally edited fields into current server values,
shows a comparison, and requires another explicit Save. A second remote change
conflicts again. **Use server policy** explicitly discards the draft. When the
submitted values already match the current policy, the UI reports that fact and
does not write again; it does not infer which request produced those values.
**Check save result** also only reads. Failed checks retain the input and retry.

Reads and writes have a 20-second bound, unmount cancellation and authentication
generation guards. Fields pause during recovery; read failure never enables a
blind repeat write. Known denied/unavailable access removes the form. Comparison
and result feedback receive keyboard focus, and Save follows the comparison.
Locale changes do not reload/reset the draft. Existing capabilities refresh after
acknowledgement; this does not change their scope or deployment safety ceilings.

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

### Account action recovery (local, 2026-10-07)

Status PATCH and approval/rejection POST retain their original `id`/`status`
response and add `user`, the complete directory/detail representation captured
within the write transaction before commit. It is returned only after commit
succeeds. This preserves old callers and lets new clients acknowledge server
state without reproducing approval/verification rules or waiting for another GET.
No extra credential fields, permission changes or migration are introduced.

The account panel cancels older detail/task reads before an action, accepts its
response into the corresponding cache, and refreshes metadata independently of
the action's busy state. Account metadata/actions and deletion task reads have a
20-second request bound. Failed writes are not automatically resubmitted. Temporary
read errors retain identifiable details but pause new account mutations until a
successful read; 401/403/404 remove old detail, reset links and content panels.
Authentication-generation and mounted guards fence action responses.

A deletion confirmed by the administrator can be reattached with its original
idempotency key after an unknown response, even when the account is already gone.
The UI exposes **Check deletion result**, without showing the stale account or
creating a new key. A failed check keeps the same recovery action and explicit
error. Canonical completion still comes from the durable task result, never from
the account's disappearance alone.

Directory refresh keeps the selected query/filter. When the server total shrinks
below the current offset, it loads the last valid page before restoring focus.
Returning to a still-present account restores its row/scroll; a removed or newly
filtered-out account falls back to an actual visible row. Directory and detail
have explicit refresh actions. This is in-memory navigation, not a new persistent
account cache. Dated evidence: [account recovery audit](../execution/ux-audit-admin-account-recovery-2026-10-07.md).

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

Registration policy above the invitation list uses changed-field writes, optional
base revisions and local read/compare/check-result recovery. It does not reset the
invitation form while reading policy. The
[authentication contract](AUTHENTICATION_CONTRACT.md#registration-policy-recovery-local-2026-10-07)
defines the compatibility, SMTP, transaction and account-admission boundaries.

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

The current migration and deployed baseline are recorded in `PROJECT_STATE.md`;
the account recovery extension above is local and introduces no migration or
deployment. Help/operational status and replacement-only Skill Bundles are covered
by their current contracts; earlier stage scheduling is historical. Dated tests
and remaining acceptance belong to execution records, not this contract.
