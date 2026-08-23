# API 参考

## Adaptive Import (2026-08-22)

JSON / Markdown sources use a session-oriented API. Analysis creates
InputGroups and StructureFamilies, resolves Built-in or Learned Profile
revisions, and produces canonical drafts for the existing durable commit path.
Unknown and drifted Families use one unified Mapping endpoint; validation is
performed on every group in the Family. `.cr` remains an independent archive
preview/restore path. See [Adaptive Import Contract](system/ADAPTIVE_IMPORT_CONTRACT.md).

Importer v5 treats exporter JSON and its optional Markdown as one upload batch. JSON provides canonical message identity/role/time/order and allows a matching Prompt-only or Response-only Markdown export to be recognized; a standalone single-role Markdown file is still rejected. Empty messages may occur anywhere and are reported as ignored. Every non-empty message must have one reliable monotonic counterpart or Preview returns a non-committable conflict with per-source alignment diagnostics. Historical JSON plain fallbacks may pair with rich Markdown only under a unique matching role/timestamp identity.

## Attachment Renderer supporting APIs (2026-08-09)

| Method | Path | Contract |
| --- | --- | --- |
| `GET` | `/api/attachments/{id}/text/search?q=&limit=&cursor=` | Bounded literal text search with signed continuation cursor; stale object/query cursors return `cursor_stale` |
| `POST` | `/api/attachments/{id}/derivatives/{type}` | Queue `text_extract`, `image_thumbnail`, or `image_preview` through the existing worker |
| `GET/HEAD` | `/api/attachments/{id}/derivatives/{type}/content` | Authorized derivative content using the shared single-byte-Range contract |
| `POST` | `/api/conversations/{id}/attachment-downloads` | Owner-only bounded background ZIP of active available conversation Attachments |
| `GET` | `/api/capabilities` | Abstract Viewer/Range/derivative/search/batch flags only; no database schema details |

Owner, Share and derivative content authorization occurs before file stat/read. Share cannot enumerate owner attachments or create derivative/batch jobs. Offline never calls search or job endpoints. See [Attachment Renderer Contract](system/ATTACHMENT_RENDERER_CONTRACT.md).

## Current task additions (2026-08-04)

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/tasks/{job_id}/cancel` | Cancel a conversation merge. A running job returns `cancelling`; a queued/already-cancelled job returns `cancelled`; completed or unsupported tasks return `409`. |

`GET /api/tasks/{job_id}` and `GET /api/tasks/active` expose `cancellable` and `attempt_count`. Task status includes `cancelling` and `cancelled`. Merge results preserve canonical versions, render blocks, source refs and annotation mappings and commit atomically.

所有业务接口以 `/api` 为前缀。浏览器应使用相对 URL，不应直接拼接 FastAPI 的主机或端口。

最后核验：2026-08-05。当前本地 `app.openapi()` 生成 99 个 path templates、117 个 operations；精确 request/response 字段始终以 `apps/api/app/schemas/` 和运行代码为准。

## Health

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/health` | FastAPI 直接健康检查 |
| GET | `/api/health` | 同源代理和容器健康检查 |

