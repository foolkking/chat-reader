# Markdown 文档台账

2026-08-31 deployment synchronization: production source `7d86166`, release
run/artifact provenance, the retained verified five-component recovery point,
runtime health and the corrected PostgreSQL stdin verification command are
current in `PROJECT_STATE.md` and `docs/deployment.md`. The backup command fix
changes operator tooling only; authenticated production UI remains explicitly
`NOT VERIFIED`.

2026-08-31 sidebar interaction synchronization: fixed custom Project order,
append-at-bottom creation, source-sized non-native drag previews, delayed list
description previews, non-modal upward Settings region and short-lived Reader
locate feedback are current in `PROJECT_STATE.md`,
`docs/system/USER_FLOWS.md`, `docs/system/FEATURE_INVENTORY.md` and
`docs/system/FRONTEND_ARCHITECTURE.md`. Legacy project-sort preferences remain
compatibility data; no migration, dependency or documentation category was
introduced.

2026-08-25 Adaptive Import handling classes and Conversation Rescue are
current in `PROJECT_STATE.md` and `system/ADAPTIVE_IMPORT_CONTRACT.md`.
Static bilingual Rescue Skill assets are runtime resources under
`apps/web/public/import-rescue/`; they are not documentation authority or
database data.

2026-08-24 knowledge closeout: the repository remains on the single `master`
branch and the current follow-up is documentation-only. Production runtime
remains the verified `7ff2f92` image generation from Actions run `32698108862`.
The temporary pre-deploy backup was deleted
after health acceptance at the operator's request; the current and direct
rollback image generations remain. Authenticated production UI is explicitly
`NOT VERIFIED` in the current deployment record.

2026-08-24 content-cleanup synchronization: Source Editor selection authority,
central review and embedded rule management are current in `PROJECT_STATE.md`,
`docs/system/CONTENT_CLEANUP_CONTRACT.md`, `docs/api-reference.md` and
`.interface-design/system.md`. Deterministic built-in and literal
rule revisions, layered structural/normalized/bounded matching,
current/selected/all-active scan scopes, occurrence-only evidence persistence,
low-priority post-import review and MessageVersion-based explicit apply are
current in `PROJECT_STATE.md` and `docs/system/CONTENT_CLEANUP_CONTRACT.md`.
Alembic head is `20260823_0028`.

The current cleanup contract also includes an explicit rule-library action for a
low-priority `BATCH / ALL_ACTIVE` review of project and unclassified active
conversations. Archived conversations are excluded, rule revisions are
snapshotted per scan. Actionable detected occurrences default to `DELETE`
(selected) for review; protected or stale occurrences remain unselected. The
owner can deselect any candidate to keep it.

2026-08-22 Adaptive Import synchronization: the two-entry import surface,
session/group/family model, Built-in and Learned Profile revisions, canonical
draft boundary, full-family validation, direct commit and retired `.crbundle`
product contract are recorded in `PROJECT_STATE.md`,
`docs/system/ADAPTIVE_IMPORT_CONTRACT.md`, `docs/product.md`,
`docs/architecture.md`, `docs/api-reference.md`,
`docs/system/BACKEND_AND_API.md`, `docs/system/FEATURE_INVENTORY.md` and
`docs/testing.md`. Migration `20260822_0025` adds adaptive-import persistence;
`20260822_0026` adds content-cleanup review persistence and `20260823_0027`
adds versioned detection and match-evidence fields. The current
operational/profile state; existing Conversation and `.cr` schema remains
unchanged.

2026-08-22 Adaptive Import recovery synchronization: item-level `INVALID`
semantics, continued Mapping beside malformed siblings, in-place source
replacement, Group exclusion/regrouping, legacy reanalysis, commit-before-file
cleanup and responsive recovery UX are current in `PROJECT_STATE.md`,
`docs/system/ADAPTIVE_IMPORT_CONTRACT.md`, `docs/api-reference.md`,
`docs/system/BACKEND_AND_API.md` and `docs/testing.md`. No migration,
dependency or new documentation category was introduced.

2026-08-22 current-project movement synchronization: the right-hand Project
workspace drop target, stable optimistic `project_relation`, URL-preserving
success behavior and multi-cache failure rollback are recorded in
`PROJECT_STATE.md` and `docs/system/USER_FLOWS.md`. No API, migration,
dependency or new documentation category was introduced.

2026-08-21 large paired-import and Reader-copy synchronization: the current
linear unique-identity pairing rule, 50 MiB per-file/two-file Preview boundary,
route-specific proxy allowance and shared Owner/Share/Offline semantic Markdown
copy contract are recorded in `PROJECT_STATE.md`,
`docs/system/BACKEND_AND_API.md`,
`docs/system/FRONTEND_ARCHITECTURE.md`,
`docs/system/DEPLOYMENT_AND_ENVIRONMENT.md`, `docs/deployment.md` and
`docs/testing.md`. No migration, dependency or new documentation category was
introduced.

2026-08-24 public Share/search enhancement synchronization: the current
public-by-link Share contract, independent optional Share password and
reference-style exact occurrence navigation are recorded in
`PROJECT_STATE.md`, `docs/system/AUTHENTICATION_CONTRACT.md`,
`docs/api-reference.md`, `docs/product.md`, `docs/architecture.md` and
`docs/testing.md`. Production acceptance covered passwordless and protected
Share access, revocation and exact search occurrence navigation; disposable QA
data was removed through the product UI.

