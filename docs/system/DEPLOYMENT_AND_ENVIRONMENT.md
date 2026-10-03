# 部署与运行环境

2026-10-02 已部署的版本与诊断扩展：生产镜像构建参数 `BUILD_REVISION` 为完整40位
小写 Git commit；省略则帮助页显示未知，非法非空值拒绝构建。GitHub workflow
将当前 `GITHUB_SHA` 注入 API/Web，production Compose 本机构建也传递该可选参数。
API 将其写入镜像内 `app/build_metadata.json`；Web 将其编译到客户端配置。
运行时不读取环境值来代替构建来源。独立镜像检查同时核对应用内版本与 OCI label。
本地生成的 API metadata 被 Git 忽略。新增 `/api/app-info` 与 Root 专用
`/api/admin/runtime-status` 不改变 health、loopback运维入口、数据库migration或
离线包；详见 [Observability Contract](OBSERVABILITY_CONTRACT.md)。不需要新增运行时
secret，发布和部署仍是独立步骤。

2026-10-02 已部署的归档扩展：系统导出 `.cr v5` 保留 v4 显式归属映射和旧 v5 无配置扩展兼容；新配置 schema 1 保存个人授权、系统发布、偏好及功能/访问策略。普通账户恢复后重设密码，目标 Root 凭据不变；启用邮箱验证的策略恢复前要求目标已配置 SMTP。个人恢复新增幂等 receipt migration，当前唯一 head 为 `20261002_0042`（包含归属选择表）。上传沿用 `BUNDLE_MAX_COMPRESSED_BYTES`（默认 512 MiB）；Nginx 为精确路径 `/api/me/archive/previews` 与 `/api/system/archive/previews` 添加 520 MiB multipart 上限并直连 loopback FastAPI，避免 Next rewrite 缓冲截断。导出现在同时验证上传/展开大小、文件/对象数量、单对象及 JSONL/manifest 限制；容量失败需一致核对 `BUNDLE_MAX_*`、`CANJSON_MAX_LINE_BYTES` 和网关上限后重试，不静默忽略附件。没有新增环境变量；此次发布已同步两条精确网关规则。系统预检、持久归属映射和恢复已接入 worker 与管理员页面，详情见 [Data Archive Contract](DATA_ARCHIVE_CONTRACT.md)。应用归档不能替代部署前服务器备份。

## Current deployed snapshot (2026-10-02)

Production runs `ad223cd4bcbbad7a4ff0c5ea5f33ed2846f3a3ca` from successful
Actions `36955004824`, with Alembic `20261002_0042 (head/current)`. Verified
backup: `/opt/chat-reader/backups/chat-reader-20261002T031735Z`. Only prebuilt
API/worker/Web images were replaced; PostgreSQL identity/start time, the
administrator configuration and `.env.production` remain unchanged. Runtime
image IDs and authenticated/public checks are in the
[deployment record](../execution/DEPLOYMENT_SETTINGS_2026-10-02.md).

The current image pointer is authoritative in `/etc/chat-reader/release-state`;
previous `5877558` images and the backup are retained. The live Compose runtime
settings match the release template; only unused local-build revision args
differ, so the existing server checkout was preserved. Exact archive upload
routes are installed through the dedicated Nginx snippet. No data/image cleanup
was performed. Root free space is about 9.2 GiB.

Production SMTP is not configured. Email verification and email-change delivery
remain unavailable; existing account access is unchanged. Public login rendering
and authenticated HTTP smoke pass; full owner desktop/mobile browser acceptance
is recorded separately as NOT_VERIFIED.

## Previous deployed snapshot (2026-09-30)

Production runs source `5877558070311d1728974198f37a4500d25233b1` from Actions
run `36669226287`. API/worker image ID is
`sha256:6b93c70651a2f2cc59172b5d24bc8d928688efe5b115e8a3121398ed43e0a7ce`;
Web is `sha256:f7f57a76660e7e2d08e5e4c6e711eaa7618a8044057626bb742d6eff36accdc0`.
All CI quality, authentication/PWA and independent artifact gates passed.

