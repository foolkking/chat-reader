# 实施日志

状态说明：`完成`表示本轮有代码变更；`核验完成`表示现有实现已满足封板行为并完成回归。所有条目的规划一致性均为“是”，除 `DEVIATIONS.md` 记录的代码组织/命令差异外无产品偏差。

| 任务 ID | 状态 | 修改/核验文件 | 实际实现 | 测试 | 验收 ID | 备注 |
|---|---|---|---|---|---|---|
| DS-01 | 完成 | `globals.css` | 暖色 light/dark 与 `#10a37f` accent | lint/E2E/截图 | A-01 | CSS 变量优先 |
| DS-02 | 完成 | `globals.css` | shadow/radius/spacing/semantic tokens | lint | A-01 | 无 Tailwind 迁移 |
| DS-03 | 完成 | `globals.css`, `responsive-reader-frame.tsx` | Reader grid、focus 与间距 | E2E | A-06~A-09 | 保留双 TOC |
| DS-04 | 完成 | `globals.css` | button/input/card/state 工具类 | lint/截图 | A-01 | 含 focus/disabled/error/offline |
| NAV-01 | 完成 | `project-sidebar.tsx` | 最近、搜索、归档、Project 树和未归类对话单层同时显示；双向拖放 | Chrome/E2E/API | A-01,A-12 | 删除互斥标签；折叠 Project 仍是 drop target |
| NAV-02 | 完成 | `app-shell.tsx` | 壳背景与移动 Continue Reading | E2E | A-01 | 复用现有壳 |
| NAV-03 | 完成 | `shortcut-manager.tsx`, `project-sidebar.tsx` | Cmd/Ctrl+K 事件；Reader 折叠态先展开侧栏再稳定聚焦 | Chrome/E2E | A-01,A-04 | 输入控件内不抢占；消除挂载焦点竞态 |
| NAV-04 | 完成 | `sidebar-search.tsx` | 快捷聚焦与批注精准跳转 | Chrome/E2E/API | A-04 | 携带 block/offset/id |
| NAV-05 | 核验完成 | `search-box.tsx` | 保留页面搜索键盘行为 | lint/E2E | A-04 | 无重复组件 |
| NAV-06 | 完成 | `preferences-panel.tsx` | Library 入口 | lint | A-08,A-15 | focus 模式在 Reader 保存 |
| NAV-07 | 核验完成 | `preferences-provider.tsx` | 现有 localStorage 偏好语义保留 | typecheck | A-08 | 未改 schema |
| HOM-01 | 完成 | `app-shell.tsx`, `page.tsx` | 首页总览与移动继续阅读 | E2E/截图 | A-01,A-17 | 条件显示 |
| HOM-02 | 核验完成 | `conversation-list.tsx` | 现有时间/选择/排序状态保留 | E2E | A-01 | token 全局生效 |
| HOM-03 | 核验完成 | `archived/page.tsx` | 真实 archived 路由与空状态 | build | A-02 | 未创建重复列表 |
| HOM-04 | 核验完成 | `app-shell.tsx` | `mode=archived` 继续工作 | build | A-02 | 路径与规划一致 |
| HOM-05 | 完成 | `recent/page.tsx`, `recent-items.tsx` | 正式最近页与恢复目标 | E2E | A-03 | 使用真实 context 字段 |
| HOM-06 | 完成 | `recent-items.tsx` | 时间、进度、message/block/offset 卡片 | E2E | A-03,A-17 | 不伪造进度 |
| HOM-07 | 完成 | `search-page.tsx` | 搜索分类、筛选和状态 | E2E/API | A-04 | 批注单独分组 |
| HOM-08 | 完成 | `search-results.tsx` | 高亮、类型/颜色、精准定位 | E2E/API | A-04 | annotation 打开面板 |
| HOM-09 | 核验完成 | `projects/[projectId]/page.tsx` | Project 详情路由保留 | build | A-05 | token 全局生效 |
| HOM-10 | 核验完成 | `project-conversation-list.tsx` | 排序、选择、拖动保留 | API/E2E | A-05 | 无数据语义变化 |
| HOM-11 | 核验完成 | `selection-toolbar.tsx` | 批量工具栏状态保留 | lint | A-05 | token 全局生效 |
| HOM-12 | 核验完成 | `sort-menu.tsx` | 排序菜单保留 | lint | A-05 | token 全局生效 |
| RDR-01 | 完成 | `conversation-reader.tsx` | focus、操作分级、批注协调 | E2E | A-06~A-12 | 保存阅读状态 |
| RDR-02 | 完成 | `message-item.tsx` | user/assistant 全部左对齐及层级 | E2E/截图 | A-07 | 固定布局宽度 |
| RDR-03 | 完成 | `assistant-message-renderer.tsx`, `message-item.tsx` | Markdown/代码/表格/公式排版保留；消息只渲染完整 blocks | API/E2E | A-07 | 删除 heavy 占位和 block 分页路径 |
| RDR-04 | 核验完成 | `conversation-index.tsx` | 对话 TOC 独立可见 | E2E | A-09 | navigation token 保留 |
| RDR-05 | 核验完成 | `conversation-toc.tsx` | 章节 TOC 独立可见 | E2E | A-09 | 分页语义保留 |
| RDR-06 | 完成 | `conversation-reader.tsx` | 桌面/移动操作入口完整 | E2E | A-10,A-18 | 移动不截断 action |
| RDR-07 | 完成 | `responsive-reader-frame.tsx` | `data-focus-mode` 传递 | E2E | A-08 | 不卸载 TOC 状态 |
| RDR-08 | 完成 | `conversation-reader.tsx`, `reader-navigation.ts`, `reader_turns.py`, `reader-data-source.ts` | 完整轮次导航事务；quote→offset→block→message；媒体解码、ResizeObserver 稳定和 24px 复校 | API/E2E/Chrome | S-03~S-05 | 取消固定 10 秒锁和 preview 二次跳转 |
| RDR-09 | 核验完成 | `conversation-action-menu.tsx` | 消息操作与 annotation 入口保留 | lint | A-10 | token 全局生效 |
| ANN-01 | 完成 | `annotation-workspace.tsx` | 默认浮窗、固定覆盖左栏、恢复、移动选择 | E2E | A-11,A-12,A-19 | 未增加第四列 |
| ANN-02 | 完成 | `annotation-repository.ts` | CRUD 后离线索引同步 | API/PWA | S-07 | store 不变 |
| ANN-03 | 核验完成 | `edit-message-form.tsx` | 新版本编辑语义保留 | API tests | S-02 | token 全局生效 |
| ANN-04 | 核验完成 | `version-history-panel.tsx` | 版本恢复语义保留 | API tests | S-02 | 无 schema 变化 |
| ANN-05 | 核验完成 | `share-panel.tsx` | private 默认关闭及预览保留 | API tests | A-13,S-06 | token 全局生效 |
| ANN-06 | 完成 | `share-readonly-reader.tsx`, `share_service.py` | token/scope 只读完整轮次窗口与位置恢复 | API/E2E | A-13,S-06 | URL 和隐私语义不变 |
| ANN-07 | 核验完成 | `export-panel.tsx` | MD/JSON/.cr、进度和失败保留 | API tests | A-14 | `.cr` 不变 |
| ANN-08 | 核验完成 | `import-panel.tsx` | preview/commit/task 状态保留 | API tests | S-01 | token 全局生效 |
| ANN-09 | 核验完成 | `import-preview-card.tsx` | warning/preview 保留 | API tests | S-01 | token 全局生效 |
| ANN-10 | 完成 | `conversation-search-panel.tsx` | 当前正文+当前批注分类结果 | E2E/API | A-04 | conversation_id 强制范围 |
| BAK-01 | 完成 | `routes/search.py` | annotation 类型与字段返回 | pytest | A-04 | API 扩展兼容 |
| BAK-02 | 完成 | `search_service.py` | 批注查询、block/offset 解析与范围 | pytest | A-04 | 非 annotation 回归通过 |
| BAK-03 | 完成 | `annotation_indexer.py`, `annotations.py` | CRUD/冲突/重定位同步及稳定 UUID | pytest | A-04,S-05 | 无 migration |
| BAK-04 | 完成 | `schemas/search.py` | annotation 与定位可选字段 | pytest | A-04 | 旧客户端兼容 |
| BAK-05 | 完成 | Web search files | 分类展示与批注跳转 | E2E | A-04 | 查询由 URL 保留 |
| BAK-06 | 完成 | `offline-db.ts`, `reader-data-source.ts` | 现有 store 写入 annotation 搜索记录 | PWA/typecheck | A-15,S-07 | Dexie version 1 |
| MOB-01 | 完成 | `app-shell.tsx`, `recent-items.tsx` | 移动继续阅读 | E2E | A-17 | 真实 progress 条件渲染 |
| MOB-02 | 完成 | `conversation-reader.tsx`, `annotation-workspace.tsx` | 操作、TOC、搜索与轻量批注 | E2E | A-18,A-19 | dock 仅桌面 |
| MOB-03 | 完成 | `use-mobile-header-auto-hide.ts`, `conversation-reader.tsx` | 滚动隐藏保留；正文挂载后只由 wheel/touch/pointer drag/阅读键建立用户意图 | E2E/Chrome | A-18,S-04 | 修复 loading shell 漏绑、程序滚动误判及恢复降级循环重启 |
| MOB-04 | 完成 | `project-sidebar.tsx` | 移动导航映射含 recent | E2E | A-01,A-17 | 保留所有入口 |
| MOB-05 | 完成 | `globals.css` | safe-area、触摸和小屏约束 | E2E | A-18,A-19 | 390x844 无横滚 |
| OFL-01 | 完成 | `library-shell.tsx`, `offline-db.ts`, `offline_packages.py`, `routes/offline.py` | 离线状态、批注搜索；本地 revision 对比在线 catalog 的 conversation 增量包；自动更新可随新 revision 再次触发 | API/PWA/typecheck/Chrome | A-15,A-16 | v2 写入、v1/v2 读取；完整读取含 `last_read_at=null` 的本地对话；不升级 Dexie |
| OFL-02 | 核验完成 | `library/page.tsx`, `layout.tsx` | `/library` 独立 scope | PWA/build | A-15 | scope 不变 |
| OFL-03 | 核验完成 | `library-sw.js`, manifest | 内容哈希 revision 与暖色 manifest | PWA | A-15,A-16 | SW 协议未重写 |
| OFL-04 | 完成 | `conversation-reader.tsx`, `offline-db.ts` | 在线/离线 data source 引导保留；v2 空增量与变化 conversation 原子导入 | API/PWA | A-15 | 失败保留旧本地副本 |
| OFL-05 | 完成 | `preferences-panel.tsx`, `sidebar-preferences.tsx`, `library-shell.tsx` | 在线/离线共用紧凑偏好弹层；在线进入 Library，离线返回在线版 | lint/PWA/Chrome | A-15 | 绝对定位弹层不压缩列表 |
| FIN-01 | 完成 | 全局 tokens/各页面 | loading/empty/error/offline/conflict 状态核验 | E2E/截图 | A-01~A-19 | 现有领域状态保留 |
| FIN-02 | 完成 | `globals.css`, interactive controls | focus、reduced motion、safe area | lint/E2E | A-01~A-19 | aria 名称保留 |
| FIN-03 | 核验完成 | `library-offline.spec.ts` | 旧 active 壳、staging、冷启动、统一侧栏与紧凑偏好回归 | Playwright 6/6 | A-15,A-16 | Dexie 数据不清理 |
| FIN-04 | 完成 | `reader-layout.spec.ts`, `reader-restoration.spec.ts` | 导航/布局/移动截图 + 100 条长对话远距离批注、刷新恢复、跨轮次 DOM 上限 | Playwright | A-01,A-04,A-06~A-12,A-18,S-03,S-04 | 合成 fixture，无生产正文 |
| FIN-05 | 完成 | 全局 | lint、tsc、pytest、build、PWA、长对话专项和 Chrome 点击复审 | 全量命令通过 | 全部 | 2026-07-28 结果见 TEST_RESULTS |

