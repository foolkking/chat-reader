# 系统概览

## Current implementation and production boundary — 2026-11-04

Chat Reader is a private multi-account archive. One deployment-provisioned
`ADMIN` owns the migrated legacy archive; registered accounts are `USER` and
are isolated by server-derived `owner_user_id`. Authentication, account
access, invitations, password reset and user-scoped Offline/Skill data are
implemented in the current source and are deployed under schema
`20261030_0058`. Public Share and Offline Reader keep their existing separate
boundaries. Current production source is `be58b12`; the direct rollback is
`3b839dc`.

## Current deployed access boundary — 2026-11-04

Server-side, per-device sessions protect private business APIs, pages and owner
artifact downloads. Explicit public Share paths instead validate their own
token/password/scope capability on every request. Public health remains coarse; protected
diagnostics remains on its separate SSH plus loopback operator boundary.
Anonymous private capability checks remain denied. See
[`AUTHENTICATION_CONTRACT.md`](AUTHENTICATION_CONTRACT.md).

Current runtime and remaining user-side verification debt are recorded in
[`PROJECT_STATE.md`](../../PROJECT_STATE.md) and the
[current release receipt](../execution/SMALL_ZIP_MEMORY_RELEASE_2026-11-04.md).
最后核验：2026-11-04

## 定位与边界

- Chat Reader 用于导入、长期阅读和管理已经线性化、标准化的 AI 对话资料，不发送消息或调用模型生成回答。
- 当前 owner 由认证会话中的用户 UUID 决定；迁移前的 legacy 数据使用固定管理员回填，`local:default` 只作为开发/兼容回退。公开访客通过 Share token 取得只读能力。
- 主要对象：User、Conversation、Message、MessageVersion、RenderBlock、Heading、SearchDocument、Project、Annotation、Notebook、Share、ReadingPosition 和 OfflinePackage。
- 当前提供注册/登录、单管理员与用户账号、邀请、密码重置和 owner 隔离；不提供计费或在线 AI。极长单消息会做 RenderBlock 级虚拟化。

## 系统模块

```text
Browser
├── online management and reader
├── token-scoped Share reader
├── /library offline PWA
└── same-origin /api/*
    -> Next.js rewrite
       -> FastAPI
          -> PostgreSQL
          -> import/export/offline artifact volumes
          -> single background worker
```

| 模块 | 责任 |
| --- | --- |
| Next.js Web | 页面、Reader、Project 管理、Share、Library 和 PWA 壳 |
| FastAPI | canonical CRUD、搜索、Reader turn、Share、导出和离线 API |
| PostgreSQL | 主数据、不可变版本、任务、偏好、批注和阅读位置 |
| Worker | import、conversation merge、`.cr` export、auto-clean 和 offline package |
| Dexie/Cache API | 已下载正文、离线搜索/批注/位置和原子 PWA 壳 |

## 主要场景

1. preview Adaptive JSON/Markdown/ZIP 或 `.cr`，显式提交后异步导入 canonical 数据。
2. 在 Project、未归类、归档或搜索结果中找到会话。
3. 以完整轮次阅读长正文并恢复稳定位置。
4. 编辑/恢复版本、拆分/合并、批量移动或归档。
5. 创建批注和精选笔记，连续阅读或逐条回顾。
6. 创建受限 Share、导出文件或增量更新离线资料库。

## 部署状态

源码 Compose 包含 `postgres`、`migrate`、`api`、`import-worker`、`web`，并提供可选 `scanner` profile；已核验的轻量生产部署不启用该 profile。源码 Alembic 单一 head 为 `20261030_0058`；`worker_runtime_states` 只保存单 worker operational heartbeat/state，不包含业务 payload。

2026-11-04 的精确生产／回退、CI、备份和有限线上探针见[当前发布回执](../execution/SMALL_ZIP_MEMORY_RELEASE_2026-11-04.md)。只读收尾复查确认版本指针、三个服务健康、worker heartbeat 与 HTTPS health/login；这不替代认证 UI 或原 ZIP/离线大包用户验收。早期部署检查点仍在 execution 历史中。

## 安全边界

- 私有管理 API 使用账户鉴权和 owner 隔离；管理员审计能力单独授权。公网仍必须由反向代理提供 HTTPS。
- Share token 只存 hash；每个公开接口校验 token、expiry、revoke、scope 和 include flags。
- raw import artifact 不直接进入 Reader 渲染；canonical Markdown 可投影有界 allowlist 静态 HTML，统一经过 sanitization，禁止脚本、任意属性和可执行文档注入。
- 生产证据不得包含真实正文或可访问 token。
