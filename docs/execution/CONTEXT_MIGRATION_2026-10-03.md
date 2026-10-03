# Context migration checkpoint — 2026-10-03

## Final negative matrix, semantic review and ZIP member safety

- `context-release-pwa-negative`: **14 passed / 3 failed**, including two timeouts.
  The file-opening helper omitted the actual Chinese Message actions label; the
  persistent-browser test hard-coded an absent bundled Chromium instead of the
  configured installed Chrome. Corrected helpers preserve all original fault
  assertions. `context-release-pwa-negative-final`: **17 passed / 0 skipped,
  50.4s**. This covers missing/corrupt assets, cache and IndexedDB quota/failure,
  v1/v2 compatibility, bounded writes, cold browser/worker restart and recovery.
  The production-mode fault-seam build succeeded. It is not a deployable artifact.
- Added an authored 14-message semantic walkthrough. Materialized Current/Index
  and both extracted tail bodies were actually inspected; the detailed distinction
  between structural testing and semantic review is in
  [the review](../evidence/CONTEXT_SEMANTIC_WALKTHROUGH_2026-10-03.md). Initial harness
  failures omitted a required validation report and inspected the receipt instead
  of extracted files. Corrected preservation test passed; no runtime relaxation.
  The exact supplied Normalizer was then run externally on a reviewed three-message
  synthetic JSON source: inspector/serializer/validator passed and the application
  parser preserved adjacent user turns, a fenced Response delimiter, all bodies and
  the historical Exported value. This scoped probe is recorded in the same review;
  it does not claim tool-span/ambiguous-branch or independent model acceptance.
- Final file-boundary review found six real ambiguities accepted by the code:
  canonically equivalent Unicode paths and Skill file/directory collisions.
  Baseline: **6 failed / 22 passed / 1 Windows symlink skip**. ZIP checks now compare
  case-folded NFC keys while preserving original accepted names/bytes. Shared
  sources remain byte-identical across app and reviewed Skills. Final path/runtime
  suite: **69 passed / 1 symlink skip, 6.85s**. API replacement test proves rejection
  preserves the original revision and downloaded bytes; Skill/return/default
  compatibility gate: **36 passed, 58.78s**.
- A serial API rerun was deliberately interrupted around 25% before changing this
  source, and is not accepted as a complete run. Final lint and typecheck passed.
  Full API after the fix: **867 passed / 4 skipped / 0 failures, 1551.12s** with
  both PostgreSQL flags and forward-slash Windows paths. JUnit at the authorized
  test root's `api-path-final.xml` reports 871 cases, zero errors/failures.
  The skips remain Windows symlink permission and absent optional exporter/import
  fixtures. Prior completed full-run allocation error remains documented below.
- Generated `next-env.d.ts` references were restored from the negative-build output
  directory to standard `.next/types`. Unrelated tsconfig build info was preserved.
  The Context CI evidence summary now lists `context-files` explicitly.
  `verify_migration_state.py --require-current` reports sole head/current 0046;
  scoped diff hygiene, workflow YAML and current-state/review links pass.

Reviewed delivery files are under the authorized local test root
`.tmp/context-tests/context-review-delivery-20261003/`. They are separately named,
not installed defaults. Rebuild using `build.py --review --output <directory>`;
the three pinned/default ZIPs still pass the exact byte check.

| Review file | SHA-256 |
| --- | --- |
| `context-acquisition.review.zip` | `21eb4636b476e90cfc0b37173416cc80ec930e420835f54491ee46a9902a7c34` |
| `context-continuation-maintainer.review.zip` | `dc7358949963f0834f5b9ac1e1134cc52f7b948df74b0b70fc616e43730c3e39` |
| `synthetic-walkthrough.context.zip` | `67f5a4b66422da99f6c73fc778567b3104ad0917c36e70ee252c3ac5d0172603` |

Final authenticated gates against the restarted current-source API/worker passed:
`context-final-authenticated` **14 passed / 0 skipped, 69.596s** (Root Bundles,
durable drafts, offline lock and pending signout), and `context-final-auth-share`
**4 passed / 0 skipped, 27.762s** (authentication, Share and session revocation).
Evidence is in each gate's `apps/web/test-results/<gate>/gate-evidence.json`.
The synthetic Root password was rotated by the final revocation test; restart
the isolated fixture before further authenticated tests. These overlap earlier
gates and must not be summed as unique scenarios.

No commit, push or deployment. Independent external model trials, release/CI
verification and the user's subsequent settings/site work are not claimed complete.
Local Context acceptance is complete within the stated coverage; proceed to the
authorized settings cleanup before release. Existing C: cleanup rejections were
not retried.

## E: recovery, transaction cancellation and CI coverage

The user explicitly allowed this run's test temporary files under
`E:\1project\chat-reader\.tmp\context-tests` after C: reached zero free bytes.
Only process-local TEMP/TMP and isolated fixture storage changed. No old C: files
were moved/deleted and no global environment variable changed. This supersedes
the storage pause below for this run, not the default rule for future tasks.

- Resumed direct/return/retirement/PostgreSQL suite: **30 passed, 68.55s**.
- New isolated authenticated fixture migrated from empty to sole head 0046.
  `context-auth-drafts-account-fence`: **8 passed, 0 skipped, 52.448s**, after the
  current backend fence. The earlier eight-case result overlaps these scenarios.
- Added real PostgreSQL return publication cancellation/failure cases. The fault
  happens after actual member writes; cancellation commits through a second DB
  session. Assertions inspect restored generation/offline revision, selected Pair,
  object rows/physical files, retained upload bytes and successful explicit retry.
  Combined return, shared Context/Skill cleanup and personal/system archive/default
  migration suite: **13 passed, 75.37s**.
- First full `corepack pnpm run test:api`: **855 passed, 3 failed, 5 skipped,
  1595.51s**. One obsolete admin test used retired JSON content writes; it now uses
  multipart replacement/creation and checks actual ZIP bytes and restored resolver
  state. One registration test inherited OPEN from the browser environment; CLOSED
  is now its explicit precondition. One personal archive test used only the old
  table registry; it now invokes the real restore preflight, including declared
  Context members, while preserving cross-owner exclusion assertions. Corrected
  cases plus personal archive and enabled PostgreSQL export check: **7 passed,
  13.52s**. Corrected full API rerun enabled both PostgreSQL flags: **858 passed,
  4 skipped, 1 setup error, 1788.05s**. Argon2 failed to allocate memory while
  provisioning the owner for the ordinary-user system-archive permission case.
  No test assertion failed. The entire affected file then passed separately:
  **6 passed, 21.02s**; production hash parameters were not changed. The full run
  remains failed. Four skips: Windows symlink permission, two absent optional
  external exporter fixture cases and one absent import-pair fixture.
  JUnit now resides at the authorized E: test root (`api-final-junit.xml`);
  its originally malformed Windows option path was moved there without overwriting.
