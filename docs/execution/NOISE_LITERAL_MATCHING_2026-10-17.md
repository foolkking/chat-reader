# Noise literal matching — 2026-10-17

## Boundary

This is continued local optimization after production accepted `3e68d1f/0051`.
No push, hosted CI, deployment or production operation is authorized or part of
this batch. PostgreSQL integration uses freshly initialized, loopback-only task
clusters and disposable databases, not an existing database or user import.

## Reproduced problems

1. A valid approximate literal can become shorter than six code points after
   whitespace normalization. The detector already collected normalized-exact
   matches, but its short-needle fuzzy guard discarded that list. The real rule
   trial returned **zero instead of 52** synthetic matches, including one
   protected match. Six pure cases also missed both ordinary/protected matches.
2. WHOLE_LINE and BLOCK_END checks sliced prefixes/tails for each occurrence.
   Four 512-candidate cases copied **654,080–1,311,744 source characters** just
   for boundary checks. This creates repeated temporary allocations/work when
   many candidates are present; it is not evidence that this path caused the
   previous production OOM.

Initial regression: **11 failed / 3 passed**. Failures were seven missed-match
assertions and four copied-character assertions, not fixture setup errors.

## Local source changes

- Keep already-found normalized-exact results when the normalized needle is
  short. The existing six-character rule admission is unchanged, and fuzzy
  matching below the normalized threshold is still prohibited. Matches remain
  KEEP or PROTECTED, never automatically DELETE.
- Check line prefixes in at most 256-character search windows, using regex
  positions rather than substring copies. Check adjacent line/block whitespace
  with anchored positional matches, stopping at the next token or LF.
  Unicode whitespace and LF-only line-boundary semantics stay unchanged.
- Preserve rule identities/revisions, source fingerprints, Unicode offsets,
  protected syntax, explicit consent and canonical MessageVersion publication.
  No schema, API, frontend, dependency or service configuration changes.

The first memory-safe implementation walked each whitespace code point in
Python. Although its **14** focused tests passed, profiling exposed a long
whitespace-tail regression: WHOLE_LINE rose from roughly **0.083 to 20.622 ms**.
It was replaced, not accepted merely because tests were green. The first
broader checkpoint (**190 / 1 skipped**, PostgreSQL **7/7**) belongs to that
intermediate implementation, not final acceptance.

## Allocation and timing evidence

[Sanitized local measurements](../evidence/noise-literal-matching-2026-10-17.json)
bind the baseline `8a32982` and final source's LF-normalized SHA-256. Input and
import allocations are excluded; `tracemalloc` measures boundary-check Python
allocation only. Times are illustrative medians of three local repetitions,
not isolated load tests, API latency or process RSS.

| Synthetic workload | Boundary | Peak bytes before → after | Median ms before → after |
| --- | --- | --- | --- |
| 8,192 short lines | WHOLE_LINE | 164,440 → 1,898 | 22.128 → 12.817 |
| Same | BLOCK_END | 328,224 → 1,686 | 28.198 → 4.938 |
| 8,192 adjacent hits on one line | WHOLE_LINE | 41,540 → 1,718 | 47.944 → 8.109 |
| Same | BLOCK_END | 41,444 → 1,686 | 6.572 → 4.484 |
| 2,048 whitespace-padded lines | WHOLE_LINE | 536,996 → 1,898 | 13.733 → 6.969 |
| Same | BLOCK_END | 1,073,038 → 1,686 | 24.004 → 3.243 |
| One hit, 200,000 trailing spaces | WHOLE_LINE | 200,581 → 1,654 | 0.082 → 1.874 |
| Same | BLOCK_END | 200,489 → 1,654 | 0.067 → 0.751 |

The last two controls remain slower than the old slicing implementation,
though below two milliseconds in this measurement. This is an allocation
improvement, not a claim that every input is faster or that arbitrary scanning
cannot exhaust memory.

## Verification coverage

`test_cleanup_literal_matching.py` covers:

- valid whitespace-collapsing rules, case settings, full-width characters and
  CRLF, retaining normalized-exact matches without calling fuzzy anchors;
- no source slices, bounded prefix-search windows and wide whitespace runs;
- 3,000 deterministic differential boundary cases including Unicode whitespace,
  CR/LF, empty boundaries and astral characters;
- real API trial → confirmed learning → rescan → two review pages → a two-range
  refinement → filtered bulk selection → token-bound preview → canonical apply.
  All **51** actionable candidates apply, the protected candidate and refined
  retained text survive, and exactly one new MessageVersion is created only
  after confirmation. This verifies API behavior, not mounted checkbox styling.

The related non-PostgreSQL run selects all 19 `test_cleanup_*.py` modules without
the `_postgres.py` suffix, plus `test_content_cleanup.py`. JUnit uses `legacy`
only for existing `record_property` metadata compatibility; assertions and test
selection are unchanged. The existing environment-dependent symlink case is
not replaced or silently treated as passing.

Separate PostgreSQL range/source suites exercise competing range saves, safe
consent-revoking downgrade/upgrade, exact-source backfill, concurrent source edit,
same-ID whitespace replacement and preview-time source replacement. They do not
constitute full PostgreSQL 16, browser, Reader/Share/Offline or memory/load gates.

Final verification passes **194 / 1 skipped** across the 20 related modules,
including **18** new cases. The skip is the existing outside-symlink capability
case on this Windows environment. The existing Starlette/httpx deprecation
warning remains. Final independent PostgreSQL 17 rerun passes **7/7**; both task
clusters stopped cleanly, without PID files or a listener left on their task
port. The final source's syntax, changed-document links, source-bound JSON,
added-text secret-pattern scan and `git diff --check` pass. No CI, push,
deployment, existing database or production operation occurred.

## Remaining normalization audit

Three separate synthetic probes still show an existing limitation: composed
accents, canonical combining-mark order and Hangul Jamo can be NFKC-equivalent
under the standard library, while the current per-code-point shadow differs
and returns no normalized match. This batch does **not** fix cross-character
normalization or claim complete Unicode equivalence. The evidence retains the
probe counts without source/rule text. Next work must preserve exact original
offsets and protected ranges while making that normalization bounded and
correct; canonical source must not be normalized or rewritten.
