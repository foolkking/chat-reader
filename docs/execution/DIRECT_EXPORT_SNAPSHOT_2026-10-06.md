# Direct export snapshot and download recovery — 2026-10-06

Status: **deployed and accepted, including post-cleanup checks**.
Production source `e27f415024252eaffa527957a37766699a6962a9`; single migration head/current `20261006_0048`.

## Confirmed problem and change

A real PostgreSQL reproduction consumed the CanJSON manifest, committed an insert
on another connection, then consumed the remaining stream. Manifest/end reported
one message while the file contained two: a later edit leaked into the download.
READ COMMITTED lazy serializers could also mix edited versions, ordering and notes.

Direct download routes now drain serializers inside one read-only repeatable-read
snapshot, then release the database before sending prepared bytes. A private spool
spills above 1 MiB; 64 KiB response chunks bound delivery reads. Header/body errors,
disconnect and preparation/event-commit failures close it. Storage failures return
503 without internal paths; no success event is committed on failure.

The original download position now has preparation, cancel and inline retry states.
An error cannot navigate away from Reader. Late responses after format/option changes,
closure or authentication changes cannot trigger a download. UTF-8 filenames and
actual Markdown/CanJSON contents are preserved. Buttons follow existing 44px targets,
paper/ink colors and typography; no additional modal or permanent explanation.

## Acceptance

- New backend tests: **11 passed**, including four real PostgreSQL formats
  (Markdown v2, CanJSON, gzip, legacy JSON), 105 messages and >1 MiB spill.
  Independent commits edit, delete, insert, reorder and change title/notebook.
  Export keeps original data; concurrent edits persist independently. A one-slot
  reader pool has zero connections checked out before client consumption.
- Related final backend run: **60 passed / 1 skipped**. The skip is Windows
  symlink creation in cleanup tests, not a successful safety test. Covers export,
  retention, cleanup and Context export alongside the new suites.
- Final browser matrix: **10 passed** across 375/768/1440px, Chinese/light and
  English/dark. Actual download bytes and filenames, keyboard activation, 503/network retry,
  no navigation, duplicate prevention, cancel, options/format/close and revoked
  account behavior verified. The late response also remains blocked after logging
  into another account; its server access to the original export returns 404.
- Lint, typecheck and production Web build passed. `pnpm --filter web test:pwa`
  rebuilt production Web and passed the focused 10-test gate; the full PWA suite
  is reserved for exact-source CI. Single head/current is `20261006_0048`.
  No local or server Docker build.

Test corrections are not counted as product fixes: an initial commit-failure test
expected exception propagation but middleware correctly returned sanitized 500;
browser fixtures initially omitted required second message/password confirmation.
An early command named a nonexistent attachment test; no tests ran in that invocation.

Local synthetic evidence lives under
`C:/Users/86182/Desktop/wkkk/chat-reader-export-snapshot-20261006/` and ignored Web
`test-results/direct-export-*`. No production conversation content was used.

## Scope and tradeoffs

Direct preparation delays first byte and requires temporary storage; the client
receives a Blob before downloading. Synchronous server preparation can finish even
after cancellation; response cleanup still releases bytes. No permanent export copy
or new migration is created. No full snapshot guarantee is claimed for background
attachment bundles. The earlier Next stream-close diagnostic remains unproven and
is not claimed fixed. CI-wide Reader/Share/offline and production HTTP acceptance passed as
separate gates; the continuous optimization goal stays active.

## Exact-source CI and production release

