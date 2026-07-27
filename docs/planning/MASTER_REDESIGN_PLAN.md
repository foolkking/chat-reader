# Chat Reader 改造总计划 MASTER_REDESIGN_PLAN

**创建日期：** 2026-07-27
**封板日期：** 2026-07-27
**基线版本：** `e752e9ddf25595c3f373977a1803956354ca71b0`
**状态：** ✅ **已封板，可执行**
**唯一执行入口（按序阅读）：** `EXECUTION_LOCK.md` → `EXECUTION_MANIFEST.md` → `DECISION_LOG.md` → `ACCEPTANCE_AND_TEST_PLAN.md` → 按需读专项文档
**禁止重新规划：** 第二轮执行智能体不得重新讨论或修改本计划中已锁定的任何决策、产品定位、信息架构、视觉规范和功能边界。执行中仅负责实施、验证和交付。
**唯一执行依据：** 本文件 + `DECISION_LOG.md`。冲突时以 `DECISION_LOG.md` 为准。

---

## 1. 改造总目标

将 Chat Reader 改造为一个**气质温暖、阅读舒适、结构清晰的 ChatGPT 导出资料长期阅读与管理工具**。保持工具型定位，不引入账号/在线 AI/多用户。核心是：Reader 阅读体验升级 + 信息架构清晰 + 视觉语言统一 + 功能完整保留。

---

## 2. 已确认边界

- **做什么：** 阅读/管理/编辑/批注/检索/Share/Export/离线，全部保留并优化。
- **不做什么（D-023）：** 账号/在线 AI/多用户/协作/全局批注中心/标签/日历/附件上传/音视频/HTML-PDF 导出/虚拟滚动/技术栈重构/微前端/Reader SSR。
- **允许改：** 前端全面、后端 API/DB/Alembic、Dexie/SW/.cr/offline package/Share token。
- **不允许改：** 换技术栈、加 auth 中间件、改导入两阶段流程、删除核心功能。
- **兼容性（D-024）：** 见图 §12. 兼容性锁定。不向后兼容仅适用于 CSS token 色值和可能的 Dexie schema 版本升级。**不允许**破坏 PostgreSQL 数据、Share URL、离线包、批注/笔记/阅读位置。
- **事实修正（2026-07-27 封板核对）：** 后端 routes 实际路径 `apps/api/app/api/routes/`（非 `apps/api/app/routes/`）；业务表 22 张（非 21）；migration head `20260724_0015`；设计 token 全在 `apps/web/app/globals.css`（tailwind 空 extend）。
- **技术影响最终结论（封板锁定）：** 前端必须修改（大量）；后端小量修改（搜索扩展批注）；API 扩展返回字段；数据库不改；Alembic 不创建；Dexie 不改；SW 调整（不重写）；.cr 不改；offline package 不改；Share 不改；Nginx 不改；生产部署需前端重建+SW revision 更新。

---

## 3. 用户与核心任务

- **角色：** 本地资料拥有者（主）+ Share 访客（只读）。
- **19 项核心任务**见 USER_TASK_MODEL。
- **三条进入 Reader 路径（D-009）：** 列表 / 搜索 / 继续阅读，均优化且衔接顺滑。

---

## 4. 最终信息架构（D-005~D-009）

- 首页 = 资料总览中心；左侧导航栏 = 导入/搜索(Cmd+K)/最近/归档/对话-项目标签/设置。
- `/recent` 正式纳入导航；`/library` 情景化引导不入主导航。
- 页面树与跳转关系见 INFORMATION_ARCHITECTURE_PLAN。

---

## 5. 全系统页面方案

9 路由 + 16 覆盖层，逐条见 PAGE_REDESIGN_PLAN。最高优先级 = Reader `/conversations/[id]`。

---

## 6. Reader 最终方案（D-011~D-015-A）

- **布局：** 左侧导航栏（独立）+ 正文区域（对话 TOC rail + 消息正文 + 章节 TOC，均属正文）+ 批注（浮窗/固定左栏）。
- **模式：** 默认阅读/专注/工作台/Share 访客/离线。
- **正文：** 统一左对齐，头像/标签/背景区分。
- **双 TOC：** 对话 TOC（跨消息）+ 章节 TOC（消息内），命名与视觉区分。
- **顶栏：** 一级(搜索/导航/批注/分享) + 更多菜单 + 消息级。
- **批注：** 默认浮窗，可固定左栏（覆盖导航栏），可拆离，不取代任何 TOC。
- 完整见 READER_REDESIGN_PLAN。

