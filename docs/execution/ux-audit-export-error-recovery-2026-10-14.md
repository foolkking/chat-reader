# UX audit — Export error recovery — 2026-10-14

这是持续普通用户体验优化中的下一批本地源码修复。本批只检查对话导出面板的
任务创建失败与后台任务失败文案；不改导出 API、任务幂等键、后台 worker、任务
状态轮询、下载保留或附件限制合同。不启动服务、不登录、不做浏览器或自动化验证、
不提交 CI 或部署，用户将自行验证。本记录先于源码修改建立。

## 范围与修改前证据

范围是 `apps/web/features/exporting/export-panel.tsx` 的队列创建 catch、导出任务
失败状态，以及已有 `batchExportError` 的使用边界。

修改前文件 SHA-256：

- `apps/web/features/exporting/export-panel.tsx`
  `F8F6AA0DFCF14D61D908B8D5F2DCBB73417DD26142D5FF5D73BB4969B1554326`
- `apps/web/lib/batch-export-errors.ts`
  `3BC8C0171460CFD37C0B48C526159A5939E60B138FD5A78D5EF672A292033566`

源码审查确认：

- 创建 Context／附件导出任务的 catch 直接把 `error.message` 放进用户界面，连接
  失败、代理错误和 API 内部文本会被暴露。
- 创建请求的响应可能在客户端断开前已经被服务端接受；当前失败提示只说创建
  失败，没有提醒用户先到任务中心核对，重复点击可能提交重复导出。
- 后台任务失败只翻译 `ATTACHMENT_EXPORT_*` 和 `CONTEXT_EXPORT_*`，其他任务错误
  文本直接渲染 `taskQuery.data.error_message`。
- 已有 `batchExportError` 对已知导出代码提供稳定双语文案和通用兜底，适合复用；
  不需要新增请求或错误协议。

## Findings

| ID | 类型／严重度／置信度 | 用户影响与处理 |
|---|---|---|
| EXPORT-ERR-01 | Defect / Medium / Observed (code)，渲染未验收 | 原始异常可能泄露实现细节且无法指导恢复。将创建失败按状态／导出代码映射为稳定文案。 |
| EXPORT-RECOVERY-02 | Defect / High / Observed (code) | 未知创建结果下立即重试可能重复提交。提示先检查任务中心，保留当前选项和幂等键语义。 |
| EXPORT-TASK-ERR-03 | Defect / Medium / Observed (code) | 后台失败的未知文本直接进入页面。统一使用已知导出代码映射或安全兜底。 |

## 实现边界

- 不自动重试或重新提交导出，不改变现有提交锁、任务状态查询和任务中心入口。
- 已知后端导出错误代码继续使用 `batchExportError`；未知 HTTP／连接结果说明任务
  创建状态未确认，要求先查看任务中心再决定是否重试。
- 保持导出选项、当前任务键、附件限制、失败任务重新生成和下载行为不变。

## Evidence log

- **SEEN (source):** `queueError` 直接来自 `Error.message`；任务失败 JSX 在未知代码
  时直接使用 `error_message`；`batchExportError` 已有稳定的已知代码映射。
- **NOT SEEN:** 登录后的真实导出面板、断网与服务端已接收但客户端丢响应的时序、
  任务中心视觉呈现、屏幕阅读器朗读与设备资源使用。

## Planned local repair

添加状态感知的导出创建错误映射，并将未知结果改为“先检查任务中心再重试”；后台
任务失败统一走导出代码映射和安全兜底，不再渲染原始 `error_message`。仅源码和
文档记录属于本批，运行时验收留给用户。

## 实施记录

`export-panel.tsx` 现在将创建请求和后台任务失败分开收拢：

- 创建失败使用 `ApiRequestError` 的状态／错误代码映射；连接失败、5xx 和未知异常
  不再显示底层 `Error.message`，改为说明任务创建结果尚未确认，并要求先到任务
  中心核对后再决定是否重试。
- 已知导出代码继续复用 `batchExportError`，覆盖 Context、附件、来源、账户、
  完整性、容量和存储等用户可行动状态。
- 后台任务失败统一交给 `batchExportError`；未识别的 `error_message` 现在只显示
  安全的导出失败兜底，不再直接渲染 worker 或 API 原始文本。
- 提交锁、当前导出选项、任务状态读取、失败任务重新生成、附件限制和下载行为
  均未改变；没有自动重试、重复提交或新增请求。

按用户要求，本批未启动服务、未登录、未运行浏览器／脚本／lint／类型检查／构建，
未提交、未触发 CI 或部署。源码修改不代表运行时验收，由用户自行验证。

修改后文件 SHA-256：

- `apps/web/features/exporting/export-panel.tsx`
  `B4415BBBBEA2F33CD2667DA367916BE646EB6BE21A3C95006C199943A6DFC78C`
- `apps/web/lib/batch-export-errors.ts`
  `3BC8C0171460CFD37C0B48C526159A5939E60B138FD5A78D5EF672A292033566`
