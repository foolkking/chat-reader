# Implementation Results

## Release K residual verification reconciliation - 2026-08-16

```text
RELEASE_K = BLOCKED
BLOCKER_CLASS = VERIFICATION_TOOLING_CAPABILITY
PRODUCT_DEFECT = NOT_ESTABLISHED
RELEASE_A_J = PASS
CURRENT_PRODUCTION_AUTHORITY = VERIFIED
PRODUCTION_RUNTIME_SOURCE = 7bcd686b59d62fb9907ba09d644637b7af2b3d86
CURRENT_REPOSITORY_HEAD = fcb55ffd09c246f1714992e108802259ee185cd7
CI_AUTHORITY = 31936666151 / success / 81fb441f51984330042625aac4dabddfd78b0ebc
ARTIFACT_ID = 9260977100 / present / unexpired
RUNNING_IMAGE_IDENTITY = PASS
ALEMBIC_HEAD_CURRENT = 20260806_0021
CANDIDATES_DISCOVERED = 40
SUPERSEDED_OR_ALREADY_CLOSED = 19
DEFERRED_BY_DESIGN = 8
CONDITIONAL_FUTURE_TRACK = 6
CURRENT_VERIFICATION_DEBT = 7
UNKNOWN_UNRESOLVED = 0
REAL_BROWSER_ZOOM_125 = NOT_VERIFIED
REAL_BROWSER_ZOOM_150 = NOT_VERIFIED
REAL_BROWSER_ZOOM_200 = NOT_VERIFIED
ACCESSIBILITY_ZOOM_SIGNOFF = BLOCKED
RUNTIME_SOURCE_CHANGED = NO
TEST_TOOLING_CHANGED = NO
PRODUCTION_REDEPLOY_REQUIRED = NO
NEXT_RELEASE = RELEASE_L_NOT_STARTED
```

The current production containers and OCI labels independently match Release I
runtime source and immutable image IDs; public health is 200 and Alembic remains
at the single current head. The status scan was reconciled by evidence
precedence rather than by treating every historical `PARTIAL_PASS` as current.
PWA negative paths, Source Editor upload atomicity, manual cleanup apply,
Next/PDF.js maintained lines, CSP enforcement, Share focus and production file
chooser are closed by Releases F-J.

Seven current production evidence records remain: native Chrome page zoom at
125%, 150% and 200%; Mermaid rendering; and the document, spreadsheet and
presentation browser-Worker Viewers. The Chrome browser skill is present, but
its required JavaScript control tool is not exposed and no browser MCP resource
is available. Its explicit-browser rule prohibits substituting standalone
Playwright, device emulation, CSS zoom or another desktop surface. Consequently
the product was not exercised at native zoom, no screenshots were claimed, and
Release K cannot be promoted to PASS.

## Release J cleanup first-apply closure - 2026-08-16

```text
RELEASE_J = PASS
RUNTIME_SOURCE_CHANGED = NO
PRODUCTION_REDEPLOY_REQUIRED = NO
PRODUCTION_RUNTIME_SOURCE = 7bcd686b59d62fb9907ba09d644637b7af2b3d86
TEST_EVIDENCE_COMMIT = 81fb441f51984330042625aac4dabddfd78b0ebc
ACTIONS_RUN = 31936666151 (success, exact test/evidence SHA)
CLEANUP_FOCUSED_LOCAL = PASS (32 passed / 1 Windows symlink capability skip)
LINUX_CLEANUP_MATRIX = PASS (0 scoped skips)
PRE_CLEANUP_BACKUP = /opt/chat-reader/backups/release-j-precleanup-20260816T081840Z-7bcd686
BACKUP_VERIFIED = PASS
GRACE_WINDOW = 24 hours
DRY_RUN_A_B_STABLE = PASS
APPROVED_CATEGORY = ORPHAN_FINAL
APPROVED_CANDIDATES = 4 / 659673 bytes
FIRST_APPLY = PASS
DELETED = 4 / 659673 bytes
FAILED = 0
RECHECK_SKIPPED = 0
ALREADY_ABSENT = 0
POST_APPLY_ELIGIBLE = 0
IDEMPOTENCY = PASS (old tokens: deleted 0 / skipped 4 / failed 0)
BUSINESS_ATTACHMENT_DELETED = 0
ASSET_OBJECT_DELETED = 0
CANONICAL_REFERENCED_ARTIFACT_DELETED = 0
ACTIVE_JOB_ARTIFACT_DELETED = 0
SUCCESSFUL_RETAINED_EXPORT_DELETED = 0
CURRENT_OFFLINE_ARTIFACT_DELETED = 0
SHARE_REQUIRED_OBJECT_DELETED = 0
PRODUCTION_PUBLICATION_SMOKE = PASS
PRODUCTION_QA_CLEANUP = PASS (product API / 404 readback)
PRODUCTION_HEALTH = PASS
ALEMBIC_HEAD_CURRENT = 20260806_0021
AUTOMATIC_CLEANUP = DISABLED
ASSET_OBJECT_GC = NOT_IMPLEMENTED / NOT_ENABLED
```

The first production apply used only the four opaque identities stable across
two dry-runs plus a final pre-apply scan. The engine performed its normal fresh
DB/filesystem classification before every unlink. The exact apply result was
four requested, four deleted, `659,673` bytes, zero failures and zero skipped.
Both post-apply scans had no eligible objects; replaying the old tokens was a
bounded no-op.

Canonical table counts and file integrity were identical before and after the
apply. Production Chrome then published and downloaded a disposable `.cr`
Export, and a targeted classifier proved its committed DB/job/file state was
protected and absent from candidates. Product API cleanup returned 404 for the
QA Conversation. The resulting recent final file remains protected by the
24-hour grace window; Release J did not run a second cleanup or enable a
schedule. Runtime/image identity is unchanged from Release I.

## Release I upload-token atomicity closure - 2026-08-16

```text
RELEASE_I = PASS
READY_FOR_RELEASE_J = YES
SOURCE_EDITOR_UPLOAD_TOKEN_ATOMICITY = PASS
EDITOR_GUARD = IMPLEMENTED
SAVE_TIME_CANONICAL_VALIDATION = PASS
API_TRANSIENT_REFERENCE_REJECTION = PASS
API_CANONICAL_REFERENCE_ACCEPTANCE = PASS
AUTHORITATIVE_EDITOR_DOCUMENT = CodeMirror EditorView.state.doc
UPLOAD_NETWORK_COMPLETE_SEPARATED_FROM_EDITOR_READY = PASS
FILE_CHOOSER_UPLOAD_ATOMICITY = PASS
DRAG_DROP_UPLOAD_ATOMICITY = PASS
CLIPBOARD_UPLOAD_ATOMICITY = PASS
MULTI_UPLOAD_OUT_OF_ORDER = PASS
PARTIAL_UPLOAD_FAILURE = PASS
UPLOAD_RETRY_IDEMPOTENCY = PASS
DELETE_PLACEHOLDER_BEFORE_COMPLETION = PASS
CANONICALIZATION_UNDO_SAFETY = PASS
CURSOR_SELECTION_SCROLL_STABILITY = PASS
REVISION_AND_NETWORK_FAILURE_DRAFT_RETENTION = PASS
ATTACHMENT_OCCURRENCE_INTEGRITY = PASS
BACKEND_FOCUSED_TESTS = PASS (15 passed)
API_FULL_SUITE = PASS (285 passed / 5 skipped)
BROWSER_ATOMICITY_E2E = PASS (18 passed / 0 scoped skipped)
UPLOAD_ATOMICITY_SCOPED_SKIPS = 0
FOCUSED_BROWSER_REGRESSION = PASS (36 passed)
CSP_BROWSER = PASS (4 passed)
SHARE_BROWSER = PASS (2 passed)
MUTATION_BROWSER = PASS (2 passed)
VIEWER_BROWSER = PASS (1 passed)
PDF_BROWSER = PASS (3 passed)
PWA_DEFAULT = PASS (72 passed / 65 unrelated conditional skipped)
PWA_NEGATIVE_MATRIX = PASS (10 passed / 0 scoped skipped)
ALEMBIC_HEAD = 20260806_0021
ALEMBIC_CURRENT = 20260806_0021
DEPENDENCY_POLICY = PASS
SECURITY_HIGH_CRITICAL = PASS (0 high / 0 critical)
NEW_RUNTIME_DEPENDENCIES = NONE
NEW_ALEMBIC_MIGRATION = NONE
DEXIE_SCHEMA_MIGRATION = NONE
OFFLINE_PACKAGE_FORMAT_CHANGE = NONE
BUILD_BUNDLER = WEBPACK
TURBOPACK_MIGRATION = NOT_EXECUTED
PRODUCTION_FAULT_BRIDGE = ABSENT
RUNTIME_SOURCE_COMMIT = 7bcd686b59d62fb9907ba09d644637b7af2b3d86
ACTIONS_RUN = 31934088629 (success, exact source SHA)
ARCHIVE_SHA256 = dd082f902e4c84cb2a1466735da80dd2659119f087518703b98838b2f66c04f8
API_WORKER_MIGRATE_IMAGE = sha256:e7800d1a86f9973db3642add2f3236e721846f9d4426f74da54e7da0b0f0b8ea
WEB_IMAGE = sha256:dae7507d89a66ffc086cc3971e2de57907af2781279c19f3f480b35031d66654
RUNNING_IMAGE_IDENTITY = PASS
PRODUCTION_DEPLOYMENT = PASS
PRODUCTION_REAL_FILE_CHOOSER = PASS (3 independent runs)
PRODUCTION_UPLOAD_SAVE_RELOAD = PASS
PRODUCTION_CANONICAL_SOURCE = PASS
PERSISTED_TRANSIENT_REFERENCE_COUNT = 0 (post-deploy aggregate audit)
DATA_REPAIR_REQUIRED = NO
ROLLBACK_RELEASE_H = RETAINED
FINAL_DOCUMENTATION_ONLY = TRUE
RUNTIME_IMAGE_UNCHANGED = TRUE
```

The original defect allowed upload finalization to mark a draft ready while
the React text mirror read by Save could still contain a transient token. A
first immutable production candidate then exposed a narrower pre-CodeMirror
ordering: a real chooser event queued before lazy CodeMirror creation, marker
insertion updated only `text`, and the post-create controlled-value effect
restored the baseline `editorDocument`. The final runtime synchronizes both
mirrors from the exact live document after marker insert, canonical replacement
and explicit removal. `I-RACE-002A` deterministically holds the lazy editor
chunk and upload finalize response to prove this ordering.

The live CodeMirror document is the save authority, every save path rescans it,
and FastAPI independently rejects active transient Markdown destinations with
structured 422 rollback. Actions run `31934088629` passed the full quality and
image chain on exact SHA `7bcd686...`. The independently verified release
archive, complete backup and immutable image identities are recorded above.

King migration used the exact API image and recreation used `--no-build`.
Running API/worker/Web image identities match the manifest; API/Web/PostgreSQL
are healthy, the worker runs, Scanner remains disabled and Alembic remains
`20260806_0021`. Production Chrome passed three real chooser/save/reload flows,
canonical API readback, attachment Viewer, zero legitimate-path CSP violations
and isolated PWA offline/reconnect. Product-API cleanup returned 404 for every
QA Conversation. The final aggregate source-aware audit found zero active
transient references in all and current MessageVersions. Release H images and
backup remain direct rollback.

## Release H CSP enforcement closure - 2026-08-16

