# Implementation Results

## 2026-08-09 Attachment Inline Layout System Candidate

| Area | Status | Evidence |
| --- | --- | --- |
| Group-level alignment | PASS | `AttachmentInlineGroup` partitions adjacent current-version attachments into one of six semantic lanes; individual `mx-auto`/renderer max-width card geometry was removed |
| Reading/Data lanes | PASS | 45rem/55rem centralized limits, bounded preview body, fade/expand and group-stable headers/footers |
| Image Gallery | PASS | no permanent per-image header; aspect-ratio rows, centred capped last row, full occurrence session and dedicated five-plus-`+N` Overview entry |
| AudioList/FileList | PASS | one group surface, row dividers, 38rem lane, progressive actions; Office/archive/CAD/download-only entries no longer form independent cards |
| Video runtime fallback | PASS | supported video uses the 43rem video lane; codec/decode runtime states re-partition to FileList without mutating static capability |
| Scanner/status contract | PASS | `scanner_disabled/unscanned` remains low-weight `未扫描`; no clean/safe wording or Scanner service change |
| Web lint/typecheck/build | PASS | all required Web commands passed; production build generated 9 routes |
| Focused inline/viewer tests | PASS | 12/12 passed |
| API regression | PASS | 216 passed; 3 skipped and not counted as PASS |
| Alembic | PASS | single head `20260806_0021`; no migration added |
| PWA default matrix | PARTIAL_PASS | 28 passed; 21 conditional online/fixture tests skipped and not counted as PASS |
| Production deployment / visual acceptance | NOT_PRODUCTION_VERIFIED | candidate not yet deployed at this documentation checkpoint |

## 2026-08-09 Conversation Editing, Import Stability And Complex Viewer Addendum

| Area | Status | Evidence |
| --- | --- | --- |
| New conversation | PASS | API and schema tests create a non-empty User -> Assistant pair atomically; Web dialog was typechecked and built |
| Message insertion | PASS | API tests cover before/after, inferred opposite role, User -> Assistant pair, ordering and stale revision 409; Web plus dialog is implemented |
| Message delete/undo | PASS | API tests cover soft delete and restore without Trash; optional revision query is validated; Web confirmation/undo toast is implemented |
| JSON + Markdown pairing | PASS | Unique role/timestamp fast path; real `<EXAMPLES_DIR>` fixture has 398 sections with no empty messages |
| Real fixture preview/commit/retry | PASS | Preview, commit and repeated commit passed in the local API harness; elapsed 17.7 seconds, source fixture is read-only |
| Pairing budget failures | PASS | Candidate/transition/deadline guards return structured 422 rather than generic 500 |
| DOCX/ODT Viewer | NOT_PRODUCTION_VERIFIED | Browser Worker extracts bounded paragraphs/tables; build and static contract tests pass |
| XLSX/ODS Viewer | NOT_PRODUCTION_VERIFIED | Browser Worker exposes bounded read-only sheets/grid; build and static contract tests pass |
| PPTX/ODP Viewer | NOT_PRODUCTION_VERIFIED | Browser Worker exposes bounded static slide navigation; build and static contract tests pass |
| ZIP Viewer | NOT_PRODUCTION_VERIFIED | `fflate` Worker validates central directory and bounded text/image entry previews; no King browser acceptance yet |
| Legacy Office/TAR/EPUB/CAD/3D | NOT_IMPLEMENTED | Reliable authenticated download-only fallback remains intentional |
| Web lint/typecheck/build | PASS | `corepack pnpm run lint`, `corepack pnpm run typecheck`, and `corepack pnpm --filter web build` passed |
| API suite | PASS | `216 passed, 3 skipped`; skipped tests remain disclosed and are not counted as PASS |
| Migration head | PASS | `20260806_0021`; no migration added |
| Production verification for this addendum | NOT_PRODUCTION_VERIFIED | No deployment or production data mutation was performed in this round |

The existing production release entries below are historical evidence and are not upgraded by this local implementation. A King release still requires a backup, CI/external Linux image build, GitHub synchronization, pull, migration preflight and `--no-build` recreation.

## 2026-08-09 Adaptive Viewer Presentation Candidate

