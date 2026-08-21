# 部署与运行环境

## Import Preview request boundary

The application limit remains 50 MiB per uploaded import file and Preview
accepts at most one JSON plus one Markdown file. The versioned Nginx config
sets `client_max_body_size 110m` only for the exact
`/api/imports/preview` location, allowing multipart overhead for a maximum-size
pair. The server-wide 60 MiB boundary remains in force for every other route.

Adaptive batches use the separate exact `/api/adaptive-import/sessions`
location with `client_max_body_size 520m`; application limits remain 50 MiB
per file, 512 MiB total and 500 files. No other route inherits this allowance.

## Worker memory boundary

Production Compose sets `import-worker.mem_limit` to `${IMPORT_WORKER_MEMORY_LIMIT:-640m}`. Override it only through the production environment; do not replace `.env.production` and do not remove named volumes. Conversation merge must remain below this limit through bounded canonical copy batches.

Before an incremental production update, create and validate both the PostgreSQL custom-format dump and read-only archives of `import-storage`, `export-storage`, `offline-storage`, and `asset-storage`. Source deployment archives must exclude `.env.production`, named-volume data, user import directories, caches, and browser traces.

The 2026-08-09 Adaptive Viewer rollout used GitHub Actions run `31294947752` for commit `a89bc28`; the archive SHA-256 was verified as `4d48d4d55c461be318c5ccab2b06eaabeefb11e1c32dcb73b2201aa3d833e5be` on both ends. Backup `/opt/chat-reader/backups/adaptive-viewer-20260809T050228Z-a89bc28` contains a validated PostgreSQL custom dump and all four business-volume archives. King only pulled source, loaded images, ran migration and recreated services with `--no-build`; `.env.production`, named volumes and the disabled Scanner policy were unchanged.

最后核验：2026-08-06

本页维护运行边界和配置名称。可复制的本地/生产步骤分别见 [本地开发](../development.md) 与 [生产部署](../deployment.md)。

## 运行拓扑

| 环境 | Web/API | 数据库与文件 | 入口 |
| --- | --- | --- | --- |
| 本地 | Next dev + Uvicorn + worker | 本地 PostgreSQL + storage dirs | `localhost:3000` |
| 生产 | Compose Next standalone + Uvicorn + worker；scanner 为可选 profile | PostgreSQL/import/export/offline/asset named volumes | reverse proxy -> Web |

生产 Compose 的 `migrate` one-shot service 在 API/worker 前执行 Alembic。PostgreSQL 和 API 位于内部 network，宿主机只需暴露 Web；反向代理负责 TLS 和访问控制。

## 环境变量

| 变量 | 所有者 | 用途 |
| --- | --- | --- |
| `APP_NAME`, `APP_ENV` | API/worker | 服务名称和环境 |
| `DATABASE_URL` | migrate/API/worker | PostgreSQL 连接 |
| `POSTGRES_DB/USER/PASSWORD` | Compose | 数据库初始化/连接 |
| `CORS_ORIGINS` | API | 直接跨域请求 origin |
| `PUBLIC_WEB_BASE_URL` | API | Share 等公开 URL base |
| `MAX_IMPORT_FILE_SIZE_MB` | API | 导入大小上限 |
| `IMPORT/EXPORT/OFFLINE/ASSET_STORAGE_DIR` | API/worker | artifact and attachment roots |
| `ATTACHMENT_SCANNER`, `ALLOW_UNSCANNED_ATTACHMENTS` | API/worker | `disabled|clamav|remote` provider 与未扫描对象使用策略 |
| `CLAMAV_HOST/PORT/TIMEOUT`, `REMOTE_SCANNER_URL/TOKEN/TIMEOUT` | API/worker | 可选本地或远程扫描节点；disabled 时不使用 |
| `ASSET_STORAGE_BACKEND`, `ASSET_S3_*` | API/worker | `local` 或可选 S3-compatible 对象存储 |
| `COMPLEX_ATTACHMENT_PREVIEW_ENABLED`, `ATTACHMENT_PREVIEW_ORIGIN` | API/Next build | optional sandboxed Office/archive preview; disabled unless a separate origin is configured |
| `IMPORT_WORKER_POLL_SECONDS`, `IMPORT_STALE_AFTER_SECONDS` | worker/API | queue 轮询与 stale 判断 |
| `IMPORT_COMMIT_INLINE` | 测试/调试 | 绕过 worker 的显式开关 |
| `API_INTERNAL_URL` | Next server | FastAPI upstream |
| `WEB_BIND_ADDRESS`, `WEB_PORT`, `API_WORKERS` | Compose | 进程绑定/并发 |

真实值只存在 `.env`/`.env.production` 或 secret manager，不写入文档。

## 持久化与健康

