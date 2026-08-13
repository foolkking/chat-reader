# 系统事实索引

当前渲染合同：[AI Rich Markdown Renderer](AI_RICH_MARKDOWN_CONTRACT.md)。

最后审计：2026-08-09

本目录记录可由当前代码、配置、migration、测试或带日期的生产证据追溯的系统事实，不保存产品计划。当前代码与 migration 优先于本目录；无法复验的生产结论必须注明证据日期。

## 文档职责

| 文档 | 内容 |
| --- | --- |
| [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) | 产品边界、模块和部署总览 |
| [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md) | 当前能力与明确未实现项 |
| [PAGE_AND_ROUTE_MAP.md](PAGE_AND_ROUTE_MAP.md) | 页面、覆盖层和跳转关系 |
| [USER_ROLES_AND_PERMISSIONS.md](USER_ROLES_AND_PERMISSIONS.md) | 身份、能力凭证和权限边界 |
| [USER_FLOWS.md](USER_FLOWS.md) | 主要端到端用户流程 |
| [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) | 前端模块、状态和浏览器持久化 |
| [ATTACHMENT_RENDERER_CONTRACT.md](ATTACHMENT_RENDERER_CONTRACT.md) | 附件正文、Gallery、统一 Viewer、权限与大文件合同 |
| [BACKEND_AND_API.md](BACKEND_AND_API.md) | 后端模块和关键数据流 |
| [DATA_AND_STORAGE.md](DATA_AND_STORAGE.md) | PostgreSQL、文件、Dexie 和 Cache API |
| [DEPLOYMENT_AND_ENVIRONMENT.md](DEPLOYMENT_AND_ENVIRONMENT.md) | 运行拓扑、配置与运维边界 |
| [EXTERNAL_DEPENDENCIES.md](EXTERNAL_DEPENDENCIES.md) | 外部运行依赖及故障影响 |
| [KNOWN_ISSUES_AND_UNCERTAINTIES.md](KNOWN_ISSUES_AND_UNCERTAINTIES.md) | 当前风险与待验证项 |
| [DOCUMENT_MAINTENANCE.md](DOCUMENT_MAINTENANCE.md) | 事实等级和维护规则 |

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

- [planning/](../planning/README.md)：2026-07-27 已完成规划，部分内容被后续决策覆盖。
- [execution/](../execution/README.md)：2026-07-27 至 2026-07-29 实施、测试和生产发布档案。
- [evidence/](../evidence/README.md)：2026-07-26 基线截图和只读请求快照。

不得在事实文档中保存真实会话正文、标题、ID、Share token、Cookie、凭据、数据库 URL 或 `.env` 值。
Current release contract: [Release Safety Baseline](RELEASE_SAFETY_BASELINE.md).