- CI now opts personal Bundle tests into `context-files` and Root Bundle tests
  into the authenticated settings step. `context-admin-ci-inclusion`: **6 passed,
  0 skipped, 16.043s** at 375/768/1440 and Chinese/English. Inspection then found
  the old fixture DELETE returned 405; it had not removed the synthetic accounts.
  The new helper uses confirmed POST deletion, waits for committed task state and
  checks account GET becomes 404. Final Root/draft run
  `context-auth-lifecycle-cleanup`: **9 passed, 0 skipped, 41.495s**. These overlap
  prior cases; earlier passes do not prove cleanup. GitHub execution is pending.
- Exact pinned/default Bundle check, lint/typecheck and sole head 0046 pass.
  `corepack pnpm --filter web test:pwa` completed its production-mode build,
  then ran the 381-case baseline below. This is an auth-disabled local synthetic
  fixture build, not a deployable release artifact.

Full PWA baseline `context-release-pwa-baseline`: **174 passed, 7 failed (including
2 timeouts), 197 skipped and 3 did not run**, 667.750s. The evidence reporter
combines skipped/not-run as 200; neither category is accepted. Three login cases
were incorrectly enabled by leftover E2E credentials despite AUTH_ENABLED=false;
the baseline env now clears them, while real auth gates run separately. Two parity
cases expected inline import HTTP 200; they now accept queued 202 and wait for the
actual worker's committed status and conversation ID before proceeding. The Reader
performance source contract now normalizes CRLF before its unchanged assertions.
The remaining legacy-worker upgrade failure did not reproduce in the focused
follow-up; no speculative application fix was made.

`context-pwa-failure-followup`: **6 passed, 0 skipped, 51.048s**, covering actual
async import parity, Owner/Share Markdown copy, legacy worker upgrade and the
performance contract. Corrected complete `context-release-pwa-final`: **180 passed,
201 skipped, 0 failed, 404.782s**. Includes the legacy-worker upgrade. This local
auth-disabled baseline does not satisfy its disabled opt-in/authenticated cases.
Final lint/typecheck passed for the last test edits. No application source changed
during these corrections. Negative/authenticated matrices remain separate gates.
The CI evidence summary now explicitly requires `context-files`; running its step
without collecting its report is no longer sufficient for the release summary.

Documentation scan corrected active Skill/Context export explanations in product,
user flows, frontend/backend reference, API, offline and testing documents. Legacy
Markdown URLs remain available but no longer describe current Skill delivery.
No production changes. Full API/PWA/release and external semantic-use acceptance
remain open; settings cleanup and later site UX work keep their existing sequence.

## Authenticated draft recovery and account-write fence

Added `settings-context-drafts.spec.ts` to the existing authenticated settings
selection. It exercises real PostgreSQL/API/worker state and actual IndexedDB:

- Expired cached Current/Index and drafts remain locked across reload; another
  account cannot read/write the owner's server files or take over its drafts.
  Signing in as the original owner permits explicit draft recovery/save.
- At 375px, a one-shot IndexedDB put failure preserves the previous durable draft
  and newest downloadable text; retry saves it. A delete failure after server
  success preserves the draft without duplicating the saved revision.
- Removing one offline copy exports/removes only its draft. Signout notices a
  real second-tab edit after recovery export, requires fresh export, retains data
  on failed logout and clears only the account's local data after success.

The cleanup-failure probe found a real UI defect: the error referred to a draft
list that had not refreshed, leaving no Delete draft action. The list now refreshes
after either cleanup outcome, and explicit deletion clears the stale error.

Verified local evidence:

- Baseline `context-auth-draft-delete-failure`: 1 failed, missing Delete draft.
- Post-fix `context-auth-drafts-recovery/gate-evidence.json`: **8 passed, 0 skipped,
  50.275s**. Includes the new three cases, one offline-lock and four pending-signout
  cases. Lint/typecheck/Web build passed for this frontend source.
- Two earlier three-case runs failed fixture CSRF setup; configured run had
  2 passes / 1 helper hydration failure. The helper now waits for Settings/sidebar
  before choosing the responsive branch. Subsequent 1-case and 3-case passes
  overlap; they are not additional acceptance. Trace is disabled, synthetic data
  only. Quota/cleanup errors are targeted IndexedDB fault injection.

A separate backend review found that an already-authenticated request could still
write Context files after an administrator committed account disable. Direct save,
final return admission and return application now use the existing subject-account
transaction fence before the conversation lock. It refreshes cached ORM state and
rejects inactive/deleted owners; authentication-disabled development remains valid.

PostgreSQL evidence and limits:

- Before fix: direct case failed because the expected 401 was not raised.
- Initial post-fix run: 3 passed / 1 failed due to the new return fixture omitting
  the required Raw entrypoint. Added minimal canonical Raw to that synthetic ZIP;
  application return still does not interpret/import Raw.
- Mixed regression with browser auth configuration: 6 passed / 24 failed because
  old auth-disabled API fixtures inherited `AUTH_ENABLED=true`.
- Corrected mixed run: **16 passed / 14 setup errors due to C: exhaustion**. The
  first four PostgreSQL cases (concurrent same update plus direct/return-admission/
  return-application after disable) passed. Overall gate is incomplete.
- The eight-pass browser gate predates this backend fix. Its API/worker were
  restarted with current code, but a browser rerun is still required.

Resume the focused API suite with the isolated PostgreSQL fixture configured,
`AUTH_ENABLED=false` and `SETTINGS_POSTGRES_INTEGRATION=1`:

```powershell
python -m pytest tests/test_continuation_candidates_postgres.py tests/test_continuation_files.py tests/test_continuation_candidates.py tests/test_context_return.py -q --tb=short --show-capture=no --basetemp "$taskTempRoot\pytest-context-fence-resume" -p no:cacheprovider
```

Run from `apps/api`; use a new task subdirectory only after storage is available.
The browser fixture instead requires `AUTH_ENABLED=true` and matching same-origin
PUBLIC_WEB_BASE_URL/CORS_ORIGINS; use installed Chrome if pinned Chromium is absent.

Storage rechecked this continuation: **C: free bytes = 0**. Automatic approval
rejected deleting `pytest-context-fence-regression`, `pytest-context-fence-final`,
`pytest-account-fence-after` and `pytest-account-fence-before` under the task's
`wkkk/chat-reader-auth-drafts-20261003` directory, with `blocked by policy` and no
further reason. Nothing was deleted; do not retry those or earlier rejected targets
through another mechanism. No new disk-writing tests until space is available or
the user changes the temporary-directory constraint. This does not prevent source
review and documentation on E:. Full release, lifecycle and external semantic-use
acceptance remain open. No commit, push or production deployment.

