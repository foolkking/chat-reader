# UX 审查与修复前证据：单对话离线清理的同步范围

日期：2026-10-14

## 范围与限制

本次检查针对离线同步中心中“清理单个对话副本”前的待处理修改处理。目标是保证用户确认的同步、重试和清理范围与界面展示的对话范围一致。

本轮仅进行源码审查和修复，不启动本地服务，不登录，不运行测试、构建或静态检查，不提交 CI，不部署。没有运行时截图或网络行为证据；以下结论来自当前源码路径。

## 证据链

1. `apps/web/components/offline-sync-center.tsx` 在清理单个对话时向 `PendingChangesPanel` 传入该对话的 `conversationIds`。
2. `apps/web/components/pending-changes-panel.tsx` 的 `read()` 调用 `readOfflinePending(conversationIds)`，因此列表和确认文案只描述当前对话。
3. 同一组件的 `sync()` 在有范围时跳过偏好同步，但仍：
   - 无条件把 `offlineDb.outbox` 中所有可重试记录的 `attempts`、`last_error`、`retry_after` 清零；
   - 无参数调用 `flushAnnotationOutbox()`。
4. `apps/web/lib/annotation-sync.ts` 的无参数刷新从整个 outbox 选择批次，并继续调用全局阅读位置批次。
5. `apps/web/lib/reading-position-sync.ts` 的 `flushReadingPositionBatch()` 当前从整个 outbox 选择阅读位置记录。

## 发现

| 编号 | 发现 | 严重度 | 置信度 | 影响 |
| --- | --- | --- | --- | --- |
| STATE-OFFLINE-01 | 单对话清理界面的“先同步”会触发其他对话的批注、笔记和阅读位置提交。界面承诺“其他对话的本机修改保持不变”，但调用边界是全局的。 | High | Observed（源码）/ Inferred（用户后果） | 用户为清理 A 对话做出的操作可能提交 B 对话的修改，违反确认范围和数据边界。 |
| STATE-OFFLINE-02 | 单对话清理会重置全部对话的 outbox 重试次数、错误和退避时间。 | Medium | Observed（源码） | 其他对话的失败状态和退避策略被无提示改变，可能造成重复重试或掩盖失败原因。 |

## 修复契约

- 保留无参数 `flushAnnotationOutbox()` 的全局语义，供账户级同步和后台同步使用。
- 为同步函数增加可选的对话范围；传入范围时，批注、笔记和阅读位置只处理这些对话。
- 单对话清理只重置这些对话的可重试 outbox 状态。
- 偏好同步仍只在无 `conversationIds` 的账户级路径执行。
- 同一数据库上的全局与范围同步串行化，避免范围调用绕过已有同步任务。
- 不改变服务端接口、数据库 schema、迁移、离线包格式或清理确认语义。

## 已实施的源码修复

- `apps/web/components/pending-changes-panel.tsx` 将 outbox 重试状态重置和同步调用都限制到传入的 `conversationIds`；无范围的账户级退出仍执行原有偏好与全局 outbox 同步。
- `apps/web/lib/annotation-sync.ts` 为同步增加可选对话范围，并以数据库级尾队列串行化不同范围；无范围调用仍从全局 outbox 工作。
- `apps/web/lib/reading-position-sync.ts` 为阅读位置选择和重试时间计算增加同一可选范围。

静态检查了现有调用关系和修改后的关键分支；没有执行运行时、测试或构建验证。

## 修复后验证计划

本轮按用户要求不执行测试或本地验收。后续如明确要求验证，再覆盖账户级全局同步、单对话范围同步、失败重试状态和阅读位置 outbox。
