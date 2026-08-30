# Project State

## 2026-08-31 Offline resilience and attachment locator deployment

- Production runs source `7d861667e46a6e60092426bf551c975b718c8be7`,
  built by GitHub Actions run `33335620850`. Web lint, typecheck, production
  build, the complete API suite, Alembic head/current, dependency audit and all
  twelve release browser gates passed before image construction.
- The deployable archive SHA-256 is
  `198a995ca27dd43af6b3936eb9a5b5d9363f526899c38b05d363724096e63ec8`.
  API/worker image ID is
  `sha256:3534d485db52bd72f09a032038c275ee9106f58a2b9e9f8923cae7b9187a02ae`;
  Web image ID is
  `sha256:9d015c21a2cd6e4ef5b31ada07dc9a3a6225f18c75c44299e2b34280fde69133`.
- The retained pre-deploy recovery point is
  `/opt/chat-reader/backups/chat-reader-20260830T213040Z`. Its PostgreSQL
  custom dump, imports, exports, offline and assets archives passed SHA-256,
  archive-list and isolated `pg_restore --list` verification.
- King loaded the CI images, ran migration, then recreated only API,
  import-worker and Web with `--no-build --no-deps --force-recreate`.
  PostgreSQL retained its original start time. Runtime OCI revisions match the
  release SHA; API/Web/PostgreSQL are healthy, worker diagnostics are
  `alive_idle`, restart counts are zero, HTTPS health is 200, port 80 redirects
  to HTTPS, anonymous private access is 401, public diagnostics is 404 and
  Alembic is `20260829_0029 (head/current)`.
- Authenticated production UI acceptance is `NOT VERIFIED`; no owner credential
  was used. The deployment exposed and corrected an operator-tool bug where
  `pg_restore --list -` treated `-` as a filename. The backup helpers now use
  stdin correctly; this tooling-only follow-up does not change the running
  application images.

## 2026-08-31 Continuous improvement register

- The durable candidate queue is [Continuous Improvement Backlog](docs/system/CONTINUOUS_IMPROVEMENT_BACKLOG.md): 130 evidence-labeled candidates, 17 completed, 113 remaining, 0 blocked.
- All 15 Playwright gates in the release and performance workflows now have explicit 20-30 minute step limits and gate-specific `test-results` directories, so a later invocation does not erase earlier diagnostics before the existing `always()` artifact upload. A bounded custom reporter writes one redacted start/final status file per executed gate, including a durable `running` marker if a step is terminated. YAML contract validation covered 15/15 gates. Build release images run `33331355359` attempt 2 passed quality and image jobs; its quality artifact contains 12/12 release-gate status files marked `passed`, while attempt 1 separately retains 10 status files and the trace from a transient Chromium `SIGSEGV`.
- The release quality job now always writes `apps/web/test-results/release-gate-summary.json`, indexing all 12 expected browser gates as `PASS`, `FAIL`, `SKIPPED`, or `NOT_VERIFIED`. Missing, unreadable, incomplete and zero-test evidence remains `NOT_VERIFIED`; the summary contains counts and timings but no test content or credentials.
- Online Files, file details and Offline Files now use one attachment occurrence target builder. Every path preserves attachment/occurrence/version/block identity plus canonical start/end offsets; a same-block second-occurrence contract test passed.
- `deploy/backup.sh` now checks target free space before writing, then creates a timestamped, verified five-component recovery directory (PostgreSQL plus imports, exports, offline, and assets) with a schema/source-SHA `MANIFEST` and `SHA256SUMS`; it does not delete volumes or prior backups.
- `deploy/verify_backup.sh` performs a read-only checksum/archive/catalog check using an isolated PostgreSQL container with no network or mounted volume. Both helpers have passed `sh -n` and `git diff --check`; production execution remains a separate operator action.
- `deploy/verify_runtime_images.sh` checks the running API, worker, and Web OCI revisions against an expected release SHA without changing containers.
- `deploy/verify_runtime_health.sh` verifies core container health and the worker heartbeat through protected in-container diagnostics.
- `deploy/verify_https_entry.sh` rejects plain HTTP HTTPS-port inputs and verifies TLS health plus the HTTP-to-HTTPS redirect boundary.
- GitHub Actions run `33329145714` passed the complete quality and image jobs for `f182e5872dd4c75058aba16853410b22cf50c2c9`; the deployable artifact is unambiguously named `chat-reader-images-f182e5872dd4c75058aba16853410b22cf50c2c9-1`.
- Attachment reference parser coverage now includes case-insensitive UUIDs, Markdown/query/fragment delimiters, nested structured IDs, and fail-closed missing mappings (`3 passed`).
- `deploy/preflight_release_space.sh` validates a staged release archive, measures its expanded image size, and combines backup, Docker root, and transfer headroom requirements per actual filesystem before backup or `docker load`. A production read-only run measured 13,970,832 KiB available versus 3,856,926 KiB required on the shared root filesystem; an oversized-headroom run refused with status 1. The verified temporary archive was removed afterward, and runtime image/health checks remained unchanged and healthy.

## 2026-08-31 Sidebar state, custom project order, drag feedback and batch merge (deployed)

- Production runtime is source `9cc7c4e2b6065bf3bce333a2fc8bb3cfb0ac94fd`,
  built externally by GitHub Actions run `33325329338` attempt 2. The exact
  archive SHA-256 is
  `bb46bc1e497408b1abece1662dcbccad4830185946c0ca7c501bcba996b191ab`.
- The retained pre-deploy recovery point is
  `/opt/chat-reader/backups/predeploy-20260830T175500Z-9cc7c4e` (540 MiB).
  Its PostgreSQL custom dump passed `pg_restore --list`; imports, exports,
  offline and assets archives passed tar listing and all five files passed
  `SHA256SUMS` verification.
- King loaded the externally built images, ran the existing migration, and
  recreated API/import-worker/Web with `--no-build --no-deps --force-recreate`.
  PostgreSQL was not restarted; no volume, `.env.production`, import storage or
  user data was removed or overwritten.
- API/worker runtime image ID is
  `sha256:662dd41a676886a2b38d4b0a72c2cc76ec75f719c64dea926d04dd2cf0055125`;
  Web is
  `sha256:c9e5efe9cd0ceb9cbce74c4f299cf345be1c8aa462d0251e67ce5329d1f54ba3`.
  Both OCI revision labels match the runtime source.
- Production API, Web and PostgreSQL are healthy; worker diagnostics report
  `alive_idle`; external health is 200, anonymous private access is 401,
  public diagnostics is 404, and Alembic is `20260829_0029 (head/current)`.
  Authenticated production UI acceptance remains `NOT VERIFIED` because no
  owner credential was used. CI production-build browser, PWA, authentication,
  Reader, Share, Source Editor and attachment gates all passed.

- Project containers now have one product ordering authority: custom drag order.
  New active non-default projects append after the current last project. Project
  and conversation rows retain normal text contrast; only the current item uses
  the neutral selected surface.
- Project/conversation drag previews are inert, source-sized blocks rather than
  browser link ghosts. Main list rows remain ordinary navigation targets and
  show a delayed, viewport-aware description preview only after stable hover.
- Successful Reader navigation now uses a short exact text-line pulse (or a
  fallback left marker) instead of leaving an entire message highlighted.
  Sidebar Settings is an upward in-shell region with an explicit Settings /
  Collapse settings toggle, not a modal dialog.
- Batch selection keeps its launcher in place and changes it to `Done`; Merge is
  a first-level action whose title and order are owned by a focused dialog,
  outside the horizontal toolbar's size constraints.
- Pre-deployment local verification:
  Web typecheck, lint, production build, the focused Project API suite (10
  tests), Alembic single head, and `git diff --check` pass locally. The full API
  suite reached 346 passed/6 skipped, then failed with 47 setup errors after the
  Windows temporary drive filled (`sqlite3: database or disk is full`); one
  import-backed Reader performance case failed in the same run. PWA/browser
  execution built successfully but service-worker activation stayed false and
  repeated Offline tests timed out, so browser acceptance is NOT VERIFIED. No
  commit or deployment was performed.

## 2026-08-29 User Skill management (local)

- Added owner-scoped `user_skills` and `user_skill_selections` persistence with
  immutable system defaults for export and Conversation Rescue Skills.
- Added authenticated Skill registry API and Settings > Skill 管理 panel. User
  uploads are UTF-8 Markdown (512 KiB max), deduplicated, saved inactive until
  explicitly selected, and safely fall back to the system default when disabled
  or deleted.
- Online export and Rescue copy flows resolve the selected Skill; offline paths
  continue using static defaults. No external model request or Skill content
  indexing is introduced.
- Verification: Skill API tests (3) and migration-head regression (8 focused
  tests, 1 PostgreSQL skip), API module compilation, Web typecheck, lint,
  production build, and Alembic heads pass locally. The full API run reached
  393 passed/5 skipped; its stale fixed-head assertion was updated for this
  migration and the focused rerun passes. Browser and production gates remain
  pending; no commit or deployment performed.

## 2026-08-29 Offline library content-readability fix (local)

- Offline package import now normalizes message/conversation identifiers and
  verifies that payload message rows were actually persisted before committing.
- Offline Reader message and render-block reads use the indexed path with a
  safe primary-table fallback for older Dexie packages whose indexes were not
  rebuilt after an upgrade.
- Offline library metadata reconciles stale server message aggregates from
  the locally stored message rows, preventing valid packages from displaying
  as `0/0` messages. No schema or route changed.
- Verification: Web typecheck, lint, `git diff --check`, and the focused API
  offline package test pass. Full build/browser verification remains pending
  because the development C: volume is critically low; no commit/deployment
  was performed.

## 2026-08-25 Adaptive import handling classes and Conversation Rescue (local, not committed or deployed)

- Import analysis now returns explicit `SUPPORTED`, `MAPPABLE` or
  `NOT_MAPPABLE` handling classes per StructureFamily. Native Markdown Export
  v2 is recognized directly; instruction/document sources are rejected from
  Mapping with a diagnostic instead of being presented as a repairable format.
- The existing Import Session keeps unresolved files in place and offers
  diagnosis, replacement, exclusion and a contextual Conversation Rescue
  dialog. The dialog only copies/downloads the supplied static skill files;
  Chat Reader does not call an external model or upload source content.
- The supplied bilingual 25k Skill resources are served from both the
  import-rescue URLs and the existing export Skill URLs; the export picker
  therefore uses the same current Chinese/English 25k source without a new
  route or local-path dependency.
  Replacement uses the existing artifact replacement and re-analysis flow;
  no database migration or new product route was added.
- Focused Adaptive Import API tests, Web typecheck, lint and production build
  pass locally. The full API suite exceeded the available five-minute command
  window and remains unverified; no commit or deployment was performed.

## 2026-08-25 IA Round 2 implementation (local, not committed or deployed)

- Implemented the adopted IA-R2-001 Settings boundary: the global footer now
  presents `Settings`, while data/import, learned import formats and account
  security open focused state-owning dialogs with guarded dirty dismissal and
  return-to-opener focus restoration. Reader and import contextual shortcuts
  remain available.
- Implemented IA-R2-002 global Tasks ownership: the authenticated shell has a
  stable `Tasks` launcher that opens the existing task monitor for import,
  merge, delete, export and cleanup work. The worker, cancellation semantics,
  retention and cleanup review paths are unchanged; no task-history model was
  added.
- Implemented IA-R2-003 import completion: committed imports remain in the
  Import surface and show the committed count, message count, warnings and
  explicit `View imported conversations`, `Open first` and `Close` actions.
  Multi-item completion no longer silently opens the first conversation.
- Replaced the two exported Context Acquisition Skill assets with the supplied
  bilingual v2 files while preserving the existing public filenames/URLs.
  The viewer no longer presents a manual SHA/checksum confirmation; the assets
  remain inert static text resources.
- Local verification: Web typecheck and lint PASS. Browser/API/build gates and
  production deployment are intentionally pending for this uncommitted local
  change.

## 2026-08-24 Current authority and formula/source-position deployment

- The repository remains on the single `master` branch. The current follow-up
  is documentation-only and does not change the production runtime authority,
  which remains source commit
  `7ff2f92b3aea707b9db3826907c7016d3ac9ac8e`; no runtime redeploy was needed
  for the follow-up documentation commit. GitHub Actions run `32698108862`
  passed the complete quality job and built the deployable API/worker/Web
  image set for the runtime source.
- Source-to-reader locate now centers the selected rendered block in the reader
  viewport, while ordinary search, TOC and annotation navigation retain their
  existing alignment. Fenced `latex`, `tex` and `ltx` blocks use the LaTeX
  syntax highlighter without changing canonical source or math semantics.
- A temporary pre-deploy backup was verified readable before replacement and
  deleted after production health acceptance by explicit operator request.
- Production now runs the `7ff2f92` image generation for API, import-worker and
  Web. API, worker, Web and PostgreSQL are healthy; public health is 200,
  public diagnostics is 404, protected diagnostics reports `alive_idle`, and
  Alembic is `20260823_0028 (head)`. The direct rollback image generation is
  retained; no production volume, database or environment file was deleted.
  Authenticated production UI remains `NOT VERIFIED`.

## 2026-08-24 Performance optimization deployment

- The current `master` runtime source is `111874782e963b9271b0385963be8edc6e6525e8`.
  The release workflow completed successfully, including the full quality job
  and image construction. The deployed images were built at
  `2026-08-24T01:55:40Z`.
- The change reduces duplicate browser preference reads and broad cache
  invalidation, defers annotation data until the workspace is opened, and
  removes repeated list/project/search database queries through eager loading,
  aggregate counts and batched render-block reads. No migration or dependency
  was added.
- Production was backed up before replacement. The PostgreSQL dump and the
  imports, exports, offline and assets archives are readable. API, worker, Web
  and PostgreSQL are healthy; public health is 200, anonymous private access is
  401, public diagnostics is 404, and protected diagnostics reports
  `alive_idle`. Alembic is `20260823_0028 (head)`.
- Targeted image cleanup retains only the deployed Chat Reader generation and
  its direct rollback generation. No production volume, database, environment
  file, backup, import storage or unrelated image was removed. Authenticated
  production UI remains `NOT VERIFIED`.

## 2026-08-23 Rule-library existing-conversation review

- Content Cleanup now exposes an explicit rule-library action for one-shot
  `BATCH / ALL_ACTIVE` background review. The target snapshot includes active
  conversations in projects and the default/unclassified area, and excludes
  archived or deleted conversations.
- Each scan snapshots the enabled rule revisions in
  `content_cleanup_scan_rules`; disabling or editing a rule after the scan
  starts does not change that scan. The worker processes bounded chunks and
  requeues low-priority noise work so imports and interactive jobs remain
  responsive.
- Scan progress reports total, project and unclassified targets, archived
  exclusions, processed messages and candidate count. The existing review
  dialog is reused; every actionable occurrence defaults to `DELETE` (selected)
  and is removed with its scan after successful apply or ignore. Protected or
  stale occurrences remain unselected. No confidence or similarity
  fields are part of the current model/API.
- Alembic source head is `20260823_0028`, adding per-scan rule snapshots and
  archived-exclusion progress while removing the current occurrence
  confidence/similarity columns. Production runs this head and the externally
  built image set for source `6f674cb` created at `2026-08-23T11:52:16Z`.
- GitHub Actions run `32637260713` passed the complete quality and image jobs
  for source `6f674cb`. Dynamic API reads now bypass browser HTTP caching, and
  cleanup refreshes the focused source editor before broad Reader invalidation,
  so an applied MessageVersion is visible without a page refresh.
  Production API, worker, Web and PostgreSQL are healthy; public health is 200,
  anonymous cleanup access is 401, public internal diagnostics is 404 and the
  protected diagnostic reports `alive_idle`. The pre-deploy five-component
  backup is retained, and the server keeps only the current image generation
  plus the one it replaced. Authenticated production UI is `NOT VERIFIED`.

## 2026-08-23 Layered content-noise detection (pre-scan baseline)

- Source Editor cleanup now evaluates active built-in and user rules inside the
  selected MessageVersion range before using a manual-selection fallback. A
  complete citation selection retains structural detector authority; a partial
  selection expands to the complete candidate and stays unselected for review.
- Built-in citation recognition combines exact private/visible grammar with
  narrowly bounded syntax-token normalization. A tolerant candidate still
  requires an exact `turn...search/news/view...` reference sequence. User rules
  support raw exact, NFKC/case/whitespace normalized and anchored approximate
  modes plus anywhere, whole-line and block-end boundaries.
- The pre-scan production baseline recorded detector version, match mode and
  evidence codes without storing message copies. The current implementation
  supersedes its confidence-based presentation: every occurrence is now an
  explicit review item; actionable occurrences now default to `DELETE`.
- Markdown protection covers variable-length fenced/inline code, indented code,
  math, link destinations, reference definitions, autolinks and asset URLs.
  Apply rechecks the current role, immutable MessageVersion range and detector
  evidence before creating a normal replacement version.
- The pre-scan source head was `20260823_0027`; the current source head is
  `20260823_0028` as documented above. No new dependency or automatic
  deletion path was added.
- Final local evidence for the complete scope is focused cleanup API `17
  passed`, full API `368 passed / 5 skipped`, browser/PWA `76 passed / 71
  conditional skipped`, Web lint/typecheck/build PASS, dependency policy PASS
  with zero high or critical advisories, and `git diff --check` PASS.
- GitHub Actions run `32588592205` passed on attempt 2. Attempt 1 completed the
  API, migration, dependency and first three CSP checks before bundled Chromium
  exited with `SIGSEGV` while creating the final isolated browser context; the
  exact-source rerun passed every browser gate and image construction. The
  deployed images were built at `2026-08-22T18:00:33Z`.
- Production migrated to `20260823_0027`; API, Web and PostgreSQL are healthy,
  the worker reports `alive_idle`, public health returns 200, anonymous cleanup
  access returns 401 and public diagnostics returns 404. A production-container
  synthetic smoke verified private, normalized and bounded-fuzzy citation
  behavior plus the ordinary-prose and separate-inline-code negative cases.
  The current five-part backup is retained, transfer caches were removed and
  exactly the current and immediately replaced Chat Reader image generations
  remain. Authenticated production UI was not claimed without an owner browser
  session; the same production build passed the isolated cleanup browser gate.

## 2026-08-22 Final Chat Reader consolidation

- Chat Reader is the only product and runtime boundary. The retired standalone
  normalization gateway has no tracked dependency, package link, submodule,
  HTTP call, container, environment variable, route or deployment service in
  this repository. The former sibling project was made unavailable before
  install, migration, build and focused Adaptive Import tests passed, and its
  remaining processes and files were then removed.
- The product import surface is Adaptive JSON/Markdown plus independent `.cr`
  archive restore. `.crbundle`, download-first conversion, standalone result
  pages and duplicate Mapping pages remain removed; the sole route regression
  deliberately asserts that the retired `.crbundle` endpoint returns 404.
- Adaptive Import now records the full session lifecycle: collection starts in
  `COLLECTING`, analysis enters `ANALYZING`, a validated plan queues as `READY`,
  worker ownership enters `IMPORTING`, and bounded terminal failures enter
  `FAILED`. Item-level invalid input remains recoverable in `RESOLVING` and
  cannot globally revive the retired `BLOCKED` behavior.
- Final local gates after removing the sibling project: API `358 passed / 5
  skipped`, default PWA/Playwright `75 passed / 72 conditional skipped`,
  Adaptive Import browser `3 passed / 1 real-file condition skipped`, Content
  Cleanup browser `1 passed`, Web lint/typecheck/build PASS, clean and current
  database migration PASS, dependency policy PASS with zero high/critical
  advisories, and Alembic single head `20260822_0026`.
- The final consolidation image set was built at `2026-08-22T14:47:26Z` after
  GitHub Actions run `32578788677` passed on attempt 2. Attempt 1 reached the
  final PWA matrix before the bundled Chromium process exited with `SIGSEGV`;
  the rerun passed quality and image construction without a product change.
  Production now runs the final API, worker and Web images, Alembic current is
  `20260822_0026`, public health is 200, private cleanup/import APIs deny
  anonymous requests, and public diagnostics remains 404. The protected
  loopback diagnostic reports `alive_idle` with a recent worker heartbeat.