Verified backup: `/opt/chat-reader/backups/chat-reader-20260930T053642Z`.
Application writes were briefly stopped to copy consistent storage; PostgreSQL
was not stopped, restarted or replaced. The existing Compose and helper
contents match the release source after newline normalization, so the dirty
server checkout and `.env.production` were preserved. Deployment support and
provenance are retained in `/opt/chat-reader/releases/5877558070311d1728974198f37a4500d25233b1`;
runtime image revision is authoritative, not the server checkout's old HEAD.

Runtime health, worker heartbeat, HTTPS, anonymous private-route 401, attachment
integrity and Alembic `20260927_0033` passed. The operator confirmed that login
now reaches the library after Ctrl+F5. Full agent-driven authenticated
desktop/mobile/logout acceptance remains `NOT_VERIFIED`; it is distinct from
the operator-confirmed resolution of the reported login failure.

Only the current four Chat Reader image tags remain. Exact old-image removal
reclaimed about 263 MiB; removal of the consumed transfer archive brings the
measured free-space increase to about 446 MiB. Root has about 12.3 GiB free with
all backups retained. `/etc/chat-reader/release-state/current-images.env` is
authoritative; the root `current-images.env` now links to it. No direct rollback
image set is retained (`rollback_revision=none`). Business volumes and other
applications were untouched.

## Previous deployed snapshot (2026-09-27)

That release was source `97146a69233b22da1caf250adac380e3802d764f`
from GitHub Actions run `36299691874`. API/worker digest is
`sha256:f53face550496986b2fdf6660298096c3bd3adda94f1775af20cd946bfa3a4d9`;
Web is `sha256:6f5afdd734ac3eb90c8ff32cd488024eff06c75b31b47db89fe5df0160580883`.
Runtime health, worker heartbeat, HTTPS entry and migration head
`20260927_0033` passed, and PostgreSQL retained its prior container identity
and start time. The verified five-component backup is
`/opt/chat-reader/backups/chat-reader-20260927T064519Z`.

The operator elected not to retain a previous application image generation.
Release state therefore has a required current pointer and no rollback file;
`verify_release_state.sh` reports `rollback_revision=none`. Exact obsolete Chat
Reader image tags, the stale unversioned API image and superseded release
transfer were removed after verification. Named volumes, database data, user
storage, backups and `.env.production` were preserved. Root usage is about 62%
with roughly 15 GiB available. Authenticated owner Web acceptance remains an
operator step.

The preceding deployed snapshot was source
`2e7e7577b9b6b44e392fed6c00800470ee0a90b4`, built by GitHub Actions run
`36242345790`. API/worker digest is
`sha256:a2dd5439a8ce10c08dc85b95be6da165924d3e5087eaf477c23d709bb715aa5a`;
Web is `sha256:f5ad3416b4fbb6d868e84d57f1a637824aa8e09c3eac890da5df4e7fb72c70d0`.
The verified backup is `/opt/chat-reader/backups/chat-reader-20260926T130202Z`;
release state records `2e7e7577` as current and `027a148b` as direct rollback.
Runtime health, worker heartbeat, HTTPS entry and migration head passed. The
transferred archive and failed-preflight `chat-reader-api:latest` image were
removed; no named volume, PostgreSQL data, user storage or production
environment file was changed.

The preceding deployed snapshot was `027a148b509a4503a45e3d21036ad2edf72c5389`
from GitHub Actions run `36226227092`.
API/worker image digest is
`sha256:56c7a2d6172ac5a21ca28a04e76cfecc04fd72b597535f0135ec20984326133c`;
Web is `sha256:de261f62dcfd64c5c4be7b92146f816cbb15dd0d9eb9c086f614ff0adb3afcf4`.
Runtime health, worker heartbeat, HTTPS reachability and migration head
`20260902_0032` passed after rollout. PostgreSQL was not restarted. The
verified five-component backup is
`/opt/chat-reader/backups/chat-reader-20260926T102225Z`.

Only the current `027a148b` Chat Reader image set remains after operator-requested
cleanup. The stale image rollback pointer was removed; recovery uses the three
independently verified backups `20260926T102225Z`, `20260926T055815Z` and
`20260902T014223Z`. Cleanup removed redundant backups, obsolete release
transfers, unused build images/cache, inactive VS Code Server versions and old
journal files. Named volumes, PostgreSQL data, user storage and
`.env.production` were not touched. Root free space is about 18 GiB.

