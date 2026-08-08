# 文档导航

## 2026-08-08 current implementation notes

- [Backend/API merge and cancellation](system/BACKEND_AND_API.md#conversation-merge-execution-current)
- [Reader and task user flow](system/USER_FLOWS.md#reader-source-workspace-and-merge-cancellation-current)
- [API task additions](api-reference.md#current-task-additions-2026-08-04)
- [Attachment data and storage](system/DATA_AND_STORAGE.md)
- [Attachment UI and task-list rendering](system/FRONTEND_ARCHITECTURE.md#附件-ui)
- [Task toggle and attachment export API](api-reference.md)
- [Current verification results](../results.md)

当前事实以代码、配置、migration 和测试为准，最近核验日期为 2026-08-08。阅读顺序建议：先看 [Project State](../PROJECT_STATE.md)，再进入对应专题；带日期的计划、执行和证据目录只用于历史追溯。

## 开始这里

| 文档 | 长期职责 |
| --- | --- |
| [README](../README.md) | 产品入口、快速开始和常用命令 |
| [Project State](../PROJECT_STATE.md) | 当前仓库、实现、风险和验证快照 |
| [AGENTS](../AGENTS.md) | 最小开发与智能体工作规则 |
| [产品说明](product.md) | 当前用户能力、工作流和边界 |
| [系统事实索引](system/README.md) | 页面、功能、数据、权限和运行事实 |
| [文档台账](documentation-inventory.md) | 每个 Markdown 的分类、所有权和维护方式 |

## 开发与运行

| 文档 | 内容 |
| --- | --- |
| [系统架构](architecture.md) | Web/API/PostgreSQL、canonical 数据和关键数据流 |
| [API 参考](api-reference.md) | 当前 FastAPI 业务接口与兼容路径 |
| [本地开发](development.md) | 环境、安装、migration、启动和测试 |
| [生产部署](deployment.md) | Compose、备份、升级、回退和运行维护 |
| [故障排查](troubleshooting.md) | 数据库、代理、Reader、离线、构建和容器问题 |

## 当前系统参考

[system/README.md](system/README.md) 是详细事实入口。该目录按产品总览、页面/流程、前后端、数据/存储、权限、依赖和已知风险拆分；它不保存实施计划。

## 历史档案

| 目录 | 时间与用途 | 使用限制 |
| --- | --- | --- |
| [planning/](planning/README.md) | 2026-07-27 改造决策与执行清单 | 已完成且被后续决策部分覆盖，不作为当前真值 |
| [execution/](execution/README.md) | 2026-07-27 至 2026-07-29 实施、测试和发布证据 | 只表示对应发布批次，不替代重新验证 |
| [evidence/](evidence/README.md) | 2026-07-26 生产基线截图与只读请求 | 时间点快照，不表示当前生产状态 |
| [agent-context/UX_AUDIT_HANDOFF.md](agent-context/UX_AUDIT_HANDOFF.md) | 2026-07-26 UX 调研交接 | 历史范围说明，当前任务从 Project State 开始 |

## Markdown 数据资产

`apps/api/storage/imports/**/*.md` 与 `examples/**/*.md` 是用户导入内容或解析 fixture，不属于文档系统。不要自动改写、移动或纳入文档链接校验；详细边界见 [文档台账](documentation-inventory.md)。
