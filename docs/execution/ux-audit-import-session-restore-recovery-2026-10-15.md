# UX 审查与修复前证据：导入会话恢复

日期：2026-10-15

## 范围与证据

审查导入页在浏览器刷新、返回或重新挂载后恢复自适应导入会话的路径。
证据来自当前源码 `apps/web/features/import/import-panel.tsx`；
没有启动服务、浏览器或测试，因此没有观察真实网络错误、会话过期、
组件卸载时序或屏幕阅读器输出。

## 发现

### ERR-IMPORT-SESSION-RESTORE-01 · 恢复读取失败会静默丢失导入工作区

| | |
|---|---|
| **Dimension** | System status / Error recovery |
| **Severity** | High |
| **Confidence** | Observed (code); user-visible disappearance is Inferred |
| **Effort** | S |
| **Location** | `apps/web/features/import/import-panel.tsx:62–74` |

**Evidence.** 组件从 `sessionStorage` 取出活动自适应导入会话 ID 后调用
`getAdaptiveImportSession`。读取成功会恢复工作区；但任何异常都会进入
`.catch(() => window.sessionStorage.removeItem(activeSessionKey))`，既不显示
读取失败，也不保留重试入口。暂时的网络、API 或组件切换错误因此会被当成
“没有进行中的导入”，用户会回到空的文件选择界面；这段代码不能证明服务器
会话或临时源文件已经删除。

**Why it matters.** 导入映射和已上传的临时源属于用户正在进行的工作。把一次
不确定的读取失败转换为本地会话指针删除，会让用户误以为工作区已经消失，
随后重新选择文件，增加重复上传或重复分析的风险。

**Recommendation.** 为恢复读取增加独立的有限状态：恢复中、恢复失败和已完成。
失败时保留 `sessionStorage` 指针，给出稳定的读取错误与只读 Retry；Retry
只重读已有会话，不创建新导入、不重放提交、不取消服务器会话。用户明确
选择新文件时才清除旧的本地恢复指针。已确认的终止会话仍可清除指针。

## 修复边界

- 只修改导入页的恢复状态、局部文案、加载/错误反馈和重读入口。
- 不修改自适应导入 API、临时源文件、canonical 数据、提交/取消/重试语义、
  `.cr` 归档、Share、离线包或服务端 worker。
- 已确认 `COMPLETED`、`CANCELED`、`FAILED` 的会话继续清除本地恢复指针；
  未确认的读取异常不再清除。
- 新回归为未执行的源码/状态检查；真实 API、sessionStorage、React 挂载、
  浏览器刷新和屏幕阅读器结果仍待授权后的专项验证。

本报告先于本批产品源码修改创建。本批不启动服务、不运行测试、lint、类型检查、
build 或浏览器，不提交、不触发 CI、不部署。

## 已实施的源码修复

导入页现在把已保存会话恢复建模为独立的恢复状态。读取期间暂时阻止启动另一
次导入并显示状态；读取失败保留本地会话指针，使用既有稳定的导入读取错误映射
显示错误和 Retry。Retry 只增加恢复读取代次并再次调用
`getAdaptiveImportSession`；用户选择新文件时才清除旧指针。成功恢复以及已确认的
终止状态继续使用原有工作区、提交和清理语义。

`scripts/ux/import-session-restore-recovery.test.mjs` 已编写为源码/状态回归，
但未执行；它不建立真实 sessionStorage、API 请求、React 挂载或浏览器刷新验收。
本批仍未启动服务、运行 lint／类型检查／build，未提交、触发 CI 或部署。