## Imports

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/imports/preview` | multipart 上传并返回识别、preview 和 warnings |
| GET | `/api/imports/{import_id}` | 查询 preview、Draft 校验和、到期时间和任务状态 |
| DELETE | `/api/imports/{import_id}` | 只清理已过期且未提交的 preview/Draft，其他状态返回 409 |
| GET | `/api/imports/{import_id}/source-artifacts` | 查看 source artifact 元数据 |
| GET | `/api/imports/{import_id}/warnings` | 查看导入 warning |
| POST | `/api/imports/{import_id}/commit` | 幂等排队；queued/processing 返回 `202`，committed 返回 `200` |
| GET | `/api/imports/{import_id}/status` | 查询阶段、百分比、消息进度、结果或错误 |
| GET | `/api/imports/active` | 返回 queued、processing 和待处理 failed 任务 |

Adaptive JSON / Markdown：

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/adaptive-import/sessions` | 有界上传 JSON/Markdown，分析 grouping、Family 与 Profile match；最多 500 文件、每文件 50 MiB、session 总计 512 MiB |
| GET/DELETE | `/api/adaptive-import/sessions/{id}` | 恢复 session，或明确取消并清理其临时来源 |
| PUT | `/api/adaptive-import/sessions/{id}/groups` | 在任意未提交可恢复状态确认或调整 InputGroup；每个来源必须且只能出现一次 |
| POST | `/api/adaptive-import/sessions/{id}/reanalyze` | 使用当前 Analyzer 恢复并重建未提交 session 的 Family/Profile resolution |
| PUT | `/api/adaptive-import/sessions/{id}/artifacts/{artifact}` | 原位替换一个 session 临时来源，保留 Group 身份并自动重新分析 |
| DELETE | `/api/adaptive-import/sessions/{id}/groups/{group}` | 从本次导入排除一个 Conversation Group；拒绝删除最后一个 Group |
| POST | `/api/adaptive-import/sessions/{id}/families/{family}/mapping/preview` | 对完整 Family normalization/validation，并返回 canonical sample |
| POST | `/api/adaptive-import/sessions/{id}/families/{family}/mapping` | 保存 VERIFIED Learned Profile/Revision 并重建 ImportPlan |
| POST | `/api/adaptive-import/sessions/{id}/families/{family}/profile` | 为 AMBIGUOUS Family 明确选择候选 revision |
| GET | `/api/import-formats` | 列出 Built-in 与 Learned Profile |
| PATCH/DELETE | `/api/import-formats/{profile}` | 重命名、启停或删除 Learned Profile；Built-in 拒绝修改 |
| GET | `/api/import-formats/{profile}/revisions` | 查看不可变历史 revision |

产品导入只有 Adaptive JSON / Markdown 与 `.cr` archive 两类入口。CanJSON v1/v2 与原生 Chat Reader 格式是 Built-in Profile；单 Markdown 是正式 source mode。Import Profile 不保存正文，匹配结果会解释 hard requirements、semantic guards、compatibility 与 drift。READY 后仍使用现有 `/api/imports/{id}/commit` durable commit contract。

## Conversations

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/conversations` | 会话列表；`scope=history` 只返回未归类或归属已归档 Project 的 active 会话 |
| GET | `/api/conversations/{id}` | 会话详情 |
| PATCH | `/api/conversations/{id}` | 重命名或修改 active/archived 状态 |
| DELETE | `/api/conversations/{id}` | 不可恢复硬删除；同事务删除关系，仅在无真实引用时删除 AssetObject |
| POST | `/api/conversations/merge` | 按请求顺序排队非破坏式合并，返回 `202 BackgroundTaskRead` |
| POST | `/api/conversations/{id}/split` | 从连续消息范围创建新会话 |
| POST | `/api/conversations/{id}/split-workspace/preview` | 校验并预览 range/boundary/discrete 拆分计划，不写数据 |
| POST | `/api/conversations/{id}/split-workspace` | 按已校验计划创建一个或两个新会话，来源不变 |
| PATCH | `/api/conversations/{id}/pin` | 修改全局置顶 |
| PUT | `/api/conversations/{id}/placement` | 单事务跨 Project/未分类移动或同区间隔排序，支持 revision 冲突检查 |
| GET | `/api/conversations/{id}/events` | 管理和编辑事件 |
| GET | `/api/conversations/{id}/messages` | 消息分页列表 |
| GET | `/api/conversations/{id}/message-window` | 消息窗口；支持 offset、limit、anchor message/order key |
| GET | `/api/conversations/{id}/reader-turn` | 返回 anchor 所在完整阅读轮次、全部 RenderBlock 及相邻轮次 anchor；不截断正文 |
| GET | `/api/conversations/{id}/dialogue-index` | 轻量对话索引，不返回完整正文 |
| GET | `/api/conversations/{id}/toc` | canonical heading TOC；支持 message、offset、limit、max level、role、q 和 order key 范围 |
| POST | `/api/conversations/{id}/exports` | 统一导出；Markdown/CanJSON 返回流，`.cr` 返回后台任务 |
| POST | `/api/conversations/{id}/auto-clean` | 排队清理历史 assistant 思考/搜索前缀 |

## Messages

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/messages/{id}` | 消息详情 |
| PATCH | `/api/messages/{id}` | 编辑正文；`save_mode=create_version` 默认创建版本，`replace_current` 仅允许覆盖 v2+ |
| GET | `/api/messages/{id}/blocks` | 当前版本 RenderBlock 分页 |
| GET | `/api/messages/{id}/versions` | 版本历史 |
| PUT | `/api/messages/{id}/current-version` | 持久化选择该单消息的当前版本，不复制版本 |
| DELETE | `/api/messages/{id}/versions/{version_id}` | 永久删除 v2+；删除当前版本时自动回退，v1 永久保护 |
| POST | `/api/messages/{id}/versions/{version_id}/restore` | 基于历史快照创建恢复版本 |
| POST | `/api/messages/{id}/split` | 兼容接口：按字符 offset 拆分消息；当前 Reader 不提供该入口 |
| POST | `/api/messages/merge` | 合并相邻、同 role 消息 |

