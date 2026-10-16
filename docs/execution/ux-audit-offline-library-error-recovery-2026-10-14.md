# UX audit — Offline library error recovery — 2026-10-14

这是持续普通用户体验优化中的下一批本地源码修复。本批只检查离线资料库的在线
目录读取、离线启动准备重试和错误反馈；不改 Dexie 数据、离线包兼容、Service
Worker 协议、下载任务、搜索索引或 Reader 行为。不启动服务、不登录、不做浏览器或
自动化验证、不提交 CI 或部署，用户将自行验证。本记录先于源码修改建立。

## 范围与修改前证据

范围是 `apps/web/features/offline/library-shell.tsx` 的目录查询错误、离线启动
重试错误、离线下载启动错误和 `OfflineShellStatus.message` 展示。

修改前文件 SHA-256：

`DC8F442BA48DE22A624A1A1E53AE82BD0B1CF91EFA3077C9C806C6C44A946AE8`

源码审查确认：

- `catalogQuery.error.message` 直接作为资料库侧栏错误展示；API、代理或 IndexedDB
  相关底层文本可能因此暴露给普通用户。
- `prepareOfflineShell({ force: true })` 失败时，重试回调直接把 `reason.message`
  写入错误状态。
- `OfflineShellIndicator` 在启动不可用／不支持状态直接显示 `status.message`；
  `offline-shell.ts` 的多个状态消息来自 `Error.message`，存在同样的底层文本暴露。
- 目录错误没有独立的显式“重试目录”入口；在线目录失败时，已下载的本地资料仍
  可用，但用户不能在侧栏内直接恢复在线目录读取。
- 离线下载启动失败的兜底函数仍将普通 `Error.message` 直接放入错误状态；API
  状态和本地离线包错误应使用已有稳定分类文案。

## Findings

| ID | 类型／严重度／置信度 | 用户影响与处理 |
|---|---|---|
| OFFLINE-LIB-ERR-01 | Defect / Medium / Observed (code)，渲染未验收 | 底层异常进入离线资料库侧栏，且无法给出稳定恢复方向。按状态提供中英文文案。 |
| OFFLINE-LIB-RECOVERY-02 | Defect / Medium / Observed (code) | 目录读取失败没有明确重试入口；本地资料仍可读但在线更新能力被静默卡住。增加只读目录重试。 |
| OFFLINE-SHELL-ERR-03 | Defect / Medium / Observed (code) | Service Worker／资源准备错误文本可能直接展示。使用稳定状态文案，保留现有重试按钮。 |
| OFFLINE-DOWNLOAD-ERR-04 | Defect / Medium / Observed (code) | 离线下载启动的未知异常直接展示底层文本。沿用离线下载错误分类和 API 状态文案。 |

## 实现边界

- 目录重试只调用现有 `catalogQuery.refetch()`，不触发下载、不清除本地资料、不改
  当前选择。
- 离线启动重试继续使用现有 `prepareOfflineShell({ force: true })`；不增加轮询、
  新资源请求或 Service Worker 协议。
- 本地资料、搜索失败状态、下载失败重试、资源检查和 Reader 入口保持不变。

## Evidence log

- **SEEN (source):** 目录和重试回调直接使用 `Error.message`；启动指示器直接使用
  `status.message`；目录查询有 React Query 重试但没有手动重试按钮。
- **NOT SEEN:** 离线资料库真实渲染、浏览器 Cache／Service Worker 故障时序、登录
  会话、设备存储与资源开销。

## Planned local repair

添加目录读取的稳定状态感知文案和手动重试入口；离线启动、离线下载和 Service
Worker 指示器不再显示原始异常文本，只显示稳定恢复指引。仅源码和文档记录属于
本批，运行时验收留给用户。

## 实施记录

`library-shell.tsx` 现在：

- 将在线目录错误映射为稳定的中英文提示，并提供只读的“重试目录”按钮；重试期间
  按钮禁用，已下载资料、当前选择和本地列表不受影响。
- 将离线启动强制重试异常和 Service Worker 不可用／不支持状态改为稳定文案，不再
  直接显示 `reason.message` 或 `status.message`。
- 将离线下载启动的 API 401、403、404、429 和未知异常收拢到稳定恢复提示；本地
  包错误仍沿用已有分类文案。
- 没有新增轮询、下载、清理、Service Worker 请求或数据写入；搜索、资源检查、
  下载失败重试和 Reader 行为保持不变。

按用户要求，本批未启动服务、未登录、未运行浏览器／脚本／lint／类型检查／构建，
未提交、未触发 CI 或部署。源码修改不代表运行时验收，由用户自行验证。

修改后文件 SHA-256：

`apps/web/features/offline/library-shell.tsx`
`6739FDDE90D2F757A0C6EC0819A9F8AB6AF3709F24F2C477CFDA1EA04B9CBF2C`
