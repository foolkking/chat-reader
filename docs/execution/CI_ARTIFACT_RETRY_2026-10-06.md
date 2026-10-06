# 独立发布包检查重试 — 2026-10-06

状态：工作流已修改，本机合同检查通过；真实 CI 和仅重试检查任务尚待验证。
生产应用继续使用已验收的 `6b4ee0a` / `20261006_0048`，本项不修改应用、数据或部署配置。

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