2026-08-17 Release N synchronization is complete. The current auth
contract, configuration, single-owner/session schema and tests are recorded in
`docs/system/AUTHENTICATION_CONTRACT.md`, `PROJECT_STATE.md`, `TASKS.md`,
`docs/testing.md`, `docs/development.md`, `docs/api-reference.md` and
`docs/deployment.md`. Exact CI, a verified pre-deploy backup, owner-password
provisioning and production acceptance are complete.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `apps/api/app/services/auth.py` | Current runtime | Single-owner Argon2id verification, opaque-token digest, session expiry/touch and bounded login throttle. |
| `apps/api/app/core/auth_middleware.py` | Current runtime | Default-deny business API boundary, origin checks and no-store behavior. |
| `apps/api/alembic/versions/20260817_0023_single_owner_auth.py` | Historical migration | Owner principal, per-device session and throttle persistence. |
| `apps/api/alembic/versions/20260817_0024_public_share_password.py` | Current migration | Independent optional Share-password and scoped unlock-session persistence. |
| `apps/web/components/auth-boundary.tsx` | Current runtime | Online session verification and conservative offline cache lock. |
| `apps/web/e2e/auth-gate.spec.ts` | Current test | New device, Share, logout/PWA and global password-change session invalidation. |
| `docs/system/RELEASE_EVIDENCE_INDEX.md` | Current release documentation | Maps required quality/deployment commands to source-bound evidence and verification levels. |
| `apps/web/e2e/feature-test-inventory.spec.ts` | Current test | Ensures every Web feature directory has a named test owner or explicit shared-contract reason. |

2026-08-16 Release L synchronization: independent single-worker heartbeat,
idle/busy/stale/unavailable derivation, loopback-only internal diagnostics,
public Nginx concealment, no-store/privacy rules and Alembic `20260816_0022`
are current in `PROJECT_STATE.md`, `docs/system/OBSERVABILITY_CONTRACT.md`,
`docs/api-reference.md`, `docs/development.md`, `docs/testing.md`,
`docs/deployment.md` and `results.md`. Production closure is PASS: exact-SHA
run `31948357231`, immutable artifact `9264075894`, protected public denial,
operator loopback access and idle/busy worker evidence are recorded there.

2026-08-16 Release M synchronization: the five-part verified backup,
production-target rejection preflight, aggregate/physical recovery integrity
audit, two fresh isolated restore targets, measured recovery characterization and
the executable restore procedure are recorded in
`docs/system/DISASTER_RECOVERY_RUNBOOK.md`, `deploy/recovery_preflight.py`,
`deploy/recovery_integrity.py`, `PROJECT_STATE.md`, `results.md` and `TASKS.md`.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `apps/api/app/services/worker_liveness.py` | Current runtime | Worker-owned periodic liveness and separately committed active-task refresh. |
| `apps/api/app/models/worker_runtime_state.py` | Current runtime | Payload-free singleton worker process state. |
| `apps/api/alembic/versions/20260816_0022_worker_runtime_state.py` | Current migration | Backward-safe operational heartbeat table. |
| `deploy/nginx-internal-diagnostics.location.conf` | Current deployment config | Public diagnostics concealment and non-cacheability. |
| `apps/api/tests/test_worker_liveness.py` | Current test | Idle/busy/stale/recovery, fencing, failure isolation and long-task coverage. |
| `apps/api/tests/test_diagnostics.py` | Current test | Protected access, aggregates, privacy, headers and query/storage bounds. |

2026-08-16 Release J final synchronization: the first bounded production
cleanup apply, exact candidate authority, 24-hour grace, per-object recheck,
idempotency, canonical zero-deletion evidence and protected post-publication QA
artifact are recorded in `docs/system/CLEANUP_CONTRACT.md`,
`docs/system/ARTIFACT_LIFECYCLE_CONTRACT.md`, `PROJECT_STATE.md`, `results.md`,
`docs/testing.md`, `docs/deployment.md` and `TASKS.md`. Runtime source and
production images remain Release I; automatic cleanup and AssetObject GC remain
disabled/out of scope. `RELEASE_J = PASS`.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `docs/system/CLEANUP_CONTRACT.md` | Current contract | Managed roots, categories, grace, opaque identity, explicit apply, final recheck, first-apply evidence and future-approval boundary. |
| `docs/system/ARTIFACT_LIFECYCLE_CONTRACT.md` | Current contract | Publish/commit ordering, orphan semantics, download integrity and production publish-versus-cleanup evidence. |
| `docs/system/RETENTION_CONTRACT.md` | Current contract | Terminal Task Center visibility, canonical Offline Package replacement, cleanup grace and browser Offline Library lifetime. |
| `apps/api/scripts/artifact_cleanup.py` | Current operator CLI | Dry-run by default and exact category/token apply; no apply-all or automatic schedule. |
| `apps/api/tests/test_cleanup_execution.py` | Current test | Cleanup matrix, wrong-category protection, race recheck, partial failure, path escape and idempotency. |
| `TASKS.md` | Current release ledger | Release J approved candidate set, apply/post-apply aggregates, recovery notes and final status. |

2026-08-16 Release I final synchronization: the Source Editor transient
URI grammar, authoritative CodeMirror document, network-versus-editor-ready
state machine, three-layer save defense, retry/history/selection behavior and
immutable production acceptance are recorded in
`docs/system/SOURCE_EDITOR_UPLOAD_ATOMICITY_CONTRACT.md`, `PROJECT_STATE.md`,
`results.md`, `docs/testing.md` and `docs/deployment.md`. Final evidence is API
`15/15`, browser `18/18`, isolated and production Alembic head/current
`20260806_0021`, exact-SHA Actions run `31934088629`, verified immutable image
identity and three production real chooser/save/reload flows. The post-deploy
aggregate transient-reference count is zero; `RELEASE_I = PASS`.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `docs/system/SOURCE_EDITOR_UPLOAD_ATOMICITY_CONTRACT.md` | Current contract | Transient/canonical URI classes, editor authority, upload state machine, save/API defenses, concurrency, retry, history, data audit, release and rollback. |
| `apps/web/e2e/source-editor-upload-atomicity.spec.ts` | Current test | Deterministic Release I race matrix, canonical payload/readback, editor stability and save-failure retention. |
| `apps/api/app/services/editing/transient_upload_references.py` | Current runtime | Source-aware active transient Markdown reference classifier used at persistence boundaries. |