- named volumes：`postgres-data`、`import-storage`、`export-storage`、`offline-storage`、`asset-storage`；只有启用 `scanner` profile 时才使用 `clamav-data`。
- 附件对象不使用静态公开目录；发布前必须备份 `asset-storage`，迁移/回滚不得删除该 volume。附件 GC 默认 dry-run，只有人工确认后才使用 `apps/api/scripts/gc_assets.py --execute`。
- King 的约 2 GiB 单用户部署固定使用 `ATTACHMENT_SCANNER=disabled`、`ALLOW_UNSCANNED_ATTACHMENTS=true`，不启动 `scanner` profile 或 ClamAV。当前部署主动关闭附件恶意软件扫描和内容安全审查。附件以 `scanner_disabled`/`unscanned` 状态正常使用，中文 UI 显示“未扫描”。这是当前单用户部署的已接受策略，不代表文件已经通过安全检测。Scanner Provider 抽象保留，但本轮不部署本地或远程扫描节点。消息保存不重新读取或扫描已提升的附件对象。
- 复杂附件预览默认关闭。未配置独立 preview origin 时 Office/ZIP 只下载；HTML 可作为转义文本读取，SVG 只通过浏览器图片上下文展示，不作为可执行文档注入。
- healthcheck：PostgreSQL、API、Web；worker 通过进程、日志和 job heartbeat 观察。
- Docker json-file 日志已配置轮转；仓库没有集中式日志/APM。
- `deploy/backup.sh` 生成 PostgreSQL custom-format dump；Release M 的五部分
  备份校验、隔离恢复前置检查和完整性审计见
  `docs/system/DISASTER_RECOVERY_RUNBOOK.md`、
  `deploy/recovery_preflight.py` 与 `deploy/recovery_integrity.py`。

## 运行约束

- 运行时必须是 PostgreSQL；没有 SQLite fallback。
- King 约 2 GiB 主机不得执行 Next production build。2026-08-06 即使先暂停约 418 MiB 的 worker，构建仍使 PostgreSQL checkpointer 被 OOM kill；数据库完成 WAL 恢复，随后 custom dump 已通过 `pg_restore -l`。后续必须在 CI/独立 Linux 构建机生成镜像，通过 registry 或 `docker save/load` 交付。
- `.github/workflows/build-release-images.yml` 提供手动 Linux runner 构建：同步 GitHub 后生成 API/worker/migrate/Web 镜像归档；King 只拉取对应提交、校验并 `docker load`，再运行 migration 并使用 `docker compose --no-build` 更新服务。2026-08-06 的源码附件发布运行 `31083578130` 已用提交 `af17c93` 完成该链路，发布前备份为 `/opt/chat-reader/backups/release-20260806T081207Z-af17c93`。该流程不得覆盖 `.env.production` 或删除 named volumes。
- 2026-08-08 的附件呈现与任务清单发布使用提交 `65585eb40ca1ad44eaeb2ebbe8b6d6be309ddcdc`、GitHub Actions run `31242030506` 和归档 SHA-256 `ef3480b2c0afa3b69ed342e53c602ca5028d523561f7859a196683c0af8ea18d`。有效发布前备份为 `/opt/chat-reader/backups/release-20260808T053116Z-4983a8d`；King 仅执行 `git pull --ff-only`、`docker load`、migration 和 `--no-build` 重建。部署后 API/Web/PostgreSQL healthy、worker running、Alembic 为 `20260806_0021 (head)`，ClamAV 继续停止。请求的 Chrome 扩展未连接，因此本批次生产视觉点击验收仍为 `NOT_PRODUCTION_VERIFIED`。
- 2026-08-09 Attachment Viewer 最终发布提交为 `5baea32cdada3ed22ae01268cac128f88fa9f527`。首次 run `31267864860` 暴露 Docker builder 640 MiB heap OOM；修正只作用于外部构建阶段，run `31268057540` 和最终 run `31269172465` 均成功。最终归档 SHA-256 为 `55a53e8606ae1e404255729dbb566172913997b3678648e3630b95be73400f6e`；发布前备份 `/opt/chat-reader/backups/release-20260808T170034Z-254b5bb` 包含已验证 PostgreSQL dump 和四个业务卷。King 仅执行 `git pull --ff-only`、`docker load`、migration 与 `--no-build` 服务更新；PostgreSQL 未重启，API/Web/PostgreSQL healthy、worker running、Alembic `20260806_0021`、ClamAV stopped。真实 Chrome 核心 Viewer 验收 PASS；条件 PWA/Offline 与可选复杂 Viewer 仍按各自状态记录。
- 2026-08-10 lifecycle stabilization release 使用 commit `200cf9e` 和 Actions run `31362680316`。`chat-reader-images.tar.gz` SHA-256 `f864e609c5a108e8fd98545d73d1ff037f4e39a7ff2257a7da6b7a61d7310154` 双端校验通过；备份 `/opt/chat-reader/backups/stabilization-20260810T064736Z-200cf9e` 包含验证过的 PostgreSQL dump 与四个业务卷归档。King 从已加载镜像执行 migration，再以 `up -d --no-build --no-deps` 重建 API/worker/Web。API/Web/PostgreSQL healthy、worker running、Alembic `20260806_0021`、Scanner disabled。此次 Chrome bridge 不可再用，部署后真实点击验收保持 `NOT_PRODUCTION_VERIFIED`，不得用 health 替代。
- Library 离线冷启动需要先在线准备壳并下载资料。
- 生产 OpenAPI 不通过 `/api/openapi.json` 暴露是当前代理边界，不表示业务 API 缺失。
- 仓库 `deploy/nginx-chat-reader.conf` 是示例；真实 TLS/证书配置位于仓库外。

## 最后生产证据

2026-07-29 的执行档案记录 production migration `20260728_0016`、Web 离线 TOC 补丁和服务健康。该记录不能替代下一次部署前的只读检查。详见 [执行档案](../execution/README.md)。
Release A freezes three runtime invariants: production requires a non-default `ATTACHMENT_CURSOR_SECRET`; Alembic preserves percent-encoded database URLs; and deployable images can only be produced after the repository quality gate succeeds. Security-header and provenance details are in [Release Safety Baseline](RELEASE_SAFETY_BASELINE.md).
