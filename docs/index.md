# 文档导航

当前渲染合同：[AI Rich Markdown Renderer](system/AI_RICH_MARKDOWN_CONTRACT.md)，定义 Reader、源码预览和 Markdown 附件共享的 Math/GFM/Footnote、安全、无障碍、溢出与离线资源行为。

当前 Adaptive Import 合同：[Adaptive Import Contract](system/ADAPTIVE_IMPORT_CONTRACT.md)，定义 JSON/Markdown 的 session、group、family、profile revision、Mapping、canonical draft、直接导入和 `.cr` 独立恢复边界。

当前内容清理合同：[Content Cleanup Contract](system/CONTENT_CLEANUP_CONTRACT.md)，定义规则 revision、位置存储、活动对话范围、导入后低优先级扫描、显式审查与 MessageVersion 应用边界。

Single-owner authentication and the public-by-link Share/search navigation
enhancement are deployed and accepted. Current facts are in
[Project State](../PROJECT_STATE.md), [testing](testing.md),
[Authentication Contract](system/AUTHENTICATION_CONTRACT.md), and
[known issues](system/KNOWN_ISSUES_AND_UNCERTAINTIES.md). Historical release
rows retain their checkpoint meaning; later Release K/M/N evidence supersedes
their earlier incomplete verification records.

The living improvement register is [Continuous Improvement Backlog](system/CONTINUOUS_IMPROVEMENT_BACKLOG.md).
It is a candidate queue, not a replacement for current implementation facts.

## 2026-08-11 current implementation notes

- [2026-08-11 Final Release Closure](evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md#final-release-closure-2026-08-11): current production lifecycle evidence, release matrix and remaining verification debt.
- [Attachment UI](system/FRONTEND_ARCHITECTURE.md#附件-ui): `.cr` restore uses Import data; desktop conversation files use the annotation-style draggable Reader workspace.

- [Backend/API merge and cancellation](system/BACKEND_AND_API.md#conversation-merge-execution-current)
- [Reader and task user flow](system/USER_FLOWS.md#reader-source-workspace-and-merge-cancellation-current)
- [API task additions](api-reference.md#current-task-additions-2026-08-04)
- [Attachment data and storage](system/DATA_AND_STORAGE.md)
- [Attachment UI and task-list rendering](system/FRONTEND_ARCHITECTURE.md#附件-ui)
- [Attachment Renderer contract](system/ATTACHMENT_RENDERER_CONTRACT.md)
- [Task toggle and attachment export API](api-reference.md)
- [Current verification results](../results.md)
- [Release D performance contract](system/PERFORMANCE_CAPACITY_CONTRACT.md)
- [Release D characterization evidence](evidence/PERFORMANCE_CHARACTERIZATION_REPORT_2026-08-14.md)
- [Release E PWA/offline resilience contract](system/PWA_OFFLINE_RESILIENCE_CONTRACT.md)
- [Release F Next LTS migration contract](system/NEXT_LTS_MIGRATION_CONTRACT.md)
- [Release G PDF.js maintained-line migration contract](system/PDFJS_MIGRATION_CONTRACT.md)
- [Release H CSP enforcement contract](system/CSP_ENFORCEMENT_CONTRACT.md)
- [Release I Source Editor upload atomicity contract](system/SOURCE_EDITOR_UPLOAD_ATOMICITY_CONTRACT.md)
- [Release N single-owner authentication contract](system/AUTHENTICATION_CONTRACT.md)
- [Conversation/import/viewer test addendum](testing.md)

当前事实以代码、配置、migration 和测试为准，最近核验日期为 2026-08-24。阅读顺序建议：先看 [Project State](../PROJECT_STATE.md)，再进入对应专题；带日期的计划、执行和证据目录只用于历史追溯。

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
Current release contracts: [Release Safety Baseline](system/RELEASE_SAFETY_BASELINE.md) covers dependency risk, production secret fail-fast, security headers, quality gating, image inspection and artifact provenance; [CSP Enforcement Contract](system/CSP_ENFORCEMENT_CONTRACT.md) defines the current application policy, resource allowlist and browser enforcement gate.

Artifact publication and cleanup contract: [Artifact Lifecycle Contract](system/ARTIFACT_LIFECYCLE_CONTRACT.md), covering Offline/Export staging, validation, transaction boundaries, orphan semantics, bounded Import recovery and dry-run cleanup.

Operational evidence and cleanup safety: [Observability Contract](system/OBSERVABILITY_CONTRACT.md) and [Cleanup Contract](system/CLEANUP_CONTRACT.md), covering request IDs, redacted structured logs, diagnostics enablement, aggregate storage/job state, grace windows, explicit manual apply and final race rechecks.
