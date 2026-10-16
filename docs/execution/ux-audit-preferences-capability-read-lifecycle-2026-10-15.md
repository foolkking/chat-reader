# 设置权限读取生命周期审查 — 2026-10-15

## 范围与证据

本轮只审查普通设置入口 `apps/web/components/preferences-panel.tsx` 中读取账户
功能与权限、决定是否显示 Administration 区域的客户端流程。证据来自当前工作树
源码、`apps/web/lib/auth-client.ts` 和认证代次实现；不启动 Web/API 服务，不登录，
不访问生产或用户正文。修改前 SHA-256：
`00172F5355205161AB321908B559938849105C7DD82A169C4016F3DF2902D1F9`。

### 发现

| ID | 维度 | 严重度 | 置信度 | 证据与用户影响 |
| --- | --- | --- | --- | --- |
| SETTINGS-CAP-STATE-01 | 状态覆盖／导航 | High | Observed (code) | `readAccountCapabilities()` 的完成与失败只检查 effect 内的 `active` 布尔值；重试会启动新的读取，但没有请求序列。旧请求可能在新请求之后写入 `accessRole`，导致管理员看不到入口或普通账户暂时看到旧入口。 |
| SETTINGS-CAP-AUTH-02 | 信任／认证边界 | High | Observed (code) | 能力读取没有 `authenticationGeneration()` 守卫；账户切换、登出或身份锁定期间的晚到响应仍可设置管理员角色。虽然后端仍会拒绝越权请求，但用户会进入错误的设置导航并看到不属于当前账户的控制。 |
| SETTINGS-CAP-RESOURCE-03 | 感知性能／资源 | Medium | Observed (code) | 每次重试和组件卸载都不取消已有能力读取，连续点击 Retry 会保留多个请求直到各自超时；这增加了设置页低价值的并发网络与状态回调。 |

## 修复边界

为账户能力读取增加挂载、认证代次、请求序列和 `AbortController` 归属；重试时
只保留最新读取，并在读取期间隐藏未确认的管理员入口。保留现有个人设置分类、
失败后的“Retry”、后端角色判断、事件 key 和管理员权限；不改变 API、权限、
缓存、登录、离线包或数据合同。

## 验收边界

本记录先于源码编辑创建。编辑后只运行 `git diff --check`；本轮不运行服务、登录、
浏览器、测试、构建、CI、提交或部署。真实账户切换、浏览器导航和权限验收仍需
另行授权。

## 实施记录

`PreferencesPanel` 现在为能力读取维护挂载、认证代次、最新请求序列和
`AbortController`；新的重试会取消旧读取并清空未确认的角色，只有最新且当前账户
的成功响应才显示 Administration。取消和卸载不会把旧错误当作当前账户状态。

修改后 SHA-256：
`FF91F6A3BB92CE6A74B3C405FDFC6F061A08B804F83B8F0D4097326F2780B745`。
`git diff --check` 返回 0；真实账户切换、浏览器和完整测试仍未执行。
