# Private requests and account limit increases

Implementation contract, 2026-10-05, committed in `ad82cf4`. Not deployed;
exact-source CI passed, with deployment pending capacity. [Execution and remaining work](../execution/SUPPORT_REQUESTS_2026-10-05.md)
separates implemented behavior, evidence and unverified flows.

## Identity and lifecycle

`support_requests.owner_user_id` is server-authenticated identity. Root can inspect
requests through audited `/api/admin/requests`; normal users only use
`/api/me/requests`. Root cannot create a request to itself. Titles/bodies are private
resources and never become conversation canonical data, search data or Share data.

Kinds: LIMIT, QUESTION, ISSUE. Active states: OPEN, WAITING. Terminal states:
APPROVED, REJECTED, RESOLVED, WITHDRAWN, IMPORTED. Replies move active requests to
WAITING when the administrator replies and OPEN when the user supplements them.
Terminal requests cannot be modified. Users may withdraw active requests; approval
and rejection require Root. LIMIT must use approval/rejection rather than RESOLVE.

Creation allows ten active requests and one active LIMIT request per owner, plus
thirty user messages per hour. Request headers require an ASCII Idempotency-Key
(1–100 characters). Mutations require the current integer base_revision; retries
of an already recorded identical operation do not create another message/grant.
Changing payload under the same key is a conflict. Owner advisory locks and a
subject-account fence serialize writes and coexist with account deletion.

## Limits

Effective value is `min(hard bound, max(global default, personal increase))`.
Import file bound is the minimum of `MAX_IMPORT_FILE_SIZE_MB`,
`IMPORT_GATEWAY_FILE_LIMIT_MB` and `MAX_ADAPTIVE_IMPORT_TOTAL_MB`. Aggregate request
size is separately bounded by the latter two. `IMPORT_GATEWAY_FILE_LIMIT_MB`
defaults to 500 MiB, leaving multipart overhead under supplied 520 MiB routes;
operators must align every relevant Nginx route before raising this declaration.
The API does not probe or modify the reverse proxy. The merge hard ceiling is
100,000 messages. None of these overrides enable a globally disabled feature.

Approval may grant no more than requested or supported. Changing the request and
its override is atomic. Root can explicitly reset either override with revision
checks and a private change reason. A larger future global default still wins.
Capabilities and upload/merge admission share this resolver. Merge jobs pin their
accepted ceiling; a subsequent policy change does not reinterpret accepted work.

Import and merge surface the applicable limit before submission. A contextual
request opens above the existing operation, retaining selected File objects,
merge title and order. Only requested numbers are prefilled; a protected existing
draft takes precedence and is identified as restored. No file names, source text
or conversation IDs are added to a request automatically. Root opens system
defaults instead of a self-request. Requests beyond the hard bound route to a
question; aggregate upload overflow asks for smaller batches. Returning refreshes
capabilities and never starts import/merge automatically. Server merge rejection
uses `MERGE_MESSAGE_LIMIT` with the existing human message; the client refreshes
both capabilities and source counts while preserving the user's selection.

## Notification contract

Station persistence precedes email. Email is optional and uses configured SMTP,
the deployment Root's stored email and the request owner's current email. User
reply notifications also require the owner's notify_replies choice. The payload
contains only a neutral update message and authenticated fragment link. No support
body, title, diagnosis, attached conversation or arbitrary client recipient is sent.

Message mail states: NOT_REQUESTED, UNAVAILABLE, QUEUED, SENDING, ACCEPTED, FAILED,
UNKNOWN. ACCEPTED means SMTP acceptance, not inbox arrival. An explicit SMTP
rejection may be retried by its author at most three attempts. UNKNOWN is not
automatically resent. Crash recovery preserves uncertain send status. Email
failure never rolls back a previously saved request or claims the request vanished.
Worker tasks are internal and are excluded from the ordinary task list/retry API;
the request owns their user-facing state.

## Persistence and archives

Migration `20261005_0047` adds requests, messages, and overrides only. User deletion
cascades private rows; message authors/updaters use nullable references. Audits
retain the existing minimal privileged metadata, excluding bodies/reasons.

Optional `.cr` extension `support_requests_version: 1` contains request history.
Personal additive restore remaps request IDs, sets IMPORTED/read-only and disables
notification replay. It never restores overrides. System archives preserve and
remap overrides but cap values at current deployment bounds and clear mail replay
state. Existing archives without the extension remain accepted. Temporary uploads,
mail jobs, sessions and credentials are not archive members.

## Help, replies and local drafts

Help displays numerical limits and genuinely disabled features, without normal
Allowed rows or a separate manual-diagnostics section. Ordinary users can create
requests, browse their inbox, reply and withdraw. Root sees system-limit settings
and an audited user inbox, with decisions and explicit account override reset.
Status/type filters and request/message pagination use server results.

The composer uses Markdown editing, undo/redo and preview. User-provided images
are represented as text; preview does not fetch remote images or attachments.
Redacted diagnostics are an unchecked optional attachment, previewed before
submission and collapsed in message history. Email is independently opt-in and
the interface distinguishes saved requests, queued mail and SMTP acceptance.
One authenticated notification-link owner resolves `#support-request=<uuid>`;
server ownership/root checks still authorize every detail read.

Request/reply drafts use account-protected Dexie settings `support-draft:*` with
compare-and-set versions. Each mounted editor retains its original access epoch;
late work cannot write a previous account's input into a newly active account.
Writes are ordered. Concurrent-tab changes preserve local input for copying and
offer explicit reload. Closing after a successful local save keeps the draft;
unsaved storage failures use the settings dismissal guard.

Before submission the exact payload/idempotency key is persisted. Uncertain
network results freeze that payload for explicit replay. Deterministic rejections
allow correction; a changed request requires reviewing the newer revision before
resubmitting. Reconnect never sends drafts automatically. Account-wide pending
review/export includes support drafts; individual conversation deletion does not.
Expired authorization locks the editor and cache without deleting the drafts.

Administrator direct override fields use the existing unsaved-change guard and
revision checks; they are not offline submissions. Restored IMPORTED requests are
read-only. Input retained after a request closes remains available to copy/delete.
