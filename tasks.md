# Implementation Tasks: ChatGPT 导出对话阅读器

## Stage 00：项目骨架与基础设施

- [ ] 初始化 monorepo `chat-archive-reader/`。
- [ ] 创建 `apps/web` Next.js + TypeScript。
- [ ] 创建 `apps/api` FastAPI。
- [ ] 配置 Docker Compose：PostgreSQL、API、Web。
- [ ] 配置 SQLAlchemy 2.x 与 Alembic。
- [ ] 添加基础健康检查 API。
- [ ] 添加测试框架：pytest、frontend test、lint/typecheck。
- [ ] 创建初始 migrations。

## Stage 01：来源识别与 Raw Artifact

- [ ] 实现 upload endpoint。
- [ ] 实现 SourceDetector。
- [ ] 实现 source_artifacts 表与 repository。
- [ ] 实现 imports 表与 preview DTO。
- [ ] 实现 import preview API。
- [ ] 添加 fixture tests。

## Stage 02：ChatGPT Exporter JSON + Markdown 导入

- [ ] 实现 ExporterJsonParser。
- [ ] 实现 MarkdownParser。
- [ ] 实现 JsonMarkdownAligner。
- [ ] 实现 thinking summary Cleaner。
- [ ] 实现空消息过滤。
- [ ] 实现 canonicalizer for exporter source。
- [ ] 写入 conversations/messages/message_versions。
- [ ] 添加 exact/partial/json-only/md-only tests。

## Stage 03：官方 conversations.json 导入

- [ ] 实现 OfficialJsonParser。
- [ ] 支持 conversations array。
- [ ] 支持 single conversation object。
- [ ] 实现 ConversationGraphBuilder。
- [ ] 实现 PrimaryPathResolver。
- [ ] 保存 source_message_refs。
- [ ] 导入 primary path messages。
- [ ] 添加 regenerate branch fixture tests。

## Stage 04：Canonical 存储、搜索、目录

- [ ] 实现 RenderBlock builder。
- [ ] 实现 Heading builder。
- [ ] 实现 Search builder。
- [ ] 实现 conversation list API。
- [ ] 实现 messages cursor API。
- [ ] 实现 batch blocks API。
- [ ] 实现 search API。

## Stage 05：基础阅读器前端

- [ ] 实现 Sidebar。
- [ ] 实现 TopBar。
- [ ] 实现 ConversationReader。
- [ ] 实现 MessageItem。
- [ ] 实现 BlockRenderer。
- [ ] 实现 ImportPreviewModal。
- [ ] 实现 SearchPanel。
- [ ] 实现 TOCDrawer。

## Stage 06：Project / Pin / Reading Position

- [ ] 实现 Project CRUD。
- [ ] 实现 project_conversations。
- [ ] 实现 Project pin。
- [ ] 实现 global conversation pin。
- [ ] 实现 project-level conversation pin。
- [ ] 实现 reading_positions。
- [ ] 实现 recent_items。
- [ ] 实现 reading range setting。

## Stage 07：性能优化与虚拟滚动

- [ ] 集成 TanStack Virtual。
- [ ] 实现 message-level virtualization。
- [ ] 实现 heavy message block lazy loading。
- [ ] 实现 estimated_height / measured_height。
- [ ] 实现 request cancellation。
- [ ] 实现 hover prefetch。
- [ ] 实现 read model 优化。

## Stage 08：编辑、版本、Undo

- [ ] 实现 message edit。
- [ ] 实现 version history。
- [ ] 实现 restore version。
- [ ] 实现 delete/restore。
- [ ] 实现 insert note/message。
- [ ] 实现 split/merge。
- [ ] 实现 conversation_events。
- [ ] 实现 UndoToast。

## Stage 09：分享与导出

- [ ] 实现 shares 表。
- [ ] 实现 share token。
- [ ] 实现分享完整会话。
- [ ] 实现分享阅读范围。
- [ ] 实现 Canonical JSON export。
- [ ] 实现 Markdown export。
- [ ] 实现 HTML export。
- [ ] 实现 Project export job。

## Stage 10：安全、测试、发布硬化

- [ ] HTML sanitize。
- [ ] raw artifact 权限控制。
- [ ] share access tests。
- [ ] 大文件测试。
- [ ] 性能基准。
- [ ] 错误状态 UI。
- [ ] 文档完善。
- [ ] 发布 checklist。
