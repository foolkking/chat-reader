# UX audit — offline conversation files recovery

2026-10-14（本地日期）。本次只检查普通读者在离线阅读器中打开“当前对话文件”
面板后的读取失败恢复。没有登录、没有启动服务、没有使用线上页面；证据来自当前
工作树源码和既有离线文件流程。用户已明确本轮不需要浏览器或本地运行验证，后续由
用户自行验收。

## Scope & evidence base

检查范围是
`apps/web/features/attachments/offline-conversation-files-panel.tsx` 的文件列表
读取、筛选状态与错误分支。未检查真实 IndexedDB 时序、浏览器渲染、屏幕阅读器或
设备资源占用。

修复前源文件 SHA-256：
`7f7215c7d2861bd17c921acd8c2220d375e4bb226d661216febf1672f29e9302`

## Finding

### ERR-OFFLINE-FILES-01 · 离线文件列表失败没有局部重试入口

| | |
|---|---|
| **Dimension** | Error prevention & recovery / System status |
| **Severity** | Medium |
| **Confidence** | Observed (code) |
| **Effort** | S |
| **Location** | `apps/web/features/attachments/offline-conversation-files-panel.tsx:81–109` |

**Evidence.** 当 `listOfflineConversationAttachments(conversationId)` 失败时，
组件只渲染“无法读取离线文件列表。”这一条 `role="alert"` 文本，没有调用
`filesQuery.refetch()` 的控件。文件列表查询仍可能保留已有 `data`，但用户没有
办法在当前面板中重新读取；只能关闭面板、重新进入或重新加载阅读器。

**Why it matters.** 离线资料依赖浏览器本地存储，读取失败可能是暂时性的存储
连接或本机状态问题。读者仍在当前对话中时，关闭并重新打开会丢失当前筛选和阅读
上下文，也不能帮助恢复本次面板状态。

**Recommendation.** 在现有错误区域加入局部、只读的“重试”按钮，调用已有
`filesQuery.refetch()`；重试期间禁用按钮。保留已有查询数据、搜索词、筛选项和
下载／预览／定位行为，不加入轮询、自动下载或新缓存格式。

## Implemented narrow repair

错误区域现在保留原有错误说明，并提供中英文局部重试按钮。按钮只重新执行当前
文件列表查询，使用 `isFetching` 防止重复触发；没有新增自动重试、网络请求之外
的副作用、数据删除或离线包格式变化。

## Verification boundary

按用户要求，本批不运行浏览器、服务、脚本测试、lint、typecheck、build、CI 或
部署。修复后的人工验收应覆盖：首次读取失败、已有缓存数据下失败、重复失败、
点击重试恢复，以及搜索／筛选状态保持。