## Reviewed dual-source writer, real app loop and Skill ecosystem

The preceding implementation slice added external
`materialize_continuation.py NEW --previous-package OLD`: OLD supplies saved
Continuation/base identities, NEW supplies all Raw/assets. The writer validates a
private overlay, binds complete input inventories, pins external Candidate/Trace/
Fragment files and requires explicit supplementary-context review. Historical
repair forbids inheritance from the affected boundary onward. It rechecks both
inputs and refuses any existing/concurrently created output. Raw/assets stream
from NEW unchanged. Single-source publication also uses exclusive hard links.

An expanded negative test found a genuine validator defect: stale Current Evidence
IDs passed when recomputed Raw fingerprints matched. All three shared runtime
copies now treat explicit locator mismatch independently, reject unresolved ID-only
evidence and preserve invalid missing locators. Reader version 1.0.1; reviewed
writer 1.1.0. Attachment occurrence indexing and Fragment/Index sequence lookup
remove repeated global rescans without changing fingerprint profiles/values.

External reviewed runtime evidence:

- Initial expanded suite: 22 passed, 1 failed (stale Evidence bug).
- After the fix: 57 passed, 1 Windows symlink case skipped; final expanded
  distribution/fragment coverage: 60 passed, 1 skipped, 6.13s.
- Current rerun after reference/inventory updates: **60 passed, 1 skipped**, 6.28s,
  `python -m pytest tools/context-skills/tests -q`. The skipped symlink creation
  test still requires Linux CI; it is not counted as passing.
- Prior focused API run: 22 passed, then broader **32 passed**, 65.95s, covering
  `test_context_external_roundtrip.py`, default Skill interop, package runtime,
  continuation validation, export and return. The first app-loop attempt failed
  because its fixture submitted unsupported `include_saved`; corrected to actual
  `auto`. The final loop runs actual worker functions and external subprocesses:
  A export → maintain → return → append → B Raw export → OLD+B maintain → return →
  C export. It checks saved member bytes, unchanged Raw/assets, no duplicate
  versions/attachments/objects, no application candidates/validation rows and two
  saved snapshots. It does not prove an arbitrary model's semantic decisions.
- Separate `build.py --review --output <task-directory>/review-bundles` delivers
  Acquisition/Maintainer review ZIPs. Exact supplied public/default ZIPs remain
  unchanged. Reviewed fixes must not be described as already installed defaults.

Inventory now records all actual public/default/editable Skills and their input/
output semantics. Both old Rescue Markdown files equal the corresponding old
Acquisition files byte for byte. No separate Handoff/Recovery/Merge Bundle exists
in those areas. Normalizer's actual Bundle root is `chat-transcript-normalizer/`;
its instruction bytes equal the public compatibility Markdown. Its transcript
output and optional PARTIAL audit are not canonical continuation state, so it is
not forcibly converted to Context ZIP. New migration guidance explains how an
external agent reconciles historical state documents against Raw before writing a
Pair; the application still performs direct updates without semantic adoption.

## Offline ZIP delivery and obsolete test migration

Corrected a real locale mismatch: usage instructions now follow the selected Skill
language, not only the application UI language. Replaced obsolete Markdown viewer/
whole-Skill clipboard expectations with actual ZIP download, pinned digest and
Bundle member checks. The offline test now disconnects and reloads before browsing
files/exporting, verifies actual cached attachment bytes, exercises both usage
languages, denied clipboard and retry, and verifies package download is independent
of clipboard success. Legacy public Markdown URLs remain covered by runtime checks.
Release checks now inspect all three ZIPs' MIME, attachment disposition, sandbox
headers and exact supplied bytes rather than source-searching for a removed viewer.

Browser evidence (actual Chrome, production-mode synthetic build):

- First `context-offline-skill-zip`: 4 failures. Three were browser launch failures
  (requested bundled Chromium absent locally); the HTTP test incorrectly assumed
  Normalizer's archive filename equalled its internal root. No browser behavior
  was accepted from this run. Used installed Chrome and corrected the fixture root.
- `context-offline-skill-chrome`: 4 passed, 0 skipped, 18.1s.
- First `context-skill-shell-recovery`: 1 failed. The test tried to delete the
  optional ZIP before its background repair finished. It now waits for the real
  cached ZIP as well as the critical chunk; removal must return true.
- `context-skill-shell-recovery-final`: **1 passed, 0 skipped**, 10.739s; exercises
  real critical-resource offline failure, online recovery, ZIP-only cache loss and
  a readable offline library. It is not the complete PWA negative matrix.
- `context-offline-library-final`: **21 passed, 0 skipped**, 73.140s; complete
  `library-offline.spec.ts` and `release-security-baseline.spec.ts`. Earlier 4-case
  run overlaps and is not four additional scenarios. Evidence counts verified from
  the gate-evidence JSON records under the corresponding Web test-result paths.
- Serial lint/typecheck and production Web build passed before the browser runs;
  final lightweight checks recorded below. No migration added.

Final lightweight rerun: `corepack pnpm run lint` and `corepack pnpm run typecheck`
both passed; `python tools/context-skills/build.py --output apps/web/public/skills
--check` passed; `python -m alembic heads` returned only `20261003_0046`; scoped
`git diff --check` passed (line-ending notices only). A first standalone build
check omitted its required `--output` argument and exited before checking; the
corrected command above is the passing evidence. Review artifacts were regenerated
to include the updated external runtime reference. The production Web build from
this slice contains the locale fix; later edits affect tests/docs only.

Task temporary directory remains `C:\Users\86182\Desktop\wkkk\chat-reader-maintainer-20261003`.
With C: down to about 240 MiB, inspected only this task root: nine completed pytest
trees total about 133 MiB; three failed-browser profile folders are empty; no child
reparse points or live process references were found. Deletion of these twelve
specific directories was rejected before execution by automatic policy
(`blocked by policy`). Nothing was deleted or retried through another mechanism.
Review ZIPs and repository test evidence were excluded. Large further test runs
are deferred while recording current results; no user/system global temp change.

Remaining goal: authenticated durable-draft expiry/quota/signout/scoped deletion,
Context/Skill permissions and lifecycle gates; complete API/PWA/PostgreSQL release
checks; actual external semantic-use acceptance and reviewed-runtime delivery;
settings screenshot cleanup and later site UX follow-up. The default Bundle bytes
remain user-pinned. No commit, push or production deployment in this slice.

