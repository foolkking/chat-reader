# UX audit — conversation split error recovery — 2026-10-14

这是持续普通用户体验优化中的下一批本地源码修复。本批只处理“拆分对话”工作区
读取索引、生成预览和创建新对话时的错误反馈；不改拆分模式、消息选择、服务端
校验、写入事务、项目归属或阅读位置语义。不启动服务、不登录、不做浏览器或自动化
验证，用户将自行验收。本记录先于源码修改建立。

## 范围与修改前证据

范围是 `apps/web/features/editing/conversation-split-workspace.tsx`，并核对了
`split-workspace` API 的已知状态边界：401、403、404、409、422、429，以及网络或
其他未知失败。

修改前文件 SHA-256：

`10CF8C8C576E5272F657EF336C7DAD90E8702315F7EA440856B7A9FB8B494E8A`

## Finding

### CONVERSATION-SPLIT-ERR-01 · 三条失败路径直接展示底层异常

| | |
|---|---|
| **Dimension** | Error prevention & recovery / Consistency |
| **Severity** | Medium |
| **Confidence** | Observed (code) |
| **Effort** | S |
| **Location** | `apps/web/features/editing/conversation-split-workspace.tsx` |

完整对话索引加载、拆分预览和拆分执行的 `catch` 都调用
`errorMessage()`，直接把 `Error.message` 写入工作区的错误区域。底层消息可能来自
API detail、代理、网络或服务端校验文本；普通用户会看到实现细节，且不同语言界面
没有稳定的恢复方向。

服务端已经有足够的状态边界：会话不存在、权限不足、并发变化、选择／标题无效、
请求过频和未知传输失败。客户端只需在界面层分类，不应改变请求或重试策略。

## Planned local repair

- 以 `ApiRequestError` 的状态码／错误码为依据提供稳定中英文提示。
- 401、403、404、409、422、429 各保留可行动方向；未知错误按索引、预览、执行
  操作分别提供兜底提示。
- 服务端已经确认拆分成功后，父级列表刷新失败单独提示，不再把已完成写入误报为
  未确认，也不清除已生成的新对话链接。
- 保留当前选择、标题草稿、预览结果、已有结果和按钮禁用逻辑；不自动重放写请求，
  不新增轮询或请求。

## 实施记录

`conversation-split-workspace.tsx` 现在：

- 不再直接渲染索引、预览和执行异常的原始 `Error.message`。
- 按 API 状态码提供登录、权限、会话缺失、并发变化、输入无效和限流提示；未知
  错误按操作提供稳定中英文恢复文案。
- 将已确认的拆分响应与后续对话列表刷新分开处理；刷新失败时保留结果链接并说明
  可稍后刷新列表，避免用户重复创建。
- 消息选择、标题、服务端校验和请求次数保持不变。

修改后文件 SHA-256：

`AE524D2013C747AF47CF9804710F346BFAAC0174AA0C404D7FBC5A7E43351F22`

## Verification boundary

按用户要求，本批不启动服务、未登录、未运行浏览器／脚本／lint／类型检查／构建，
不提交、未触发 CI 或部署。源码修改不代表运行时验收，由用户自行验证。
