# UX release check — archived-project refresh contract

## Scope and evidence

This is a narrow pre-edit review of the ninth attachment-release CI failure,
not a new product redesign. Chat Reader is a desktop/mobile Web app for ordinary
readers; confirmed actions should acknowledge completion without waiting for
unrelated refreshes. Source is `87eae8ddd6ff50b3a606ec92d6f9fcbef8a10f4f` and
[CI 37986179840](https://github.com/foolkking/chat-reader/actions/runs/37986179840),
attempt one. The original diagnostic ZIP's size and GitHub SHA256 were verified
before extraction; provenance and the local reproduction are retained in the
[pre-edit record](ux-audit-archive-contract-2026-10-10-evidence/pre-edit.json).

No browser, local Web service or production resource was used for this
reproduction. The six-file local config deliberately has no webServer or browser
fixtures. Its 18 source-only Playwright tests are not browser acceptance.
No new visual, accessibility, CPU or memory measurement is claimed.

## Summary

The failure is an obsolete source-string expectation, not a failed PDF action.
The test requires `await refreshProjects()`, although the approved recovery
implementation acknowledges deletion and refreshes in the background.
The local source-only run reproduces exactly one failure, with 17 passes.
The same CI already passes all 13 PDF, 21 attachment, 18 upload and 100 mutation
cases, but its default-PWA gate fails and auth/negative-PWA are not reached.
Restoring the awaited refresh would reintroduce waiting after a confirmed action.
Keep product code frozen and test the actual completion/refresh contract.

## Finding

| ID | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| FBK-CONTRACT-01 | Feedback and state verification | Medium; release-blocking test defect | Observed (source + executed source-only test + CI log) | S |

**Location.** `apps/web/e2e/archived-project-delete.spec.ts:14` and
`apps/web/features/projects/archived-project-list.tsx:199`.

**Evidence.** The final assertion expects the literal `await refreshProjects()`.
The production delete callback instead confirms scope, awaits the batch write,
removes confirmed deleted rows from existing caches, publishes its result and
uses `if (result.succeededIds.length) void refreshProjects().catch(() => undefined);`
before releasing busy state. `refreshProjects` still invalidates projects,
sidebar conversations and conversations. The API DELETE path, confirmation and
conversation-preservation assertions preceding the obsolete assertion all pass.

**Why it matters.** This mismatch blocks delivery of the reading improvements.
Changing the product solely to satisfy the old string would make readers wait
for a follow-up read after their action has already succeeded. A string check
alone also cannot prove that all affected lists refresh or that slow reads do
not prolong the action's busy state.

**Recommendation.** Preserve the five existing deletion/API/confirmation
assertions, align the last assertion with the guarded background refresh, and
add real compiled-callback/QueryObserver cases for single and bulk deletion under
held and failed reads. Check immediate result, released action state, cached-row
removal and invalidation of all three query families. These remain controlled
transport/state doubles, not backend or browser proofs.

## Priority and boundaries

1. Make the test-only repair and run the six-file source contracts plus all
   repository-script tests, lint and nonincremental types.
2. Complete another full exact-source CI within the same authorized cycle;
   preserve all gate names, assertions, budgets and failed-run history.
3. Inspect new-source screenshots and independently verify CI images before
   fresh King preflight/backup/0050-to-0050 deployment checks.

The current non-blocking product feedback, destructive confirmation, fresh scope
checks, API protection and existing recovery tests are retained. Product/API,
dependencies, CI workflow and migration are outside this patch. The annotation
and CSV follow-up stays outside this release candidate. Production remains
30a0d32; this diagnostic artifact is not deployable. Final settings results,
new-source visual acceptance and deployment acceptance are still outstanding
at this pre-edit checkpoint.

## Local repair outcome

Only the archived-project source contract and its existing Node recovery suite
changed. The five existing deletion/API/confirmation assertions are intact;
one obsolete refresh expectation is replaced, not a browser assertion removed.
All original 40 callback tests remain unchanged and pass; the four new cases
also pass. They exercise real QueryClient/QueryObserver and compiled production
callbacks with controlled transport/hook state, not a real browser or API.

The six-file source-only suite now passes **18/18** (1.2s), and all 25 repository
script suites pass **730/730** (9097.6598ms), zero failures/skips. Lint and
nonincremental types exit zero. No product, workflow, dependency or migration
changed. Build/API checks were not rerun for the test-only delta. The
[local ledger](ux-audit-archive-contract-2026-10-10-evidence/local-verification.json)
binds this checkpoint, preserves prior ledgers/buildinfo and distinguishes the
source-only executions from earlier 149-case browser discovery. Full CI,
new-source screenshots and independent image acceptance still precede deployment.

The local checkpoint checker initially stopped on mixed workspace CRLF versus
Git's LF bytes (two attempts), then on the missing empty-output typecheck log.
It now preserves raw workspace hashes and checks normalized repository text
separately. Types were rerun with their actual exit code logged; no product
change, old-ledger rewrite or test relaxation was used to resolve these
verification-tool errors.

## Final ninth-run status

The [final run record](ux-audit-archive-contract-2026-10-10-evidence/ci-final.json)
confirms API and settings success, Web failure and both image jobs skipped.
Settings passes **439** (39.7m), plus **one** independent fresh-instance restore
(35.0s). These results belong to 87eae8d, not the next repaired commit; its
complete CI and screenshot/image acceptance remain required.
