# 用户角色、身份与权限

Last synchronized: 2026-11-04. Current runtime and remaining interactive
acceptance limits are recorded in [Project State](../../PROJECT_STATE.md).

## Current implementation (deployed)

The repository now contains a two-role account model:

| Role | Meaning | Scope |
| --- | --- | --- |
| `ADMIN` | Exactly one deployment-provisioned administrator | Owns the migrated legacy archive and manages registration, users and system archive operations |
| `USER` | Regular private archive account | Can create and manage only resources whose `owner_user_id` equals the authenticated account |

The legacy `owner` principal is bound to the single `ADMIN` user by migration
`20260901_0030`; new users are never promoted through public registration.
Sessions, preferences, annotations, reading positions, Skills and Offline
metadata use the authenticated account UUID. Share tokens remain independent
read-only capabilities. The migration and deployment of this model are live.
The single-owner/no-login descriptions in older release records are superseded
by this account model and [Authentication](AUTHENTICATION_CONTRACT.md).

<a id="current-identity-model-2026-08-17"></a>

The old 2026-08-17 identity anchor is retained for incoming links; it does not
define the current owner or public Share authentication contract.

## 身份模型

- 应用支持注册策略、登录、设备 session、单管理员和隔离账户；公开注册只能创建 `USER`。
- 私有管理、偏好和位置从服务端会话获取用户 UUID；`local:default` 仅为 legacy 开发/测试兼容，不是生产身份选择器。
- Share token 是只读能力凭证：创建时只返回一次原 token，数据库保存 SHA-256 hash 和 prefix。
- `/library` 的受保护数据和 outbox 绑定已验证账户；授权失效时锁定，仅同一已验证账户可恢复。离线能力不绕过服务端联网授权。

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
| 阅读位置 | 服务端当前账户 UUID | 账户绑定的本地 Dexie | Share 范围的浏览器位置 |

## 校验位置

- 私有 API 通过 session、role 和 owner 校验授权；管理员跨账户只读内容需走专门审计路径，不能将前端隐藏按钮当安全边界。
- Share 的 `/api/shared/{token}/*` 独立校验 hash、expiry、revoke、scope、selected messages 和 include flags。
- 离线 ReaderDataSource 通过 capabilities 禁用 canonical 写操作；离线批注同步使用 UUID、base revision 和 receipt 保证幂等。
- 冲突创建副本而不是覆盖服务器或本地版本。

## 失效表现

- 无效、过期或撤销 Share token 返回 HTTP 错误，公开页显示不可用状态。
- 未认证私有请求拒绝访问；无权或不存在的目标不泄露另一账户数据。认证失败和目标失效不应混为一个成功空列表。
- 无网络且未准备 Library 壳时无法离线启动；已准备但目标未下载时显示本地未下载状态。

## 外部访问控制

应用账户隔离不能替代 HTTPS、代理限制和运维安全。当前发布检查了 canonical HTTPS
与匿名拒绝等有限路径，不等于已完成全部认证生产 UI、跨账户人工操作或真实设备验收。
