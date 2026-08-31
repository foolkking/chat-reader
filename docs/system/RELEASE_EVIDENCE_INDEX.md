# Release Evidence Index

This index maps the repository's required release commands to their evidence
location and verification level. It is an index, not a claim that every gate
has passed for every source revision.

## Current source snapshot

The authoritative source SHA, branch, deployment status and remaining
verification debt are recorded in [PROJECT_STATE](../../PROJECT_STATE.md).
Historical release records in `docs/evidence/` retain the SHA and run they
describe; they must not be read as evidence for a newer working tree.

## Required command map

| Gate | Command | Evidence location | Level |
| --- | --- | --- | --- |
| Web lint | `corepack pnpm run lint` | `PROJECT_STATE.md` current-cycle entry or CI quality artifact | AUTOMATED_TESTED |
| Web types | `corepack pnpm run typecheck` | `PROJECT_STATE.md` current-cycle entry or CI quality artifact | AUTOMATED_TESTED |
| Web build | `corepack pnpm --filter web build` | `PROJECT_STATE.md` current-cycle entry or CI quality artifact | AUTOMATED_TESTED |
| API suite | `corepack pnpm run test:api` | `PROJECT_STATE.md` current-cycle entry or CI quality artifact | AUTOMATED_TESTED |
| PWA suite | `corepack pnpm --filter web test:pwa` | `PROJECT_STATE.md` and the named PWA evidence record | AUTOMATED_TESTED / NOT_VERIFIED when fixture-gated |
| Migration head | `cd apps/api; python -m alembic heads` | `PROJECT_STATE.md` and deployment evidence | AUTOMATED_TESTED |
| Diff hygiene | `git diff --check` | Current command output in the implementation handoff | AUTOMATED_TESTED |
| Owner browser flow | Authenticated Playwright/browser run at the exact SHA | `docs/evidence/` release record or `PROJECT_STATE.md` | BROWSER_VERIFIED or NOT_VERIFIED |
| Production runtime | HTTPS health, runtime revision, migration and owner flow | `docs/system/DEPLOYMENT_AND_ENVIRONMENT.md` and `PROJECT_STATE.md` | PRODUCTION_VERIFIED or NOT_VERIFIED |

The release workflow also uploads source-bound Web build measurements for the
standard and PWA-negative builds (`web-build-standard.txt` and
`web-build-pwa-negative.txt`). Each file records elapsed seconds and peak RSS
in KiB, so future cache changes can be compared without changing the deployable
image gate.

The release and performance workflows also upload `pnpm-cache.txt`, containing
only the cache hit/miss result and lockfile-derived key. It is diagnostic
evidence for dependency-install performance and is not a release gate.

After `build-images` succeeds, the `inspect-release-artifact` job independently
downloads the named artifact, reloads the image archive, and verifies the
manifest commit plus OCI revision labels for API, worker, migration, and Web
images. This is a separate artifact-boundary check; it does not deploy or
replace the normal release artifact.

## Evidence rules

- A command is `AUTOMATED_TESTED` only when its output belongs to the source
  SHA being reported.
- A skipped, fixture-gated or unavailable browser run is recorded as
  `NOT_VERIFIED`, never promoted to `PASS`.
- Production verification requires the deployed SHA, runtime health and the
  applicable authenticated flow. Anonymous health alone is insufficient.
- Logs and artifacts linked here must remain redacted: no conversation body,
  credentials, cookies, share tokens or user attachment paths.