2026-08-16 Release H final synchronization: the evidence-derived enforced
CSP, single authority, resource graph, inline/Wasm decisions, browser violation
harness, PWA synthetic-response policy and immutable deployment gate are
recorded in `docs/system/CSP_ENFORCEMENT_CONTRACT.md`, `PROJECT_STATE.md`,
`results.md`, `docs/testing.md` and `docs/deployment.md`. Source `da160a9`,
Actions run `31906595581`, verified artifact/backup, immutable running image
identity, public enforced headers, isolated production Chrome and retained
Release G rollback are recorded. `RELEASE_H = PASS`.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `docs/system/CSP_ENFORCEMENT_CONTRACT.md` | Current contract | Application policy authority, actual resource allowlist, strictness limits, isolated response policies, test privacy, release and rollback. |
| `apps/web/next.config.mjs` | Current runtime | One production application CSP generator and development-only eval boundary. |
| `apps/web/e2e/csp-enforcement.spec.ts` | Current test | Production-build enforcing header, blocked forbidden resources, allowed legitimate resources and frame-ancestor proof. |
| `apps/web/public/library-sw.js` | Current runtime | Offline shell lifecycle and independently locked-down synthetic incomplete response. |

2026-08-16 Release G final synchronization: the official stable
`pdfjs-dist 6.2.108` target, modern ESM/local-worker strategy, Range/offline
and security boundaries, Node `22.13.1` engine requirement, verification gate
and immutable deployment/rollback procedure are recorded in
`docs/system/PDFJS_MIGRATION_CONTRACT.md`, `PROJECT_STATE.md`, `results.md`,
`docs/testing.md` and `docs/deployment.md`. Source `1b752b7`, Actions run
`31896564657`, the verified archive and complete backup, immutable running
image identity, production Chrome PDF/Range/offline/Viewer evidence and
retained Release F rollback are recorded. `RELEASE_G = PASS`.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `docs/system/PDFJS_MIGRATION_CONTRACT.md` | Current contract | PDF.js target/provenance, ESM and real-worker boundary, authenticated Range, cached-only offline behavior, scripting/security, bundle, CI, production identity and rollback evidence. |
| `apps/web/features/attachments/pdfjs-runtime.ts` | Current runtime | Single browser-only PDF.js load and same-package local worker configuration. |
| `apps/web/e2e/pdfjs-migration.spec.ts` | Current test | Synthetic real-worker/canvas, Range, Viewer lifecycle, malformed and malicious PDF browser assertions. |
| `security/dependency-exceptions.json` | Current policy | Removes obsolete PDF.js 3 and legacy canvas/node-pre-gyp/tar exceptions; the official-registry policy gate reports 0 blocked and 0 unapproved findings. |

2026-08-15 Release F final synchronization: Next `16.3.1`, React
`19.2.8`, async request APIs, explicit Webpack build, dependency exception
removal, current-worktree focused browser evidence and the immutable-image
deployment contract are recorded in `PROJECT_STATE.md`, `results.md`,
`docs/testing.md`, `docs/deployment.md` and
`docs/system/NEXT_LTS_MIGRATION_CONTRACT.md`. Final Actions run
`31887198941`, artifact SHA-256
`739435634b6a4ebe52597d9db6887c3599c10a6fb5441f1032b01981923e5b84`, verified
backup `/opt/chat-reader/backups/release-f-final-20260815T134803Z-c9ddae1`,
immutable running-image identity and production Chromium acceptance are now
recorded. `RELEASE_F = PASS`; Release E rollback images remain retained.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `docs/system/NEXT_LTS_MIGRATION_CONTRACT.md` | Current | Next 14 -> 15 -> 16 checkpoints, React 19, async request APIs, cache semantics, Webpack preservation, PWA impact, provenance and rollback. |
| `apps/web/package.json` | Current runtime contract | Pins Next/React candidate versions and makes `next build --webpack` explicit. |
| `apps/web/e2e/release-security-baseline.spec.ts` | Current test | Release A header/CSP, production fault-bridge absence and quality-before-artifact checks. |
| `docker-compose.production.yml` | Current deployment contract | Allows explicit immutable API/Web image binding without changing production env contents. |

2026-08-15 Release E synchronization: scoped Offline/PWA negative-path
resilience is current in docs/system/PWA_OFFLINE_RESILIENCE_CONTRACT.md,
PROJECT_STATE.md, docs/testing.md and results.md. The contract preserves
offline package/Dexie formats and documents critical versus optional shell
resources, cache-miss behavior, quota/interruption/restart semantics, retry
ownership and false-ready prevention.

2026-08-15 Release E production closure: runtime `1591fd9`, Actions run
`31874712687`, archive/image provenance, verified five-part backup, explicit
production-compose deployment, production health, isolated PWA/Reader/Share
browser evidence and the final PASS matrix are recorded in `PROJECT_STATE.md`,
`results.md`, `docs/testing.md` and `docs/deployment.md`. No migration or
business-data cleanup was performed; unrelated PWA skips remain skips.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| docs/system/PWA_OFFLINE_RESILIENCE_CONTRACT.md | Current | /library shell readiness, conversation package current-state preservation, offline Viewer misses, quota/interruption/restart handling and Release E negative browser matrix. |
| apps/web/e2e/pwa-negative.spec.ts | Current test | Production-build browser negative matrix using real Cache Storage, Service Worker, IndexedDB, offline network and isolated persistent profile. |
| apps/web/public/library-sw.js | Current runtime | Critical shell-resource verification and standalone offline-incomplete fallback. |
| apps/web/lib/offline-db.ts | Current runtime | Offline package import, immutable attachment cache writes and verified cached-attachment reads. |

