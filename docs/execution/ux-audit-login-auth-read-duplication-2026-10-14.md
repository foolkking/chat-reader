# UX 审查与修复前证据：登录页重复读取认证状态

日期：2026-10-14

## 范围与证据

本次审查覆盖 `/login` 首次打开、检查本机退出清理记录以及读取服务器
认证状态的初始化路径。证据来自当前源码；没有启动服务、登录、浏览器、
测试或构建，因此没有真实请求次数或网络时序采样。

已查看：

- `apps/web/app/login/page.tsx`
- `apps/web/lib/auth-client.ts`
- `apps/web/components/signout-cleanup-recovery.tsx`

## 发现

### PERF-AUTH-01 · 清理状态初始化会让认证读取 effect 重跑

| | |
|---|---|
| **Dimension** | Efficiency / Feedback timing |
| **Severity** | Medium |
| **Confidence** | Observed (code); request duplication Inferred |
| **Effort** | S |
| **Location** | `apps/web/app/login/page.tsx:34–55` |

**Evidence.** 同一个 effect 先读取 `pendingSignoutCleanups()` 并把
`cleanupPending` 从初始 `null` 设置为 `false`，随后立即读取
`readAuthSetup()` 与 `readAuthSession()`；但 effect 的依赖又包含
`cleanupPending`，所以状态更新后 effect 会再次执行并再次发起两个读取。
有待处理清理时，清理恢复完成后也需要重新进入认证读取，但两种生命周期
被同一 effect 混合管理。

**Why it matters.** 登录页会在首屏平白重复请求 setup/session，增加网络、
服务器和首屏状态竞争；在连接不稳定时，后一次读取还可能把前一次的结果或
错误覆盖。用户只是打开登录页，并没有产生第二次认证动作。

**Recommendation.** 用一个仅负责首次读取本机清理状态的 effect，另一个只在
`cleanupPending === false` 时读取认证 setup/session。清理恢复完成仍通过状态
从 `true` 变为 `false` 触发一次新的服务器读取；不改变重定向、重新认证和密码
重置可用性语义。

## 修复契约

- 首次无待清理时，每个 setup/session 只发起一次读取。
- 有待清理时，先保持现有恢复界面；恢复完成后再读取一次认证状态。
- 保留 `destination`、`reauthenticate`、账户升级重定向和密码重置入口语义。
- 不改变登录提交、退出清理或 API 合同。
- 本报告在源码编辑前写入；本批不启动服务，不登录，不运行测试／构建，不提交、
  不触发 CI，也不部署，运行时效果由用户后续验证。

## 已实施的源码修复

登录页现在由两个 effect 分别负责本机退出清理状态和服务器认证状态。认证
读取只在 `cleanupPending === false` 时执行；首次无待清理时不会因状态从
`null` 变为 `false` 而重复请求，有待清理时仍在恢复完成后重新读取一次。
重定向、重新认证标记、密码重置可用性和登录提交语义均未改变。

本批仅做源码与文档修复，未启动服务、登录、运行测试／构建／静态验证，未提交、
未触发 CI，也未部署；运行时效果由用户后续验证。