| Area | Status | Evidence |
| --- | --- | --- |
| Unified Viewer architecture | PASS | one `AttachmentViewerProvider -> AttachmentViewerShell`; PDF tools mount into the same shell toolbar and do not create a second dialog |
| Presentation resolver | PASS | compact/reading/document/media/workspace mapping is unit-covered; presentation remains transient UI state |
| Desktop adaptive sizing | PASS | compact 720px, reading 1000/1240px, document 1120/1280px, intrinsic media <= 90vw x 90vh, workspace 96vw x 94vh |
| Mobile shell | PASS | every presentation resolves to 100vw x 100dvh below 768px and the overlay has no mobile inset |
| Maximize state machine | PASS | CSS-only 96vw x 94vh maximize; first Escape exits maximize and second Escape closes |
| Single-page PDF | PASS | defaults to Fit Page, page is centered in one non-scrolling PDF viewport, page/fit/zoom tools occupy the shared toolbar |
| Multi-page PDF | PASS | large document presentation, Fit Width/custom scrolling, page navigation and collapsible thumbnail rail implemented |
| Renderer scroll ownership | PASS | Shell viewport is overflow-hidden; Markdown, code, table, PDF and media keep renderer-owned content behavior |
| Focused Viewer tests | PASS | 12/12 presentation/policy/SVG/single-shell tests |
| Web lint/typecheck/build | PASS | all required Web commands passed; production build generated 9 routes |
| API regression | PASS | 211 passed; 1 fixture-gated test skipped and not counted as PASS |
| Alembic | PASS | single head `20260806_0021`; no migration added |
| PWA default matrix | PARTIAL_PASS | 19 passed; 21 online/fixture-gated scenarios skipped and not counted as PASS |
| Production old-layout baseline | PASS | Chrome measured the old single-page PDF shell at about 1844 x 1016 CSS px in a 1920 x 1080 viewport, confirming universal 96vw x 94vh behavior |
| Adaptive production deployment / Chrome | PASS | commit `a89bc28` deployed from Actions run `31294947752` (archive SHA-256 `4d48d4d55c461be318c5ccab2b06eaabeefb11e1c32dcb73b2201aa3d833e5be`); Chrome verified document/reading/media/compact/workspace, maximize/Esc, Fit Page/Fit Width, five viewport classes and mobile 100vw x 100dvh |

The adaptive change does not alter inline attachment layout, Reader width, data models, upload, Files Panel, Share, export, `.cr v4`, Scanner, Range or permissions.

Production backup `/opt/chat-reader/backups/adaptive-viewer-20260809T050228Z-a89bc28` is 378 MiB. Its PostgreSQL custom dump passed `pg_restore --list`; import/export/offline/asset archives passed tar reads and every SHA-256 entry passed. King pulled source before loading prebuilt images, ran migration, and recreated API/worker/Web with `--no-build`; API/Web/PostgreSQL are healthy, worker is running, Alembic is `20260806_0021`, ClamAV is stopped, and Scanner remains disabled.

## 2026-08-09 Attachment Renderer Contract Candidate

| Area | Status | Evidence |
| --- | --- | --- |
| Four-layer state and Registry | PASS | data/capability/runtime/plan are separate; runtime unsupported and failure do not mutate static capability |
| Inline skins and display mode | PASS | only media/preview-panel/file-row are emitted; auto/small/medium/large normalization and width caps are covered |
| Unified Viewer portal | PASS | root Provider owns the single body portal; source assertions cover the portal count and compatibility adapter |
| Occurrence identity propagation | PASS | Reader turn, direct message/block and Offline payloads include messageVersionId + occurrenceKey metadata |
| Image/Markdown/media runtime fallback | PASS | image/text/PDF/media retry issues were corrected; load failure no longer leaves a blank Viewer stage |
| Inert SVG/Markdown path | PASS | SVG uses IMG and attachment paths reject inline SVG/object/embed/window.open; Markdown skips/sanitizes raw HTML and does not auto-load external images |
| Text search / derivative / batch ZIP API | PASS | focused API tests cover capability privacy, stale cursors and distinct business filenames sharing one AssetObject |
| Office/Spreadsheet/Presentation/EPUB/Archive/CAD/3D Viewer | NOT_IMPLEMENTED | reliable authenticated download-only fallback remains the approved behavior |
| Web lint/typecheck/build | PASS | all required commands passed on 2026-08-09; build uses browser PDF.js with optional Node canvas excluded |
| API suite | PASS | 211 passed; 1 fixture-gated test skipped and not counted as passed |
| Alembic | PASS | one head `20260806_0021`; no migration added |
| Attachment policy/SVG/portal tests | PASS | final focused run 7/7 passed, including generic `text/plain` refinement and trusted binary MIME precedence |
| PWA default matrix | PARTIAL_PASS | 13 passed; 21 online/fixture-gated scenarios skipped and not counted as passed |
| Production deployment | PASS | final commit `5baea32` was built by run `31269172465`, archive SHA-256 `55a53e8606ae1e404255729dbb566172913997b3678648e3630b95be73400f6e`, and deployed with migration plus `--no-build` service recreation |
| Production Chrome core Viewer acceptance | PASS | real multi-format conversation verified one body dialog, image Gallery/filmstrip, Markdown Rendered/Source, OBJ/STL/DXF download-only behavior, TIFF non-broken fallback, Esc and scroll restoration |
| Optional/conditional Viewer matrix | PARTIAL_PASS | Offline/PWA conditional scenarios, animation frame enforcement and TIFF converted first-page preview were not fully exercised in production |

