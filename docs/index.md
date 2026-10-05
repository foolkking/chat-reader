# 文档导航

最新已验证应用源码 `5d48b68` 的 [Skill 复制恢复与移动面板修正](execution/SKILL_COPY_RECOVERY_2026-10-05.md)
已通过 CI `37323431809` 全部五项任务，镜像已本地核验。后续仅修正测试准备与双语断言，
本机完整回归 138 通过／284 跳过；生产仍为 `3f1d539`。
用户已授权服务器备份只保留两份；验证后删除八份旧备份，释放约 9.25 GiB，业务数据与服务未改动。
[导出回收与备份保留整理](planning/EXPORT_RETENTION_AND_BACKUP_2026-10-06.md) 记录已执行清理和待实现的三分钟导出/管理员策略；发布仍需重新预检与验收。
[服务器存储检查](execution/SERVER_STORAGE_REVIEW_2026-10-05.md) 保存清理前的只读测量、其他候选与边界。
[备份组成与策略检查](execution/BACKUP_STORAGE_REVIEW_2026-10-05.md) 保存清理前十份全量备份、重复组件、过期导出保留及报告运行兼容问题。

之前的待发布记录：
最新待发布源码 `daf759d` 包含 [格式转换入口与恢复](execution/NORMALIZER_DISCOVERY_2026-10-05.md)：普通导入的折叠入口、转换步骤复用、键盘返回与文件保留。首次 CI 的草稿读取时序失败已修正；本机 10 次复验及最终 CI `37307115329` 五项任务全部通过，发布产物已本地核对。生产仍为 `3f1d539`，等待容量处理；没有执行未获批准的备份去重。

当前 [管理员请求与限额](execution/SUPPORT_REQUESTS_2026-10-05.md) 已提交推送 `ad82cf4`，
新增未发布 migration `20261005_0047`；核心界面、离线草稿、邮件链接及导入／合并中的申请入口已接入，准确源码 CI `37295004053` 全部通过，部署等待服务器空间。
[请求合同](system/SUPPORT_REQUEST_CONTRACT.md) 标明本机实现及未交付边界。

当前线上：2026-10-05 核心引导发布，源码 `3f1d539`，CI `37259074167`（attempt 2），唯一 migration head/current `20261003_0046`。
[Project State](../PROJECT_STATE.md) 是当前快照；[引导部署记录](execution/DEPLOYMENT_GUIDANCE_2026-10-05.md) 记录完整 CI、容量预检、备份、线上验收与旧镜像清理。
[Skill 首选与管理清理](execution/SKILL_UNIFICATION_2026-10-05.md) 已提交 `2863a00` 并通过 CI；部署等待容量处理，尚未替换线上服务。
[引导实施](execution/CORE_GUIDANCE_2026-10-05.md) 保存方案 B 和未纳入 Index 范围的提示行为。之前的 [18 项审查](evidence/ux-audit-whole-site-2026-10-04.md) 与 [UX 发布](execution/DEPLOYMENT_UX_2026-10-04.md) 保留历史证据；后续 Skill/管理员求助事项仍独立跟踪。

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
