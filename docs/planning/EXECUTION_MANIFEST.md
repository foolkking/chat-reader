# 文件级执行清单 EXECUTION_MANIFEST

**封板日期：** 2026-07-27
**说明：** 第二轮逐项施工的唯一文件级清单。每个路径已通过代码搜索确认存在。
**操作类型：** 创建 / 修改 / 删除 / 重命名 / 无需修改 / 核验

---

## 全局约定
- 样式：全部 token 修改在 `apps/web/app/globals.css`；不修改 `tailwind.config.ts`
- i18n：所有用户可见文案遵循 `apps/web/lib/i18n.ts` 模式
- 路径：除非标注"新建"，所有文件已存在

---

## S0 设计系统（先行）

| 顺序 | 任务 ID | 操作 | 文件路径 | 具体变更 |
|------|---------|------|---------|---------|
| 0.1 | DS-01 | 修改 | `apps/web/app/globals.css` | 改 light accent 色值 #0f8f70→#10a37f；accent-soft #e8f5f0→#f0fdfa；dark accent #55c9a6→#5fd0ad；neutral 暖调（page/sidebar/border） |
| 0.2 | DS-02 | 创建 | `apps/web/app/globals.css`（新增块） | 新增 `--shadow-subtle/soft/medium`、`--radius-sm/md/lg/pill`、`--space-message/list/toc`、`--color-semantic-*` 变量 |
| 0.3 | DS-03 | 修改 | `apps/web/app/globals.css` | Reader 网格：新增 `data-focus-mode` 支持（隐藏 .reader-index-column/.reader-toc-column + 顶栏），消息间距改 `--space-message`，对话 TOC rail 视觉优化，章节 TOC 树状缩进优化 |
| 0.4 | DS-04 | 修改 | `apps/web/app/globals.css` | 组件 token 工具类：.btn-primary/.btn-secondary/.btn-ghost/.btn-icon/.btn-pill/.btn-danger、.input-base、.card-base、.menu-list、.modal-base、.state-empty/.state-error/.state-offline/.badge-accent/.badge-danger |

---

## S1 全局壳与导航

| 顺序 | 任务 ID | 操作 | 文件路径 | 具体变更 | 前置依赖 | 验收项 |
|------|---------|------|---------|---------|---------|--------|
| 1.1 | NAV-01 | 修改 | `apps/web/features/projects/project-sidebar.tsx` | 侧栏结构：顶部加"最近"链接(Cmd+K 提示)、搜索按钮、归档；对话/项目标签切换；行 hover 高亮；active 项左条；批注固定状态判断（被覆盖时渲染提示） | S0 | A-01 |
| 1.2 | NAV-02 | 修改 | `apps/web/components/app-shell.tsx` | 壳视觉 token 化；背景层级 | DS-01 | A-01 |
| 1.3 | NAV-03 | 修改 | `apps/web/components/shortcut-manager.tsx` | 新增 Cmd/Ctrl+K 监听 → 派发 `chat-reader:focus-global-search` | — | A-01, A-04 |
| 1.4 | NAV-04 | 修改 | `apps/web/features/search/sidebar-search.tsx` | 监听 focus-global-search 事件；聚焦输入框 | NAV-03 | A-04 |
| 1.5 | NAV-05 | 修改 | `apps/web/features/search/search-box.tsx` | 同 NAV-04 | NAV-03 | A-04 |
| 1.6 | NAV-06 | 修改 | `apps/web/components/preferences-panel.tsx` | 新增专注模式/批注位置偏好 UI；离线资料库入口 | S0 | A-08 |
| 1.7 | NAV-07 | 核验 | `apps/web/components/preferences-provider.tsx` | 确认现有 localStorage 读写模式可用；决定新增偏好是否沿用 | — | — |

---

## S2 首页与列表页

