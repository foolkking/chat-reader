# 文档导航

入口同步：**2026-11-06**。先读 [Project State](../PROJECT_STATE.md) 和
[AGENTS](../AGENTS.md)，再进入任务专题。当前代码、配置与 migration 是真值；
带日期的 planning/execution/evidence 只说明各自检查点，不能当成新工作指令。

## 当前状态与验收边界

11 月 6 日图片/阅读稳定性及七项追加审查已通过精确 CI `42217357688`：
六项 job、14 项 Web 门禁、阅读 23/23 与 64 条逐帧轨迹、五份制品独立核验。
后续单独授权部署于 **22:07:48 +08:00** 验收，**22:10:03** 独立复核通过。
生产／直接回退为 **`9cf235f`／`67e6336`**，schema **`20261105_0059`**
不变。随后单独授权清理，仅删除两份旧验证备份和八个无引用旧镜像标签；
保留 11 月 6 日、11 月 5 日两份重验备份及当前／直接回退镜像。见
[发布回执](execution/IMAGE_READING_STABILITY_RELEASE_2026-11-06.md)、
[行为合同](system/IMAGE_READING_STABILITY_CONTRACT.md)及
[实施映射](execution/IMAGE_READING_STABILITY_2026-11-06.md)。
清理后独立复核为 85% 使用、6,167,416 KiB 可用；后续发布仍必须重新容量预检，
不能据此扩大删除范围。用户资料、数据卷、镜像归档和发布证据未动。
回退仍需停写、job/data 兼容检查；禁止自动 downgrade。
原用户 ZIP 重试、真实 47 对话离线更新与认证生产 UI 仍待单独验收。
11 月 5 日候选已通过隔离合成 PostgreSQL/附件备份恢复演练，不等于生产备份恢复。
前一恢复一致性 `67e6336` 的 0059 升级与 52/52 回填仍由
[上一发布回执](execution/RECOVERY_CONSISTENCY_RELEASE_2026-11-06.md)保存。
CI 回查保持暂停，没有创建或恢复安排。
此前知识整理及汇报后获准的本地安全清场已完成，该收尾任务本身未重新发布；
见[收尾回执](execution/KNOWLEDGE_CLOSEOUT_2026-11-04.md)中的删除范围与保全核验。

## 开始这里

| 文档 | 长期职责 |
| --- | --- |
| [README](../README.md) | 产品入口、快速开始与常用命令 |
| [Project State](../PROJECT_STATE.md) | 当前源码／运行态、稳定决策和待验证边界 |
| [AGENTS](../AGENTS.md) | 开发、安全、临时目录与验证规则 |
| [产品说明](product.md) | 用户工作流、能力与产品限制 |
| [系统事实索引](system/README.md) | 功能、页面、权限、数据与运行专题 |
| [文档台账](documentation-inventory.md) | 所有权、分类与历史维护记录 |

## 开发与运行

| 文档 | 内容 |
| --- | --- |
| [系统架构](architecture.md) | Web/API/PostgreSQL、canonical 数据和关键数据流 |
| [API 参考](api-reference.md) | 当前业务接口与兼容接口 |
| [本地开发](development.md) | 环境、安装、migration、启动和测试 |
| [测试](testing.md) | 按风险选择测试、CI gate 与证据边界 |
| [生产部署](deployment.md) | 精确制品、容量、停写备份、部署与回退 |
| [故障排查](troubleshooting.md) | 代理、Reader、离线、构建与容器问题 |

## 按任务进入合同