Contract approval markers and the implementation/verification boundary are recorded in `docs/system/ATTACHMENT_RENDERER_CONTRACT.md`.

Release backup `/opt/chat-reader/backups/release-20260808T170034Z-254b5bb` is 378 MiB. Its PostgreSQL custom dump passed `pg_restore --list`; SHA-256 manifests cover the dump and all four business-volume archives. Production capabilities report Viewer, Range, derivatives, text search and batch download enabled; scanner provider remains disabled, unscanned use is allowed, and complex preview remains disabled.

## 2026-08-08 Attachment Rendering And Task Checklist Release Candidate

| Area | Status | Evidence |
| --- | --- | --- |
| Attachment presentation policy | PASS | Markdown renders as Markdown; image metadata/download controls, bounded text/code/table previews, TIFF/media failure fallbacks, and download-only complex formats are covered by code policy and focused browser tests |
| Preview workspace UX | PASS | portal/backdrop remains viewport-level while visible panels are type-specific: bounded dark image/video stage, compact audio panel, and bounded document/PDF workspace; focus trap, Esc, backdrop close, scroll lock and restoration remain covered |
| SVG contract | PASS | Reader and preview content use `IMG`; focused tests reject inline SVG/script/object/embed and independent document opening |
| Attachment grouping | PASS | consecutive images/files are grouped with bounded initial item counts and explicit expansion |
| Conversation export projection | PASS | detached Attachments are excluded from conversation CanJSON/Markdown packages; manifest counts are recalculated; system `.cr v4` history remains unchanged |
| Portable hidden filenames | PASS | leading dots are preserved while path confinement and collision handling remain active |
| Interactive task lists | PASS | owner user/assistant tasks toggle immediately; v1 creates v2, v2+ replaces current, refresh persists, conflict rollback is API-covered, and Share remains read-only |
| Web lint/typecheck/build | PASS | required commands passed on 2026-08-08 |
| API suite | PASS | 208 passed; 1 real-fixture test was conditionally skipped and is not counted as passed |
| Alembic | PASS | single head `20260806_0021` |
| PWA baseline | PARTIAL_PASS | 10 passed; 20 online/fixture-gated scenarios skipped by the default matrix and are not PASS |
| Real attachment browser fixture | PASS | 1/1 passed; product import, Markdown attachment rendering, bounded image dialog, SVG DOM, file groups, Share authorization/revocation and hard-delete cleanup completed |
| King incremental deployment | PASS | GitHub Actions run `31242030506` built commit `65585eb`; King verified archive SHA-256 `ef3480b2c0afa3b69ed342e53c602ca5028d523561f7859a196683c0af8ea18d`, used backup `release-20260808T053116Z-4983a8d`, ran migration, and recreated API/worker/Web with prebuilt images only |
| King service and capability checks | PASS | public health and Reader routes return HTTP 200; API/Web/PostgreSQL are healthy, worker is running, Alembic is `20260806_0021`, scanner provider is disabled, unscanned use is allowed, basic preview is enabled, and complex preview remains disabled |
| King Chrome attachment visual acceptance | NOT_PRODUCTION_VERIFIED | the requested Chrome extension was not connected after deployment; no substitute browser was used, so bounded viewer panels, inline attachment presentation, and interactive task toggles still require the requested Chrome click pass |

The large fixture previously duplicated full Share-page hydration and consumed the test timeout after owner assertions. The fixture now verifies Share authorization directly; the dedicated Share UI path remains separately covered. This was a test-scope performance issue, not an attachment content API failure.

## 2026-08-07 Attachment Workflow Release Candidate

