# Next LTS Migration Contract

Last updated: 2026-08-15

Current status: `RELEASE_F = PASS`. The final CI artifact, verified backup,
immutable running-image identity and production acceptance are recorded below.

Release F moves the Web app from unsupported Next 14 to stable Next 16. It is a framework migration only; Reader, Share, Viewer, Import, Export, cr v4, Offline package v2, Dexie v1, PDF.js and CSP enforcement contracts remain unchanged.

## Version Plan

| Stage | Purpose | Production deploy |
| --- | --- | --- |
| F1: Next 14 to 15 | Isolate 14-to-15 compatibility and React 19 changes | No |
| F2: Next 15 to 16 | Final supported candidate | Yes, after full quality gate |

The F1 checkpoint is retained as migration evidence only. Production must not deploy a Next 15 candidate unless an operator explicitly approves a separate exception.

## Final Versions

| Package | Version | Source |
| --- | --- | --- |
| next | 16.3.1 | official npm registry |
| react | 19.2.8 | official npm registry |
| react-dom | 19.2.8 | official npm registry |
| @types/react | 19.2.18 | official npm registry |
| @types/react-dom | 19.2.4 | official npm registry |

Next 16.3.1 requires Node >=20.9.0. Release F local, CI and production
verification used Node 20.13.1. The current Release G PDF.js candidate raises
CI and the Web build/runtime images together to Node 22.13.1 because
`pdfjs-dist 6.2.108` requires `>=22.13.0 || >=24`; Next and React versions do
not change. Release F's closed evidence remains historical, while the Release
G runtime requires its own final CI and production proof.

## Provenance

| Package | Tarball | Integrity |
| --- | --- | --- |
| next 16.3.1 | https://registry.npmjs.org/next/-/next-16.3.1.tgz | sha512-hsAp0i7Rh+/dhe7DGIeN2YlpLM1DP4MNxti9EtDMtqcO612X81MvvEj388/oTce9U1EcEIOWDlGq0zRwrBKvuA== |
| react 19.2.8 | https://registry.npmjs.org/react/-/react-19.2.8.tgz | sha512-PWaYA1L/q9u2u7xYQi+Y3L3Yfnie7XyLeaJICV1MGD6LprsBxcAqGjYyr0eY3p+QdsA+x/Irkt4Qif8D63+Sbw== |
| react-dom 19.2.8 | https://registry.npmjs.org/react-dom/-/react-dom-19.2.8.tgz | sha512-rVprimfGBG3DR+Tq0IQG2DT5PxKth1WIGDmj5yPmlzr4YBe7uyE+Du4oVqTDXZSHGGGXRtTJEGSSePyQCMBglQ== |

The lockfile contains the same integrity values. Release builds must continue to use locked installs and the official npm audit source.

## Build And Bundler

- Production build is explicitly next build --webpack.
- BUILD_BUNDLER = WEBPACK.
- TURBOPACK_MIGRATION = NOT_EXECUTED.
- React Compiler and Cache Components remain disabled.
- The Pages API route for long-running import commit remains outside App Route build caching and retains its no-store proxy contract.

## Compatibility Inventory

| Surface | Release F result |
| --- | --- |
| App Router | Dynamic app routes continue to render on demand. |
| Pages Router | Only /api/imports/[importId]/commit remains for the long-running proxy. |
| Middleware / proxy | No Next middleware/proxy file exists. |
| Async request APIs | `headers()` is used only through `await headers()` in the root layout; dynamic route params are awaited Promise props; no synchronous Next 14/15 compatibility access remains. |
| Cache semantics | Server page fetches that read FastAPI remain cache: no-store; client mutation responses remain canonical. |
| next/image | No migration-driven optimizer expansion; attachment image security remains owned by Viewer/IMG paths. |
| Parallel routes | No app/@* slots. |
| Custom webpack | Keeps canvas: false for PDF.js optional native canvas. |

## PWA And Offline

Release E remains the PWA contract. Next 16 changes build IDs and runtime chunk paths, so Release F must rerun the default PWA baseline and the scoped PWA negative matrix with zero scoped skips.

The test-only PWA fault bridge is allowed only in a dedicated test build and must be absent from normal production bundles.

Final local/CI evidence is default PWA `68 passed / 50 unrelated conditional
skipped` and scoped negative `9 passed / 0 scoped skipped`; the production
browser closure is recorded in Final Closure Evidence below.
The normal production chunk set is scanned for the bridge symbol itself, not
only for a runtime global, and currently passes with the bridge absent.

## Deployment Contract

- Final deploy uses only the Next 16 candidate.
- King must not run a Next production build.
- Release artifact must contain a manifest with source commit, Actions run, archive SHA-256, API image ID and Web image ID.
- Compose may use API_IMAGE and WEB_IMAGE to bind immutable commit tags or digests; latest is not release authority.
- Before acceptance, running container image IDs must match the manifest.
- Release E images and backups remain the direct rollback source.
- No Alembic migration or Dexie schema migration is part of Release F.

`LATEST_TAG_IS_NOT_RELEASE_AUTHORITY = TRUE`. The release manifest binds
source commit, Actions run, archive SHA-256 and API/worker/migrate/Web image
digests. Compose must receive explicit `API_IMAGE` and `WEB_IMAGE` immutable
values. King verifies the archive and image metadata, runs migration
preflight, recreates with `--no-build`, then compares every running image
identity to the manifest before any browser acceptance. Release E images and
backups remain the direct rollback source; `latest` is a convenience alias
only.

## Regression Gate

Final Release F requires locked install, lint, typecheck, production build --webpack, API full suite, Alembic heads/current, dependency audit policy, Release A/B/C/D/E regressions, Rich Markdown, Reader, Mobile Share, Viewer, Share permission, Source Editor, mutation-cache flows, PWA default baseline and scoped PWA negative matrix.

Skip counts must be reported separately and scoped PWA negative skips must be zero.

## Final Closure Evidence

- Final source: `c9ddae1e9cd5c94c406f357a152304105e6d20b0`; Actions run
  `31887198941` was SUCCESS. The archive SHA-256 is
  `739435634b6a4ebe52597d9db6887c3599c10a6fb5441f1032b01981923e5b84`.
- Manifest image identities: API/worker/migrate
  `sha256:4856d1a275c178418d2495dc0cd2b67cf9d94fe660c5100d7d4a84c5b2af0f9a`;
  Web `sha256:d7ac14aa3c3f2955e109c6cd933cf3ac350992e0fe99b93071507674a4790670`.
  King running identities match all expected values.
- Backup `/opt/chat-reader/backups/release-f-final-20260815T134803Z-c9ddae1`
  passed custom-dump listing, archive listing and checksum verification.
  Alembic current/head is `20260806_0021`; `NEW_ALEMBIC_MIGRATION = NONE` and
  `DEXIE_SCHEMA_MIGRATION = NONE`.
- Production acceptance passed API/Web/PostgreSQL/worker health, Scanner
  disabled, Release A headers, CSP Report-Only, Request ID, PWA shell/offline
  reconnect, Reader KaTeX/MathML, 390x844 Share focus, mutation/source-editor,
  attachment Viewer and disposable PDF canvas. Release E immutable images are
  retained for direct rollback.

## Remaining Separate Tracks

- PDF.js maintained-line migration is active as the Release G candidate; it
  remains incomplete until its browser, CI and production gates close.
- CSP enforcing.
- Optional Turbopack migration.
- Automatic cleanup / first production cleanup apply.
- Worker idle heartbeat.
- Exact Markdown/KaTeX cache hit/miss telemetry.
