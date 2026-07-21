# 项目当前状态

更新日期：2026-07-21。

本文是后续开发者和 AI 的当前实现快照。功能事实以代码、Alembic migration 和自动化测试为最终依据。

## 当前基线

- Web：Next.js 14 App Router，浏览器使用相对 `/api/*`，Next.js 服务端通过 `API_INTERNAL_URL` 转发到 FastAPI。
- API：FastAPI + SQLAlchemy 2，数据库为 PostgreSQL，当前 migration head 为 `20260721_0013`。
- 最近聚焦后端测试、前端 typecheck 和 lint 已通过；最终完整测试基线以本次提交验证结果为准。
- 生产部署文件已包含 PostgreSQL、migration、API、单并发 task worker、Web、Nginx 示例和数据库备份脚本。

## 已实现

### 导入与 canonical 数据

- 导入预览、warning、raw source artifact 保存、持久化队列、阶段进度、失败重试和自动发布。
- ChatGPT Exporter JSON、Markdown 及组合导入。
- 官方 conversations JSON primary path 导入；源节点引用仍被保留，但 UI 不展示分支切换。
- 消息、不可变 MessageVersion、RenderBlock、Heading 和 SearchDocument 持久化。
- PostgreSQL COPY 批量写入；import commit 快速返回 `202`，worker 使用 heartbeat 和 stale recovery。
- exporter 带属性的 fenced code、长 fence 和 tilde fence 可正确生成 code blocks。
- assistant 开头明显的 exporter thinking summary 在导入时清理；历史内容有前端折叠兜底。
- 历史会话可排队执行 `conversation_auto_clean`，通过新版本删除导出的搜索/思考前缀并重建 TOC/Search。
- `.cr` 快速归档支持后台导出、校验预览、重复检测和 canonical round-trip 导入。

### 阅读与导航

- user/assistant Markdown 安全渲染，支持 GFM、浅色 Shiki、KaTeX、Mermaid 和 callout；代码块支持复制、换行和长内容展开。
- 首屏使用 30 条 preview window；heavy message blocks 在视口附近自动加载并分页追加。
- 对话索引使用独立轻量 API；active-message TOC 使用按消息过滤和分页 API。
- 左侧对话索引按 `U#`、`A#` 编号，右侧 TOC 默认绑定 active message。
- 未挂载 message/block 可通过 anchor window 加载后定位；移动 sheet 和只读分享页复用可靠导航。
- 移动端消息使用全宽阅读布局，代码、表格和图表在自身容器滚动。

### 管理、搜索和分享

- Project 创建/重命名/归档、展开子会话、拖放移动和 Project 内置顶。
- Conversation 使用单 Project 归属：未归类会话只在 history，进入 Project 后不重复；归档保留关系，恢复回原位置。
- 会话重命名、全局置顶、归档、软删除和批量操作。
- 消息拆分/合并；会话拆分和按可拖动顺序进行非破坏式后台合并。
- import 与 conversation merge 共用 PostgreSQL 持久化任务队列、全局进度条、heartbeat、失败重试和完成后自动刷新。
- 消息编辑、版本历史和通过新版本恢复。
- PostgreSQL full-text、trigram substring 混合搜索，支持 conversation/project/status/date/document type/role 过滤；heading/code 结果包含 block 定位，重复消息按 content hash 折叠。
- 分享链接创建、列表、标题/描述/有效期更新、撤销和只读访问。
- `.cr` 后台快速归档、Markdown 和 Canonical JSON 导出。
- 阅读位置、最近打开和 PWA-ready 壳。
- Conversation/Project 最近阅读时间、置顶优先的多字段排序、跨浏览器排序偏好和自定义拖动顺序。
- Sidebar 全局即时搜索、Reader 当前会话搜索，以及搜索与阅读键盘快捷键。
- 阅读位置支持 message/block/heading 内偏移、停滚保存和跨浏览器自动续接；首屏直接加载保存位置附近窗口。
- Share 使用 token 约束的 message/index/TOC/block 分页，匿名访客进度仅保存在当前浏览器。

## 明确未实现

- 认证、多用户、角色权限和租户隔离。
- TanStack Virtual 等真正的消息虚拟滚动；当前是窗口加载和 DOM 增量渲染。
- HTML/PDF/Project 打包导出。
- Tag、Bookmark、笔记系统和语义/向量搜索。
- 批量 blocks read API 和真正多 worker 调度；当前 worker 固定单并发处理 import、merge、`.cr` export 与 auto-clean。
- 全局操作反馈仍以各功能内状态为主，尚未统一成应用级 Toast 队列。
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
