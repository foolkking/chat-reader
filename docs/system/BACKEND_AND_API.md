# 后端与 API

## Conversation merge execution (current)

- Merge is an atomic background job that creates an independent target conversation. It copies all active source messages, every `MessageVersion`, every canonical `RenderBlock`, source refs, and non-deleted annotations (including conflict copies) through bounded bulk batches. ID maps preserve `based_on_version_id`, current-version pointers, block indexes, quotes, offsets, and context anchors.
- The merge path never reparses Markdown or repeatedly loads `MessageVersion.blocks` while discovering headings/code. TOC rows are remapped from source headings; search uses lightweight projections and refreshes PostgreSQL `search_tsv` once after annotation indexing.
- Statistics, content hash, `offline_revision`, project link, source events, and global heading slugs publish in the same transaction. Cancellation checks run at each batch and before publication, so no partial target conversation remains.

### Background task cancellation

| Endpoint/state | Contract |
| --- | --- |
| `POST /api/tasks/{job_id}/cancel` | Merge only; queued jobs become `cancelled`, processing jobs become `cancelling`; repeats are idempotent. |
| `cancelling` | Worker finishes the current database call, detects the state, rolls back, then records `cancelled`. |
| stale recovery | At most three automatic attempts; exhausted jobs become `failed`. Explicit retry resets `attempt_count`. |

`BackgroundTaskRead` includes `cancellable` and `attempt_count`. Production Compose limits the worker to `${IMPORT_WORKER_MEMORY_LIMIT:-640m}`.

The ten-fixture isolated regression baseline contains 398 effective messages and 51,866 canonical render blocks. It merged in 7.26 seconds with 132.9 MiB peak process RSS; the paired import reported 13 trailing-empty messages and no blocking alignment ambiguity.

最后核验：2026-08-04

## 技术边界

- Python 3.11+、FastAPI、SQLAlchemy 2、Alembic、Pydantic Settings、psycopg 3。
- 入口：`apps/api/app/main.py`；API metadata version `0.12.0`。
- 当前本地 OpenAPI 为 99 paths / 117 operations；附件 GET/HEAD 使用独立 operation ID。
- route 位于 `apps/api/app/api/routes/`；业务逻辑位于 `services/`；持久化实体位于 `models/`；传输 schema 位于 `schemas/`。
- 没有 auth middleware、Redis、SSE/WebSocket、AI provider client、应用级限流或计费中间件。

完整端点表见 [API 参考](../api-reference.md)，本页不重复维护每个 Method/Path。

## 资源边界

| 资源组 | 责任 |
| --- | --- |
| imports/tasks | JSON/Markdown、`.crbundle`、旧 `.cr`、ImportDraft、preview、commit、warnings、durable job、retry/stale recovery |
| conversations/messages | canonical 管理、完整轮次、索引、拆分/合并、版本 |
| projects/reading/preferences | 单 Project 归属、排序、位置、最近、阅读偏好 |
| search/toc | PostgreSQL full-text + trigram、SearchDocument、Heading |
| annotations/notebook | CRUD、锚点 revision、离线同步、冲突副本 |
| shares/shared | 创建/撤销与 token-scoped 只读数据，附件范围同步校验 |
| attachments | Bundle preview/commit、AssetStore、扫描、Range content、Share content、派生对象和生命周期 |
| exports/offline | Markdown v2/CanJSON v2 流、`.cr` artifact、Context Package、catalog 和增量 v3 package |

## 关键数据流

### 导入

```text
JSON(+optional Markdown) or .cr -> detector/parser/aligner
-> imports + source artifact + checksummed ImportDraft JSONL
-> explicit commit -> background_jobs -> worker reads the same Draft
-> conversation/messages/versions/blocks/headings/search -> publish
```

JSON 是形式 1 的 metadata、role、time、源索引与配对冲突权威；有效配对的 Markdown 是 canonical 显示正文权威。Source detector 不在主链路接受官方 OpenAI 图/ZIP、CSV、TXT 或 Markdown 单文件；CanJSON v1/v2 由形式 1 自动识别。

形式 1 会分别删除 JSON/Markdown 尾部的空白消息，再按非空消息顺序校验 role 与 timestamp。配对解析枚举全部 `Prompt`/`Response` 标题候选，以 JSON 的角色、规范化时间和顺序建立完整单调路径，再按正文相似度和长度偏差选择唯一最佳路径；未选候选作为 Markdown 正文保留。只有完整路径唯一时启用辅助分段，同分、缺失或顺序冲突仍产生 conflict 并阻止 commit。消息状态为 exact、normalized 或 by_order 时，canonical `display_markdown` 取 Markdown；JSON-only 仍取 JSON。Markdown-only 与无可靠时间序列继续使用保守兼容解析，未闭合围栏恢复保持不变。parser/Markdown parser 当前为 v4，`ChatGPT Exporter (https://www.chatgptexporter.com)` 是受支持的 `powered_by` 值。

### 阅读与定位

```text
anchor message -> reader_turns groups full user-led turn
-> batch current versions + all blocks -> ReaderTurnResponse
-> client atomic mount/stabilize/align -> save reading position
```

message-window 和 block-range 端点仍保留兼容性与其他功能，但不是主 Reader 正文加载路径。

### 搜索与编辑

