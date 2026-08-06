# 部署检查清单与发布证据

最终发布于 2026-07-28 部署到 `https://chat.king.2bd.net`。全程未执行 `docker compose down -v`，未修改 Dexie schema；视觉体验补充发布只为 PostgreSQL 增加了向后兼容的阅读预设偏好列。

## 发布前

- [x] 记录生产 Git HEAD `bf64b9e4cd80b98ec00ebe6da090b5bd8b673547`、dirty worktree 与 Compose 镜像。
- [x] PostgreSQL dump：`backups/chat-reader-20260728T110017Z.dump`，77 MB，已通过 `pg_restore --list` 校验。
- [x] 源码、import storage、offline storage 分别备份为 `source-20260728T110000Z.tar.gz`、`import-storage-20260728T110000Z.tar.gz`、`offline-storage-20260728T110000Z.tar.gz`。
- [x] 首次发布前镜像标记为 `rollback-20260728T110000Z`；离线 UI 补丁前 Web 标记为 `rollback-offline-20260728T115827Z`。
- [x] `.env.production` 存在；发布前检查磁盘、内存和 3 GiB swap；未上传环境变量、storage、数据库、日志或缓存。
- [x] 本地 lint、typecheck、API 150 tests、Playwright/PWA、长对话 10 轮专项与 production build 通过。
- [x] 确认本次无 Alembic migration，Dexie 仍为 version 1 且 stores 未变化。

## 上传与镜像

| 阶段 | 文件清单 | 归档 SHA-256 | 最终镜像 |
|---|---:|---|---|
| Reader/API 完整发布 | 32 个显式运行时文件 | `33dcc95b0c69a739c3407c2ff75af22689c357742b263d8b2444e456207e7e1d` | API `088d7e5736fe...`；worker `5ec06a13a72b...` |
| 最终 Web（含离线一致性修复） | 5 个显式运行时文件 | `7cee70aaaf649b78b4ea52d6dfa869007286de6ff79a4478b0fc1bc0ef6a0a94` | Web `89cf21043354...` |

服务端与本地归档哈希一致。修正后的 `.dockerignore` 将 Web build context 从约 940 MB 降至首次复建 26.88 KB；最终补丁复建为 105.96 KB。

## 构建与启动

```bash
docker compose --env-file .env.production -f docker-compose.production.yml build api import-worker web
docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps api import-worker web
docker compose --env-file .env.production -f docker-compose.production.yml ps -a
```

离线 UI 补丁只重新构建 Web；已发布的 API/worker 代码和数据库保持不变。最终 Compose 状态：PostgreSQL/API/Web healthy，worker running，migrate exited 0。

## 发布后验证

- [x] `/api/health`、`/library`、生产长对话均返回 HTTP 200。
- [x] reader-turn API 返回完整 blocks，`content_truncated=false`；当前生产对话总消息数 998。
- [x] Chrome 打开首页、最近、归档、Project、Library 和 Reader，均有主内容且无应用错误。
- [x] 生产远距离批注对齐阅读线误差 2px；窗口为 3 轮、无“立即展开”。
- [x] 继续滚动后刷新恢复同一 block；首次验证偏差 0px，最终 Web 镜像复验保持同一 block/17px offset。
- [x] 跨轮次加载进入 `next:settled`，DOM 仍为 3 轮。
- [x] 项目拖到未归类区成功，并通过移动菜单恢复原项目；最终数据库/侧栏归属为项目内 1、未归类 0。
- [x] 在线更多菜单无离线入口；在线偏好仅有 1 个“离线资料库”入口。
- [x] 离线侧栏同时显示项目与全部对话，无旧互斥标签；离线偏好仅有 1 个“返回在线版”入口。
- [x] 在线/离线偏好弹层打开前后 footer 高度差 0px。
- [x] PWA Playwright 精确覆盖离线冷启动、移动 390x844、旧壳保留、远距离批注和统一侧栏，共 6/6。
- [x] API/Web/worker 最终日志未发现 error、exception、traceback、fatal 或 panic。

没有在生产创建/删除测试批注，没有生成含私有正文的证据，也没有为了 smoke test 修改 Share token。批注 CRUD、Share scope、导入/导出和移动端由发布前 API/Playwright 回归覆盖。

## 回退

1. Reader/API 发布可使用 `chat-reader-api:rollback-20260728T110000Z`、`chat-reader-import-worker:rollback-20260728T110000Z` 和 `chat-reader-web:rollback-20260728T110000Z`。
2. 仅回退最终离线 UI 时使用 `chat-reader-web:rollback-offline-20260728T115827Z`。
3. Reader/离线阶段没有 migration；后续视觉体验补充发布增加 `20260728_0015`。应用回退时该兼容列可保留，不自动执行数据库降级。
4. Library 原子 active revision 会保留最后成功壳；Web 回退不清理 Dexie 或 Cache API 数据。
5. 数据异常时只在隔离环境验证备份；禁止直接覆盖未经验证的生产数据。

