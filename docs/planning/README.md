# Chat Reader 完整改造规划

**规划日期：** 2026-07-27
**基线版本：** `e752e9ddf25595c3f373977a1803956354ca71b0`
**规划状态：** ✅ **已封板，可执行**
**封板日期：** 2026-07-27
**封板检查项：** ✅ 事实基线核对 ✅ 决策锁定 ✅ 技术影响确定 ✅ 追踪矩阵完成 ✅ 文档一致性通过

---

## 规划概述

本目录包含 Chat Reader 系统的完整改造规划，基于 2026-07-26 完成的系统事实盘点。本轮规划已完成所有关键决策确认，形成可直接执行的完整方案。

### 核心定位

Chat Reader 保持**工具型定位**，继续聚焦 ChatGPT 导出资料的长期阅读和管理。本轮改造的目标是：

1. **提升阅读体验**：优化 Reader 的视觉层级、信息密度和交互流畅度
2. **完善信息架构**：明确导航层级，加入"最近"入口，优化首页职责
3. **统一设计语言**：建立温暖舒适的现代阅读器气质
4. **保持功能完整**：不删减现有核心能力，优化而非重构

### 改造范围

**允许修改**：
- ✅ 前端 UI/UX、组件结构、样式系统
- ✅ 后端 API、数据库表结构（Alembic migration）
- ✅ 数据协议（.cr、offline package、Dexie schema）
- ✅ Service Worker、离线系统

**明确不做**：
- ❌ 账号、登录、多用户系统
- ❌ 在线 AI 对话功能
- ❌ 全局批注/笔记中心（独立于 Reader）
- ❌ 标签、日历、附件上传
- ❌ HTML/PDF 导出
- ❌ 真正的虚拟滚动
- ❌ 技术栈重构

### 设计方向

- **视觉气质**：现代阅读器（舒适温暖），参考 Readwise Reader、Matter
- **主色调**：保持绿色系，微调为更温暖的 #10a37f
- **信息密度**：正文舒适宽松，侧栏适度紧凑
- **圆角阴影**：柔和温暖（8px 圆角，多层柔和阴影）
- **端侧优先**：桌面优先，移动端阅读 + 轻量管理

---

## 文档导航

### 封板核心文档
| 文档 | 用途 | 优先级 |
|------|------|--------|
| [EXECUTION_LOCK.md](EXECUTION_LOCK.md) | 执行决策锁（最高约束） | **P0** |
| [EXECUTION_MANIFEST.md](EXECUTION_MANIFEST.md) | 文件级执行清单 | **P0** |
| [DECISION_LOG.md](DECISION_LOG.md) | 25 个核心决策的权威记录 | P1 |
| [MASTER_REDESIGN_PLAN.md](MASTER_REDESIGN_PLAN.md) | 改造总计划 | P1 |
| [TRACEABILITY_MATRIX.md](TRACEABILITY_MATRIX.md) | 决策→任务→验收追踪矩阵 | P1 |
| [FACT_BASELINE_RECONCILIATION.md](FACT_BASELINE_RECONCILIATION.md) | 事实基线修正核对记录 | P1 |
| [PRODUCT_GOALS_AND_CONSTRAINTS.md](PRODUCT_GOALS_AND_CONSTRAINTS.md) | 产品目标、边界、兼容策略 | P2 |
| [USER_TASK_MODEL.md](USER_TASK_MODEL.md) | 用户角色、19 项任务、场景 | P2 |

### 专项规划

