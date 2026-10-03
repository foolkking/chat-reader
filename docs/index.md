# 文档导航

2026-10-03：本次授权使用 E 盘测试临时目录。最终 API 867 通过、4 跳过；PWA 基线 180 通过、201 开关跳过；离线故障专项 17 通过；最终认证 Context 专项 14 通过、认证与 Share 专项 4 通过，均无跳过。ZIP 路径歧义修复及外部合成审阅见 [执行记录](execution/CONTEXT_MIGRATION_2026-10-03.md) 与 [语义审阅](evidence/CONTEXT_SEMANTIC_WALKTHROUGH_2026-10-03.md)。设置复查已完成本地验收：9 项阅读同步与 14 项长 Reader/Share/Context 导航复验通过；失败历史和视觉检查见 [设置记录](execution/SETTINGS_REAUDIT_2026-10-03.md)。待提交、CI 和部署。

2026-10-03：外部 Maintainer 双包写出及应用回传循环已有本地证据；改进运行时仍是独立 review Bundle，未替换用户指定默认 ZIP。真实 Skill 清单、旧 Rescue 定位及历史状态文档迁移见 [Context Skill 迁移](system/CONTEXT_SKILL_MIGRATION.md)。完整发布验收仍未完成。

2026-10-03：真实 Normalizer 导入、worker 离线下载入库、断网重载及 Context 再导出链路已验证。
补齐旧批注版本、项目说明和附件来源；完整发布验收仍未完成。见 [离线合同](system/PWA_OFFLINE_RESILIENCE_CONTRACT.md)。

Latest input update (2026-10-03): Skill upload/replacement accepts ZIP and Markdown.
Markdown is automatically stored as a compatibility Bundle, preserving original
instructions and the Skill display name; downloads use that name with `.zip`.
System defaults remain the three supplied ZIPs. No Skill viewer is added.
This supersedes earlier ZIP-only input statements below.

Skill 最新约定：接受 ZIP 或 Markdown 上传和替换，Markdown 自动包装为同名 ZIP；系统默认使用用户提供的三个 Bundle，个人首选保留。设置不提供 Skill 内容查看，Current/Index 仍可阅读编辑。

最新调整：用户取消候选、校验与采用流程，改为直接更新 Current / Index，默认保留最近 3 次记录。入口在 Reader 批注旁；已接入易读视图、编辑、本机草稿、文件查找、索引搜索与跳转、单文件历史恢复。完整迁移与发布验收仍未完成；详见 [Context 合同](system/CONTEXT_PACKAGE_CONTRACT.md)。

Context 协议迁移当前状态：[Context Package Contract](system/CONTEXT_PACKAGE_CONTRACT.md)。直接文件保存、整包回传和最近三次记录已接入；旧候选／校验／采用 API 已退役。外部双包维护已有应用循环和合成审阅证据，review Bundle 已单独生成；独立外部模型使用、完整发布检查和后续设置复查仍待完成。

当前管理员账户与内容合同：[Administration Contract](system/ADMINISTRATION_CONTRACT.md)，定义账户搜索分页、真实登录状态、后台删除幂等与共享资源保留，以及完整只读 Reader 和审计附件访问。

当前应用数据归档：[Data Archive Contract](system/DATA_ARCHIVE_CONTRACT.md)，定义系统 `.cr v5` 的身份/配置恢复、v4 显式映射及旧 v5 兼容、个人归档预检与新增恢复、幂等任务、导出容量自检与事务回滚，以及系统预检任务、持久归属选择和管理员恢复流程。

当前渲染合同：[AI Rich Markdown Renderer](system/AI_RICH_MARKDOWN_CONTRACT.md)，定义 Reader、源码预览和 Markdown 附件共享的 Math/GFM/Footnote、安全、无障碍、溢出与离线资源行为。

当前 Adaptive Import 合同：[Adaptive Import Contract](system/ADAPTIVE_IMPORT_CONTRACT.md)，定义 JSON/Markdown 的 session、group、family、profile revision、Mapping、canonical draft、直接导入和 `.cr` 独立恢复边界。

当前内容清理合同：[Content Cleanup Contract](system/CONTENT_CLEANUP_CONTRACT.md)，定义规则 revision 与版本授权、系统发布／撤回、位置存储、导入后低优先级扫描、显式审查、个人忽略例外、规则试运行和 MessageVersion 应用边界。

The deployed snapshot provides one deployment-provisioned administrator,
isolated user accounts and UUID-based owner scoping, while preserving
public-by-link Share/search behavior. Current facts are in
[Project State](../PROJECT_STATE.md), [testing](testing.md),
[Authentication Contract](system/AUTHENTICATION_CONTRACT.md), and
[known issues](system/KNOWN_ISSUES_AND_UNCERTAINTIES.md). Historical release
rows retain their checkpoint meaning; later Release K/M/N evidence supersedes
their earlier incomplete verification records.

The living improvement register is [Continuous Improvement Backlog](system/CONTINUOUS_IMPROVEMENT_BACKLOG.md).
It is a candidate queue, not a replacement for current implementation facts.

Release command-to-evidence mapping is maintained in
[Release Evidence Index](system/RELEASE_EVIDENCE_INDEX.md). It distinguishes
automated tests, browser verification and production verification.

## 2026-08-11 current implementation notes

- [2026-08-11 Final Release Closure](evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md#final-release-closure-2026-08-11): current production lifecycle evidence, release matrix and remaining verification debt.
- [Attachment UI](system/FRONTEND_ARCHITECTURE.md#附件-ui): `.cr` restore uses Settings → Data & backup; desktop conversation files use the annotation-style draggable Reader workspace.

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

当前事实以代码、配置、migration 和测试为准，最近部署核验日期为 2026-10-02（ad223cd，具体范围见 Project State）。阅读顺序建议：先看 [Project State](../PROJECT_STATE.md)，再进入对应专题；带日期的计划、执行和证据目录只用于历史追溯。

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

Task/offline retention contract: [Task And Offline Retention Contract](system/RETENTION_CONTRACT.md), distinguishing the bounded Task Center result window, canonical server packages, manual cleanup grace and browser-managed Offline Library lifetime.

Operational evidence and cleanup safety: [Observability Contract](system/OBSERVABILITY_CONTRACT.md) and [Cleanup Contract](system/CLEANUP_CONTRACT.md), covering request IDs, redacted structured logs, diagnostics enablement, aggregate storage/job state, grace windows, explicit manual apply and final race rechecks.

The pre-compression historical project-state snapshot is retained at
`archive/PROJECT_STATE-history-2026-09-01.md`; it is historical evidence only,
not a current-state authority.
