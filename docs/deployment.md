# 生产部署

## 2026-08-10 release evidence

### Focus lifecycle closure

Commit `ed9116abd496684a1bb50c2e5891d4bc0879e05e` was built externally by GitHub Actions run `31374507130`. King verified release archive SHA-256 `a6132d7801253da105893967a87e373a151587795c1c220ecb741f53bba1788b`, ran the production-compose migration preflight, and recreated API, import-worker and Web with `--no-build`. PostgreSQL and existing imports were backed up with verified checksums at `/opt/chat-reader/backups/stabilization-20260810T0815Z-248b771`; storage directories absent on the server were not fabricated as successful archives. No volume or `.env.production` was modified, ClamAV remained disabled, Alembic stayed at `20260806_0021`, and final API/Web/PostgreSQL health checks passed.

### Lifecycle stabilization release

Commit `200cf9ea01c57a2ab5fa344688a4a77f70c154b9` was built externally by GitHub Actions run `31362680316`. The image archive SHA-256 was verified locally and on King as `f864e609c5a108e8fd98545d73d1ff037f4e39a7ff2257a7da6b7a61d7310154`. Before update, King created `/opt/chat-reader/backups/stabilization-20260810T064736Z-200cf9e` with a validated PostgreSQL custom dump and read-only import/export/offline/asset volume archives plus checksums. King fast-forwarded source, loaded the prebuilt archive, ran the existing migration preflight, and recreated API, worker and Web only with `--no-build`; `.env.production`, PostgreSQL and all named volumes were unchanged. Post-deploy API/Web/PostgreSQL are healthy, worker is running, `/api/health` is `ok`, capabilities retain Scanner `disabled`, and Alembic remains `20260806_0021`.

The remote Compose version does not support `run --no-build`; it never ran that unsupported command successfully. Migration used `docker compose ... run --rm migrate`, which consumed the already loaded `chat-reader-migrate:latest` image. The service recreation still used `up -d --no-build --no-deps`.

Commit `5cc491f3a8a1b398735c0e5b84629731a13da0bf` was built by GitHub Actions run `31325841867` and deployed from archive SHA-256 `d75a66b214932a542fc39f8630f674128f134b61eb51445da59eb75cce117f17`. PostgreSQL and business-volume backup completed at `/opt/chat-reader/backups/csv-table-20260810T010711Z`; King ran migration preflight and `up -d --no-build`. The release adds CSV/TSV Table/Raw Viewer behavior. Previous service image tags were removed while current SHA and `latest` tags were retained; no production volumes or `.env.production` were changed.

Follow-up commit `6d025e7fdcca47334e8020ed8b615f9c4d40d928` removes redundant legacy attachment captions only. It was built by Actions run `31347470091`, archive SHA-256 `158dc6e03d2fa6abb536a1c0a66e297e8c42e17512db57b7af6e4e1afb5f88f9`, and deployed with the same `--no-build` procedure. The checked backup above remains the pre-release recovery point because neither release changed schema or persistent data.

## Merge worker resource control

- Default worker limit: `IMPORT_WORKER_MEMORY_LIMIT=640m` through Compose interpolation.
- Deploy incrementally after PostgreSQL/business-volume backup. Never run `docker compose down -v` and never overwrite server `.env.production`.
- Before replacing a runaway legacy merge, cancel the exact active merge task, restart only `import-worker`, verify rollback/no active merge, then deploy the optimized worker.

最后核验：2026-08-05

本页描述可复用的部署程序。特定发布的镜像、哈希和 Chrome 结果保留在 [execution/DEPLOYMENT_CHECKLIST.md](execution/DEPLOYMENT_CHECKLIST.md)，不应复制为永久配置。

## 拓扑与前提

```text
Internet HTTPS
  -> reverse proxy
  -> Next.js Web :3000
       -> /api/* -> FastAPI :8000
  -> PostgreSQL 16
  -> single import/background worker
```

生产 Compose 文件为 `docker-compose.production.yml`，服务包括 `postgres`、`migrate`、`api`、`import-worker` 和 `web`。只对宿主机暴露 Web；API 和 PostgreSQL 位于内部 network。

