# Natural image sizing and reading viewport stability

Source contract updated **2026-11-07**; new implementation awaits exact-source CI.
It supersedes the previous fixed-cell geometry, not its reading-stability gates.
The deployed `9cf235f` / CI `42217357688` remains a separate historical acceptance:
[release receipt](../execution/IMAGE_READING_STABILITY_RELEASE_2026-11-06.md).
No deployment is authorized here. Synthetic CI is not authenticated production
UI or physical-device acceptance.

## Geometry and saved dimensions

- Original geometry and the owner's saved percentage are separate. Optional
  `image_geometry_v1` contains only source SHA and orientation-corrected original
  width/height. It is not a saved size, derivative or public capability.
  New authorized/scanned uploads/imports inspect bounded headers; raw imports
  cannot assert reserved geometry or saved-display metadata.
- Existing owner/Share/admin **single-attachment** detail reads may inspect
  missing geometry, without database writes. Lists, complete turns and offline
  generation only carry existing geometry, never scan all historical files.
  Inspection rejection leaves existing original access intact.
- Visible online images deduplicate reads with at most four geometry requests
  in flight. Cache identity includes access scope, SHA and authentication
  generation. Browser decode is a session-only fallback; offline uses its own
  snapshot and never issues these online reads.
- Saved pixels use `max(1, floor((original * percent + 50) / 100))`.
  Body width is `min(saved width, lane width)` and height is proportional.
  Default 100% and explicitly saved 100% have identical layout. Unknown sources
  start at 320×240 but normalize when geometry arrives; no frozen unknown frame.
- Multi-image flow preserves source order and requested widths, wrapping with
  an 8px gap, centered rows and top alignment. No fixed columns, 4:3 cells,
  stretching or height-driven width reduction. In a 720px lane, two 300px
  images share a row; two 500px images do not. Legacy small/medium/large fields
  remain readable but no longer add hidden size limits.
- More than six uses five images plus Overview. A navigation lease for a hidden
  occurrence substitutes that actual image into the fifth slot; it does not
  expand the entire group or substitute another image's DOM ID.
- A ratio of at least 2:1 and displayed height above `min(70svh, 640px)` folds
  the image's lower content, never its width. Expand/collapse controls sit below
  the image. Expansion uses body scrolling and survives virtual remounts in
  query-client session memory, scoped to authority/source/real occurrence.
  Collapse preserves the shared live anchor; a reading point in the hidden
  portion explicitly navigates to the actual image start.
- Media has no permanent gray backing, rounded crop or decorative padding.
  Captions and error/retry actions are outside its reserved geometry; failure
  does not repartition the image run. Image pixels remain 32×24 when appropriate;
  only the interaction container has a 44px minimum. Fitted images disclose the
  lane limit. Different percentages above the lane width need not change the
  screen width.
- Explicit preview retry immediately remounts/loads that occurrence even if it
  has moved offscreen. HTTP retry uses a fresh query marker while retaining the
  scoped original path/parameters; local Blob URLs remain unchanged. Ordinary
  image loading stays lazy. Retrying neither saves dimensions nor publishes.
- Image-only attachment paragraphs reuse span-only image UI. Prose-inline,
  linked and table images retain document semantics and shared dimensions:
  no figure/div in paragraphs and no buttons nested inside links. Native images
  are inline-block with no global max-height cap; their line boxes and actual
  aspect ratios, not only width attributes, are part of the contract.

`image-display` source SHA/expected-percentage checks, row locking, conversion
slot and byte/pixel/format safety limits remain. A failed conversion never
silently relaxes those limits. Permission remains distinct: owner can save;
Share, Offline, admin-read and read-only Compare cannot show write controls.

## Controls and temporary viewing

Size and View actions are below media; under 240px they become one persistent
44px Image options entry. A root-portal 320px size panel captures its opening
anchor, avoids Reader rails and stays in the viewport; under 640px it becomes
a safe-area-aware bottom sheet. Existing focus/closing mechanisms return to the
live trigger with `preventScroll`, never scroll to find a retired trigger.