- The retained final backup contains a readable PostgreSQL custom dump and
  readable imports, exports, offline and assets archives. The interrupted
  partial backup and deployment transfer cache were removed. Production keeps
  exactly the current and immediately replaced Chat Reader image generations;
  PostgreSQL, business volumes, `.env.production` and the retained backup were
  not modified by cleanup. Authenticated production UI acceptance remains
  `NOT VERIFIED`; the same production build passed the isolated browser gates.

## 2026-08-22 Content cleanup rules and asynchronous review

- Content cleanup now uses a server-side rule registry and immutable rule
  revisions. Built-in citation, exporter-footer and thinking-summary detectors
  plus user literal rules share one deterministic scanner; no user regular
  expressions, scripts or message copies are persisted.
- The primary cleanup entry lives in the Markdown Source Editor. The owner
  selects persisted source text and opens a centered review dialog; the server
  records only the current MessageVersion identity and Unicode code-point
  offsets. Dirty editor text must be saved before it can be reviewed.
- The same review surface can still scan a current, selected-active or
  all-active scope when invoked by a background/import task. Archived
  conversations are rejected while creating targets, scanning and applying.
- Scan occurrences store only message/version identity, Unicode offsets,
  line/column metadata, rule revision and decision. Preview context is derived
  from the current MessageVersion and is marked stale when that version changes.
- Import commits enqueue a low-priority, chunked `content_noise_scan` after the
  canonical import. Import success does not depend on scanner availability;
  the task monitor exposes progress, review and ignore actions without a modal
  interruption.
- Applying cleanup revalidates versions, protects code/math/link/asset regions,
  creates normal MessageVersion history and rebuilds search/TOC. There is no
  cleanup-specific undo; existing MessageVersion history remains authoritative.
  Zero-match, successfully applied and explicitly ignored scans are deleted
  with their occurrence rows. The dialog contains the single rule-library entry for viewing,
  disabling and deleting unused user literal rules.
- Alembic head is `20260822_0026` and there is no additional dependency.

## 2026-08-22 Adaptive Import recovery UX

- A source-analysis failure is now scoped to its `InputGroup`. An `INVALID`
  Family keeps the session in `RESOLVING`, so valid UNKNOWN/DRIFTED Families in
  the same batch can still be mapped and completed. `BLOCKED` is reserved for
  legacy or genuinely unrecoverable session state rather than ordinary bad
  input.
- Import Overview shows the affected files and a specific recovery action.
  The owner can replace one source file in place, exclude one conversation
  group, reopen Group Resolver, or reanalyze a legacy blocked session without
  discarding completed Profile work. The final Import action remains disabled
  until every included group has a safe normalization path.
- Replacement and exclusion use commit-before-cleanup filesystem semantics:
  database/session reanalysis commits before superseded temporary source files
  are removed. The last remaining group cannot be excluded. No Conversation,
  attachment, schema or canonical persistence contract changed.
- The reported three-file selection was reproduced read-only in the browser:
  explicit grouping produced one JSON/Markdown pair plus one standalone
  Markdown conversation, both Families were mapped in the same session, and
  the two-conversation plan reached `READY` in about 2.1 seconds. The sources
  were not committed as Conversations. The recovery regression additionally
  covers a valid Family beside malformed JSON, continued Mapping, exclusion,
  replacement and transition to `READY` without restarting the session.
- GitHub Actions run `32550720450` passed on its second attempt. The first
  attempt had already passed the new Adaptive Import browser gate, then the
  bundled Chromium process crashed with `SIGSEGV` while opening the final CSP
  test context; the exact-source rerun passed every quality and image-build
  step. That recovery-stage image set was built at `2026-08-22T04:19:59Z` and
  has since been superseded by the final consolidation deployment recorded
  above.

## 2026-08-22 Adaptive Markdown role-boundary fix

- Adaptive Import now recognizes deterministic Chinese line-label roles such as
  `用户` and `AI助手`, and treats emphasized model-name decorations such as
  `ChatGPT *(model-name)*` as role metadata rather than a distinct role.
- Markdown normalization uses only the role labels confirmed by the mapping.
  Same-level headings and colon-ended prose inside a message therefore remain
  message content instead of becoming false boundaries.
- The reported three-file workflow was reproduced without persisting its
  source data. After explicit grouping, the JSON/Markdown pair normalizes to
  five messages and the standalone formula Markdown normalizes to two; the
  session can resolve both Families and reach `READY` instead of `BLOCKED`.
- GitHub Actions run `32544978132` passed quality and image-build jobs. The
  production image set was built at `2026-08-22T02:09:40Z`; API, worker and Web
  are healthy, public health returns 200, and Alembic remains
  `20260822_0025 (head/current)`.
- The verified five-component pre-deploy backup is retained at
  `/opt/chat-reader/backups/import-role-fix-20260822T021617Z-8b5b0e4`.
  Production retains the current image generation and the immediately replaced
  generation only; the older third generation and old transfer archive were
  removed without touching PostgreSQL or business volumes.

## 2026-08-22 Adaptive JSON / Markdown Import

- Chat Reader now owns one deterministic adaptive-import pipeline:
  source files are analyzed into InputGroups and session-local
  StructureFamilies, resolved through Built-in or Learned Profile revisions,
  normalized into the existing `CanonicalConversationDraft`, validated across
  the full Family, and committed through the existing canonical persistence
  service. No converted download/re-upload step remains.
- The user-facing Import surface contains only `JSON / Markdown` and `.cr`.
  Single JSON, single Markdown, paired sources and batches are supported.
  Ambiguous mixed-file pairing enters a conditional Group Resolver; normal
  known formats do not expose grouping or Mapping workspaces.
- Built-in profiles cover the formats already supported by Chat Reader:
  Native JSON/Markdown, CanJSON v1/v2 and Prompt/Response Markdown. Unknown
  structures can create a Learned Profile only after full-family validation.
  Required-field or semantic drift creates a new immutable revision; verified
  historical revisions remain match candidates.
- Mapping separates message locator, role source, role value conversion,
  content, relation and noise rules. Unknown roles, competing profiles,
  incomplete relations and invalid canonical drafts fail conservatively.
  Profile signatures contain no conversation body.
- The integrated UI uses the existing Chat Reader dialog, overlay, form,
  token and settings patterns. Import Overview, conditional Group Resolver,
  unified Mapping Workspace, canonical Preview and actionable Diagnostics
  replace the retired standalone conversion workbench.
- `.crbundle` import UI, API, parser, result/download workflow and dedicated
  tests are removed. Ordinary attachments, AssetObject behavior, Share,
  Offline and independent `.cr` archive restore remain supported.
- Alembic source head is `20260822_0026`; migrations `20260822_0025` and
  `20260822_0026` add adaptive session grouping and content-cleanup review,
  Family, Profile and immutable revision persistence without changing the
  Conversation canonical schema. The retired Gateway's SQLite profile tables
  were empty, so no historical user mapping data required migration.
- Production deployment completed from GitHub Actions run `32534425663` on
  `master` at build time `2026-08-21T22:57:53Z`. API, import worker and Web
  run on the immutable image set for commit `8b5b0e454ea244936eafa1b6f921d5c66ee5a873`;
  the production schema is `20260822_0025 (head/current)` and public health
  returns 200. The pre-deploy recovery point is retained at
  `/opt/chat-reader/backups/adaptive-import-predeploy-20260821T231241Z-8b5b0e4`.
  The server keeps only this image generation and the immediately previous
  `95a665d` rollback generation; older Chat Reader images were removed.
- The production Adaptive Import API remains owner-authenticated: an
  unauthenticated session request returns 401. Production logged-in browser
  acceptance of an unknown-family Mapping flow is not claimed without an
  approved browser-control session; local and CI browser flows are the current
  evidence for that path.

## 2026-08-22 Current-project drop target and project workspace

- An open Project page is now a first-class sidebar conversation drop target.
  Dropping an unclassified or cross-project conversation into the right-hand
  workspace keeps the current URL and scroll context, updates the destination
  list immediately and reports success without navigating the Reader.
- Optimistic project-list entries always include a valid `project_relation`.
  A failed placement restores the project, project-conversation and sidebar
  conversation caches together and reports a localized retryable error.
- The desktop Project workspace now separates title/count authority and list
  controls from its compact divided conversation list. During a conversation
  drag, an amber-to-accent target layer names the current project and does not
  occupy layout or intercept input outside the drag. Existing menu and keyboard
  movement remain the non-pointer alternatives.
- No API, database schema, dependency, Reader, Files or Share contract changed.

## 2026-08-21 Large import and semantic Markdown copy deployment

- The scoped import-pairing and Reader Markdown-copy changes are deployed from
  the current `master` commit. The exact CI run passed both quality and image
  build jobs; the production API, worker and Web are healthy on the new image
  generation, with the previous generation retained for rollback.
- Production Alembic remains `20260817_0024 (head/current)`. The pre-deploy
  backup at `/opt/chat-reader/backups/import-copy-20260821T140915Z-95a665d`
  contains the PostgreSQL dump plus imports, exports, offline and assets
  archives; the dump and archive listings were readable before replacement.
- Nginx now includes the versioned exact `/api/imports/preview` location with
  a 110 MiB request limit; the global 60 MiB limit remains unchanged for all
  other routes. Unauthenticated preview requests continue to fail closed.
- The real Desktop JSON/Markdown pair previews locally as 66 messages with
  `exact_match` in about 1.2 seconds. Production authenticated preview and
  clipboard acceptance remain pending until an allowed logged-in browser
  control session is available; no owner credential or session token was
  extracted or recorded.
- Local and production Chat Reader images retain only the current generation
  and the immediately previous rollback generation. Unrelated Docker images,
  containers, volumes and user worktree changes were preserved.

## 2026-08-21 Large paired imports and semantic Reader copy

- JSON/Markdown pairing now takes a linear path when every non-empty JSON
  message has one unique, ordered role/timestamp match. Untimed
  `Prompt`/`Response` headings that appear inside message bodies no longer
  force the bounded similarity search; timed extras, duplicate identities and
  ambiguous inputs retain the existing explicit rejection path.
- Import Preview accepts at most one JSON plus one Markdown file, with the
  existing 50 MiB limit applied to each file before parsing. The production
  proxy grants 110 MiB only to the exact `/api/imports/preview` route; other
  routes retain their smaller request limit.
- Owner, public Share and Offline Readers share one semantic Markdown copy
  boundary. A selection may span rendered blocks and messages; complete blocks
  use canonical rendered Markdown while partial selections preserve inline
  Markdown semantics such as emphasis, links, code, lists and quotations.
  Long-message virtualization pins only the active selection range and resumes
  its normal bounded window after the selection is cleared.
- No migration, dependency, visible control or persisted Reader/offline
  contract changed.

## 2026-08-18 Public Share and reference-style conversation search

- The post-audit product enhancement is deployed: the explicit
  `/share/{token}` page and `/api/shared/{token}/*` capability surface are
  public-by-link by default, while the owner password remains required for
  private application routes. Share passwords are optional, independently
  Argon2id-hashed credentials; they never create or reuse an owner session.
- Password-protected Shares use a Share-scoped HttpOnly unlock cookie and
  server-side unlock session with revocation on password change/removal. Share
  resources continue to be resolved through the exact Share scope. The public
  Share page does not register the owner PWA service worker and responses are
  non-cacheable.
- Current-conversation search now requests canonical message results by
  default, returns message-version and per-occurrence block/offset/quote
  anchors with contextual plain-text snippets, and keeps a persistent exact
  match previous/next navigation context after a jump.
- Alembic revision `20260817_0024` adds only Share password and unlock-session
  state. The deployed production runtime has passed focused Share/search/auth
  tests, the full API suite, Web lint/typecheck/production build and CI.
  Production acceptance covered direct passwordless viewing, wrong/correct
  Share-password behavior, revocation, and exact search occurrence navigation
  with previous/next and return-to-results state. A small manual-conversation
  indexing fix ensures newly created conversations are searchable immediately.
  All disposable QA conversations and Shares used for this acceptance were
  removed through the product UI.

## 2026-08-17 Deployed baseline and final product audit

- Release N deployed one owner-password gate with a future-compatible
  principal/session boundary, not multi-user accounts. The current production
  runtime is the authenticated Release N baseline.
- Sessions use an Argon2id owner credential, a server-side HMAC digest of a
  cryptographically random opaque cookie token, per-session 48-hour sliding
  inactivity and a bounded 10-minute activity touch interval. No plaintext
  password or raw token is persisted.
- Business API routes are protected by default when authentication is enabled;
  public health and the minimal login/session/logout endpoints are explicit
  exceptions. Share and artifact routes are not bypasses. Unsafe mutations
  require same-origin requests, and authenticated responses are no-store.
- The PWA may cache its shell but removes protected IndexedDB/Cache Storage
  state on logout or rejected session. A non-credential browser marker makes
  ordinary cookie clearing lock offline content; it cannot authorize server
  requests. Production is fail-closed and the owner credential is provisioned
  only through the operator path.
- Alembic revision `20260817_0023` adds the single owner, session and bounded
  login-throttle records. Final isolated evidence is `8` focused auth tests,
  `319` API tests (`7` skipped), `3` auth browser tests, the default PWA
  matrix (`72` passed, `69` scoped skips), and the Release E PWA negative
  matrix (`10` passed), with lint, typecheck, production build,
  dependency/security policy and migration head/current all passing.
  Release N completed exact-SHA CI, deployment and production acceptance.
- File reads now enforce controlled paths, existence and declared byte size
  without recomputing SHA-256. Database digest fields, content-addressed names,
  password/session/Share security hashes and digest generation remain intact.
  Current CI, deployment and backup reporting no longer treats a separately
  repeated human SHA/checksum confirmation as a release gate.

## 2026-08-17 Final product audit complete

- `FINAL_PRODUCT_AUDIT = PASS`; the user-centric audit found no P0 product,
  security or data-integrity defect. The only selected P1 runtime change was
  Reader attachment metadata reuse; current deployment and authentication
  documents were synchronized as an evidence-only change.
- Attachment-rich Reader turns now embed the already authorized attachment
  metadata loaded with their occurrences, avoiding one metadata request per
  inline block. Owner and Share responses use their respective content URL
  prefixes; offline and legacy payloads retain their existing query fallback.
- CI run `32021895498` passed for exact source `cb70e0a`; production now runs
  that artifact and remains healthy with Alembic `20260817_0023` at head.
- Production read-only audit and the disposable QA golden path passed for
  Reader, Share creation/revocation, logout/login and protected-route/PWA
  cache behavior. The QA conversation was deleted through the product UI.
- No P0 items remain. P1 selected: 2, implemented: 2. P2 speculative Reader
  virtualization and broad architecture/performance rewrites remain
  intentionally unimplemented. No new migration or dependency was added.
- Large-scale Reader virtualization, architectural rewrites and speculative
  performance work are intentionally not selected. Proactive optimization is
  now stopped; future work is usage-, measurement- or security-triggered.

## 2026-08-17 Release M disaster-recovery closure

- `RELEASE_M = PASS`; `RELEASE_N = NOT_STARTED`. This was a restore drill in
  two fresh, isolated recovery environments and did not cut production traffic.
- Current production authority remained runtime source
  `baca93bdf6f2965c4f5614e296c12d337efc1a0a`, schema `20260816_0022`, with
  public health 200 and unchanged API/Web/worker/PostgreSQL image identities.
- Backup `release-m-20260816T161711Z-baca93b` contains the PostgreSQL custom
  dump plus imports, exports, offline and assets archives. PostgreSQL and
  archive readability/listing verification passed; the backup is retained.
- Recovery targets `chat-reader-release-m-recovery-a` and `-b` used distinct
  projects, networks, databases, ports and named volumes. Preflight rejected
  production identity reuse and passed isolation before either restore.
- Both restores reached schema `20260816_0022`, healthy API/Web/worker state,
  matching aggregate and storage counts, 228 physical-object checks with zero
  missing/size mismatches, zero canonical dangling references and zero
  missing required files. Dedupe groups and active-unreferenced attachments
  were preserved; transient upload references remained zero.
- Restored historical heartbeat state was stale before worker startup; a new
  worker heartbeat reached `alive_idle`, and a normal recovery QA job produced
  `alive_busy` then returned to idle. The recovery browser smoke covered
  Library, Reader and Source Editor without recording user content.
- Recovery resources were removed by exact project/volume identity only;
  production resources removed by the drill: `0`. The executable procedure is
  `docs/system/DISASTER_RECOVERY_RUNBOOK.md` with `deploy/recovery_preflight.py`
  and `deploy/recovery_integrity.py`.

## 2026-08-16 Release L final closure

- At the Release L checkpoint, `RELEASE_L = PASS` and Release K remained
  `PASS`; Release M was not started at that time. The current Release M state
  is recorded above.
  Runtime work was committed and pushed from an isolated worktree, preserving
  the externally modified main worktree. Production now runs exact source
  `baca93bdf6f2965c4f5614e296c12d337efc1a0a` from Actions run `31948357231`
  and immutable artifact `9264075894`.
- The single worker now emits a worker-owned heartbeat independent of job
  traffic: immediate startup registration, 30-second idle/busy pulses and a
  120-second stale threshold. A background publisher continues during long
  synchronous work. Worker liveness commits separately from the active task
  heartbeat, and replaced instances cannot overwrite the current instance or
  continue claiming new tasks after ownership loss.
- Diagnostics now reports `alive_idle`, `alive_busy`, `stale` or `unavailable`
  from server-time worker heartbeat state. It separately reports aggregate
  processing-task count, task family and last task heartbeat age; old job
  completion never proves worker liveness.
- Protected diagnostics uses two enforced boundaries: public Nginx returns a
  concealed non-cacheable 404 for `/api/internal/diagnostics`, while the API
  route requires both enablement and a loopback client. Authorized access is
  the existing SSH public-key plus API-container loopback path. No public HTTP
  credential, frontend link or mutation endpoint is added.
- Alembic revision `20260816_0022` adds the bounded
  `worker_runtime_states` operational table; canonical data, Dexie and Offline
  formats are unchanged. Isolated PostgreSQL downgrade/upgrade and head/current
  verification pass. Focused observability/liveness is `27 passed`; full API is
  `303 passed / 6 skipped` against the isolated final-head database. Web lint,
  typecheck, Next `16.3.1` Webpack build and dependency policy pass with zero
  high/critical findings. Production backup
  `/opt/chat-reader/backups/release-l-predeploy-20260816T131149Z-baca93b`
  passed PostgreSQL restore-listing, five archive listings and six SHA256
  checks. API/worker use image
  `sha256:818c37bc703344ff6ce291c79a805832ad6ab4f24433323c6193622b24857395`;
  Web uses image
  `sha256:83ee77cc5b7b69b90fda804555f6eb3803063491f34aa19f4db50df968ae39a8`.
  Production Alembic is `20260816_0022` at head/current. Public health is 200;
  public diagnostics is denied; SSH public-key plus API-container loopback
  diagnostics returned `alive_idle`, while a disposable product QA rebuild
  observed `alive_busy` and returned to idle before product-API cleanup. No
  sensitive diagnostics fields or post-deploy API/worker error log lines were
  observed.

## 2026-08-16 Release K residual production verification closure

- `RELEASE_K = PASS`; `CURRENT_VERIFICATION_DEBT_COUNT = 0`; known product
  defects and unknown/unclassified candidates are zero. Release A-J remain
  `PASS`, and Release L is explicitly not started.
- Production continues to run immutable runtime source
  `7bcd686b59d62fb9907ba09d644637b7af2b3d86`. API and worker use image
  `sha256:e7800d1a86f9973db3642add2f3236e721846f9d4426f74da54e7da0b0f0b8ea`;
  Web uses `sha256:dae7507d89a66ffc086cc3971e2de57907af2781279c19f3f480b35031d66654`.
  Release K changed no runtime or test-tooling source and required no production
  redeploy. Release J Actions run `31936666151`, artifact `9260977100`, running
  image identity, public application availability and Alembic head/current
  `20260806_0021` remain the release authority.