服务器需要 Docker Compose、足够磁盘、可用 swap/内存、`.env.production` 和外部 HTTPS 反向代理。至少配置强 `POSTGRES_PASSWORD`、正确的 `PUBLIC_WEB_BASE_URL`、`WEB_BIND_ADDRESS` 与 `WEB_PORT`。

## 数据持久化

| Volume | 内容 | 回退时处理 |
| --- | --- | --- |
| `postgres-data` | canonical 数据、偏好、任务、批注等 | 不删除；先 dump 再迁移 |
| `import-storage` | 原始 source artifacts | 独立备份 |
| `export-storage` | 临时导出 artifact | 可过期清理，但发布时不要覆盖 |
| `offline-storage` | 离线 package artifacts | 独立备份 |
| `asset-storage` | 附件对象、暂存和派生物 | 独立备份；不得删除 |

禁止执行 `docker compose down -v`。镜像回退不等于数据回退；数据库 downgrade 必须单独审批和演练。

## 首次部署

```bash
cp .env.production.example .env.production
# 编辑 .env.production，填入强密码、公开 URL 和绑定地址
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml ps -a
curl -fsS http://127.0.0.1:3000/api/health
```

将反向代理 upstream 指向 `127.0.0.1:<WEB_PORT>`，由代理处理 TLS、HTTP 到 HTTPS、请求体上限和访问控制。仓库中的 `deploy/nginx-chat-reader.conf` 只是 HTTP 示例，不是生产证书配置。

## 发布前检查

1. 记录当前 commit、dirty worktree、Compose 状态、镜像 ID、磁盘、内存和 swap。
2. 使用显式上传清单；排除 `.env*`、storage、数据库、备份、日志、缓存、临时目录和 `tsbuildinfo`。
3. 运行本地 lint、typecheck、API pytest、相关 Playwright 和 production build。
4. 生成 PostgreSQL dump，并用 `pg_restore --list` 验证可读性。
5. 独立备份 import/offline storage；为当前 API、worker 和 Web 镜像添加回滚标签。

附件发布还必须备份 `asset-storage`，并确认 `ATTACHMENT_SCANNER` 策略。约 2 GiB 的 King 主机固定使用 `disabled`，不启动 `scanner` profile；`ALLOW_UNSCANNED_ATTACHMENTS=true` 只允许单用户继续使用，所有对象仍显示 `scanner_disabled`。未来本地 ClamAV 需要资源充足节点与 `--profile scanner`，更推荐配置独立 `RemoteScanner`。

数据库备份脚本：

```bash
chmod +x deploy/backup.sh
./deploy/backup.sh
pg_restore --list backups/chat-reader-<timestamp>.dump >/dev/null
```

## 低内存 King 发布

King 不再承担 Web 镜像编译。2026-08-06 的发布证明，即使暂停 worker，原机 `next build` 仍可能杀死 PostgreSQL checkpointer。必须在 CI 或独立 Linux 构建机完成镜像，再通过 registry 或 `docker save/load` 交付：

```bash
COMPOSE='docker compose --env-file .env.production -f docker-compose.production.yml'
$COMPOSE up -d postgres
# 在独立构建机生成并推送/传输 web、api、import-worker 镜像
$COMPOSE pull api import-worker web  # 使用 registry 时
$COMPOSE run --rm migrate
$COMPOSE up -d --no-deps api import-worker
$COMPOSE up -d --no-deps web
$COMPOSE ps -a
```

如果使用 `docker save/load`，先在 King `docker load`，再执行同样的 migrate 和 `up -d --no-deps`。不得以增加 swap 或暂停 PostgreSQL 来换取原机 Web 构建。

本轮附件 migration 后还需验证：

```bash
$COMPOSE exec -T api python -m alembic current
$COMPOSE exec -T api python -m scripts.purge_legacy_deleted_conversations
curl -fsS http://127.0.0.1:3000/api/capabilities
```

