# OOM 续查发布 — 2026-10-19

## 发布准备检查点

本记录使用 Asia/Shanghai，准备检查点为 **2026-10-19 17:34 +08:00**。
用户已明确授权提交、CI 与部署；沿用此前要求，**CI 启动后停止等待用户报告结果**。
没有 GitHub 网页登录或 web search；发布只使用既有本地凭据。

生产仍为已接受的 **f3b331a / 20261017_0052**，未因本地提交而改变。
OOM 修复已提交为 `92dd270`；本发布准备与脚本修复形成后续提交，不重写已有提交。
尚未接受新部署，没有修改生产配置、PostgreSQL、导入资料或其他用户数据。

修复范围与原始局部测量分别见：

- [导入、导出和正文保留](OOM_IMPORT_EXPORT_FOLLOWUP_2026-10-19.md)；
- [附件/批注索引与 gzip 准入](OOM_SEARCH_GZIP_FOLLOWUP_2026-10-19.md)。

无新 migration；源码仍为单一 **20261017_0052** head。

## 实际本地回归结果

| 检查 | 本次结果 |
| --- | --- |
| 单进程完整 API | **1392 通过／49 失败／185 条件跳过**，1626 项，2683.61 秒；不是通过 |
| 原 49 个失败用例，新进程复查 | **49 通过／0 失败／0 错误／0 跳过**，99.87 秒 |
| Web typecheck | 通过 |
| Web lint | 通过 |
| 源码 Alembic heads | 单一 `20261017_0052` |
| PowerShell 原生命令失败传播 | 隔离合成命令 **9/9** |

第一次完整 API 的 49 项均在合成导入提交阶段返回 400，或因该失败缺少
`conversation_ids`，并非它们各自主功能断言失败。原辅助断言没有保留响应 detail，
所以不能把每个失败都认定为内存不足。**17:12:58 +08:00** 的单次只读采样显示：
pytest 工作集 **2790.6 MiB**，主机可用内存 **411.4 MiB**。
这不是持续监测、峰值 RSS 或已证明的唯一根因。

复查使用原有 49 项，不删除或放宽断言；临时观察器只在导入失败时附加响应详情
与可用内存，不替换响应、不修改准入或阈值。49 项均通过，因此未复现原失败。
不能将复查与第一次 1392 项相加后声称单进程全量通过。

本地开发 PostgreSQL 仍为 **0028**，未执行升级、清空或重建。
CI 必须在其独立临时 PostgreSQL 上验证完整 API、0052 current/head 和全部既有门禁。
本次没有本地 Web build/PWA、Linux PID 1 或 2 GiB/60 分钟压力验收；
此前局部 PostgreSQL 和资源证据只保留各自原边界。

## 发布检查脚本修复

原 `scripts/check-local.ps1` 只有 `$ErrorActionPreference = "Stop"`，
Windows PowerShell 不会据此把 pytest 等原生命令的非零退出码变为终止错误。
因此第一次 API 失败后，旧脚本仍继续 Web 检查并打印 `Release check completed`，
整个进程返回 0。该输出明确**不作为通过证据**。

现在逐项检查 PostgreSQL client/readiness、API migration/tests、
Web typecheck/lint 的 `$LASTEXITCODE`；非零即抛错，后续门禁不再执行。
API 段及 release 最后 migration 段均通过 `finally` 恢复目录；
最后的原生命令同样不能被忽略。

使用单独 Windows PowerShell 进程和合成命令验证六个本地失败位置、
完整本地成功、最终 migration 失败及完整 release 成功，共 **9/9**。
未执行真实测试/数据库/网络命令；这只验证控制流，不替代完整门禁。
脱敏汇总见[准备证据](../evidence/oom-release-preflight-2026-10-19.json)。

## CI 与部署边界

