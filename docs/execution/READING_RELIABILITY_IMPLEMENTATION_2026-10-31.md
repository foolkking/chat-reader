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

## Incident correction

The earlier attachment-only orphan conclusion was incomplete: shared asset
storage also contains canonical Context/Skill references. The October 16
isolation record remains historical evidence, not proof that all reference
families were checked. Recovery must verify original metadata, SHA256 and size,
take a fresh stopped-writer five-component backup and copy without overwrite;
keep preserved originals, independent copies and prior backups intact.
