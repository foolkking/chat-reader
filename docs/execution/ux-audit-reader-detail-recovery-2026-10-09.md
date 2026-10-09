# UX quick review — Reader detail-read recovery

2026-10-09 · Remote Web Reader · Recorded before application edits in this batch.

## Scope and evidence

An ordinary reader has opened a private conversation and may be reading or editing
when a background detail GET fails. This scoped review covers the remote detail
query's rendering, explicit read-only retry and access-denial boundary. Source is
the local checkpoint following [recent-open reconciliation](ux-audit-reader-recent-2026-10-09.md),
on parent `a12ce9e287fdddfd4df8a6039a212cec04629568`. The current Reader is not
running in a browser. Render/focus/scroll consequences are inferred from source;
controlled QueryObserver and extracted-code checks will be labelled separately.

Excluded: mutation admission/receipts (create/insert/delete/merge), complete-turn
reload policy, initial message-window recovery, navigation/position algorithms,
offline storage/access, Share, API contracts and PostgreSQL. Those paths were
sampled only to select a bounded next step. A failed recent-open full-detail GET
already preserves coherent cache data; that does not establish a usable rendered
Reader. This is a distinct display/recovery gap, not a rewrite of the prior batch.
No local server restart, browser workaround, production browsing, subagent or CI.

## What matters most

The person should be able to keep reading already loaded text during a temporary
detail-read failure. Presently, a retained successful detail is discarded by the
render branch even though QueryClient still has it. The error view offers no local
read retry, so the practical recovery becomes leaving or reloading the page. Cached
content must still disappear when the server denies access or the conversation no
longer exists. These are state/recovery defects, not a reason to redesign the Reader.

## Findings and priority

| ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| STATE-01 | A transient detail refetch error replaces the entire loaded Reader | State coverage / continuity | High | Observed (code); interruption/focus effects Inferred | S |
| REC-01 | The detail error state has no explicit read-only retry and exposes raw transport text | Error recovery / copy | Medium | Observed (code); user recovery route Inferred | S |

### STATE-01 — preserve the current reading surface on temporary failures

`apps/web/features/conversations/conversation-reader.tsx:2190–2204` returns a
standalone `ReaderState` whenever `conversationQuery.isError`, before the main
Reader tree. It does not inspect retained data or the HTTP failure category.
`query-provider.tsx` uses normal Query caching; QueryObserver retains data after
a refetch error. Consequently, the source would remove the reading DOM, sidebar
and editor surface during a 503/network error despite a known detail snapshot.
The recently fixed list path at `conversation-list.tsx:215–232` already separates
cached/transient errors from HTTP 401/403/404.

Keep the existing remote Reader tree when a matching cached detail exists and the
failure is transient. Put a small, labelled recovery notice outside the reading
scroll subtree, without resetting loaded turns, selections or anchors. Do not
keep the Reader for denied/missing access, a different cached id or a known merged
source. The latter retains its existing destination action. The cached view is
explicitly the previously loaded snapshot, not a claim that fresh data was read.

### REC-01 — retry the failed detail read, not the visit or a mutation

The same return at `conversation-reader.tsx:2203` passes the raw error message and
no `action`, although `ReaderState` at `:3251` already accepts one. Add localized
generic error copy and **Retry conversation / 重试读取对话** for the remote detail
query. Disable repeated activation while its read is pending; handle rejection
without an unhandled promise. The action directly refetches only the existing
detail query. Normal initial dependent reads may resume after it succeeds, but
the action must not navigate/reload, reset the window or replay recent/mutation
POSTs. A stale route/account callback may not initiate the read.

On 401/403/404, keep a generic unavailable view (and generic document title) rather
than cached private content. A retry can recheck access, never bypass it. If the
retry control disappears after recovery, restore only lost/body focus to the
existing Reader scroll region with `preventScroll`; another chosen control keeps
focus. This focus behavior will remain unverified until a real browser run.

## Implementation brief and preserved decisions

Intent: the same quiet reading desk remains usable through an intermittent read
failure; a visible error offers one small, explicit recovery action. The existing
paper/graphite/sea-green palette, application font stack, border/surface depth and
4px spacing grid remain unchanged. Reuse `ReaderState`, `btn-secondary`, text-sm
copy and a 44px minimum Retry target. A compact bottom notice inside the Reader
section stays outside the reading scroll content and its mobile auto-hiding header;
it does not insert a large block above messages or change the reading pane's layout.
No new dependency, token, screen, modal or navigation mechanism is needed.

Platform and design direction are already approved Web decisions. The interface,
senior-designer and frontend design skills guide consistency, not a new redesign.
Their rendered verification cannot be scored while local Web execution is blocked;
no visual or accessibility conformance claim will be made.

