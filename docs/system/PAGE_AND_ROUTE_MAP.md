# 页面与路由地图

最后核验日期：2026-07-26

## 页面层级

```text
Chat Reader
├── 在线管理壳 /
│   ├── 全部对话流
│   ├── Project 树
│   ├── 导入、搜索、任务和偏好覆盖层
│   ├── Project 详情 /projects/[projectId]
│   ├── 归档 /archived
│   └── 最近 /recent
├── 全局搜索 /search
├── 对话阅读 /conversations/[conversationId]
│   ├── 对话 TOC / 章节 TOC
│   ├── 当前对话搜索
│   ├── 批注与精选笔记
│   ├── Share / Export 面板
│   └── canonical 编辑与版本覆盖层
├── 只读分享 /share/[token]
├── 离线资料库 /library
│   ├── 下载与本地存储管理
│   └── 共享阅读器框架的离线阅读
└── 连接失败 /offline
```

## 页面路由

| 页面 | 路由 | 登录 | 访问身份 | 入口 | 主要内容/操作 | 对应代码 | 线上状态 | 截图 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 在线首页 | `/` | 不需要；当前无登录机制 | 本地资料拥有者 | 域名根路径 | 对话/Project 侧栏、活跃对话列表、导入、排序、选择管理 | `apps/web/app/page.tsx`, `features/projects/project-sidebar.tsx`, `components/app-shell.tsx` | 可访问 | `PAGE-001`, `PAGE-012/013` |
| 归档 | `/archived` | 不需要 | 本地资料拥有者 | 侧栏“已归档” | 已归档对话/Project、选择、恢复、删除 | `apps/web/app/archived/page.tsx`, `features/conversations/archived-conversation-list.tsx` | 可访问 | `PAGE-005`, `STATE-001` |
| 最近 | `/recent` | 不需要 | 本地资料拥有者 | 未发现当前侧栏入口；可直接访问 | 最近打开的 Conversation/Project/Message | `apps/web/app/recent/page.tsx`, `features/reading/recent-items.tsx` | HTTP 200；未做数据操作 | 无 |
| 全局搜索 | `/search` | 不需要 | 本地资料拥有者 | 侧栏搜索 | 关键词、状态、文档类型、角色、Project、日期筛选 | `apps/web/app/search/page.tsx`, `features/search/search-page.tsx` | 可访问，空结果已验证 | `PAGE-006` |
| Project 详情 | `/projects/[projectId]` | 不需要 | 本地资料拥有者 | Project 树 | Project 对话列表、选择与批量操作 | `apps/web/app/projects/[projectId]/page.tsx`, `features/projects/project-conversation-list.tsx` | 可访问 | `PAGE-004` |
| 对话阅读器 | `/conversations/[conversationId]` | 不需要 | 本地资料拥有者 | 任一对话行/搜索结果 | 阅读、TOC、搜索、批注、分享、导出、管理 | `apps/web/app/conversations/[conversationId]/page.tsx`, `features/conversations/conversation-reader.tsx` | 可访问 | `PAGE-007/008/009`, `STATE-002/003/005`, `PAGE-014/015` |
| 只读分享 | `/share/[token]` | 不需要账号；需要有效 token | Share 访客 | 分享 URL | 受 scope/options 限制的只读内容与可选导出 | `apps/web/app/share/[token]/page.tsx`, `features/sharing/share-readonly-reader.tsx` | 代码链路确认；有效 token 页面未截图 | 无 |
| 离线资料库 | `/library` | 不需要 | 本地资料拥有者 | 在线 reader“离线资料库”或直接/PWA 启动 | catalog、下载、删除本地副本、离线搜索和阅读 | `apps/web/app/library/page.tsx`, `features/offline/library-shell.tsx` | 可访问 | `PAGE-010/011/016` |
| 连接失败页 | `/offline` | 不需要 | 任意 | 直接访问；不是 library SW 的导航 fallback | 网络检查文案和重试 | `apps/web/app/offline/page.tsx` | 可访问 | `STATE-004` |

