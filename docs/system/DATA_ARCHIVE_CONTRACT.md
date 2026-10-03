# Data archive contract

Current working tree: 2026-10-02. Stage-six functions are locally implemented;
final integrated release acceptance remains. Not deployed.

## Container and scope

`.cr` uses a format discriminator in `manifest.json`; its version is unrelated
to the offline `.crpkg` version. Offline package v1/v2/v3 and Dexie v2 are
unchanged. Legacy conversation `.cr` reading is unchanged.

System exports now use `chat-reader-system-archive`, version **5**. They retain
the existing canonical tables and add a whitelist of account identity fields.
Empty projects, historical message versions, deleted/detached attachment
identities, and their physical objects are retained. Tombstoned annotations are
included so conflict references remain valid. Derived blocks/search/headings
are rebuilt during restore, rather than treated as source truth.

System v4 remains readable. For authenticated restores its missing identities
require an explicit source-account-to-target-account mapping. The optional
`owner_mapping` multipart field is a JSON object whose values are target UUIDs;
`unowned` identifies pre-account rows. Unknown targets/sources are rejected.
Auth-disabled development retains its legacy identity compatibility only.

Version 5 maps the archived administrator to the authenticated target Root
Admin without changing the target credentials or account settings. Ordinary
accounts get new UUIDs and fresh unknown passwords; the existing one-use
password-reset flow is required. Approval, enabled/disabled status and email
verification requirements remain effective. Conflicting emails require an
explicit mapping, never automatic account takeover. Project/conversation
owners and Reader subject keys are remapped together. If explicitly merged
owners cause duplicate project names/defaults, the projects remain distinct
with a restored-name suffix and only the first default flag.

No archive identity contains password hashes, deployment digests, sessions,
verification/reset grants or usable sharing credentials. This application data
archive is not the server disaster-recovery backup.

New v5 exports declare `configuration_version: 1` and include all format/rule
identities, immutable revisions, grants, publications (including withdrawals),
aliases, preferences and personal exceptions; account preferences and existing
personal/system Skill content/selections; and feature/access policies. Missing
policy rows are serialized as their effective non-secret defaults from the
same read-only snapshot. V5 archives without this extension remain readable;
they restore only their originally declared data. Unknown extension versions
and undeclared files are rejected.

Configuration preflight validates field types, checksums, references, source
accounts, alias cycles, selected-version relationships, Skill ownership and
category, unique system defaults and policy limits. Restore remaps all account
references while retaining configuration identities/revisions. Public and
withdrawn states remain distinct. Existing target personal/learned configuration
or customized system Skills prevents empty-instance restoration; only bootstrap
rules/Skills/policies may be replaced. Two source accounts cannot silently merge
their settings/grants. Target preference field revisions advance through the
existing preference service rather than being replaced with source counters.
Restoring a policy that requires email verification needs target SMTP configured
first; credentials/environment values never come from the archive. Configuration,
identity, canonical rows and new files commit or roll back together.

## Integrity and transaction boundaries

Export queries use SQL subqueries and batches of 250, avoiding an unbounded
list of message/version IDs in PostgreSQL bind parameters. PostgreSQL export
reads use a separate read-only repeatable-read snapshot while the worker
retains its existing progress/commit session. Concurrent changes therefore
cannot splice two snapshots into one archive. Attachment bytes are streamed
and checked against both stored size and SHA-256 before publication.
Both exporters run the complete corresponding archive preflight before publishing.

Exports enforce the same configured upload, expanded-size, JSONL/manifest,
member-count, object-count and per-object limits as restore. Highly repetitive
entries are streamed into a second staging ZIP with those entries stored
uncompressed; their canonical bytes and checksums do not change. If the result
exceeds the upload limit, the job fails before publication with a capacity
error. Cancellation or failure removes both staging files. Administrators must
review `BUNDLE_MAX_*` and `CANJSON_MAX_LINE_BYTES` consistently with upload/proxy
limits before retrying; no attachment is silently omitted to satisfy a limit.

Restore rejects duplicate/unsafe member paths, links/encrypted entries,
oversized expansion/lines, invalid/duplicate-key JSON, missing tables,
incorrect record counts, checksums and object sizes. All declared canonical
entries and included assets are validated before writes. JSONL restore reads
are repeatable bounded iterators and flush in batches without intermediate
commits. Existing empty-instance constraints remain in force.

Archive-created physical objects are tied to the SQLAlchemy transaction.
Rollback, commit failure and session close remove those objects; nested
rollback cleans only its own objects, while nested commit transfers ownership
to the parent transaction. Existing objects are not registered for deletion.
Interrupted asset staging and export cancellation clean their `.part` files.
Final export artifacts retain the existing worker publication/retention
contract and 24-hour download lifetime.

## Personal backup and additive restore

