# UX quick review — conflict merge draft refresh protection

2026-10-15 · source-only evidence, recorded before product edits.

## Scope and evidence

Continuation of the ordinary-reader UX goal. Platform: Web app; audience:
ordinary readers resolving annotation/notebook conflicts. Scope: the existing
manual merge draft during `Compare again`, read failure and locale changes.
No resolution receipt, server revision, outbox rebase, draft storage key,
package or conflict policy is redesigned.

SEEN: `apps/web/components/offline-conflict-review.tsx:14–50,79–104`,
`apps/web/lib/offline-conflicts.ts:34–95`, existing settings conflict browser
scenarios, and neighboring pending/reading-position recovery components.
NOT SEEN: mounted React, actual Dexie, browser editing/focus, cross-tab draft
writers, real storage failures or device resources. Code facts are observed;
rendered consequences are inferred. No accessibility conformance claim follows.

## Finding

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| ERR-CONFLICT-MERGE-01 | Defect / error recovery; input preservation | High | Observed (code); rendered loss Inferred | S |

**Evidence.** `saveDraft` updates `merged` immediately and reports a failed
local write without clearing it. `Compare again` remains available in that
state. Its successful load unconditionally executes
`setMerged(saved ?? data.local)`, replacing the unsaved merge with the older
stored draft or comparison content. The separate `draftState` remains failed,
so `Retry saving draft` then receives the replacement rather than the user's
lost edit. The load callback also depends on `zh`; changing locale reruns the
load effect and repeats the same replacement/focus path.

**Why it matters.** A reader recovering from a storage failure can lose the
very merge text the failure message says was retained simply by re-comparing
versions. A later save retry cannot recover the overwritten in-memory edit.
This is not just stale feedback or a translation issue.

**Recommendation.** Initialize the merge draft from storage/local content once
per conflict visit. Subsequent comparison reads refresh the comparison but
preserve the current in-memory merge, including saving/failed/newer edits.
Keep the existing save/retry path and dirty state. Separate finite error state
from translated display copy so locale changes update feedback without a
comparison request, draft replacement or focus reset. Reset draft/read state
only for an actual conflict-key change and retire old read/save completions.

## Ordered repair and acceptance

1. Preserve an initialized merge with a functional state update; reset only on
   conflict-key changes. Keep existing generation/draft-version ownership.
2. Derive localized recovery copy from finite error categories and remove
   locale from the load identity. Keep manual comparison available.
3. Author synthetic checks against the actual compiled component for initial
   restore, failed/pending save plus recompare, a newer edit during a read,
   locale changes, read errors and conflict-key retirement. Leave unexecuted
   under the current no-test/no-service boundary.
4. After authorization, run the focused Node file, relevant Web gates and
   actual conflict editing/storage failure/Retry/locale/focus transitions.

## What's working and left alone

Existing server/local choices, immutable reference display, draft retry,
confirmation, idempotent resolution, pending descendant preservation and
protected exit remain. The repair does not create persistent cross-route
recovery, a new draft queue or cross-tab draft reconciliation. No new polling,
storage format, API, schema, dependency, permission or deployment change.

## Implemented source checkpoint

- The successful read now initializes `merged` only if it is null. Recomparison
  updates `preview` without replacing an initialized notebook/annotation merge.
  Explicit local/server-as-draft actions still use the existing save path.
- Finite `read`/`changed`/`resolution` error state is translated during render;
  locale is no longer part of `load` identity, so its effect does not re-read
  or refocus merely to translate feedback.
- An actual conflict-key layout transition resets visit state. Its generation
  and draft-version retirement keep old read/save completions from publishing
  into the new visit. This is not cancellation of writes or arbitrary retained
  callbacks, nor cross-tab reconciliation.
- `scripts/ux/offline-conflict-merge-draft-refresh.test.mjs` is authored,
  **unexecuted**. It would transpile the actual component with controlled
  hooks, confirmation, promises and storage. Proposed cases cover initial
  restore/fallback, failed/pending writes, annotation comments, newer edits
  during reads, failed comparisons, locale, old read/save completion retirement
  and the existing merge submit path. No pass count or runtime result is
  claimed; real React, Dexie, browser/focus and device acceptance remain open.
- Current architecture, PWA contract, user flows, project state, testing guide,
  navigation and documentation inventory are synchronized. No tests/gates,
  build, services, browser, production action, commit, CI, deployment or
  CPU/RSS measurement ran. The full ordinary-user optimization goal remains
  active; this checkpoint only closes this source repair.

Formatting evidence: `git diff --check` on the edited tracked component and
current-fact documents returned 0 with no whitespace errors. Git emitted the
existing LF→CRLF warnings; no line-ending normalization was performed. This
does not validate behavior or include the new untracked report/regression.
