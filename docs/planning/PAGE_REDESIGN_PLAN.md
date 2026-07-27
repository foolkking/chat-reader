# 页面级改造规划 PAGE_REDESIGN_PLAN

**创建日期：** 2026-07-27
**依据：** DECISION_LOG 全部；docs/system/PAGE_AND_ROUTE_MAP.md
**说明：** 每个路由/覆盖层一个改造条目。Reader 的完整细节见 READER_REDESIGN_PLAN，移动端见 MOBILE_EXPERIENCE_PLAN，此处给页面级结论。

---

## R-01 首页 `/`
- **页面/模块：** `apps/web/app/page.tsx` + `components/app-shell.tsx` + `features/projects/project-sidebar.tsx`
- **当前职责：** 对话/Project 侧栏 + 活跃对话列表 + 导入/搜索/归档/设置入口。
- **用户目标：** 查看全部资料、快速定位对话、导入。
- **当前问题：** 无"最近"入口（KI-003）；视觉层级平淡；空态弱。
- **改良目标：** 资料总览中心（D-006）+ 嵌套导航 + 最近入口（D-007）。
- **最终方案：** 见 INFORMATION_ARCHITECTURE_PLAN §2。左侧导航栏加"最近/搜索(Cmd+K)"，对话/项目标签，行内菜单；主区活跃对话列表优化（进度/时间/摘要）。
- **桌面：** 左导航栏 + 列表。**移动：** 首屏继续阅读卡 + 标签列表（D-018）。
- **状态：** loading skeleton / 空态引导导入 / 错误重试。
- **涉及前端：** 上述 + `conversation-list.tsx`, `sort-menu.tsx`, `selection-toolbar.tsx`。**后端：** `GET /api/conversations?scope=all`, `/api/projects`, `/api/preferences`, `/api/tasks/active`。**迁移：** 不涉及。
- **验收：** 见 ACCEPTANCE_AND_TEST_PLAN A-01。

## R-02 归档 `/archived`
- **文件：** `app/archived/page.tsx` + `features/conversations/archived-conversation-list.tsx`(注：核对为 conversation-list 归档态) + `features/projects/archived-project-list.tsx`
- **当前职责：** 已归档对话/Project、恢复、删除。
- **改良：** 视觉与首页一致；选择模式统一；空态优化。
- **状态：** 空/列表/加载/错误。**迁移：** 不涉及。

## R-03 最近 `/recent`
- **文件：** `app/recent/page.tsx` + `features/reading/recent-items.tsx`
- **当前职责：** 最近打开的 Conversation/Project/Message；侧栏无入口。
- **改良：** 正式纳入导航（D-007）；分组 + 进度 + 时间；点击恢复位置；空态引导。
- **后端：** `/api/recent-items`。**迁移：** 不涉及（除非扩展字段）。

## R-04 全局搜索 `/search`
- **文件：** `app/search/page.tsx` + `features/search/*`
- **改良：** Cmd+K 唤起（D-008）；结果分组 + 上下文 + 高亮 + 标识；点击精确定位；返回保留查询。
- **后端：** `GET /api/search`。详见 SEARCH_AND_DISCOVERY_PLAN。

## R-05 Project 详情 `/projects/[projectId]`
- **文件：** `app/projects/[projectId]/page.tsx` + `features/projects/project-conversation-list.tsx`
- **改良：** 与首页一致视觉；对话列表 + 批量；拖动排序保留。
- **后端：** `/api/projects*`。

## R-06 Reader `/conversations/[conversationId]`
- **文件：** `app/conversations/[conversationId]/page.tsx` + `loading.tsx` + `features/conversations/conversation-reader.tsx` 等。
- **改良：** 完整改造，见 READER_REDESIGN_PLAN（渐进式显示 D-011、统一左对齐 D-012、双 TOC D-013、顶栏分级 D-014、批注混合 D-015）。
- **最高优先级。**

## R-07 只读分享 `/share/[token]`
- **文件：** `app/share/[token]/page.tsx` + `features/sharing/share-readonly-reader.tsx`
- **改良：** 访客只读视觉与主 Reader 一致（简化）；隐私/品牌提示；可选导出。详见 SHARE_AND_EXPORT_PLAN。

## R-08 离线资料库 `/library`
- **文件：** `app/library/page.tsx` + `layout.tsx` + `features/offline/library-shell.tsx`
- **改良：** 情景化引导（D-005）；catalog/下载/删除/空间视觉重做；数据格式升级提示（D-024）。详见 OFFLINE_AND_PWA_PLAN。

## R-09 连接失败 `/offline`
- **文件：** `app/offline/page.tsx`
- **改良：** 视觉统一；重试；明确非 library fallback。

---

## 覆盖层与面板

## O-01 导入对话框
- **文件：** `components/import-dialog-provider.tsx` + `features/import/import-panel.tsx` + `import-preview-card.tsx` + `import-task-monitor.tsx`
- **改良：** preview→commit 流程不变（D-023）；视觉重做；warnings/profile 清晰；任务反馈。

## O-02 偏好面板
- **文件：** `components/preferences-panel.tsx` + `preferences-provider.tsx`
- **改良：** 主题/语言/阅读宽度；新增专注模式/批注默认位置等偏好（如需）；离线库入口。

## O-03 任务监控
- **文件：** `features/import/import-task-monitor.tsx`（+ 后端 `/api/tasks/*`）
- **改良：** active/status/retry 视觉；失败态清晰。

## O-04 Reader 操作轨
- **文件：** `components/reader-header-action-rail.tsx`
- **改良：** 分级（D-014）。

## O-05 对话 TOC / O-06 章节 TOC
- **文件：** `features/toc/conversation-index.tsx` / `conversation-toc.tsx`
- **改良：** 见 READER_REDESIGN_PLAN §4。

## O-07 当前对话搜索
- **文件：** `features/search/conversation-search-panel.tsx`
- **改良：** 上下文 + 高亮 + 定位。

## O-08 批注工作区
- **文件：** `features/annotations/annotation-workspace.tsx`
- **改良：** 浮窗/固定左栏/拆离/管理（D-015）。

## O-09 Share 面板 / O-10 Export 面板
- **文件：** `features/sharing/share-panel.tsx` / `features/exporting/export-panel.tsx`
- **改良：** 见 SHARE_AND_EXPORT_PLAN。

## O-11 消息编辑 / O-12 版本查看恢复
- **文件：** `features/editing/edit-message-form.tsx`, `version-history-panel.tsx`, `version-history-button.tsx`, `restore-version-button.tsx`
- **改良：** 视觉统一；版本不可变语义保留；恢复确认。

## O-13 移动端侧栏 / O-14 移动 Reader actions / O-15 移动 Bottom Sheets
- 见 MOBILE_EXPERIENCE_PLAN。

## O-16 全局状态（loading/empty/error/offline/conflict）
- 统一到 DESIGN_SYSTEM_PLAN §6.7 规范，逐组件落地。

---

## 每条目通用字段
- **文案要求：** 清晰、去术语化、中文为主（i18n `lib/i18n.ts`）。
- **性能影响：** 保持窗口加载/懒加载语义，不引入虚拟滚动。
- **安全隐私：** Share/Export 私有默认关闭；不泄露 token。
- **回退方式：** 纯前端改动可 git 回退；DB 变更见 TECHNICAL_CHANGE_PLAN 回退策略。
