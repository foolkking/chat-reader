# PWA and Offline Resilience Contract

## Task Center recovery — 2026-10-08 worktree, not deployed

Offline Task Center rows open the existing Offline & sync panel. Opening it does
not admit or retry a download. Server task status describes packaging, not whether
this browser has imported the package. The generic server-only Retry/result ZIP
actions are replaced by this entry; the legacy APIs and download URLs remain.
Cancellation there is explicitly labelled Cancel server generation. Local download
cancellation and retry remain in the sync panel with their existing semantics.

Task responses add nullable `offline_target`: scope, corresponding conversation
or project ID, and `include_assets`. Only allowed values are projected from owned
offline-package jobs; malformed/legacy payloads return null. It is navigation
metadata, not authorization. Admission rechecks source ownership and computes
known revisions from this device, never from another device's historical job.

The panel first finds the exact job, then a local retry with the same scope and
attachment mode. It opens the matching state and 20-row failure page, focusing
the actual row without overriding intervening keyboard/pointer navigation. A
completed local record offers the Library route. Without a local record, valid
target metadata offers an explicit Download to this device action through the
existing enqueue pipeline. Missing metadata keeps a manual Library route. Catalog
failure, offline state and empty/deleted/unavailable sources cannot silently start
that targeted download. Users can choose the attachment mode before admission.

Successful recovery does not rewrite the historical failed server job. Task
visibility still follows existing retention; local-copy availability is separate.
No Dexie/package version, persisted task model, canonical content or Share change.
The [execution record](../execution/offline-task-recovery-2026-10-08.md) separates
33 passing API checks from the unexecuted browser persistence/focus cases.

## Attachment copying — 2026-10-08 worktree, not deployed

Recognized server attachment failures use `OFFLINE_ASSET_INTEGRITY` and
`OFFLINE_ASSET_IO`. The download record stores only admitted categories, with
legacy exact-message support and GENERATION fallback. Both Offline Center and
Task Center render localized recovery guidance; Task Center does not assert local
copy retention. Manual retry obtains a new generation job for either category.

Retention wording requires an explicit local-copy boolean. The sync center checks
the displayed failure page against account-local conversation/project indexes;
an unrelated copy does not establish retention for this download. The library
uses the same scope distinction. Cancellation without a matching copy and generic
operation failures do not claim that a readable copy exists. No new stored fields,
Dexie version, message writes or attachment changes are involved. Browser acceptance
of this follow-up remains pending; see the dated offline-error-guidance record.

Offline package asset copying uses bounded 1 MiB reads and verifies the actual
written byte count and SHA-256 against canonical asset metadata before publication.
Missing/unreadable or mismatched files fail the task and discard staging without
replacing the previous successful artifact. Large files offer throttled progress
and cancellation checkpoints between chunks. Repairing the source allows a new
download attempt. This is independent of browser cache validation and DB snapshots.

## Package source snapshot — 2026-10-08 worktree, not deployed

PostgreSQL offline packaging reads canonical metadata, messages, search, notes,
anchors, Continuation and asset metadata in one read-only REPEATABLE READ snapshot,
reusing `archive_read_snapshot`. Worker progress and artifact records use the
original publication session. Progress commits cannot reset the read snapshot.
Concurrent edits remain available for the next update rather than mixing into
this package under an older revision. SQLite keeps its existing session behavior.
Snapshot exit closes the extra read connection on success/error. Filesystem asset
bytes remain governed by the existing asset storage lifecycle.

## Source revision concurrency — 2026-10-08 worktree, not deployed

All current offline revision increments use `bump_offline_revision`, a deferred
database expression evaluated at the existing transaction flush boundary. Stale
ORM instances cannot overwrite another transaction's increment. Multiple queued
increments accumulate; after flush, reads return the persisted integer. Rollback
reverts the source and its revision together. No package or Dexie version changes.

Message source and cleanup locking uses PostgreSQL NO KEY UPDATE, serializing
source mutations while permitting search-document FK KEY SHARE checks. Full FOR
UPDATE locks here can deadlock independent edits rebuilding the same conversation's
search index. Revision and existing source-version conflict checks remain separate.