## 汇总

- Manifest 唯一任务 ID：63（规划摘要写“约 46”，见 DEV-001）。
- 完成：37。
- 核验完成：26。
- 部分完成：0。
- 未完成：0。
- 产品行为偏差：0。

## 2026-07-28 重新审计

| 阶段 | 任务数 | 重新核验证据 | 结果 |
|---|---:|---|---|
| S0 设计系统 | 4 | CSS 扫描、lint、build、既有截图 | 4/4 |
| S1 导航 | 7 | 源码、Chrome 单层侧栏与菜单 | 7/7 |
| S2 页面 | 12 | API 全量、build、recent/search 回归 | 12/12 |
| S3 Reader | 9 | reader-turn API、专项 E2E、Chrome | 9/9 |
| S4 工具/批注 | 10 | API、PWA、Chrome 批注定位 | 10/10 |
| S5 搜索后端 | 6 | API 150 tests、批注索引测试 | 6/6 |
| S6 移动端 | 5 | 390x844 Playwright、Chrome 移动断点 | 5/5 |
| S7 Offline/PWA | 5 | Playwright 5/5、Dexie schema 未变 | 5/5 |
| S8 收尾 | 5 | lint/typecheck/build/pytest/Playwright | 5/5 |

总计 63/63；重新打开项 `RDR-08`、`S-03`、`S-04`、`A-03`、`A-04`、`NAV-01`、`FIN-05` 均已关闭。