## Projects

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/projects` | Project 列表 |
| POST | `/api/projects` | 创建 Project |
| PATCH | `/api/projects/{id}` | 重命名、置顶或归档 Project |
| GET | `/api/projects/{id}/conversations` | Project 会话列表 |
| POST | `/api/projects/{id}/conversations/{conversation_id}` | 兼容接口；将会话移动到该 Project |
| DELETE | `/api/projects/{id}/conversations/{conversation_id}` | 移回内部 Inbox/Conversation history |
| PATCH | `/api/projects/{id}/conversations/{conversation_id}/pin` | Project 内置顶 |
| POST | `/api/conversations/{id}/projects/{project_id}` | conversation 侧兼容加入接口 |
| DELETE | `/api/conversations/{id}/projects/{project_id}` | conversation 侧兼容移出接口 |
| PUT | `/api/conversations/{id}/project` | 单归属移动；`project_id=null` 移回 history |
| PUT | `/api/projects/order` | 更新 Project 自定义顺序 |
| PUT | `/api/conversations/order` | 更新未分类 Conversation 自定义顺序 |
| PUT | `/api/projects/{id}/conversations/order` | 更新 Project 内 Conversation 自定义顺序 |
| POST | `/api/projects/{id}/recent` | 更新 Project 最近阅读时间 |

Project 列表支持 `sort=recent_read|updated|created|title|conversation_count|custom` 与 `direction=asc|desc`。Conversation 列表和 Project 内列表支持 `sort=recent_read|updated|created|imported|title|message_count|custom`；置顶项始终优先。

## Background Tasks

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/tasks/active` | 返回 queued、processing 和 failed 的 import/merge/export/auto-clean 任务 |
| GET | `/api/tasks/{job_id}` | 查询统一任务阶段、进度、结果或错误 |
| POST | `/api/tasks/{job_id}/retry` | 重试 failed 任务 |
| POST | `/api/tasks/{job_id}/cancel` | 取消 queued/processing conversation merge；完成或不支持的任务返回 409 |

Conversation merge 可携带 `Idempotency-Key` 请求头。相同 key 的 queued、processing 或 committed 请求返回已有任务，不会重复创建结果。

## Search And TOC

