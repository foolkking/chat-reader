# API 参考

## 邀请、审计与删除后清理（工作树，2026-10-02）

- `GET /api/admin/access/invitations/page`：Root，`state=ALL|PENDING|USED|EXPIRED|REVOKED`、
  `offset>=0`、`limit=1..100`（默认20），返回 items/total/offset/limit；无令牌、摘要或链接。
  旧 invitations 数组保留；撤销幂等，与一次性注册使用串行化。
- `GET /api/admin/audit/page`：Root，`action/actor/target/result`、可选
  `actor_user_id/target_user_id`、带时区 `created_after/created_before`、offset/limit；
  默认20、最大100。账户文字按字面匹配，历史已删除账户完整UUID仍可检索。
- `GET /api/admin/audit/actions`：最多200个现有操作代码。旧 `/audit` 数组保留。
- 用户删除任务结果增加 `account_deleted/asset_cleanup_status/asset_cleanup_pending`；
  canonical 已提交但文件清理未完成时，`POST /api/tasks/{id}/retry` 仅重试剩余清理。
  存储键不进入API结果，不重复删除账户或写完成审计。
  `/api/tasks/active` 另保留最多20项待清理删除结果，超过普通终态窗口仍可重试；
  已完成清理的记录继续遵循原有终态保留时间。

详见 [Administration Contract](system/ADMINISTRATION_CONTRACT.md)。

## 系统归档任务（工作树，2026-10-02）

全部 Root 专用，普通用户返回 404。旧同步 `/api/system/archive/restore` 保留。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/system/archive/capabilities` | 上传限制、空实例/配置原因、SMTP 状态 |
| GET | `/api/system/archive/tasks` | 本人系统任务，`before` 游标、`limit` 1–100 默认30；实时 artifact 状态 |
| POST | `/api/system/archive/previews` | multipart `file` + 必填 `Idempotency-Key`，202 后台预检 |
| GET | `/api/system/archive/previews/{id}/accounts` | `offset/limit/unresolved_only`，总数/未决数/全清单 revision |
| GET | `/api/system/archive/account-targets` | `q/offset/limit` 搜索目标账户 |
| PATCH | `/api/system/archive/previews/{id}/accounts/{source_key}` | `base_revision/decision/target_user_id`；NEW/EXISTING 草稿，冲突409 |
| POST | `/api/system/archive/restores` | `preview_job_id/content_digest/ownership_revision`，202；空实例检查与重复恢复幂等 |
| DELETE | `/api/system/archive/previews/{id}` | 204移除临时来源；活跃任务409 |

导出沿用 `/api/system/archive/exports`；同 key 并发去重、不同选项409。上传24小时
后不能新确认，已确认恢复仍可完成。详见 [Data Archive Contract](system/DATA_ARCHIVE_CONTRACT.md)。

## 个人数据归档（工作树，2026-10-02）

下列接口严格限定当前有效账户；Root 在此也只能访问本人归档。写入执行
既有同源检查，任务重入复用 `/api/tasks`，不会向管理员系统备份接口回退。

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/api/me/archive/capabilities` | 当前 `maximum_upload_bytes` 与 `upload_lifetime_hours` |
| GET | `/api/me/archive/tasks` | 本人归档任务；`limit` 1–100（默认 30），可选 `before` 任务 UUID 游标；结果补当前 `expires_at`、`artifact_available` |
| POST | `/api/me/archive/exports` | `{include_archived: true}`；必填 `Idempotency-Key`（1–160 字符），202 `BackgroundTaskRead` |
| POST | `/api/me/archive/previews` | multipart `file`、必填 `Idempotency-Key`；按大小上限分块落盘后返回 202 预检任务，ZIP 解析在 worker |
| POST | `/api/me/archive/restores` | `{preview_job_id, content_digest, include_preferences: false}`；成功预检后显式确认，202；同预检重复确认复用任务 |
| DELETE | `/api/me/archive/previews/{preview_id}` | 204，移除临时上传，不删除已恢复内容；有关联活跃任务时 409 |