Reader 的最终压力复验为长对话专项连续 10/10。边缘事务只在会话代次变化或真实输入反向时取消，等待新增消息挂载后再补偿锚点；真实用户滚动会递增 reading restore token，防止失败候选继续启动下一次自动定位。

## 2026-07-28 离线增量追加审计

旧实现会在页面自动刷新时找出 revision 变化的 conversation，但 conversation/project/all package 本身不知道浏览器已安装版本；项目或全库更新会重复传输未变化数据，变化 conversation 也会整包原子替换。最终实现保留原子替换作为一致性边界，并把增量判断下沉到 API/worker：

- 客户端按请求 scope 提交 `known_revisions`。
- worker 只序列化新增或 revision 不同的 conversation；全未变化时生成合法空增量。
- v2 package 明示 `update_mode=conversation-delta` 和 base revisions。
- Dexie 只删除/重写包内变化 conversation，其他本地数据不动；v1 全量包仍兼容。
- PostgreSQL 与 Dexie schema 均未变化。

## 2026-07-28 离线 UI 与自动同步补充审计

- 删除 Library 的“对话/项目”互斥标签，改为与在线一致的项目树和未归类“全部对话”同时显示；项目内对话不在未归类列表重复。
- 修复 `refreshStartedRef` 只允许一次自动更新的问题：按远端 revision 组合键去重，新 revision 到达时可再次增量更新；同一时间只运行一个自动更新事务。
- 修复 Dexie `orderBy("last_read_at")` 漏掉 `null` 索引值的问题：读取全部 conversation，再按 `last_read_at ?? downloaded_at` 排序，已下载但未阅读对话不再消失。
- 在线与离线共用 `SidebarPreferences`。弹层绝对定位、可用 Escape/外部点击关闭，打开前后 footer 高度不变；Library 模式入口反向为当前对话的在线 URL。
- 最终 PWA 6/6、本地 Chrome 和 King Chrome 均通过；63 个原 Manifest 任务仍为 63/63，无重新打开项。

