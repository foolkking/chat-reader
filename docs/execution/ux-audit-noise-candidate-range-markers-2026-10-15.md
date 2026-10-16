# UX quick review — noise candidate range markers, 2026-10-15

## Scope and evidence

Web candidate rows after the local range-editing batch, for ordinary readers
reviewing many possible noise fragments. Source inspection only, not production,
a listening application, a browser screenshot or an assistive-technology session.
This report is written before the corrective source edit. Current contract:
`system/CONTENT_CLEANUP_CONTRACT.md`, editable candidate ranges; no API or
migration change is proposed here.

## Findings

| ID | Dimension / severity | Confidence | Evidence / consequence / action | Effort |
| --- | --- | --- | --- | --- |
| FBK-MARK-01 | Feedback and data display / Medium | Observed (code); appearance inferred | `cleanup-candidate.tsx:41,62` wraps the complete original `match_text` in a mark regardless of `reviewed_ranges`. The selected label and expanded retained context already use refinements. A reader scanning selected rows must open another view to distinguish retained words from actual removals. Reuse exact Unicode range splitting and mark/strike only proposed removals, leaving retained text plain; fall back to plain text if refinement is invalid | S |
| FBK-MARK-02 | Feedback / Low | Observed (code); assistive effect untested | `cleanup-candidate.tsx:28–34` describes every unselected nonprotected row as “Kept”, including APPLIED, stale and CONFLICT, while separate text later says completed/rescan. The checkbox's linked description therefore omits the most important current state. Prioritize protected, completed and rescan status, and prevent an ineligible row from appearing checked even if a stale caller passes selected | S |

## Decision and working brief

Intent: the person scanning selected candidates needs to see precisely what will
remain without re-editing every item. Keep the quiet reading-desk presentation,
native checkbox, existing scope/count feedback and required full-message preview.
Palette: existing paper/graphite/sea-green plus mark tokens; highlight means a
matched suggestion when unselected, and exact proposed removal when selected.
Depth/surfaces: retain divided rows and selected soft tint, no new border/shadow
or card. Typography: preserve application font and text-sm/text-xs hierarchy.
Spacing: preserve the established 4px grid and 44px row/action targets.

Domain: source, detected match, saved choice, removal interval, retained text,
message version. Signature: exact source-to-retained-text progression. Reject
whole-match deletion emphasis after refinement, color-only selection and a new
parallel diff editor; replace them with exact inline markers, linked state text
and the existing required preview. No new font, token, dependency or motion.

Use the full-message preview's established mark + strikethrough convention.
Keep stable checkbox accessible names and the `content-cleanup-match` locator's
complete original text. One memoized split per selected refined row can serve
both collapsed/expanded match and expanded after-context; ordinary unselected
rows need no range split. Preserve Unicode/CRLF and source fidelity.

The existing layout E2E checks the unselected summary element's highlight
background. Preserve that original mark/token contract; do not weaken its
assertion to accommodate an unnecessarily transparent wrapper. APPLIED rows can
naturally be stale against their pre-cleanup version, so their completion state
must not be accompanied by the generic red rescan warning.

## Quick wins / prioritized work

1. Share validated candidate splitting with retained-text computation, refusing
   malformed/out-of-bounds/overlapping ranges rather than guessing a deletion.
2. Use exact inline removals in the row and its expanded context, with plain
   retained text and a readable invalid-range recovery state.
3. Make the checkbox description and checked/tint state match current eligibility.
4. Add service-free helper and actual React server-markup regressions. These
   are not evidence of mounted events, browser styling, focus or accessibility.

## Working / deliberately unchanged

Bulk review already spans the full filtered scope, and range edits save choices,
not canonical text. Required preview/apply, source authority, owner checks,
rule learning, migration 0051, offline/Share formats and Reader anchors remain
unchanged. This is a small review-row correction, not a visual redesign.

## Open verification

Browser interaction, rendered contrast, touch/keyboard selection, expanded-row
focus and assistive announcements still need separately authorized verification.
No rendered checklist score or production acceptance is claimed.

## Implementation and final verification — 2026-10-16 local

Implemented both findings without changing canonical/source/API/migration
contracts. Selected refined matches use memoized exact `gaps`/`removed` parts;
expanded retained context reuses those parts. Unselected suggestions preserve
their previous marked summary element and tokens. Invalid or empty persisted
refinements show plain text and recovery copy. APPLIED, stale, conflict and
protected descriptions take precedence, and ineligible rows cannot inherit
selected/saving/tint state from a stale caller. APPLIED-with-stale is completion,
not a request to rescan.

| Check | Result / boundary |
| --- | --- |
| Actual helper + candidate React server markup | **13 passed / 0 failed**, 544.86 ms: six helper cases + seven markup cases |
| Targeted Web ESLint, zero warnings | Passed on candidate, helper and range editor |
| Nonincremental Web typecheck | Passed |
| Diff whitespace | Passed |
| User import storage worktree | Unchanged |

Evidence: [aggregate checks](ux-audit-noise-candidate-range-markers-2026-10-15-evidence/local-checks.json).
The seven markup cases compile the actual TSX/helper and use real React,
ReactDOM server and Lucide; no hooks are mocked. They assert default collapsed
markup, not event behavior or browser pixels. The helper cases cover source
reconstruction, retained text, Unicode/CRLF and malformed data. The existing
layout E2E was inspected for compatibility but not executed or weakened.

This source-only audit began October 15; verification completed after midnight,
October 16, Asia/Shanghai. Process-local TEMP/TMP used the batch-specific desktop
`wkkk` directory; no global environment changes, user import edits or raw
user-content logs were made. No API test was rerun because no API changed;
the prior 65-case result remains owned by the earlier range-editing report.

No listening services, authentication, browser/CSS/expanded-event/focus/assistive
verification, PostgreSQL migration, build/full gates, commit/push, new CI or
deployment ran. The rendered design checklist is **not assessed**, not passed;
the existing tokens and approved direction are retained, not rebranded. The
overall UX goal is still unproven and active; this is a local correction batch.