2026-08-15 Release D final synchronization: deterministic Reader/import/export/.cr
capacity characterization, real Attachment identity fixtures, constrained-run
methodology, query-plan evidence and the no-unnecessary-optimization decision
are current in `docs/system/PERFORMANCE_CAPACITY_CONTRACT.md`,
`docs/evidence/PERFORMANCE_CHARACTERIZATION_REPORT_2026-08-14.md`,
`docs/testing.md`, `PROJECT_STATE.md` and `results.md`.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `docs/system/PERFORMANCE_CAPACITY_CONTRACT.md` | Current | Fixture tiers, budgets, measurement privacy, capacity classes and evidence-driven optimization/index gates. |
| `docs/evidence/PERFORMANCE_CHARACTERIZATION_REPORT_2026-08-14.md` | Dated evidence | Release D environment, raw aggregate results, regression status and remaining capacity debt. |
| `.github/workflows/performance-characterization.yml` | Current workflow | Separate API/Web quality gates followed by external Linux Reader/API/.cr characterization and A/B/C regression. |
| `apps/web/e2e/reader-capacity.spec.ts` | Current test | Three cold runs, warm revisit, bounded virtual working set, scroll and browser budget assertions. |
| `scripts/performance/run_backend_benchmark.py` | Current harness | Deterministic import/export, real attachment identity, RSS/temp-disk and `.cr` archive measurements. |
| `scripts/performance/measure-attachment-ranges.mjs` | Current harness | Aggregate-only attachment Range timing/retry characterization by media type; synthetic/local by default. |

2026-08-14 Release C synchronization: request correlation, production-emitted redacted structured logging, aggregate diagnostics, storage visibility and explicit safe cleanup are current in `PROJECT_STATE.md`, `docs/system/OBSERVABILITY_CONTRACT.md`, `docs/system/CLEANUP_CONTRACT.md`, `docs/system/ARTIFACT_LIFECYCLE_CONTRACT.md`, `docs/api-reference.md`, `docs/testing.md`, `docs/deployment.md` and `results.md`. Final source `8d0ad66` is deployed; no migration or business-data cleanup is introduced.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `docs/system/OBSERVABILITY_CONTRACT.md` | Current | Request ID, log schema/redaction, lifecycle events, aggregate metrics and diagnostics security. |
| `docs/system/CLEANUP_CONTRACT.md` | Current | Grace, categories, dry-run default, explicit apply, final recheck, idempotency and protected data. |
| `apps/api/app/core/observability.py` | Current runtime | Server-owned request correlation and sanitized completion logging. |
| `apps/api/app/services/diagnostics.py` | Current runtime | Bounded database/storage aggregate collection without user content. |
| `apps/api/scripts/artifact_cleanup.py` | Current operator CLI | Dry-run by default; explicit category/token manual apply. |
| `apps/api/tests/test_observability.py` | Current test | Request/header/error correlation and log privacy/failure isolation. |
| `apps/api/tests/test_diagnostics.py` | Current test | Disabled-by-default, aggregate privacy and query/storage budget. |
| `apps/api/tests/test_cleanup_execution.py` | Current test | Protected predicates, race recheck, partial failure and idempotency. |

2026-08-13 synchronization: manual Owner TOC refresh, canonical dialogue-index semantics, current/all section rebuild scope, background progress, UI focus/error behavior and regression evidence are current in `PROJECT_STATE.md`, `docs/api-reference.md`, `docs/system/USER_FLOWS.md`, `docs/testing.md` and `results.md`. No migration or new document category was added.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `apps/api/app/services/toc/toc_refresh.py` | Current | Canonical dialogue-index validation plus current/all section TOC rebuild orchestration. |
| `apps/api/app/api/routes/toc.py` | Current API | Queues idempotent manual TOC refresh jobs. |
| `apps/web/features/toc/toc-refresh-dialog.tsx` | Current UI | Selectable dialogue/section targets, current/all section scope and accessible submission dialog. |
| `apps/api/tests/test_toc_api.py` | Current test | Target, scope, idempotency, revision and rebuild regression. |
| `apps/web/e2e/toc-refresh-contract.spec.ts` | Current test | Reader entry, defaults, worker polling and cache invalidation contract. |

2026-08-12 synchronization: archived-project deletion lifecycle, retained-conversation semantics, API/UI regression coverage and image-archive cleanup are current in `PROJECT_STATE.md`, `docs/system/USER_FLOWS.md`, `docs/api-reference.md`, `docs/testing.md` and `results.md`. No migration or new document category was added.

2026-08-12 synchronization: AI Rich Markdown canonical source, parser-level math compatibility v4 (including consumed inline parentheses, scientific standalone brackets, bounded conceptual display labels and heading KaTeX-tree preservation), shared consumers, security, accessibility, overflow, performance, offline KaTeX assets, final production evidence and targeted image cleanup are current in `PROJECT_STATE.md`, `docs/system/AI_RICH_MARKDOWN_CONTRACT.md`, `docs/system/FRONTEND_ARCHITECTURE.md`, `docs/testing.md`, `docs/deployment.md` and `results.md`.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `docs/system/AI_RICH_MARKDOWN_CONTRACT.md` | Current | Canonical Markdown, Math/GFM/footnote/code semantics, safety, accessibility, overflow, performance and PWA asset policy. |
| `apps/web/features/rich-markdown/rich-markdown-config.ts` | Current | Shared remark/rehype/KaTeX policy and renderer version. |
| `apps/web/features/rich-markdown/remark-ai-math-compatibility.ts` | Current | Parser-level ChatGPT escaped/bare delimiter compatibility, bounded math-token grammar and conservative currency demotion. |
| `apps/web/e2e/ai-rich-markdown*.spec.ts` | Current test | Parser, Reader, Editor, attachment, security, stress and reflow regression. |
| `apps/web/e2e/production-rich-markdown-copy.spec.ts` | Current test | Ephemeral full-source compatibility count using QA-only data and product-API cleanup. |
| `apps/web/e2e/production-rich-markdown-scientific-copy.spec.ts` | Current test | Ephemeral scientific-source compatibility, common command coverage, canonical-source equality and cleanup. |