`GET /api/search` 接受 `q`、`limit`、`offset`、`conversation_id`、`project_id`、`document_type`、`role`、`status_scope`、`date_from` 和 `date_to`。`document_type` 使用 `conversation`、`message`、`heading`、`code`、`annotation` 或 `attachment`；heading/code/annotation 结果返回目标字段以支持精确定位。重复 message 结果通过 `occurrence_count` 表示跨会话出现次数。

`POST /api/search/reindex` 重建 canonical 搜索文档，属于管理操作；当前没有认证，公网部署应在反向代理层限制访问。

TOC 使用 `GET /api/conversations/{id}/toc`。返回 heading 带 message id、block index、level、title、anchor 和顺序信息，并支持 `message_id`、`max_level`、`role`、`q`、`order_key_from`、`order_key_to`、`offset` 和 `limit`。

Owner 可通过 `POST /api/conversations/{id}/toc/refresh` 手动排队目录更新任务：

```json
{
  "refresh_dialogue_index": true,
  "refresh_section_toc": true,
  "section_scope": "current_conversation"
}
```

- `refresh_dialogue_index` 与 `refresh_section_toc` 至少选择一项，否则返回 `422`。
- `section_scope` 为 `current_conversation`（默认）或 `all_conversations`；仅影响章节目录重建。
- 返回 `202 BackgroundTaskRead`，可由 `/api/tasks/{job_id}` 查询进度。请求可携带 `Idempotency-Key`，同 key 的活动或已完成任务不会重复创建。
- 对话目录是当前 canonical 消息的实时投影；任务完成后客户端重新获取该索引。章节目录是 Heading 派生表，由 worker 从 current MessageVersion 的 heading RenderBlock 重建。
- 该派生操作不提升 Conversation revision，不创建 MessageVersion，也不改变阅读位置。

消息编辑补充接口：

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/messages/{message_id}/tasks/{task_key}/toggle` | 立即切换当前 Owner Reader 中的 GFM 任务；校验 `base_version_id`，v1 创建 v2，v2+ 覆盖当前版本，返回局部消息编辑投影 |

任务 key 来自 canonical block builder 的稳定元数据，不使用当前可见序号；Share、Offline 和附件 Markdown 预览不调用该写接口。

## Reading

阅读位置由服务端身份解析器绑定到 `local:default`，客户端不能提交身份字段。当前客户端写入 `anchor_data.position_mode=block-relative-v2`，包含 block id/index、version id、order key、scroll ratio、block 内像素及字符偏移；恢复按 `block_id -> block_index/message_id -> order_key -> scroll_ratio` 降级，并继续读取 v1。重新进入会话时直接请求包含保存 message 的完整 `reader-turn`。

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/conversations/{id}/reading-position` | 获取阅读位置 |
| PUT | `/api/conversations/{id}/reading-position` | 保存 message/block/scroll offset |
| POST | `/api/conversations/{id}/recent` | 记录最近打开 |
| GET | `/api/recent-items` | 最近项目，仅 active 会话 |

会话生命周期和归属：

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/conversations/{id}/archive` | 软归档并从 active 列表移除 |
| POST | `/api/conversations/{id}/unarchive` | 取消归档并恢复项目归属 |
| DELETE | `/api/conversations/{id}` | 二次确认后立即硬删除，无 Trash/restore |
| PUT | `/api/conversations/{id}/placement` | 单事务跨 Project/未分类移动或同区排序，支持 revision 冲突检查 |

## Shares

The current Share contract is public-by-link by default. Creation accepts an
optional `share_password` that is independently hashed and never creates an
owner session. Password-protected Shares unlock through
`POST /api/shared/{token}/unlock`, which issues only a Share-scoped HttpOnly
credential; changing or removing the password revokes prior unlock sessions.
All shared data and attachment routes continue to re-check token, scope,
expiry and revocation, and cannot call private owner APIs.

管理端接口：

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/conversations/{id}/shares` | 创建 full/selected 分享；原 token 只在创建响应返回 |
| GET | `/api/conversations/{id}/shares` | 列出该会话的分享记录，不返回原 token |
| PATCH | `/api/shares/{share_id}` | 更新标题、描述、过期时间或分享选项 |
| POST | `/api/shares/{share_id}/revoke` | 撤销分享 |