## What's working and left alone

Recent-open now has visit/auth ownership and does not retry a lost non-idempotent
POST. Complete turns and stable real DOM anchors remain the reading authority.
Neighbor-window retries already exist; the initial message-window error, mutation
refresh feedback and create/insert unknown-outcome policies are separate candidates,
not silently included here. Offline Reader retains its original error behavior.

## Verification plan and open questions

Execute the real pre-repair early-return branch with installed QueryObserver and
controlled read failures; retain that baseline before edits. Test actual repaired
branch/notice/retry/focus code with explicit transport, hooks and DOM doubles,
including denial, wrong id, merged/offline controls, pending duplicate activation,
navigation/account retirement and same-query recovery. Integrate the earlier Node
suites, lint, nonincremental typecheck, bounded build and browser discovery only.
Real Reader DOM identity, focus, mobile overlay size and browser scheduling remain
open until an authorized runnable browser fixture exists.

## Local implementation and verification checkpoint

The two scoped repairs are implemented locally. Remote cached transient failures
keep the existing Reader; the recovery notice is a single child of the reading
section, outside header/scroll content. Denied/missing and wrong-id data have the
generic title/error boundary; known merged and offline branches retain their
existing behavior. Explicit retry directly refetches only detail with
`cancelRefetch: false`, guarded by the mounted visit/auth owner and current fetching
state. Focus recovery uses the existing labelled scroll region and `preventScroll`,
only when focus is lost; it does not modify reading position or navigation algorithms.

| Evidence | Actual result | Boundary |
| --- | --- | --- |
| [Before-edit baseline](ux-audit-reader-detail-recovery-2026-10-09-evidence/baseline.json) | 22 cases: 5 passed / 17 failed, 671.5455ms | Two findings, not 17 separate product defects |
| Same initial cases after repair | 22 passed, 589.9979ms | Extracted application branches and controlled QueryObserver |
| Expanded detail checks | 27 passed, 638.6627ms | Pending/failed/retired focus, title and real JSX placement added |
| Final combined Node run | 435 passed / 0 failed / 0 skipped, 7778.5554ms | 27 new + preceding 408; not browser rendering |
| Web lint / nonincremental typecheck | Passed | Final application and browser-test source |
| Bounded Web build | Passed; Next 16.3.8, compile 28.2s, TypeScript 8.1s, 14 pages 3.1s | One worker, standalone off; no app server or image build |
| Browser discovery | 69 discovered / 0 executed | Four new cases, no browser or fixture started |
| API | Not changed or rerun | Prior 11/18/19/41 SQLite checkpoints overlap and remain separate |

The [durable verification ledger](ux-audit-reader-detail-recovery-2026-10-09-evidence/local-verification.json)
binds 61 final source/test hashes. Of the previous 60 files, 58 are unchanged; only
Reader and the browser file changed, with the new detail script added. Historical
recent-open hashes and evidence were not rewritten. HEAD/local origin remain
`a12ce9e`; index is empty, tracked protected paths have no diff, unrelated buildinfo
and both legacy auth-resume directories remain preserved. No remote fetch or
production access was performed to establish these local checks.

The Node harness renders the exact extracted early-return/recovery JSX to static
markup and executes actual retry/title/focus callbacks with installed QueryClient
and QueryObserver. The rest of the Reader is deliberately replaced by a retained-
surface marker. Hook scheduling, owner/auth lifecycle, transport and DOM focus are
doubles. It proves the local branch and action contracts, not actual React mounting,
retained DOM identity, scrolling, keyboard behavior or visual layout. Separate AST
checks inspect the actual notice insertion and labelled, unkeyed scroll region.

The four new browser cases are written for 375px Chinese/light and 1440px English/dark.
Two use an actual sidebar rename followed by a failed detail GET; they retain
original root/article handles, assert scroll continuity and unchanged messages,
hold explicit retry, and check no repeated rename/recent POST. Two start with a
failed initial GET and assert no recent POST until a successful explicit read.
The mobile setup was source-corrected to reveal the auto-hiding header with a real
upward wheel before recording the retained position. This is a test correction,
not a newly demonstrated product issue. Selectors, timing, focus and screenshots
remain unexecuted; no rendered designer score or accessibility conformance is claimed.

## Next bounded review

Initial complete-turn failures and create/insert/delete/undo/merge write recovery
remain separate candidates. Inspect and record the next finding before further
application edits. This checkpoint does not implement or accept those paths.
The goal stays active; do not commit, push, trigger CI or deploy without the user's
next explicit request. The accepted production source remains 30a0d32, not this batch.
