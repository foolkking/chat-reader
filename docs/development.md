# 本地开发

## 当前工作树账户基线（2026-09-01）

当前工作树包含多账户 owner 边界：部署时只设置一个 `ADMIN`，后续账号为
`USER`。私有记录按已认证用户 UUID 隔离，源码 migration head 为
`20260901_0030_multi_account_users.py`。这部分尚未提交，也尚未应用到生产。
首次账号请使用 `apps/api/scripts/owner_auth.py`，以运维输入的真实邮箱和交互式
强密码创建；凭据不得写入仓库。

最后核验：2026-08-05

## 依赖

- Node.js 20、Corepack 和 pnpm 9.15.4。
- Python 3.11+。
- PostgreSQL 16 或兼容版本。运行时没有 SQLite fallback；pytest 使用隔离 fixture。
- Chrome（Playwright 配置使用 `channel: chrome`）。

## 安装

```powershell
Copy-Item .env.example .env
corepack pnpm install
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .\apps\api
```

创建 `.env` 指定的数据库后运行：

```powershell
Set-Location apps/api
python -m alembic upgrade head
python -m alembic heads
Set-Location ../..
```

`alembic heads` 应只有一个结果。当前源码 head 是
`20260901_0030_multi_account_users.py`；生产执行前必须完成备份和 migration
preflight。

当前 Content Cleanup 支持从规则库主动启动一次低优先级的
`BATCH / ALL_ACTIVE` 后台审查。目标包括项目内和未分类的活动对话，归档
对话在目标快照阶段排除；扫描使用启动时的规则 revision 快照，命中默认
`KEEP`，当前 API 和 schema 不使用 confidence/similarity 字段。

## 环境变量

| 变量 | 用途 | 默认/备注 |
| --- | --- | --- |
| `DATABASE_URL` | API、worker、migration 的 PostgreSQL URL | 本地默认 `localhost:5432` |
| `API_INTERNAL_URL` | Next.js 服务端 API upstream | `http://127.0.0.1:8000` |
| `CORS_ORIGINS` | 直接跨域请求 API 时允许的 origin | 同源 Web 通常不依赖它 |
| `PUBLIC_WEB_BASE_URL` | Share 等公开 URL 的 base | 本地 `http://localhost:3000` |
| `MAX_IMPORT_FILE_SIZE_MB` | 导入大小上限 | 50 |
| `IMPORT_STORAGE_DIR` | source artifact 目录 | `storage/imports` |
| `EXPORT_STORAGE_DIR` | export artifact 目录 | `storage/exports` |
| `OFFLINE_STORAGE_DIR` | offline package 目录 | `storage/offline` |
| `ASSET_STORAGE_DIR`, `ASSET_STORAGE_BACKEND` | 附件对象、暂存与本地/S3 backend | 默认 local |
| `ATTACHMENT_SCANNER`, `ALLOW_UNSCANNED_ATTACHMENTS` | disabled/clamav/remote 与未扫描对象策略 | 轻量开发默认 disabled/true |
| `CHAT_READER_E2E_FIXTURE_DIR` | 真实附件 fixture 根目录，只供测试读取 | 不写死到业务代码 |
| `IMPORT_COMMIT_INLINE` | 测试/调试时内联 commit | 默认关闭 |
| `IMPORT_WORKER_POLL_SECONDS` | worker 轮询间隔 | 1 秒 |
| `IMPORT_STALE_AFTER_SECONDS` | stale job 判定 | 300 秒 |
| `WORKER_HEARTBEAT_INTERVAL_SECONDS` | worker-owned liveness publish interval | 30 seconds |
| `WORKER_HEARTBEAT_STALE_AFTER_SECONDS` | worker stale threshold; at least 3x interval | 120 seconds |
| `ENABLE_INTERNAL_DIAGNOSTICS` | loopback-only aggregate diagnostics feature flag | false |
| `AUTH_ENABLED` | enables the production account/session boundary | false outside production |
| `AUTH_SESSION_SECRET` | deployment-only HMAC secret for opaque session-token digests | no repository default |
| `AUTH_INACTIVITY_TIMEOUT_SECONDS` | per-device sliding inactivity timeout | 172800 seconds |
| `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` | first production migration bootstrap only | set together outside Git, then remove the password after the migrate container succeeds |

不要把真实凭据或生产 URL 提交到仓库；示例只维护变量名和无敏感默认值。

## 启动

分别打开三个终端：

```powershell
corepack pnpm run dev:api
corepack pnpm run dev:worker
corepack pnpm run dev:web
```

- Web：`http://localhost:3000`
- FastAPI 直接健康检查：`http://localhost:8000/health`
- 推荐同源健康检查：`http://localhost:3000/api/health`

局域网设备只访问 Web 3000 端口；不要让远端浏览器直接拼接 `localhost:8000`。

## 检查与测试

| 命令 | 用途 |
| --- | --- |
| `corepack pnpm run lint` | Web ESLint，禁止 warnings |
| `corepack pnpm run typecheck` | TypeScript `tsc --noEmit` |
| `corepack pnpm run test:api` | API 全量 pytest |
| `corepack pnpm --filter web build` | Next.js production build |
| `corepack pnpm --filter web test:pwa` | build 后运行全部 Playwright 配置 |
| `cd apps/web; npx playwright test e2e/reader-layout.spec.ts` | Reader/UI 专项 |
| `cd apps/web; npx playwright test e2e/library-offline.spec.ts` | Library/PWA 专项 |
| `cd apps/web; $env:E2E_LONG_READER='1'; npx playwright test e2e/reader-restoration.spec.ts` | 长对话恢复专项 |

真实附件 fixture 测试只读环境变量指定的展开目录，并在测试临时目录打包；不得修改源目录，也不得把正文、绝对路径或附件内容写入文档/截图。运行完整 API 时设置 `CHAT_READER_E2E_FIXTURE_DIR`，否则该单项会明确 skip，不能记为 PASS。在线 Playwright 分别通过 `E2E_ATTACHMENT_FIXTURE`、`E2E_ATTACHMENT_UPLOAD`、`E2E_DND_FLOW` 和 `E2E_IMPORT_FLOW` 启用。

Playwright 默认从 `http://127.0.0.1:3107` 启动 production server，需要已有 Web build 和对应测试 API/fixture。设置 `PLAYWRIGHT_REUSE_EXISTING_SERVER=1` 可复用已经启动的隔离服务；长 Reader fixture 应覆盖 1000+ blocks、远距离目标和刷新恢复。不要把生产私密会话作为可提交 fixture。

## 数据与 migration 规则

- 生产和本地业务数据都应使用 PostgreSQL；测试数据库必须隔离。
- 新 migration 必须填写正确 `down_revision`，保持单一 head，并更新 model/schema/tests。
- 不要手工修改生产表替代 migration，不要删除 production volume 解决 schema 问题。
- `apps/api/storage/imports/` 可能包含用户导入资料；不作为临时目录清理。
- `.cr`、offline package 与 Dexie 是不同协议。修改任何一个都要单独验证兼容性。

## 文档同步

变更路由、环境变量、migration、Reader 数据合同、离线协议或部署拓扑时，同步更新 [Project State](../PROJECT_STATE.md)、对应专题文档和 [Markdown 台账](documentation-inventory.md)。