The explicit attachment upload limit is 1 GiB with a 1040 MiB exact Nginx
allowance on `/api/attachment-upload-sessions/`. Import and Adaptive Import
remain 500 MiB with 520 MiB exact routes. Browser preview remains capped at
50 MiB; authenticated 1 GiB acceptance is left for operator verification.

The preceding `094abf4` and `b303930` snapshots below are retained as historical deployment
evidence and rollback context.

The active production source is `b3039300c3df1001b5afe92d0849fe9fc9addeae`
from GitHub Actions run `36087943707`. The release used prebuilt OCI images,
the exact migration image and explicit immutable `API_IMAGE`/`WEB_IMAGE`
bindings; only the API, import-worker and Web services were recreated.
PostgreSQL was not restarted or replaced. Alembic `20260902_0032` is current.
Runtime health, HTTPS reachability, worker heartbeat and anonymous private-route
boundaries were verified after rollout. Owner-authenticated production UI
acceptance remains `NOT_VERIFIED` for operator-run Web verification.

The three exact large-upload routes bypass Next.js and stream from Nginx to a
loopback-only FastAPI listener. A 65 MiB anonymous gateway probe reached the
API without Next.js body-limit or proxy-reset errors. Application limits are
500 MiB and exact Nginx limits are 520 MiB; authenticated upload acceptance is
still separate and `NOT_VERIFIED`.

The 2026-09-02 settings-visibility rollout used archive SHA-256
`691b71b7822025610d0d80cfc6ef19f33b316f30312042f70b2b31b627f843ef`.
API/worker digest is `sha256:be80e8c9cb5e08bb5a5bbb182e1752b88757e108ef42751cc4f51a4b3eb8f59c`;
Web digest is `sha256:b093609b0b1001bb9869f794a1b9d0479aa443ade1f8b81b21976a28ffe09c84`.
Backup `/opt/chat-reader/backups/chat-reader-20260902T014223Z` passed the
five-component verification. Only API, import-worker and Web were recreated;
PostgreSQL identity and `StartedAt` were unchanged. Public HTTPS/API health
returned 200 and anonymous admin access returned 401. Browser-authenticated
acceptance is intentionally left for the operator and remains `NOT_VERIFIED`.

The single immutable Root Admin is deployment-configured only by the server
`.env.production` pair `ADMIN_EMAIL` / `ADMIN_PASSWORD`. The migration consumes
the pair when it changes; unchanged values do not overwrite a password changed
in the Web UI. Share and Offline remain separate permission boundaries.

## Working-tree editor and attachment preview changes

The current working tree raises only the attachment upload limit to 1 GiB and
uses an approximately 1040 MiB exact Nginx allowance for that route. Import
and Adaptive Import remain 500 MiB with 520 MiB exact routes. Browser preview
is capped at 50 MiB for previewable attachment types; larger files remain
downloadable. These values are active in the deployed release above.

## Import Preview request boundary

The application and proxy limits in this section are 500/520 MiB respectively.

The application limit defaults to 500 MiB per user-uploaded file and Preview
accepts at most one JSON plus one Markdown file. Nginx keeps a 60 MiB global
boundary and larger allowances only for the documented upload locations.
Those locations stream directly to the API's loopback-only port with
`proxy_request_buffering off`; they do not traverse the Next.js rewrite, whose
proxy request clone is intentionally unsuitable for hundreds of MiB. The API
still enforces the per-file limit before parsing.

Adaptive batches use the separate exact `/api/adaptive-import/sessions`
location with `client_max_body_size 520m`; application limits remain 500 MiB
per file, 512 MiB total and 500 files. No other route inherits this allowance.

Ordinary attachment upload items use `MAX_ATTACHMENT_FILE_SIZE_MB` (1,024 MiB by
default), independently of the import parser limit. The exact
`/api/attachment-upload-sessions/` Nginx location allows 1,040 MiB for multipart
overhead. Large attachment staging is a bounded disk copy using its own
admission slot; parser-backed imports retain the memory reserve check and return
a retryable 429 when memory is low.

## Context and Skill upload boundary

