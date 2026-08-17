# Release Safety Baseline

Release A introduced CSP in Report-Only mode. Release H supersedes the current
application response mode with an evidence-derived enforcing policy; see
`CSP_ENFORCEMENT_CONTRACT.md`. The Release A history below remains the baseline
record and is not retroactively rewritten as enforcement evidence.

Last audited: 2026-08-13

This contract defines the Release A security and provenance gate. It does not change product data, Reader behavior, attachment lifecycle, Share, export formats, or offline package formats.

## Release gate

The deployable image job depends on the `quality` job and runs only when that job succeeds:

```text
locked install without lifecycle scripts
-> lint / typecheck / production build
-> API full suite / Alembic current and single head
-> official-registry dependency audit and exact exceptions
-> focused online browser checks / default PWA baseline
-> image build / inspection / deployable artifact
```

Quality evidence may be uploaded after a failed gate for diagnosis. It is explicitly non-deployable. A deployable artifact must include the source commit, workflow run, image identifiers, build time, archive name, and image inspection report. Automated package digests may remain in build metadata, but human CI/deployment reports do not require a separate SHA/checksum confirmation.

CI installs pinned pnpm `9.15.4` through `pnpm/action-setup`. The Web image pins a Node-20-compatible Corepack before activating the same package-manager version. Do not bypass package-manager signature validation with `COREPACK_INTEGRITY_KEYS=0`.

## Dependency policy

The audit source is `https://registry.npmjs.org`. Critical and high advisories fail the release unless an exact, unexpired record exists in `security/dependency-exceptions.json`. The gate rejects unknown advisories, mismatched severity, duplicate records, expired records, and unused broad exceptions. Exceptions identify runtime, build supply-chain, or development exposure and include a mitigation, remediation track, and review date.

- Next is patched within Release A from `14.2.23` to `14.2.35`. Next 14 is unsupported, so `NEXT_SUPPORTED_LTS_BASELINE = MIGRATION_REQUIRED`; the separate track is `NEXT_LTS_MIGRATION_TRACK`.
- Mermaid is patched from `11.16.0` to `11.16.1` and retains `securityLevel: "strict"`.
- PostCSS resolves to `8.5.26`. Compatible vulnerable transitive versions of brace-expansion, js-yaml, nanoid, and PostCSS are overridden to patched versions.
- PDF.js remains `3.11.174`. Its only `getDocument` path must set `isEvalSupported: false`. `PDFJS_SUPPORTED_LINE_MIGRATION_REQUIRED = YES`; the separate track is `PDFJS_MIGRATION_TRACK`.
- The legacy optional `pdfjs-dist -> canvas -> node-pre-gyp -> tar` build chain is not executed by locked release installs because lifecycle scripts are disabled. It remains an explicit, time-bounded build supply-chain exception until the PDF.js migration removes it.

## Configuration guard

`APP_ENV=production` or `prod` requires a non-empty `ATTACHMENT_CURSOR_SECRET` that is neither the development default nor a known placeholder. There is no minimum-length requirement. The local default remains valid only for development/test. Compose also requires the variable before migrate, API, or worker starts. Errors identify the variable but never print its value.

Production secret provisioning is operator-owned. A release agent may verify configured/non-default status, but must not generate a committed secret, print it, or overwrite `.env.production`.

Alembic escapes percent tokens only at the ConfigParser boundary. The canonical `DATABASE_URL` is unchanged, including `%`, `%25`, `%3D`, `%40`, and combinations.

## HTTP baseline

