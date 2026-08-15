# PDF.js Maintained Stable-Line Migration Contract

Last updated: 2026-08-16

Current status: `RELEASE_G = PASS`. PDF.js 6.2.108, final CI artifact,
immutable production identities, complete backup, production Chrome
acceptance and retained Release F rollback are closed below.

## Scope And Frozen Boundaries

Release G changes the browser PDF engine only:

```text
pdfjs-dist 3.11.174
-> pdfjs-dist 6.2.108
```

Next `16.3.1`, React/ReactDOM `19.2.8`, Webpack, the unified Attachment
Viewer, authenticated attachment routes, Share scope, offline package v2 and
Dexie v1 remain unchanged. Turbopack, CSP enforcement, PDF editing, OCR,
annotation-editor features and database work are not part of this migration.

```text
BUILD_BUNDLER = WEBPACK
TURBOPACK_MIGRATION = NOT_EXECUTED
NEW_ALEMBIC_MIGRATION = NONE
DEXIE_SCHEMA_MIGRATION = NONE
OFFLINE_PACKAGE_FORMAT_CHANGE = NONE
```

## Official Target And Provenance

The target was resolved independently from the official npm registry and the
Mozilla PDF.js release feed on 2026-08-15. Both identify `6.2.108` as the
current non-prerelease release.

| Field | Final value |
| --- | --- |
| Version | `6.2.108` |
| GitHub release | `https://github.com/mozilla/pdf.js/releases/tag/v6.2.108` |
| npm tarball | `https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.2.108.tgz` |
| npm integrity | `sha512-YxFb+SQcodN2rnX9Tn3dHYlqfb7NjlzzfONPpJd+AKoKtUjEdevTfbC07d5TcczzOK6261auRkP/M8OBHs9vFQ==` |
| Node engine | `>=22.13.0 || >=24` |
| Optional dependency | `@napi-rs/canvas ^1.0.0` |

The workspace lockfile must retain the exact registry integrity. Release
installs continue to disable lifecycle scripts; the browser Viewer does not
need optional native canvas. The package engine raises the current Release G
CI/Web-image build and runtime baseline to Node `22.13.1`. This does not
change the frozen Next or React versions.

## Architecture Before And After

### Before

```text
AttachmentViewerProvider
-> AttachmentViewerShell
-> browser-only dynamic import("pdfjs-dist")
-> GlobalWorkerOptions.workerSrc = pdf.worker.min.js
-> getDocument(authenticated owner/share URL or offline blob URL)
-> canvas renderer
```

PDF.js initialization lived directly in `attachment-viewer.tsx`. The Viewer
destroyed its loading task and cancelled page/thumbnail render tasks during
cleanup. Server owner and Share routes remained the authority for GET/HEAD
and one authenticated byte range.

### After

```text
AttachmentViewerProvider
-> AttachmentViewerShell
-> loadPdfJs() browser runtime boundary
-> modern ESM pdf.mjs
-> same-package pdf.worker.min.mjs
-> getDocument(authenticated owner/share URL or offline blob URL)
-> existing canvas renderer
```

`features/attachments/pdfjs-runtime.ts` is the single worker configuration
point. It caches the module promise and derives the worker URL from the exact
installed package through `new URL(..., import.meta.url)`. The URL is local to
the application release; no worker CDN or external host is permitted.

The Viewer remains one provider, one shell and one portal/dialog. It does not
embed the Mozilla viewer or add PDF editing, scripting, text-layer,
annotation-layer or navigation features that were not already product
capabilities.

## Build And Worker Contract

- `PDFJS_BUILD_VARIANT = MODERN`; imports use the package's ESM build.
- Production continues to run `next build --webpack`.
- The worker must be emitted as a same-origin `.mjs` asset.
- The library and worker must come from the same exact `pdfjs-dist` package.
- A fake-worker fallback, worker version mismatch, external worker URL or
  missing worker response is a release failure.
- Browser-only PDF code must not execute in Server Components or the Node
  runtime.

The production build emits the modern PDF chunk and a local
`pdf.worker.min.*.mjs` asset containing version `6.2.108`. Dedicated
production-build Chromium observes a real Worker event, a successful
same-origin worker response and a rendered nonblank canvas.

## Loading, Range And Cleanup

Owner and Share URLs keep explicit range-friendly PDF.js options:

```text
disableStream = true
disableAutoFetch = true
rangeChunkSize = 64 KiB
```

Offline object/blob URLs do not acquire those network options and remain
cached-only. The server route contract is unchanged: authorization precedes
stat/read; a valid single range returns `206`, `Accept-Ranges` and
`Content-Range`; invalid or unauthorized requests do not bypass Attachment or
Share scope.

The Viewer continues to:

- destroy the PDF loading task/document when the attachment changes or the
  Viewer closes;
- cancel page and thumbnail render tasks;
- isolate malformed/password/transport failures as explicit Viewer error
  states; and
- leave subsequent PDF and non-PDF Viewer sessions usable.

Owner and Share browser paths prove authenticated `206` Range and preserve
scope. Viewer replacement/close tests prove cancellation and cleanup remain
bounded; production Chrome repeated the owner and Share Range paths.

