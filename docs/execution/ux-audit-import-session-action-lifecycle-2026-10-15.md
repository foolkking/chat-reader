# UX quick review — Adaptive import session action lifecycle

2026-10-15 · pre-edit source evidence. Full ordinary-user goal remains active.

## Scope and evidence

Mainstream responsive Web, the adaptive import workspace after the user has
selected source files and is choosing profiles, replacing an invalid artifact,
excluding a group, reanalyzing or confirming file grouping. This review covers
only session-changing action ownership and local grouping-draft alignment; it
does not change import parsing, storage, API contracts or commit semantics.

SEEN: `apps/web/features/import/import-panel.tsx:68–170,214–229`;
`apps/web/features/import/adaptive-import-workspace.tsx:39–92,159–236,
304–386`; `apps/web/features/import/mapping-workspace.tsx:20–44`.
The workspace exposes independent mutation controls in separate family rows,
each callback publishes a complete `AdaptiveImportSession` through the same
parent setter. `GroupResolver` derives its initial assignment map only during
initial render. NOT SEEN: mounted React timing, real network ordering, API
transaction scheduling, browser interaction, screen-reader output, CPU/RSS or
production state. Branch facts are Observed (code); stale-overwrite and
mis-submission consequences are Inferred. Tests/gates, services, browser
operation and release remain off.

## Executive summary

The import workspace lets separate family rows submit profile selection or
recovery actions while another row can still be active. Each mutation receives
the current session ID but its `onSuccess` directly calls the shared
`onSession` setter with a full server snapshot. If two requests are started
from the same snapshot and complete out of order, the older snapshot can
replace a newer selection. The same unscoped action lifecycle also allows
another control to remain enabled while a session-changing response is
settling.

The grouping surface has a second state-coverage defect: its assignment map is
created from `session.groups` only once. If the resolver remains mounted while
the session is refreshed or reanalyzed, the visible file list can come from
the new session while the submitted assignment values still come from the old
group set. The repair should serialize session-changing actions at the
workspace boundary and resynchronize local assignments when the server group
identity changes.

## Finding and quick win

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| STATE-IMPORT-ACTION-01 | Defect / state coverage; feedback | Medium | Observed (code); runtime consequence Inferred | M |
| FORM-IMPORT-GROUP-01 | Defect / form state; error prevention | Medium | Observed (code); runtime consequence Inferred | S |

**STATE-IMPORT-ACTION-01.** Pre-edit locations:
`adaptive-import-workspace.tsx:159–236,304–386` and the parent handoff at
`import-panel.tsx:214–229`. `FamilyRow`, `NotMappableRecovery`,
`LegacyBlockedRecovery` and `GroupResolver` each own a mutation whose success
callback can call the same `setSession` path. No shared action lease or
completion token prevents two session-changing actions from running at once,
and each callback publishes a full session snapshot. A slow earlier response
can therefore overwrite a later response or reopen a state that the visitor
has already left. Give these actions one synchronous workspace lease, disable
competing controls, and publish only the response that owns that lease. Do
not abort already-started transport or change server-side operation policy.

**FORM-IMPORT-GROUP-01.** Pre-edit location:
`adaptive-import-workspace.tsx:348–354`. `assignments` is initialized from
`session.groups` but has no effect that replaces it when the group identity set
changes. A new analysis response can therefore display different files while
retaining assignments for removed artifacts and missing assignments for new
ones. Rebuild the local map when the ordered artifact identity signature
changes; preserve ordinary typing between server responses.

## Ordered repair and acceptance

1. Add a workspace-local session-action lease with a monotonically increasing
   token. Route session-changing import mutations through it; reject competing
   starts synchronously, disable session navigation/commit controls while held,
   and apply a success snapshot only while its token still owns the lease.
   Release the lease on both success and failure. Keep request bodies,
   endpoints, server ordering and no-abort behavior unchanged.
2. Resynchronize `GroupResolver` assignments only when the server-provided
   artifact identity signature changes. Do not reset a visitor's typed values
   on ordinary rerenders.
3. Author an extracted-source regression for action serialization,
   stale-success suppression, failure release, workspace-navigation blocking
   and grouping-map refresh/removal. Do not execute it.
4. After authorization, run focused import/Web checks with task TEMP/TMP, then
   browser slow-response, rapid-control, reanalysis and keyboard acceptance.
   Source adapters do not prove mounted React or network ordering.

## What stays and open questions

No import parser, API endpoint, PostgreSQL schema, source-file retention,
`.cr` format, Share URL, offline package, commit polling or attachment policy
changes. Already-started requests are not cancelled and server effects are
not claimed reversible. Runtime confirmation is still needed for actual
response ordering, remount behavior and whether any concurrent server writes
are serialized independently of the UI lease.

## Implemented source checkpoint

The adaptive workspace now owns one synchronous session-action lease and a
monotonic token. Profile selection, invalid-artifact replacement, group
exclusion, legacy reanalysis, grouping confirmation and mapping save all
acquire that lease before starting; competing controls, navigation and commit
are disabled while it is held. A response is applied only when its token and
import ID still own the current workspace; success and failure both release
the lease. Existing requests are not aborted and the API/server contracts are
unchanged.

`GroupResolver` now rebuilds assignments when the ordered artifact identity
signature changes, while ordinary typing remains local between server
responses. Format-health checks are disabled during a session-changing action
so an old read cannot be started beside a source mutation.

`scripts/ux/adaptive-import-session-action-lifecycle.test.mjs` is authored but
**unexecuted**. It extracts the actual workspace, mapping and health-check
source and covers lease admission, token/import ownership, success/failure
release paths, disabled competing controls and grouping resynchronization.
This is not mounted React, network-ordering, API transaction or browser
keyboard evidence.
