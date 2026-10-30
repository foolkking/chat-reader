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

### Eighth CI — passed recovery, remaining launcher and external capacity block

GitHub creation time is **05:10:00 +08**; first status read **06:00:46 +08**
respected the full 50-minute boundary. Exact source remains `1b74ba9`.
Full API succeeded; settings passed **463 plus independent restore one**,
including the new transient-catalog first-copy cases. Web lint/typecheck/build,
**1,899 UX**, preceding browser gates and **110 mutation** cases passed.

Cleanup then had four passes / two failures, both in
`openSettingsNoiseReview`. Their snapshots show an intact Reader and visible
Open sidebar rail; the helper still awaited a Task summary inside the hidden
desktop sidebar. Source now waits for a real visible entry or opener, explicitly
opens that sidebar if necessary and uses the original Task summary/review flow.
No cleanup selection, refined-range, rule, confirmation or source-preservation
assertion is removed. This correction is not executed locally or reverified.

Performance job `124325380653` has **zero steps** and no log/measurement
artifact. Its authoritative check annotation states that the job was not
started because recent account payments failed or the spending limit needs
increasing. This is an external Actions billing/capacity block, not a v2
measurement result. The earlier v1 failures remain failures. No paid setting,
spending limit, runner substitution, gate bypass or local test is attempted.

Next required work, after the user restores GitHub Actions capacity:

1. Dispatch the corrected exact source in the full workflow, observe a
   fresh 50-minute first-read boundary and retain all four prerequisites.
2. Complete default-PWA/negative/auth and v2 baseline/candidate gates; inspect
   the target 375/1440px collection/focus screenshots rather than unrelated UI.
3. Record actual pass/failure and measurement deltas without cross-protocol
   speedup claims. App deployment, full production 47-conversation download
   and a new coherent post-repair backup remain unclaimed.

At **06:09:54 +08**, read-only reinspection still finds run `41128941676`
as the latest full workflow on this branch; its terminal capacity check still
has zero steps and the billing/spending-limit annotation. There is no live
process/job to wait on, and no new dispatch is attempted. Static review of the
unreached browser gates found one additional old-default fixture assumption:
the workspace soft-navigation test interacts with expanded project links
after entering a Reader without setting an expanded preference. It now sets
that real preference before navigation. Same Sidebar identity and exactly one
document request remain required; default-collapsed/focus coverage is separate.
This is source progress, not an executed or passing browser receipt.

## Incident correction

The earlier attachment-only orphan conclusion was incomplete: shared asset
storage also contains canonical Context/Skill references. The October 16
isolation record remains historical evidence, not proof that all reference
families were checked. Recovery must verify original metadata, SHA256 and size,
take a fresh stopped-writer five-component backup and copy without overwrite;
keep preserved originals, independent copies and prior backups intact.