## Download recovery — 2026-10-07 worktree, not deployed

Local download cancellation can run without a network connection. It settles under
the existing account download lock only after the importer has stopped; an already
committed package wins a late cancellation. Network loss without cancellation keeps
the existing resumable state. Status text reports the offline pause.

Server cancellation intents live in the existing account-scoped settings store
(`offline-cancellation:`), independently of later retries of the same local row.
Unknown admission receipts replay the original idempotency key. A separate browser
lock coordinates acknowledgements without holding up local cancellation/cleanup.
An HTTP 409 clears an intent only after a fresh owned task query proves a terminal
state (the server may have completed generation before cancellation arrived).
Requests have a 15-second bound; automatic attempts stop after five with backoff,
retaining a manual retry in the sync center. Authentication generations and existing
database fences still apply. No background retry is treated as a confirmed response.
If a newer download has already completed while an earlier cancellation failed,
its recovery row offers server-cancellation retry only, not an ineffective
download retry. Clearing the acknowledged intent does not replace the saved copy.

Malformed packages rebuild with a new admission key; network and local write/quota
failures reuse their existing job/package. A transaction and per-attempt revision
prevent concurrent retry clicks from replacing another active attempt. Existing
records without the additive revision field read as attempt zero.

Library reads persistent failures as well as active/completed states. The first-copy
screen exposes the same specific error/retry without requiring a user to open its
sidebar. Sync-center pagination clamps to a valid page after live counts decrease;
outdated resource-check promises cannot overwrite a newer list.
Desktop Open library expands the sidebar and focuses its search; it is hidden when
that sidebar is already open. A failure displayed for the selected first-copy
screen is suppressed only when the desktop sidebar would repeat the same message.
Other sidebar errors and mobile drawer feedback remain visible.

These changes do not alter Dexie version 2, offline package v1/v2/v3, canonical
content, personal preferences or Share. All six real-browser recovery cases passed
after fixing the terminal-cancellation boundary and restoring test disk capacity.
They verify actual IndexedDB rows, original admission keys/server jobs, retained
intent after a failed status query, and deleting a cancelled browser copy without
deleting the server conversation, and bounded/manual retry after a later successful
download. Related authentication and sync tests passed. Default PWA reported
135 passed / 329 conditional skips, and the instrumented negative matrix 17 passed
with no skips. The dated audit retains initial
failures and identifies test-fixture corrections separately from application fixes.
No deployment/CI has run for this worktree.

## Cleanup after completed downloads (2026-10-04)

Copy/attachment cleanup checks durable active downloads before acquiring the
account's download lock. With no active job it waits up to 2.5 seconds for the
coordinator's short idle scan or terminal-state handoff, instead of reporting a
false active download. After acquiring the lock it rechecks the account and active
jobs under the existing sync lock; pending-change fingerprints still protect
deletion. Active downloads remain blocked and a busy lock times out without
clearing data. No Dexie version or package format changes.

## Context export after actual ingestion (2026-10-03)

Offline v3 optionally stores per-message `annotation_versions`, conversation
`project_context` and attachment source metadata in existing Dexie v2 records.
Only the requesting subject's live annotation anchors are packaged; current
Reader data is unchanged. Project-description changes increment offline revisions.
Offline Context/CanJSON export includes anchor versions only when their annotations
are exported and filters notebook references accordingly. Legacy missing history
preserves quotes and original unavailable locators without linking to a newer body,
with an actionable post-export notice. The Raw manifest extension
`chat_reader_offline_snapshot` reports missing anchors and project-context availability.
Project context follows the description option and is supplementary to message hashes.

Metadata-only export preserves attachment digests and locators, independently of
binary inclusion. Actual-ingestion browser tests start with a Normalizer transcript,
then use online Context export, real worker packaging/download and app ingestion,
disconnect and reload before exporting again. Body/locator fingerprints, complete
canonical references, old anchor text, attachments, source metadata, descriptions,
notebook and saved Current/Index bytes pass. A separately identified legacy test
removes optional members from the downloaded package; it proves absence handling,
not an actual old deployment or the entire v1/v2 compatibility matrix.