The `create_personal_archive` service writes
`chat-reader-personal-archive`, version **1**, with `restore_mode=additive`.
Its queries include only the requested active account's projects,
conversations/history/assets, Reader state, preferences, held format/rule
revisions and aliases, personal exceptions/preferences, Skills and selections.
System publication is not exported; unheld newer revisions and the original
author's private identity/name/verification samples are excluded. Include-
archived filtering applies to the owned canonical graph. Shared declarations
remain references to their version identities rather than duplicate libraries.

Personal settings expose separate backup and restore actions. Root's personal
panel has the same owner boundary; instance-wide backups remain in admin
settings. Missing attachment files remain explicit in export, preview and
restore, including a second export after restore; an absent AssetObject cannot
produce a false complete archive.

`/api/me/archive/exports` creates a normal single-worker export job. Uploading
to `/api/me/archive/previews` streams to managed export storage and creates a
preflight job; the API thread does not parse the ZIP. Uploads have server-chosen
names, no download endpoint, and an ExportArtifact reference protecting the
source from manual orphan cleanup. Uploads expire for new restore admission
after 24 hours; an already-confirmed restore retains its source until it ends.
Explicit source removal is serialized against confirmation and running restore,
deletes no canonical data, and releases the artifact reference. A failed unlink
leaves a managed orphan for the existing manual cleanup process.

Preflight validates the entire graph, supported fields/configuration, table
checksums/counts, internal references, alias cycles and included attachment
bytes. It returns counts and up to 50 project/conversation titles; this limit
affects only the preview list. The digest uses canonical declarations rather
than ZIP order, timestamp or compression. Confirmation sends the preview task
ID, digest and separate `include_preferences` boolean, default false. Execution
validates the upload bytes and archive again before writing.

Migration `20261001_0041` adds `archive_restore_receipts`, keyed by account UUID
and content digest independently of task retention. PostgreSQL locks serialize
duplicate confirmations/restores. Imported data, configuration, optional
preference updates, file ownership and the receipt commit with final job status
in one transaction. Cancellation winning the final publish comparison rolls
back the import. Repeating an already-restored archive returns its prior result
and does not reapply preferences.

Restore creates distinct projects/conversations and remaps messages, versions,
attachments/URIs, notebook annotation references, reading anchors and conflict
links. Name collisions get a restored suffix. Search and TOC data are rebuilt.
Held formats/rules reuse equivalent configuration after recomputing its digest,
including legacy revisions whose stored digest is absent. New formats are
personally usable, but archived verification claims do not authorize system
promotion. Skills retain their existing content/selection model; paused
stage-five version editing is not implemented. Missing attachment bytes cannot
establish possession of another user's object.

Settings and Task Center reopen the same durable task. Failed upload retries
reuse the request key and preserve input. Task failures use the existing retry
endpoint. Offline mode explains the connection requirement and existing Library
snapshot capability. No reminders or automatic backup scheduling are added.

## System archive tasks and ownership review

Root settings separate system backup and restore. `/api/system/archive/*`
provides capabilities, paginated task history, streamed upload/preflight,
paginated source accounts, searchable targets, version-checked choices,
explicit restore confirmation and source removal. Previous synchronous
`/restore` and admin backup routes remain compatible. Normal accounts cannot
access system previews, ownership choices or tasks.

Migration `20261002_0042` adds `archive_restore_accounts`, keyed by preview and
source identity, with role, decision, target and optional source labels. Drafts
persist across refresh and paging. Their revision covers every choice, including
unloaded pages. Stale edits/confirmations return 409. Root maps to the current
Root; new ordinary identities need password reset; conflicting emails and v4
owners require explicit selection. Active restore locks choices. Failure allows
amendment; retrying the old task rejects changed choices.

The worker verifies upload bytes and the full archive before writing. Global
PostgreSQL restore locking, model-defined table locks and a second empty-instance
check prevent competing restores/business writes bypassing admission. Existing
account preference locks precede table locks to avoid lock inversion with normal
preference saves. Rows, configuration, files, receipt and final task status commit
together. A re-uploaded restored archive returns the prior result even though the
instance is now occupied.

Uploads expire for new confirmation after 24 hours; accepted restores can finish
later. Cancellation, removal and ownership updates share review locking. Task
history reports current artifact availability/expiry and parent tasks even on
queued/failed results. Export keys serialize concurrent requests; different
options with the same key return 409. SystemBackupRecord follows task state;
privileged terminal results are audited without source text or filenames.

The admin panel shows validated counts, an expandable content list, source to
target ownership rows and a final confirmation. Selection saves only a draft.
Cross-page review, search, stale-choice recovery, upload cancellation/lost-response
retry, Task Center re-entry, retry, download expiry and regeneration are supported.
Personal restore retains its additive behavior. The remaining full release matrix
and GitHub CI are separate from these local checks. Not deployed;
prior stage-four GitHub CI does not cover this working tree.

## Verification ownership