| 顺序 | 任务 ID | 操作 | 文件路径 | 具体变更 | 前置依赖 | 验收项 |
|------|---------|------|---------|---------|---------|--------|
| 2.1 | HOM-01 | 修改 | `apps/web/app/page.tsx` | 视觉 token 化；移动端继续阅读卡片条件渲染（有最近阅读时显示） | DS-01, S1 | A-01, A-17 |
| 2.2 | HOM-02 | 修改 | `apps/web/features/conversations/conversation-list.tsx` | 行项加进度指示器、最近访问时间、摘要（取首条）；token 化 | S0 | A-01 |
| 2.3 | HOM-03 | 修改 | `apps/web/app/archived/page.tsx` | 视觉 token 化；空态优化 | S0 | A-02 |
| 2.4 | HOM-04 | 核验+调整 | `apps/web/components/app-shell.tsx` | 确认为 `mode="archived"` 提供的视图；视觉统一 | S0 | A-02 |
| 2.5 | HOM-05 | 修改 | `apps/web/app/recent/page.tsx` | 正式页面：分组+进度+时间；空态引导 | S0 | A-03 |
| 2.6 | HOM-06 | 修改 | `apps/web/features/reading/recent-items.tsx` | 增强 item 数据（进度/摘要）；继续阅读卡片组件（可被首页/移动端复用） | S0 | A-03, A-17 |
| 2.7 | HOM-07 | 修改 | `apps/web/features/search/search-page.tsx` | 结果按 document_type 分组（对话/批注）展示；批注结果标注对话来源 | S0 + S3 | A-04 |
| 2.8 | HOM-08 | 修改 | `apps/web/features/search/search-results.tsx` | 项加上下文片段、Project/角色标识、关键词高亮；批注结果加注释类型图标 | S0 + S3 | A-04 |
| 2.9 | HOM-09 | 修改 | `apps/web/app/projects/[projectId]/page.tsx` | 视觉 token 化 | S0 | A-05 |
| 2.10 | HOM-10 | 修改 | `apps/web/features/projects/project-conversation-list.tsx` | 行项同 HOM-02 | S0 | A-05 |
| 2.11 | HOM-11 | 修改 | `apps/web/components/selection-toolbar.tsx` | 视觉 token 化 | S0 | — |
| 2.12 | HOM-12 | 修改 | `apps/web/components/sort-menu.tsx` | 视觉 token 化 | S0 | — |

---

## S3 Reader 核心（最高优先级）

| 顺序 | 任务 ID | 操作 | 文件路径 | 具体变更 | 前置依赖 | 验收项 |
|------|---------|------|---------|---------|---------|--------|
| 3.1 | RDR-01 | 修改 | `apps/web/features/conversations/conversation-reader.tsx` | 渐进式模式（默认/专注/工作台）；专注模式按钮+快捷键 → 设 data-focus-mode；顶栏动作分级（一级/更多菜单分离）；批注开关协调（浮窗/固定/关闭）；批注计数 badge | S0 | A-06~A-10, A-11, A-12 |
| 3.2 | RDR-02 | 修改 | `apps/web/features/conversations/message-item.tsx` | 统一左对齐；消息头（头像+User/Assistant #序号+hover 时间戳）；背景 --subtle/--surface；左边可选 accent 条 | S0 | A-07 |
| 3.3 | RDR-03 | 修改 | `apps/web/features/conversations/assistant-message-renderer.tsx` | 保持左对齐，统一消息头样式 | S0 | A-07 |
| 3.4 | RDR-04 | 修改 | `apps/web/features/toc/conversation-index.tsx` | 对话 TOC 视觉：rail 彩条优化、active 更清、UI名改为"消息列表"、hover panel 卡片化 | S0 | A-09 |
| 3.5 | RDR-05 | 修改 | `apps/web/features/toc/conversation-toc.tsx` | 章节 TOC 树状缩进优化、active marker、UI名"章节目录"、加载态保留旧数据 | S0 | A-09 |
| 3.6 | RDR-06 | 修改 | `apps/web/components/reader-header-action-rail.tsx` | 动作分级：一级（搜索/导航/批注/分享）+ 更多菜单（导出/离线切换/展开全部/专注模式/同步）；带 badge 的批注图标 | S0 | A-10 |
| 3.7 | RDR-07 | 核验/调整 | `apps/web/components/responsive-reader-frame.tsx` | 确保 data-focus-mode 属性正确传至 reader-frame；视需要调整默认 TOC 宽 | DS-03 | A-08 |
| 3.8 | RDR-08 | 核验 | `apps/web/lib/reader-navigation.ts` | 确保专注模式不破坏导航语义；保持 target 流程 | — | — |
| 3.9 | RDR-09 | 核验 | `apps/web/features/conversations/conversation-action-menu.tsx` | 消息菜单视觉适配 | S0 | — |

---

## S4 批注/编辑/工具面板

