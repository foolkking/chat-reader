# Testing Addendum 2026-08-09

## Public Share and exact conversation search (working change, 2026-08-17)

The focused API coverage now exercises passwordless public Share access,
independent Share-password hashing/unlock rotation, owner-session separation,
revocation and per-occurrence search anchors:

```powershell
$env:PYTHONPATH='apps/api'
pytest -q apps/api/tests/test_sharing_api.py apps/api/tests/test_search_api.py apps/api/tests/test_auth.py apps/api/tests/test_migration_integrity.py
```

The current local result is `27 passed / 1 skipped`; the full API suite is
`324 passed / 7 skipped`. The Web typecheck and lint also pass. Production
deployment and browser acceptance are intentionally recorded only after the
scoped commit reaches exact-SHA CI and the current production runtime.

## Release N authentication verification and production acceptance (2026-08-17)

The focused gate exercises one owner principal, independent device sessions,
the exact 48-hour expiry boundary, rate-limited activity touch, bounded login
backoff, logout, password-change global revocation, default API protection,
Private-route protection, public Share capability scoping and same-origin
mutation checks:

```powershell
cd apps/api
python -m pytest -q tests/test_auth.py tests/test_migration_integrity.py
```

An auth-enabled isolated PostgreSQL environment upgrades to Alembic
`20260817_0024` and runs the production-build Playwright gate:

```text
apps/web/e2e/auth-gate.spec.ts
```

It covers a fresh device login, generic failure, HttpOnly server credential,
logout cache purge, Share-token non-bypass, two independent device sessions and
password-change invalidation. It uses a generated test credential only; no
production credential is written to test output. The final isolated source
passes `8` focused auth tests, `319` API tests (`7` skipped), `3` browser auth
tests, the default PWA matrix (`72` passed, `69` scoped skips), and the Release
E PWA negative matrix (`10` passed). Web lint,
typecheck, the Next 16.3.1 Webpack production build, dependency/security policy,
migration head/current and `git diff --check` also pass. Exact-SHA CI,
operator password provisioning, deployment and production acceptance passed.

## Release M disaster-recovery verification (2026-08-17)

Release M used the current five-part production backup and restored it into
two fresh isolated Compose projects. `deploy/recovery_preflight.py` passed the
database, filesystem, port, network and volume-isolation checks before each
restore; its tests pass `9/9`. `deploy/recovery_integrity.py` found matching
aggregate/storage snapshots, zero canonical dangling references, zero missing
required files and 228 physical objects with zero missing, size or hash
mismatches on both targets. The second fresh target matched critical
aggregates, proving repeatability. The recovery runbook is
`docs/system/DISASTER_RECOVERY_RUNBOOK.md`.

The drill also verified that restored historical worker heartbeat state is
stale until a new worker emits a heartbeat, then observed recovery `alive_idle`
and a normal QA job transition `alive_busy -> alive_idle`. Production health,
runtime image identity and business volumes remained unchanged; no production
resource was removed. Browser smoke was limited to aggregate Library, Reader
and Source Editor availability and did not persist user content.

## Release L observability verification and production closure (2026-08-16)

The deterministic focused gate is:

```text
cd apps/api
python -m pytest -q tests/test_worker_liveness.py \
  tests/test_diagnostics.py tests/test_observability.py tests/test_health.py
```

Current result: `27 passed`. The matrix controls timestamps and thread/event
barriers rather than waiting for wall-clock stale intervals. It covers recent
idle, busy, stale, unavailable, restart recovery, old-instance fencing, both
task families, blocked long-job pulses, task-heartbeat failure isolation,
privacy, public denial, loopback authorization, no-store headers, request IDs
and Scanner-disabled semantics.

The final migration was applied to an isolated PostgreSQL 16 environment,
downgraded to `20260806_0021`, upgraded again, and verified at single
head/current `20260816_0022`. Migration integrity is `3 passed`. The full API
suite against that isolated final-head database is `303 passed / 6 skipped`.
An initial full run used the unrelated local default database at 0021 and had
one migration-current environment failure; no shared/default database was
migrated, and the explicit isolated rerun is the release evidence.

Production closure used Actions run `31948357231` and immutable artifact
`9264075894` from source `baca93bdf6f2965c4f5614e296c12d337efc1a0a`.
The API/worker image ID was
`sha256:818c37bc703344ff6ce291c79a805832ad6ab4f24433323c6193622b24857395`
and the Web image ID was
`sha256:83ee77cc5b7b69b90fda804555f6eb3803063491f34aa19f4db50df968ae39a8`.
Production diagnostics returned `alive_idle` with a recent heartbeat through
the SSH plus API-container loopback boundary; a disposable product QA rebuild
observed `alive_busy` and then `alive_idle`. Public diagnostics returned a
concealed 404 with `Cache-Control: no-store` and `nosniff`. Response inspection
found no message, attachment, token, credential, payload or full-path fields.
The QA conversation was deleted through the product API. Production health,
Alembic head/current, image identity and post-deploy API/worker error counts
all passed.

## Release K residual production verification (2026-08-16)

Release K retained the reconciled 40-item inventory and executed only its seven
current production verification records. Production remains immutable Release I
runtime `7bcd686...`; Release J Actions run `31936666151`, artifact `9260977100`,
running image identity and Alembic `20260806_0021` remain authoritative. No
runtime or test-tooling source changed, so there was no production redeploy and
the historical Web/API/PWA matrices were not mechanically rerun.

The final inventory is:

| Classification | Count | Current interpretation |
| --- | ---: | --- |
| Current verification debt | 0 | All seven Release K records now have production evidence |
| Superseded/already closed | 26 | 19 closed by Releases A-J plus seven closed by Release K |
| Deferred by design | 8 | Release L/N/O or explicit architecture deferral |
| Conditional/external future | 6 | No current defect or unconditional product gate |
| Unknown | 0 | Every discovered logical candidate has an owner and classification |

### Native Chrome page zoom

The dedicated Chrome profile was changed with Chrome's native Page Zoom. The
controlled production page independently verified exact state changes relative
to the original 100% baseline:

| Chrome state | DPR | CSS viewport width | Ratio to baseline | Result |
| --- | ---: | ---: | ---: | --- |
| 100% baseline | 1.05 | 1830 px | 1.00 | PASS |
| 125% | 1.3125 | 1464 px | 1.25 | PASS |
| 150% | 1.575 | 1220 px | 1.50 | PASS |
| 200% | 2.10 | 915 px | 2.00 | PASS |
| 100% restored | 1.05 | 1830 px | 1.00 | PASS |

CSS zoom, transforms, device scale, viewport-only resizing and CDP page-scale
emulation were not used. Library, Reader, Source Editor, Files Panel, Viewer,
Share and core dialogs passed at 125% and 150%. The 200% matrix additionally
verified long Reader content, image/Markdown/PDF Viewers, preferences dialog,
Tab/Shift+Tab/Esc focus behavior, trigger focus restoration and reachable Save,
upload, Close and Download actions. Every checkpoint reported zero page-level
horizontal overflow; only intrinsic document/table/code surfaces retain local
scrolling. The PDF Viewer rendered a visibly nonblank canvas with its real
toolbar while the browser remained at 200%.

