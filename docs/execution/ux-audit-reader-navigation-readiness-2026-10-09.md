# UX audit — Reader readiness and quiet autosave

2026-10-09 · Existing Web Reader · Findings recorded before application edits.

The findings describe the pre-repair checkpoint. Implementation and measured
local verification are recorded below; this is not browser or release acceptance.

## Scope and evidence

This scoped continuation follows the [initial-window checkpoint](ux-audit-reader-initial-window-2026-10-09.md)
on parent `a12ce9e287fdddfd4df8a6039a212cec04629568`. The ordinary reader's first
complete-turn GET fails, then a deliberate dialogue-index navigation obtains a
valid body through a separate target read. Review covers truthful readiness,
listener attachment and admission of subsequent real reading-position saves.
The same source path also serves Offline Reader; its existing restore and
complete-turn contracts must survive. Initial evidence was source code; the
subsequent static-markup/extracted-code checks are recorded below. No browser
session was observed.

Not inspected live: either viewport, React/browser scheduling, real pointer or
touch input, DOM geometry, focus, paint timing, network/server persistence or
production. Do not restart the denied Web launcher, start fixtures, use a
subagent, submit CI or deploy. The user-approved Web platform, existing reading
desk design and local-only execution boundary remain unchanged.

## Executive summary

A successful target window is already accepted independently of the failed
initial query. Readiness still waits for that original query to succeed, so
the code continues reporting partial loading after valid body content exists.
On a cold mount, two listener effects can also miss the later-mounted Reader
root because readiness is their only changing dependency in this sequence.
Their bodies do not actually require readiness; this is a dependency/root-
lifetime problem, not an unconditional boolean gate on every render.
Separately, ordinary index navigation does not settle the saved-position
decision, leaving position writes blocked and a later initial-query success
free to start the old restoration. Fix both ownership boundaries while keeping
the real DOM anchor algorithm and intentional/programmatic-scroll distinction.

## User-requested scope addition — quiet autosave

During this review the user reported frequent save feedback squeezing the body
after scrolling, and explicitly requested a low-interruption solution or removal
of routine notifications. Source inspection identifies the ordinary pending-sync
message, not a server-confirmed success toast. The additional FBK-02 below is
audited before editing that component and takes priority as a small, direct fix.

## Findings and prioritized backlog

| Order / ID | Type / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| 1 · FBK-02 | Defect · routine autosave feedback interrupts reading | Medium | Observed (code), user-reported disruption; exact geometry not measured | S |
| 2 · STATE-01 | Defect · restoration and recovery ownership | High | Observed (code); user-visible loss/jump Inferred | M |
| 3 · FBK-01 | Defect · readiness, feedback and listener lifetime | Medium | Observed (code); rendered indicator/input effect Inferred | M |

FBK-02 is first because the user explicitly prioritized this frequent reading
interruption and the change can preserve the entire saving/synchronization path.

### FBK-02 — normal pending synchronization creates and removes a body-level row

`reading-position-sync-status.tsx:41` treats any nonzero pending count as a reason
to render. Its `:52` message is **阅读进度已保存在本机，等待同步。 / Reading progress
is saved locally and waiting to sync.**, with `role=status`. Reader mounts the
component immediately before its flexing scroll root at
`conversation-reader.tsx:2500–2520`; the component's normal-flow section has padding
and a bottom border. Normal save/queue/acknowledgement cycles therefore add/remove
a layout row. The user reports that movement interrupting reading; exact browser
geometry has not been measured in this task.

Remove routine pending and saved feedback from passive Reader use. Do not replace
it with toasts, blinking icons, repeated live announcements or permanently reserved
blank space. Local saving, outbox coalescing/retries, server acknowledgements and
position restoration remain unchanged. Keep actionable storage/read/sync failures,
conflicts and failed explicit locate recovery. Their existing exceptional notice
placement is retained; this is not a claim that every possible error causes zero
layout change. The explicitly opened sync-center detail already uses `showIdle`
and should keep its useful pending/saved status. Never show a saved-success line
beside a current storage/read/action error in that detail view.

The concrete alternative of moving every save into a floating toast was rejected
because it still consumes attention on every scroll. A persistent saved badge was
also rejected because it adds chrome for a default behavior without resolving a
decision. Silence on routine autosave matches the user's explicit preference.

### STATE-01 — explicit index navigation leaves initial restoration unresolved

Before edits, `conversation-reader.tsx:935–942` settles `restoreAttemptedRef`
and cancels a restore token only for a `targetFirst` navigation. The ordinary
`dialogue-index` path is not `targetFirst`. The saved-position effect at
`:1353–1444` still waits for `windowQuery.isSuccess`; the independent target
load at `:1087–1095` does not change that query. Position persistence at
`:1531–1543` refuses to save while `restoreAttemptedRef` is false.

