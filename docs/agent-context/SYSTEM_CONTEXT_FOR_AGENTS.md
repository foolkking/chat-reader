# 智能体系统上下文

最后核验日期：2026-07-26
线上：`https://chat.king.2bd.net`
核验版本：`e752e9ddf25595c3f373977a1803956354ca71b0`

## 必须先知道

Chat Reader 是 ChatGPT 导出资料的长期阅读与管理系统，不是在线聊天机器人。它把外部 JSON/Markdown/`.cr` 等导入为 PostgreSQL canonical 数据，提供长对话窗口阅读、搜索、TOC、版本、Project、批注/精选笔记、分享、导出和独立 `/library` 离线 PWA。

当前没有注册/登录/会员/admin/计费/模型选择/消息生成。用户级数据以 `local:default` 表示。第二种身份是持有效 URL token 的只读 Share 访客。

## 技术与目录

- Monorepo：`apps/web`（Next.js 14/React 18/TypeScript/Tailwind）、`apps/api`（FastAPI/SQLAlchemy/Alembic/Python 3.11+）、`packages/shared`。
- 数据：PostgreSQL 16，21 张业务表；migration head `20260724_0015`。
- 同源 API：浏览器 `/api/*` -> Next rewrite -> FastAPI。OpenAPI 本地有 67 paths/79 operations。
- 后台：PostgreSQL durable jobs + 单独 import/background worker；文件型 import/export/offline volumes。
- 生产：Nginx HTTPS -> Next loopback；Docker Compose 位于 `/opt/chat-reader`。
- 离线：`/library` 独立 manifest/scope，Dexie + Cache API + FlexSearch Worker；普通首页不由 library SW fallback。

## 页面

`/` 在线列表，`/archived` 归档，`/recent` 最近（当前未发现侧栏入口），`/search` 全局搜索，`/projects/[id]` Project 列表，`/conversations/[id]` Reader，`/share/[token]` 只读分享，`/library` 离线资料库，`/offline` 连接失败页。详细入口、overlay 和截图见 `PAGE_AND_ROUTE_MAP.md`。

## 核心实现事实

- 导入先 preview，再显式 commit；支持 `.cr/.json/.md/.markdown/.txt/.csv` 检测，canonical commit 由 service/worker 完成。
- MessageVersion 不可变；RenderBlock/Heading/SearchDocument 可重建；编辑/恢复改变 current version。
- Reader 共享 remote/offline `ReaderDataSource`，使用居中消息窗口、block range、对话 TOC、章节 TOC 和阅读位置。
- 导航目标包含 conversation/message/block/offset/quote。目标优先流程取消旧 token，准备 window/blocks/TOC 后一次替换，再 quote/prefix/suffix -> offset -> block -> message 回退。
- Markdown 支持 GFM、代码/Shiki、KaTeX、Mermaid、callout、reasoning、表格、链接以及导入内容中的图片/附件。未发现音视频专用播放器或聊天附件上传。
- 批注类型：highlight/underline/strikethrough/comment/bookmark；颜色黄/绿/蓝/粉；anchor 可 active/relocated/stale。工作区支持筛选、单项/批量管理和精选笔记。
- 离线只允许修改 annotation/notebook，写入 UUID/base revision outbox；冲突保留副本。canonical 管理在离线隐藏/禁用。
- Share 的 description/annotations/notebook 和 Export 对应 flags 默认关闭；公开 API 通过 token hash/expiry/revoke/scope/options 限制。
- Desktop 左侧栏、章节 TOC、dock 和批注窗口可调尺寸并 localStorage 记忆；mobile 使用 Bottom Sheet、无 desktop separator/rail，批注只读。

## 数据与存储

服务器主数据在 PostgreSQL；source/export/offline artifacts 在配置目录/volume。浏览器 Dexie stores：conversations/messages/blocks/headings/searchDocuments/annotations/notebooks/readingPositions/packages/outbox/settings。localStorage 保存偏好和 pane 尺寸。无认证 Cookie 代码。

离线 package 导入是 Dexie transaction；保留 pending 用户元数据，本地较新的 reading position 不被服务器包覆盖。Service Worker staging 完整校验后才激活新版壳；首次离线冷启动保证必须先成功在线准备。

## 已确认限制

- 当前无多用户 ACL；公网部署访问边界不能由应用账号系统提供。
- `/library` 只覆盖已下载资料，不允许导入、编辑正文、移动 Project 或改 description。
- 移动端不创建/编辑/批量删除批注，也不显示 desktop resize handles。
- 浏览器离线数据受 quota、持久化许可和清站点数据影响。
- 生产 OpenAPI schema 未通过 `/api/openapi.json` 暴露。
- 本次没有对生产执行导入、编辑、删除、同步或故障注入。

## 当前差异与未确认

- 旧 `docs/product.md`/`PROJECT_STATE.md` 对批注、离线和 migration head 的描述已过期。
- 有效 production Share token 页面未完整核验。
- 真实设备离线冷启动、staging asset 失败、quota 失败未在本阶段执行。
- 生产实际 Nginx TLS 配置在仓库外。
- `/recent` 可直接访问，但当前主侧栏未发现入口；不推断原因。

完整条目见 `KNOWN_ISSUES_AND_UNCERTAINTIES.md`。

## 兼容与安全要求

- `.cr` 当前写 v2 optional entries，并兼容读 v1；offline package v1 是另一协议。
- `/library` 的 Service Worker scope 不得被误认为根站点 scope。
- 不在文档、截图、日志中保存真实会话、ID、Share token、Cookie、密钥或 `.env` 值。
- 不把旧文档、单张截图或未挂载代码单独当成线上事实。

## 开始工作前阅读

1. `docs/system/README.md`
2. 本文件
3. `docs/agent-context/UX_AUDIT_HANDOFF.md`
4. `docs/system/PAGE_AND_ROUTE_MAP.md`
5. `docs/system/FEATURE_INVENTORY.md`
6. `docs/system/KNOWN_ISSUES_AND_UNCERTAINTIES.md`

证据位于 `docs/evidence/README.md`；维护规则位于 `docs/system/DOCUMENT_MAINTENANCE.md`。新证据必须带日期、版本、状态和脱敏说明，不能无证据覆盖已确认事实。

