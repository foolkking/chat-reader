# Durable batch exports — 2026-10-06

Status: deployed, accepted and verified after cleanup.
Production source **aee64ff6146d3ac915b2a281aac3bc040268ffed**;
Alembic remains **20261006_0048**, single head/current.

## Reproduction and scope

The archived list selected three synthetic conversations. One direct CanJSON
request returned 503, but all three requests ran, the browser raised an unhandled
`Export failed (503)` error, and the page showed no failure. Both list handlers
used the same Promise.all / ArrayBuffer / main-thread zipSync path.

Both conversation and project lists now submit one owner-scoped background job.
The ZIP still contains numbered CanJSON files in the submitted order, with no
binary attachments, annotations, notebook or Continuation. It is not a `.cr`
backup or Context Package. Selection remains after failure. A lost response
retains its key in the mounted submitter for safe retry. Tasks remains the
re-entry point after refresh; there is no new permanent task history.

The existing single worker writes entries sequentially under one PostgreSQL
read-only repeatable-read snapshot for the complete batch. Source ownership and
account state are checked before admission, inside the snapshot and before
publication. Final publication is atomic at the existing job/artifact boundary.
Cancellation and ordinary rollback/commit failure remove the task's new files;
process crashes still use the existing orphan-cleanup contract. No migration.

The job participates in Task Center cancellation/retry, the Root-controlled
three-minute default export lifetime, explicit result close, protected transfer
leases, expiry/reclamation and regeneration against current sources. Closing a
list does not cancel admitted work. The client discards late responses after an
account change. Admission waits at most 20 seconds before offering safe retry.

## Local evidence

- Baseline: 3 requests despite failure, 1 unhandled error, 0 error alerts.
- New batch + retention suites: 43 passed, including 7 actual PostgreSQL cases.
- Expanded batch suite: 17 passed (the original 13 plus entry/compressed/expanded
  limits with retry, and queued cancellation). A final retry-helper verification
  passed: 3 passed / 14 deselected using the actual retry service. These suites overlap; do not sum them.
- Related snapshot/artifact/cleanup: 24 passed, 1 Windows symlink skip.
- Actual browser: 6 passed across 375/768/1440px, Chinese/light and English/dark,
  archived/project lists, HTTP failure, real admitted response loss, same-key
  retry, refresh, keyboard, actual ZIP entries/order/content, and regeneration.
- Additional actual account-switch browser test: 1 passed. The old account's
  late response cannot open or populate the new account's Tasks; server returns
  404 for its job. Screenshots show bounded layouts and visible failure recovery.
- Web lint, typecheck and build passed. Alembic has the single head `20261006_0048`.
- Full API/PWA and broad authenticated release gates passed in the separate
  exact-source CI recorded below; local runs above are not presented as that CI.

Initial test corrections are not passes: mkdir exposed an exception outside the
storage-error wrapper and was fixed; a regeneration test incorrectly supplied
an ID instead of an artifact row. Browser setup initially matched Next's route
announcer as a second alert and reused a unique project name; selectors/fixtures
were corrected before the six-case passing run. One related-suite command named
a nonexistent test file and collected no tests; the corrected run is above.

Temporary files are confined to
`C:/Users/86182/Desktop/wkkk/chat-reader-batch-export-20261006`; browser evidence
is in ignored `apps/web/test-results/batch-export-local-2` and `batch-export-auth`.
Local tests use only synthetic data. Production acceptance below reads owned
content in memory and records aggregate checks only. No local/server Docker
build, off-site backup or local-residue cleanup was performed.

## Remaining boundaries

One read snapshot remains open while the single worker prepares the batch;
temporary disk capacity and selected conversations' serialized sizes determine
duration. A browser connection is not held during generation. The 1–5000 source
bound and existing entry/compressed/expanded limits reject an oversized batch
without partial download. An accepted retry after source edits is a new current
snapshot, not a replay of old bytes. Ordinary direct-download and background
attachment-bundle scope limits from the previous release remain unchanged.

The continuous optimization goal remains active. Repeated completed exports in
Task Center can still be difficult to distinguish; that is a follow-up observation,
not a claim that this stage improves every task's labeling.

## Exact-source CI and artifact