## 2026-07-28 视觉与操作体验收尾

| 项目 | 状态 | 实现与验收 |
|---|---|---|
| UX-01 统一工具抽屉 | 完成 | 搜索、分享、导出复用 `ReaderUtilityDrawer`，统一关闭、Esc、焦点恢复和视口宽度纠偏；分享私人内容控件在 1280x720 与 1830x823 完整可操作 |
| UX-02 专注阅读 | 完成 | 一键隐藏主侧栏、索引、目录和普通工具；进入/退出用真实 block 锚点保持阅读线；当前状态与默认启动偏好分离 |
| UX-03 搜索与批注 | 完成 | 当前对话搜索增加两个稳定筛选、结果数和安全高亮；批注浮窗自动纠偏并支持重置位置；相关状态完成中英文双语化 |
| UX-04 阅读预设 | 完成 | 增加紧凑、舒适、大字三档；在线与离线共享；API 偏好字段及 Alembic migration `20260728_0015` 已落地 |
| UX-05 单层侧栏与紧凑设置 | 完成 | 在线历史列表统一为“未归类”；Library 同步项目/未归类结构；偏好弹层默认只显示高频项，更多设置每次打开折叠 |
| UX-06 离线增量表达 | 完成 | 同步按钮显示变化对话数与体积，无变化时明确提示已是最新；实际请求继续使用 revision 增量协议 |
| UX-07 文案与状态 | 完成 | 最近、归档、Reader、批注、分享、导出、导入及 Library 的中英混排已修正；导入弹窗保留单一标题和两步流程 |