## Actual offline ingestion and Context export parity

Confirmed a real defect with a failing test: offline annotations referenced earlier
versions absent from the package (`annotation_versions` missing). Fixed packaging
to include only the requesting owner's live anchor versions per message batch.
Dexie v2 stores these as optional fields; Reader still uses current versions.
Exports include the required history and filter excluded annotation notebook refs.
Older snapshots retain annotation quotes and unavailable original locators, never
fabricate links to current text, and display a specific export notice.

Added optional project context and attachment provenance. Project-description edits
now advance related conversations' offline revisions. Legacy absence is declared
in the Raw manifest extension. Metadata-only attachments keep their digest/object
locator; cached binary checks remain independent of inclusion.

Evidence (local, no deployment):

- Baseline `test_offline_context_anchors.py`: 1 failed, proving missing history.
- Final API tests: `test_offline_context_anchors.py`, `test_offline_annotations_api.py`,
  `test_context_default_skill_interop.py`, `test_projects_api.py`: **27 passed**
  in 52.15s. Includes real owner filtering and persisted project revision/metadata.
- Initial real-ingestion browser case: 1 passed. Expanded gate
  `context-offline-parity-final`: **4 passed, 0 skipped**, 40.822s, including
  cached workspace/export regressions. Two parity cases were then strengthened to
  start with actual Normalizer import instead of direct conversation creation.
- Final `context-offline-source-parity`: **2 passed, 0 skipped**, 27.627s.
  The application downloads a real worker package and imports it without IndexedDB
  seeding, disconnects/reloads, then exports. The legacy case deliberately strips
  optional fields from the real HTTP download. Fixed-runtime fingerprints and the
  full canonical reference parser run against the actual downloaded ZIPs. Assertions
  verify body/old-anchor text, actual attachments, metadata-only hash parity,
  descriptions/project context, Normalizer model/timestamp metadata, notebook
  references and saved Current/Index bytes. Overlapping runs are not additional
  unique acceptance scenarios.
- Serial lint, typecheck and production Web build passed; pinned default ZIP
  check passed; Alembic sole head remains `20261003_0046`. No migration added.
- CI includes the parity spec in `context-files`; GitHub execution is still pending.

Temporary outputs use `C:\Users\86182\Desktop\wkkk\chat-reader-context-parity-20261003`.
Browser synthetic evidence lives under the named `apps/web/test-results/` gates.
No cleanup retry, commit, push or production change was performed. The fixture
API/worker were intentionally restarted to load changed package code.

Still required: external OLD/NEW materialization and real semantic use; authenticated
draft/Context/Skill negative and cleanup gates; complete API/PWA/PostgreSQL release
checks; remaining Rescue/legacy ecosystem work; settings and later site UI audit.
The actual-ingestion gate does not prove all attachment sizes, v1/v2 cases, resource
failure paths or account-isolation behavior.

## Reader tools and durable drafts checkpoint

Implemented file Find across inline Markdown text, whole-Index search, reference
navigation through the owned complete-turn Reader, single-member history restore
with a captured generation and current counterpart retention. Opening History
loads fresh rows, avoiding references already pruned by another window. Explicit
Index navigation cancels startup reading-position restoration and works against
the cached 220-block offline fixture. Dialog key events do not scroll the Reader.

Current/Index drafts use the existing protected Dexie settings. They retain their
base text/generation, offer resume after reload, fork on concurrent local writes,
and are removed after save, explicit discard or returning to original text.
Pending-signout/cleanup accounting and recovery exports include them. Conflicts
can compare a pinned current server file before an explicit generation-checked
update. The normal Context/Share/offline-package outputs exclude working drafts.
Two separately refreshed state/history queries now retain a coherent mounted
document; a test deliberately delays the real history response while the newer
state arrives to guard against losing the editor.

Evidence so far (not all runs passed):

- Initial reading-tools run: 9 passed, 3 timeouts; stale cached history exposed
  a product issue. Refreshed-history follow-up: 12 passed.
- Initial disconnected Index jump failed because startup restoration retried
  its old position. After cancellation fix, navigation run: 6 passed, including
  actual heavy offline target and three Reader restoration regressions.
- Visual-only run: 2 passed, 3 skipped because E2E_LONG_READER was absent. The
  subsequent six-case run enabled it; skips were never counted as passes.
- Initial durable draft/direct/drop/offline run: 12 passed. Actual IndexedDB,
  server state and downloaded recovery file contents were asserted.
- Follow-up with compare workflow: 5 passed, 2 failed. One exposed transient
  editor unmount between refreshed queries; fixed above. Another PUT returned
  HTTP 500 during resource pressure; cause not yet proven. It did not recur in
  the final run; this does not establish its cause or replace full API gates.
- Lint/typecheck/build passed before the latest comparison/refresh changes.
  A later concurrent lint attempt hit V8 out-of-memory and typecheck could not
  spawn; these are failed attempts. Final serial lint, typecheck and Web build
  passed. Workflow YAML parses; GitHub has not executed this change.

Final `context-reading-final`: **10 passed, 0 skipped**, 106.954 seconds. Includes
all three reading widths, two durable-draft widths with a deliberately delayed
real history response, Index conflict comparison/explicit update, cached heavy
offline reference/export and three existing Reader restoration regressions.
Authoritative local report:
`apps/web/test-results/context-reading-final/gate-evidence.json`.
The earlier 12-pass direct/drop/draft run remains a separate checkpoint, not an
additional 12 unique features or proof of the complete migration.

Mobile/light and desktop/dark screenshots were inspected for Find, Index,
history and draft conflict layout. All content is synthetic. Temporary processes
use C:/Users/86182/Desktop/wkkk/chat-reader-context-reading-20261003. A read-only
scan found approximately 170 MB of prior task pytest files; the attempted scoped
cleanup was rejected by automatic approval policy. Nothing was deleted by that
attempt. C: was down to roughly 200 MiB; unrelated task/app data was not touched.

Added the context-files CI step with the required feature switch so these tests
will run rather than silently skip. CI has not run. API reference was reconciled
to direct-file routes and retirement tombstones; Context/Offline contracts,
testing guide, navigation and inventory were synchronized. Authenticated draft
expiry/quota/signout/deletion cases, external dual-package materialization,
ingestion fingerprint parity and full release gates remain outstanding.

## Latest checkpoint: actual default Skill interoperability and drag/drop

The eight drag/drop/direct-save browser scenarios now pass across 375/768/1440
and Chinese/English. They verify persisted member bytes, wrong-tab refusal,
failed-update draft preservation, reopened state, three-snapshot retention and
unchanged canonical messages. Mobile reading and desktop editing screenshots were
visually inspected. Evidence: `apps/web/test-results/context-drag-files/`.