1. 使用本地已有令牌推送 fast-forward 提交，不改写远端历史。
2. 手动启动现有 `Build release images`，不删除/跳过任何质量任务或镜像检查。
3. 记录精确 source/run 后等待用户反馈；不在此阶段连接生产并替换服务。
4. CI 全通过后，独立核验精确原始制品、镜像来源和部署支持文件。
5. 按现有低内存程序执行容量/备份/停止写入/镜像替换/只读验收，
   不在工作站或 King 构建镜像，不覆盖生产 `.env`，不重启 PostgreSQL。
6. 本轮与当前直接前版均为 0052；不执行无必要 migration/downgrade。
   更老的 0051 回退仍受原撤销保护授权规则约束。

以上是发布前的边界，不预记为通过。以下补记实际执行结果。

## 精确源码 CI 与制品

用户报告 CI 通过后，复核 **39231559224 attempt 1** 的
`web-quality`、`settings-quality`、`api-quality`、`build-images`、
`inspect-release-artifact` 均成功，源码为
`50f6de4b2e72ad33bd4d351ada6f95c0b3583898`。
原始 `chat-reader-images-<source>-1` 制品的 manifest、镜像摘要和检查结果一致。
下载与上传的镜像归档 SHA-256 一致；本轮没有 GitHub 网页登录或 web search。

| 运行角色 | CI 镜像摘要 |
| --- | --- |
| API / import-worker | `sha256:0db17dc9db6e1e51f663122dacb75f9186762aa9c38c88dffc287470a4f01b14` |
| Web | `sha256:fcfa797b76bca0de9ee685b83f965084aa2feae4016e3867bafa67ccc0122d01` |

## 备份、替换与保留的失败

1. 容量检查最初在没有显式 `API_IMAGE` 的情况下调用旧运维脚本。
   Compose 缺少默认 `latest`，意外在 King 构建了一个 API 镜像。
   该副作用违反“生产不构建”的发布边界，不能把本轮说成全程无生产构建。
   当时未替换 serving 容器；之后确认该 `latest` 没有容器使用并精确删除，
   显式传入已有 f3b331a 镜像后容量检查通过。
2. `chat-reader-20261019T115316Z` 五组件备份验证成功，四个未变组件通过
   既有 hardlink 去重避免重复存储 **804,585,754 字节**。
   这是替换前在线采集，不声称是停止写入的跨组件原子快照。
3. 原始 CI 镜像加载并核对摘要。服务器 Compose 不支持
   `run --no-build`，该命令在运行前失败；改用已存在的精确 CI image 执行
   migrate 命令成功。没有待执行 schema 升级，管理员部署配置报告未变化，
   current/head 保持 `20261017_0052`。
4. 使用 `up -d --no-build --no-deps --force-recreate api import-worker web`
   与显式 CI image 替换三项应用。PostgreSQL 未重启，未覆盖 `.env`、
   Compose/Nginx 或运维 checkout，未修改 `apps/api/storage/imports/`。
5. 运维 checkout 的旧健康脚本仍尝试 serving-container 完整诊断，被
   `SERVING_CONTAINER_DIAGNOSTICS_FORBIDDEN` 拒绝。之后改用精确源码
   release support 的轻量脚本，没有重试旧全量诊断。
   support archive 内 shell 文件为 CRLF；操作副本转换 LF，并验证只做了
   换行规范化，以 `sh` 调用，原始 source archive 保留。

**未修复 P1：** `preflight_release_space.sh` 与 `backup.sh` 的 one-off
没有先钉住并验证已有 immutable image，可能隐式 build。`run --no-build`
在本机服务器不受支持，不是可用修复。后续源码应 fail-closed 并增加缺失镜像
回归；本次没有偷偷改动已通过 CI 的产品源码再部署。

## 独立运行验收

独立审计完成于 **2026-10-19 12:27:23 UTC / 20:27:23 +08:00**。
[脱敏证据](../evidence/oom-release-2026-10-19.json)仅保留版本、健康、
资源和清理计数，不含用户内容或身份。

