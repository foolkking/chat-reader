# Search and reading audit — 2026-11-20

## Scope and evidence

Approved scope: finding a conversation/passage, understanding results, opening the
actual passage, uninterrupted reading and returning. Ordinary owner, offline,
shared, together/compare and administrator read-only surfaces have different
authorization boundaries. No production data or operations are used for testing.

Baseline: local uncommitted tree on `a3512d7103fd8d5f2b9fc3941ba206cf50313f1c`;
its committed tree equals production `1d1a3c7`, but the uncommitted work is NOT
certified by that release. Existing uncommitted changes and deleted historical
audit files are preserved. This report is delivered before this batch's edits.

Evidence: source review; synthetic 375/1280px screenshots in
`../reader-find-motion-2026-11-20/`; 375px historical global-results screenshot
in `../navigation-search-import-2026-11-17/`; isolated Node worker probe and
actual-source helper in Edge 157.0.4341.60. Neither probe is full-app acceptance.

## Findings

| ID | Severity / confidence | Evidence and consequence | Planned correction |
| --- | --- | --- | --- |
| FIND-01 | High, observed (actual worker) | 97 synthetic messages `先看潮汐然后继续阅读`: directory query `潮汐` yields 0; reader yields 80 with continuation. Prefix query yields 80 + 17. Chinese middle-of-sentence hits disappear from the catalogue. | Bounded substring-aware directory search; retain relevance vs literal-reader distinction. |
| FIND-02 | High, observed (code) | `lib/offline-search.ts:66`, `features/offline/library-shell.tsx:498,922`: directory discards continuation, renders only the first 80 documents; excerpts are always the first 240 characters. | Expose pagination and accurate partial counts; show actual matched context. |
| FIND-03 | Medium, observed (code) | `features/search/search-page.tsx:73,233`: `status_scope=all` counts as active filter but its chip is removed by the generic `value !== all` filter. | One semantic active-filter predicate for count and visible removable chips. |
| FIND-04 | Medium, observed (screenshots + code) | Mobile reader panel mixes document totals, occurrence totals, per-message indices, and permanently visible role/type filters. Results obscure the reading area. | Approved compact find bar, optional details/filters, one occurrence position; no automatic jump while typing. |
| FIND-05 | High, observed (code) | Search results truncate each document at 100 occurrences; there is no continuation within that document. | Bounded occurrence continuation, preserving canonical ranges and stale-target checks. |
| INPUT-01 | Medium, observed (code) | Reader debounce lacks composition state, unlike global/sidebar search. | Do not search or navigate unfinished IME composition. |
| MOTION-01 | High, observed (actual-source isolated browser) | `features/conversations/message-item.tsx:212`: unchanged layout, delayed `onChanged`, native wheel 800→1040→800 and 800→680→800. Late callback restores an obsolete position. | Use the existing physical-scroller geometry owner; do not replay stale absolute coordinates or cancel a later gesture. |
| ACCESS-01 | High, observed (code); rendered effect unverified | Shared page has no search listener; global shortcut handler nevertheless prevents native Find and dispatches an absent global-search action. | Scope interception to mounted capabilities; approved full authorized share-body search. |

An initial worker probe using a separate VM realm failed because FlexSearch's
realm-sensitive array checks received cross-realm arrays; it was a harness
failure, not evidence of an application crash. The same-source, same-realm
probe completed with the counts above. Preserve that distinction.

## Decisions and what remains intact

The user selected compact mobile find and full authorized share-body search.
Retain paper/graphite/sea-green tokens, existing navigation, native controls
where appropriate, canonical source ranges, explicit activation, bounded
virtualization, offline package v1/v2/v3 and all existing safety gates. No new
search engine, universal plugin, cosmetic theme, database reset or production
exercise is part of this work.

## Unverified risks and acceptance

The refresh repro does not explain all passive-reading problems. Audit every
scroll writer/geometry owner and test text, images, formulas, asynchronous code
and font rendering, paging/eviction, focus and viewport changes, Viewer return,
navigation/restore cancellation and independent comparison panes.

Repeat the reported small-up / stop / down / same-top-region / small-up gesture.
Measure actual reading-line anchors, blank/flickering frames and owner events,
not just scrollTop. Existing stillness limits remain peak ≤2 CSS px and final
≤1px. Add IME, stale queries, later pages, return state, signed-out/revoked/
expired/password/frozen-share and offline failure cases. Synthetic browser
results must not be described as physical iOS/Android acceptance.

Implementation results, failures and screenshots will be recorded separately;
this baseline report does not declare any fixes complete.
