# UX quick review — Reader recent-open reconciliation

2026-10-09 · Existing Web Reader · Recorded before this batch's application edits.

## Scope and evidence

An ordinary reader opens a conversation, may edit/move it, then navigates onward
or back to Recent. This review covers only recent-open admission and response
publication inside `ConversationReader`; it follows the completed local placement
checkpoint on parent `a12ce9e287fdddfd4df8a6039a212cec04629568`. Evidence is exact
source, followed by explicitly labelled synthetic/API checks. No live browser,
real lifecycle, network race frequency or visual behavior has been observed.

Excluded: changing reading-position synchronization, DOM anchors, navigation,
recent-project context policy, canonical membership, offline packages/Dexie schema,
Share, server locking or authentication architecture. The recent-project context
can differ from canonical membership; its policy is not being changed here.
No service fixture restart, production access, subagent, commit, CI or deployment.

## What matters most

Recent-open bookkeeping must not regress a conversation that has already changed.
Its response is only a list summary, not a fresh full Reader document. The server
does not advance the canonical conversation revision for an open or position save,
so revision alone also cannot order two reading-progress observations. Opening is
not idempotent: another POST increments the open count. Recovery should therefore
keep reading usable and reconcile with reads, not silently replay an uncertain POST.

## Findings and prioritized work

| ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| DATA-01 | Recent responses can regress or mislabel cached canonical/reading state | Data consistency | Medium | Observed (code); user-visible effect Inferred | S |
| LIFE-01 | Recent callbacks have no current-owner or authentication-generation fence | State/recovery | Medium | Observed (code); lifecycle timing Inferred | S |
| FBK-01 | A successful open does not invalidate the Recent list | Feedback | Medium | Observed (code); stale visible order Inferred | S |
| NET-01 | A failed response re-enables a non-idempotent open on later data changes | Error prevention | Low | Observed (code); duplicate-count frequency unknown | S |

### DATA-01 — reconcile a summary without downgrading the Reader

`features/conversations/conversation-reader.tsx:465–478` copies the response's
`offline_revision`, `last_read_at` and `reading_progress` into any existing detail,
without comparing revision, identity or timestamp. A delayed older response can
lower the revision after a rename/move. A newer summary can instead label old
detail-only/canonical fields with a revision they never represented. Even equal
canonical revisions can carry older reading progress: `reading_service.py:195–220`
updates recent time/context without bumping conversation revision.

Preserve newer canonical snapshots. For a newer returned revision, leave the
existing full detail coherent and request a fresh exact remote detail GET; never
manufacture Detail from the partial recent response. At equal revisions, update
the reading time/progress pair only if its timestamp is newer. Progress may go
backward when the person rereads; do not take a numeric maximum. Reject mismatched
identity/invalid revisions and do not create a missing cache entry. Leave reading
position and complete-turn window keys untouched.

### LIFE-01 — make publication belong to one Reader visit

The same effect at `:465–485` has no cleanup or live-owner check; its admission
ref at `:122` contains only the conversation id. Success always publishes and
invalidates global lists. `lib/api.ts:1603–1640` uses authentication generation
for a failed-auth notification, not for successful response publication. The
offline source at `lib/reader-data-source.ts:320–323` returns null after its local
timestamp update, yet the effect still invalidates remote project/conversation
queries. These are source boundary gaps, not evidence of cross-account data access.

Reserve one attempt per mounted conversation/data-source visit. Use a live owner
reference, cleanup and the captured authentication generation before sending or
publishing; navigating away and back creates a new visit, while ordinary query
refreshes do not. Keep offline local recording on its existing source without
triggering remote refresh. Old callbacks may not act during the render-to-effect
cleanup gap. An already-sent server request is not cancelled or undone by retirement.

### FBK-01 — invalidate the actual recent-list key

`conversation-reader.tsx:480–481` invalidates `conversations` and `projects`, but
`features/reading/recent-items.tsx` reads `recent-items`. QueryProvider retains
successful data for 15 seconds and does not refetch on window focus. Returning to
a cached Recent page in that interval can therefore reuse the pre-open result.
After a valid current remote response, invalidate the existing recent-items key
along with the existing list keys. Handle detached read errors independently;
default Query invalidation ordinarily resolves even when a GET fails, so a
rejecting callback is a separate defensive test, not proof of every GET failure.

### NET-01 — do not turn a refresh into another opening

`conversation-reader.tsx:482–484` clears the recorded-id ref on rejection. The
effect depends on `conversationQuery.data`, so a later changed read can silently
send another open POST. `reading_service.py:217–218` increments `open_count` on
every repeat; there is no receipt/idempotency key for this endpoint. A lost first
response can thus be counted twice in one visit. Keep the attempt reserved even
on failure; opening another conversation and returning is a real new visit and
can record again. Do not add a blocking error/toast or a new retry UI for this
nonessential bookkeeping path.