```text
CSP_RESOURCE_INVENTORY = PASS
CSP_POLICY_AUTHORITY = PASS
CSP_ENFORCING_HEADER = PASS (production)
CSP_ENFORCING = PASS (production)
CSP_REPORT_ONLY_SHADOW = NOT_USED
CSP_REPORT_ONLY = ABSENT
CSP_SCRIPT_UNSAFE_EVAL = ABSENT (production)
CSP_SCRIPT_UNSAFE_INLINE = RETAINED_WITH_EVIDENCE (script-src-elem)
CSP_STYLE_UNSAFE_INLINE = RETAINED_WITH_EVIDENCE
STRICT_SCRIPT_CSP_STRATEGY = CURRENT_ARCHITECTURE_CONSTRAINED
STRICT_NONCE_CSP = DEFERRED_WITH_ARCHITECTURE_EVIDENCE
NEXT_EXPERIMENTAL_SRI = NOT_EXECUTED
TRUSTED_TYPES = NOT_EXECUTED
CSP_DEFAULT_SRC = PASS
CSP_CONNECT_SRC = PASS
CSP_IMG_SRC = PASS
CSP_FONT_SRC = PASS
CSP_MEDIA_SRC = PASS
CSP_WORKER_SRC = PASS
CSP_MANIFEST_SRC = PASS
CSP_OBJECT_SRC = PASS
CSP_BASE_URI = PASS
CSP_FRAME_ANCESTORS = PASS
CSP_FORM_ACTION = PASS
SERVICE_WORKER_CSP = PASS
PDF_WORKER_CSP = PASS
PDF_REAL_WORKER = PASS
PDF_WASM_CSP = NOT_APPLICABLE (useWasm=false)
KATEX_FONT_CSP = PASS
OFFLINE_CSP = PASS
SHARE_CSP = PASS
CSP_EXTERNAL_SCRIPT_BLOCK = PASS
CSP_EXTERNAL_CONNECT_BLOCK = PASS
CSP_EXTERNAL_WORKER_BLOCK = PASS
CSP_FRAME_EMBED_BLOCK = PASS
CSP_INLINE_INJECTION_BLOCK = POLICY_LIMITED
CSP_SCOPED_SKIPS = 0
PWA_POSITIVE = PASS (72 passed / 53 unrelated conditional skipped)
PWA_NEGATIVE_MATRIX = PASS (10 passed / 0 scoped skipped)
PWA_SCOPED_SKIPS = 0
BUILD_BUNDLER = WEBPACK
TURBOPACK_MIGRATION = NOT_EXECUTED
NEW_ALEMBIC_MIGRATION = NONE
DEXIE_SCHEMA_MIGRATION = NONE
OFFLINE_PACKAGE_FORMAT_CHANGE = NONE
CSP_SERVER_REPORTING = NOT_IMPLEMENTED
CI_RELEASE_ARTIFACT = PASS
RUNNING_IMAGE_IDENTITY = PASS
LATEST_TAG_IS_NOT_RELEASE_AUTHORITY = TRUE
ROLLBACK_RELEASE_G = RETAINED
PRODUCTION_CSP_BLOCK_PROBES = PASS
PRODUCTION_CSP_LEGITIMATE_PATHS = PASS
PRODUCTION_CSP_VIOLATIONS = 0
PRODUCTION_READER_RICH_MARKDOWN = PASS
PRODUCTION_VIEWER_PDF_RANGE = PASS
PRODUCTION_SOURCE_EDITOR_MUTATION = PASS
PRODUCTION_MOBILE_SHARE_390 = PASS
PRODUCTION_PWA_OFFLINE_RECONNECT = PASS
RELEASE_A_REGRESSION = PASS
RELEASE_B_REGRESSION = PASS
RELEASE_C_REGRESSION = PASS
RELEASE_D_REGRESSION = PASS
RELEASE_E_REGRESSION = PASS
RELEASE_F_REGRESSION = PASS
RELEASE_G_REGRESSION = PASS
PRODUCTION_DEPLOYMENT = PASS
RELEASE_H = PASS
```

The application policy is now enforcing in the production build. Its
allowlist is tied to observed same-origin resources plus the narrow Shiki
`'wasm-unsafe-eval'`, Mermaid data-image, and Offline/Viewer blob requirements.
Production `'unsafe-eval'`, wildcard/scheme sources, data fonts, blob workers,
external CDNs, duplicate Report-Only policy and a reporting endpoint are not
present.

Production-build Chromium proves real blocking with `4/4` scoped tests and zero skips.
The controlled loopback origin receives no forbidden script/connect/image/
object requests; browser events have `disposition=enforce`; a blob worker and
cross-origin parent frame are blocked. Legitimate local/data/blob images,
inline layout styles, manifest and Service Worker remain available. Rich
Markdown additionally proves real Shiki tokens, KaTeX/MathML, sanitized
`javascript:`/script payloads and zero legitimate-path CSP violations.

PWA negative is `10/10` with zero scoped skips, including the new synthetic
503 CSP assertion. Default PWA is `72/53 conditional`. Focused Reader/Rich/
Security is `36/36`; PDF owner/Share real worker and Range are `3/3`; the
Markdown and image unified Viewer is `1/1`; Source Editor and mutation are
`2/2`; final Share focus is `2/2`, with a separate three-run `6/6` repeat.
Final Actions run `31906595581` on
`da160a9c9a34dfe670fc67262cf3c8c9eedba07a` passed locked install,
lint/typecheck/Next `16.3.1` Webpack build, Release C `30/30`, full API
`282 passed / 4 skipped`, Alembic, dependency policy, CSP `4/4`, focused
browser/security `36/36`, Share `2/2`, Source Editor/mutation `2/2`,
Markdown/image Viewer `1/1`, PDF `3/3`, default PWA `72 passed / 53 unrelated
conditional skipped`, and scoped PWA negative `10/10` with zero scoped skips.
The quality job gated the successful image/inspect/package job.

The independently verified release archive SHA-256 is
`abb3f48ce6ab833fa9abb222a304b8c26ac42c458ab232e94789acbc3e0b32c5`.
The manifest API/worker/migrate identity is
`sha256:a8604d1518a623eacc5171171d1105ff2eeb84f0371e93a3535f36a9d9264ba1`;
Web is
`sha256:0f37153f34d86fe514f0e58a14bf8f7a358e9f0975dbad64d3f529cc97915c66`.
Running API, worker and Web match these identities after immutable commit-tag
binding and `--no-build` recreation.

Backup `/opt/chat-reader/backups/release-h-20260815T204036Z-da160a9` passed
`pg_restore --list`, all four business-volume archive listings, and independent
SHA-256 verification. Production has exactly one enforcing application policy,
no Report-Only header, no `X-Powered-By`, and all Release A headers. Isolated
Chrome passed real forbidden-resource blocking, Reader/Rich Markdown,
Source Editor mutation/reload, Markdown/image Viewer, PDF real worker/nonblank
canvas/authenticated `206` Range, desktop and 390x844 Share focus, and PWA
offline/reconnect, with zero legitimate-path CSP violations. Final QA cleanup
used the product API and left zero Release H disposable Conversations.

An exploratory direct Source Editor upload reproduced the pre-existing
upload-token replacement race already recorded by Release G. It is not caused
by CSP and the user's overlapping uncommitted editor fix was preserved rather
than folded into Release H. Release G immutable images and backup remain direct
rollback. `RELEASE_H = PASS`.

## Release G PDF.js maintained-line closure - 2026-08-16

```text
TARGET_PDFJS_VERSION = 6.2.108
PDFJS_OFFICIAL_STABLE = PASS
PDFJS_PACKAGE_PROVENANCE = PASS
PDFJS_SUPPORTED_LINE = PASS
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
PDFJS_EVAL_DISABLED = NOT_APPLICABLE (option removed from target public API)
PDF_SCRIPTING = DISABLED
PDF_CSP_REPORT_ONLY = PASS
PDF_WORKER_CSP = PASS
PDF_WASM_COMPATIBILITY = NOT_APPLICABLE (useWasm=false)
PDF_CMAP_STANDARD_FONT_COMPATIBILITY = NOT_APPLICABLE
PDF_VIEWER_FOCUS = PASS
PDF_VIEWER_MAXIMIZE = PASS
PDF_RENDER_CANCELLATION = PASS
PDF_RESOURCE_CLEANUP = PASS
PDF_LAZY_LOADING = PASS
PDF_INITIAL_BUNDLE_REGRESSION = PASS
PDFJS_LEGACY_SECURITY_EXCEPTION = REMOVED
PDFJS_LEGACY_BUILD_CHAIN_EXCEPTION = REMOVED
DEPENDENCY_AUDIT = PASS (0 blocked / 0 unapproved)
PWA_POSITIVE = PASS (68 passed / 53 conditional skipped)
PWA_NEGATIVE_MATRIX = PASS (10 passed / 0 scoped skipped)
PWA_SCOPED_SKIPS = 0
READER_REGRESSION = PASS
RICH_MARKDOWN_REGRESSION = PASS
MOBILE_SHARE_REGRESSION = PASS
SOURCE_EDITOR_REGRESSION = PASS
VIEWER_NON_PDF_REGRESSION = PASS
RELEASE_A_REGRESSION = PASS
RELEASE_B_REGRESSION = PASS
RELEASE_C_REGRESSION = PASS
RELEASE_D_REGRESSION = PASS
RELEASE_E_REGRESSION = PASS
RELEASE_F_REGRESSION = PASS
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

Official npm and Mozilla GitHub release sources both resolve stable
`pdfjs-dist 6.2.108`. The npm tarball is
`https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.2.108.tgz`; integrity is
`sha512-YxFb+SQcodN2rnX9Tn3dHYlqfb7NjlzzfONPpJd+AKoKtUjEdevTfbC07d5TcczzOK6261auRkP/M8OBHs9vFQ==`.
Its Node engine requirement (`>=22.13.0 || >=24`) caused the narrow CI/Web
image baseline update to Node `22.13.1`; Next `16.3.1`, React `19.2.8` and
Webpack remain frozen.

The final runtime centralizes the browser-only PDF.js module and local modern
worker, updates PDF.js 6 canvas render calls, preserves explicit authenticated
Range loading for owner/Share URLs, and adds the worker to offline shell asset
inventory. No worker CDN, PDF scripting manager, Dexie/Alembic migration or
offline package change was introduced. The target API no longer accepts the
legacy `isEvalSupported` option; the candidate uses the maintained package,
keeps scripting disabled and sets `useWasm: false`.

Before/after emitted artifacts are 305,261 -> 429,398 bytes for
the PDF dynamic chunk and 1,039,505 -> 1,180,944 bytes for the worker. These
remain lazy artifacts: the PDF chunk has no initial-manifest intersection and
the production-build browser observes no PDF chunk or worker before opening a
PDF. Current-source lint/typecheck/build pass; API is `280 passed / 6 skipped`;
Alembic current/head is the single `20260806_0021`; dependency policy has zero
blocked or unapproved finding.

Final CI evidence is source `1b752b77063893feefef01756af9deda559f30a5`,
Actions run `31896564657`, archive SHA-256
`0d3c460815a562f0e25aab5f0750bc46aa85b5a153ddcb52238018bf7cfeede4`,
API/worker/migrate image
`sha256:d95bb99660f3bafd7e64ef7866e49947797ec26a55328671fdd7afe3044ac331`
and Web image
`sha256:6684742dbe6960d6ee4f4632b61048765407266344685c3fd616bce2e6c848e6`.
The workflow passed API `282/4`, focused browser `38/38`, maintained-PDF
`3/3`, default PWA `68/53 conditional`, and scoped negative `10/10` with zero
scoped skips before building images.

King independently verified the archive and complete backup
`/opt/chat-reader/backups/release-g-20260815T170643Z-1b752b7`, then used
immutable `API_IMAGE`/`WEB_IMAGE`, Alembic preflight and `--no-build` service
recreation. Expected and actual running API/worker/migrate/Web identities
match exactly. API/Web/PostgreSQL are healthy, worker is running, Scanner is
disabled, `/api/health` returns `200`, and Alembic remains `20260806_0021`.

Isolated production Chrome passed real version-matched worker and same-origin
asset loading, nonblank single/multi canvas, authenticated owner/Share `206`
Range, Share denial outside scope, Fit Page/Width, 110% zoom, page navigation,
maximize/Escape/focus, cached PDF offline through a real service worker,
offline-to-online recovery, Rich Markdown/KaTeX/MathML, image/Markdown unified
Viewer, Source Editor type/backspace, and desktop/mobile Share focus. CSP
Report-Only monitoring found no unexplained PDF worker/Wasm violation; Release
F immutable images remain retained as direct rollback.

An exploratory opt-in Markdown attachment upload flow exposed a pre-existing
placement race where a transient `cr-upload://` reference can reach save
before canonical replacement. The relevant runtime files are byte-identical
to Release F, the required Source Editor regression passed, and Release G did
not alter this path. It remains separately disclosed follow-up debt rather
than being misattributed to the PDF engine migration.