2026-08-11 synchronization: Offline shell availability/background update, offline read-only attachment files, local snapshot export and bilingual Context Acquisition Skill delivery are current in `PROJECT_STATE.md`, `docs/system/FRONTEND_ARCHITECTURE.md`, `docs/system/USER_FLOWS.md`, `docs/system/ATTACHMENT_RENDERER_CONTRACT.md`, `docs/testing.md` and `docs/deployment.md`.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `apps/web/lib/offline-shell.ts` | Current | Immediate active-shell availability, deterministic asset inventory and non-blocking background reconciliation. |
| `apps/web/features/attachments/offline-conversation-files-panel.tsx` | Current | Read-only offline current-conversation attachments and cached/unavailable states. |
| `apps/web/lib/offline-export.ts` | Current | Bounded browser-local CanJSON/Markdown/context package projection from the downloaded snapshot. |
| `apps/web/features/exporting/offline-export-panel.tsx` | Current | Offline export controls and local result delivery. |
| `apps/web/public/skills/chat-reader-conversation-context-acquisition-skill.v1.md` | Current static asset | Supplied bilingual v2 Chinese inert parsing Skill; stable public filename retained, no manual checksum confirmation in the UI. |
| `apps/web/public/skills/chat-reader-conversation-context-acquisition-skill.v1-en.md` | Current static asset | Supplied bilingual v2 English inert parsing Skill; stable public filename retained, no manual checksum confirmation in the UI. |

2026-08-10 synchronization: Reader scrollbar-jump coordinate recovery and pointer-held edge-loading rules are current in `PROJECT_STATE.md`, `docs/system/FRONTEND_ARCHITECTURE.md`, `docs/testing.md`, and `results.md`.

## 2026-08-10 Reader wheel performance ownership additions

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `apps/web/features/conversations/reader-block-layout.ts` | Current | Stable metric-aware virtual block estimates and Reader layout signatures. |
| `apps/web/features/conversations/reader-active-position.ts` | Current | Bounded reading-line target resolution shared by Owner and Share readers. |
| `apps/web/features/conversations/conversation-reader.tsx` | Current | Single Owner scroll coordinator, idle position persistence and sentinel-authoritative window loading. |
| `apps/web/features/sharing/share-readonly-reader.tsx` | Current | Share reuse of the same bounded active-position and wheel behavior. |
| `apps/web/features/toc/conversation-toc.tsx` | Current | Memoized TOC with derived heading activity and bounded asynchronous follow. |
| `apps/web/e2e/reader-block-layout.spec.ts` | Current test | Paragraph/CJK/heading/code/empty estimator regression. |
| `apps/web/e2e/reader-restoration.spec.ts` | Current test | Heavy Owner/Share navigation, restoration, wheel monotonicity, edge-load, persistence and performance regression. |

No new documentation category, public API, migration or persisted Reader contract was introduced.

## 2026-08-07 attachment workflow performance and DnD additions

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `apps/api/alembic/versions/20260805_0020_conversation_attachments_and_uploads.py` | Current | Conversation-owned Attachment, occurrence identity, upload staging, system export scope migration. |
| `apps/api/alembic/versions/20260806_0021_attachment_workflow_performance.py` | Current | Batch ownership/version lookup indexes for the separated message save path. |
| `apps/api/app/api/routes/attachments.py` | Current | Upload sessions, conversation files, metadata, Range content, derivatives and Share attachment access. |
| `apps/api/app/services/assets/asset_store.py` | Current | Local and optional S3-compatible storage providers with controlled keys. |
| `apps/api/app/services/assets/scanner.py` | Current | Disabled, ClamAV and remote scanner providers; deployment-policy status. |
| `apps/api/app/services/exporting/system_archive.py` | Current | System `.cr v4` export and empty-instance restore. |
| `.github/workflows/build-release-images.yml` | Current | API/Web quality ownership split, then manual external Linux image build for low-memory production deployment. |
| `apps/web/features/attachments/conversation-files-panel.tsx` | Current | Current conversation file drawer, upload and occurrence actions. |
| `apps/web/e2e/attachment-upload-flow.spec.ts` | Current | Ordinary upload, insertion, version switching and file reuse acceptance. |
| `apps/web/e2e/project-sidebar-dnd.spec.ts` | Current | Explicit project/conversation drop-target and placement regression. |
| `apps/api/tests/background_job_test_utils.py` | Test support | Deterministic post-commit derived-job processing for API tests. |
| `results.md` | Current | Exact local/production acceptance status for the 2026-08-06 release. |

最后审计：2026-08-07

## 2026-08-04 implementation ownership additions

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `apps/api/app/services/editing/conversation_merge_service.py` | Current | Bounded canonical merge graph copy and ID remapping. |
| `apps/api/tests/test_merge_history_and_cancellation.py` | Current | Version/block/annotation copy, rollback, cancellation and retry regressions. |
| `apps/web/components/floating-workspace-panel.tsx` | Current | Shared geometry plus source-editor left-overlay placement and direct resize updates. |
| `apps/web/features/editing/edit-message-form.tsx` | Current | CodeMirror source editor with light/dark theme compartment. |
| `apps/web/features/editing/source-attachment-drop.ts` | Current | CodeMirror file drop/paste detection, safe insertion-position resolution and draft marker commands. |

最后审计：2026-08-04

## 2026-08-05 attachment and sidebar ownership additions

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `apps/api/app/services/exporting/context_package.py` | Current | Current-state `.context.zip` manifest/CanJSONL/content-addressed asset projection. |
| `apps/api/app/services/exporting/attachment_bundle.py` | Current | Markdown/CanJSON attachment bundle export with content-addressed objects and sensitive-file exclusion. |
| `apps/api/app/services/assets/derivatives.py` | Current | Bounded text extraction derivative job and attachment search refresh. |
| `apps/web/features/attachments/preview-adapter-registry.ts` | Current | MIME-to-preview adapter selection and independently hosted complex-preview gate. |
| `apps/api/app/services/assets/lifecycle.py` | Current | Expired import release and dry-run/execute asset GC. |
| `apps/api/scripts/gc_assets.py` | Current | Explicitly invoked attachment GC operation; dry-run by default. |
| `apps/web/features/attachments/attachment-block.tsx` | Current | Owner/Share/Offline attachment card, media/text/PDF preview and download fallback. |
| `apps/web/features/projects/project-action-menu.tsx` | Current | Project-only actions and project settings entry. |
| `apps/web/features/conversations/conversation-action-menu.tsx` | Current | Conversation lifecycle, placement, pin, export and dangerous actions. |

