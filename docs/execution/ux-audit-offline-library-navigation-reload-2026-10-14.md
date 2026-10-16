# UX 审查与修复前证据：离线资料库导航触发全量重读

日期：2026-10-14

## 范围与证据

本次审查覆盖 `/library` 离线资料库从侧栏选择对话到本地搜索索引刷新的路径。
证据来自当前源码；没有启动服务、登录、浏览器、测试或构建，因此没有运行时
截图、性能采样或真实设备内存数据。

已查看：

- `apps/web/features/offline/library-shell.tsx`
- `apps/web/lib/offline-search.ts`
- `apps/web/lib/offline-db.ts`

## 发现

### PERF-OFFLINE-01 · 选择对话会重新读取并重建整个离线资料库

| | |
|---|---|
| **Dimension** | Efficiency / Navigation |
| **Severity** | High |
| **Confidence** | Observed (code); performance consequence Inferred |
| **Effort** | S |
| **Location** | `apps/web/features/offline/library-shell.tsx:107–202` |

**Evidence.** `reloadLocal` 的 `useCallback` 依赖 `selectedId` 与 `requestedId`，
而其 `useEffect` 会在回调身份变化时再次执行。一次重读会读取全部 conversations
和 messages，随后读取全部 `searchDocuments`、`annotations`、`notebooks`，重新
初始化搜索 Worker，并重新读取存储估算。侧栏选择对话会改变 `selectedId`，URL
参数也会改变 `requestedId`，因此普通导航会触发这套全量操作。

**Why it matters.** 阅读者只是切换已下载的对话，却会承担与资料库刷新相同的
IndexedDB 读取、消息统计遍历和搜索索引重建。资料库越大，切换越容易出现无关的
短暂卡顿、额外内存峰值和搜索 Worker 重启；这也没有给用户带来新的资料。

**Recommendation.** 将“资料库刷新”保持为稳定回调，把“没有当前选择时决定初始
对话”移到独立 effect。下载完成、删除或显式重试仍可调用 `reloadLocal`；单纯
选择对话或更新 URL 不应重建整库索引。

## 修复契约

- 不改变离线包 v1/v2/v3 读取、对话排序、消息统计修复、搜索内容或选中语义。
- 首次进入资料库、下载完成、删除和显式重试仍执行现有刷新。
- 只拆分 React effect 依赖，避免导航触发额外 IndexedDB 全量读取和搜索 Worker
  重建。
- 本报告在源码编辑前写入；本批不启动服务，不登录，不运行测试／构建，不提交、
  不触发 CI，也不部署，运行时效果由用户后续验证。

## 已实施的源码修复

`LibraryShell` 现在把资料库读取与初次选中逻辑分开：`reloadLocal` 不再捕获
`selectedId` 或 URL 参数，也不再因对话导航改变回调身份；初次没有选择时由独立
effect 根据 URL、记忆的对话或首项决定选择。下载完成、删除和显式重试仍调用
原有刷新函数；离线包读取、消息统计修复、搜索文档组合、搜索 Worker 初始化和
存储估算逻辑均未改变。

本批仅做源码与文档修复，未启动服务、登录、运行测试／构建／静态验证，未提交、
未触发 CI，也未部署；运行时效果由用户后续验证。
