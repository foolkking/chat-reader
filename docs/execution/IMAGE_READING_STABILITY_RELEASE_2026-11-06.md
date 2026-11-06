# Image presentation and reading stability release — 2026-11-06

## Accepted disposition

The user explicitly requested deployment after the exact-source CI was accepted.
This supersedes the earlier no-deployment boundary for this release only, not
for cleanup, replaying user imports, schedules or unrelated production work.
The later explicit old-backup/image cleanup authorization and its result are
recorded in [Subsequent authorized cleanup](#subsequent-authorized-cleanup);
the deployment-time facts below remain historical evidence.

| Boundary | Verified result |
| --- | --- |
| Application source | `9cf235f3730aae0f3ae747fe0e36763056a624c0`, existing master |
| Exact CI | `42217357688`, attempt 1; six required jobs, five artifact contents independently verified |
| First-check boundary / actual | 2026-11-06 13:14:12.2415817Z / 13:14:12.5340498Z |
| Deployment CI recheck | 2026-11-06 13:51:32.701975Z; same SHA/run/attempt, not a new dispatch |
| Maintenance | **2026-11-06 22:00:46–22:07:48 +08:00**; 7m02s, not zero downtime |
| Independent runtime recheck | **22:10:03 +08:00**; exact image/config/PostgreSQL/HTTP/log/OOM checks passed |
| Runtime / direct rollback images | `9cf235f` / `67e6336`; older `be58b12` and `3b839dc` also retained |
| Schema | Single head/current `20261105_0059`, unchanged; no upgrade or downgrade |
| Fresh stopped-writer backup | `chat-reader-20261106T140111Z`; five components verified and independently rechecked |

Any subsequent documentation-only receipt commit does not change the deployed
application SHA or claim a new exact-source CI. The authoritative CI handoff
retains this accepted run/source and its completed, paused recheck.

## Complete CI and reading evidence

| Gate | Result |
| --- | --- |
| API | 6072 passed, three unchanged optional fixture skips; Context runtime 65 passed |
| Web Node | 2092/2092, no failures or skips |
| Required Web machine gates | 14/14 PASS, no FAIL/NOT_VERIFIED/SKIPPED gate |
| Focused Reader / new reading stability | 45/45 and 23/23; all new reading cases actually executed |
| Reading traces | 64: 16 each stopped/down/up/Viewer; 2238 total frames, plus 839 preference frames |
| Geometry in the synthetic matrix | Fixed-cell change, stationary/Viewer peak and final anchor shift: 0 CSS px; directional traces each moved 360px without reverse pullback |
| Settings | 463/463 plus isolated PostgreSQL restore 1/1 |
| Capacity | Same-runner baseline/candidate 9/9 each |
| Real worker memory | Exact API image, 320 MiB memory and memory+swap; growth 56,532,992 bytes ≤64 MiB; 14 asset hashes; zero OOM/failcnt/restart |

Default PWA retains its existing environment-routed skips; the independent
specialist gates executed. One import case requires optional external user files.
These are not newly skipped tests, and no new reading case was skipped.
No assertion, timeout, capacity or memory budget was relaxed. The seven
follow-up audit items remain in this source; NX-PERF-01 measures the existing
full-rebuild baseline rather than claiming incremental-index gains.

The [implementation record](IMAGE_READING_STABILITY_2026-11-06.md) preserves
the failed runs and causal limits. The final 25px preference failure was traced
to a natural-flow virtual row leaving its range before deferred measurement.
The shared row adapter records the real mounted height without a second scroll
writer. The last failing run instead exposed a new test adapter's misuse of a
private lazy measurement array; its correction uses the same public API as the
product, and all new regressions passed in the final run.

## Exact artifact and preparation

Official image artifact **13504104247**:

- Artifact ZIP SHA-256: `d3592c3312e2208d52aa3f9aad9809cd192c6ed7cf367b7c95abd31bb32d2b67`
- Image archive SHA-256: `e21c512a8216fd9404da30567ad94aaea4c7b04e3b7780f158803fc28a8584f8`
- API/worker/migrate config: `sha256:86d4d51659eb6331283d80ce94ea8cb3f0cd2f69857641e3ca351e6a266cd1fd`
- Web config: `sha256:0b1cdaeac4267270e613d797c5d76e2e90dc7de6d0800801f2f86a5ca7c2be95`

All five artifact ZIP digests were rechecked against the exact GitHub run.
Static inspection followed the OCI index → linux/amd64 manifest → config
chain and verified 35 blobs and source revision labels. Docker config IDs were
not confused with the CI index IDs. The server rehashed every transferred file.

The dirty operational checkout was not pulled/reset. Nine exact-source helpers
were staged under the new release directory; live Compose/env/Nginx were not
replaced. Host Python 3.6.8 parsing, shell syntax and the bounded read-only
one-off overlay were verified before maintenance. The first preflight rejected
CRLF checksum-list filenames before any service change; only task-owned list
delivery was normalized to LF, rehashed and retried. Application source was
unchanged.

## Deployment and preservation

1. Current/rollback image identities, healthy services and idle queues passed.
   Actual staged-artifact capacity: **6,317,848 KiB available** against
   **5,123,038 KiB required**, without reducing headroom.
2. Stopped only Web/API/worker. PostgreSQL remained healthy with the same
   identity/start time. Stopped-writer MemAvailable was **539,860 KiB**,
   exceeding the unchanged 448 MiB floor.
3. Candidate-image, bounded read-only storage audit: **385/385 hashes**,
   373 asset objects, 12 Context objects, 352 active attachments, zero issues.
4. Created a fresh PostgreSQL custom dump and imports/exports/offline/assets
   archives. Five checksums, PostgreSQL TOC and four tar streams passed before
   application replacement. Backup deduplication/retention cleanup was disabled.
5. Candidate image read only the migration head/current under PostgreSQL
   read-only transaction settings. Schema stayed at 0059; fourteen canonical
   row counts matched while writers remained stopped. The preceding release's
   52/52 search backfill remained committed; it was not replayed.
6. Recreated only API/worker/Web using `--no-build --no-deps --pull never`.
   Health and worker `alive_idle`, exact image IDs, HTTPS health/login,
   HTTP→HTTPS, anonymous denials, hidden diagnostics, public-image no-store,
   security headers and 50 synthetic illegal page-method denials passed.
7. Startup logs were inspected in memory and retained only as fixed
   categories/counts/hashes: no error keywords, restart/OOM or new kernel/host
   OOM events. Env/Compose/Nginx and PostgreSQL identity/start stayed unchanged.
8. Updated current/rollback pointers only after acceptance, then independently
   repeated runtime checks and five-component backup validation. All four
   backup points and sixteen role tags across four revisions were retained.

The preservation check had **3,881,188 KiB available, 91% disk used**.
No cleanup is authorized by this release. A future release must repeat capacity
admission; do not reuse this preflight or reduce its budgets to fit.

No local application tests/services, production build, PostgreSQL restart,
configuration replacement, data restoration, archive replay, scanner enablement,
branch creation or cleanup occurred. Eleven original user files retain their
hashes, including build-info and both audit/evidence batches.
Canonical counts after writers resumed were not compared to the stopped
baseline and are not claimed unchanged.

## Recovery and remaining limits

The immediately preceding `67e6336` understands the same 0059 schema and worker
jobs; its images remain the direct application rollback. Recovery still requires
fresh stopped-writer, active-job and data compatibility checks. Never downgrade
the database or restore user data automatically. No rollback was needed.
The still older `be58b12` does not understand the 0059 backfill job and is not an
unconditional recovery target.

Not verified by this release: authenticated production UI/real device behavior,
physical clipboard or screen reader, the user's original ZIP retry, the real
47-conversation offline update, sustained load or restore/off-site recovery of
this production backup. Synthetic CI and service health do not establish these.
Existing offline copies update normally; deployment does not rewrite them.

[Sanitized machine receipt](../evidence/release-2026-11-06/image-reading-deployment-summary.json)
owns exact artifact/runtime/backup evidence. Detailed operator evidence remains
in desktop batch `chat-reader-deploy-9cf235f-20261106`, and CI evidence in
`chat-reader-images-reading-fix7-20261106`.
The existing CI recheck remains paused; no schedule was created or resumed.

## Subsequent authorized cleanup

After the 91% disk warning, the user explicitly approved clearing this task's old
backups and images. This separate authorization covered bounded retention only:
two latest verified recovery points and current/direct rollback images must
remain. It did not authorize user-data, volume, release-archive/evidence deletion,
global Docker pruning or scheduled cleanup.

| Boundary | Verified cleanup result |
| --- | --- |
| Completion / independent recheck | **2026-11-06 22:50:39 / 22:53:09 +08:00** |
| Kept backups | `chat-reader-20261106T140111Z`, `chat-reader-20261105T160504Z` |
| Removed old backups | `chat-reader-20261104T004004Z`, `chat-reader-20261103T155702Z` |
| Kept images | All eight API/worker/migrate/Web tags for `9cf235f` and `67e6336` |
| Removed images | Eight exact tags for `be58b12` and `3b839dc`, four unique image configs |
| Backup unlinked bytes | **1,987,286,636**; only last-link logical bytes counted, not shared references or allocated blocks |
| Filesystem space | 91% → **85%**; available **3,880,612 → 6,167,464 KiB** at apply completion; independent recheck **6,167,416 KiB** |
| Measured available-space increase | **2,341,736,448 bytes ≈2.18 GiB** at apply completion, including concurrent system activity |
| Runtime | API/Web/PostgreSQL healthy, worker `alive_idle`, HTTPS health/login 200 |

The immutable `9cf235f` backup helper was SHA-verified and used under its shared
backup-operation lock, with an exact four-directory allowlist. All four points
passed five SHA-256 checks, four tar-stream scans and PostgreSQL TOC before
deletion. The retained two were verified again after deletion and during the
independent recheck; their original identities and checksums match.
The matching installed PostgreSQL image performed TOC checks with 96 MiB memory,
no network, no mounts, read-only root and no pull/build. The apply report's
`held: 1` is its own lock directory; post-lock verification had zero held entries.

Every old image config was checked against **all running and stopped containers**
and rejected if it had an unapproved alias or shared a protected config ID.
Deletion used only exact tags, without force or parent/global pruning. The final
image inventory equals the previous inventory minus exactly those four configs;
all unrelated images remain.

All eleven existing container identities/start times/restarts/mounts were
unchanged. Production env/Compose/Nginx/current-and-rollback pointer hashes,
PostgreSQL identity, schema 0059 and host OOM count were unchanged. No services
were restarted. Live canonical row counts were deliberately not compared.
No user files, data volumes, image-transfer archives, original release evidence
or unrelated workloads were deleted. Eleven original local files remain hashed
and preserved; no application source, local application test, new CI dispatch,
deployment or automation change was needed.

The original deployment machine receipt remains immutable. The separate
[sanitized cleanup receipt](../evidence/release-2026-11-06/image-reading-cleanup-summary.json)
and task batch `chat-reader-release-cleanup-9cf235f-20261106` retain this result.
Two local verified backups are not a production restore drill or off-site
recovery guarantee. Future capacity checks and cleanup still need fresh review.