## 视觉体验补充发布（2026-07-28）

### 备份与上传

- [x] 发布前时间戳 `20260728T141126Z`；源码、import storage、offline storage 均独立备份。
- [x] 发布前 PostgreSQL dump `chat-reader-20260728T141127Z.dump`，77 MB，SHA-256 `b7e383...`，通过 `pg_restore --list`。
- [x] API/Web 回滚镜像标记为 `rollback-ux-20260728T141126Z`。
- [x] 225 个显式运行时文件归档 SHA-256 为 `ce1eb87b4f4411f5d2268a4619ce2ed0f58f3f3c7bc619c33b46f5ff23b10073`，服务端校验一致；未上传 `.env`、storage、数据库、日志、缓存、临时包或 `tsbuildinfo`。

### 迁移与镜像

- [x] Alembic 执行 `20260724_0015 -> 20260728_0015`，随后 `alembic current` 为 `20260728_0015 (head)`。
- [x] API 镜像 `68a3162943bb...`，Web 镜像 `6be3eea55d80...`；worker 本轮无代码变化，沿用已发布镜像。
- [x] `/api/preferences` 返回 `reader_density_mode=comfortable`，旧偏好缺失字段时使用同一默认值。

### 构建资源事件

Web 低内存构建期间 PostgreSQL 的一个后端进程于 `14:22:18Z` 被系统终止。PostgreSQL 自动恢复并于约 2 秒内重新接受连接，worker 随后恢复运行；没有继续构建或宣布成功前忽略该事件。恢复后完成以下校验：

- [x] `pg_isready` 正常，API/PostgreSQL/Web healthy，worker running。
- [x] 迁移仍为 head，公开健康检查、偏好接口和 reader-turn 接口均为 HTTP 200。
- [x] 发布后新增 dump `chat-reader-20260728T142653Z.dump`，77 MB，SHA-256 `bf9e481...`，通过 `pg_restore --list`。
- [x] 稳态可用内存约 813 MiB、swap 可用约 2.8 GiB；事件后日志未再出现数据库恢复或应用异常。

### 生产复验

- [x] 1830x823 Chrome：远距离批注完整加载并对齐；继续滚动、等待保存、刷新后恢复同一 block，阅读线偏差约 0.21px。
- [x] 分享抽屉底部不越界，私人内容复选项可见并可点击；搜索、导出使用一致抽屉行为。
- [x] 专注模式只保留正文和退出按钮，退出后侧栏状态与阅读锚点恢复。
- [x] 偏好弹层默认紧凑，三档预设可切换；在线三点菜单无离线入口，Library 返回在线版。
- [x] Library 显示项目与未归类，并显示真实增量摘要；中英文切换后没有错误混排。

视觉体验补充发布回退使用 `chat-reader-api:rollback-ux-20260728T141126Z` 与 `chat-reader-web:rollback-ux-20260728T141126Z`。新增偏好列对旧镜像无害，因此默认只回退应用镜像；任何数据库 downgrade 必须单独审批并先验证备份。

## 批量管理与批注阅读发布（2026-07-28）

### 备份与上传

- [x] 有效发布时间戳为 `20260728T164041Z`；更早的 `20260728T163846Z` 零字节 dump 无效且不作为回滚依据。
- [x] PostgreSQL dump `chat-reader-20260728T164041Z.dump`，约 77 MB，SHA-256 `0b5b5082249926427a82699a05d318f931919d658bf9a34a4ab54f7e58b67c33`，通过 `pg_restore --list`。
- [x] import storage SHA-256 `026b16da856f7d56336e1ed9605dfe9774a1eedfddf06e0406562cf09a1a77c6`；offline storage SHA-256 `8d41dc6b76e18e4f2994485f56bd56b5523da8324badf33b49a957c15d741753`。
- [x] source backup SHA-256 `73a424efbe5a47071f4658c58104bacd1d5f2b0b4243fa4100834850e41cd743`。
- [x] 230 个显式运行时文件的上传归档 SHA-256 为 `26c2350b94cf42936059f943e634362b0d719b871e9e62d6454595c33e00425a`，本地和服务器一致；未上传 `.env`、storage、数据库、日志、缓存或 `tsbuildinfo`。
- [x] 回滚镜像：`chat-reader-api:rollback-bulk-20260728T164041Z`、`chat-reader-web:rollback-bulk-20260728T164041Z`。

### 构建、迁移与服务

