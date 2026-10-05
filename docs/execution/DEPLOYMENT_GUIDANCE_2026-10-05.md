# Core guidance deployment — 2026-10-05

The user authorized commit and deployment. Application implementation is
`9e6f8baad9ab37eb5b0140379d086f0625f1fdb5`; the queued-import test correction is
`3f1d539d82fdbaa5d4f7f0b7f8857870c13c1926`, the intended release source.
Release CI: [37259074167](https://github.com/foolkking/chat-reader/actions/runs/37259074167).
Attempt 2 completed successfully on the unchanged release source. Production
replacement follows the verified artifact and consistent-backup gates below.

## Evidence and corrections

- Initial CI `37258215124`: API/settings passed; Context browser 31 passed,
  3 failed because the new fixture expected synchronous import HTTP 200 instead
  of the worker's valid HTTP 202. No deployable image was produced or deployed.
- The correction waits for the actual import status to become committed, then
  checks the single persisted conversation before testing guidance. It does not
  relax file, download, dismissal, range-counting or browser assertions.
- New CI API: 876 passed / 3 skipped; runtime Bundle tests: 64 passed; focused
  observability/worker suite: 53 passed. Skips are not counted as passes.
- On release source `3f1d539`, attempt 1 passed API and Web quality. Settings
  ended at 125 passed / 1 failed: a proxy connection reset interrupted the
  768px Chinese learned-format import. API logs show no exception for that
  request and the UI stayed in recoverable import failure. Attempt 2 reran the
  entire failed settings job and dependent image gates on the unchanged source;
  all 126 settings tests and the isolated fresh PostgreSQL restore passed.
  All assertions remain intact. First-attempt settings evidence was archived
  locally and in the private release directory as `settings-ci-attempt-1.zip`
  before releasing its duplicate GitHub artifact name for the rerun upload.
- A supplemental local asynchronous-worker check used SQLite and hit its writer
  lock during the separate progress update: 1 passed / 3 failed. This is retained
  as failed local environment evidence, not claimed as a successful import test.
  The release gates exercise the real PostgreSQL/worker path.
- GitHub CLI uses the existing system Git credential for the requested GitHub
  account in process memory. No credential was printed, committed or replaced;
  the user did not need to sign in again.
- Existing production checkout/configuration changes are preserved. Release
  helpers are staged separately under the intended source revision; these files
  alone do not change running services.

## Deployment boundary

Before this release production is source `5ef984a`, Alembic `20261003_0046`.
The planned procedure is verified CI artifact, capacity check, consistent
five-component backup, migration verification, and `--no-build` recreation of
API/worker/Web. PostgreSQL and production environment must remain unchanged.
Current/Index, private Skills, Share URLs and user imports are not modified by
deployment smoke tests. Image cleanup follows successful acceptance and must
preserve the verified recovery archive and backups.

## Successful release gates

Attempt 2 reports all five jobs successful: API quality, Web quality, settings
quality, image build and independent artifact inspection. API: 876 passed /
3 skipped; shared runtime Bundle: 64 passed; focused worker/observability:
53 passed; Context browser: 34 passed; default PWA: 134 passed / 268 mode-specific
skips; authentication: 18 passed; offline negatives: 17 passed; settings:
126 passed plus 1 isolated PostgreSQL archive restore. Lint, typecheck, Web build
and migration gates passed. Overlapping suites are not added as unique coverage.

Release artifact `chat-reader-images.tar.gz` is 196,501,544 bytes; SHA-256:
`fd6e1fd236d3c24de4efa6080a226e0f44852a07736bfc70aecbf204ad6d1cdd`.
The server transfer matches. API/worker/migrate image:
`sha256:1804286fd8d383ee129993f26dce6de44b7ea8c727a2e455acf2bf3772f3ca2f`;
Web image:
`sha256:8c2a3420517d1be4945498cb92826259770b8426e80f74b67e8a0bd71bc25bf7`.
All revision labels and amd64 architecture match the release manifest.

## Capacity preflight and bounded cleanup

The first capacity check refused deployment: 4,668,064 KiB available against
5,278,142 KiB required. No production service was changed at that point.
Two superseded outer CI ZIPs were streamed and compared against their retained
sibling image archives; both pairs have identical SHA-256. Only those duplicate
outer ZIPs and the unreferenced `ad223cd` image transfer were removed, reclaiming
586,190,162 bytes. The latter was neither current nor rollback nor referenced by
any container; its manifest and CI provenance remain.

Two exact, reclaimable, unshared BuildKit cache records in the confirmed
Chat Reader API build chain were removed (3.828 MB and 143.9 MB). No global prune,
unrelated application cache/image removal, business-data cleanup or backup
deletion was performed. Current `5ef984a` and prior `0219fd5` recovery archives
remain. The second capacity check passed with 5,399,892 KiB available against
the unchanged requirement.

## Backup, replacement and live acceptance

Verified backup: `/opt/chat-reader/backups/chat-reader-20261005T042224Z`.
API and the idle worker were stopped during the consistent PostgreSQL/imports/
exports/offline/assets backup; all five checksums and archive/dump readability
checks passed. Migration verification remained `20261003_0046 (head/current)`.
Canonical row counts, private Skill aggregates and all 301 attachment-object
checksums matched before and after migration. PostgreSQL identity/start time and
the production environment hash remained unchanged.

Only API, worker and Web were recreated using loaded CI images with
`--no-deps --no-build`. Runtime image IDs and revision labels match the manifest.
API/Web/PostgreSQL are healthy; worker heartbeat is alive_idle. All containers
have zero restarts and no OOM state; application startup logs contain no detected
error/exception/fatal keywords. Existing server checkout, Compose and Nginx
configuration were preserved. No production build or volume deletion occurred.

Real authenticated smoke passed login and twelve read-only settings endpoints.
Two owned conversations returned the expected guidance schema and 100-message /
60,000-character thresholds. No conversation bodies or IDs were recorded. Logout
returned 204 and subsequent private access returned 401. Three public system
Bundle ZIPs have the pinned user-supplied hashes and download headers. Both
synthetic 12 MiB anonymous Context/Skill uploads returned 401 without creating
artifacts. Public HTTPS health is 200 and HTTP redirects to HTTPS with 301.

The live login form was reached in the in-app browser. Full authenticated
production browser interaction was not repeated; the three-width, bilingual
guidance/export behavior is supported by the CI and earlier synthetic local
browser evidence. Independent external-model maintenance remains unverified.

## Post-acceptance cleanup and recovery

The authoritative current release pointer now selects `3f1d539`; rollback points
to `5ef984a`. After all acceptance checks, exactly four old Chat Reader application
tags (API, worker, migrate, Web) were removed after proving no container used
their image IDs. No global Docker prune was used. This reclaimed 283,901,952 bytes
(about 271 MiB); measured available space was 3,545,767,936 bytes (about 3.3 GiB).

All backups remain. The retained `5ef984a/chat-reader-images.tar.gz` was rechecked
before removal; SHA-256 is
`f02561e450dc6ec3cc957dbe73ebc817e27c610c4c9018b86ac20891a15fd1f7`.
Rollback requires loading that archive before selecting rollback-images.env;
`/etc/chat-reader/release-state/rollback-requires-load.txt` names it explicitly.
The older `0219fd5` recovery archive and new release archive also remain.
Local workstation residues were not removed and remain for the user.

After cleanup, service health, worker heartbeat, all three runtime revision
labels, public HTTPS, PostgreSQL identity/start time and unchanged environment,
Compose and Nginx bytes were checked again successfully. An initial invocation
of the health helper lacked its absolute Compose/env context and exited before
checking services; the correctly configured wrapper completed all checks above.

The subsequent documentation-only commit records this deployment; production
continues to run the CI-tested source `3f1d539`, not the later documentation HEAD.
