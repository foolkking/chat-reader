# 数据与持久化

最后核验日期：2026-07-26

## PostgreSQL

生产使用 PostgreSQL 16。当前 SQLAlchemy metadata 有 21 张业务表；迁移链从 `0001` 到 `20260724_0015`，生产与源码都在 `0015 (head)`。

| 表 | 主要用途 | 关键关系/兼容事实 |
| --- | --- | --- |
| `conversations` | canonical 对话、标题、description、状态、置顶、offline revision | 被 message/project/share/annotation 等引用 |
| `messages` | 对话中的 U/A/other 消息和 current version | FK conversation；顺序和 source identity |
| `message_versions` | 不可变 Markdown/纯文本版本 | FK message；current version 由 message 指向 |
| `render_blocks` | 当前/指定版本的可渲染 block | FK version；block index/range 支持懒加载 |
| `headings` | 章节 TOC | FK conversation/message/version/block |
| `search_documents` | title/message/heading/code 等搜索文档 | PostgreSQL tsvector/trigram/fallback；FK canonical 对象 |
| `projects` | Project 元数据、归档和排序 | 当前无用户所有权 FK |
| `project_conversations` | Project 与 conversation 关系、局部排序/置顶 | 联结表 |
| `imports` | preview/commit/job 状态 | 关联 source artifacts |
| `source_artifacts` | 原始导入文件元数据与存储引用 | FK import；文件落配置目录 |
| `source_message_refs` | canonical message 到来源位置映射 | FK message/source artifact |
| `background_jobs` | 导入、归档导出、离线包等 durable queue | worker 轮询与 retry/stale |
| `export_artifacts` | 导出文件元数据 | FK job/conversation；实际文件在 export dir |
| `offline_package_artifacts` | 离线包 artifact、scope、状态 | FK job；固定 subject |
| `shares` | token hash/prefix、scope、expiry、include flags | FK conversation；不存原始 token |
| `reading_positions` | message/block/offset/anchor 阅读位置 | FK conversation/message；subject=`local:default` |
| `recent_items` | 最近打开 Conversation/Project/Message | 可选 FK 对应对象；固定 subject |
| `user_preferences` | 主题、语言、宽度、TOC、排序 | subject=`local:default` |
| `conversation_annotations` | 类型/颜色/comment/anchor/status/revision/conflict | FK conversation/message/version/self conflict |
| `conversation_notebooks` | Markdown/reference blocks、revision/conflict | FK conversation/self conflict |
| `annotation_sync_receipts` | 离线操作幂等回执 | operation UUID/subject |

模型证据：`apps/api/app/models/*.py`；schema 演进证据：`apps/api/alembic/versions/*.py`。本次没有读取或记录真实表行内容。

## Canonical 关系

```text
Conversation
├── Message (ordered)
│   ├── MessageVersion (immutable history)
│   │   ├── RenderBlock
│   │   └── Heading
│   └── SourceMessageRef
├── ProjectConversation -> Project
├── SearchDocument
├── ReadingPosition / RecentItem
├── Share
├── ConversationAnnotation -> Message/Version
└── ConversationNotebook -> Annotation references
```

导入 preview 与 canonical commit 分离；commit 服务在事务内写 canonical，失败不应留下部分 conversation。版本恢复不会覆盖历史 version。

## 服务器文件存储

| 配置目录 | 内容 | 数据库记录 | 生产 volume |
| --- | --- | --- | --- |
| `IMPORT_STORAGE_DIR` | 上传的 source artifacts | imports/source_artifacts | `import_storage` |
| `EXPORT_STORAGE_DIR` | Markdown/JSON/`.cr` artifacts | export_artifacts/jobs | `export_storage` |
| `OFFLINE_STORAGE_DIR` | 紧凑离线包 | offline_package_artifacts/jobs | `offline_storage` |

文件名、路径和真实内容均未写入文档。仓库 `apps/api/storage/` 在工作树中有本地未跟踪数据，本次未触碰。

## 浏览器 IndexedDB

Dexie database：`chat-reader-offline-library`，version 1。

| Store | 内容 |
| --- | --- |
| `conversations` | 本地会话元数据、revision、Project context |
| `messages` | 当前消息版本窗口/索引数据 |
| `blocks` | 当前版本 blocks |
| `headings` | 本地章节 TOC |
| `searchDocuments` | FlexSearch 输入文档 |
| `annotations` | 批注、revision、stale/conflict 状态 |
| `notebooks` | 精选笔记与冲突副本 |
| `readingPositions` | 本浏览器阅读位置 |
| `packages` | 下载 scope/revision/时间/大小 |
| `outbox` | 离线 annotation/notebook operations |
| `settings` | library/offline 状态元数据 |

离线包格式是 ZIP 内 `package.json`，format `chat-reader-offline-package` version 1。导入在单个 Dexie transaction 中原子替换；保留 pending annotations/notebooks；服务器 reading position 只在本地不存在更近位置时初始化。

## Cache API 与 PWA

- library shell 使用 metadata cache、staging revision cache 和 active revision cache；只有必要 HTML/Next static/font/icon/manifest/search worker 全部校验后才切换 active。
- 更新失败时旧 active cache 保留；cleanup 按 shell/legacy 前缀删除 superseded cache。
- 普通 API 响应、首页和 canonical 管理页面不进入 library SW fallback。
- Cache/IndexedDB 都可能被“清除站点数据”删除；界面通过 StorageManager `persist()`/`estimate()`显示状态。

## localStorage、Cookie 与内存缓存

localStorage 键表见 `FRONTEND_ARCHITECTURE.md`，包括偏好、各 pane 尺寸、批注窗位置、资料库最近对话和 Share 局部阅读位置。

- `已确认` 代码未发现账号 Cookie/Session/Token 保存。
- TanStack Query 是运行时浏览器缓存，不是跨刷新 canonical 持久化。
- Share 原始 token 只存在 URL/创建响应；DB 只存 hash。截图和文档均未保留 token。

## 初始化、测试和兼容

- Alembic 创建/演进 schema；没有发现会自动写生产业务样本的 seed 脚本。
- `apps/api/tests/` 含 44 个 `test_*.py` 文件，测试使用隔离 database/fixtures；仓库另有 `examples/`，不视为生产数据。
- `.cr` 导入兼容 v1；当前导出可写 v2 optional entries。离线 package v1 与 `.cr` archive version 是两个不同协议。

## 敏感信息边界

真实会话/消息/批注、文件内容、路径、ID、Share token、数据库 URL 和环境变量值不进入本目录文档。后续需要展示 schema 示例时只能使用合成数据。