公开分享采用轻量 bootstrap、完整轮次正文和 token 约束兼容分页，不允许通过分享 token 调用内部 conversation/message API：

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/shared/{token}` | Share 与 conversation 元数据，不包含完整消息和 TOC |
| GET | `/api/shared/{token}/message-window` | 30 条消息窗口，支持 `anchor_message_id` |
| GET | `/api/shared/{token}/reader-turn` | token/scope 约束下返回完整阅读轮次与相邻 anchor |
| GET | `/api/shared/{token}/dialogue-index` | 分页对话索引，支持围绕目标消息加载 |
| GET | `/api/shared/{token}/toc` | 当前消息或指定范围的章节目录 |
| GET | `/api/shared/{token}/messages/{message_id}/blocks` | 授权消息的 RenderBlock 分页 |
| GET | `/api/shared/{token}/annotations` | include flag 允许时读取批注 |
| GET | `/api/shared/{token}/notebook` | include flag 允许时读取精选笔记 |

所有分页接口都会重新验证 token、有效期、撤销状态和 `selected_messages` 范围。Share 阅读位置只保存在访问浏览器的 localStorage，不写入服务器。

## Preferences

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/preferences` | 获取主题、语言、正文宽度、Markdown 间距、字号、TOC 与列表排序偏好 |
| PATCH | `/api/preferences` | 更新外观或 Conversation/Project 排序模式与方向 |

`reader_width_mode` 支持 `compact / standard / wide`；`reader_density_mode` 支持 `compact / comfortable / large`，界面语义为 Markdown 间距；`reader_font_size_px` 范围为 15-22，默认 17。客户端不能提交 `subject_key`；当前服务端身份固定解析为 `local:default`。

## Export

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/conversations/{id}/exports/markdown` | 流式 Markdown v2；支持 metadata、versions、annotations、notebook、message ids 和 TOC 模式 |
| GET | `/api/conversations/{id}/exports/canjson` | 流式 CanJSON v2 JSONL；支持 metadata、versions、annotations、notebook、source refs、message ids 和 gzip |
| POST | `/api/conversations/{id}/exports` | API 兼容多种内部 format；产品 UI 只调用附件 Markdown/CanJSON package |
| GET | `/api/conversations/{id}/export` | 一个兼容周期的旧接口；`canonical_json` 仍映射 CanJSON v1 |
| POST | `/api/system/archive/exports` | 生成系统 `.cr v4`；附件自动包含，可选择是否包含 archived |
| POST | `/api/system/archive/restore` | 只恢复到没有 conversation/attachment 的空实例；非空返回 409 |

对话产品 UI 始终导出完整当前对话，只显示 CanJSON/Markdown 与“包含附件”。无附件分别调用流式 `.canjsonl`/`.md`；含附件排队 `.context.zip`/可移植 Markdown ZIP。API 中旧 selection/context format 暂保兼容，但不在新 UI 暴露。`.context.zip` 只含 `manifest.json`、`conversation.canjsonl` 和内容寻址附件对象；manifest 分开记录 conversation/asset completeness。当前对话投影排除 `status=detached` 的 Attachment；系统 `.cr v4` 仍保留历史版本引用。CanJSON metadata-only 仍保留 active Attachment 和 occurrence；Markdown metadata-only 使用人类可读缺失占位。

附件：

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/capabilities` | 上传、scanner provider、未扫描策略、基础/复杂预览和最大文件大小 |
| POST | `/api/conversations/{id}/attachment-upload-sessions` | 创建有期限的普通上传 session，可绑定目标消息/base version |
| POST | `/api/attachment-upload-sessions/{id}/items` | 流式上传一个暂存项；返回 MIME/hash/大小/scan 状态 |
| GET | `/api/attachment-upload-sessions/{id}` | 查询 session 与多文件项状态 |
| DELETE | `/api/attachment-upload-sessions/{id}/items/{item_id}` | 取消并清理暂存项 |
| GET/POST | `/api/conversations/{id}/attachments` | 列出当前对话文件；或显式将已上传暂存项提升为未放置 Attachment |
| PATCH/DELETE | `/api/conversations/{id}/attachments/{attachment_id}` | 修改显示名；或删除没有任何版本引用的对话级 Attachment |
| GET | `/api/attachments/{id}` | Owner 附件 metadata 与受控 content/download URL |
| GET/HEAD | `/api/attachments/{id}/content` | 权限校验、`Range: bytes=start-end`、nosniff 和主动内容隔离 |
| POST | `/api/attachments/{id}/derivatives/text_extract` | 排队生成受限 UTF-8 文本派生物并同步附件搜索索引 |
| GET/HEAD | `/api/attachments/{id}/derivatives/text_extract/content` | 派生文本的受控内容与 Range |
| GET | `/api/shared/{token}/attachments/{id}` | Share 范围内的附件 metadata |
| GET/HEAD | `/api/shared/{token}/attachments/{id}/content` | Share 范围内的附件内容与 Range |

