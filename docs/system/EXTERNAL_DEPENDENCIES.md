# 外部依赖

最后核验日期：2026-07-26

## 运行服务

| 服务 | 用途 | 调用位置 | 配置变量 | 失败影响 | 降级 | 验证状态 |
| --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL 16 | canonical、索引、任务、分享、批注等主数据 | SQLAlchemy services | `DATABASE_URL`, Postgres vars | 在线管理/API 不可用 | 已下载 `/library` 仍可读；在线无 DB fallback | 生产 healthy |
| 本机/volume 文件系统 | import/export/offline artifacts | import/export/offline services | 三个 `*_STORAGE_DIR` | 对应上传、下载或包任务失败 | 原 canonical DB 数据不因 artifact 失败自动删除 | 生产 volume 配置确认 |
| Nginx | HTTPS 和反向代理 | 生产前置 | 仓库无实际 TLS 变量 | 公网不可达 | 可在服务器回环健康检查 | 公网响应确认；配置部分确认 |
| 浏览器 Service Worker/Cache/IndexedDB/Storage API | PWA 壳、离线数据、配额 | `apps/web/public`, offline libs | 无密钥 | 离线冷启动/本地资料不可用 | 在线页面和服务器数据不受本地删除影响 | 代码与生产入口确认 |

## 前端/后端软件依赖

Next/React、TanStack Query、Dexie/FlexSearch、Markdown/Shiki/KaTeX/Mermaid、FastAPI/SQLAlchemy/Alembic/psycopg 等均从包生态安装。它们是构建/运行库，不是由应用在运行时调用的外部业务 API。精确前端版本见 `FRONTEND_ARCHITECTURE.md`，后端仅有版本范围。

## 经搜索未发现的第三方业务服务

| 类别 | 当前状态 | 证据范围 |
| --- | --- | --- |
| OpenAI/其他 AI 模型 API | 不适用 | 无 SDK、模型配置、生成 route、SSE/WebSocket；README 明确不是在线机器人 |
| 对象存储/OSS/S3 | 未发现 | 文件服务和 Compose 使用本地/volume 路径 |
| 外部登录/OAuth | 不适用 | 无 auth route/dependency/config |
| 支付/会员 | 不适用 | 无 billing/member model/route/UI |
| 邮件/短信 | 不适用 | 无 client/config |
| CDN/图片变换服务 | 未发现 | 静态资源由 Next/Nginx 提供；图片来自导入内容/链接 |
| 文档解析 SaaS | 未发现 | parser 位于 `services/import_pipeline` |
| 监控/统计/APM | 未发现 | 无 Sentry/OTel/analytics 配置；只有应用/容器日志 |

“未发现”限于 2026-07-26 当前仓库和可见生产响应，不代表基础设施账户层面绝对不存在。

