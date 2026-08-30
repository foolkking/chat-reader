# 生产部署

## 2026-08-31 workspace navigation and batch merge deployment

Production runs source `9cc7c4e2b6065bf3bce333a2fc8bb3cfb0ac94fd`
from GitHub Actions run `33325329338` attempt 2. The complete API, migration,
dependency, Reader, Share, Source Editor, attachment, authentication and PWA
quality matrix passed before image construction. Attempt 1 reached only the
last PWA negative matrix and timed out in an optional-cache Service Worker
readiness scenario; the unchanged exact-source attempt 2 passed all ten
negative cases. The deployable archive SHA-256 is
`bb46bc1e497408b1abece1662dcbccad4830185946c0ca7c501bcba996b191ab`.

The retained recovery point is
`/opt/chat-reader/backups/predeploy-20260830T175500Z-9cc7c4e`. Its PostgreSQL
custom dump and imports/exports/offline/assets archives passed restore/archive
listings and checksum verification. King fast-forwarded source, loaded the
prebuilt images, ran migration, and recreated API/import-worker/Web with
`--no-build --no-deps --force-recreate`. PostgreSQL stayed running; no build,
volume deletion, environment overwrite, Scanner start or user-data cleanup was
performed.

API/worker run image
`sha256:662dd41a676886a2b38d4b0a72c2cc76ec75f719c64dea926d04dd2cf0055125`;
Web runs
`sha256:c9e5efe9cd0ceb9cbce74c4f299cf345be1c8aa462d0251e67ce5329d1f54ba3`.
Runtime image identities and OCI revisions match the CI manifest. API, Web and
PostgreSQL are healthy, worker diagnostics are `alive_idle`, public health is
200, anonymous private access is 401, public diagnostics is 404, and Alembic is
`20260829_0029 (head/current)`. Authenticated production UI acceptance remains
`NOT VERIFIED`; no owner credential was used during deployment.

## 2026-08-24 Formula rendering and source-position deployment

GitHub Actions run `32698108862` passed the complete quality and image-build
workflow for source commit `7ff2f92b3aea707b9db3826907c7016d3ac9ac8e` on the
single `master` branch. The deployable image archive was loaded on King and
the existing production Compose migration and `--no-build` replacement flow
was used for API, import-worker and Web.

The temporary pre-deploy recovery point (PostgreSQL plus all four business
volume archives) was verified readable before replacement and deleted after
health acceptance at the operator's request. The temporary transfer directory
was also removed; production volumes, database data and environment
configuration were not removed.

Production API, worker, Web and PostgreSQL are healthy, public health returns
200, the public diagnostics path returns 404, protected diagnostics reports
`alive_idle`, and Alembic is `20260823_0028 (head)`. The current image
generation and its direct rollback generation are retained. Authenticated
production UI acceptance remains `NOT VERIFIED` because no owner credential or
approved browser-control session was used during this deployment.

## 2026-08-24 performance optimization deployment

The `master` runtime source was rebuilt after the list, project and search
query optimizations. The complete quality and image workflow passed, and the
new API/worker/Web images were built at `2026-08-24T01:55:40Z`. Production was
backed up before migration and replacement; the PostgreSQL dump and all four
business-volume archives are readable. API, worker, Web and PostgreSQL are
healthy, public health is 200, anonymous private access is 401, public
diagnostics is 404, protected diagnostics reports `alive_idle`, and Alembic is
`20260823_0028 (head)`.

The server retains only the current Chat Reader image generation and its direct
rollback generation. No production volume, database, environment file,
backup, import storage or unrelated image was removed. Authenticated production
UI remains `NOT VERIFIED`.

## 2026-08-23 existing-conversation cleanup scan

Production runs Alembic `20260823_0028` and the API, worker and Web images
built at `2026-08-23T09:21:16Z`. GitHub Actions run `32630280224` passed the
complete API, Web, browser, authentication, PWA, dependency and image gates.
An earlier exact-source attempt ended only after bundled Chromium crashed in
the default PWA matrix; the successful rerun passed that same matrix.

Before migration, production created and verified a retained five-component
backup containing a PostgreSQL custom dump plus imports, exports, offline and
assets archives. Migration ran before API/worker and Web replacement. All
application services and PostgreSQL are healthy, public health is 200,
anonymous cleanup access is 401, public internal diagnostics is 404, and the
protected container-loopback diagnostic reports `alive_idle`.

The release transfer archive was removed after acceptance. Targeted cleanup
retains only the current Chat Reader image generation and the generation it
replaced; no database, business volume, production environment file, backup or
unrelated image was removed. Authenticated production UI remains
`NOT VERIFIED`; the deployed build passed the isolated cleanup browser gate.

## 2026-08-23 layered content-cleanup detection

Production currently runs the previously deployed layered content-noise
detector and Alembic `20260823_0027`. GitHub Actions run `32588592205` passed
all quality and image
jobs on attempt 2; attempt 1 stopped only after bundled Chromium crashed while
creating the last CSP browser context. The exact-source rerun passed the full
CSP, cleanup, Reader, Share, authentication and PWA matrices. The deployed
image set was built at `2026-08-22T18:00:33Z`.

Before migration, production created a five-part backup containing a readable
PostgreSQL custom dump and readable imports, exports, offline and assets
archives. Deployment loaded the externally built images, ran the migration,
then replaced API/worker before Web. Public health is 200, API/Web/PostgreSQL
are healthy, worker diagnostics report `alive_idle`, anonymous cleanup access
returns 401 and public diagnostics remains 404. Synthetic read-only checks in
the production API container cover private markers, normalized syntax, bounded
fuzzy review, ordinary-prose rejection and Markdown code-span protection.

The transfer archive was removed after loading. Targeted image cleanup retains
only the current generation and its direct rollback generation for API,
worker, migrate and Web. No PostgreSQL data, business volume, production
environment file, backup or unrelated image was removed. Authenticated
production UI remains `NOT VERIFIED`; the deployed build passed the isolated
Source Editor cleanup browser gate.

## Final consolidation deployment contract

This source moves production from Alembic `20260822_0025` to
`20260822_0026` and ships the Source Editor content-cleanup review with the
final Adaptive Import state-machine closeout. Before replacement, retain the
normal PostgreSQL, imports, exports, offline and assets backup. Run migration
with the versioned API image, then replace API, worker and Web with the same
release image set. Verify public health, private-route denial, worker liveness,
protected diagnostics and the Source Editor cleanup boundary. No standalone
gateway service, `.crbundle` route or conversion-download service may be
deployed. Retain the current image generation and the generation it replaces;
remove only older unreferenced Chat Reader images after acceptance.

Final deployment result (2026-08-22): GitHub Actions run `32578788677` passed
quality and image construction on attempt 2; attempt 1 ended only because the
bundled Chromium process exited with `SIGSEGV` in the final PWA matrix. The
deployed image set was built at `2026-08-22T14:47:26Z`. The retained backup has
a readable PostgreSQL custom dump plus readable imports, exports, offline and
assets archives; no separate manual checksum confirmation was used.

Migration to `20260822_0026` completed before API, worker and Web replacement.
All three application services and PostgreSQL are healthy, public health is
200, anonymous cleanup/import requests return 401, and public diagnostics
returns 404. The SSH + container-loopback diagnostic reports an idle live
worker with a recent heartbeat. The interrupted partial backup and deployment
transfer cache were removed. The server retains the final image generation and
the generation it immediately replaced. PostgreSQL, business volumes,
`.env.production` and the retained backup were not deleted or overwritten.
Authenticated production UI acceptance is `NOT VERIFIED`; the same production
build passed isolated Adaptive Import and Source Editor cleanup browser gates.

## 2026-08-22 Adaptive Import recovery deployment

GitHub Actions run `32550720450` passed the complete quality and image-build
workflow on its second attempt. Attempt 1 passed the new Adaptive Import browser
gate, then bundled Chromium crashed while creating the last CSP test context;
the exact-source rerun passed that matrix and every remaining gate. The deployed
API/worker/Web images were built at `2026-08-22T04:19:59Z`.

Before replacement, production created the retained five-part recovery point
`/opt/chat-reader/backups/import-recovery-20260822T042839Z-ea459e4` containing a
readable PostgreSQL custom dump plus readable imports, exports, offline and
assets archives. No schema migration was added; Alembic remains
`20260822_0025 (head/current)`.

Public health returns 200, API and Web are healthy, the worker reports
`alive_idle`, and anonymous Adaptive Import creation/recovery requests remain
denied. The server retains only the image generation built at the timestamp
above and the generation it immediately replaced. The older third generation
and release-transfer archives were removed without modifying PostgreSQL,
business volumes or `.env.production`.

## 2026-08-22 Adaptive Markdown role-boundary deployment

GitHub Actions run `32544978132` passed the complete quality and image-build
workflow. The deployed API/worker/Web images were built at
`2026-08-22T02:09:40Z`. Public health returns 200, API and Web are healthy, the
worker is running, and Alembic remains `20260822_0025 (head/current)`.

The pre-deploy recovery point is
`/opt/chat-reader/backups/import-role-fix-20260822T021617Z-8b5b0e4`. Its
PostgreSQL dump and imports, exports, offline and assets archives passed
readability checks. No manual archive checksum confirmation is part of this
report.