| 检查 | 实际结果 |
| --- | --- |
| API / Web / PostgreSQL | running，health=healthy |
| worker | running，heartbeat=`alive_idle`，审计时 20 秒新鲜 |
| 应用重启 / OOMKilled | 三项均为 0 / false |
| API / Web 本地 health、公开 HTTPS health、登录页 | 全部 200 |
| HTTP→HTTPS | 301，指向正式 HTTPS 地址 |
| 未认证 capabilities / 公开 diagnostics | 401 / 404，符合访问边界 |
| 数据库 current/head | `20261017_0052` |
| kernel OOM | 审计采样未见新 API 启动后的事件，不是长期负载保证 |
| 当前 / 直接回退 | `50f6de4 / f3b331a`，状态文件权限及镜像配对通过 |

第一次审计被 Web 日志中的五行 Server Reference ID 格式错误阻止。
复核均为无效 Action ID `x`；用合成 `Next-Action: x` POST 验证返回 404，
源码未发现相应 Action。最终报告保留五行计数，未复核的错误关键词行数为零；
不把它们删掉或记作“全部日志零错误”。

审计时主机 RAM **1,915,900 KiB**，可用 **348,688 KiB**，
swap 总计 **3,146,744 KiB**、可用 **2,719,608 KiB**。这是一次采样，
不是 RSS 峰值、60 分钟或 2 GiB 综合压力验收。

## 验收后备份与镜像清理

按用户继续检查旧备份的要求，在成功发布后执行现有 retention helper。
它重新验证五份备份，移除三份旧集合，保留：

- `chat-reader-20261018T160748Z`：前一次停止写入的恢复点；
- `chat-reader-20261019T115316Z`：本次替换前已验证恢复点。

helper 报告 `removed=3 / retained=2 / held=1`，unlink 对象逻辑大小合计
**2,910,357,448 字节**。该数字不冒充净释放物理空间：未变组件共享硬链接，
也不声称两个恢复点是两份独立物理副本。held 条目未处理。
旧应用镜像只保留 **50f6de4** 与直接回退 **f3b331a** 的相关 tags，
没有全局 prune、删除 volume 或用户导入资料。已加载验收的镜像传输归档删除，
manifest、image-inspection、source support 和 acceptance audit 仍保留。

**2026-10-19 12:50:52 UTC / 20:50:52 +08:00** 清理后复核：
应用仍 running、零重启、OOMKilled=false；根分区可用 **9,410,340 KiB**
（约 **9.0 GiB**）。当前/回退 marker 与真实镜像、轻量健康/HTTPS 均通过。

## 终态与未执行项目

- 产品源码已部署：`50f6de4`；后续文档收尾不构成再次产品发布。
- 无新 migration；直接回退无需降级。更老的 0051 回退仍须先撤销保护授权。
- 未执行认证浏览器全量验收、Docker PID 1、60 分钟低内存业务压力或全量数据比对。
- 不宣称消除所有 OOM、取得零停机或把固定默认 Skill ZIP 升级。
- preflight/backup 隐式 build 的 P1 仍待下一轮源码修复与 CI。
- 文档与脱敏证据同步，不再次推送、触发 CI 或部署；本轮临时复核现场保留。

文档收尾实际检查：`git diff --check`、新增相对文件/标题链接 **27/27**、
脱敏 JSON 与独立 runtime audit 的 source/run/digest/health/log 计数一致性通过。
只有文档与证据变化，没有新的产品源码修改。规则未变，生成式 Agent 记忆未写入。
收尾文档为本地未提交修改；不据本机陈旧的 remote-tracking ref 推断远端状态。
额外 `git ls-remote` 只读检查因 Git SSH/443 connection reset 失败，未盲重试；
精确 CI source 和实际运行镜像已由独立制品/运行审计验证，远端分支头未重新确认。