The actual pinned default ZIP runtime did not read the dedicated exporter's old
CanJSON 2.1 stream. New online Context exports now emit canonical v2, including
top-level attachment refs, source refs, complete annotation anchors and notebook
records. Partial-range exports exclude unrelated attachment objects. Normalizer
display metadata survives canonical/Context reimport and reaches offline v3;
offline export retains cached source refs. Arbitrary provider metadata is excluded.
The supplied default ZIP bytes were not modified and application code does not
execute their scripts. Tests import only seven reviewed deterministic modules from
checksum-pinned defaults, separately from the experimental application runtime.

Verification:

- API/export/Normalizer/offline regression: 46 passed.
- Subsequent default-reader and legacy/resource regression after partial attachment
  filtering: 38 passed, 1 skipped. The skipped directory-symlink case requires
  Linux CI or a Windows host able to create symlinks; it is not a pass.
- Browser online export (six width/locale combinations) and disconnected cached
  Context export: 7 passed; actual downloaded ZIP records/checksums inspected.
  Evidence: `apps/web/test-results/context-canonical-v2/`.
- Web lint, typecheck, production build and exact pinned default-ZIP check passed.
- Initial new test run: 4 failures due to expecting CRLF to survive canonical
  reimport (the parser deliberately normalizes it); follow-up: 2 failures due to
  expecting conversation header metadata on every message (Normalizer places it
  on the first). Expectations now reflect these contracts; the original exported
  Skill-reader bytes are still checked exactly. Failures are not counted as passes.

Task temp processes and pytest roots now use
`C:\Users\86182\Desktop\wkkk\chat-reader-canonical-v2-20261003`.
Earlier scoped cache cleanup removed 87 confirmed task items, 42,672,605 bytes;
unowned caches and user inputs were retained. AGENTS.md records the ongoing rule.

Remaining: full external OLD/NEW materialization and semantic acceptance, actual
ingestion online/offline fingerprint parity, durable editor drafts and Index
navigation/search/history restore, remaining role/PostgreSQL/concurrency gates,
complete release suite, settings cleanup and the subsequently authorized full-site
UX audit. Full migration is not complete; no commit, push or deployment here.
The current Context contract now distinguishes the experimental runtime from
the pinned default runtime and removes superseded candidate/adoption instructions.

## Earlier checkpoints (historical, superseded where stated)

The direct-file application workflow remains authoritative: no candidates or
semantic adoption in Chat Reader. External Maintainer semantic inputs are separate.

Added read-only `compare_context_packages.py OLD NEW` to the Maintainer Bundle.
It checks manifest member integrity and matching conversation identity, streams
message comparisons using the existing canonical projections, groups attachment
references to avoid scanning all references for every message, and reports first
content/locator differences and appended material. Prior asset changes are counted.
It never asserts semantic reuse or expands coverage, and explicitly requires
supplementary-context review. Both inputs remain unchanged.

Six actual CLI tests passed for append, historical modification, locator changes,
truncation, foreign identity and corrupt Raw checksum. This is the comparison
part of the required dual-package workflow; final dual-input materialization,
semantic boundary repair, Rescue migration and full acceptance remain incomplete.
No production deployment.


## ZIP-only default replacement checkpoint

User decision supersedes the earlier distribution approach: ship the three exact
ZIPs supplied under Desktop/examples, pinned in tools/context-skills/default-bundles.
The comparison CLI described above remains experimental source and is not injected
into these user-supplied defaults. The normalizer replaces the Rescue default while
retaining the internal CONVERSATION_RESCUE category for compatibility.

New Skill uploads/replacements require ZIP. Admin settings show three bundled
rows per locale with download/replacement only. Personal preferences and existing
Skills remain preserved; no Skill viewer/member/history UI is exposed. Current and
Index remain separate readable/editable Context files. Migration 0046 resets system
defaults without deleting personal data or previous system revision records.

Evidence: exact ZIP build check passed; ZIP-default API/migration tests 2 passed;
Skill Bundle/API regression 23 passed; personal browser 7 passed; authenticated
Root browser 6 passed. Browser tests cover 375/768/1440, Chinese/English and actual
ZIP member downloads, preference persistence and stale replacement protection.
Lint, typecheck and Web build passed. Alembic reports one head, 20261003_0046.
Initial regression run had 7 failures from obsolete Markdown-upload expectations;
fixtures now submit ZIP and retain a separately seeded legacy-record compatibility
test, and all 23 cases pass. No failure was counted as a pass or hidden by a skip.

Full API/PWA release gates, external Skill/importer integration and the complete
Context migration remain unfinished. Old unrelated E2E Skill-viewer assertions
still require migration. No commit, push or production deployment in this checkpoint.

PostgreSQL 17 acceptance: 4 passed using an isolated loopback cluster and disposable
migrated databases. Includes personal/system Bundle archive roundtrip and rollback,
plus 0045-to-0046 default reset preserving personal selection. The cluster was stopped
after testing. This is local acceptance, not production verification.


## Follow-up: Markdown input and transcript importer

User re-enabled Markdown Skill upload/replacement with automatic ZIP packaging
and unchanged Skill names. Both user/admin file routes accept .md/.zip; immutable
Bundle storage preserves original instructions. Downloads use RFC 5987 name.zip.
System defaults still use the exact supplied ZIP bytes. JSON content-edit routes
remain retired and no Skill viewer is restored.

Normalizer integration inspection found the generic parser could mistake literal
Prompt headings for messages and keep Unknown/model metadata inside body text.
A fixed transcript-profile parser now recognizes the specific header and complete
boundaries before adaptive mapping, protects fences/HTML literals, and supports
same-role messages. Six synthetic parser/import cases pass, including actual
canonical message/version persistence. It does not execute any supplied scripts.
Model/exported display metadata are parsed but not yet persisted as structured
canonical fields; legacy preview integration and external serializer end-to-end
acceptance remain pending. The original ZIPs are unchanged.

Follow-up acceptance: 4 default/Markdown packaging API cases passed, including Root replacement. Combined Skill/transcript suite passed 32 cases before adding that Root case. Adaptive/parser regression: 34 passed, 1 skipped. Browser final: 8 passed, including Unicode same-name ZIP download and Markdown replacement. Initial browser run had one ambiguous personal/system settings locator; anchored to the personal setting label and all eight passed. Lint/typecheck/build passed; sole head remains 0046. Maintenance reminder proposal is saved under docs/planning, not implemented.


## Transcript compatibility and provenance follow-up