### Production Viewer fixtures

The Mermaid fixture rendered a complete data-URI SVG image with nonzero natural
and displayed dimensions, including the expected Upload, Canonical and Reader
nodes. DOCX, ODT, XLSX, ODS, PPTX and ODP all selected the expected online
Viewer path, rendered supported content, exposed Download and exactly one
accessible Close, closed with Esc and restored focus to the trigger. The
fixture matrix recorded zero CSP violations and no fatal Viewer error.

One React hydration warning already known from the earlier Offline Library path
was observed during initial setup; it did not recur as a Release K fixture or
zoom failure. An offline cached-blob DOCX fetch observation was excluded from
the online Viewer contract rather than used as production Viewer evidence.

The disposable Mermaid QA Conversation was permanently deleted through the
product UI and was absent after a fresh navigation. Chrome extension-popup and
OneTab handoff interruptions were recovered with a fresh controlled tab; no
product data or runtime changed. `TEST_RESULTS.md` does not exist at repository
root, while `docs/execution/TEST_RESULTS.md` remains dated historical evidence.

## Release J cleanup first-apply closure (2026-08-16)

No cleanup runtime code changed. Four explicit fixture gaps were added to
`tests/test_cleanup_execution.py`: recent generated staging protection,
retained conversation Export protection, wrong-category token rejection and
canonical DB-state preservation on partial unlink failure.

The focused local gate is:

```text
cd apps/api
python -m pytest -q \
  tests/test_cleanup_execution.py \
  tests/test_artifact_lifecycle.py \
  tests/test_artifact_transaction_boundary.py
```

Result: `32 passed / 1 skipped`. The skip is the Windows host's inability to
create the path-escape symlink fixture; exact-SHA Linux Actions executed the
cleanup safety step without a scoped skip. Actions run `31936666151` on
`81fb441f51984330042625aac4dabddfd78b0ebc` also passed lint, typecheck, Next
`16.3.1` Webpack build, full API, Alembic, dependency policy, browser matrices,
default PWA, scoped PWA negative and image inspection/package/upload.

Production evidence is not count-only. Dry-runs A/B plus the pre-apply scan
returned the same four opaque `ORPHAN_FINAL` tokens and `659,673` bytes. Apply
deleted exactly four with zero failures/skips; two post-apply scans had zero
eligible objects. Replaying the old token authority deleted zero and reported
four changed/stale skips. Before/after canonical counts and Export/Offline file
size checks were identical.

Isolated production Chrome passed Library, Reader, Source Editor real upload
and canonical save, Markdown Viewer, Files Panel, Share focus, Offline catalog,
committed Export download and zero CSP violations. A targeted production
classifier proved the new committed Export existed, matched its declared size
and was not a cleanup candidate. QA cleanup used the product API with 404
readback. The recent final file left by that disposable lifecycle is protected
by the 24-hour grace window and was not deleted.

The first two attempts to create the QA through Node `APIRequestContext`
encountered HTTPS `ECONNRESET` before the route reached API logs. Browser
same-origin `fetch`, which matches the application boundary, completed the
flow. This is recorded as recovered test transport behavior, not a cleanup or
product failure.

## Release I upload-token atomicity closure (2026-08-16)

The focused API gate is:

```text
cd apps/api
python -m pytest tests/test_attachment_scanner.py \
  tests/test_attachment_upload_api.py -q
```

Final result: `15 passed`. It proves structured rejection and
transaction rollback for active transient references at PATCH, conversation
create and message insert; acceptance of canonical references and occurrence
creation; allowance of bare/inline/fenced/indented code literals; idempotent
finalize; and concurrent optional MIME detection.

The browser gate uses the existing production build and no runtime fault
bridge:

```text
PLAYWRIGHT_USE_BUNDLED_CHROMIUM=1
E2E_ATTACHMENT_UPLOAD=1
corepack pnpm --filter web exec playwright test \
  --config=playwright.config.ts \
  e2e/source-editor-upload-atomicity.spec.ts \
  e2e/attachment-upload-flow.spec.ts
```

Final result: `18 passed / 0 failed / 0 scoped skipped`. Playwright route
barriers hold and release real upload/finalize/save requests; elapsed sleeps
are not the correctness authority. The matrix asserts zero PATCHes before
canonicalization, canonical-only payload/version reads, exact occurrence
counts, chooser/drop/paste convergence, fast/slow and B-before-A completion,
partial failure and single-flight retry, typing/cursor/selection/scroll,
delete-before-completion, undo/redo, and canonical drafts after 409/500.
`I-RACE-002A` additionally holds the lazy CodeMirror chunk, selects a file
before `.cm-content` exists, then releases editor creation and upload finalize;
this covers the exact real-production ordering that the first candidate
exposed.

The remaining final-source regression set passed: full API `285 passed / 5
skipped`, CSP `4/4`, focused Reader/Rich/security `36/36`, Share `2/2`,
mutation `2/2`, Markdown/image Viewer `1/1`, PDF `3/3`, default PWA `72 passed
/ 65 unrelated conditional skipped`, and scoped PWA negative `10/10` with
zero scoped skips. Lint, typecheck, Next `16.3.1` Webpack production build,
dependency policy and the zero high/critical gate also passed.

The historical attachment tests now wait for actual PATCH completion rather
than a transient `Saving...` button label. Cleanup retries only a transient
HTTP 500 caused by the test worker committing `conversation_derived_rebuild`
at the same instant, then requires a successful product API delete and a 404
readback. This retry is test cleanup, not upload correctness synchronization.

Actions run `31934088629` passed this gate and all release gates on exact SHA
`7bcd686b59d62fb9907ba09d644637b7af2b3d86`. The same immutable images passed
production identity checks. Standalone production Chrome then passed three
independent real chooser/upload/save/reload cycles: each captured PATCH and
canonical version contained `cr-asset://` and no `cr-upload://`, reload rendered
the attachment and Markdown Viewer opened it. The isolated PWA shell also
started offline and reconnected. Legitimate-path CSP violations were zero.
All disposable Conversations were deleted through the product API and returned
404. The post-deploy source-aware aggregate audit reported zero active
transient references in all and current MessageVersions without exposing
content, tokens or IDs.

## Release H CSP enforcement closure (2026-08-16)

Release H adds a production-build browser hard gate:

```text
corepack pnpm --filter web exec playwright test --config=playwright.config.ts \
  e2e/csp-enforcement.spec.ts
```

The four tests must all execute. They verify the exact enforcing response,
production absence of `'unsafe-eval'` and broad sources, controlled external
script/connect/image/object blocking, blob-worker blocking, real
`frame-ancestors` enforcement from a second origin, inline event-handler
blocking, and allowed same-origin/data/blob/style/manifest/Service Worker
resources. The harness records only directive/disposition and bounded URI
classifications; it does not persist raw URLs or content.

