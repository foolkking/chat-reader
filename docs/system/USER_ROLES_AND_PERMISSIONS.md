# 用户角色、身份与权限

## Current identity model (2026-08-17)

The deployed application has one non-editable logical principal, `owner`.
Authentication is a password-protected, server-side per-device session; it is
not a multi-user account, role or tenancy system. Share tokens constrain the
post-auth read scope but never bypass owner authentication. Historical notes
below that state the application has no login are pre-Release-N snapshots.

最后核验：2026-07-29

## 身份模型

- 应用没有注册、登录、session、会员、管理员或账号所有权模型。
- 在线管理与服务端偏好/位置使用固定主体 `local:default`。
- Share token 是只读能力凭证：创建时只返回一次原 token，数据库保存 SHA-256 hash 和 prefix。
- `/library` 的“身份”是当前浏览器已下载数据及本地 outbox；联网同步仍归属 `local:default`。

## 权限矩阵

| 能力 | 在线资料拥有者 | 离线资料库 | Share 访客 |
| --- | --- | --- | --- |
| 阅读、TOC、搜索 | 全部可见 canonical | 已下载范围 | token 授权 scope |
| 导入、正文编辑、版本恢复 | 允许 | 禁止 | 禁止 |
| Project、归档、批量管理 | 允许 | 只读本地分类 | 禁止 |
| 批注/精选笔记查看 | 允许 | 允许 | include flag 允许时只读 |
| 批注/精选笔记修改 | 允许 | 允许，写 outbox | 禁止 |
| 创建/管理 Share | 允许 | 禁止 | 禁止 |
| 导出 | 允许 | 当前 Reader capability 禁用 | 仅 `allow_export=true` |
| 阅读位置 | 服务端 `local:default` | 本地 Dexie | 浏览器 localStorage |

## 校验位置

- 管理 API 没有 Cookie/Bearer/role dependency；前端隐藏按钮不是公网安全边界。
- Share 的 `/api/shared/{token}/*` 独立校验 hash、expiry、revoke、scope、selected messages 和 include flags。
- 离线 ReaderDataSource 通过 capabilities 禁用 canonical 写操作；离线批注同步使用 UUID、base revision 和 receipt 保证幂等。
- 冲突创建副本而不是覆盖服务器或本地版本。

## 失效表现

- 无效、过期或撤销 Share token 返回 HTTP 错误，公开页显示不可用状态。
- 无效 conversation/project ID 进入对应 error/empty state；不是“未登录”。
- 无网络且未准备 Library 壳时无法离线启动；已准备但目标未下载时显示本地未下载状态。

## 外部访问控制

仓库无法确认实际生产代理是否使用 VPN、Basic Auth、IP allowlist 或访问网关。公网 HTTPS 可达不等于应用具备权限隔离；部署者必须明确承担这一边界。
