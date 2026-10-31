# Reading reliability implementation — 2026-10-31

## Authority and verification boundary

The user approved the merged plan: offline recovery first, reading-list and
annotation-inbox improvements, collapsible project navigation, body-first focus
with edge navigation, and measured performance work. No Web search or local
test/lint/build/server/browser gates. CI owns executable acceptance.

Production acceptance remains the existing 2026-10-30 release until separately
verified. The pre-existing `apps/web/tsconfig.tsbuildinfo` is excluded.

## Batch 1 — source implementation, not yet verified

- Local storage reconciliation now includes ContextMemberObject and
  SkillFileObject, with truncation disabling orphan enumeration. It does not
  exclude entire `context` or `skills` directories.
- Storage-key validation rejects symlink components and unsafe roots.
- Offline preflight checks the changed conversation set before writing bodies;
  selected attachments retain their final streamed integrity checks. Context
  failures have bounded owner-only task diagnostics and safe UI copy.
- Exact-content Context upload retries verify physical members before success.
- Recovery integrity includes Context/Skill objects and their references.
- Added synthetic regressions and a 47/470-conversation SQL characterization.
  Tests are authored, not locally executed.

## Production file recovery — independently checked

Production application remains `127eae5`, schema 0058. All three writers were
stopped and five-component backup `chat-reader-20261030T172811Z` was created;
component hashes, archives and database archive listing were independently
checked. This backup precedes the repair and is **not** a standalone coherent
post-repair recovery point: its missing Context members still require the
preserved copies. Take a new coherent backup at a verified release.

12 files / 974,628 bytes were copied from original preserved storage, each with
exact SHA256 and size, using no-overwrite publication. Overwrites and database
mutations were zero. Both original and independent preserved groups remain.
Original application containers returned healthy, canonical metadata/counts
were unchanged and all six adopted Context pairs were readable through the
existing business service. Full offline-package generation/download is not yet
accepted. No backup, volume, import or preserved user file was deleted.

## Batch 2 — source implementation, pending CI

- Added bounded no-store reading-list and annotation-inbox summaries, retaining
  old full APIs and CAS writes. New tests cover privacy, filtering, Unicode
  preview bounds, paging, read-only state and fixed reading-list query budget.
- Replaced per-card detail requests with summaries; URL filters/paging, back
  scroll restoration, manual state and page-scoped selection. Batch actions
  expose per-item acknowledged/checked/different/rejected/unknown/not-sent
  results. Batch removal confirms that conversations are not deleted.
- Removed synthetic-example links from quick actions and quick start, retaining
  `/example` and its fixtures.
- Project sidebar defaults collapsed for readers without a saved preference.
  Focus hides the persistent workspace nav, uses delayed edge overlays/mobile
  sheets and retains the canonical body. Hidden navigation queries are disabled.
  Added keyboard help and input/IME/consumed-event/modal guards.
- Shared recovery retains the original feature-entry UUID in tab memory across
  panel reopening. Unknown writes require read-only checking; retries are
  explicit, only with a checked absent create identity. Conflicts never replay.
  Account epochs fence/discard private pending attempts.
- CI-only same-runner baseline/candidate capacity comparison uses unchanged
  398/1,000/10,000 synthetic tiers and existing budgets; source identities and
  measurements are preserved. No performance result is claimed yet.

## Remaining batches

Query aggregation now follows the measured baseline below. CI browser/restore/
performance acceptance, full offline generation and any application deployment
remain outstanding. No local gate, CI success or performance improvement is
claimed here. The user's existing tsbuildinfo stays excluded.

## First CI read and measured catalog baseline

Run `41098242354`, source `43a714f`, dispatched 01:22:18 +08;
first read 02:12:21 +08 respected the 50-minute threshold. Not accepted:
the new API fixture called `resolve_key` before creating a simulated file
without `must_exist=False`; all four cases stopped at fixture setup. Web's
single-owner auth gate exposed an existing pathname commit race: a late
private check redirected a URL already changed to a public Share. Source
fixes preserve the existing assertions and fence side effects with the actual
browser pathname, not only delayed React cleanup.

