# Continuous Improvement Backlog

Last reviewed: 2026-08-31  
Owner: repository maintainers  
Scope: single-owner Chat Reader Web/API/worker/deployment lifecycle

This is a living candidate register, not a defect declaration. Every item keeps
its evidence level and must be revalidated before implementation. `Observed`
and `Strong` entries are grounded in current code, tests, deployment evidence,
or production diagnostics. `Inferred` entries are design or operational risks
that need a focused check. `Hypothesis` entries require measurement before
being promoted. Status is `Candidate` until a separate implementation cycle
adopts it.

Priority fields use `H/M/L`; effort and risk use `S/M/L`. Impact and urgency
are user or operator consequence, not code size.

## Candidate Register

| ID | Area | Concrete improvement | Evidence | Impact | Urgency | Confidence | Effort | Risk | Status |
|---|---|---|---|---:|---:|---|---:|---:|---|
| CI-001 | Recovery | Make `deploy/backup.sh` create and verify the database plus all five artifact archives under one timestamped manifest. | Strong: current script only dumps PostgreSQL; deployment used manual archive checks. | H | H | Strong | M | M | Completed 2026-08-31; shell-verified |
| CI-002 | Recovery | Add a dry-run restore verifier that checks archive lists, checksums, and PostgreSQL catalog compatibility without changing live volumes. | Strong: release evidence performs these checks manually. | H | H | Strong | M | L | Completed 2026-08-31; shell-verified |
| CI-003 | Recovery | Add a documented retention report for backup directories before pruning old releases. | Strong: retained release and backup directories are currently operator-managed. | M | M | Strong | S | M | Candidate |
| CI-004 | Recovery | Record backup schema/tool versions and source SHA in the backup manifest. | Strong: deployment manifest already records image/source metadata separately. | M | M | Strong | S | L | Completed 2026-08-31; source SHA, PostgreSQL tool, and manifest schema recorded |
| CI-005 | Recovery | Add a restore rehearsal fixture for `.cr` archives and attachment assets using disposable volumes. | Strong: `.cr` round-trip is tested, but release restore still needs operational rehearsal. | H | M | Strong | L | L | Candidate |
| CI-006 | Recovery | Add an operator command to compare current database attachment references with filesystem assets before deploy. | Strong: artifact lifecycle contract requires stage/validate/publish boundaries. | H | H | Strong | M | M | Candidate |
| CI-007 | Recovery | Emit a bounded report for `SAFE_TEMP`, `ORPHAN_FINAL`, and `SUPERSEDED_ARTIFACT` cleanup debt. | Observed: cleanup classifier exists and production has orphan debt. | H | M | Observed | M | M | Candidate |
| CI-008 | Recovery | Add a manual, race-safe apply mode for only explicitly approved artifact cleanup candidates. | Strong: automatic cleanup is intentionally disabled; dry-run exists. | H | M | Strong | L | H | Candidate |
| CI-009 | Recovery | Verify backup storage free space and fail before starting a partial backup. | Inferred: current script writes directly without a preflight capacity check. | H | H | Inferred | S | M | Completed 2026-08-31; conservative size preflight added |
| CI-010 | Recovery | Add a backup failure notification hook that contains no conversation content or secrets. | Hypothesis: operators currently discover failures from command output. | M | M | Hypothesis | M | M | Candidate |
| CI-011 | CI | Cache the Web production build output between quality and negative-PWA gates where valid. | Observed: workflow runs Web production build before tests and again for PWA negative matrix. | M | M | Observed | M | M | Candidate |
| CI-012 | CI | Split API-only and Web-only quality jobs so unrelated failures identify their owner faster. | Observed: one quality job contains both suites and browser services. | M | M | Strong | M | M | Candidate |
| CI-013 | CI | Add explicit timeout and artifact collection for every long browser gate. | Strong: first deployment attempt timed out in optional SW readiness. | H | M | Strong | M | L | Completed 2026-08-31; 15/15 gates are bounded and run 33331355359 attempt 2 retained 12/12 passed release-gate records |
| CI-014 | CI | Publish deployable artifact names with commit SHA and run attempt instead of a constant name. | Observed: workflow artifact is always `chat-reader-images`. | M | M | Observed | S | L | Completed 2026-08-31; Actions run 33329145714 verified exact name |
| CI-015 | CI | Add a machine-readable gate summary that distinguishes PASS, NOT VERIFIED, and SKIPPED. | Strong: current reports require manual interpretation of gates. | M | M | Strong | M | L | Candidate |
| CI-016 | CI | Add pnpm store cache hit/miss metrics to release evidence. | Inferred: setup-node caches pnpm but no effectiveness evidence is recorded. | L | L | Inferred | S | L | Candidate |
| CI-017 | CI | Add a changed-area test selector while retaining the full release gate before deployment. | Inferred: every local cycle runs broad suites even for narrow docs/UI changes. | M | L | Inferred | M | M | Candidate |
| CI-018 | CI | Upgrade GitHub Actions runtime versions after compatibility verification and record the migration. | Observed: workflow currently uses setup actions with changing Node runtime warnings. | M | M | Strong | S | M | Candidate |
| CI-019 | CI | Add a release artifact download-and-inspect job independent from the image builder. | Strong: deploy uses downloaded artifact and image inspection is a critical boundary. | H | M | Strong | M | M | Candidate |
| CI-020 | CI | Preserve browser reports per gate with a stable index linking source SHA and environment. | Strong: reports are uploaded, but gate ownership is not centralized. | M | L | Strong | M | L | Candidate |
| DEP-001 | Deployment | Add a preflight that rejects `http://host:443` and verifies HTTPS redirect/TLS listener behavior. | Observed: screenshot showed plain HTTP sent to HTTPS port; HTTPS root returns 307. | H | H | Observed | S | L | Completed 2026-08-31; external HTTPS verifier added |
| DEP-002 | Deployment | Add a post-deploy check that running container OCI revisions equal the release SHA. | Observed: deployment performs this manually and images are immutable. | H | H | Strong | S | L | Completed 2026-08-31; read-only runtime verifier added |
| DEP-003 | Deployment | Add a post-deploy check that PostgreSQL was not unintentionally restarted during Web/API rollout. | Strong: current deployment explicitly preserves PostgreSQL. | H | M | Strong | S | M | Candidate |
| DEP-004 | Deployment | Move server current-image and rollback state into a documented operator-owned state location. | Observed: `current-images.env` and rollback state are untracked server files. | M | M | Observed | M | M | Candidate |
| DEP-005 | Deployment | Add release disk-space preflight covering image layers, backup, and transfer directory. | Inferred: King build OOM and storage pressure are known operational risks. | H | H | Strong | S | M | Candidate |
| DEP-006 | Deployment | Add a bounded release transfer cleanup procedure that preserves the active and previous rollback artifacts. | Observed: release transfer directory remains retained after deployment. | M | M | Strong | M | M | Candidate |
| DEP-007 | Deployment | Add a rollback smoke test that checks health, migration head, and anonymous auth boundaries. | Strong: rollback images are retained but checks are manual. | H | M | Strong | M | M | Candidate |
| DEP-008 | Deployment | Pin and periodically verify the external Chromium path used for browser acceptance. | Observed: authenticated browser verification is environment-dependent. | M | M | Strong | S | L | Candidate |
| DEP-009 | Deployment | Add an operator runbook for production-equivalent versus production verification labels. | Strong: current evidence distinguishes these levels and avoids overclaiming. | M | M | Strong | S | L | Candidate |
| DEP-010 | Deployment | Add a health check for core services and a recent worker heartbeat after rollout. | Observed: worker liveness is a release gate and production diagnostic. | H | H | Observed | S | L | Completed 2026-08-31; protected runtime health verifier added |
| OFF-001 | Offline | Make offline package import commit in bounded chunks with resumable progress after IndexedDB abort. | Observed: prior `searchDocuments.bulkPut` aborted thousands of operations. | H | H | Observed | L | H | Candidate |
| OFF-002 | Offline | Add an offline package preflight estimating IndexedDB quota before packaging/import. | Strong: browser quota and eviction variance are documented risks. | H | H | Strong | M | M | Candidate |
| OFF-003 | Offline | Add an import journal that records the last completed store/chunk without storing conversation content. | Inferred: current abort can leave an apparently downloaded package with no usable content. | H | H | Inferred | L | H | Candidate |
| OFF-004 | Offline | Validate that offline Reader message counts and TOC entries are non-zero after package import. | Observed: a successful download opened with `0 / 0` messages. | H | H | Observed | M | M | Candidate |
| OFF-005 | Offline | Keep v1 package reads while writing v2 import diagnostics for schema/store mismatches. | Strong: AGENTS requires v1 compatibility. | H | M | Strong | M | M | Candidate |
| OFF-006 | Offline | Add an offline asset URL lifecycle test covering revoke timing after Viewer close. | Strong: offline attachment URLs are released by timed cleanup. | M | M | Strong | M | M | Candidate |
| OFF-007 | Offline | Add a visible retry path when one store fails without discarding stores already imported. | Strong: partial package failure is a known recovery concern. | H | M | Strong | M | M | Candidate |
| OFF-008 | Offline | Add low-storage messaging that differentiates quota denial from malformed package data. | Inferred: both currently surface as import failure to users. | M | M | Inferred | S | L | Candidate |
| OFF-009 | Offline | Measure package build and import timings by store and chunk size in redacted diagnostics. | Hypothesis: packaging latency is dominated by one or more unbounded stores. | M | M | Hypothesis | M | L | Candidate |
| OFF-010 | Offline | Add mobile offline acceptance at 375px for Library, Reader, TOC, and attachment access. | Strong: desktop and production-equivalent coverage do not replace real mobile verification. | M | M | Strong | M | L | Candidate |
| LOC-001 | Reader | Return a server-resolved locator DTO for every TOC, search, annotation, attachment, and source reference. | Strong: current audit found divergent DOM/block-index authorities. | H | H | Strong | L | H | Candidate |
| LOC-002 | Reader | Replace DOM text reverse lookup with canonical MessageVersion/RenderBlock offsets. | Strong: rendered Markdown differs from source text and causes misses. | H | H | Strong | L | H | Candidate |
| LOC-003 | Reader | Preserve attachment `occurrence_key` through Files Panel, resolver, and final highlight. | Observed: front-end previously dropped occurrence identity. | H | H | Observed | M | M | Candidate |
| LOC-004 | Reader | Return all same-block attachment occurrences instead of a single dictionary value. | Observed: single-value `occurrence_by_block` overwrote siblings. | H | H | Observed | M | M | Candidate |
| LOC-005 | Reader | Add locator version 2 compatibility and stale/ambiguous/not-found status rendering. | Strong: target locator plan defines these statuses. | H | H | Strong | M | M | Candidate |
| LOC-006 | Reader | Batch target context and turn-window loading into one resolver response. | Strong: current flow makes duplicate target/turn requests. | M | M | Strong | M | M | Candidate |
| LOC-007 | Reader | Add a bounded mount lease for virtualized target blocks before scrolling. | Strong: target blocks may not be mounted when a locator resolves. | H | M | Strong | M | M | Candidate |
| LOC-008 | Reader | Keep Reader content visible on locator failure and expose message-level recovery. | Observed: prior failures could leave confusing empty/failure states. | H | H | Strong | M | L | Candidate |
| LOC-009 | Reader | Replace full-message locate background with a short first-line pulse and reduced-motion marker. | Observed: current locate feedback was visually uncomfortable. | M | M | Observed | S | L | Candidate |
| LOC-010 | Reader | Add same-text multi-match tests for Unicode, formulas, Markdown markers, and historical versions. | Strong: these are explicit unresolved locator cases. | H | M | Strong | M | L | Candidate |
| ATT-001 | Attachments | Run a read-only attachment reference integrity report across current and historical MessageVersions. | Strong: legacy merge failures can leave stale occurrence links. | H | H | Strong | M | L | Candidate |
| ATT-002 | Attachments | Add fail-closed merge validation for missing Attachment, block, occurrence, or cross-conversation references. | Strong: merge plan requires transaction rollback on missing mappings. | H | H | Strong | M | H | Candidate |
| ATT-003 | Attachments | Recompute `plain_text`, content hash, RenderBlock text, and sanitized HTML after attachment rewrites. | Strong: prior merge only rewrote selected fields. | H | H | Strong | M | H | Candidate |
| ATT-004 | Attachments | Preserve multiple occurrences per block in API and Files Panel responses. | Observed: single-value block maps lose siblings. | H | H | Observed | M | M | Candidate |
| ATT-005 | Attachments | Add a repair command only for UUID mappings that are unique within one conversation. | Strong: plan explicitly forbids filename/order guessing. | H | M | Strong | M | H | Candidate |
| ATT-006 | Attachments | Add post-merge consistency checks for Reader, Source Editor, Files, Viewer, Search, TOC, and Offline derivations. | Strong: these surfaces must remain coherent after merge. | H | M | Strong | L | M | Candidate |
| ATT-007 | Attachments | Display an actionable stale-reference state with message fallback and rescan action. | Strong: audit defines explicit recovery actions. | M | M | Strong | S | L | Candidate |
| ATT-008 | Attachments | Add case-insensitive `cr-asset://UUID` parser tests with query/parenthesis edge cases. | Strong: old replacement was case-sensitive and delimiter-dependent. | M | M | Strong | S | L | Completed 2026-08-31; 3 targeted API tests pass |
| ATT-009 | Attachments | Add regression fixtures for image, file, repeated, historical-version, and merged references. | Strong: required attachment acceptance scenarios are listed. | H | M | Strong | M | L | Candidate |
| ATT-010 | Attachments | Add a user-visible distinction between file metadata/details and direct body navigation. | Strong: current Files Panel mixed these actions. | M | M | Strong | M | L | Candidate |
| IMP-001 | Import | Make `SUPPORTED`, `MAPPABLE`, and `NOT_MAPPABLE` server classifications authoritative in every Import surface. | Strong: current UI previously inferred mapping from resolution status. | H | H | Strong | M | M | Candidate |
| IMP-002 | Import | Prevent a NOT_MAPPABLE input from generating a mapping plan or fake canonical preview. | Strong: explicit product boundary. | H | H | Strong | M | M | Candidate |
| IMP-003 | Import | Preserve resolved Families when a different input is replaced or excluded. | Strong: mixed-batch flow requires session-local replacement. | H | M | Strong | M | M | Candidate |
| IMP-004 | Import | Add deterministic batch completion with committed/failed/skipped counts and result scope. | Strong: previous batch success opened only the first conversation. | H | H | Strong | M | M | Candidate |
| IMP-005 | Import | Add compact imported-conversation links using existing session/task retention, without ImportBatch persistence. | Strong: explicit no-new-product boundary. | M | M | Strong | M | M | Candidate |
| IMP-006 | Import | Preserve original opener on Import close, including Reader, Project, Library, and Unclassified. | Strong: return contract is explicit. | H | M | Strong | M | L | Candidate |
| IMP-007 | Import | Add a Rescue Skill copy/download path that never uploads source content automatically. | Strong: privacy boundary and static skill resources are current contracts. | M | M | Strong | M | L | Candidate |
| IMP-008 | Import | Add file replacement validation that re-analyzes only the replaced input row. | Strong: required rescue flow replaces in the same session. | H | M | Strong | M | M | Candidate |
| IMP-009 | Import | Add per-Family diagnostics explaining why a document cannot be safely mapped. | Strong: user reported ordinary documents incorrectly entering repair. | H | H | Strong | S | L | Candidate |
| IMP-010 | Import | Add unknown-format fixtures from `examples` that assert NOT_MAPPABLE rather than repairable. | Observed: examples include non-conversation documents. | H | H | Observed | S | L | Candidate |
| TASK-001 | Background tasks | Keep one stable global Tasks launcher for import, merge, delete, export, and cleanup. | Strong: monitor is global but was visually owned by Import. | H | H | Strong | M | M | Candidate |
| TASK-002 | Background tasks | Add refresh/re-entry tests that reopen an active task after leaving its origin. | Strong: this is a core task-center contract. | H | H | Strong | M | L | Candidate |
| TASK-003 | Background tasks | Distinguish presentation dismissal from server-side cancellation in every task surface. | Strong: explicit cancellation boundary. | H | H | Strong | S | L | Candidate |
| TASK-004 | Background tasks | Preserve finish-current-item/stop-future-items deletion cancellation semantics in copy and API tests. | Strong: current deletion semantics are intentionally non-transactional. | H | H | Strong | M | H | Candidate |
| TASK-005 | Background tasks | Expose truthful completed, partial, failed, and retry result actions per task type. | Strong: generic Done wording hides actual outcomes. | H | M | Strong | M | M | Candidate |
| TASK-006 | Background tasks | Add bounded retention telemetry for terminal task results without creating permanent history. | Strong: retention is a current implementation decision. | M | M | Strong | M | L | Candidate |
| TASK-007 | Background tasks | Add idempotent retry tests for cleanup, merge, export, and import tasks. | Strong: worker retry exists and task classes differ. | H | M | Strong | M | M | Candidate |
| TASK-008 | Background tasks | Add mobile full-height task surface acceptance while keeping the same global task semantics. | Strong: mobile card is only a shortcut representation. | M | M | Strong | M | L | Candidate |
| TASK-009 | Background tasks | Add queue wait and execution latency histograms to protected aggregate diagnostics. | Observed: current diagnostics expose averages but not distributions. | M | M | Observed | M | L | Candidate |
| TASK-010 | Background tasks | Add a worker stale-heartbeat alert threshold tied to existing liveness settings. | Strong: heartbeat is already a release contract. | H | H | Strong | S | M | Candidate |
| UX-001 | Navigation | Keep Sidebar mounted across Conversation, Project, Recent, Search, and Home soft navigation. | Observed: prior route shells remounted and looked like full refreshes. | H | H | Observed | M | M | Candidate |
| UX-002 | Navigation | Add browser-flow assertions that only the正文 surface changes on list navigation. | Strong: soft-navigation acceptance requires DOM/request evidence. | H | M | Strong | M | L | Candidate |
| UX-003 | Navigation | Ensure project rows and conversation rows share the same custom-drag affordance without native link drag ghosts. | Observed: project drag still showed a link-like preview. | M | M | Observed | M | L | Candidate |
| UX-004 | Navigation | Keep project order custom-only while preserving existing conversation sort rules and compatibility query fields. | Strong: current product decision explicitly separates these semantics. | M | M | Strong | S | M | Candidate |
| UX-005 | Navigation | Add delayed, collision-aware description previews for truncated project/list rows. | Strong: current UI includes a shared hover preview pattern. | M | L | Strong | M | L | Candidate |
| UX-006 | Navigation | Make Settings an upward sidebar region with bounded height and internal scroll. | Observed: Settings was too tall/modal-like in screenshots. | M | M | Observed | M | L | Candidate |
| UX-007 | Navigation | Add an explicit close affordance and Escape behavior to all transient More menus. | Observed: native details menus required re-clicking to close. | M | M | Strong | S | L | Candidate |
| UX-008 | Navigation | Keep batch mode toggle width stable and label its exit as `完成`/`Done` with an X icon. | Observed: current batch control disappeared after activation. | M | M | Observed | S | L | Candidate |
| UX-009 | Navigation | Make Merge Conversations a dialog or full-width surface independent of the list row clipping boundary. | Observed: merge action was constrained inside a list frame. | M | M | Strong | M | M | Candidate |
| UX-010 | Navigation | Remove or replace non-actionable hover styles on Project and All Conversations rows. | Observed: users reported rows looking disabled while still clickable. | M | M | Observed | S | L | Candidate |
| SEC-001 | Security | Add automated assertions that user Skill content is never sent to logs, telemetry, Share, or Offline Catalog. | Strong: Skill security contract explicitly forbids these paths. | H | H | Strong | M | M | Candidate |
| SEC-002 | Security | Add owner/share/offline matrix tests for Settings, Tasks, Skills, and attachment controls. | Strong: permission boundaries are explicit and high impact. | H | H | Strong | M | M | Candidate |
| SEC-003 | Security | Add a static-resource CSP test for built-in Skill Markdown files. | Strong: built-in resources are served through current CSP/static policy. | M | M | Strong | S | L | Candidate |
| SEC-004 | Security | Reject uploaded Skill files containing invalid UTF-8, binary bytes, empty content, or oversized payloads before persistence. | Strong: upload contract defines all four checks. | H | H | Strong | M | L | Candidate |
| SEC-005 | Security | Add tests proving Skill previews use text-only rendering and cannot execute HTML/Markdown scripts. | Strong: user configuration is displayed in `<pre>`. | H | M | Strong | S | L | Candidate |
| SEC-006 | Security | Add redaction assertions for request IDs, attachment paths, and error messages in structured logs. | Strong: observability contract requires redaction. | H | M | Strong | M | M | Candidate |
| SEC-007 | Security | Add a regression test that public Share never exposes owner-only backup/security/import-format controls. | Strong: Share-scoped shell boundary is explicit. | H | M | Strong | M | L | Candidate |
| SEC-008 | Security | Add secure-cookie and inactivity-timeout browser matrix coverage for production-equivalent auth. | Strong: auth contract and CI gate already define these settings. | H | M | Strong | M | M | Candidate |
| SEC-009 | Security | Add attachment range-request abuse limits and tests for oversized preview reads. | Inferred: attachment viewers issue bounded Range requests but abuse limits need explicit evidence. | M | M | Inferred | M | M | Candidate |
| SEC-010 | Security | Add a migration-time check that no new database head is introduced by feature work. | Strong: single Alembic head is mandatory. | H | M | Strong | S | L | Candidate |
| PERF-001 | Performance | Track Reader first-content, locator resolution, and target-mount latency separately. | Strong: current locator delay is user-visible and conflated with rendering. | H | H | Strong | M | L | Candidate |
| PERF-002 | Performance | Add a locator fast path keyed by message version and render block before quote remapping. | Strong: exact identity is available in current APIs. | H | H | Strong | M | M | Candidate |
| PERF-003 | Performance | Bound large Reader virtualization work by block count and character count with measured thresholds. | Strong: large-conversation risk and current virtualization contract are documented. | H | M | Strong | M | M | Candidate |
| PERF-004 | Performance | Measure attachment Viewer Range throughput and retry cost by media type. | Inferred: viewers use multiple bounded reads and retries. | M | M | Inferred | M | L | Candidate |
| PERF-005 | Performance | Add API query timing buckets for conversation, TOC, search, and Files Panel endpoints. | Observed: code logs some mutation timings but not a uniform endpoint view. | M | M | Strong | M | L | Candidate |
| PERF-006 | Performance | Avoid duplicate Reader target-context and turn-window requests through a combined response. | Strong: current audit identifies duplicate loading. | M | M | Strong | M | M | Candidate |
| PERF-007 | Performance | Add offline packaging progress by store so `packaging` is not an opaque long state. | Observed: packaging can remain long without useful progress. | M | M | Observed | M | L | Candidate |
| PERF-008 | Performance | Compare Next Web build memory and duration before/after cache changes in CI artifacts. | Observed: Web build uses a 2048 MB heap and is repeated. | M | M | Strong | S | L | Candidate |
| PERF-009 | Performance | Add a bounded search index bulk-write benchmark for 15k-document imports. | Observed: prior IndexedDB failure involved 15,448 operations. | H | H | Observed | M | M | Candidate |
| PERF-010 | Performance | Add production diagnostic percentiles for queue wait, execution, and artifact packaging duration. | Observed: diagnostics currently expose averages such as 5.02s queue and 19.675s execution. | M | M | Observed | M | L | Candidate |
| TEST-001 | Testing | Add authenticated browser acceptance for the current deployed SHA using disposable owner credentials. | Observed: production owner-authenticated UI remains NOT VERIFIED. | H | H | Observed | M | M | Candidate |
| TEST-002 | Testing | Add desktop/mobile tests for direct attachment locate with single and multiple occurrences. | Strong: prior flow opened details instead of navigating. | H | H | Strong | M | L | Candidate |
| TEST-003 | Testing | Add browser tests for More-menu outside click, Escape, and focus restoration in Files and Annotations. | Strong: inconsistent menu contracts were observed. | M | M | Strong | M | L | Candidate |
| TEST-004 | Testing | Add browser tests for project/list row hover preview timing and viewport collision. | Strong: delayed preview contract is explicit. | M | L | Strong | M | L | Candidate |
| TEST-005 | Testing | Add browser tests that drag overlays preserve source row dimensions within 2px. | Strong: source-sized overlay is a product acceptance requirement. | M | M | Strong | S | L | Candidate |
| TEST-006 | Testing | Add browser tests that Reader locate pulse never clears正文 on stale/not-found results. | Strong: failure must preserve current content. | H | M | Strong | S | L | Candidate |
| TEST-007 | Testing | Add merge attachment consistency tests spanning API, Source Editor, Reader, Files, Viewer, Search, and TOC. | Strong: merge regressions affected multiple surfaces. | H | H | Strong | L | M | Candidate |
| TEST-008 | Testing | Add offline package tests for v1 read, v2 import, abort/resume, and zero-message detection. | Strong: offline compatibility and prior empty Reader are evidenced. | H | H | Strong | L | M | Candidate |
| TEST-009 | Testing | Add a test inventory check that every feature directory has a named test owner or explicit reason. | Inferred: feature inventory and E2E coverage are uneven. | M | L | Inferred | M | L | Candidate |
| TEST-010 | Testing | Add a release evidence index linking each required command to its output artifact and verification level. | Strong: release reports distinguish automated and browser evidence. | M | M | Strong | M | L | Candidate |
| DOC-001 | Documentation | Update `docs/index.md` current verification date after each production deployment. | Observed: index had an older current verification date than the deployment. | L | M | Observed | S | L | Candidate |
| DOC-002 | Documentation | Keep `PROJECT_STATE.md` under the compact snapshot target and link detailed release evidence instead of duplicating logs. | Strong: documentation skill sets a 100–250 line target; current file is large. | M | M | Strong | M | M | Candidate |
| DOC-003 | Documentation | Add the continuous backlog to the docs index and inventory with lifecycle ownership. | Strong: durable docs must be discoverable. | M | M | Strong | S | L | Candidate |
| DOC-004 | Documentation | Add a current troubleshooting entry for IndexedDB bulkPut AbortError and recovery steps. | Observed: user encountered this exact error. | M | H | Observed | S | L | Completed 2026-08-31; current recovery order documented |
| DOC-005 | Documentation | Add a current troubleshooting entry for HTTP-on-HTTPS-port 400 errors. | Observed: screenshot and deployment diagnosis identify this protocol error. | L | M | Observed | S | L | Completed 2026-08-31; protocol diagnosis and verifier documented |
| DOC-006 | Documentation | Record the attachment reference repair boundary and manual-review cases without storing real IDs or正文. | Strong: repair plan forbids guessing and sensitive data persistence. | H | M | Strong | S | L | Candidate |
| DOC-007 | Documentation | Document the exact current retention window for terminal task results and offline artifacts. | Inferred: retention is used by re-entry contracts but not surfaced in one place. | M | M | Inferred | S | L | Candidate |
| DOC-008 | Documentation | Add a release checklist item for production owner-authenticated browser status. | Observed: this remains a recurring verification debt. | M | M | Observed | S | L | Candidate |
| DOC-009 | Documentation | Add a data-boundary map for Reader, Share, Offline, Skills, and `.cr` pipelines. | Strong: multiple boundaries must not be merged during maintenance. | M | M | Strong | M | L | Candidate |
| DOC-010 | Documentation | Add a decision record for keeping automatic artifact cleanup disabled until race-safe evidence exists. | Strong: this is a documented product decision needing durable rationale. | M | L | Strong | S | L | Candidate |

## Prioritization Rules

1. Revalidate `Observed`/`Strong` candidates against the current source SHA before
   implementation; a later fix closes the item instead of creating duplicate
   work.
2. Prefer H-impact/H-urgency items that protect data integrity, recovery,
   authentication, or user-visible loss of context.
3. Do not implement a `Hypothesis` item until a focused measurement confirms the
   underlying cost.
4. Each implementation cycle adopts one independent item, adds a regression
   check, records verification level, and updates this table.
5. `Blocked` means the item needs an external decision, credential, fixture, or
   production capability; blocked work does not block unrelated candidates.

## Initial Counts

| Metric | Count |
|---|---:|
| Discovered candidates | 130 |
| Completed in this backlog | 12 |
| Blocked | 0 |
| Remaining candidates | 118 |