The Release E scoped PWA command remains a separate zero-skip gate. It now also
asserts the synthetic offline-incomplete 503 CSP:

```text
E2E_PWA_NEGATIVE=1
NEXT_PUBLIC_PWA_NEGATIVE_TESTS=1
NEXT_DIST_DIR=.next-pwa-negative
corepack pnpm --filter web build
corepack pnpm --filter web exec playwright test --config=playwright.config.ts \
  e2e/pwa-negative.spec.ts
```

Final Actions run `31906595581` on source
`da160a9c9a34dfe670fc67262cf3c8c9eedba07a` passed CSP `4/4`, Release C
`30/30`, full API `282 passed / 4 skipped`, PWA negative `10/10` with zero
scoped skips, default PWA `72 passed / 53 unrelated conditional skipped`,
focused Reader/Rich/Security `36/36`, PDF `3/3`, Markdown/image unified Viewer
`1/1`, Source Editor/mutation `2/2`, and Share `2/2`. Locked install,
lint/typecheck/Next `16.3.1` Webpack build, Alembic and dependency policy also
passed before images were built. Rich Markdown requires a real Shiki
highlighted token span plus zero enforced violation events, in addition to
KaTeX, MathML and sanitizer assertions.

A Windows Chromium process repeatedly exited when the desktop Share test tried
to create a new context after the long Reader group; all preceding tests and
the next worker's mobile Share passed, and the isolated Share suite passed six
times. This is treated as a deterministic test-process lifecycle defect, not a
rerun-based product PASS. CI therefore keeps CSP, long Reader/focused paths,
Share, mutation, Markdown/image Viewer, PDF and scoped PWA as separate hard
steps.

Production acceptance used an isolated Chrome profile and browser same-origin
`fetch` for disposable QA setup/cleanup. It did not use a logged-in user
profile, direct SQL, or Node APIRequestContext as release evidence. The final
scoped product run passed `3/3`: Reader scroll/Rich Markdown/Source Editor
mutation and reload; Markdown/image/PDF unified Viewer with a real PDF.js
worker and authenticated `206` Range; desktop and 390x844 Share single-dialog
and focus restoration. A separate clean-profile PWA offline/reconnect run
passed `1/1`. The deployed CSP block probes passed for external script/connect/
image/blob-worker/object and frame embedding, and legitimate paths produced
zero `securitypolicyviolation` events. A final product-API cleanup pass verified
zero Release H disposable Conversation titles remained.

The production smoke initially exposed a pre-existing Source Editor timing
race where an attachment upload can display ready before its `cr-upload://`
marker is replaced in the submitted document; the API safely rejects it with
422. This is not a CSP regression and is already represented by overlapping
uncommitted user editor work. Release H preserves those files and validates
Viewer data by upload-session/finalize plus insertion of the committed
Conversation attachment. Do not convert the exploratory 422 into a release
PASS or silently stage the user's editor changes.

## Release G PDF.js migration closure (2026-08-16)

Release G uses official `pdfjs-dist 6.2.108` with the modern ESM library and a
same-origin `pdf.worker.min.mjs`. The target requires Node `>=22.13.0`, so run
Release G Web commands under Node `22.13.1`. The production build remains
Webpack:

```text
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm --filter web build
```

The dedicated browser suite is `apps/web/e2e/pdfjs-migration.spec.ts` and is
explicitly enabled so its disposable API data is never created by the default
PWA matrix:

```text
E2E_PDFJS_MIGRATION=1
corepack pnpm --filter web exec playwright test e2e/pdfjs-migration.spec.ts --config=playwright.config.ts
```

It must prove a real Worker event and local worker response, library/worker
version `6.2.108`, non-empty canvas pixels, single/multi-page fit/navigation,
authenticated `206` Range, maximize/Escape/focus behavior, malformed PDF
isolation and no JavaScript execution from a controlled malicious fixture.
The fixture Conversation and attachments are synthetic and must be removed
through the product API.

Release G also requires:

```text
corepack pnpm run test:api
cd apps/api; python -m alembic heads
cd apps/api; python -m alembic current
corepack pnpm --filter web test:pwa
E2E_PWA_NEGATIVE=1
NEXT_PUBLIC_PWA_NEGATIVE_TESTS=1
NEXT_DIST_DIR=.release-e-negative-next
corepack pnpm --filter web exec playwright test e2e/pwa-negative.spec.ts --config=playwright.config.ts
```

The default PWA matrix reports unrelated conditional skips separately. The
Release E scoped negative matrix must execute with zero scoped skips and must
cover the local PDF worker/original missing offline path. Focused regressions
must retain unified non-PDF Viewer behavior, Reader scroll stability, Rich
Markdown/KaTeX/MathML, Source Editor and the 390x844 Mobile Share
single-dialog/Escape/focus contract.

Current-source local evidence is PASS: Web lint/typecheck/Next 16 Webpack
build; API `280 passed / 6 skipped`; Alembic current/head single
`20260806_0021`; and dependency policy with zero blocked and zero unapproved
findings. The combined owner/Share/security PDF gate is `10/10`, including
real worker, exact version match, nonblank single/multi canvas, authenticated
Range, lazy loading, focus, malicious script isolation and corrupt-file
recovery. Broader focused browser regression remains `38/38`, and Source
Editor/mutation is `2/2`.

The final CI default PWA matrix is `68 passed / 53 conditional skipped`;
three additional conditional skips are the opt-in Release G PDF suites and
were executed separately. The Release E scoped negative matrix is `10 passed
/ 0 scoped skipped`, including local PDF worker inventory and missing-worker
recovery. Skips remain skips and are not counted as PASS.

Actions run `31896564657` tested frozen source
`1b752b77063893feefef01756af9deda559f30a5`. It passed locked install,
lint/typecheck/Next Webpack build, API `282 passed / 4 skipped`, Alembic,
dependency policy, focused browser `38/38`, maintained PDF `3/3`, default PWA
and scoped negative PWA before image construction. The Docker log explicitly
records `next build --webpack` and `Next.js 16.3.1 (webpack)`.

Production acceptance used installed Chrome `151.0.7922.138` through isolated
Playwright contexts and the public HTTPS origin. It verified real worker,
version match, single/multi canvas, owner/Share Range `206`, Share scope,
Fit Page/Width, 110% zoom, page navigation, maximize/Escape/focus, and a real
offline package/IndexedDB/service-worker PDF open followed by reconnect.
Separate production smokes passed Rich Markdown/KaTeX/MathML, image/Markdown
unified Viewer, Source Editor input/backspace, desktop Share and the mandatory
390x844 single-dialog/Escape/focus contract. Synthetic QA Conversations were
deleted through the product API; no direct SQL cleanup was used.

The first zoom evidence attempt used an over-broad icon selector and timed
out after all earlier PDF assertions passed. Its QA Conversation was then
deleted through the product API. The corrected accessible-name selector
passed in `21.4s`; the failed attempt is retained as test-harness evidence and
is not classified as a product failure.