- The Chrome extension control surface was recovered. The operator changed the
  dedicated production Chrome profile with native browser Page Zoom, while the
  controlled page independently verified exact DPR/CSS viewport ratios against
  the original 100% baseline: `1.05 / 1830px` at 100%, `1.3125 / 1464px` at
  125%, `1.575 / 1220px` at 150%, and `2.10 / 915px` at 200%. The profile was
  restored to the exact 100% baseline afterward. No CSS zoom, transform,
  device-scale, viewport-only or CDP page-scale substitution was used.
- Native 125%, 150% and 200% production checks pass. At 200%, Library, long
  Reader content, Source Editor, Files Panel, image/Markdown/PDF Viewers, Share,
  core dialogs and keyboard focus remain usable. Save, upload, Close, Download
  and primary navigation controls are reachable; dialog focus supports
  Tab/Shift+Tab and Esc restoration. Every checkpoint reported zero page-level
  horizontal overflow; intrinsic document/table/code content retains local
  scrolling where needed. PDF rendered a nonblank canvas with real controls.
- Production Mermaid rendered a complete data-URI SVG image with nonzero
  dimensions and remained within the 200% Reader shell. Online Viewer fixtures
  for DOCX, ODT, XLSX, ODS, PPTX and ODP all selected the expected Viewer path,
  rendered supported content, retained Download, exposed exactly one accessible
  Close, closed with Esc and restored focus. The fixture matrix recorded zero
  CSP violations and no fatal Viewer error.
- The disposable Mermaid QA Conversation was permanently deleted through the
  product UI and was absent after a fresh navigation. Recoverable Chrome issues
  (an extension popup, a OneTab tab handoff, and a transient click timeout) were
  resolved by reconnecting or creating a fresh controlled tab; they caused no
  product or data failure.
- Final reconciliation retains 40 discovered candidates: 26 are now closed
  (19 by Releases A-J and seven by Release K), eight remain deferred by design,
  and six remain conditional/external future tracks. Worker heartbeat and
  protected diagnostics remain Release L work; automatic cleanup remains
  disabled for Release N; strict nonce/reporting remain Release O work;
  AssetObject GC and Turbopack remain conditional future tracks.

## 2026-08-16 Release J cleanup first-apply closure

- `RELEASE_J = PASS`. Release J used the existing cleanup engine without a
  runtime change or production redeploy. Production continues to run immutable
  Release I source `7bcd686b59d62fb9907ba09d644637b7af2b3d86`; actual
  API/worker/Web image identities still match that release and Alembic remains
  `20260806_0021 (head/current)`.
- Cleanup authority is limited to the configured Export and Offline roots, a
  24-hour technical grace window, canonical DB/job/path checks, opaque tokens
  and a fresh per-object reclassification. Automatic cleanup stays disabled;
  AssetObject/Attachment/business-file GC remains out of scope.
- Focused cleanup/lifecycle tests passed `32` with one local Windows symlink
  capability skip. Exact-SHA Actions run `31936666151` on test/evidence commit
  `81fb441f51984330042625aac4dabddfd78b0ebc` passed the Linux cleanup matrix,
  full API/Web/Alembic/dependency/browser/PWA gates and artifact packaging.
- Verified backup
  `/opt/chat-reader/backups/release-j-precleanup-20260816T081840Z-7bcd686`
  contains PostgreSQL plus imports, exports, offline and assets; all five
  checksums, the PostgreSQL restore listing and four archive listings passed.
- Two production dry-runs and a final pre-apply scan returned the same four
  `ORPHAN_FINAL` identities totaling `659,673` bytes. The bounded first apply
  requested and deleted exactly those four objects with zero failed, changed
  or already-absent results. Post-apply eligible categories were all zero.
  Replaying the same old authority deleted zero and skipped all four stale
  tokens, proving idempotency.
- Canonical state before/after apply is unchanged: 79 AssetObjects, 88
  Attachments, 81 MessageVersion occurrences, 18 Export artifacts, 19 Offline
  artifacts and 67 Import records. Every canonical Export/Offline file exists
  with its declared size. Business Attachment, AssetObject, active-job,
  retained Export, current Offline and Share-required deletions are all zero.
- Isolated production Chrome passed Library, Reader, Source Editor upload/save,
  Markdown Viewer, Files Panel, Share focus, Offline catalog and committed
  Export download with zero CSP violations. The new publication was proven
  protected from cleanup before the disposable QA Conversation was deleted by
  the product API with 404 readback. Its recent 5,902-byte final file remains
  `UNSAFE_PROTECTED` under the grace contract and is not a cleanup candidate.
- Durable contracts: `docs/system/CLEANUP_CONTRACT.md` and
  `docs/system/ARTIFACT_LIFECYCLE_CONTRACT.md`.

## 2026-08-16 Release I upload-token atomicity closure

- `RELEASE_I = PASS` and `READY_FOR_RELEASE_J = YES`. Production runtime source
  is `7bcd686b59d62fb9907ba09d644637b7af2b3d86`; `cr-upload://` is editor-local
  only, CodeMirror is the authoritative save document, and successful
  canonical source may contain only finalized `cr-asset://` references.
- The editor distinguishes upload completion from canonical replacement,
  blocks all shared save paths while either state is unresolved, rereads the
  live CodeMirror document at submit time, and applies exact token-identity
  replacements outside editor history. The API independently returns a
  structured 422 `transient_upload_reference` and rolls back create, insert or
  edit mutations containing an active transient Markdown destination. Code
  literals remain valid user content.
- Final local evidence is API atomicity/scanner `15/15`, deterministic
  production-build Chromium upload matrix `18/18` with zero scoped skips, and
  isolated PostgreSQL Alembic head/current `20260806_0021`. The browser matrix
  covers chooser before and after lazy CodeMirror creation, drag/drop,
  clipboard, fast/slow and out-of-order completion, partial failure/retry,
  typing, cursor/selection/scroll, delete-before-completion, undo/redo and
  canonical draft retention after 409/500.
- Final-source regression evidence is full API `285 passed / 5 skipped`, CSP
  `4/4`, focused Reader/Rich/security `36/36`, Share `2/2`, mutation `2/2`,
  Markdown/image Viewer `1/1`, PDF `3/3`, default PWA `72 passed / 65`
  unrelated conditional skips, and scoped PWA negative `10/10` with zero
  scoped skips. Lint, typecheck, the Next `16.3.1` Webpack production build,
  dependency policy and the zero high/critical security gate also pass.
- The first immutable candidate exposed one additional real ordering defect:
  a chooser event could queue before lazy CodeMirror creation, then the
  controlled-value effect could overwrite the inserted transient marker with
  the baseline document. The final fix synchronizes both editor mirrors from
  the exact live document after insert, canonical replacement and removal;
  deterministic `I-RACE-002A` covers this ordering.
- An observed Windows-only concurrent `python-magic` initialization failure is
  serialized at the optional detector boundary; the signature/mimetype
  fallback and Scanner-disabled production policy are unchanged. Upload
  finalize is idempotent for a committed item and retry remains single-flight.
- Release I adds no runtime dependency, Alembic migration, Dexie migration or
  Offline package format change. The normal production bundle exposes no test
  fault bridge. Next `16.3.1`, React `19.2.8`, PDF.js `6.2.108`, Webpack and the
  enforced CSP remain frozen.
- Actions run `31934088629` passed on exact SHA `7bcd686...`. Independently
  verified archive SHA-256 is
  `dd082f902e4c84cb2a1466735da80dd2659119f087518703b98838b2f66c04f8`.
  API/worker/migrate image identity is
  `sha256:e7800d1a86f9973db3642add2f3236e721846f9d4426f74da54e7da0b0f0b8ea`;
  Web is
  `sha256:dae7507d89a66ffc086cc3971e2de57907af2781279c19f3f480b35031d66654`.
  King bound the immutable commit tags, migrated with the exact API image and
  actual API/worker/Web identities match the manifest.
- Verified backup
  `/opt/chat-reader/backups/release-i-final-20260816T074726Z-7bcd686` contains
  PostgreSQL plus imports, exports, offline and assets; restore/listing and
  SHA-256 checks passed. Release H immutable images and backup remain direct
  rollback.
- Production Chrome passed three independent real chooser/upload/save/reload
  flows with canonical API readback and Viewer open, plus isolated PWA offline
  startup/reconnect. Legitimate-path CSP violations were zero and all QA
  Conversations were deleted through the product API with 404 confirmation.
  A post-deploy source-aware aggregate scan returned zero active transient
  references across all and current MessageVersions without emitting content,
  tokens or IDs; `DATA_REPAIR_REQUIRED = NO`.
- Durable contract:
  `docs/system/SOURCE_EDITOR_UPLOAD_ATOMICITY_CONTRACT.md`.

## 2026-08-16 Release H CSP enforcement closure

- `RELEASE_H = PASS`. Production source
  `da160a9c9a34dfe670fc67262cf3c8c9eedba07a` has one application CSP authority
  in `apps/web/next.config.mjs` and emits one enforcing
  `Content-Security-Policy`; Report-Only and `X-Powered-By` are absent.
- The policy is derived from the actual resource graph: same-origin Next/API,
  local KaTeX fonts, same-origin Service/PDF/Search/complex workers, Mermaid
  data images, Offline/Viewer blob images and media, and the Shiki Oniguruma
  Wasm engine. External runtime origins are zero. Wildcards, external scheme
  sources, blob workers, data fonts and production `'unsafe-eval'` are absent.
- Next's two nonce-less inline bootstrap/RSC scripts require
  `script-src-elem 'unsafe-inline'`; 36 current runtime style sites require
  `style-src 'unsafe-inline'`. Inline event attributes are blocked with
  `script-src-attr 'none'`. Strict nonce/hashes are deferred with architecture
  evidence rather than forcing dynamic/PWA changes.
- A production-build Chromium harness passes `4/4` with zero skips: enforced
  header shape, actual external script/connect/image/object/frame and blob
  worker blocking, inline-handler blocking, and allowed local/data/blob/style/
  manifest/Service Worker resources. Markdown sanitizer browser evidence
  removes `javascript:` links and script payloads; direct inline-script CSP is
  disclosed as `POLICY_LIMITED`.
- Actions run `31906595581` completed SUCCESS on the final source. Quality
  passed locked install, lint, typecheck, Next `16.3.1` Webpack build, Release C
  `30/30`, API `282 passed / 4 skipped`, Alembic, dependency policy, CSP `4/4`,
  focused browser/security `36/36`, Share `2/2`, Source Editor/mutation `2/2`,
  Markdown/image Viewer `1/1`, PDF `3/3`, default PWA `72 passed / 53 unrelated
  conditional skipped`, and scoped PWA negative `10/10` with zero scoped skips.
  `build-images` ran only after quality and completed inspect/package/upload.
- The verified archive SHA-256 is
  `abb3f48ce6ab833fa9abb222a304b8c26ac42c458ab232e94789acbc3e0b32c5`.
  API/worker/migrate image identity is
  `sha256:a8604d1518a623eacc5171171d1105ff2eeb84f0371e93a3535f36a9d9264ba1`;
  Web is
  `sha256:0f37153f34d86fe514f0e58a14bf8f7a358e9f0975dbad64d3f529cc97915c66`.
  King bound immutable commit tags and the actual running identities match.
- Backup `/opt/chat-reader/backups/release-h-20260815T204036Z-da160a9`
  contains the PostgreSQL custom dump plus imports, exports, offline and assets
  archives. `pg_restore --list`, four archive listings and independent SHA-256
  re-verification passed before deployment. Alembic remains the single
  `20260806_0021` head; no database, Dexie or Offline package migration exists.
- Isolated production Chrome passed the deployed block probes, Reader scroll
  and no-blank-window smoke, Shiki/KaTeX/MathML, Source Editor cursor and
  canonical mutation reload, Markdown/image unified Viewer, PDF `6.2.108`
  real worker/nonblank canvas/authenticated `206` Range, desktop Share and the
  390x844 single-dialog/Escape/focus contract. A clean profile passed PWA
  offline startup and reconnect. Legitimate-path enforced CSP violations were
  zero, public `/api/health` is `200`, and its server-owned request ID correlates
  with `api_request_completed` without raw query logging.
- The Service Worker synthetic offline-incomplete 503 has its own locked-down
  CSP. Owner and Share attachment Range responses retain the API
  `default-src 'none'; sandbox` contract. Alembic, Dexie, Offline package,
  Next/React/PDF.js and Webpack remain unchanged. The pre-existing Source Editor
  upload-token replacement race observed during exploratory QA remains outside
  Release H; the user's overlapping uncommitted editor fix was preserved and
  was not staged into this release.
- Release G immutable API/Web images and verified backup remain the direct
  rollback source. `latest` is only a convenience alias, not release authority.
- Durable contract: `docs/system/CSP_ENFORCEMENT_CONTRACT.md`.

## 2026-08-16 Release G PDF.js maintained-line closure

- `RELEASE_G = PASS`. Runtime source
  `1b752b77063893feefef01756af9deda559f30a5` migrates the browser PDF engine
  from `pdfjs-dist 3.11.174` to official stable `6.2.108` using the modern ESM
  build. npm and Mozilla release provenance agree and the lockfile retains the
  official registry integrity.
- One browser runtime helper configures the same-package, same-origin
  `pdf.worker.min.mjs`. Production Chrome observed the real worker, embedded
  version `6.2.108`, nonblank one- and two-page canvases, Fit Page, Fit Width,
  110% custom zoom, page navigation, maximize/Escape and focus restoration.
  Owner and Share both retained authenticated `206` Range; out-of-scope Share
  access remained `404`.
- Offline remains cached-only. An isolated production Chrome profile created
  a real offline package, verified its IndexedDB identity, restarted through
  the service worker, opened the cached PDF offline with the local worker, and
  reconnected successfully. Missing/corrupt/worker-miss behavior remains
  covered by the Release E scoped matrix.
- PDF scripting remains disabled. The target removed the public
  `isEvalSupported` option, so Release G uses maintained-version protection,
  no scripting manager, `useWasm: false`, and a controlled malicious-file
  browser test that executed no application JavaScript. The obsolete PDF.js 3
  and canvas/node-pre-gyp/tar policy exceptions are removed.
- Actions run `31896564657` passed locked install, lint, typecheck, Next
  `16.3.1` Webpack build, API `282 passed / 4 skipped`, Alembic, dependency
  policy, focused browser `38/38`, PDF.js `3/3`, default PWA `68 passed / 53
  conditional skipped`, and scoped PWA negative `10/10` with zero scoped
  skips. Skips remain explicitly separate from PASS.
- The deployable archive SHA-256 is
  `0d3c460815a562f0e25aab5f0750bc46aa85b5a153ddcb52238018bf7cfeede4`.
  API/worker/migrate image identity is
  `sha256:d95bb99660f3bafd7e64ef7866e49947797ec26a55328671fdd7afe3044ac331`;
  Web is
  `sha256:6684742dbe6960d6ee4f4632b61048765407266344685c3fd616bce2e6c848e6`.
  All running identities match the manifest.
- King verified backup
  `/opt/chat-reader/backups/release-g-20260815T170643Z-1b752b7` with
  `pg_restore --list`, four business-volume archive listings and SHA-256.
  Deployment used immutable commit tags, migration preflight and
  `--no-build`; API/Web/PostgreSQL are healthy, worker runs, Scanner is
  disabled, `/api/health` is `200`, and Alembic remains the single
  `20260806_0021` head. Release F immutable images remain direct rollback.
- Production responses retain Release A headers, CSP Report-Only and a
  server-owned request ID; `X-Powered-By` is absent. Production Chrome also
  passed Rich Markdown/KaTeX/MathML, image/Markdown unified Viewer, Source
  Editor type/backspace, and desktop plus 390x844 Share focus contracts.
- An exploratory opt-in Markdown attachment upload exposed an existing
  upload-placement timing race (`cr-upload://` not yet replaced before save).
  The affected editor runtime files are byte-identical to Release F, so this
  is recorded as separate pre-existing debt rather than a PDF.js regression;
  Release G did not change or conceal it.
- Durable contract: `docs/system/PDFJS_MIGRATION_CONTRACT.md`.

## 2026-08-15 Release F Next 16 final closure

- The current worktree contains the Next 16.3.1 / React 19.2.8 migration and
  the minimal async `headers()`/route-params and React 19 ref-typing fixes.
  `BUILD_BUNDLER = WEBPACK`; Turbopack, PDF.js migration and CSP enforcing
  remain separate tracks.
- Local gates are PASS: locked install, lint, typecheck, Webpack production
  build, API `280 passed / 6 skipped`, Alembic current/head
  `20260806_0021`, and dependency policy with no unapproved Next runtime
  exception. Current-worktree focused browser evidence is `38 passed / 0
  failed` across the CI focused specs, including the 390x844 Share focus
  contract. The default PWA matrix is `68 passed / 50 unrelated conditional
  skipped`; the Release E scoped negative matrix is `9 passed / 0 scoped
  skipped`. Normal production chunks contain no PWA fault bridge.
- Final source is `c9ddae1e9cd5c94c406f357a152304105e6d20b0`, pushed to
  `origin/master`. Actions run `31887198941` passed the complete quality,
  image, inspect, package and checksum chain. The artifact archive SHA-256 is
  `739435634b6a4ebe52597d9db6887c3599c10a6fb5441f1032b01981923e5b84`.
  API/worker/migrate image identity is
  `sha256:4856d1a275c178418d2495dc0cd2b67cf9d94fe660c5100d7d4a84c5b2af0f9a`;
  Web is `sha256:d7ac14aa3c3f2955e109c6cd933cf3ac350992e0fe99b93071507674a4790670`.
- King independently recomputed the archive hash, retained Release E rollback
  images, and validated the complete backup at
  `/opt/chat-reader/backups/release-f-final-20260815T134803Z-c9ddae1`.
  PostgreSQL `pg_restore --list`, all four business archive listings and all
  five SHA-256 entries passed. The explicit Release F compose binding used
  immutable commit tags and `--no-build`; no `.env.production`, volume or
  database schema was changed.
- Running API, worker, migrate image and Web identities match the manifest
  exactly. API/Web/PostgreSQL are healthy, worker is running, Scanner is
  disabled, public `/api/health` is `200`, and Alembic current/head remains
  `20260806_0021`.
