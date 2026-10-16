# UX 审查与修复前证据：管理员访问设置错误提示

日期：2026-10-14

## 范围与证据

本次审查覆盖设置中的管理员“用户与访问”面板，包括读取访问设置、保存注册
模式、更新账户状态、创建密码重置链接、创建邀请和撤销邀请。证据来自当前
源码；没有启动服务、登录、浏览器、测试或构建，因此没有运行时截图或真实
服务端错误样本。

已查看：

- `apps/web/components/admin-access-panel.tsx`
- `apps/web/lib/account-access-client.ts`
- `apps/web/lib/auth-client.ts`

## 发现

### ERR-ADMIN-ACCESS-01 · 服务端错误原文直接显示在管理员面板

| | |
|---|---|
| **Dimension** | System status & feedback / Error recovery |
| **Severity** | Medium |
| **Confidence** | Observed (code); rendered consequence Inferred |
| **Effort** | S |
| **Location** | `apps/web/components/admin-access-panel.tsx:56–140` |

**Evidence.** 访问客户端在非 2xx 响应中读取 `detail` 并放入
`AuthRequestError.message`；管理员面板的读取、注册模式、用户状态、重置链接、
创建邀请和撤销邀请分支都优先把 `cause.message` 写入 `error`，因此服务端或
代理原文可以进入界面。

**Why it matters.** `detail` 可能是未本地化的实现文本、代理错误或请求上下文。
它不能稳定说明管理员下一步，也会让不同接口的反馈风格不一致。

**Recommendation.** 按连接失败、未授权／无权限、并发冲突、参数拒绝和未知结果
映射到稳定双语文案；保留每个操作已有的 fallback、账户状态、输入值、一次性
链接和现有重试路径，不暴露原始 `detail`。

## 修复契约

- 只改变管理员面板的展示文案，不改变 API 请求、权限、确认弹窗或本地状态。
- 识别 `AuthRequestError.status` 与稳定的 `CONNECTION_FAILED` 标记。
- 未知异常使用当前操作的既有 fallback。
- 不记录或展示服务端响应正文，不增加请求、轮询、依赖或部署变更。

本报告在源码编辑前写入，后续只做上述范围内的本地修复。

## 已实施的源码修复

`AdminAccessPanel` 现在将连接失败、401/403、409、422、429、5xx 和未知
异常映射为稳定的双语恢复文案，继续使用各操作原有的 fallback。服务端
`detail`、代理文本和其他异常原文不再直接显示；确认弹窗、权限请求、输入状态、
一次性链接和现有请求流程均未改变。

本批仅做源码与文档修复，未启动服务、登录、运行测试／构建／静态验证，未提交、
未触发 CI，也未部署；运行时效果由用户后续验证。
