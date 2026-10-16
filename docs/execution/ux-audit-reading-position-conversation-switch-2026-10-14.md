# UX 审查与修复前证据：切换对话时阅读位置状态残留

日期：2026-10-14

## 范围与证据

本次审查覆盖 Reader 在同一组件实例内切换 `conversationId` 时的阅读位置
状态订阅、冲突选择和失败重试。证据来自当前源码；没有启动服务、浏览器、
测试或构建，因此没有真实路由时序采样。

已查看：

- `apps/web/components/reading-position-sync-status.tsx`
- `apps/web/features/conversations/conversation-reader.tsx`

## 发现

### DATA-READER-02 · 旧对话的阅读位置状态会短暂留在新对话上

| | |
|---|---|
| **Dimension** | Consistency / Recovery |
| **Severity** | High |
| **Confidence** | Observed (code); incorrect action window Inferred |
| **Effort** | M |
| **Location** | `apps/web/components/reading-position-sync-status.tsx:16–37, 48–51` |

**Evidence.** 订阅 effect 依赖 `conversationId`，但切换时没有清空
`view`、`navigationTarget`、`readFailed` 或错误状态。旧对话的 liveQuery
结果会继续渲染，直到新查询第一次返回；同时冲突选择使用当前 render 的
`conversationId` 调用 `resolveReadingPosition`，因此旧 `view.local/server`
可能与新对话 ID 组合。`perform` 也没有访问代次，旧的异步恢复完成后仍可
设置错误、busy 或导航状态。

**Why it matters.** 快速切换对话或从离线资料库打开另一个条目时，用户可能
看到上一对话的“另一设备已更新”或同步失败提示，并对当前对话执行错误的
恢复动作。即使短暂，阅读位置是跨设备状态，错误的选择比普通提示闪烁更危险。

## 修复契约

- `conversationId` 改变时，旧的 view、冲突导航目标和本地读取失败状态立即失效，
  新订阅返回前不显示旧对话反馈。
- 旧访问中的异步请求不能改变新访问的错误、busy、导航或读取重试状态。
- 冲突选择、存储重试和服务器位置应用仍只作用于当前对话。
- 保留静默自动保存、冲突解决、离线数据库读取和显式同步中心详情语义。
- 本报告在源码编辑前写入；本批不启动服务，不运行浏览器、测试／构建，不提交、
  不触发 CI，也不部署，运行时效果由用户后续验证。

## 已实施的源码修复

阅读位置状态现在按 `conversationId` 建立访问代次。对话改变时，旧 view、
冲突导航目标、读取失败和错误提示会在新订阅建立前清空；数据库订阅、在线/聚焦
刷新、冲突选择、定位重试和同步重试都只允许当前代次提交状态。旧访问在等待
异步读取或服务器位置应用期间，不会再覆盖新对话的 busy、error 或导航状态。
静默自动保存及同步中心显式详情语义保持不变。

本批仅做源码与文档修复，未启动服务、运行浏览器、测试／构建／静态验证，未提交、
未触发 CI，也未部署；运行时效果由用户后续验证。
