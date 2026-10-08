# Offline attachment integrity — 2026-10-08

Local repair; browser acceptance pending. No deployment or migration.

## Reproduction

The offline exporter used ZIP file copying without comparing copied content to
the asset's canonical size/hash. Real worker tests showed that same-size corruption
and truncated files produced committed tasks and replaced the previous package.
Missing files already failed and preserved the previous package.

The initial shared export fixture had a notebook block without the ID required by
offline serialization; those three failures were fixture failures, not evidence of
the target defect. After adding synthetic block IDs, the baseline was 2 failed /
1 passed on actual worker terminal state and package persistence.

## Change

Offline assets are copied in 1 MiB chunks, hashing the actual bytes written.
Oversized input aborts early; final size/hash mismatches prevent publication.
Read/write errors produce a path-free packaging error. Cancellation/progress is
checked between chunks at a throttled interval. Failed staging is removed by the
existing exporter cleanup; previous artifacts are untouched until successful
publication and transaction commit. Source files are not altered by packaging.

## Verification

17 distinct tests pass, zero skips: 16 worker/API integration cases and one focused
chunk-cancellation case. The first gate passed 15; the expanded four-case repair
gate overlaps three of those tests; the cancellation test adds one.

Negative cases include equal-size corruption, truncation, growth and missing files.
Each verifies failed task state, absence of a new artifact, byte-identical previous
package, no staging residue, then successful publication after source repair and
the exact recovered bytes extracted from the final ZIP. Related offline annotation
and artifact-transaction tests remain green. The cancellation test verifies only
one 1 MiB chunk was written before cancellation and source bytes were unchanged.

No database contract change: tests use existing SQLite FK integration fixtures.
PostgreSQL, Web build/lint and PWA were not rerun for this filesystem-only change;
prior browser acceptance remains pending. No test services were started.
Aggregate evidence: `offline-asset-integrity-2026-10-08-evidence/results.json`.
