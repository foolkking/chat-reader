# 故障排查

## Web 可打开但显示 Failed to fetch

浏览器 Network 中业务 Request URL 应是当前 Web origin 下的 `/api/*`，例如 `http://192.168.1.10:3000/api/conversations`，而不是远端设备自己的 `localhost:8000`。

检查：

```powershell
Invoke-WebRequest http://localhost:3000/api/health
Invoke-WebRequest http://localhost:3000/api/conversations
```

确认 Next.js 进程环境中的 `API_INTERNAL_URL` 指向服务器可达的 FastAPI：本地开发通常为 `http://127.0.0.1:8000`，production compose 为 `http://api:8000`。修改后必须重启 Web。

## API 无法连接 PostgreSQL

检查 `DATABASE_URL`、数据库进程和 migration：

```powershell
Set-Location apps/api
alembic current
alembic upgrade head
```

Docker 中数据库 host 必须是 service 名 `postgres`，宿主机开发通常是 `localhost`。不要在容器内使用 `localhost` 指向另一个容器。

## Migration 服务失败

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs migrate postgres
```

常见原因是数据库密码不一致、旧 volume 使用了不同初始化凭据、数据库未 healthy 或 migration 代码与镜像版本不一致。不要通过删除 production volume 解决 migration 错误。

## 端口占用

PowerShell：

```powershell
Get-NetTCPConnection -LocalPort 3000,8000 -ErrorAction SilentlyContinue
```

停止旧进程或为临时开发实例选择其他端口。根脚本固定使用 Web 3000 和 API 8000；修改前确认 Next rewrite 和公开 URL 配置一致。

## LAN 访问

Web 已监听 `0.0.0.0:3000`。Windows 防火墙需允许 Node.js 或 TCP 3000。浏览器只需访问 `http://<server-ip>:3000`，不要求直接访问 API 8000。

PWA service worker 只在 secure context 注册。普通 LAN HTTP 作为响应式 Web 使用，不注册是预期行为。

## CORS 或 OPTIONS

使用同源代理时浏览器不会直接跨域请求 FastAPI，通常无需为每个 LAN IP 添加 CORS。只有绕过 Web 直接请求 8000 时才检查 `CORS_ORIGINS`、Origin 和 OPTIONS response。不要在 `allow_credentials=true` 时使用不受控的 wildcard origin。

## Import 失败

- 检查单文件是否低于 `MAX_IMPORT_FILE_SIZE_MB`，Adaptive batch 是否低于 `MAX_ADAPTIVE_IMPORT_TOTAL_MB`，以及精确 Nginx route 的 `client_max_body_size`。
- 确认 `IMPORT_STORAGE_DIR` 或 Docker `import-storage` 可写且磁盘有空间。
- 先查看 preview warnings，再 commit。
- JSON/Markdown 数量不一致时，检查是否选择了不匹配的会话文件。
- 兼容 JSON 必须存在，Markdown只能作为可选一致性校验；`.cr` 使用完整归档入口。
- 官方 OpenAI 图/ZIP、CSV、TXT 和 Markdown 单文件按产品边界返回 `422 unsupported_source_profile`。

## 长会话或 TOC 跳转问题

确认 `/api/conversations/{id}/reader-turn?anchor_message_id=...` 返回目标所在完整轮次，且每条消息满足 `render_blocks.length === block_count`。检查 Reader 稳定 DOM 是否不超过 3 个轮次，以及滚动容器的 `data-navigation-stage` 是否最终为 `settled`。若只有特定导入失败，记录脱敏后的 conversation/message/block 标识，不要上传 raw 私密正文。

刷新恢复失败时同时检查 reading-position payload 是否为 `anchor_data.position_mode=block-relative-v2`（旧数据可为 v1），以及保存发生前导航和 ResizeObserver 是否已稳定。极长消息若目标 block 在测量时反复卸载，检查 virtual range 是否在事务期间固定目标 index。`pagehide` 只应发送最后缓存的稳定位置，不应现场重新读取正在变化的 DOM。

## CanJSON 下载失败

先直接检查 `/api/conversations/{id}/exports/canjson` 是否返回 `200`、`Content-Type: application/x-ndjson` 和安全的 `Content-Disposition` 文件名。若响应可完整读取但 Chrome 下载仍失败，检查浏览器下载目录的磁盘配额；磁盘写满属于客户端保存失败，不应误判为服务端导出失败。gzip 模式应返回 `.canonical.jsonl.gz`。

## Library 重复下载或增量摘要不正确

- 确认 `/api/offline/catalog` 中 conversation `revision` 与 Dexie 中保存的 `offline_revision` 可比较。
- package 请求必须提交 `known_revisions`；相同 revision 应得到 `estimated_bytes=0` 和可安全导入的空增量。
- 变化 conversation 应在一个 Dexie transaction 中替换，未变化 conversation 不应被重写。
- 如果下载后界面仍显示旧内容，检查 package job 完成状态、SHA-256、导入事务和自动更新去重 key，而不是删除整个 IndexedDB。

