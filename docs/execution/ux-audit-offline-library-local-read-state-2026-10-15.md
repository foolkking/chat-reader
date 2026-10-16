# UX 审查与修复前证据：离线资料库本地副本读取状态

日期：2026-10-15

## 范围与证据

审查 `/library` 的本地会话列表初读、刷新、失败和空态。证据来自
`apps/web/features/offline/library-shell.tsx` 当前源码；未启动服务、浏览器或
测试，实际渲染、IndexedDB 故障和恢复时序未观察。

## 发现

### STATE-OFFLINE-LIBRARY-01 · 本地列表读取尚未成功时可能被表达为“没有资料”

| | |
|---|---|
| **Dimension** | System status / State coverage |
| **Severity** | Medium |
| **Confidence** | Observed (code); rendered outcome Inferred |
| **Effort** | S |
| **Location** | `apps/web/features/offline/library-shell.tsx:43,118–225,581–593` |

**Evidence.** `conversations` 初始为空。`reloadLocal` 先读取
`offlineDb.conversations` 和 `offlineDb.messages`，读完后才提交列表；其异常
只设置 `searchFailed`。`searchFailed` 只控制已输入查询时的搜索错误视图，
列表区却无本地读取就绪门槛，并在 `!sidebarConversations.length && !query`
时显示“尚未下载资料”。因此在本地读取完成前，或读取失败且在线目录没有
可展示项目时，源码允许空态与读取失败/未完成状态无法区分。

**Why it matters.** 用户可能把暂时无法读取本机资料误认为资料已清空或从未下载，
也没有针对本地列表读取的明确恢复入口。

**Recommendation.** 为本地会话/消息列表读取建立独立于搜索索引的有限状态；
初读时显示读取中，只有成功读取后才允许确认空态，失败时显示局部只读重试。
刷新失败保留最近成功展示的副本。搜索索引错误仍由现有搜索状态单独处理。

## 修复边界

- 只增加界面本地读取状态、反馈和复用现有 `reloadLocal` 的显式 Retry。
- 不重写数据库、不更改 Dexie/offline package 版本、不改变搜索索引或空副本语义。
- 已有本地列表在刷新中继续展示；不把索引读取失败误报为本地列表读取失败。
- 新回归仅作为未执行的源码/状态检查；真实 IndexedDB、React、浏览器、
  无障碍焦点和设备验收仍需后续验证。

本报告先于本批产品源码修改创建。当前批次不启动服务、不运行测试、lint、
类型检查、build 或浏览器，不提交、不触发 CI、不部署。

## 已实施的源码修复

`LibraryShell` 现在独立维护本地会话/消息读取的 `loading`、`ready` 和
`error` 状态，并把搜索索引状态与本地副本列表状态分开。首次读取未完成时，
列表空态不会出现；初次读取失败显示“本地副本未被删除”的局部 Retry。已有
成功列表刷新失败时继续保留当前列表，同时显示刷新提示和同一路径 Retry。
成功读取会先提交可阅读的本地列表，再处理可选的搜索文档读取，因此搜索
辅助失败不会把已读副本误报成读库失败。已有 catalog 下载深链仍可用，
下载、删除、选择、搜索索引和离线包合同未改变。

`scripts/ux/offline-library-local-read-state.test.mjs` 已编写为源码/状态
回归，但未执行；它不建立 React、Dexie、浏览器或屏幕阅读器验收。实际运行、
无障碍焦点、IndexedDB 故障恢复和资源收益仍待用户授权后的专项验证。本批次
仍未启动服务、运行 lint／类型检查／build，未提交、触发 CI 或部署。