- Production headers include `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, CSP Report-Only and no `X-Powered-By`; `/api/health`
  returned a server-owned `x-request-id`. Isolated production Chromium passed
  shell/offline/reconnect, Reader KaTeX/MathML, 390x844 Share focus,
  mutation/source-editor, generic attachment Viewer and a disposable PDF
  upload through the real PDF canvas. QA records were removed through the
  product API. A production CSP Report-Only listener observed zero violations
  on `/library` and Reader. `RELEASE_F = PASS`, `PRODUCTION_DEPLOYMENT = PASS`,
  `RUNNING_IMAGE_IDENTITY = PASS`, and `ROLLBACK_RELEASE_E = RETAINED`.
- Release F changes must be selectively staged. Existing API/editor,
  screenshots, storage and build-cache paths in the worktree are unrelated
  and remain untouched. Build logs and caches for this closure are kept in an
  operator-designated cache outside the repository.

## 2026-08-15 Release E PWA negative matrix and offline resilience

- Release E implements scoped Offline/PWA negative-path resilience without
  changing offline package format, Dexie schema, Alembic schema, Reader,
  Share, Viewer, Import, Export, cleanup, Next major, PDF.js or CSP policy.
  Runtime changes are limited to /library shell readiness, offline package
  client persistence safety, explicit offline attachment/viewer miss handling,
  test-only PWA fault instrumentation, and release workflow coverage.
- The /library service worker now checks critical active-shell resources
  before serving cached navigation while offline. Missing critical runtime
  assets return a standalone offline-incomplete page with a retry action instead
  of a generic client exception, blank page, spinner, or reload loop. Optional
  Skill markdown resources no longer make the whole shell unavailable.
- Offline package attachment bytes are written under immutable attachment id
  plus sha256 Cache Storage keys and verified by byte size and SHA-256 before
  use. Dexie commit failure, quota/cache put failure, truncated package,
  browser/SW restart, or corruption preserves the last committed package.
  Legacy identity-only cache keys remain readable.
- Offline file rows and the shared Attachment Viewer now surface
  offline_unavailable explicitly when cached bytes are absent, truncated, or
  corrupted. Error-state Viewer close/Esc/focus behavior uses the existing
  shell; offline misses do not enumerate server files, create derivatives, or
  widen attachment scope.
- Current local Release E evidence: scoped PWA negative browser matrix
  9 passed / 0 scoped skipped; the prior Release D default PWA baseline was
  67 passed / 50 skipped and the current full run is 68 passed / 50 skipped
  after adding the normal-bundle fault-bridge assertion. Full API is
  280 passed / 6 skipped, Alembic heads/current is 20260806_0021 (head), and
  the Release A security browser regression is 7 passed. Remaining default PWA
  skips are unrelated conditional flows and are not PASS.
- Final runtime source is `1591fd9bdab3d12d7928f6421845173cb1b1b81e` from
  Actions run `31874712687`. The complete quality -> image inspection ->
  checksum -> artifact chain passed. Archive SHA-256 is
  `ff07fdab24d729b173f3f1abc9facfe730f5ec88ea6a326445c64d3f1b633f1d`;
  API/worker/migrate image is
  `sha256:f360fefd4a4881e695bfb5a1a6a81f2f096adfbd2149981ca0191caaac6808f8`
  and Web is
  `sha256:f1d33ca458b3a2e6af249796972399c281feffce831eac00c4babadf9e2ed35f`.
- King verified the archive checksum and backup
  `/opt/chat-reader/backups/release-e-20260815T084805Z-1591fd9`. The PostgreSQL
  custom dump, imports/exports/offline/assets archives, archive listings and
  SHA-256 checks passed before explicit production-compose migration preflight
  and `--no-build` recreation. No schema or Dexie migration was added.
- Production API/Web/PostgreSQL are healthy, the worker runs, Scanner remains
  disabled and Alembic is `20260806_0021 (head)`. Actual public headers retain
  `nosniff`, the strict referrer policy, bounded Permissions Policy and CSP
  Report-Only; `X-Powered-By` remains absent.
- An isolated production Chromium profile verified an active Service Worker,
  75/75 critical shell resources, an offline `/library` reload with HTTP 200,
  390px reflow, online recovery and zero CSP violations. Read-only Reader QA
  rendered 22 blocks with 10 KaTeX and 10 MathML nodes, no page overflow or
  page error. Mobile More -> Share kept exactly one dialog and one Escape
  restored focus to More. `RELEASE_E = PASS`, `PRODUCTION_DEPLOYMENT = PASS`,
  `DEXIE_SCHEMA_MIGRATION = NONE`, and `NEW_ALEMBIC_MIGRATION = NONE`.

## 2026-08-15 Release D performance and capacity characterization

- Release D final source is `da0a79fd116b7a26e30bf2d1f57b1ff658a758f7` and
  Actions run `31865404393` completed the quality-gated external Linux
  characterization. Web lint/typecheck/build, API/Alembic, Reader capacity,
  import/export RSS, `.cr v4` export/restore, PostgreSQL plans and Release A/B/C
  regressions passed. The default PWA matrix was `67 passed / 50 skipped`;
  conditional skips remain separate from PASS.
- `RELEASE_D = PASS`, `PERFORMANCE_OPTIMIZATION_REQUIRED = NO`,
  `PERFORMANCE_OPTIMIZATION_CHANGES = NONE`, `RUNTIME_CHANGES = NONE`,
  `NEW_ALEMBIC_MIGRATION = NONE`, and `PRODUCTION_DEPLOYMENT = NOT_REQUIRED`.
  No core Reader, Markdown/KaTeX, import, export, `.cr v4`, database or runtime
  algorithm was changed. Large workloads ran only in the isolated Linux stack.
- Reader working sets stayed bounded across 398/1k/10k tiers (maximum observed
  26 mounted messages and 77 blocks); 10k is characterized-only. Short-message
  import stayed bounded without OOM; 10k Markdown export and few-huge import
  are documented capacity warnings. `.cr v4` current-like/2x/10x restore
  preserved canonical row and Attachment/AssetObject identity.
- The final evidence is in
  `docs/evidence/PERFORMANCE_CHARACTERIZATION_REPORT_2026-08-14.md` and the
  contract in `docs/system/PERFORMANCE_CAPACITY_CONTRACT.md`. Benchmark logs and
  artifacts were kept in an operator-designated cache outside the repository; no synthetic fixture
  entered the product bundle, PWA cache, King, or user data.

## 2026-08-15 Release C superseding production closure

- Runtime source is `e58b750357d92bba314737582a94493829c038e2`, pushed to
  `origin/master` and deployed from GitHub Actions run `31856041473`.
  Quality, image build/inspection, package checksum and artifact publication
  passed. The archive SHA-256 is
  `023c2eb4bea5e216c323a457454a627a3d4a72e7c4b9a99361f1501e59ed8a71`.
- API/worker/migrate image is
  `sha256:58868488dacf5722c3b12cc50cd191532067384e507dbb7d4a043672ff96570b`;
  Web image is
  `sha256:f814e1a2ac2c1d6df5aa9fc9418d9a7c42f57f9bb7472cb41b467df5fde0cea6`.
  King verified the archive checksum, used explicit production compose/env,
  ran migration preflight and recreated only API/import-worker/Web with
  `--no-build`.
- Verified backup is
  `/opt/chat-reader/backups/release-c-mobile-focus-20260815T013334Z-e58b750`;
  PostgreSQL custom-dump listing, imports/exports/offline/assets archive
  listings and SHA-256 checks passed. Alembic remains the single
  `20260806_0021` head; no migration or business-data mutation was added.
- Production health after deployment and targeted image cleanup is PASS:
  API/Web/PostgreSQL healthy, worker running, Scanner disabled, public health
  `200`, and public diagnostics remains intentionally `404`. Actual headers
  include `nosniff`, strict referrer policy, bounded Permissions Policy, CSP
  Report-Only and no `X-Powered-By`.
- A real 390x844 production Chrome regression found two simultaneously mounted
  Vaul sheets when More -> Share was opened. The fix immediately unmounts the
  inactive mobile sheet and routes Esc/X/backdrop close through the logical
  More trigger. Production Chrome now closes Share with one Esc and restores
  focus to the More button; desktop and mobile focused E2E both pass.
- Exact obsolete Chat Reader image tags for the prior runtime and intermediate
  diagnostics build were removed only after final health. Current `e58b750`
  and `latest` tags remain. The incomplete duplicate backup was removed; the
  verified backup, current release archive, all volumes, PostgreSQL,
  `.env.production` and user data remain. This is targeted image/archive
  cleanup, not business-data cleanup.
- Final Release C status remains `PASS`. `JOB_METRICS` is `PARTIAL_PASS` because
  an independently persisted idle-worker heartbeat is not derivable;
  diagnostics HTTP stays `NOT_ENABLED`, cleanup manual apply is
  `NOT_EXECUTED`, automatic cleanup is disabled, and AssetObject GC is not
  implemented. The earlier Release C aggregate change from the Release B
  baseline remains disclosed as an unresolved candidate-set change.

## 2026-08-14 Release C bounded-diagnostics follow-up (verification-only)

- Current source is `6c50e740449a9186f7f2121e6b9280be7a9801de`, which contains
  the deployed Release C commit as an ancestor. No Release C production
  redeploy was performed; this follow-up only closes a diagnostics query-budget
  gap.
- Cleanup classification now snapshots the bounded filesystem first and then
  queries only matching artifact paths and parsed job IDs in chunks of 500.
  Historical Export/Offline references and unrelated jobs are not loaded into
  Python for an administrator diagnostics request.
- Current verification: artifact/diagnostics subset `21 passed / 1 skipped`;
  full API `280 passed / 6 skipped`; Web lint, typecheck and production build
  PASS; Alembic heads/current `20260806_0021 (head)`. The Windows skip is the
  known symlink path-escape case and is not counted as PASS. Build output was
  redirected through a junction-backed operator cache outside the repository.

## 2026-08-14 Release C Production Closure (final)

- Release C runtime source is `8d0ad66d65bb069176970ea814d9a6b08e04322c`; GitHub Actions run `31789905868` passed the complete `quality -> build-images -> inspect -> package -> checksum -> artifact` chain. Quality included Web lint/typecheck/build, Release C observability/cleanup tests, API full suite, Alembic validation, official dependency audit, focused online browser checks and the default PWA baseline. The earlier run `31778569056` also passed but is superseded by this logging fix; its first predecessor failure remains evidence that the quality gate blocks images.
- Final artifact SHA-256 is `577594e63ed351de39cdfb56c02e385bff1ef0bbfe90285ddd9d0441aaabedd7`. API/worker/migrate image is `sha256:dfc11cda21f78ce77b9b451e886689f97842e1929a6e6618bfcaf8626a312c2a`; Web image is `sha256:69d228b578c35626f37577102afcbd7ad40c7e61191edafe6e14747379ab38b6`.
- King deployed the externally built images with explicit production compose/env, migration preflight and `--no-build`. Final verified backup is `/opt/chat-reader/backups/release-c-final-20260814T100144Z-8d0ad66`; PostgreSQL `pg_restore --list`, all four business-volume tar listings and SHA-256 checks passed. No migration was added; Alembic remains the single head `20260806_0021`.
- Final production health is PASS: API/Web/PostgreSQL healthy, import worker running, Scanner disabled. Actual public headers include `nosniff`, `strict-origin-when-cross-origin`, the documented bounded Permissions Policy and CSP Report-Only; `X-Powered-By` is absent. A success and controlled 404 each returned server-owned UUID v4 `X-Request-ID`; the same IDs appeared in structured `api_request_completed` logs, while a synthetic query marker and raw access-log pattern were absent.
- `/api/internal/diagnostics` remains intentionally disabled/publicly 404 because the gateway boundary is not independently proven. The internal CLI returned aggregate-only job/import/artifact/storage data without content or filenames. Production dry-run was executed twice with no deletion and stable results: `SAFE_TEMP=0`, `ORPHAN_FINAL=3 / 655,810 bytes`, `SUPERSEDED_ARTIFACT=0`, `UNSAFE_PROTECTED=30 / 236,550,537 bytes`. Release B reported four candidates, but did not persist candidate identities; Release C performed no artifact deletion, so the changed aggregate is recorded as an unresolved set change and no apply approval is inferred.
- Cleanup engine remains dry-run by default; manual apply was not executed, automatic cleanup is disabled, and AssetObject GC is not implemented. Exact obsolete image tags for `1d366fb` and intermediate `2d2ad36` plus the two release transfer directories were removed only after final health; current `8d0ad66`, direct rollback `32a980b`, volumes, PostgreSQL, backups and `.env.production` remain.

## 2026-08-14 Release C Observability and Safe Cleanup (implementation)

- Release B is closed as `PASS`: the operator manually verified production Chrome Share Drawer focus restoration for Esc, X, backdrop, and the remounted-trigger fallback. This is user-provided production evidence, not an automated browser-bridge result.
- FastAPI now generates a server-owned UUID request ID, returns it in `X-Request-ID`, and emits one duration/status event keyed by the matched route template. Uvicorn raw access logging is disabled so query strings do not bypass the redaction contract. Logging failures are isolated from business operations.
- BackgroundJob, Import, Export and Offline lifecycle transitions emit bounded structured events. Current job/import state, retry exhaustion, recent timing, cleanup debt and storage bytes are available through aggregate diagnostics without reading messages, filenames or artifact contents.
- `/api/internal/diagnostics` is implemented but disabled by default. Production enablement requires a separately proven gateway/VPN restriction; the safe operational fallback is the internal CLI.
- Cleanup remains dry-run by default. Manual apply requires one eligible category plus exact opaque candidate tokens, then repeats canonical-reference, active-job, path, age, size and mtime checks before each unlink. AssetObject, user Attachments, imports, backups, current artifacts and successful retained Exports are never eligible.
- The technical cleanup grace defaults to 24 hours and does not change user Export retention. Automatic cleanup and AssetObject GC remain disabled/not implemented. No Alembic migration is added.
- The Release B production baseline was re-read twice without deletion and remained stable at `ORPHAN_FINAL=4 / 659,673 bytes`, `SAFE_TEMP=0`, `SUPERSEDED_ARTIFACT=0`, `UNSAFE_PROTECTED=29 / 236,546,674 bytes`. Exact candidate identities were not persisted by Release B; Release C adds opaque stable tokens for future two-pass comparison.
- Current local results: focused `28 passed / 1 skipped`, full API `279 passed / 6 skipped`, Web lint/typecheck/production build PASS, Alembic single head `20260806_0021`, and default PWA `67 passed / 37 conditional skipped`. The focused Windows skip is the symlink path-escape case and will run on Linux CI. Skips are not PASS. CI artifact, deployment and final production dry-run remain pending for this source revision.

## 2026-08-14 Release B Artifact Integrity Closure (current production)

- Offline Package publication now writes same-volume UUID staging files, validates and publishes a unique final path, commits through the worker-owned transaction, and only then attempts prior-file cleanup. Commit failure preserves the prior row/file; cleanup failure is debt. Automatic cleanup remains disabled.
- All asynchronous Export ZIP builders share that lifecycle. A production QA `.cr` export exposed a PostgreSQL-only defect: `DISTINCT attachments.*` included a JSON column without an equality operator. The final query is rooted in conversation-owned Attachments and uses a correlated historical-occurrence predicate, preserving active unreferenced and historically referenced detached Attachments without entity-level `DISTINCT`.
- Import stale recovery uses the shared automatic-attempt ceiling of 3. Exhausted ImportRecords become terminal failed; manual retry starts a new bounded lifecycle.
- Share Drawer uses `useDialogFocus` for Esc/X/backdrop and a stable More-actions fallback. Production-equivalent browser E2E is PASS. The operator subsequently completed manual production Chrome verification for Esc, X, backdrop, and remounted-trigger focus restoration; Release A's historical failure remains preserved as superseded evidence.
- Final source `32a980bb7cc6ab5a30dc2b3a47d6f6c19acfa8da`; Actions run `31736593196`; CI API `265 passed / 4 skipped`, focused browser `28 passed`, default PWA `67 passed / 37 skipped`. Local API `264 passed / 5 skipped`; lint/typecheck/build PASS. Skips are not PASS.
- Artifact SHA-256 `aa1bd95a4567be87c43d5e86a5bd17602d738402b37bef7922ca93d87f8b4088`; API image `sha256:14478427325f395be4d54ce6cccb2fdcff8de7fcf97503a547e11cd57c4696aa`; Web image `sha256:0f544a7c39c735a84d59b81b4d08abb5cd7061f8f41c613f74ef72b4a59062e4`.
- Verified backup `/opt/chat-reader/backups/release-b-final-20260813T194413Z-32a980b`; explicit production compose/migration preflight/`--no-build` deployment. API/Web/PostgreSQL healthy, worker running, Scanner disabled, Alembic `20260806_0021`.
- Production QA PASS: two distinct Offline packages committed and downloaded; `.cr` committed, immediately downloaded and opened; normal Import preview/commit completed. QA Conversations were deleted through the API. The committed ImportRecord/source artifact remains under product retention because no safe immediate-delete endpoint exists.
- Cleanup dry-run only: `SAFE_TEMP=0`, `SUPERSEDED_ARTIFACT=0`, `ORPHAN_FINAL=4` (659,673 bytes), `UNSAFE_PROTECTED=29` (236,546,674 bytes). Image cleanup retained current `32a980b`, rollback `1d366fb` and `latest`; only superseded `ae4f498`/`0645a84` images and the old candidate transfer package were removed.

```text
RELEASE_B = PASS (manual production Chrome Share focus verification completed by the operator)
AUTOMATIC_CLEANUP = NOT_IMPLEMENTED
NEW_ALEMBIC_MIGRATION = NONE
```

## 2026-08-13 Release A Production Closure (Current)

- Release A is deployed from runtime commit `1d366fb0b3e74f865f1cbc455e3f5d6afeaa5911`, after the approved policy change removed only the cursor-secret length threshold. The deployment guard still rejects a missing, empty, development-default, or known-placeholder `ATTACHMENT_CURSOR_SECRET`.
- Value-safe production preflight passed without exposing the secret: `configured=true`, `not_default=true`, `not_placeholder=true`. The value was neither printed, copied, committed, nor changed by the release process.
- GitHub Actions run `31713379831` reran the complete `quality -> build-images -> inspect -> package -> checksum -> artifact` chain from the final source commit. Quality, image inspection and artifact publication passed. Earlier controlled quality failures (`31705576354`, `31706041697`) remain evidence that `build-images` cannot publish a deployable artifact after a failed gate.
- Official npm-registry provenance recheck passed: Mermaid `11.16.1` and PostCSS `8.5.26` match their exact lockfile `dist.integrity` values and official tarballs. No registry credential was recorded.
- The externally built archive SHA-256 is `52b809f4b484db3a180c06f46587130b79d6c3f6a999f1f8651eb12411910b59`. Running API/worker/migrate image digest: `sha256:650d9c9fdcd1f686c7adb1c34f27f37c5cb961206202cc2a0b60519fe5aa3a6f`; Web image digest: `sha256:6a273fc0bed72217b6307be2c3a8fd55ee2839a9b8efaebf11f85bf35d8579e1`.
- King verified the archive checksum, created and validated backup `/opt/chat-reader/backups/release-a-closure-20260813T151932Z-1d366fb` (PostgreSQL custom dump plus import/export/offline/asset archives), ran `alembic upgrade head`, then recreated only migrate/API/worker/Web with explicit production compose/env and `--no-build`. No volume was deleted, no secret was shown or overwritten, no local Next build ran, and Scanner remains disabled.
- Production health is PASS: API, Web and PostgreSQL are healthy; worker runs; public `/api/health` is `ok`; Alembic current/head is the single `20260806_0021`; capabilities report `scanner_provider=disabled` and `scanner_enabled=false`.
- Actual production headers are PASS: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, bounded `Permissions-Policy`, and the documented CSP Report-Only policy. `X-Powered-By` is absent. The external gateway still identifies itself as `nginx/1.23.1`; gateway banner/TLS/access control remain external responsibilities.
- Production Chrome smoke passed for Library/PWA availability, Reader Rich Markdown/KaTeX (MathML present, no math error or page overflow), PDF Viewer (canvas rendered, one accessible close, Esc restored the opener), and the Share owner drawer opening. No CSP Report-Only violation was captured in Library, Reader/KaTeX, or PDF Viewer. Mermaid has a strict-mode CI regression but no safe current production fixture, so its browser renderer remains `NOT_PRODUCTION_VERIFIED`.
- A separate real finding is deferred by user direction: closing the desktop Share utility drawer with Esc leaves focus on `body`. Root cause is that `ReaderUtilityDrawer` stores/restores a transient active element rather than the toolbar trigger. This is a documented next-round P2 accessibility fix and is outside Release A's security/provenance scope.
- The verified transfer archive was removed only after replacement health checks. The older superseded `9d338a0` Chat Reader image set was then removed after an exact tag audit; current `1d366fb`, `latest`, and the direct rollback `0645a84` remain. API/Web/PostgreSQL stayed healthy and the worker stayed running after cleanup. No user data, volume, database, `.env.production`, backup, or unrelated image was removed. King root free space is approximately 16 GiB.

```text
RELEASE_A = PASS
NEXT_SUPPORTED_LTS_BASELINE = MIGRATION_REQUIRED
PDFJS_SUPPORTED_LINE_MIGRATION_REQUIRED = YES
CSP_ENFORCING = NOT_IMPLEMENTED
```

## 2026-08-13 Release A Safety Baseline

- Release artifacts are now gated by locked install, Web lint/typecheck/production build, API full suite, Alembic current/single-head validation, an official npm-registry security audit, focused online browser checks and the default PWA matrix. `build-images` has a hard dependency on successful quality; failed quality may upload non-deployable evidence but cannot publish the image archive.
- Runtime/build dependencies are patched within the approved scope: Next `14.2.23 -> 14.2.35`, Mermaid `11.16.0 -> 11.16.1`, PostCSS `8.5.26`, plus compatible transitive overrides. The current official audit reports 36 advisories; all 17 critical/high findings are matched by exact, expiring records and there are no unapproved or unused exceptions. Next 14 and PDF.js 3 remain unsupported-line migration debt rather than a false security PASS.
- Production now fails before migration/API/worker startup when `ATTACHMENT_CURSOR_SECRET` is missing, empty, the known development default, or a known placeholder. There is no minimum-length gate; this policy was explicitly approved after the first production closure preflight found a configured custom value that did not meet the former 32-character rule. Local/test startup remains available. Alembic percent escaping is confined to ConfigParser and preserves the canonical database URL.
- Web responses define `nosniff`, a strict referrer policy, a bounded Permissions Policy, no `X-Powered-By`, and CSP Report-Only with `frame-ancestors 'none'`. CSP enforcement is intentionally not implemented in Release A.
- Next 14.2.35 exposed an upstream dynamic App Route build incompatibility for the five-minute import commit proxy. The same public `POST /api/imports/[importId]/commit` contract now uses a Pages API handler; all other `/api/*` requests remain rewrite-proxied to FastAPI. Runtime proxy evidence confirms its dedicated marker, no-store response, and upstream status propagation.
- Local gate evidence: lint PASS, typecheck PASS, production build PASS, API `251 passed / 4 skipped`, Alembic `head=current=20260806_0021`, Release A browser `6/6`, default PWA `67 passed / 36 skipped`, official audit policy PASS. Skips remain separate verification debt.
- GitHub Actions run `31706522862` completed the full `quality -> build-images -> inspect -> checksum -> artifact` chain for commit `08df7a1a880c63a4d05df46b8e0a271b16088c7f`. The downloaded archive SHA-256 is `25687fa7b91db5a518d42ccb61892015ff5fb90fc717f820de03a2719846a6b5`; its manifest, commit/run provenance, `linux/amd64` image inspection, expected entrypoints and forbidden-path scan all passed. API/worker/migrate use image `sha256:7eec3604e1b9ef31b93b9fda867f9967e62e025747a235fe1ab1058c89ea9edb`; Web uses `sha256:201c867b3259fef2020b8a84708c0964e5361e32b32a0be293b76868cb90ef02`.
- Production deployment is `BLOCKED`: a value-only-safe preflight found `ATTACHMENT_CURSOR_SECRET` absent (`configured=false`, `default-or-placeholder=true`, `length-ok=false`). The release agent did not generate, print or write a secret. Current production remains on its previous healthy images with API/Web/PostgreSQL healthy, worker running and Alembic `20260806_0021 (head)`; the Release A headers and CSP remain `NOT_VERIFIED` in production until an operator provisions the secret and the candidate is rebuilt/deployed from the then-current committed source.
- A later value-only-safe preflight found the operator value configured, non-default and non-placeholder, but shorter than the former minimum. The user explicitly removed the length requirement; the value itself was never displayed, copied, recorded or changed. Release closure must still rebuild from the resulting committed policy before deployment.
- The first controlled workflow run failed before dependency installation because the Node 20.13.1 bundled Corepack trust store could not validate the current pnpm signing key. The gate correctly skipped `build-images` and produced no deployable artifact. Actions now installs pinned pnpm `9.15.4` through `pnpm/action-setup`; the Web image pins a Node-20-compatible Corepack before activating the same pnpm version. Signature verification is not disabled.
- The second controlled run passed bootstrap, install, lint, typecheck and production build, then exposed an environment-isolation error in two new default-secret tests: the workflow's synthetic `ATTACHMENT_CURSOR_SECRET` overrode the default under test. Those cases now explicitly clear only their test process environment before constructing Settings; the production failure cases and workflow secret remain unchanged. The gate again skipped images and produced no deployable artifact.
- Durable contract: [Release Safety Baseline](docs/system/RELEASE_SAFETY_BASELINE.md). No database migration or business-data change was added.

## 2026-08-13 Formula Dense Reader Scroll Stabilization

- Root cause: formula-heavy blocks were re-rendered across parent Reader updates without stable memo boundaries. Each mounted block could re-enter the shared ReactMarkdown/remark/rehype-KaTeX pipeline, while virtual height estimation treated LaTeX source width like ordinary wrapped text. KaTeX `htmlAndMathml` remains intentionally enabled, so the DOM/layout cost was amplified by visual HTML plus MathML and annotation nodes.
- Reader stability now memoizes the cross-block math projection and display-unit grouping, and uses custom `memo` comparators for `BlockSlot`, `BlockElement`, `BlockRenderer` and `MarkdownRenderer`. Unchanged formula blocks remain mounted without re-running the parser during ordinary scroll updates.
- Math-aware block estimates ignore fenced/inline code, treat display formulas as bounded horizontal surfaces, and add capped row estimates for aligned/cases/matrix-like environments. Formula overflow remains local to `.katex-display`; `contain: layout paint` limits layout propagation without changing Reader width or MathML accessibility.
- Verification: Web typecheck, production build, focused ESLint and parser/layout tests pass; focused parser/layout suite is `17/17`. Rich Markdown browser cases were fixture/server-gated in this local run and remain separate verification debt. No API, database, migration, canonical Markdown, attachment or Viewer contract changed.

## 2026-08-13 Manual TOC Refresh

- Owner Reader 的右上角“更多”新增“更新目录”。用户可分别选择“对话目录”“章节目录”或同时更新；章节目录范围默认当前对话，也可显式选择全部未删除对话。
- 对话目录继续以当前 canonical Message/current MessageVersion 动态投影为唯一真值，不新增第二份持久化索引。手动更新任务会校验该投影，完成后 Web 精确失效 dialogue-index cache。章节目录由单并发 worker 从当前版本 heading RenderBlock 重建；全部范围逐对话报告进度且整个 job 失败时回滚。
- 新接口为 `POST /api/conversations/{conversation_id}/toc/refresh`，返回统一 `BackgroundTaskRead`。任务支持 `Idempotency-Key`，不修改 Conversation revision、消息、阅读位置或正文，不新增 migration。
- UI 使用统一 Dialog focus/close 合同，默认同时选中两类目录、默认章节范围为当前对话；任务状态通过可访问 status/alert 展示，失败时保留重试入口。Share 与 Offline Reader 不暴露 canonical 管理操作。
- 本地验证：TOC route + builder `4/4`（route `3/3`、builder `1/1`）、Web contract `1/1`、Web lint/typecheck/build PASS、完整 API `236 passed / 4 fixture-gated skipped`、默认 PWA `59 passed / 36 environment-gated skipped`、Alembic single head `20260806_0021`。Skip 不计为 PASS。
- 生产运行 commit `9d338a001c612bfd837de6a9ee5d06cdb684df61`，由 GitHub Actions run `31621723794` 构建，artifact SHA-256 为 `8b0123f93a382535d378e16d5d5a046049ba245870d955dc009e1262cbbdca1b`。部署前恢复点 `/opt/chat-reader/backups/toc-refresh-20260813T012000Z-9d338a0` 的 PostgreSQL custom dump、四个业务 volume archive、SHA-256、`pg_restore --list` 与 tar listing 均通过。King 仅执行 image load、migration preflight 和 `--no-build` recreate；API/Web/PostgreSQL healthy，worker 运行，Scanner 停止，Alembic 保持 `20260806_0021`。
- 真实生产 Chrome 的隔离 QA 对话通过：More 中存在“更新目录”；默认两项选中且章节范围为当前对话；可切换“全部对话”；初始焦点在第一项，accessible Close 恰好一个，Esc 恢复 More trigger；combined/current、dialogue-only、section-only 任务均完成，章节结果为 2，刷新后正文/标题仍在，revision 保持 5。全量章节重建未在生产执行，以避免无必要改写真实业务对话的派生 Heading；API/worker 集成测试已覆盖。QA 对话通过产品 API 删除并确认 404。
- 替换确认后仅删除 superseded `9e3bc99` Chat Reader 镜像标签/层与传输 archive；保留 current `9d338a0`、rollback `3ed9dc7` 和 `latest`。`/opt/chat-reader/releases` 为 4 KiB，root 可用约 16 GiB；volume、业务数据、`.env.production`、恢复点和其他服务镜像未动。

## 2026-08-12 JSON + Markdown Import Compatibility v5

- The reported `ChatGPT-网页缺陷探索方法.json` + `.md` pair failed before parsing with HTTP `422 unsupported_source_profile`: its Markdown export contains only one `Response` section, while the old source detector required both `Prompt` and `Response` headings.
- Import v5 detects the files as a batch. JSON remains the authority for message identity, role, timestamp and ordering; its non-empty messages provide context for recognizing Prompt-only or Response-only Markdown. A single-role Markdown file without matching JSON context remains unsupported, including dated ordinary notes.
- Blank JSON and Markdown messages are ignored at any position while their source indexes remain traceable. Non-empty sequences use a bounded monotonic message-level alignment. Unmatched, ambiguous or plain-text content mismatches are reported with source/index/role/time diagnostics and block commit; nothing is silently dropped.
- Historical exporters may store a lossy plain fallback in JSON and authoritative rich structure in Markdown. With unique matching role/timestamp, recognizable Markdown headings/lists/code/tables/links are accepted as `by_order`; two unrelated plain-text bodies remain a blocking mismatch.
- Structured import `422` codes now have Chinese UI messages. Preview shows ignored-blank counts and exact mismatch locations instead of exposing `/api/imports/preview returned 422`.
- Unique `(role, normalized timestamp)` identities now take an O(n) monotonic fast path. It validates content with bounded exact/normalized/prefix/semantic checks and a bounded 1,000-character similarity fallback; duplicate or non-monotonic identities continue through the guarded compatibility path. Preview logs now separate `json_parse_ms`, `markdown_parse_ms` and `alignment_ms`.
- Verification: the exact supplied pair passed its preview-only matrix (`61 passed / 2 fixture-gated skipped`); the real 398-message fixture passed preview, commit and idempotent retry (`12 passed / 1 fixture-gated skipped`) and its preview stayed inside the 20-second proxy assertion. Full API is `235 passed / 4 fixture-gated skipped`; Web import contract `2/2`; default PWA `57 passed / 36 environment-gated skipped`; lint/typecheck/build PASS; Alembic remains the single head `20260806_0021`. Source files were not modified and the supplied pair was not committed.
- Production multipart Preview for the supplied pair returned HTTP `200` in about 1.5 seconds with `can_commit=true`, `alignment=exact_match`, one non-empty message and no warning. No Conversation was committed. The uncommitted preview record has no safe immediate-delete product endpoint and remains subject to the existing preview TTL rather than direct SQL cleanup.

## 2026-08-12 Rich Markdown Scientific-inline Closure

- The reported heading defect was not missing math recognition. `InlineHeadingMarkdown` sanitized a valid KaTeX tree and then applied a second `allowedElements`/`unwrapDisallowed` filter. That removed KaTeX's structural wrappers and exposed MathML text, annotation LaTeX and visual HTML together, producing duplicated text such as `n3n^3n3`. Headings now retain the same sanitized KaTeX tree as other shared consumers while still suppressing image rendering.
- A second reported conversation contains standalone ChatGPT bracket formulas using common scientific commands such as `lambda`, `mathbb`, `in`, `langle`, `neq`, `xrightarrow`, `mathrm` and `times`. The v2 allowlist omitted them. The first v3 production check then found eight more standalone short display labels (`Image > Text`, `Image+Text`, `Text-only`, `Image`, `OCR/Text`, `Question`, `Answer + Provenance`). `ai-rich-markdown-v4` adds a separate bounded display-label grammar: at most 80 characters, uppercase label tokens and only `>`/`+` binary operators. It projects these as `text{...}` math while rejecting lowercase prose and multiword prose such as `Appendix A`.
- Production-equivalent verification: parser/shared contract `14/14`; Reader/Editor/security/stress `5/5`; exact read-only source copies for both reported shapes `1/1` each; the full second source renders 41 display formulas/MathML, all common scientific commands, zero math errors and zero residual bracket paragraphs. Web lint/typecheck/build PASS; full API `235 passed / 4 fixture-gated skipped`; default PWA `58 passed / 36 environment-gated skipped`; Alembic single head `20260806_0021`. QA copies were deleted through the product API.
- Production runtime is commit `3ed9dc75e650223b05663000b6429074e1ba4c1b`, built by GitHub Actions run `31614666602` from artifact SHA-256 `e718641b046edadab0560e84363c4d0e0618e994b461a622c29109443c480b92`. Backup `/opt/chat-reader/backups/import-rich-v3-20260812T151526Z-9e3bc99` contains validated business-volume archives plus pre/post-preview PostgreSQL custom dumps. King used migration preflight and `--no-build` recreation; API/Web/PostgreSQL are healthy, worker runs, Scanner remains stopped and Alembic remains `20260806_0021`.
- Real production Chrome performed read-only full-source audits on both reported pages. The first retained 108 display formulas with zero errors and one visual/semantic heading formula rather than duplicated MathML/annotation/HTML text. The second increased from the intermediate 33 formulas to `41/41` display formulas and MathML trees, including all eight bounded conceptual labels, with zero errors and zero literal bracket paragraphs. Source Preview started collapsed and was closed without saving, so production conversation data was not modified.
- After replacement health and Chrome acceptance, cleanup removed only intermediate `e69a510` and superseded `336486b` Chat Reader image tags/layers plus their two transfer directories. Current `3ed9dc7`, rollback `9e3bc99` and `latest` remain; `/opt/chat-reader/releases` is empty and root free space is about 17 GiB. Volumes, PostgreSQL, user files, `.env.production`, backups and unrelated images were not removed.

## 2026-08-12 Archived Project Deletion Closure

- Archived projects now have a complete terminal lifecycle. `DELETE /api/projects/{project_id}` accepts only non-default archived projects; active and default projects are rejected. Deletion removes the project container, not its conversations or messages.
- Before deleting the container, every project conversation is atomically moved to the internal default/Unclassified project, project pins are cleared, Reader/offline revisions and recent placement are updated, and a placement event records `reason=project_deleted`. No migration is required.
- The Archived page exposes both a guarded per-project delete action and batch deletion. Its confirmation explicitly states that project deletion is irreversible while conversations/messages remain in Unclassified. Partial batch failures remain selected and visible.
- Local verification: project API `9/9`, archived-project Web contract `1/1`, Web lint/typecheck/build PASS, full API `220 passed / 3 fixture-gated skipped`, Alembic single head `20260806_0021`.
- Production runtime is commit `0f004f7ce79cc6b97e68a8756c6ea21d6a75cc9f`, built by GitHub Actions run `31576690022` from artifact SHA-256 `1d34431be81000854736a1185264a523ec875db5252c3bb0ea8b1c1f4f6a4d67`. Backup `/opt/chat-reader/backups/project-delete-20260812T0810Z-0f004f7` passed PostgreSQL and archive readability/checksum validation. King used migration preflight and `--no-build` recreation; API/Web/PostgreSQL are healthy, the worker runs, Scanner remains stopped and Alembic remains `20260806_0021`.
- Real production Chrome created, archived and deleted a dedicated QA project. The project disappeared from Archived, its conversation remained available under Unclassified after refresh, and the disposable QA conversation was then deleted through the product API.
- King cleanup removed 18 obsolete top-level release tarballs, six legacy release directories containing only image tar/checksum pairs, the deployment transfer archive and the superseded `4d07ce4` image set. `/opt/chat-reader/releases` is 4 KiB and final root free space is about 5.2 GiB. Current `0f004f7`, rollback `336486b` and `latest` remain. Business volumes, PostgreSQL, `.env.production` and backups were not removed.

## 2026-08-12 Rich Markdown Consumed-inline Closure

- The remaining production defect was a second delimiter-loss shape. Canonical source contained prose such as `根号中最高次是 (n^6)` and standalone `[\nf(x)=x^2.\n]`; the v1 compatibility rule recognized only surviving `\(...\)` and bare bracket bodies containing a named LaTeX command.
- `ai-rich-markdown-v2` adds a conservative AST-only grammar for compact bare parentheses and standalone bare-bracket expressions. `(n^6)`, `(1/3)`, `(k)`, `(n)`, `[f(x)=x^2]`, `[kn]` and `[n^6+kn]` render as semantic math. Prose, dates, versions, uppercase identifiers, currency and code remain text. Canonical Markdown, API, DB, exports and RenderBlocks are unchanged; no migration was added.
- Production-build verification: parser/shared contract `12/12`; Reader/Editor/security/stress `5/5`; exact reported production-source copy `1/1`; Markdown attachment shared renderer `1/1`; Web lint/typecheck/build PASS; API `220 passed / 3 fixture-gated skipped`; default PWA `54 passed / 34 conditional skipped`; Alembic single head `20260806_0021`. The full source preview rendered 108 display formula nodes, at least 108 MathML trees, zero math errors and no page-level horizontal overflow. Ephemeral QA conversations were deleted through the product API. PWA skips are not PASS.
- Production runtime is commit `9e3bc99595dfc958c0167763a68b95890b98f431`, built by GitHub Actions run `31580890665` from artifact SHA-256 `493f080d973c7b2aedcf3e61f18762471f613a04599b0bd051943afe16de4dba`. Backup `/opt/chat-reader/backups/rich-inline-20260812T090711Z-9e3bc99` is 434 MiB; all five checksums, PostgreSQL `pg_restore --list` and four tar listings passed. King used the existing migration head and `--no-build` recreation; API/Web/PostgreSQL are healthy, worker runs and Scanner remains stopped.
- Real production Chrome on the reported Conversation confirmed `ai-rich-markdown-v2`. Source Preview began collapsed, then rendered 108 display math nodes and 130 MathML trees after explicit expansion, including three `n^6`, five `k` and one `f(x)=x^2` recovered expression, with zero math errors and no page overflow. The editor was returned to reading mode without saving; production data was not modified.
- Post-acceptance cleanup removed the superseded `0f004f7` image tags/layers and transfer archive. Current `9e3bc99`, rollback `336486b` and `latest` remain; `/opt/chat-reader/releases` is 4 KiB and root free space is about 4.1 GiB after retaining the new verified backup. No volume, PostgreSQL data, `.env.production`, historical backup or non-Chat-Reader image was removed.
- A separate storage-pressure closure then audited the 15 GiB backup directory and removed 50 redundant historical release snapshots (13,701,926,937 accounted bytes). Recovery coverage retained the July 30/31 baseline set, the verified `38c57c1` Release Closure point, rollback `336486b`, and current `9e3bc99`. The three retained complete restore points passed SHA-256, archive-listing and PostgreSQL `pg_restore --list` checks before deletion. `/opt/chat-reader/backups` is now 1.5 GiB and root free space is 17 GiB (56% used). Business volumes, current PostgreSQL, user assets/imports/exports/offline data, `.env.production`, running images and unrelated services were not touched; API/Web/PostgreSQL remained healthy, the worker remained running, and both same-origin and public health checks returned `ok`.

## 2026-08-12 AI Rich Markdown Rendering Release

- Message Markdown now uses one parser-level semantic core for Reader, Source Editor live preview and Markdown attachment inline/Viewer rendering. GFM, footnotes, code isolation and all four math delimiters (`\(...\)`, `$...$`, `\[...\]`, `$$...$$`) share the same plugin/security configuration.
- Root cause of the production formula defect was confirmed: CommonMark consumed the backslashes in `\[`/`\]` as punctuation escapes before `remark-math`, which only recognized dollar delimiters. The new mdast compatibility transform recovers ChatGPT bracket/parenthesis delimiters from node source positions without rewriting canonical Markdown or scanning rendered DOM.
- KaTeX remains locally bundled and renders `htmlAndMathml` with `trust=false`, `maxExpand=1000`, `maxSize=20` and local formula-error isolation. Math/table/code own horizontal overflow; Reader width is unchanged. Raw HTML remains inert, unsafe link schemes are rejected, and remote Markdown images are not automatically fetched.
- Source Editor has a deferred shared preview while CodeMirror retains its independent external document baseline. Cross-block current-version footnotes are projected into one semantic parse without mutating stored text. Footnote IDs are scoped per MessageVersion or attachment.
- Attachment draft completion now seeds React state from CodeMirror's canonical document before enabling save. This closes the upload-completion race where the first save could submit a stale `cr-upload://` marker after the UI already showed the draft as ready.
- Offline shell preparation adds same-origin `KaTeX_*` font URLs from current `@font-face` rules to its deterministic revision and required cache. No CDN or historical Performance scan is used.
- Verification: Web lint/typecheck/build PASS; Rich Markdown parser/Reader/Editor/security/stress/attachment suite `8/8`; Markdown attachment real upload/save/Viewer `1/1`; heavy Reader Owner/Share regression `8/8`; default PWA `45 passed / 31 conditional skipped`; offline KaTeX inventory/cold start `1/1`; API `218 passed / 3 skipped`; Alembic single head `20260806_0021`. Conditional skips are not PASS.
- Durable contract: [AI Rich Markdown Renderer Contract](docs/system/AI_RICH_MARKDOWN_CONTRACT.md). No dependency, API, export format, persisted model or migration was added.
- Production runtime is commit `4d07ce40fd8f130c219e8535bcd2c2f8d9910d97`, built by GitHub Actions run `31560459470` and deployed from archive SHA-256 `c47168693d2d3efb9aca3ca8fe4b7ff122a08ee511ce9cfeef77f10c0442a2e5`. Backup `/opt/chat-reader/backups/ai-rich-markdown-20260812T034100Z-4d07ce4` contains a validated PostgreSQL custom dump and checked import/export/offline/asset archives. King loaded external images, ran migration preflight and recreated API/worker/Web with `--no-build`; API/Web/PostgreSQL are healthy, worker runs, Scanner remains stopped, and Alembic remains `20260806_0021`.
- Production Chrome synthetic QA passed the golden boxed limit, all four delimiters, currency exclusion, table, task-list presentation, strike, namespaced footnotes, code isolation, MathML, unsafe HTML/link blocking and page-overflow checks. Source Editor kept raw `\[`/`\boxed`, rendered the shared preview, and retained the same selection offset after type/backspace. `/library` reported `可离线启动 · 78 项资源`; local production-build service-worker cold start provides the exact KaTeX-font cache assertion. The QA Conversation was removed through the product API.
- Exact local production-build 360/390/768 reflow is PASS. The Chrome bridge viewport override advertised by the current extension could not be applied, so exact production 360/390 is not claimed a second time. A screenshot request also timed out; synthetic local desktop/mobile screenshots and production DOM assertions remain the evidence. The only console errors were the already isolated browser-extension asynchronous message-channel error, not an application error.
- After replacement health and Chrome acceptance, obsolete `1cdadc4` image tags/layers and the transferred archive were removed. Current `4d07ce4`, rollback `3b544fe` and `latest` remain; root free space increased from about 2.0 GiB to 2.4 GiB. Volumes, `.env.production`, PostgreSQL and Scanner were untouched.
- Follow-up production evidence from Conversation `c4f6db82-8deb-4342-84c6-5a94bc811a84` identified a second ChatGPT source shape: 21 formula pairs had already lost only the outer `\\[`/`\\]`, one used `/[`/`]/`, and the body retained 6 `\\boxed`, 51 `\\frac` and 15 `\\sqrt` commands. Blank lines and pasted Setext artifacts split some formulas across paragraph/heading API RenderBlocks. The compatibility layer recognizes only standalone multiline brackets with strong LaTeX signals, excludes code/HTML, normalizes Setext clipboard artifacts only inside an established formula boundary, and projects split blocks back into one UI-only Markdown unit without changing canonical source, stored RenderBlocks or API contracts. Source Editor Rich Preview is opt-in and collapsed whenever the workspace opens. Focused parser/Reader/Editor regression is `10/10 PASS`; a transient local copy of the exact production source rendered `22/22` display formulas with `22/22` MathML trees, zero errors/raw LaTeX/page overflow, then was deleted through the API.
- Follow-up runtime is commit `336486b89c12c1536763698feda4c550502b49eb`, built by Actions run `31573557959` from artifact SHA-256 `c3e6463a9689061430d7b28a7970550553cab6fdcf2020d2f2b19b04a96627e3`. Verified backup `/opt/chat-reader/backups/rich-markdown-followup-20260812T072512Z-336486b` contains the PostgreSQL custom dump plus all four business-volume archives with checksum, `pg_restore --list` and tar-list validation. King used source fast-forward, image load, migration preflight and `--no-build` recreation; health is green, worker runs, Scanner is stopped and Alembic remains `20260806_0021`. Real Chrome on the reported page confirmed `22/22` display formulas, `22/22` MathML, zero renderer errors/raw LaTeX/page overflow; Source Editor opened with preview count `0` and `aria-pressed=false`, then rendered `22/22` after explicit expansion. Cleanup retained current `336486b` and rollback `4d07ce4`, removed `3b544fe` and the transfer archive.

## 2026-08-11 Offline Startup, Read-only Attachments And Context Skill Delivery

- Offline shell startup no longer blocks Library, Reader, or package downloads. An existing active shell is marked `ready` immediately; viewer runtime warming and shell reconciliation run as a background update. A failed update preserves the previous ready shell. The shell inventory is deterministic and includes the Chinese and English Context Acquisition Skill assets without scanning historical Performance entries.
- Offline Reader now exposes the same `current conversation files` entry as the online Reader, through the existing `reader-floating` workspace on desktop and the existing full-width sheet on mobile. It is read-only: cached originals can open in the single Attachment Viewer Shell or download; missing originals show `offline-unavailable`; server attachment enumeration and management actions are unavailable.
- Offline export is local-only and consumes the downloaded snapshot from IndexedDB/Cache Storage. CanJSON and Markdown exports preserve the existing offline boundary; local `.context.zip` includes a manifest, conversation JSONL and only cached content-addressed assets. Missing assets remain explicit metadata records. No API request, background job, derivative generation or migration is used.
- Context Package results provide `Download Context Package`, `Copy parsing Skill`, and `View Skill`. Download attempts clipboard copy in the same gesture but never blocks the download. Clipboard denial or unavailable APIs show a persistent retryable error. Both Skill files are static, inert text resources: zh SHA-256 `BF467029CE810249701DCB21E0642ECEDF55F7B61ADA1C597BA386B891F9D08E`, en SHA-256 `BE2F289E8D45F659F6A9AECFC43C2491058DF940EC5416062F6FA55FEF6AC613`.
- Verified locally: Web production build, lint, typecheck, API `218 passed / 3 skipped`, Alembic single head `20260806_0021`, and PWA/Playwright `41 passed / 27 skipped`. Offline startup, read-only files, local export, both Skill deliveries, clipboard rejection, active shell preservation and exact 360/390/768 reflow passed. Quota exhaustion, interrupted package writes and production offline network interception remain `NOT_PRODUCTION_VERIFIED`.
- Production runtime is commit `3b544feb97257722763437fc5c9206f80b3e68db`, built by GitHub Actions run `31486218261` and deployed from archive SHA-256 `1e83d68a5f3c7321e9e9d6f2d5602b043aa32ae127ab5cf3c320e75fa3b7bfe7`. Backup `/opt/chat-reader/backups/offline-context-20260811T112745Z-3b544fe` contains a validated PostgreSQL custom dump and checked import/export/offline/asset archives. King loaded the external images, ran migration preflight and recreated services with `--no-build`; API/Web/PostgreSQL are healthy, worker runs, Scanner remains stopped and Alembic remains `20260806_0021`.
- Production Chrome `/library` changed from `checking` to `ready` in about 2.5 seconds and reported 27 shell resources while keeping the conversation update action enabled. An existing 398-message offline snapshot opened normally; the read-only file and local export actions were present, local `.context.zip` generated, and the English Skill viewer showed the pinned checksum. The download action reported package start plus Skill copy; the Chrome bridge could not observe its download event or read back the system clipboard, so those bridge-specific checks remain `NOT_PRODUCTION_VERIFIED` while production-build Playwright is PASS.
- After health and browser verification, obsolete `b6ce0e6` image tags/layers and the transferred release archive were removed. Current `3b544fe`, rollback `1cdadc4` and `latest` remain; volumes and the validated release backup were not touched.

## 2026-08-11 Attachment Workspace And Markdown Cursor Closure

- Production now runs commit `1cdadc4f90115d7b46ce55d07a2b4f23c90471d4`, built by GitHub Actions run `31470442426` and deployed from archive SHA-256 `429fb5384dc1dbf57eec68aecad4632c01bd71a58fca6ea9f276468c6d8630fb`. Verified backup `/opt/chat-reader/backups/file-workspace-cursor-20260811T075200Z-1cdadc4` contains a PostgreSQL custom dump plus import/export/offline/asset archives; every checksum, `pg_restore --list` and tar listing passed.
- Desktop `当前对话文件` now uses the annotation-style `reader-floating` workspace instead of the superseded fixed left overlay. Its default geometry is a 400x620 panel at the Reader's upper-right safe region (production Chrome: `x=1604`, `y=72` in a 2032x975 viewport). The whole header is the drag handle, exposes `grab`/`grabbing`, and begins with an accent-colored attachment `Paperclip`; position and size persist and can be reset. Mobile remains a full-width sheet.
- The Markdown cursor jump had three interacting causes: unstable inline CodeMirror configuration callbacks reconfigured the editor on React renders; Reader's global keyboard-intent listener treated editor keys such as End/Arrow/Space as Reader navigation; and the controlled wrapper echoed draft state through `value={text}`. CodeMirror now receives stable memoized setup/update callbacks, Reader keyboard intent ignores editable/source-workspace targets, and an `editorDocument` baseline is changed only by real external document replacement or save.
- Local verification on this release: Web lint/typecheck/build PASS; API `218 passed / 3 skipped`; Alembic one head `20260806_0021`; default PWA/Playwright `39 passed / 27 conditional skipped`; focused stabilization contract `6/6`; production-equivalent mutation/source cursor E2E `2/2`. Production Chrome opened a long source at offset `21860` and `scrollTop=41091`: typing moved the offset to `21861`, Backspace restored `21860`, while scrollTop and the active message remained unchanged. No source save occurred.
- After the new images and production flows were healthy, 48 exact tags from 12 older Chat Reader releases were removed non-forcefully. Only current `1cdadc4`, rollback `b6ce0e6` and `latest` remain for Web/API/worker/migrate. Docker image storage fell from 4.919 GB to 2.510 GB and root free space increased from 1.4 GB to 3.9 GB; volumes, PostgreSQL, `.env.production` and Scanner were untouched.

## 2026-08-11 Final Release Closure

- Production runtime is commit `38c57c12191bb85ebca0a7caf9aea80f11070993`, built by GitHub Actions run `31453697905` and deployed from archive SHA-256 `430dd0d88c927a6329da132aced75c742124ac4035b4c05c348bdbeda549e11c`. King used validated backup `/opt/chat-reader/backups/final-closure-20260811T030600Z-38c57c1`, migration preflight and `--no-build`; API/Web/PostgreSQL are healthy, the worker is running, Scanner remains disabled, and Alembic is the single head `20260806_0021`.
- Settings now exposes system `.cr` export only. Users select `.cr` from the existing Import data flow; the duplicate restore file picker in Data and backup is removed. Desktop `当前对话文件` defaults to the fixed left management workspace with a resizable right edge; mobile remains a full-width sheet.
- The final first-mutation race was a read-side revision write: lazy `GET /notebook` materialized an empty Notebook and touched the Conversation revision without returning the new revision. That GET no longer changes revision. Real production flow now passes create -> immediate insert, delete -> forced restore failure -> visible retry -> restore -> refresh persistence.
- Active zero-current-occurrence Attachments are now reconciled as unreferenced business rows. Production QA verified two distinct Attachment identities for identical bytes sharing one AssetObject; both remained visible with current reference count zero, and insert/keep/reinsert preserved the Attachment/Object identities.
- Production verification passes exact 360x800, 390x844 and 768x1024 reflow on the real long Reader, genuine two-tab conflict protection with draft preservation and explicit `加载最新状态`, Share expiry/revocation, long Reader restoration and the unified Dialog/Viewer focus contract. File chooser is PASS in production-build Playwright but remains unavailable to the production Chrome bridge.
- Current release decision is deliberately `PARTIAL_PASS`: online lifecycle and conflict-recovery gates pass, but actual browser 125/150/200% zoom has not been controlled. PWA/Offline is also `PARTIAL_PASS` because runtime-chunk/cache-miss/quota/interruption/reconnect negative paths remain unverified. `CORE_WEB_RELEASE=PARTIAL_PASS`, `PWA_OFFLINE_RELEASE=PARTIAL_PASS`, `OVERALL=PARTIAL_PASS`, `ONLINE_WEB_GA_READY=NO` under the strict closure gate.
- Full evidence and status layering are retained in [the release-readiness audit](docs/evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md); historical FAILED results are not erased by this addendum.

## 2026-08-10 Reader Scrollbar-Jump Blank-Window Closure

- A second production Reader scroll defect was reproduced with direct scrollbar-thumb jumps: a visible heavy message could retain its shell while all mounted virtual block rows were positioned tens of thousands of pixels outside the viewport. The failure was not an empty API response.
- Root cause: edge-window merge and late upstream row measurement changed a downstream virtual message's absolute offset without changing its own width or height. Its cached TanStack `scrollMargin` therefore remained stale; large scroll jumps selected a valid but wrong block range. Pointer dragging could also grow the message window while Chromium still held the native scrollbar thumb, changing the drag coordinate system mid-gesture.
- Virtualized messages now perform a bounded gap recovery only when their shell intersects the Reader viewport but none of their mounted rows do. The recovery rebases the real scroll margin without clearing measured row sizes. Pointer-down proactively rebases coordinates; edge-window loading is deferred while the pointer gesture is active and runs once after release.
- Production-equivalent verification before release: Web lint/typecheck/build PASS; Reader restoration/Share suite `8/8`; blank-jump plus wheel repeat `6/6`; API `216 passed / 3 skipped`; default PWA `37 passed / 25 conditional skips`; Alembic remains single head `20260806_0021`.

## 2026-08-10 Reader Wheel Performance Stabilization

- The production scroll hitch was traced to measurement churn inside a bounded six-message window, not to mounting all 398 messages. Three visible Assistant messages contained 402, 389 and 501 virtual blocks; coarse paragraph, heading and fixed 260px code estimates repeatedly corrected the virtual total height while wheel input was active.
- Reader block estimation now uses stable content-width/font/density metrics, Unicode-aware visual-line estimates and type-specific heading/code/table/media geometry. TanStack keeps measured row sizes, and scroll compensation is limited to rows wholly above the reading line.
- Owner and Share readers now use the same bounded active-target resolver and one passive scroll coordinator. Active sampling is capped at 80ms with a trailing sample, reading-position persistence is a single idle write, and sentinel intersection is the sole edge-loading authority. The virtual container's changing total height is no longer observed as a Reader layout signal.
- The TOC receives a derived active heading, keeps its rows memoized and only follows asynchronously when the active item is outside its own viewport. Existing source-follow, refresh restoration, annotation jump, search target and six-message window semantics remain intact.
- Local verification: lint and typecheck PASS; estimator plus long Owner/Share Reader suite `9/9` PASS. Three production-build Chromium wheel runs recorded median p95 frame interval `16.7ms`, median longest task `70ms`, median five-second long-task total `70ms`; each run stayed within the `34ms / 150ms / 250ms` budgets. Full API remains `216 passed / 3 skipped`, Web production build PASS and default PWA matrix `37 passed / 22 conditional skips`.
- Deployment and real production Chrome status are recorded separately after the external image release. Existing production conversation content is read-only during this verification.

## 2026-08-10 Release Stabilization / Lifecycle Closure

- Root-cause fixes are implemented without migration or production data changes. Successful message mutations now return the post-commit `conversation_revision`; Web applies that canonical value for create, insert, edit, task toggle, version changes, delete and undo restore. Create now seeds the conversation cache, and restore is idempotent with a visible retryable failure state.
- Attachment list responses expose `current_occurrence_count` separately from Attachment status. Active zero-reference files remain distinct from explicit `detached` files; shared AssetObjects do not merge business Attachment rows.
- Import, interaction, new-conversation, insert and file-details dialogs share `useDialogFocus`: synchronous initial focus, focus trap, Escape, pointer-only backdrop and deterministic logical focus restoration after pointer defaults. The Attachment Viewer supplies an Attachment-identity fallback when React replaces its original trigger. Disabled Scanner is neutral `未扫描`; Project creation uses Chinese labels, autofocus, and Escape cancellation with trigger restoration.
- Verification this closure: targeted API `10 passed`; full API `216 passed / 3 skipped`; Web lint/typecheck/build PASS; PWA default `30 passed / 21 skipped`. Final focus release `ed9116a` was externally built by Actions run `31374507130`; archive SHA-256 `a6132d7801253da105893967a87e373a151587795c1c220ecb741f53bba1788b` was verified before King `--no-build` deployment. Production Chrome now passes Viewer initial focus, Tab/Shift+Tab containment, one Shell/one accessible close, Esc/X/backdrop close restoration, and Project-create autofocus/Escape restoration. The bridge's requested 390px viewport resolved to 433px and passed without horizontal overflow; exact 360/390 and 125/150/200% browser zoom remain `NOT_PRODUCTION_VERIFIED`.
- Contract: [Mutation / Revision Contract](docs/system/MUTATION_REVISION_CONTRACT.md). Evidence: [Release-Readiness Audit remediation](docs/evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md).

## 2026-08-10 Release-Readiness Audit

- Current status is `PARTIAL_PASS`, not an unconditional production sign-off. Required local checks passed: Web lint/typecheck/build, API `216 passed / 3 conditional skips`, PWA `30 passed / 21 conditional skips`, and Alembic single head `20260806_0021`.
- Real Chrome production acceptance used existing data read-only and a separate QA project/conversations for writes. It verified the large JSON+Markdown import path, Reader windowing, Scanner-disabled `未扫描` wording, Markdown/CSV/SVG/PDF/ZIP attachment paths, Range, restricted Share/revocation and adaptive visible Viewer panels. The visible ZIP panel was 720x420 and the one-page PDF panel about 1120x786; the full viewport dialog root is backdrop/focus infrastructure only.
- Release blockers found: active unreferenced Attachments in the acceptance fixture disappear from the Files Panel despite remaining in export facts, and the visible message-delete `撤销` action does not restore its QA message. Immediate insertion after conversation creation also uses a stale revision until reload; dialog close does not restore trigger focus and multiple dialogs expose two focusable close controls.
- QA cleanup: test conversations were deleted, test Share revoked and test Project archived. Existing business records were not changed. A committed QA ImportRecord remains under normal lifecycle because no safe owner deletion endpoint exists.
- Detailed redacted findings, traceability, coverage, remediation and evidence: [UX release-readiness audit](docs/evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md).

## 2026-08-09 Attachment Inline Layout System Candidate

- Reader attachments now use one group-owned geometry chain: `Attachment Lane -> Attachment Group -> Semantic Renderer`. The six presentations are `reading`, `data`, `gallery`, `audio-list`, `video`, and `file-list`; individual renderers no longer apply independent centring or arbitrary max widths.
- Lane maxima are 45rem reading, 55rem data, 100% gallery, 38rem audio/file and 43rem video. These values do not alter the Reader content-width contract.
- Consecutive current-version attachment blocks are resolved through the shared Renderer/RenderPlan registry, then partitioned by presentation without crossing ordinary text. Gallery contains only runtime-previewable images; TIFF, image decode failure and unsupported media use FileList. Audio and download-only files share one group surface with row dividers.
- Gallery rows preserve aspect ratio, use an approximately 200px target, cap the final row at 220px and centre the incomplete row. More than six images renders five images plus a dedicated `+N` Overview tile while retaining the complete occurrence-authoritative Viewer session.
- Local verification: Web lint/typecheck/build PASS; focused inline/viewer tests `13/13`; API `216 passed / 3 skipped`; PWA default matrix `28 passed / 21 conditional skipped`; Alembic single head `20260806_0021`.
- Production release `5cc491f3a8a1b398735c0e5b84629731a13da0bf` was built by GitHub Actions run `31325841867` (archive SHA-256 `d75a66b214932a542fc39f8630f674128f134b61eb51445da59eb75cce117f17`) and deployed to King using `--no-build` after backup `/opt/chat-reader/backups/csv-table-20260810T010711Z`. API, Web, worker and PostgreSQL are healthy; scanner remains disabled and Alembic remains `20260806_0021`.
- Production Chrome verified the group-owned inline layout and CSV detail Viewer: one `AttachmentViewerShell`, `Table` default with bounded 70-row table, `Raw` toggle and return to `Table`, no legacy preview modal. Previous service image tags were removed after deployment; only the current full SHA and `latest` remain. Volumes were not touched.
- Follow-up release `6d025e7fdcca47334e8020ed8b615f9c4d40d928` was built by Actions run `31347470091` (archive SHA-256 `158dc6e03d2fa6abb536a1c0a66e297e8c42e17512db57b7af6e4e1afb5f88f9`) and deployed with the same no-build procedure. Final Chrome acceptance found zero redundant legacy `Attachment:`/`附件：` captions across Preview panels; meaningful captions remain available. Current containers are healthy and only this SHA plus `latest` are tagged.

## 2026-08-09 Conversation Editing, Import Pairing And Complex Viewer Addendum

- Manual conversation creation is available at `POST /api/conversations`. It atomically creates one non-empty User version followed by one non-empty Assistant version, with optional project ownership.
- Manual insertion is available at `POST /api/conversations/{id}/messages/insert`. It supports before/after placement, one-message role inference, and a fixed User -> Assistant pair. Ordering uses the existing `messages.order_key` with local midpoint allocation and bounded rebalance; no migration was added.
- `DELETE /api/messages/{id}` is a transactional soft delete and `POST /api/messages/{id}/restore` provides short undo. Both accept an optional `expected_offline_revision` query parameter and return 409 on stale conversation state. This is not a Trash product flow.
- The JSON + Markdown exporter path now uses an O(n) unique role/timestamp pairing path. Ambiguous or over-budget pairing returns structured 422 errors instead of an unhandled 500. The optional fixture-gated API test reads `<EXAMPLES_DIR>` without modifying the source files; the verified 398-message preview/commit/retry path completed in 17.7 seconds in the local SQLite test harness.
- Renderer Registry now maps DOCX/ODT to `document`, XLSX/ODS to `spreadsheet`, PPTX/ODP to `presentation`, and ZIP to `archive`. Legacy Office, RTF, TAR-family, EPUB, CAD and 3D formats remain reliable download-only. Complex viewers are lazy-loaded into a Worker and bounded before ZIP expansion; the existing `fflate` dependency is reused and stable export/offline ZIP paths are unchanged.
- Local verification for this addendum: API `216 passed, 3 skipped`; Web lint/typecheck/build PASS; adaptive renderer policy and presentation tests PASS. Complex Viewer and manual conversation browser flows remain `NOT_PRODUCTION_VERIFIED` until deployed and exercised in a dedicated King test conversation.

## 2026-08-09 Attachment Renderer Contract Addendum

- Attachment presentation now separates `AttachmentDataState`, static `RendererCapability`, per-request `RuntimeRenderState`, and `RenderPlan`. Inline UI has exactly three skins: `media`, `preview-panel`, and `file-row`; empty/missing/unsupported/preview failure/offline absence are FileRow variants.
- The root layout mounts one `AttachmentViewerProvider` and one body-level `AttachmentViewerShell`. Reader, file-panel compatibility calls and Gallery sessions use the same shell; the old preview component no longer owns a second portal. Viewer is consumption-only.
- Current-version occurrence metadata (`messageVersionId`, `occurrenceKey`, display order/mode, caption and alt) is included in Reader turns, direct message/block responses and Offline package blocks. Gallery identity is `message_version_id + occurrence_key`; block index is only positioning metadata.
- Image display modes are `auto/small/medium/large` with 280px/480px/Reader-width caps and no forced low-resolution enlargement. Adjacent current-version images form one group; more than six shows five images plus a sixth `+N` entry while retaining the full Viewer session.
- Markdown/text/code/table previews are bounded. Long Markdown Viewer has a contained scroll region; Markdown remains inert. PDF uses lazy PDF.js canvas rendering. Media/image/PDF/text failures show retry/download fallback and runtime codec rejection does not mutate static capability. Office/ODF/EPUB/archive/CAD/3D remain `NOT_IMPLEMENTED` with authenticated download-only fallback.
- API additions include abstract attachment capability flags, checksum/query-bound paginated text search, bounded image thumbnail/preview derivatives and Owner-only worker ZIP downloads. Existing GET/HEAD single-range routes remain the content authority. No migration was added; local schema/migration verification remains at single head `20260806_0021`.
- Local verification on 2026-08-09: Web lint/typecheck/build PASS; API `211 passed, 1 fixture-gated skipped`; attachment API contract `3/3`; final Renderer/SVG/single-portal policy tests `7/7`; PWA default matrix `13 passed, 21 conditional skipped` (`PARTIAL_PASS`).
- Production now runs final source/image commit `5baea32cdada3ed22ae01268cac128f88fa9f527`, built by GitHub Actions run `31269172465` and deployed from verified archive SHA-256 `55a53e8606ae1e404255729dbb566172913997b3678648e3630b95be73400f6e`. Backup `/opt/chat-reader/backups/release-20260808T170034Z-254b5bb` contains a validated PostgreSQL custom dump and import/export/offline/asset archives. API/Web/PostgreSQL are healthy, worker is running, Alembic is `20260806_0021`, and ClamAV remains stopped.
- Production Chrome verified the single body-level Viewer, image Gallery/filmstrip, Markdown Rendered/Source modes, download-only engineering formats, TIFF thumbnail/main failure fallback, Esc, scroll lock and restoration. Full conditional PWA/Offline scenarios and optional complex viewers are not promoted to PASS by this visual acceptance.
- Durable contract: `docs/system/ATTACHMENT_RENDERER_CONTRACT.md`.

## 2026-08-08 Attachment Rendering And Task Checklist Addendum

- Reader attachments use four presentation policies: `inline-rich`, `inline-compact`, `file-card`, and `fallback`. Markdown is rendered through the existing Markdown renderer; text/code/table previews are bounded; TIFF, unsupported media, Office, archive, CAD, and 3D formats use an explicit download fallback instead of a broken preview.
- Attachment preview remains a `document.body` portal with dialog semantics, focus containment, shared body scroll locking, Esc/backdrop close, and trigger focus restoration. The visible panel is now content-specific rather than a viewport-sized white sheet: images/video use a bounded dark stage, audio uses a compact panel, and Markdown/text/table/PDF use bounded document workspaces.
- Consecutive attachments are grouped in Reader output. Images use a gallery and ordinary files use a compact list with an explicit expand action, so fixture-heavy messages do not force every attachment into a large standalone card.
- Conversation CanJSON/Markdown exports exclude `detached` Attachment identities and recalculate attachment/object/reference completeness. System `.cr v4` continues to preserve historical version relationships. Portable Markdown filenames preserve leading dots, Unicode, spaces, case, compound extensions, and business identities that share one AssetObject.
- Online owner Reader task-list markers are interactive. `POST /api/messages/{message_id}/tasks/{task_key}/toggle` uses stable task metadata and base-version conflict checks; a v1 toggle creates v2, while v2+ toggles explicitly replace the current version. Share, Offline Reader, and attachment Markdown previews remain read-only.
- Current verification: Web lint/typecheck/build pass; API `208 passed, 1 fixture-gated skipped`; Alembic has one head `20260806_0021`; PWA/Playwright baseline has `10 passed, 20 conditional skipped`; the real attachment Bundle browser flow passes `1/1` and validates Markdown rendering, bounded image preview, SVG-as-IMG, file groups, Share authorization/revocation, and cleanup.
- Release commit `65585eb40ca1ad44eaeb2ebbe8b6d6be309ddcdc` was built by GitHub Actions run `31242030506` and deployed to King through prebuilt images only. The release archive SHA-256 is `ef3480b2c0afa3b69ed342e53c602ca5028d523561f7859a196683c0af8ea18d`; the validated backup is `/opt/chat-reader/backups/release-20260808T053116Z-4983a8d`. API/Web/PostgreSQL are healthy, the worker is running, Alembic is at `20260806_0021`, and ClamAV remains stopped. Production Chrome visual acceptance is still `NOT_PRODUCTION_VERIFIED` because the requested Chrome extension was unavailable after deployment.

## 2026-08-04 Current Implementation Addendum

- Conversation merge now clones the canonical message/version/render-block/source-ref/annotation graph with bounded batch inserts. It does not reparse Markdown; headings and search are built from canonical projections after ID remapping. Source conversations remain unchanged and notebooks are intentionally excluded.
- `POST /api/tasks/{job_id}/cancel` supports queued cancellation, processing `cancelling`, idempotent repeated cancellation, transactional rollback, and the `cancelled` terminal state. Automatic stale recovery stops after three attempts; explicit retry resets `attempt_count`.
- `BackgroundTaskRead` exposes `cancellable` and `attempt_count`. Production `import-worker` has a default `640m` memory limit through `IMPORT_WORKER_MEMORY_LIMIT`.
- Reader source editing is a fixed left overlay at desktop widths (1024px+), with right-edge-only resize and direct DOM width updates. The main reader temporarily yields `panel width - sidebar width`; closing clears the offset. CodeMirror uses `theme="none"` plus a theme compartment for runtime light/dark reconfiguration.
- Same-message source follow is RAF-coalesced and imperative; the wheel handler no longer increments top-level React state. Search, annotation, and source workspaces use toggle and mutual-exclusion semantics.
- New regression coverage: `apps/api/tests/test_merge_history_and_cancellation.py`.
- Final local validation: 182 API tests, lint, typecheck, production Web build, the PWA matrix, and the focused Reader layout flow pass. The ten paired merge fixtures produce 398 effective messages, 13 non-blocking trailing-empty notices, zero ambiguity, 51,866 copied render blocks, and 11,028 remapped headings; isolated merge time was 7.26 seconds with 132.9 MiB peak process RSS.

最后更新：2026-08-04

## 2026-08-05 Attachment and Sidebar Addendum

- Alembic 当前单一 head 为 `20260806_0021`。附件采用 `AssetObject -> conversation-owned Attachment -> MessageVersion occurrence` 三层模型；`message_version_attachments` 保留物理表名，但每行有独立 ID、`occurrence_key` 和 `placement`，允许同一附件多次出现。上传先进入 `attachment_upload_sessions/items`，只有显式提交或保存消息时才原子提升为 canonical 数据。
- `.crbundle` preview/commit 校验 ZIP 路径、大小、SHA-256、MIME、扫描状态和引用，并兼容 `chat-reader-import-bundle v1`。Reader/Share 使用权限受控 metadata/content 与单 Range 接口；“当前对话文件”抽屉和 Markdown 源码编辑器支持普通上传、未放置文件、已有文件复用及光标/消息尾部插入。
- 对话导出 UI 只暴露 CanJSON、Markdown 和“包含附件”。结果固定为 `.canjsonl`、`.context.zip`、`.md` 或可移植 Markdown ZIP；系统级 `.cr v4` 从“数据与备份”导出，通过已有“导入数据”入口选择恢复文件，服务端仍只允许系统归档恢复到空实例。旧对话级 `.cr` 继续保留导入兼容。
- Context Package 导出前只校验对象状态、大小与 SHA-256 完整性；当前产品策略不执行附件内容秘密扫描或敏感文件排除。未扫描对象仍明确标记 `scanner_disabled`，不能解释为 clean/safe。过期未提交 Bundle preview 会释放 staging 对象；`apps/api/scripts/gc_assets.py` 默认 dry-run、执行时按 30 天无引用/无 lease 保留 tombstone 后删除物理文件。
- Scanner Provider 抽象保留；当前 King 单用户部署固定使用 `DisabledScanner`、`ATTACHMENT_SCANNER=disabled` 和 `ALLOW_UNSCANNED_ATTACHMENTS=true`。当前部署主动关闭附件恶意软件扫描和内容安全审查。附件以 `scanner_disabled`/`unscanned` 未扫描状态正常使用。这是当前单用户部署的已接受策略，不代表文件已经通过安全检测。
- Project/Conversation 菜单已分离；Conversation 支持 archive/unarchive、不可恢复硬删除和单事务 placement，不存在 Trash/restore 产品流程。拖拽按 active 类型过滤 Droppable，统一 `DropIntent` 驱动指示线、optimistic cache 与 placement API。
- 真实附件 fixture 自动化基线为 1 conversation、8 messages、20 attachments、19 resolved、1 missing、18 physical objects、21 occurrences、1 unplaced；测试只通过环境变量读取并在临时目录打包，不修改源目录。

最后更新：2026-08-06

## 2026-08-07 Attachment Workflow Performance Addendum

- Alembic 当前单一 head 为 `20260806_0021`。该迁移补充 `attachments(conversation_id, id)` 与 `message_versions(message_id, created_at)` 索引；现有 occurrence 索引继续覆盖 version/display order 与 attachment lookup。
- 普通上传与消息保存已彻底分离：上传项必须先通过 conversation attachment 接口提升为已存在的 Attachment；`PATCH /api/messages/{id}` 对非空旧 `upload_item_ids` 明确拒绝，不再读取、移动、hash 或检测附件对象。
- 消息保存同步事务只处理 base-version、批量附件归属校验、当前 Markdown 解析、MessageVersion、RenderBlock、AttachmentOccurrence、current-version 指针与必要批注迁移。TOC、搜索、统计和会话摘要在提交后进入去重的 `conversation_derived_rebuild` 任务。
- 保存响应直接返回当前 message/version、render blocks、occurrences 和 conversation attachment summary。Web 使用局部 query cache 替换与单消息重测，不再重新获取完整对话或清空 Reader 窗口；其他 MessageItem 引用保持稳定。
- “当前对话文件”在桌面默认固定于左侧管理工作区，占满视口高度并只允许调整右边缘宽度；打开时覆盖左侧源码工作区但保留其编辑状态，选择附件后返回源码。移动端仍使用覆盖式全宽工作面板。已有 Attachment 通过 `application/x-chat-reader-attachment` 从独立拖动柄进入 CodeMirror，不上传字节、不创建新 Attachment/AssetObject。
- 删除源码附件引用只在保存前统一确认。默认 `keep_in_conversation`；只有不存在其他当前版本引用时才允许 `detach_from_conversation`。detached Attachment 从活动文件列表隐藏，但历史 MessageVersion 仍可读取，AssetObject 仅由后台 GC 在所有真实引用消失后处理。
- Project 与 Conversation Droppable 保持物理分离；未分类接收区是稳定标题行，列表中的 conversation row/insert slot 只表达排序意图。项目/对话查询刷新保留上一份数据，避免拖拽期间卸载目标。

最后更新：2026-08-07

## 项目快照

| 字段 | 当前状态 |
| --- | --- |
| 项目类型 | Monorepo；Web 应用 + 后端服务 + 后台 worker |
| 主要语言 | TypeScript/React；Python 3.11+ |
| 包管理 | Corepack + pnpm 9.15.4；Python setuptools |
| Web | Next.js 14 App Router；9 个页面路由 |
| API | FastAPI 0.12.0；本地 OpenAPI 99 paths / 117 operations |
| 数据库 | PostgreSQL 16；29 张业务表；源码与本地 Alembic 单一 head `20260806_0021` |
| 浏览器离线库 | Dexie version 2；兼容读取 v1；offline package 写 v3、读 v1/v2/v3 |
| 部署 | Compose：postgres、migrate、api、import-worker、web |
| Git 基线 | 应用与镜像源提交为 `5baea32cdada3ed22ae01268cac128f88fa9f527`；最终镜像由 GitHub Actions run `31269172465` 构建，文档证据随后同步 |
| 最近完整验证 | 2026-08-09 本地：Web lint/typecheck/build；API 211 passed / 1 fixture-gated skipped；PWA 基线 13 passed / 21 conditional skipped。King 已部署最终 Viewer commit，并完成真实 Chrome 核心 Viewer/Registry 验收；条件跳过的 PWA/Offline 与可选复杂 Viewer 仍不算 PASS |

## 当前目的与边界

- 导入并长期阅读、搜索、批注、整理、分享和导出已经线性化、标准化的 AI 对话资料。
- 新导入接受 Adaptive JSON/Markdown（单 JSON、单 Markdown、JSON+Markdown，含 CanJSON v1/v2 内置识别）与独立 `.cr` 归档恢复；`.crbundle` 产品入口已移除，不接收未经 Adapter 标准化的 OpenAI 官方图结构/ZIP、CSV、TXT 或 Markdown 单文件提交。
- 主要身份是固定主体 `local:default`；Share 访客仅凭 token 访问授权范围。
- 没有应用内认证、多用户 ACL、在线 AI 生成、标签或语义搜索；复杂 Office 预览仍退化为下载。
- 公网访问控制、TLS、证书与限流属于反向代理/基础设施边界。

## 仓库地图

```text
apps/web/          Next.js UI、Reader、Library、Service Worker、Playwright
apps/api/          FastAPI、SQLAlchemy、Alembic、worker、pytest
packages/          导入解析与渲染共享包
schemas/           导入/归档 schema
deploy/            反向代理示例和备份脚本
docs/system/       当前系统事实
docs/planning/     2026-07-27 改造计划历史档案
docs/execution/    2026-07-27 至 2026-07-29 实施与发布证据
docs/evidence/     2026-07-26 基线截图和只读请求记录
```

## 当前架构

- 浏览器请求同源 `/api/*`；Next.js 在服务端通过 `API_INTERNAL_URL` 转发到 FastAPI。
- 导入先 preview 到带校验和与过期时间的 durable ImportDraft JSONL，再由 PostgreSQL durable queue 和单并发 worker 流式读取同一 Draft 完成 canonical commit。
- `MessageVersion` 第一版永久不可覆盖/删除；第二版及以后只有显式 `replace_current` 才可原地覆盖，其他编辑继续创建新版本，覆盖与删除均写审计事件。当前版本关联有序 `RenderBlock`、`Heading` 和 `SearchDocument`。
- `MessageVersion` 记录 normalizer/Markdown parser/block builder/search document 版本；正文权威语义为现有 `display_text` 列的 `display_markdown` 服务别名。
- SearchDocument 覆盖 conversation、message、heading、code 和 annotation；全文与 trigram 子串共同检索。
- source、export、offline 和 attachment objects 分别写入受控目录/Compose named volume；数据库只存相对 storage key。

## Reader 与界面状态

- user 消息开启一个阅读轮次，后续 assistant/tool/system 消息归入该轮次。
- 在线与 Share 的 `reader-turn` 接口一次返回目标轮次全部正文 blocks 和相邻 anchor；Offline 从 Dexie 组装同一合同。
- 初始/位置恢复窗口最多水合 5 个真实轮次，确保短消息目标有足够上下文对齐阅读线；边缘滑动完成后通常裁剪为 3 个完整轮次。用户进入首/末已加载轮次或接近边缘时预取相邻轮次，响应先按 `turn_key` 合并，再在锚点恢复后按整轮裁剪。合并和裁剪期间固定阅读线上的真实 message/block；只有到达会话真实末尾才保留底部阅读留白。
- `block_count > 160` 或 `char_count > 50000` 的单条消息使用 TanStack Virtual 动态 blocks 虚拟化，正文数据仍完整；目标 block 在导航完成前强制保持挂载。虚拟行使用普通文档流和实测空白补偿，字号、Markdown 间距或正文宽度变化会使布局签名失效并重测，估算偏差不能再造成正文叠放。
- 阅读线为滚动根顶部 120px；ReadingPosition v2 保存 block/version/order/ratio/字符偏移，并兼容读取 v1。
- 桌面侧栏同时显示 Project 树与未归类对话；支持拖放和 Linear 式批量选择。桌面隐藏“最近”入口，移动端保留继续阅读入口和 `/recent`。
- 批注支持浮窗、左侧 dock 和全屏阅读；全部批注与精选笔记可连续阅读或逐条回顾。
- 外观设置提供 Markdown 间距、15-22px 正文字号、正文宽度、主题、语言和默认专注模式。
- `/library` 与在线侧栏、TOC 和 Reader 语义对齐；更新只传输新增或 revision 变化的 conversation。
- 消息工具栏位于正文上方的信息栏。在线 Reader 的桌面顶栏固定为“编辑、搜索、批注、专注、更多”，移动端固定为“导航、编辑、更多”；Share 和 Offline Reader 不显示编辑入口。
- Markdown 源码编辑器是非模态浮动工作区，不替换正文或改变消息高度；桌面可拖动、四边缩放、复位并保存尺寸，移动端使用顶栏下方全宽面板。只有真实 wheel/touch/pointer/阅读键输入会驱动源码单向跟随阅读线；同消息同步源码位置，干净状态跨消息切换，脏状态锁定并要求保存或放弃。保存后局部更新消息与派生数据，工作区保持打开，并用真实 DOM 锚点补偿正文位置。
- 附件预览通过唯一的 React portal 挂载到 `document.body`；覆盖层负责 dialog 语义、共享背景滚动锁、初始焦点、Tab 循环、Esc/背景关闭与触发器焦点恢复。`ViewerPresentationResolver` 将同一 Shell 派生为 compact/reading/document/media/workspace：音频紧凑，Markdown/Text/Code/JSON 为阅读窗，PDF 为文档窗，图片/视频按 intrinsic ratio，CSV 与 Gallery Overview 才使用近全屏 workspace。移动端统一 100vw × 100dvh；桌面可最大化，第一次 Esc 退出最大化、第二次关闭。presentation 不持久化，也不改变正文宽度。
- PDF 的 page/fit/zoom 与可折叠缩略图控制位于共享 Shell 顶栏；单页默认 Fit Page、完整居中且 PDF viewport 不产生纵向滚动，Fit Width/自定义缩放由 PDF Renderer 独占滚动。Shell 本身保持 `overflow: hidden`，避免与 Markdown/PDF 的内容滚动形成双层滚动。
- 图片/视频使用媒体 canvas，音频使用系统 surface，Markdown/文本使用阅读 surface，PDF 使用浅灰 document canvas。图片（含 SVG 图片上下文）最终均为 `<img>`，不内联 SVG XML、不以独立文档打开。
- Adaptive Viewer 当前生产版本为 `a89bc28`，由 GitHub Actions run `31294947752` 构建并以 `--no-build` 部署。生产 Chrome 已验证单页 PDF 从旧 96vw × 94vh 缩为 1120 × 900 document window，Fit Page 无内部纵向滚动；compact/reading/media/workspace、CSS 最大化双阶段 Esc 与 390 × 844 移动端全屏均通过。发布前有效备份为 `/opt/chat-reader/backups/adaptive-viewer-20260809T050228Z-a89bc28`。
- 对话导出主选项仍为 CanJSON/Markdown 与“包含附件”；折叠的二级内容选项控制对话简介、批注、笔记和 CanJSON 来源引用。普通文件与附件 ZIP 复用同一组后端 `ExportOptions`。
- 单消息版本使用持久化左右切换器；第一版受保护，后续版本可永久删除，删除当前版本会回退到编号更小的最近可用版本。统一“拆分对话”工作区支持连续区间、边界双份和离散消息三种非破坏式复制。

## 重要文件

| 路径 | 职责 |
| --- | --- |
| `apps/api/app/main.py` | FastAPI 入口与路由注册 |
| `apps/api/app/services/reader_turns.py` | 完整轮次分组与批量水合 |
| `apps/api/app/services/import_pipeline/draft_store.py` | ImportDraft JSONL、校验和、受控相对路径与过期清理 |
| `apps/api/app/services/exporting/export_service.py` | Markdown v2 与 CanJSON v2 流式投影 |
| `apps/api/app/services/offline_packages.py` | 离线 catalog/package 增量协议 |
| `apps/web/features/conversations/conversation-reader.tsx` | Reader 窗口、导航和位置持久化 |
| `apps/web/features/editing/edit-message-form.tsx` | 动态 CodeMirror Markdown 源码编辑器与保存模式 |
| `apps/web/features/editing/source-attachment-drop.ts` | 源码文件拖放/粘贴、落点解析和草稿 marker 命令 |
| `apps/web/features/editing/source-editor-workspace.tsx` | 浮动源码会话、滚动跟随、脏状态锁定与局部保存 |
| `apps/web/components/floating-workspace-panel.tsx` | 可复用的桌面拖动/缩放/复位与移动端全宽工作面板 |
| `apps/web/features/editing/conversation-split-workspace.tsx` | 三种非破坏式对话拆分计划、预览与执行 |
| `apps/web/features/conversations/reader-navigation.ts` | 目标解析与布局稳定 |
| `apps/web/features/conversations/assistant-message-renderer.tsx` | 极长消息 block 虚拟化与目标固定 |
| `apps/web/lib/reader-data-source.ts` | 在线/离线 ReaderDataSource 合同 |
| `apps/web/features/annotations/annotation-workspace.tsx` | 批注浮窗、dock、展开阅读和管理 |
| `apps/web/features/offline/library-shell.tsx` | Library 壳、同步和本地信息架构 |
| `docker-compose.production.yml` | 生产服务、volume、healthcheck 和网络 |

## 已验证命令

以下是 2026-08-05 本轮实现后的本地记录；生产结果在发布完成后追加到 `results.md` 和执行档案。

| 命令/检查 | 最后记录 |
| --- | --- |
| `corepack pnpm run lint` | 通过，0 warnings |
| `corepack pnpm run typecheck` | 通过 |
| `corepack pnpm --filter web build` | 通过，9 个页面路由 |
| `corepack pnpm run test:api` | 通过，205 passed；1 个真实 fixture 条件 skip，不计为 PASS |
| `corepack pnpm --filter web test:pwa` | 基线 8 passed；20 个需要在线 API/专项 fixture 的场景按条件 skipped，不计为 PASS |
| 附件/Reader/DnD 在线 Playwright | 通过，11/11：文件选择、独立多文件上传、拖放/粘贴、围栏选择、保留未放置文件、已有 Attachment 拖入、删除引用确认、配对导入、结构化侧栏 DnD 与 4 条长 Reader 恢复场景 |
| `E2E_LONG_READER=1 ... reader-restoration.spec.ts` | 通过，4 tests；含虚拟目标、TOC、布局变化、批注恢复与边缘锚点 |
| 本地 Chrome production Reader | 通过；目标误差 4px，继续滚动后刷新恢复到同一 block |

## 当前风险与待验证

| 风险 | 当前控制/状态 |
| --- | --- |
| 应用没有认证 | 必须由反向代理限制公网访问 |
| King 扫描器关闭 | `DisabledScanner`；附件显示 `scanner_disabled`/`unscanned`/“未扫描”并可正常使用，不显示 clean/safe；这是已接受部署策略，不代表经过安全检测 |
| 复杂 Office/OCR/CAD/压缩包预览 | `NOT_IMPLEMENTED`；只提供受控下载，不阻塞基础附件链路 |
| 单轮可能包含极大正文 | 数据仍完整进入内存；blocks DOM 仅在极长消息阈值下虚拟化，需继续监测内存与动态测量 |
| 真实设备存储配额与缓存清理 | 自动化覆盖主要失败态；不同浏览器仍需实机验证 |
| 生产 Share 附件链路 | `PASS`；用户确认允许范围预览/下载、越权拒绝和撤销失效，文档不保存真实 token |
| 生产 TLS/证书配置 | 仓库外管理，本文无法验证完整配置 |
| King 原机 Web 构建 | 约 2 GiB 主机即使暂停 worker 仍发生 OOM，PostgreSQL checkpointer 被杀后 WAL 恢复；本轮恢复后 dump 已用 `pg_restore -l` 校验。后续必须在 CI/独立构建机生成 Linux 镜像并传输，禁止在 King 原机执行 Next production build |
| 发布同步 | GitHub Actions run `31083578130` 构建并打包提交 `af17c93` 的 Linux 镜像，归档 SHA-256 为 `918dc9a3121e8d83dd917839b55b778e53a9c3b8d303937624124dab9650cd17`；King 已备份并执行拉取、校验、`docker load`、migration 与 `--no-build` 更新，原 dirty worktree 保存在服务器 Git stash 中 |

## 文档地图

| 文档 | 用途 |
| --- | --- |
| `README.md` | 人类入口和快速开始 |
| `AGENTS.md` | 最小开发/智能体约束 |
| `docs/index.md` | 全部文档导航 |
| `docs/product.md` | 当前产品能力与边界 |
| `docs/architecture.md` | 架构和关键数据流 |
| `docs/api-reference.md` | 业务 API 参考 |
| `docs/system/README.md` | 当前系统事实索引 |
| `docs/documentation-inventory.md` | 每个 Markdown 的生命周期与所有权 |

## 后续工作准则

1. 先核验当前代码与 migration，再修改任何“当前事实”文档。
2. 功能变更后运行与风险匹配的测试，并把新结果追加到新的执行记录，不覆盖旧证据。
3. 部署前备份 PostgreSQL 和三个 artifact volume，按 `postgres -> migrate -> api/worker -> web` 依赖验证。

## 不要假设

- 不要把 `docs/planning/` 的已完成计划当成当前规范；后续用户覆盖和代码事实优先。
- 不要把 message-window/blocks 兼容接口当成 Reader 主加载路径。
- 不要假设本地 Alembic head 已自动部署；应分别执行 `alembic heads` 与生产 `alembic current`。
- 不要将导入目录中的 Markdown 当作项目文档，也不要将私密正文写入证据。

## 2026-08-02 Reader 排版与定位补充

- Markdown 三档间距由统一变量驱动，普通块与虚拟块共用同一 `BlockSlot`；消息间距和正文宽度不随间距档位改变。
- 有序列表保留源 `start`，标题支持安全行内 Markdown，TOC 使用同一纯文本清洗规则。
- 极长消息仍完整获取 blocks，仅在 DOM 层虚拟化；虚拟行采用普通文档流和实测空白补偿，不允许估算高度让正文相互覆盖。
- 字号、Markdown 间距或正文宽度切换会先捕获阅读线上的真实 block，暂停虚拟器自动补偿，再恢复该锚点。
- 批注高亮通过 Reader 级 block registry 跟随虚拟 block 挂载；定位事务持有目标 block lease，只有 Reader 导航事务可以写最终滚动位置。

## 2026-08-04 导入与连续阅读补充

- 形式 1 导入先分别过滤 JSON/Markdown 尾部空白消息，再按非空消息顺序校验 role/timestamp；JSON 保持 metadata、role、time 和源索引权威，配对状态为 exact/normalized/by_order 时 canonical `display_markdown` 取 Markdown，JSON-only 导入仍取 JSON。
- JSON+Markdown 配对会枚举全部 `Prompt`/`Response` 标题候选，再用非空 JSON 消息的角色、规范化时间、顺序和正文相似度选择唯一最佳完整路径；未选标题保留在相邻 Markdown 正文内。完整路径缺失、同分或顺序冲突仍回退到保守解析并阻止提交；Markdown-only 兼容路径和未闭合围栏恢复保持不变。导入 parser/Markdown parser 版本为 v4，当前导出器带官网 URL 的 `metadata.powered_by` 形式受支持。
- Import Preview 返回受限长度且保留换行的首条 user Markdown；同步 commit 或 worker 完成后 Web 清除旧预览并进入新 Reader。历史有效配对可用 `python -m scripts.backfill_exporter_markdown` dry-run，再以 `--apply` 创建可审计的系统修复版本；后续编辑过的 current version 不覆盖。
- 在线、Offline 和 Share Reader 的边缘加载统一采用完整轮次合并、真实 block lease 和锚点恢复；继续向同一方向滚动不会把正在完成的边缘事务误判为取消。

## 2026-08-04 消息编辑、版本与拆分补充

- 收藏、选择、源码编辑和单消息版本控件位于消息信息栏，桌面 hover/focus 显示，移动端通过消息操作菜单使用；控件不再覆盖 Markdown 标题。
- Markdown 编辑器按需加载 CodeMirror 6，支持源码高亮、行号、查找、折行和独立内部滚动；正式 light/dark theme extension 覆盖正文、行号、活动行、选区、搜索、tooltip 和 Markdown token，主题重配置不丢失文本、光标或撤销栈。
- `PATCH /api/messages/{id}` 的 `save_mode` 默认为 `create_version`；`replace_current` 仅允许第二版及以后。版本选择直接持久化 `current_version_id`，版本删除保护第一版并在删除当前版本时自动回退。
- Reader 不再提供按字符拆分单条消息的入口；旧 API 仍兼容。新的对话拆分 plan/execute 支持 `range_copy`、`boundary_copy` 和 `discrete_copy`，均重建新会话派生数据且不修改来源会话。

## 2026-08-05 附件导出与派生补充

- `format=markdown_bundle` 与 `format=canjson_bundle` 通过后台任务生成当前版本附件包；正文入口分别为 `conversation.md`/`conversation.canjsonl`，物理对象使用 `assets/objects/<sha-prefix>/<sha256>`。manifest 分开记录对话/附件完整性和所选二级内容；当前不执行内容秘密扫描，`excluded_object_count` 仅保留兼容字段并为 0。
- 附件派生任务当前提供受限 `text_extract`：最多读取 2 MiB，复用 AssetObject 去重，完成后把文件名和提取文本写入现有 `search_documents` 的 `attachment` 文档类型。
- 复杂 Office/压缩包预览默认关闭；只有同时配置 `COMPLEX_ATTACHMENT_PREVIEW_ENABLED=true` 与独立 `ATTACHMENT_PREVIEW_ORIGIN` 才会进入 sandbox adapter，否则强制下载回退。主站不以内联方式执行主动内容。

## 2026-08-06 源码附件拖放与粘贴补充

- Markdown 源码编辑器的文件选择、真实文件拖放和剪贴板文件粘贴共用同一上传暂存控制器。拖放使用 CodeMirror `posAtCoords` 定位实际光标，编辑器显示插入光标；多文件按 DataTransfer 顺序插入独立临时行。
- 临时源码只使用编辑器草稿态 `cr-upload://<draft-token>`，顶部/底部草稿区显示每个文件的上传进度、失败重试和移除。上传成功后原位替换为 UploadItem UUID，消息 API 保存时在事务内提升为对话级 Attachment 并写入 MessageVersion occurrence；最终 canonical 内容不会保留 draft token 或 `cr-upload://`。
- 代码围栏内的拖放不会静默写入：默认提示插入到围栏后，也可选择仍作为普通文本或取消；已有 Markdown 链接内的落点移动到完整链接之后，避免破坏链接语法。保存前存在上传中/失败/未解析草稿会阻止提交。
- 关闭带未保存附件的源码工作区时可选择保留到“当前对话文件”（无 occurrence）或删除暂存项；已移除的草稿不再参与保留。服务端拒绝漏传 UploadItem、非法 draft token 和残留 `cr-upload://`，并返回源码行号。

## 2026-08-10 Reader Scroll Stabilization (Current)

- Production wheel-scroll regression fixed in commit `e4bc9c3ce00ed7071d896546df330cdd1a0f1b53`. The existing virtualized Reader and public contracts remain intact. Block estimates now use content width, font metrics, explicit line counts, Unicode display width and block-specific limits.
- A single passive scroll coordinator samples active content at most every 80ms and saves one reading position after roughly one second of idle time. Sentinel IntersectionObserver is the only edge-loading trigger. Measured-height compensation applies only to rows fully above the reading line.
- Local production-build Chromium (three repeats): p95 frame interval 16.7ms; longest task 72/68/70ms; total long-task time 72/68/70ms. All configured budgets passed.
- Production Chrome read-only verification: 30 real wheel steps were monotonic (`minDelta=119.576px`, `reverseSteps=0`) while six messages stayed mounted. A warmed 1,080px segment corrected virtual height by 85px. TOC followed block 54 to block 62. A temporary 17px font change invalidated layout correctly and was restored to 16px.
- The server persisted block 68. After hard navigation, asynchronous restoration settled back to the same message and block 68; the early top-of-window state was the restore-loading interval, not lost data.
- GitHub Actions run `31385483844` built `e4bc9c3`; artifact SHA-256 `1deddb658a8c663111e530ffd793cb3f437cc9498ca68fded7dd498934f8c777` matched locally and on King. Deployment used `--no-build`; health checks passed; Alembic remains at the single head `20260806_0021`. Verified rollback backup: `/opt/chat-reader/backups/reader-scroll-20260810T120035Z-e4bc9c3`.

## 2026-08-10 Reader Scrollbar-Thumb Blank-Window Closure

- Commit `771f4c864df7d7dea619a17eb19339ae971a2f28` closes the remaining native-scrollbar large-jump gap. A visible virtual message now repairs a stale absolute coordinate when none of its mounted rows intersects the Reader. Native pointer-held scrollbar gestures rebase before movement and defer sentinel edge-window changes until pointer release; a viewport-scale non-wheel jump also requests a rebase. These paths do not clear TanStack's measured row cache or add DOM measurement to ordinary wheel frames.
- GitHub Actions run `31398377216` produced archive SHA-256 `b8c6dc8e7769cfe4e03e9523595b179f50308a045f78ebe8beb71a44291e1000`. King deployed prebuilt images with `--no-build`; backup `/opt/chat-reader/backups/reader-scrollbar-20260810T141005Z-5e50a6e` remains the verified rollback point. API/Web/PostgreSQL are healthy, worker is running, Scanner is disabled and Alembic remains `20260806_0021`.
- Real production Chrome read-only verification on the reported long conversation dragged the native scrollbar thumb between distant positions in both directions. The first destinations immediately retained 15 and 14 visible blocks; a further five-position sweep recorded `blankCount=0` and 11-15 visible blocks at every destination, rather than a visible article with zero blocks. The production user path is PASS; PWA conditional cases retain their separate `PARTIAL_PASS` status.

## 2026-08-29 Citation Locate Performance (Local)

- Owner and Share Reader-turn loading now resolves only the target turn with permission-scoped order-key queries; legacy mixed/null turn metadata safely falls back to the canonical full grouping path.
- Target-first navigation renders the fetched turn immediately and prefetches neighboring turns after alignment. Concurrent identical target-turn/context requests are deduplicated for the request lifetime only.
- Text-anchor resolution caches the mounted block's text-node index and invalidates it on DOM mutation. Exact text/offset targets skip a redundant scroll-anchor stabilization wait; neighbor-window expansion restores the captured anchor.
- Verification: API full suite `391 passed, 5 skipped`; Reader/Share performance tests `16 passed` (including a middle-turn boundary case); Web lint, typecheck, production build and Alembic single head `20260823_0028` passed. PWA suite was started but stopped after environment-dependent CSP/offline timeouts; no PWA PASS claim is made for this change.

## 2026-08-31 Offline Package Completeness Guard (Current)

- Offline package import now validates every declared conversation `message_count` against the exact embedded `messages` array before touching Cache Storage or replacing IndexedDB rows. Invalid or incomplete packages fail closed and preserve the last readable offline copy.
- Package generation derives `message_count` from the serialized active message rows, avoiding stale aggregate metadata. Packages without the field remain compatible with older v1 data.
- Verification: Web typecheck passed; production Web build passed; Chromium 1234 PWA negative count-mismatch regression passed (`PWA-NEG-022`). The full negative matrix was not claimed locally because its Service Worker shell fixture timed out before reaching the import tests.

## 2026-08-31 Offline Import Error Classification (Current)

- Offline package download, storage quota, malformed payload and browser write-abort failures now carry stable error codes. The Library maps those codes to localized, actionable messages while preserving the existing offline copy.
- Capacity errors ask the user to free browser storage; malformed packages ask for a rebuild rather than implying that storage cleanup will help. Raw package contents and attachment paths are not exposed in the user-facing message.
- Verification: Web lint/typecheck and the dedicated production PWA build passed. Chromium 1234 passed the targeted quota (`PWA-NEG-008..009..015`) and malformed count (`PWA-NEG-022`) paths. The Service Worker-dependent full negative matrix remains a CI gate, not a local PASS claim.
