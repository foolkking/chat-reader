# 用户角色、身份与权限

最后核验日期：2026-07-26

## 当前身份模型

- `已确认` 当前应用没有注册、登录、退出、账号设置、管理员、会员或计费模型。前端没有相关路由/菜单，后端没有认证中间件或 Security dependency，生产首页直接可访问。
- `已确认` 用户级数据以固定主体 `local:default` 保存，见偏好、阅读位置、离线包、批注、精选笔记和同步回执服务。
- `已确认` Share 使用 URL token 作为能力凭证。创建时返回一次原始 token，数据库保存 SHA-256 哈希与前缀；读取时校验哈希、撤销、过期、scope 和 include 选项。证据：`apps/api/app/services/share_service.py`、share routes/models。
- `部分确认` 部署层可能有仓库外访问限制；本次公网访问没有遇到登录网关，仓库也没有该配置。

## 可观察身份

| 身份 | 取得方式 | 页面范围 | 写权限 | 后端校验 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 本地资料拥有者 | 直接访问站点；逻辑主体固定为 `local:default` | 除需要 Share token 的公开页外全部管理页面 | canonical、Project、导入、分享、导出、批注、离线包等接口均可调用 | 无账号鉴权；请求参数与资源存在性/业务约束校验 | 已确认 |
| Share 访客 | 持有有效 `/share/[token]` URL | 指定对话的只读页面 | 无 canonical 写权限；仅 `allow_export=true` 时可下载授权内容 | token hash、过期、撤销、scope/include flags | 已确认（代码），生产页面部分待验证 |
| 离线资料库使用者 | 浏览器中已下载资料并准备壳 | `/library` 本地数据 | 可离线改批注/笔记并写 outbox；canonical 管理禁用 | 本地能力判断；联网同步仍以 `local:default` 处理 | 已确认 |

## 权限矩阵

| 能力 | 本地资料拥有者（在线） | 离线资料库 | Share 访客 |
| --- | --- | --- | --- |
| 阅读、TOC、搜索 | 允许 | 已下载数据允许 | 允许授权范围 |
| 导入、编辑消息、版本恢复 | 允许 | 禁止/不显示 | 禁止 |
| Project 移动、归档、删除 | 允许 | 禁止/不显示 | 禁止 |
| 修改 description | 允许 | 禁止 | 不显示，除非 Share 创建时包含则只读 |
| 批注/精选笔记查看 | 允许 | 允许 | 仅创建者显式包含时只读 |
| 批注/精选笔记修改 | 允许 | 桌面允许，进入 outbox | 禁止 |
| 创建/管理 Share | 允许 | 禁止 | 禁止 |
| 导出 | 允许 | 提供本地 `.cr` 备份入口 | 仅 Share 明确允许 |

## 前后端校验

- 管理 API 依赖 `get_db`，没有基于 Cookie、Bearer header、session 或用户角色的访问控制。
- 前端离线限制不是唯一防线：离线 reader 使用 `ReaderDataSource.capabilities` 隐藏 canonical 管理入口，同时没有可用的远程管理数据源。
- Share 只读限制由独立 `/api/shared/{token}/*` 路由实现，不复用不受 token 限制的管理页面。
- 批注同步使用 UUID、base revision 和 idempotency receipt；冲突生成副本，不是账号级 ACL。

## 登录状态与失效表现

- Cookie/Session/Token 登录：`不适用`（当前实现不存在）。
- Share token 无效、过期或撤销：后端返回 HTTP 错误，前端显示不可用状态；本次未用生产 token制造失效。
- 资源 ID 无效：对话 Reader 显示“对话暂时不可用”，见 `STATE-005`。

## 尚未确认

- Nginx、上游网络或私有基础设施是否另设 IP/VPN/Basic Auth；仓库与公网操作均未显示。
- 多用户迁移后的所有权模型；当前模型字段只预留 `subject_id`，没有可执行的多用户权限规则。