最后审计：2026-08-05

## 2026-08-08 attachment rendering and task ownership additions

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `apps/web/features/attachments/attachment-block.tsx` | Current | Four attachment presentation modes, bounded type-specific body-level Viewer, media failure fallback, metadata and download actions. |
| `apps/web/features/attachments/preview-adapter-registry.ts` | Current | Extension/MIME policy for Markdown, table, code, media, image and download-only formats. |
| `apps/web/features/conversations/markdown-renderer.tsx` | Current | Stable task-key extraction and owner-only interactive GFM task controls. |
| `apps/api/app/services/canonical/block_builder.py` | Current | Canonical task metadata and stable key generation outside code fences. |
| `apps/api/app/api/routes/messages.py` | Current | Base-version-aware task toggle endpoint and bounded message edit transaction. |

最后审计：2026-08-08

## 2026-08-09 attachment renderer contract additions

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `docs/system/ATTACHMENT_RENDERER_CONTRACT.md` | Current | Four-layer state, Registry, six group-owned inline lanes, Gallery, unified adaptive Viewer presentations, Range/search/batch/offline and permission contract. |
| `apps/web/features/attachments/attachment-viewer.tsx` | Current | Single provider/shell portal, image/document/media Viewer kernels and runtime retry state. |
| `apps/web/features/attachments/complex-attachment-viewer.tsx` | Current | Lazy read-only document, spreadsheet, presentation and ZIP Viewer surface. |
| `apps/web/features/attachments/complex-attachment-worker.ts` | Current | Bounded browser Worker parsing using the existing `fflate` dependency. |
| `apps/web/features/conversations/new-conversation-dialog.tsx` | Current | Atomic User + Assistant conversation creation UI. |
| `apps/web/features/conversations/message-insert-dialog.tsx` | Current | Before/after single or User + Assistant message insertion UI. |
| `docs/testing.md` | Current | Addendum-specific local, fixture and production verification status. |
| `apps/api/app/services/assets/text_search.py` | Current | Bounded text search and checksum/query-bound signed continuation cursor. |
| `apps/api/app/services/exporting/attachment_download.py` | Current | Owner batch ZIP validation, stable names, streaming worker artifact and TTL. |
| `apps/api/tests/test_attachment_renderer_contract.py` | Current | Capability privacy, cursor staleness and business-identity ZIP regression. |

最后审计：2026-08-09

## 2026-08-10 release stabilization additions

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `docs/system/MUTATION_REVISION_CONTRACT.md` | Current | Canonical mutation revision handoff, attachment lifecycle invariants, delete/undo idempotency, dialog focus and Scanner wording. |
| `apps/web/components/use-dialog-focus.ts` | Current | Shared synchronous initial focus, focus trap, Escape and post-pointer logical focus restoration for managed dialogs. |
| `docs/evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md` | Evidence | Redacted release audit findings and remediation result; historical failures are retained. |

最后审计：2026-08-10

## 项目画像与规则

- 项目画像：Monorepo、前端应用、Web/后端服务。
- 当前事实来源优先级：代码/配置/migration/测试 > `PROJECT_STATE.md` > `docs/system/` > 带日期的历史记录。
- 生命周期：`现行` 持续维护；`入口` 只做导航；`历史封存` 保留原时间点；`数据资产` 不参与文档整理。
- 本次不物理移动规划/证据文件，避免破坏内部链接和正在进行的工作树；通过目录 README 明确封存语义。
- 2026-08-04 浮动源码工作区、CodeMirror 明暗主题和 JSON 辅助 Markdown 分段已同步到 `PROJECT_STATE.md`、`docs/product.md`、`docs/api-reference.md`、`docs/system/BACKEND_AND_API.md`、`docs/system/USER_FLOWS.md` 与 `docs/system/FRONTEND_ARCHITECTURE.md`；未新增文档类别。
- 2026-08-06 全页附件预览、正文轻量展示、导出二级选项、扫描关闭策略与 King 原机构建 OOM 边界已同步到当前事实、产品、API、前端、部署、风险和结果文档；本次收尾补充 SVG `<img>` DOM 合同、弹窗焦点管理以及用户确认的 Chrome 上传、Share、`.cr v4` 恢复生产证据；未新增文档类别。
- 2026-08-11 移除设置中的重复系统归档恢复入口；`.cr` 文件继续从“导入数据”选择。桌面“当前对话文件”最终采用批注式右侧可拖动工作区，移动端行为不变；Markdown 源码逐键编辑稳定性、生产部署和旧镜像精确清理同步到当前状态、前端架构、用户流程、测试和部署文档。

## 根目录与现行专题

| 路径 | 分类 | 长期职责 |
| --- | --- | --- |
| `README.md` | 压缩并更新 / 入口 | 人类入口、快速开始、常用命令 |
| `AGENTS.md` | 新建 / 现行 | 最小开发和智能体约束 |
| `PROJECT_STATE.md` | 更新 / 现行 | 当前 AI 可读项目快照 |
| `docs/index.md` | 更新 / 入口 | 文档导航和生命周期说明 |
| `docs/documentation-inventory.md` | 新建 / 现行 | 全部 Markdown 所有权与分类 |
| `docs/product.md` | 更新 / 现行 | 产品能力、工作流、边界 |
| `docs/architecture.md` | 更新 / 现行 | 系统架构和关键数据流 |
| `docs/api-reference.md` | 更新 / 现行 | 手写业务 API 参考 |
| `docs/development.md` | 更新 / 现行 | 本地环境、命令和测试 |
| `docs/deployment.md` | 更新 / 现行 | 生产部署、备份和回退 |
| `docs/troubleshooting.md` | 更新 / 现行 | 可复用故障诊断 |