Slider movement and numeric drafts change only the panel. Release commits once;
presets commit once; numeric Enter/blur deduplicate. Percentages remain 1–100,
with 25/50/75/100 stops and 100 labelled Original. “Fit current column” saves
a concrete integer, not an automatic mode. The panel distinguishes original,
draft-selection and currently displayed body pixels. Existing conversion bounds
still constrain the fit suggestion; they are not enlarged to satisfy a target.
Folded images distinguish full body dimensions from the currently visible area.
Moving from a number draft to a preset, range or column-fit choice is one
final-choice transaction, including touch compatibility mouse events and keyboard
focus hand-off. Leaving the editing controls/Enter still commits the number.
Unconfirmed edits never continue to claim the previous selection was saved.

Shared attachment/source/auth/access-authority-scoped pending state prevents duplicate writes.
Closing during submission does not cancel or undo the server write. Success
updates all owner references. An uncertain network/server result blocks writes
until an explicit read-only Check result; it never automatically resends.
Conflict, limits, unsupported formats and busy conversion have separate messages.
Saving updates prior public URLs but does not publish an image.
Read-only controls neither inherit owner write recovery nor call the owner-only
size endpoint; switching authority remounts local editor state. Compare may read
the same owner's confirmed size without acquiring the ability to save/check writes.

The existing Viewer and react-zoom-pan-pinch use intrinsic image pixels as the
transform base. Original 1:1 means one image pixel per **CSS pixel**, not physical
screen pixels. Fit to window uses actual canvas dimensions; Fit to width starts
at the top. Fit modes do not upscale small images. Manual zoom does not save.
Canvas controls/navigation are outside image content, with 44px targets, a
narrow-screen mode selector and explicit mobile thumbnails. Desktop thumbnails
remain visible by default. Light/dark/checker backgrounds inspect transparency
without changing exported bytes. The image shell is viewport-sized and does not
follow image decode or zoom. Download actions identify the unchanged original.
Known-image entry points supply a presentation-only hint before the scoped
attachment read. The same image session retains that shell while the next image
is pending. This hint supplies no content, query data or authorization.

## Offline and canonical copy

Package v3 attachment records optionally carry `image_display_v1` and
`image_geometry_v1`, validated
against the asset SHA, positive bounded integer dimensions and exact rounding.
Unknown/invalid optional dimensions use a temporary placeholder and can fall
back to local decode, not an import failure. No Dexie schema change: version 2
and package v1/v2/v3 remain.
An actual saved-size change atomically increments the conversation's offline
revision. Existing offline copies retain their package snapshot until a normal
explicit update; online query data cannot override it. Embedded Markdown
occurrences receive the same source-bound dimensions.

Markdown copying continues to fetch full canonical content; five visible slots
are not the source of message-copy Markdown. Every occurrence retains stable
message/block/occurrence IDs and the rendered-block registry for selection.

## Compensation ownership

`reading-viewport.ts` is the shared geometry owner per physical scroller, with
reference-counted mounted messages and a ResizeObserver. It holds a real block
or occurrence, preferably a real text Range at the reading line. It compensates
actual layout displacement after subtracting intervening user scrolling. It
does not repeatedly restore an old scrollTop. Scalar correction events contain
only delta/applied pixels, never conversation content.
Discrete image fold/size/error-recovery commits invoke that same owner's
reconciliation from the layout effect, before the next animation-frame sample.
ResizeObserver remains the owner of later asynchronous geometry, but is not a
substitute for commit-time correction of a multi-thousand-pixel collapse.
The handoff retains busy/retired-owner checks and never creates a second
image-specific restoration loop.

Explicit navigation/restoration claims the existing navigation position lease;
ordinary geometry yields. Virtual-list automatic size adjustments and the old
Reader geometry loop yield to the same owner. Wheel, touch, relevant keys and
pointer actions invalidate an older position lease. Layout flags distinguish
programmatic corrections from user intent and reading-position writes.

Reader preference/surface transitions claim layout ownership only when a real
DOM anchor exists. A single frame writer performs their corrections; an
identified preference event cannot be completed by an older event or an
unrelated anonymous surface event. A suspended settle observer rechecks its
token after every frame. New reading input/navigation retires that transition;
completion releases ownership before virtual pins and immediately hands the
actual geometry to the shared viewport owner. Code tokenization must not turn
a live Range's collapsed/reparented endpoints into a different text anchor:
the original node/character endpoints must still match, otherwise the real
block is the fallback. These guards passed the exact-source CI above.