Context returns at `/api/conversations/{uuid}/continuation/returns` stream directly
to loopback FastAPI with a 520 MiB gateway allowance and the existing 512 MiB
compressed-package application limit. Personal `/api/skills` creation/revisions
and `/api/admin/system-skills/bundle` creation/revisions use a separate 20 MiB
gateway allowance for the 16 MiB Skill limit. Anchored locations preserve ordinary
routes. Direct Current/Index updates remain below 10 MiB combined and use the
normal API path. No gateway rule bypasses application authentication/ownership.

The marked Context/Bundle block in `deploy/nginx-chat-reader.conf` must be installed
in the existing TLS server during release without replacing other configuration.
`python scripts/verify-context-upload-proxy.py` starts isolated Nginx/upstream
listeners and checks actual 12 MiB body hashes, forwarded auth headers, over-limit
rejection and unrelated paths. CI runs it with nginx-light; this is transport
evidence, separate from the authenticated application and production smoke gates.

## Worker memory boundary

Production Compose sets `import-worker.mem_limit` to `${IMPORT_WORKER_MEMORY_LIMIT:-640m}`. Override it only through the production environment; do not replace `.env.production` and do not remove named volumes. Conversation merge must remain below this limit through bounded canonical copy batches.

Before an incremental production update, create and validate both the PostgreSQL custom-format dump and read-only archives of `import-storage`, `export-storage`, `offline-storage`, and `asset-storage`. Source deployment archives must exclude `.env.production`, named-volume data, user import directories, caches, and browser traces.

## Owner-authenticated browser verification checklist

For external browser acceptance, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an absolute, operator-provided
Chromium executable and run `corepack pnpm run verify:chromium` before the
Playwright gate. The check records only the executable basename and version;
it does not persist the local path. CI continues to use its bundled browser.

Before replacing API/worker/Web, record the PostgreSQL container `StartedAt`
and optionally its ID. After the rollout, run
`deploy/verify_postgres_unchanged.sh <container> <started-at> [container-id]`.
This read-only check fails if PostgreSQL was restarted or replaced.

After a rollback, run
`deploy/verify_rollback_smoke.sh <base-url> <migration-container> <expected-revision>`.
It checks health, the anonymous private-route 401 boundary and the database
migration head through the existing migration container. It performs no
rollback or mutation.

Health checks, anonymous API checks, and production-equivalent Playwright runs
do not prove that the deployed owner workspace works end to end. Every release
that changes owner-facing Web behavior must record this independent status:

| Status | Meaning | Required evidence |
| --- | --- | --- |
| `PASS` | The exact deployed source was exercised with an approved owner session. | Login, one changed-area flow, logout, and the relevant desktop/mobile checks; record source SHA and browser environment, never credentials or page content. |
| `NOT_VERIFIED` | No approved owner session or browser-control surface was available. | Record the missing capability and keep production UI acceptance separate from health/CI results. |
| `BLOCKED` | An owner session was available but the required flow failed or a release safety gate prevented execution. | Record the failing gate and recovery action; do not report production acceptance as PASS. |

The release report must include the status even when no owner-facing code
changed. A production-equivalent authenticated run may be listed separately,
but it cannot upgrade `NOT_VERIFIED` to `PASS`. Do not create production data
solely for this check; use synthetic/disposable data and remove it through the
supported application path when the environment permits.

The 2026-08-09 Adaptive Viewer rollout used GitHub Actions run `31294947752` for commit `a89bc28`; the archive SHA-256 was verified as `4d48d4d55c461be318c5ccab2b06eaabeefb11e1c32dcb73b2201aa3d833e5be` on both ends. Backup `/opt/chat-reader/backups/adaptive-viewer-20260809T050228Z-a89bc28` contains a validated PostgreSQL custom dump and all four business-volume archives. King only pulled source, loaded images, ran migration and recreated services with `--no-build`; `.env.production`, named volumes and the disabled Scanner policy were unchanged.

最后核验：2026-09-02

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
| `WEB_BIND_ADDRESS`, `WEB_PORT`, `API_PORT`, `API_WORKERS` | Compose | Web 绑定、API loopback 上传端口与进程并发；`API_PORT` 不得绑定公网地址 |

真实值只存在 `.env`/`.env.production` 或 secret manager，不写入文档。

## 持久化与健康