[CI 37419965889](https://github.com/foolkking/chat-reader/actions/runs/37419965889)
passed all five jobs on the exact deployed source. No rerun or local/server Docker
build was used. Original artifact **11392973308**, producer attempt **1**, contains
archive **193,569,800 bytes**, SHA-256
`5f31b3e7491c7450c46865b559089c83384d634ab97345ac1ebf0273ad4a97f4`.
All 50 image blobs/configuration and 17 support files were independently checked;
support files match `git show` of this source. The server rechecked transfer hashes.

| Runtime | Image ID |
|---|---|
| API / worker / migrate | `sha256:f33a208f01e07f167a8b40d29173cbe8ac987e1df5aefd52d79af6f1882eb7a6` |
| Web | `sha256:3970f453bd5e499dffb25e0c980eebf00b918c7cf334a790a08e3d1f3a9acc38` |

CI results: API **940 / 3 skipped**, runtime/Bundle **64**, cleanup **53**,
settings **157** plus **1** separate PostgreSQL restore; Context **35**, auth **18**,
offline negatives **17**, baseline PWA **134 / 305 skipped**. Reader/Share/upload,
source editor/PDF/CSP, lint/typecheck/build, migration and image inspection passed.
The new direct-download 10-case browser matrix passed inside authenticated settings.
API's three skips and import's one skip require external samples. Baseline-gated
specialized tests are not passes; suites overlap and are not summed.

Capacity passed before image loading. Worker was idle; API/worker stopped for the
verified five-component backup **chat-reader-20261006T061915Z**. PostgreSQL was not
restarted. Migration retained 0048, canonical counts and all 301 attachment checksums.
Services were replaced with `--no-build`. The first readiness probe observed Web
starting; acceptance resumed after it became healthy, without rebuilding/redeploying.

Production acceptance passed:

- API/Web/PostgreSQL healthy, worker alive_idle; zero restarts/OOM/startup-error keywords.
- Login, 14 settings/admin read endpoints, two owned guidance queries, three system
  Skill purposes, six resolved downloads and three exact public ZIPs.
- Four direct formats via real HTTPS: Markdown, CanJSON, gzip CanJSON and legacy JSON;
  actual content lengths, filenames, parseable content and consistent CanJSON counts.
  No returned Raw body was saved. After logout, private export access returns 401.
- Actual export ZIP/Range, early physical reclamation, 410 expiry and idempotent
  regeneration. Existing 61 expired exports were already reclaimed before this
  deployment; they are not counted as newly reclaimed bytes.
- Canonical counts, personal Skill fingerprints, attachment checksums, imports and
  offline fingerprints equal before/after. Environment, Compose, Nginx and PostgreSQL
  identity/start time unchanged; public HTTPS 200 and HTTP→HTTPS 301.

No full interactive production browser matrix or external SMTP delivery is claimed.
SMTP remains unconfigured. No off-site copy was requested or created.

## Post-acceptance cleanup and rollback

The new backup reused **3** identical components, avoiding **623,608,310 bytes**;
shared components mean these are two logical recovery points, not independent
physical copies. Retention removed the older **025905Z** backup only after verification,
reporting **1,361,044,848 bytes** unlinked. Retained:
**chat-reader-20261006T043843Z** and **chat-reader-20261006T061915Z**.
Final report: verified=2, held=0, candidates=0. During pruning held=1 is its own lock.

The four replaced bdfb725 tags were precisely removed after checking that no container
uses them. Measured free-space increase: **347,111,424 bytes**. Its recovery archive
remains at `/opt/chat-reader/releases/bdfb7257341f0f74685de4ad80e339fbde525ab7/chat-reader-images.tar.gz`,
SHA-256 `2eebe4348d56146d13f2f370bd48dab17b3a3bd9513f0a3bc314c2678e877f0b`.
Load it before using `/etc/chat-reader/release-state/rollback-images.env`; no database
downgrade is required. Business volumes and local residues were not removed.

Final post-cleanup health/source/data-configuration checks passed; available space
**16,295,895,040 bytes (15.18 GiB)**. This is a final observation, not a cumulative
cleanup claim; the release also added images, its archive and a backup.
Fifteen sanitized production evidence files are retained in this task's
`production-evidence/`; server records are under
`/opt/chat-reader/releases/e27f415024252eaffa527957a37766699a6962a9/`.
This release stage is complete; the overall optimization goal remains active.
