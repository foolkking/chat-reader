# Release D Performance Characterization Report

This dated report preserves Release D evidence. Current interpretation rules
live in `docs/system/PERFORMANCE_CAPACITY_CONTRACT.md`.

## Scope and source

- Preliminary characterization source (superseded): `286f91fc74b3a86a2cc70cb988138f052e417856`.
- Final characterization source: `da0a79fd116b7a26e30bf2d1f57b1ff658a758f7`; GitHub Actions run
  `31865404393` completed successfully after the failed regression job was
  rerun without a source change.
- Fixture version: `release-d-reader-capacity-v1`; seed: `20260814`.
- Production behavior algorithms were not changed before measurement.
- No synthetic large workload ran on King production.
- No real conversation source, title, ID, filename, token, or credential is
  stored in this report.

## Baseline decision

The final GitHub Actions run and result tables are appended after the complete
quality, capacity, and regression matrix finishes. Earlier diagnostic runs are
not release evidence when their harness assertion or query target was invalid.

The first complete backend baseline established these preliminary facts:

- combined API/worker peak RSS stayed between about 198 and 267 MB for 398 to
  10,000 short-message imports and conversation exports;
- 10,000-message import commit completed in about 9.4 to 15.9 seconds;
- 10,000-message Markdown export took about 27.2 to 40.8 seconds and is a real
  capacity warning, while compressed CanJSON remained around 1.2 to 1.5 seconds;
- 3,980-message `.cr v4` export completed in about 1.4 seconds and restore in
  about 14.3 seconds, with restore peak RSS around 139 MB;
- mounted Reader messages remained in the tens rather than growing to all
  10,000 messages;
- query plans observed so far do not justify an index migration.

These preliminary figures are retained for traceability but do not replace the
final run because Release D later corrected fixture identity reconciliation and
query target selection.

## Production safety snapshot

On 2026-08-14, lightweight read-only production verification reported:

- API and Web healthy, PostgreSQL healthy, worker running, Scanner absent;
- Alembic current/head `20260806_0021`;
- runtime source remains Release C commit `8d0ad66`;
- host RAM 1,961,881,600 bytes, available 783,007,744 bytes;
- swap 3,222,265,856 bytes total, 346,664,960 bytes used;
- root filesystem 41,881,894,912 bytes total, 14,191,927,296 bytes available;
- public API health returned 200 and Release A response headers remained present.

This snapshot is not a production stress result. It explains why 10k workloads
remain isolated and why King headroom is judged from stack steady state plus
external constrained measurements.

## Final results (2026-08-15)

### Executive result

```text
PERFORMANCE_ENVIRONMENT = PASS
PERFORMANCE_OPTIMIZATION_REQUIRED = NO
PERFORMANCE_OPTIMIZATION_CHANGES = NONE
RUNTIME_CHANGES = NONE
NEW_ALEMBIC_MIGRATION = NONE
PRODUCTION_DEPLOYMENT = NOT_REQUIRED
RELEASE_D = PASS
```

The run used an isolated GitHub-hosted Linux stack, not King production. Quality
passed before all characterization jobs, and the final workflow conclusion was
`success`. No Reader, import, export, `.cr v4`, database, or runtime algorithm
was changed for Release D.

### Environment and fixture

The benchmark runner had 4 vCPU, about 16.8 GiB RAM, 3 GiB swap, 91.5 GiB free
disk, Python 3.11.15, Node 20.13.1, pnpm 9.15.4, PostgreSQL 16.14 and the
production-build Chromium test stack. API/worker RSS was sampled from Linux
`/proc` every 50 ms; browser heap is a diagnostic sample rather than a device
RAM promise. Fixtures use seed `20260814`, version
`release-d-reader-capacity-v1`, and contain no production content. Attachment
fixtures preserve distinct business Attachment rows, a shared AssetObject and
Occurrence rows. Large workloads were not run on King.

### Reader capacity

Cold values below are the median/worst navigation time across three runs; the
mounted values are the maximum first-window working set. The warm column is the
observed Rich Markdown invocation delta on revisit, not a persistent-cache hit
counter.