本轮没有改动对话、批注、阅读位置或 Dexie schema。新增的 PostgreSQL 偏好列对旧客户端向后兼容，缺失值按 `comfortable` 处理。

## 2026-07-28 批量管理、Markdown 排版与批注阅读收尾

| 项目 | 状态 | 实现与验收 |
|---|---|---|
| UX-08 Linear 式批量管理 | 完成 | 项目、未归类、项目内、归档对话和归档项目共用选择控制器；支持悬停复选框、Shift 范围、X、Ctrl/Cmd+A、Escape、移动端长按及单一底部工具栏；并发批处理保留失败项选择 |
| UX-09 桌面最近入口 | 完成 | 桌面隐藏侧栏入口和首页卡片；移动端入口与 `/recent` 路由保留 |
| UX-10 Markdown 排版与字号 | 完成 | 三档间距作用到段落、标题、列表、引用、代码、表格、KaTeX/Mermaid 和 render block；字号 15-22px，默认 17；密度与字号分别持久化 |
| UX-11 批注阅读层 | 完成 | 浮窗可展开全屏；全部批注/精选笔记、连续/逐条模式、URL/浏览器返回同步、标题编辑、排序、Markdown 说明和移除引用均已接入现有 notebook 数据 |
| UX-12 在线/离线一致性 | 完成 | Library 行移除可见日期，离线 TOC 优先 `content_preview`；离线更多菜单移除在线入口；Reader 导出入口改用 `FileOutput` |
| UX-13 发布 | 完成 | API/Web 已部署，migration 0016 生效；生产 Chrome 已完成全量点击复验。复验发现的离线 TOC 时间戳已由 `reader-data-source.ts` 修复并通过 Web 补丁重新发布，离线/在线正文与索引最终一致 |

本轮新增 PostgreSQL 偏好列，不升级 Dexie schema，不新增批量 API，也不修改 annotation/notebook/conversation/reading-position 数据结构。

## 2026-07-30 Mobile and Export Closeout