| 任务 | 权威专题 |
| --- | --- |
| 导入格式／ZIP／小内存恢复 | [Adaptive Import](system/ADAPTIVE_IMPORT_CONTRACT.md)、[Archive Import](system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md) |
| 正文与富内容 | [Rich Markdown](system/AI_RICH_MARKDOWN_CONTRACT.md)、[附件](system/ATTACHMENT_RENDERER_CONTRACT.md)、[消息 Markdown 复制](system/MESSAGE_MARKDOWN_COPY_CONTRACT.md) |
| 收藏／批注／标签／数据语义 | [功能清单](system/FEATURE_INVENTORY.md)、[数据与存储](system/DATA_AND_STORAGE.md)、[API](api-reference.md) |
| 页面／导航／阅读流程 | [路由地图](system/PAGE_AND_ROUTE_MAP.md)、[用户流程](system/USER_FLOWS.md)、[前端架构](system/FRONTEND_ARCHITECTURE.md) |
| 编辑与上传 | [后端/API](system/BACKEND_AND_API.md)、[Source Editor 上传原子性](system/SOURCE_EDITOR_UPLOAD_ATOMICITY_CONTRACT.md) |
| Context／归档 | [Context](system/CONTEXT_PACKAGE_CONTRACT.md)、[数据归档](system/DATA_ARCHIVE_CONTRACT.md) |
| 账户／管理员／Share | [认证](system/AUTHENTICATION_CONTRACT.md)、[权限](system/USER_ROLES_AND_PERMISSIONS.md)、[管理](system/ADMINISTRATION_CONTRACT.md) |
| 离线/PWA | [离线韧性](system/PWA_OFFLINE_RESILIENCE_CONTRACT.md)、[任务与离线保留](system/RETENTION_CONTRACT.md) |
| 本轮认证／离线／搜索／归档整合 | [当前行为合同](system/COMPREHENSIVE_OPTIMIZATION_CONTRACT.md)、[实施与验证](execution/COMPREHENSIVE_OPTIMIZATION_2026-11-05.md)；0059 已部署，生产认证 UI 仍未验收 |
| 恢复一致性／预览过期／容量／分页 | [当前行为合同](system/COMPREHENSIVE_OPTIMIZATION_CONTRACT.md#recovery-consistency-follow-up)、[本轮验证](execution/RECOVERY_CONSISTENCY_2026-11-05.md) |
| 噪声与内容清理 | [内容清理](system/CONTENT_CLEANUP_CONTRACT.md)、[已知风险](system/KNOWN_ISSUES_AND_UNCERTAINTIES.md) |
| 发布／依赖／浏览器安全 | [发布安全](system/RELEASE_SAFETY_BASELINE.md)、[Next 迁移与现行版本](system/NEXT_LTS_MIGRATION_CONTRACT.md)、[CSP](system/CSP_ENFORCEMENT_CONTRACT.md) |
| 文件／运行诊断／安全清理 | [Artifact 生命周期](system/ARTIFACT_LIFECYCLE_CONTRACT.md)、[可观测性](system/OBSERVABILITY_CONTRACT.md)、[安全清理](system/CLEANUP_CONTRACT.md) |
| 性能与容量 | [性能合同](system/PERFORMANCE_CAPACITY_CONTRACT.md)、[部署环境](system/DEPLOYMENT_AND_ENVIRONMENT.md) |

## 近期证据（历史记录，不替代当前状态）

- 图片/阅读：[完整 CI／部署回执](execution/IMAGE_READING_STABILITY_RELEASE_2026-11-06.md)。
- 恢复一致性：[完整 CI／部署回执](execution/RECOVERY_CONSISTENCY_RELEASE_2026-11-06.md)。
- 小内存 ZIP：[诊断与实施](execution/SMALL_ZIP_MEMORY_2026-11-04.md)、
  [精确 CI／部署回执](execution/SMALL_ZIP_MEMORY_RELEASE_2026-11-04.md)。
- Reader／收藏／键盘／几何／富 Markdown／ZIP：
  [完成度复审](execution/ux-audit-reader-zip-completion-2026-11-03.md)、
  [实施](execution/READER_ZIP_IMPLEMENTATION_2026-11-03.md)、
  [上一发布点](execution/READER_ZIP_RELEASE_2026-11-04.md)。
- 真实离线大包待复验：[诊断与恢复边界](execution/OFFLINE_LARGE_PACKAGE_DIAGNOSIS_2026-11-01.md)。
- 两轮 24 项有界功能：[实施与发布](execution/WEB_FEATURE_OPPORTUNITIES_IMPLEMENTATION_2026-10-30.md)。
- 本轮知识与工作区收尾：[检查结果和保留现场](execution/KNOWLEDGE_CLOSEOUT_2026-11-04.md)。

## 历史、规划与数据资产

| 位置 | 使用边界 |
| --- | --- |
| [planning/](planning/README.md) | 带日期的设计；仅经当前授权才能转为工作项 |
| [execution/](execution/README.md) | 审查、失败过程、测试及发布证据 |
| [evidence/](evidence/README.md) | 脱敏测量、合成截图和请求快照 |
| [前一状态入口快照](archive/PROJECT_STATE-history-2026-11-04.md) | 保留原检查点和源码 hash，不再冒充当前状态 |
| [前一长导航快照](archive/documentation-index-history-2026-11-04.md) | 保留旧审查索引与逐批摘要，避免丢失检索线索 |
| [早期 UX 交接](agent-context/UX_AUDIT_HANDOFF.md) | 历史范围；新会话仍从 Project State 开始 |
| [早期优化账本](system/CONTINUOUS_OPTIMIZATION_BACKLOG.md) | 历史审查与决策，不是持续无限优化指令 |

`apps/api/storage/imports/**/*.md`、`examples/**/*.md` 与应用内 Skill Markdown
是用户资料或产品/测试输入，不属于文档整理对象；不要自动改写、移动或纳入知识链接校验。
