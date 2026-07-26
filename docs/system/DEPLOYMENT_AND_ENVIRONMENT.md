# 部署与运行环境

最后核验日期：2026-07-26

## 本地启动与构建

前置：Node.js/Corepack、pnpm 9、Python 3.11+、PostgreSQL。

```powershell
Copy-Item .env.example .env
corepack pnpm install
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e "./apps/api[dev]"
alembic -c apps/api/alembic.ini upgrade head
pnpm dev
```

常用只读/验证命令来自 root/apps package scripts：

```text
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web build
pnpm --filter web test:pwa
cd apps/api && pytest
```

本阶段没有执行构建或测试，因为任务边界是事实盘点与文档。

## 生产拓扑

```text
Internet HTTPS
  -> Nginx :443/:80
  -> Next Web 127.0.0.1:3000
       -> /api/* rewrite -> FastAPI container
  -> PostgreSQL 16 container
  -> import/background worker container
  -> import/export/offline named volumes
```

- 生产仓库：`/opt/chat-reader`。
- Compose：`docker-compose.production.yml`，环境来源 `.env.production`。
- Web image：Next standalone production server；仅绑定 host loopback `127.0.0.1:3000`。
- API：Uvicorn workers 数量由环境配置。
- `migrate` one-shot service 在依赖健康后执行 Alembic，再启动 API/worker。
- 2026-07-26 只读核验：API/Web/PostgreSQL healthy，import worker running，migration `0015 head`。

## Next 与代理

- `next.config.mjs` 将浏览器同源 `/api/:path*` rewrite 到 `API_INTERNAL_URL`。
- `/library`、manifest、Service Workers、offline 和动态页面配置 no-cache/no-store 头，避免壳控制脚本被陈旧缓存。
- 仓库 `deploy/nginx-chat-reader.conf` 是 HTTP 示例，包含 Web 反代和上传大小设置；生产实际 HTTPS/TLS 配置位于仓库外，状态为 `部分确认`。
- 公网响应标识 Nginx；生产 HTTPS 可访问。

## 环境变量（只记录名称和用途）

| 变量 | 用途 | 位置 |
| --- | --- | --- |
| `APP_NAME`, `APP_ENV` | API 名称/环境 | FastAPI settings |
| `DATABASE_URL` | PostgreSQL 连接 | API/migrate/worker |
| `CORS_ORIGINS` | 允许的浏览器 origin | API |
| `MAX_IMPORT_FILE_SIZE_MB` | 导入文件上限 | API |
| `IMPORT_STORAGE_DIR` | source artifact 路径 | API/worker |
| `EXPORT_STORAGE_DIR` | export artifact 路径 | API/worker |
| `OFFLINE_STORAGE_DIR` | offline package 路径 | API/worker |
| `PUBLIC_WEB_BASE_URL` | share 等公开 URL base | API |
| `IMPORT_COMMIT_INLINE` | commit inline/queue 开关 | API |
| `IMPORT_WORKER_POLL_SECONDS` | worker 轮询间隔 | worker |
| `IMPORT_STALE_AFTER_SECONDS` | stale import/job 判定 | API/worker |
| `API_INTERNAL_URL` | Next 服务端 API upstream | Web |
| `WEB_BIND_ADDRESS`, `WEB_PORT`, `API_WORKERS` | 生产进程绑定/并发 | Compose |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | PostgreSQL 初始化 | Compose |

实际值位于 `.env`/`.env.production`，不得写入文档。

## 备份、日志与健康

- `deploy/backup.sh` 使用 `pg_dump -Fc` 写入 `backups/`；保留周期/异地复制/恢复演练未在仓库确认。
- 生产已有未跟踪 `backups/`，本次没有读取或修改。
- 日志通过 Docker/Uvicorn/Python logging 查看；仓库未配置独立日志收集、APM 或告警服务。
- Compose health checks 覆盖 PostgreSQL/API/Web；worker 无单独 healthcheck，通过进程状态和 job 状态观察。

## 开发与生产差异

| 项目 | 开发 | 生产 |
| --- | --- | --- |
| Web/API | pnpm dev + local Uvicorn | Docker images/Next standalone/Uvicorn workers |
| 数据库 | 开发 PostgreSQL URL | Compose PostgreSQL volume |
| API 地址 | 环境或默认 localhost | 容器内部 `API_INTERNAL_URL`，浏览器仍同源 `/api` |
| TLS | 通常无 | Nginx HTTPS，实际证书配置仓库外 |
| 文件 | 本地 storage dirs | named volumes |

## 已知运行约束

- PostgreSQL 是运行必需，不存在 SQLite fallback。
- 完整离线冷启动要求设备至少在线成功准备一次 `/library` 壳并下载资料。
- 浏览器离线数据受 quota、持久化授权和清除站点数据影响。
- 生产 OpenAPI schema 未通过 `/api/openapi.json` 暴露。

