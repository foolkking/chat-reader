# Adaptive import error recovery audit — 2026-10-14

## Scope and evidence boundary

This is a source-based UX audit and local repair record for the adaptive import
flow: upload/analysis, saved-format selection, mapping preview/save, format
health checks, source replacement, grouping and final import. No service,
browser, login, automated test, lint, typecheck, build, CI or deployment was
run for this batch; the user will verify the result.

The pre-edit source evidence was collected from the clean candidate files at
the following SHA-256 values:

| File | Pre-edit SHA-256 |
| --- | --- |
| `apps/web/lib/api.ts` | `A10FB2F30CFA4C0F6B726BEB09875076F190BDA33DBAF66694DB5DDFAAEE2E2C` |
| `apps/web/features/import/import-workspace-copy.ts` | `94C1B344C8A7CCDDE36CEA06E1A15D3FCC86FC8D6CB481EF9CAE0C794F962272` |
| `apps/web/features/import/mapping-workspace.tsx` | `95D5642980765230CDC18FFCE9E54D618EFE21FCF18BF0316B5809A06C8B8709` |
| `apps/web/features/import/format-health-check.tsx` | `C2011A48636E97EB1F548F7294DA52EB16808403B4598DB820052DA4BF5F8BDF` |
| `apps/web/features/import/adaptive-import-workspace.tsx` | `8939A13934E98655E66B2D0B99D1E5A6981C04B32CE14653A5BBAB1614C1B4B6` |
| `apps/web/features/import/import-panel.tsx` | `B36A14D30FB78CFCC7C7B89467E44215C9CCAD20857E558B25D28F6804ED38E0` |

## Findings

### IMP-ERR-01 — error metadata is discarded at the UI boundary

Observed in source: `ApiRequestError` carries `status`, `path` and an
optional `code` in `apps/web/lib/api.ts:95-106`. The import panel, adaptive
workspace and mapping workspace pass only `mutation.error.message` into their
shared error line (`import-panel.tsx:210-212`,
`adaptive-import-workspace.tsx:202,281-282,336,385`,
`mapping-workspace.tsx:59-60`). The adaptive workspace also receives the
cancel/commit failure as a string from `ImportPanel:174`.

Runtime implication (inferred from the code path): the same visible message
cannot distinguish a permission/feature-disabled response, a stale import
session, a size limit, a transient server failure, or an operation whose
write result is not confirmed. The existing source-format diagnostics are
different: they include repair-specific codes, messages and pointers and must
remain visible.

### IMP-ERR-02 — server error codes are dropped for HTTP 5xx

Observed in source: `getApiRequestError` returns the generic
`服务暂时不可用，请稍后重试。` before reading the response body for every
HTTP 5xx (`apps/web/lib/api.ts:1640-1644`). The adaptive import API emits
structured codes for analysis persistence/analysis failure and source
replacement failure, including 500 responses, and emits a structured total
size-limit code.

Runtime implication (inferred): the UI cannot localize or explain those
operation-specific recovery paths, and a final-import 5xx cannot be marked as
an unconfirmed result when the client is deciding whether another submission
is safe.

### IMP-ERR-03 — format health failure bypasses the shared import copy

Observed in source: the format health check renders `check.error.message`
directly (`apps/web/features/import/format-health-check.tsx:35`) while its
per-group validation issues deliberately render repair diagnostics from
`healthDiagnosticZh`.

Runtime implication (inferred): transport/API failures can expose raw
English or browser text, while actual source validation issues already have
the useful, actionable detail users need.

## Repair contract

1. Keep validation and source-format messages intact; do not replace them with
   transport-level generic copy.
2. Preserve API request status/code metadata until the import error
   presenter.
3. Add stable bilingual copy for known import operation codes.
4. Retain a generic read failure for unavailable services, but for an
   unclassified write failure, including a lost connection, state that its
   result is unconfirmed before the user retries.
5. Do not add requests, polling, automatic retries, persistence, migration or resource
   work.

## Implementation record

The repair updates the shared import error presenter, the import callers and
the API error parser. HTTP 5xx responses now retain a safe structured error
code while continuing to hide server detail; known validation codes retain
their existing API copy. Reads keep the existing retry control, while
unclassified writes avoid advice to blindly resubmit. The repair adds no new
network operation and does not change the import API contract, source
validation behavior, session storage, or commit semantics.

## Verification and outcome

Per user direction, no service, login, browser, automated test, lint,
typecheck, build, CI or deployment was run. Runtime rendering, screen-reader
behavior and recovery after real server/network failures remain unverified;
the user will verify this local source change.
