# Release Safety Baseline

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
-> image build / inspection / SHA-256 / deployable artifact
```

Quality evidence may be uploaded after a failed gate for diagnosis. It is explicitly non-deployable. A deployable artifact must include the source commit, workflow run, image identifiers, build time, archive name, SHA-256, and image inspection report.

## Dependency policy

The audit source is `https://registry.npmjs.org`. Critical and high advisories fail the release unless an exact, unexpired record exists in `security/dependency-exceptions.json`. The gate rejects unknown advisories, mismatched severity, duplicate records, expired records, and unused broad exceptions. Exceptions identify runtime, build supply-chain, or development exposure and include a mitigation, remediation track, and review date.

- Next is patched within Release A from `14.2.23` to `14.2.35`. Next 14 is unsupported, so `NEXT_SUPPORTED_LTS_BASELINE = MIGRATION_REQUIRED`; the separate track is `NEXT_LTS_MIGRATION_TRACK`.
- Mermaid is patched from `11.16.0` to `11.16.1` and retains `securityLevel: "strict"`.
- PostCSS resolves to `8.5.26`. Compatible vulnerable transitive versions of brace-expansion, js-yaml, nanoid, and PostCSS are overridden to patched versions.
- PDF.js remains `3.11.174`. Its only `getDocument` path must set `isEvalSupported: false`. `PDFJS_SUPPORTED_LINE_MIGRATION_REQUIRED = YES`; the separate track is `PDFJS_MIGRATION_TRACK`.
- The legacy optional `pdfjs-dist -> canvas -> node-pre-gyp -> tar` build chain is not executed by locked release installs because lifecycle scripts are disabled. It remains an explicit, time-bounded build supply-chain exception until the PDF.js migration removes it.

## Configuration guard

`APP_ENV=production` or `prod` requires a non-empty, non-placeholder `ATTACHMENT_CURSOR_SECRET` of at least 32 characters. The local default remains valid only for development/test. Compose also requires the variable before migrate, API, or worker starts. Errors identify the variable but never print its value.

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

King never runs a Next production build. Deployment uses an externally built archive, verifies SHA-256, validates PostgreSQL and business-volume backups, runs migration preflight, and recreates services with `--no-build`. It never runs `down -v`, deletes business volumes, replaces `.env.production`, or enables Scanner.

The application has no account system. TLS and owner access control remain the responsibility of the external gateway/VPN. The repository owns application headers; the gateway must preserve or deliberately supersede them, forward the expected proxy headers, and monitor `/api/health`.

## Current verification rules

API or source inspection alone does not establish a browser-flow PASS. Skipped tests are reported separately. Release A can be complete while supported Next/PDF.js migrations and CSP enforcement remain `MIGRATION_REQUIRED` or `NOT_IMPLEMENTED`, provided all residual risk is explicit and the quality/artifact gate passes.
