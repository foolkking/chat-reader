# Reader 离线错误文案审查（2026-10-14）

## 范围与证据

本轮只审查 canonical Reader 的离线对话读取失败和首屏正文读取失败状态。
证据来自当前源码；没有启动本地服务、登录、浏览器或线上页面，因此“用户会看到
什么布局”不作运行时断言。以下问题是源码直接把异常对象的 `message` 传给
`ReaderState` 的观察。

修改前文件 SHA-256：

- `apps/web/features/conversations/conversation-reader.tsx`
  `CCE4250391768CB057878B3EEFAD6FC6A6113D5AA66C6E7680EDDC5458B68FD7`

## Findings

### READER-ERR-01 — Medium / Observed (code)

当对话读取失败且 Reader 不保留旧内容时，离线分支在
`conversation-reader.tsx:2304-2308` 直接展示 `conversationQuery.error.message`。
异常可能来自本地离线副本、IndexedDB 或请求适配层，文案因此可能混入英文、
内部错误码或实现细节；当前界面语言和错误表达不一定一致。

### READER-ERR-02 — Medium / Observed (code)

当首屏消息窗口读取失败时，离线分支在
`conversation-reader.tsx:2553-2560` 直接展示 `windowQuery.error.message`。
该分支没有现有的内联重试控件，用户得到的是不稳定的技术异常文本，而不是说明
离线副本不可读并指出下一步的稳定恢复提示。

## 为什么影响用户

这两处位于 Reader 的核心打开与首屏阅读路径。离线副本确实不可读时，用户需要
先判断异常文本到底是网络、存储还是数据问题；混合语言或内部错误码会增加误判，
也会让同一 Reader 的恢复体验与其他已本地化的错误状态不一致。问题不会改变
数据本身，但会降低离线阅读失败时的可理解性。

## 处理决策

- 将两处离线分支改为稳定的中英文恢复文案，不再把原始 `Error.message` 直接交给用户。
- 文案说明离线副本读取失败及返回资料库/确认副本后重新打开的方向，不新增请求、
  轮询或重试按钮。
- 保留现有在线权限错误、暂时性错误、重试控件和 `isOffline` 分流；不改变离线
  数据读取、缓存、阅读位置、权限或资源预算。

## 本地实现

`conversation-reader.tsx` 的对话失败分支现在按 `resolvedLocale` 显示“离线对话
无法打开”的恢复提示；首屏消息窗口失败分支显示“离线副本正文无法读取”的恢复
提示。两处仍保持原有离线无按钮策略，在线权限／暂时性失败分支和在线重试控件
未改动。当前状态、用户流程和文档台账已同步。

## 验证边界

按用户当前要求，本批不启动服务、不登录、不运行浏览器、lint、typecheck、build、
测试、CI 或部署；后续由用户自行验证。