## Release F Next 16 final closure - 2026-08-15

```text
NEXT_ACTIVE_LTS = PASS (local candidate)
TARGET_NEXT_VERSION = 16.3.1
REACT = 19.2.8
REACT_DOM = 19.2.8
BUILD_BUNDLER = WEBPACK
TURBOPACK_MIGRATION = NOT_EXECUTED
ASYNC_REQUEST_APIS = PASS
CACHE_SEMANTICS = PASS
NEXT_RUNTIME_SECURITY_EXCEPTION = NONE
NEW_ALEMBIC_MIGRATION = NONE
DEXIE_SCHEMA_MIGRATION = NONE
PRODUCTION_PWA_FAULT_BRIDGE = ABSENT
FINAL_BROWSER_REGRESSION = 38 passed / 0 failed
PWA_POSITIVE = PASS (68 passed / 50 unrelated conditional skipped)
PWA_NEGATIVE_MATRIX = PASS (9 passed)
PWA_SCOPED_SKIPS = 0
CI_RELEASE_ARTIFACT = PASS
PRODUCTION_DEPLOYMENT = PASS
RUNNING_IMAGE_IDENTITY = PASS
ROLLBACK_RELEASE_E = RETAINED
RELEASE_F = PASS
```

The current worktree local gates passed locked install, lint, typecheck,
`next build --webpack`, API `280 passed / 6 skipped`, Alembic
`20260806_0021` single head and the official-registry dependency policy with
zero unapproved exceptions. The focused browser gate was rerun after the
async request/ref fixes: Rich Markdown/KaTeX/MathML, Viewer, Reader
restoration, security headers/CSP-equivalent checks, stabilization and
desktop/mobile Share all passed (38 tests, 0 failures). The first Reader run
was environment-incomplete because the isolated worker was absent; the
Reader suite was then rerun with that worker and passed 8/8.

The current-worktree default PWA matrix passed 68 tests with 50 unrelated
conditional skips. The dedicated Release E negative build passed 9/9 with
zero scoped skips. Normal production chunks were scanned directly and contain
neither the PWA test fault bridge nor benchmark fixtures; the negative-only
build and its temporary dist directory were not retained as runtime output.

The final source commit is `c9ddae1e9cd5c94c406f357a152304105e6d20b0` and the
release workflow is Actions run `31887198941` (SUCCESS). The externally built
archive is `739435634b6a4ebe52597d9db6887c3599c10a6fb5441f1032b01981923e5b84`.
API/worker/migrate use
`sha256:4856d1a275c178418d2495dc0cd2b67cf9d94fe660c5100d7d4a84c5b2af0f9a` and
Web uses `sha256:d7ac14aa3c3f2955e109c6cd933cf3ac350992e0fe99b93071507674a4790670`.
King recomputed the archive hash and matched the manifest before loading the
images. The verified Release F backup is
`/opt/chat-reader/backups/release-f-final-20260815T134803Z-c9ddae1`; its
PostgreSQL custom dump, four business archives, listings and checksums passed.

Production used the explicit Release F compose file with immutable
`API_IMAGE`/`WEB_IMAGE` tags and `--no-build`; the running container IDs match
the manifest exactly. API/Web/PostgreSQL are healthy, worker is running,
Scanner is disabled and Alembic remains `20260806_0021`. Actual production
headers preserve the Release A contract and `X-Powered-By` is absent. The
isolated production Chromium smoke passed shell/SW offline and reconnect,
Reader KaTeX/MathML, 390x844 Share single-dialog/Escape/focus, mutation and
Source Editor, attachment Viewer, and a disposable PDF Viewer canvas. All QA
Conversation cleanup used the product API. Release E immutable images remain
available for direct rollback. A production CSP Report-Only listener observed
zero violations on `/library` and Reader; enforcing remains intentionally
unimplemented.

## Release E PWA Negative Matrix & Offline Resilience - 2026-08-15

```text
PWA_RUNTIME_CHUNK_MISS = PASS
PWA_SHELL_CRITICAL_CACHE_MISS = PASS
PWA_SHELL_UPDATE_ATOMICITY = PASS
OFFLINE_ATTACHMENT_MISS = PASS
OFFLINE_VIEWER_MISS = PASS
PWA_QUOTA_EXHAUSTION = PASS
PWA_QUOTA_RECOVERY = PASS
OFFLINE_PACKAGE_INTERRUPTION = PASS
OFFLINE_PACKAGE_RESTART_RECOVERY = PASS
OFFLINE_PREVIOUS_PACKAGE_PRESERVATION = PASS
OFFLINE_RETRY_IDEMPOTENCY = PASS
OFFLINE_RECONNECT = PASS
OFFLINE_NETWORK_FLAPPING = PASS
OFFLINE_CORRUPTED_CACHE = PASS
OFFLINE_FALSE_READY_PREVENTION = PASS
PWA_NEGATIVE_MATRIX = PASS
MOBILE_SHARE_SINGLE_DIALOG_REGRESSION = PASS
RELEASE_A_REGRESSION = PASS
RELEASE_B_REGRESSION = PASS
RELEASE_C_REGRESSION = PASS
RELEASE_D_REGRESSION = PASS
DEXIE_SCHEMA_MIGRATION = NONE
NEW_ALEMBIC_MIGRATION = NONE
RUNTIME_CHANGES = IMPLEMENTED
PRODUCTION_DEPLOYMENT = PASS
RELEASE_E = PASS
```

Release E closes the scoped browser-side PWA negative matrix using a
test-instrumented production build with real Cache Storage, Service Worker,
IndexedDB, offline network state, Chromium quota override and an isolated
persistent browser profile. The scoped matrix currently passes 9/9 with no
Release E conditional skips. The default PWA baseline remains
The prior default PWA baseline was 67 passed / 50 skipped; the current full
local run is 68 passed / 50 skipped because it includes the normal-bundle
fault-bridge assertion added in Release E. Those skipped flows are unrelated
conditional fixture/production-copy paths and remain separate from PASS.

The final runtime source is
`1591fd9bdab3d12d7928f6421845173cb1b1b81e`; Actions run `31874712687`
passed the complete release gate. The externally built archive SHA-256 is
`ff07fdab24d729b173f3f1abc9facfe730f5ec88ea6a326445c64d3f1b633f1d`.
API/worker/migrate image digest is
`sha256:f360fefd4a4881e695bfb5a1a6a81f2f096adfbd2149981ca0191caaac6808f8`;
Web image digest is
`sha256:f1d33ca458b3a2e6af249796972399c281feffce831eac00c4babadf9e2ed35f`.
King recomputed the archive checksum and validated backup
`/opt/chat-reader/backups/release-e-20260815T084805Z-1591fd9` before migration
preflight and `--no-build` recreation.

Production health is PASS: API/Web/PostgreSQL are healthy, worker is running,
Scanner is disabled, and Alembic current/head remains `20260806_0021`.
Production Chromium used an isolated profile under the approved external cache
root. The shell had 75 critical resources with zero misses; offline Library
reload and reconnect returned HTTP 200 at 390px with no overflow or CSP
violation. Read-only Reader QA produced 22 blocks, 10 KaTeX nodes and 10 MathML
nodes without page overflow or page errors. Mobile Share kept one dialog and
restored focus to More after one Escape. No production fault injection or
business-data mutation was performed.

The runtime fix preserves the existing product contracts: Offline remains
cached-only; offline package v2/v3 read/write compatibility is unchanged; Dexie
schema is unchanged; missing cached attachments and Viewer resources become
explicit unavailable states; failed updates preserve the last committed package.
Normal production bundles do not expose the test-only PWA fault bridge.

## Release D Performance & Capacity Characterization - 2026-08-15

```text
PERFORMANCE_ENVIRONMENT = PASS
READER_398 = PASS
READER_1000 = PASS
READER_10000 = WARNING
READER_MATH_CACHE = PASS
READER_VIRTUALIZATION_BOUND = PASS
READER_SCROLL_STABILITY = PASS
MOBILE_SHARE_SINGLE_DIALOG_REGRESSION = PASS
IMPORT_398 = PASS
IMPORT_1000 = PASS
IMPORT_10000 = WARNING
IMPORT_FEW_HUGE = WARNING
IMPORT_MEMORY_BUDGET = PASS
EXPORT_CAPACITY = WARNING
CR_V4_EXPORT_CAPACITY = PASS
CR_V4_RESTORE_CAPACITY = PASS
POSTGRES_QUERY_BASELINE = PASS
DATABASE_INDEX_REQUIRED = NO
WEB_BUNDLE_BASELINE = PASS
PERFORMANCE_OPTIMIZATION_REQUIRED = NO
PERFORMANCE_OPTIMIZATION_CHANGES = NONE
RELEASE_A_REGRESSION = PASS
RELEASE_B_REGRESSION = PASS
RELEASE_C_REGRESSION = PASS
NEW_ALEMBIC_MIGRATION = NONE
RUNTIME_CHANGES = NONE
PRODUCTION_DEPLOYMENT = NOT_REQUIRED
RELEASE_D = PASS
```

The final source was `da0a79fd116b7a26e30bf2d1f57b1ff658a758f7` and Actions run
`31865404393`. The final run used a deterministic seed/version in an isolated
Linux/PostgreSQL/Chromium stack. Reader virtualization stayed bounded at 398,
1k and 10k; no OOM, data-integrity failure, blank window or page overflow was
observed. The 10k and few-huge warnings are capacity boundaries, not normal UX
guarantees. No core algorithm or runtime image changed, so no deployment was
performed. Exact math cache hit/miss is not derivable from the current
test-only probe; the bounded working-set and frame/long-task budgets passed.
The 10k Markdown export warning and few-huge import warning are detailed in the
dated evidence report.

## Release C superseding production closure - 2026-08-15

```text
RELEASE_B_PRODUCTION_FOCUS_CLOSURE = PASS
REQUEST_ID = PASS
STRUCTURED_API_LOGGING = PASS
SENSITIVE_LOG_REDACTION = PASS
JOB_METRICS = PARTIAL_PASS
ARTIFACT_METRICS = PASS
STORAGE_AGGREGATES = PASS
INTERNAL_DIAGNOSTICS_IMPLEMENTATION = PASS
INTERNAL_DIAGNOSTICS_PRODUCTION = NOT_ENABLED
CLEANUP_CLASSIFIER = PASS
CLEANUP_DRY_RUN = PASS
CLEANUP_RECHECK = PASS
CLEANUP_MANUAL_APPLY = NOT_EXECUTED
AUTOMATIC_CLEANUP = DISABLED
ASSET_OBJECT_GC = NOT_IMPLEMENTED
RELEASE_A_REGRESSION = PASS
RELEASE_B_REGRESSION = PASS
NEW_ALEMBIC_MIGRATION = NONE
RELEASE_C = PASS
```

The final runtime is commit `e58b750357d92bba314737582a94493829c038e2` from
Actions run `31856041473`. The externally built archive SHA-256 is
`023c2eb4bea5e216c323a457454a627a3d4a72e7c4b9a99361f1501e59ed8a71`; API/
worker/migrate is `sha256:58868488dacf5722c3b12cc50cd191532067384e507dbb7d4a043672ff96570b`
and Web is
`sha256:f814e1a2ac2c1d6df5aa9fc9418d9a7c42f57f9bb7472cb41b467df5fde0cea6`.
The verified backup is
`/opt/chat-reader/backups/release-c-mobile-focus-20260815T013334Z-e58b750`.