The same failed API step still completed its independent synthetic catalog
characterization: 47 conversations = **283 SQL / 50.18 ms**; 470 =
**2,821 SQL / 413.90 ms**. These are disposable SQLite CI workload measurements,
not production PostgreSQL latency or throughput. Baseline acquisition precedes
aggregation changes. The candidate uses five grouped scalar projections plus
eager project loading, deduplicates equal-sized assets by object identity and
loads tag membership once per package. A <=8-query budget and scalar/reference
parity regression are authored; improved measurements are not yet claimed.

Second source batch `7b2e0bf`, run `41104369714`, dispatched 02:08:59 +08;
do not read success/status before 02:58:59 +08 unless the user reports failure.
Its baseline/candidate Reader capacity workflow is an additional required
comparison, not a substitute for the full existing gates. Added a synthetic
47-conversation/six-pair repair-and-package regression and actual business
read/export/offline checks after isolated Context archive restoration, including
the migrated PostgreSQL fixture. These are authored, not yet passed.

Second run first read at **02:59:02 +08** respected that deadline. API repeated
the known pre-creation fixture error; Web lint/typecheck/build passed, but
the UX suite had **1,880 passes / four failures** in the offline query-policy
adapter: old placement-specific cache expectations and an unregistered
visibility-context import. The adapter now asserts the shared canonical key,
retains source/network/turn/range checks and adds hidden/overlay enablement
coverage. No product retry policy or offline scheduling is weakened.

The third source batch additionally makes unsafe/truncated audit walks withdraw
all orphan classifications, tests symlink boundaries, fences stale feature-entry
callbacks before requests, and tests desktop edge hover/selection/scrollbar
behavior. These strengthen the original gates; no assertion or capacity budget
is relaxed. Application deployment is not part of this source checkpoint.

Third batch `388e3fda5f85a3f8fa24dad82f830c7fc7e678d0`, full CI
`41108969129`, dispatched 02:40:48 +08; first status read is not permitted
before 03:30:48 +08 unless the user reports failure. First-run settings later
completed **463 plus independent restore 1**, without changing its failed
overall conclusion.

Follow-up source review fixes focus-only inherited column padding/header height
and keeps asset-integrity errors from being caught as generic IO errors.
Additional browser cases exercise all five annotation filters, orphan links,
mobile/desktop help and actual keyboard-consumption guards. Collection scroll
memory is bounded to 100 tab/account-epoch entries, not raw search URL keys in
sessionStorage. The comparison becomes an image prerequisite and records both
phases without ignoring any failure. These follow-up changes await fresh CI.

Fourth source batch `c50210ffcc4105f4256c3d98c5baad2950160709`, run
`41111725452`, dispatched 03:01:15 +08; no first status read before
03:51:15 +08 absent a user-reported failure. A final audit-walk review replaces
`rglob` with explicit `os.walk(onerror=...)`: skipped permission-denied subtrees
must withdraw orphan classification, even when visible candidates were already
encountered. A deterministic permission-error regression preserves all files.

Frozen candidate `28fec951962bfce548e450b750c58a51bf9868ce`, full CI
`41112123152`, dispatched 03:04:03 +08; no first status read before
03:54:03 +08 absent a user-reported failure. Only verification-driven corrections
may follow this freeze; no additional product scope is being added.

Third CI first read at **03:30:51 +08** respected its 50-minute threshold.
Grouped catalog measurements were **7 SQL / 14.50 ms (47)** and
**7 SQL / 21.69 ms (470)** in this synthetic SQLite workload, versus the
earlier 283/2,821-query characterization. Only the later dedicated comparison
can certify same-runner timing; these counts demonstrate the bounded query shape.
The API focused step had **26 passes / one failure**: the 47-row test seeded
unowned conversations, but the correctly owner-scoped background worker
serialized zero of them. The fixture now assigns the real migrated test owner;
production ownership isolation is unchanged, and the 47-count assertion stays.
Web repeated the already-corrected query-policy adapter failures. API full,
capacity comparison and image acceptance remain unverified for this checkpoint.

