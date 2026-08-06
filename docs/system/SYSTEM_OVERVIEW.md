# 系统概览

最后核验：2026-07-30

## 定位与边界

- Chat Reader 用于导入、长期阅读和管理已经线性化、标准化的 AI 对话资料，不发送消息或调用模型生成回答。
- 当前是单资料拥有者模型，服务端主体固定为 `local:default`；公开访客通过 Share token 取得只读能力。
- 主要对象：Conversation、Message、MessageVersion、RenderBlock、Heading、SearchDocument、Project、Annotation、Notebook、Share、ReadingPosition 和 OfflinePackage。
- 当前没有注册/登录、多用户、计费、在线 AI、标签、HTML/PDF 导出或完整消息/轮次虚拟列表；极长单消息会做 RenderBlock 级虚拟化。

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

1. preview 兼容 JSON（可选 Markdown 校验）或 `.cr`，再异步导入 canonical 数据。
2. 在 Project、未归类、归档或搜索结果中找到会话。
3. 以完整轮次阅读长正文并恢复稳定位置。
4. 编辑/恢复版本、拆分/合并、批量移动或归档。
5. 创建批注和精选笔记，连续阅读或逐条回顾。
6. 创建受限 Share、导出文件或增量更新离线资料库。

## 部署状态

源码 Compose 包含 `postgres`、`migrate`、`api`、`import-worker`、`web`，并提供可选 `scanner` profile；King 不启用该 profile。源码 Alembic 单一 head 为 `20260805_0020`。

最后一份生产发布证据记录于 2026-07-29：生产 migration 为 `20260728_0016`，API/Web/PostgreSQL healthy，worker running，并完成离线 TOC 补丁后的 Chrome 复验。该结论是时间点快照；当前线上状态需重新检查。详见 [execution/DEPLOYMENT_CHECKLIST.md](../execution/DEPLOYMENT_CHECKLIST.md)。

## 安全边界

- 应用管理 API 没有账号鉴权，公网必须由反向代理/VPN/访问网关保护。
- Share token 只存 hash；每个公开接口校验 token、expiry、revoke、scope 和 include flags。
- raw import artifact 不进入 Reader 渲染；导入 Markdown 禁止执行 raw HTML。
- 生产证据不得包含真实正文或可访问 token。