## 当前系统事实

| 路径 | 分类 | 长期职责 |
| --- | --- | --- |
| `docs/system/README.md` | 更新 / 入口 | 详细事实目录与阅读顺序 |
| `docs/system/SYSTEM_OVERVIEW.md` | 压缩并更新 / 现行 | 产品、模块和部署总览 |
| `docs/system/FEATURE_INVENTORY.md` | 压缩并更新 / 现行 | 当前能力矩阵 |
| `docs/system/PAGE_AND_ROUTE_MAP.md` | 更新 / 现行 | 页面、覆盖层与跳转关系 |
| `docs/system/USER_ROLES_AND_PERMISSIONS.md` | 更新 / 现行 | 身份与权限边界 |
| `docs/system/USER_FLOWS.md` | 压缩并更新 / 现行 | 主要端到端用户流程 |
| `docs/system/FRONTEND_ARCHITECTURE.md` | 压缩并更新 / 现行 | 前端模块、状态和持久化 |
| `docs/system/BACKEND_AND_API.md` | 压缩并更新 / 现行 | 后端边界和数据流 |
| `docs/system/DATA_AND_STORAGE.md` | 更新 / 现行 | PostgreSQL、文件和浏览器存储 |
| `docs/system/DEPLOYMENT_AND_ENVIRONMENT.md` | 压缩并更新 / 现行 | 环境变量、运行拓扑、备份验证与只读保留盘点边界 |
| `docs/system/EXTERNAL_DEPENDENCIES.md` | 更新 / 现行 | 外部运行依赖 |
| `docs/system/KNOWN_ISSUES_AND_UNCERTAINTIES.md` | 压缩并更新 / 现行 | 当前风险与待验证事项 |
| `docs/system/CONTINUOUS_IMPROVEMENT_BACKLOG.md` | 新建 / 现行 | 按证据维护的持续改进候选队列；每项实施前必须复核 |
| `docs/system/DOCUMENT_MAINTENANCE.md` | 更新 / 现行 | 文档事实治理和更新触发 |

## 智能体上下文

| 路径 | 分类 | 长期职责 |
| --- | --- | --- |
| `docs/agent-context/SYSTEM_CONTEXT_FOR_AGENTS.md` | 合并/压缩 | 兼容旧入口；指向 `AGENTS.md` 与 `PROJECT_STATE.md` |
| `docs/agent-context/UX_AUDIT_HANDOFF.md` | 历史封存 | 2026-07-26 UX 调研范围和证据边界 |

## 规划档案

以下文件均为 `历史封存`：记录 2026-07-27 的决策与执行基线，后续完整轮次 Reader、单层侧栏、桌面隐藏最近、离线增量、批注展开阅读、Markdown 间距与字号等决策已部分覆盖它们。

| 路径 | 原始用途 |
| --- | --- |
| `docs/planning/README.md` | 历史规划索引与覆盖说明 |
| `docs/planning/ACCEPTANCE_AND_TEST_PLAN.md` | 页面与语义验收 |
| `docs/planning/ANNOTATION_AND_NOTES_PLAN.md` | 批注和精选笔记规划 |
| `docs/planning/DECISION_LOG.md` | D-001 至 D-025 决策 |
| `docs/planning/DESIGN_SYSTEM_PLAN.md` | 设计 token 与组件规范 |
| `docs/planning/EXECUTION_LOCK.md` | 当时的执行约束 |
| `docs/planning/EXECUTION_MANIFEST.md` | 文件级任务清单 |
| `docs/planning/FACT_BASELINE_RECONCILIATION.md` | 当时的事实校准 |
| `docs/planning/FUNCTION_CHANGE_MATRIX.md` | 功能变更矩阵 |
| `docs/planning/IMPLEMENTATION_BACKLOG.md` | 实施依赖顺序 |
| `docs/planning/INFORMATION_ARCHITECTURE_PLAN.md` | 信息架构规划 |
| `docs/planning/MASTER_REDESIGN_PLAN.md` | 改造总计划 |
| `docs/planning/MOBILE_EXPERIENCE_PLAN.md` | 移动端规划 |
| `docs/planning/OFFLINE_AND_PWA_PLAN.md` | 离线与 PWA 规划 |
| `docs/planning/PAGE_REDESIGN_PLAN.md` | 页面级规划 |
| `docs/planning/PRODUCT_GOALS_AND_CONSTRAINTS.md` | 产品目标和边界 |
| `docs/planning/READER_REDESIGN_PLAN.md` | Reader 规划 |
| `docs/planning/SEARCH_AND_DISCOVERY_PLAN.md` | 搜索与发现规划 |
| `docs/planning/SHARE_AND_EXPORT_PLAN.md` | Share 与导出规划 |
| `docs/planning/TECHNICAL_CHANGE_PLAN.md` | 技术变更清单 |
| `docs/planning/TRACEABILITY_MATRIX.md` | 决策、任务、验收追踪 |
| `docs/planning/USER_TASK_MODEL.md` | 角色与任务模型 |

## 执行与证据档案

| 路径 | 分类 | 时间点/用途 |
| --- | --- | --- |
| `docs/execution/README.md` | 更新 / 历史索引 | 2026-07-27 至 2026-07-30 发布档案入口 |
| `docs/execution/IMPLEMENTATION_LOG.md` | 历史封存 | 实施条目与补充审计 |
| `docs/execution/TEST_RESULTS.md` | 历史封存 | 命令、E2E 与 Chrome 结果 |
| `docs/execution/DEVIATIONS.md` | 历史封存 | 实施偏差与环境事件 |
| `docs/execution/DEPLOYMENT_CHECKLIST.md` | 历史封存 | 发布、备份、镜像和回退证据 |
| `docs/evidence/README.md` | 更新 / 历史索引 | 2026-07-26 基线证据入口 |
| `docs/evidence/request-records/README.md` | 更新 / 历史索引 | 请求记录目录 |
| `docs/evidence/request-records/LOCAL_OPENAPI_2026-07-26.md` | 历史封存 | 当日本地 OpenAPI 快照 |
| `docs/evidence/request-records/PRODUCTION_HTTP_2026-07-26.md` | 历史封存 | 当日生产 HTTP 只读快照 |
| `docs/evidence/request-records/PRODUCTION_RUNTIME_2026-07-26.md` | 历史封存 | 当日生产运行快照 |
| `docs/evidence/screenshots/README.md` | 更新 / 历史索引 | 当日 21 张脱敏截图说明 |