另有 Next.js Route Handler `POST /api/imports/[importId]/commit`，位于 `apps/web/app/api/imports/[importId]/commit/route.ts`，用于转发导入提交；其余 `/api/*` 由 `next.config.mjs` rewrite 到 FastAPI。

## 框架状态页面

| 类型 | 位置 | 实现/表现 | 状态 |
| --- | --- | --- | --- |
| 全局加载 | `apps/web/app/loading.tsx` | Next App Router loading UI | 已确认（代码） |
| 对话加载/不可用 | `conversation-reader.tsx` | 查询期间加载；无效 ID 显示“对话暂时不可用” | 已确认，见 `STATE-005` |
| 搜索空状态 | `/search` | 无匹配结果提示 | 已确认，见 `PAGE-006` |
| 归档空/列表状态 | `/archived` | 根据数据渲染列表或空状态 | 部分确认；列表页已验证 |
| 资料未下载 | `/library?conversationId=...` | 在线可引导下载，离线说明尚未下载 | 已确认（代码），生产未制造该状态 |
| PWA 壳错误 | `/library` | `unsupported/preparing/ready/error` 与重试 | 已确认（代码），未制造 staging 失败 |
| Not Found | Next 默认 | 仓库没有自定义 `not-found.tsx` | 已确认（代码搜索） |
| 权限不足 | 不适用 | 当前没有账号/角色权限页面 | 已确认当前边界 |

## 重要覆盖层与面板

| 覆盖层 | 触发入口 | 桌面 | 移动 | 代码 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 导入对话框 | 侧栏“导入数据” | 模态框 | 响应式模态 | `components/import-dialog.tsx`, `features/import/*` | `PAGE-002` |
| 外观与语言 | 侧栏底部设置 | 弹出面板 | 响应式面板 | `components/preferences-panel.tsx` | `PAGE-003` |
| Reader 操作轨 | 右上角更多 | 固定动作区 | 触发点固定，动作在左侧展开 | `components/reader-header-action-rail.tsx` | `STATE-003` |
| 阅读导航 | Reader 顶栏 | 可调宽右侧 dock | Bottom Sheet | `conversation-reader.tsx`, `toc/*` | `PAGE-015` |
| 章节 TOC | Reader 右侧 | visible/rail，可调宽 | 导航 Sheet 内 | `features/toc/conversation-toc.tsx` | `PAGE-007/011/015` |
| 批注工作区 | Reader 更多 | 可拖动/缩放浮窗 | 只读 Bottom Sheet | `features/annotations/annotation-workspace.tsx` | `PAGE-008`, `STATE-002` |
| Share/Export/Search | Reader 更多 | 可调宽 dock | Bottom Sheet | `features/sharing`, `features/exporting`, `features/search` | `PAGE-009` |
| 消息编辑/版本 | 消息菜单 | 对话框/面板 | 响应式 | `features/editing/*` | 代码确认；未修改生产数据 |

## 跳转关系

- 对话、Project 和搜索结果进入 `/conversations/[id]`；搜索结果附带 `messageId/blockIndex/characterOffset`。
- 在线 Reader 进入 `/library` 时传递当前 conversation/message/block/offset；离线 Reader 联网时可返回 `/conversations/[id]` 并传递同一定位上下文。
- Share 创建返回 `/share/[token]`；公开页不会进入 canonical 管理操作。
- 对话 TOC、章节 TOC、搜索和批注复用 Reader 的目标导航事务，而不是独立页面。

## 外部链接

正文安全链接可打开外部 URL；代码通过 Markdown 渲染与 sanitize 规则处理。仓库未发现独立帮助中心、支付、账号或管理站点链接。

## 2026-07-27 路由更新

`/recent` 已为正式侧栏入口。`/search` 支持 annotation 分组及带 `messageId/blockIndex/characterOffset/annotations/annotationId` 的 Reader 定位。`/library` 继续为独立离线 scope。截图证据位于 `docs/execution/screenshots/`。
