# API 参考

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
| POST | `/api/imports/bundles/preview` | 流式暂存 `.crbundle` 并异步校验 canonical、附件索引和对象 |
| GET | `/api/imports/{import_id}` | 查询 preview、Draft 校验和、到期时间和任务状态 |
| DELETE | `/api/imports/{import_id}` | 只清理已过期且未提交的 preview/Draft，其他状态返回 409 |
| GET | `/api/imports/{import_id}/source-artifacts` | 查看 source artifact 元数据 |
| GET | `/api/imports/{import_id}/warnings` | 查看导入 warning |
| POST | `/api/imports/{import_id}/commit` | 幂等排队；queued/processing 返回 `202`，committed 返回 `200` |
| GET | `/api/imports/{import_id}/status` | 查询阶段、百分比、消息进度、结果或错误 |
| GET | `/api/imports/active` | 返回 queued、processing 和待处理 failed 任务 |

产品导入有三类入口：兼容 JSON 必需、Markdown 可选配对；附件 `.crbundle`；旧 `.cr` 兼容归档。CanJSON v1/v2 由 JSON 控件自动识别。JSON 保持 metadata/role/time 和冲突判定权威；配对 Markdown 的标题候选只有在角色、规范化时间和顺序形成唯一最佳完整路径时才作为真实边界，其余候选保留在正文中。`.crbundle` 使用 CanJSONL 作为 canonical truth，兼容原生 attachment bundle 与 `chat-reader-import-bundle v1`；JSON/Markdown 只做一致性报告。官方 OpenAI 图/ZIP、CSV、TXT 和 Markdown 单文件返回 `422 unsupported_source_profile`。Preview 生成带 SHA-256 和到期时间的受控 Draft；Commit 校验并读取同一 Draft。Import 状态为 `previewed / queued / processing / committed / failed`。

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

对话产品 UI 始终导出完整当前对话，只显示 CanJSON/Markdown 与“包含附件”。无附件分别调用流式 `.canjsonl`/`.md`；含附件排队 `.context.zip`/可移植 Markdown ZIP。API 中旧 selection/context format 暂保兼容，但不在新 UI 暴露。`.context.zip` 只含 `manifest.json`、`conversation.canjsonl` 和内容寻址附件对象；manifest 分开记录 conversation/asset completeness。CanJSON metadata-only 仍保留 Attachment 和 occurrence；Markdown metadata-only 使用人类可读缺失占位。

附件：

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/imports/bundles/preview` | 流式接收 `.crbundle`，异步校验 ZIP、哈希、MIME、扫描和引用 |
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
