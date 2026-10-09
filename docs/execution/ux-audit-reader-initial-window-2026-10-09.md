# UX quick review — Reader initial complete-turn recovery

2026-10-09 · Remote Web Reader · Findings recorded before application edits.

## Scope and evidence

The ordinary reader has reached the conversation detail but the first complete-turn
window has not loaded. This scoped audit follows [detail-read recovery](ux-audit-reader-detail-recovery-2026-10-09.md)
on parent `a12ce9e287fdddfd4df8a6039a212cec04629568`. It covers the initial body-read
error surface, an explicit retry of that same query and retirement of that error
once an independently loaded current window exists. Source and installed query
behavior are available; there is no running browser fixture. Rendered interruption,
focus and scrolling remain Inferred, not observed in a live Reader.

Excluded: the complete-turn loader/anchor fallback algorithm, neighboring-window
loading, target-navigation transactions, reading-position restoration/persistence,
mutation admission or reconciliation, offline behavior, Share, API and migrations.
Navigation is read only to establish which local state supersedes the initial query.
No local service start, production browsing, CI, deployment or subagent is allowed.

## What matters most

The title can be readable while the body is unavailable. That is a recoverable
read failure, not an empty conversation. The current error offers no local retry
and presents raw transport text. Successful alternate navigation can load complete
turns while the original query stays failed, leaving an obsolete error above them.
A small, explicit body-read action should recover the original window without
reopening the conversation, replaying recent-open or replacing a newer navigated
window. Existing complete-turn and navigation safety rules must remain authoritative.

## Findings and priority

| ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| REC-01 | The initial complete-turn error has no local retry and shows raw transport text | Error recovery / copy | High | Observed (code); user recovery cost Inferred | S |
| STATE-01 | An obsolete initial-query error remains above an independently loaded current window | State coverage / truthful feedback | Medium | Observed (code); rendered effect Inferred | S |

### REC-01 — retry the same initial body read

Before this batch, `conversation-reader.tsx:2500–2502` renders
`<ReaderState title={t("loadFailed")} detail={windowQuery.error.message} />` with no
action. The query at `:537–551` loads complete turns around the original URL/saved
anchor, enabled after detail and the initial-position decision. Earlier/later
sentinel retries at `:2514` and `:2551` depend on a loaded window; they cannot recover
this first body read. The previous detail-read repair is an in-repo recovery pattern.

The reader otherwise has to leave/reload or discover a different navigation path.
Offer **Retry messages / 重试读取正文** with plain localized failure copy. Refetch only
the existing `reader-turn-window` query with its unchanged anchor/key and complete-
turn policy; do not reset the visit, position, loaded window, mutations or recent
POST. Reject repeat/retired callbacks and stale anchor scopes. Offline errors keep
their existing branch. Access failures can be rechecked, never bypassed.

### STATE-01 — stop reporting an initial failure as a current-window failure

The same JSX tests only `windowQuery.isError`, without considering current messages
or whether an initial window has already been applied. `navigateToTarget` at
`:1065–1073` can set `initialWindowAppliedRef.current = true` and apply a full target
window independently of that original query. The first-window application effect
at `:735–744` already respects this flag and does not overwrite an accepted window.

Showing the stale failure beside valid content wrongly implies the current body
still needs recovery. Limit the new remote initial error/retry to an unapplied,
empty initial window. A cached callback must also check live local state before
requesting another read. Preserve the existing apply-once guard so a late initial
retry cannot replace a newer accepted target window. This is error-scope correction,
not a rewrite of navigation or an automatic refetch policy.

## Implementation brief and preserved decisions

Intent: get back to the same reading desk with one understandable action beside the
failed body, without redoing a successful visit. Preserve paper/graphite/sea-green
tokens, application font, border/surface depth and 4px spacing. Reuse ReaderState,
text-sm, btn-secondary and a 44px Retry target. A localized status/recovery region
belongs where the old initial error appeared, not in a new modal or above the
whole shell. The existing labelled Reader region can receive lost focus with
preventScroll; a selected control, new anchor/account or newer navigation owns
its focus. No new dependency, token or product direction is needed.

Web platform and design direction are already approved. Interface/senior/frontend
design checks constrain consistency; rendered scoring remains unavailable, so no
visual or accessibility conformance claim is made.

## What's working and left alone

