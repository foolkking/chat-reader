# UX audit — mobile release follow-up

Pre-edit review of source `3e82323668a7843a5bfbebc7ea1d03a5dca61c1e` and its
second complete CI, 2026-10-09. This continues the same authorized release cycle.

## Scope and evidence

The audience is ordinary readers using the existing responsive Web app. This
review covers mobile first-message access, pending conversation placement and
project archive/restore recovery. The existing quiet reading-desk design and
tokens remain approved; no new visual system, dependency or background work is
proposed. Canonical content, saved reading positions and explicit recovery after
an uncertain write must remain intact.

Evidence is source plus isolated Chromium CI 37897405546, original quality
artifact **11601831277**, producer attempt 1. The failed manual-source trace uses
a synthetic two-message conversation at 375 × 900 in English/dark mode. Its
[last recorded frame](ux-audit-mobile-release-2026-10-09-evidence/header-overlap-375.jpeg)
shows the first message hidden beneath the header. The placement failure has an
assertion context, not a trace of the element receiving the second pointer event.
Do not infer that exact target from the failed focus assertion.

No local Web/API/PostgreSQL/worker fixture or production UI was started. The
original local Web policy refusal is not retried. This is not a whole-app visual,
accessibility-conformance or CPU/RSS acceptance. API and settings jobs succeeded;
their detailed totals are not yet re-read at this checkpoint. Web's mutation
gate completed **97 passed, 2 failed, 1 timed out, zero skipped** in 857,735 ms.
The CLI groups the latter three as failures. The gate did **not** reach its
20-minute limit; an initial progress interpretation was corrected after reading
the log. Later Web gates and both image jobs did not execute.

## What matters most

The first mobile message must stay reachable even when the offline guide wraps.
The fixed 56px reserve does not describe the actual header and can leave a short
conversation with no useful scroll escape. The earlier placement repair keeps
the dialog open, but the mobile double-click case still loses the expected Close
focus. These are scoped interaction defects, not reasons to redesign the Reader.
The archive failure is different: its test expects an obsolete error and blind
retry, while the product correctly offers an explicit result check. The next
repair must preserve source fidelity, one-write guards and read-only recovery.

## Findings

### VIEW-01 · Wrapped mobile header obscures the first message

- **Dimension:** responsive layout / core reading and editing flow.
- **Kind / severity / effort:** defect; High; M.
- **Confidence:** Observed (source, isolated CI pointer-interception trace and
  screenshot). Exact real-device incidence is not measured.
- **Location:** `apps/web/features/conversations/conversation-reader.tsx:2429`,
  `:2510`, `:2534`; `apps/web/e2e/manual-markdown-fidelity.spec.ts:53`.
- **Evidence:** the absolute mobile header contains the wrapped offline guide,
  but the reading region reserves only `pt-14`. The real first-message action
  exists and is visible/enabled/stable; Chromium repeatedly reports the header
  or its offline-guide child intercepting the click. The test times out before
  opening the editor. Its `finally` cleanup timeout masks the original action
  failure in the console summary; the trace identifies the original click.
- **User consequence:** readers cannot see or operate the start of a short
  conversation without dismissing unrelated guidance. This also prevents the
  requested whitespace-only edit flow.
- **Recommendation:** reserve the header's actual border-box height on mobile,
  keep that reserve stable while auto-hide only transforms the header, and keep
  desktop normal flow unchanged. Observe size changes, not scrolling; do not
  manufacture scrolling, reading intent or saved positions. Retain the guide
  and test actual pointer access instead of dismissing it or force-clicking.

### FOCUS-01 · A pending mobile move still loses Close focus

- **Dimension:** keyboard interaction / feedback and recovery.
- **Kind / severity / effort:** defect; Medium; S.
- **Confidence:** Observed (isolated CI: one held PUT, disabled submit, Close
  inactive); cause after the second pointer-down is Inferred.
- **Location:** `apps/web/features/conversations/conversation-placement.tsx:288`,
  `:336`, `:381`; `apps/web/e2e/ux-recovery-followup.spec.ts:604`.
- **Evidence:** desktop passes. Mobile retains the dialog and sends only one
  held write, but Close fails its focus assertion. The existing layout effect
  handles body/newly-disabled-submit focus at the phase transition; backdrop
  pointer-down is guarded. A subsequent pointer-down on the disabled submit has
  no corresponding default-focus guard.
- **User consequence:** keyboard continuation after a repeated click is no
  longer at the dialog's first enabled action, despite the move still running.
