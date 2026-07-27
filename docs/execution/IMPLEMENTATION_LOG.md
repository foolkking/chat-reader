# 实施日志

状态说明：`完成`表示本轮有代码变更；`核验完成`表示现有实现已满足封板行为并完成回归。所有条目的规划一致性均为“是”，除 `DEVIATIONS.md` 记录的代码组织/命令差异外无产品偏差。

| 任务 ID | 状态 | 修改/核验文件 | 实际实现 | 测试 | 验收 ID | 备注 |
|---|---|---|---|---|---|---|
| DS-01 | 完成 | `globals.css` | 暖色 light/dark 与 `#10a37f` accent | lint/E2E/截图 | A-01 | CSS 变量优先 |
| DS-02 | 完成 | `globals.css` | shadow/radius/spacing/semantic tokens | lint | A-01 | 无 Tailwind 迁移 |
| DS-03 | 完成 | `globals.css`, `responsive-reader-frame.tsx` | Reader grid、focus 与间距 | E2E | A-06~A-09 | 保留双 TOC |
| DS-04 | 完成 | `globals.css` | button/input/card/state 工具类 | lint/截图 | A-01 | 含 focus/disabled/error/offline |
| NAV-01 | 完成 | `project-sidebar.tsx` | 最近、搜索、归档及 active 导航 | E2E | A-01 | 保留 Project 树 |
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
| RDR-03 | 核验完成 | `assistant-message-renderer.tsx` | Markdown/代码/表格/公式排版保留 | API/E2E | A-07 | 未改 lazy block |
| RDR-04 | 核验完成 | `conversation-index.tsx` | 对话 TOC 独立可见 | E2E | A-09 | navigation token 保留 |
| RDR-05 | 核验完成 | `conversation-toc.tsx` | 章节 TOC 独立可见 | E2E | A-09 | 分页语义保留 |
| RDR-06 | 完成 | `conversation-reader.tsx` | 桌面/移动操作入口完整 | E2E | A-10,A-18 | 移动不截断 action |
| RDR-07 | 完成 | `responsive-reader-frame.tsx` | `data-focus-mode` 传递 | E2E | A-08 | 不卸载 TOC 状态 |
| RDR-08 | 核验完成 | `reader-navigation.ts` | quote→offset→block→message 回退保留 | API tests | S-03~S-05 | 未改 transaction |
| RDR-09 | 核验完成 | `conversation-action-menu.tsx` | 消息操作与 annotation 入口保留 | lint | A-10 | token 全局生效 |
| ANN-01 | 完成 | `annotation-workspace.tsx` | 默认浮窗、固定覆盖左栏、恢复、移动选择 | E2E | A-11,A-12,A-19 | 未增加第四列 |
| ANN-02 | 完成 | `annotation-repository.ts` | CRUD 后离线索引同步 | API/PWA | S-07 | store 不变 |
| ANN-03 | 核验完成 | `edit-message-form.tsx` | 新版本编辑语义保留 | API tests | S-02 | token 全局生效 |
| ANN-04 | 核验完成 | `version-history-panel.tsx` | 版本恢复语义保留 | API tests | S-02 | 无 schema 变化 |
| ANN-05 | 核验完成 | `share-panel.tsx` | private 默认关闭及预览保留 | API tests | A-13,S-06 | token 全局生效 |
| ANN-06 | 核验完成 | `share-readonly-reader.tsx` | token 只读页保留 | API tests | A-13 | URL 语义不变 |
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
| MOB-03 | 核验完成 | `use-mobile-header-auto-hide.ts` | 现有滚动隐藏保留 | E2E | A-18 | 无改动必要 |
| MOB-04 | 完成 | `project-sidebar.tsx` | 移动导航映射含 recent | E2E | A-01,A-17 | 保留所有入口 |
| MOB-05 | 完成 | `globals.css` | safe-area、触摸和小屏约束 | E2E | A-18,A-19 | 390x844 无横滚 |
| OFL-01 | 完成 | `library-shell.tsx`, `offline-db.ts` | 离线状态与批注搜索 | PWA | A-15,A-16 | 不加清库提示 |
| OFL-02 | 核验完成 | `library/page.tsx`, `layout.tsx` | `/library` 独立 scope | PWA/build | A-15 | scope 不变 |
| OFL-03 | 核验完成 | `library-sw.js`, manifest | 内容哈希 revision 与暖色 manifest | PWA | A-15,A-16 | SW 协议未重写 |
| OFL-04 | 核验完成 | `conversation-reader.tsx` | 在线/离线 data source 引导保留 | PWA | A-15 | 包协议不变 |
| OFL-05 | 完成 | `preferences-panel.tsx` | 离线资料库入口 | lint | A-15 | `/library` |
| FIN-01 | 完成 | 全局 tokens/各页面 | loading/empty/error/offline/conflict 状态核验 | E2E/截图 | A-01~A-19 | 现有领域状态保留 |
| FIN-02 | 完成 | `globals.css`, interactive controls | focus、reduced motion、safe area | lint/E2E | A-01~A-19 | aria 名称保留 |
| FIN-03 | 核验完成 | `library-offline.spec.ts` | 旧 active 壳、staging、冷启动回归 | Playwright 5/5 | A-15,A-16 | Dexie 数据不清理 |
| FIN-04 | 完成 | `reader-layout.spec.ts` | 导航、Reader 折叠态 Ctrl+K、搜索、双 TOC、批注模式、移动截图 | Playwright 3/3 | A-01,A-04,A-06~A-12,A-18 | 合成 fixture |
| FIN-05 | 完成 | 全局 | lint、tsc、pytest、build、Playwright/PWA、Chrome 点击复审 | 全量命令 8/8 | 全部 | 结果见 TEST_RESULTS |

## 汇总

- Manifest 唯一任务 ID：63（规划摘要写“约 46”，见 DEV-001）。
- 完成：37。
- 核验完成：26。
- 部分完成：0。
- 未完成：0。
- 产品行为偏差：0。
