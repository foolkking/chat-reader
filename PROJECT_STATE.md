# 项目当前状态

更新日期：2026-07-12。

本文是后续开发者和 AI 的当前实现快照。功能事实以代码、Alembic migration 和自动化测试为最终依据。

## 当前基线

- Web：Next.js 14 App Router，浏览器使用相对 `/api/*`，Next.js 服务端通过 `API_INTERNAL_URL` 转发到 FastAPI。
- API：FastAPI + SQLAlchemy 2，数据库为 PostgreSQL，当前 migration head 为 `20260707_0005`。
- 最近完整后端测试基线：116 tests passed；前端 typecheck、lint 和 production build 已通过。
- 生产部署文件已包含 PostgreSQL、migration、API、Web、Nginx 示例和数据库备份脚本。

## 已实现

### 导入与 canonical 数据

- 导入预览、warning、raw source artifact 保存和 commit 流程。
- ChatGPT Exporter JSON、Markdown 及组合导入。
- 官方 conversations JSON primary path 导入；源节点引用仍被保留，但 UI 不展示分支切换。
- 消息、不可变 MessageVersion、RenderBlock、Heading 和 SearchDocument 持久化。
- assistant 开头明显的 exporter thinking summary 在导入时清理；历史内容有前端折叠兜底。

### 阅读与导航

- user/assistant Markdown 安全渲染，支持 GFM、Shiki、KaTeX、Mermaid 和 callout。
- 消息窗口加载和 heavy message blocks 按需加载。
- 左侧对话索引按 `U#`、`A#` 编号，右侧 TOC 默认绑定 active message。
- 未挂载 message/block 可通过 anchor window 加载后定位；移动 sheet 和只读分享页复用可靠导航。
- 移动端消息使用全宽阅读布局，代码、表格和图表在自身容器滚动。

### 管理、搜索和分享

- Project 创建/重命名/归档、会话加入/移动/移出和 Project 内置顶。
- 会话重命名、全局置顶、归档、软删除和批量操作。
- 消息拆分/合并；会话拆分和按明确顺序进行非破坏式合并。
- 消息编辑、版本历史和通过新版本恢复。
- PostgreSQL full-text 与 substring 混合搜索，支持 conversation/project/document type 过滤和分页。
- 分享链接创建、列表、标题/描述/有效期更新、撤销和只读访问。
- Markdown 和 Canonical JSON 导出。
- 阅读位置、最近打开和 PWA-ready 壳。

## 明确未实现

- 认证、多用户、角色权限和租户隔离。
- TanStack Virtual 等真正的消息虚拟滚动；当前是窗口加载和 DOM 增量渲染。
- HTML/PDF/Project 打包导出。
- Tag、Bookmark、笔记系统和语义/向量搜索。
- Job Worker、批量 blocks API 和持久化后台任务队列。
- 通用 UndoToast；部分操作可通过现有 restore/archive API恢复。
- 在线聊天、SSE streaming、重新生成、工具调用持久化和回答分支 UI。
- 私有会话离线缓存；service worker 不缓存 `/api/*` 或会话正文。

## 关键约束

- 前端只渲染 canonical 当前版本和 RenderBlock，不渲染 raw source artifact。
- 不使用 `dangerouslySetInnerHTML` 执行导入内容；原始 HTML 被禁用或清理。
- 编辑和恢复创建新 MessageVersion，不覆盖历史版本。
- 会话级 merge/split 复制当前 canonical 内容，源会话保持不变。
- 生产环境必须设置强数据库密码、准确的 `PUBLIC_WEB_BASE_URL`，并在公网入口增加 HTTPS 和访问控制。

## 下一优先级

1. 认证与多用户数据隔离。
2. 大规模会话的真正虚拟滚动和性能预算回归。
3. 附件、citation、tool result 的后端结构化持久化。
4. HTML 导出、备份恢复演练和生产监控。

文档导航见 [docs/index.md](docs/index.md)。