## Continuation reading and local drafts (2026-10-03)

Cached Index references navigate through the offline complete-turn Reader; an
explicit destination cancels any startup reading-position restore. Disconnected
browser coverage now includes an unloaded 220-block message, followed by reopening
Index with its selected tab retained and exporting actual cached Context bytes.

Online Current/Index editors persist working drafts in the existing account-scoped
settings store. They do not add a Dexie version/store or enter a downloaded
conversation package. Drafts count as pending local work for signout and cleanup;
scoped deletion includes only the selected conversation's drafts. The sync center
lists them separately and opens the corresponding online member. The recovery ZIP
includes `continuation_drafts` metadata and actual `continuation-drafts/N/current.md`
or `index.json` files. No outbox operation is created and drafts are never silently
published. Storage guards/identity epochs protect queued writes. Authenticated
browser tests cover real worker copies, expiry/reload retaining locked bytes,
different-account isolation and explicit same-owner draft recovery. At 375px,
injected IndexedDB write/delete failures preserve durable or in-memory text;
server-save success followed by failed local cleanup exposes the retained draft.
Scoped removal exports only that conversation's draft. Signout rejects an outdated
export after another tab changes a draft; failed logout retains local data, and a
successful retry clears the account's database. These are fault-injection tests,
not a claim that physical disk exhaustion was reproduced in the browser. Counts
and full release limits are in the dated execution record.

## Source display metadata (2026-10-03)

New v3 offline messages optionally include `source_refs`: source identity plus
allowlisted model/timestamp and conversation header display fields. The existing
Dexie v2 message records retain them; legacy v1/v2/v3 records without this field
remain valid. Offline CanJSON/Context export emits these as canonical `source_ref`
records and declares their presence in the outer manifest. No raw provider payload,
new database store, or personal Skill is added. API tests verify Normalizer import
through real offline package creation; disconnected browser tests verify cached
metadata in downloaded Context bytes. Actual-ingestion parity now also covers
Normalizer metadata as described above.

## Context files (local migration, 2026-10-02)

Offline export defaults to `context`; CanJSON and Markdown remain selectable.
The Context ZIP is independent of the attachment checkbox. Cached Current/Index
can be included or omitted; digests/limits are checked before inclusion. Unreadable
derived files fall back to Raw-only. The manifest uses
`extensions.chat_reader_continuation_export` with explicit unverified inclusion
or omission status; protocol claims, when supplied in cached metadata, remain
source claims. Content is not semantically assessed. Metadata-only attachment
policy is explicit. Canonical rows are read in one Dexie transaction; available
attachment bytes must match their declared digest. The aggregate bundle size
limit includes Raw and derived members.

Disconnected browser evidence verifies actual ZIP member bytes/checksums and
Raw-only choice; actual-ingestion parity evidence is described above.

Offline package v3 conversation metadata optionally contains `continuation`:
version 1, generation, revision ID, timestamp and current/index member text,
SHA-256 and byte sizes. Only selected saved files are included, never personal
Skills, returned ZIPs or candidate history. Direct file updates increment the
conversation offline revision; catalog estimates include selected member bytes.
Missing or corrupt server files fail package construction rather than silently
publish an incomplete update.

The importer checks optional member shape, limits and digests before its existing
transaction, then stores the result on the conversation record. No new Dexie
version or store is introduced; absent fields in legacy v1/v2/v3 remain valid.
Existing account-scoped storage and protected transactions cover these bytes.
The Reader entry beside annotations opens a read-only cached view. Local queries
run without network availability; upload/edit remain online operations.

Current evidence covers backend packaging/revision changes, disconnected desktop
view, parser contracts and actual-ingestion Context parity with cold reload.
The complete import negative matrix, mobile and authenticated lease acceptance
remain part of the full release gates.

## Settings completion: lock and sync (working tree, 2026-10-01)

