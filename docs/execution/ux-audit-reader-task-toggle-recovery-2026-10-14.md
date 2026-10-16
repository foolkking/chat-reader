# UX audit — Reader task toggle recovery — 2026-10-14

这是持续普通用户体验优化中的下一批本地源码修复。本批只处理 Reader 正文中
Markdown 任务勾选的错误反馈与成功写入后的视图刷新边界；不改任务解析、版本、
阅读锚点、请求接口或权限语义。不启动服务、不登录、不做浏览器或自动化验证，用户
将自行验收。本记录先于源码修改建立。

## 范围与修改前证据

范围是 `apps/web/features/conversations/message-item.tsx`，并核对了
`POST /api/messages/{message_id}/tasks/{task_key}/toggle` 的状态边界：
401、403、404、409、422、429，以及网络或其他未知失败。

修改前文件 SHA-256：

`FF5591DFDF0E59AD2103080E783ACA484B2484B120267E6031A5B821BD86B04D`

## Findings

### READER-TASK-ERR-01 · 任务失败直接展示底层异常

| | |
|---|---|
| **Dimension** | Error prevention & recovery / Consistency |
| **Severity** | Medium |
| **Confidence** | Observed (code) |
| **Location** | `apps/web/features/conversations/message-item.tsx` |

任务切换的 `catch` 直接把 `Error.message` 放入正文上方的警告区域。底层消息可能
来自 API detail、代理或网络，普通读者会看到实现文本，且没有稳定的中英文恢复方向。

### READER-TASK-ERR-02 · 已确认写入被正文刷新失败误报

任务接口成功返回后，`replaceMessagePreservingAnchor()` 还会调用父级的
`onChanged` 和布局恢复逻辑；这些后续步骤抛错时会进入同一个 `catch`。因此服务端
已保存的勾选可能被提示为失败，且本地覆盖状态被清掉，造成再次点击或重复操作风险。

## Planned local repair

- 按 API 状态提供稳定的中英文任务恢复提示，未知失败使用保留重试方向的兜底文案。
- 将已确认的任务写入与消息刷新分开；刷新失败时保留已勾选状态并说明稍后刷新，
  不自动重放请求。
- 保留阅读锚点、版本校验、任务解析、禁用状态和现有请求次数。

## 实施记录

`message-item.tsx` 现在：

- 不再把任务切换的 API、代理或网络异常直接显示在正文中；401、403、404、409、
  422、429 和未知失败都有稳定的中英文恢复提示。
- 任务接口返回成功后，正文刷新与锚点恢复属于后续步骤；若该步骤失败，保留本次
  勾选覆盖并提示稍后刷新，不会把已保存状态误报为失败或自动重复提交。
- 原有版本校验、单任务在途锁、阅读位置保持和渲染行为不变。

修改后文件 SHA-256：

`2A0EFF80D772D57B182ACF44953345BCD85EDB4B52E7EB9179A5725D322971CC`

## Verification boundary

按用户要求，本批不启动服务、未登录、未运行浏览器／脚本／lint／类型检查／构建，
不提交、未触发 CI 或部署。源码修改不代表运行时验收，由用户自行验证。
