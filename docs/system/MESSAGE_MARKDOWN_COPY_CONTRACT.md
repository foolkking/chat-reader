# Single-message Markdown copy

Current source: 2026-10-23. Release status is owned by
[PROJECT_STATE](../../PROJECT_STATE.md), not this implementation contract.

## User action and source

The owner Reader has a 44px copy action immediately before the bookmark in
each message's top actions, including the existing mobile actions sheet.
It copies the **whole current canonical `MessageVersion.display_text`**,
not the DOM selection, currently mounted blocks, conversation or original import.
Existing selection-copy behavior is unchanged. Share, Offline Reader and
administrator read-only views do not offer image publication.

The installed ReactMarkdown/AI Rich Markdown parser supplies source positions.
Only canonical `cr-asset://` image/file nodes and their reference definitions
are rewritten. Code, math, literal HTML, tables, whitespace, line endings and
ordinary external URLs remain source text; this is not HTML-to-Markdown export.
Supported attachment images are PNG, JPEG, GIF, WebP, AVIF, BMP, ICO and bounded SVG.
Image attachment links become Markdown images. Other attachment nodes are
omitted, not downloaded or published. Missing/unavailable referenced images
fail the whole preparation rather than silently omitting a picture.
Unsupported image formats (for example TIFF) fail with a conversion instruction;
they are not silently treated as an omitted non-image file.

Preparation is cancellable and fenced by message/version, mounted lifetime and
authentication generation. Retirement clears prepared text and blocks stale
clipboard retries. The mobile sheet closes before feedback; no second dialog
is added. Success means Clipboard API completion. Failure leaves the entire
prepared Markdown selected in a labelled read-only field for manual copying.
The UI warns that the image links are public until file deletion.

## Explicit public capability

An authenticated owner GET returns full source and private attachment metadata
without publishing anything. The subsequent owner POST checks the current
version and every requested image before creating any capability.
`attachment_public_links` (migration `20261022_0053`, parent
`20261017_0052`) binds one stable, independently random 256-bit URL capability
to each attachment/source-object pair. Concurrent/repeated copies reuse it.
It is not an attachment UUID, Share token, login cookie or expiring signed URL.

Only exact `GET`/`HEAD /api/public-images/{43-character-token}` bypass login.
Mutation, source-plan, private content, nested and malformed paths do not gain
public access. Public reads recheck the attachment/source binding, conversation
deletion, file availability and scanner policy on every request. Detach/delete,
replacement, quarantine/blocking or missing source bytes fail closed with the
same 404. Removal also deletes the capability, so re-adding a file cannot
resurrect its old URL. Message deletion alone does not delete the conversation
file; remove that file or conversation to revoke access.

Links have no automatic expiry and survive logout, password changes and Share
revocation. Anyone with the URL can read/copy it. The UI uses its current public
origin; moving origin or restoring data to another host does not redirect old
URLs. Downloaded external copies cannot be recalled. Losing the clipboard race
or closing the notice after publication does not revoke already-created links.

Responses support existing HEAD/Range behavior and use raster MIME,
`Cache-Control: no-store`, `nosniff`, `Referrer-Policy: no-referrer` and inert
CSP. The Nginx public-image location disables proxy caching and raw URI access/error logs;
API events use route templates, not token-bearing URLs. Gateways, APM and
external clients must likewise avoid persisting capability URLs.

## SVG and resource limits

No original SVG XML is public and no server SVG renderer/network fetch is added.
The browser parses a detached SVG, rejects active/external/embedded content,
entities, external CSS/fonts, animation/filter/foreignObject and excessive
dimensions, then loads only the bounded document as an opaque Blob image.
Safe static shapes, text, styles and internal fragment references can rasterize.
Unsupported/complex SVG fails with an actionable error; it is not a general
SVG fidelity guarantee.

The API accepts only bounded single-frame PNG, decodes with existing Pillow,
and re-encodes **pixels only**, discarding metadata. Browser-produced PNG mappings
are scoped to the specific attachment, never inherited by another account
sharing the same deduplicated SVG source. Pixel-identical PNG storage may still
deduplicate. Prepared derivatives alone do not create public capabilities.

