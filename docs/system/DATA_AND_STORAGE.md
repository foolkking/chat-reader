# 数据与持久化

最后核验：2026-08-05

## PostgreSQL

当前 SQLAlchemy metadata 有 30 张应用表；加 `alembic_version` 共 31 张。源码和本地数据库 Alembic 单一 head 为 `20260816_0022`；生产部署后必须执行 `alembic current` 核对该 head。

| 领域 | 表 |
| --- | --- |
| canonical | `conversations`, `messages`, `message_versions`, `render_blocks`, `headings`, `conversation_events` |
| 导入与来源 | `imports`, `source_artifacts`, `source_message_refs`, `background_jobs` |
| 组织与阅读 | `projects`, `project_conversations`, `reading_positions`, `recent_items`, `user_preferences` |
| 搜索 | `search_documents` |
| 批注 | `conversation_annotations`, `conversation_notebooks`, `annotation_sync_receipts` |
| 分享/文件 | `shares`, `export_artifacts`, `offline_package_artifacts`, `asset_objects`, `attachments`, `message_version_attachments`, `asset_derivatives`, `asset_object_leases`, `attachment_upload_sessions`, `attachment_upload_items` |
| Operational liveness | `worker_runtime_states` (single-worker heartbeat/state only; no payload or task ID) |
| Authentication | `auth_principals`, `auth_sessions`, `auth_login_throttles` (single-owner credential hash, opaque-session digest and bounded throttle only; no plaintext password or token) |

## Canonical 关系

```text
Conversation
├── Message -> immutable MessageVersion -> RenderBlock
├── Heading / SearchDocument / ConversationEvent
├── ProjectConversation -> Project
├── ReadingPosition / RecentItem / Share
└── ConversationAnnotation / ConversationNotebook
```

附件关系为 `AssetObject -> Attachment(conversation_id) -> MessageVersionAttachment occurrence`。一个物理对象可被多个对话级 Attachment 复用，但 Attachment 不跨对话引用；Occurrence 有独立 ID、`occurrence_key` 和 `placement=inline|after_message`，同一 Attachment 可在同一版本出现多次。上传 session/item 是有期限的暂存数据，不是 canonical Attachment，也不是用户可见回收站。

消息保存路径使用 `idx_attachments_conversation_id_id` 与 `idx_message_versions_message_created_at` 批量校验和版本查询；occurrence 写入使用现有 version/display-order 与 attachment 索引。上传项提升与消息版本事务分离，保存不会移动或重新读取物理附件对象。

- `Message.current_version_id` 指向当前不可变版本；编辑/恢复不覆盖旧版本。
- `MessageVersion.display_text` 继续存储唯一 Markdown 正文；服务层以 `display_markdown` 表达其语义，并记录 normalizer/parser/block/search builder 版本。
- RenderBlock 是正式阅读 read model；分页 range 仍兼容，但主 Reader 按完整轮次批量读取。
- SearchDocument 是可重建派生数据，覆盖 title/message/heading/code/annotation。
- `user_preferences` 包括主题、语言、宽度、Markdown 间距、15-22px 字号、TOC 和列表排序。

## 服务器文件存储

| 配置 | 内容 | Compose volume |
| --- | --- | --- |
| `IMPORT_STORAGE_DIR` | source artifacts 与受控 ImportDraft JSONL | `import-storage` |
| `EXPORT_STORAGE_DIR` | Markdown/JSON/`.cr` artifacts | `export-storage` |
| `OFFLINE_STORAGE_DIR` | `.crpkg` offline artifacts | `offline-storage` |
| `ASSET_STORAGE_DIR` | quarantine/original/derivative attachment objects | `asset-storage` |

数据库只保存 metadata 和受控相对路径；服务必须验证 resolved path 位于对应 root。ImportDraft 记录 SHA-256、统计和到期时间，Commit 校验路径、统计和到期后读取同一文件。导入目录可能含用户私密正文，不进入文档整理、截图或普通源码归档。

## Dexie

数据库 `chat-reader-offline-library` 当前 version 2，保留 version 1 数据读取。

| Store | 内容 |
| --- | --- |
| `conversations` | 本地元数据、revision、Project context |
| `messages`, `blocks`, `headings` | 当前 Reader 正文与 TOC |
| `searchDocuments` | 离线搜索输入 |
| `annotations`, `notebooks` | 本地批注、精选笔记和冲突副本 |
| `readingPositions` | 本浏览器稳定位置 |
| `packages` | 下载 scope/revision/大小/时间 |
| `outbox` | 待同步批注/notebook operations |
| `settings` | Library 和同步元数据 |
| `attachments` | Offline v3 attachment metadata and message/version relation |

offline package 写格式为 v3 `conversation-delta`，客户端兼容读 v1/v2/v3。请求字段 `asset_mode` 支持 `none|small|all`；策略允许的 `scanner_disabled` 对象可随包进入 Cache Storage，但状态原样保留，不能解释为 clean。数据库 transaction 失败会回滚新增缓存；删除本地会话同时删除对应 metadata 和 Blob。请求提交 `known_revisions`；变化 conversation 在单个 transaction 中原子替换，pending 用户数据覆盖包内副本，本地较新的 reading position 不被服务器初始化值覆盖。

## Cache API 与 StorageManager

- Library shell 使用 metadata、staging revision 和 active revision cache；全部必要资源通过后才激活。
- 更新失败保留旧 active shell；普通 API/管理页面不进入 Library fallback。
- `navigator.storage.persist()/estimate()` 只表达浏览器配额/持久化状态，不是服务器授权。
- 清除站点数据会删除 Cache、IndexedDB 和 localStorage，但不删除 PostgreSQL canonical 数据。

## 兼容边界

- `.cr` archive 和 offline `.crpkg` 是不同协议，即使版本号相同也不可互换。
- CanJSON v2 是轻量 JSONL 交换投影，Markdown v2 是人类阅读投影；两者都不替代 `.cr` 的完整数据库级恢复。
- ReadingPosition 不增加数据库列；`anchor_data` 的 `block-relative-v2` 扩展 block/version/order/ratio 信息并兼容读取 v1。
- Share token/URL、PostgreSQL 数据、Dexie version 1、本地阅读位置和 v1 offline package 读取均是当前兼容边界。
- 新 migration 必须保持单一 head；不要用删除 volume 或重建浏览器库处理普通 schema/revision 问题。
