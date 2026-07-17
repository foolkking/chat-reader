# 系统架构

## 总览

```mermaid
flowchart LR
  B[Browser] -->|same-origin /api| W[Next.js Web]
  W -->|API_INTERNAL_URL| A[FastAPI]
  A --> P[(PostgreSQL)]
  A --> S[(Import storage)]
  Q[Task worker] -->|SKIP LOCKED| P
  Q --> S
  Q --> E[(Export storage)]
```

浏览器始终请求 Web 当前 origin 下的 `/api/*`。Next.js rewrite 在服务端把请求转发给 FastAPI，因此 localhost、局域网和生产域名使用同一客户端代码，也不会把 `localhost:8000` 暴露给远端浏览器。

## 代码边界

- `apps/web/app`：Next.js 页面、布局、PWA manifest 和 route UI。
- `apps/web/features`：reader、import、search、projects、sharing 等客户端能力。
- `apps/web/lib`：API client、query provider 和共享工具。
- `apps/api/app/api/routes`：HTTP 接口。
- `apps/api/app/services`：导入、canonical、搜索、编辑、分享和导出逻辑。
- `apps/api/app/models`：SQLAlchemy 持久化模型。
- `apps/api/alembic`：数据库版本演进。

## Canonical 模型

核心关系如下：

```text
Import -> SourceArtifact
Conversation -> Message -> MessageVersion -> RenderBlock
Conversation -> Heading
Conversation/MessageVersion -> SearchDocument
Conversation -> ProjectConversation -> Project
Conversation -> ConversationEvent / Share / ReadingPosition
```

- `Conversation` 保存标题、来源、状态、统计和全局置顶信息。
- `Message` 保存角色、顺序、turn 和当前版本引用。
- `MessageVersion` 保存不可变文本快照、hash 和编辑来源。
- `RenderBlock` 是阅读 read model，包含 heading、paragraph、list、code、table 等结构。
- `SourceMessageRef` 保留导入源节点追踪信息。
- `Heading` 和 `SearchDocument` 在导入或编辑后重建，不依赖浏览器扫描 DOM。
- 每个 Conversation 最多只有一个 ProjectConversation 关系。默认 Inbox 是内部未归类位置，不在侧栏显示为普通 Project。

## 导入流程

```text
upload -> detect -> parse preview/warnings -> enqueue (202)
worker -> align JSON/Markdown -> clean -> canonicalize
       -> blocks -> headings -> search -> atomic publish
```

Import queue 持久化在 PostgreSQL。独立单并发 worker 使用 `FOR UPDATE SKIP LOCKED` 领取任务，并写入阶段、百分比、消息计数和 heartbeat；崩溃任务超过五分钟会重新排队。导入主体在 worker 事务中完成，conversation 在成功前保持 `importing`，不会进入列表、搜索或分享。

同一 worker 也领取 `background_jobs` 中的 conversation merge、`.cr` export 和 historical auto-clean。Merge API 立即返回 `202`，任务按请求中的 conversation ID 顺序分批复制当前 canonical 内容；目标 conversation 在发布前保持 `processing`，失败事务不会留下不完整会话。任务共用单并发调度，避免小内存服务器同时执行两个高内存任务。

大批量 `RenderBlock`、`Heading` 和 `SearchDocument` 在 PostgreSQL 使用 COPY；SQLite 测试使用 SQLAlchemy Core fallback。导入版本的 `MessageVersion.blocks` 保持兼容但写入空数组，正式 block 来源为 `render_blocks`，避免双份 JSON。

raw artifact 存在受控 storage 中，只用于追踪和诊断。reader 和 share 页面不直接渲染 raw artifact。官方 conversations JSON 选择 primary path 形成线性阅读内容，分支节点引用仍可追踪。

## 阅读与性能

- `message-window` 返回分页窗口，并支持通过 `anchor_message_id` 或 `anchor_order_key` 直接取得包含目标的窗口；`content_mode=preview` 会截断 heavy 正文。
- `dialogue-index` 只返回消息 ID、角色编号、ordinal、order key 和短预览，不返回完整 MessageVersion。
- TOC 支持 `message_id/offset/limit/max_level`，reader 首屏不再读取整个 conversation TOC。
- heavy message 首先返回轻量消息元数据；进入视口附近或导航到 block 时再调用 message blocks API，并通过 sentinel 继续分页。
- block cache 以 message id 为键复用结果。
- 导航等待目标挂载、布局稳定并校验 scroll root 中的位置，必要时补偿滚动。
- 当前方案不是严格的虚拟列表：长会话仍会随窗口合并增加 DOM 数量。

## Markdown 安全

renderer 使用 React 组件和受控 Markdown pipeline，禁止 raw HTML 执行，不使用 `dangerouslySetInnerHTML` 渲染导入内容。链接限制协议，未知外部图片不会直接热加载。Mermaid 在客户端初始化，失败时回退为代码内容。Shiki 使用缓存的 `github-light` highlighter；代码、表格、公式和图表只允许在自身容器横向滚动。

## Project 可见性

- active conversation 归属内部 Inbox 时出现在 Conversation history。
- active conversation 归属普通且未归档 Project 时，只出现在该 Project。
- archived conversation 保留关系但不出现在 history 或 Project 列表。
- Project 被归档时，其 active conversations 临时出现在 history；恢复 Project 后自动回到原 Project。

## 搜索

PostgreSQL `search_documents` 同时支持全文排名和基于 `pg_trgm` GIN 索引的大小写不敏感 substring。substring 对中文、`package.json`、URL 和标点查询尤其重要。搜索结果只引用 canonical conversation/message/heading，不索引 raw artifact；相同 `Message.content_hash` 的跨会话 message 结果会折叠并返回 `occurrence_count`。

## 编辑和版本

编辑、拆分、合并和恢复都保留旧 MessageVersion。写操作完成后重建当前版本的 blocks、headings 和 search documents，并写入 ConversationEvent。会话 merge/split 创建新 conversation，不修改来源会话。

## 分享和导出

Share 只保存 token hash；公开 token 仅在创建时返回。访问接口提供只读 canonical 数据并记录访问次数。

`.cr` 导出创建 `conversation_export` 后台任务，worker 流式写入 ZIP64 JSONL 和 entry checksum。导入 Preview 校验路径、压缩率、记录数量、格式版本和 checksum；Commit 使用确定性 UUID 重映射恢复 canonical 数据，并跳过 Markdown parse、blocks 和 TOC 重建。导出 artifact 记录在 `export_artifacts`，默认 24 小时过期。

## 部署边界

production compose 将 PostgreSQL 和 API 置于内部 Docker network，只暴露 Web。Nginx/Caddy 应作为公网入口负责 TLS、请求体限制和访问控制。当前应用本身没有用户认证，不能仅依靠不可猜测 URL 保护全部数据。