| Boundary | Limit |
| --- | --- |
| Single canonical source | 4 MiB UTF-8 |
| Source attachment metadata / distinct published images | 1,000 / 100 |
| Parsed Markdown / SVG element count | 100,000 / 10,000 |
| SVG source | 2 MiB |
| SVG pre-decode dimensions | 4,096 per edge and 4,000,000 pixels |
| PNG upload / decoded result | 4 MiB; 1,600 per edge; 2,560,000 pixels |
| Preview uploads | One active per API process; excess 429 with Retry-After |
| Upload body / browser image-load wait | 15s / 10s |

Browser timers are not a hard CPU-preemption guarantee. The server does not
decode arbitrary SVG, run a subprocess or queue an extra worker. A concurrent
deduplicated PNG insert conflict rolls back and returns retryable 503, not
partial publication.

## Persistence and compatibility

Capabilities are database state, excluded from personal/system `.cr`, Context,
offline packages and Dexie. Those formats and v1/v2/v3 reading remain unchanged;
restoring a portable archive does not restore public URLs. Full operational
PostgreSQL plus asset-storage backup preserves them. Migration downgrade
revokes every capability by dropping only its table/index; source messages,
attachments and files are untouched. Database downgrade is an operator-approved
operation, not automatic image rollback.

## Owner-selected image size

An owner can expand **Image size** below an inline attachment image, read its
original dimensions, enter a whole **1–100%**, Apply, or Restore 100%.
The percentage is relative to the original, never the last resized result.
Dimensions are rounded to the nearest pixel, with a one-pixel minimum. Raster
EXIF orientation is applied before determining width/height. The original file,
private content/download URL and original viewer remain unchanged.

The source-hash-bound `Attachment.metadata.image_display_v1` stores
`source_sha256`, `scale_percent`, `original_width`, `original_height`, `width`
and `height`. The existing derivative table stores `image_display_png` with an
attachment-scoped generator version; there is **no migration** (head stays
`20261022_0053`). Source replacement invalidates the selection. Saving checks
both source hash and expected current percentage under an attachment row lock;
a stale save returns 409 with a read-before-retry instruction.

All inline references to **the same attachment** use the saved size, with a
container-width cap. This is not a different setting for each occurrence.
Existing public-image URLs keep their identity and resolve the latest selected
PNG (original raster bytes at 100%). The URL's intrinsic pixels therefore work
in ordinary Markdown clients without nonstandard image-size syntax. The
response remains no-store with live source/scan/deletion checks. A missing
selected derivative fails closed rather than silently serving the original;
the owner can explicitly save again to repair it. Anonymous reads never resize.
Apply remains available for an unchanged valid percentage after a successful
read, including initial 100%; an uncertain write must still be checked first.
Saving a size **does not publish** an image. Only the existing explicit
Markdown-copy publication does.

For SVG, original dimensions follow the existing bounded sanitizer's
numeric/px/viewBox/default-size interpretation. Resizing uses its validated,
attachment-scoped safe PNG, never server-side SVG execution. At 100%, a large
SVG can have original dimensions but is still derived from the safe preview
(at most 1600px per edge), not a guarantee of original vector detail.

Resize admission shares the single per-process preview/conversion slot
(429/Retry-After). Source bytes are at most 16 MiB and decoded input at most
8,000,000 pixels; the output is at most 4096px per edge, 4,000,000 pixels and
16 MiB. SVG keeps its stricter existing source and preview limits. Animated
images are rejected for resizing rather than flattened; their unchanged
original may still be used at 100%. Pixel-only PNG output discards metadata.
Oversized, unsupported or unsafe content leaves the last valid selection
unchanged. No new dependency, network fetch, worker or decoder is introduced.
These are admission bounds, not a claim of measured production peak memory.
The raster encoded-byte limit is checked against both stored size and actual
file size **before Pillow header/EXIF inspection**, including GET and 100% saves.
Size-reading rejection leaves the original available through its existing access
paths; the UI directs owners there instead of suggesting a blind save retry.

Share/Offline/read-only views never offer the editing control. They can render
saved metadata with existing private/offline image access; offline copies are
snapshots and do not live-follow later saves. Existing `.cr` attachment metadata
can retain a selection, but derived objects/public capabilities are not a new
portable format: after restoring elsewhere, saving again may be required before
publishing. Existing v1/v2/v3 package readers and Dexie data are unchanged.
External clients can override display width, cache or download images; no URL
can force those clients or update their saved local copies.

See [API](../api-reference.md), [deployment](../deployment.md),
[testing](../testing.md), and the
[dated implementation/release record](../execution/MESSAGE_MARKDOWN_COPY_2026-10-22.md).
