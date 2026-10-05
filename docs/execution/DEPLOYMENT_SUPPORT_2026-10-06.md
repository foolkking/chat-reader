# Skill、请求功能发布及两份备份收敛 — 2026-10-06

应用源码 `5d48b686893d44f98092dfffbfa32a4464e8ede1` 已部署到 King。
GitHub [CI 37323431809](https://github.com/foolkking/chat-reader/actions/runs/37323431809)
attempt 1 的五项任务全部成功。后续测试和文档提交不改变此镜像来源。
本次未在本机或服务器构建镜像，未配置异地副本。

## 来源与迁移

- 镜像归档 196,647,521 bytes，SHA-256：
  `5737b14069ed2a105edb0c5a10b25189f679eb4209b5f1c245dc502c53991cde`。
- API/worker：`sha256:d905eabd6420c3fe176942487aefee32ea451b9aadeaec11f3429e9d3dafa9cb`。
- Web：`sha256:2163878a261a1de1f5fefa4a90920b853e157678ea8eb4e831ec01b3d9de1c8e`。
- 50 个镜像 blob 和 16 个 support archive 文件重新核验；标签、架构和源码一致。
- Alembic 从 `20261003_0046` 升到唯一 head/current `20261005_0047`。
  新增支持请求、回复和账户限额覆盖表；原 canonical 计数及 301 个附件校验不变。
- 仅重建 API、worker、Web。PostgreSQL 容器身份及启动时间不变；
  `.env.production`、Nginx 和其他应用不变。
- live Compose 只补充 `IMPORT_GATEWAY_FILE_LIMIT_MB` 和
  `MAX_ADAPTIVE_IMPORT_TOTAL_MB` 两项声明，保留其余原始字节。

## 首次失败与恢复

首次容量预检通过，生成并核验备份 `chat-reader-20261005T162104Z`。
应用已停写，但迁移前的 Compose 补丁因混合 LF/CRLF 换行符断言失败。
此时没有修改配置或执行迁移；异常 trap 自动恢复旧 API/worker，健康恢复。

修正辅助脚本，仅依据目标行实际换行符插入两项；先以 `--check` 校验候选
Compose，不改 live 配置。重新预检通过，再停写并生成新备份
`chat-reader-20261005T162912Z`，没有复用服务恢复期间可能过时的快照。
两次备份均检查五项 SHA-256、四个 tar 可读性及 PostgreSQL TOC。
随后迁移和服务启动成功。失败没有被记为通过，也没有重复加载镜像。

## 验收与限制

- API/Web/PostgreSQL healthy，worker heartbeat alive_idle；无 OOM、重启或启动错误关键词。
- 真实登录、14 个只读设置/请求接口、2 个本人引导请求通过。
- 有效系统 Skill 用途为 3；两种界面语言共 6 次解析下载成功。
  3 个公开默认 ZIP 字节与固定来源一致。
- 退出成功，随后私有接口 401；两个 12 MiB 匿名上传按预期 401。
- 公开 HTTPS health 200，HTTP → HTTPS 301。
- 本次是生产 HTTP/数据/运行验收；没有新增生产交互式浏览器完整验收。
  精确源码 CI 浏览器证据及后续本机测试修复见
  [复制恢复记录](SKILL_COPY_RECOVERY_2026-10-05.md)，跳过项不计为通过。
- SMTP 未配置，站内请求可用，真实邮件投递未验证且当前不可用。

## 清理与回滚

验收及 release pointer 更新后，重新核验最新两份备份，再删除更早两份：
`chat-reader-20261004T151827Z`、`chat-reader-20261005T042224Z`，
文件合计 **3,969,248,298 bytes**。现在保留上面两个 2026-10-05 UTC 的新备份；
北京时间为 2026-10-06。只删除核验范围内的确切成员，无全局 prune 或递归清空。

删除被替换的 `3f1d539` 四个镜像标签，实际释放 **283,971,584 bytes**
（约 271 MiB）。此时可用 **13,042,831,360 bytes**（约 12.15 GiB）。
这不包括之前已释放的约 9.25 GiB；新增备份也占用了空间，不能把所有清理量
直接当作当前净增量。

旧 `3f1d539` 镜像归档仍保留，SHA-256：
`fd6e1fd236d3c24de4efa6080a226e0f44852a07736bfc70aecbf204ad6d1cdd`。
回滚先加载该归档，再使用 `/etc/chat-reader/release-state/rollback-images.env`；
0047 为兼容新增表，不自动降级数据库。

服务器证据位于 `/opt/chat-reader/releases/5d48b686893d44f98092dfffbfa32a4464e8ede1/`：
`baseline.json`、两次 backup log/path、migration/acceptance markers、
`runtime-verification.json`、`backup-retention.json`、`old-image-cleanup.json`。
清理后再次核验 health、镜像源码、PostgreSQL/environment/Compose/Nginx 全部通过，
证据为 `post-cleanup-verification.json`；最终可用 **12,737,072 KiB**。
本机发布辅助文件位于 `C:/Users/86182/Desktop/wkkk/chat-reader-release-20261006/`，
没有扫描或清理本机其他目录。

## 后续

[导出回收与备份计划](../planning/EXPORT_RETENTION_AND_BACKUP_2026-10-06.md)
仍需实现管理员三分钟策略、下载占用保护、界面重建入口、自动两份保留及备份去重。
本次两份收敛是已授权的一次性执行，不代表自动策略上线。
