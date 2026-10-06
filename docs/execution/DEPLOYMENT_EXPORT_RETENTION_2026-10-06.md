# 临时导出回收与两份备份发布 — 2026-10-06

应用源码 `6b4ee0aec8bf399d2bd5eefabfb9c538f2933632` 已部署到 King，GitHub [CI 37366294097](https://github.com/foolkking/chat-reader/actions/runs/37366294097)
五项任务全部成功，migration 为唯一 head/current `20261006_0048`。
镜像仅由 GitHub CI 构建；没有配置异地副本，没有本机或服务器镜像构建。

## 发布来源

- 归档 196,697,034 bytes；SHA-256 `2001794208bf1291e0e685df744fa4ba7dde71c755287f8a13ec25c9c65dc0a0`。
- API/worker/migrate：`sha256:c990899e10f14eba34a193ec03ec87f014e9db4b646ec9c98c2b372f87cf95ea`。
- Web：`sha256:0c2b5ce6d46aad16493699a8429846738086b9800d9bad46561ae07d433ff633`。
- 本机和服务器重新核验归档与文件 SHA；本机验证 50 个镜像 blob、四类标签、源码和架构。
- support archive 的 17 个文件逐一与该 Git 提交对照；生产 Compose、Nginx 和 `.env.production` 未改写。

## 功能与验收

- 新临时导出成功提交后默认保留 3 分钟，Root 可设 1–60 分钟，默认明确关闭面板后提前释放。
- 页面关闭、短期领取和真实下载使用同一生命周期；下载途中不提前删除，过期可按原选项从当前资料重新生成。
- 线上真实登录、设置/请求只读接口、三类 Skill 的解析和 ZIP 字节、退出后的私有 401、公开 HTTPS 和重定向通过。
- 实际导出测试验证 Range 32 字节、完整 ZIP、关闭后物理文件消失、原 URL 410、重生成幂等及新结果再次回收。
- 历史过期导出 **57** 个、**1,118,258,860 bytes**，全部回收，剩余文件 **0**、失败重试 **0**。
- PostgreSQL 容器身份/启动时间、canonical 计数、个人 Skill 摘要、301 个附件校验、导入原件和离线文件摘要不变。
- API/Web/PostgreSQL healthy，worker 心跳正常，无 OOM、重启或启动错误关键词。
- 线上验收是 HTTP、真实文件及数据校验；没有将其表述为完整生产交互式浏览器矩阵。

## 测试证据与未执行项

- 精确源码 CI：API **929 passed / 3 skipped**；Context **35**；
  认证设置 **147**，独立 PostgreSQL 空实例恢复 **1**；认证 **18**、离线负面 **17**；
  PWA 基线 **134 passed / 295 skipped**，Reader/Share/上传/CSP/PDF 与 lint/typecheck/build/迁移检查通过。
- 本机：旧导出兼容真实浏览器 **1 passed**；最终 lint/typecheck/build 通过。此前 Context 专项 **10**、
  PWA **138 / 294 skipped**、导出矩阵、PostgreSQL 并发/备份恢复证据见[实施记录](EXPORT_RETENTION_2026-10-06.md)。
- `585d61f` 首轮 CI 的旧 schema fixture/复制状态定位失败已修复，不修改历史迁移或去掉剪贴板断言。
  `79109a2` 五项 CI 已通过；发布复核补修旧导出 null 时长误显示 0 分钟后重新对最终源码执行全部 CI。
- `67d6a9a` 的原归档焦点测试抢在页面刷新结束前关闭；最终改为等待上传入口可操作，保留焦点断言。
  中间一次测试等待了错误的预检提示，发现后取消 `2ab1e40` CI；正确条件本机连续 **3 passed**。
- 最终 CI attempt 1 的 Web 通过，API/设置因 GitHub 官方 Actions 故障未获得 runner、没有执行步骤。
  同一源码 attempt 2 完成 API、设置和镜像构建，保留已通过 Web；独立检查再次因未获 runner 而未执行。
  attempt 3 保留全部已通过质量任务，重跑 GitHub 镜像构建及独立检查，保证 artifact 与 run attempt 一致。
  最终发布只使用全部门禁通过后核验的产物，不绕过检查，也不在本机或服务器构建镜像。
- 本机基线曾沿用认证变量而等待已跳转的登录页，修正进程环境后通过；测试库重启曾遗漏独立端口，
  补回 loopback 55948 后启动。两次均为测试环境问题，未修改生产认证或数据库配置。
- 跳过项不计通过；SMTP 未配置，真实邮件投递仍不可用；异地恢复演练未执行，用户明确暂不设置。
  API 的 3 项跳过是未配置外部 JSON/Markdown 配对样本的可选导入测试（2 项 fixture-dir、1 项显式文件对）。
  Markdown 导入专项另有 **8 passed / 1 skipped**；跳过项同样需要未配置的外部 JSON/Markdown 文件对。
  PWA 基线关闭专项开关的用例不计通过；对应已执行的专项结果单独列在上面。

## 备份、清理与回滚

停写后创建新的五组件备份，逐项校验数据库 dump、四个 tar 和 SHA，再迁移和替换 API/worker/Web。
新备份仅在未发布 staging 中复用字节相同的组件，保留原 v1 五组件结构。
本次实际复用 **4** 个组件，避免重复写入 **1,790,924,339 bytes**。
复用扫描中的 held=2 是正在操作的 staging 和排他锁；正式保留终态为 verified=2、held=0，无未知或损坏备份。
`backup.sh` 与 `backup_housekeeping.py` 已一起安装到服务器，原脚本保留在本次发布记录中。

验收后由核验工具保留最新两份：`chat-reader-20261005T162912Z`, `chat-reader-20261006T025905Z`。
删除更早 **1** 份完整备份；工具记录不重复计共享 inode 的移除字节为
**1,984,640,398**。两份逻辑快照可能共享文件，不称为两份独立物理副本。
保留两份由发布成功后的命令执行；没有新增定期备份或后台定时备份任务。

删除被替换的 `5d48b68` 四个镜像标签，旧镜像回滚归档仍在，SHA-256
`5737b14069ed2a105edb0c5a10b25189f679eb4209b5f1c245dc502c53991cde`。
另删除本任务未部署的 `79109a2` 临时镜像传输文件，保留其小型来源/校验记录。
回滚先加载旧归档，再采用 `/etc/chat-reader/release-state/rollback-images.env`；不自动 downgrade 数据库。

最终服务器可用 **15,712,391,168 bytes（约 14.63 GiB）**。
不能把累计清理量当作净增量；本次同时新增了一份备份和最终镜像归档。
业务 volume、用户导入原件、附件、离线数据和其他服务未删除。本机残留按用户要求保留。

服务器证据位于 `/opt/chat-reader/releases/6b4ee0aec8bf399d2bd5eefabfb9c538f2933632/`，包括 baseline、backup log/path、
CI/source/镜像校验、export-before/after、真实验收、备份保留、旧镜像清理和清理后验证。
本机证据在 `C:/Users/86182/Desktop/wkkk/chat-reader-export-final-20261006/`。
本阶段交付完成；长期持续优化目标保持进行中。
