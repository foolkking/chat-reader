# UX 审查与修复前证据：离线同步失败恢复提示

日期：2026-10-14

## 范围与证据

本次审查覆盖 `/settings` 的“离线与同步”中心，以及离线同步失败记录从
本机队列到用户恢复操作的反馈。证据来自当前源码；没有启动服务、登录、浏览器、
测试或构建，因此没有运行时截图、真实网络错误或屏幕阅读器证据。

已查看：

- `apps/web/components/offline-sync-center.tsx`
- `apps/web/lib/annotation-sync.ts`
- `apps/web/lib/reading-position-sync.ts`
- `apps/web/components/reading-position-sync-status.tsx`
- `apps/web/components/preference-sync-status.tsx`

## 发现

### FBK-OFFLINE-01 · 失败类型已记录，但离线中心只显示统一文案

| | |
|---|---|
| **Dimension** | System status & feedback / Error recovery |
| **Severity** | High |
| **Confidence** | Observed (code); rendered consequence Inferred |
| **Effort** | S |
| **Location** | `apps/web/components/offline-sync-center.tsx:245`, `:249` |

**Evidence.** `annotation-sync.ts` 与 `reading-position-sync.ts` 已把同步失败写成
`AUTH`、`INVALID` 或 `NETWORK`；但离线中心待同步行把所有非冲突错误压缩成
“同步失败 · 已尝试 N 次”，失败区域也只显示“这些修改仍保留在本机”，没有
告诉用户是需要重新登录、检查内容，还是等待连接恢复。

**Why it matters.** 用户看到同一个按钮和同一句话，却面对三种完全不同的下一步；
网络失败可以等待，权限失败需要恢复账户，参数拒绝需要打开原内容核对。统一文案
会让用户盲目重复操作，或误以为本机修改已经丢失。

**Recommendation.** 在离线中心按稳定内部分类显示简短中英文恢复方向：
网络／暂时不可用、账户授权需要重新确认、服务器拒绝当前修改；继续保留本机修改
和原内容链接，不暴露 API 或传输层原文。冲突继续使用现有“比较并解决”路径。

### ERR-OFFLINE-02 · “重试同步”缺少对失败类别的边界说明

| | |
|---|---|
| **Dimension** | Error prevention & recovery |
| **Severity** | Medium |
| **Confidence** | Observed (code); user consequence Inferred |
| **Effort** | S |
| **Location** | `apps/web/components/offline-sync-center.tsx:158–160`, `:249` |

**Evidence.** 离线中心的单个“重试同步”按钮会把所有非冲突记录的
`attempts`、`last_error` 和 `retry_after` 清零，再触发后台同步；其中包括
`AUTH` 和 `INVALID` 记录。

**Why it matters.** 用户不能知道重试是否有合理前提；永久性拒绝会被再次提交，
而失败次数和退避信息被重置。虽然修改仍保留，但恢复路径没有帮助用户先处理原因。

**Recommendation.** 保留显式重试入口以支持用户修正后的恢复，但在每条记录显示
原因和“先打开内容核对／重新确认账户／检查连接”的方向；重试按钮的范围和
现有全局离线中心语义不变。

## 修复契约

- 只增加稳定的展示文案，不展示 `Error.message`、API 响应或 URL。
- `NETWORK`、`AUTH`、`INVALID` 使用不同的中英文恢复方向；未知值使用保守通用文案。
- 不改变 outbox、尝试次数、退避、冲突解决或自动同步策略。
- 不改变现有链接和单一全局“重试同步”行为；本批不引入新请求。

本报告在源码编辑前写入，后续只做上述范围内的本地修复。

## 已实施的源码修复

`apps/web/components/offline-sync-center.tsx` 现在将 `NETWORK`、`AUTH`、
`INVALID` 以及未知失败值映射为稳定的中英文恢复提示。待同步列表和失败列表
都说明本机修改仍保留，并把用户引向联网重试、重新确认账户或打开对应内容核对。
冲突仍进入原有“比较并解决”路径；原有内容链接、全局重试按钮、outbox 尝试次数、
退避、自动同步和请求语义均未改变，也没有显示底层异常文本。

本批仅做源码与文档修复，未启动服务、登录、运行测试／构建／静态验证，未提交、
未触发 CI，也未部署；运行时效果由用户后续验证。
