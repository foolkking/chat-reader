# 修改邮箱确认页生命周期与 token 归属审查 — 2026-10-15

## 范围与证据

本轮只审查现有 `/verify-email` 修改邮箱确认页
`apps/web/features/auth/email-change-confirmation.tsx`。证据来自当前源码和
`docs/system/AUTHENTICATION_CONTRACT.md`；不启动 Web/API 服务，不登录，不读取
邮件、用户正文、token 值或凭据。修改前 SHA-256：
`ED5CBE742BBFF01FE9A1DB325F9668C93357ED83BB80DBA3543224999E05C761`。

### 发现

| ID | 维度 | 严重度 | 置信度 | 证据与用户影响 |
| --- | --- | --- | --- | --- |
| EMAIL-CONF-STATE-01 | 状态覆盖／反馈 | High | Observed (code) | “重新检查”按钮只由 `busy` 禁用，而 `check()` 没有检查中准入或操作序列；连续点击会并发读取，较旧的预览或错误可能覆盖较新的结果。用户可能确认错误的邮箱状态。 |
| EMAIL-CONF-LIFE-02 | 错误恢复／认证 | High | Observed (code) | `check()`、`confirm()` 和 `finally` 直接更新 React 状态，没有 mounted 或 `authenticationGeneration()` 守卫。卸载、登出或切换原账户后，旧请求仍可能显示旧账户的预览／成功提示。 |
| EMAIL-CONF-TOKEN-03 | 信任／数据归属 | High | Observed (code) | 丢失确认响应后的 `readAuthSession()` 只比较可变的 `expected.current`，没有将它与当前 URL token 和确认操作绑定；新一轮检查完成后，旧确认的晚到结果可能使用错误的预览身份判断成功。 |
| EMAIL-CONF-ACTION-04 | 操作反馈 | Medium | Observed (code) | `confirm()` 没有同步操作准入；当前确认尚未结束时，旧回调和重新检查可以交错修改 `preview`、`error`、`busy`，用户无法知道当前按钮对应哪一轮检查。 |

## 修复边界

只增加页面内的 mounted／认证代次／操作序列和当前 token 绑定，阻止重复检查和
交叉确认；保留预览不消费授权、原账户校验、30 分钟单次 grant、当前 session
恢复判断、URL fragment、确认后其他会话撤销及现有 API。不会把 GET 当作写入回执，
不会自动重试确认，不修改邮箱协议、数据库、授权或服务端合同。

## 验收边界

本记录先于源码编辑创建。编辑后只运行 `git diff --check`；本轮不运行服务、登录、
浏览器、测试、构建、CI、提交或部署。真实 SMTP／PostgreSQL、浏览器焦点和跨账户
验收仍需要另行授权。

## 实施记录

确认页现在拒绝并发检查和交叉确认；预览、确认及丢响应后的会话读取均按当前挂载、
认证代次、操作序列和 URL token 准入。恢复成功仍必须同时匹配当前 token、先前预览的
账户 UUID 与目标邮箱；旧页面回调不再发布状态或替换 URL。确认接口、fragment URL、
grant 期限和服务端授权合同保持不变。

修改后 SHA-256：
`B760A21A78BD00D9AA2FE56306D83DF0620D1D1D536E012A6C44BA5D8B92B82E`。
`git diff --check` 返回 0；真实 SMTP／PostgreSQL、浏览器和完整测试仍未执行。
