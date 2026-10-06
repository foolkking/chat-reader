# Direct export snapshot and download recovery — 2026-10-06

Status: local implementation and focused acceptance; new CI and deployment pending.
Production remains `bdfb725` / migration `20261006_0048`.

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
is not claimed fixed. CI-wide Reader/Share/offline and production acceptance remain
separate gates; the continuous optimization goal stays active.
