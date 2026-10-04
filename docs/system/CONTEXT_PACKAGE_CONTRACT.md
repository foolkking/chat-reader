# Context Package contract

Current deployed implementation, 2026-10-04; migration head `20261003_0046`.
Source `5ef984a` passed full CI and production acceptance. See the
[completion audit](../execution/CONTEXT_GOAL_COMPLETION_2026-10-04.md) for the
final approved scope and requirement evidence, and the
[deployment record](../execution/DEPLOYMENT_UX_2026-10-04.md) for live verification.
Independent external model trials remain unverified; synthetic external Skill
walkthroughs are separately recorded. Earlier candidate/adoption designs are superseded.

## Product boundaries

Skill Bundle ZIP distributes capabilities; `.context.zip` delivers conversation
context; `.cr` restores application data. Users maintain context externally with
their selected personal or system Skill. Chat Reader does not call models or
execute Bundle scripts.

Context uploads belong to each conversation's workspace beside Reader Annotations.
There is no global Context page or ordinary transcript-import entry for Context ZIP.
Returns update Current/Index only, never Raw, attachments, annotations or notebooks.
The app performs no semantic validation, candidate review or adoption. Ownership,
file syntax/resource safety, stored-byte integrity and concurrent-write checks remain.

ZIP member collision checks compare case-folded NFC names without rewriting the
stored member spelling or bytes. Canonically equivalent duplicates and a file
used as another member's directory are rejected; unique Unicode names remain valid.

## Skill delivery

The three system defaults are the pinned user-supplied `context-acquisition.zip`,
`context-continuation-maintainer.zip` and `chat-transcript-normalizer-skill.zip`.
Public ZIPs match `tools/context-skills/default-bundles/` byte for byte. Normalizer
uses the legacy rescue category for compatibility; this does not add a fourth
default or claim a new Rescue implementation.

Uploads/replacements accept ZIP or Markdown. Markdown preserves instructions and
display name inside a compatibility Bundle, downloaded with the same name and
`.zip`. Packaging does not assert Context conformance. Settings expose replacement,
download and applicable metadata/preference controls; no Skill content/file-tree/
history viewer or browser editor. Current/Index reading/editing is separate.

Custom Bundles have immutable revisions and content-addressed members. Replacement
checks `base_revision`; stale writes conflict and exact current retries are
idempotent. Downloads pin revisions. Personal preferences survive system-default
resets and use existing fallback behavior on disable/delete. Root-only writes stay
separate from personal operations; legacy text reads remain compatible.

`python tools/context-skills/build.py --output apps/web/public/skills --check`
verifies public artifacts. Editable runtime trees are experimental sources, not
the bytes shipped as defaults.

## Package and Raw export

A package contains `manifest.json`, `conversation.canjsonl`, optional `assets/`
and optional `continuation/current.md` / `continuation/index.json`.
Raw-only and single-member packages remain valid inputs.

New dedicated online exports write canonical JSONL v2: initial `manifest` record
with `format=chat-reader-canonical-jsonl`, `version=2`; messages use
`current_version.content_markdown` and `number`; attachment occurrences are
top-level `attachment_ref`; source refs, annotations and notebook use their
canonical record names; the final `end` counts records/messages.
Historical versions required by annotation anchors are included. Notebook annotation
references are limited to exported owned annotations. Reading-scope export preserves
original sequence numbers and excludes attachments unrelated to selected messages.

The outer manifest declares conversation identity, scope, availability and a
path-keyed `files` checksum map. Package version, conversation revision and source
Continuation claims are distinct. Description, project context, annotations,
notebook and source display metadata are supplementary context, outside the
existing `chat-reader-content-v1` message fingerprint.

Context always delivers ZIP independently of attachment inclusion. Metadata-only
retains attachment identity/digests and explicitly reports omitted objects and
partial asset completeness. Source refs retain allowlisted model/timestamp and
conversation header fields, not arbitrary provider metadata. Generic canonical
export uses the same projection when source refs are requested.

## Direct file APIs and lifecycle

- `PUT /api/conversations/{id}/continuation/files`: Current Markdown and/or Index
  JSON, with `base_generation`. Single-member updates inherit the other member.
  Current limit: 1 MiB; Index: 8 MiB and JSON object syntax, without semantic schema
  validation. Exact retries are idempotent; conflicting writes return 409.
- Saves atomically advance generation and offline revision. Keep the latest three
  snapshots, queue unreferenced physical objects for cleanup, and retain shared
  objects. Legacy `adopted_revision_id` names the selected snapshot internally;
  it does not represent an adoption step.