- named volumes：`postgres-data`、`import-storage`、`export-storage`、`offline-storage`、`asset-storage`；只有启用 `scanner` profile 时才使用 `clamav-data`。
- 附件对象不使用静态公开目录；发布前必须备份 `asset-storage`，迁移/回滚不得删除该 volume。替换镜像前在 API 容器运行只读 `python -m scripts.verify_attachment_storage`，将数据库对象、活动 Attachment 和 local asset files 对账；非零结果或不完整扫描必须停止发布。`--verify-sha256` 是显式的全内容校验，默认检查存在性和大小。该检查不自动修复或删除，无主对象仍交给独立的人工 cleanup 决策。附件 GC 默认 dry-run，只有人工确认后才使用 `apps/api/scripts/gc_assets.py --execute`。
- King 的约 2 GiB 单用户部署固定使用 `ATTACHMENT_SCANNER=disabled`、`ALLOW_UNSCANNED_ATTACHMENTS=true`，不启动 `scanner` profile 或 ClamAV。当前部署主动关闭附件恶意软件扫描和内容安全审查。附件以 `scanner_disabled`/`unscanned` 状态正常使用，中文 UI 显示“未扫描”。这是当前单用户部署的已接受策略，不代表文件已经通过安全检测。Scanner Provider 抽象保留，但本轮不部署本地或远程扫描节点。消息保存不重新读取或扫描已提升的附件对象。
- 复杂附件预览默认关闭。未配置独立 preview origin 时 Office/ZIP 只下载；HTML 可作为转义文本读取，SVG 只通过浏览器图片上下文展示，不作为可执行文档注入。
- healthcheck：PostgreSQL、API、Web；worker 通过进程、日志和 job heartbeat 观察。
- Docker json-file 日志已配置轮转；仓库没有集中式日志/APM。
- `deploy/backup.sh` 生成 PostgreSQL custom-format dump；Release M 的五部分
  备份校验、隔离恢复前置检查和完整性审计见
  `docs/system/DISASTER_RECOVERY_RUNBOOK.md`、
  `deploy/recovery_preflight.py` 与 `deploy/recovery_integrity.py`。
- `deploy/backup_retention_report.py` 只读盘点备份目录。默认保留最新 3 份
  结构完整备份和 30 天内备份，支持显式保护基线；更旧的完整备份只标记为
  `REVIEW_OLDER_COMPLETE`，不代表允许删除。不完整、时间未知、符号链接或
  扫描截断均 fail closed；默认只输出聚合计数和字节数。

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

## Operator-owned release state and bounded transfer cleanup

The server's mutable release pointer is operator-owned state, not repository
content. Store it under `/etc/chat-reader/release-state/` with mode `0700`:
`current-images.env` identifies the active immutable source revision. An
optional `rollback-images.env` identifies a directly recoverable previous
revision when the operator chooses to retain one. Every present file must
contain a non-empty `RELEASE_SHA` value, and current/rollback values must be
different. When no previous image generation is retained, remove the rollback
file instead of leaving a stale pointer. Verify the state before a rollout with
the read-only helper:

```bash
sh deploy/verify_release_state.sh /etc/chat-reader/release-state
```

Do not put credentials, database URLs, or user data in these files. They are
deployment pointers only and should be backed up by the operator's host-state
procedure, separately from application volumes.

After health, migration, and browser gates pass, inspect the staged release
transfer directory with the bounded cleanup helper. It retains only explicitly
named active artifacts and any optional rollback artifacts; symlinks and
non-direct children are never removed. The default is a report-only dry run:

```bash
python3 deploy/cleanup_release_transfer.py \
  --transfer-dir /opt/chat-reader/releases \
  --keep chat-reader-images-current.tar.gz
python3 deploy/cleanup_release_transfer.py \
  --transfer-dir /opt/chat-reader/releases \
  --keep chat-reader-images-current.tar.gz \
  --execute
```

Add a second `--keep` only when a direct rollback artifact is intentionally
retained.

The explicit `--execute` step is an operator action after the recovery chain
has been verified. Never replace it with `docker image prune`, a wildcard
delete, or cleanup of named volumes/backups.
# Settings migration chain (deployed 2026-10-02)