Runs four/five first read **03:54:06 +08**, after both thresholds. Their
reading UX script gate now passes **1,889/1,889**; preceding Web checks pass.
Focused browser/security had 44 passes and one old exact-three-gate assertion:
the workflow correctly has four prerequisites after adding capacity comparison.
The security assertion now requires all four successes, rather than dropping
the existing checks. The new project-privacy fixture also violated the existing
one-project-per-conversation constraint; it now uses two owned conversations
with separate owned/foreign links and still requires no foreign projection.
Neither correction changes application authorization, schema or release gates.

Owner-fixture correction `6976ee4`, run `41116168009`, dispatched
03:33:03 +08 (first-read threshold 04:23:03 +08). The subsequent exact
candidate `b27ce7599e09e945ce6eb9088111423d2264bb1d`, full run
`41119273117`, dispatched **03:56:08 +08**, includes both test-contract
corrections. Do not read it before **04:46:08 +08** absent a user-reported
failure. No full-suite, browser, restoration or capacity acceptance is inferred
from the earlier focused passes.

### Seventh CI — failure evidence and bounded follow-up

First read **04:46:10 +08**, after its 04:46:08 threshold. API passed
**5,966 / three skipped**, including migrated PostgreSQL restoration and
business read/export/offline checks. This is synthetic isolated acceptance,
not a production full-package download.

Web passed 1,889 UX and the focused preceding gates; mutation had 108 passes /
two failures. Both placement snapshots show the active project **already
expanded with its target row**. An immediate `row.count()` after opening the
new default-collapsed sidebar raced the response and waited for a nonexistent
Expand button. The test now waits for the real row; acknowledgement, held
reads, single write, Reader identity/position and keyboard checks remain.

Settings had **462 passes / one failure**. Its trace shows initial catalog 200
then pre-admission catalog 500; Next logs a proxy socket hang-up and no package
POST reached the API. This did not reach the injected worker failure. A bounded
250ms, one-retry policy applies only to transient catalog reads, fenced before/
after by account generation. Auth/scope/validation errors do not retry; no
package write is replayed. The first-copy regression now deterministically
injects that catalog failure and still requires one admission, truthful retained
copy guidance and explicit new-identity rebuild.

Capacity v1 failed baseline **six passes / three failures**, candidate **five /
four**. All 10k profiles exceed 34ms frame p95; candidate plain-398 also has a
189ms task. Mounted message maxima remain <=30. The retained plain-10k candidate
trace contains 1,002 DOM snapshots / 737 screencast frames across its three
navigations and warm revisit; repeated hover actions participate in every wheel
sample. This is evidence of instrumentation work, not proof it explains every
failed frame. The next common v2 harness disables those diagnostics only for
capacity, hovers once before timing, stops RAF/observers, includes all frames
and reports duration/frame/index-request counts. It keeps all old numeric
budgets, readiness and workloads. Do not compare v1/v2 as a product speedup.

The same trace also shows an 80-row index request for each changed active
message. Candidate source reuses a page only while every ordinal in the full
clamped +/-24 window is present; missing rows, gaps, far targets, boundaries
and data-source scope changes recenter. Actual predicate/effect regressions
are authored. Same-runner baseline/candidate v2 must establish the result;
both phase failures still fail the gate. No local gate ran and no application
deployment occurred.

Follow-up source **`1b74ba9cc8e0ac8d31c06e4db341b099d825e67a`** was pushed
and full CI **`41128941676`** dispatched at **05:09:57 +08**. Its first
result/status read is deferred until **06:00:15 +08** (a conservative
50-minute boundary after dispatch), absent a user-reported failure. No result
is inferred from dispatch; only verification-driven fixes may follow.

### Eighth CI — attempt 3 passes API/settings/performance; Web cleanup fails

