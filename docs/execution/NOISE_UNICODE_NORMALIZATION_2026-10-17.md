# Noise Unicode normalization — 2026-10-17

## Boundary and reproduced failure

Local continuation after accepted production `3e68d1f/0051`; no push, hosted
CI, deployment, production operation, existing database or import mutation.
This follows the [literal audit](NOISE_LITERAL_MATCHING_2026-10-17.md), whose
three failing probes and source binding remain unchanged historical evidence.

The old shadow normalized each character separately. It missed equivalent
forms requiring cross-character composition or canonical mark ordering.
New regressions before the repair: **23 failed / 5 passed** (20 normalized/
approximate detector cases and three actual API trial failures; raw exact
negative checks passed). This is a functional reproduction, not setup failure.

## Implementation and consent

- The [normalization helper](../../apps/api/app/services/cleanup_normalization.py)
  produces complete NFKC, optional casefold, then whitespace collapse. For text
  already in NFKC it retains a direct-source fast path.
- Otherwise it stably orders NFKD non-starters by combining-class buckets
  (classes bounded to 0–255) before standard-library NFC. Compact unsigned
  source-origin storage and ordered target NFD align equal decomposition atoms;
  the implementation does not invent composition tables or repeatedly
  normalize growing unordered prefixes.
- Source spans include all contributing atoms. They are not assumed monotonic:
  reordered marks and composition across an intervening mark require min/max
  over the matched atom provenance. The result is the minimal **contiguous raw
  envelope**, not a claim that every enclosed mark appears in a partial literal.
  The complete envelope remains visible for explicit review/refinement.
- Normalized-exact and fuzzy candidates use the same original-source mapping
  and whole-envelope protection. Raw exact mode, six-character fuzzy admission,
  rule identity/profile/revisions, API/schema and KEEP/PROTECTED defaults stay
  unchanged. No canonical source normalization, backfill or automatic deletion.
- Trial/learning/rescan/save/preview never publish a canonical version. Only
  explicitly confirmed raw ranges are removed on apply; retained decomposed
  source, CRLF, astral offsets, protected code and original version survive.
  A legitimate pre-repair partial match is also tested: its old selected bounds
  conflict under the new matcher, without widening consent or writing a version.

## Verification

Final related run: **237 passed / 1 skipped**, all 21 `test_cleanup_*.py`
modules without `_postgres.py`, plus `test_content_cleanup.py` (22 modules).
This includes **43 new cases** in `test_cleanup_normalization.py` and
`test_cleanup_unicode_normalization.py`. The skip is the existing
outside-symlink capability case; the Starlette/httpx deprecation remains.

| Check | Actual scope |
| --- | --- |
| Runtime Unicode differential | Unicode 14.0.0; every scalar with decomposition metadata, nonzero combining class, changed casefold, or precomposed Hangul value: 18,859 scalars, three contexts × two case settings = 113,154 complete-key comparisons; separate Hangul Jamo composition vectors |
| Mixed differential | 2,000 fixed-seed strings, length 0–128, composition/reordering/casefold/whitespace/Hangul/compatibility/astral input |
| Provenance | Nonmonotonic leading marks, stable equal classes, interleaved composition, casefold expansion, complete original bounds in normalized and fuzzy modes |
| Long-run work guard | 8,193 source code points; 8,192 one-character NFKD + 8,192 one-character NFD + one NFC on already ordered input; no growing-prefix normalization |
| Actual HTTP workflow | Four trial → confirmed learn → rescan → two raw refinements → token preview → apply cases, including a partial-composition envelope; protected/retained text and exactly one new version |
| PostgreSQL 17 | **10/10** Unicode publication plus existing range/source concurrency/migration guards; newly initialized loopback-only task clusters and disposable databases; offline revision advances |

Focused final normalization/API checks also pass **43/43** before the broad
run; these are a subset, not 43 additional broad cases. The runtime scalar
differential is not the externally published Unicode conformance corpus.
Separate initial and final PostgreSQL runs both pass 10/10; both clusters
stop cleanly and leave no task listener/PID file.
Five Python syntax checks, single Alembic head 0051, 430 relative document
file links, source-bound JSON, added-text credential-pattern checks and diff
whitespace checks pass. The initial closeout verifier resolved untracked paths
relative to `apps/api`; correcting that task-only path selection allows the
whole-repository check to run without changing application/test assertions.

## Resource evidence and iteration

[Sanitized evidence](../evidence/noise-unicode-normalization-2026-10-17.json)
binds baseline `bb38cb1` and the final LF-normalized source hashes. Measurements
are function-only, synthetic, five sequential local timing repetitions
(median); input/import allocations are excluded from `tracemalloc`. They are
not API latency, service RSS, isolated load tests or production OOM proof.
The baseline is **incorrect** for cross-character normalization and is not a
functionally equivalent alternative.

The first complete implementation passed the related suite (**235 / 1 skip**
before two final consent/order cases were added), but profiling found duplicate
source decomposition and two large tuple streams. Compact origin storage
removes the second source pass. For the 32,769-code-point combining sample,
peak allocation drops **14,223,082 → 9,963,670 bytes** and median
**91.433 → 73.892 ms** between the two complete implementations. Mixed input
improves **586.739 → 488.182 ms**, with peak **31,529,372 → 31,864,988 bytes**
(slightly higher, not a universal memory improvement).

| Synthetic input | Code points | Old incorrect → final median ms | Old → final peak Python bytes |
| --- | ---: | ---: | ---: |
| ASCII prose/CRLF | 222,000 | 99.242 → 100.620 | 28,911,353 → 29,774,897 |
| Already-NFKC mixed prose | 220,000 | 111.303 → 111.016 | 32,079,296 → 32,039,244 |
| Mixed compatibility/composition | 198,000 | 104.607 → 488.182 | 29,630,928 → 31,864,988 |
| Unordered combining run | 4,097 | 2.524 → 8.652 | 845,732 → 1,229,758 |
| Same doubled | 8,193 | 4.979 → 17.643 | 1,708,708 → 2,472,166 |
| Same doubled | 16,385 | 9.625 → 34.894 | 3,436,772 → 4,964,358 |
| Same doubled | 32,769 | 19.621 → 73.892 | 6,896,676 → 9,963,670 |

Full provenance remains costlier than the old incorrect per-character path,
especially for long combining/compatibility input. Intermediate storage is
linear, not constant or a hard memory budget. Ordinary normalized text avoids
decomposition provenance; no persistent source cache or dependency was added.

## Remaining boundary

No full API/PostgreSQL 16, Web lint/typecheck/build/browser, Reader/Share/Offline
package, assistive-technology, Linux PID 1 or service RSS/load gate was run for
this backend-only batch. PostgreSQL offline revision checks do not prove mounted
offline package refresh. Other inputs, future runtime Unicode versions and full
service resource limits still need their own evidence. Production remains
`3e68d1f/0051`; this record does not authorize CI, push or deployment.