Viewer captures its originating scroller and real trigger before modal focus.
Window restoration uses `left/top`; element scrollers restore their own
occurrence without touching the opposite Compare pane. Modal input/return
events do not become reading intent or persistent progress. The Viewer owns
that scroller through the return frame, then releases it for a fresh geometry
anchor; there is no deferred loop restoring a stale scroll position. Initial
and fallback modal focus use `preventScroll`.

Ordinary and heavy messages share image display units and natural-flow estimates.
Measured row caches survive ordinary image/content resize; width/font/density
changes may remeasure. Code tokenization retains the same inline newline/blank
line geometry as fallback. Late Mermaid/content height changes are covered by
the scroller owner. Independent Compare scrollers never compensate each other.
Natural-flow virtual rows cache their real mounted height even while TanStack
is in scrolling mode, before they can leave the range and become a spacer.
The shared ref/explicit-measurement adapter retains normal observer cleanup,
updates only the affected row and never writes scroll or clears other sizes.
This prevents a row's estimate/actual gap from oscillating at a range boundary
as the explicit layout owner compensates its real DOM anchor.
Compare's explicit section navigation aligns within 1px of its 24px inset;
the shared navigator's legacy default tolerance and visible physical-endpoint
exception remain intact. Compare releases its navigation flag and rebases the
geometry owner before releasing the virtual target pin, including cancellation.

## Required evidence

`reading-stability` is a required release browser gate, not optional evidence.
The synthetic matrix covers Reader/Share/Offline/Compare, 375/1440px,
normal/virtual messages, delayed/reordered/failing/retried images, actual sizes,
Viewer return, forward/backward reading, real hidden-occurrence navigation,
saved-size/offline revision isolation and baseline/Compare recovery.

Each stationary case records every animation-frame anchor, mounted count,
scroll coordinate, frame dimensions and compensation source. Required peak
anchor displacement ≤2 CSS px, final ≤1px, known media geometry change ≤1px.
Missing legacy geometry may normalize once rather than retain a wrong frame.
Directional samples inspect both the real anchor and scroll coordinate, not
only the final screenshot. Each of the 16 matrix entries also retains a
full-frame Viewer open/close trace with the same peak/final displacement
limits (64 required traces total). A failed case retains any partial trace.
Viewer sampling starts only after an explicit positioning action puts the real
trigger centre outside sticky-header occlusion. A hit-tested physical click,
not a forced/DOM click or an auto-scrolling locator retry, then opens it.
Scalar pointer/focus/scroll events and modal/ownership frames are retained;
the full opening/closing interval still obeys the same peak/final limits.
Fresh Reader readiness does not invent a navigation transaction; Offline
network isolation starts only after canonical messages and all source-bound
fixture assets exist in its own package/cache. Lazy offscreen images are not
misreported as broken because no request has begun; controlled visible images
must decode successfully, not merely report `complete`.
`verify-reading-stability.mjs` rejects missing traces, missing cases, skipped
cases and invalid evidence. At least 35 cases include seven natural-flow cases
for actual 300/500px image widths, 607/608px wrap boundaries, default/saved 100%,
virtual long-image folding, intrinsic Viewer modes, tiny/transparent images,
semantic Markdown and 375/800/1440px panels. Synthetic PNGs contain bitmap text,
diagram blocks, table lines and optional transparency, not just solid colors.
The genuine never-configured legacy fixture is created only in guarded CI's
loopback disposable database; it does not save 100% before testing the default.
Four surfaces each retain three additional collapse traces (12 total): surviving
anchor ≤2px peak/≤1px final, hidden point explicitly aligned to image start at
120px, and real immediate wheel not overwritten by stale restoration. The
intentional hidden-point jump is retained in evidence, not called stationary.
Every trace also records the opposite Compare scroll position. A separate cold
Viewer panel trace spans delayed detail reads and next-image loading; public
PNG checks prove full long-image output and stable URL identity after resizing.
The mounted control browser gate covers themes/locales and trusted mouse,
touch, keyboard, cancellation and uncertain writes. Existing navigation,
capacity, memory, security, copy and offline gates remain required.

See [execution record](../execution/IMAGE_NATURAL_FLOW_2026-11-07.md)
for the current verification boundary, and
[Markdown copy](MESSAGE_MARKDOWN_COPY_CONTRACT.md) for publication/security.