---

## 7. 功能变化矩阵

保留/优化/重构/补齐/新增/不做，逐项见 FUNCTION_CHANGE_MATRIX。**删除项：无。**

- **重构：** 正文左对齐、双 TOC 视觉、批注形态。
- **新增（已确认）：** 专注模式、Cmd+K、移动简化批注、离线情景引导、设计 token。
- **补齐：** 最近入口、搜索含批注、状态统一。

---

## 8. 视觉系统（D-019~D-022）

现代阅读器气质；accent #10a37f + 暖中性；正文宽松侧栏紧凑；柔和圆角(8px)与三级阴影。全部 token 在 `app/globals.css`。见 DESIGN_SYSTEM_PLAN。

---

## 9. 技术改动

前端大量、后端小量（搜索扩展批注）、DB 不改、Alembic 不创建、Dexie 不改、SW 调整（不重写）、.cr/package/Share 不改。见 TECHNICAL_CHANGE_PLAN（以 EXECUTION_LOCK.md §14 为准）。

---

## 10. 文件级实施清单

阶段 0-8，路径级，见 IMPLEMENTATION_BACKLOG。

---

## 11. 实施顺序与依赖（D-025 一次性完成，此为内部依赖顺序）

1. 设计 token（globals.css）
2. 全局壳与导航
3. 首页与列表页
4. Reader 核心
5. 批注/编辑/工具面板
6. 移动端
7. 离线/PWA
8. 后端（搜索含批注，小量）+ API 扩展
9. 状态/可访问性/测试

---

## 12. 风险与兼容

| 风险 | 缓解 |
|------|------|
| 数据/migration | downgrade + 备份 + 破坏性提示 |
| 离线数据失效 | 首次进入提示重新下载 |
| Share 旧链接失效 | 明确不保证兼容（D-024） |
| 性能（长对话） | 保持窗口/懒加载，不引入虚拟滚动 |
| 响应式 | 多断点测试 |
| 大量组件重构 | 保持渲染管线/导航语义不变 |
| 回退 | 前端 git 回退，DB downgrade |

---

## 13. 验收标准

A-01~A-19 页面级 + S-01~S-08 语义回归，均可测。见 ACCEPTANCE_AND_TEST_PLAN。

---

## 14. 测试计划

单元/API/集成/Playwright/桌面+移动截图/响应式/键盘/可访问性/长对话/离线/Share/导入/批注同步/错误态。见 ACCEPTANCE_AND_TEST_PLAN §3。

---

## 15. 用户决策汇总

25 项（D-001~D-025 含 D-015-A）全部确认，见 DECISION_LOG。

---

## 16. 明确不做

见 §2 与 D-023。执行阶段不得扩展。

---

## 17. 第二轮执行指令摘要

- **必读（严格按序）：** `EXECUTION_LOCK.md` → `EXECUTION_MANIFEST.md` → `DECISION_LOG.md` → `ACCEPTANCE_AND_TEST_PLAN.md`；按需读 `READER_REDESIGN_PLAN.md`、`DESIGN_SYSTEM_PLAN.md` 等专项。
- **唯一执行入口：** `EXECUTION_LOCK.md` + `EXECUTION_MANIFEST.md`。
- **实施顺序：** EXECUTION_MANIFEST 的阶段 S0→S8（非分期，一次性连续执行）。
- **禁止重新规划：** 所有 25 项决策（D-001~D-025）、产品定位、信息架构、视觉规范、功能范围已锁定。执行智能体不得修改、讨论或重新确认。
- **允许自行决定：** 仅限 EXECUTION_LOCK §17 列出的实现自由项。
- **触发用户提问：** 仅限 EXECUTION_LOCK §19 列出的四种情况。
- **每完成 S-[n] 后检查：** 对照 ACCEPTANCE_AND_TEST_PLAN 对应 A/S 验收项。
- **最终完成标准：** A-01~A-19 + S-01~S-08 全通过、Playwright E2E 通过、桌面+移动截图核对、`next build`+ESLint+tsc 通过、破坏性变更的 UI 提示文案到位、无遗留待定。

---

## 未决事项检查

**是否仍存在会阻塞执行的未决事项：否。**