Reading positions use server revisions and account/operation-scoped receipts
(`20261001_0040`). The existing readingPositions store holds the local working
anchor; settings stores the server comparison and conflict marker. Only an
unsubmitted position may coalesce. Submitted outbox IDs and payloads remain
immutable through timeout/reload; at most five positions are sent per batch,
with ten-second request deadlines and at most five automatic attempts. A
response acknowledges only its own operation and preserves/rebases a newer
unsent position. Old unversioned local positions are queued for comparison;
client timestamps do not choose a winner.

Reader restoration freezes the initial saved anchor for that mounted source.
Remote progress refreshes do not scroll or replace the active window. Only
real user scroll or explicit destination intent creates progress; layout and
saved-position restoration do not. Restoration shares the real-DOM locator but
does not increment the persistence intent or cancel its own restore token.
Wheel/touch/key input still cancels restoration and records the new intent.
Explicit use-server choice goes through the existing real-DOM locator
and clears older captured idle/pagehide intent. Conflict choices recheck both
the displayed local anchor and server revision, including a strict online
refresh; unavailable or changed comparisons remain unresolved. Local storage
failures preserve the last durable position and expose retry. Online reading
can still restore freshly fetched server progress if local storage is unavailable.

Offline package replacement preserves pending/conflicted reading positions.
Their actual working anchors are included in scoped recovery ZIPs, fingerprints,
copy-removal review and the shared Offline & sync center. No Dexie/package
version change accompanies the server migration.

Account preferences use the existing Dexie settings store, with durable local
changes, per-field server base revisions, conflicts and the exact in-flight
operation identity. Migration `20261001_0039` adds server field revisions,
default Reader focus, default annotation position and account-scoped receipts.
Independent fields merge; a stale changed field requires keep-local or use-server.
Client timestamps never choose a winner. New edits during a response remain local
and rebase only after their predecessor is acknowledged. Responses older than
the cached field revision cannot roll that field back.

Preference requests have a ten-second deadline and exponential backoff capped at
five automatic attempts, persisted across reload. Window focus and reconnect do
not reset the limit; explicit Retry does. A lost response replays the same request
and operation ID. Authentication stops sync; invalid requests require intervention.
Layout changes from either local controls or incoming preferences use the Reader's
existing anchor capture/restore events. Default focus and annotation docking are
account values; floating window geometry remains device-local.

Legacy preferences migrate once only when the old authenticated account binding
matches the current UUID. Unowned values and another account's values are never
uploaded. Public authentication/Share pages do not initialize private preference
sync. Storage failures keep the current selection in memory, expose retry and
guard browser exit; deliberate logout/password change first persists that draft.
Pending preference fields and their values participate in signout review,
fingerprints and the explicit recovery ZIP. Removing a conversation copy excludes
account-wide preferences. No Dexie or offline package version changes are needed.

Expired authorization and an explicit server authentication rejection lock the
private Reader without deleting its account database, attachment cache or
outbox. The runtime closes the database, aborts pending IndexedDB transactions,
revokes attachment Object URLs, terminates the search worker and clears private
query results. Reads, exports, package writes and sync responses carry an access
generation: work begun for A cannot finish in B's namespace or after locking.
Only a server-verified session for the same account UUID removes that account's
persisted lock. Another account gets its own namespace. Explicit logout still
clears its protected local data after pending-edit review. The current account
panel offers sync, readable recovery export and explicit discard before logout
or password change. A SHA-256 snapshot fingerprint is checked again under the
sync Web Lock; changed drafts/operations abort the action. A short account-scoped
write freeze fences local writes and makes all tabs inert during the final
request. Request failure releases it and retains both stored and mounted edits.
The initiating UI navigates after cleanup, avoiding a competing expiry-event
redirect and a stale password-form beforeunload prompt.

Explicit logout no longer treats best-effort deletion as confirmed cleanup.
The exact account database/cache context is captured before locking. Failed or
blocked deletion retains a cleanup request in localStorage, with sessionStorage
and memory fallbacks. The private boundary is replaced by a cleanup recovery
screen; login can also resume persisted cleanup. A pending account cannot reopen
protected storage while its old deletion may still complete. A per-account
completion token makes other tabs' stale requests inert after a later login.
Cleanup removes only that account's database, assets, shell and stale identity
pointer, and preserves the legacy-owner binding. It waits up to three seconds
before offering retry; timeout does not mean success or cancel the IDB request.

