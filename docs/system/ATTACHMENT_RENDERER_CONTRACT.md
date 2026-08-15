# Attachment Renderer Contract

## Offline cache-miss hardening addendum (2026-08-15)

Offline attachment bytes are verified against cached metadata before they are
used. A missing, truncated, or SHA-256-mismatched Cache Storage entry resolves
to offline_unavailable and is not promoted to a Viewer object URL. If bytes
disappear after the files panel has already listed an attachment, the shared
Viewer shell shows an explicit retryable unavailable state rather than leaving
the renderer blank or permanently loading.

Release E does not add offline upload, rename, insert, delete, server
enumeration, derivative generation or a second Viewer. The miss path stays
inside the existing AttachmentViewerProvider -> AttachmentViewerShell flow.

## Offline attachment consumption addendum (2026-08-11)

Offline attachment access is consumer-only. `ReaderDataSource.capabilities.attachments` is `read-only`; it does not grant owner file management or server enumeration. The current conversation files panel uses the same `AttachmentViewerProvider -> AttachmentViewerShell -> RenderPlan` path as the online Reader. Cached originals may open/download. Missing originals and missing dynamic viewer resources use the approved `offline-unavailable` FileRow state with explicit text and no permanent loading.

Offline export never changes Attachment/Occurrence/AssetObject identity. It serializes the current downloaded snapshot locally. A missing cached asset remains a metadata record in the local package and is not silently omitted from the attachment accounting. The panel's used/unused predicates are computed from current offline occurrences only.

Last verified: 2026-08-09

This is the durable contract for attachment presentation. Code and tests remain the source of truth. It does not change attachment ownership, uploads, exports, Scanner policy, or Reader content width.

## Inline Layout System

Inline rendering and the Viewer share capability/RenderPlan facts, but they own different geometry. Reader layout is now:

```text
Reader body -> Attachment Lane -> Attachment Group -> Semantic Renderer
```

`InlinePresentation` has exactly `reading`, `data`, `gallery`, `audio-list`, `video`, and `file-list`. The group is the only centred unit. Renderer components cannot add independent `margin-inline`, arbitrary max widths or per-file rounded-card shells.

| Presentation | Primitive | Maximum inline size |
| --- | --- | ---: |
| `reading` | RichPreview (Markdown/text/log/code/JSON/source) | 45rem |
| `data` | DataPreview (CSV/TSV bounded table) | 55rem |
| `gallery` | ImageGallery | Reader attachment width |
| `audio-list` | AudioList | 38rem |
| `video` | VideoPreview | 43rem |
| `file-list` | FileList | 38rem |

Adjacent attachment blocks are queried using the same owner/share/offline access and Registry facts, then split whenever `InlinePresentation` changes. Ordinary body content always terminates a group. Runtime image/media failure can move an item into FileList without changing persistent capability.

Gallery items have no permanent file header. Filename and View are progressively disclosed on hover/focus; original download remains in the Viewer. Rows preserve aspect ratios at an approximately 200px target, do not crop, and cap the final row at 220px before centring it. More than six images shows five images plus a dedicated `+N` Overview entry. TIFF joins Gallery only when the RenderPlan has a reliable visual preview; otherwise it remains a FileList row.

AudioList and FileList each own one subtle border/radius surface and row dividers. Rows do not have individual outer cards. Rich/Data previews keep one bounded preview surface with no vertical nested scroll; Code/Data may scroll horizontally. Metadata order is filename, friendly type, size and low-weight `未扫描`.

Spacing follows an 8px base: 24px between semantic groups, 8px within a group, 12px inner padding, 48px preview headers/footers, 56px FileList rows and at least 44px action targets. Normal surfaces use 10px radius and media uses 12px. These tokens live in Reader CSS and do not change the Reader width.

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

## Unified Viewer And Adaptive Presentation

The application has one Viewer architecture, not one universal Viewer size:

```text
AttachmentViewerProvider
-> ViewerPresentationResolver
-> AttachmentViewerShell
-> Renderer
```

`ViewerPresentation` is transient UI state derived from the Viewer kind/mode, item count, intrinsic media dimensions, PDF page count and current viewport. It is never written to Attachment, occurrence or database state.

| Presentation | Default Viewer | Desktop bounds |
| --- | --- | --- |
| `compact` | audio | `min(720px, 90vw)` by up to `min(70vh, 640px)`; current audio shell targets about 420px height |
| `reading` | Markdown, text, log, code, JSON | 1000px normal / 1240px code maximum, 90vw by 82vh |
| `document` | PDF | 1120px single-page / 1280px multi-page maximum, 88vw by 86-90vh |
| `media` | image, image Focus, video | intrinsic aspect-ratio-aware, at most 90vw by 90vh; small media is not enlarged to the viewport |
| `workspace` | image Overview, CSV/TSV table | 96vw by 94vh |

At viewport widths below 768px every presentation becomes `100vw x 100dvh`; the outer overlay has no mobile inset. Desktop presentations may enter a CSS-only `maximized` state at 96vw x 94vh. Browser fullscreen is not used. While maximized, the first Escape exits maximized and the next Escape closes the Viewer. Resize changes only the shell bounds and does not reset renderer page, active item, zoom, mode or scroll state.