源码编辑器上传时，文件先通过上传 session 和 Attachment finalize 接口成为当前对话 Attachment；消息保存只提交已存在的 `cr-asset://` 引用和 occurrence 声明。非空 `upload_item_ids` 返回 409/422，保存不会再次读取或移动文件。响应包含当前 message/version、render blocks、occurrences 和 conversation attachment summary；搜索、TOC、统计和摘要在 commit 后异步重建。

## Offline Library

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/offline/catalog` | 返回 catalog revision、conversation `revision` 与包含附件的估算大小 |
| POST | `/api/offline/packages` | 排队生成 conversation/project/all 离线包；`asset_mode=none|small|all` |
| GET | `/api/offline/packages/{package_id}` | 查询 artifact 元数据 |
| GET | `/api/offline/packages/{package_id}/download` | 下载 `.crpkg` |

`POST /api/offline/packages` 可提交 `known_revisions: {conversation_id: revision}`。服务器逐 conversation 与当前 catalog 比对，v3 `conversation-delta` 包只写新增或 revision 不同的 conversation；全部未变化时返回可安全导入的空增量。旧 v1/v2 包仍可由浏览器导入。

系统 `.cr v4` 从 `/api/system/archive/exports` 排队，轮询任务后下载；旧对话级 `.cr` 仍可导入，但新对话导出 UI 不再生成。下载 artifact 默认 24 小时过期。

`format=markdown_bundle` 输出 Markdown 与相对 `assets/objects/<sha-prefix>/<sha256>` 文件；`format=canjson_bundle` 输出带附件对象路径的 CanJSON JSONL。两种 Bundle 只包含当前版本，并接受 `include_description`、`annotation_scope`、`notebook_scope` 与 `include_source_refs` 二级选项。当前不做附件内容秘密扫描；对象仍需通过状态、大小和 SHA-256 完整性校验，manifest 中 `excluded_object_count` 为兼容字段。

生产同源代理当前不承诺公开 `/api/openapi.json`。需要核验完整 schema 时，在受控环境调用 FastAPI `app.openapi()`，并与 `apps/api/app/schemas` 交叉检查。
# 2026-08-09 API Addendum

## Conversation editing

- `POST /api/conversations`: atomically create a titled conversation with a project and exactly two non-empty initial messages (`user`, then `assistant`).
- `POST /api/conversations/{conversation_id}/messages/insert`: body contains `anchor_message_id`, `position` (`before|after`), `mode` (`single|pair`), messages, and optional `expected_offline_revision`.
- `DELETE /api/messages/{message_id}?expected_offline_revision=N`: soft-delete the message and return the deleted message plus the post-mutation `conversation_revision`.
- `POST /api/messages/{message_id}/restore?expected_offline_revision=N`: undo a soft delete and return the restored message plus the post-mutation `conversation_revision`; repeating an already successful restore is idempotent.

All mutations are transactional and return `409` for an old conversation revision. No Trash endpoint or recovery list is added.

Message edit, task toggle, current-version selection and version deletion responses also include the post-commit `conversation_revision`; Web must use it as the next mutation's base revision.
# Archived project deletion (2026-08-12)

`DELETE /api/projects/{project_id}` permanently deletes a non-default archived Project container and returns `204`. Its conversations are atomically retained under the internal default/Unclassified project. Active or default projects return `422`; missing projects return `404`. The operation does not delete conversations, messages or attachments and requires no schema migration.

## Internal diagnostics (Release C/L)

`GET /api/internal/diagnostics` is an aggregate-only internal route. It returns
404 unless `ENABLE_INTERNAL_DIAGNOSTICS=true` and the direct API client is
loopback. Production Nginx deliberately returns 404 for the public path;
authorized operators use the SSH + API-container loopback boundary. The route
returns worker liveness, job/Import, artifact cleanup and storage aggregates
without instance/task IDs, filenames, raw paths, message content, tokens or
credentials. Responses are `no-store` and carry a server-owned request ID.
`/api/health` remains the separate, cheap public health-check route. See
`docs/system/OBSERVABILITY_CONTRACT.md`.

## Single-owner authentication (Release N)

When `AUTH_ENABLED=true`, every business API route is authenticated by default.
The explicit public allowlist is coarse health plus the minimal session flow:

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/api/auth/session` | Returns authenticated state and a server-derived inactivity expiry; no-store. |
| POST | `/api/auth/login` | Accepts one password and issues a fresh HttpOnly opaque session cookie; generic failure and bounded backoff. |
| POST | `/api/auth/logout` | Revokes the current server session and clears cookies. |
| POST | `/api/auth/password` | Authenticated owner-only current/new/confirm password change; invalidates all sessions. |