An exploratory `E2E_RICH_MARKDOWN_ATTACHMENT` production run exposed an
existing upload-placement timing race: the editor can still contain a
transient `cr-upload://` reference when save begins. This path is outside the
PDF.js change, the relevant runtime files are byte-identical to Release F, and
the required Source Editor type/backspace/close regression passed. Keep the
race as separate follow-up work; do not use the optional failed run as Release
G PDF evidence or conceal it as a PASS.

## Release F Next 16 final closure (2026-08-15)

The current worktree uses locked Next `16.3.1`, React/ReactDOM `19.2.8`,
Node 20.13.1 and the explicit `next build --webpack` path. Final local gates
passed lint, typecheck, Webpack build, API `280 passed / 6 skipped`, Alembic
`20260806_0021` current/head and dependency policy (`unapproved=0`).

The focused browser command was rerun against the current source after the
async `headers()`/route-param and React 19 ref fixes. It passed 38/38 tests,
including Rich Markdown/KaTeX/MathML, Viewer, Reader wheel/thumb/TOC and
restoration, security/CSP-equivalent checks, desktop Share and the mandatory
390x844 More -> Share single-dialog/Escape/focus contract. The Reader
restoration subset was run with the isolated API import worker because those
fixtures require committed imports.

The current-source default PWA baseline is `68 passed / 50 unrelated
conditional skipped`; the dedicated Release E scoped negative matrix is
`9 passed / 0 scoped skipped`. Normal production chunks contain no PWA test
fault bridge or benchmark fixture. Final Actions run `31887198941` passed
quality, image inspection, packaging and checksum generation; the artifact
SHA-256 is `739435634b6a4ebe52597d9db6887c3599c10a6fb5441f1032b01981923e5b84`.
King recomputed the same hash, verified backup
`/opt/chat-reader/backups/release-f-final-20260815T134803Z-c9ddae1`, and
confirmed running image identities match the manifest. Isolated production
Chromium passed PWA shell/offline/reconnect, Reader KaTeX/MathML, 390x844
Share single-dialog/Escape/focus, mutation/Source Editor, attachment Viewer
and disposable PDF canvas acceptance. `RELEASE_F = PASS`; unrelated default
PWA skips remain skips.

## Release E PWA negative matrix (2026-08-15)

Release E adds a dedicated production-build browser matrix for scoped
Offline/PWA negative paths:

```text
E2E_PWA_NEGATIVE=1
NEXT_PUBLIC_PWA_NEGATIVE_TESTS=1
NEXT_DIST_DIR=.release-e-negative-next
corepack pnpm --filter web exec playwright test e2e/pwa-negative.spec.ts --config=playwright.config.ts
```

The matrix uses real Cache Storage, Service Worker, IndexedDB, offline network
state, Chromium quota override and an isolated persistent browser profile. It
covers critical and optional shell misses, online recovery, shell cache quota,
offline attachment and Viewer misses, corrupted cached bytes, quota/cache put
failure after a partial write, Dexie transaction abort, truncated package,
browser/SW restart, idempotent retry, package identity preservation,
offline-to-online recovery and bounded network flapping. Current local result:
9 passed / 0 scoped skipped.

The prior default PWA baseline was 67 passed / 50 skipped. The current full
local run is 68 passed / 50 skipped because it includes the normal production
bundle fault-bridge assertion added in Release E. Those skips remain unrelated
conditional fixture/production-copy flows and are not counted as Release E
PASS. The normal production bundle is separately checked to ensure
window.__chatReaderPwaNegativeTest is absent.

Final CI run `31874712687` executed the scoped negative matrix in the quality
job before image construction and passed all 9 browser tests with zero scoped
skips. The same run passed Web lint/typecheck/build, the API full suite,
Alembic, Release A/B/C/D regressions, the default PWA matrix, image inspection
and archive checksum generation.

Post-deploy production Chromium used an isolated disposable profile rather than
the operator's normal browser data. It verified the active Service Worker,
75/75 critical cached shell resources, offline `/library` HTTP 200, 390px
reflow, reconnect, zero CSP violations, Reader KaTeX/MathML and the single
mobile Share dialog/focus contract. Quota, interruption and cache-corruption
faults remained confined to the production-build CI/local matrix; production
did not receive fault injection. The unrelated 50 default-matrix conditional
skips remain reported as skips.

## Release D performance and capacity characterization (2026-08-15 final)

The Release D workflow is an external Linux characterization run, not a
production stress test:

```text
quality
  -> Reader capacity (398/1k/10k x plain/math/mixed/real attachment metadata)
  -> import/export RSS and elapsed measurements
  -> isolated .cr v4 export/restore (current/2x/10x)
  -> PostgreSQL EXPLAIN (ANALYZE, BUFFERS)
  -> Release A/B/C, Rich Markdown, Reader, and default PWA regression
```

The deterministic fixture uses seed `20260814`. Attachment metadata fixtures
use real business Attachment rows with distinct identities, one shared
AssetObject, and current occurrences; they are reconciled through the API after
import. API/worker RSS is sampled from Linux `/proc`, browser working set is
measured by DOM/Playwright telemetry, and no source text is recorded. The
quality job must pass before any characterization job starts. Conditional
skips remain separate from pass counts.

The final Actions run `31865404393` completed successfully after an unchanged
regression rerun. Reader capacity and backend measurements passed the functional
and bounded-working-set gates; 10k Markdown export and few-huge import are
explicit WARNING capacity boundaries. Release D does not weaken the historical
Reader budgets, add a migration, run large workloads on King, change the `.cr`
format, or perform a product architecture rewrite. See [the capacity contract](system/PERFORMANCE_CAPACITY_CONTRACT.md)
and [the dated evidence report](evidence/PERFORMANCE_CHARACTERIZATION_REPORT_2026-08-14.md)
for classification and final numbers.

## Release C observability and cleanup (2026-08-14)

The Release C safety suite is part of the release workflow before the API full
suite and therefore before image construction:

```text
cd apps/api
pytest -q tests/test_observability.py tests/test_diagnostics.py \
  tests/test_artifact_lifecycle.py tests/test_cleanup_execution.py \
  tests/test_artifact_transaction_boundary.py tests/test_import_queue.py
```

Coverage includes UUID request IDs for success/400/404/409/500, route-template
logging, query/header redaction, logging failure isolation, diagnostics default
disablement and bounded queries/scans, path-scoped/chunked cleanup lookups,
current/active/recent/unknown/AssetObject protection, Offline superseded
classification, dry-run, explicit apply, canonical/active race recheck,
idempotence and partial unlink failure. Release B publication and bounded Import
retry tests run in the same focused gate.

Current Windows focused result is `28 passed / 1 skipped`; full API is
`279 passed / 6 skipped`; Web lint/typecheck/production build PASS; Alembic is
the single `20260806_0021` head; default PWA is `67 passed / 37 conditional
skipped`. The focused skip is symlink path-escape coverage because this host
cannot create the test symlink. Linux CI must execute it; no skip is a PASS.

