# Markdown 文档台账

2026-08-12 synchronization: AI Rich Markdown canonical source, parser-level math compatibility, shared consumers, security, accessibility, overflow, performance and offline KaTeX assets are current in `PROJECT_STATE.md`, `docs/system/AI_RICH_MARKDOWN_CONTRACT.md`, `docs/system/FRONTEND_ARCHITECTURE.md`, `docs/testing.md` and `results.md`.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `docs/system/AI_RICH_MARKDOWN_CONTRACT.md` | Current | Canonical Markdown, Math/GFM/footnote/code semantics, safety, accessibility, overflow, performance and PWA asset policy. |
| `apps/web/features/rich-markdown/rich-markdown-config.ts` | Current | Shared remark/rehype/KaTeX policy and renderer version. |
| `apps/web/features/rich-markdown/remark-ai-math-compatibility.ts` | Current | Parser-level ChatGPT `\(`/`\[` compatibility and conservative currency demotion. |
| `apps/web/e2e/ai-rich-markdown*.spec.ts` | Current test | Parser, Reader, Editor, attachment, security, stress and reflow regression. |

2026-08-11 synchronization: Offline shell availability/background update, offline read-only attachment files, local snapshot export and bilingual Context Acquisition Skill delivery are current in `PROJECT_STATE.md`, `docs/system/FRONTEND_ARCHITECTURE.md`, `docs/system/USER_FLOWS.md`, `docs/system/ATTACHMENT_RENDERER_CONTRACT.md`, `docs/testing.md` and `docs/deployment.md`.

| Path | Lifecycle | Responsibility |
| --- | --- | --- |
| `apps/web/lib/offline-shell.ts` | Current | Immediate active-shell availability, deterministic asset inventory and non-blocking background reconciliation. |
| `apps/web/features/attachments/offline-conversation-files-panel.tsx` | Current | Read-only offline current-conversation attachments and cached/unavailable states. |
| `apps/web/lib/offline-export.ts` | Current | Bounded browser-local CanJSON/Markdown/context package projection from the downloaded snapshot. |
| `apps/web/features/exporting/offline-export-panel.tsx` | Current | Offline export controls and local result delivery. |
| `apps/web/public/skills/chat-reader-conversation-context-acquisition-skill.v1.md` | Current static asset | Chinese inert parsing Skill; SHA-256 `BF467029CE810249701DCB21E0642ECEDF55F7B61ADA1C597BA386B891F9D08E`. |
| `apps/web/public/skills/chat-reader-conversation-context-acquisition-skill.v1-en.md` | Current static asset | English inert parsing Skill; SHA-256 `BE2F289E8D45F659F6A9AECFC43C2491058DF940EC5416062F6FA55FEF6AC613`. |

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
| `apps/api/app/services/import_pipeline/bundle_import.py` | Current | Native bundle and `chat-reader-import-bundle v1` validation/normalization. |
| `apps/api/app/services/exporting/system_archive.py` | Current | System `.cr v4` export and empty-instance restore. |
| `.github/workflows/build-release-images.yml` | Current | Manual external Linux image build for low-memory production deployment. |
| `apps/api/tests/test_attachment_bundle_api.py` | Current | Real fixture, Share/Offline/export/split/merge attachment regression. |
| `apps/web/features/attachments/conversation-files-panel.tsx` | Current | Current conversation file drawer, upload and occurrence actions. |
| `apps/web/e2e/attachment-fixture.spec.ts` | Current | Real bundle product-flow acceptance without mutating source fixture. |
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
| `docs/system/DEPLOYMENT_AND_ENVIRONMENT.md` | 压缩并更新 / 现行 | 环境变量与运行拓扑 |
| `docs/system/EXTERNAL_DEPENDENCIES.md` | 更新 / 现行 | 外部运行依赖 |
| `docs/system/KNOWN_ISSUES_AND_UNCERTAINTIES.md` | 压缩并更新 / 现行 | 当前风险与待验证事项 |
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