- `test_system_archive_integrity.py`: tampering, path/JSON limits, historical
  attachments, cancellation and transaction/file rollback.
- `test_archive_export_limits.py`: repetitive-content round trips, export/restore
  capacity parity, failed publication and cancellation during repacking.
- `test_system_archive_accounts.py`: explicit legacy mappings.
- `test_system_archive_configuration.py`: configuration round trip, historical v5
  compatibility, corrupt settings/references, occupied targets and SMTP admission.
- `test_system_archive_api.py`: queued v5 export and attachment round trip.
- `test_personal_archive.py`: owned scope, held versions, configuration privacy,
  archive filter and unavailable-account rejection.
- `test_system_archive_postgres.py`: new-instance identity/FK/password-reset
  recovery, full configuration restore/rollback/commit failure and bounded personal
  export with an edit during serialization.
- `test_personal_restore.py` / `test_personal_restore_postgres.py`: additive
  references, configuration reuse, preference opt-in, repeated archives, missing
  attachments, rollback, migration and concurrent PostgreSQL restores.
- `test_personal_archive_jobs.py` / `test_personal_archive_jobs_postgres.py`:
  upload, preview, confirmation, expiry, source removal, cancellation and errors.
- `test_personal_archive_auth.py`: real session-based owner/user/Root isolation.
- `settings-personal-backup.spec.ts`: three-size browser round trips, repeat
  submission, lost response, corrupt archive and Task Center re-entry.

Run PostgreSQL cases with `SETTINGS_POSTGRES_INTEGRATION=1` and an explicitly
disposable database URL. Dated counts and outstanding gates belong to
`docs/execution/SETTINGS_COMPLETION_2026-09-30.md`.

- `test_system_archive_tasks.py` / `test_system_archive_tasks_postgres.py`: auth,
  saved mappings, expiry, cancellation/audit, concurrent admission, preference
  lock order and migration.
- `settings-system-backup.spec.ts`: three-size review, reload, offline, stale
  mapping, lost response and Task Center.
- `system-archive-new-instance.spec.ts`: opt-in fresh PostgreSQL restore,
  identities/configuration, repeat receipt, real download and expiry UI.
  `tests/build_system_archive_browser_fixture.py` creates synthetic input.


## Skill Bundle archive extension (local Context migration, not deployed)

### Context file extension (2026-10-02, local)

Personal v1 and system v5 archives also declare `context_files_version: 1` and
include `context_member_objects`, `context_bindings`, `continuation_revisions`
and `continuation_states`. Member bytes live at `context/objects/<prefix>/<sha256>`;
private storage keys are excluded. Queries follow the exported conversation scope.
Candidates, validation/export receipts and uploaded ZIPs are not archived. Older
archives without this extension retain their prior table set.

Preflight checks sizes/digests/file syntax and reference ownership, not semantic
correctness. Additive restoration remaps local conversation/version/binding IDs,
retaining external identity and mapping data as source information. Current/Index
bytes remain unchanged; historical references inside them are not silently
rewritten. Restored revisions use direct-files mode without former verification.
System restoration preserves canonical IDs. Both use rollback-aware member storage,
archive transactions and heartbeats. Parent relationships restore in a streamed pass.

Tests cover retained snapshots, Pair bytes, source binding, account scope,
idempotency, corruption, legacy omission, fresh system restore and rollback.
Migrated PostgreSQL tests pass personal and system restore/rollback; concurrent
export/cleanup and UI inclusion-list acceptance remain pending.

New personal v1 and system v5 archives declare `skill_bundle_version: 1`.
They add `skill_bundle_revisions`, `skill_bundle_members` and `skill_file_objects`
JSONL tables. Private file members are stored once at `skills/objects/<prefix>/<sha>`;
storage keys are omitted. They do not increase attachment statistics. Personal
queries include only the account's Skills and their revisions. System queries
include personal/system history and only referenced member objects.

Preflight checks paths, bytes, checksums, Bundle structure, source kind, owner,
revision uniqueness, current text projection and complete-Bundle identity. Files
are bounded by existing Bundle limits; uploaded scripts remain opaque. Missing
history with nonzero current pointers is rejected. Older archives without this
extension remain readable; unknown extension versions and undeclared files fail.

Additive restoration deduplicates complete Bundles separately from legacy text.
Equal instructions with different scripts remain distinct. Existing personal
current revisions and preferences remain selected while missing archived history
is merged; conflicting local revision numbers are remapped. Fresh system restore
rebuilds personal/system history after account mapping. Member writes share the
archive transaction's nested-rollback/commit/close lifecycle, and existing shared
objects must pass integrity checks before reuse.

Synthetic SQLite round trips and interrupted restoration are implemented in
`test_skill_bundle_archives.py`. Corresponding migrated PostgreSQL cases are in
`test_skill_bundle_archives_postgres.py` and require the existing disposable
integration database flag; unexecuted PostgreSQL cases are not a passing claim.