Final Release C workflow run `31789905868` passed quality, image inspection,
artifact packaging/checksum, full API, focused browser and default PWA jobs for
source `8d0ad66`: Release C focused `30 passed`, API `282 passed / 4 skipped`,
focused browser `28 passed`, and PWA `67 passed / 37 skipped`. Production
recheck verified one request-completion event for
both a successful request and a controlled 404, with no raw query marker or
Uvicorn access line. The first post-deploy check found that production INFO
events were not emitted by the unconfigured application logger; the bounded
logger-handler fix added a subprocess regression and was rebuilt before final
deployment. Production dry-run was repeated twice with no deletion and stable
aggregate counts; manual apply remains unexecuted.

## Release A safety baseline (2026-08-13)

The release workflow runs the default commands plus a real PostgreSQL service, `alembic upgrade/current`, the official npm-registry audit policy, a live API/worker, focused production-build browser tests, and the default PWA baseline before any image build. `build-images` requires successful `quality`; diagnostic quality evidence is explicitly non-deployable.

Focused regressions cover production secret rejection/acceptance, Alembic `%` and encoded credentials, actual HTTP security headers, absence of `X-Powered-By`, CSP Report-Only, the single PDF.js `isEvalSupported=false` path, Mermaid strict mode, the long import commit proxy, and workflow ordering. Local results are lint PASS, typecheck PASS, build PASS, API `251 passed / 4 skipped`, Alembic `20260806_0021 (head/current)`, focused browser `6/6`, and default PWA `67 passed / 36 skipped`. The 36 Playwright skips are conditional online-write/fixture/production-copy flows and are not counted as PASS; the release workflow explicitly enables its focused online subset.

The production secret regression rejects missing, empty, development-default and known-placeholder values. It accepts custom values without imposing a length threshold, following the approved Release A policy revision. Tests use synthetic values and never read a production secret.

Release workflow evidence is three-layered rather than inferred from YAML. Runs `31705576354` and `31706041697` failed at early and late quality stages respectively; both skipped `build-images` and produced no deployable archive. Run `31706522862` passed every quality step and only then built, inspected, checksummed and uploaded the release archive. Production headers are not marked PASS because deployment was stopped by the production-secret gate.

## Manual TOC refresh (2026-08-13)

`test_toc_api.py` 覆盖只更新对话目录、只更新当前对话章节目录、同时更新且章节范围为全部对话、幂等 key、未选择任何目标的 `422`，并断言派生重建不会提升 Conversation revision。`toc-refresh-contract.spec.ts` 固定 Reader 右上角 More 入口、两个默认选中目标、当前对话默认范围、全部对话选项、统一 Dialog focus、worker polling 和精确 query invalidation。

本轮结果：TOC route `3 passed` + builder `1 passed`，Web contract `1 passed`，全 API `236 passed / 4 fixture-gated skipped`，PWA/Playwright `59 passed / 36 environment-gated skipped`，lint/typecheck/build PASS，Alembic single head `20260806_0021`。PWA 的 API-dependent 场景因默认矩阵未启动 API 而 skip，不计为 PASS。

生产 Chrome 使用隔离 QA Conversation 验证 combined/current、dialogue-only、section-only 三种提交、默认值、all-scope 选择器、initial focus、single accessible Close、Esc focus restore、完成 live status 与刷新稳定性。生产没有执行 all-conversations section rebuild，因为它会重建真实业务对话的派生 Heading；该分支由实际 API/worker 集成测试执行，不将其冒充为生产 PASS。

## Import compatibility v5 (2026-08-12)

The import regression matrix now covers Prompt-only/Response-only paired Markdown, arbitrary single-role Markdown rejection, blank JSON messages at head/middle/tail, empty Markdown sections, missing non-empty messages at head/middle/tail, normalized matches without timestamps, duplicate ambiguity, timestamp mismatch, lossy JSON plus rich Markdown, old Markdown repair and the existing full-flow contract.

The user-supplied pair is read directly from `CHAT_READER_IMPORT_PAIR_JSON` and `CHAT_READER_IMPORT_PAIR_MARKDOWN`; the tests perform Preview only and never change the source directory or commit the conversation. Current results: exact supplied-pair compatibility `61 passed / 2 fixture-gated skipped`; isolated production-build file-chooser Preview `1/1 PASS`; real 398-message preview/commit/idempotent-retry matrix `12 passed / 1 fixture-gated skipped`; full API `235 passed / 4 fixture-gated skipped`; Web contract `2/2`; default PWA `57 passed / 36 environment-gated skipped`; Web lint/typecheck/build PASS. Skips are reported separately and are not PASS.

The final production multipart Preview of the supplied pair returned HTTP `200` in about 1.5 seconds with one non-empty exact-match message, `can_commit=true` and no warning. It was not committed. The resulting preview-only ImportRecord is left to the existing TTL because the product does not expose a safe immediate-delete endpoint; tests and cleanup must not substitute direct SQL deletion.

Unique role/timestamp identities use the linear alignment regression in `test_exporter_aligner.py`. The 398-message preview assertion must remain under 20 seconds. Structured logs split JSON parsing, Markdown parsing and alignment so a future proxy timeout can be assigned to the actual stage.

## Archived project deletion (2026-08-12)

`test_projects_api.py` verifies that active/default projects cannot be deleted, an archived project can be deleted, its conversations remain under Unclassified with a new offline revision, and a repeated delete returns `404`. `archived-project-delete.spec.ts` freezes the single/batch UI, irreversible confirmation copy, retained-conversation wording, API call and cache refresh contract. Current results: focused API `9/9`, Web contract `1/1`, lint/typecheck/build PASS, full API `220 passed / 3 fixture-gated skipped`, Alembic head `20260806_0021`.

## AI Rich Markdown release (2026-08-12)

The current parser/browser matrix is split by evidence level:

| Suite | Current result |
| --- | --- |
| `ai-rich-markdown-parser.spec.ts` + static contract | `4/4 PASS` |
| Reader/Editor/security/109-formula stress + attachment flow | `8/8 PASS` |
| Real `.md` chooser/upload/save/inline/Viewer | `1/1 PASS` |
| Heavy Owner/Share Reader restoration and wheel regression | `8/8 PASS` |
| Offline KaTeX font inventory + cold start | `1/1 PASS` |
| Default PWA matrix | `45 passed / 31 conditional skipped`; skips are not PASS |

Release browser command (API and production Web server must already be running):

```powershell
$env:PLAYWRIGHT_REUSE_EXISTING_SERVER='1'
$env:E2E_RICH_MARKDOWN='1'
$env:E2E_RICH_MARKDOWN_ATTACHMENT='1'
corepack pnpm --filter web exec playwright test `
  e2e/ai-rich-markdown.spec.ts `
  e2e/ai-rich-markdown-attachment.spec.ts `
  e2e/ai-rich-markdown-parser.spec.ts `
  e2e/ai-rich-markdown-contract.spec.ts `
  --config=playwright.config.ts
