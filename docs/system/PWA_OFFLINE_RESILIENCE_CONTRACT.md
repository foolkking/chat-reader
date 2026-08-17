# PWA and Offline Resilience Contract

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
```

The standalone incomplete response has no external script, style, font, API,
or image dependency. It cannot enter a reload loop.

## Critical and Optional Resources

Critical resources are current document scripts/styles, Library navigation,
the offline search worker, icons, bundled KaTeX assets, and warmed Viewer
runtime chunks required by the active shell. The two parsing Skill Markdown
files are optional. A missing optional Skill does not make Library or Reader
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
