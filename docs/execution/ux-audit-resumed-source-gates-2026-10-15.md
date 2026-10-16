# Resumed source quality-gate recovery — 2026-10-15

## Scope and evidence before edits

The rich-text batch ran service-free repository lint and nonincremental types.
They exposed previously unvalidated local changes outside its four edited
existing renderer files. These failures must not be attributed to rich-text
code or hidden by a narrower gate.

Evidence: the initial `lint.txt` and `typecheck.txt` in
[rich-text evidence](ux-audit-chatgpt-rich-text-2026-10-15-evidence/).
Audience is mixed; this is an engineering gate recovery within the continuing
ordinary-user optimization goal, not a visual or production UX acceptance.

| ID | Severity | Confidence | Location / evidence | Minimal repair |
| --- | --- | --- | --- | --- |
| STATE-GATE-01 | High (build gate) | Observed (compiler) | `components/offline-sync-manager.tsx:18` passes a now scope-aware function as a `Promise<void>` continuation | Explicit zero-argument callback; preserve global manager scope |
| STATE-GATE-02 | High (build gate) | Observed (compiler + DOM type declarations) | `lib/annotation-sync.ts:38` unions `Promise<SyncResult>` and declared nested Web Locks promises | Await at the serialized async boundary; no cast or queue-policy change |
| COPY-GATE-01 | High (build gate) | Observed (compiler + code) | `features/import/import-workspace-copy.ts:43,54` repeats the identical 500-file key/value | Remove only the duplicate entry |
| STATE-GATE-03 | High (build gate) | Observed (compiler) | `features/projects/project-sidebar.tsx:166,452` stores browser numeric timer under Node timer type | Type the browser timer as `number`; keep cancellation behavior |
| STATE-GATE-04 | High (lint gate) | Observed (lint + config) | deletion provider line 74 and version-history hook lines 211/222 disable an unconfigured React-hooks rule | Remove the three invalid directives, retaining explanatory comments and effect dependencies |

Effort: S for each. These severities describe the engineering gate, not a
demonstrated live loss of offline data or an observed browser outage.

## Acceptance / boundaries

Rerun the exact full lint and nonincremental type gates, targeted version and
confirmation regressions, and synthetic synchronization checks with controlled
locks/transport. Preserve serial scope deduplication, previous-failure recovery,
task and confirmation lifecycle. Do not change the ESLint rule set, dependencies,
compiler configuration, existing test budgets or user-facing copy.

No service, login, production action, commit, CI or deployment is permitted.
Other historical source-only batches remain unaccepted unless specifically
covered by these limited checks. No browser/geometry/device claim follows.

## Pre-edit source bindings

| File | Git blob |
| --- | --- |
| `components/offline-sync-manager.tsx` | `a590cbd8cbddb52cb77af81cd063e3f65fc7239a` |
| `lib/annotation-sync.ts` | `e6e2092dfdf5baf7bc8c66fc447cf2fae5913a9c` |
| `features/import/import-workspace-copy.ts` | `25ec277985938e8bea6aed6d3b4b06b201257603` |
| `features/projects/project-sidebar.tsx` | `18a3fa4ce94fcbabaac82412b56055638fb0fe0d` |
| `features/conversations/conversation-deletion-provider.tsx` | `181f74e3e40fad4607529eb88e3e14081819b7fd` |
| `features/editing/use-message-version-history.ts` | `ae40123612c1aa1f2933b22c5bfdea3d7c7c1edf` |

## Results

The full lint gate and nonincremental Web types now pass, with no policy,
dependency or compiler-configuration change. The five-file selected Node run is
**106 passed / 0 failed / 0 skipped**, including nine new gate-recovery cases.
It exercises serial/deduplicated scope draining through Web Locks and fallback,
failure-tail recovery, empty/global scopes, the global manager's zero-argument
call and cleanup, numeric notice cancellation, and unique import-copy keys.
Locks, IndexedDB/network work and component scheduling are explicit doubles;
this is not actual browser synchronization or focus acceptance.

The same run covers actual compiled version/confirmation controllers and exact
Markdown save paths; older broad source-only batches remain unaccepted beyond
these named checks. Five pure API parser checks pass/one external fixture is
excluded. No full API suite, product server, build, PWA/browser execution,
production action, commit, CI or deployment occurred.

Exact commands and successful/failed logs are retained in the
[rich-text report](ux-audit-chatgpt-rich-text-2026-10-15.md) and its evidence
directory. The initial lint/type failures are retained; no passing test budget
or product user-facing behavior was removed to make the gates pass.

### Cross-regression harness findings before test edits

The first combined run retained in `targeted-node.txt` passed 101/105, including
all 25 rich-text and nine gate-recovery cases. The four failures expose stale
test assumptions, not demonstrated product regressions:

- The exact-source save fixture omits the existing `editorErrorFeedback`
  dependency and expects the raw exception, contrary to the subsequent
  source-editor error-copy repair. Load the real classification/message helpers
  and assert both draft preservation and bounded feedback.
- Two unknown-version-write cases still expect a third conversation GET and
  revision 11. The current hook reads matching history/body and deliberately
  passes no unbound conversation revision. The Reader accepts an optional
  revision; an independent metadata GET would not prove a shared snapshot.
  Assert the exact two reads, no revision advancement and no replay instead.
- The retired-response case assumes two microtasks are enough to dispatch
  QueryClient cancellation's continuation. Synchronize on the actual controlled
  request dispatch for both requests, retaining the stale-response/finally
  exclusion assertions.

No product implementation change is needed for these fixture repairs. They do
not constitute browser acceptance of those older batches.