The chain starts at `20260930_0034` after `20260927_0033` and was deployed
through `20261002_0042` with the ordinary backup and migration gates. It adds approval/verification state, email grants and personal noise
preferences; no existing user import files or browser data are transformed.
Existing ACTIVE accounts do not acquire a new verification requirement.
Legacy disabled accounts with an approval-review record stay conservatively
rejected because the old schema cannot distinguish rejection from later disable.

Email verification uses the existing `SMTP_HOST`, `SMTP_PORT`,
`SMTP_FROM_ADDRESS`, `SMTP_STARTTLS`, `SMTP_USERNAME`, `SMTP_PASSWORD` and
`PUBLIC_WEB_BASE_URL`. Do not enable it before mail configuration is usable.
The admin UI reports configuration presence, not tested delivery health.
The 2026-10-02 deployment preserved credentials and the production environment.
SMTP remains unconfigured. Downgrade removes pending verification grants
and per-user rule preferences; prefer the established pre-release backup for
rollback rather than treating schema downgrade as data restoration.

Stage-six regular-account email changes reuse this SMTP configuration and the
existing EMAIL_CHANGE grant purpose. They require matching Web/API code, but
no additional migration or environment keys of their own. The later archive
migrations advance the current single head to `20261002_0042`. Root administrator email remains deployment-managed. SMTP
presence enables the form, while delivery failure remains a retryable error
and never changes the old address. The deployed form reports unavailable mail
until SMTP is configured.

`20260930_0035` follows `0034` on the same migration chain. It backfills existing
format revisions as personal grants before replacing the source-owner cascade
with SET NULL; it does not publish any existing format. Equivalent complete
revision sets receive aliases while old IDs remain intact. Apply with matching
API/worker code. Downgrade restores the source owner's personal label/status
but cannot represent shared grants; once a source account has been deleted,
it explicitly refuses downgrade. Restore the verified pre-release backup for
a full rollback rather than deleting retained formats to force downgrade.

`20260930_0036` follows `0035`: explicit cleanup decision timestamps and apply
leases. Existing automatically selected DELETE candidates reset to KEEP for
re-review; no message content is rewritten. Deploy matching Web/API/worker so
protected-range checks, saved decisions and preview tokens agree. The single
working-tree head is now `20261002_0042`; production remains unchanged.

`20260930_0037` follows `0036`, adding per-account revision/context-bound cleanup
exceptions with owner/scope uniqueness. It changes no existing message content.
Downgrade removes only these new exception records. Apply the migration before
the matching API and worker, because scans consult the exception table. The
trial/confirmation flow reuses the existing session signing secret and does not
introduce new deployment settings.

The isolated browser fixture must supply the same `API_INTERNAL_URL` during
both Web build (compiled rewrites) and Web startup (the import commit proxy).
Runtime configuration alone does not replace a compiled rewrite destination.

`20261001_0038` follows `0037`: backfill literal-rule grants and personal labels,
status and selected version before changing source-owner deletion to SET NULL.
It adds publications, aliases and revision configuration digests; nothing is
published automatically. Deploy the matching API/worker after migration because
rule listing and scans consult these relationships. Downgrade cannot represent
shared grants and refuses retained rules whose source account no longer exists;
use the verified pre-release backup for a full rollback. Full-family format
health checks reuse existing session JSON fields and add no migration or env var.

`20261001_0039` follows `0038`: add default focus/annotation position and a JSON
field-revision map to user preferences, plus account-scoped idempotent receipts.
Existing values stay intact and start at revision one; no browser storage or
package migration is required. Deploy matching API after the schema update,
then Web. Legacy PATCH still works and advances only changed field versions.
Downgrade removes the new default fields and receipts, so use the pre-release
backup if these values must survive rollback. Actual PostgreSQL tests exercise
upgrade/downgrade/upgrade, receipt cascade and concurrent requests.

`20261001_0040` follows `0039`: existing reading positions gain revision one,
and a subject/operation receipt table references conversations with deletion
cascade. Existing position values and anchors are unchanged. Deploy matching
API/worker after the migration and then Web; legacy position PUT remains valid.
Downgrade removes revision/receipt metadata while preserving positions. It does
not migrate Dexie or offline-package versions. PostgreSQL tests verify actual
upgrade/downgrade/upgrade, FK deletion, concurrent replay and competing updates.
