# 独立发布包检查重试 — 2026-10-06

状态：最终源码 `bdfb725` 的五项 CI 和仅重试检查任务均已通过。
本项不修改应用、数据或部署配置；同批依赖修复的生产发布单独记录。

## 已观察的问题

CI `37366294097` attempt 2 已成功构建镜像，但检查任务因 GitHub runner 故障未启动。
原消费者使用当前 `github.run_attempt` 拼接下载名称；仅重试检查会进入新 attempt，
成功构建所对应的旧名称却不会改变。因此上一轮必须同时重跑构建，额外消耗构建、传输和存储。
参见[实际发布记录](DEPLOYMENT_EXPORT_RETENTION_2026-10-06.md)。

## 修改与边界

- 上传步骤输出不可变 artifact ID，构建任务同时输出原始 producer attempt。
- 独立检查按确切 ID 下载，单独重试仍使用成功构建的同一份包，不搜索“最新包”或相似名称。
- 明确检查引用非空且合法；manifest 必须匹配源码、workflow run、producer attempt 和归档名称。
- Docker 载入后，四个标签的真实镜像 ID、源码及 linux/amd64 架构必须与 manifest 一致；
  每个镜像在构建检查报告中必须恰有一条对应记录。
- 产物缺失、过期、引用丢失或校验失败仍然失败，不回退到别的产物；三天保留期不变。
- API、Web、设置质量门禁和构建后的独立检查全部保留。没有在本机或服务器构建镜像。

## 本机证据

临时目录 `C:/Users/86182/Desktop/wkkk/chat-reader-ci-artifact-retry-20261006/`。
`verify-local.py` 读取实际 YAML 中的 shell guard 与 jq 表达式并执行，**25 项通过**：
同 attempt/后续 attempt、空或非法引用、未来 producer attempt、错误来源/工作流/版本、
不合法镜像摘要、检查报告不匹配与重复镜像条目。输入包括上一版本真实 CI manifest 和检查报告，
变异样本只含发布元数据。shell 语法检查通过；没有执行 Docker。

这些结果不能代替 GitHub 跨 attempt 的 outputs/下载验证。

## 真实 CI 完成条件

1. 当前提交的完整 release workflow 五项通过。
2. 记录本次 build job、artifact ID、producer attempt 和镜像来源。
3. 仅重跑 `inspect-release-artifact`，不重跑 builder；新的消费 attempt 仍通过。
4. 确认 artifact ID、producer attempt 和镜像来源不变，构建步骤没有再次执行。
5. 分开记录本机证据、首次 CI、单独重试；跳过项目不算通过。

本项是发布流程修复，不以再次替换生产镜像作为验收条件。

## 首次 CI 的依赖门禁

提交 `f59247ba17a4bfe59e27c0b36265db0889a1cf95` 启动 CI `37409815492`。
Web lint/typecheck/build 已通过，但官方 npm 审计拒绝新匹配的
`GHSA-68fv-2mgg-jv7q`（source-map-js high）。尚未运行到镜像构建和独立检查，
不能将这次运行计为重试验证成功。最终 API、设置均成功，Web 失败，构建及独立检查跳过。

该发现增加了[独立的依赖修复](SOURCE_MAP_SECURITY_2026-10-06.md)。最终源码需重新通过完整 CI，
然后仅重跑独立检查。CI 重试机制本身不要求重新部署应用；依赖升级则需按发布流程另行验证部署。

## 真实重试结果

最终提交 `bdfb7257341f0f74685de4ad80e339fbde525ab7`，
[CI 37411587470](https://github.com/foolkking/chat-reader/actions/runs/37411587470)：
attempt 1 的 API、Web、设置、构建和独立检查全部成功。

- 原构建 job `112106778613`，执行时间 `04:23:10–04:26:09 UTC`。
- 原检查 job `112107522722`；仅对此 job 发起 rerun。
- attempt 2 检查 job `112108025090`，执行时间 `04:28:17–04:28:41 UTC`，成功。
- 两次使用同一 artifact ID `11389837379`，名称仍为
  `chat-reader-images-bdfb7257341f0f74685de4ad80e339fbde525ab7-1`。
  全部 artifact 元数据未变化；manifest producer attempt 仍为 **1**，consumer 为 **2**。
- GitHub 为沿用的成功任务也生成 attempt 2 记录；构建的沿用记录为 `112108025576`。
  原始和沿用记录的步骤、起止时间及 runner 相同，两份完整构建日志逐字节一致。
  API/Web/设置同样沿用原执行记录；没有重跑质量测试或构建。

本机证据采集器初次假定沿用任务不会生成新 job ID，断言失败；依据实际 API 记录改为
核对完整执行时间、步骤、runner、日志和产物，不再把新记录误当成新执行。
另一次保存日志遇到 Windows 默认编码问题，改用 UTF-8 后成功；这些是证据采集修正，
没有修改 CI、重新构建或放宽发布门禁。

`retry-before.json`、`retry-after.json`、`retry-proof.json` 和对应日志保存在上述任务目录。
真实消费者重试验收完成。