- Mutations refresh and lock the owner account before locking the conversation.
  With authentication enabled, an unavailable/inactive account is rejected even
  when the request authenticated before disable/delete. The same transaction
  fence covers final return-upload admission and worker file application.
- `POST /continuation/returns`: private expiring ZIP, base generation and
  idempotency key; processed by the existing worker. Manifest/Raw entrypoint presence
  distinguishes packages, but Raw is not compared or imported. Only the two
  standard Continuation members update storage. Missing members inherit saved files.
  Successful uploads are removed; failed uploads retain the existing retry/expiry
  lifecycle. Expiry processes at most 25 inactive uploads per iteration.
- `GET /continuation`: generation, selected revision and owned
  `pending_return_task_id`, allowing reconnection after reopening.
  Revision/member reads are owner-scoped, no-store and nosniff. Absent members
  return 404; corrupt stored members 409; foreign conversations 404.
- Legacy candidate routes return 410 after ownership checks, are absent from
  OpenAPI, and cannot be revived by task retry. Old validation jobs fail with
  `CONTEXT_VALIDATION_RETIRED`. Private historical tables/services are retained
  for fixtures and compatibility only.

## Reader workspace

Desktop uses an expandable side panel; mobile a full-screen surface. Current and
Index are primary reading destinations; Update files and History are separate.
Current uses existing Markdown rendering with collapsed frontmatter and full source
access. Index has grouped views and readable fallback values. This is presentation,
not validation.

Drop Markdown on Current, JSON on Index, or Context ZIP on either to update its
present members. Clickable upload supports keyboard/mobile. One file per drop;
wrong-tab formats do not mutate data. Unsaved edits require explicit discard before
replacement/navigation. Failed updates retain drafts and expose retry; saves use
the generation captured when editing begins. Immediate in-flight writes block
duplicates and close; background return tasks may continue after closing.

Current/Index can be edited and downloaded. Current/source Find searches literal
text across Markdown inline formatting, counts up to 500 matches and scrolls only
the workspace. Browsers with CSS Custom Highlight support display match colors.
Index search covers all chapters/segments, not just the first displayed page.
Explicit message IDs navigate through the current conversation's canonical Reader
resolver; a failed ID is never silently replaced by a sequence. Sequence-only
links say "View current message N" and are not verified historical locators.
The Reader retains the selected member and Index query across closing/reopening.
Explicit Index navigation cancels in-flight startup position restoration; dialog
keyboard events do not scroll the underlying Reader.

History fetches fresh state before displaying its three rows. A member can be
previewed and explicitly restored through the direct files PUT with the generation
captured at preview time. The counterpart remains unchanged; stale restores fail
without overwriting newer files. Restoration creates a normal saved snapshot.

Working editor drafts use the existing account-scoped Dexie settings store with
`continuation-draft:` keys. They retain text, base text, server generation and a
local version; reload offers an explicit Resume draft action. Concurrent edits to
one recovered draft fork local records on version conflict. Pending writes are
fenced by the authentication generation. Save/discard waits for local writes and
clears only the matching local version. Restoring original text clears the draft.
Storage failure keeps in-memory text and offers retry/download; it never claims
durable success. Server conflict keeps the draft and allows comparison against a
pinned latest file; explicit update still checks that comparison's generation.
Saved drafts appear in the sync center and pending signout/cleanup guard. Recovery
exports contain the actual Markdown/JSON files. They are excluded from Context,
Share and offline conversation packages. Authorization expiry locks access while
retaining the account's local drafts. New authenticated negative/cleanup gates remain
separate from auth-disabled editing tests. The authenticated suite now covers
expiry/reload, switching accounts and same-owner recovery, actual IndexedDB write
and cleanup failures, scoped recovery export and changed-draft signout rejection.
When server save succeeds but draft cleanup fails, the refreshed draft list exposes
the retained record for explicit removal; removing it does not save another server
revision. The eight-case authenticated gate also passes after the backend account
fence; full release acceptance remains separately tracked in the execution record.

## Re-export and external compatibility

Full exports include selected saved members with
`extensions.chat_reader_continuation_export.status=included_without_validation`.
Frontmatter coverage/trust/fingerprint fields remain source declarations. The app
does not compare semantic prefixes, rewrite claims or enlarge coverage. Raw-only
choice omits members without changing storage. Partial exports omit Continuation;
corrupt optional objects fall back to Raw-only without publishing half the saved
set. Publication rechecks source revision, supplementary dependency digest and
saved-file generation, rejecting concurrent source changes.