| 顺序 | 任务 ID | 操作 | 文件路径 | 具体变更 | 前置依赖 | 验收项 |
|------|---------|------|---------|---------|---------|--------|
| 4.1 | ANN-01 | 修改 | `apps/web/features/annotations/annotation-workspace.tsx` | 混合形态：默认浮窗（拖动/resize/记忆）→ 固定到左侧导航栏（覆盖 project-sidebar，提供返回入口）→ 拆离回浮窗；不取代任何 TOC；关闭恢复左侧栏 | S0, NAV-01 | A-11, A-12 |
| 4.2 | ANN-02 | 修改 | `apps/web/lib/annotation-repository.ts` | 确认现有 CRUD 满足需要 | — | — |
| 4.3 | ANN-03 | 修改 | `apps/web/features/editing/edit-message-form.tsx` | 视觉 token 化 | S0 | — |
| 4.4 | ANN-04 | 修改 | `apps/web/features/editing/version-history-panel.tsx` | 视觉 token 化 | S0 | — |
| 4.5 | ANN-05 | 修改 | `apps/web/features/sharing/share-panel.tsx` | 视觉 token 化；隐私预览清晰 | S0 | A-13 |
| 4.6 | ANN-06 | 修改 | `apps/web/features/sharing/share-readonly-reader.tsx` | 视觉 token 化（与主 Reader 一致简化） | S0 | A-13 |
| 4.7 | ANN-07 | 修改 | `apps/web/features/exporting/export-panel.tsx` | 视觉 token 化 | S0 | A-14 |
| 4.8 | ANN-08 | 修改 | `apps/web/features/import/import-panel.tsx` | 视觉 token 化 | S0 | — |
| 4.9 | ANN-09 | 修改 | `apps/web/features/import/import-preview-card.tsx` | 视觉 token 化 | S0 | — |
| 4.10 | ANN-10 | 修改 | `apps/web/features/search/conversation-search-panel.tsx` | 当前对话搜索含批注结果（本对话范围） | S0 | A-04 |

---

## S5 后端（搜索含批注）

| 顺序 | 任务 ID | 操作 | 文件路径 | 具体变更 | 前置依赖 | 验收项 |
|------|---------|------|---------|---------|---------|--------|
| 5.1 | BAK-01 | 修改 | `apps/api/app/api/routes/search.py` | SearchResultItem schema 扩展（加 annotation_id/annotation_type/annotation_color 可选字段）；search_documents 的 document_type='annotation' 行正常返回 | S3 | A-04 |
| 5.2 | BAK-02 | 修改 | `apps/api/app/services/search/search_service.py` | 查询逻辑兼容 annotation 结果（join conversation_annotations 获取额外字段）；当前 conversation_id/document_type 过滤无需改 | BAK-01 | — |
| 5.3 | BAK-03 | 新增 | `apps/api/app/services/search/annotation_indexer.py`（推荐）或在 `services/annotations.py` 内扩展 | 批注 CRUD 时同步创建/更新/删除 SearchDocument 行（document_type='annotation'，plain_text=comment text，conversation_id/message_id 同批注） | BAK-02 | — |
| 5.4 | BAK-04 | 修改 | `apps/api/app/schemas/search.py` | SearchResultItem 增加可选字段（annotation_id:UUID, annotation_type:str, annotation_color:str） | BAK-01 | — |
| 5.5 | BAK-05 | 修改 | `apps/web/features/search/search-page.tsx` | 前端分组展示 batch 结果（对话 vs 批注），批注项显示类型/颜色标记 | BAK-04 | A-04 |
| 5.6 | BAK-06 | 修改 | `apps/web/lib/offline-db.ts` | 离线包含批注 SearchDocument 时正常存储；确保 searchDocuments 的 Dexie store 索引支持 | — | — |

注：5.1~5.4 为后端改动，5.5~5.6 为前端对接。若后端改动范围扩大（如新增单独 annotation_search 表）则需重新评估。

---

## S6 移动端

| 顺序 | 任务 ID | 操作 | 文件路径 | 具体变更 | 前置依赖 | 验收项 |
|------|---------|------|---------|---------|---------|--------|
| 6.1 | MOB-01 | 修改 | `apps/web/app/page.tsx` | 移动端：首屏条件渲染继续阅读卡片（HOM-01 共用） | HOM-06 | A-17 |
| 6.2 | MOB-02 | 修改 | `apps/web/components/mobile-reader-sheet.tsx` | 极简顶栏（返回+标题+阅读导航+更多）；更多菜单 Sheet 含其余动作；Bottom Sheet 层级清晰；批注创建简化 | S0, RDR-01 | A-18, A-19 |
| 6.3 | MOB-03 | 核验 | `apps/web/features/conversations/use-mobile-header-auto-hide.ts` | 确认现有逻辑可用；如需要更新触发条件 | — | A-18 |
| 6.4 | MOB-04 | 修改 | `apps/web/features/projects/project-sidebar.tsx` | 移动端侧栏适配（与 NAV-01 共用） | NAV-01 | — |
| 6.5 | MOB-05 | 修改 | `apps/web/app/globals.css` | 移动端安全区（safe-area-inset-*）、小屏适配 | S0 | — |

---

## S7 离线/PWA