The production 390x844 Chrome regression showed two mobile Vaul sheets could
remain mounted during More -> Share, so the first Esc closed the wrong sheet.
`e58b750` immediately unmounts inactive sheets and restores the logical More
trigger on every mobile utility close path. Focused desktop/mobile E2E passed,
and a final production read-only smoke observed one Share dialog, one Esc,
zero dialogs and focus on the More button. No production business data was
written.

Production health, worker, Scanner-disabled state, Alembic head and actual
security headers passed. Public diagnostics is still 404 by design. King has
only current/latest Chat Reader image tags after exact old-tag cleanup; the
verified backup and release archive were retained, and no volume or user data
was deleted. The prior Release C `ORPHAN_FINAL=4` baseline versus the current
stable `3 / 655,810 bytes` remains an explicitly unresolved candidate-set
change; no cleanup apply was inferred or executed.

## Release C bounded-diagnostics follow-up - verification-only (2026-08-14)

The current source `6c50e740449a9186f7f2121e6b9280be7a9801de` contains the
deployed Release C commit as an ancestor. A real query-budget gap was closed in
`artifact_lifecycle.py`: diagnostics now snapshots the bounded filesystem and
performs path/job-ID scoped reference lookups in chunks of 500 instead of
loading all historical artifact/job rows. Artifact publication, cleanup
eligibility, database schema and user contracts are unchanged; no production
redeploy was needed for this verification-only change.

Current results: artifact/diagnostics subset `21 passed / 1 skipped`; full API
`280 passed / 6 skipped`; Web lint/typecheck/production build PASS; Alembic
heads/current `20260806_0021 (head)`. The Windows symlink path-escape test is
the single skip and is not counted as PASS. Build cache was kept under
`C:\Users\86182\Desktop\wkkk\next-build-release-c`.

## Release C Production Closure - 2026-08-14

### Executive result

```text
RELEASE_B_PRODUCTION_FOCUS_CLOSURE = PASS (manual operator production Chrome Share focus evidence)
REQUEST_ID = PASS
STRUCTURED_API_LOGGING = PASS
SENSITIVE_LOG_REDACTION = PASS
JOB_METRICS = PARTIAL_PASS (idle worker heartbeat is not independently derivable)
ARTIFACT_METRICS = PASS
STORAGE_AGGREGATES = PASS
INTERNAL_DIAGNOSTICS_IMPLEMENTATION = PASS
INTERNAL_DIAGNOSTICS_PRODUCTION = NOT_ENABLED
CLEANUP_CLASSIFIER = PASS
CLEANUP_DRY_RUN = PASS
CLEANUP_RECHECK = PASS
CLEANUP_MANUAL_APPLY = NOT_EXECUTED
AUTOMATIC_CLEANUP = DISABLED
ASSET_OBJECT_GC = NOT_IMPLEMENTED
RELEASE_A_REGRESSION = PASS
RELEASE_B_REGRESSION = PASS
NEW_ALEMBIC_MIGRATION = NONE
RELEASE_C = PASS
```

### Final deployment evidence

- Runtime source: `8d0ad66d65bb069176970ea814d9a6b08e04322c`.
- GitHub Actions: `31789905868`, complete quality/build/inspect/package/checksum chain PASS. The earlier `31778569056` candidate is superseded; its first quality-gate failure remains preserved evidence that no image artifact is published after a failed browser quality step.
- Artifact SHA-256: `577594e63ed351de39cdfb56c02e385bff1ef0bbfe90285ddd9d0441aaabedd7`.
- API/worker/migrate image: `sha256:dfc11cda21f78ce77b9b451e886689f97842e1929a6e6618bfcaf8626a312c2a`.
- Web image: `sha256:69d228b578c35626f37577102afcbd7ad40c7e61191edafe6e14747379ab38b6`.
- Verified backup: `/opt/chat-reader/backups/release-c-final-20260814T100144Z-8d0ad66`.
- Production: API/Web/PostgreSQL healthy, worker running, Scanner disabled, Alembic current/head `20260806_0021`.
- Final CI counts: Release C focused `30 passed`; API `282 passed / 4 skipped`; focused browser `28 passed`; default PWA `67 passed / 37 skipped`. Skips are conditional/fixture paths and are not counted as PASS.

### Production request and diagnostics evidence

The public `/api/health` response returned 200 and a server-owned UUID v4 `X-Request-ID`; the controlled public diagnostics request returned 404 with its own UUID. Both IDs correlated to one `api_request_completed` structured log event. The synthetic query marker never appeared in logs and raw Uvicorn access-log lines were absent. This was reverified after fixing the production logger handler/level gap discovered during the first post-deploy check.

The diagnostics CLI returned aggregates only. It reported jobs `committed=130, failed=3, cancelled=1`, imports `committed=31, failed=2, previewed=14`, no stale/retry-exhausted items, bounded recent timing samples, and storage aggregates without content/filename output. The HTTP diagnostics route remains disabled/not enabled pending gateway proof.

### Cleanup evidence

Release B baseline was `ORPHAN_FINAL=4 / 659,673 bytes`, `SAFE_TEMP=0`, `SUPERSEDED_ARTIFACT=0`, `UNSAFE_PROTECTED=29 / 236,546,674 bytes`. Release C ran the classifier twice in production dry-run mode. Both runs were identical: `ORPHAN_FINAL=3 / 655,810 bytes`, `SAFE_TEMP=0`, `SUPERSEDED_ARTIFACT=0`, `UNSAFE_PROTECTED=30 / 236,550,537 bytes`, scan complete. Release B did not preserve opaque candidate identities and Release C did not delete artifacts, so the aggregate change is disclosed as an unresolved candidate-set change rather than treated as a safe deletion. No production cleanup apply was approved or executed.

Only exact superseded Chat Reader image tags (`1d366fb`, intermediate `2d2ad36`) and the two verified release-transfer directories were removed after final health. Current `8d0ad66`, direct rollback `32a980b`, all business volumes, PostgreSQL, backups and `.env.production` were retained.

### Remaining debt

- `INTERNAL_DIAGNOSTICS_PRODUCTION = NOT_ENABLED` until reverse-proxy/VPN protection is independently evidenced.
- `CLEANUP_MANUAL_APPLY = NOT_EXECUTED`; stable ORPHAN_FINAL candidates remain pending separate operator approval.
- `AUTOMATIC_CLEANUP = DISABLED`; `ASSET_OBJECT_GC = NOT_IMPLEMENTED`.
- Next supported LTS migration, PDF.js supported-line migration, CSP enforcing, PWA negative matrix and dedicated Reader/Import/.cr performance benchmark remain separate tracks.

## Release C Observability and Safe Cleanup (implementation, 2026-08-14)

Release B closure is now `PASS` based on the operator's manual production Chrome verification of Share Drawer Esc/X/backdrop/remounted-trigger focus restoration. It is explicitly manual user evidence, not a browser-bridge automation claim.

Release C implements server-owned request IDs, redacted route-template request logs, lifecycle events, aggregate diagnostics, bounded storage scans, explicit cleanup grace, opaque two-pass candidate tokens and per-object final rechecks. Diagnostics is disabled by default; automatic cleanup and AssetObject GC remain disabled. No schema or user artifact format changes were made.

The existing production dry-run was repeated twice before code changes and remained `ORPHAN_FINAL 4 / 659,673 bytes`, `SAFE_TEMP 0`, `SUPERSEDED_ARTIFACT 0`, `UNSAFE_PROTECTED 29 / 236,546,674 bytes`. Nothing was deleted. Local results: focused `28 passed / 1 skipped`, full API `279 passed / 6 skipped`, Web lint/typecheck/production build PASS, Alembic `20260806_0021`, default PWA `67 passed / 37 conditional skipped`. Skips remain separate from PASS. CI artifact, deployment and final production diagnostics/dry-run are pending.

## Release B Artifact Integrity Closure (production, 2026-08-14)

- Offline and asynchronous Export ZIP builders stage, validate, publish a unique final file, commit via the worker-owned transaction, and clean old files only after commit. Uncommitted files are cleanup debt, never canonical state. Import automatic stale recovery is bounded at three attempts.
- The first final workflow was correctly blocked by a PWA assertion that accepted the recovery wording only in a paragraph although the valid failed-update state renders it in a span. The assertion now follows accessible status text without changing product behavior.
- Production QA then exposed a PostgreSQL-only `.cr` defect: `DISTINCT` over an Attachment entity required equality for its JSON metadata. SQLite had hidden it. Attachment enumeration now starts from the conversation-owned Attachment table and uses a correlated historical-occurrence predicate, preserving active-unreferenced and historically referenced detached files. CI executes the exact query against PostgreSQL.
- Final run `31736593196`, source `32a980bb7cc6ab5a30dc2b3a47d6f6c19acfa8da`: API `265 passed / 4 skipped`, focused browser `28 passed`, default PWA `67 passed / 37 skipped`, and all Release A gates PASS. SHA-256 `aa1bd95a4567be87c43d5e86a5bd17602d738402b37bef7922ca93d87f8b4088`; API digest `sha256:14478427325f395be4d54ce6cccb2fdcff8de7fcf97503a547e11cd57c4696aa`; Web digest `sha256:0f544a7c39c735a84d59b81b4d08abb5cd7061f8f41c613f74ef72b4a59062e4`.
- Production deployment/health and Offline A/B, `.cr` immediate download, archive sanity and Import smoke PASS. Verified backup: `/opt/chat-reader/backups/release-b-final-20260813T194413Z-32a980b`. QA Conversations were removed through the API; the committed QA ImportRecord/source artifact remains under normal product retention.
- Dry-run only: `SAFE_TEMP 0`, `SUPERSEDED_ARTIFACT 0`, `ORPHAN_FINAL 4 / 659,673 bytes`, `UNSAFE_PROTECTED 29 / 236,546,674 bytes`. No artifact was deleted. Image cleanup retained current `32a980b`, rollback `1d366fb` and `latest`.
- Share focus production-equivalent E2E PASS for initial focus, containment, Esc, X, backdrop and remounted-trigger fallback. The operator subsequently confirmed the same Esc/X/backdrop/remounted-trigger behavior in manual production Chrome; this is user-provided production evidence, not browser-bridge automation. `RELEASE_B = PASS`.

## Release B Artifact Integrity Closure (2026-08-14)

Implementation status: focused local regression PASS (`9 passed`), lint PASS, typecheck PASS. No database migration. Production deployment, external artifact provenance, production headers/health and Chrome QA are not yet verified for this source revision.

Historical Release A Share Drawer Esc->body evidence remains preserved. The Release B implementation routes the drawer through the shared focus controller and adds logical More-actions fallback for a trigger unmounted by the action rail.

Offline/Export now publish validated same-volume unique files before the worker-owned database commit, and defer old-file cleanup until after commit. Commit failure preserves prior canonical state; cleanup failure is debt. Import stale recovery is bounded at three automatic attempts. `apps/api/scripts/artifact_cleanup_dry_run.py` is read-only and automatic cleanup remains disabled.

## Formula Dense Reader Scroll Stabilization - 2026-08-13

The reported slowdown after formulas had already loaded was traced to repeated ReactMarkdown/remark/rehype-KaTeX work on unchanged virtual blocks, compounded by ordinary-text height estimation for long display LaTeX and layout propagation from the full `htmlAndMathml` subtree. The fix keeps complete MathML and all existing KaTeX security settings, but memoizes cross-block projections and block/rendering subtrees, adds formula-aware bounded virtual estimates, and applies local `contain: layout paint` to display math.

Verification: Web typecheck PASS, production build PASS, focused ESLint PASS, parser/layout/browser-independent tests `17/17 PASS`. The full Rich Markdown browser suite was fixture/server-gated in this local run and is not counted as PASS. No database/API/migration/canonical source/attachment/Viewer changes were made. Production wheel trace, frame interval, long-task and real formula-heavy conversation metrics remain `NOT_PRODUCTION_VERIFIED`.

## Manual TOC Refresh - 2026-08-13

The Owner Reader now exposes `更新目录` in the top-right More menu. Its accessible dialog allows dialogue index, section contents, or both; section rebuilding defaults to the current conversation and can explicitly target every non-deleted conversation. At least one target is required.

