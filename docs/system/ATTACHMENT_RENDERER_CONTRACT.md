# Attachment Renderer Contract

Last verified: 2026-08-09

This is the durable contract for attachment presentation. Code and tests remain the source of truth. It does not change attachment ownership, uploads, exports, Scanner policy, or Reader content width.

## Product Boundary

```text
Viewer = consume
Files Panel = manage
Editor = compose
```

Every attachment entry uses `AttachmentViewerProvider -> AttachmentViewerShell -> RendererCapability -> RenderPlan`. `AttachmentPreviewDialog` is a portal-free compatibility adapter. The application has one attachment Viewer portal and one dialog shell. Viewer actions never rename, replace, detach, delete, or insert attachments.

## State And Planning

| Layer | Meaning | Persistent |
| --- | --- | --- |
| `AttachmentDataState` | `available`, `empty`, `missing`, `uploading`, `upload_failed` | canonical data |
| `RendererCapability` | static type capability and Viewer kernel | no runtime mutation |
| `RuntimeRenderState` | `idle/loading/ready/unsupported/failed/offline-unavailable` for one request | no |
| `RenderPlan` | current UI skin, mode, variant and allowed actions | no |

`unsupported(codec/browser-capability)` is separate from `failed(network/decode/parser/timeout/authorization)`. Retry creates a new request; neither state changes database capability.

`RenderPlan.inline` has exactly `media`, `preview-panel`, and `file-row`. Empty, missing, unsupported, preview failure and offline absence are FileRow variants. There is no fallback skin.

Scanner state is independent metadata. `scanner_disabled/unscanned` displays as `未扫描`, never as clean or safe, and does not change renderer capability.

## Type Resolution And Registry

Resolution order is `detected MIME/content format -> declared MIME -> compound filename extension -> simple filename extension -> unknown`. A filename-derived `detected_extension` is not content detection and cannot override declared MIME or a trusted content MIME.

| Types | Inline skin | Viewer | Status |
| --- | --- | --- | --- |
| PNG/JPEG/WebP/GIF/BMP/ICO/SVG | media | image | implemented |
| TIFF | file-row or converted first-frame preview | image when derivative exists | partial |
| Markdown | preview-panel | rendered/source | implemented |
| TXT/LOG/SRT | preview-panel | text/source | implemented |
| JS/TS/PY/SQL/CSS/HTML/XML/YAML/TOML/INI | preview-panel | inert code/source | implemented |
| JSON | preview-panel | bounded tree/raw | implemented baseline |
| CSV/TSV | preview-panel | bounded raw/table | partial |
| PDF | compact preview-panel | PDF.js canvas | implemented baseline |
| MP3/WAV/OGG/FLAC/M4A/AAC | compact media | audio | runtime probe |
| MP4/WebM/MOV | compact media/file-row | video after runtime probe | runtime probe |
| AVI/MKV | file-row | none | download-only |
| Office/ODF/EPUB | file-row | none | `NOT_IMPLEMENTED`, download-only |
| Archive/compressed | file-row | none | `NOT_IMPLEMENTED`, download-only |
| VSDX/drawio/DXF/STL/OBJ | file-row | none | `NOT_IMPLEMENTED`, download-only |

Download-only rows never open a false Viewer.

## Images, Gallery And Identity

Occurrence `display_mode` supports `auto`, `small`, `medium`, and `large`. Legacy `inline`, `card`, and unknown values map to `auto`. `small` is capped at 280px, `medium` at 480px, and `large` at Reader available width. Images preserve aspect ratio, use `object-fit: contain`, do not crop, and are not enlarged beyond intrinsic CSS dimensions. Display mode never changes Attachment, occurrence, derivative, asset, or download identity. SVG remains an ordinary `<img>`; SVG XML is never inserted into the application DOM.

A Gallery contains only adjacent image occurrences in one current MessageVersion. Normal content ends the group. For more than six images, Reader renders five images plus a sixth `+N` entry; the Viewer session retains every occurrence.

Occurrence identity is `message_version_id + occurrence_key`. `block_index` is only a sort/DOM-location hint. File-panel attachments without occurrences may open a single Viewer but never enter message or conversation Gallery.

Current-conversation image order is `message order -> current MessageVersion -> RenderBlock order -> display_order -> occurrence_key`. Attachment, derivative, and database return order are not authorities.

## Fullscreen Viewer

Desktop uses a centered `96vw x 94vh` shell; mobile uses `100vw x 100dvh`. The shell is portaled to `document.body`, has one bounded content scroll area, safe-area handling, dialog semantics, focus containment, Esc/backdrop close, reference-counted body scroll lock, and trigger focus/Reader scroll restoration.

Image Focus supports Fit, zoom, pan, previous/next keys and a filmstrip with `aria-current`. Overview returns to the selected Focus item. Controls have 44px targets, survive 200% zoom/reflow, respect reduced motion and do not communicate state by color alone.

Markdown Rendered and Source share the shell. The content area has `min-height: 0`, vertical overflow and contained overscroll, so long Markdown scrolls without moving Reader. Markdown HTML is skipped/sanitized; scripts, frames, objects, embeds, event handlers and `javascript:` URLs are not rendered. External images use the existing Reader placeholder/link policy rather than being fetched automatically.

