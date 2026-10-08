# Cleanup validation work — 2026-10-08

Batch 28 follows verified backend source safety. Browser acceptance for batches
26/27 still awaits permission after automatic approval rejected loopback Web
startup; that command is not retried. Scope: the cost and correctness of selecting,
previewing and applying many noise candidates in one source. No deployment/CI.

## Findings before implementation

High, observed source: `_occurrence_still_matches` recomputes the full source
fingerprint, protected ranges and detector output for each occurrence. Preview
and apply call it once per selected occurrence. `update_decisions` and filtered
selection also reparse protected ranges per row. With N candidates in one message,
work grows with N times source length, even though all candidates share one source
and rule revision. This can make long import/global reviews slow. Benchmark with
real API operations and synthetic source before changing behavior.

Use operation-local source analysis and per-message/per-rule validation reuse.
Never cache across requests, source changes or accounts. Preserve exact-source
binding, explicit consent, protected regions, role checks, conflict handling and
normal version publication. Count work and verify source/version output, rather
than claiming performance from button presence or mock success.

Task TEMP/TMP: `chat-reader-cleanup-validation-work-20261008`.

## Implementation and evidence

Source analysis is local to each decision batch or candidate page. Preview/apply
use one validation context per message and evaluate each admitted rule revision
once. Protected intervals use indexed lookup; exact fingerprints, recorded consent,
source existence, role restrictions and protected/conflicted states remain checked.
No context survives a request or crosses a source/role. Scanning hashes a source
once per message. Applying fragments joins retained pieces once rather than
repeatedly copying the shrinking source string.

Both pre-change work-bound tests failed after verifying correct saved output:
32 and 128 candidates caused 32/128 full detector calls in each preview/apply and
64/256 protected-range parses in each operation. Final same-rule work is one
detector call per message and two protected-range parses; preview hashing is three
passes independent of candidate count, including the before/after binding checks.

| Local synthetic case, 128 candidates | Before | After |
| --- | ---: | ---: |
| Preview detector calls | 128 | 1 |
| Preview protected parses | 256 | 2 |
| Preview elapsed | 975.123 ms | 41.958 ms |
| Apply elapsed | 1052.397 ms | 153.530 ms |
| Select elapsed | 347.257 ms | 220.221 ms |

These are single local synthetic measurements, not production latency promises.
Deterministic work counts and actual source/version outputs are the regression
gates. Different sources and rule revisions remain independent. Existing tests
cover manual selection, protected syntax, role/matcher modes, cross-page decisions,
account isolation, changed source and canonical Reader/Share/offline propagation.

[Evidence summary](cleanup-validation-work-2026-10-08-evidence/results.json):
44 API cases plus 43 related cases, with two overlaps, yield **85 distinct API
cases passed**. **11 actual PostgreSQL cases passed**, including concurrent editing,
source changes during preview, outcome recovery and migration. Zero skipped.
The two baseline failures remain recorded separately. No implementation failure
occurred in the final runs. No new migration; local single head remains 0050.

No Web code changed, so no repeated Web build was needed. Browser/PWA acceptance
against this backend remains unexecuted pending the existing rejected-startup
confirmation. On resume the supervisor handle was absent; direct checks found no
task-owned Python/PostgreSQL process or 45438/8008/8328/3107 listener. The precise
supervisor termination time was not observed and is not presented as a graceful
shutdown result. No service was restarted. No commit, CI, image build, deployment
or production change occurred. The broader optimization goal remains active.
