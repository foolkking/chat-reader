# Upload release verification: lost fixture-cleanup response

2026-10-10; pre-edit supplement for the eighth complete attachment-release CI.

## Scope and evidence

This is a narrow audit of the existing browser test's cleanup/recovery behavior,
not a new product redesign or a claim that attachment upload is broken. It serves
the ordinary-user Web release while preserving its existing desktop/mobile
assertions, time budgets, production data and low-resource PDF implementation.
Source: `96b31b011a7ad161f2b98f39f409ef39caf399b3`,
[CI 37979802613](https://github.com/foolkking/chat-reader/actions/runs/37979802613).

The original non-deployable quality ZIP 11641460126 is 21,104,107 bytes. Its
GitHub SHA256 digest was verified before extraction; identity is retained in
[artifact metadata](ux-audit-upload-cleanup-2026-10-10-evidence/artifact-meta.json).
The [sanitized trace extract](ux-audit-upload-cleanup-2026-10-10-evidence/trace-inspection.json),
[frozen actual-source probe](ux-audit-upload-cleanup-2026-10-10-evidence/probe.mjs)
and [probe output](ux-audit-upload-cleanup-2026-10-10-evidence/pre-edit-probe.json)
are adjacent evidence. No local Web service, browser, production API or real
user data was accessed for the probe.

## Summary

The upload/insertion/version/reference path reaches its final assertion before
cleanup. The test then loses the DELETE response for its own synthetic fixture
with `ECONNRESET`; the cleanup helper never checks the remaining resource. A
recorded intermediate `expect.poll` attempt sees one attachment instead of two,
but that poll subsequently succeeds and the later desktop/mobile steps run.
The final two-attachment assertion completes successfully at trace time
11449.168ms, before cleanup starts at 11457.976ms. This supports a test-cleanup
failure, not an upload-contract failure. The server outcome of the lost DELETE
and the cause of the connection reset remain unknown.

## Finding and quick win

### STATE-UPLOAD-01 · Cleanup cannot reconcile a lost DELETE response

- Type: verification/recovery defect, not an observed end-user UI defect.
- Dimension: error recovery and truthful completion; severity High for release
  reliability; effort S. No product UX-health score is inferred.
- Confidence: Observed (isolated CI trace and frozen function with explicit
  transport doubles). The underlying socket-reset cause is unverified.
- Location: [attachment-upload-flow.spec.ts](../../apps/web/e2e/attachment-upload-flow.spec.ts#L90),
  called from the test's `finally` at line 255 in this frozen source.
- Evidence: the only terminating failure is the cleanup DELETE transport error.
  The helper performs no read-back. Two actual-source probes reproduce rejection
  even when a GET double would return 404; when a prior assertion is supplied,
  this cleanup rejection also masks that assertion.
- Consequence: a completed product flow cannot finish its isolated test cleanup,
  blocking the complete release and concealing a prior error when one exists.
  The evidence does **not** establish that CI actually deleted the fixture.
- Recommendation: catch only the observed connection-reset class, perform one
  read-only GET for the exact fixture, and accept cleanup only on confirmed 404.
  A present resource, denied/failed read or another transport error must still
  fail. Do not add blind DELETE retries, accept any error as success, weaken the
  business assertions or increase time budgets. Keep existing HTTP-500 behavior
  separately covered rather than claiming to repair all transport failures.

## Prioritized verification

1. Add actual-function regression coverage for confirmed absence after reset,
   present/denied/unavailable/read-reset outcomes, unrelated exceptions, normal
   successful cleanup and preservation of a prior business assertion.
2. Make the smallest E2E-helper change. Runtime/API/PDF/Reader source remains
   frozen. Check the old three-attempt HTTP-500 bound without extending it.
3. Run the focused and complete repository-script suites, lint and independent
   typecheck; retain pre-edit failures. Run complete exact-source CI again within
   this same user-authorized release cycle, not a failed-job-only retry.
4. All five jobs, all 13 Web gates, actual screenshots and independent image
   verification remain prerequisites to fresh production checks/deployment.

## What's working and what is left alone

This source passes all **100** mutation cases (506921ms), including quiet autosave
and its real-error recovery on desktop/mobile. The upload gate is **17 passed /
one failed / zero timedOut / zero skipped / zero interrupted**, 46397ms. Web is
**seven PASS / one FAIL / five NOT_VERIFIED** in the
[original gate summary](ux-audit-upload-cleanup-2026-10-10-evidence/web-gates.json).
API passes **1239 / three skipped / 20 warnings**, 858.58s, with single
`20261008_0050` head/current. Settings is still running at this report checkpoint.
Markdown/image/PDF/default-PWA/auth/negative-PWA acceptance is absent for this run;
in particular, the eighth run did not reach the repaired PDF behavior.

The [last recorded synthetic frame](ux-audit-upload-cleanup-2026-10-10-evidence/upload-before-cleanup.jpg)
was visually inspected. Its recorded viewport is 1440x900 but the screencast JPEG
is only 720x450; it predates the final assertion by about 5ms and is not a
pixel-geometry or complete rendered-state proof. No full visual/accessibility
score, CPU/RSS result or production acceptance is claimed. Previous PDF evidence,
all product assertions and the later annotation/CSV audit remain unchanged.

## Open questions

What reset the DELETE connection? The available trace and saved job output do
not establish a cause, and no matching new exception was found in the retained
API log. A read-back is the minimum evidence needed to distinguish completed
cleanup from a remaining fixture; a retry alone would not answer that question.

## Post-edit test-only checkpoint

The [new test baseline](ux-audit-upload-cleanup-2026-10-10-evidence/baseline-tests.json)
was recorded before changing the E2E helper: **30 tests, 21 passed / nine failed**,
496.4094ms. It combines the existing three project-cleanup cases with 27 new
upload-cleanup cases; the real helper is compiled, with explicit request and
timer doubles. The failure groups cover absent readback and masked prior errors,
not an invented server outcome. After the narrow change all **30** pass,
525.252ms. DELETE ECONNRESET alone permits one same-resource GET; only a 404
returns success. A failed read or other status rethrows the original DELETE
error. A normal successful DELETE still requires 404, and normal readback reset
is not itself retried. Existing HTTP-500 attempts/delays are unchanged.

All 25 repository-script Node files pass **726 / zero failed / zero skipped**,
9432.6716ms. Lint and nonincremental types pass. Discovery remains **149 cases in
ten files**, zero local browser executions. The
[additive local ledger](ux-audit-upload-cleanup-2026-10-10-evidence/local-verification.json)
binds the two changed test files and checks the untouched body/assertions of the
E2E suite. Product/PDF/Reader/API source, dependencies and budgets remain frozen;
the previous build and API checks are inherited rather than falsely rerun.
No local service, King access, candidate image or deployment occurred. The next
step is ninth complete exact-source CI in this same user-authorized cycle.

### Eighth run final result

The [final CI record](ux-audit-upload-cleanup-2026-10-10-evidence/ci-final.json)
confirms settings **439 passed** (39.1m) and fresh-instance restore **one passed**
(34.9s). The run completed with failure at 20:05:08 UTC on 2026-10-09; both image
jobs were skipped. This supplements, without rewriting, the pre-edit checkpoint
where settings was still running. No later gate or production acceptance follows
from the passing settings job.