- [x] Alembic 已执行到 `20260728_0016 (head)`；新增 `reader_font_size_px`，范围 15-22，默认 17，并按旧间距档位回填。
- [x] API 镜像 `7cc879ffcddaeb07c76f27de30a11a1a806ae5b08e9e58f3967509d70afbb7e3`。
- [x] Web 镜像 `51f51e6499bbce06d7f7bfe23cfc79e05417ea98a0d3957ae06ca70d3504992f`。
- [x] Worker 无代码变化，沿用 `5ec06a13a72b3f754574f5cdb119f2d10fcd7c4c5858aa433d9dd0378dff887c`。
- [x] API/Web/PostgreSQL healthy，worker running，migrate exited 0；`/api/preferences` 已返回 `reader_font_size_px=17`。
- [x] 公网 Reader、Library 和 health 均为 HTTP 200；reader-turn 返回完整 blocks 且 `content_truncated=false`。

构建期间一个停滞的 Docker 客户端诊断触发 daemon 重启，容器短暂退出。立即按 PostgreSQL、migrate、API/worker/Web 顺序恢复；迁移成功、服务健康、日志无应用异常后才继续发布。随后清理 44 个 dangling images，释放约 159.8 MB，所有当前和回滚标签均保留。全程未执行 `docker compose down -v`。

### 生产验收（2026-07-29 完成）

- [x] 使用用户指定 Chrome 完成本轮远距离批注、继续滚动、刷新恢复、批量选择、批注全屏、Markdown 间距/字号、桌面/移动和离线入口点击复验。
- [x] 复验中发现离线 TOC 预览仍显示时间戳；修复离线预览清洗后，仅重建并替换 Web，API、worker、PostgreSQL 和 migration 保持不变。
- [x] Web 补丁镜像 `7714e9a9d96c33cb68908a9d57b1de50cb4883d9827de63f26f3c846232deb65` healthy；旧镜像 `51f51e6499bbce06d7f7bfe23cfc79e05417ea98a0d3957ae06ca70d3504992f` 保留为 `chat-reader-web:rollback-offline-toc-20260729T014534Z`。
- [x] 补丁归档 `offline-toc-web-20260729T014534Z.tar.gz` 仅含 `apps/web/lib/reader-data-source.ts`，本地/服务器 SHA-256 为 `30a92d9d98df7615ebf79381332e2dfa69969330ea35cfcbbed785a723acbbcf`。
- [x] 补丁后生产 Chrome 确认离线 TOC 50 项无时间戳；离线点击后完整正文 6 条/1062 blocks；在线 Reader 同样 6 条/1062 blocks，无占位、无横向溢出。

## 混合虚拟化叠字修复发布（2026-07-31）

- [x] 仅发布 Web；最终镜像为 `de131dd06dac8bdf8dac7b10bd0497e3257948361a2e45e9ad3aa876b1b1bc96`，容器 restart 0、OOM false、healthy。
- [x] 发布前保留源码副本和旧 Web 回滚镜像；生产 Chrome 全部通过后按既有保留策略删除旧镜像。
- [x] 公网 HTTPS 与 `/api/health` 返回 200；API/PostgreSQL healthy，worker running。
- [x] 在生产 998 条消息对话中验证默认、最大字号宽松窄版、最小字号紧凑宽版、刷新和继续滚动；可见正文无叠字或横向溢出。
- [x] 生产偏好已恢复 `17px + comfortable + standard`。
- [x] Docker build cache 从约 2.65 GB 清至 0 B；只保留当前 Chat Reader 服务镜像；根分区使用率约从 50% 降到 42%。
- [x] 未执行 `docker compose down -v`，未修改数据库、volume、`.env`、导入资料或离线资料。

构建期间服务器在 `2026-07-31 12:33 CST` 出现全局 OOM，API、worker、旧 Web 及同机部分服务被内核回收。PostgreSQL 本轮未重启；所有受影响服务随后恢复。完成发布前重新检查了 Chat Reader、`sub2api` 与 `x-ui` 的运行状态，最终可用内存约 892 MiB、swap 可用约 2.8 GiB。

## 附件预览与导出增量发布（2026-08-06）

- [x] 本地 lint、typecheck、Web build、203 API tests 和 migration head 通过。
- [x] 增量源文件发布，不覆盖 `.env.production`，不删除任何 named volume。
- [x] API/Web healthy，worker running，生产 capabilities 与 `20260805_0020` 一致。
- [x] Chrome 验证全页面附件弹窗、正文图片/文本预览、导出二级选项和失败任务关闭。
- [x] 专用附件/DnD 验收对话清理；附件 GC dry-run 为 0 candidates。
- [x] Web build 期间发生 PostgreSQL checkpointer OOM；WAL 自动恢复后生成 custom dump，并通过 `pg_restore -l`。
- [ ] 禁止再次在 King 原机执行 Next production build；下一次发布前先建立 CI/独立 Linux 镜像交付流程。