The deployed runtime parsed the reported source shapes without persisting the
source data: the JSON/Markdown pair produced five messages and the standalone
Chinese line-label Markdown produced two. Post-deploy logs contained no
ERROR/Traceback entries. Image cleanup retained only the current generation and
the immediately replaced generation; the older third generation and old
transfer archive were removed without changing volumes, PostgreSQL or
`.env.production`.

## 2026-08-22 Adaptive Import deployment

Adaptive JSON / Markdown import was deployed from `master` after GitHub
Actions run `32534425663` passed quality and image-build jobs. The image set
was built at `2026-08-21T22:57:53Z` for commit
`8b5b0e454ea244936eafa1b6f921d5c66ee5a873`; API, import worker and Web are
healthy, public health returns 200, and Alembic is
`20260822_0025 (head/current)`. The server's current and immediately previous
Chat Reader image generations are retained; older unreferenced Chat Reader
images were removed without touching PostgreSQL, business volumes or
unrelated images.

The pre-deploy recovery point is retained at
`/opt/chat-reader/backups/adaptive-import-predeploy-20260821T231241Z-8b5b0e4`.
Its PostgreSQL dump is readable by `pg_restore --list` and the imports,
exports, offline and assets archives are readable by tar listing. This report
does not require a separate manual archive checksum confirmation. Database
content-addressing, artifact fields and security token/hash primitives remain
unchanged.

The Adaptive Import API is still behind the owner authentication boundary;
anonymous session creation returns 401. Local/CI browser coverage proves the
known-profile, unknown-to-Mapping, learned-profile and batch-family flows.
Production logged-in browser acceptance remains `NOT VERIFIED` until an
approved browser-control session is available.

## 2026-08-21 Large import and semantic Reader copy deployment

The scoped import-pairing and semantic Markdown-copy changes were deployed on
`master` after the exact CI quality and image-build jobs passed. Production API,
worker and Web are healthy, and Alembic remains `20260817_0024 (head/current)`.
The pre-deploy backup is retained at
`/opt/chat-reader/backups/import-copy-20260821T140915Z-95a665d`; its PostgreSQL
dump and four business-volume archives were readable before the replacement.

The production Nginx TLS server includes the versioned exact
`/api/imports/preview` location with a 110 MiB request limit; the global 60 MiB
limit is unchanged for other routes. The current and immediately previous Chat
Reader image generations remain available for rollback; older unreferenced
Chat Reader images were removed without touching unrelated images or volumes.

Adaptive multi-file import adds an exact `/api/adaptive-import/sessions`
location with a 520 MiB multipart limit. The API independently enforces 50 MiB
per file, 512 MiB per session and 500 files; unrelated routes retain 60 MiB.

The supplied Desktop JSON/Markdown pair was verified locally as a 66-message
`exact_match` preview in about 1.2 seconds. Production authenticated preview
and clipboard acceptance are not claimed here because the available execution
session has no approved browser-control surface or owner credential; anonymous
requests remain correctly denied by the production auth/CSRF boundary.

## Current authenticated runtime and public Share deployment (complete)

The current runtime adds Alembic `20260817_0024` for independent optional
Share passwords and scoped unlock sessions. The explicit `/share/{token}`
surface is public-by-link by default; owner application routes remain gated.
Password-protected Shares issue only a Share-scoped unlock credential and do
not create an owner session. Production acceptance covers direct public Share
viewing, password gating, revocation and private-route isolation.
For future authenticated-runtime changes, create a verified production backup
using the current five-component procedure, deploy the versioned Compose
configuration with `AUTH_ENABLED=true`, a separately generated long
`AUTH_SESSION_SECRET`, Secure cookies and the fixed 48-hour timeout. Do not
print or commit that secret.

Provision the owner credential only through the running exact API image and
the password-safe operator CLI:

```text
python -m scripts.owner_auth provision
```

The command reads a password from the terminal without echoing it. Keep SSH
operator access as the password-recovery path. Run migrations before serving
the authenticated application, then prove public health, unauthenticated
business denial, a clean-browser login, logout, Share/download gating, PWA
cache lock, worker liveness and protected diagnostics. Do not enable the
password gate with no provisioned owner credential.

## Release M disaster-recovery drill (2026-08-17)

The current restore contract is documented in
`docs/system/DISASTER_RECOVERY_RUNBOOK.md`. It requires a current verified
PostgreSQL custom dump plus `imports`, `exports`, `offline` and `assets`
archives/archive-list validation, and a fresh recovery Compose
project. Run `deploy/recovery_preflight.py` against an explicit JSON plan and
require isolation before any restore mutation; run
`deploy/recovery_integrity.py` inside the exact versioned API image after
restoring. Release M restored the retained backup into two independent targets,
verified Alembic `20260816_0022`, canonical/physical integrity and worker
heartbeat recovery, then removed only the exact recovery resources. Production
runtime, volumes and health were unchanged. A disaster cutover was not
executed by design.

## Release L protected diagnostics and worker liveness

Release L is deployed and changes the API/worker image, adds Alembic `20260816_0022` and adds a
versioned Nginx diagnostics-concealment fragment. The Web runtime is unchanged,
but all services must still be bound to the exact CI manifest images.

Deployment order is security-sensitive:

```text
verify exact source/CI/artifact identity
  -> back up PostgreSQL + imports/exports/offline/assets + Nginx config
  -> install versioned diagnostics gateway fragment
  -> nginx -t and reload
  -> prove public diagnostics returns non-cacheable 404
  -> run migration with the exact immutable API image
  -> set ENABLE_INTERNAL_DIAGNOSTICS=true without exposing other env values
  -> recreate API/worker/Web with --no-build
  -> verify running image IDs and Alembic current=head
  -> query diagnostics through SSH + API-container loopback
  -> verify public denial, idle/busy state, privacy, health and logs
```

Do not expose the API port publicly, proxy the diagnostics path through Next.js,
add a public operator token, build on King or use `latest` as release authority.
The authorized read-only command runs inside the API container; the public path
must remain denied independently. Stale/recovery is tested deterministically in
the isolated suite and must not be induced by killing the production worker.

Production closure evidence (2026-08-16): source
`baca93bdf6f2965c4f5614e296c12d337efc1a0a`, Actions run `31948357231`, artifact
`9264075894`, API/worker ID
`sha256:818c37bc703344ff6ce291c79a805832ad6ab4f24433323c6193622b24857395`,
Web ID
`sha256:83ee77cc5b7b69b90fda804555f6eb3803063491f34aa19f4db50df968ae39a8`.
The pre-deploy backup at
`/opt/chat-reader/backups/release-l-predeploy-20260816T131149Z-baca93b`
passed restore/archive listings and SHA256 verification. Production
`20260816_0022` is head/current, public health is 200, public diagnostics is
denied, and operator diagnostics is available only through SSH public-key plus
API-container loopback. Idle and busy worker states were observed with a
disposable QA job and the QA conversation was removed through the product API.

## Release J cleanup first-apply closure (2026-08-16)

Release J is an operations/evidence closure. It does not change runtime source,
database schema or deployment configuration, and production was not recreated.
The running authority remains Release I source
`7bcd686b59d62fb9907ba09d644637b7af2b3d86` with API/worker image
`sha256:e7800d1a86f9973db3642add2f3236e721846f9d4426f74da54e7da0b0f0b8ea`
and Web image
`sha256:dae7507d89a66ffc086cc3971e2de57907af2781279c19f3f480b35031d66654`.
Actual running identities and OCI revision labels were reverified before apply.

The permanent first-apply sequence is:

```text
verify immutable running identity and health
  -> verify PostgreSQL + imports/exports/offline/assets backup
  -> assert both managed roots are mounted
  -> dry-run A and dry-run B with exact opaque identities
  -> verify ORPHAN_FINAL predicates per identity
  -> final dry-run immediately before apply
  -> apply only approved category and tokens
  -> per-object fresh classification before unlink
  -> post-apply dry-run and old-token idempotency replay
  -> canonical DB/file integrity and production publication smoke
```

Backup `/opt/chat-reader/backups/release-j-precleanup-20260816T081840Z-7bcd686`
passed five SHA-256 checks, PostgreSQL restore listing and four archive listings.
The approved set was four `ORPHAN_FINAL` Export files totaling `659,673` bytes.
Apply deleted exactly that set with zero failed, changed or absent results.
Post-apply eligible categories were all zero; replaying the old tokens deleted
zero and skipped all four as stale.

Canonical counts and Export/Offline file integrity were unchanged. API/Web/
PostgreSQL remained healthy, the worker remained running, Alembic stayed
`20260806_0021 (head/current)` and public health returned 200. Production
Chrome published/downloaded a disposable committed Export and proved it was
protected from cleanup; QA deletion used the product API with 404 readback.
The recent final file remains `UNSAFE_PROTECTED` by the 24-hour grace window.

Automatic cleanup remains disabled. Do not schedule the CLI, lower the grace
window, apply another category, delete the recent QA file manually, run
AssetObject GC, prune volumes or treat `latest` as release authority. Release J
test/evidence commit `81fb441f51984330042625aac4dabddfd78b0ebc` passed Actions
run `31936666151`; its images were not deployed because runtime source did not
change.

## Release I upload-token atomicity closure (2026-08-16)

Release I changes only Source Editor upload/save coordination and API
defense-in-depth. It adds no migration or storage-format change. Production
runs runtime source `7bcd686b59d62fb9907ba09d644637b7af2b3d86` from successful
Actions run `31934088629`.

