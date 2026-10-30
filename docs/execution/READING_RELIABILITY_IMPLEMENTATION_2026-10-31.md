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

Query aggregation follows measured baseline evidence. CI browser/restore/
performance acceptance, full offline generation and any application deployment
remain outstanding. No local gate, CI success or performance improvement is
claimed here. The user's existing tsbuildinfo stays excluded.

## Incident correction

The earlier attachment-only orphan conclusion was incomplete: shared asset
storage also contains canonical Context/Skill references. The October 16
isolation record remains historical evidence, not proof that all reference
families were checked. Recovery must verify original metadata, SHA256 and size,
take a fresh stopped-writer five-component backup and copy without overwrite;
keep preserved originals, independent copies and prior backups intact.
