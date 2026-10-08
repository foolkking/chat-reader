# 文档导航

[Project State](../PROJECT_STATE.md) 是当前源码、生产、验证边界和下一步的入口。
[累计优化发布记录](execution/OPTIMIZATION_RELEASE_2026-10-08.md) 负责本次提交、
完整 CI、镜像来源、备份迁移和验收；精确候选与生产状态见当前快照。
本次发布已验收完成；当前继续普通用户产品审查，后续改动不等同于已部署。
[后续恢复与导航审查](execution/ux-audit-post-release-recovery-2026-10-08.md)
记录最初六项证据、通过的九项新增浏览器用例，以及后续发现的同版本
离线缓存补齐缺陷和本轮验证边界。最新授权：只把本轮 CI 修复至通过，
之后继续本地审查和优化；未经用户再次明确要求，不再提交／触发 CI 或部署。

此前三十余批摘要保存在[历史入口快照](archive/PROJECT_STATE-before-release-2026-10-08.md)
及各自 execution 记录中。“未提交／未授权部署”等旧状态不覆盖当前用户授权。
本地 Web 启动仍被未确定来源的工具策略拒绝；隔离 CI 浏览器证据不等同于
指定 Windows Chromium 的本地验收。具体边界见当前快照和发布记录。

## 开始这里

| 文档 | 长期职责 |
| --- | --- |
| [README](../README.md) | 产品入口、快速开始和常用命令 |
| [Project State](../PROJECT_STATE.md) | 当前仓库、实现、风险和验证快照 |
| [AGENTS](../AGENTS.md) | 最小开发与智能体工作规则 |
| [产品说明](product.md) | 当前用户能力、工作流和边界 |
| [系统事实索引](system/README.md) | 页面、功能、数据、权限和运行事实 |
| [文档台账](documentation-inventory.md) | 文档分类、所有权与维护方式 |

## 开发与运行

| 文档 | 内容 |
| --- | --- |
| [系统架构](architecture.md) | Web/API/PostgreSQL、canonical 数据和关键数据流 |
| [API 参考](api-reference.md) | 当前 FastAPI 业务接口与兼容路径 |
| [本地开发](development.md) | 环境、安装、migration、启动和测试 |
| [测试](testing.md) | 按风险选择测试、CI gate 和证据边界 |
| [生产部署](deployment.md) | CI 镜像、备份、迁移、验收、回退与运维 |
| [故障排查](troubleshooting.md) | 数据库、代理、Reader、离线、构建和容器问题 |

## 关键合同

| 合同 | 内容 |
| --- | --- |
| [发布安全](system/RELEASE_SAFETY_BASELINE.md) | 依赖风险、secret fail-fast、质量 gate、镜像检查和来源 |
| [CSP](system/CSP_ENFORCEMENT_CONTRACT.md) | 资源白名单、浏览器执行策略和验证 |
| [认证](system/AUTHENTICATION_CONTRACT.md) | 账户、设备会话、Share 与离线身份边界 |
| [离线/PWA](system/PWA_OFFLINE_RESILIENCE_CONTRACT.md) | 兼容包、旧副本保护、故障恢复与真实设备下载 |
| [内容清理](system/CONTENT_CLEANUP_CONTRACT.md) | 规则、选择、版本、源码冲突与明确确认 |
| [Artifact 生命周期](system/ARTIFACT_LIFECYCLE_CONTRACT.md) | staging、发布、事务边界和孤立文件 |
| [任务与离线保留](system/RETENTION_CONTRACT.md) | 任务结果窗口、服务器包和本机副本的区别 |
| [可观测性](system/OBSERVABILITY_CONTRACT.md) | 脱敏日志、诊断、请求与任务状态 |
| [安全清理](system/CLEANUP_CONTRACT.md) | grace、dry-run、明确 apply 和执行时重查 |

其他页面、流程、前后端、数据、权限和依赖专题从
[system/README.md](system/README.md) 按需进入；当前代码和 migration 优先。
带日期的验证只能说明相应时间点，不等于重新验收。

## 历史与数据资产

| 位置 | 使用边界 |
| --- | --- |
| [planning/](planning/README.md) | 带日期的规划；部分决定已被后续用户要求覆盖 |
| [execution/](execution/README.md) | 审计、失败过程、测试和发布证据；不替代当前事实 |
| [evidence/](evidence/README.md) | 各时间点的脱敏测量、合成截图和只读请求证据 |
| [早期 UX 交接](agent-context/UX_AUDIT_HANDOFF.md) | 历史范围说明，新任务从 Project State 开始 |
| [早期状态归档](archive/PROJECT_STATE-history-2026-09-01.md) | 2026-09-01 压缩前快照，不是当前状态 |

`apps/api/storage/imports/**/*.md` 与 `examples/**/*.md` 是用户资料或解析 fixture，
不属于文档系统。不要自动改写、移动或纳入文档链接校验。