Shared fixed profile parser now serves both adaptive normalization and legacy
Markdown detection/parsing. A first probe correctly found the legacy HTTP preview
requires JSON; this contract remains unchanged and the negative test proves it.
Standalone transcript files use adaptive import and commit actual canonical bodies.
Private source references now preserve model, timestamp display and historical
header metadata. File-order locators are explicit `transcript:N`, not provider IDs.

Final focused regression: 86 passed, 1 skipped. Covers source detector, exporter
parser/alignment, CanJSON parser, adaptive API and eight transcript tests including
DB body/order and source-metadata assertions. A preliminary command referenced a
nonexistent test_canjson.py and ran no tests; corrected to test_canjson_parser.py.
No uploaded scripts were executed, no supplied default ZIP changed, no deployment.

Candidate API audit still finds live creation/member replacement/validation/adoption
routes. They are obsolete under direct file updates; retiring these also requires
migrating historical service regressions and old queued-validation behavior. This
remains required follow-up, not completed by direct-workflow tests. Maintenance
reminder guidance remains a design proposal pending user decisions.


## Direct-file export alignment

Removed the legacy selected-revision exporter branch that compared Raw prefixes,
dependencies and locator fingerprints, or rewrote raw-tail declarations. All saved
revisions now use the same direct-file inclusion path as new saves, with explicit
included_without_validation status. Source declarations and member bytes are not
rewritten. Partial exports still omit continuation to protect excluded history.

Fixed a real failure in the direct path: corrupt/missing optional member objects
used to abort Raw export; they now yield Raw-only/unavailable and never half a Pair.
Partial snapshot member GET returns 404 for absent members, while corrupt object
storage remains a recoverable 409. No candidate API retirement claimed yet.

Final targeted regression: 28 passed (direct files, legacy saved-state export,
options, returns and archives). Initial test expected a null raw_tail_start_seq;
source had no such field, so the assertion now requires it remain absent, proving
no synthesized declaration. Tests cover actual ZIP members/checksums, partial scope,
source mutation before publication, corrupt objects, history preservation and
explicit Raw-only export. No production deployment or new migration.


## Candidate API retirement and direct-write concurrency

Removed the public candidate creation/member replacement, validation, preview,
adoption and listing handlers. Ownership-checked tombstones respond 410 with a
stable retirement code; foreign-account requests remain 404. Removed old Web API
methods/types. Queued legacy validation now fails without creating a receipt;
manual retry returns 410 and task UI explains direct file updates instead.

Historical database tables and private services are retained for stored-data and
cleanup compatibility, not as a reachable application workflow. Legacy fixture
seeding explicitly calls those private services; it no longer creates/adopts through
HTTP. Tests asserting the superseded candidate product behavior were replaced by
retirement/no-mutation, direct safety/ownership and historical-data preservation
scenarios. Existing direct tests still cover inheritance, stale generation,
idempotency, last-three retention and unchanged Raw. No mocks enable retired APIs.

Acceptance: 31 candidate/direct/export/legacy compatibility cases passed; 19 return,
cleanup/options/archive cases passed; final validation-worker/retry subset 4 passed.
One real PostgreSQL test migrated an isolated database to head and raced two identical
direct saves: one snapshot, one member object, zero candidates. Lint/typecheck and
Web build status recorded after completion below. Sole migration head remains 0046.
No production deployment; settings cleanup and later site audit remain sequenced
under the user's latest follow-up. Full migration acceptance is still incomplete.

Retirement checkpoint final checks: lint, typecheck and Web production build passed. Disposable PostgreSQL cluster stopped. Full release/PWA gates have not been run in this checkpoint and are not counted as passed.

## Archived Context migration state notes

Copied from the earlier PROJECT_STATE preface during the 2026-10-03 closeout.
These dated notes preserve history, including superseded candidate/ZIP-only
designs and incomplete test checkpoints. They are not current product rules.

Authenticated Context recovery (2026-10-03, local): failed post-save draft cleanup
now leaves an actionable draft list. Direct writes and return admission/application
refresh and lock the owner account before the conversation. Focused API/PostgreSQL
rerun: 30 passed. Authenticated browser rerun after the backend fix: 8 passed,
zero skips. PostgreSQL return-publication cancellation/failure, shared cleanup and
archive/default recovery: 13 passed. Cancellation or failure after member writes
rolls back saved files/generation/objects; explicit retry preserves the counterpart.
The user authorized E:/1project/chat-reader/.tmp/context-tests for this test run
because C: is full. Existing C: files remain untouched; no global env changes.
The corrected full API run has 858 passes / 4 skips / 1 Argon2 allocation setup
error; all six tests in that archive test file pass when rerun separately. This
does not turn the failed full run into a pass. Corrected full PWA: 180 passed,
201 opt-in skips; lint/typecheck pass. Negative/authenticated matrices are separate
gates. Authenticated Root/draft cleanup now waits for actual account
deletion and passes 9 cases. Personal/Root Bundle suites are included in CI, but
GitHub execution and remaining release gates are unproven. See
docs/execution/CONTEXT_MIGRATION_2026-10-03.md. No commit/push/deployment.

External maintenance and offline Skill delivery (2026-10-03, local): reviewed
Maintainer now materializes OLD Continuation + NEW Raw with complete source
bindings, historical suffix repair rules, stale Evidence rejection, streamed
assets and exclusive output publication. The preceding implementation run passed
32 focused API tests, including the real API/worker → external writer → return →
append → dual writer → return → re-export cycle. Current reviewed runtime/distribution
rerun: 60 passed, 1 Windows symlink test skipped. The three user-supplied default
ZIPs remain byte-identical; these fixes ship only as separate review artifacts.
Actual Skill inventory and legacy-state migration guidance are in
docs/system/CONTEXT_SKILL_MIGRATION.md. Old Rescue Markdown is exactly the old
Acquisition text, not a package-rescue implementation; Normalizer remains the
third default. Offline delivery now copies instructions in the selected language;
real ZIP/attachment downloads and cold-start recovery passed 21 library/security
cases plus one shell-negative case, with zero skips. Earlier overlapping/failed
runs and remaining acceptance are recorded in the dated execution log.
External real-use semantic acceptance, reviewed-runtime delivery, authenticated
draft/Context/Skill negative and cleanup gates, full release checks and settings/
site follow-up remain open. No commit, push or production deployment.

Context offline ingestion parity (2026-10-03, local): offline v3 now retains only
the requesting owner's annotation anchor versions, optional project context and
attachment source metadata. Project-description edits advance offline revisions.
Legacy packages preserve quotes with explicitly unavailable anchor locators;
export does not relink them to current bodies. Metadata-only exports retain asset
digests. Actual Normalizer import → online export → worker offline download →
IndexedDB ingestion → disconnected reload/export passes content/locator hashes,
full canonical reference parsing and member-byte checks. Final browser gate:
2 passed/0 skipped, with 4 earlier overlapping offline regression passes;
API/offline/project/default-reader tests: 27 passed. Serial lint/typecheck/build,
exact default ZIP checks and sole migration head 0046 pass. Full migration,
external dual-package materialization, authenticated negative/cleanup acceptance,
release checks and settings/site follow-up remain open. No commit/push/deployment.

