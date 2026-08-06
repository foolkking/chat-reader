# 2026-07-27 改造规划档案

| 字段 | 内容 |
| --- | --- |
| 基线 | 2026-07-26 系统事实盘点；commit `e752e9ddf25595c3f373977a1803956354ca71b0` |
| 封板日期 | 2026-07-27 |
| 当前状态 | 已执行、已审计、已发布；历史封存 |
| 实施证据 | [docs/execution/README.md](../execution/README.md) |
| 当前事实 | [PROJECT_STATE.md](../../PROJECT_STATE.md)、[docs/system/README.md](../system/README.md) |

本目录保留当时的产品决策、设计方案、文件级任务和验收标准，用于追溯“为什么这样实现”。它不再是待执行计划，也不应覆盖后续用户决策或当前代码。

## 后续覆盖

2026-07-28 至 2026-07-29 的明确需求对原封板方案做了以下主要覆盖：

- 30 条 preview/heavy 懒加载改为完整 user-led turn，稳定 DOM 最多 3 轮。
- 对话/Project 互斥标签改为 Project + 未归类单层侧栏和双向拖放。
- 离线包升级为 v2 conversation delta，同时保留 v1 读取和 Dexie version 1。
- 桌面隐藏“最近”入口/卡片，移动端保留 `/recent` 和继续阅读。
- 搜索/Share/Export 统一 utility drawer，专注模式成为真正沉浸阅读。
- 批量管理改为 Linear 式选择；批注增加全屏阅读、连续/逐条模式和精选管理。
- “阅读预设”拆为 Markdown 间距与 15-22px 字号；新增 migrations `20260728_0015`、`20260728_0016`。
- 离线侧栏、偏好入口和 TOC 预览与在线版对齐。

发生冲突时优先级为：最新用户决策和当前代码 > `PROJECT_STATE.md`/当前系统事实 > 本目录历史计划。

## 文件索引

| 文档 | 历史用途 |
| --- | --- |
| [EXECUTION_LOCK.md](EXECUTION_LOCK.md) | 当时的决策锁和执行边界 |
| [EXECUTION_MANIFEST.md](EXECUTION_MANIFEST.md) | 63 项文件级任务与验收映射 |
| [DECISION_LOG.md](DECISION_LOG.md) | D-001 至 D-025 决策背景 |
| [MASTER_REDESIGN_PLAN.md](MASTER_REDESIGN_PLAN.md) | 改造总计划 |
| [TRACEABILITY_MATRIX.md](TRACEABILITY_MATRIX.md) | 决策、任务和验收追踪 |
| [FACT_BASELINE_RECONCILIATION.md](FACT_BASELINE_RECONCILIATION.md) | 2026-07-27 当时的事实校准 |
| [PRODUCT_GOALS_AND_CONSTRAINTS.md](PRODUCT_GOALS_AND_CONSTRAINTS.md) | 产品目标和兼容边界 |
| [USER_TASK_MODEL.md](USER_TASK_MODEL.md) | 角色、任务和高风险流程 |
| [INFORMATION_ARCHITECTURE_PLAN.md](INFORMATION_ARCHITECTURE_PLAN.md) | 原信息架构方案 |
| [PAGE_REDESIGN_PLAN.md](PAGE_REDESIGN_PLAN.md) | 页面和覆盖层改造 |
| [READER_REDESIGN_PLAN.md](READER_REDESIGN_PLAN.md) | 原 Reader 方案及后续覆盖提示 |
| [SEARCH_AND_DISCOVERY_PLAN.md](SEARCH_AND_DISCOVERY_PLAN.md) | 搜索和最近规划 |
| [ANNOTATION_AND_NOTES_PLAN.md](ANNOTATION_AND_NOTES_PLAN.md) | 批注和精选笔记规划 |
| [SHARE_AND_EXPORT_PLAN.md](SHARE_AND_EXPORT_PLAN.md) | Share 与 Export 规划 |
| [MOBILE_EXPERIENCE_PLAN.md](MOBILE_EXPERIENCE_PLAN.md) | 移动端规划 |
| [DESIGN_SYSTEM_PLAN.md](DESIGN_SYSTEM_PLAN.md) | 设计 token 和组件规范 |
| [OFFLINE_AND_PWA_PLAN.md](OFFLINE_AND_PWA_PLAN.md) | 离线/PWA 规划 |
| [FUNCTION_CHANGE_MATRIX.md](FUNCTION_CHANGE_MATRIX.md) | 功能增删矩阵 |
| [TECHNICAL_CHANGE_PLAN.md](TECHNICAL_CHANGE_PLAN.md) | 前后端技术变更清单 |
| [IMPLEMENTATION_BACKLOG.md](IMPLEMENTATION_BACKLOG.md) | 实施顺序和依赖 |
| [ACCEPTANCE_AND_TEST_PLAN.md](ACCEPTANCE_AND_TEST_PLAN.md) | A-01 至 A-19、S-01 至 S-08 验收 |

## 维护规则

- 保留原文和当时版本号，不批量“修正”为今天的实现；覆盖关系只在本索引与执行档案中说明。
- 不向本目录追加普通新需求。新的计划应另建带日期/决策状态的文档，并在文档台账登记。
- 需要判断当前功能时回到代码和现行文档，不从历史计划推断。
