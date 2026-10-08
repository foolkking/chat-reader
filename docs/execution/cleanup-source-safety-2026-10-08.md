# Cleanup source replacement safety — 2026-10-08

Batch 27 investigates a source-backed risk while batch 26 browser acceptance
awaits explicit permission to retry rejected loopback Web startup. No rejected
command is retried here. Scope: preserving canonical edits when cleanup and
source-version changes overlap. Production, CI and deployment are excluded.

## Findings before implementation

- High, observed source: `replace_current` mutates a MessageVersion in place.
  Cleanup preview fingerprints contain version IDs but no content hashes;
  occurrences still selected at matching offsets can survive a changed source.
  Test the real edit/preview/replace/apply sequence before changing production code.
- Concurrency hypothesis: cleanup and editing do not visibly share message write
  locks before checking source. Inspect actual route/service transaction boundaries
  and reproduce with PostgreSQL before claiming an overwrite defect or choosing
  a correction. The scan lock already serializes cleanup decision/apply operations.

Prefer the existing conflict/rescan UI and version machinery. Source changes must
not silently acquire prior deletion consent. Use synthetic messages only. Task
TEMP/TMP: `chat-reader-cleanup-source-safety-20261008`. Tests pending.

## Implemented behavior

Both defects were reproduced: the sequential old-preview apply returned 200,
and the actual PostgreSQL race created a third version that overwrote the other
editor's accepted change. Candidates now bind SHA-256 of exact UTF-8 source;
whitespace-normalized canonical hashes are insufficient for offsets.
Same-ID edits and unknown historical source bindings require rescanning. Preview
fingerprints also detect changes while preparing a response. Exception learning
uses the same source check.

The shared version writer acquires the message lock and rechecks current ID,
canonical hash, deletion and exact source before any write. Replacement, version
selection and version deletion use the same guard. Cleanup locks its affected
messages in ID order before writing within a conversation. Historical ancestry
is not treated as the current base, so restore still works. Initial creation,
split/merge, deterministic repair and attachment editing remain supported.

Migration `20261008_0050` follows 0049. It stores no source body; backfill streams
one version at a time and only binds candidates whose target revision/current
version can still prove the old source. Unknown candidates retain their records
and need a rescan. Production remains 0048.

## Verification and limitations

Final evidence summary: [API/PostgreSQL results](cleanup-source-safety-2026-10-08-evidence/results.json).

| Final gate | Result |
| --- | --- |
| API/source safety, cleanup, edit/version history, derived rebuild, Reader contract/locator, attachments | 62 passed |
| Split/merge, exporter repair and attachment uploads | 22 passed |
| Actual PostgreSQL concurrency, completion/recovery and migration | 9 passed |
| Cached same-ID whitespace replacement | 1 PostgreSQL case passed |
| Edit during preview | 1 PostgreSQL case passed |
| Alembic | Single head `20261008_0050` |

Final union: **84 API-related cases and 11 PostgreSQL cases, zero skipped**.
Two targeted PostgreSQL runs deselected unrelated tests; those are not extra
passes. Final API files are disjoint. Earlier smaller passes are not added again.
The race tests use independent transactions and actual blocking detection; only
the timing boundary is controlled. Stored source/version counts are checked.

Intermediate failures remain separate: baseline API 1 failed; PostgreSQL baseline
2 passed/1 failed. The first exact-source migration leaked connection-level stream
mode into Alembic's version UPDATE (3 failed); stream mode is now statement-local.
An inner join in the write guard then rejected initial message creation before a
current version existed (API 22 failed/40 passed, PostgreSQL 9 failed). An outer
join retains the same conflict checks and supports initial creation. Subsequent
final runs above passed; the original failures are not relabeled as passes.

No Web code changed in this batch, so batch 26's lint/TypeScript/build evidence
remains applicable to the local Web tree; it does not substitute for browser
acceptance. Reader/Share/offline canonical propagation has API-level regression,
but a browser/PWA run against the new backend remains **not executed**. The rejected
Web startup was not retried through another mechanism. No production or whole-suite
claim is made. New tests and all prior local work remain uncommitted.

The task-owned PostgreSQL supervisor stopped cleanly; no listener remains on
45438/8008/8328/3107. Diff checks pass and staging is empty. No local Docker image
build, push, CI, deployment or production change occurred. The wider goal remains
active; batch 26 and this backend change still require browser acceptance.