The loader uses whole turns (five initially), combines neighboring reads and falls
back only for the existing missing-anchor category. Query keys intentionally do
not include content revision. Loaded-window state and its apply-once guard prevent
ordinary refresh from resetting the reading position. Neighbor retries and target
navigation already have separate recovery. All these decisions remain unchanged.

## Verification plan and open questions

Retain a before-edit failing baseline from the actual extracted query options,
error JSX and apply-once effect, with installed QueryObserver and the real complete-
turn helper. Transport, hook scheduling, document/focus and navigation state are
explicit doubles. Cover original/saved anchors, missing-anchor fallback, empty
success, read failure, no write/detail retry, live duplicate/stale-scope guards and
late results after accepted navigation. Add unexecuted browser cases, then integrate
Node, lint, nonincremental typecheck, bounded build and discovery only.

Real body DOM, focus, scroll, browser scheduling and restored-position interactions
remain open. Other create/edit/undo recovery candidates are not included in this batch.

Follow-up candidate, not a repair/acceptance claim here: first-paint readiness is
still derived from the original detail/window query statuses (`setInitialPaintReady`),
not from independently applied target windows. Its effect on post-failure navigation,
progress feedback and later user-intent/position tracking needs a separate audit and
reproduction. Hiding an obsolete initial-error notice does not establish that this
broader readiness path is correct.

## Before-edit baseline

The [baseline](ux-audit-reader-initial-window-2026-10-09-evidence/baseline.json)
records **5 passed / 19 failed** of 24 cases (656.6163ms), before application edits.
The five controls cover whole-turn application, true empty success, offline errors,
missing-anchor fallback and the existing query key/enablement. Failures are grouped
under the two findings above; missing Retry prevents its proposed pending/owner/focus
contracts from running and is not 19 distinct product defects.

An earlier harness-construction run failed its extraction assertion before any
test case ran: it also selected the enclosing content prop. Restricting extraction
to each actual conditional's own condition corrected the harness. That 0/1 run is
recorded separately and is not evidence of a product failure. Application source
was unchanged throughout both baseline runs.

## Local implementation and verification checkpoint

The same 24 cases pass after the scoped repair (648.742ms). Expanded checks pass
all 32 cases (690.2266ms). Final integration passes **467 Node cases / 0 failures /
0 skips**, 7527.7393ms, including the preceding 435. Lint, nonincremental typecheck
and the one-worker Next 16.3.8 build pass after final application/browser-test edits;
build compilation took 15.5s, TypeScript 7.5s and 14-page generation 3.1s. Standalone
output was disabled and no application server or image build was started.

The [verification ledger](ux-audit-reader-initial-window-2026-10-09-evidence/local-verification.json)
binds 64 source/test hashes. Of the preceding 61 files, 59 are unchanged; only Reader
and the follow-up browser file changed. The new script, existing complete-turn helper
and existing dialogue index are additionally bound. No earlier checkpoint hash was
rewritten. HEAD/local origin remain a12ce9e, index is empty, protected tracked paths
have no diff and unrelated buildinfo/legacy auth-resume directories remain intact.

The repair adds only the current-visit/anchor recovery scope, localized initial
error/action and lost-focus handling. The callback rechecks live query state and
current loaded/navigation refs. The existing loader, key/enablement, apply-once
effect, target navigation and position algorithms are unchanged. No API implementation,
test, migration or dependency changed; prior 11/18/19/41-case SQLite passes were not
rerun and must not be added as unique cases.

Browser discovery finds **75 tests, 0 executed**. Six new cases cover first-turn and
saved-anchor retry plus actual dialogue-index recovery at 375px Chinese/light and
1440px English/dark. Intended assertions preserve the original Reader root, complete
turn messages, source content and detail/recent counts; hold retry reads; restore
lost focus; and hide only an obsolete initial error. Selectors, fixture cleanup,
timing, actual restoration, DOM, screenshots and visual/accessibility checks remain
unexecuted. The Node harness uses exact extracted code and real query/turn helpers,
with explicit lifecycle/transport/navigation/focus doubles, not a mounted full Reader.

This local checkpoint is not CI or production acceptance. The first-paint/position
readiness candidate above remains unmodified and needs its own reproduction before
further edits. Keep the goal active and all accumulated work uncommitted; another
CI submission or deployment requires the user's explicit request.