```

The browser fixture creates a QA-only two-message Conversation through the canonical create API, validates Reader and Source Editor semantics, and deletes the Conversation through the product API. The attachment fixture waits for upload resolution, then requires the first message PATCH to return 2xx before asserting inline and Viewer semantics. This specifically guards the resolved-draft race where CodeMirror had replaced `cr-upload://` but React still held the stale marker.

The compatibility matrix covers all four math delimiters, golden boxed limit, aligned/matrix/cases/Chinese text, invalid LaTeX, 109 formulas in one message, currency, inline/fenced code exclusion, GFM table/task/strike/autolink, cross-block footnotes, unsafe HTML/URL, untrusted KaTeX command, remote image non-fetch, MathML and 360px local overflow. Screenshot evidence is synthetic QA data only.

KaTeX offline readiness requires the active shell record to contain current `KaTeX_Main` and `KaTeX_Math` font URLs. CSS import alone is insufficient evidence. `library-offline.spec.ts` performs a real service-worker cold start after asserting those required assets.

Production commit `4d07ce4` was exercised with a disposable synthetic Conversation in real Chrome. DOM evidence recorded five KaTeX/MathML expressions, two display expressions, one semantic table, namespaced footnote reference/backlink, code isolation, inert unsafe HTML/link handling, literal currency, and zero page-level horizontal overflow. Source Editor preserved the raw bracket delimiter and selection offset across type/backspace. The QA Conversation was removed through the product API.

The exact 360/390/768 suite remains production-build browser evidence. The external Chrome extension advertised viewport control but did not return a callable override in this session, so it is not relabeled as exact production viewport evidence. A production screenshot timed out; this does not replace the passing DOM/source assertions, and local synthetic screenshots remain the visual evidence. The `/library` DOM reported an active 78-resource offline shell; exact `KaTeX_*` cache membership is asserted by the production-build service-worker cold-start test because Cache Storage is not exposed by the Chrome read-only page evaluator.

The reported production ChatGPT fixture adds distinct compatibility regressions: outer backslashes may already be gone, delimiters may be `/[`/`]/`, the surviving formula may span paragraph and heading API RenderBlocks, and inline `\(n^6\)` may arrive as bare `(n^6)`. `ai-rich-markdown-parser.spec.ts` asserts strict source-range recognition, compact inline/bracket expressions, slash delimiters, bounded Setext normalization and prose/date/version/code/currency exclusion. `ai-rich-markdown.spec.ts` asserts Reader/Editor semantics, MathML, canonical-source preservation and Preview-default-collapsed behavior. `production-rich-markdown-copy.spec.ts` accepts an ephemeral UTF-8 Base64 source, creates a QA-only copy, expands Source Preview for full semantic coverage and deletes the copy through the product API.

Current v4 focused results: parser/shared contract `14/14`, Reader/Editor/security/stress `5/5`, two exact reported-source copies `1/1` each, and Markdown attachment shared renderer `1/1`. The default PWA matrix is `58 passed / 36 conditional skipped`; skipped online/fixture-gated cases are not PASS. The first full-source preview rendered 108 display formulas and at least 108 MathML trees. The second renders 41 display formulas/MathML, includes common scientific commands and the eight bounded conceptual labels, and leaves zero formula errors or bracket paragraphs. Earlier v1/v2/v3 evidence remains historical rather than final v4 production proof.

## Formula scroll stabilization (2026-08-13)

Focused Reader block estimator and Rich Markdown parser regressions pass `17/17`. Coverage includes display formula bounded-height estimation, aligned multi-row estimation, code/currency exclusion, ChatGPT delimiter compatibility and canonical parser behavior. Web typecheck, production build and focused ESLint pass. The full browser Rich Markdown suite was skipped because the local run lacked its API/fixture server; those cases are not counted as PASS. Production frame interval, long-task, cache-hit and long-reader wheel metrics remain `NOT_PRODUCTION_VERIFIED` until a production-equivalent fixture run is executed.

Production Chrome v3 evidence is an intermediate release check: the first reported page rendered one visual heading formula without exposing the hidden MathML/annotation layers, and the second rendered 33 scientific display formulas with zero errors. That check discovered eight standalone conceptual labels still displayed as brackets, so v3 is not the final PASS.

Final v4 production evidence is PASS. Read-only Source Preview audits began collapsed and were expanded explicitly. The first reported page retained 108 display formulas, zero errors and one semantic/visual heading formula. The second produced `41/41` display formulas and MathML trees, all eight bounded conceptual labels exactly once, zero errors and zero residual literal bracket paragraphs. Both editors were returned to reading mode without saving. The default PWA matrix remains `58 passed / 36 conditional skipped`; those skipped online/fixture-gated cases remain separate verification debt rather than PASS.

## Offline/context delivery regression coverage (2026-08-11)

`apps/web/e2e/library-offline.spec.ts` covers active-shell immediate startup, failed update preservation, deterministic Skill asset caching, read-only current-conversation files, cached/missing attachment handling, local CanJSON/Markdown/`.context.zip` export, both Chinese and English Skill SHA-256 values, download-plus-copy clipboard rejection, inert Skill viewing/download and exact 360x800, 390x844 and 768x1024 reflow.

The full local matrix completed with `41 passed / 27 skipped`. The skips are conditional API/fixture-backed flows (upload/import/online reader/share) because the PWA web server was intentionally run without an API at `127.0.0.1:8000`; they are not counted as PASS. Offline quota exhaustion, interrupted package writes, reconnect synchronization and production network interception remain `NOT_PRODUCTION_VERIFIED`.

The local offline exporter is intentionally bounded to the downloaded snapshot and does not replace the server export contract. Any future change to manifest compatibility must add an API/import round-trip test before release.

## Reader wheel stabilization 2026-08-10

The production-equivalent fixture contains three heavy Assistant messages with 402, 389 and 501 mixed paragraph, CJK, emoji, heading, list, table and short/long-code blocks. It may be created by the suite or reused explicitly:

```powershell
$env:E2E_LONG_READER='1'
$env:E2E_LONG_READER_CONVERSATION_ID='<qa-conversation-id>'
$env:E2E_LONG_READER_TARGET_MESSAGE_ID='<qa-message-id>'
$env:E2E_LONG_READER_TARGET_BLOCK_INDEX='180'
$env:E2E_LONG_READER_ANNOTATION_QUOTE='<qa-quote>'
corepack pnpm --filter web exec playwright test e2e/reader-restoration.spec.ts e2e/reader-block-layout.spec.ts --config=playwright.config.ts
```

The suite asserts estimator bounds, direct/search/annotation navigation, refresh restoration, TOC virtualization, preference anchoring, Owner and Share reuse, 30 monotonic wheel steps, at most six mounted messages, bounded virtual rows, no row gaps/overlap, no middle-window turn fetch, no save during wheel input and exactly one save after idle. Current result: `9 passed`.