When pending work cannot be inspected, ordinary logout retains the session.
The account panel offers an explicit destructive confirmation explaining that
local changes/preferences/drafts cannot be checked or exported. Only that
choice permits logout with unreadable storage. It still locks data immediately
and retains cleanup recovery; server request failure retains the session/data.
The temporary write freeze uses memory and BroadcastChannel when localStorage
is unavailable. If no browser persistence works, keep the recovery page open
until retry or clear this site's data in browser settings; no persistence across
closing that page is promised in that state.

Dexie stays at version 2, package writes at version 3, and package readers keep
versions 1/2/3. These changes introduce no migration. Local annotation/note
edits commit their row, search data and outbox operation in one transaction.
Queue timestamps are monotonic within the account transaction, including
multiple edits made in the same millisecond. Removal checks pending work inside
the removal transaction and refuses to delete without an explicit reviewed
snapshot. The center offers sync/export/discard for just the selected copy.
Deletion verifies that snapshot inside the write transaction, then atomically
removes its records, outbox, notebook drafts, conflict markers and merge drafts.
Download and sync locks coordinate removal with package/snapshot writers.
Other conversations and server data remain. Attachment-only cleanup requires
sync or export first and retains pending text edits and drafts.
Package replacement preserves pending notes and regenerates pending annotation
search entries rather than restoring the stale server search text.

Sync sends at most 50 operations per request and only the earliest operation
for each entity. Web Locks serialize tabs where supported; account-local
in-flight deduplication and server receipts also prevent duplicate application.
Receipts must correspond to the submitted operations. Snapshot reads happen
before local acknowledgment; a failed read retains the operation ID for an
idempotent retry. One local transaction acknowledges confirmed operations,
updates snapshots and preserves rows with newly queued edits. Failure counters
and bounded error categories persist; retry backs off with at most five
automatic attempts. Authentication failures suspend access, invalid operations
stop, and conflicts pause descendant edits. Conflict markers remain in the
existing settings store with the acknowledged local payload and action, so even
a deletion or an empty descendant queue retains the local intent for comparison.

PostgreSQL serializes online annotation/notebook writes, lazy notebook creation
and offline sync by subject, and locks receipt identities before first insert.
Concurrent retries apply once; competing base revisions preserve conflict
copies. A zero notebook base revision only bootstraps an untouched empty note,
never overwrites an already edited note.

The settings menu and Library menu open the same Offline & sync center. It has
offline copies, pending edits, and failures/conflicts views, with paged rows,
asset completeness, manual sync retry, source links, download cancellation and
retry, explicit attachment-cache cleanup and copy removal. The center compares
current canonical and local content and offers keep-local, keep-server and manual
merge. Merge drafts persist in account-local settings; edits to Markdown blocks,
titles and comments preserve reference blocks. Resolution checks both canonical
and conflict-copy revisions under the same PostgreSQL subject lock. Changed
versions require a fresh comparison; confirmed resolution removes the temporary
copy and updates annotation search and notebook references.

A resolution request and the specific descendant operation IDs included in its
comparison are persisted before sending. Retry reuses that operation ID through
the existing server receipt table, including after the copy was already removed.
Only an acknowledged resolution removes its marker and superseded outbox items.
New edits queued during its snapshot fetch remain; only fields changed by those
edits are rebased onto the selected resolution. Failed snapshot/storage work
retains the request for retry. A conflict marker counts as pending work even
without descendant outbox records and prevents copy removal/cache cleanup. Package
replacement also preserves its canonical working row and conflict copy while a
resolution is awaiting acknowledgment, even if the new server package already
contains the resolved version.

Notebook inputs wait for the initial record and account-local draft. Drafts
persist on input in the existing settings table with a tab identity and a
compare-and-set version. Their original notebook base revision is retained on
reload. Failed saves preserve the draft and offer current-version comparison,
keep-current or explicit application against that compared version. Draft links
in the center can reopen another tab's draft; no second notebook is created.
The former append-copy conflict action is replaced by the center's resolver.
Expanded/mobile/desktop notebook views use the same editor. Input not yet safely
stored guards closing and browser navigation.

