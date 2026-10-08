# UX quick review — rapid search filters

## Scope and evidence

This release-prerequisite review covers the existing Web search date/filter
flow for ordinary users, not a redesign or the later whole-product audit.
Evidence is source `b18aced` and the synthetic Chromium failure snapshot from
[CI 37754402200](https://github.com/foolkking/chat-reader/actions/runs/37754402200),
Web job `113235275013`. The relevant snapshot excerpt is retained
[beside this report](ux-audit-search-filter-race-2026-10-08-evidence/failure.md).
No production content was used. Local application browsing remains blocked;
no local, cross-browser, responsive-layout or accessibility pass is claimed.

## Finding

**FORM-01 — consecutive filter edits silently discard the earlier value.**
Defect; **High** severity; **Observed (CI page snapshot + source)**; effort **S**.
Primary dimension: input/forms; also browser navigation and error feedback.
Location: `/search`, `apps/web/features/search/search-page.tsx:71` and
`apps/web/e2e/ux-whole-site.spec.ts:143`.

After loading more results and selecting Role = User, the real browser fills
From = `2099-01-01`, then To = `2020-01-01`. The failure snapshot contains an
empty From field, the latter To value, and "No results. Clear filters or try
another query." instead of "From must be on or before To." Each handler clones
the last rendered `useSearchParams()` and starts an asynchronous `router.push`;
the next event can therefore discard an uncommitted change.

Users lose a value they just entered and can receive results for a different
range than intended. The no-results message hides the actual invalid range.
This is a core search correctness issue, not merely a slow test.

**Recommendation / quick win.** Compose every filter update from the current
browser URL and use Next's supported native History API for this client-fetched
search view. Preserve the existing parameter normalization, field focus, query,
pagination reset and Back/Forward/reload semantics. Keep ordinary Router
navigation for opening results. Add deterministic rapid-input coverage by
holding only optional search-page RSC responses until both edits have occurred;
do not add sleeps between inputs or weaken the current invalid-date assertion.

## Acceptance and boundaries

1. Both dates and unrelated filters survive rapid edits, including an invalid
   range; the existing focused date/pagination test remains intact.
2. Back and Forward restore each filter step; reload restores the full URL state.
   Clearing filters retains the query, then Back restores the prior filters.
3. Existing search failure/retry, keyboard navigation, authenticated result
   loading and full release gates pass on the exact proposed source.

The existing clear-filters action, native labels and invalid-range feedback are
useful and remain unchanged. No new filtering rules, layout, data contract or
server behavior is proposed. Runtime acceptance of the repair is still pending
when this report is written; CI evidence will be added after execution.

## Repair checkpoint

The synchronous URL update and rapid-input/history regression are implemented.
Local lint, nonincremental TypeScript and bounded Next 16.3.8 production build
pass. The modified test files pass discovery (37 cases across four files), not
browser execution. The existing search invalid-date/pagination test is unchanged.
