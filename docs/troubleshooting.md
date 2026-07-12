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

- 检查上传大小是否同时低于 Nginx `client_max_body_size` 和 `MAX_IMPORT_FILE_SIZE_MB`。
- 确认 `IMPORT_STORAGE_DIR` 或 Docker `import-storage` 可写且磁盘有空间。
- 先查看 preview warnings，再 commit。
- JSON/Markdown 数量不一致时，检查是否选择了不匹配的会话文件。
- CSV/TXT 不是当前完整 canonical import 的稳定承诺。

## 长会话或 TOC 跳转问题

确认 `message-window` anchor 请求成功，以及目标 heavy message 的 `/api/messages/{id}/blocks` 已返回。浏览器 console 中不应有旧导航请求覆盖新导航的错误。若只有特定导入失败，记录 conversation id、message id 和 block index，不要上传 raw 私密内容。

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
