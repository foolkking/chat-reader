# 系统事实文档索引

最后核验日期：2026-07-26
线上入口：`https://chat.king.2bd.net`

本目录记录可由代码、配置、接口、线上页面或实际操作追溯的系统事实。它不包含 UI 改进方案。

本轮基线对应本地和生产共同 commit `e752e9ddf25595c3f373977a1803956354ca71b0`。已盘点 9 个前端页面路由、67 个 API path templates（79 operations）、21 张 PostgreSQL 表和 21 张生产脱敏截图。

## 状态标记

- `已确认`：有代码、页面、请求或配置证据。
- `部分确认`：只确认了部分链路。
- `推测`：由结构推断，缺少直接证据。
- `待验证`：尚未完成验证或受环境、权限、数据限制。
- `不适用`：经核验，当前产品边界不涉及。
- `已废弃`：有明确证据表明不再使用。

## 文档导航

| 文档 | 长期职责 |
| --- | --- |
| [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) | 产品定位、系统边界、模块和部署入口 |
| [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md) | 功能状态、入口、代码/API 与线上证据 |
| [PAGE_AND_ROUTE_MAP.md](PAGE_AND_ROUTE_MAP.md) | 页面、路由、覆盖层和跳转关系 |
| [USER_ROLES_AND_PERMISSIONS.md](USER_ROLES_AND_PERMISSIONS.md) | 身份、角色、权限和访问控制 |
| [USER_FLOWS.md](USER_FLOWS.md) | 当前真实用户流程 |
| [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) | 前端技术栈、组件、状态与响应式结构 |
| [BACKEND_AND_API.md](BACKEND_AND_API.md) | 后端结构、接口和关键数据流 |
| [DATA_AND_STORAGE.md](DATA_AND_STORAGE.md) | PostgreSQL、文件、IndexedDB、缓存与偏好 |
| [DEPLOYMENT_AND_ENVIRONMENT.md](DEPLOYMENT_AND_ENVIRONMENT.md) | 构建、部署、代理和环境变量 |
| [EXTERNAL_DEPENDENCIES.md](EXTERNAL_DEPENDENCIES.md) | 外部运行依赖和失败影响 |
| [KNOWN_ISSUES_AND_UNCERTAINTIES.md](KNOWN_ISSUES_AND_UNCERTAINTIES.md) | 已确认问题、差异和待验证事项 |
| [DOCUMENT_MAINTENANCE.md](DOCUMENT_MAINTENANCE.md) | 文档更新与事实治理规则 |

## 后续智能体阅读顺序

1. 本页。
2. [智能体系统上下文](../agent-context/SYSTEM_CONTEXT_FOR_AGENTS.md)。
3. [UX 调研交接](../agent-context/UX_AUDIT_HANDOFF.md)。
4. 页面地图、功能清单和问题/不确定性文档。
5. 按任务需要读取架构、API、数据和部署文档。

## 证据与敏感信息

证据索引位于 [docs/evidence/README.md](../evidence/README.md)。代码证据应给出仓库相对路径和模块/函数；线上证据应给出 URL、操作和截图编号。不得记录真实密码、Token、Cookie、API Key、数据库凭据、私钥或未脱敏聊天正文。

## 与旧文档的关系

根 `README.md` 仍是快速启动入口；`docs/product.md`、`docs/architecture.md`、`docs/api-reference.md`、`PROJECT_STATE.md` 保留历史和专题说明。若其描述与本目录冲突，以带当前核验日期和证据的事实基线为准；已知过期点登记在 `KNOWN_ISSUES_AND_UNCERTAINTIES.md`。

## 2026-07-27 执行核验

第二轮本地执行已完成，代码核验 HEAD 为 `175fae3914ad65a9682fa13303b64064507d498c`。Reader、导航、批注搜索与离线索引事实见本目录；命令与截图证据见 `docs/execution/`。生产环境未执行写操作。