The implementation preserves one source of truth: dialogue index rows are dynamically projected from current canonical messages, so refresh validates that source and then precisely invalidates the Web query cache. Persisted Heading rows are the only derived materialization rebuilt by the worker. The operation does not bump conversation revision, rewrite messages, reset Reader position, or add a migration. All-conversation rebuilding is idempotently queued and reports per-conversation progress.

Local verification PASS: TOC route + builder `4/4` (route `3/3`, builder `1/1`), Web contract `1/1`, lint/typecheck/production build PASS, full API `236 passed / 4 fixture-gated skipped`, default PWA `59 passed / 36 environment-gated skipped`, Alembic `20260806_0021`. Skipped PWA flows are reported separately and are not PASS.

Production deployment PASS: commit `9d338a001c612bfd837de6a9ee5d06cdb684df61`, Actions run `31621723794`, artifact SHA-256 `8b0123f93a382535d378e16d5d5a046049ba245870d955dc009e1262cbbdca1b`, validated recovery point `/opt/chat-reader/backups/toc-refresh-20260813T012000Z-9d338a0`. API/Web/PostgreSQL are healthy, worker runs, Scanner is stopped and Alembic remains `20260806_0021`.

Real production Chrome PASS for the isolated QA current-conversation flow: More entry, both default targets, current default section scope, all-scope selection, initial focus, exactly one accessible Close, Esc focus restoration, combined/current, dialogue-only and section-only tasks, accessible completion feedback and refresh stability. The current section job produced two headings and the derived operation left revision `5` unchanged. The all-conversations section branch is `NOT_PRODUCTION_VERIFIED` by deliberate data-safety choice; real API/worker integration is PASS. The QA Conversation was deleted through the product API and returned `404` afterward.

Post-acceptance cleanup retained current `9d338a0`, rollback `3ed9dc7` and `latest`; it removed only superseded `9e3bc99` Chat Reader image tags/layers and the transfer archive. Releases are 4 KiB and root free space is about 16 GiB. No business volume, user data, `.env.production`, backup or unrelated image was removed.

## JSON + Markdown Import Compatibility v5 - 2026-08-12

Root cause confirmed: the supplied Markdown contains one `Response` section, and the old detector recognized exporter Markdown only when both literal `## Prompt:` and `## Response:` existed. The route therefore returned `422 unsupported_source_profile` before the existing JSON-aware parser/alignment logic could run; file size was not the cause.

The preview route now classifies the upload batch with JSON message context. Import v5 ignores blank messages anywhere, aligns every non-empty message with a bounded monotonic sequence algorithm, preserves original source indexes, accepts unique timestamp-bound rich Markdown from historical lossy-JSON exporters, and blocks unmatched/ambiguous/unrelated plain content with visible diagnostics. Structured 422 errors are localized in the Chinese Web UI.

Verification PASS: the exact supplied pair previews as one non-empty Assistant message through both API and an isolated production-build file-chooser flow; no commit was performed. Supplied-pair compatibility is `61 passed / 2 skipped`; the real 398-message preview/commit/idempotent-retry matrix is `12 passed / 1 skipped` and preview remains inside the 20-second assertion. Full API is `235 passed / 4 skipped`, Web import contract is `2/2`, default PWA is `57 passed / 36 environment-gated skipped`, and lint/typecheck/production build plus Alembic single-head checks pass. Skips are not counted as PASS. No migration or new dependency was added.

Production Preview PASS: the exact supplied pair returned HTTP `200` in about 1.5 seconds with `can_commit=true`, `alignment=exact_match`, one non-empty message and no warning. The preview was not committed. Its uncommitted ImportRecord remains governed by the existing preview TTL because there is no safe owner-facing immediate-delete endpoint; no direct SQL deletion was used.

The 398-message bottleneck was the unique role/timestamp path still running the full Markdown/thinking comparison for every large message. It now pairs unique monotonic identities in O(n) and performs only bounded validation. Preview logs expose JSON parse, Markdown parse and alignment time separately. Duplicate, reordered and unrelated content retains the guarded conflict path.

## Rich Markdown Scientific-inline Closure - 2026-08-12

Three roots were closed. First, heading rendering applied an element allowlist after KaTeX and unwrapped the semantic tree, making hidden MathML text, TeX annotation and visible HTML appear together. The heading wrapper now retains the shared sanitized KaTeX subtree and suppresses images through its component map. Second, the standalone bracket grammar omitted common scientific commands used by ChatGPT. Third, the v3 production check found eight short conceptual display labels still excluded because they contained English words. V4 adds a distinct, bounded uppercase-label grammar with only `>`/`+` operators and a UI-only `text{...}` projection; lowercase and multiword prose remain text.

Production-equivalent verification is PASS: parser/shared contract `14/14`, Reader/Editor/security/stress `5/5`, and both exact reported-source copies `1/1`; the second full source now has 41 display formulas/MathML and zero residual bracket paragraphs. Neither copy produced math errors or page-level overflow, and canonical source equality held. Full API is `235 passed / 4 skipped`, default PWA is `58 passed / 36 skipped`, lint/typecheck/build PASS and Alembic remains `20260806_0021`.

Production PASS: commit `3ed9dc75e650223b05663000b6429074e1ba4c1b`, Actions run `31614666602`, artifact SHA-256 `e718641b046edadab0560e84363c4d0e0618e994b461a622c29109443c480b92`, validated backup `/opt/chat-reader/backups/import-rich-v3-20260812T151526Z-9e3bc99`. Real Chrome read-only full-source checks confirmed the first page retains 108 display formulas and a single heading formula presentation, while the second page renders `41/41` display formulas/MathML with all eight bounded conceptual labels, zero errors and zero residual literal bracket paragraphs. Source Preview began collapsed and no edit was saved.

King cleanup PASS: current `3ed9dc7`, rollback `9e3bc99` and `latest` remain. Intermediate `e69a510`, superseded `336486b` and their transfer archives were removed only after replacement health. `/opt/chat-reader/releases` is empty and root free space is about 17 GiB. No volume, PostgreSQL data, user file, `.env.production`, retained backup or unrelated image was removed.

## Archived Project Deletion - 2026-08-12

Root cause: the product implemented archive/restore but had neither a project-delete API nor a delete action on the Archived page. The closure adds a guarded terminal operation for archived non-default projects. It preserves every conversation/message by moving project relations to the internal Unclassified project before deleting only the Project row; pins, recent placement, offline revision and placement events are reconciled in the same transaction.

The Archived page now supports per-row and batch permanent deletion with explicit retained-data copy and partial-failure feedback. Verification: project API `9/9`, Web contract `1/1`, lint/typecheck/build PASS, full API `220 passed / 3 skipped`, Alembic `20260806_0021`. Production deployment and real QA flow are recorded after the external image release.

Production PASS: commit `0f004f7ce79cc6b97e68a8756c6ea21d6a75cc9f`, Actions run `31576690022`, artifact SHA-256 `1d34431be81000854736a1185264a523ec875db5252c3bb0ea8b1c1f4f6a4d67`, validated backup `/opt/chat-reader/backups/project-delete-20260812T0810Z-0f004f7`. Real Chrome completed create -> archive -> delete -> project absent -> conversation retained under Unclassified -> refresh, then removed the disposable QA conversation through the product API.

King image-package cleanup is complete: 18 legacy top-level archives, six legacy release directories containing only Chat Reader image tar/checksum pairs, the transfer archive and superseded `4d07ce4` images were deleted. `/opt/chat-reader/releases` fell from about 3.8 GiB to 4 KiB; final root free space is about 5.2 GiB. Current `0f004f7`, rollback `336486b`, `latest`, volumes, PostgreSQL, `.env.production` and validated backups were retained.

## Rich Markdown Consumed-inline Closure - 2026-08-12

The reported production message retained math bodies but lost additional outer delimiters during ChatGPT clipboard ingestion: `\(n^6\)` became `(n^6)`, while `[\nf(x)=x^2.\n]` lacked a named LaTeX command and failed the v1 bare-bracket gate. The shared parser now uses `ai-rich-markdown-v2`: compact mathematical parentheses and standalone bracket expressions become semantic `inlineMath`/`math` nodes, while prose, dates, versions, uppercase identifiers, currency and code remain unchanged. This is an AST presentation rule; canonical source and persisted data are untouched.

Production-build results: parser/core `12/12`, Reader/Editor/security/stress `5/5`, reported full-source copy `1/1`, Markdown attachment `1/1`, lint/typecheck/build PASS, API `220 passed / 3 skipped`, default PWA `54 passed / 34 conditional skipped`, Alembic `20260806_0021`. The explicit full-source preview rendered 108 display formulas and at least 108 MathML nodes with zero math errors and no document horizontal overflow. The ephemeral QA copies were deleted through the product API. Conditional PWA skips are not counted as PASS. Production deployment and read-only verification are appended after the external release.

Production PASS: commit `9e3bc99595dfc958c0167763a68b95890b98f431`, Actions run `31580890665`, artifact SHA-256 `493f080d973c7b2aedcf3e61f18762471f613a04599b0bd051943afe16de4dba`, validated 434 MiB backup `/opt/chat-reader/backups/rich-inline-20260812T090711Z-9e3bc99`. Real Chrome on the reported Conversation confirmed renderer v2, default-collapsed preview, 108 display formulas, 130 MathML trees, recovered `n^6`/`k`/`f(x)=x^2`, zero math errors and no page overflow. The source editor was closed without saving.

King cleanup PASS: the deployment archive and superseded `0f004f7` API/worker/migrate/Web layers were removed only after health and Chrome acceptance. Current `9e3bc99`, rollback `336486b` and `latest` remain. `/opt/chat-reader/releases` is 4 KiB and final root free space is about 4.1 GiB after retaining the verified backup. Volumes, PostgreSQL, `.env.production`, historical backups and unrelated images were untouched.

Backup retention cleanup PASS: a read-only audit found `/opt/chat-reader/backups` consuming about 15 GiB. After checksum/archive/PostgreSQL validation of the protected recovery chain and confirmation that no container mounted the directory, 50 redundant historical snapshots (13,701,926,937 bytes) were removed. Retained coverage comprises the July 30/31 baseline, `38c57c1` Release Closure, `336486b` rollback, and `9e3bc99` current release. Backups now use 1.5 GiB; root availability increased from 4.1 GiB at 90% usage to 17 GiB at 56% usage. API/Web/PostgreSQL remained healthy, the import worker remained running, public and same-origin health returned `ok`, and no business volume, database, user file, environment file, current/rollback image, or unrelated service was removed.

## AI Rich Markdown Rendering Release - 2026-08-12

### Root cause and implementation

- The previous pipeline already had `remark-math` and KaTeX, but CommonMark consumed the backslashes in ChatGPT `\[`/`\]` and `\(`/`\)` before `remark-math`; the parser therefore produced literal brackets/text instead of math nodes. Dollar parsing also interpreted currency ranges too aggressively.
- `remarkAiMathCompatibility` now recovers ChatGPT delimiters from mdast source positions only in ordinary text, produces `math`/`inlineMath` nodes, excludes code, and demotes currency-like single-dollar nodes. There is no regex source rewrite and no DOM auto-render pass.
- Reader, Source Editor preview and Markdown attachment inline/Viewer use one shared GFM/Math/footnote/security core. Source is not changed or persisted as generated HTML. No migration, API or export format changed.
- KaTeX uses local `htmlAndMathml`, `trust=false`, `maxExpand=1000`, `maxSize=20`; malformed math is isolated. Math/table/code own overflow. Unsafe HTML/links stay inert and remote Markdown images are not fetched automatically.
- Offline shell revisions now explicitly include current same-origin `KaTeX_*` font assets rather than depending on an incidental online font request.
- The real Markdown attachment flow exposed an upload-completion race: the draft could become `ready` before React received CodeMirror's `cr-asset://` replacement. Completion now seeds the canonical editor document before enabling save; the regression requires the first PATCH to return 2xx.

