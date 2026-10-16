# UX 审查与修复前证据：源码编辑器附件选择器读取恢复

日期：2026-10-15

## 范围与证据

审查源码编辑器中“选择当前对话文件”弹层的附件列表读取、失败和空列表
反馈。证据来自当前源码
`apps/web/features/editing/source-editor-workspace.tsx`；没有启动服务、
浏览器或测试，因此没有观察真实附件 API、Query 缓存或焦点表现。

## 发现

### ERR-EDITOR-ATTACHMENT-PICKER-READ-01 · 附件读取失败被显示为“没有可用文件”

| | |
|---|---|
| **Dimension** | System status / Error recovery |
| **Severity** | Medium |
| **Confidence** | Observed (code); user-visible false empty state is Inferred |
| **Effort** | S |
| **Location** | `apps/web/features/editing/source-editor-workspace.tsx:487–537` |

**Evidence.** `ConversationAttachmentPicker` 使用
`useQuery(["conversation-attachments", conversationId])` 读取附件；视图只判断
`query.isLoading`，随后在 `items.length === 0` 时显示“没有可用文件”。没有
`query.isError` 分支，也没有列表 Retry。因此网络、权限或暂时 API 失败会被
当作确定的空列表；若 Query 保留旧数据，刷新失败也没有告诉用户列表可能过时。

**Why it matters.** 用户在编辑消息时无法区分“这个对话确实没有可插入的可用
文件”和“文件列表暂时读不到”，会放弃插入、重复关闭重开，或误以为附件已被
删除。

**Recommendation.** 给弹层增加独立的读取错误反馈和只读 Retry；失败且无数据
时禁止空列表结论，失败但有旧数据时保留可见条目并明确提示列表未刷新。
Retry 只重新读取同一个附件查询，不创建、上传、删除或插入附件。空状态只在
读取成功后显示。

## 修复边界

- 只修改弹层读取状态、稳定文案、错误提示、Retry 和空状态门槛。
- 不修改附件上传/最终化、缓存、权限、编辑器正文、插入位置或 API 合同。
- 保留已读取的可用附件和当前搜索词；Retry 不触发上传或写入。
- 新回归为未执行的源码/状态检查；真实 API、Query 缓存、浏览器弹层、
  焦点和屏幕阅读器结果仍待授权后的专项验证。

本报告先于本批产品源码修改创建。本批不启动服务、不运行测试、lint、类型检查、
build 或浏览器，不提交、不触发 CI、不部署。

## 已实施的源码修复

附件选择器现在区分读取中、读取失败、成功空列表和成功列表。读取失败且无
可用旧数据时显示稳定错误与 Retry，不再显示“没有可用文件”；失败但保留旧数据
时继续显示条目并提示列表未刷新。Retry 只调用同一个 Query 的 `refetch`，
空状态只在非错误且非读取中的成功结果下出现。

`scripts/ux/source-editor-attachment-picker-read-recovery.test.mjs` 已编写为
源码/状态回归，但未执行；它不建立真实 Query、附件 API、React 弹层或浏览器
焦点验收。本批仍未启动服务、运行 lint／类型检查／build，未提交、触发 CI 或部署。
