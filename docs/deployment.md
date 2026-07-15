# 生产部署

当前生产路径使用 `docker-compose.production.yml`：PostgreSQL、一次性 migration、FastAPI、单并发 task worker 和 Next.js 五个服务。Compose 服务名仍为 `import-worker`，但它同时处理 import 与 conversation merge。只有 Web 端口对宿主机暴露。

生产 healthcheck 使用低频配置，避免小内存主机频繁创建 Docker exec：PostgreSQL 每 30 秒，API/Web 每 60 秒。容器日志启用 10 MiB、3 文件轮转。Web 远程构建固定为单 CPU worker，Node heap 上限为 512 MiB；1 GiB 以下服务器应顺序构建，并在构建 Web 前停止现有 API、worker 和 Web 容器。

## 服务器准备

- Linux 服务器、Docker Engine 和 Docker Compose plugin。
- 域名指向服务器。
- Nginx 或 Caddy 负责 HTTPS。
- 防火墙只开放 SSH、80 和 443；不要公开 PostgreSQL 5432 或 FastAPI 8000。

## 首次部署

```bash
git clone <repository-url> chat-reader
cd chat-reader
cp .env.production.example .env.production
```

至少修改：

```env
POSTGRES_PASSWORD=<long-random-password>
PUBLIC_WEB_BASE_URL=https://chat.example.com
WEB_BIND_ADDRESS=127.0.0.1
WEB_PORT=3000
```

启动：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs -f migrate api import-worker web
```

`migrate` 必须成功完成后 API 才会启动。验证真实业务链路：

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/conversations
```

## Nginx 与 HTTPS

复制 `deploy/nginx-chat-reader.conf`，替换 `server_name`，启用站点后使用 Certbot 或等价工具配置 TLS。反向代理只指向 `127.0.0.1:3000`，API 继续通过 Next.js 同源 rewrite 到 Docker 内的 `http://api:8000`。

Nginx 的 `client_max_body_size` 应大于 `MAX_IMPORT_FILE_SIZE_MB`。commit 只负责快速排队，不再需要数分钟的 proxy timeout。

生产环境没有内置认证。面向公网时必须在应用前增加可信的身份认证或至少反向代理访问控制，尤其应限制 import、reindex、编辑、删除和 share 管理接口。

## 数据持久化

- `postgres-data`：数据库。
- `import-storage`：raw import artifacts。

升级或重建容器时不要删除 volumes。`docker compose down -v` 会永久删除数据，不应在生产环境使用。

## 备份

仓库提供 `deploy/backup.sh`：

```bash
chmod +x deploy/backup.sh
./deploy/backup.sh
```

脚本使用 `pg_dump -Fc` 写入 `./backups`。应把备份复制到服务器外，并定期验证恢复：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres \
  pg_restore --list < backups/chat-reader-YYYYMMDDTHHMMSSZ.dump
```

raw artifact volume 需要单独做 volume/file backup；数据库 dump 不包含这些文件。

## 升级

1. 先备份数据库和 import storage。
2. 拉取目标版本并检查 `.env.production.example` 变化。
3. 执行 `docker compose ... up -d --build`。
4. 确认 migrate completed、API/Web healthy，且 `import-worker` 正在运行。
5. 验证 `/api/health`、会话列表、reader、search、import 和 share。

回滚应用镜像前要确认数据库 migration 是否向后兼容。不要直接降级数据库；先从经过验证的备份恢复到隔离环境。

## 运行维护

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 api import-worker web postgres
docker compose --env-file .env.production -f docker-compose.production.yml restart api import-worker web
```

建议监控磁盘、PostgreSQL volume、容器 health、5xx、后台任务失败率和备份时间。密钥、真实域名配置和备份文件不得提交到 Git。