The permanent deployment sequence is:

```text
exact source commit and successful Actions run
  -> independently verified artifact SHA-256 and image manifest
  -> verified PostgreSQL + imports/exports/offline/assets backup
  -> preserve Release H immutable images and backup
  -> explicit immutable API_IMAGE/WEB_IMAGE binding
  -> Alembic current/head preflight
  -> recreate --no-build
  -> compare actual API/worker/migrate/Web identities with the manifest
  -> health and security headers
  -> production aggregate transient-reference audit
  -> isolated Chrome real chooser/upload/save/reload acceptance
```

`LATEST_TAG_IS_NOT_RELEASE_AUTHORITY = TRUE`. A running image mismatch stops
acceptance even if health is 200. Never build Next on King, replace production
environment files, delete volumes, run broad Docker pruning or repair canonical
message content directly.

Before and after deployment, the production audit must run the same
source-aware active-reference classifier and output only an aggregate count.
It must not print source, token, filename, conversation title or IDs. A nonzero
count requires separate operator approval for data repair; Release I must not
rewrite user content automatically.

After identity passes, create a disposable QA Conversation through the product,
use the real Source Editor file chooser, observe Save blocked while unresolved,
then save after canonicalization. API/reload evidence must show `cr-asset://`
present and `cr-upload://` absent, Viewer must open the attachment, enforced CSP
must report zero legitimate-path violations, and QA cleanup must use the product
API with 404 readback. The deterministic race authority remains the pre-
production Playwright matrix; no production test hook is allowed.

The independently verified release archive SHA-256 is
`dd082f902e4c84cb2a1466735da80dd2659119f087518703b98838b2f66c04f8`.
The manifest and actual running identities are:

| Service | Expected and actual image identity | Match |
| --- | --- | --- |
| API / worker / migrate | `sha256:e7800d1a86f9973db3642add2f3236e721846f9d4426f74da54e7da0b0f0b8ea` | yes |
| Web | `sha256:dae7507d89a66ffc086cc3971e2de57907af2781279c19f3f480b35031d66654` | yes |

Backup `/opt/chat-reader/backups/release-i-final-20260816T074726Z-7bcd686`
passed PostgreSQL restore listing, imports/exports/offline/assets archive
listings and SHA-256 verification. Deployment used explicit immutable commit
tags, migration from the exact API image and `--no-build`. Production health,
headers and Alembic `20260806_0021` passed before Chrome acceptance.

Three independent real chooser/upload/save/reload flows produced canonical-only
source, opened the saved Markdown attachment in Viewer and emitted zero
legitimate-path CSP violations. An isolated PWA profile passed offline startup
and reconnect. QA cleanup used the product API with 404 readback. The final
aggregate scan reported zero active transient references. Release H immutable
images and backup remain direct rollback; `latest` remains convenience only.

## Release H CSP enforcement closure (2026-08-16)

Release H changes the Web response from Report-Only to one enforcing
`Content-Security-Policy`. `RELEASE_H = PASS`; production runs immutable source
`da160a9c9a34dfe670fc67262cf3c8c9eedba07a`.

The immutable sequence is unchanged:

```text
verified Actions artifact and SHA-256
  -> verified PostgreSQL + imports/exports/offline/assets backup
  -> immutable API_IMAGE/WEB_IMAGE binding
  -> Alembic current/head preflight
  -> recreate --no-build
  -> compare actual API/worker/migrate/Web image identities with manifest
  -> health
  -> raw public header and isolated-Chromium CSP acceptance
```

`LATEST_TAG_IS_NOT_RELEASE_AUTHORITY = TRUE`. Keep Release G immutable API/Web
images and its verified backup as direct rollback. Do not run Next on King,
overwrite production env, delete a volume, change Scanner, or use broad Docker
pruning.

Public header acceptance must inspect raw header arrays, not only a merged map.
The application document response must have one effective enforcing policy;
Report-Only is absent unless a future strictly narrower shadow is separately
approved. The external gateway must not append a conflicting policy. API raw
attachment responses keep their independent `default-src 'none'; sandbox`.

After running-image identity passes, isolated Chrome must cover Library,
Reader, Rich Markdown/Shiki/KaTeX, PDF real worker and Range, image/Markdown
Viewer, Share, Source Editor, mutation cache, clean-profile PWA install,
offline/reconnect and 390x844 Share focus. Legitimate-path enforced violations
must be zero. A harmless test-only external resource attempt must be blocked by
the deployed policy without a server-side mutation. CSP reporting remains
browser evidence only; no public reporting endpoint is introduced.

### Release H final evidence

- Actions run `31906595581` completed SUCCESS. The archive SHA-256 is
  `abb3f48ce6ab833fa9abb222a304b8c26ac42c458ab232e94789acbc3e0b32c5`.
  API/worker/migrate image identity is
  `sha256:a8604d1518a623eacc5171171d1105ff2eeb84f0371e93a3535f36a9d9264ba1`;
  Web identity is
  `sha256:0f37153f34d86fe514f0e58a14bf8f7a358e9f0975dbad64d3f529cc97915c66`.
  King independently verified the checksum, image architecture, commands and
  manifest before recreation.
- Backup `/opt/chat-reader/backups/release-h-20260815T204036Z-da160a9`
  contains the PostgreSQL custom dump and imports, exports, offline and assets
  archives. `pg_restore --list`, all archive listings and all SHA-256 values
  passed. The initial aggregate verifier exited only after those validations
  because a PowerShell CRLF reached its final file-list `sort`; an independent
  re-verification closed that tooling-only result before deployment.
- The release directory binds exact commit tags through `API_IMAGE` and
  `WEB_IMAGE`; migration preflight/current/head remained `20260806_0021` and
  the migrate execution used the manifest API image. API, worker and Web were
  recreated with `--no-build`. Actual running Compose image identities match
  the manifest before health/browser acceptance.
- API/Web/PostgreSQL are healthy, worker runs, Scanner remains disabled and
  `/api/health` returns `200` with a server-owned request ID that correlates to
  the structured completion event. The public `/library` response has exactly
  one enforcing policy, no Report-Only and no `X-Powered-By`; Release A headers
  remain present.
- Isolated production Chrome passed real forbidden-resource enforcement,
  Reader/Rich Markdown/KaTeX/MathML, Source Editor mutation/reload,
  Markdown/image Viewer, PDF `6.2.108` real worker/nonblank canvas/authenticated
  `206` Range, desktop and 390x844 Share focus, and PWA offline/reconnect with
  zero legitimate-path violations. QA Conversations were deleted through the
  product API and a final list check found none remaining.
- Release G immutable API/Web images
  `sha256:d95bb99660f3bafd7e64ef7866e49947797ec26a55328671fdd7afe3044ac331`
  and
  `sha256:6684742dbe6960d6ee4f4632b61048765407266344685c3fd616bce2e6c848e6`
  plus its verified backup remain direct rollback. `latest` remains only a
  convenience alias. No broad image cleanup or business-volume cleanup ran.

## Release G PDF.js deployment closure (2026-08-16)

Release G changes the browser PDF engine to official stable
`pdfjs-dist 6.2.108`. CI and Web build/runtime images use Node `22.13.1` while
Next `16.3.1`, React `19.2.8`, Webpack and all data formats remain frozen.

```text
RELEASE_G = PASS
CI_RELEASE_ARTIFACT = PASS
PRODUCTION_DEPLOYMENT = PASS
RUNNING_IMAGE_IDENTITY = PASS
ROLLBACK_RELEASE_F = RETAINED
```

The permanent immutable-image contract from Release F applies unchanged:

```text
verified CI artifact and SHA-256
  -> immutable API_IMAGE/WEB_IMAGE binding
  -> PostgreSQL + imports/exports/offline/assets backup and validation
  -> Alembic current/head preflight
  -> recreate --no-build
  -> inspect running API/worker/migrate/Web identities
  -> compare with manifest
  -> health, headers/CSP and isolated-Chromium acceptance
```

`LATEST_TAG_IS_NOT_RELEASE_AUTHORITY = TRUE`; `latest` remains only a
convenience alias. Any running-image mismatch stops acceptance even if health
is `200`. King must not run a Next build, overwrite `.env.production`, start
Scanner, delete a volume or use broad Docker pruning.

### Release G final evidence

- Source `1b752b77063893feefef01756af9deda559f30a5`; Actions run
  `31896564657` completed SUCCESS. Archive SHA-256 is
  `0d3c460815a562f0e25aab5f0750bc46aa85b5a153ddcb52238018bf7cfeede4`.
- API/worker/migrate image identity is
  `sha256:d95bb99660f3bafd7e64ef7866e49947797ec26a55328671fdd7afe3044ac331`;
  Web identity is
  `sha256:6684742dbe6960d6ee4f4632b61048765407266344685c3fd616bce2e6c848e6`.
  The image archive, manifest, architecture and entrypoints were independently
  checked before transfer and King recomputed the same archive hash.
- Complete backup
  `/opt/chat-reader/backups/release-g-20260815T170643Z-1b752b7` contains the
  PostgreSQL custom dump plus imports, exports, offline and assets archives.
  `pg_restore --list`, all archive listings and every SHA-256 entry passed.