Dexie 当前为 version 2，并兼容读取既有 v1 数据；Offline package 当前写 v3、读 v1/v2/v3。不要用升级/清库处理普通 revision 不一致。Offline package 与系统归档 `.cr` 是不同协议。

## Offline Library reports `bulkPut` / `AbortError` or opens with 0 messages

`searchDocuments.bulkPut(): ... AbortError` means the browser aborted the
IndexedDB transaction. It does not by itself prove that the server package is
invalid. Check browser storage quota/eviction state and whether another Library
tab is writing the same database. Do not immediately delete the whole Chat
Reader IndexedDB, because that also removes valid offline packages and local
annotation state.

The current importer writes large stores in bounded chunks and verifies each
conversation's message rows before committing package metadata. Recovery order:

1. Keep the server package and reload `/library`; retry the failed update once
   with other Chat Reader Library tabs closed.
2. Check browser site-storage availability. A quota denial needs space or
   persistence permission; repeated `AbortError` without quota pressure needs a
   browser console/IndexedDB error capture.
3. If one package still fails, remove or update that package through the
   Offline Library UI. Do not clear unrelated stores manually.
4. If the package is marked current but Reader shows `0 / 0`, treat it as an
   import-integrity failure. The local `messages` store must contain rows for
   the selected conversation before the package is accepted; retry the package
   and preserve the error evidence without recording message text.
5. If retry still produces zero rows, record the package schema version,
   conversation count, store counts, and browser version only. Do not put
   titles,正文, IDs, attachments, or credentials in diagnostics.

Offline package v1 read compatibility remains mandatory; this procedure must
not be replaced by a database-version reset.

## 附件显示“未扫描”或无法使用

先检查运行时能力，而不是仅检查环境文件：

```bash
curl -fsS http://127.0.0.1:3000/api/capabilities
```

King 的预期状态是 `scanner_provider=disabled`、`scanner_enabled=false`、`allow_unscanned_attachments=true` 和 `unscanned_status=scanner_disabled`。这不是 clean/safe。若策略不允许未扫描对象，上传可以完成暂存，但 canonical 提交应被拒绝。

确认 `ASSET_STORAGE_DIR` 位于 Web Root 外且 API/worker 使用同一 volume。附件对象只能通过鉴权 API 读取；不要把存储目录映射为静态站点。HTML、SVG、Office 和压缩包在未配置隔离预览时下载降级是预期行为。

S3-compatible 后端需要安装 API 的 `s3` 可选依赖，并配置 bucket、endpoint、region 和 prefix；缺少 `boto3` 时服务会给出明确配置错误，不应静默回退到本地路径。

## Markdown 间距或字号切换无效

检查 `/api/preferences` 是否返回 `reader_density_mode` 和 `reader_font_size_px`，以及页面根节点是否应用对应 CSS data attribute/variable。间距应影响 paragraph、heading、list、blockquote、table、code、KaTeX/Mermaid 容器和相邻 render blocks，而不只是消息外层 margin。字号允许 15-22px，默认 17px。

## Markdown、Mermaid 或代码块显示异常

- Mermaid 仅客户端渲染，语法失败时应回退为代码块。
- 未知 Shiki language 应回退 plaintext。
- 页面横向滚动通常表示某个 table/code/diagram 容器缺少自身 overflow；在 390px viewport 检查 `scrollWidth === clientWidth`。
- KaTeX 样式由根 layout 引入，构建产物缺失时重新安装依赖并 build。

## 前端检查失败

```powershell
corepack pnpm install
corepack pnpm --filter web typecheck
corepack pnpm --filter web lint
corepack pnpm --filter web build
```

若 build 后只有 `apps/web/tsconfig.tsbuildinfo` 变化，它是增量缓存，不应作为功能改动提交。

## 分享链接失效

检查 link 是否已 revoked、`expires_at` 是否已过期，以及 `PUBLIC_WEB_BASE_URL` 是否与公开域名一致。可从会话的 share 管理界面延期；token 原文不会从数据库重新读取。

## Docker 页面返回 502

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 migrate api web
curl -v http://127.0.0.1:3000/api/health
```

先确认 Web health，再检查 API 和 migrate。Nginx upstream 应为 `127.0.0.1:3000`，不是容器内部 service name。

## Nginx returns `400 The plain HTTP request was sent to HTTPS port`

This response means the request used plain `http://` against a TLS listener,
commonly `http://<host>:443`. It is an entry-protocol error, not a Conversation
route or Reader data failure.

- Use the configured HTTPS hostname, for example
  `https://chat.example.com/`; do not use `http://IP:443`.
- If an IP address is required, its TLS certificate and SNI/Host routing must
  still match the configured ingress. A successful raw IP TCP connection does
  not prove valid HTTPS routing.
- Port 80 should only redirect to the same HTTPS origin. Port 443 must be
  accepted by a TLS listener; never forward plain HTTP into it.
- Verify the public boundary without touching application data:

```bash
./deploy/verify_https_entry.sh https://chat.example.com
```

The script requires HTTPS health 200 and an HTTP 301/302/307/308 redirect to
the expected HTTPS origin. Do not interpret that transport check as an
authenticated Reader acceptance pass.
