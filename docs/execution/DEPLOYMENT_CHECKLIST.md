# 部署检查清单

生产部署已于 2026-07-27 在当前对话获得授权。发布仍须逐项执行本清单；禁止使用 `docker compose down -v`。

## 部署前

- [x] 记录当前生产 commit `e752e9ddf25595c3f373977a1803956354ca71b0` 与现有 Compose 镜像状态。
- [ ] 运行 `deploy/backup.sh`，校验 PostgreSQL dump，并备份 import/offline storage。
- [x] 确认 `.env.production` 存在、根分区剩余约 11 GiB、HTTPS 入口与服务健康。
- [x] 运行本地 lint、typecheck、API tests、Playwright/PWA 和 Web build。
- [x] 确认本次无 Alembic migration，Dexie 仍为 version 1 且 stores 未变化。

## 构建与发布

```bash
docker compose --env-file .env.production -f docker-compose.production.yml build api import-worker web
docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps api import-worker web
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

API 与 worker 共享后端搜索/批注代码，必须同时重建并重启。Nginx 和 PostgreSQL schema 不变。Web 重建会生成包含最新静态资源内容哈希的 Library SW revision；不手工改 SW 协议。

## 批注索引回填

仅在新 API/worker healthy 后执行一次；命令可重复运行且第二次应主要为 `skipped`：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T api \
  python -m scripts.backfill_annotation_search
```

保存输出中的 `scanned/created/updated/skipped/deleted/errors`。`errors` 非 0 时命令退出 1，停止发布并检查日志；不得记录批注正文。

## 部署后 smoke test

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS 'http://127.0.0.1:3000/api/search?q=<known-safe-term>&document_type=annotation'
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 api import-worker web
```

- [ ] 首页、最近、搜索、Reader、归档、Project、Library 可打开。
- [ ] 新建/修改/删除一条测试批注后搜索索引同步。
- [ ] 当前对话搜索不出现其他对话批注。
- [ ] 已有 Share URL 仍只读且隐私语义不变。
- [ ] Markdown/JSON/`.cr` 导出、导入和任务监控正常。
- [ ] 已下载 Library、离线冷启动、outbox 与阅读位置正常。
- [ ] 390x844 移动 Reader 的 TOC、搜索、操作和批注可用。

## 回退

1. 切回发布前 commit/tag，重建并启动 `api import-worker web`。
2. 本次没有 migration，不执行数据库降级。
3. 批注 SearchDocument 使用稳定 UUID，可保留；如需清理，只能通过受审查的 annotation document 维护命令，不能删除非 annotation 文档。
4. 若 Web 壳异常，回退 Web 镜像；Library 原子 active revision 会保留最后成功壳。
5. 若数据异常，停止写入后从部署前备份恢复到隔离环境验证，禁止直接覆盖未经验证的生产数据。
