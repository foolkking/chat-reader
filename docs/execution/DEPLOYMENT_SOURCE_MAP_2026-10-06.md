# 依赖修复与 CI 重试发布 — 2026-10-06

状态：**已部署并完成清理后验收**。线上应用源码为
`bdfb7257341f0f74685de4ad80e339fbde525ab7`，Alembic 保持唯一
`20261006_0048 (head/current)`。后续文档提交不改变镜像中的应用源码。

## 发布来源

- [CI 37411587470](https://github.com/foolkking/chat-reader/actions/runs/37411587470)
  attempt 1 的 API、Web、设置、构建、独立检查全部成功。
- 仅重跑独立检查，attempt 2 成功复用 artifact **11389837379**。
  原构建和沿用记录的日志逐字节一致、时间和步骤不变，镜像实际只构建一次。
  [重试证据](CI_ARTIFACT_RETRY_2026-10-06.md) 记录 GitHub 沿用任务的新 job ID 行为。
- manifest 的 producer attempt 仍为 **1**；消费者 attempt 为 **2**，不改写产物来源。
- 本机流式核验 50 个镜像 blob、四个标签、镜像 ID、源码、linux/amd64 及检查报告。
  17 个部署支持文件逐一与发布提交对照；服务器再次校验传输文件。
- 没有在本机或服务器构建镜像。

归档 SHA-256：`2eebe4348d56146d13f2f370bd48dab17b3a3bd9513f0a3bc314c2678e877f0b`，
大小 **196,720,984 bytes**。

| 镜像 | ID |
|---|---|
| API / worker / migrate | `sha256:1a63f133d84155f779212fb7579bd076b902b1bf8489c2ed2e12d49c1403d610` |
| Web | `sha256:934ba45e5d9c81e4dec9e59dcec3b5a130c14252974a36f211132c6199f36ac8` |

## 改动与测试

`source-map-js` 统一使用上游 **1.2.2**，修复 GHSA-68fv-2mgg-jv7q。
未增加审计例外；原 braces 补丁及其有期限例外继续保留。
[依赖修复记录](SOURCE_MAP_SECURITY_2026-10-06.md) 保存来源、锁文件边界和本机测试。

精确源码 CI：

- 依赖行为回归 **9 passed**；官方审计 **0 未批准阻断项**，不是零公告。
- lint、typecheck、Web production build 通过。
- Context runtime / Bundle **64 passed**；可观测性与回收安全专项 **53 passed**。
- API **929 passed / 3 skipped**；PostgreSQL 空库迁移和唯一 head/current 检查通过。
- 设置浏览器 **147 passed**；独立 PostgreSQL 系统归档恢复 **1 passed**。
- Context 浏览器 **35 passed**，认证 **18 passed**，离线负面 **17 passed**。
- PWA 基线 **134 passed / 295 skipped**。
- Reader/Share、CSP、源码编辑、上传原子性、附件查看及 PDF 专项通过。
  导入恢复专项 **8 passed / 1 skipped**。

套件存在重叠，不累加为独立用例总数。API 的 3 个跳过与导入专项 1 个跳过需要
未配置的外部 JSON/Markdown 样本；PWA 基线关闭的专项不计为通过。
CI 测试独立于生产 HTTP 验收，不宣称完成完整生产交互式浏览器矩阵。
真实 SMTP 投递仍未验证，生产未配置邮件；异地副本按用户决定不设置。

## 生产验收

容量预检通过后，载入 CI 镜像；确认 worker 空闲、无排队/执行任务，停止 API/worker 写入。
创建并验证五组件备份 `chat-reader-20261006T043843Z`，再检查迁移并以 `--no-build`
替换 API/worker/Web。PostgreSQL 没有重启，管理员部署配置不变。

- API/Web/PostgreSQL healthy，worker heartbeat 正常；无重启、OOM 或启动错误关键词。
- 真实登录、14 个设置/管理只读接口、两次所属对话引导查询通过。
- 三类系统默认 Skill、六次解析下载及三个公开 ZIP 的字节校验通过。
- 两次匿名大上传保持 401；退出后私有接口为 401。
- 实际导出 Range 32 字节、完整 ZIP、关闭后的物理回收、旧 URL 410、幂等重建及再次回收通过。
- 历史 59 个过期导出在此次部署前已全部回收，部署后仍无文件、无失败重试。
  不把这批旧回收量再次计入本次释放空间。
- canonical 计数、个人 Skill 聚合摘要、301 个附件校验值、导入原件与离线文件摘要一致。
- 公网 HTTPS health 200，HTTP → HTTPS 301。
- `.env.production`、Compose、Nginx 文件以及 PostgreSQL 容器身份/启动时间不变。

## 备份、清理与回退

新备份复用 **3** 个字节一致组件，避免重复写入 **623,608,310 bytes**。
已安装的备份工具与本次源文件一致，没有重复覆盖或改动部署配置。

发布验收后删除更早 **1** 份已验证备份，工具记录移除 **193,716,057 bytes**；
最终只保留 `chat-reader-20261006T025905Z` 和 `chat-reader-20261006T043843Z`。
最终报告 verified=2、held=0、candidates=0；执行期间 held=1 是工具自身的排他锁。
两个逻辑恢复点可共享物理文件，不等同于两份独立物理副本。

精确删除上一版 `6b4ee0a` 的四个镜像标签，测得释放 **284,725,248 bytes**。
保留该版回滚归档，SHA-256 为
`2001794208bf1291e0e685df744fa4ba7dde71c755287f8a13ec25c9c65dc0a0`。
回滚前必须先载入 `/opt/chat-reader/releases/6b4ee0aec8bf399d2bd5eefabfb9c538f2933632/chat-reader-images.tar.gz`，
再使用 `/etc/chat-reader/release-state/rollback-images.env`；不自动降级数据库。

清理后健康、源码、数据库和配置检查全部通过。最终可用
**15,454,683,136 bytes（约 14.39 GiB）**。这不是累计清理量；发布也新增了备份与镜像归档。
业务 volume、导入、附件、离线资料和其他服务未删除；本机残留留给用户处理。

## 证据与后续

服务器记录目录：`/opt/chat-reader/releases/bdfb7257341f0f74685de4ad80e339fbde525ab7/`。
本机证据目录：`C:/Users/86182/Desktop/wkkk/chat-reader-ci-artifact-retry-20261006/`。
包含精确 CI、重试前后、传输校验、部署基线、备份、数据对比、导出验收、运行检查、清理及最终空间。
本次发布阶段完成；长期持续优化目标保持进行中。