| Area | Status | Evidence |
| --- | --- | --- |
| Message save transaction | PASS | uploaded files are finalized before save; message PATCH performs batch ownership validation, current Markdown/version/block/occurrence persistence and pointer update only |
| Derived rebuild | PASS | search, TOC, statistics and summary rebuild is queued only after commit and coalesced per conversation |
| Save response and Reader cache | PASS | response includes message/version/blocks/occurrences/attachment summary; Web replaces the current message and remeasures only its layout |
| Existing Attachment drag | PASS | `application/x-chat-reader-attachment` inserts the existing conversation Attachment at the CodeMirror location without uploading bytes or creating another Attachment/AssetObject |
| Removed reference confirmation | PASS | save-time comparison defaults to keep; detach is refused while another current occurrence exists; historical versions remain readable |
| Conversation file workspace | PASS | desktop floating workspace is unmasked, resizable and geometry-persistent; it coexists with the source editor; mobile retains its overlay panel |
| Structured sidebar DnD | PASS | project order, project receiver, conversation rows/slots and the unclassified header are separate targets; the dedicated E2E moved conversations across projects, reordered, and returned one to unclassified |
| Web lint/typecheck/build | PASS | all three required commands passed on 2026-08-07 |
| API suite | PASS | 205 passed; 1 real-fixture test was conditionally skipped and is not counted as passed |
| Alembic | PASS | single head `20260806_0021` |
| PWA baseline | PARTIAL_PASS | 8 passed; 20 online/fixture-gated tests skipped by the default command |
| Online attachment/Reader/DnD suite | PASS | 11/11 passed with explicit online flags: 5 attachment workflows, paired import, structured DnD, and 4 long Reader restoration scenarios |
| Save p50/p95 on King | NOT_PRODUCTION_VERIFIED | instrumentation is implemented; production measurements require this release candidate to be deployed and exercised on a dedicated test conversation |
| 2026-08-07 King deployment | NOT_PRODUCTION_VERIFIED | current production evidence below describes the previous `af17c93` release until the new commit/image is deployed |

The default PWA command's 20 skipped scenarios and the fixture-gated API test are disclosed separately; they are not PASS. Office/OCR/CAD/complex archive preview remains `NOT_IMPLEMENTED` with authenticated download fallback.

## 2026-08-06 Release

## Status Vocabulary

- `PASS`: executed and passed in the stated environment.
- `PARTIAL_PASS`: the executed subset passed, but a related scenario remains unverified.
- `NOT_PRODUCTION_VERIFIED`: implemented or locally verified, but not verified on King in this release.
- `NOT_IMPLEMENTED`: intentionally outside the completed baseline.
- `FAILED`: executed and failed; the exact failing path is not approved for reuse.
- `BLOCKED`: cannot proceed without an external dependency or decision.

## Local Verification

| Area | Status | Evidence |
| --- | --- | --- |
| Web lint | PASS | `corepack pnpm run lint`; zero warnings |
| Web typecheck | PASS | `corepack pnpm run typecheck` |
| Web production build | PASS | Next.js build; 9 application routes |
| API suite | PASS | 203 passed, 1 fixture-gated skip in the default command; the real attachment fixture module was rerun with `CHAT_READER_E2E_FIXTURE_DIR` and passed 9/9 |
| Alembic | PASS | single head `20260805_0020` |
| PWA baseline | PARTIAL_PASS | 8 passed; 19 online/fixture scenarios conditionally skipped by the default command |
| Attachment/SVG/Share Playwright | PASS | real Bundle fixture: SVG is an `IMG` in Reader and the body-level dialog; focus, scroll lock, Share access and revoke behavior passed |
| Attachment upload Playwright | PASS | 4/4: file selection, exact-position drop, clipboard paste, fenced-code choice, independent drafts, message save, Reader rendering and preserve-as-unplaced close behavior |
| Long Reader Playwright | PASS | 4/4 target mounting, TOC, layout-anchor and annotation restoration scenarios passed |
| Attachment export options | PASS | streaming and background ZIP tests cover description, annotations, notebook and source refs |
| Message version rendering | PASS | API regression proves selecting a version returns its persisted render blocks immediately |

## Real Fixture Baseline

The fixture is read through `CHAT_READER_E2E_FIXTURE_DIR` and packed only in a temporary test directory. Tests do not modify the source fixture or persist its conversation body.

| Metric | Verified |
| --- | ---: |
| Conversations / messages | 1 / 8 |
| Attachment records | 20 |
| Resolved / missing | 19 / 1 |
| Physical objects | 18 |
| Occurrences | 21 |
| Unplaced attachments | 1 |
| Resolved scan state | 19 `scanner_disabled` |

The AI context package contains 18 content-addressed objects and reports partial asset completeness. The portable Markdown ZIP contains 19 business attachment paths, rewrites links to relative paths, and contains no `cr-asset://` URI.

## King Production Acceptance