The opaque session token is never stored as plaintext. It expires on exactly
48 hours of per-device inactivity and only authenticated requests can advance a
rate-limited server-side activity timestamp. Unauthenticated private business
routes return `401`; all authenticated, auth and shared-capability responses
are `Cache-Control: no-store`. Unsafe mutations require the configured same
origin. A Share token authorizes only its exact scoped public Share resources;
it is never a global owner or artifact bypass.

## Content cleanup review

All `/api/content-cleanup/*` routes remain inside the owner authentication
boundary. `GET/POST/PATCH/DELETE /rules` manage built-in and literal rule
revisions. Literal create/update accepts `matcher_mode` (`EXACT`, `NORMALIZED`,
`APPROXIMATE`) and `boundary_mode` (`ANYWHERE`, `WHOLE_LINE`, `BLOCK_END`).
`POST /rules/scan-existing` queues one low-priority scan of all active project
and unclassified conversations using a snapshot of enabled rule revisions.
`POST /scans` accepts current, selected-active or all-active scope;
archived conversations are rejected. A Source Editor selection additionally
sends `message_id`, `selection_start_offset` and `selection_end_offset` as one
all-or-none set. Offsets are server Unicode code-point offsets over the current
persisted MessageVersion; unsaved source is not accepted. Scan status and
occurrence preview are read separately, decisions are updated through
`PATCH /scans/{id}/decisions`, and `POST /scans/{id}/apply` revalidates current
MessageVersion authority before creating reviewed versions. Successful apply
and `DELETE /scans/{id}` both remove the scan and occurrence records.
Occurrence responses derive bounded context at read time; persisted scan rows
contain positions and identities, not copied message bodies. Occurrences also
return detector-versioned `match_mode` and evidence codes. All candidates
default to `KEEP` and require explicit review; confidence and similarity are
not part of the cleanup API.
