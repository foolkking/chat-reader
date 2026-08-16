# Source Editor Upload Atomicity Contract

Last verified: 2026-08-16

## Invariant

`cr-upload://...` is transient Source Editor state. It may exist only in the
unsaved CodeMirror document, the editor upload registry and controlled test
fixtures. A successful message mutation must never persist it in a
`MessageVersion`, render block, Reader, Share, export, Offline package or
Context package.

Canonical attachment references use `cr-asset://<attachment UUID>`. A new
upload uses an editor-local `cr-upload://draft-<random UUID>` Markdown
destination until the conversation-owned `Attachment` exists and the exact
reference is replaced. Existing conversation attachments insert their
canonical `cr-asset://` reference directly and do not enter upload gating.

The transient classifier recognizes an active Markdown link or image
destination outside fenced, inline and indented code. Bare prose and code
examples that mention the scheme are ordinary user content, not attachment
references.

## State Ownership

The Source Editor workspace owns one upload job per draft token. A job retains
its session, upload-item and finalized Attachment identity across a retry and
allows only one in-flight attempt. Finalize is idempotent for an already
committed upload item.

CodeMirror `EditorView.state.doc` is the authoritative editor document. The
React text state is a render/dirty-state mirror; the save function rereads the
live CodeMirror document immediately before mutation.

The valid transition is:

```text
file selected
  -> unique transient marker inserted in CodeMirror
  -> upload network in progress
  -> Attachment finalized
  -> editor status canonicalizing
  -> exact active marker replaced by cr-asset:// in one CodeMirror transaction
  -> post-dispatch document verification
  -> ready and save eligible
```

Network completion is not editor readiness. A missing marker means the user
removed the reference and the finalized Attachment remains active and
unreferenced. A duplicated marker is an explicit error; the editor does not
guess which occurrence to replace.

## Three-Layer Defense

1. Editor state disables every save action while a draft is uploading,
   canonicalizing, failed or otherwise unresolved, or while the authoritative
   document contains an active transient reference. The same state is exposed
   through an accessible status.
2. The shared save function rereads `EditorView.state.doc`, applies the same
   source-aware classifier and returns before `onSave` if a draft or transient
   reference remains. Button, form, close-and-save and programmatic submit all
   converge here; there is no separate keyboard shortcut path.
3. FastAPI validates source at the canonical persistence service boundary and
   again before version create/replace/synchronization. An active transient
   reference returns structured HTTP 422 detail with machine code
   `transient_upload_reference` and a line number. The transaction is rolled
   back. Canonical `cr-asset://` references remain accepted and conversation
   ownership/occurrence validation is unchanged.

## Editor Transactions

Canonicalization locates the current active reference by token identity, not
its original character offset, and replaces only the URI and upload label
spans. The CodeMirror transaction uses `addToHistory: false`; change mapping
preserves typing, cursor, selection and scroll without reconfiguring or
remounting the editor. Undo/redo may remove or restore the user's attachment
insertion, but cannot restore a persistable transient reference.

Removing a ready draft removes its exact canonical marker before applying the
existing Attachment removal policy. Removing a transient marker before
completion never reinserts the canonical reference. The finalized Attachment
may remain active and unreferenced in the Files panel, matching the existing
product contract.

## Failure And Retry

Partial failure retains successful canonical references and leaves failed
drafts visible and save-blocking. Retry reuses the known session/item stage,
is single-flight, and accepts an idempotent finalize response without creating
a duplicate canonical reference. A 409 revision conflict or a save network
failure keeps the canonical draft; neither path reconstructs `cr-upload://`.

Optional MIME detection serializes `python-magic` initialization and first
use. This prevents concurrent uploads on platforms without native libmagic
from observing a partially initialized module; normal signature and mimetype
fallback remains unchanged.

## Verification Contract

The Release I browser gate runs the real production build with deterministic
Playwright request barriers. It covers pending immediate submit, fast/slow
upload, typing, out-of-order uploads, partial failure, retry, cursor, selection,
scroll, file chooser, drag/drop, clipboard paste, delete-before-completion,
undo/redo, and 409/500 save recovery. A save payload is captured and must
contain `cr-asset://` and no `cr-upload://`; persisted versions and occurrences
are then read back from the API.

The API gate covers PATCH, conversation create and message insert rejection,
transaction state remaining unchanged, code-literal acceptance, canonical
acceptance and occurrence integrity. The normal production bundle exposes no
upload fault bridge; browser barriers exist only in Playwright request routing.

## Data And Deployment

Release I adds no Alembic migration, Dexie schema change, Offline package
format change or runtime dependency. Before production acceptance, an
aggregate source-aware audit must report only the count of persisted active
transient references and never emit source, tokens, filenames or IDs. Any
nonzero count requires separately approved data repair; Release I does not
rewrite historical user content automatically.

Deployment follows the immutable release contract: exact Actions SHA,
verified archive and image identities, complete backup, explicit `API_IMAGE`
and `WEB_IMAGE`, `--no-build`, running-image identity before browser QA, and
retention of the Release H immutable rollback images and backup. `latest` is a
convenience alias only.

## Production Closure

The first immutable candidate exposed an additional editor-creation ordering:
a real file chooser could queue work before lazy CodeMirror creation, marker
insertion updated the React text mirror, and the post-create controlled-value
effect restored the older `editorDocument`. The final implementation
synchronizes both mirrors from the exact live CodeMirror document after marker
insert, canonical replacement and explicit removal. Missing markers still mean
the user removed the reference and are never reinserted. Deterministic
`I-RACE-002A` holds the lazy editor chunk and finalize response to preserve this
contract.

Final runtime source is `7bcd686b59d62fb9907ba09d644637b7af2b3d86`.
Actions run `31934088629` passed the full quality and image chain for that exact
SHA. King verified the archive checksum and complete backup, bound immutable
API/Web images, ran migration from the exact API image and confirmed running
API/worker/Web identities against the manifest before acceptance.

Production Chrome passed three independent real chooser/upload/save/reload
flows with canonical API readback, Viewer open, zero legitimate-path CSP
violations and product-API cleanup. A source-aware post-deploy aggregate audit
reported zero active transient references in all and current MessageVersions.
No source, token or business identifier was emitted. `RELEASE_I = PASS` and
Release H remains the direct rollback.