`chat-reader-unsynced-changes.zip` contains `changes.json` and readable `notes.md`.
It includes scoped pending operations/deletions, annotations, notebooks, notebook
drafts and conflict merge drafts. Export never acknowledges work or clears data.
This is an explicit recovery export, not a `.cr` archive or an automatic restore
format; the UI explains copying text back and the exclusion of attachment bytes.
No authentication credentials or session values are included. Export is limited
to 256 MiB of encoded source data. Changes made after export invalidate the
reviewed fingerprint before destructive cleanup.

Download requests persist in the account's existing Dexie settings store before
HTTP admission. Their stable idempotency keys, scope, asset tier, base revisions,
server job/package IDs, cancellation and current phase survive refresh. The
global download manager resumes one writer per account using Web Locks where
available, while the existing API worker remains single-concurrency. Closing a
settings panel does not cancel the underlying work. Network interruption keeps
a resumable record; failures expose explicit retry. A lost admission response
replays the same key and request; PostgreSQL serializes admission and rejects a
changed request with 409. Terminal server jobs also retain their identity on
replay. Rebuilding a cancelled/failed generation uses a new key deliberately.

Usable base revisions now require known attachment metadata and complete cached
bytes for the requested asset tier. Same-version packages therefore still fetch
missing files or a higher tier. Each imported conversation records its last
asset tier; package v3 carries an additive `downloadable` flag derived from
server asset/scan policy. Older packages without it remain readable. Cache
presence alone cannot override an explicit non-downloadable flag. Switching to
a lower tier retains existing files; only explicit cleanup releases them.
Cancellation aborts the package transaction and rolls back staged cache writes;
a package already committed remains committed. Removal/attachment cleanup reject
unreviewed pending edits and active downloads, and share browser writer/sync locks.

Evidence: `settings-offline-conflicts.spec.ts`, `test_annotation_conflict_resolution.py`,
`settings-offline-center.spec.ts`, `test_offline_download_postgres.py`,
`settings-offline-lock.spec.ts`, `settings-offline-sync.spec.ts`,
`auth-recovery.spec.ts`, `test_annotation_sync_postgres.py` and existing
annotation API tests. Subsequent draft/cleanup/signout integration passes nineteen
real browser cases plus three real authentication/Share cases, thirteen
authentication-recovery contracts and fifteen annotation API tests. All use
synthetic data. Preferences have dedicated two-device, reload/retry and Reader
anchor tests in `settings-preferences.spec.ts`. Nine real reading sync cases
cover both conflict choices, incoming remote progress without scrolling,
lost receipts, newer edits, quota failure/retry, stale/unavailable comparisons,
package replacement, unavailable initial IndexedDB/reopen and scoped export/removal.
The latest integrated gate passes 42 real settings browser cases and 13 auth
fault contracts, with four cleanup failure cases and three additional real
authentication/Share cases. Subsequent complete PWA, negative and long-Reader
runs and the compiled-worker cold-start correction are tracked in the dated
settings execution record; counts from overlapping runs must not be added.
Older sections describe the existing baseline.

Last verified: 2026-08-15

## Scope and Existing Versions

Release E closes browser-side negative paths without replacing the PWA,
changing server artifact publication, or changing user data formats.

| Boundary | Current code contract |
| --- | --- |
| Service Worker scope | `/library` only |
| Shell storage | Cache Storage revision caches plus one active metadata record |
| Offline records | Dexie schema version 2; version 1 stores remain readable |
| Offline package | Writes version 3; reads versions 1, 2, and 3 |
| Attachment bytes | `chat-reader-offline-assets-v1` Cache Storage |
| Release E migrations | No Dexie or Alembic migration |

The package and Dexie versions above predate Release E. Release E does not
downgrade them to the older planning assumptions.

## Storage Ownership