| 顺序 | 任务 ID | 操作 | 文件路径 | 具体变更 | 前置依赖 | 验收项 |
|------|---------|------|---------|---------|---------|--------|
| 7.1 | OFL-01 | 修改 | `apps/web/features/offline/library-shell.tsx` | 视觉 token 化；catalog/download/delete/space 状态优化；Dexie 版本升级提示 UI（"数据格式已更新，请重新下载"） | S0 | A-15 |
| 7.2 | OFL-02 | 核验 | `apps/web/app/library/page.tsx`, `layout.tsx` | 壳布局确认；视觉 token 化 | S0 | A-15 |
| 7.3 | OFL-03 | 调整 | `apps/web/public/library-sw.js` | 更新缓存资源列表；scope 保持 `/library`；revision 更新 | S0 | A-15 |
| 7.4 | OFL-04 | 修改 | `apps/web/features/conversations/conversation-reader.tsx` | 离线情景引导（一次性提示卡："下载后可离线阅读"，记忆已关闭） | RDR-01 | A-15 |
| 7.5 | OFL-05 | 修改 | `apps/web/components/preferences-panel.tsx` | 离线资料库入口 | NAV-06 | — |

---

## S8 状态/可访问性/收尾

| 顺序 | 任务 ID | 操作 | 文件路径 | 具体变更 | 前置依赖 | 验收项 |
|------|---------|------|---------|---------|---------|--------|
| 8.1 | FIN-01 | 修改 | 各页面/组件 | 统一应用状态组件规范（empty/error/offline/conflict/skeleton）至缺少状态的模块 | DS-04 | — |
| 8.2 | FIN-02 | 修改 | 全局 | 检查焦点序、aria 标签、对比度、reduced-motion、截图对比 | 全部 | — |
| 8.3 | FIN-03 | 修改 | `apps/web/e2e/library-offline.spec.ts` | 更新 SW/Dexie 变更后的 E2E | S7 | — |
| 8.4 | FIN-04 | 创建 | `apps/web/e2e/reader-layout.spec.ts`（新建） | Reader 布局/双 TOC/专注模式/批注浮窗/搜索定位/移动首页卡片的 Playwright 测试 | S3, S4, S6 | — |
| 8.5 | FIN-05 | 核验 | 全局 | 构建检查：`next build` + ESLint + tsc | 全部完成 | — |

---

## 任务统计

| 类型 | 数量 |
|------|------|
| 修改文件 | ~38 |
| 新建文件 | 3（annotation_indexer.py, reader-layout.e2e.ts, globals.css 新增块） |
| 删除文件 | 0 |
| 核验任务 | 5 |
| 无需修改系统 | .cr/offline package/Share token/DB/Alembic/Nginx |
| 总实施任务 | 约 46 |

## 第二轮执行结果（2026-07-27）

实际执行 HEAD：`175fae3914ad65a9682fa13303b64064507d498c`。Manifest 实际列出 63 个唯一任务 ID（原摘要“约 46”为计数差异，见 `docs/execution/DEVIATIONS.md`），均已完成或核验完成。没有创建 migration；后端搜索改造需要同时重建 API 与 import worker。详细记录见 `docs/execution/IMPLEMENTATION_LOG.md`。

## 最终缺项审计（2026-07-28）

重新从当前代码、API 测试、Playwright 和 Chrome 证据核对全部 63 个唯一任务 ID。旧实施日志不作为单独通过依据。按用户最新执行计划重新打开并完成：`NAV-01`、`RDR-08`、`S-03`、`S-04`、`A-03`、`A-04`、`FIN-05`。

- `NAV-01`：侧栏改为项目树与未归类对话同时可见，删除互斥标签；折叠 Project 仍可接收拖放。
- `RDR-08/S-03/S-04`：新增完整 reader-turn API，主/Share/Offline Reader 使用最多 3 个完整轮次，远距离导航和刷新恢复使用显式事务与真实 DOM 锚点。
- `A-03/A-04`：recent 上下文和批注目标链路有 API/专项 E2E/Chrome 证据。
- `FIN-05`：重新执行 lint、typecheck、API 150 tests、PWA、长对话专项连续 10 轮和 production build。
- 后续用户追加的离线更新审计：确认旧实现只在触发层筛选变化 conversation，但 package/范围更新仍可能全量；现已升级为 `known_revisions` 对比的 conversation-delta v2，未变化 conversation 不打包、不重写，v1 读取兼容。
- 最终离线一致性补充：Library 同步采用项目树 + 未归类单层侧栏，修复后续 revision 无法再次自动更新及 `last_read_at=null` 对话漏列；在线/离线共用不挤压列表的偏好弹层，入口在 Library 中反向返回在线版。

审计结果：63/63 已完成或核验，0 部分完成，0 未完成。最终部署证据见 `docs/execution/`。