### Verification before deployment

| Check | Result |
| --- | --- |
| Web lint / typecheck / production build | PASS |
| Rich parser + shared-core static tests | `4/4 PASS` |
| Reader/Editor/security/109-formula stress/attachment matrix | `8/8 PASS` |
| Real Markdown attachment upload/save/inline/Viewer | `1/1 PASS` |
| Heavy Reader Owner/Share regression | `8/8 PASS` |
| Default PWA matrix | `45 passed / 31 conditional skipped` (`PARTIAL_PASS`; skips not PASS) |
| Offline KaTeX inventory and cold start | `1/1 PASS` |
| API suite | `218 passed / 3 skipped` |
| Alembic | one head `20260806_0021`; no migration |
| Production deployment / Chrome | PENDING at candidate stage; appended after release |

Golden screenshots: `docs/execution/screenshots/ai-rich-markdown-desktop-1440x900.png` and `ai-rich-markdown-mobile-360x800.png`. They contain only synthetic QA content and supplement DOM/source assertions; they are not the sole evidence.

Current statuses: `AI_RICH_MARKDOWN_CORE=PASS`, four delimiter modes PASS, Math error/security/accessibility/overflow PASS, GFM table/task/strike/autolink PASS, footnotes PASS, code isolation PASS, Reader/Editor/Markdown attachment PASS, Long Reader PASS, 360px reflow PASS, and `OFFLINE_KATEX_ASSETS=PASS` in production-equivalent PWA.

### Production deployment and Chrome acceptance

| Check | Result |
| --- | --- |
| Commit / Actions | `4d07ce40fd8f130c219e8535bcd2c2f8d9910d97` / run `31560459470` PASS |
| Release archive | SHA-256 `c47168693d2d3efb9aca3ca8fe4b7ff122a08ee511ce9cfeef77f10c0442a2e5` matched locally and on King |
| Backup | Validated PostgreSQL and import/export/offline/asset archives at `/opt/chat-reader/backups/ai-rich-markdown-20260812T034100Z-4d07ce4` |
| Migration / health | `20260806_0021`; API/Web/PostgreSQL healthy; worker running; Scanner stopped |
| Golden formula / delimiters | PASS: 5 KaTeX roots, 2 display roots, 5 MathML trees; currency remained text |
| GFM / footnotes / code | PASS: semantic table/del/task markers, scoped reference/backlink, fenced and inline code excluded from math |
| Security / overflow | PASS: no executable unsafe link, no script execution, no document-level horizontal overflow |
| Source Editor | PASS: raw `\[`/`\boxed` preserved; shared formula preview rendered; type/backspace kept selection offset |
| Offline shell UI | PASS: `/library` immediately reported `可离线启动 · 78 项资源`; exact font membership is PASS in production-build SW cold-start E2E |
| Exact 360/390 production Chrome | NOT_PRODUCTION_VERIFIED in the current bridge; exact production-build 360/390/768 is PASS |
| Production screenshot | NOT_CAPTURED: Chrome capture timed out; production DOM assertions plus synthetic local screenshots are retained |
| QA cleanup | PASS: disposable synthetic Conversation deleted via product API |
| Image cleanup | PASS: retained current `4d07ce4` and rollback `3b544fe`; removed obsolete `1cdadc4` and transfer archive |

Production logs contained only the known extension message-channel error. API/Web logs and health contained no new application error. The production formula phase therefore passes its release gate; unrelated unexecuted PWA quota/interruption negative paths remain outside this phase and are not upgraded to PASS.

### ChatGPT bare-bracket follow-up

Read-only inspection of the reported production Conversation found 21 standalone `[`/`]` formula pairs, 6 `\\boxed`, 51 `\\frac` and 15 `\\sqrt` commands, but zero surviving outer `\\[`/`\\]`. The API block builder had also divided formulas at blank lines. The first release correctly handled intact delimiters but could not reconstruct a formula after both delimiter loss and RenderBlock splitting.

The parser now accepts a bare-bracket display only when standalone `[`/`]` or `/[`/`]/` delimiters bound a multiline body containing a recognized LaTeX command and the source range does not intersect code or HTML. It also repairs pasted Setext equality/heading artifacts only after that boundary is established. The Reader adds a UI-only paragraph/heading cross-block projection before the shared parser; canonical Markdown, persisted RenderBlocks and export remain unchanged. Ordinary bracket prose, headings and fenced LaTeX remain ordinary/code. Source Editor preview now starts collapsed at every viewport and keeps an explicit accessible toggle.

Focused parser/Reader/Editor verification is `10 passed`. The exact production canonical source was copied into a transient local QA Conversation: all `22/22` formula groups rendered as display math with `22/22` MathML trees, zero KaTeX error fallbacks, no visible raw `\\boxed`/`\\frac`/`\\sqrt`, and no page-level horizontal overflow. The QA copy was deleted through the product API. Web lint/typecheck/build PASS; API `218 passed / 3 skipped`; Alembic single head `20260806_0021`; default PWA `49 passed / 32 conditional skipped`. Conditional skips are not PASS.

Deployment PASS: commit `336486b89c12c1536763698feda4c550502b49eb`, Actions run `31573557959`, artifact SHA-256 `c3e6463a9689061430d7b28a7970550553cab6fdcf2020d2f2b19b04a96627e3`, verified backup `/opt/chat-reader/backups/rich-markdown-followup-20260812T072512Z-336486b`. King used external images, migration preflight and `--no-build`; API/Web/PostgreSQL are healthy, worker runs, Scanner is stopped and Alembic remains `20260806_0021`. Real Chrome on the reported Conversation confirmed 22 display formulas, 22 MathML trees, zero errors, zero visible raw LaTeX and no page overflow. Source Editor default preview was absent with its toggle false; after explicit expansion it rendered all 22 formulas. No production data was changed. Cleanup retained current `336486b` and rollback `4d07ce4`, and removed older `3b544fe` plus the transfer archive.

## Offline Startup, Attachments and Context Skill Delivery - 2026-08-11

### Root causes closed

- The Library shell was hard-coded to `preparing`, waited for `window.load` and dynamic viewer imports, and used historical Performance entries for its revision. That made a valid active shell appear blocked and could block downloads. Availability is now independent from background reconciliation; active shells are ready immediately, the inventory is deterministic, and the update is retryable without blocking the page.
- Offline Reader had no corresponding current-conversation-files entry and offline attachment URL misses could leave a blank/indefinite Viewer. It now exposes a read-only panel through the existing workspace and unified Viewer; cache misses are explicit `offline-unavailable` and object URLs are released.
- Context Package delivery had no bilingual Skill path and could allow clipboard failure to obscure the package handoff. The result now offers download/copy/view for both Skill files. Download always starts first, clipboard failure is visible and retryable, and both static files are inert and checksum-pinned.

### Verification

| Check | Result |
| --- | --- |
| Web lint | PASS |
| Web typecheck | PASS |
| Web production build | PASS |
| API suite | `218 passed / 3 skipped` |
| Alembic | PASS, one head `20260806_0021` |
| PWA/Playwright full local matrix | `41 passed / 27 skipped` |
| Offline startup and active-shell preservation | PASS |
| Offline read-only attachment panel and unified Viewer path | PASS |
| Local CanJSON/Markdown/`.context.zip` export | PASS |
| Chinese/English Skill view, download, checksum | PASS |
| Clipboard rejection after package download | PASS |
| Exact 360/390/768 offline reflow | PASS |
| Quota/interrupted package/reconnect/production offline interception | NOT_PRODUCTION_VERIFIED |

The 27 PWA skips are API/fixture-gated online flows in the no-API local web matrix and are not counted as PASS. The local offline exporter is a bounded snapshot projection; it does not alter the server export/import contract.

### Production deployment and Chrome

| Check | Result |
| --- | --- |
| Commit / Actions | `3b544fe` / run `31486218261` PASS |
| Release archive | SHA-256 `1e83d68a5f3c7321e9e9d6f2d5602b043aa32ae127ab5cf3c320e75fa3b7bfe7` PASS |
| Backup | PostgreSQL plus four business archives validated at `/opt/chat-reader/backups/offline-context-20260811T112745Z-3b544fe` |
| Migration / health | `20260806_0021`; API/Web/PostgreSQL healthy; worker running |
| `/library` startup | PASS: `checking` to `ready` in about 2.5 seconds, 27 shell resources, update action usable |
| Existing offline Reader | PASS: 398-message snapshot opened, no page overflow |
| Offline current-conversation files | PASS: read-only entry/panel present, no management actions |
| Offline local `.context.zip` | PASS: generated from the existing snapshot without server mutation |
| English Skill viewer | PASS: content and pinned SHA visible |
| Production download event / clipboard readback | NOT_PRODUCTION_VERIFIED_IN_THIS_BROWSER_BRIDGE; UI reported success and production-build Playwright is PASS |
| Image cleanup | PASS: retained current `3b544fe` plus rollback `1cdadc4`; removed obsolete `b6ce0e6` and transferred archive |

Offline quota exhaustion, interrupted package writes, stale-package reconnect and a real production network cut remain verification debt. Therefore this release does not claim the complete PWA negative matrix as PASS.

## Reader Scrollbar Jump Blank-Window Closure - 2026-08-10

### Root cause

- Production Chrome reproduced persistent empty Reader content after large scrollbar jumps: the visible article remained mounted, but `visibleBlocks=0` and its nine virtual rows were placed roughly 33,000px below the viewport.
- The API and message data were present. A stale per-message `scrollMargin` survived edge-window growth and upstream virtual-height correction, so the virtualizer selected a valid range in the wrong coordinate system.
- Native thumb dragging also allowed the sentinel load to merge more messages before pointer release, changing total scroll height during the gesture.

### Remediation

- Visible virtual gaps now rebase from the real DOM offset without clearing measured row sizes.
- Pointer-down proactively requests a coordinate rebase. Sentinel visibility is still tracked during drag, but the fetch/merge is deferred until pointer release and invoked once.
- Ordinary wheel scrolling does not perform the recovery DOM scan unless the virtual range changes and the message shell is actually visible without a visible row.

### Verification before deployment

| Check | Result |
| --- | --- |
| Web lint / typecheck / production build | PASS |
| Reader restoration, navigation, Share and wheel suite | `8 passed` |
| Blank-jump + continuous-wheel repeat (3x each) | `6 passed` |
| API | `216 passed, 3 skipped` |
| Alembic | single head `20260806_0021` |
| Default PWA matrix | `37 passed, 25 conditional skipped` (`PARTIAL_PASS`) |

## Reader Wheel Performance Stabilization 2026-08-10

### Root cause and implementation

- The six-message Reader window was working, but three mounted Assistant messages contained 402, 389 and 501 virtual blocks. Coarse estimates (including a fixed 260px for code) caused approximately 550–640px total-height corrections during small wheel sequences.
- The wheel path also scanned mounted messages/blocks with repeated rectangles, observed the changing virtual total-height container and retained two edge-load triggers. These combined measurement, compensation and state updates made the wheel feel detached from user input.
- The fix introduces metric-aware block estimates, Unicode/CJK visual-line accounting, bounded compensation above the reading line, stable-width observation, one Owner/Share active-target resolver, one 80ms/trailing scroll coordinator, a single idle reading-position save, sentinel-authoritative edge loading and memoized TOC following.

### Verified locally

| Check | Result |
| --- | --- |
| Estimator + Owner/Share long Reader suite | PASS, `9/9` |
| 30-step wheel monotonicity | PASS, no reverse correction over 2px |
| Warm 1000px virtual-height drift | PASS, within 200px budget |
| Mounted messages / virtual rows | PASS, `<=6` messages and bounded row overscan |
| Wheel persistence | PASS, zero writes during input and one after idle |
| Middle-window edge traffic | PASS, no Reader turn request |
| Three Chromium performance runs | PASS, median p95 `16.7ms`, longest task `70ms`, total long-task time `70ms` |
| Web lint/typecheck/build | PASS |
| Full API | PASS, `216 passed / 3 skipped` |
| Default PWA matrix | PARTIAL_PASS, `37 passed / 22 conditional skips` |
| Alembic | PASS, one head `20260806_0021` |