- **Recommendation:** prevent default focus changes from a pending disabled
  submit, while leaving intentional enabled controls, Close/Back/Escape and
  user-selected focus alone. Keep the one-write and focus-cycle assertions.
  Capture the actual active element and pending geometry before assertion in
  the next synthetic browser run; do not treat a local DOM double as proof of
  Chromium event dispatch.

## Test-path correction, not a third product defect

`apps/web/e2e/ux-whole-site.spec.ts:407` still seeks an alert containing
`Could not archive`. The actual screenshot context shows a status with
`Archive could not be confirmed. Check the result before retrying.` and the
working `Check archive result` action. Archive recovery now closes its menu and
requires a read before another explicit archive; restoration has the same
unknown-outcome boundary. Update this test to exercise that real sequence,
assert unchanged canonical membership and exact write counts through the
failure/check/retry steps, and retain actual mobile creation and restoration.
Do not restore a blind write merely to satisfy an old assertion.

## Prioritized work and acceptance

1. VIEW-01: mounted-header sizing, detachment/late-callback cleanup and no-scroll
   local probes; real short-message pointer access in both locales and widths.
2. FOCUS-01: pending pointer-default guard with chosen-control negative probes;
   retain actual double-click, disabled submit, focus cycle and one PUT.
3. Align archive/restore test with explicit checking and exact write counts.
4. Run integrated Node, lint, nonincremental typecheck, bounded build and browser
   discovery only locally. Then rerun the complete same-cycle exact-source CI.

No product edits had been made when this report was written and delivered.
Actual render acceptance, all remaining Web gates, independent image inspection
and fresh King backup/capacity/rollback/data checks are still required. There is
no new permission to publish future unrelated optimization.

## Working decisions and deferred review

Routine position autosave stays silent. Acknowledged mutations remain distinct
from failed refresh, and unknown writes retain explicit read-only checks.
Current/All annotation empty states, annotation-read failure isolation, large
text/table preview budgets and English generic API errors remain follow-up
review candidates, not included repairs or accepted findings of this release.
They need their own source/measurement record before implementation.

## Scoped repair and local verification

After the pre-edit report was delivered, VIEW-01 was repaired with a React 19
callback ref that reserves the actual mounted header height. It observes size,
not scroll, writes only changed positive heights, and disconnects/restores its
owned property on cleanup without overwriting a newer value. The reserve survives
auto-hide transforms; desktop normal flow is unchanged. The first mobile message
test retains the offline guide and verifies geometry before an ordinary click.
Its synthetic-record fixture now has an independent 30-second teardown budget
and a 15-second DELETE timeout, preventing cleanup from masking the first error.

FOCUS-01 adds a live pending-state default-blur guard to the retained disabled
submit's pointer-down capture, shared with the backdrop. It does not change the
dialog's full height, take chosen focus, resend a write or block Close/Back/Escape.
The browser test records active focus and geometry, and captures the pending
dialog before asserting focus. The inferred dispatch cause remains unproven
until Chromium reacceptance; local event doubles are not that acceptance.

The whole-site archive test now follows the implemented unknown-outcome contract:
failed archive, read-only result check, explicit archive, failed restore, read-only
result check, explicit restore. It retains real mobile project creation, checks
canonical membership at each failure and asserts exactly four PATCH payloads.
No blind retry, force click, guide dismissal or assertion removal is used.

The [local ledger](ux-audit-mobile-release-2026-10-09-evidence/local-verification.json)
records the 81-case baseline (**68 pass / 13 fail**) and same-script repair
(**81 pass**), followed by **622 integrated Node passes**, zero failed/skipped,
9,482.2517 ms. Lint, nonincremental TypeScript and bounded one-worker/non-standalone
Web build pass. Discovery is **144 cases in eight files**, zero locally executed.
No API changes or new local API run were needed for this delta. The new ledger
inherits 107 hashes, verifies 102 unchanged and five expected changes, then binds
three additional sources for 110. Original pre-edit and earlier repair ledgers
remain unchanged. Resource use and the full rendered checklist remain unmeasured,
not scored as passing.

The second CI's detailed logs were subsequently re-read: API **1,239 passed /
3 skipped / 20 warnings**, 840.05 seconds, including both real PostgreSQL merge
concurrency cases; settings **439 passed**, 38.4 minutes, followed by **one passing
fresh-instance restore**, 34.7 seconds. This completes the missing totals without
rewriting the earlier pre-edit JSON. Web remains failed and no image was built.
The next step is a complete third exact-source CI in the same authorized cycle;
King remains unchanged until all release acceptance conditions hold.
