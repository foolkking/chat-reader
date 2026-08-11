# Project State

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
- 新导入接受兼容 JSON（Markdown 可选校验，CanJSON v1/v2 自动识别）、附件 `.crbundle` 和旧 `.cr` 兼容归档；不接收未经 Adapter 标准化的 OpenAI 官方图结构/ZIP、CSV、TXT 或 Markdown 单文件提交。
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