GitHub creation time is **05:10:00 +08**; attempt 1 first status read
**06:00:46 +08** respected the full 50-minute boundary. Attempt 1 ran on exact
source `1b74ba9`: full API and settings (**463 plus independent restore one**)
passed; Web lint/typecheck/build, **1,899 UX**, preceding browser gates and
**110 mutation** cases passed.

The cleanup gate had four passes / two failures, both in
`openSettingsNoiseReview`. Their snapshots show an intact Reader and visible
Open sidebar rail; the helper still awaited a Task summary inside the hidden
desktop sidebar. The later source fix waits for a real visible entry or opener,
explicitly opens that sidebar if necessary and uses the original Task
summary/review flow. No cleanup selection, refined-range, rule, confirmation or
source-preservation assertion is removed.

Attempt 1 performance job `124325380653` had **zero steps**; its check
annotation says account payments failed or the spending limit needs
increasing. Attempt 2 also had zero-step jobs. These are preserved as failed
attempts. Attempt 3 later ran the same-runner v2 comparison successfully:
baseline and candidate each passed **9/9** Reader capacity cases, and the
synthetic catalog query counts were baseline **283/2,821** versus candidate
**7/7** at 47/470 conversations. Its single-run SQLite timings were baseline
96.78/820.29 ms and candidate 24.56/35.02 ms; these characterize only that
isolated synthetic workload and are not production PostgreSQL latency claims.
The current full run still concludes failure because Web cleanup failed.

Attempt 3 also passed full API (**5,966 / three skipped**) and settings
(**463 plus independent restore one**). It ran on the same `1b74ba9` source,
so it does not verify the later test corrections. `build-images` and
`inspect-release-artifact` were skipped because Web failed.

### Source-only CI corrections and plan audit before run 41183167236

Commits `978080e` and `09f820c` are on the current branch (`09f820c`) but have
no CI receipt. The first fixes both cleanup failures by opening the collapsed
Reader sidebar before using the existing Task Center flow; the second makes
the workspace soft-navigation test's expanded preference explicit while
keeping the Sidebar identity and one-document-request assertions. They do not
relax product or release assertions.

| Approved scope | Source status | Latest acceptance / remaining |
| --- | --- | --- |
| Shared-storage audit, Context/Skill references, offline preflight/recovery | Implemented; 12 preserved files restored without overwrite. | Attempt 3 API passed, including isolated restore/read/export/package checks. A production-sized 47-conversation package download and a new coherent post-repair five-component backup remain outstanding. |
| Reading list, annotation inbox, example-entry removal | Implemented; legacy APIs and `/example` compatibility retained. | API suite passed. Dedicated browser/screenshot evidence is not present in the latest artifact; later full-PWA gate was not reached. |
| Collapsed project sidebar, body-first focus and edge navigation | Implemented; browser fixtures cover default, saved preference and focus cases. | Some focused browser checks passed, but no target 375/1440 collection/focus screenshot review exists; current source-only fixture fixes await CI. |
| Reader recovery, keyboard guards and account-fenced unknown writes | Implemented with regression coverage. | API, UX/mutation and focused browser subsets passed; later default-PWA/auth gates remain unverified. |
| System/catalog/index performance | Grouped catalog query and index-window reuse implemented; v2 harness keeps existing budgets. | Attempt 3 baseline/candidate capacity both passed 9/9; catalog shape 283/2,821 -> 7/7. Synthetic results only; no production latency claim. |
| Full release acceptance | Not complete. | Latest attempt 3 failed Web cleanup on old SHA; both current fixes need a new full exact-source CI. Image build, independent artifact inspection and production deployment have not happened for this batch. |

Therefore, all approved source work has a candidate implementation, but the
plan is **not fully accepted or released**. The exact offline incident is not
uniquely attributable from the user's screenshot: shared Context/Skill
references and missing Context backing files were confirmed, and CI also
reproduced a transient pre-admission catalog failure. The one-retry read policy
addresses that transient path without replaying package writes. Actual full
package generation/download, new source CI, target screenshots, a coherent
post-repair backup and release gates remain required.

