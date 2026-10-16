# UX 审查与修复前证据：离线资料库下载状态读取

日期：2026-10-15

## 范围与证据

审查 `/library` 中下载进度、持久化失败记录和本地下载状态订阅的失败反馈。
证据来自当前源码 `apps/web/features/offline/library-shell.tsx`；没有启动服务、
浏览器或测试，因此没有观察真实 Dexie/liveQuery 失败、后台下载是否继续或
设备断电/锁库时序。

## 发现

### ERR-OFFLINE-LIBRARY-STATUS-01 · 下载状态订阅失败时没有反馈或恢复入口

| | |
|---|---|
| **Dimension** | System status / Error recovery |
| **Severity** | Medium |
| **Confidence** | Observed (code); stale progress outcome Inferred |
| **Effort** | S |
| **Location** | `apps/web/features/offline/library-shell.tsx:304–326` |

**Evidence.** `liveQuery(() => listOfflineDownloads()).subscribe` 的 `next` 回调
更新 `download`、`downloadFailure`，并在完成记录变化后触发本地刷新；但
`error: () => undefined` 不做任何状态改变。订阅一旦失败，用户看不到状态
读取失败，也没有重新建立订阅的入口；此前显示的进行中状态可能继续留在界面，
或此前失败记录继续影响提示。该代码不能证明后台任务停止，只能证明 UI 没有
状态读取恢复路径。

**Why it matters.** 用户无法判断“下载仍在后台运行”还是“页面已经无法读取状态”，
容易重复点击、等待一个不会更新的进度，或错过可重试的失败记录。

**Recommendation.** 给下载状态订阅增加独立的有限错误反馈和只读 Retry；
订阅读取失败时停止展示无法确认的旧进度，但不要把它解释为下载已取消或失败。
Retry 只重新打开已有 `liveQuery` 订阅，不提交下载、不重放任务、不覆盖普通
下载操作错误。

## 修复边界

- 只增加订阅状态、局部文案和重新订阅入口。
- 不修改下载记录、后台 worker、取消/重试语义、离线包、Dexie 版本或服务端合同。
- 普通下载启动错误和已确认任务失败继续使用原有反馈。
- 新回归为未执行的源码/状态检查；liveQuery、IndexedDB、后台 worker、
  浏览器和性能结果仍待授权后的专项验证。

本报告先于本批产品源码修改创建。本批不启动服务、不运行测试、lint、类型检查、
build 或浏览器，不提交、不触发 CI、不部署。

## 已实施的源码修复

下载状态 `liveQuery` 现在有独立的订阅错误状态和重新订阅代次。订阅失败时，
页面停止显示无法确认的旧进度和旧失败投影，改为提示“下载可能仍在继续”，
并提供只读的状态读取 Retry；这不表示下载已取消，也不修改后台任务。新的
成功订阅发出记录后会清除状态读取错误，并保留原有完成刷新、失败筛选和进度
映射。普通下载启动错误仍使用既有操作错误反馈。

`scripts/ux/offline-library-download-status-read.test.mjs` 已编写为源码/状态
回归，但未执行；它不建立真实 liveQuery、Dexie、后台 worker 或浏览器验收。
本批仍未启动服务、运行 lint／类型检查／build，未提交、触发 CI 或部署。