Context Reader tools (2026-10-03, local, release incomplete): Current/source Find,
full Index search, owner-scoped online/offline reference navigation and explicit
single-member history restoration are implemented. Index navigation now cancels
startup reading-position restoration. Account-scoped Current/Index editor drafts
persist in existing Dexie settings, retain server bases, survive reload and fork
on local concurrent edits. Sync-center recovery export and cleanup/signout pending
guards include them; server conflicts can compare the latest file before an
explicit generation-checked update. The editor retains its coherent file snapshot
while state/history refresh independently. Final rerun: 10 browser cases passed
with zero skips; serial lint/typecheck and production build passed. See the dated
execution record for earlier failed and skipped runs. External
OLD/NEW materialization, authenticated
negative/cleanup acceptance, complete release checks and settings/site follow-up
remain open. No commit, push or deployment in this checkpoint.

The remaining lines are dated earlier checkpoints; current Context behavior is
defined in docs/system/CONTEXT_PACKAGE_CONTRACT.md.

Context export interoperability (2026-10-03): new dedicated Context exports now
write canonical JSONL v2, readable by the actual pinned Acquisition and Maintainer
readers. Top-level attachment refs, anchor versions, notebooks and allowlisted
source display metadata are preserved. Reading-scope exports omit unrelated
attachments. Offline v3 optionally carries message source refs without a Dexie
upgrade; offline export retains them. 46 API/export/offline tests passed;
38 compatibility/resource tests passed with one Windows symlink test skipped;
7 online/offline export browser cases passed. Lint, typecheck, build and exact
default ZIP checks passed. Earlier drag/drop suite: 8 passed. Full migration,
external dual-package writing, workspace navigation/durable drafts, final release
gates and settings/site UX follow-up remain unfinished; no deployment this turn.

Latest entry decision (2026-10-03): Context ZIP updates belong to the individual
conversation's Current/Index workspace beside annotations. Do not add a global
Context page or mix Context ZIP into ordinary transcript import. Dropping a
Context ZIP updates its saved members; dropping Markdown on Current or JSON on
Index updates that member. Drag/drop and pending-task reconnection are implemented
locally; eight browser scenarios pass. No Raw import route was added.
Task temporary directories now use `C:\Users\86182\Desktop\wkkk` as required
by AGENTS.md. A scoped cleanup removed 87 attributable items (42,672,605 bytes)
from Windows Temp; unowned caches and user input files were retained.

Candidate API retirement (2026-10-03): all legacy candidate routes now return
410 CONTEXT_CANDIDATE_FLOW_RETIRED after conversation ownership checks; foreign
accounts receive 404. They are absent from OpenAPI. Only direct files, whole-package
return, state and saved revisions remain supported. Queued legacy context_validation
jobs fail with CONTEXT_VALIDATION_RETIRED without new validation receipts; retry is
blocked and the task UI points to direct updates. Historical rows/private fixture
services remain for compatibility, not a reachable user workflow. No data was erased.

User follow-up (2026-10-03): after completing Context migration, re-audit all
settings against original requirements and simplify the screenshot-marked and
similar UI. Then test, commit and deploy (explicitly authorized by latest user
instruction); only after that release run a full-site UX/layout audit and implement
at least 15 valuable improvements, prioritizing major user friction. This is pending
scope, not completed work or permission to deploy the current incomplete tree.
See docs/planning/SETTINGS_AND_SITE_UX_FOLLOWUP_2026-10-03.md.

Direct-file export alignment (2026-10-03): all selected saved revisions, including
historical adopted records, export as `included_without_validation`. The exporter
no longer checks semantic prefixes/dependencies or rewrites coverage/tail claims.
Optional source declarations are preserved as declarations only. Partial-scope
exports exclude saved continuation members. Missing/corrupt saved objects fall
back to Raw-only with `unavailable`, without publishing half a Pair. Revision
member reads distinguish an absent member (404) from a damaged stored member (409).
Legacy candidate/validation/adoption endpoints still require retirement; this
export alignment does not claim that API retirement is complete.

Latest input update (2026-10-03): Skill upload/replacement accepts ZIP and Markdown.
Markdown is automatically stored as a compatibility Bundle, preserving original
instructions and the Skill display name; downloads use that name with `.zip`.
System defaults remain the three supplied ZIPs. No Skill viewer is added.
This supersedes earlier ZIP-only input statements below.

Normalizer transcript integration (2026-10-03): adaptive import recognizes the
specific Profile v1 header/boundaries and preserves same-role turns and literal
headings. Model/timestamp/header displays now persist in private source references.
Compatibility parser shares the same recognition, while legacy preview still
requires JSON. Regression: 86 passed, 1 skipped (source detection, parsers,
alignment, adaptive import and actual canonical persistence). Full source-metadata
Context/Offline roundtrip and obsolete candidate API retirement remain unfinished.

## ZIP-only Skill defaults (2026-10-03, local source)

The only three shipped default Skill ZIPs are context-acquisition,
context-continuation-maintainer and chat-transcript-normalizer-skill. Downloads
are byte-identical to the user-supplied ZIPs pinned under
`tools/context-skills/default-bundles/`. Experimental editable runtime trees are
not the shipped default Bundles. Personal Skills and preferences are preserved.
New uploads/replacements accept ZIP only. Settings expose replacement/download,
not Skill content, member trees or history viewing. Current/Index viewing and
editing remain separate features. Legacy Markdown content APIs remain readable.
Migration `20261003_0046` is the sole source head and resets system defaults to
these Bundles without touching personal selections. Production is not updated.
Earlier head numbers and external Skill statements below are dated checkpoints.
ZIP-only checkpoint: 25 API tests, 13 browser scenarios and 4 PostgreSQL
archive/default-migration cases pass; lint/typecheck/build and exact ZIP checks pass.
Full Context migration and release gates remain incomplete.

2026-10-03: external Maintainer now includes a read-only OLD/NEW package comparison
CLI. Six tests cover append/history/locator/truncation, identity and integrity.
It does not assert semantic reuse. Dual-input final materialization is still
pending; see docs/execution/CONTEXT_MIGRATION_2026-10-03.md.

## Latest user decision: direct file updates (2026-10-02)

