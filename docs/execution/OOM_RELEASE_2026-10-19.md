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

CI 启动、结果及实际部署验收是后续检查点，不能预记为通过。
