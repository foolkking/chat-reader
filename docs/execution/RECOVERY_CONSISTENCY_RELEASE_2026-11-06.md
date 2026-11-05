# Recovery consistency release — 2026-11-06

## Disposition and authorization

The user explicitly requested deployment after exact-source CI passed, then
resumed the interrupted preparation. The earlier CI-only/no-production boundary
was superseded for this release, not for cleanup or replaying user imports.

| Boundary | Accepted evidence |
| --- | --- |
| Application source | `67e63364f794d2b6d820eb8502ead9010c76f4bd`, existing master |
| CI | `42043078359`, attempt 1; all six required jobs and artifacts passed |
| First result gate/read | 2026-11-05 15:04:42.075Z / 15:04:42.366Z; final green read 15:10:30.896Z |
| Maintenance | 2026-11-05 16:04:37–16:12:00Z = **2026-11-06 00:04:37–00:12:00 +08:00**; not zero downtime |
| Runtime / retained rollback | `67e6336` / `be58b12`; older `3b839dc` also retained |
| Schema | `20261030_0058` → single head/current `20261105_0059` |
| Derived backfill | Existing single worker committed `personal_search_backfill`, 52/52, progress 100, no error |
| Independent runtime recheck | 2026-11-05 16:16:51Z; same exact image/config/PostgreSQL/HTTP/log/OOM checks passed |
| Preservation recheck | 16:28:39Z; all twelve role tags across three revisions and all three known backup points retained |

The later documentation-only receipt commit does not change the deployed
application SHA or claim a new exact-source CI. The current handoff JSON keeps
the accepted run/source identity and stops this completed CI recheck.

## Full CI, not a composition of older successes

| Gate | Result |
| --- | --- |
| API full suite / migration | 6065 passed, 3 unchanged optional real-user-fixture skips; 0059 single head/current |
| Web | Node 2022/2022; required machine gates 13/13 PASS, 0 FAIL/NOT_VERIFIED/SKIPPED |
| Browser highlights | Context 36/36; focused 45/45; mutation 118/118 |
| Settings | 463/463 plus independent fresh-instance restore 1/1; 2/2 machine gates |
| Performance | Same-runner baseline/candidate 9/9 each; plain 10k cold Markdown calls 69 per repeat, longest/cumulative long task 0 |
| Build / independent inspection | Both successful; exact run/producer/artifact/source identity verified |
| Real worker memory | Exact API image, 320 MiB memory and memory+swap; growth 57,237,504 bytes ≤64 MiB; 14 verified asset hashes; no OOM/failcnt/restart |

The default PWA umbrella includes its existing environment-routed skips; the
individual release gates passed. Optional skips are not new exceptions or an
excuse for missing gates. No timeout, budget, retry, skip or assertion relaxation
was introduced. No local application tests or local services ran in the CI
repair/deployment continuation. Failure history remains in the
[implementation record](RECOVERY_CONSISTENCY_2026-11-05.md).

## Exact artifact and operator preparation

Official release artifact **13427291594**:

- ZIP SHA-256: `1bf83063657b0ee9347d8d3e4d7bdcb1067c96ecf5b46b88a2517682323cb7e1`
- Image archive SHA-256: `1600e2a8fa57093c999982f663905d91fb188263111a898bb758e413620be3da`
- API/worker/migrate Docker config:
  `sha256:95e34fb7ca0059fab9e1586963fc080709b4de20afe137901abf43c79d3ec95f`
- Web Docker config:
  `sha256:4bc1deb7f9ea2a96dd4cc5abf7f463e1071ed17ee0b8d38c63d880d16f674042`

All five required evidence artifacts were independently downloaded and matched
their API digests. Local static verification hashed 35 blobs and followed the
OCI index → linux/amd64 manifest → config/revision chain; Docker's config IDs
are not confused with CI's index IDs. CI's forbidden-path inspection passed.
The server recomputed transferred-file hashes before loading the exact archive.

The dirty operational checkout was not pulled/reset. Exact-source deployment
helpers were staged under the new release directory, without replacing live
Compose/env/Nginx. Eight staged shell helpers needed CRLF→LF delivery normalization;
before/after and every staged support-file hash were recorded. The operator
wrapper was syntax-checked against the server's Python 3.6.8 and shell; application
Python remains the CI-built image runtime. Preparation errors occurred before
stopping services and did not alter application source or production configuration.