```text
Cache Storage
  chat-reader-library-meta-v1
    /__chat_reader_library_active__ -> active shell record
  chat-reader-library-shell-<revision>
    shell HTML, critical runtime resources, optional resources
  chat-reader-offline-assets-v1
    versioned attachment originals

IndexedDB / Dexie
  chat-reader-offline-library
    conversations, messages, blocks, search, annotations, positions,
    package metadata, attachment metadata, and outbox
```

The active Service Worker and its active-record cache entry are the shell
source of truth. Dexie package metadata is the conversation-package source of
truth. A cache hit alone never promotes incomplete or corrupt data to READY.

## Shell State Machine

Before Release E, a cached `/library` navigation could be returned even when a
critical JavaScript or stylesheet entry was missing. With the HTTP cache also
empty, Next.js could show a generic client exception.

After Release E:

```text
no active record
  -> CHECKING -> first preparation -> READY or UNAVAILABLE

active A complete
  -> READY immediately
  -> background prepare B
       success -> activate B -> cleanup A
       failure -> A remains active -> READY + non-blocking update failure

active record with critical resource missing + offline navigation
  -> standalone OFFLINE_INCOMPLETE response
  -> explicit reconnect/retry action

optional resource missing
  -> shell remains READY
  -> only that feature/update reports unavailable
  -> online reconciliation repairs the missing resource even at the same revision
```

The standalone incomplete response has no external script, style, font, API,
or image dependency. It cannot enter a reload loop.

## Critical and Optional Resources

Library searches rerun after the local search index finishes loading or
refreshing. A query entered during cold start cannot remain an empty result
from an uninitialized index; superseded queries cannot replace current results.
The search worker reports its compiled entry and imported resources after it
starts. These actual JavaScript assets are critical shell resources; a separate
URL expression for the TypeScript source is not a usable worker manifest.
Webpack worker entries use `/library/_next/static/`, rewritten by Next to the
same `/_next/static/` build assets. A dedicated worker is its own client, so its
entry must stay inside the existing `/library` service-worker scope for offline
startup. Imported static chunks remain on the same origin and in the shell
allowlist. No wider service-worker scope or blob/eval CSP exception is added.

Worker errors, message errors and ten-second request deadlines reject pending
search work and expose a retry action instead of an empty-results success.
Retry rebuilds from the retained local documents; search failure does not block
conversation selection or remove offline copies. Expiry still terminates the
worker and invalidates outstanding access generations. The cold-start browser
gate clears the ordinary HTTP cache while preserving Cache Storage, disconnects
the network, and verifies actual search results in a new page.

Cached `/library` HTML hydrates with a stable initial shell snapshot, selection
and connectivity state; the requested conversation and live network status are
applied after hydration. This avoids replacing the cached tree during a cold
offline navigation with query parameters.

Critical resources are current document scripts/styles, Library navigation,
the offline search worker, icons, bundled KaTeX assets, and warmed Viewer
runtime chunks required by the active shell. The cached built-in Acquisition
Skill ZIP is optional. A missing optional Skill does not make Library or Reader
unavailable.

The inventory comes from the current document and explicit runtime warming. It
does not use arbitrary historical Performance entries or API responses.

## Conversation Package Invariant

```text
FAILED UPDATE MUST NOT DESTROY LAST KNOWN GOOD OFFLINE STATE
```

The client writes attachment bytes to an immutable internal cache key based on
server-controlled attachment identity and SHA-256. It then commits Dexie
metadata in one transaction. Only after that commit may old cache keys be
best-effort deleted.

```text
new versioned attachment cache entries
  -> validate declared byte size
  -> Dexie transaction commits package/current records
  -> old attachment cache entries become cleanup candidates
```

Legacy attachment keys containing only the attachment ID remain readable. New
writes use `attachment id + SHA-256`; this avoids overwriting the old bytes
before the new Dexie state commits. Cleanup failure is local cache debt, not a
failed committed update.

## Attachment and Viewer Misses

Every offline attachment read checks Cache Storage bytes against the current
metadata size. A missing or truncated entry is removed from the usable set and
resolves to `offline_unavailable`. SHA-256 metadata remains part of the
content-addressed cache identity, but reads do not re-hash file bytes.