## Implementation brief and unchanged decisions

Intent: preserve a quiet, stable reading session and honest Recent state through
late bookkeeping responses. This changes effect ownership/cache reconciliation,
not markup. Existing paper/graphite/sea-green tokens, fonts, spacing, modal depth
and all visible controls remain untouched. Platform and design direction are
already approved. No dependency, new backend API, migration or visual redesign.

Use the existing Reader effect and local React owner/ref patterns. First execute
the actual pre-repair effect with controlled responses and installed QueryClient;
then patch only this path and add contract tests around the unchanged API. Verify
that newer detail arrives through a real QueryObserver, not a fake fabricated
Detail. Never invalidate reading-position/turn-window merely to repair recent data.

## Evidence status and open questions

- Seen: Reader effect/dependencies, remote/offline data sources, fetch helper,
  recent API/service, existing recent/position tests and query defaults.
- Not seen: real React scheduling, browser navigation, focus, visible sort order,
  real transport failures, PostgreSQL concurrency or a rendered design checklist.
- Synthetic and SQLite evidence will be retained beside this report; neither
  establishes a browser or production acceptance result.
- Outside scope: whether historical `projectId` navigation context should always
  track canonical membership in Recent. Resolving that policy could change its
  link context, but is not needed to keep canonical revisions and reading fields
  coherent here. No conclusion or membership change is made.

## Local implementation and verification checkpoint

The existing effect now reserves a conversation/data-source owner with a captured
authentication generation, live reference and layout cleanup. Both admission and
publication require the current active owner. Authentication is deliberately not
a memo dependency: an account change cannot automatically re-admit stale data in
the same mounted view. Ordinary refresh and uncertain failure retain the attempt;
a genuinely new visit gets a new reservation. Already-sent writes are not undone.

Current remote replies validate identity/revision before publishing. Equal-revision
reading fields change together only for a strictly newer timestamp. Ignored replies
do not call `setQueryData`, preserving `dataUpdatedAt`. A higher revision schedules
an exact full-detail GET with normal cancellation of an older in-flight refetch;
failed reads retain coherent old detail. Three independent, handled invalidations
include the actual Recent key. Offline recording stays on its original local source.
No markup, DOM anchors, reading-position/complete-turn keys, backend implementation,
API schema, migration or dependency changed for this batch.

| Check | Result | Meaning |
| --- | --- | --- |
| [Pre-edit baseline](ux-audit-reader-recent-2026-10-09-evidence/baseline.json) | 24 cases: 7 passed / 17 failed | Actual extracted pre-repair effect, not a fabricated alternate algorithm |
| Initial repair | 24 passed, 528.4943 ms | Same initial cases |
| Expanded recent-open regression | 37 passed, 573.4687 ms | Cache age, failed/full/older in-flight GETs, equivalent timestamps, owner/auth/data-source transitions |
| Final combined Node regression | 408 passed / 0 failed / 0 skipped, 6885.6218 ms | Includes preceding 371 cases; not a count of distinct product findings |
| SQLite recent/position/sync contracts | 11 passed, 25.74 s | Five recent (three new), two position and four existing test-auth sync cases |
| Lint / nonincremental typecheck | Passed | Final source and browser test code |
| Bounded Web build | Passed | Next 16.3.8, one worker, standalone disabled; compile 27.1 s, TypeScript 8.0 s, 14 pages in 3.1 s; no server |
| Browser discovery | 65 discovered / 0 executed | Four new cases; no rendering, focus, lifecycle or screenshot acceptance |
| Evidence / docs / Git checks | Passed | 60 source hashes; 48 of the preceding 50 unchanged, two expected Reader/browser changes; 25 docs / 287 local links; clean whitespace check and empty index |

The new browser cases are source/discovery only. At 375px Chinese/light and 1440px
English/dark, they intend to let the fixture actually record an open, then delay or
lose its response while the person renames through the sidebar. Later GETs are held
so they cannot hide an overwritten revision. A real message-insert dialog submits
to an intercepted 503 response without inserting data; its expected revision must
equal the acknowledged rename. Count and unchanged-source assertions use only the
disposable fixture. These selectors and timing have not been exercised. They do not
claim a reload-based proof of Recent cache invalidation; that key is checked by the
installed QueryClient regression.

Exact-source hashes, commands, previous-checkpoint comparisons and verification
limits are in [local verification](ux-audit-reader-recent-2026-10-09-evidence/local-verification.json).
The earlier placement 18-pass, metadata 19-pass and admission/project 41-pass API
checkpoints were not rerun here and must not be summed as unique cases. Prior
ledgers and the failing baseline remain immutable. Visual checklist scores, full
React lifecycle and PostgreSQL concurrency remain **NOT_VERIFIED**. No subagent,
service fixture, remote/production access, commit, push, CI or deployment was used.