编辑默认生成新 MessageVersion；第一版永久不可覆盖或删除，第二版及以后可通过显式 `replace_current` 原地覆盖。版本选择只更新单消息 `current_version_id`，版本删除在需要时先回退当前版本，并重定位或标记批注。上述写操作会更新 message/conversation 派生字段、offline revision、blocks、headings 和 SearchDocument，并写审计事件。MessageVersion 记录 normalizer、Markdown parser、block builder 和 search document 版本；幂等 derived rebuild 任务可升级历史派生数据和旧 hash。

会话拆分保留旧连续区间接口，并增加 split-workspace preview/execute 合同：`range_copy` 复制完整连续区间，`boundary_copy` 创建边界前后两个新会话，`discrete_copy` 只复制明确 ID。三种模式均不修改来源会话，并校验空结果、重复 ID、跨会话 ID、非法边界和 Project。

### Share

```text
create -> random token returned once -> DB stores hash/prefix
-> /api/shared/{token}/* validates expiry/revoke/scope/options
-> read-only reader-turn/index/toc/private includes/export permission
```

### 离线

```text
 catalog + known_revisions + asset_mode -> offline_package job
-> v3 ZIP contains only new/changed conversations and optional attachment objects
-> browser verifies/imports transactionally
-> local annotation/notebook outbox -> sync receipt/conflict copy
```

### Attachments and Context Package

`.crbundle` is the standard attachment-bearing import input. The Adapter accepts both the native attachment bundle schema and `chat-reader-import-bundle v1`, using CanJSONL as canonical truth and JSON/Markdown only for consistency reporting. It is validated in quarantine before commit; canonical RenderBlocks store only stable `attachmentId` values.

Ordinary uploads use expiring `attachment_upload_sessions/items`. The conversation attachment endpoint explicitly finalizes an uploaded item, promotes/reuses AssetObject bytes, and creates a conversation-owned Attachment identity. Message save never promotes uploads: it only references Attachments that already belong to the conversation. Split/merge clone Attachment identities for the target conversation, reuse AssetObject bytes, and rewrite occurrence/block/source Markdown IDs.

The source editor may use a transient upload marker while an item is in flight, but successful upload finalization replaces it with `cr-asset://<attachment-uuid>` before save. `PATCH /api/messages/{id}` rejects non-empty legacy `upload_item_ids`, unresolved upload markers, mismatched Markdown/occurrence declarations, duplicate occurrence keys, and cross-conversation Attachment IDs. Its synchronous transaction is limited to base-version validation, one batch Attachment ownership query, the current Markdown/version/render blocks/occurrences, current-version pointer and required annotation migration. Whole-conversation search, TOC, statistics and summary rebuild is queued after commit through a coalesced `conversation_derived_rebuild` task.

The edit response returns the refreshed message, MessageVersion, render blocks, AttachmentOccurrences and conversation attachment summary. It records structured timing for request parsing, base-version check, attachment validation, Markdown parsing, version/block/occurrence writes, commit and response serialization; requests over one second emit a slow-save warning.

GFM task markers carry deterministic `task_key`, checked state, source offset, label and ordinal metadata in the current paragraph RenderBlock. `POST /api/messages/{message_id}/tasks/{task_key}/toggle` requires `base_version_id`: toggling v1 creates a new version, while v2+ explicitly replaces the current version. It reuses the bounded message-edit transaction and preserves attachment occurrences. Unknown/stale keys and base-version conflicts are rejected instead of toggling a task by display order alone.

Owner and Share attachment content routes re-check status, scanner policy, selected-message scope and a single byte Range on every request. Offline v3 stores attachment metadata in Dexie v2 and optional policy-allowed blobs in Cache Storage while preserving `scanner_disabled`; it never relabels them clean. `text_extract` derivatives are bounded background jobs (2 MiB source read cap) and are indexed through the existing `search_documents` table with document type `attachment`.

The conversation export UI maps CanJSON/Markdown plus `include attachments` to four outputs: `.canjsonl`, `.context.zip`, `.md`, and portable Markdown ZIP. Secondary options for description, annotations, notebook and CanJSON source refs are represented by one `ExportOptions` contract for streaming and background bundle exports. Conversation projections include active Attachments only; `detached` identities remain available to historical MessageVersions and system `.cr v4` but are excluded from current conversation package counts and files. Metadata-only formats preserve active attachment references; package manifests separate conversation completeness from asset completeness and record the included secondary content. System `.cr v4` is a full single-user archive exported from Settings, includes Attachment/AssetObject/Occurrence relationships, and restores only into an empty instance. Old conversation `.cr` remains import-compatible but is not newly exposed in conversation export UI.

The current deployment policy does not inspect attachment contents for secrets or exclude files by filename/content. Export still verifies object status, byte size and SHA-256. Scanner state remains explicit (`scanner_disabled` on King), so an included object is not asserted clean or safe.

## 后台任务

单 worker 处理 import、conversation merge、`.cr` export、historical auto-clean 和 offline package。任务使用 PostgreSQL queue、heartbeat、stale recovery、retry 与 idempotency key；单并发是小内存部署的当前控制，不是通用并发 job framework。

## 错误与可观察性

- 业务错误多使用 FastAPI `HTTPException(detail=...)`；validation 使用标准 422。
- 日志来自 Uvicorn、worker/Python logging 和 Docker json-file rotation。
- 仓库没有 Sentry/OpenTelemetry/APM/告警配置；生产需通过容器状态、health、failed jobs 和外部监控补足。
- 生产同源层不保证公开 OpenAPI；精确 schema 在受控环境调用 `app.openapi()`。
