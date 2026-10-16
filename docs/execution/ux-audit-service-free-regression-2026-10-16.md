# UX regression audit — service-free continuation

Date: 2026-10-16. Scope: existing synthetic Node UX regressions, not a new
product redesign. Audience: ordinary users of import, Reader, Share, offline
library, attachments and settings. Evidence is current application/test source
and execution of all `scripts/ux/*.test.mjs`, serialized in Node without a
server, login, browser, external request, build or production operation.

## Finding and impact

### STATE-REGRESSION-01 — stale adapters prevent verification of current UX

| Field | Assessment |
| --- | --- |
| Dimension | Error recovery / state coverage / engineering verification |
| Severity | Medium |
| Confidence | Observed (test execution and source); product impact not established |
| Effort | M |
| Location | `scripts/ux/` adapters for lists, metadata, placement, sidebar, Reader, Share and attachments |

The initial serialized run completed **1,407 tests: 1,103 passed, 304 failed,
0 skipped**. Repeated failures include missing deletion-provider and
authentication-generation adapters, missing `project-error-copy`, absent
`readerQueryNetworkMode` in extracted options, changed source-boundary markers,
and expectations for old raw-error/localization behavior. Share edge tests also
count the intentional initial error-clear as a late error publication.
These are observed failures of verification; they are not 304 demonstrated
product defects and do not establish mounted/browser correctness.

Without usable regression evidence, users' recovery paths and late-callback
protection cannot be confidently assessed after the accumulated source changes.
Repair adapters to execute the current source and supply explicit synthetic
dependencies, while preserving read/write counts, uncertainty, retained drafts,
scope fencing and failure recovery assertions. Update obsolete text expectations
to assert the current finite localized guidance rather than reintroduce raw
exceptions. Do not skip cases, relax safety checks, change production to fit old
tests, or claim browser acceptance.

## Ordered work

1. Inspect each failing adapter and the current application dependency.
2. Repair stale harness boundaries/dependencies; keep behavior assertions.
3. Investigate remaining failures as possible product defects before editing.
4. Rerun all service-free UX files, Web lint/typecheck and whitespace checks.
5. Record actual results and limits here and in current-fact documentation.

## Working behavior and exclusions

The initial run already passed 1,103 cases, including focused noise-range and
search work. Keep data/storage/API compatibility, real DOM anchors and service
boundaries unchanged. No original import content is accessed or modified.
Mounted React, IndexedDB/Worker, assistive technology, browser rendering,
PostgreSQL migration/concurrency, API/PWA/full build, CPU/RSS, CI and deployment
are not proven by these synthetic checks.

Initial, intermediate, focused failing reproduction and final outputs are
retained in this report's adjacent evidence directory.

## Repairs and additional product finding

Fourteen stale test files were repaired without removing or skipping cases.
Deletion-provider adapters are explicit non-writing controls; project error
copy uses the actual compiled helper. Reader options include the actual
source-derived offline policy. Picker/download subscription extraction uses
TypeScript declarations instead of blank-line/indentation sentinels.
Attachment providers retain their session ref; PDF labels are checked in both
locales. Offline errors assert finite local-copy guidance and reject raw
upstream text. Share late-result checks retain the legitimate initial clear
and verify that no later feedback appears after retirement/reversal.

After adapter repair, an intermediate run passed **1,407 of 1,408**, with only
one remaining obsolete raw-error expectation. No failed cases were skipped.

Further source review and a pre-edit extracted-loader test reproduced a real
Share entry-lifecycle defect: both old edge callbacks could start reads after
the visit retired. The [Share edge report](ux-audit-share-edge-loading-lifecycle-2026-10-15.md)
records **STATE-SHARE-EDGE-02** before editing. Both new negative cases failed
(7 passed / 2 failed in that focused run). The two entry guards now require an
active visit before any loading/error setter or complete-turn request.
Already-sent requests, merge/lease/DOM-anchor behavior, Share URL and storage
contracts remain unchanged. Current-direction failure is a positive control,
not suppressed to make the negative cases pass.

## Final local verification and closeout

All **63** current `scripts/ux/*.test.mjs` files ran serially with task-local
TEMP/TMP. The final run completed **1,412 passed / 0 failed / 0 skipped /
0 cancelled**, in 49.70 seconds. The extra five cases versus the initial run
are the second PDF locale and four Share entry/current-failure controls.
Full `corepack pnpm run lint`, nonincremental Web typecheck and diff whitespace
passed. No files under `apps/api/storage/imports/` were changed.

Evidence: `ux-audit-service-free-regression-2026-10-16-evidence/` retains the
initial/intermediate/final Node outputs, pre-fix Share reproduction, lint/type
and final whitespace outputs, plus a summary with file hashes. It contains
synthetic fixtures and code/test paths, not real conversation content or tokens.

The resumed local implementation and permitted service-free verification are
closed out. This run supersedes original unexecuted notes only for the exact
63 Node files in the manifest; it is not acceptance of unlisted tests or all
product behavior. Previously recorded noise API and rich-text parser results
retain their original dates and boundaries, not a claimed fresh full API run.
The original imports, existing data contracts, offline package/Dexie formats,
canonical storage and stable anchors remain unchanged by this continuation.

No Web/API/worker service, login, product browser, full API/PWA/build,
PostgreSQL migration/concurrency, CPU/RSS measurement, commit, push, CI or
deployment ran. Those excluded runtime/release activities require a separate
authorized validation/release batch; no accepted release cycle was replayed.
