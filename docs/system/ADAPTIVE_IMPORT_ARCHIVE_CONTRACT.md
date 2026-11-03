# Adaptive Import ZIP Contract

Status: source candidate implemented 2026-11-03; not CI/production accepted.
This contract extends the existing Adaptive Import session. It does not replace
`.cr` personal restore, system archives, or the canonical import commit.

## Supported ZIP shapes

The existing Adaptive Import file picker accepts `.zip` alongside JSON and
Markdown:

- **Conversation export ZIP:** a root (or single common wrapper directory)
  `conversation.md` plus a valid `manifest.json` with string `version`, `assets`
  and `messages` arrays. The Markdown transcript is authoritative for message
  boundaries and text. Manifest message-count differences are warnings, not
  permission to fabricate messages. Only the selected transcript is imported;
  manifest-declared files become candidate attachments.
- **Generic Markdown ZIP:** one or more `.md`/`.markdown` members. Each is a
  conversation candidate and remains in the existing profile/mapping review
  flow. Other members begin excluded; resolvable local resources referenced by
  Markdown are proposed as attachments and associated with the referring
  document. The user may include/exclude members and correct ownership before
  commit.

Other ZIP types do not become conversation import paths merely because they
contain role-like text. An archive with no Markdown document is rejected.
Existing `.cr` detection and restore remain unchanged.

## Safe inspection and recovery

The ZIP upload is subject to the existing Adaptive Import per-file and
session/gateway budgets (default 500 MiB per file/gateway request and 512 MiB
per session). Archive inspection then applies the existing configurable bundle
limits (defaults: 2 GiB aggregate expanded size, 256 MiB per member, 5,000
entries, compression ratio 100, and path depth 4). It rejects absolute,
traversal, duplicate-normalized, backslash/drive/colon/NUL paths, encrypted
members, symlinks and unsupported special files. Each member read is bounded
and checked against ZIP integrity errors; referenced attachments are streamed
and CRC-checked when committed. These settings are independent bounds, not a
promise that an accepted ZIP fits in a fixed amount of process memory.

The source ZIP is retained only inside its owned Adaptive Import session. The
catalog is a derived, versioned sidecar, not canonical conversation data. Its
member list is paged (`offset`, `limit`, at most 500 per read), and a
classification update must include the exact `expected_version`; stale edits
return `ARCHIVE_CLASSIFICATION_STALE`. Replacement advances that revision,
including ZIP → text → ZIP replacements; stable path/member identities do not
authorize an old preview to overwrite replacement bytes. Editable-session
mutations, catalog reads and canonical queueing use the ImportRecord row lock.
Progress polling does not take that lock; active analysis cancellation keeps
its existing job-first protocol and does not wait for the worker's record lock.

Classification/replacement snapshots the previous catalog and canonical draft
inside the task temporary area. An in-process mutation/DB-commit failure
restores overwritten files and removes only new regular files inside the
validated session root. This is exception recovery, not a durable cross-store
crash journal. Old sources are cleaned only after a successful DB commit.
A failure to read the response after an acknowledged commit never deletes the
new committed source; it reports `*_RESPONSE_UNCONFIRMED` and requires session
review rather than claiming that the old classification/file is still current.

The Web ledger keeps version-bound local overrides across pagination/refetch.
Mixed-version pages cannot be saved together. A newer catalog preserves old
edits for explicit discard/review, never silently rebases them. Unsaved ZIP
choices block canonical import and conflicting overview actions, and join the
existing dialog-close protection; collapsing the ledger does not lose them.

Missing relative resources and missing manifest-declared assets are blocking
issues. A manifest asset path that is absolute, traverses, uses a drive/colon,
backslash, NUL or otherwise fails member normalization is also a blocking
`MANIFEST_ASSET_PATH_INVALID` issue; it is never ignored or guessed. CRC,
decode, or archive errors fail safely rather than leaving a partially imported
conversation. Unreferenced files are never silently attached. A valid archive
can still be reviewed, corrected, or replaced using the normal Adaptive Import
recovery flow.

## Resource identity and Reader rendering

Markdown links/images and recognized `src`/`href` attributes are resolved only
against normalized members in the same ZIP, outside fenced/indented/inline
code and recognized `<code>/<pre>` examples. Inspection, rewriting and
occurrence construction share one source-offset resource scanner; excluded
regions are intervals rather than per-character object copies. This is a
bounded resource scanner, not a replacement CommonMark parser. Archive-local
attachment references are rewritten to stable `cr-asset://<member-id>`
identities in the derived Markdown source. These IDs are resolved through the
existing message-version attachment occurrence contract; no archive path is
treated as a public URL or guessed as a filesystem path.

If a matched member is excluded, is not an attachment, or is assigned only to
another document, its local reference is
rewritten to the inert `cr-archive-member://<member-id>` scheme. It therefore
cannot accidentally resolve against the current Reader route. The visible
label/alt text remains, but no missing file is presented as usable. External
URLs keep the existing Markdown URL policy and do not become archive
attachments.

On canonical commit, attachment bytes are streamed through bounded staging,
MIME detection and the configured malware/policy scanner. Allowed content is
stored in the existing `AssetObject` store, deduplicated by content hash and
size, and related to its `Attachment` and `MessageVersionAttachment`
occurrences. Rejected/unavailable objects abort the import transaction; no
fake occurrence is attached to an unrelated message. Repeated references are
associated with their actual render block in source order, not the first
matching block or the last message. Safe HTML a/img/audio/video projections
use the same authorized occurrence resolver before sanitization; ordinary
source data attributes cannot manufacture attachment authority. Reader, Share
and Offline continue using their existing same-origin attachment/access
contracts.

## API surface

The existing session endpoints accept ZIP uploads and replace a source with a
ZIP. Two session-scoped operations are added:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/adaptive-import/sessions/{id}/archives/{artifact}` | Read ZIP summary and a bounded member page. |
| PUT | `/api/adaptive-import/sessions/{id}/archives/{artifact}` | Update member `use`/owner selections with `expected_version`; then rebuild the existing import plan. |

Both routes use the current import ownership checks and bounded analysis
admission. Canonical commit still uses `POST /api/imports/{id}/commit`. No
database migration, new canonical column, export format, Share URL, offline
package version, or Dexie version is added.

## Local verification and remaining gates

Regression coverage verifies generic Markdown ZIP catalog/classification,
pagination/edit preservation, replacement stale-version rejection, unsafe
manifest paths, code-example fidelity, excluded/wrong-owner references,
dedicated conversation ZIP commit, repeated real-block occurrences, transaction
fault recovery and post-commit response failure. The
[completion audit](../execution/ux-audit-reader-zip-completion-2026-11-03.md)
owns the current results; earlier implementation counts remain historical.
PostgreSQL concurrency and Web/browser visual
acceptance, CI, online tests and deployment remain user-owned and are not
implied by passing local tests.