| 文档 | 覆盖范围 |
|------|----------|
| [INFORMATION_ARCHITECTURE_PLAN.md](INFORMATION_ARCHITECTURE_PLAN.md) | 导航结构、首页、路由关系 |
| [PAGE_REDESIGN_PLAN.md](PAGE_REDESIGN_PLAN.md) | 9 路由 + 16 覆盖层改造条目 |
| [READER_REDESIGN_PLAN.md](READER_REDESIGN_PLAN.md) | Reader 完整改造方案（最高优先） |
| [SEARCH_AND_DISCOVERY_PLAN.md](SEARCH_AND_DISCOVERY_PLAN.md) | 搜索、最近、继续阅读 |
| [ANNOTATION_AND_NOTES_PLAN.md](ANNOTATION_AND_NOTES_PLAN.md) | 批注、精选笔记、同步 |
| [SHARE_AND_EXPORT_PLAN.md](SHARE_AND_EXPORT_PLAN.md) | Share 与 Export |
| [MOBILE_EXPERIENCE_PLAN.md](MOBILE_EXPERIENCE_PLAN.md) | 移动端专项设计 |
| [DESIGN_SYSTEM_PLAN.md](DESIGN_SYSTEM_PLAN.md) | 视觉系统、token、组件规范 |
| [OFFLINE_AND_PWA_PLAN.md](OFFLINE_AND_PWA_PLAN.md) | 离线资料库与 PWA |

### 实施文档

| 文档 | 用途 |
|------|------|
| [FUNCTION_CHANGE_MATRIX.md](FUNCTION_CHANGE_MATRIX.md) | 功能增删矩阵 |
| [TECHNICAL_CHANGE_PLAN.md](TECHNICAL_CHANGE_PLAN.md) | 前后端技术变更清单 |
| [IMPLEMENTATION_BACKLOG.md](IMPLEMENTATION_BACKLOG.md) | 文件级实施清单 |
| [ACCEPTANCE_AND_TEST_PLAN.md](ACCEPTANCE_AND_TEST_PLAN.md) | 验收标准和测试计划 |

---

## 第二轮执行指引

### 唯一执行入口（严格按序阅读）

第二轮执行智能体必须按以下顺序阅读文档，不得跳跃或跳过：

1. **`EXECUTION_LOCK.md`** — 首先理解所有执行约束和禁止事项
2. **`EXECUTION_MANIFEST.md`** — 然后获得逐文件执行清单
3. **`DECISION_LOG.md`** — 了解 25 项决策背景
4. **`MASTER_REDESIGN_PLAN.md`** — 改造方案总览
5. **`ACCEPTANCE_AND_TEST_PLAN.md`** — 验收标准和测试计划
6. **`IMPLEMENTATION_BACKLOG.md`** — 备用实施依赖顺序
7. **专项规划文档**（按需深入）：`READER_REDESIGN_PLAN.md` > `DESIGN_SYSTEM_PLAN.md` > `MOBILE_EXPERIENCE_PLAN.md` > 其余
8. **事实文档**（按需）：`docs/system/`

### 执行原则

1. **不得偏离执行锁（EXECUTION_LOCK.md）**：所有 25 项决策不可修改；禁止事项不能做
2. **一次性完成**：不分阶段，一次对话完成全部改造（S0→S8 连续执行）
3. **不得重新规划**：所有产品/交互/视觉/功能/技术决策已锁定
4. **完整验收**：EXECUTION_MANIFEST 每项标注验收 ID，完成后逐项自查
5. **保持代码质量**：遵循现有代码风格和架构模式

### 禁止事项

- ❌ 不得添加未在规划中确认的功能
- ❌ 不得删除现有核心功能
- ❌ 不得修改产品定位（保持工具型）
- ❌ 不得引入新的技术栈或架构模式
- ❌ 不得在执行中重新讨论已确认的决策

---

## 规划完成度检查

### ✅ 已完成

- [x] 系统事实盘点（docs/system/）
- [x] 25 个核心决策确认
- [x] 产品目标和边界明确
- [x] 信息架构设计完成
- [x] Reader 完整设计完成
- [x] 移动端专项设计完成
- [x] 视觉系统规范完成
- [x] 技术变更计划完成
- [x] 实施清单完成
- [x] 验收标准完成

### ❓ 无悬而未决问题

确认：**本规划无遗留的关键不确定性或待决策事项**。所有会影响执行的重大决定均已明确。

---

## 文档维护

- **更新规则**：第二轮执行前不应修改本规划（除非发现严重错误）
- **执行反馈**：执行中发现的问题应记录在执行日志，不修改本规划
- **版本控制**：本规划对应 commit 将在第二轮执行前单独提交

---

**下一步行动**：进入第二轮，开始执行改造。