- The release directory stores a copied production Compose file, a protected
  `release-images.env` and `compose-release-g` wrapper. The wrapper clears
  inherited image/Compose variables and binds exact commit tags through
  `API_IMAGE` and `WEB_IMAGE`; `.env.production` was not overwritten.
  Alembic current/head preflight was `20260806_0021`, the migrate execution
  used the expected API image, and API/worker/Web were recreated with
  `--no-build`.
- Expected and actual running image IDs match for API, import worker, migrate
  and Web. This identity gate passed before health or browser acceptance.
  API/Web/PostgreSQL are healthy, worker runs, Scanner is disabled and public
  `/api/health` returns `200` with a server-owned request ID.
- Production responses retain `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy` and CSP Report-Only; `X-Powered-By` is absent.
  Isolated production Chrome passed real same-origin PDF worker, exact
  library/worker version, single/multi canvas, authenticated owner/Share
  `206` Range, Share scope, Fit Page/Width, 110% zoom, page navigation,
  maximize/Escape/focus, cached PDF offline and reconnect. No unexplained PDF
  worker/Wasm CSP violation was observed. Malicious/corrupt fault fixtures
  remained production-equivalent only.
- Immutable Release F `c9ddae1e9cd5c94c406f357a152304105e6d20b0`
  API/Web images and its verified backup remain available for direct rollback.
  `latest` remains only a convenience alias. No broad image cleanup, business
  volume deletion, database change, Scanner change or King-side Next build was
  performed.

## Release F Next 16 deployment contract (closed, 2026-08-15)

Release F is a Next `16.3.1` / React `19.2.8` framework migration. The
candidate is built externally with `next build --webpack`; King never runs a
Next build. `LATEST_TAG_IS_NOT_RELEASE_AUTHORITY = TRUE`: `latest` is only a
convenience alias. Production authority is an immutable commit tag or digest
recorded in the release manifest.

The required sequence is:

```text
quality gate
  -> image build/inspect
  -> package manifest and SHA-256
  -> explicit API_IMAGE/WEB_IMAGE immutable binding
  -> backup and Alembic preflight
  -> recreate --no-build
  -> docker inspect running API/worker/migrate/Web image identities
  -> compare every identity with the manifest
  -> health, security headers, CSP Report-Only and browser acceptance
```

Container health is not deployment acceptance until running image identity
matches the manifest. A mismatch stops acceptance immediately. Release E
immutable API/worker/Web images and its verified backup remain the direct
rollback source. No Alembic or Dexie schema migration is part of this release.

### Release F final evidence

- Source `c9ddae1e9cd5c94c406f357a152304105e6d20b0`; Actions run
  `31887198941` completed SUCCESS. Archive SHA-256 is
  `739435634b6a4ebe52597d9db6887c3599c10a6fb5441f1032b01981923e5b84`.
- API/worker/migrate digest is
  `sha256:4856d1a275c178418d2495dc0cd2b67cf9d94fe660c5100d7d4a84c5b2af0f9a`;
  Web digest is
  `sha256:d7ac14aa3c3f2955e109c6cd933cf3ac350992e0fe99b93071507674a4790670`.
  King recomputed the archive hash and the four running service image IDs
  match these manifest identities exactly.
- Backup `/opt/chat-reader/backups/release-f-final-20260815T134803Z-c9ddae1`
  contains PostgreSQL custom dump plus imports/exports/offline/assets
  archives. `pg_restore --list`, tar listings and all five SHA-256 checks
  passed. Release E rollback images remain retained.
- The Release F compose file was used from the immutable release directory
  with the existing `.env.production`; only `API_IMAGE` and `WEB_IMAGE` were
  supplied as immutable commit tags. Migration preflight was unchanged at
  `20260806_0021`, and API/worker/Web were recreated with `--no-build`.
  No volume, database, environment file or Scanner service was changed.
- Post-deploy API/Web/PostgreSQL are healthy, worker is running, Scanner is
  disabled, and `/api/health` is `200`. Actual production responses contain
  the Release A security headers and a server-owned `x-request-id`; `X-Powered-By`
  is absent. Isolated Chromium passed PWA shell/offline/reconnect, Reader
  KaTeX/MathML, mobile Share focus, mutation/Source Editor, attachment Viewer
  and disposable PDF canvas acceptance.
- A production Chromium CSP Report-Only listener observed zero violations on
  `/library` and the Reader route; CSP remains report-only and no policy was
  broadened.

## Release E PWA resilience closure (2026-08-15)

- Runtime source `1591fd9bdab3d12d7928f6421845173cb1b1b81e`; Actions run
  `31874712687`; archive SHA-256
  `ff07fdab24d729b173f3f1abc9facfe730f5ec88ea6a326445c64d3f1b633f1d`.
  API/worker/migrate image is
  `sha256:f360fefd4a4881e695bfb5a1a6a81f2f096adfbd2149981ca0191caaac6808f8`;
  Web image is
  `sha256:f1d33ca458b3a2e6af249796972399c281feffce831eac00c4babadf9e2ed35f`.
- King independently verified the archive and retained verified backup
  `/opt/chat-reader/backups/release-e-20260815T084805Z-1591fd9`. The backup
  contains a readable PostgreSQL custom dump and imports, exports, offline and
  assets archives; all five checksums and archive listings passed.
- The first recreation remained on the prior images because the CI archive
  carries immutable commit tags and Compose resolves `latest`. Container image
  ID verification caught this before acceptance. The verified commit tags were
  then explicitly retagged to `latest`, migration preflight was repeated and
  API/worker/Web were recreated again with `--no-build`. Final container IDs
  match the manifest. No business state changed during the first recreation.
- Post-deploy API/Web/PostgreSQL are healthy, worker runs, Scanner remains
  disabled and Alembic is `20260806_0021 (head)`. Production headers retain
  `nosniff`, strict referrer policy, bounded Permissions Policy, CSP
  Report-Only and no `X-Powered-By`.
- Isolated production Chromium verified an active coherent shell, 75/75
  critical cached resources, offline Library restart, reconnect and 390px
  reflow. Read-only Reader QA verified KaTeX plus MathML without overflow;
  mobile Share retained one dialog and restored focus after one Escape. No
  production fault injection, data mutation, Next build, volume deletion,
  `.env.production` overwrite, Scanner start or automatic cleanup occurred.

For future archive deployments, load the commit-tagged images and explicitly
retag all four service images to `latest` before running production Compose.
Always verify the resulting container image IDs against the release manifest;
source HEAD alone is not runtime-image evidence.

## Release C superseding closure (2026-08-15)

- Runtime commit `e58b750357d92bba314737582a94493829c038e2`; Actions run
  `31856041473`; archive SHA-256
  `023c2eb4bea5e216c323a457454a627a3d4a72e7c4b9a99361f1501e59ed8a71`.
- Image digests: API/worker/migrate
  `sha256:58868488dacf5722c3b12cc50cd191532067384e507dbb7d4a043672ff96570b`;
  Web `sha256:f814e1a2ac2c1d6df5aa9fc9418d9a7c42f57f9bb7472cb41b467df5fde0cea6`.
- Backup `/opt/chat-reader/backups/release-c-mobile-focus-20260815T013334Z-e58b750`
  passed custom-dump, archive-listing and checksum verification. King used
  explicit production compose/env, migration preflight and `--no-build`.
- Post-deploy API/Web/PostgreSQL, worker, Scanner-disabled state and Alembic
  `20260806_0021` passed. Production responses verified `nosniff`, strict
  referrer policy, bounded Permissions Policy, CSP Report-Only and absent
  `X-Powered-By`; public diagnostics remains intentionally `404`.
- A real 390x844 Chrome check found overlapping mobile utility and Share sheets.
  The final code unmounts inactive sheets and restores the logical More trigger;
  focused desktop/mobile E2E and production read-only smoke pass with one Esc
  closing Share and focus returning to More.
- After health verification, only exact obsolete Chat Reader image tags and an
  incomplete duplicate backup were removed. Current/latest images, verified
  backup, release archive, volumes, PostgreSQL and `.env.production` remain.
  No business-data cleanup or volume deletion was performed.

## Release C final deployment (2026-08-14)

- Source `8d0ad66d65bb069176970ea814d9a6b08e04322c`; Actions `31789905868`; artifact SHA-256 `577594e63ed351de39cdfb56c02e385bff1ef0bbfe90285ddd9d0441aaabedd7`.
- Image digests: API/worker/migrate `sha256:dfc11cda21f78ce77b9b451e886689f97842e1929a6e6618bfcaf8626a312c2a`; Web `sha256:69d228b578c35626f37577102afcbd7ad40c7e61191edafe6e14747379ab38b6`.
- Backup `/opt/chat-reader/backups/release-c-final-20260814T100144Z-8d0ad66` passed PostgreSQL custom-dump listing, four business-volume tar listings and checksum verification. King used explicit production compose/env, migration preflight and `--no-build`; no Next build, volume deletion, environment overwrite or Scanner start occurred.
- Post-deploy API/Web/PostgreSQL health, worker, Scanner-disabled state and Alembic `20260806_0021` passed. Production headers were verified: `nosniff`, strict referrer policy, bounded Permissions Policy, CSP Report-Only, and no `X-Powered-By`.
- Request ID production verification passed after a first post-deploy logger-level finding was fixed in `8d0ad66`: success and controlled 404 IDs correlate to structured request events; raw query markers and raw access-log lines are absent. Public diagnostics remains disabled/404; internal CLI diagnostics is the safe fallback.
- Cleanup dry-run twice: `SAFE_TEMP=0`, `ORPHAN_FINAL=3 / 655,810 bytes`, `SUPERSEDED_ARTIFACT=0`, `UNSAFE_PROTECTED=30 / 236,550,537 bytes`, stable and complete. No application artifact was deleted and manual cleanup approval was not requested. Exact old/intermediate image tags and release-transfer directories were removed only after health, retaining current `8d0ad66`, rollback `32a980b`, all volumes and backups.