The fixed experimental runtime reads canonical v2 and legacy CanJSON 2.1,
normalizes legacy scope/array files, rejects conflicting declarations, and applies
bounded ZIP/JSON parsing. The actual pinned Skill readers accept canonical v2 but
do not contain the legacy 2.1 adapter. Tests execute only reviewed, checksum-pinned
reader modules in the test process against actual exported bodies, versions,
attachment bytes/locators and fingerprints. App uploads never execute them.

The reviewed Maintainer supports OLD Continuation + NEW Raw materialization via
`--previous-package`. A complete member-inventory digest binds each input separately
from message fingerprints. It creates a NEW-Raw/OLD-Pair overlay, computes fresh
checks, pins external semantic inputs and requires explicit supplementary-context
review. Historical repair cannot inherit ranges at or after the chosen repair
boundary. Later unchanged wording is not evidence of semantic independence.
Both source inventories are rechecked; output preserves NEW Raw, assets and other
retained members. Same-volume exclusive publication refuses existing/concurrent
output files. Assets stream through bounded copies rather than whole-file reads.

Explicit stale Evidence locators require repair even if newly computed content and
locator fingerprints match Raw. Source fingerprint profiles/values are unchanged;
global attachment occurrence indexing and Fragment/Index sequence lookup avoid
repeated full rescans. The shared reader is 1.0.1; the reviewed writer is 1.1.0.

These reviewed sources are not shipped in the exact pinned defaults. Separate
`.review.zip` builds leave those defaults intact. See the actual
[Skill inventory and standalone migration guidance](CONTEXT_SKILL_MIGRATION.md)
and the linked dual-package workflow. App tests cover a real worker export →
external writer → return → append → new export → dual writer → return → re-export
cycle. They prove byte/storage behavior, not arbitrary external semantic judgment.
Separate review Bundles are generated for delivery. A documented
[synthetic semantic walkthrough](../evidence/CONTEXT_SEMANTIC_WALKTHROUGH_2026-10-03.md)
reviews proposal/adoption, revision-specific verification, corrections, scope,
unknowns and full-tail reconciliation. Independent external model trials remain
unverified; this walkthrough does not assert arbitrary model correctness.

## Offline, archives and deletion

Offline package v3 optionally embeds selected Continuation on the conversation and
allowlisted `source_refs` on each message. Existing Dexie v2 records retain these
optional fields without a schema/store change. Legacy v1/v2/v3 absence is valid.
Offline canonical/Context exports preserve cached source metadata. Cached
Current/Index are readable; updates require online access. Account isolation and
lease locks protect these bytes. See [Offline contract](PWA_OFFLINE_RESILIENCE_CONTRACT.md).

V3 also carries optional `annotation_versions` on messages, limited to live anchors
owned by the requesting subject and fetched per message batch. Canonical export
includes only versions needed by exported annotations. If an older package lacks
an anchor body, its quote/comment remain; `version_id` is null, the original ID is
retained as `unavailable_anchor_version_id`, and the UI reports missing history.
It is never rebound to the current body. Notebook references to excluded annotations
are omitted. Message bodies remain current-version-only for Reader/fingerprints.

Optional `project_context` preserves project name/description; description changes
advance affected conversations' offline revisions. It follows the offline description
export option. Raw manifest extension `chat_reader_offline_snapshot` declares
project-context availability and the missing annotation-anchor count. Supplementary
context remains outside message fingerprints. Asset metadata retains digests even
when bytes are omitted; available files have independently checked hashes.

Real browser coverage includes Normalizer source metadata through actual worker
download, app ingestion, disconnected reload and export; the fixed app reader
compares content/locator fingerprints while the canonical parser checks the full
reference graph. The legacy probe removes optional fields from a real package to
exercise old v3 compatibility. It does not replace all v1/v2, permission or quota gates.

Personal/system `.cr` preserve Bundle versions/members and Context bindings through
their archive extensions, excluding temporary returned ZIPs. Restore remaps relations
and resets validation claims. Conversation/account deletion retains shared objects
and queues cleanup. See [Data archive contract](DATA_ARCHIVE_CONTRACT.md).
Share excludes private Context files and personal Skill objects.

Full release checks, remaining
PostgreSQL concurrency and UI capabilities, external semantic use, settings cleanup
and the subsequent full-site UX audit remain outstanding. Passes and skips are
recorded separately in the execution record.