- Added a shared `MobilePageHeader` and `MobileSidebarTrigger` to the home, archive, search, recent, project, offline, loading, and Reader surfaces.
- Mobile Reader header visibility now ignores programmatic scrolling, hides only after real downward intent, and shows on the first upward intent; tests wait for navigation settlement before asserting gesture behavior.
- Mobile sort uses a viewport-safe bottom sheet. Its `<details>` state is controlled and explicitly cleared on mount so Chrome form-state restoration cannot reopen it after refresh.
- Bulk selection uses an explicit zero-selection mode, persistent row checkboxes, and a sticky toolbar above list rows across conversation, project, and archive views.
- Canonical JSON is available in compact/mobile export UI. The API exports it with batched database reads and 64 KiB buffered JSON streaming, avoiding the former 628 MiB OOM and micro-chunk throughput bottleneck.
- King deployment rebuilt API, import worker, and Web after an 80.4 MB PostgreSQL dump and source/storage backup. Production Chrome and direct HTTP checks passed.
- Removed rollback/old Chat Reader images, all Docker build cache, and superseded Chat Reader backups. Retained the latest database dump and the current source rollback archive.

## 2026-07-31 Hybrid Virtualization Overlap Fix

- Replaced absolutely positioned virtual Markdown rows with normal-flow rows separated by measured leading, inter-row, and trailing spacers. A stale estimate can now change only empty space; it cannot place two mounted text blocks on top of each other.
- Limited full virtualizer resets to actual layout-signature changes. The signature includes resolved reader width, `15-22px` font size, line height, Markdown paragraph/heading/list/block spacing, and the reader width preset.
- Re-measure mounted rows for two animation frames after a layout reset and use TanStack Virtual's normal above-viewport anchor compensation instead of compensating every size change.
- Extended the long-reader regression to switch between `22px + loose + narrow` and `15px + compact + wide`, then verify every mounted virtual row remains ordered and non-overlapping.
- Published Web image `de131dd06dac8bdf8dac7b10bd0497e3257948361a2e45e9ad3aa876b1b1bc96`. API, worker, database schema, canonical data, and offline package contracts were unchanged.
- After production verification, removed superseded Chat Reader images and the failed Web candidate, and reduced Docker build cache from about 2.65 GB to 0 B.

## 2026-08-06 Attachment Preview and Export Options Increment

- Moved attachment preview into a `document.body` portal so it covers the complete page and is not clipped by Reader layout containers.
- Rendered images, text/Markdown/JSON/CSV/code, and browser-native media as lightweight Reader content; large images use a constrained lazy view and open the original object in the page-level dialog.
- Restored description, annotations, notebook, and source-reference controls as secondary export options. Streaming files and background attachment ZIPs now share the same `ExportOptions` values.
- Disabled content secret scanning and sensitive-file export exclusion under the current product policy. Scanner capability/status remains explicit and King continues to report `scanner_disabled`.
- Added persistent close controls for stale failed task cards and fixed message version selection to return persisted render blocks immediately.
- Deployed incrementally to King and verified the new UI with Chrome. Acceptance conversations were removed; the synthetic DnD project was archived.
- The King Web build caused a PostgreSQL checkpointer OOM despite pausing the worker. WAL recovery completed and the post-recovery custom dump passed `pg_restore -l`; future King releases must use externally built Linux images.

## 2026-08-02 Markdown Rhythm, Annotation, and Layout Anchor Closeout

- Unified compact, comfortable, and loose Markdown rhythm through Reader CSS variables and a single `BlockSlot`; message spacing and reader width remain independent.
- Preserved ordered-list `start` values and rendered heading inline Markdown safely while sharing plain heading cleanup with the Reader TOC.
- Registered mounted blocks at Reader scope so annotation ranges and color tokens survive virtual block unmount/remount cycles.
- Removed virtualizer-owned target centering. Navigation keeps a measured block lease and only the Reader transaction aligns the final text range to the 120px reading line.
- Added preference-layout transactions for density, font size, and width changes. A real block anchor is captured before the change, virtual automatic compensation is suspended, and the anchor is restored after layout settles.
- Local Playwright and Chrome regression passed for extreme layouts, rapid preference changes, focus mode, mobile header visibility, and horizontal overflow. This release changes Web only.