遗留 deleted conversation 清理脚本默认 dry-run；只有 PostgreSQL 和业务 volume 备份已验证后才使用 `--execute`。不可恢复删除没有产品级恢复入口。

如果 shell 不支持变量形式，逐条写出相同 Compose 前缀。出现 OOM、Docker daemon 重启或数据库恢复事件时，停止发布结论，先检查 PostgreSQL、migration、日志并重新生成和校验数据库 dump；不要把容器重新启动等同于成功。

## 发布后验证

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps -a
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 migrate api import-worker web
curl -fsS http://127.0.0.1:3000/api/health
```

配对 Markdown 正文合同升级后，先在 API 容器运行只读统计，再在备份确认可用后创建修复版本：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T api python -m scripts.backfill_exporter_markdown
docker compose --env-file .env.production -f docker-compose.production.yml exec -T api python -m scripts.backfill_exporter_markdown --apply
```

命令幂等且不修改 schema；它只处理原始 JSON/Markdown 仍可验证、current version 仍由 import 创建的配对消息，手动或系统后续编辑跳过。

至少确认：

- PostgreSQL/API/Web healthy，worker running，migrate exited 0。
- 生产 `alembic current` 与源码单一 head 一致。
- `/api/health`、首页、Reader 和 `/library` 返回正常。
- 本次新增 API、Reader 跳转/刷新恢复、Share/Export、离线增量和移动端关键路径按风险复验。
- `/api/capabilities` 必须报告 scanner `disabled`、未扫描可用、基础预览开启、复杂预览关闭；附件 UI 不得显示 clean/safe。
- 日志没有新增 error、exception、traceback、fatal、panic 或持续重启。

生产 OpenAPI 不保证通过 `/api/openapi.json` 暴露；接口存在性可从容器内 `app.openapi()` 或测试环境核验。

## 回退

1. 停止继续发布，保留失败日志和当前镜像 ID。
2. 将 API/worker/Web 指回发布前回滚标签；不要删除 volume。
3. 若 migration 向后兼容，通常保留新增列；确需 downgrade 时先在备份副本验证。
4. 恢复后重新检查 health、migration、worker 和关键只读路径。
5. 数据异常时使用已验证 dump 在隔离环境演练，不直接覆盖唯一生产数据库。

## 运行维护

- 定期执行并异地保存 PostgreSQL dump；另外备份 import/offline volumes。
- 配置 Docker 日志轮转；Compose 已限制 json-file 大小和文件数。
- 监控磁盘、内存、swap、PostgreSQL health、worker 存活和 failed jobs。
- 定期验证恢复流程，而不仅是验证备份文件存在。
- 应用没有内置认证，公开域名必须长期由代理/VPN/访问网关保护。
# 2026-08-09 Addendum

Build Web/API images on GitHub Actions or an external Linux builder. King only pulls the verified image, runs the existing migration preflight and recreates services with `--no-build`. Do not run `next build`, start ClamAV, remove volumes, or overwrite the server `.env`.

The complex attachment Viewer is a browser-side lazy Worker and has no server dependency. The production deployment remains `ATTACHMENT_SCANNER=disabled`; unsupported complex formats continue to download.

## 2026-08-10 Reader Scroll Release

GitHub Actions run `31385483844` produced the verified `e4bc9c3` artifact (`1deddb658a8c663111e530ffd793cb3f437cc9498ca68fded7dd498934f8c777`). King was backed up, loaded and recreated with `--no-build`; no migration was added and the single Alembic head remained `20260806_0021`. API/Web/Postgres health checks passed. The rollback backup is `/opt/chat-reader/backups/reader-scroll-20260810T120035Z-e4bc9c3`; it includes PostgreSQL and the import/export/offline/asset storage archives with checksums.

Production Chrome read-only wheel verification recorded zero reverse wheel steps and six mounted messages. Exact 360px, browser zoom and forced-offline negative cases remain explicit verification debt rather than unconditional PASS.

## 2026-08-10 Reader Scrollbar-Thumb Gap Closure