| Condition | Result |
| --- | --- |
| Cached original valid | Viewer/download may use a short-lived Object URL |
| Metadata exists, bytes absent | File row says unavailable offline |
| Bytes disappear after file-list query | Viewer shows explicit unavailable state and Retry |
| Cached PDF/image/text bytes absent | No blank stage or permanent spinner |
| Viewer closes on error | Existing Esc/X/backdrop and focus restoration apply |

Offline misses never enumerate server files, create derivatives, widen access,
or start jobs.

## Quota, Interruption, and Restart

Quota failure is the write exception, not `navigator.storage.estimate()`. An
estimate may improve messaging but cannot prove a future write will succeed.

| Failure | Previous committed state | Partial new state | User state | Retry |
| --- | --- | --- | --- | --- |
| Shell cache quota | Active shell A remains | Failed staging cache removed | A usable; update failed | Explicit retry |
| Package cache quota | Package A and old bytes remain | New immutable entries may be removed/orphaned | Update failed; A usable | Idempotent |
| Dexie transaction abort | Package A remains canonical | New cache entries rolled back/bounded | No false READY | Idempotent |
| Truncated package | Package A remains canonical | No committed B | Explicit failure | Allowed |
| Browser/SW restart during failed B | Persisted A reloads | Incomplete B ignored | A usable offline | Allowed |
| Corrupt cached bytes | Metadata remains; bytes rejected | Bad cache entry removed | Explicit unavailable | Reconnect/update |

Automatic shell registration/reconciliation is bounded by the existing single
preparation/reconciliation promises and one navigation retry. Conversation
package retry is user-owned through the existing Update action. Repeating a
retry with the same package identity does not create duplicate current rows.

A same-revision no-work result requires an empty missing-resource set, not just
critical-resource readiness. Same-revision preparation fetches only missing
allowlisted entries in the existing active cache; it does not replace intact
bytes, metadata or other accounts' caches. Failed repair preserves the usable
shell. A different revision still uses the existing staged replacement path.
The client normalizes same-origin allowlisted resource URLs before deduplicating
and sorting its revision inventory. Discovering an absolute DOM URL again as a
relative runtime path or with a fragment does not change the shell revision.
Distinct query strings remain distinct resources; origin/path restrictions are
unchanged. This keeps same-version repair from becoming an unnecessary staged
replacement when only resource-discovery timing changes.
The scoped implementation has synthetic checks and awaits its negative browser
gate; see the [follow-on audit](../execution/ux-audit-post-release-recovery-2026-10-08.md).

## Reconnect

Shell availability and conversation-package availability remain separate.
Valid states include `shell=READY, conversation=NOT_CACHED` and
`shell=READY, conversation=STALE`.

Offline-to-online transition may reconcile the shell or discover a package
update, but it never deletes the current package before the replacement is
fully persisted. Connectivity checks do not advance the canonical
Conversation revision. Network flapping must not create unbounded polling,
reload, logging, or package jobs.

## Test Contract

`e2e/pwa-negative.spec.ts` runs only in a dedicated test-instrumented
production build. The normal production bundle does not expose its package
fault bridge. The suite uses real Cache Storage, Service Worker, IndexedDB,
offline network state, Chromium quota override, and an isolated persistent
browser profile.

Release builds execute:

```text
normal quality and default PWA matrix
  -> test-instrumented production build
  -> Release E negative matrix with no scoped skips
  -> build deployable images from a fresh checkout/runner
```

The matrix covers runtime chunk/critical/optional misses, online recovery,
shell quota, package quota after a partial write, Dexie abort, attachment and
Viewer misses, corruption, truncation, browser/SW restart, package identity,
idempotent retry, reconnect, and bounded offline/online transition.

## Security and Privacy

- Fault injection is compile-time test-only; there is no public query switch.
- Tests use isolated synthetic browser profiles and synthetic conversation data.
- Logs and reports do not include message content, filenames from user data,
  tokens, signed URLs, cookies, or secrets.
- Share remains online-only under its existing contract.
- Cache recovery does not clear all site data or delete committed packages.
- AssetObject GC, automatic server cleanup, package format changes, and new
  synchronization engines remain out of scope.