The shell remains portaled to `document.body`, has one bounded content viewport, safe-area handling, dialog semantics, focus containment, backdrop close, reference-counted body scroll lock, and trigger focus/Reader scroll restoration. `AttachmentPreviewDialog` remains a portal-free adapter; renderer-specific portals are forbidden. A PDF toolbar may portal into the toolbar host inside the same shell without creating another dialog.

The shell owns no vertical scroll. Its `ViewerViewport` is `min-height: 0; overflow: hidden`; each renderer owns its single content scroll container. Canvas backgrounds are renderer-specific: document gray for PDF, reading surface for Markdown/text, code surface for source, neutral media for images, dark media for video, and system surface for audio/table.

PDF defaults to Fit Page. Single-page PDF shows exactly the active page, centered and fully contained without a vertical scrollbar. Fit Width and custom zoom own both horizontal and vertical scrolling. Multi-page PDF uses the large document presentation and an optional, collapsible thumbnail rail. Page, fit and zoom controls live in the common toolbar rather than consuming a second content row.

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

The adaptive-presentation release passed 12 focused policy/presentation/SVG tests, Web lint, typecheck and production build. Its default PWA matrix passed 19 tests with 21 online/fixture-gated conditional skips; the full API suite remained `211 passed / 1 skipped`, and Alembic remained at the single `20260806_0021` head. Before deployment, production Chrome measured the old single-page PDF shell at about 1844 x 1016 CSS pixels in a 1920 x 1080 viewport, confirming the former universal 96vw x 94vh behavior.

Commit `a89bc28f5f7cb4028474e8e4488f771aadb9c19f` was built by GitHub Actions run `31294947752`; the release archive SHA-256 is `4d48d4d55c461be318c5ccab2b06eaabeefb11e1c32dcb73b2201aa3d833e5be`. King production Chrome then measured the same single-page PDF as the `document/normal` presentation at 1120 x 900 CSS pixels in the 1920 x 1080 viewport. Fit Page had equal client/scroll heights; Fit Width became the sole scrolling container and switching back restored the no-scroll Fit Page state. Production also verified compact audio (720 x 414), reading Markdown/JSON (1000px), large reading code (1240px), media Image Focus, workspace Gallery Overview/CSV, CSS maximize with two-stage Escape, and exact mobile 390 x 844 fullscreen with no maximize button. The five requested viewport classes were exercised; viewport state changed shell geometry without altering renderer state. Conditional skips remain `PARTIAL_PASS`, not PASS.

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

UNIFIED_VIEWER_SHELL = APPROVED
ADAPTIVE_VIEWER_PRESENTATION = APPROVED
DEFAULT_FULLSCREEN_FOR_ALL_ATTACHMENTS = REMOVED

COMPACT_VIEWER = APPROVED
READING_VIEWER = APPROVED
DOCUMENT_VIEWER = APPROVED
MEDIA_VIEWER = APPROVED
WORKSPACE_VIEWER = APPROVED

MOBILE_FULLSCREEN = APPROVED
OPTIONAL_MAXIMIZE = APPROVED
```
# 2026-08-09 Addendum: First Complex Browser Renderers

The contract remains `Viewer = consume`, `Files panel = manage`, and `Editor = compose`. No attachment data model or migration changed.

| Capability | Inline | Viewer | Limit/fallback |
| --- | --- | --- | --- |
| DOCX/ODT | viewer-only file row | `document` | bounded paragraphs/tables in a Worker, otherwise download |
| XLSX/ODS | viewer-only file row | `spreadsheet` | bounded read-only sheets/grid, otherwise download |
| PPTX/ODP | viewer-only file row | `presentation` | bounded static slide text/navigation, otherwise download |
| ZIP | viewer-only file row | `archive` | bounded directory and small text/image entry preview, no recursive extraction |

`fflate` is reused for the lazy ZIP Worker; it does not replace the established export/offline implementation. The Worker rejects oversized source files, excessive central-directory entries, oversized entries and excessive expanded bytes before preview. Original authenticated downloads remain available. DOC/XLS/PPT, RTF, TAR-family, EPUB, VSDX, drawio, DXF, STL, OBJ and unknown formats remain `NOT_IMPLEMENTED` with reliable download-only behavior.

# 2026-08-10 CSV/TSV Viewer Closure

CSV and TSV use the existing unified `AttachmentViewerShell` with `table` as the default rendered mode and `table-raw` as the explicit source mode. Rendered mode uses a bounded quoted-field parser, sticky header, row numbers, horizontal overflow within the Viewer and a row/column summary; it never reads beyond the existing 8 MiB content range and aborts at parser row/column caps. `Raw` remains available from the same toolbar and does not create another dialog.

Legacy import labels exactly equivalent to the visible filename (for example `Attachment: sample.csv` and `附件：sample.csv`) are not rendered as captions. This removes duplicate footer information without suppressing a real occurrence caption.