Performance gating is opt-in so slow CI hardware does not hide functional failures:

```powershell
$env:E2E_READER_PERF_BUDGET='1'
corepack pnpm --filter web exec playwright test e2e/reader-restoration.spec.ts --config=playwright.config.ts --grep 'continuous wheel' --repeat-each=3
```

Current production-build Chromium results were `16.7ms` p95 frame interval in all three runs; longest task was `72/68/70ms` and five-second long-task total was `72/68/70ms`. Budgets are p95 `<=34ms`, no task `>150ms`, and total long-task time `<=250ms`.

Release checks for this change: Web lint/typecheck/build PASS; API `216 passed / 3 skipped`; Alembic one head `20260806_0021`; PWA default `37 passed / 22 conditional skips`. Conditional PWA skips remain `PARTIAL_PASS`, not PASS.

## Release-Readiness Audit 2026-08-10

- Required local baseline: lint, typecheck and production Web build passed; API `216 passed, 3 conditional skips`; PWA `30 passed, 21 conditional skips`; Alembic has one head `20260806_0021`. Conditional skips are not PASS.
- Real production Chrome acceptance was read-only for existing business data. QA-only conversations verified creation, insertion, source task toggle, deletion/undo, restricted Share/revocation and the direct API import follow-up. Existing acceptance fixture verified attachment Renderers, Range and adaptive visible Viewer panels.
- The supplied JSON + Markdown pair previewed exactly 398 nonempty messages and committed without a 500 through the production multipart API. Browser chooser interaction remains `NOT_PRODUCTION_VERIFIED` because this Chrome integration cannot inject chooser selections.
- Release blockers: active unreferenced Attachments missing from Files Panel filters and a non-functional delete-undo toast. The detailed report, QA cleanup record and redacted evidence are in [UX_RELEASE_READINESS_AUDIT_2026-08-10.md](evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md).
- Production negative offline/weak-network faults, 360px and browser zoom matrix, QA export/restore round trip and conditional PWA scenarios remain `NOT_PRODUCTION_VERIFIED` until separately executed.

## Release Stabilization 2026-08-10

- Root-cause fixes: delete/restore now return the committed conversation revision; edit/task/version responses do the same; Web seeds the create response, applies insert/edit/task/version/delete/restore revisions immediately, and preserves a retryable Undo state. Restore is idempotent.
- Attachment API rows expose `current_occurrence_count` as a projection. Active zero-reference rows remain eligible for All/Unreferenced; detached rows remain excluded. No occurrence/AssetObject merge or migration was introduced.
- Managed dialogs use `useDialogFocus` for synchronous meaningful focus, Tab/Shift+Tab trapping, Escape and logical trigger restoration after pointer defaults. Backdrops are pointer-only `aria-hidden` surfaces, so each dialog has one accessible visible close button. Attachment Viewer restoration falls back to the current connected Attachment trigger if React replaced the opener node.
- Disabled Scanner messaging is neutral `Info` + `未扫描`; it is not rendered as clean/safe or as an attachment fault. Project creation uses Chinese `新建项目` labels and autofocuses the inline field.
- Verification: targeted API `10 passed`; full API `216 passed / 3 skipped`; Web lint/typecheck/build PASS; focused stabilization contracts `4 passed`; PWA default `30 passed / 21 skipped`. Production Chrome on final commit `ed9116a` passes Viewer initial focus, keyboard loop, Esc/X/backdrop restoration, single close/Shell, and Project-create autofocus/Escape restoration. The bridge's requested 390px viewport rendered at 433px without page horizontal overflow. Exact 360/390, real 125/150/200% zoom and forced-offline negative paths remain `NOT_PRODUCTION_VERIFIED`; skips are not release PASS.

## Attachment Inline Layout System

- Focused Playwright policy tests: `13 passed` across InlinePresentation mapping, six centralized lane contracts, justified last-row bounds, progressive disclosure, runtime FileList fallback, CSV/TSV Table/Raw behavior and unchanged adaptive Viewer behavior.
- Web lint, typecheck and production build: PASS.
- API regression: `216 passed, 3 skipped`; skipped fixture-gated cases are not PASS.
- PWA default matrix: `28 passed, 21 skipped` (`PARTIAL_PASS`). Online/fixture-gated upload, full Reader and restoration scenarios require explicit services/flags.
- Alembic: one head `20260806_0021`; no migration.
- Production Chrome evidence: the deployed acceptance conversation verified group-owned lanes, one Viewer shell, CSV Table default, Raw toggle and return to Table. The broader visual matrix (all requested formats and mobile widths) remains `NOT_PRODUCTION_VERIFIED` unless separately captured; skipped cases are not PASS.
- Caption follow-up: focused policy tests `6 passed`; final production Chrome found zero legacy `Attachment:`/`附件：` captions duplicating Preview-header filenames. All three CSV Table actions remained available.

Local checks for the conversation, import and viewer addendum:

- `pytest -q` API suite: `216 passed, 3 skipped`.
- Real JSON + Markdown fixture (`CHAT_READER_E2E_FIXTURE_DIR=<EXAMPLES_DIR>`): 398-message preview, commit and repeated commit passed; local test harness elapsed 17.7 seconds.
- Web lint, typecheck and production build: PASS.
- Attachment renderer policy/presentation Playwright tests: PASS.
- Full King browser verification of new message dialogs and complex Office/ZIP viewers: `NOT_PRODUCTION_VERIFIED` until a dedicated deployment test is run. Skipped scenarios are not PASS.

## Reader Wheel Performance Regression

- `reader-block-layout.spec.ts` verifies paragraph, CJK/emoji, explicit-line, heading, code and empty-block estimates against stable layout metrics.
- `reader-restoration.spec.ts` verifies monotonic 30-step wheel input, bounded warmed height correction, no middle-window turn request, one idle position write, TOC follow, preference anchoring, annotation/refresh restoration and Share Reader reuse.
- Performance budgets run on a production build three times; report the median and every raw run. Functional invariants must never be skipped because a CI host is slow. Timing-budget failure may be reported as environment-specific only when all functional invariants still pass.
- 2026-08-10 local production-build result: p95 frame interval 16.7ms; longest task 72/68/70ms; total long-task time 72/68/70ms. Production Chrome read-only wheel evidence was monotonic with zero reverse steps and an 85px warmed height correction over about 1,080px.

## Reader Scrollbar Jump Regression

- `reader-restoration.spec.ts` changes an upstream virtual height after a heavy message has cached its absolute margin, jumps into that message, and requires a visible block plus reading-line coverage within the recovery budget. A visible Message shell without a visible block is a failure.
- The pointer-drag regression holds an active pointer while moving the Reader to the edge. It asserts that no `reader-turn` request starts while the pointer is held, then that exactly one request starts after release.
- Run the production-equivalent path with `E2E_LONG_READER=1`; the default PWA matrix intentionally reports these fixture-gated cases as skipped rather than PASS.