Next required work:

1. Run the full workflow against the corrected exact source; retain all four
   release prerequisites and the established first-read boundary.
2. Complete default-PWA/negative/auth gates and inspect the target 375/1440px
   collection/focus screenshots, not unrelated UI.
3. Record actual pass/failure and measurements without production-latency or
   cross-protocol speedup claims. Deployment, full production package download
   and a new coherent post-repair backup remain separately outstanding.

### Ninth CI — three independent failure families

Full run `41183167236`, exact source `53d0e226f3837df84ae4b4cc813e357e4e62c485`,
concluded failure on 2026-10-31. API passed. Web cleanup now passes **6/6**,
confirming that the old collapsed-desktop entry problem is resolved; the
soft-navigation preference case also passes. Default PWA records **178 passes /
two timed out / 760 conditional skips**, both timeouts at the inbox's exact
`getByLabel("Type")`. Its snapshots contain the real accessible
`combobox "Type"`; subsequent filters now use that explicit role/name, retaining
all five types, attention/project/sort/reset and no-write assertions.

Settings records **436 passes / 27 failures**. The failed 375px helper tries
to click the visible floating Task summary after opening a modal sidebar;
the sidebar's Settings button intercepts it. The corrected helper uses the
real `sidebar-tasks-button` inside the sidebar, which closes the drawer and
opens the existing Task Center. There is no force-click, removed product
assertion, increased test timeout or ignored failure.

Capacity baseline/candidate are **6/9 / 8/9**. Logs retain exact 120px
reversals: baseline plain-10k run 2 `840 -> 720`, mixed-10k run 1
`2880 -> 2760`, and both plain-398 warm revisits `1200 -> 1080`.
Their frame/task thresholds do not cause these failures. The old protocol
reset the root before saved-position restoration was known complete and used
fixed warm-up delays despite possible edge restoration. These are verified
harness readiness gaps; they do **not** establish the unique cause of every
reversal. Follow-up source waits on actual restore/edge state and retains the
raw monotonic assertion, adding bounded navigation/edge/layout context when it
fails. Do not silently discard reversed samples or loosen the 2px tolerance.
Catalog measurements still show baseline **283/2,821**, candidate **7/7**
queries; no browser-performance or production-latency acceptance is inferred.

`0bd8de647ad2dae6cc7b6b392c84ca59bed5e7d9` contains those test corrections.
Per the user's branch instruction, existing master was fast-forwarded to this
history and pushed to existing origin/master; no branch was created and no
deployment occurred. Standalone performance run `41192399714` was dispatched
at **18:21:08 +08** against that exact SHA. It is a diagnostic run, not a
release receipt. No local tests, lint, typecheck, build, browser or service ran.

The latest Web artifact now contains the requested collection/focus screenshots.
Visual inspection of the 375px inbox catches a genuine narrow keyword editor.
The [scoped screenshot review](ux-audit-reading-reliability-ci-2026-10-31.md)
retains synthetic evidence before editing. Follow-up layout gives the keyword
form a full narrow-screen row; its regression checks >=160px input width,
editing/submission, URL state and no horizontal overflow at both widths.
This is pending fresh CI and final-source screenshot review.

Full workflow `41193214379` was dispatched at **18:33:09 +08** on
`0f5c78a4ed5b52f85754ab890c5112d1116fb46c`; its conservative first-read
boundary is **19:23:09 +08**, absent a user-reported failure. This workflow
includes the mobile keyword correction, not the further focus correction below.

The retained 375px focus-index screenshot also shows a genuine implementation
gap: compact mode moves index content into a mobile sheet but leaves the empty
desktop aside marked open. Its z-index 75 covers the real z-index 51 sheet.
The scoped audit now retains this second synthetic screenshot. Follow-up source
keeps both desktop asides closed in compact mode and reuses the navigation
header/close action inside the existing sheet. The browser regression adds an
actual row hit-test, hidden-desktop assertions and mobile close/focus recovery,
retaining the canonical-body identity/coordinate and hidden-read assertions.
No new panel, token, breakpoint, dependency or navigation API is introduced.
It needs a later exact-source CI and screenshots.