## Release C deployment and cleanup checklist (2026-08-14)

- Build only from committed source through `quality -> build-images -> inspect -> checksum -> artifact`. King never runs a Next build.
- Back up and verify PostgreSQL plus imports, exports, offline and assets before replacement. Use explicit production compose/env and `--no-build`; never use `down -v` or overwrite `.env.production`.
- Keep `ENABLE_INTERNAL_DIAGNOSTICS=false` unless the gateway/VPN is proven to block the public route. When it stays disabled, use `python -m scripts.internal_diagnostics` inside the API environment.
- Confirm production success and controlled 404 responses contain `X-Request-ID`, and correlate the same ID with the redacted `api_request_completed` log. Do not inject destructive 500 failures in production.
- Run `python -m scripts.artifact_cleanup` twice in dry-run mode. Compare category counts/bytes and opaque tokens with the Release B baseline. No path, filename or user content belongs in release evidence.
- Deployment does not authorize deletion. Present any stable eligible category/count/bytes for separate operator approval. Apply only explicit approved tokens, then rerun dry-run, health, current Offline download and current Export download checks.
- Automatic cleanup remains disabled. AssetObject, Attachment, successful retained Export, Import source, backup and unknown path deletion is prohibited.

## Release B deployment checklist (2026-08-14)

- Build Release B only from a committed source revision through the existing external quality -> image -> inspect -> checksum -> artifact workflow. King must not run a Next build.
- Before deployment back up PostgreSQL and the current import/export/offline/asset business volumes. Verify the dump with `pg_restore --list`, archive readability and checksums; retain the current release as rollback.
- Use the explicit production compose/env target and `--no-build`. Never run `down -v`, delete volumes, overwrite `.env.production`, start Scanner or perform a migration unless separately approved.
- Artifact publication contract is documented in `docs/system/ARTIFACT_LIFECYCLE_CONTRACT.md`: staging -> validation -> unique final publish -> worker transaction commit -> old cleanup. Cleanup is dry-run only in Release B.
- After health checks, run isolated QA Share focus, Offline package replace/previous-package continuity, Export immediate download and normal Import smoke. Production must not receive injected commit failures; those are production-equivalent tests.

Final evidence: source `32a980bb7cc6ab5a30dc2b3a47d6f6c19acfa8da`, Actions run `31736593196`, archive SHA-256 `aa1bd95a4567be87c43d5e86a5bd17602d738402b37bef7922ca93d87f8b4088`, API image `sha256:14478427325f395be4d54ce6cccb2fdcff8de7fcf97503a547e11cd57c4696aa`, Web image `sha256:0f544a7c39c735a84d59b81b4d08abb5cd7061f8f41c613f74ef72b4a59062e4`, backup `/opt/chat-reader/backups/release-b-final-20260813T194413Z-32a980b`. King checksum, custom dump listing and four volume archive checks passed before `--no-build` replacement.

The production dry-run reported four unreferenced final candidates totaling 659,673 bytes and 29 protected artifacts totaling 236,546,674 bytes. Release B did not delete artifacts. Image cleanup retained current `32a980b`, rollback `1d366fb` and `latest`; no backup, volume, PostgreSQL data or production environment file was changed.

## Manual TOC refresh release (2026-08-13)

- Commit `9d338a001c612bfd837de6a9ee5d06cdb684df61`; GitHub Actions run `31621723794`; artifact SHA-256 `8b0123f93a382535d378e16d5d5a046049ba245870d955dc009e1262cbbdca1b` matched locally and on King.
- Pre-deploy backup `/opt/chat-reader/backups/toc-refresh-20260813T012000Z-9d338a0` contains PostgreSQL plus import/export/offline/asset volumes. SHA-256, `pg_restore --list` and every tar listing passed before image replacement.
- King fast-forwarded source, loaded external images, ran the existing migration preflight and recreated API/import-worker/Web with `--no-build`. It did not run Next build, overwrite `.env.production`, delete a volume or start Scanner. API/Web/PostgreSQL are healthy, worker runs and Alembic is `20260806_0021`.
- Production Chrome passed the isolated current-conversation UI/task flow and QA cleanup. All-conversation section rebuilding remains production-unexecuted to avoid rewriting real derived Heading data; the actual worker branch passes API integration tests.
- After replacement health, only the superseded `9e3bc99` Chat Reader image set and release-transfer archive were removed. Current `9d338a0`, rollback `3ed9dc7` and `latest` remain. `/opt/chat-reader/releases` is 4 KiB and root free space is about 16 GiB. Business volumes, PostgreSQL, `.env.production`, backups and unrelated images were untouched.

## Import and Rich Markdown v4 release (2026-08-12)

Current production runtime is commit `3ed9dc75e650223b05663000b6429074e1ba4c1b`, built externally by GitHub Actions run `31614666602`; artifact SHA-256 is `e718641b046edadab0560e84363c4d0e0618e994b461a622c29109443c480b92`. Verified backup `/opt/chat-reader/backups/import-rich-v3-20260812T151526Z-9e3bc99` contains readable business-volume archives and PostgreSQL custom dumps validated with `pg_restore --list`.

King fast-forwarded source, loaded the prebuilt images, ran the existing migration preflight and recreated API/import-worker/Web with `--no-build`. API/Web/PostgreSQL are healthy, the worker runs, Scanner remains stopped and Alembic is the single head `20260806_0021`. Real Chrome read-only acceptance confirmed Rich Markdown v4 on both reported source shapes; the second full source renders `41/41` display formulas/MathML with zero residual bracket paragraphs.

After health and browser acceptance, cleanup removed only the intermediate `e69a510` and superseded `336486b` Chat Reader image sets and the two verified transfer directories. Current `3ed9dc7`, rollback `9e3bc99` and `latest` remain. `/opt/chat-reader/releases` is empty and root free space is about 17 GiB. No business volume, PostgreSQL data, `.env.production`, retained backup, user file or unrelated service image was touched.

## Archived project and consumed-inline math release (2026-08-12)

Archived-project deletion commit `0f004f7ce79cc6b97e68a8756c6ea21d6a75cc9f` was built by Actions run `31576690022`; artifact SHA-256 is `1d34431be81000854736a1185264a523ec875db5252c3bb0ea8b1c1f4f6a4d67` and verified backup is `/opt/chat-reader/backups/project-delete-20260812T0810Z-0f004f7`. King used migration preflight and `--no-build`. Real Chrome verified the guarded project lifecycle and retained conversation. Cleanup retained current `0f004f7`, rollback `336486b` and `latest`; it removed only obsolete Chat Reader archives/images and left about 5.2 GiB free. Volumes, PostgreSQL, `.env.production` and backups were untouched.

The follow-up Rich Markdown release upgrades only the Web AST compatibility policy to `ai-rich-markdown-v2`; no API, model, export field or migration changes. Release evidence: commit `9e3bc99595dfc958c0167763a68b95890b98f431`, Actions run `31580890665`, artifact SHA-256 `493f080d973c7b2aedcf3e61f18762471f613a04599b0bd051943afe16de4dba`, verified 434 MiB backup `/opt/chat-reader/backups/rich-inline-20260812T090711Z-9e3bc99`. King used the existing migration preflight and `--no-build`; API/Web/PostgreSQL are healthy, worker runs and Scanner is stopped.

Real Chrome on the reported page read-only confirmed `(n^6)`/`(k)` inline compatibility and `[f(x)=x^2]`/compact standalone bracket display compatibility. Source Preview started collapsed; explicit expansion produced 108 display formulas and 130 MathML trees with zero math errors and no page overflow. The editor was closed without saving. Cleanup retained current `9e3bc99`, rollback `336486b` and `latest`, removed the deployment archive plus superseded `0f004f7` layers, and left `/opt/chat-reader/releases` at 4 KiB with about 4.1 GiB root free space. Volumes, PostgreSQL, `.env.production`, backups and unrelated images were untouched.

Storage-pressure cleanup was performed only after validating the retained recovery chain. Fifty redundant historical backup snapshots were removed from `/opt/chat-reader/backups`, accounting for 13,701,926,937 bytes. The July 30/31 baseline artifacts, verified `final-closure-20260811T030600Z-38c57c1`, rollback `rich-markdown-followup-20260812T072512Z-336486b`, and current `rich-inline-20260812T090711Z-9e3bc99` were retained. The three complete recent restore points passed SHA-256, tar readability and PostgreSQL `pg_restore --list`; no container mounted the backup directory. Backups now occupy 1.5 GiB and `/` has 17 GiB available (56% used). Do not infer from historical release sections below that every per-release backup is still retained.

## AI Rich Markdown rollout (2026-08-12)

This release changes only the Web Markdown parser/render pipeline, Source Editor preview, deterministic offline KaTeX font inventory and an attachment-draft state handoff. It adds no dependency, API contract, export field, database model or migration. Build the Web/API images in GitHub Actions or another external Linux builder; King must only verify/load the artifact, run the existing migration preflight and recreate services with `--no-build`.