The reader can resume reading through the index yet fail to record that progress.
If the old query later succeeds, its pending restoration may also reclaim the
reading location from the newer explicit choice. Whether it scrolls or only
changes active-message state depends on whether the saved message exists in the
accepted target window; do not claim that every such case jumps.

Make every deliberate non-restore navigation supersede the initial saved-position
decision, as the existing target-first path already does. Preserve
`restorePosition: true`: loading/restoring an existing saved position must not
manufacture new user intent. A failed or cancelled locate must never fabricate a
new DOM anchor or auto-retry its read. Verify a late saved-position/query result
cannot override the newer choice, and that actual user input can still cancel an
in-progress restoration.

### FBK-01 — readiness describes the original request, not accepted content

Before edits, the sole `setInitialPaintReady(true)` at `:751–755` requires both
detail and original-window queries to be successful. `loadingProgress` at
`:1614–1621` therefore remains 25 when detail is ready but only independent
target navigation succeeds. The first-content metric at `:718–738` does not
complete either. The target window's existing apply-once ownership is already
enough to distinguish accepted content from a pending or failed empty read.

The listener effects at `:597–666` and `:1498–1611` return early without a root.
If detail was initially pending, the root mounts later but their dependencies
may not change until first-paint readiness does. A cached-detail mount can have
listeners already attached and must be tested as a separate control. Merely
hiding the progress line would leave the underlying recovery gap intact.

Drive the paint checkpoint from an accepted current window and available Reader
surface, including genuine successful emptiness. Bind/clean up input and position
listeners with the surface's availability, not the fate of the obsolete request.
Scope scheduled paint work to the current visit/window and cancel it on cleanup.
Keep failure with no accepted content unready, preserve denied-access hiding,
retain the current cached-detail recovery, and leave the original query/key,
complete-turn helper, target alignment and stable-anchor capture unchanged.

## Quick wins and implementation brief

FBK-02 is the quick win: change notification admission, not saving. For FBK-01,
there is no sufficient indicator-only fix: readiness and restore ownership need
regression coverage together. No new UI, dependency, token or
product choice is proposed. Intent is to let a person continue at the message
they deliberately chose, with an honest loading signal and recoverable progress.
Preserve paper/graphite/sea-green palette, existing border/surface depth, font
stack and 4px spacing. Existing progress, navigation status and recovery surfaces
remain in place; no modal, new animation or focus change is needed.

Interface/senior-design checks are limited to preserving those approved decisions.
Without a live render there is no visual score, pixel/contrast measurement or
accessibility conformance claim.

## What works and remains unchanged

- Complete turns and the apply-once flag already protect an independently accepted
  target from a late initial query result. Keep their loading/fallback contract.
- Target navigation already has generation/token cancellation, real DOM block
  leases, stable anchor settling and separate locate-failure feedback.
- Saved-position navigation already opts out of incrementing user intent. Real
  wheel/touch/keyboard/drag input owns its own sequence; a programmatic scroll
  alone must not become a new user action.
- Preserve source data, Share URLs, offline package/Dexie compatibility, mutation
  reconciliation, metadata/recent recovery and all earlier evidence ledgers.

## Verification plan and open questions

Before changing application code, execute the real extracted readiness, input,
restore and persistence effects and target-navigation callback. Use a deterministic
dependency/cleanup scheduler and explicit DOM, transport, time and anchor-alignment
doubles. Exercise cold/cached detail, accepted target/empty windows, original read
failure, late original success, pending or failed saved-position reads, programmatic
scroll, real-intent admission, cancellation, window/visit retirement and cleanup.
Extract the actual position payload builder; do not substitute an invented save
payload. Record harness failures separately from product failures if any occur.

Also compile the actual autosave-status component with explicit view/transport/
hook doubles. Cover routine pending/submitted/idle/offline transitions in both
locales, explicit sync-center status, exceptional failures, conflicts and retry
controls; prove that silent rendering retains its data observation effect.

Add browser assertions for eventual authorized execution, then run local Node,
lint, nonincremental typecheck, bounded build and Playwright discovery only.
Actual DOM anchoring, browser lifecycle and network persistence remain unverified
even when the extracted-code checks pass. Unreviewed create/edit outcomes remain
later candidates, not findings in this batch.

## Implemented local checkpoint