## Security Contract

PDF scripting remains disabled because Chat Reader does not create or attach
a `PDFScriptingManager`. PDF actions must not execute application JavaScript
or broaden external navigation. A controlled malicious fixture must prove no
application-global marker or dialog executes.

PDF.js 6.2.108 no longer exposes the old `isEvalSupported` document option in
its public API. Release G therefore does not hide the removed option behind a
cast. The Release A `isEvalSupported: false` implementation is classified as
`OLD_MITIGATION = OBSOLETE_BY_TARGET_API`; closure instead requires the
maintained version, disabled scripting integration and malicious-file browser
regression.

The final runtime sets `useWasm: false`, so no remote or unversioned Wasm/QuickJS
asset is introduced. CMap and standard-font CDN URLs are not configured.
Ordinary PDF rendering, malformed/truncated handling and the malicious fixture
must pass before this security section can be marked closed.

The former `pdfjs-dist` advisory and optional
`canvas -> node-pre-gyp -> tar` exception records have been removed from the
dependency policy because the old chain is absent. The final dependency-policy
gate reports zero blocked and zero unapproved findings.

## Offline And PWA

Release E remains authoritative:

```text
cached original exists -> PDF may render offline
cached original missing/corrupt -> explicit offline-unavailable/error
offline miss -> no server enumeration, derivative job or Range request
```

The offline shell warm-up now loads the shared PDF runtime and records the
normalized local worker URL in its deterministic asset inventory. The worker
is not fetched from a CDN. Release G must rerun both the default PWA matrix and
the Release E scoped negative matrix with zero scoped skips, including PDF
original/worker miss behavior and false-ready prevention.

## Viewer And Accessibility

The existing product contract remains authoritative:

- one-page PDF defaults to Fit Page and stays centered;
- multi-page PDF retains Fit Width, scrolling, navigation and its existing
  optional thumbnail rail;
- existing zoom controls remain available;
- the shell owns focus trapping, X/backdrop/Escape restoration and body scroll
  lock;
- while maximized, the first Escape exits maximize and the second closes;
- a render/load failure remains visible, bounded, closable and retryable; and
- PDF migration must not affect image, Markdown, CSV, SVG or download-only
  renderers.

## Bundle Contract

PDF.js and its worker are lazy Viewer dependencies. Before a PDF opens, the
Reader/Library initial path must not request or contain the PDF engine or
worker. Opening a PDF may then request the PDF dynamic chunk and local worker.
Benchmark fixtures, malicious fixtures and test fault controls must not enter
the production bundle or PWA precache.

The local build comparison is:

| Artifact | PDF.js 3.11.174 baseline | PDF.js 6.2.108 final |
| --- | ---: | ---: |
| PDF dynamic chunk | 305,261 bytes | 429,398 bytes |
| PDF worker asset | 1,039,505 bytes | 1,180,944 bytes |

These are emitted-file sizes, not initial-route transfer sizes. The PDF chunk
has no intersection with the initial build manifest, and production-build
browser tracing observes neither the PDF dynamic chunk nor worker before a
PDF is opened. Opening a PDF then loads both. Server traces contain no
`@napi-rs/canvas`, `node-pre-gyp` or `tar` chain, and normal production chunks
contain no PWA/PDF test markers.

## Verification Gate

Release G requires all of the following against one frozen source:

```text
locked install
-> lint / typecheck / Next 16 Webpack production build
-> dependency policy / API full suite / Alembic current and single head
-> real-worker PDF browser suite
-> owner + Share authenticated Range
-> single/multi/zoom/navigation/focus/cancellation/error/security
-> offline PDF positive and PDF-specific negative cases
-> default PWA + Release E scoped negative matrix (0 scoped skips)
-> Reader/Rich Markdown/Share/Source Editor/non-PDF Viewer regressions
-> CI image inspection / manifest / checksum
-> immutable production deployment and running-image identity
-> production PDF, Range, offline, CSP and focus acceptance
```

Skipped scoped cases are not PASS. Production must use externally built
immutable images, verify backup and running identities, and retain Release F
as direct rollback. King must not build Next or run broad Docker cleanup.

## Final Evidence

| Evidence | Current status |
| --- | --- |
| Official version/provenance resolution | PASS |
| Package/import/type compatibility checkpoint | PASS |
| Final Webpack build | PASS, Next 16.3.1 with Webpack |
| Modern worker emitted with embedded 6.2.108 | PASS |
| Real worker and canvas browser proof | PASS |
| Owner/Share Range browser proof | PASS |
| Offline PDF and worker-miss proof | PASS, production-equivalent browser |
| Malformed/malicious PDF proof | PASS |
| Default/scoped PWA rerun | PASS: 68/53 conditional; scoped 10/10 with 0 skips |
| Full local quality gate | PASS: lint/type/build; API 280/6; Alembic 20260806_0021; policy 0 blocked/unapproved |
| CI artifact and checksum | PASS, run 31896564657, archive `0d3c460815a562f0e25aab5f0750bc46aa85b5a153ddcb52238018bf7cfeede4` |
| Production backup/deployment/image identity | PASS, complete verified backup and exact manifest match |
| Production Chrome acceptance | PASS, PDF/Range/offline/Viewer/Share/Editor/CSP smokes |