After deployment, use a synthetic QA Conversation to verify `\(...\)`, `$...$`, `\[...\]` and `$$...$$`, currency/code exclusion, GFM/footnotes, Source Editor canonical-source preservation and Markdown attachment inline/Viewer rendering. Verify `/library` prepares an active shell containing same-origin `KaTeX_*` fonts. Do not use real conversation content for screenshots. Remove obsolete image tags only after API/Web/PostgreSQL health, worker state, migration head and Chrome acceptance pass, while retaining the previous release as rollback.

Release evidence: commit `4d07ce40fd8f130c219e8535bcd2c2f8d9910d97`, Actions run `31560459470`, archive SHA-256 `c47168693d2d3efb9aca3ca8fe4b7ff122a08ee511ce9cfeef77f10c0442a2e5`, verified backup `/opt/chat-reader/backups/ai-rich-markdown-20260812T034100Z-4d07ce4`. King used explicit production migration preflight and `--no-build` recreation. API/Web/PostgreSQL are healthy, worker runs, Scanner is stopped and Alembic remains `20260806_0021`. Production Chrome synthetic QA passed Rich Markdown DOM/source/security/overflow checks. Cleanup retained current `4d07ce4` and rollback `3b544fe`, removed obsolete `1cdadc4` tags/layers and the transferred archive, and did not touch volumes or `.env.production`.

Bare-bracket/Source Preview follow-up evidence: commit `336486b89c12c1536763698feda4c550502b49eb`, Actions run `31573557959`, artifact SHA-256 `c3e6463a9689061430d7b28a7970550553cab6fdcf2020d2f2b19b04a96627e3`, verified backup `/opt/chat-reader/backups/rich-markdown-followup-20260812T072512Z-336486b`. King fast-forwarded source, loaded the external images, ran migration preflight and recreated API/worker/Web with `--no-build`. API/Web/PostgreSQL are healthy, worker runs, Scanner remains stopped and Alembic is `20260806_0021`. Real Chrome passed the exact reported Conversation formula and preview-default-collapsed checks. Cleanup retained current `336486b` plus rollback `4d07ce4`, removed `3b544fe` and the transfer archive; volumes and `.env.production` were untouched.

## Offline shell and static Skill rollout (2026-08-11)

The release adds only static Skill files and browser-local offline export code; no migration is required. The service-worker allowlist must include `/skills/` so both Skill files participate in the deterministic shell revision. Build the Web image on the external Linux/GitHub Actions builder. On King, verify the artifact checksum, back up PostgreSQL and business volumes, run migration preflight, and recreate with `up -d --no-build`. Do not build Next on King, overwrite `.env.production`, remove volumes, run `down -v`, or start Scanner.

After deployment, verify `/library` can interact while shell reconciliation is pending, the same current-conversation-files entry appears in Offline Reader, missing cached files show `offline-unavailable`, and `.context.zip` results expose the two Skill languages. Remove old image tags only after the replacement Web/API/worker images are healthy and rollback tags remain.

Release evidence: commit `3b544feb97257722763437fc5c9206f80b3e68db`, Actions run `31486218261`, archive SHA-256 `1e83d68a5f3c7321e9e9d6f2d5602b043aa32ae127ab5cf3c320e75fa3b7bfe7`, verified backup `/opt/chat-reader/backups/offline-context-20260811T112745Z-3b544fe`. King used migration preflight and `--no-build` recreation. API/Web/PostgreSQL are healthy and worker is running. Cleanup retained current `3b544fe` and rollback `1cdadc4`, removed obsolete `b6ce0e6` tags/layers and the transferred archive, and did not touch volumes or `.env.production`.

## 2026-08-10 release evidence

### Focus lifecycle closure

Commit `ed9116abd496684a1bb50c2e5891d4bc0879e05e` was built externally by GitHub Actions run `31374507130`. King verified release archive SHA-256 `a6132d7801253da105893967a87e373a151587795c1c220ecb741f53bba1788b`, ran the production-compose migration preflight, and recreated API, import-worker and Web with `--no-build`. PostgreSQL and existing imports were backed up with verified checksums at `/opt/chat-reader/backups/stabilization-20260810T0815Z-248b771`; storage directories absent on the server were not fabricated as successful archives. No volume or `.env.production` was modified, ClamAV remained disabled, Alembic stayed at `20260806_0021`, and final API/Web/PostgreSQL health checks passed.

### Lifecycle stabilization release

Commit `200cf9ea01c57a2ab5fa344688a4a77f70c154b9` was built externally by GitHub Actions run `31362680316`. The image archive SHA-256 was verified locally and on King as `f864e609c5a108e8fd98545d73d1ff037f4e39a7ff2257a7da6b7a61d7310154`. Before update, King created `/opt/chat-reader/backups/stabilization-20260810T064736Z-200cf9e` with a validated PostgreSQL custom dump and read-only import/export/offline/asset volume archives plus checksums. King fast-forwarded source, loaded the prebuilt archive, ran the existing migration preflight, and recreated API, worker and Web only with `--no-build`; `.env.production`, PostgreSQL and all named volumes were unchanged. Post-deploy API/Web/PostgreSQL are healthy, worker is running, `/api/health` is `ok`, capabilities retain Scanner `disabled`, and Alembic remains `20260806_0021`.

The remote Compose version does not support `run --no-build`; it never ran that unsupported command successfully. Migration used `docker compose ... run --rm migrate`, which consumed the already loaded `chat-reader-migrate:latest` image. The service recreation still used `up -d --no-build --no-deps`.

Commit `5cc491f3a8a1b398735c0e5b84629731a13da0bf` was built by GitHub Actions run `31325841867` and deployed from archive SHA-256 `d75a66b214932a542fc39f8630f674128f134b61eb51445da59eb75cce117f17`. PostgreSQL and business-volume backup completed at `/opt/chat-reader/backups/csv-table-20260810T010711Z`; King ran migration preflight and `up -d --no-build`. The release adds CSV/TSV Table/Raw Viewer behavior. Previous service image tags were removed while current SHA and `latest` tags were retained; no production volumes or `.env.production` were changed.

Follow-up commit `6d025e7fdcca47334e8020ed8b615f9c4d40d928` removes redundant legacy attachment captions only. It was built by Actions run `31347470091`, archive SHA-256 `158dc6e03d2fa6abb536a1c0a66e297e8c42e17512db57b7af6e4e1afb5f88f9`, and deployed with the same `--no-build` procedure. The checked backup above remains the pre-release recovery point because neither release changed schema or persistent data.

## Merge worker resource control

- Default worker limit: `IMPORT_WORKER_MEMORY_LIMIT=640m` through Compose interpolation.
- Deploy incrementally after PostgreSQL/business-volume backup. Never run `docker compose down -v` and never overwrite server `.env.production`.
- Before replacing a runaway legacy merge, cancel the exact active merge task, restart only `import-worker`, verify rollback/no active merge, then deploy the optimized worker.

最后核验：2026-08-05

本页描述可复用的部署程序。特定发布的镜像、哈希和 Chrome 结果保留在 [execution/DEPLOYMENT_CHECKLIST.md](execution/DEPLOYMENT_CHECKLIST.md)，不应复制为永久配置。

## 拓扑与前提

```text
Internet HTTPS
  -> reverse proxy
  -> Next.js Web :3000
       -> /api/* -> FastAPI :8000
  -> PostgreSQL 16
  -> single import/background worker
```

生产 Compose 文件为 `docker-compose.production.yml`，服务包括 `postgres`、`migrate`、`api`、`import-worker` 和 `web`。只对宿主机暴露 Web；API 和 PostgreSQL 位于内部 network。

服务器需要 Docker Compose、足够磁盘、可用 swap/内存、`.env.production` 和外部 HTTPS 反向代理。至少配置强 `POSTGRES_PASSWORD`、正确的 `PUBLIC_WEB_BASE_URL`、`WEB_BIND_ADDRESS` 与 `WEB_PORT`。

## 数据持久化

| Volume | 内容 | 回退时处理 |
| --- | --- | --- |
| `postgres-data` | canonical 数据、偏好、任务、批注等 | 不删除；先 dump 再迁移 |
| `import-storage` | 原始 source artifacts | 独立备份 |
| `export-storage` | 临时导出 artifact | 可过期清理，但发布时不要覆盖 |
| `offline-storage` | 离线 package artifacts | 独立备份 |
| `asset-storage` | 附件对象、暂存和派生物 | 独立备份；不得删除 |

禁止执行 `docker compose down -v`。镜像回退不等于数据回退；数据库 downgrade 必须单独审批和演练。

## 首次部署

```bash
cp .env.production.example .env.production
# 编辑 .env.production，填入强密码、公开 URL 和绑定地址
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml ps -a
curl -fsS http://127.0.0.1:3000/api/health
```

将反向代理 upstream 指向 `127.0.0.1:<WEB_PORT>`，由代理处理 TLS、HTTP 到 HTTPS、请求体上限和访问控制。仓库中的 `deploy/nginx-chat-reader.conf` 只是 HTTP 示例，不是生产证书配置。生产配置必须把 `110m` 请求体上限限定在精确的 `/api/imports/preview` location；其他 route 保持全局 `60m` 上限。

## 发布前检查

