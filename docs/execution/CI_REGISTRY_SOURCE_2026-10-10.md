# CI official registry source repair — 2026-10-10

## Pre-edit diagnosis and boundary

Source `da04e626d63d440b0c3ffd444dd65eb4740045f1`, complete
[CI 37991317201](https://github.com/foolkking/chat-reader/actions/runs/37991317201),
attempt one, failed before checkout. API, Web and settings each failed
`Initialize containers`: all three runner-managed pulls of `postgres:16-alpine`
returned Docker Hub's **unauthenticated pull rate limit**. No product test ran;
both image jobs were skipped, and the artifact API reports zero artifacts.
The subsequent missing `gate-summary.mjs` is a consequence of no checkout,
not evidence that the tracked file is missing. The previous ninth run's passing
PDF/attachment/API/settings results are historical, not this source's acceptance.

| Job | ID | Original log SHA256 |
| --- | --- | --- |
| API | 114025920907 | c1ca471d50157d625d33d138b6465274bb9c4fb5c4d0b735a2aeeae6a3cc9011 |
| Web | 114025920600 | 4ce84ca5be1d7edf297582f7ecd83ef092689aaa1c6fc074630702c1983263d3 |
| Settings | 114025920872 | c863232793f1c500bda7059d2c2b1badba320f56f3345384dde996698c1b7a2d |

Original logs remain in the designated local task directory. The repository's
Actions secret-name listing is empty; no credential value was read or created.
Docker's green status page does not negate this specific rate-limit response.
No blind rerun, local Web start, Docker execution or King operation has occurred.

## Verified distribution source, before configuration edits

AWS's [official announcement](https://aws.amazon.com/blogs/containers/docker-official-images-now-available-on-amazon-elastic-container-registry-public/)
(HTTP 200, read 2026-10-09 UTC) explicitly documents Docker Official Images in
ECR Public's Docker publisher. It is a separate public distribution service,
not an unknown republisher. Its anonymous service has its own limits; this
change is not a promise of unlimited service or future availability.

The [read-only registry evidence](ci-registry-source-2026-10-10-evidence/registry-metadata.json)
compares Docker Hub manifest HEAD digests with SHA256 of full ECR Public index
bytes for `postgres:16-alpine`, `python:3.11-slim` and `node:22.13.1-alpine`.
**All three indexes match exactly.** Each unique Linux/amd64 manifest is fetched
and hashed, agrees with Docker Hub's same platform digest, and links to a
hash-verified config declaring Linux/amd64. No filesystem layer is downloaded,
executed or built. PostgreSQL's index also matches the preceding ninth CI log.

The first Node fetch failed at `auth.docker.io/token` with
`UND_ERR_CONNECT_TIMEOUT`; it did not establish a mirror outage. Standard
PowerShell HTTPS requests completed the verification. Tokens stayed in process
memory and were neither printed nor saved. No TLS validation or security policy
was disabled; this was unrelated to the denied local Web launch.

## Planned narrow repair

1. Pin the three disposable CI PostgreSQL services to the verified ECR index.
2. Add optional Dockerfile base arguments with **unchanged original defaults**;
   CI supplies the verified same-version Python and Node ECR index references.
   Both Web stages share the same Node argument. No application dependency or
   production Compose/environment configuration changes.
3. Select the existing Docker builder (`driver: docker`) so setup does not
   bootstrap another Docker Hub BuildKit container. Existing builds are ordinary
   single-platform `docker build`; keep Linux/amd64 explicit. The upstream v3
   action's actual input/creation/cleanup paths were checked before this choice.
4. Add source-contract regression checks, validate workflow syntax and compare
   the parsed workflow against its parent to prove all old quality steps,
   budgets, job dependencies and independent artifact checks remain intact.

Full exact-source CI remains mandatory: all five jobs, all 13 Web gates, settings
439 plus one fresh-instance restore, new-source screenshot review and independent
image acceptance. Production stays at 30a0d32 and database 0050. This release
performs **0050→0050**, without migration, reconcile or backfill. The repair and
necessary complete rerun belong to the user's current authorized release cycle;
later optimization does not authorize another release.

Implementation and actual verification results will be appended; this section
is the pre-edit plan, not a passing test or deployment claim.

## Implemented repair and local verification

Only the planned workflow/Dockerfile source changes and one additive regression
file were implemented. The original ten source assertions fail before repair
and all **10 pass** afterward (100.261ms). All 26 repository-script suites pass
**740 / zero failed / zero skipped**, 7797.545ms. Lint and nonincremental types
pass without changing the existing buildinfo. Application/API code, dependencies,
all existing tests and production configuration remain unchanged. Actual image
builds, service pulls and browser cases are not executed locally.

Actionlint **1.7.12** passes workflow/expression validation (optional shellcheck
and pyflakes disabled). Its Windows archive matches the upstream SHA256
`6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9`.
A checksum-text decoding issue was corrected before extraction/execution;
no unverified binary ran. An initial mixed-CRLF patch could not match a hunk;
the subsequent exact-text patch is checked by Git diff and parsed comparison.

Read-only PyYAML comparison with da04e62 accepts **only** the three service
references, two fixed base inputs, driver/explicit-platform arguments and one
new check. Every old step, condition, timeout, dependency and independent
artifact-inspection body remains identical. Complete Dockerfile comparison
accepts only the optional base arguments and corresponding FROM substitutions;
all defaults and other instructions are unchanged. Static source assertions do
not themselves establish pull availability or container correctness.

The [additive checkpoint](ci-registry-source-2026-10-10-evidence/local-verification.json)
inherits 117 bound files (only workflow changes) and adds both Dockerfiles and
the new test, for **120**. It preserves 22 preceding ledgers and their selected
evidence plus unrelated buildinfo. Full exact-source CI is the next step within
the same authorization; no release image or deployment is yet accepted.