Image, text, PDF and media load errors produce explicit retry/download UI. Runtime codec rejection uses `unsupported`; transport/decode failures use `failed`. A failed request is never stored as permanent capability.

## Large Files And Derivatives

- JSON tree: source <= 8 MiB, depth <= 64, nodes <= 50,000, children/node <= 2,000, key preview <= 256 code points, string preview <= 4,096. Exceeding a limit aborts tree construction and uses Raw.
- CSV/TSV table: parse <= 8 MiB, rows <= 10,000, columns <= 256, cells <= 250,000, field <= 64 KiB. Inline reads at most 128 KiB and 8 x 8 cells. Full table enforcement beyond the baseline remains partial.
- Text search: query <= 256 code points; regex is unsupported; each page scans <= 8 MiB in 256 KiB chunks, returns <= 200 matches and <= 256 KiB within a 750ms deadline.
- Search cursor is HMAC-signed and binds Attachment ID, asset SHA-256, size/version, normalized query hash, encoding, byte offset and expiration. Mismatch returns `cursor_stale`.
- Image derivatives cap source at 64 MiB, decoded pixels at 32 MP, estimated memory at 128 MiB, CPU at 10 seconds and output to one frame. Thumbnail/preview maximum edges are 320/1600px with no enlargement.
- TIFF derivatives represent only page/frame one and must be labeled accordingly. Animated GIF/WebP static-preview thresholds remain a contract requirement; metadata/frame enforcement is not production verified.

Overview prefers bounded previews and Focus loads the active item. Original bytes are always the download authority.

## API, Permissions And Offline

Owner, Share and derivative content routes authorize before stat/read and support GET/HEAD plus one byte range. Valid ranges return 206 with `Accept-Ranges`, `Content-Length`, and `Content-Range`; invalid, multiple, or out-of-bounds ranges return 416. Empty content returns 200 with length zero.

Owner batch downloads validate one conversation, active/available attachments, unique IDs, <= 500 business attachments and <= 2 GiB. The worker streams originals into a safe-name ZIP with a 24-hour artifact TTL. It rejects unsafe paths, cross-conversation IDs, missing/detached data and excessive quotas. Attachments sharing one AssetObject retain distinct business filenames.

Share may view/download one authorized attachment and navigate a Gallery composed only from authorized message occurrences. Share cannot enumerate owner conversation files, discover unplaced attachments, open owner conversation Gallery, create derivatives, or create batch ZIPs.

Offline does not start jobs, call server search, generate derivatives, generate batch ZIPs or enumerate server attachments. It consumes packaged/cached originals, derivatives and Viewer runtime only. A missing resource becomes `offline-unavailable`; local download is available only when the original Blob is cached. Dynamic Viewer chunks are warmed before the offline shell inventory is committed.

Schema introspection is limited to startup, CI, migration tests and deployment preflight. Public capabilities expose abstract booleans only, never PostgreSQL names. Local migration tests and Alembic confirm the no-migration implementation uses single head `20260806_0021`.

## Verification Status

The 2026-08-09 local verification passed Web lint, typecheck, production build, API `211 passed / 1 fixture-gated skipped`, attachment contract tests `3/3`, final Renderer/SVG/portal policy tests `7/7`, and PWA baseline `13 passed / 21 conditional skipped`. Conditional tests remain `PARTIAL_PASS`, not PASS.

Final commit `5baea32cdada3ed22ae01268cac128f88fa9f527` was built by GitHub Actions run `31269172465` and deployed to King from archive SHA-256 `55a53e8606ae1e404255729dbb566172913997b3678648e3630b95be73400f6e`. Production Chrome verified the single `document.body` dialog, image Gallery and filmstrip, Markdown Rendered/Source, trusted MIME versus generic-text refinement, download-only engineering formats, TIFF fallback without a broken image, Esc, body scroll lock and restoration. Core Viewer production acceptance is PASS.

This does not promote unexecuted conditional PWA/Offline tests, animated-image frame enforcement, TIFF converted first-page preview, or optional complex viewers. Office, Spreadsheet, Presentation, EPUB, Archive, Diagram, CAD and 3D remain `NOT_IMPLEMENTED` with reliable authenticated download-only fallback.

```text
ATTACHMENT_RENDERER_CONTRACT = APPROVED
INLINE_RENDERING = APPROVED
GALLERY = APPROVED
FULLSCREEN_VIEWER = APPROVED
FILE_PANEL_VIEWING = APPROVED
SHARE_VIEWING = APPROVED_WITH_PERMISSION_BOUNDARY
OFFLINE_VIEWING = APPROVED
LARGE_FILE_HANDLING = APPROVED
DERIVATIVE_PIPELINE = APPROVED
RANGE = APPROVED
TEXT_SEARCH = APPROVED
BATCH_DOWNLOAD = APPROVED
INERT_CONTENT_SECURITY = APPROVED
DOWNLOAD_ONLY_FALLBACK = APPROVED

IMPLEMENTATION_READY = YES
```