| Area | Status | Evidence |
| --- | --- | --- |
| Incremental deployment | PASS | GitHub Actions run `31083578130` built the Linux images for commit `af17c93`; King pulled the same commit, verified artifact SHA-256 `918dc9a3121e8d83dd917839b55b778e53a9c3b8d303937624124dab9650cd17`, loaded the images, ran migration, and recreated API/worker/Web without an on-host build |
| Migration and capabilities | PASS | production head `20260805_0020`; scanner disabled, unscanned allowed, basic preview enabled, complex preview disabled |
| Attachment Bundle import | PASS | checksum-scoped fixture imported once; expected 1/8/20/19/1/18/21/1 statistics verified |
| Reader attachment rendering | PASS | Chrome observed 20 attachment blocks, 3 inline images in the loaded view and 6 inline text previews after hydration |
| Full-page attachment preview | PASS | Chrome verified the dialog is a direct `body` child, equals the viewport, locks body scrolling and displays the original image endpoint |
| SVG attachment preview | PASS | Production Chrome verified inline SVG uses one `IMG`; the body-level dialog content also uses one `IMG`, with no inline SVG/script/object/embed/iframe; focus trap, Esc, backdrop close, scroll restoration and trigger focus restoration passed |
| Export secondary options | PASS | Chrome exposed description/annotations/notebook/source-ref controls; generated manifest recorded `true/true/false/true` for the selected options |
| Failed task dismissal | PASS | two stale failed cards were closed; reload kept them hidden in the same browser profile |
| CanJSON/Markdown packages | PASS | context and portable Markdown ZIP counts, hashes, relative links and completeness were inspected on King |
| Structured sidebar DnD | PASS | dedicated synthetic conversation moved into a project and back to unclassified; reload preserved placement |
| Share attachment scope | PASS | user-confirmed production E2E: allowed image/text/media preview and download worked; out-of-scope ID access was rejected; revocation invalidated attachment access |
| Ordinary attachment upload from API | PASS | production upload session/finalization created a `scanner_disabled` conversation attachment |
| Ordinary attachment upload through Chrome | PASS | user-confirmed production E2E: file selection -> upload session -> conversation attachment -> message version/Reader -> refresh -> download/export |
| Message version immediate attachment rendering in Chrome | NOT_PRODUCTION_VERIFIED | deployed and API-covered; hidden hover-only version control could not be activated reliably through the browser bridge |
| System `.cr v4` export | PASS | production archive generated and contents inspected; no secret/config/cache paths present |
| System `.cr v4` restore | PASS | user-confirmed empty-instance production-equivalent restore: projects, conversations, versions, attachments/objects, annotations, notebook, source refs, placement/order, hashes, derived rebuild and Reader opening passed |
| Acceptance data cleanup | PASS | fixture and synthetic conversations hard-deleted; synthetic project archived because the product has no project-delete endpoint |
| GitHub/server synchronization | PASS | Application source and deployed image source resolve to `af17c93b344947f3d58bb7af0a77bb40a35a27fe`; King backup `release-20260806T081207Z-af17c93` contains PostgreSQL and four business-volume archives, and the pre-sync server worktree remains recoverable in `stash@{0}` |

## Production Incident

| Event | Status | Result |
| --- | --- | --- |
| Build Web image on the 2 GiB King host | FAILED | Even with the 418 MiB worker stopped, `next build` caused the kernel to kill the PostgreSQL checkpointer |
| PostgreSQL recovery | PASS | Container stayed running, WAL recovery completed, health returned, and a post-recovery custom dump passed `pg_restore -l` |
| Future deployment method | REQUIRED | Build Linux images in CI/an independent host and deliver through a registry or `docker save/load`; do not compile Web on King |

## Scanner and Content Policy

- The current deployment actively disables attachment malware scanning and content security review.
- Attachments remain usable in the explicit `scanner_disabled`/`unscanned` state; the Chinese UI displays “未扫描”, never clean/safe or “已通过扫描”.
- This is an accepted policy for the current single-user deployment and does not mean that any file passed a security check.
- Object status, byte size, SHA-256, storage-key confinement and authenticated content routes remain enforced.

## Deliberate Limits

| Capability | Status | Fallback |
| --- | --- | --- |
| Office conversion/inline preview | NOT_IMPLEMENTED | Authenticated download |
| OCR | NOT_IMPLEMENTED | Original file download |
| CAD preview | NOT_IMPLEMENTED | Original file download |
| Complex archive browsing/conversion | NOT_IMPLEMENTED | Authenticated download |
| Local ClamAV on the 2 GiB King host | NOT_IMPLEMENTED | `DisabledScanner`; optional remote scanner later |
| Full online Playwright matrix in default PWA command | PARTIAL_PASS | Conditional tests require running API and explicit fixture flags |