## Final Release Closure 2026-08-11

### Current command results

| Check | Result |
| --- | --- |
| Web lint / typecheck / production build | PASS |
| Full API | PASS: 218 passed, 3 skipped |
| Alembic | PASS: one head `20260806_0021` |
| Default PWA | PARTIAL_PASS: 37 passed, 27 conditional skipped |
| Mutation lifecycle/stabilization | PASS: 5/5 |
| Long Reader restoration | PASS: 8/8 |
| Offline baseline | PASS: 6/6 |
| File chooser/upload lifecycle | PASS: 5/5 |
| Flagged import/task/DnD | PASS: 3/3 |
| Sharing/system archive/manual targeted | PASS: 13/13 |

The default 27 skips are classified, not erased: 18 long-Reader/layout cases are environment/fixture-gated, 8 upload/import/task/DnD/mutation cases are online environment-gated, and 1 attachment case is fixture-gated. Release runs explicitly enabled the meaningful mutation, upload, import/task/DnD and long-Reader suites. A local reader-layout attempt using a production-only conversation ID produced four fixture-resolution failures; it is not a product PASS or failure and is superseded by exact production viewport checks and the valid long-Reader fixture.

### Release test status rules

- API PASS does not imply a complete user-flow PASS.
- Latest higher-level production E2E overrides older component/API evidence.
- A conditional skip remains unverified until its required service, fixture and flag are supplied.
- Device-scale-factor is not accepted as browser 125/150/200% zoom.
- Production bridge chooser limitations are recorded separately from Playwright's real `setInputFiles` coverage.
- `.cr v4` restore runs only in an empty production-equivalent instance, never by clearing production.

Actual browser zoom and the Offline negative matrix (runtime chunk miss, original/derivative miss, quota, interrupted package and reconnect) remain `NOT_PRODUCTION_VERIFIED`; therefore the strict Core and PWA release gates remain `PARTIAL_PASS`.

## Attachment Workspace And Markdown Source Regression 2026-08-11

- `release-stabilization-contract.spec.ts` freezes `reader-floating`, `left/top` CSS geometry, the whole-header drag handle, `grab/grabbing`, the accent `Paperclip`, stable CodeMirror setup/update callbacks, external `editorDocument` ownership and the Reader editable-target keyboard guard.
- `release-mutation-lifecycle.spec.ts` reads the real CodeMirror selection through the host's `data-cursor-offset`. DOM `Range` is not valid evidence for the whole source because CodeMirror virtualizes lines. The test moves to the bottom of a long source, types one character, deletes it and asserts exact cursor restoration plus no backward scroll correction.
- Current release results: API `218 passed / 3 skipped`; Alembic one head `20260806_0021`; default PWA/Playwright `39 passed / 27 conditional skipped`; static stabilization contract `6/6` PASS; production-equivalent source cursor/mutation flow `2/2` PASS. Production Chrome repeated the type/delete path at source offset 21860 with an unchanged 41091px scrollTop and unchanged active message.
- Production Chrome verified the attachment workspace default geometry, visible accent icon and computed `cursor: grab`. The bridge does not expose a physical pointer API; real drag/persistence/reset remains covered by the Playwright `reader-layout` mouse test and must not be reported as a production-bridge pointer PASS.

## Release A Production Closure 2026-08-13

| Evidence | Result |
| --- | --- |
| Final GitHub Actions quality and image gate | PASS, run `31713379831` from `1d366fb` |
| Quality-failure artifact block | PASS, retained controlled-failure runs `31705576354` and `31706041697` did not publish deployable images |
| Official registry provenance | PASS, exact Mermaid `11.16.1` and PostCSS `8.5.26` lockfile integrities match npm registry metadata |
| Production secret guard | PASS, tests and value-safe production preflight; no secret value observed |
| Alembic percent-URL handling | PASS, focused encoded URL tests and production current/head `20260806_0021` |
| Production HTTP headers | PASS, `nosniff`, referrer, permissions, CSP Report-Only; no `X-Powered-By` |
| Production Library/PWA availability | PASS, Library reports a ready offline shell and no page overflow |
| Production Rich Markdown/KaTeX | PASS, KaTeX/MathML present, no math error or page overflow |
| Production PDF Viewer | PASS, canvas rendered; one accessible close; Esc returned focus to `打开 sample.pdf` |
| CSP Report-Only browser smoke | PASS, no CSP violation in Library, Reader/KaTeX or PDF Viewer |
| Production Mermaid renderer | NOT_PRODUCTION_VERIFIED, no safe Mermaid QA fixture; strict-mode CI regression remains PASS |

The desktop Share utility drawer opened successfully, but Esc restoration landed on `body` rather than the Share trigger. This is an observed P2 accessibility defect, deferred by user direction to the next round. It is not counted as a Share-focus PASS and does not alter the Release A security/provenance gate.

## Release B Artifact Integrity Closure 2026-08-14

- `tests/test_artifact_lifecycle.py` covers same-filesystem staging, ZIP validation, atomic rename failure, outer rollback preservation, cleanup debt and protected dry-run classification.
- `tests/test_artifact_transaction_boundary.py` invokes the real BackgroundJob publication path with an injected outer commit failure. The previous Offline package remains referenced and downloadable; the new published file is allowed to remain an unreferenced orphan. Export commit failure leaves no committed artifact row and does not expose a download.
- `tests/test_import_queue.py` covers stale recovery below the ceiling, terminal failure at three attempts, scanner non-recovery of terminal records and an explicit bounded manual retry lifecycle.
- Local final result: focused `.cr`/transaction tests `10 passed / 1 PostgreSQL-gated skip`; full API `264 passed / 5 skipped`; Web lint/typecheck/production build PASS; Alembic remains `20260806_0021`. The local build uses `NEXT_DIST_DIR=.release-b-next` backed by the user-approved disposable build-cache directory. Skips remain separate from PASS.
- `share-drawer-focus.spec.ts` creates and deletes its own QA Conversation and asserts initial focus plus `document.activeElement` after Esc, X and backdrop. It runs only in the full online matrix via `E2E_SHARE_DRAWER_FOCUS=1`, never in the lightweight PWA matrix. The previous Release A production failure is preserved as historical evidence and is not overwritten.
- Final Actions run `31736593196` uses PostgreSQL and `POSTGRES_EXPORT_INTEGRATION=1`: API `265 passed / 4 skipped`, including the actual `.cr` Attachment query; focused browser `28 passed`, including Share focus; default PWA `67 passed / 37 skipped`. Earlier run `31735786444` failed one valid retained-shell status assertion and produced no deployable image, preserving quality-gate evidence.
- Production QA separately passed Offline A/B publication/download, committed `.cr` immediate download/archive sanity, and normal Import preview/commit. Fault injection remains production-equivalent only. The operator later completed manual production Chrome Share focus verification for Esc/X/backdrop/remounted-trigger restoration; this evidence is user-provided rather than browser-bridge automation.
