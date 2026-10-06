# Attachment export integrity — 2026-10-06

## Reproduction and result

Actual PostgreSQL concurrent append/attachment replacement during lazy CanJSON
serialization produced a ZIP declaring two messages while containing three;
attachment SHA did not match the copied bytes. `Synthetic 100x` lost literal `0`
and `x` in its filename because a raw-string sanitizer interpreted them as forbidden
characters. An interrupted copy left one staging ZIP behind.

The attachment-bundle worker now uses the existing read-only repeatable-read
snapshot across metadata, messages/order/versions, description, notes/annotations
and attachment mapping. Actual object bytes are copied in bounded chunks and
SHA/size verified before publication. Missing objects retain explicit metadata;
corruption fails without publishing a misleading successful artifact. Account,
source ownership and object availability are rechecked. No schema migration.

Creation/publication cleanup and transaction-owned final files cover write,
rename, callback and commit failures. Nested stream iterators close on interruption.
Existing configurable size/count limits are enforced. Filenames retain `100x`,
and Markdown attachment destinations escape spaces/parentheses/hash characters.
Export panel/Task Center explain integrity, storage, size and access failures in
Chinese and English. A repaired source can retry through existing workflows.

## Local verification

- Final combined attachment/real-PostgreSQL run: **29 passed** (20 attachment
  cases plus 9 PostgreSQL cases). This includes real retry/expiry/regeneration
  and bounded-copy checks. Earlier incremental runs passed 18 plus 2 cases.
- Shared Context/export/retention/batch/transaction suites: 71 passed, including
  the original 18 attachment cases; do not sum overlapping suites.
- Migrated PostgreSQL: 9 passed. Append and edit/delete/reorder races in both
  formats retain the old coherent message, note, annotation and attachment
  snapshot. Disabled account, deleted source, ownership change, blocked and
  deleted asset cases do not publish.
- Browser: 3 passed at 375/768/1440px, Chinese/light and English/dark. Real uploaded
  attachment is corrupted in the disposable test store, actual worker fails,
  localized error is visible, restoring bytes and keyboard submission succeeds.
  Actual downloaded ZIP filename, count, member sizes and hashes are checked.
  Mobile failure and middle-width success screenshots were visually inspected.
- Lint, typecheck and Web build passed. Single Alembic head: `20261006_0048`.
- Full API/PWA, Reader/Share/auth/offline and exact-source image CI are recorded
  separately below; local tests are not counted as CI evidence.

Initial failures are recorded, not counted as passing evidence: a test imported
an unused nonexistent helper (collection failed); the PostgreSQL interception
helper assumed every iterator had `.close()` (2 failed / 7 passed), corrected
before the 9-case passing run. First local Web build failed with Windows error
1455 (page-file/thread allocation). Process-local thread limits allowed the same
source build to pass; global machine configuration was not changed.

Temporary data/evidence are confined to
`C:/Users/86182/Desktop/wkkk/chat-reader-attachment-export-20261006`.
All new tests use synthetic sources. No user import, local residue or production
data was deleted. No local or server Docker image build was performed.

## Scope and release status

Production now runs f0e355a following the separately verified deployment below. The dedicated
Context exporter and attachment-only batch downloader have separate contracts;
this stage does not claim to fix them. A read snapshot stays open for the bounded
worker job, not during user downloading. Process crashes still rely on existing
orphan cleanup. Generic export cancellation was not added. Same-size object
corruption becomes an explicit error instead of silently generating a broken ZIP.

Repeated export labels/timestamps in Task Center remain a separate UX follow-up.
The continuous optimization goal remains active. The release followed exact-source CI, independent artifact verification and fresh
helpers based on live aee64ff. Two verified backups and the old recovery archive
remain; replaced image tags were removed only after acceptance. Off-site copies
remain deferred.


## Exact-source CI and deployed artifact

[CI 37439899921](https://github.com/foolkking/chat-reader/actions/runs/37439899921)
passed all five gates without rerunning the workflow. Source:
`f0e355af4169ff593da8134b8148c7dc5c25425d`. API: **993 / 3 skips**;
settings: **167** plus **1** fresh PostgreSQL restore; Context **35**, auth **18**,
offline negatives **17**, baseline PWA **134 / 315 gated skips**. Runtime/Bundle
**64**, cleanup **53**. Reader/Share/upload, source editor, CSP/PDF, lint/typecheck/
build/migration and independent image/artifact inspection passed. Overlapping
suites are not additive; skips are not passes.

Original artifact **11401429587**, attempt **1**, archive **193,606,500 bytes**;
SHA-256 `2bc83c979a90a07178a01e0e7927d05826bc08925123beca0908ecc64441fb06`.
All 50 blobs/configs and exact-source support members were independently checked;
server transfer checksums matched. Images were built only in GitHub CI.

| Runtime | Image ID |
|---|---|
| API / worker / migrate | `sha256:4250b086f415dc56061a131ed518557f5942a6389a976802ae3322874b909138` |
| Web | `sha256:51be79e37b5aee21799e73465cd9c2ed81bef0740e888b775c4de8341d946d68` |

One local CI status request hit a TLS timeout; the observer resumed the same run
with bounded retries. This was not a CI failure or a workflow rerun.

## Production acceptance and cleanup

Fresh helpers were bound to f0e355a and live aee64ff. Space preflight passed.
The idle API/worker were paused for verified five-component backup
`chat-reader-20261006T093548Z`; PostgreSQL was not restarted. Three identical
components were reused, avoiding **623,608,310 bytes**. No schema change; head/current
remains 0048. Only application services were recreated, using `--no-build`.

Production acceptance exercised both attachment formats, **74 object checksums**,
manifest/message counts, physical result-close reclamation, private access and
retained sources. Batch/idempotency, four direct formats, Context/Range,
regeneration, login/settings/default Bundle checks passed. Canonical counts,
personal Skill fingerprints, **301 attachment checksums**, imports/offline
fingerprints and PostgreSQL identity/start time are unchanged. Environment,
Compose and Nginx are unchanged. API/Web healthy, worker alive; no restart/OOM
or startup error keyword was observed. HTTPS health 200 and HTTP redirect 301.
Raw production content was inspected only in memory, not saved to local evidence.
A full interactive production browser matrix is not claimed.

After acceptance the authoritative release pointer was updated. Verified backups
retained: `chat-reader-20261006T075948Z`, `chat-reader-20261006T093548Z`.
One older backup was removed; four old aee64ff image tags were removed, reclaiming
**284,860,416 bytes** at that step. Its verified image archive remains for rollback:
`/opt/chat-reader/releases/aee64ff6146d3ac915b2a281aac3bc040268ffed/chat-reader-images.tar.gz`,
SHA-256 `44ccb4dc95afccf6cdb6f675c2f95705b837f4da00e32e47a57c81e4163ee02d`.
Load it before selecting rollback-images.env; no DB downgrade is required.

Final available server space: **15,887,081,472 bytes (14.80 GiB)**. Post-cleanup
health/revision/configuration checks passed. No business volume/import data or
local residues were deleted. All task-owned local test services were stopped.

C-drive logging failed during backup-retention closeout. The server's completed
`backup-retention.json` was inspected directly, proving successful pruning and two
verified retained backups. The completed operation was not replayed; subsequent
checks used direct output. Authoritative release evidence remains under the server's
versioned release directory. This logging failure did not affect the deployment.