| Workload | Tier | Cold nav ms | Mounted messages/blocks | p95 frame ms | Heap sample MB | Warm parse delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Plain | 398 | 890 / 1102 | 26 / 39 | 33.4 | 22.0 | 540 |
| Plain | 1k | 873 / 1022 | 22 / 33 | 16.8 | 31.6 | 324 |
| Plain | 10k | 2627 / 2938 | 18 / 27 | 16.8 | 17.4 | 324 |
| Math-heavy | 398 | 777 / 950 | 22 / 77 | 16.8 | 54.2 | 924 |
| Math-heavy | 1k | 917 / 1052 | 22 / 77 | 16.8 | 42.6 | 924 |
| Math-heavy | 10k | 2444 / 2612 | 18 / 63 | 16.8 | 29.8 | 756 |
| Mixed rich | 398 | 859 / 937 | 14 / 56 | 16.8 | 42.6 | 504 |
| Mixed rich | 1k | 1003 / 1111 | 14 / 56 | 16.8 | 31.6 | 90 |
| Mixed rich | 10k | 2393 / 2545 | 14 / 56 | 16.8 | 45.2 | 216 |
| Attachment metadata | 398 | 790 / 1007 | 18 / 18 | 16.8 | 33.5 | 238 |
| Attachment metadata | 1k | 924 / 1052 | 26 / 26 | 16.8 | 24.8 | 286 |
| Attachment metadata | 10k | 2418 / 2563 | 18 / 18 | 16.8 | 24.8 | 216 |

All Reader capacity assertions passed: monotonic wheel samples, no page-level
horizontal overflow, no blank window, and no unbounded mounted working set.
The largest observed working set was 26 messages/77 blocks, below the Release D
first-window budgets of 40/120. The 10k rows are `WARNING` as characterization
only, not a normal UX guarantee. Math-heavy revisits do invoke renderer/math
probes again; exact Markdown/KaTeX cache hit/miss is `NOT_DERIVABLE` because the
current test-only probe exposes invocation/source-unit counters, not a cache
telemetry contract. This is a future measurement opportunity, not a proven
budget failure.

### Import, conversation export and memory

Peak values are the maximum sampled API/worker RSS for each operation group.
The short-message tiers stayed bounded; 10k commit/export elapsed time is a
capacity warning rather than an integrity failure.

| Profile | Tier | Preview ms / RSS MB | Commit ms / RSS MB | Markdown export ms / artifact | CanJSON export ms / artifact |
| --- | ---: | ---: | ---: | ---: | ---: |
| Plain | 398 | 154 / 192 | 812 / 197 | 1224 / 95,518 B | 102 / 48,571 B |
| Plain | 1k | 104 / 201 | 1321 / 204 | 2768 / 240,200 B | 153 / 120,727 B |
| Plain | 10k | 611 / 226 | 9977 / 241 | 27,665 / 2,414,203 B | 1730 / 1,200,073 B |
| Math-heavy | 398 | 53 / 231 | 1070 / 232 | 1237 / 108,993 B | 102 / 49,380 B |
| Math-heavy | 1k | 105 / 231 | 1584 / 231 | 3046 / 273,643 B | 205 / 122,734 B |
| Math-heavy | 10k | 668 / 242 | 11,059 / 247 | 30,704 / 2,748,646 B | 2808 / 1,218,568 B |
| Mixed rich | 398 | 53 / 229 | 1076 / 229 | 1760 / 123,124 B | 103 / 49,661 B |
| Mixed rich | 1k | 105 / 229 | 2617 / 231 | 4316 / 309,145 B | 206 / 123,316 B |
| Mixed rich | 10k | 823 / 243 | 17,446 / 248 | 41,473 / 3,103,648 B | 1538 / 1,222,885 B |
| Attachment metadata | 398 | 1384 / 246 | 1334 / 246 | 1050 / 88,844 B | 103 / 50,437 B |
| Attachment metadata | 1k | 822 / 246 | 1806 / 246 | 2535 / 222,875 B | 155 / 124,925 B |
| Attachment metadata | 10k | 2365 / 280 | 10,490 / 278 | 26,438 / 2,235,728 B | 2680 / 1,239,790 B |
| Few-huge (10 messages) | source about 6.75 MB | 619 / 284 | 3610 / 313 | 310 / 6,752,420 B | 155 / 20,380 B |

The 398 and 1k import range is `PASS` in this isolated envelope. The 10k
short-message range is `WARNING` because commit and Markdown export latency
becomes user-visible. The few-huge profile is `WARNING` because its roughly
313 MB peak is materially higher, although it completed without OOM, process
death, data loss or unbounded temporary storage. No streaming rewrite is
justified without a production-equivalent resource budget failure.

### `.cr v4` export and restore

