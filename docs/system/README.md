# 系统事实索引

当前渲染合同：[AI Rich Markdown Renderer](AI_RICH_MARKDOWN_CONTRACT.md)。

入口与现役状态校准：2026-11-04；不是对每份专题及全部真实交互重新验收。

本目录记录可由当前代码、配置、migration、测试或带日期的生产证据追溯的系统事实，不保存产品计划。当前代码与 migration 优先于本目录；无法复验的生产结论必须注明证据日期。

## 文档职责

| 文档 | 内容 |
| --- | --- |
| [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) | 产品边界、模块和部署总览 |
| [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md) | 当前能力与明确未实现项 |
| [PAGE_AND_ROUTE_MAP.md](PAGE_AND_ROUTE_MAP.md) | 页面、覆盖层和跳转关系 |
| [ADMINISTRATION_CONTRACT.md](ADMINISTRATION_CONTRACT.md) | 管理员用户目录、后台删除、只读完整内容与审计附件访问 |
| [USER_ROLES_AND_PERMISSIONS.md](USER_ROLES_AND_PERMISSIONS.md) | 身份、能力凭证和权限边界 |
| [USER_FLOWS.md](USER_FLOWS.md) | 主要端到端用户流程 |
| [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) | 前端模块、状态和浏览器持久化 |
| [ADAPTIVE_IMPORT_CONTRACT.md](ADAPTIVE_IMPORT_CONTRACT.md) | 格式识别、Mapping、Profile 和显式提交 |
| [ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md](ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md) | ZIP 成员分类、安全、附件及小内存预算 |
| [AI_RICH_MARKDOWN_CONTRACT.md](AI_RICH_MARKDOWN_CONTRACT.md) | v13 富 Markdown、安全 HTML 与 Obsidian 表示子集 |
| [ATTACHMENT_RENDERER_CONTRACT.md](ATTACHMENT_RENDERER_CONTRACT.md) | 附件正文、Gallery、统一 Viewer、权限与大文件合同 |
| [IMAGE_READING_STABILITY_CONTRACT.md](IMAGE_READING_STABILITY_CONTRACT.md) | 固定预览/保存像素/离线尺寸快照、真实锚点与单滚动容器补偿；精确 `9cf235f` CI 已验收，生产边界见发布回执 |
| [MESSAGE_MARKDOWN_COPY_CONTRACT.md](MESSAGE_MARKDOWN_COPY_CONTRACT.md) | 单条消息全源码复制、显式图片公开能力、安全 SVG PNG 与撤销边界 |
| [SOURCE_EDITOR_UPLOAD_ATOMICITY_CONTRACT.md](SOURCE_EDITOR_UPLOAD_ATOMICITY_CONTRACT.md) | Source Editor 临时上传引用、保存原子性与 API 持久化防线 |
| [BACKEND_AND_API.md](BACKEND_AND_API.md) | 后端模块和关键数据流 |
| [DATA_AND_STORAGE.md](DATA_AND_STORAGE.md) | PostgreSQL、文件、Dexie 和 Cache API |
| [DATA_ARCHIVE_CONTRACT.md](DATA_ARCHIVE_CONTRACT.md) | 个人新增恢复、系统恢复与格式兼容 |
| [CONTEXT_PACKAGE_CONTRACT.md](CONTEXT_PACKAGE_CONTRACT.md) | Current/Index 与 `.context.zip` 交换边界 |
| [AUTHENTICATION_CONTRACT.md](AUTHENTICATION_CONTRACT.md) | 账户、设备会话和公开 Share 能力 |
| [DEPLOYMENT_AND_ENVIRONMENT.md](DEPLOYMENT_AND_ENVIRONMENT.md) | 运行拓扑、配置与运维边界 |
| [EXTERNAL_DEPENDENCIES.md](EXTERNAL_DEPENDENCIES.md) | 外部运行依赖及故障影响 |
| [KNOWN_ISSUES_AND_UNCERTAINTIES.md](KNOWN_ISSUES_AND_UNCERTAINTIES.md) | 当前风险与待验证项 |
| [DOCUMENT_MAINTENANCE.md](DOCUMENT_MAINTENANCE.md) | 事实等级和维护规则 |
| [CONTINUOUS_OPTIMIZATION_BACKLOG.md](CONTINUOUS_OPTIMIZATION_BACKLOG.md) | 历史审查账本；不是当前优化工作指令 |

详细 API、开发和部署步骤分别由 [API 参考](../api-reference.md)、[本地开发](../development.md) 和 [生产部署](../deployment.md) 维护，本目录只给出结构与边界，避免重复命令。

## 事实等级

- `已确认`：当前代码/配置/migration/test 可直接证明。
- `生产快照`：仅表示证据记录日期的线上状态。
- `部分确认`：代码链路存在，但缺少隔离端到端或生产复验。
- `待验证`：没有足够证据；不得写成确定事实。
- `不适用`：当前产品边界明确不包含。

## 阅读顺序

1. 根 [PROJECT_STATE.md](../../PROJECT_STATE.md)。
2. 本页和 [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)。
3. 按任务读取页面/流程或前后端/数据专题。
4. 用 [KNOWN_ISSUES_AND_UNCERTAINTIES.md](KNOWN_ISSUES_AND_UNCERTAINTIES.md) 检查未验证边界。

旧智能体入口 [SYSTEM_CONTEXT_FOR_AGENTS.md](../agent-context/SYSTEM_CONTEXT_FOR_AGENTS.md) 仅保留兼容跳转；新任务应从 `AGENTS.md` 和 `PROJECT_STATE.md` 开始。

## 历史与证据

- [planning/](../planning/README.md)：带日期的规划，可能被后续决策覆盖。
- [execution/](../execution/README.md)：实施、审查、CI 失败和生产发布档案；截至 2026-11-04。
- [evidence/](../evidence/README.md)：各检查点的脱敏测量、合成截图和请求快照。
- [入口归档](../archive/PROJECT_STATE-history-2026-11-04.md)：本次压缩前的原检查点；
  [收尾回执](../execution/KNOWLEDGE_CLOSEOUT_2026-11-04.md)记录知识校准与保留现场。

不得在事实文档中保存真实会话正文、标题、ID、Share token、Cookie、凭据、数据库 URL 或 `.env` 值。
Current release contract: [Release Safety Baseline](RELEASE_SAFETY_BASELINE.md).

Current operational contracts: [Artifact Lifecycle](ARTIFACT_LIFECYCLE_CONTRACT.md), [Observability](OBSERVABILITY_CONTRACT.md), and [Safe Cleanup](CLEANUP_CONTRACT.md).

Capacity measurement contract: [Performance and Capacity](PERFORMANCE_CAPACITY_CONTRACT.md), with dated results in [the Release D evidence report](../evidence/PERFORMANCE_CHARACTERIZATION_REPORT_2026-08-14.md).

PWA/offline resilience contract: [PWA and Offline Resilience](PWA_OFFLINE_RESILIENCE_CONTRACT.md), covering shell critical resources, offline package current-state preservation, quota/interruption/restart semantics, Viewer cache misses and the Release E negative matrix.