## Backup, migration and runtime

1. Pointer/image/idle-queue/health and duplicate Share creation-intent preflight
   passed. Actual-artifact disk admission: **9,028,948 KiB available** versus
   **5,122,992 KiB required**, with the existing headroom unchanged.
2. Stopped Web/API/worker only. PostgreSQL stayed healthy and unchanged. At the
   stopped-writer check, **536,984 KiB MemAvailable** exceeded the 448 MiB floor.
3. Candidate-image read-only attachment audit completed cleanly: **385/385 hashes**,
   373 asset objects, 12 Context objects, 352 active attachments, zero issues.
4. Created **`chat-reader-20261105T160504Z`**: PostgreSQL custom dump plus
   imports/exports/offline/assets. All five checksums, `pg_restore --list` and
   four tar listings passed before migration. Deduplication/retention cleanup
   was disabled; both previous backup points remained.
5. Bounded one-off ran single-head verification, `alembic upgrade head`, and
   head/current verification. Nullable revocation reason and the unique intent
   index were checked; fourteen canonical table counts were equal while writers
   remained stopped. Only derived search metadata/job state changed as designed.
6. Recreated only API/worker/Web using `--no-build --no-deps --pull never`;
   the bounded diagnostic/migration overlay was not used for runtime services.
   Existing single worker finished the derived backfill before acceptance.
7. API/Web/PostgreSQL healthy; worker `alive_idle`; exact image IDs/revisions,
   HTTPS health/login, HTTP→HTTPS, anonymous denial, hidden diagnostics,
   public-image no-store and enforcing security headers passed. Fifty synthetic
   illegal page-method requests returned the required 405 without cookies/redirects.
8. Startup logs were inspected in memory; only fixed categories/counts/hashes
   were retained. Zero error keywords, container restarts/OOM, or new host/kernel
   OOM events. Env/Compose/Nginx hashes and PostgreSQL ID/start/restarts stayed
   unchanged. Pointers were updated only after acceptance, then independently
   checked. Available disk at recheck: **6,585,652 KiB**.

Canonical counts after writers resumed were **not** compared to the stopped
baseline and are not claimed unchanged. No data was restored to make counts match.

## Recovery and preserved boundaries

`be58b12` images remain available but do not understand the new backfill job.
The operator wrapper permits automatic image recovery only while schema is still
0058; after 0059 it stops writers for forward recovery instead of downgrading or
starting an incompatible old worker. Any future rollback requires fresh stopped
writer, job/schema/data compatibility review. No rollback was needed this release.

No production build, PostgreSQL restart, env/Compose/Nginx overwrite, Scanner
enablement, business-volume deletion, backup/image pruning, user-data cleanup,
raw ZIP replay, branch creation or unrelated workload change occurred.
The original modified build-info and seven original audit/evidence files retain
their captured hashes and remain uncommitted.

Still **not verified**: authenticated production UI, the original user ZIP retry,
the real 47-conversation offline update, physical clipboard/screen reader/device
behavior, sustained load, or restore of this production backup/off-site recovery.
The synthetic CI restore drill and health checks do not establish these outcomes.

## Evidence and documentation

[Sanitized machine summary](../evidence/release-2026-11-06/recovery-deployment-summary.json)
contains source/run/artifact/backup/runtime identity without user content or secrets.
Full task evidence remains in the identifiable desktop
`chat-reader-deploy-67e6336-20261105` batch; CI evidence remains in the handoff's
`chat-reader-search-history-fix10-20261105` batch.

| Documentation scope | Action |
| --- | --- |
| Project State, navigation, deployment/testing, runtime/risk pages | Update current source/schema/acceptance and preserve remaining debt |
| Feature/authentication/PWA/archive/optimization contracts | Replace candidate-only status with this release reference; no behavior rewrite |
| Dated implementation records | Prepend final disposition without erasing failed checkpoints |
| Unrelated docs, AGENTS, application/test source and user files | Keep; no restructure or cleanup |