Next responses define:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` disabling browsing topics, camera, geolocation, microphone, payment, USB, serial, and Bluetooth
- no `X-Powered-By`
- `Content-Security-Policy-Report-Only`

The report-only CSP starts with same-origin defaults, allows the local data/blob resources required by images, media, fonts, and workers, blocks objects, restricts base/form targets, and evaluates `frame-ancestors 'none'`. It is intentionally not enforcing in Release A. Browser console observations are compatibility evidence, not a reporting service.

## Image and deployment boundary

Release images must be `linux/amd64`, carry the exact OCI revision label, expose expected API/Web entrypoints, and omit `.env`, `.git`, build caches, and user import storage. Worker and migration tags share the API filesystem image; production Compose supplies their explicit command overrides.

King never runs a Next production build. Deployment uses an externally built archive, validates its versioned build metadata, validates PostgreSQL and business-volume backup readability/listings, runs migration preflight, and recreates services with `--no-build`. It never runs `down -v`, deletes business volumes, replaces `.env.production`, or enables Scanner. Manual SHA/checksum confirmation is not a release-report gate.

The application has no account system. TLS and owner access control remain the responsibility of the external gateway/VPN. The repository owns application headers; the gateway must preserve or deliberately supersede them, forward the expected proxy headers, and monitor `/api/health`.

## Current verification rules

API or source inspection alone does not establish a browser-flow PASS. Skipped tests are reported separately. Release A can be complete while supported Next/PDF.js migrations and CSP enforcement remain `MIGRATION_REQUIRED` or `NOT_IMPLEMENTED`, provided all residual risk is explicit and the quality/artifact gate passes.

## Release A execution evidence

- Actions run `31705576354` failed during package-manager bootstrap. `build-images` was skipped and no deployable artifact existed.
- Actions run `31706041697` passed through Web production build but failed two API environment-isolation tests. `build-images` was again skipped and no deployable artifact existed.
- Actions run `31706522862` completed every quality and image step for commit `08df7a1a880c63a4d05df46b8e0a271b16088c7f`. The independently downloaded archive matches SHA-256 `25687fa7b91db5a518d42ccb61892015ff5fb90fc717f820de03a2719846a6b5`; its manifest and image inspection report match the same commit/run, all images are `linux/amd64`, and no forbidden path was found.
- Production deployment did not start because `ATTACHMENT_CURSOR_SECRET` was absent. The current production release remains healthy and unchanged. Release A is therefore `BLOCKED`, not a production PASS; application security headers and CSP Report-Only are production-equivalent verified but production `NOT_VERIFIED`.

The first closure remained blocked because the production value did not satisfy the former 32-character policy. The user subsequently approved removing that length constraint while retaining the non-empty, non-default and non-placeholder checks. This is a policy change, not a secret change: the value itself was never displayed, copied, recorded or written by the release agent. Rerun the release workflow from the resulting committed source, verify the new archive SHA-256, complete backups and deployment, and perform HTTP/browser acceptance. Do not reuse the validated candidate as evidence for a later source commit without an explicit provenance decision.

### Final Production Closure

The release was resumed only after a value-safe preflight returned `configured=true`, `not_default=true`, and `not_placeholder=true` for `ATTACHMENT_CURSOR_SECRET`. Its value was not read, printed, copied, committed, or changed. The approved production contract has no length threshold; missing, empty, development-default, and known-placeholder values still fail fast.

Actions run `31713379831` reran the full gate from commit `1d366fb0b3e74f865f1cbc455e3f5d6afeaa5911`. It passed `quality -> build-images -> inspect -> package -> checksum -> artifact`. The final archive SHA-256 is `52b809f4b484db3a180c06f46587130b79d6c3f6a999f1f8651eb12411910b59`; API/worker/migrate digest is `sha256:650d9c9fdcd1f686c7adb1c34f27f37c5cb961206202cc2a0b60519fe5aa3a6f`; Web digest is `sha256:6a273fc0bed72217b6307be2c3a8fd55ee2839a9b8efaebf11f85bf35d8579e1`. Official registry provenance also matched both exact lockfile records: Mermaid `11.16.1` and PostCSS `8.5.26`.

King rechecked the archive SHA-256, validated `/opt/chat-reader/backups/release-a-closure-20260813T151932Z-1d366fb` with `pg_restore --list`, archive listings and checksums, then used explicit production compose/env, Alembic preflight and `--no-build` recreation. Runtime services use the final OCI revision and are healthy. Production response headers confirm `nosniff`, `strict-origin-when-cross-origin`, the bounded Permissions Policy, CSP Report-Only, and absent `X-Powered-By`. CSP Report-Only browser smoke found no policy violations in Library, Reader/KaTeX, or PDF Viewer. CSP enforcement is intentionally still not enabled.

`RELEASE_A = PASS`. The supported Next LTS migration, PDF.js supported-line migration, and enforcing CSP remain independent tracks. Browser Mermaid rendering has no safe current production fixture and remains `NOT_PRODUCTION_VERIFIED`; strict Mermaid mode is covered by CI. A desktop Share-drawer Esc focus-restoration defect was observed after this security release and is deferred as a next-round P2, not silently treated as a dialog PASS.