| Dataset | Export ms / archive | Restore ms / peak process RSS | Row preservation | Status |
| --- | ---: | ---: | --- | --- |
| Current-like (398) | 810 / 110,484 B | 2130 / 92.1 MiB | 398 messages/versions, 4 attachments, 1 AssetObject, 4 occurrences | PASS |
| 2x (796) | 1063 / 216,521 B | 3444 / 96.8 MiB | doubled message/attachment rows, shared AssetObject preserved | PASS |
| 10x representative (3980) | 1318 / 1,068,073 B | 13,829 / 138.9 MiB | 3980 messages/versions, 40 attachments, 1 AssetObject, 40 occurrences | PASS / characterized-only |

Fresh isolated PostgreSQL restore preserved canonical rows, history,
Attachment/AssetObject identity and occurrences. The archive format and hash
semantics were unchanged. The 10x result is characterization evidence, not a
product guarantee.

### PostgreSQL query characterization

`EXPLAIN (ANALYZE, BUFFERS)` was run against the synthetic dataset. Reader
message/block lookup executed in 0.580 ms with indexed conversation/order and
version lookups; attachment lookup executed in 0.433 ms using the existing
conversation index; offline state lookup executed in 0.184 ms using the status
index. The full export enumeration was the largest plan at 27.960 ms (10,000
rows, 45,602 version rows scanned, no temp spill). The scan is required to
materialize the export payload and did not justify an index migration.

```text
POSTGRES_QUERY_BASELINE = PASS
DATABASE_INDEX_REQUIRED = NO
NEW_ALEMBIC_MIGRATION = NONE
```

### Web and regression evidence

Production build, lint and typecheck passed. The final regression job passed 23
focused A/B/C, Reader, Rich Markdown and mobile Share tests. The default PWA
matrix passed 67 tests and skipped 50 conditional environment/API cases; skips
remain separate and are not counted as pass. The mobile 390x844 More -> Share
test observed one active dialog, one Esc close and logical trigger focus. The
first regression attempt had one timing-sensitive edge-window assertion fail;
the failed job was rerun unchanged and passed. No source or budget was changed,
so this is recorded as flaky test evidence rather than a product failure.

Release A, B and C focused contracts remained PASS. Rich Markdown/KaTeX,
MathML, GFM, security, Viewer, Share, mutation and PWA baseline regressions
passed. Conditional PWA negative scenarios remain outside this characterization
and are not promoted to PASS.

### Answers to the ten capacity questions

1. 398 and 1k Reader workloads are bounded and pass; 10k remains usable in the
   measured environment but is characterization-only and slower to navigate.
2. Math-heavy revisit counters show repeated renderer/math work. Exact cache
   hit/miss is not derivable from the current test-only counters; no frame,
   long-task or correctness budget failed.
3. Reader virtualization is working-set bounded across all tiers.
4. 10k does not mount all messages/blocks; the working set stayed in the tens.
5. Short-message import RSS stayed below about 280 MB in this stack; 10k commit
   reached about 278 MB and is a latency warning, not an OOM boundary.
6. Few-huge messages use substantially more RSS (about 313 MB for 6.75 MB of
   source) than many-small messages and remain a separate uncharacterized edge.
7. CanJSON is materially faster/smaller than Markdown at 10k; Markdown export
   is the capacity warning. The artifact contract remains intact.
8. Current-like through 10x representative `.cr v4` export/restore completed in
   the isolated database with row and identity checks preserved.
9. Export enumeration is the largest measured query, but its 27.96 ms plan does
   not establish an index need; serialization/compression dominates elapsed time.
10. There is no evidence-backed need for an index, streaming rewrite, Reader
    architecture change or renderer replacement in Release D.

### Capacity contract and stop point

```text
NORMAL_SUPPORTED_RANGE = 398 representative messages
LARGE_SUPPORTED_RANGE = 1,000 representative messages
CHARACTERIZED_ONLY_RANGE = 10,000 messages and 10x .cr representative data
UNCHARACTERIZED_RANGE = larger attachments, multi-GB few-message sources,
                        high-concurrency exports and PWA negative matrix
```

No runtime optimization was required, so no production deployment or image
build was performed for Release D. Existing Release C runtime
`e58b750357d92bba314737582a94493829c038e2`, Actions `31856041473`, production
health, Alembic head `20260806_0021`, and rollback evidence remain unchanged.
All downloaded logs, reports and artifacts used during analysis are under
`C:\Users\86182\Desktop\wkkk\release-d-31865404393` and are not part of the
runtime bundle or PWA precache.

Remaining debt is explicitly limited to the PWA negative matrix, Next supported
LTS migration, PDF.js supported-line migration, CSP enforcement, first
production cleanup apply, worker idle-heartbeat derivation, and future cache
hit/miss instrumentation/performance benchmark work. These are not Release D
failures.