### Diagnostic read and final CI follow-up

First read of `41192399714` at **19:11:08 +08** respected its 50-minute
boundary. Candidate `0bd8de6` passes **9/9**; immutable baseline passes **8/9**.
The only failing mixed-398 cold run reverses **2760 -> 2640** during
`next:mounted`, followed by seven samples at 2640, with navigation null and
layout/surface compensation false. The old edge-restoration loop holds the
captured viewport offset throughout same-direction wheel input; unlike an
initial saved-position restore, new input does not retire its token. This
localizes the inherited behavior, not a frame/task-budget failure.

The same-runner gate policy now requires all unchanged candidate assertions
and budgets while preserving every baseline result as diagnostic evidence.
Neither phase nor baseline application source is skipped or rewritten. Build,
service, checkout, missing-evidence and other harness failures still fail the
job; only a completed historical baseline's assertion result is non-blocking.
This is an explicit contract change from the earlier execution record,
not a claim that its previously failing runs passed.

Screenshots further show the 375px keyboard-help panel clipped at the left
edge. The existing mobile controls now span the safe viewport width and center
the bounded-width help panel; the regression checks all four panel edges at
320/375px, plus the existing 1440px case. No font reduction or token changes.
The detailed screenshot audit retains all three before-images.

Full runs `41193214379` (`0f5c78a`) and `41193860389` (`6469890`) were
cancelled before acceptance because their source lacked these final corrections.
No result or green state is claimed for either cancelled run.

All approved scope still has source implementations. **The plan is not fully
accepted**: these CI failures, final-source visual acceptance, later
authentication/negative-PWA gates, full production package generation/download,
a coherent post-repair backup and release artifact/deployment gates remain.

### Ninth full CI — failure diagnosis and narrow test-contract repair

Full run `41196506431`, dispatched **2026-10-31 19:21:15 +08** on exact source
`b3aef7328eb8361afde52baa31cc9dca98c47598`, completed **20:03:20 +08**.
API and reading-performance comparison passed; settings recorded **358 passed /
105 failed**; Web's source-contract suite recorded **58/59**. Image build and
artifact inspection were skipped because required quality jobs failed.

Settings evidence divides the failures into **32** navigation-helper timeouts
and **73** synthetic administrator login responses of HTTP 429. The helper
assumed a collapsed rail when the accessible tree showed an already-expanded
sidebar. Failed browser-worker setup then repeatedly re-created the in-memory
admin session and encountered the unchanged application login limiter. The
repair chooses the localized `Tasks` button by accessible role first, opens
the mobile drawer with its own trigger, and uses the desktop rail opener only
when needed. The API login limit is not weakened.

Web's only failure is a stale static contract assertion expecting
`exit "$failed"`; the current workflow intentionally gates candidate
assertions while preserving the historical baseline result as diagnostic.
The contract now checks the exact `candidate_failed` assignment and exit path,
without dropping CI prerequisites or changing capacity thresholds.
These repairs await a new full CI on their committed source. No local gate was
run, and the failed run is not relabeled or treated as release acceptance.

### Tenth full CI — test navigation failures and evidence-backed correction

Full run `41204822858` on exact source
`13572d300eac9efd750b4c2619fb97abf5020d16` completed on 2026-10-31. API and
reading-performance comparison passed. Settings recorded **365 passed / 98
failed**; default PWA recorded **179 passed / one failed / one timed out / 760
conditional skips**. Release image build and artifact inspection were skipped.

Settings error contexts split into **32** `Open sidebar` visibility failures
and **66** synthetic-admin login responses of HTTP 429. The accessibility
snapshot shows the desktop sidebar already expanded with its Tasks control.
The helper had sampled `isVisible()` once during page hydration; a transient
false result sent desktop cases to wait for a collapsed-rail button that cannot
exist while expanded. Repeated worker restarts then reset the helper's
worker-local admin storage state, consistent with the later 429s. The helper
now opens the sidebar only for compact viewports, scopes that action to the
active mobile page header, and waits for the Tasks control in the visible
primary sidebar. The application limiter and authentication assertions remain
unchanged.

