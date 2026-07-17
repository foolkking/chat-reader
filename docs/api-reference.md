# API 参考

所有业务接口以 `/api` 为前缀。浏览器应使用相对 URL，不应直接拼接 FastAPI 的主机或端口。

## Health

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/health` | FastAPI 直接健康检查 |
| GET | `/api/health` | 同源代理和容器健康检查 |

## Imports

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/imports/preview` | multipart 上传并返回识别、preview 和 warnings |
| GET | `/api/imports/{import_id}/source-artifacts` | 查看 source artifact 元数据 |
| GET | `/api/imports/{import_id}/warnings` | 查看导入 warning |
| POST | `/api/imports/{import_id}/commit` | 幂等排队；queued/processing 返回 `202`，committed 返回 `200` |
| GET | `/api/imports/{import_id}/status` | 查询阶段、百分比、消息进度、结果或错误 |
| GET | `/api/imports/active` | 返回 queued、processing 和待处理 failed 任务 |

Import 状态为 `previewed / queued / processing / committed / failed`。failed 任务可再次调用 commit 重试；worker 超过五分钟没有 heartbeat 时会自动重新排队。

## Conversations

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/conversations` | 会话列表；`scope=history` 只返回未归类或归属已归档 Project 的 active 会话 |
| GET | `/api/conversations/{id}` | 会话详情 |
| PATCH | `/api/conversations/{id}` | 重命名、归档或恢复 |
| DELETE | `/api/conversations/{id}` | 软删除 |
| POST | `/api/conversations/merge` | 按请求顺序排队非破坏式合并，返回 `202 BackgroundTaskRead` |
| POST | `/api/conversations/{id}/split` | 从连续消息范围创建新会话 |
| PATCH | `/api/conversations/{id}/pin` | 修改全局置顶 |
| GET | `/api/conversations/{id}/events` | 管理和编辑事件 |
| GET | `/api/conversations/{id}/messages` | 消息分页列表 |
| GET | `/api/conversations/{id}/message-window` | 消息窗口；支持 offset、limit、anchor message/order key |
| GET | `/api/conversations/{id}/dialogue-index` | 轻量对话索引，不返回完整正文 |
| GET | `/api/conversations/{id}/toc` | canonical heading TOC；支持 message/offset/limit/max level |
| POST | `/api/conversations/{id}/exports` | 排队生成 `.cr` 快速归档 |
| POST | `/api/conversations/{id}/auto-clean` | 排队清理历史 assistant 思考/搜索前缀 |

## Messages

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/messages/{id}` | 消息详情 |
| PATCH | `/api/messages/{id}` | 创建编辑版本 |
| GET | `/api/messages/{id}/blocks` | 当前版本 RenderBlock 分页 |
| GET | `/api/messages/{id}/versions` | 版本历史 |
| POST | `/api/messages/{id}/versions/{version_id}/restore` | 基于历史快照创建恢复版本 |
| POST | `/api/messages/{id}/split` | 按字符 offset 拆分消息 |
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

## Background Tasks

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/tasks/active` | 返回 queued、processing 和 failed 的 import/merge/export/auto-clean 任务 |
| GET | `/api/tasks/{job_id}` | 查询统一任务阶段、进度、结果或错误 |
| POST | `/api/tasks/{job_id}/retry` | 重试 failed 任务 |

Conversation merge 可携带 `Idempotency-Key` 请求头。相同 key 的 queued、processing 或 committed 请求返回已有任务，不会重复创建结果。

## Search And TOC

`GET /api/search` 接受 `q`、`limit`、`offset`、`conversation_id`、`project_id`、`document_type` 和 `role`。`document_type` 当前使用 `conversation`、`message` 或 `heading`。重复 message 结果通过 `occurrence_count` 表示跨会话出现次数。

`POST /api/search/reindex` 重建 canonical 搜索文档，属于管理操作；当前没有认证，公网部署应在反向代理层限制访问。

TOC 使用 `GET /api/conversations/{id}/toc`。返回 heading 带 message id、block index、level、title、anchor 和顺序信息。

## Reading

阅读位置由服务端身份解析器绑定到 `local:default`，客户端不能提交身份字段。`anchor_data.position_mode=block-relative-v1` 时，位置由 message、block、最近 heading 和 block 内像素偏移共同确定；重新进入会话时首个 message window 直接使用保存的 `anchor_message_id`。

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/conversations/{id}/reading-position` | 获取阅读位置 |
| PUT | `/api/conversations/{id}/reading-position` | 保存 message/block/scroll offset |
| POST | `/api/conversations/{id}/recent` | 记录最近打开 |
| GET | `/api/recent-items` | 最近项目 |

## Shares

公开分享采用轻量 bootstrap 和 token 约束分页，不允许通过分享 token 调用内部 conversation/message API：

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/shared/{token}` | Share 与 conversation 元数据，不包含完整消息和 TOC |
| GET | `/api/shared/{token}/message-window` | 30 条消息窗口，支持 `anchor_message_id` |
| GET | `/api/shared/{token}/dialogue-index` | 分页对话索引，支持围绕目标消息加载 |
| GET | `/api/shared/{token}/toc` | 当前消息或指定范围的章节目录 |
| GET | `/api/shared/{token}/messages/{message_id}/blocks` | 授权消息的 RenderBlock 分页 |

所有分页接口都会重新验证 token、有效期、撤销状态和 `selected_messages` 范围。Share 阅读位置只保存在访问浏览器的 localStorage，不写入服务器。

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/conversations/{id}/shares` | 创建分享链接 |
| GET | `/api/conversations/{id}/shares` | 管理该会话的分享链接 |
| PATCH | `/api/shares/{share_id}` | 修改标题、描述或过期时间 |
| POST | `/api/shares/{share_id}/revoke` | 撤销链接 |
| GET | `/api/shared/{token}` | 无需登录的只读分享数据 |

## Export

`GET /api/conversations/{id}/export` 支持：

- `format=markdown` 或 `format=canonical_json`。
- `include_metadata`、`include_toc`、`include_versions`。
- `message_ids`：逗号分隔的消息 id，用于范围导出。

`.cr` 使用后台任务：先调用 `POST /api/conversations/{id}/exports`，轮询 `/api/tasks/{job_id}`，任务完成后使用结果中的 `/api/exports/{artifact_id}/download`。下载文件默认 24 小时过期。

接口的精确 request/response schema 以运行时 `/openapi.json` 和 `apps/api/app/schemas` 为准。