Production deployment and read-only Chrome verification are appended after the external image release. No existing production message or attachment is modified for this acceptance.

## Release Stabilization / Lifecycle Closure 2026-08-10

### Implemented

- Mutation responses now carry the committed conversation revision, and the Web uses it as canonical cache state. Conversation creation seeds the new conversation query; insert/edit/task/version/delete/restore handoffs no longer leave the next action on a stale revision.
- Delete -> Undo uses the delete response revision, has visible restoring/failure/retry states, refresh persistence coverage and idempotent repeated restore. This remains short soft-delete recovery, not Trash.
- Attachment API exposes current-version occurrence count independently from active/detached status. Scanner-disabled metadata is neutral `未扫描`. Dialogs use shared initial focus/trapping/restoration and non-focusable backdrops; project creation copy/autofocus is localized.

### Verified this release (local)

| Check | Result |
| --- | --- |
| Targeted attachment + message lifecycle API | PASS, 10 passed |
| Full API suite | PASS, 216 passed / 3 conditional skips |
| Web lint | PASS |
| Web typecheck | PASS |
| Web production build | PASS |
| PWA default matrix | PARTIAL_PASS, 30 passed / 21 conditional skips |
| Alembic | PASS, one head `20260806_0021` |

### Production browser closure

Final commit `ed9116a` was externally built by Actions `31374507130` and deployed incrementally to King from archive SHA-256 `a6132d7801253da105893967a87e373a151587795c1c220ecb741f53bba1788b`. PostgreSQL and existing imports were backed up at `/opt/chat-reader/backups/stabilization-20260810T0815Z-248b771`; checksums pass. Migration preflight remained at the single head `20260806_0021`, and API/Web/PostgreSQL are healthy while the worker is running.

Real production Chrome now passes the Attachment Viewer initial-focus, Tab/Shift+Tab loop, single Shell/single accessible close, Esc/X/backdrop close and trigger restoration paths. Project creation passes Chinese naming, input autofocus and Escape cancellation with trigger restoration. A requested 390x844 viewport resolved to 433x938 in the browser bridge; that narrow layout has no page horizontal overflow, a non-zero Viewer content area and approximately 44px close/download targets. Exact 360/390 sizing, real 125/150/200% browser zoom, keyboard-only mutation flow, genuine two-tab race, browser chooser, forced-offline negative paths, full online Playwright mutation/Reader fixture and QA `.cr` round trip remain `NOT_PRODUCTION_VERIFIED`; skipped tests are not PASS. Existing production records were not modified or deleted.

## 2026-08-10 CSV Table Viewer And Production Release

| Area | Status | Evidence |
| --- | --- | --- |
| CSV/TSV detail default | PASS | `ViewerBody` maps `table` to rendered bounded table mode; production Chrome displayed `MANIFEST.csv` as a table with 70 rows and sticky header |
| Table/Raw toggle | PASS | Production Chrome switched `Table -> Raw -> Table`; Raw used one source `<pre>`, returning restored the table |
| CSV parser bounds | PASS | Quoted fields and embedded delimiters covered by focused test; parser caps 10,001 rows and 256 columns |
| Web lint/typecheck/build | PASS | lint, typecheck and Next production build passed |
| Focused attachment tests | PASS | `13/13` attachment layout/presentation tests passed |
| Production deployment | PASS | commit `5cc491f`, Actions run `31325841867`, archive SHA-256 `d75a66b214932a542fc39f8630f674128f134b61eb51445da59eb75cce117f17`, deployed with `--no-build` |
| Production backup | PASS | `/opt/chat-reader/backups/csv-table-20260810T010711Z`; database and business volumes checksummed successfully |
| Production health | PASS | API/Web/worker/PostgreSQL healthy; `/api/health` status `ok`; capability endpoint reports scanner `disabled` |
| Old image cleanup | PASS | previous service tags removed; current full SHA and `latest` retained; no volume deletion |

Production Chrome screenshot evidence was captured in the deployment acceptance run (2032x975 viewport). The broader PWA matrix remains `PARTIAL_PASS` because 21 online/fixture-gated cases were skipped and are not counted as PASS.

The caption-only follow-up commit `6d025e7` was built by Actions run `31347470091` and deployed from archive SHA-256 `158dc6e03d2fa6abb536a1c0a66e297e8c42e17512db57b7af6e4e1afb5f88f9`. Final Chrome acceptance found zero redundant legacy `Attachment:`/`附件：` footer captions while retaining all three CSV table actions. Current API, Web, Worker and PostgreSQL are healthy. Status: `PASS` for the CSV Viewer and caption closure; `PARTIAL_PASS` for the larger conditional PWA matrix.

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
## 2026-08-10 Comprehensive Release-Readiness Audit

| Area | Status | Evidence |
| --- | --- | --- |
| Production Chrome core Reader/attachment/Share acceptance | `PARTIAL_PASS` | Real Chrome verified rendered Reader, Markdown/CSV/SVG/PDF/ZIP, Range, Scanner-disabled `未扫描`, adaptive visible Viewer panels and Share revocation. |
| Large JSON + Markdown import | `PASS` | Production multipart preview HTTP 200 in 8.7s, exact 398 nonempty messages, commit completed in 28.7s; browser file chooser remains `NOT_PRODUCTION_VERIFIED`. |
| New conversation / insertion | `PARTIAL_PASS` | QA atomic pair and pair insertion pass; immediate first insert exposes stale revision until refresh. |
| Message delete / undo | `FAILED` | QA delete works, visible undo did not restore and gave no error. Release blocker FUNC-003. |
| Unreferenced attachment Files Panel | `FAILED` | Active zero-reference records disappear from All/Unreferenced despite export facts. Release blocker FUNC-001. |
| Share permission boundary | `PASS` | QA Share exposed read-only scope and revocation invalidated the URL. |
| Local required checks | `PASS` | lint, typecheck, build, API `216 passed / 3 skipped`, Alembic single head. |
| PWA/Offline full matrix | `PARTIAL_PASS` | 30 passed, 21 conditional skips; production negative offline and 360/zoom cases remain `NOT_PRODUCTION_VERIFIED`. |

Detailed findings, screenshots and QA cleanup: `docs/evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md`.

## Reader Scroll Stabilization - 2026-08-10

### Root cause and remediation

- Coarse virtual-block estimates caused repeated 550-640px total-height corrections during normal wheel input. Estimates are now metric-aware for paragraphs, CJK/emoji, code, headings, tables and media.
- The changing virtual total-height container is no longer a layout-observation source. Width/font/density/layout events invalidate metrics; TanStack row measurements remain canonical.
- Active position, direction and idle persistence share one passive scroll coordinator; sentinel IntersectionObserver alone owns edge loading.

### Automated verification

- Web lint/typecheck/production build: PASS.
- API: `216 passed, 3 skipped`; Alembic: one head `20260806_0021`.
- PWA default matrix: `37 passed, 22 skipped` (`PARTIAL_PASS`; skips are not PASS).
- Focused Reader suite: `9 passed` (estimators, TOC, preference anchoring, restoration, annotation/refresh, continuous wheel and Share Reader).
- Three production-build Chromium performance runs: p95 frame interval `16.7ms`; longest task `72/68/70ms`; total long-task time `72/68/70ms`. Budgets 34/150/250ms passed.

### Production verification and deployment

- Real production Chrome, read-only: 30 wheel steps had `minDelta=119.576px`, `reverseSteps=0`, six mounted messages. The warmed 1,080px segment had 85px height correction. TOC followed block 54 -> 62; server position persisted and restoration settled back to block 68.
- GitHub Actions run `31385483844`; release commit `e4bc9c3ce00ed7071d896546df330cdd1a0f1b53`; artifact SHA-256 `1deddb658a8c663111e530ffd793cb3f437cc9498ca68fded7dd498934f8c777`.
- King used verified backup, migration preflight and `--no-build`; API/Web/Postgres are healthy. Backup: `/opt/chat-reader/backups/reader-scroll-20260810T120035Z-e4bc9c3`.
- Production bridge has no page console/network stream and timed out on viewport screenshot capture. Exact 360px/zoom/offline-negative and a full production edge-sentinel trace remain `NOT_PRODUCTION_VERIFIED`; local functional invariants are not relabeled as production PASS.

## Reader Scrollbar-Thumb Blank-Window Closure - 2026-08-10

- Root cause: a mounted message could intersect the Reader while its per-message TanStack virtualizer still used a stale absolute `scrollMargin`. A large native scrollbar-thumb jump then selected rows far outside the visible message, producing an apparently empty page although API data and the message shell were present. Native thumb movement could also trigger an edge-window merge while Chromium still held the thumb, changing `scrollHeight` during the gesture.
- Fix: visible-message gap recovery rebases the virtual coordinate system without discarding measured row heights; pointer-held thumb gestures defer edge-window transitions until release; viewport-scale non-wheel jumps publish a layout rebase event. Ordinary wheel scrolling retains the measurement-free hot path.
- Automated: lint, typecheck and Web production build PASS; API `216 passed, 3 skipped`; Alembic `20260806_0021 (head)`; default PWA `37 passed, 25 conditional skipped`; focused final Reader regressions `3/3` PASS, with the earlier full Reader restoration suite `8/8` PASS.
- Production: commit `771f4c8`, Actions run `31398377216`, archive SHA-256 `b8c6dc8e7769cfe4e03e9523595b179f50308a045f78ebe8beb71a44291e1000`. Native Chrome thumb drags in both directions immediately retained 15/14 visible blocks; a further five-position distant-drag sweep had `blankCount=0` and 11-15 visible blocks at every destination. API/Web/PostgreSQL are healthy; worker running; Scanner disabled.
- Current status: `READER_SCROLLBAR_BLANK_GAP = PASS`, `NATIVE_THUMB_DRAG = PASS`, `ORDINARY_WHEEL_REGRESSION = PASS`. Conditional PWA cases remain `PARTIAL_PASS`, not PASS.

## Final Release Closure - 2026-08-11

| Area | Status | Evidence |
| --- | --- | --- |
| Create -> immediate insert | PASS | Real production creation followed by single and pair insert without refresh; refresh preserved lexical order. |
| Delete -> Undo -> refresh | PASS | Real production delete, forced restore 500, localized retry, successful restore and refresh persistence. |
| Active unreferenced Attachment | PASS | Production QA reconciled 2 active/unreferenced business rows with current count 0; both were visible. |
| Shared AssetObject identity | PASS | Two distinct Attachment IDs for identical bytes shared one AssetObject without UI/API merging. |
| Two-tab concurrency | PASS | Production stale write returned 409, preserved draft, loaded the latest base explicitly and saved the retained draft without overwriting silently. |
| Exact 360/390/768 reflow | PASS | Headless Chrome against production real long Reader: document widths exactly matched viewports with no page overflow. |
| Browser 125/150/200% zoom | NOT_PRODUCTION_VERIFIED | Device-scale checks are not accepted as browser zoom. |
| File chooser | PASS | Production-build Playwright real chooser/upload/insert/refresh 5/5; production bridge itself cannot control the native chooser. |
| Long Reader | PASS | Owner/Share restoration, search/jump, native thumb/wheel and blank-window recovery suites pass; production narrow regression remained populated. |
| Share scope/revoke/expiry | PASS | Production QA expiry was allowed before expiry and rejected after expiry; revoke returned success. |
| `.cr v4` round trip | PASS | Empty production-equivalent restore preserved referenced/unreferenced Attachments and distinct business identities sharing an AssetObject. |
| Offline/PWA | PARTIAL_PASS | Baseline 6/6; runtime-chunk/cache-miss/quota/interruption/reconnect negative matrix remains unverified. |

Required commands: lint/typecheck/Web production build PASS; API `218 passed / 3 skipped`; Alembic one head `20260806_0021`; default PWA `37 passed / 27 conditional skipped`; mutation closure `6/6`; long Reader `8/8`; upload chooser `5/5`; Offline baseline `6/6`. Skipped scenarios are not counted as PASS.