## Markdown 数据资产

| 路径 | 分类 | 处理规则 |
| --- | --- | --- |
| `apps/api/storage/imports/576e75cc-577a-46ef-a7d1-3e94eb66f7b8/ChatGPT-typescript_01.md` | 数据资产 | 已跟踪的导入正文；可能包含用户内容，不整理、不引用、不自动删除 |
| `examples/example1/ChatGPT-社交训练.md` | 数据资产 | 解析/展示示例；由相关测试或产品样例维护，不按文档风格改写 |

新增 import 目录中的 Markdown 自动继承“数据资产”分类，即使尚未写入本表。若未来需要删除或匿名化，必须先确认测试依赖和用户数据保留要求。

2026-08-09 文档同步：Attachment Renderer 最终合同、生产镜像 run、备份、部署与真实 Chrome 证据已写入 `PROJECT_STATE.md`、`results.md`、`docs/system/ATTACHMENT_RENDERER_CONTRACT.md`、部署文档和执行记录。没有新增文档类别；条件跳过和 `NOT_IMPLEMENTED` 项未提升为 PASS。

2026-08-09 文档同步：Attachment Inline Layout System 的六条语义轨道、组级对齐、Gallery/AudioList/FileList、统一 spacing/radius 和本地测试状态已写入现有当前事实文档；未新增文档类别，生产视觉验收在部署前保持 `NOT_PRODUCTION_VERIFIED`。

2026-08-09 Adaptive Viewer 文档同步：同一 Viewer Shell 的 compact/reading/document/media/workspace presentation、移动端全屏退化、CSS 最大化状态机、PDF Fit Page/Fit Width 单滚动所有权和五档视口验收要求已同步到当前合同、前端架构、项目状态与测试结果。未增加新的文档类别、数据模型或 migration。

2026-08-10 Reader Scroll Stabilization 文档同步：稳定 block estimator、单一滚动协调器、TOC 派生更新、生产构建性能预算、King 增量部署与真实 Chrome 滚轮证据已同步到 `PROJECT_STATE.md`、`results.md`、`docs/testing.md`、`docs/system/FRONTEND_ARCHITECTURE.md` 和 `docs/deployment.md`。360px/zoom/offline-negative 等未执行项保持 `NOT_PRODUCTION_VERIFIED`。
| `docs/evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md` | historical evidence | 2026-08-10 release-readiness audit, redacted QA evidence and verification limits |

2026-08-11 Final Release Closure 文档同步：最终生产生命周期、mutation revision、Attachment 对账、精确窄屏、Share expiry、`.cr v4`、部署与 QA 清理证据已追加到当前事实和历史审计。真实浏览器 Zoom 与完整 Offline 负向矩阵保持 `NOT_PRODUCTION_VERIFIED/PARTIAL_PASS`，没有被默认 PWA 条件跳过覆盖。
2026-08-13 synchronization: Release A dependency policy, production secret guard, Alembic percent handling, security headers, CSP Report-Only, quality-to-image gate, image inspection and artifact provenance are current in `PROJECT_STATE.md`, `docs/system/RELEASE_SAFETY_BASELINE.md`, `docs/testing.md`, `docs/deployment.md` and `results.md`.

2026-08-14 synchronization: Release B artifact publication, outer-transaction safety, bounded Import stale recovery, Share Drawer focus restoration and dry-run cleanup classification are current in `PROJECT_STATE.md`, `docs/system/ARTIFACT_LIFECYCLE_CONTRACT.md`, `docs/testing.md` and `docs/deployment.md`.

2026-08-14 final synchronization: PostgreSQL `.cr` attachment enumeration, final Actions/artifact/backup/deployment evidence, production Offline/Export/Import QA and dry-run counts are recorded without removing Release A history. The operator subsequently closed the Share focus debt through manual production Chrome verification. Automatic cleanup remains disabled.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `docs/system/RELEASE_SAFETY_BASELINE.md` | Current contract | Dependency/security policy, release gate, HTTP baseline, image provenance and deployment boundary. |
| `security/dependency-exceptions.json` | Current policy data | Exact, expiring critical/high advisory dispositions. |
| `scripts/check-dependency-audit.mjs` | Current release check | Fails unapproved, expired, mismatched, duplicate or unused exceptions. |
| `scripts/inspect-release-images.sh` | Current release check | OCI revision/architecture/entrypoint and forbidden-path inspection. |

2026-08-16 Release K synchronization: `PROJECT_STATE.md`, `results.md`,
`TASKS.md`, `docs/testing.md`, `docs/index.md`, and
`docs/system/KNOWN_ISSUES_AND_UNCERTAINTIES.md` distinguish current production
verification debt from superseded historical rows, deferred design work, and
conditional future tracks. No new document category was created. The dated
`docs/execution/TEST_RESULTS.md` remains historical and the absent root
`TEST_RESULTS.md` was not recreated as a duplicate authority.

2026-09-01 deployment-state synchronization: operator-owned release pointers
and bounded transfer cleanup are current in
`docs/system/DEPLOYMENT_AND_ENVIRONMENT.md`, `deploy/verify_release_state.sh`
and `deploy/cleanup_release_transfer.py`. The helpers are local/operator
tools only; no production host state or application data was changed.

2026-09-01 CI synchronization: `scripts/ci/changed-area-selector.mjs` and
its Node built-in test provide local changed-area feedback while preserving the
full release gate. The command is documented by the package scripts and the
backlog; it does not replace release quality jobs.
