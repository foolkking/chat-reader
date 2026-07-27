# 系统概览

最后核验日期：2026-07-26
核验代码：`master` / `e752e9ddf25595c3f373977a1803956354ca71b0`
线上入口：`https://chat.king.2bd.net`

## 定位与边界

- `已确认` 项目名称为 `chat-reader`，页面品牌显示为 `Chat Reader`。证据：根目录 `README.md`、`apps/web/app/layout.tsx`、截图 `PAGE-001`。
- `已确认` 项目用于导入 ChatGPT 导出内容并长期阅读、整理和管理，不是在线聊天机器人。证据：根目录 `README.md`；前端没有消息输入/模型选择，后端没有模型生成接口。
- `已确认` 核心对象是 Conversation、Message、MessageVersion、RenderBlock、Heading、Project、Annotation、Notebook、Share 和离线包。证据：`apps/api/app/models/`、Alembic migrations。
- `部分确认` 目标用户是管理本人导出资料的单一资料拥有者，以及通过 Share token 访问只读内容的访客。前者由产品说明和 `local:default` 数据主体共同支持，但仓库没有正式 persona 文档。
- `已确认` 当前构建没有注册、登录、会员、计费、在线 AI 生成或管理后台子系统。该结论来自对前端路由、菜单、API、模型和鉴权依赖的交叉搜索，而不等同于未来产品规划。

## 主要场景

1. 导入 `.cr`、JSON、Markdown、文本或 CSV 来源，先预览再提交后台任务。
2. 在全量对话流、Project、归档或搜索结果中找到会话。
3. 使用消息窗口、对话 TOC、章节 TOC、代码/公式/图表渲染阅读长对话。
4. 编辑 canonical 消息并保留版本，或拆分、合并、归档、移动和导出资料。
5. 为正文建立高亮、下划线、删除线、评论或消息书签，并整理精选笔记。
6. 生成受 token 限制的只读 Share 页面。
7. 下载单个对话、Project 或全部资料到 `/library`，在已准备 PWA 壳后离线阅读、搜索和编辑批注/笔记。

## 系统模块

```text
浏览器
├── 在线管理与阅读：/, /projects/*, /conversations/*, /search, /archived
├── 公开只读分享：/share/[token]
├── 独立离线资料库 PWA：/library
└── 同源 /api/*
    ↓ Next.js rewrite
FastAPI
├── canonical/import/edit/search/reader API
├── project/share/export/offline/annotation API
├── durable background job queue
└── SQLAlchemy
    ↓
PostgreSQL + 文件型导入/导出/离线包存储
```

生产通过 Nginx 提供 HTTPS，Next.js Web 仅绑定服务器回环地址，FastAPI、后台 worker 和 PostgreSQL 运行在 Docker Compose 中。证据：`docker-compose.production.yml`、`deploy/nginx-chat-reader.conf`、脱敏生产只读检查 `PROD-RUNTIME-001`。

## 当前入口与子系统

| 子系统 | 入口 | 状态 | 事实来源 |
| --- | --- | --- | --- |
| 在线资料管理 | `/` | 已确认 | `apps/web/app/page.tsx`、`PAGE-001` |
| 长对话阅读器 | `/conversations/[conversationId]` | 已确认 | 路由代码、`PAGE-007`、生产操作 |
| Project 管理 | `/projects/[projectId]` | 已确认 | 路由代码、`PAGE-004` |
| 全局搜索 | `/search` | 已确认 | 路由/API、`PAGE-006` |
| 归档管理 | `/archived` | 已确认 | 路由代码、`PAGE-005`、`STATE-001` |
| 最近记录 | `/recent` | 已确认（入口隐藏） | 路由/API 可访问；当前侧栏未发现直接入口 |
| 只读分享 | `/share/[token]` | 部分确认 | 前后端代码完整；未使用真实 token 打开生产分享页 |
| 离线资料库 | `/library` | 已确认 | 路由、SW、Dexie、`PAGE-010/011/016` |
| 连接失败页 | `/offline` | 已确认 | 路由、`STATE-004` |

## 部署状态

- `已确认` 线上域名在核验时可访问，首页、归档、最近、搜索、资料库、离线页、manifest、两个 Service Worker 和 health endpoint 返回 HTTP 200。
- `已确认` 本地 `HEAD` 与生产 `/opt/chat-reader` 的 Git `HEAD` 相同。
- `已确认` 生产 Alembic 版本为 `20260724_0015 (head)`；API、Web 和 PostgreSQL 健康，import worker 运行。
- `部分确认` 系统被部署为生产 Compose 栈，但仓库没有正式发布阶段、SLA 或用户规模声明。

## 尚未确认

- 当前生产使用人数、数据规模增长策略、备份保留周期与恢复演练结果。
- 生产 Nginx 的实际 TLS 证书来源和完整配置；仓库只含 HTTP 示例配置。
- 公开分享页在有效生产 token 下的完整视觉状态。
- 缓存清空、浏览器配额耗尽和完全离线冷启动的真实设备结果；代码与自动化场景存在，本次未执行破坏性或网络隔离测试。

## 第二轮实施状态（2026-07-27）

首页、`/recent`、Cmd/Ctrl+K 搜索、Reader focus/双 TOC、批注浮窗与固定覆盖左侧栏、移动 Reader、`/library` 均已在本地构建和 Playwright fixture 中核验。批注已进入 SearchDocument，API 与 worker 需要随发布重建。数据库结构、Dexie version 1、offline package 和 Share token 语义未改变。
