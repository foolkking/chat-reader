# 本地 OpenAPI 盘点记录

日期：2026-07-26
来源：在本地导入 `apps/api/app/main.py` 的 FastAPI `app` 并调用只读 `app.openapi()`。
结果：67 个 path templates，79 个 operations，API version `0.12.0`。

## 路由分组

| 分组 | 主要 path templates |
| --- | --- |
| Health | `/api/health`, `/health` |
| Conversations | `/api/conversations`, `/api/conversations/{conversation_id}`, `/merge`, `/order`, `/{id}/pin`, `/{id}/project`, `/{id}/split`, `/{id}/auto-clean`, `/{id}/recent` |
| Reader/TOC | `/{id}/messages`, `/{id}/message-window`, `/{id}/dialogue-index`, `/{id}/toc`, `/api/messages/{message_id}/blocks` |
| Messages/versions | `/api/messages/{message_id}`, `/merge`, `/split`, `/versions`, `/versions/{version_id}/restore` |
| Reading/recent | `/{id}/reading-position`, `/api/recent-items`, Project recent endpoints |
| Projects | `/api/projects`, `/order`, `/{project_id}`, `/{project_id}/conversations`, conversation order/pin |
| Search | `/api/search`, `/api/search/reindex` |
| Import/tasks | `/api/imports/preview`, `/{import_id}/commit/status/warnings/source-artifacts`, `/api/imports/active`, `/api/tasks/active/{job_id}/retry` |
| Export | conversation export/create artifact, `/api/exports/{artifact_id}/download` |
| Share | conversation share list/create, `/api/shares/{share_id}`, `/revoke`, `/api/shared/{token}` and token-limited reader/annotation/notebook/TOC/block endpoints |
| Annotation/notebook | conversation annotation CRUD, `/api/annotations/{annotation_id}`, `/api/annotations/sync`, notebook GET/PUT/conflicts |
| Offline | `/api/offline/catalog`, `/api/offline/packages`, `/{package_id}`, `/{package_id}/download` |
| Preferences | `/api/preferences` |

完整可执行定义以 `apps/api/app/routes/*.py` 为准；本记录不保存 schema 示例中的生产数据。