GitHub Actions run `31398377216` built commit `771f4c864df7d7dea619a17eb19339ae971a2f28`. The release archive SHA-256 `b8c6dc8e7769cfe4e03e9523595b179f50308a045f78ebe8beb71a44291e1000` matched locally and on King. The existing verified rollback backup `/opt/chat-reader/backups/reader-scrollbar-20260810T141005Z-5e50a6e` was retained; it contains the validated PostgreSQL dump and import/export/offline/asset archives. King loaded the prebuilt images, ran the existing migration preflight and recreated API, worker and Web with `--no-build`. No volume, `.env.production`, Scanner setting or database schema changed.

Post-deploy API/Web/PostgreSQL are healthy, the worker is running, public `/api/health` returns `ok`, Scanner remains `disabled`, and Alembic is `20260806_0021 (head)`. Real Chrome read-only acceptance on the reported production conversation dragged the native scrollbar thumb across distant positions in both directions; the destination viewport immediately contained 15 and 14 rendered blocks respectively, with no blank virtual-message shell. The bridge's synthetic in-page `scrollTo()` is not treated as production pointer evidence because it bypasses the native scrollbar input path; the deterministic large-jump invariant is covered by production-build Playwright.

## 2026-08-11 Final Release Closure

- Runtime commit: `38c57c12191bb85ebca0a7caf9aea80f11070993`.
- External build: GitHub Actions run `31453697905`.
- Release archive SHA-256: `430dd0d88c927a6329da132aced75c742124ac4035b4c05c348bdbeda549e11c`, verified locally and on King.
- Backup: `/opt/chat-reader/backups/final-closure-20260811T030600Z-38c57c1` (about 406 MiB). The PostgreSQL custom dump passed `pg_restore --list`; import/export/offline/asset archives passed checksum and archive listing.
- Deployment: verified images loaded, existing migration preflight run, API/import-worker/Web recreated with `--no-build`. No volume deletion, `.env` overwrite, local Next build, Scanner start or schema migration occurred.
- Post-deploy: API/Web/PostgreSQL healthy, worker running, Scanner disabled, Alembic `20260806_0021 (head)`.

Production QA writes were isolated. Disposable conversations were removed through the supported API and QA Share was revoked. The empty QA Project remains because no project-delete endpoint exists; import-preview residuals without a safe owner-delete API were not removed by SQL.

The first migration invocation accidentally selected the repository's default compose file, created a separate empty `chat-reader-postgres` container and `chat-reader_chat-reader-postgres-data` volume, then failed before running Alembic. Inspection proved the production `chat-reader-postgres-1` and `chat-reader_postgres-data` remained healthy. The two exact empty resources were removed immediately; deployment then used explicit `-f docker-compose.production.yml --env-file .env.production` for migration and service recreation. The empty resources are not recoverable, contained no business data and were never mounted by production.

## 2026-08-11 Attachment Workspace And Cursor Release

- Runtime commit: `1cdadc4f90115d7b46ce55d07a2b4f23c90471d4`; GitHub Actions run `31470442426`; archive SHA-256 `429fb5384dc1dbf57eec68aecad4632c01bd71a58fca6ea9f276468c6d8630fb`.
- Backup `/opt/chat-reader/backups/file-workspace-cursor-20260811T075200Z-1cdadc4` contains a PostgreSQL custom dump and import/export/offline/asset archives. Checksums, `pg_restore --list` and tar listings passed before replacement.
- King performed `git pull --ff-only`, `docker load`, explicit production migration preflight and `--no-build` recreation. No Next build, schema migration, volume deletion, `.env.production` overwrite or Scanner start occurred.
- After API/Web/PostgreSQL health, worker, Alembic and production Chrome acceptance passed, cleanup removed only 48 exact Chat Reader tags belonging to 12 older commits. The retained set is current `1cdadc4`, rollback `b6ce0e6` and `latest` for Web/API/import-worker/migrate. Do not replace this targeted retention policy with `docker image prune -a` on King.
- Image storage decreased from 4.919 GB to 2.510 GB; root filesystem moved from 97% used/1.4 GB free to 90% used/3.9 GB free. Business volumes and non-Chat-Reader images were not touched.