1. 记录当前 commit、dirty worktree、Compose 状态、镜像 ID、磁盘、内存和 swap。
2. 使用显式上传清单；排除 `.env*`、storage、数据库、备份、日志、缓存、临时目录和 `tsbuildinfo`。
3. 运行本地 lint、typecheck、API pytest、相关 Playwright 和 production build。
4. 生成 PostgreSQL dump，并用 `pg_restore --list` 验证可读性。
5. 独立备份 import/offline storage；为当前 API、worker 和 Web 镜像添加回滚标签。

附件发布还必须备份 `asset-storage`，并确认 `ATTACHMENT_SCANNER` 策略。约 2 GiB 的 King 主机固定使用 `disabled`，不启动 `scanner` profile；`ALLOW_UNSCANNED_ATTACHMENTS=true` 只允许单用户继续使用，所有对象仍显示 `scanner_disabled`。未来本地 ClamAV 需要资源充足节点与 `--profile scanner`，更推荐配置独立 `RemoteScanner`。

数据库备份脚本：

```bash
chmod +x deploy/backup.sh
./deploy/backup.sh
sha256sum -c backups/chat-reader-<timestamp>/SHA256SUMS
pg_restore --list backups/chat-reader-<timestamp>/postgres.dump >/dev/null
./deploy/verify_backup.sh backups/chat-reader-<timestamp>
```

The backup helper now writes a timestamped directory containing the PostgreSQL
custom dump plus read-only `imports`, `exports`, `offline`, and `assets`
archives. It validates the database table-of-contents and each archive before
publishing the directory, then writes `MANIFEST` (including source SHA and
backup schema) and `SHA256SUMS`. Set
`COMPOSE_FILE`, `COMPOSE_ENV_FILE`, `BACKUP_DIR`, or
`BACKUP_HEADROOM_KB` to use an explicit production location. Before writing,
the helper requires enough free space for the current uncompressed database and
business volumes plus 256 MiB default headroom. It never deletes existing
backups or application volumes.

`verify_backup.sh` is a read-only pre-restore check. It validates the manifest,
all five checksums, four tar archives, and the PostgreSQL custom dump through an
isolated `postgres:16-alpine` container with no network and no mounted volume.

## 低内存 King 发布

King 不再承担 Web 镜像编译。2026-08-06 的发布证明，即使暂停 worker，原机 `next build` 仍可能杀死 PostgreSQL checkpointer。必须在 CI 或独立 Linux 构建机完成镜像，再通过 registry 或 `docker save/load` 交付：

```bash
COMPOSE='docker compose --env-file .env.production -f docker-compose.production.yml'
$COMPOSE up -d postgres
# 在独立构建机生成并推送/传输 web、api、import-worker 镜像
$COMPOSE pull api import-worker web  # 使用 registry 时
$COMPOSE run --rm migrate
$COMPOSE up -d --no-deps api import-worker
$COMPOSE up -d --no-deps web
$COMPOSE ps -a
./deploy/verify_runtime_images.sh <release-sha>
./deploy/verify_runtime_health.sh
./deploy/verify_https_entry.sh https://chat.example.com
```

`verify_runtime_images.sh` is read-only. It fails unless the running API,
import-worker, and Web containers all carry the expected immutable OCI source
revision, and prints their image IDs for the release evidence record.

`verify_runtime_health.sh` is also read-only. It requires healthy PostgreSQL,
API, and Web containers, a running worker container, and an `alive_idle` or
`alive_busy` heartbeat from the protected in-container diagnostics command.

`verify_https_entry.sh` refuses an `http://` base (including the invalid
`http://host:443` form), requires public `/api/health` to return 200 over TLS,
and checks that port 80 redirects only to the expected HTTPS origin.

The deployable Actions artifact is named
`chat-reader-images-<full-source-sha>-<run-attempt>`. Download that exact name,
then compare `release-manifest.json` with the requested source and attempt:

```bash
gh run download <run-id> --name chat-reader-images-<full-source-sha>-<attempt>
```

如果使用 `docker save/load`，先在 King `docker load`，再执行同样的 migrate 和 `up -d --no-deps`。不得以增加 swap 或暂停 PostgreSQL 来换取原机 Web 构建。

本轮附件 migration 后还需验证：

```bash
$COMPOSE exec -T api python -m alembic current
$COMPOSE exec -T api python -m scripts.purge_legacy_deleted_conversations
curl -fsS http://127.0.0.1:3000/api/capabilities
```

遗留 deleted conversation 清理脚本默认 dry-run；只有 PostgreSQL 和业务 volume 备份已验证后才使用 `--execute`。不可恢复删除没有产品级恢复入口。

如果 shell 不支持变量形式，逐条写出相同 Compose 前缀。出现 OOM、Docker daemon 重启或数据库恢复事件时，停止发布结论，先检查 PostgreSQL、migration、日志并重新生成和校验数据库 dump；不要把容器重新启动等同于成功。

## 发布后验证

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps -a
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 migrate api import-worker web
curl -fsS http://127.0.0.1:3000/api/health
```

配对 Markdown 正文合同升级后，先在 API 容器运行只读统计，再在备份确认可用后创建修复版本：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T api python -m scripts.backfill_exporter_markdown
docker compose --env-file .env.production -f docker-compose.production.yml exec -T api python -m scripts.backfill_exporter_markdown --apply
```

命令幂等且不修改 schema；它只处理原始 JSON/Markdown 仍可验证、current version 仍由 import 创建的配对消息，手动或系统后续编辑跳过。

至少确认：

- PostgreSQL/API/Web healthy，worker running，migrate exited 0。
- 生产 `alembic current` 与源码单一 head 一致。
- `/api/health`、首页、Reader 和 `/library` 返回正常。
- 本次新增 API、Reader 跳转/刷新恢复、Share/Export、离线增量和移动端关键路径按风险复验。
- `/api/capabilities` 必须报告 scanner `disabled`、未扫描可用、基础预览开启、复杂预览关闭；附件 UI 不得显示 clean/safe。
- 日志没有新增 error、exception、traceback、fatal、panic 或持续重启。

生产 OpenAPI 不保证通过 `/api/openapi.json` 暴露；接口存在性可从容器内 `app.openapi()` 或测试环境核验。

## 回退

1. 停止继续发布，保留失败日志和当前镜像 ID。
2. 将 API/worker/Web 指回发布前回滚标签；不要删除 volume。
3. 若 migration 向后兼容，通常保留新增列；确需 downgrade 时先在备份副本验证。
4. 恢复后重新检查 health、migration、worker 和关键只读路径。
5. 数据异常时使用已验证 dump 在隔离环境演练，不直接覆盖唯一生产数据库。

## 运行维护

- 定期执行并异地保存 PostgreSQL dump；另外备份 import/offline volumes。
- 配置 Docker 日志轮转；Compose 已限制 json-file 大小和文件数。
- 监控磁盘、内存、swap、PostgreSQL health、worker 存活和 failed jobs。
- 定期验证恢复流程，而不仅是验证备份文件存在。
- 应用没有内置认证，公开域名必须长期由代理/VPN/访问网关保护。
# 2026-08-09 Addendum

Build Web/API images on GitHub Actions or an external Linux builder. King only pulls the verified image, runs the existing migration preflight and recreates services with `--no-build`. Do not run `next build`, start ClamAV, remove volumes, or overwrite the server `.env`.

The complex attachment Viewer is a browser-side lazy Worker and has no server dependency. The production deployment remains `ATTACHMENT_SCANNER=disabled`; unsupported complex formats continue to download.

## 2026-08-10 Reader Scroll Release

GitHub Actions run `31385483844` produced the verified `e4bc9c3` artifact (`1deddb658a8c663111e530ffd793cb3f437cc9498ca68fded7dd498934f8c777`). King was backed up, loaded and recreated with `--no-build`; no migration was added and the single Alembic head remained `20260806_0021`. API/Web/Postgres health checks passed. The rollback backup is `/opt/chat-reader/backups/reader-scroll-20260810T120035Z-e4bc9c3`; it includes PostgreSQL and the import/export/offline/asset storage archives with checksums.

Production Chrome read-only wheel verification recorded zero reverse wheel steps and six mounted messages. Exact 360px, browser zoom and forced-offline negative cases remain explicit verification debt rather than unconditional PASS.

## 2026-08-10 Reader Scrollbar-Thumb Gap Closure

GitHub Actions run `31398377216` built commit `771f4c864df7d7dea619a17eb19339ae971a2f28`. The release archive SHA-256 `b8c6dc8e7769cfe4e03e9523595b179f50308a045f78ebe8beb71a44291e1000` matched locally and on King. The existing verified rollback backup `/opt/chat-reader/backups/reader-scrollbar-20260810T141005Z-5e50a6e` was retained; it contains the validated PostgreSQL dump and import/export/offline/asset archives. King loaded the prebuilt images, ran the existing migration preflight and recreated API, worker and Web with `--no-build`. No volume, `.env.production`, Scanner setting or database schema changed.

Post-deploy API/Web/PostgreSQL are healthy, the worker is running, public `/api/health` returns `ok`, Scanner remains `disabled`, and Alembic is `20260806_0021 (head)`. Real Chrome read-only acceptance on the reported production conversation dragged the native scrollbar thumb across distant positions in both directions; the destination viewport immediately contained 15 and 14 rendered blocks respectively, with no blank virtual-message shell. The bridge's synthetic in-page `scrollTo()` is not treated as production pointer evidence because it bypasses the native scrollbar input path; the deterministic large-jump invariant is covered by production-build Playwright.

