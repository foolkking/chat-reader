# 后端与 API

最后核验日期：2026-07-26

## 技术结构

- Python `>=3.11`，FastAPI `>=0.115,<1`，Uvicorn，SQLAlchemy 2，Alembic，Pydantic Settings，psycopg 3，python-multipart。后端没有独立 lock 文件，因此不宣称精确安装版本。
- 入口 `apps/api/app/main.py`，API metadata version `0.12.0`。
- 分层：`routes/` 负责 HTTP/schema，`services/` 负责 import、canonical、editing、reader、search、share、export、offline、annotation 等业务，`models/` 负责数据库实体。
- CORS origins 可配置；生产浏览器通常使用 Next 同源 rewrite。
- 没有 auth middleware、SSE、WebSocket、Redis、AI model client、限流或计费中间件。

## API 清单

本地 OpenAPI 共 67 path templates / 79 operations。下表按资源合并方法；请求/响应精确 schema 以 `apps/api/app/schemas/` 和 OpenAPI 为准。

| 方法 | API | 用途 | 鉴权 | 主要输入/输出 | 前端调用 | 后端实现 | 验证 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/health`, `/health` | 健康检查 | 无 | status/service/stage | 部署检查 | `routes/health.py` | 生产 200 |
| GET | `/api/conversations` | scope/status/project/sort 列表 | 无 | list items、分页/limit 参数 | sidebar/lists | `routes/conversations.py` | 生产 200 |
| GET/PATCH/DELETE | `/api/conversations/{id}` | 详情、标题/description/status、删除 | 无 | conversation detail/update | lists/Reader | 同上 | GET 链路已验证；写未执行 |
| POST/PUT | `/api/conversations/merge`, `/order` | 有序合并、全局排序 | 无 | IDs/order | selection/list | conversations service | 代码/测试 |
| PATCH/PUT | `/api/conversations/{id}/pin`, `/project` | 置顶、移动 Project | 无 | pin/project | sidebar | routes/services | 代码/测试 |
| POST | `/api/conversations/{id}/split`, `/auto-clean`, `/recent` | 拆分、清理、记录最近 | 无 | message/cleanup context | Reader | editing/reading services | 代码/测试 |
| GET | `/api/conversations/{id}/messages`, `/message-window` | 全量页或锚点窗口 | 无 | anchor/direction/limit | ReaderDataSource | reader routes/services | 线上 Reader 验证 |
| GET | `/api/conversations/{id}/dialogue-index`, `/toc` | U/A 索引与 headings | 无 | anchor/page/message | TOC | toc/reader service | 线上验证 |
| GET/PATCH | `/api/messages/{message_id}` | message detail/update | 无 | Markdown/version | editing | `routes/messages.py` | 代码/测试 |
| GET | `/api/messages/{message_id}/blocks`, `/versions` | block range/版本列表 | 无 | start/end/version | Reader/editing | messages service | Reader 验证 |
| POST | `/api/messages/merge`, `/{message_id}/split`, `/versions/{version_id}/restore` | 消息合并/拆分/恢复 | 无 | IDs/offset/version | editing UI | editing services | 代码/测试 |
| GET/PUT | `/api/conversations/{id}/reading-position` | 阅读位置 | 无，固定 subject | message/block/offset/anchor | Reader | reading service | 代码/API |
| GET/POST | `/api/recent-items`, conversation/Project recent endpoints | 最近打开 | 无，固定 subject | recent rows | recent page/Reader | reading routes | `/recent` 200 |
| GET/POST/PATCH/DELETE | `/api/projects*` | Project CRUD、排序、对话关系/pin/recent | 无 | project/relationship/order | sidebar/project pages | `routes/projects.py` | GET 生产 200；写未执行 |
| GET/POST | `/api/search`, `/api/search/reindex` | 检索/重建索引 | 无 | q/filter/page/results | search pages | search service/indexer | 查询已验证；reindex 未执行 |
| POST/GET | `/api/imports/preview`, `/{id}/commit/status/warnings/source-artifacts`, `/active` | 导入两阶段流程 | 无 | multipart/import status | ImportDialog | `routes/imports.py` | 入口验证；生产未提交 |
| GET/POST | `/api/tasks/active`, `/{job_id}`, `/{job_id}/retry` | durable job 状态/重试 | 无 | job DTO | TaskMonitor | `routes/tasks.py` | worker 状态验证 |
| GET/POST | `/api/conversations/{id}/export`, `/exports` | 直接导出/后台 artifact | 无 | format/scope/include flags | export panel | export/archive service | 代码/测试 |
| GET | `/api/exports/{artifact_id}/download` | 下载 artifact | 无 | file response | browser download | exports route | 代码/测试 |
| GET/POST | `/api/conversations/{id}/shares` | 列表/创建 Share | 无 | scope/expiry/options；创建返回 token | share panel | `routes/shares.py` | 面板验证 |
| PATCH/POST | `/api/shares/{share_id}`, `/revoke` | 延期/重生设置/撤销 | 无 | share updates | share panel | share service | 代码/面板 |
| GET | `/api/shared/{token}` 及其 message-window/dialogue-index/toc/blocks/annotations/notebook | token 只读 Reader | URL token | 授权范围内容 | share reader | shared routes | 代码；生产 token 页面待验证 |
| GET/POST/PATCH/DELETE | conversation annotations 与 `/api/annotations/{id}` | 批注 CRUD | 无，固定 subject | anchor/type/color/comment/revision | annotation repository | `routes/annotations.py` | 面板/代码 |
| POST | `/api/annotations/sync` | 离线 outbox 幂等同步 | 无，固定 subject | operations/base revision | OfflineSyncManager | annotation sync service | 代码/测试 |
| GET/PUT | conversation notebook/conflicts | 精选笔记和冲突 | 无，固定 subject | blocks/revision | AnnotationWorkspace | notebook service | 代码/测试 |
| GET | `/api/offline/catalog` | 离线 revision、可下载对象和估算 | 无，固定 subject | catalog | LibraryShell | `routes/offline.py` | 生产 200 |
| POST/GET | `/api/offline/packages`, `/{package_id}`, `/download` | 生成/查询/下载紧凑包 | 无，固定 subject | scope/IDs/artifact | LibraryShell | offline package service | 页面/代码 |
| GET/PATCH | `/api/preferences` | 读取/同步偏好 | 无，固定 subject | preferences | provider | preferences route | 生产 200 |

生产 `/api/openapi.json` 返回 404；这只说明 schema 未通过当前同源代理公开。完整脱敏分组见 `docs/evidence/request-records/LOCAL_OPENAPI_2026-07-26.md`。

## 关键数据流

### 导入

```text
本地文件 -> ImportDialog multipart preview
-> source detector/parser/aligner -> source_artifacts + imports preview
-> 用户 commit -> background_jobs
-> import worker -> canonical transaction
-> messages/versions/blocks/headings/search_documents -> 前端 query 刷新
```

### 长对话阅读与定位

```text
对话/TOC/搜索/批注目标
-> ReaderDataSource 获取 dialogue anchor + centered message window
-> blocks + headings context
-> 前端原子替换窗口并挂载 DOM
-> quote/prefix/suffix 或 offset 校准
-> block/message fallback
-> 保存 reading position/recent
```

### 离线包

```text
Library catalog -> POST package scope
-> background job -> ZIP artifact（当前版本/必要元数据）
-> browser download -> Dexie transaction
-> local Reader/search
-> annotation/notebook outbox -> sync API -> receipt/conflict copy
```

### Share

```text
创建 options/scope -> 随机 token（仅创建响应返回）
-> DB 保存 hash/prefix -> /share/[token]
-> /api/shared/{token} 校验 hash/expiry/revoked/options
-> 只读窗口/TOC/可选私有内容和导出
```

## 错误、日志与后台处理

- 没有自定义全局错误 envelope；业务多使用 FastAPI `HTTPException`，响应通常为 `detail`，validation 使用 FastAPI 422 结构。
- import/background worker 使用 Python logging；Uvicorn/Compose 提供进程和访问日志。仓库未发现 Sentry/OpenTelemetry 等外部监控。
- durable job 表承载 import、export archive、offline package 等任务；worker 按排队时间轮询，并有 stale/retry 逻辑。
- 未发现应用级限流、配额/余额或会员校验；浏览器离线“quota”仅指 Storage API 容量。

