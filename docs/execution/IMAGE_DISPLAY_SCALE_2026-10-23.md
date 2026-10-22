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

- Focused API: **50 passed**, including EXIF, metadata stripping and failure
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

### First CI and bounded follow-up

Feature commit `d134d02969ebc13e3101a74c4f62e231f0dc9c7e` was pushed and run
`39829506577` dispatched at **2026-10-22 18:13:50 UTC**. Its earliest result-read
gate was **19:03:50 UTC**; the actual read at **19:04:48 UTC** respected it.
API/settings jobs passed; Web stopped at official npm dependency audit, so
build/independent artifact jobs were skipped. No deployable images were accepted
and no production operation occurred.

During that wait, resource review found raster size-reading reached Pillow before
the encoded-byte check. The follow-up checks both stored and actual file length
before header/EXIF inspection, including GET and 100% saves. Two new tests prove
Pillow is never invoked for either over-limit source and the last saved selection
is retained. The desktop/mobile browser test injects one explicit HTTP 413 and
checks original-access instructions, disabled saves and successful read recovery;
normal sizing continues against real Next/API/PostgreSQL.
The Apply action also accepts the unchanged percentage after a successful read:
this makes initial 100% explicit and exposes same-size derivative repair instead
of forcing an artificial 50→49→50 change. Unknown writes still require a read
before another save. Both viewport tests cover unchanged 100% and 50% application.

The blocked advisories require Next **16.4.1**; a fresh official audit also requires
DOMPurify **3.4.17**. Only those existing dependency families and their lock
entries change. No audit exception or severity threshold changes. Local official
policy reports **zero unapproved findings / zero policy errors**, retaining the
existing tested braces patch and reporting the lower-severity KaTeX/PostCSS
findings. The dependency patch regressions pass **9 tests**. A new full CI and
fresh 50-minute wait are required after the final local reruns.

### Small-image View target

An additional browser assertion reproduced a real accessibility regression:
at 50% of the synthetic 20px original, the View button was only **10px wide**
at both 1440px and 375px. Its wrapper now has a 44px minimum width/height;
the bitmap remains 10px (and the public URL remains 10px), so this does not
enlarge the selected image. The new DOM assertion stays in the complete
Markdown/image browser gate. This repair requires another exact-source CI;
no result from the previous source may substitute for it.

### Second CI: search history race

Source `30f5a26aba2c2b49a6633cbad2e79765da85a9a1` ran as `39839236789`.
Dispatch was **2026-10-22 19:20:39 UTC**, result-read gate **20:10:39 UTC**,
actual read **20:10:39 UTC** (after the precise receipt deadline). API/settings passed;
Web passed dependency audit but failed the search-history assertion in the
Source Editor/mutation gate: **99 passed / 1 failed**. No image was accepted
or deployed from this run.

Ten ordinary local repeats passed, but a counting-only history probe with
Chrome's 6× CPU slowdown reproduced the original failure **4 of 5** times:
the URL returned to the previous query while the input retained `NEW`.
Back can overtake the pending query render, so `initialQuery` never changes
and its effect cannot reset the draft. A same-query filter-history traversal
with an unsubmitted draft also failed deterministically before repair.

The existing SearchBox now restores its draft from the current URL on
`popstate`, clears keyboard selection and removes its listener on teardown.
The original immediate-Back assertion is retained; the browser gate additionally
checks same-query Back/Forward restoration. No sleep, retry, assertion removal,
new router abstraction, dependency or visual-token change is introduced.
The repaired source passes lint, nonincremental typecheck and production build.
Starting the rebuilt local Web was rejected by the execution tool policy, so
post-repair search browser acceptance is explicitly deferred to the next full
CI, not inferred from the earlier ten ordinary passes. The image-only
44px repair had already passed the complete selected browser suite
(26 passed / 1 existing opt-in skip) before this search-only change.
