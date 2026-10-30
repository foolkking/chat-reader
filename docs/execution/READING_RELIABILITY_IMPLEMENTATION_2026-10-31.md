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

## Remaining batches

Reading-list and inbox projection/UI, focus/navigation, stable feature-write
confirmation, query aggregation, CI browser/restore/performance evidence and
operational restoration remain in progress. No production restoration, backup,
deployment, CI success or performance improvement is claimed here.

## Incident correction

The earlier attachment-only orphan conclusion was incomplete: shared asset
storage also contains canonical Context/Skill references. The October 16
isolation record remains historical evidence, not proof that all reference
families were checked. Recovery must verify original metadata, SHA256 and size,
take a fresh stopped-writer five-component backup and copy without overwrite;
keep preserved originals, independent copies and prior backups intact.
