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
- Full API/PWA, broader Reader/Share/auth/offline and exact-source image CI remain
  pending and are not counted as passes here.

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

Production remains aee64ff until separately verified deployment. The dedicated
Context exporter and attachment-only batch downloader have separate contracts;
this stage does not claim to fix them. A read snapshot stays open for the bounded
worker job, not during user downloading. Process crashes still rely on existing
orphan cleanup. Generic export cancellation was not added. Same-size object
corruption becomes an explicit error instead of silently generating a broken ZIP.

Repeated export labels/timestamps in Task Center remain a separate UX follow-up.
The continuous optimization goal remains active. Before deployment: full CI on
the exact committed source, independently verify its artifact, fresh release
helpers based on live aee64ff, retain two verified backups and the old recovery
archive, then remove only replaced image tags after acceptance. Off-site copies
remain deferred.