The two default-PWA failures are also selector-contract issues confirmed by
retained evidence. The mobile Task Center test used a page-wide test ID that
matched both an active-header trigger and a second DOM match; it now scopes to
the visible current header. At 1000px the Reader navigation sheet and hidden
desktop index rail both retain the same row title; `.last()` selected the
hidden rail row. The regression now requires the single visible row before
clicking it, preserving the folded-turn expansion and settled-navigation
assertions. No forced clicks, timeouts, product gates, or login limits changed.

These narrow test-only fixes are pending a fresh full CI on the exact committed
source. No local lint, typecheck, build, browser, or service gate was run.
No image, deployment, offline-package acceptance, or release is claimed.

### Eleventh full CI — Reader helper coverage and genuine edge-scroll defect

Full run `41210129359`, exact source
`e662412ac314aa61d88b7af62eb15aa662e579d5`, completed on 2026-10-31.
API and settings passed. Web cleanup recorded **three passes / three failures**;
all three failures occur before opening the review, at the shared test helper.
The 375px snapshot has the loaded Reader's own mobile header, not
`mobile-page-header`; both desktop snapshots have the default collapsed rail
and a real `Open sidebar` button, not an expanded sidebar's Tasks control.
The follow-up helper waits for loaded Reader content on Reader routes, scopes
mobile triggers to either actual header owner, and waits for Tasks **or** the
rail opener before deciding which desktop state is present. Existing settings
home-page coverage and cleanup mutation/range assertions remain intact.

Capacity baseline and candidate both recorded **8/9**. The plain-398 first
cold run reverses **720 -> 600** at `next:mounted` and remains at 600 for the
remaining samples. Navigation is null and layout/surface compensation flags
are false. This is the previously localized inherited edge-anchor defect now
reproduced in candidate, not a noisy frame/task-budget exceedance. Neither
failed phase is relabeled as passing.

The initial fix, committed as `d9a9781`, tried to track changing scrollTop
during layout compensation. The next exact-source full run **41218457967**
passed API, Web and settings, but baseline capacity passed **9/9** while the
candidate passed **0/9**; image/artifact jobs were skipped. Candidate traces
show large reversals during `next:trimming` in plain, math and mixed profiles.
This is a regression in the attempted fix, not a threshold or environment-only
failure. The failed run is retained as failed.

The follow-up withdraws dynamic scrollTop compensation and restores the
utility's original fixed true-DOM-anchor semantics. Each Reader previous/next
edge restoration snapshots the existing scroll-intent sequence. New wheel,
touch, keyboard or scrollbar intent retires stale compensation; trimming is
admitted only while that captured sequence remains current, including after
anchor-lease acquisition and mounted-message waiting. Superseded work keeps
the merged window rather than pulling the Reader to an old position. Existing
120-message cap, complete-turn loading, settled-window trim policy, Share
callers, exact navigation, saved positions and all capacity assertions/budgets
remain unchanged. The shared test-helper correction is covered by the passing
Web gate.

Source regressions cover both edge callbacks' restoration/trim fences; a
controlled utility regression verifies a retired anchor cannot overwrite a
later scroll. They are not browser acceptance and were not run locally. No
local tests, lint, typecheck, build, browser or service gate ran. A fresh
exact-source full CI is required; production package generation, final-source
visual review and release remain unaccepted.

## Incident correction

The earlier attachment-only orphan conclusion was incomplete: shared asset
storage also contains canonical Context/Skill references. The October 16
isolation record remains historical evidence, not proof that all reference
families were checked. Recovery must verify original metadata, SHA256 and size,
take a fresh stopped-writer five-component backup and copy without overwrite;
keep preserved originals, independent copies and prior backups intact.
