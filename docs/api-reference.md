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
| POST | `/api/imports/{import_id}/commit` | 提交 preview 对应的 canonical 导入 |

## Conversations

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/conversations` | 会话列表；支持状态、Project 等 query |
| GET | `/api/conversations/{id}` | 会话详情 |
| PATCH | `/api/conversations/{id}` | 重命名、归档或恢复 |
| DELETE | `/api/conversations/{id}` | 软删除 |
| POST | `/api/conversations/merge` | 按请求顺序非破坏式合并多个会话 |
| POST | `/api/conversations/{id}/split` | 从连续消息范围创建新会话 |
| PATCH | `/api/conversations/{id}/pin` | 修改全局置顶 |
| GET | `/api/conversations/{id}/events` | 管理和编辑事件 |
| GET | `/api/conversations/{id}/messages` | 消息分页列表 |
| GET | `/api/conversations/{id}/message-window` | 消息窗口；支持 offset、limit、anchor message/order key |
| GET | `/api/conversations/{id}/toc` | canonical heading TOC |

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
| POST | `/api/projects/{id}/conversations/{conversation_id}` | 加入 Project |
| DELETE | `/api/projects/{id}/conversations/{conversation_id}` | 移出 Project |
| PATCH | `/api/projects/{id}/conversations/{conversation_id}/pin` | Project 内置顶 |
| POST | `/api/conversations/{id}/projects/{project_id}` | conversation 侧兼容加入接口 |
| DELETE | `/api/conversations/{id}/projects/{project_id}` | conversation 侧兼容移出接口 |

## Search And TOC

`GET /api/search` 接受 `q`、`limit`、`offset`、`conversation_id`、`project_id` 和 `document_type`。`document_type` 当前使用 `conversation`、`message` 或 `heading`。

`POST /api/search/reindex` 重建 canonical 搜索文档，属于管理操作；当前没有认证，公网部署应在反向代理层限制访问。

TOC 使用 `GET /api/conversations/{id}/toc`。返回 heading 带 message id、block index、level、title、anchor 和顺序信息。

## Reading

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/conversations/{id}/reading-position` | 获取阅读位置 |
| PUT | `/api/conversations/{id}/reading-position` | 保存 message/block/scroll offset |
| POST | `/api/conversations/{id}/recent` | 记录最近打开 |
| GET | `/api/recent-items` | 最近项目 |

## Shares

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

接口的精确 request/response schema 以运行时 `/openapi.json` 和 `apps/api/app/schemas` 为准。