```text
TARGET_PDFJS_VERSION = 6.2.108
PDFJS_OFFICIAL_STABLE = PASS
PDFJS_PACKAGE_PROVENANCE = PASS
PDFJS_BUILD_VARIANT = MODERN
PDFJS_ESM_COMPATIBILITY = PASS
PDF_WORKER_MODE = REAL
PDFJS_LIBRARY_WORKER_VERSION_MATCH = PASS
PDF_SINGLE_PAGE = PASS
PDF_MULTI_PAGE = PASS
PDF_FIT_PAGE = PASS
PDF_FIT_WIDTH = PASS
PDF_ZOOM = PASS
PDF_PAGE_NAVIGATION = PASS
PDF_RANGE = PASS
PDF_AUTH_RANGE = PASS
PDF_SHARE = PASS
PDF_OFFLINE = PASS
PDF_OFFLINE_MISS = PASS
PDF_CORRUPTED_FILE = PASS
PDF_MALICIOUS_SCRIPT = PASS
PDFJS_CVE_2024_4367_PATCHED_BY_VERSION = PASS
PDFJS_EVAL_DISABLED = NOT_APPLICABLE
PDF_SCRIPTING = DISABLED
PDF_CSP_REPORT_ONLY = PASS
PDF_WORKER_CSP = PASS
PDF_WASM_COMPATIBILITY = NOT_APPLICABLE
PDF_CMAP_STANDARD_FONT_COMPATIBILITY = NOT_APPLICABLE
PDF_VIEWER_FOCUS = PASS
PDF_VIEWER_MAXIMIZE = PASS
PDF_RENDER_CANCELLATION = PASS
PDF_RESOURCE_CLEANUP = PASS
PDF_LAZY_LOADING = PASS
PDF_INITIAL_BUNDLE_REGRESSION = PASS
PDFJS_SUPPORTED_LINE = PASS
PDFJS_LEGACY_SECURITY_EXCEPTION = REMOVED
PDFJS_LEGACY_BUILD_CHAIN_EXCEPTION = REMOVED
DEPENDENCY_AUDIT = PASS
PWA_POSITIVE = PASS
PWA_NEGATIVE_MATRIX = PASS
PWA_SCOPED_SKIPS = 0
BUILD_BUNDLER = WEBPACK
TURBOPACK_MIGRATION = NOT_EXECUTED
CSP_ENFORCING = NOT_IMPLEMENTED
DEXIE_SCHEMA_MIGRATION = NONE
NEW_ALEMBIC_MIGRATION = NONE
OFFLINE_PACKAGE_FORMAT_CHANGE = NONE
RUNNING_IMAGE_IDENTITY = PASS
ROLLBACK_RELEASE_F = RETAINED
PRODUCTION_DEPLOYMENT = PASS
RELEASE_G = PASS
```

## Final Closure

One frozen source passed CI and immutable production acceptance:

```text
RUNTIME_SOURCE_COMMIT = 1b752b77063893feefef01756af9deda559f30a5
ACTIONS_RUN = 31896564657 (SUCCESS)
ARCHIVE_SHA256 = 0d3c460815a562f0e25aab5f0750bc46aa85b5a153ddcb52238018bf7cfeede4
API_IMAGE_DIGEST = sha256:d95bb99660f3bafd7e64ef7866e49947797ec26a55328671fdd7afe3044ac331
WEB_IMAGE_DIGEST = sha256:6684742dbe6960d6ee4f4632b61048765407266344685c3fd616bce2e6c848e6
BACKUP = /opt/chat-reader/backups/release-g-20260815T170643Z-1b752b7 (verified)
EXPECTED_RUNNING_IMAGES = manifest API/Web digests above
ACTUAL_RUNNING_IMAGES = exact match for API/worker/migrate/Web
PRODUCTION_CHROME = PASS
ROLLBACK_RELEASE_F = RETAINED (c9ddae1 immutable images and backup)
PRODUCTION_DEPLOYMENT = PASS
RELEASE_G = PASS
```

Production Chrome used synthetic/disposable data and formal product cleanup.
It observed a same-origin real worker, exact library/worker version, nonblank
single/multi canvases, owner/Share `206` Range, Share scope denial, Fit
Page/Width, 110% zoom, page navigation, maximize/Escape/focus, cached-only PDF
offline and reconnect. Production headers/CSP remained within Release A/F
contracts. The malicious and corrupt PDF fixtures were kept in the isolated
production-equivalent suite rather than opened on the production domain.

An exploratory Markdown attachment upload run exposed a pre-existing
upload-placement timing race unrelated to PDF.js. The affected runtime files
are unchanged from Release F. It remains separate follow-up debt and does not
alter this PDF engine contract.

## Deferred Tracks

- CSP enforcement.
- First production cleanup apply and automatic cleanup.
- Worker idle heartbeat.
- Exact Markdown/KaTeX cache telemetry.
- Optional Turbopack migration.
