# Attachment release acceptance — 2026-10-12

Final state: 84988a2 is deployed and accepted with database 0050 unchanged.
Current/rollback pointers are 84988a2/30a0d32 and retention is finalized with two
verified backups. The initial staging checkpoint below is historical.

## Scope and current checkpoint

The user returned the passing CI result and resumed the already authorized
attachment/quiet-reading release. Source is
`84988a260c48fcafb8b3bed6fcb7a1f16348111d`, complete
[run 38255213036](https://github.com/foolkking/chat-reader/actions/runs/38255213036),
producer attempt 1. All five jobs completed successfully. This is the twelfth
complete run in the same authorized cycle; prior failures remain in the
[release history](ATTACHMENT_READING_RELEASE_2026-10-09.md).

API: 1,239 passed, 3 skipped, 20 warnings, 831.56 seconds. Separate overlapping
Bundle/cleanup gates passed 64/53 tests and are not added to the full-suite count.
Web: all 13 required gates PASS, including Context 35, mutation 100, attachment
21, PDF 13, default PWA 135, owner-auth 18 and negative PWA 18 passing cases.
Conditional skips remain distinct: adaptive import 1; default PWA 699.
Settings: 439 passed with no failures/skips; fresh-instance restore 1 passed.

## Original artifacts and visual review

Original GitHub ZIP size/digest and safe extraction were independently checked:

| Artifact | ID | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Web evidence | 11751795948 | 16730270 | `d88e3a4014b9d26578d8cd023b5d48212d336531e19697717d534dafd7915ea6` |
| Settings evidence | 11752427039 | 12487630 | `7706b22721698222b8f836250951e1a939d426bec6032eb2dd8f9deb05f83f9c` |
| Images | 11752048475 | 201911277 | `c7ff06f1b521c4667247d9c6ab4e8cc75abd1fb18076447e3c20e14a31338cd6` |

Reviewed 14 original synthetic CI screenshots: mobile/desktop quiet autosave and
declined Context replacement, desktop long PDF and mobile last-page/retry/recovery,
mobile image gallery/CSV/JSON/document/unsupported ZIP entry, and desktop return
to the file panel. No new clipping or blocking control issue was observed.
English Fit page/Fit width/Table/Raw labels within zh-CN remain a nonblocking
localization follow-up. These are CI browser images, not local browser or
interactive production acceptance. Resource bounds are tested contracts, not
measurements of real-device CPU or decoded image memory.

Independent image verification checked all 50 OCI blobs, two image configs,
four exact-source Linux/amd64 tags and the original four ZIP members. API image:
`sha256:48d10c86e6a549adda077c50bb3e0eb5350c69b88fa2b494d527425df29503c0`.
Web image:
`sha256:4edba2580b5ecbe1baaff138f9a7eed945576dbde0caff38c10112caa402f31a`.
Seventeen support paths were extracted with `git archive` from the exact commit
and compared byte-for-byte to `git show`. Seven reviewed deployment helpers were
hashed. Transfer checksums are generated locally; the producer supplied no
checksum file. No local or King build is used.

## Historical initial King preflight and planned acceptance

Initial read-only probe found source 30a0d32 healthy, PostgreSQL running since
the previous release, and the expected existing PostgreSQL 16 Alpine tool image.
The database must remain `20261008_0050`: no migration, reconcile or backfill.
The verified transfer was staged separately under the full candidate SHA.
No service had been replaced at that initial checkpoint.

The plan at that checkpoint was: fresh capacity/configuration/rollback/attachment/two-backup checks, stop
API/worker writers, create and verify a five-component backup, compare all-column
table and four-storage fingerprints, and replace only accepted API/worker/Web
images with `--no-deps --no-build`. PostgreSQL, configuration, operational checkout
and business volumes stay in place. Accept authenticated read-only HTTPS smoke,
runtime provenance/health and bounded live data before pointer finalization and
the existing two-backup retention policy.

After release, ordinary-user optimization continues locally; no additional CI
or deployment is authorized without a new explicit user request.

## Accepted production and finalized retention

Production acceptance completed at **2026-10-12 14:46:19 UTC**. API/worker/Web
run the verified 84988a2 images. API/Web/PostgreSQL are healthy; worker is
`alive_idle`. All three replaced services had zero restarts, OOM kills and
startup error-keyword log lines at acceptance. HTTPS health is 200 and HTTP
redirect is 301. Authenticated read-only smoke passes 18 API routes, three HTML
documents and three exact-source bundled Skill ZIPs; logout is 204 and the
protected route subsequently returns 401. This does not claim interactive
production browser testing.

Fresh five-component backup `chat-reader-20261012T143850Z` passed checksum,
archive-listing and PostgreSQL TOC verification. Stopped-writer comparisons
include **84 tables, every column including source_content_hash**, and all four
storage roots. All are identical; no migration/reconcile/backfill ran. The
attachment audit verified 310 SHA-256 objects / 304 active attachments with
zero issues. After restart, 67 stable table counts and the bounded attachment
binding/size audit passed. Production configuration, operational checkout and
PostgreSQL identity/start time/restart count are unchanged.

The session resumed about nine hours after acceptance. Fresh read-only checks
confirmed the new runtime still healthy and the original pointers still present;
guarded finalization then selected **84988a2 current / 30a0d32 rollback**. Both
exact rollback images remain loaded. No deployment script was replayed.

The established two-point policy retained `chat-reader-20261008T134403Z` and
`chat-reader-20261012T143850Z`. Only the verified oldest point
`chat-reader-20261006T141424Z` was removed after acceptance, unlinking 700,526,846
bytes. That historical point is no longer available locally; the two newer
verified recovery points remain. Final report: two verified, zero held, zero
candidates. Available root space: 12,392,424 KiB. No business volume or user
import was removed. No off-site backup is claimed.

An initial evidence copy preceded completion of the retention report and
contained an empty local `backups-after.json`; local validation rejected it.
After the remote process exited successfully, the completed retention files were
retrieved and validated. Prune's held=1 is its own lock; the final report is zero.
The [sanitized acceptance aggregate](../evidence/attachment-release-2026-10-12.json)
binds CI, images, screenshot selection, data and private evidence hashes.

The release cycle is complete. The broader optimization goal remains active;
the next local batch is the evidence-backed annotations/table follow-up.