- **FBK-02:** the status component still opens/subscribes to its current storage
  and installs its refresh listeners. Passive Reader rendering returns no row for
  normal pending/submitted/idle/offline-queue state. Existing real failures,
  conflicts and explicit locate recovery remain; `showIdle` detail retains useful
  routine state but suppresses routine success beside current errors. No new
  notification, motion, placeholder space or saving/sync algorithm was added.
- **STATE-01:** all `navigateToTarget` calls without `restorePosition: true` now
  settle the initial restore decision and retire an old restore token, not only
  target-first sources. Existing intent and navigation cancellation rules remain.
- **FBK-01:** listener effects follow `readerSurfaceAvailable`; accepted current
  content drives the guarded first-paint frame. A connected current root, matching
  rendered/live window and generation, plus visit/auth ownership are required.
  Normal empty success can finish loading; a failed read with no accepted window
  cannot. Readable content does not imply that an exact locate succeeded.

### Baseline, repair and final checks

| Checkpoint | Tests | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Autosave before application edits | 29 | 10 | 19 | 0 |
| Autosave repair on the same initial script | 29 | 29 | 0 | 0 |
| Final autosave checks | 31 | 31 | 0 | 0 |
| Navigation/readiness before Reader edits | 29 | 11 | 18 | 0 |
| Navigation/readiness repair and final rerun | 29 | 29 | 0 | 0 |
| Final combined `scripts/ux/*.test.mjs` run | 527 | 527 | 0 | 0 |

The two baselines had no harness-construction failure. Their independent evidence
is retained in [autosave-baseline.json](ux-audit-reader-navigation-readiness-2026-10-09-evidence/autosave-baseline.json)
and [readiness-baseline.json](ux-audit-reader-navigation-readiness-2026-10-09-evidence/readiness-baseline.json).
The final autosave script adds two unread-snapshot cases and corrects the initial
storage-failure fixture to set its snapshot to actual `undefined`; passing
`state: undefined` had previously selected the fixture's default populated view.
This correction is not retroactively attributed to the 29-case baseline/repair.

Autosave uses the complete compiled production component and actual React static
markup. Hooks/lifecycle, observation, Dexie storage, online state, transport and
navigation are doubles. Silence is checked through repeated state cycles while
the subscription stays active; a later real-failure snapshot can still render
recovery. It does not execute a real IndexedDB transaction or synchronization.

Readiness extracts exactly four real callbacks and seven effects. Complete-turn
helpers, registered-block lookup, active-target resolution and the position
payload builder run as actual code. Query snapshots, effect/dependency/cleanup
scheduling, geometry, time, transport, block leases and target alignment are
explicit doubles. Tests cover cold versus cached roots, original-query failure,
accepted target/empty windows, actual intent admission, late initial success,
restore cancellation, programmatic-scroll exclusion and queued-frame retirement.
They are not a full mounted React Reader, a real paint measurement or proof of
server persistence.

Lint, nonincremental typecheck and the one-worker Web build pass after final source
and browser-test edits. The build uses `NEXT_BUILD_CPUS=1`, `NEXT_STANDALONE=0` and
`NEXT_TELEMETRY_DISABLED=1`; it does not start an application server. The new
[local ledger](ux-audit-reader-navigation-readiness-2026-10-09-evidence/local-verification.json)
binds 72 source/test hashes. Of 64 previously bound files, 62 are unchanged; Reader
and the browser file changed as expected. The autosave component and seven other
test/helper/consumer files are newly bound. The old ledger and both baselines are
preserved, not rewritten to match the new Reader.

### Browser coverage is written, not executed

`playwright test e2e/ux-recovery-followup.spec.ts --list` discovers **79 tests**;
**zero execute in this batch**. Four new cases pair 375px Chinese/light and 1440px
English/dark: long synthetic reading with a held real sync POST, local position/
outbox presence, absent routine status, unchanged Reader y/height, subsequent
server acknowledgement/outbox drain and unchanged source; plus a fixture-scoped
`readingPositions.put` quota failure and explicit recovery after restoration.
The pending check allows two animation frames to render while keeping the held
request short relative to the client's ten-second timeout. Two existing index
recovery cases now also require settled navigation, one first-content mark and
an actual wheel-triggered position submission without retrying the old body GET.

Selectors, browser scheduling, DOM bounds/identity, touch, focus, screenshots,
real storage/network behavior and fixture cleanup are all unexecuted assertions.
No visual checklist score or accessibility conformance is claimed. The earlier
SQLite 11/18/19/41-case checkpoints are not rerun or added as a unique API count.
No service, fixture or browser was started; no production check, commit, push,
CI submission or deployment occurred. Continue local optimization under the
active goal; another release requires a new explicit user request.
