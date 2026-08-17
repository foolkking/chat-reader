# 页面与路由地图

## Current route access rule (2026-08-17)

Every application page and business API route, including `/share/[token]` and
direct artifact downloads, requires an authenticated owner session. The public
allowlist is limited to coarse health and the minimal login/session flow.
Historical route labels below describe the earlier pre-Release-N surface and
do not bypass the current authentication middleware.

最后核验：2026-08-05

## 页面路由

| 路由 | 身份/数据源 | 主要职责 | 可见入口 |
| --- | --- | --- | --- |
| `/` | 在线资料拥有者 | Project + 未归类资料总览、导入和管理 | 域名根路径 |
| `/archived` | 在线资料拥有者 | 已归档 conversation/Project 的恢复、删除和批量管理 | 侧栏 |
| `/projects/[projectId]` | 在线资料拥有者 | Project 内对话和批量管理 | Project 树 |
| `/conversations/[conversationId]` | 在线资料拥有者 | Reader、搜索、批注、Share、Export、编辑/版本、当前对话文件 | 各列表、搜索、最近 |
| `/search` | 在线资料拥有者 | 全局多类型搜索与目标定位 | 侧栏/Cmd/Ctrl+K |
| `/recent` | 在线资料拥有者 | 最近打开项目和阅读位置 | 移动端；桌面仅兼容直接 URL/历史 |
| `/share/[token]` | Share 访客 | token/scope 约束只读 Reader | 分享 URL |
| `/library` | 本浏览器离线资料库 | 下载/更新、离线搜索、Reader 和批注同步 | 外观与语言/安装 PWA |
| `/offline` | 任意 | 普通在线页面连接失败提示 | 直接/错误流；不是 Library SW fallback |

另有 Next Route Handler `POST /api/imports/[importId]/commit`；其余 `/api/*` 由 Next rewrite 转发 FastAPI。

## 页面层级

```text
Online shell
├── /, /archived, /projects/*, /recent, /search
└── /conversations/*
    ├── dialogue index + document + section TOC
    ├── search/share/export/current-conversation-files utility drawer
    ├── annotation floating/docked/expanded workspace
    └── editing/version dialogs

Public Share /share/*
Offline PWA /library
Connection state /offline
```

## 重要覆盖层与面板

| UI | 桌面 | 移动 |
| --- | --- | --- |
| 导入 | 两步 modal | 响应式 modal；复杂导入以桌面为主 |
| 外观与语言 | 有边界的紧凑 overlay；更多设置默认折叠 | 同一设置内容适配窄屏 |
| Reader 导航 | 双 TOC/可调 pane | 对话/章节 tabs Sheet |
| 搜索/Share/Export | 统一右侧 utility drawer | Bottom Sheet |
| 当前对话文件 | 右侧抽屉；已使用、未使用、缺失三组 | 全宽 Sheet；保留上传、插入、预览和下载路径 |
| 批注 | 浮窗、左侧 dock、全屏阅读层 | Sheet/展开阅读；复杂管理受桌面能力限制 |
| 数据与备份 | 左下角设置中的系统级 `.cr v4` 导出/空实例恢复 | 同一设置面板的响应式布局 |
| 批量选择 | 固定底部上下文栏 | 长按进入选择，底部上下文栏 |
| 消息编辑/版本 | 左侧源码工作区与紧凑版本弹层 | 顶栏下方全宽源码面板 |

## 状态页与边界

- 全局 loading 使用 Next App Router `loading.tsx`；Reader/搜索/列表各自有 loading、empty、error、retry。
- 仓库没有自定义登录、权限不足或账号失效页，因为应用没有账号系统。
- Library 未下载态在桌面/移动都提供“打开资料库”；有网络时可下载目标 conversation。
- Service Worker navigation fallback 仅限 `/library` scope；普通 `/offline` 页面不承载私有正文缓存。

## 跳转合同

- 搜索、TOC、批注、最近阅读和 URL target 都进入同一 Reader 导航事务。
- 目标可包含 `messageId`、`blockIndex`、`characterOffset`、quote 和 annotation ID。
- 在线与离线互跳时保留 conversation/message/block/offset；Library 中“返回在线版”位于外观与语言，不在 Reader 更多菜单重复。
- Share 页面不进入 canonical 编辑/Project 管理 API。
Current proxy note (2026-08-13): `POST /api/imports/[importId]/commit` is a Pages API handler with a bounded 300-second upstream timeout. Its public path is unchanged. All other `/api/*` requests continue through the Next rewrite to FastAPI.
