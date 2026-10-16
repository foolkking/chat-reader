# UX 审查与修复前证据：注册状态读取竞态

日期：2026-10-14

## 范围与证据

本次审查覆盖 `/register` 首次打开、注册状态读取失败后的“重试”以及
返回登录页或切换 `return_to` 后的异步读取生命周期。证据来自当前源码；
没有启动服务、登录、浏览器、测试或构建，因此没有真实网络时序采样。

已查看：

- `apps/web/app/register/page.tsx`
- `apps/web/lib/auth-client.ts`

## 发现

### PERF-AUTH-02 · 注册可用性旧请求可以覆盖重试结果

| | |
|---|---|
| **Dimension** | Feedback timing / Reliability |
| **Severity** | Medium |
| **Confidence** | Observed (code); user-visible race Inferred |
| **Effort** | S |
| **Location** | `apps/web/app/register/page.tsx:34–62` |

**Evidence.** `loadAvailability` 和首次 `useEffect` 都会并行读取
`readAuthSetup()` 与 `readAuthSession()`。点击重试时，函数会把界面重新设为
`LOADING`，但没有取消或标记之前的 Promise。旧请求的成功结果可以在新请求
之后再次设置 `mode` 或触发重定向；旧请求的失败也可以把新请求仍在进行中的
界面改成 `ERROR`。依赖 `destination` 的首次 effect 也没有把旧的请求结果
与当前页面访问区分开。

**Why it matters.** 注册页面会显示错误的开放／邀请状态，或者在用户已触发
新一次检查后被旧结果打断。弱网、网关重试和用户连续点击“重试”时更容易出现，
会让用户无法判断当前状态是否可信。

## 修复契约

- 每次注册状态检查只允许最新请求更新页面状态或触发重定向。
- 页面卸载后，未完成的 setup/session 读取不得再更新组件状态。
- 保留现有 setup-required、已登录重定向、`destination` 和错误文案语义。
- 不改变注册提交、邀请参数、密码校验或 API 合同。
- 本报告在源码编辑前写入；本批不启动服务，不登录，不运行测试／构建，不提交、
  不触发 CI，也不部署，运行时效果由用户后续验证。

## 已实施的源码修复

注册页现在把首次检查和手动重试统一到一个带请求代次的读取入口。只有仍然
挂载且属于最新代次的 `readAuthSetup()` / `readAuthSession()` 结果可以设置
注册模式、错误状态或触发重定向；页面卸载时会退休未完成的代次。原有注册
模式、账户升级重定向、已登录重定向和 `destination` 语义未改变。

本批仅做源码与文档修复，未启动服务、登录、运行测试／构建／静态验证，未提交、
未触发 CI，也未部署；运行时效果由用户后续验证。