个人任务类型：`personal_archive_export`、`personal_archive_preflight`、
`personal_archive_restore`。支持既有任务取消/失败重试。导出下载仍为
`/api/exports/{artifact_id}/download`，仅已提交的本人导出可访问，24 小时
后 410；上传来源永不通过该接口提供下载。预检结果包含 counts、最多各
50 个项目/对话标题、缺失附件数量与规范化摘要。偏好默认不导入；归档正文
和所有内部引用经重映射后新增恢复，按账户与内容摘要持久幂等。

主要错误：401 未登录，403 账户不可用，404 无权访问/不存在，409 状态或
确认选项冲突，410 上传过期/已移除，413 超出上传上限。后台未知异常只提供
静态安全信息，不回传 SQL 参数、正文或存储路径。详细合同见
[Data Archive Contract](system/DATA_ARCHIVE_CONTRACT.md)。

## 修改邮箱（工作树，2026-10-01）

以下接口需要有效的同账户 USER 会话；ADMIN 邮箱仍由部署配置管理。
所有写入执行同源检查，返回 no-store。无需新增 migration。

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/api/auth/email-change` | 返回 `pending: {target_email, expires_at} \| null` 和 `email_delivery_available`，仅当前账户 |
| POST | `/api/auth/email-change/request` | `{new_email, current_password}`；校验当前密码后发送 30 分钟一次性邮件，返回 `{target_email, expires_at}`；重发使用同接口并替换旧授权 |
| POST | `/api/auth/email-change/cancel` | 撤销当前账户未完成的邮箱修改，204；不更改邮箱 |
| POST | `/api/auth/email-change/preview` | `{token}`；验证用途、账户、版本和有效期，仅返回目标/到期时间，不消费授权 |
| POST | `/api/auth/email-change/confirm` | `{token}`；原子更换邮箱、撤销其他会话和旧重置/验证授权，返回更新后的 `AuthSessionRead`，保留当前 session token 和 UUID |

发起前检查 SMTP 和邮箱唯一性，确认时再次检查唯一性并由 PostgreSQL 约束兜底。
错误为 401（未认证）、403（不允许的账户）、409（邮箱不可用）、422（输入/授权无效）、429（限流）、503（邮件暂不可用）。邮箱验证链接使用 fragment，GET 不消费。完整身份与恢复合同见 `system/AUTHENTICATION_CONTRACT.md`。

## Offline conflict resolution (working tree, 2026-10-01)

`POST /api/annotations/sync` accepts additive `action: "resolve"` for an
annotation or notebook. `entity_id` is the canonical ID and `base_revision` is
the compared canonical revision. The payload contains `conflict_copy_id`,
`conflict_revision`, `choice` (`local`, `server`, `merge`), and the selected
`annotation` or `notebook` content; an annotation deletion uses `deleted: true`.
Server choice needs no replacement content. Schema validation rejects incomplete
requests; subject/conversation ownership and both revisions are checked before
writing. Changed revisions return 409 with the copy intact. Canonical content,
copy removal, annotation search, notebook-reference remapping and receipt commit
atomically. Exact operation replay returns the saved receipt with `duplicate`,
without requiring the removed conflict copy to exist. Existing upsert/delete
calls and response shapes are unchanged. No migration is required.

## Offline download admission (working tree, 2026-10-01)

`POST /api/offline/packages` keeps its existing payload and now enforces stable
replay for `Idempotency-Key` (at most 200 characters): the same account/key and
request returns the same job, including terminal jobs; a changed scope, IDs,
known revisions or asset tier returns 409. PostgreSQL serializes concurrent
admission. Clients persist the key/request before sending, and deliberately use
a new key to rebuild a cancelled or failed generation. Existing task status and
cancel endpoints remain authoritative; no second server queue is introduced.
Package v3 adds optional attachment `downloadable` metadata while preserving
v1/v2 readers and the current format number. Details are in
`system/PWA_OFFLINE_RESILIENCE_CONTRACT.md`.

## 当前账户接口合同（工作树，2026-09-01）

私有 API 需要 owner session，并按已认证用户 UUID 限定返回记录。首次部署账号是
唯一 `ADMIN`，普通注册账号为 `USER`；`/api/admin/*` 仅管理员可用。Share 和
Offline 保持原有 token/local 边界。该合同已在工作树实现，等待
`20260901_0030_multi_account_users.py` 的生产 migration 与发布。

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
| `POST` | `/api/tasks/{job_id}/cancel` | Cancel a conversation merge or ordered deletion. A running job returns `cancelling`; a queued/already-cancelled job returns `cancelled`; completed or unsupported tasks return `409`. |

| `POST` | `/api/conversations/batch-delete` | Queue ordered permanent deletion of one or more conversations; returns `202 BackgroundTaskRead`. The task commits one conversation at a time, reports `deleted_ids` progress, and supports stopping only the not-yet-started items via `/api/tasks/{job_id}/cancel`. |

`GET /api/tasks/{job_id}` and `GET /api/tasks/active` expose `cancellable` and `attempt_count`. Task status includes `cancelling` and `cancelled`. Merge results preserve canonical versions, render blocks, source refs and annotation mappings and commit atomically. Deletion task results contain `deleted_ids` and per-item `failed` entries when applicable.

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
| POST | `/api/adaptive-import/sessions` | 有界上传 JSON/Markdown，分析 grouping、Family 与 Profile match；最多 500 文件、每文件 500 MiB、session 总计 512 MiB；大文件分析受单并发及内存水位保护 |
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

当前版本选择和版本删除响应包含 `derived_status` 与可选
`derived_job_id`。正文提交后立即返回；搜索和章节目录通过现有
`conversation_derived_rebuild` 后台任务更新。

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
| GET | `/api/tasks/active` | 返回 active 与保留期内 terminal 的 import/merge/export/cleanup/noise-review 等任务；噪声审查通过 `parent_task_id` 关联导入 |
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

阅读位置由服务端身份解析器绑定到已验证的账户 UUID，客户端不能提交身份字段。当前客户端写入 `anchor_data.position_mode=block-relative-v2`，包含 block id/index、version id、order key、scroll ratio、block 内像素及字符偏移；恢复按 `block_id -> block_index/message_id -> order_key -> scroll_ratio` 降级，并继续读取 v1。重新进入会话时直接请求包含保存 message 的完整 `reader-turn`。Share 的本机位置继续独立保存。

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/conversations/{id}/reading-position` | 获取阅读位置 |
| PUT | `/api/conversations/{id}/reading-position` | 保存 message/block/scroll offset |
| POST | `/api/conversations/{id}/reading-position/sync` | 按基础 revision 幂等同步，返回 applied/conflict 及服务器位置 |
| POST | `/api/conversations/{id}/recent` | 记录最近打开 |
| GET | `/api/recent-items` | 最近项目，仅 active 会话 |

位置读响应增加 `revision`。同步请求为 `{operation_id, base_revision, position}`；
`position` 沿用既有写入字段，anchor JSON 上限 64 KiB。相同账户/operation 重试
返回原回执；同 ID 改内容或会话返回 409。过期基础版本且内容不同返回 conflict，
不覆盖服务器位置；同值无需新增 revision。客户端只有收到相符回执才删除 outbox。
既有 GET/PUT 保持兼容；普通用户不能同步其他用户的位置或读取其回执。

会话生命周期和归属：

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/conversations/{id}/archive` | 软归档并从 active 列表移除 |
| POST | `/api/conversations/{id}/unarchive` | 取消归档并恢复项目归属 |
| DELETE | `/api/conversations/{id}` | 兼容单项硬删除接口；产品批量/列表删除使用后台有序任务，无 Trash/restore |
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
| GET | `/api/shares` | 本人分享分页；`status=all/active/expired/revoked`、`conversation_id`、`q`（对话/分享标题）、`offset`、`limit`（1–100，默认 20）；返回 items/total/has_more，含来源标题和状态 |
| PATCH | `/api/shares/{share_id}` | 更新标题、描述、过期时间或分享选项 |
| POST | `/api/shares/{share_id}/revoke` | 撤销分享 |
| POST | `/api/shares/revoke-batch` | `share_ids` 为 1–100 项；按账户逐项提交，返回 `revoked/not_found/failed`，重复 ID 去重，重试不重复撤销事件 |

上述管理接口按服务器认证的账户及对话归属隔离；Root 的本人列表也不包含
其他账户。汇总查询不公开，响应使用 `Cache-Control: no-store`。撤销优先于过期
状态；归档对话仍在本人范围内。不存在和无权访问的批量目标均返回 `not_found`。
关闭分享策略后，本人列表与撤销继续可用；既有公共端点的策略检查保持不变。

PATCH 只处理明确提交的字段，支持清空标题/说明/有效期/密码，以及
`scope`、`selected_message_ids`、`include_toc/metadata/description/annotations/notebook`
和 `allow_export`。切换为整个对话时清空 selected IDs；所选消息必须是该对话
未删除消息，按有界批次校验。已撤销分享不能编辑或恢复。更新不会生成新 URL。
批量撤销逐项事务提交，失败项回滚；重复或并发撤销只记录一次事件。

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
| POST | `/api/preferences/sync` | 按字段基础版本幂等同步账户偏好，返回已应用字段、冲突字段及当前版本 |

`reader_width_mode` 支持 `compact / standard / wide`；`reader_density_mode` 支持 `compact / comfortable / large`，界面语义为 Markdown 间距；`reader_font_size_px` 范围为 15-22，默认 17。客户端不能提交 `subject_key`；当前服务端身份固定解析为 `local:default`。

## Export

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/conversations/{id}/exports/markdown` | 流式 Markdown v2；支持 metadata、versions、annotations、notebook、message ids 和 TOC 模式 |
| GET | `/api/conversations/{id}/exports/canjson` | 流式 CanJSON v2 JSONL；支持 metadata、versions、annotations、notebook、source refs、message ids 和 gzip |
| POST | `/api/conversations/{id}/exports` | API 兼容多种内部 format；产品 UI 只调用附件 Markdown/CanJSON package |
| GET | `/api/conversations/{id}/export` | 一个兼容周期的旧接口；`canonical_json` 仍映射 CanJSON v1 |
| POST | `/api/system/archive/exports` | 生成系统 `.cr v5`，配置 schema 1；包含无凭据身份、历史附件、格式/规则授权与发布、偏好、既有 Skill 和功能/访问策略，可选择 archived |
| POST | `/api/system/archive/restore` | v4/v5 空实例恢复，保留旧 v5 无配置扩展兼容；可选 multipart `owner_mapping` JSON 字段指定旧账户归属；非空/配置冲突/缺少必要映射或 SMTP 返回 409 |

对话产品 UI 始终导出完整当前对话，只显示 CanJSON/Markdown 与“包含附件”。无附件分别调用流式 `.canjsonl`/`.md`；含附件排队 `.context.zip`/可移植 Markdown ZIP。API 中旧 selection/context format 暂保兼容，但不在新 UI 暴露。`.context.zip` 只含 `manifest.json`、`conversation.canjsonl` 和内容寻址附件对象；manifest 分开记录 conversation/asset completeness。当前对话投影排除 `status=detached` 的 Attachment；系统 `.cr v4` 仍保留历史版本引用。CanJSON metadata-only 仍保留 active Attachment 和 occurrence；Markdown metadata-only 使用人类可读缺失占位。

附件：

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/capabilities` | 上传、scanner provider、未扫描策略、基础/复杂预览和最大文件大小 |
| POST | `/api/conversations/{id}/attachment-upload-sessions` | 创建有期限的普通上传 session，可绑定目标消息/base version |
| POST | `/api/attachment-upload-sessions/{id}/items` | 分块落盘上传一个最长 1 GiB 的暂存项；大附件使用独立 staging 槽位，繁忙时快速返回可重试 429；成功返回 MIME/hash/大小/scan 状态 |
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

系统 `.cr v5` 从 `/api/system/archive/exports` 排队，轮询任务后下载；v4 系统档与旧对话级 `.cr` 仍可读取，但新对话导出 UI 不再生成旧 `.cr`。下载 artifact 默认 24 小时过期。v5 将归档管理员关联目标 Root Admin，普通账户使用新 UUID 且须重设密码，正文/项目/Reader 归属一同更新。v4 的 `owner_mapping` 从来源 UUID（无归属用 `unowned`）映射到已有目标用户 UUID，不静默认领。校验失败为 400，映射参数格式错误为 422。个人导出/预检/新增恢复采用本页开头的 `/api/me/archive/*` 接口，系统恢复仍待任务/UI 整合；当前边界见 [Data Archive Contract](system/DATA_ARCHIVE_CONTRACT.md)。

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
## 2026-09-27 instance merge capacity policy

Root-only `GET /api/admin/features` and `PUT /api/admin/features` include
`maximum_merge_message_count` (`2..100000`, default `1000`).
`POST /api/conversations/merge` counts active canonical Message rows across
the selected conversations before queueing and returns HTTP 422 when that
instance limit would be exceeded. The existing background-task response and
idempotency contract are unchanged for admitted merges.
# Settings completion additions (working tree, 2026-09-30)

- `GET /api/auth/capabilities`: authenticated effective feature policy and limits.
- `POST /api/auth/email-verification/request`: email/password-authenticated
  verification resend, 204 on delivery, 401 credentials, 409 ineligible,
  429 bounded retry, 503 mail unavailable. Does not establish a session.
- `POST /api/auth/email-verification/confirm`: token consumption; returns
  `{verified, approval_required}`. GET never consumes. Invalid/used/expired
  grants return 422. All mutations retain same-origin enforcement.
- `PUT /api/admin/access/registration`: mode plus optional policy flags; omitted
  flags are preserved. SMTP configuration is required to enable verification.
- Existing built-in noise-rule status PATCH now changes only personal
  enablement; other built-in configuration mutations return 403.

Migration: `20260930_0034`; see `system/AUTHENTICATION_CONTRACT.md` and
`system/CONTENT_CLEANUP_CONTRACT.md`. Deployed with `ad223cd` on 2026-10-02;
production mail delivery remains unavailable while SMTP is unconfigured.

Format sharing additions (migration `20260930_0035`, working tree):

- `GET /api/import-formats`: one row per available canonical identity, including
  `held`, `system_provided`, `published_revision_id`, effective current version
  and a safe full-family verification summary. Revisions are filtered by grant
  or current publication before matching and before listing.
- Existing personal PATCH changes only personal name/enablement. Legacy DELETE
  hides the personal entry and preserves grants/history. Relearning restores it.
- `GET /api/admin/import-formats?limit=30&offset=0`: Root Admin candidate page
  with safe revision configuration and validation counts; no sample content,
  source filename, original private name or conversation metadata.
- `PUT /api/admin/import-formats/{id}/publication`: explicit `{revision_id,name}`
  publishes a verified revision; `DELETE` on the same path withdraws public
  availability. Both are audited. Existing grants and admitted imports survive.

This format change uses migration `20260930_0035`; production deployment remains
a separate release step. See `system/ADAPTIVE_IMPORT_CONTRACT.md`.

Noise review safety/workspace additions (migration `20260930_0036`, working tree):

- `GET /api/content-cleanup/scans/{id}/groups`: paginated rule/conversation
  counts, selected counts and protected/conflict counts.
- `GET /scans/{id}/review`: paginated occurrence rows and total, filtered by
  `rule_id`, `conversation_id` and `selected_only`; old `/occurrences` remains.
- `PATCH /scans/{id}/decisions/filter`: `{decision,all_matching:true}` plus
  filters persists a decision across every matching page. Protected candidates
  cannot be deleted by individual or bulk requests.
- `GET /scans/{id}/preview`: complete before/after text, bounded message pages,
  impact counts and a token binding the selected occurrences and source versions.
- `POST /scans/{id}/apply`: optional `{preview_token}` for legacy compatibility;
  the Web supplies it after preview. Stale previews return 409. Explicit saved
  decisions are required, and completed conversation batches are not replayed.
- `POST /scans/{id}/rescan`: fresh scan of the original active conversations;
  the old selection is not silently moved to new source positions.

All paths above share the `/api/content-cleanup` prefix and account ownership
checks. Zero-match results remain readable until dismissed. Current single
head: `20261002_0042`. System promotion is explicit and revision-scoped.

Personal rule learning/exception additions (working tree, 2026-10-01):

- `POST /rules/trial`: configuration plus optional `rule_id`, `base_revision`
  and `conversation_id`; returns a bounded, non-mutating trial and a ten-minute
  account/configuration-bound preview token. Foreign resources return 404.
- `POST /rules/learn`: the trial input, `confirmed:true` and `preview_token`;
  creates a personal rule or appends an immutable revision. Stale configuration,
  expired token or edit-base conflict returns 409. Legacy explicit create/PATCH
  remains supported; PATCH accepts optional `base_revision`.
- `GET /rules/{id}/revisions?limit=20&offset=0`: entitled revision history, with
  the effective personal version first; unavailable private versions are excluded.
- `GET /scans/{id}/occurrences/{occurrence_id}/exception`: exact scope preview.
  `POST` to the same path requires `{confirmed:true,preview_token}` and saves
  an account-local exception idempotently, keeping this candidate unchanged.
- `GET /exceptions?limit=20&offset=0`: own paginated exceptions and total.
  `DELETE /exceptions/{id}` revokes only the current account's exception.

All paths share `/api/content-cleanup`. See the cleanup contract for trial
bounds and exact exception matching; no sample source is persisted by trials.

Noise-rule publication additions (`20261001_0038`, working tree):

- Rule list/read responses include `revision_id`, `held`, `revision_held`,
  `system_provided` and `published_revision_id`. PATCH accepts
  `current_revision_id` for an explicitly selected entitled revision, plus
  `base_revision_id` for optimistic configuration edits. Trial/learn binds the
  same base UUID. Personal deletion hides the entry without destroying grants.
- Root-only `GET /api/admin/noise-rules?limit=30&offset=0` and
  `GET /api/admin/noise-rules/{id}/revisions?limit=20&offset=0` return paged safe
  candidate/configuration results. `PUT /{id}/publication` accepts
  `{revision_id,name}`; `DELETE /{id}/publication` withdraws it. Both are audited.
  Ordinary users cannot invoke these routes.
- `POST /api/adaptive-import/sessions/{id}/families/{family_id}/health` checks
  the owned session's pinned saved format against every group. It returns and
  persists per-group validation, revision and check time, without creating a
  format grant, revision or conversation. The session must remain recoverable.
  Source errors return failed group results; unknown format/session access and
  invalid lifecycle states fail explicitly. Source replacement invalidates the
  prior check. Mapping preview and learning share the same validator.

Preference sync additions (`20261001_0039`, working tree):

- GET/PATCH `/api/preferences` include `reader_default_focus`,
  `annotation_default_position` (`floating`/`docked`) and `field_revisions`.
  Subject identity is always the authenticated account; PATCH changes only
  explicitly submitted fields and increments the revisions of changed values.
- POST `/api/preferences/sync` takes `operation_id` (UUID), `changes` (one to
  twelve supported preference fields), and matching positive `base_revisions`.
  It returns that operation ID, `preferences`, `applied` and `conflicts` fields.
  An independent field applies even if another field conflicts. A stale field
  with the same value converges without another revision increment.
- Same account/operation/payload returns the stored receipt. Changed payload on
  the same operation returns 409. PostgreSQL serializes updates by account.
  Receipts and field revisions never use client wall time to resolve conflicts.


## Administrator directory and content inspection (current)

Root-only additions: `GET /api/admin/access/users/page` (q, state, limit, offset)
and `GET /api/admin/access/users/{id}`. Legacy array listing remains compatible.
Deletion impact/confirmation retain their URLs; repeat keys return the same task,
including after deletion, and mismatched targets return 409. Pending deletion
blocks re-enabling the account. Task results include the target for Root re-entry.

`GET /api/admin/content/users/{id}/conversations/{conversationId}` returns
read-only metadata; `/reader-turn` hydrates the complete turn using administrator
attachment URLs; `/search` returns current-message matches with real anchors,
pagination and literal text matching. Content and attachment lists now audit
reads without requiring a nonempty query. Full contract:
[Administration](system/ADMINISTRATION_CONTRACT.md).
## 帮助与运行状态（2026-10-02，已部署）

- `GET /api/app-info`：已认证账户读取 API 语义版本与镜像构建 revision；未知为 null。
- `GET /api/admin/runtime-status`：仅 Root；返回有界 Worker/任务状态、存储完整性、
  最新系统备份/恢复结果与邮件是否配置。普通账户404，匿名401；不包含业务ID、
  路径、文件名、错误正文或凭据，失败指标显式 unavailable。
- 两者均 no-store；旧 health 响应和内部 loopback diagnostics 保持原边界。
  30秒可见性刷新、统计预算、隐私白名单及离线缓存语义见
  [Observability Contract](system/OBSERVABILITY_CONTRACT.md)。
