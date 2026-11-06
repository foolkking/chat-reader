# Image previews and reading viewport stability

Source contract updated **2026-11-06**. Candidate implementation; full exact-source
CI is required before acceptance. This is not a production deployment receipt.

## Geometry and saved dimensions

- Single images retain their aspect ratio, fit the reading lane and a maximum
  preview height of `min(70svh, 640px)`. Small image pixels are never enlarged.
  The View target remains usable independently of the image's pixel dimensions.
- Multiple images occupy 4:3 rectangles, with 8px gaps, containing rather than
  cropping/stretching the image. Actual lane width selects one column below
  320px, two below 640px, otherwise three; never more columns than images.
- More than six uses five images plus Overview. A navigation lease for a hidden
  occurrence substitutes that actual image into the fifth slot; it does not
  expand the entire group or substitute another image's DOM ID.
- Trusted source-bound saved dimensions reserve space before decode. An unknown
  single image uses a maximum 320px-wide 4:3 frame, retained across virtual-row
  remounts within the message's reading window. Success/failure/retry do not
  repartition image groups. Controls/captions/errors do not resize their cells.
- Existing 1–100% settings remain. The explicit “Apply reading size” command
  selects the largest integer percentage fitting 640×1600px. Integer half-up
  rounding is `max(1, floor((original * percent + 50) / 100))` on both sides.
  If 1% cannot fit there is no recommendation. This is not a new manual limit.
- Only explicit save/slider commit writes. Reading, copying, window resizing
  and gallery layout do not save percentages. The menu shows original, saved,
  draft and recommended pixels, and retains Restore 100%.
- Same saved dimensions govern single preview and public Markdown image.
  Multi-image cells may further shrink that preview. Existing public image
  URLs still follow latest saved dimensions; external layout is not controlled.
  Originals, Viewer bytes, download and `.cr` are not replaced by grids.

`image-display` source SHA/expected-percentage checks, row locking, conversion
slot and byte/pixel/format safety limits remain. A failed conversion never
silently relaxes those limits. Permission remains distinct: owner can save;
Share, Offline, admin-read and read-only Compare cannot show write controls.

## Offline and canonical copy

Package v3 attachment records optionally carry `image_display_v1`, validated
against the asset SHA, positive bounded integer dimensions and exact rounding.
Unknown/invalid optional dimensions degrade to the stable placeholder, not an
import failure. No Dexie schema change: version 2 and package v1/v2/v3 remain.
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
block is the fallback. These source guards still require full CI acceptance.

Viewer captures its originating scroller and real trigger before modal focus.
Window restoration uses `left/top`; element scrollers restore their own
occurrence without touching the opposite Compare pane. Modal input/return
events do not become reading intent or persistent progress. The Viewer owns
that scroller through the return frame, then releases it for a fresh geometry
anchor; there is no deferred loop restoring a stale scroll position. Initial
and fallback modal focus use `preventScroll`.

Ordinary and heavy messages share image display units and grid estimates.
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
normal/virtual messages, delayed/reordered/failing/retried images, grid sizes,
Viewer return, forward/backward reading, real hidden-occurrence navigation,
saved-size/offline revision isolation and baseline/Compare recovery.

Each stationary case records every animation-frame anchor, mounted count,
scroll coordinate, frame dimensions and compensation source. Required peak
anchor displacement ≤2 CSS px, final ≤1px, fixed image frame change ≤1px.
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
cases and invalid evidence. Existing navigation,
capacity, memory, security, copy and offline gates remain required.

See [execution record](../execution/IMAGE_READING_STABILITY_2026-11-06.md)
for the current verification boundary, and
[Markdown copy](MESSAGE_MARKDOWN_COPY_CONTRACT.md) for publication/security.