## 2026-08-11 Final Release Closure

- Runtime commit: `38c57c12191bb85ebca0a7caf9aea80f11070993`.
- External build: GitHub Actions run `31453697905`.
- Release archive SHA-256: `430dd0d88c927a6329da132aced75c742124ac4035b4c05c348bdbeda549e11c`, verified locally and on King.
- Backup: `/opt/chat-reader/backups/final-closure-20260811T030600Z-38c57c1` (about 406 MiB). The PostgreSQL custom dump passed `pg_restore --list`; import/export/offline/asset archives passed checksum and archive listing.
- Deployment: verified images loaded, existing migration preflight run, API/import-worker/Web recreated with `--no-build`. No volume deletion, `.env` overwrite, local Next build, Scanner start or schema migration occurred.
- Post-deploy: API/Web/PostgreSQL healthy, worker running, Scanner disabled, Alembic `20260806_0021 (head)`.

Production QA writes were isolated. Disposable conversations were removed through the supported API and QA Share was revoked. The empty QA Project remains because no project-delete endpoint exists; import-preview residuals without a safe owner-delete API were not removed by SQL.

The first migration invocation accidentally selected the repository's default compose file, created a separate empty `chat-reader-postgres` container and `chat-reader_chat-reader-postgres-data` volume, then failed before running Alembic. Inspection proved the production `chat-reader-postgres-1` and `chat-reader_postgres-data` remained healthy. The two exact empty resources were removed immediately; deployment then used explicit `-f docker-compose.production.yml --env-file .env.production` for migration and service recreation. The empty resources are not recoverable, contained no business data and were never mounted by production.

## 2026-08-11 Attachment Workspace And Cursor Release

- Runtime commit: `1cdadc4f90115d7b46ce55d07a2b4f23c90471d4`; GitHub Actions run `31470442426`; archive SHA-256 `429fb5384dc1dbf57eec68aecad4632c01bd71a58fca6ea9f276468c6d8630fb`.
- Backup `/opt/chat-reader/backups/file-workspace-cursor-20260811T075200Z-1cdadc4` contains a PostgreSQL custom dump and import/export/offline/asset archives. Checksums, `pg_restore --list` and tar listings passed before replacement.
- King performed `git pull --ff-only`, `docker load`, explicit production migration preflight and `--no-build` recreation. No Next build, schema migration, volume deletion, `.env.production` overwrite or Scanner start occurred.
- After API/Web/PostgreSQL health, worker, Alembic and production Chrome acceptance passed, cleanup removed only 48 exact Chat Reader tags belonging to 12 older commits. The retained set is current `1cdadc4`, rollback `b6ce0e6` and `latest` for Web/API/import-worker/migrate. Do not replace this targeted retention policy with `docker image prune -a` on King.
- Image storage decreased from 4.919 GB to 2.510 GB; root filesystem moved from 97% used/1.4 GB free to 90% used/3.9 GB free. Business volumes and non-Chat-Reader images were not touched.
## 2026-08-13 Formula-heavy Reader performance deployment

- Commit `0645a846766d3bdc19d33c7ce2211f1f4f7172d0` was built externally by GitHub Actions run `31657452407`. The verified image archive SHA-256 is `15a95edc2ed726909a7ae3ff89ef7c6cd0ccf8f6a2ee5d2c50568812ea9d8ff9`.
- Before replacement, King created `/opt/chat-reader/backups/reader-formula-perf-20260813T013528Z-0645a84`. PostgreSQL custom dump passed `pg_restore --list` using PostgreSQL 16, all import/export/offline/asset archives passed tar readability, and the generated `SHA256SUMS` verified all five files.
- King loaded the external archive, ran the existing migration preflight, and recreated only API, import-worker and Web with `--no-build`. PostgreSQL and all business volumes remained running and unchanged; no migration was added. Alembic remains at the single head `20260806_0021`.
- Post-deploy API/Web/PostgreSQL health checks passed, the worker is running, `/api/health` is `ok` both locally and through `https://chat.king.2bd.net`, and `/api/capabilities` continues to report `scanner_provider=disabled`, `scanner_enabled=false`.
- After health verification, only the superseded `3ed9dc7` Chat Reader image tags/layers and the verified transfer archive were removed. Current `0645a84` and rollback `9d338a0` image sets remain. `/opt/chat-reader/releases` is empty and root free space is about 16 GiB. No user data, PostgreSQL, business volume, `.env.production`, backup or unrelated image was removed.
- Production Chrome read-only recheck opened the reported conversation after deployment and found 16 KaTeX nodes with 16 MathML trees, one mounted message, and no page-level horizontal overflow. The repeated-wheel measurement did not complete after the browser connection timed out, so the continuous production wheel budget remains `NOT_PRODUCTION_VERIFIED`; these DOM checks must not be generalized into a full scroll-performance PASS. The browser-independent focused layout tests and production build passed before deployment.
## Release A preflight (2026-08-13)

The current release gate is defined in [Release Safety Baseline](system/RELEASE_SAFETY_BASELINE.md). Before production Compose evaluation, provision `ATTACHMENT_CURSOR_SECRET` outside the repository and verify only that it is present, non-placeholder and non-default; never print it. No minimum length is enforced. `APP_ENV=production` fails fast otherwise, and Compose requires the value for migrate/API/worker.

The GitHub workflow is now `quality -> build-images -> inspect -> checksum -> artifact`. Only the final artifact is deployable. On King, explicitly use the production compose/env files, verify the archive SHA-256, validate the PostgreSQL custom dump with `pg_restore --list`, validate each business-volume archive, retain the current rollback image, run migration preflight, and recreate with `--no-build`. Do not build Next, overwrite `.env.production`, start Scanner, run `down -v`, or delete named volumes.

After replacement, verify Web/API/PostgreSQL health, worker state, Scanner disabled, Alembic current, all four HTTP security headers, absent `X-Powered-By`, and CSP Report-Only compatibility in Library, Reader, Rich Markdown/KaTeX, Mermaid, Viewer/PDF, Share and PWA registration. CSP enforcement, Next supported-LTS migration and PDF.js supported-line migration are separate future tracks.

### Release A candidate and deployment block

Actions run `31706522862` produced the inspected `linux/amd64` candidate for commit `08df7a1a880c63a4d05df46b8e0a271b16088c7f`. The independently verified archive SHA-256 is `25687fa7b91db5a518d42ccb61892015ff5fb90fc717f820de03a2719846a6b5`; API image ID is `sha256:7eec3604e1b9ef31b93b9fda867f9967e62e025747a235fe1ab1058c89ea9edb` and Web image ID is `sha256:201c867b3259fef2020b8a84708c0964e5361e32b32a0be293b76868cb90ef02`.

Deployment is intentionally blocked before backup/load/recreation because the production environment does not currently configure `ATTACHMENT_CURSOR_SECRET`. No secret was generated, displayed or written; no image, volume, `.env.production` or production service was changed. The current release remains healthy. Provision the secret manually outside the repository, then rerun the workflow from the current commit and resume at backup/checksum/migration/`--no-build` deployment. The Release A candidate is evidence of a valid build, not evidence that its headers or fail-fast behavior are live in production.

The subsequent preflight found a configured custom value but it failed the then-current 32-character minimum. The user explicitly removed only that minimum-length rule. Continue to reject missing, development-default and known-placeholder values; never expose the configured value in logs or evidence.

### Release A production closure (2026-08-13)

- Runtime commit: `1d366fb0b3e74f865f1cbc455e3f5d6afeaa5911`; GitHub Actions run: `31713379831`.
- Final archive SHA-256: `52b809f4b484db3a180c06f46587130b79d6c3f6a999f1f8651eb12411910b59`. King recomputed the same value before loading the external images.
- Image digests: API/worker/migrate `sha256:650d9c9fdcd1f686c7adb1c34f27f37c5cb961206202cc2a0b60519fe5aa3a6f`; Web `sha256:6a273fc0bed72217b6307be2c3a8fd55ee2839a9b8efaebf11f85bf35d8579e1`.
- Backup: `/opt/chat-reader/backups/release-a-closure-20260813T151932Z-1d366fb`. PostgreSQL custom dump, import/export/offline/asset archives, checksums, and archive listings passed validation. The recorded rollback source is `0645a846766d3bdc19d33c7ce2211f1f4f7172d0`; its retained image set remains available.
- Secret preflight was boolean-only: configured, non-default and non-placeholder all passed. The secret value was never emitted, stored, or modified. The guard no longer requires a minimum length.
- Deployment used `docker compose -f docker-compose.production.yml --env-file .env.production`, migration preflight and `--no-build` recreation. It did not build Next on King, remove volumes, replace `.env.production`, start Scanner, or change schema.
- Post-deploy API/Web/PostgreSQL are healthy, worker runs, Scanner is disabled, and Alembic current/head is `20260806_0021`. Public headers are present: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, the documented Permissions Policy and CSP Report-Only; `X-Powered-By` is absent.
- The release transfer archive was removed after health and browser acceptance. An exact image audit then removed only the third-oldest superseded `9d338a0` Chat Reader tags/layers. Current `1d366fb`, `latest`, direct rollback `0645a84`, and the validated backup remain; post-cleanup services stayed healthy. No business volume, database data, user import, `.env.production`, backup, or unrelated image was removed; root free space is about 16 GiB.