[CI 37429071820](https://github.com/foolkking/chat-reader/actions/runs/37429071820)
passed all five jobs without a rerun. API: **964 / 3 skips**, runtime/Bundle **64**,
cleanup **53**; settings browser **164** plus **1** fresh PostgreSQL restore.
Context **35**, auth **18**, offline negatives **17**, baseline PWA **134 / 312
gated skips**. Reader/Share/upload/source-editor/PDF/CSP, lint/typecheck/build,
migration and image checks passed. Suites overlap; gated or missing-sample
cases are not counted as passes. The seven new batch browser cases passed.

Original artifact **11396964056**, producer attempt **1**, contains an image
archive of **193,612,457 bytes**, SHA-256
`44ccb4dc95afccf6cdb6f675c2f95705b837f4da00e32e47a57c81e4163ee02d`.
All **50** blobs/configurations and exact-source support members were checked
before upload. Server transfer hashes matched. Docker images were built only
in GitHub CI, with the exact source revision and linux/amd64 provenance.

| Runtime | Image ID |
|---|---|
| API / worker / migrate | `sha256:c1bdfc749487e1fe77581b8af093221aef2684f4d37b45c37a3110c291ca9551` |
| Web | `sha256:800b780a3fc6bb307f3889c35480b0d4c33a5375b2daecf548cab37033aded00` |

## Production acceptance

Fresh release helpers were bound to aee64ff and the actually deployed e27f415
baseline. Capacity passed before loading images. The worker was idle, then
API/worker stopped for the verified five-component backup
**chat-reader-20261006T075948Z**. PostgreSQL was not restarted. Migration retained
0048 and unchanged canonical counts/attachment checksums. Application services
were replaced with `--no-build`; acceptance began after API/Web became healthy.

Verified over actual HTTPS:

- Login, 14 settings/admin reads, owned guidance, three system Skill purposes,
  six resolved downloads and three byte-exact public ZIPs; private access after
  logout and unauthorized uploads remain denied.
- Four direct download formats; content length, UTF-8 filenames, parseable
  content and CanJSON counts agree. No downloaded Raw body was saved.
- Two existing owned conversations exported in one correctly ordered batch ZIP.
  Duplicate submission returned the same task. Explicit close caused physical
  reclamation; its download became 410, and anonymous access remained 401.
- Context ZIP/Range, physical release and idempotent regeneration still work.
  Historic 63 exports were already reclaimed before deployment; their bytes are
  not reported as newly freed by this release.
- Canonical counts, personal Skill fingerprints, all **301** attachment checksums,
  imports/offline fingerprints, PostgreSQL identity/start time, environment,
  Compose and Nginx remain unchanged. API/Web/PostgreSQL healthy, worker alive_idle,
  zero restarts/OOM/startup-error keywords; public health 200, HTTPS redirect 301.

No complete interactive production browser matrix is claimed. The seven local
and seven exact-source CI batch browser cases supply UI evidence. SMTP remains
unconfigured; real external mail delivery is not claimed.

## Retention, rollback and final verification

The new backup reused **3** identical components, avoiding **623,608,310 bytes**.
These are two logical recovery points, not independent physical/off-site copies.
After acceptance, retention removed one older backup, reporting **243,995,741
unlinked bytes**. Final report: verified=2, held=0, candidates=0. Retained:
**chat-reader-20261006T061915Z**, **chat-reader-20261006T075948Z**.

Four replaced e27f415 image tags were removed after checking all container
references; measured available-space increase was **284,798,976 bytes**.
The verified recovery archive remains at
`/opt/chat-reader/releases/e27f415024252eaffa527957a37766699a6962a9/chat-reader-images.tar.gz`,
SHA-256 `5f31b3e7491c7450c46865b559089c83384d634ab97345ac1ebf0273ad4a97f4`.
Load it before using rollback-images.env; no database downgrade is needed.

Post-cleanup health, source and data/configuration checks passed. Final available
space: **16,091,594,752 bytes (14.99 GiB)**. This is a final observation, not a
cumulative cleanup claim; the release also added new images/archive/backup data.
Sixteen aggregate production evidence files are retained in this task's temporary
evidence folder. No local residues or business volumes were deleted.
