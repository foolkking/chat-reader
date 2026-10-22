# Original-relative image scale — 2026-10-23

## Approved behavior and design

Owner reading/editing on Web; retain the original and set a whole 1–100% relative
to original dimensions. The same attachment/public URL follows the latest saved
scale. Restore 100% is explicit. No occurrence-specific fork or forced external
CSS/cache behavior. This extends the previously accepted Markdown-copy feature.

Use the established quiet reading-desk system: paper/graphite surfaces, sea-green
actions, inherited application typography, 4px spacing and 44px controls. A
collapsed Image size action lives beside the image, then original dimensions,
labelled percentage, Apply/Restore and target dimensions. Flat border-separated
content avoids a second modal or nested cards. The existing darker link token
supplies readable primary-button contrast; padding/wrapping keeps small-image
controls usable. No new fonts, colors, animations or dependency.

Rejected: a global Settings panel (too far from the affected picture), per-copy
size URLs (violates the stable/latest URL choice), and repeated derivative
resampling (loses original dimensions/detail). The signature is original → target
dimensions with reversible selection, not a new image-editing product.

Loading, stop-waiting, read failure, unknown write and conflict recovery are
inline. An uncertain write requires a read before retry, and authentication/
source changes retire stale work. Saving alone never publishes the picture.

## Implementation

Source-bound `image_display_v1` in existing attachment metadata; existing
`AssetDerivative` rows hold bounded PNGs. Owner GET/PUT use original dimensions
and expected-percentage locking. Shared conversion admission is one operation
per API process. Public reads only resolve precomputed bytes; selected missing
derivatives fail closed. SVG uses the existing validated safe preview; animation
is not silently discarded. No migration: one head `20261022_0053`.
The [current contract](../system/MESSAGE_MARKDOWN_COPY_CONTRACT.md#owner-selected-image-size)
owns all resource, URL and compatibility limits.

## Local validation

- Focused API: **48 passed**, including EXIF, metadata stripping and failure
  preservation. Attachment bundle/integrity/range/renderer/storage/upload plus
  offline asset compatibility: **54 passed**.
- Service-free UX: **1,535 passed, zero skipped**.
- Real Next/API/disposable PostgreSQL browser selection: **26 passed / 1 existing
  opt-in skip**. Covers Reader/Share selection-copy, offline library, attachment
  layout/SVG contracts and 1440/375px inline sizing. A separate rerun verifies
  persisted 25% after reload at both widths (**2 passed**). Initial desktop run
  encountered the local build's API-port mismatch; no product assertion was
  relaxed, and both subsequent runs passed on the isolated API.
- Viewer modal: **12 scenarios passed**; shared table browser: **81 passed**.
  Final lint, nonincremental typecheck, one-worker production build and the full
  selected **26 passed / 1 opt-in skip** browser rerun passed after the
  screenshot-driven padding/contrast correction. Alembic has one 0053 head.

Screenshots use synthetic messages only in the task temporary directory.
Desktop/mobile critique found edge-tight button labels; added system padding,
nonshrinking buttons, wrap and existing contrast tokens. This is a scoped
usability check, not a claim of full-screen WCAG, installed external Markdown
clients, native clipboard or production peak-memory acceptance.

Focused light-theme token calculations: primary text 6.05:1, supporting text
5.08:1 and input outline 6.39:1 against their specified surfaces. This is not
a full dark-mode/zoom/assistive-technology certification. Final synthetic
desktop/mobile screenshots and normalized source/evidence receipts are in
`docs/evidence/image-display-scale-2026-10-23/`.

## Release checkpoint

User authorizes submission and deployment, but requires **50 minutes per CI run
before checking its result**. Implementation is local at this checkpoint.
Complete exact-source five-job CI, independent archive/source verification,
fresh preflight, stopped-writer five-component backup, no-build deployment and
runtime acceptance are still required. Do not infer release success from local
tests or previous release receipts.