Deployment: commit `38c57c12191bb85ebca0a7caf9aea80f11070993`, Actions run `31453697905`, artifact SHA-256 `430dd0d88c927a6329da132aced75c742124ac4035b4c05c348bdbeda549e11c`, validated backup `/opt/chat-reader/backups/final-closure-20260811T030600Z-38c57c1`, King migration preflight and `--no-build` recreation. API/Web/PostgreSQL are healthy, worker running, Scanner disabled.

```text
CORE_WEB_RELEASE = PARTIAL_PASS
PWA_OFFLINE_RELEASE = PARTIAL_PASS
OVERALL = PARTIAL_PASS
ONLINE_WEB_GA_READY = NO
```

Historical failure rows above remain evidence of the state observed on 2026-08-10; this section is the current release status.

## Attachment workspace and Markdown cursor closure - 2026-08-11

- Settings retains system `.cr` export but no longer exposes a second restore file picker; `.cr` selection stays in Import data.
- Desktop `当前对话文件` now uses the annotation-style `reader-floating` workspace at the Reader's upper-right safe region. Production Chrome verified approximately 400x620 at `y=72`, a whole-header `grab` handle and an accent attachment icon. Mobile remains a full-width sheet.
- Markdown source editing no longer reconfigures CodeMirror per draft render, no longer classifies CodeMirror keys as Reader keyboard scrolling, and no longer echoes every keystroke through the external controlled value. Production Chrome verified offset `21860 -> 21861 -> 21860` with invariant `scrollTop=41091` after type/delete on the same message.
- Web lint/typecheck/build PASS; API `218 passed / 3 skipped`; Alembic one head; default PWA/Playwright `39 passed / 27 conditional skipped`; focused source/placement contract `6/6`; production-equivalent source cursor/mutation flow `2/2`; production public health PASS. The Chrome bridge verified production geometry/cursor/icon and source stability. Physical pointer drag is covered by the production-equivalent `reader-layout` mouse regression; the Chrome bridge itself does not expose a physical mouse API.
- Release commit `1cdadc4f90115d7b46ce55d07a2b4f23c90471d4`; Actions run `31470442426`; artifact SHA-256 `429fb5384dc1dbf57eec68aecad4632c01bd71a58fca6ea9f276468c6d8630fb`; validated backup `/opt/chat-reader/backups/file-workspace-cursor-20260811T075200Z-1cdadc4`. King used migration preflight and `--no-build`; API/Web/PostgreSQL are healthy, worker running, Scanner disabled and Alembic remains `20260806_0021`.
- After health and browser acceptance, 48 exact tags from 12 old releases were removed. Current `1cdadc4`, rollback `b6ce0e6` and `latest` remain; Docker images dropped from 4.919 GB to 2.510 GB and root free space rose from 1.4 GB to 3.9 GB. No volume or non-Chat-Reader image was removed.
# Release A local gate - 2026-08-13

Release A local verification is complete. Next is patched to `14.2.35`, Mermaid to `11.16.1`, and PostCSS resolves to `8.5.26`; compatible transitive overrides reduce the official audit from 2 critical/29 high to 1 critical/16 high. The remaining 17 critical/high records are exact, expiring exceptions: unsupported Next 14 runtime debt, PDF.js 3 mitigated by `isEvalSupported=false`, and its optional canvas/node-pre-gyp/tar build chain mitigated by disabled lifecycle scripts. Next supported-LTS and PDF.js supported-line migrations remain required.

Local gates: lint PASS; typecheck PASS; production build PASS; API `251 passed / 4 skipped`; Alembic `head=current=20260806_0021`; Release A browser `6/6`; default PWA `67 passed / 36 skipped`; audit policy `17 approved / 0 unapproved / 0 policy errors`. Production secret, encoded Alembic URL, actual response headers, CSP Report-Only, PDF/Mermaid settings, long import proxy, and workflow dependency have focused regression coverage. GitHub image inspection/SHA-256 and production health/header/browser evidence remain pending until the committed release workflow and King deployment complete.

Controlled failure evidence: Actions run `31705576354` stopped at package-manager bootstrap because the runner's bundled Corepack trust store did not contain the current pnpm signing key. The `quality` job failed, `build-images` was skipped, and no deployable artifact was produced. The remediation pins pnpm through `pnpm/action-setup` and updates the Web image's Corepack without disabling integrity checks.

Actions run `31706041697` then passed bootstrap, locked install, lint, typecheck and production build. API ended at `249 passed / 4 skipped / 2 failed` because two default-value tests inherited the workflow's synthetic cursor secret. The tests now clear that variable only for the default-value assertion. `build-images` was again skipped, proving that a late quality failure also cannot produce the deployable artifact.

## Release A final candidate and production gate - 2026-08-13

Actions run `31706522862` passed locked installation, migration setup, Web lint/typecheck/production build, API full suite, Alembic validation, official-registry audit policy, live API/worker startup, focused browser checks and the default PWA baseline before image construction. The downstream image job then passed API/Web build, inspection, packaging and upload. Candidate commit: `08df7a1a880c63a4d05df46b8e0a271b16088c7f`; archive SHA-256: `25687fa7b91db5a518d42ccb61892015ff5fb90fc717f820de03a2719846a6b5`; API/worker/migrate image: `sha256:7eec3604e1b9ef31b93b9fda867f9967e62e025747a235fe1ab1058c89ea9edb`; Web image: `sha256:201c867b3259fef2020b8a84708c0964e5361e32b32a0be293b76868cb90ef02`. Independent download verification matched the checksum/manifest, all four inspected entries were `amd64`, and `forbidden_paths_present=false`.

Production deployment is `BLOCKED`. A non-value-disclosing check found `ATTACHMENT_CURSOR_SECRET` absent, classified as default/placeholder, and shorter than the required minimum. Per the Release A contract, no agent-generated secret was written and deployment did not proceed. The existing production Web/API/PostgreSQL remain healthy, worker is running, and Alembic is `20260806_0021 (head)`; no backup, image load, service recreation, data mutation or image cleanup was required because the gate stopped before those operations.

The next read-only preflight found the production value configured, non-default and non-placeholder, but shorter than the former 32-character minimum. The user explicitly approved removing the length requirement so the existing custom value can satisfy the guard. The guard continues to reject missing, empty, development-default and known-placeholder values. No secret value was displayed, copied, recorded or modified; a new workflow and artifact are required before deployment because this policy change occurred after candidate `08df7a1`.

| Capability | Status | Evidence |
| --- | --- | --- |
| Next immediate patch | PASS | `14.2.23 -> 14.2.35` plus build/browser baseline |
| Next supported baseline | MIGRATION_REQUIRED | Next 14 remains unsupported |
| PostCSS patch | PASS | resolves to `8.5.26` |
| Mermaid status | PASS | `11.16.1`, strict mode regression |
| PDF.js mitigation | PASS | sole initialization keeps `isEvalSupported=false` |
| PDF.js supported baseline | MIGRATION_REQUIRED | legacy `3.11.174` retained by scope |
| Production secret guard | PASS | configuration tests and Compose guard pass |
| Production secret provisioning | BLOCKED | production variable absent; value not disclosed |
| Alembic percent URL | PASS | encoded `%`, `%25`, `%3D`, `%40` tests |
| Security headers | NOT_VERIFIED | production-equivalent browser PASS; candidate not deployed |
| CSP Report-Only | NOT_VERIFIED | production-equivalent browser PASS; candidate not deployed |
| CSP enforcing | NOT_IMPLEMENTED | explicitly outside Release A |
| Dependency audit | PASS | 17 exact approved high/critical exceptions; 0 unapproved/policy errors |
| Runtime dependency risk | PARTIAL_PASS | Next/PDF.js time-bounded migration debt |
| Build supply-chain risk | PARTIAL_PASS | legacy optional PDF chain has exact exception and disabled lifecycle scripts |
| Release quality gate | PASS | final successful run plus two blocked-artifact failure runs |
| Quality failure blocks artifact | PASS | runs `31705576354` and `31706041697` |
| Image inspection | PASS | provenance/architecture/entrypoint/forbidden-path checks |
| Artifact SHA-256 | PASS | independent verification matched manifest |
| Current production health | PASS | old release remains healthy and unchanged |
| Release A deployment | BLOCKED | manual secret provisioning required |

```text
RELEASE_A = BLOCKED
NEXT_SUPPORTED_LTS_BASELINE = MIGRATION_REQUIRED
PDFJS_SUPPORTED_LINE_MIGRATION_REQUIRED = YES
CSP_ENFORCING = NOT_IMPLEMENTED
```

## Release A Production Closure - 2026-08-13

Historical `BLOCKED` evidence above is retained. The user later approved removing only the production cursor-secret length threshold. The new guard still rejects missing, empty, development-default and known-placeholder values. A value-safe production preflight returned `configured=true`, `not_default=true` and `not_placeholder=true`; the value itself was never displayed, copied, committed or modified.

Final source commit: `1d366fb0b3e74f865f1cbc455e3f5d6afeaa5911`. Final GitHub Actions run: `31713379831`, which reran `quality -> build-images -> inspect -> package -> checksum -> artifact`. Archive SHA-256: `52b809f4b484db3a180c06f46587130b79d6c3f6a999f1f8651eb12411910b59`. API/worker/migrate digest: `sha256:650d9c9fdcd1f686c7adb1c34f27f37c5cb961206202cc2a0b60519fe5aa3a6f`; Web digest: `sha256:6a273fc0bed72217b6307be2c3a8fd55ee2839a9b8efaebf11f85bf35d8579e1`. Official npm registry provenance matched the exact Mermaid `11.16.1` and PostCSS `8.5.26` lockfile integrity records.

King verified the archive checksum, validated backup `/opt/chat-reader/backups/release-a-closure-20260813T151932Z-1d366fb`, ran the explicit production compose/env migration preflight, and recreated API/import-worker/Web with `--no-build`. API/Web/PostgreSQL are healthy, worker runs, Scanner is disabled, and Alembic current/head is `20260806_0021`. The deployed public response contains `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, the documented Permissions Policy and CSP Report-Only policy; `X-Powered-By` is absent.

Read-only production Chrome smoke passed for Library/PWA shell availability, Rich Markdown/KaTeX (MathML present, no error or page overflow), and the PDF Viewer (canvas rendered; exactly one accessible close; Esc restored `打开 sample.pdf`). No CSP Report-Only violation was observed in Library, Reader/KaTeX or PDF Viewer. The owner Share drawer opens, but its Esc close currently restores focus to `body`; user direction defers this confirmed P2 accessibility defect to the next round. Mermaid's strict-mode regression is covered in CI, but no safe current production Mermaid fixture was available, so browser Mermaid rendering remains `NOT_PRODUCTION_VERIFIED`.

After replacement checks, the 167 MB transfer archive and its release transfer directory were removed. An exact image audit found one extra superseded `9d338a0` Chat Reader set beyond current and direct rollback; only those four service tags/layers were removed. Current `1d366fb`, `latest`, direct rollback `0645a84`, and the validated backup remain. API/Web/PostgreSQL stayed healthy and the worker stayed running. No user data, PostgreSQL, business volume, `.env.production`, backup, or unrelated image was deleted; King root free space is about 16 GiB.

| Status | Final result |
| --- | --- |
| Production secret provisioning | PASS |
| Dependency provenance | PASS |
| Release quality gate | PASS |
| Artifact SHA-256 / image inspection | PASS |
| Alembic percent URL / production head | PASS |
| Production health | PASS |
| Security headers | PASS |
| CSP Report-Only | PASS |
| CSP enforcing | NOT_IMPLEMENTED |
| Next supported LTS baseline | MIGRATION_REQUIRED |
| PDF.js supported-line baseline | MIGRATION_REQUIRED |
| Mermaid production browser fixture | NOT_PRODUCTION_VERIFIED |
| Share drawer Esc focus restoration | P2 DEFERRED |

```text
RELEASE_A = PASS
```