The user removed the candidate, validation and adoption workflow. Current and
Index now update directly; a single-member update retains the other member.
The default history is the latest three file snapshots. Application storage does
not assess continuation correctness or claim verified state. File format/resource
safety, ownership and concurrent-write protection remain necessary.

Direct member PUT and the simplified Reader export-panel section are implemented
locally. Migration 0045 permits partial snapshots; direct export includes the
saved members with included_without_validation status, and excludes them from
partial conversation exports. Two direct-file backend cases pass; typecheck and
local SQLite 0044-to-0045 migration pass. The sole source head is 0045.
Direct-file/export regression passes 11 cases; revised browser suite passes 6
cases with persistence and three-record checks. Lint and Web build also pass.
Whole-package return now directly saves Current/Index through the worker, without
candidates or content validation. The Reader entry is beside annotations on desktop
and adjacent in the mobile More menu, opening a separate responsive workspace.
Eight return tests and six workspace browser scenarios pass; lint/typecheck/build
pass. Current now renders Markdown and Index offers browsable records; both have
source editing and direct save with conflict protection. Upload/history are separate
from the default reading view. Search, reference navigation and history restore
remain pending. The earlier
candidate/validation APIs must still be retired or isolated. Direct-history pruning
now queues durable cleanup of unreferenced members; account deletion detaches the
Context graph and preserves shared members. Cleanup/direct-return/candidate
regression passes 25 tests, including the 0044/0045 migration roundtrip. Lint passes
and Alembic reports the sole 0045 head. PostgreSQL concurrency and historical
orphan sweeping remain unverified. Canonical conversation deletion now detaches
Context references and queues private cleanup. Four cleanup tests and eleven
existing conversation/ownership tests pass; three additional cleanup scenarios
pass on a disposable PostgreSQL 17 instance migrated from empty to head.
This establishes FK/rollback/shared-reference behavior, not concurrent-write
acceptance. Complete deletion-path coverage,
archive/offline integration and final acceptance remain unfinished. Earlier
candidate/adoption checkpoints below describe superseded implementation, not the
current requested product workflow.


## Context migration work in progress (2026-10-02, local only)

Offline export now defaults to a Context ZIP independently of attachments, with
an optional cached continuation toggle. It reads metadata/messages in one Dexie
transaction, verifies cached bytes and emits the same continuation status extension
as online export. A disconnected browser downloaded and inspected both Pair and
Raw-only ZIPs; checksums and unchanged message records passed. Final build/typecheck
and lint pass. Full cross-exporter fingerprint parity, import/lease/mobile gates
and external Maintainer dual-package workflow are still incomplete.

Offline package v3 now optionally embeds selected Context member text/digests;
Dexie v2 stores it on the existing conversation record. Direct updates increment
offline_revision so delta downloads notice file changes. The offline Reader has
a read-only continuation panel. Nine API regressions, one disconnected browser
view and one parser contract test pass; Web build/typecheck and lint pass.
Full import persistence/negative matrix, cold-start/lease acceptance, mobile
visuals and offline Context export parity are still pending.

Personal v1/system v5 .cr archives now include context_files_version=1 for saved
members, revisions, selected state and source bindings. Personal restore remaps
local relationships; system restore retains canonical IDs. Both preserve file
bytes, reset validation status and exclude temporary returns/candidates/receipts.
Archive regression passes 41 cases; final migrated PostgreSQL personal/system
roundtrip and rollback pass 3 cases. Offline and external dual-package maintenance
remain unfinished.

The user approved replacing paused settings stage five with Context/Skill file
replacement, validation and export reassembly. Stage 1 is in progress: legacy
manifest normalization, CanJSON 2.1 read adaptation, exporter checksum metadata,
editable external Skill sources and deterministic Bundle builds. Runtime tests
pass 10 cases, existing export tests 8, actual exporter/runtime integration 1
(SQLite). Bundle backend now supports member storage, immutable personal/system
revisions, file replacement, pinned downloads and conflict checks. Personal and
Root Bundle controls and new built-in acquisition/maintenance distributions are
wired. Web build, lint and typecheck pass; personal and Root Bundle browser acceptance passes as detailed below.
Runtime/distribution tests now pass 34 cases, with 1 Windows symlink case skipped. Sparse ranges, deep reference chains, ZIP root/path conflicts and JSON/read limits are hardened; Raw integrity errors block continuation restore. Full hostile-input and semantic conformance remain pending. Migration head is `20261002_0044`
(local source, not deployed). Bundle archive serialization and transactional restore are now implemented with
legacy reading and history merging. Skill/account deletion now detaches history
and queues durable unreferenced-file cleanup, preserving shared members and
pending cleanup tasks. PostgreSQL verification remains pending.
Personal Bundle browser acceptance now passes 7 synthetic scenarios across
375/768/1440px, Chinese/English and light/dark themes, including keyboard preview
and stale-version draft recovery. Root Bundle browser acceptance also passes 6 authenticated scenarios, preserving
personal selections through system replacement and builtin restoration. The fixed
protocol runtime is included in the API package and checked against both Skills.
Continuation storage and member-draft API now support partial uploads, inheritance,
idempotency, conflict checks and private member reads. Candidate/API regression
passes 26 cases with 1 PostgreSQL concurrency skip; SQLite migration parity passes.
Candidate validation now runs through the worker against private temporary canonical
snapshots, saving sanitized revision-bound receipts (12 focused tests pass;
typecheck passes). Valid verified/provisional Pair tests, full member preview,
atomic adoption, revision history and supplementary dependency binding now pass
19 focused cases. Whole-package return now streams private input to the worker,
checks Raw/assets and retains only candidate members; success/expiry cleanup is
implemented (26 combined Context tests, 13 worker tests and typecheck pass).
Dedicated online export now reuses matching adopted prefixes without extending
coverage, emits Raw-only on source/range changes, and guards publication revisions
(21 focused integration tests pass). External identity mapping, remaining export
strategies/receipts, Reader return UI and
later stages remain pending; this
working tree is not release-ready.
Context export now defaults to the For AI purpose and always produces a Context
ZIP, independently of attachment selection. Attachment metadata-only and explicit
Raw-only options reach the worker and actual output manifest. Six browser cases
passed across three widths and two locale/theme combinations with real downloaded
ZIP inspection; lint, typecheck and Web build passed. Validation history also
checks supplementary dependencies and input digest, matching preview/adoption
freshness (11 validation/adoption tests passed). These are focused checkpoints,
not full seven-stage or PostgreSQL acceptance.
No model integration, uploaded-script execution or production deployment.
See [contract](docs/system/CONTEXT_PACKAGE_CONTRACT.md) and
[execution checkpoint](docs/execution/CONTEXT_MIGRATION_2026-10-02.md).
