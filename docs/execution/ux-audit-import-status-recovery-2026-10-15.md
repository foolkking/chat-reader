# 导入提交状态恢复审查 — 2026-10-15

## 1. 范围与证据

本批次只审查普通用户在导入分析完成后点击“导入”时，后台排队、处理、
失败或状态读取失败的界面恢复。证据来自当前工作树源码；按用户要求没有
启动本地服务、登录、浏览器或自动化验证，因此关于最终渲染的判断均标为
源码观察或实现推断。

### 已查看

- `apps/web/features/import/import-panel.tsx`
- `apps/web/features/import/adaptive-import-workspace.tsx`
- `apps/web/features/import/import-workspace-copy.ts`
- `apps/web/lib/api.ts` 中 `commitImport`、`getImportStatus`
- `apps/web/lib/types.ts` 中 `CommitImportResponse` / `ImportStatusResponse`
- `apps/api/app/api/routes/imports.py` 中导入提交与状态接口
- `apps/api/app/services/import_queue.py` 中 queued/processing/failed 生命周期
- `apps/api/app/api/routes/tasks.py` 中 failed 导入的显式 retry 合同

### 未查看

- 真实浏览器中的忙碌态、错误提示位置、焦点和移动端换行。
- 真实 worker 故障、网络中断、状态接口 4xx/5xx 和任务中心联动。

## 2. 发现

### ERR-01 · 导入终态失败后仍永久占用导入界面

| | |
|---|---|
| **维度** | 后台任务反馈与恢复（D5/D6） |
| **严重度** | High |
| **置信度** | Observed（源码） |
| **工作量** | S |
| **位置** | `apps/web/features/import/import-panel.tsx` 的 `pendingImportId`、状态查询和 `busy` 派生 |

**证据。** 提交返回 `queued` 或 `processing` 后，组件设置
`pendingImportId` 并持续轮询 `/api/imports/{id}/status`。现有 effect 只处理
`status === "committed"`；后端 worker 明确会把异常导入写成 `status="failed"`，
而状态类型也包含 `cancelled`。因此失败终态不会清除 `pendingImportId`，
`busy` 和 `importing` 一直为真，提交按钮保持禁用。自适应导入虽然可能显示
`error_message`，但仍无法回到可重试状态；归档导入在主面板中甚至没有对应
的终态错误渲染。

**为什么重要。** 用户无法知道导入已经停止，也无法利用后端已有的
`POST /api/tasks/{id}/retry`／再次提交合同。大文件或单并发 worker 故障时，
这会表现为“导入一直卡住”。

### ERR-02 · 导入状态读取失败没有恢复入口

| | |
|---|---|
| **维度** | 后台任务读取失败与结果确认（D5/D6） |
| **严重度** | High |
| **置信度** | Observed（源码） |
| **工作量** | S |
| **位置** | `apps/web/features/import/import-panel.tsx` 的 `importStatusQuery` |

**证据。** `getImportStatus` 查询失败后，查询错误没有传给
`AdaptiveImportWorkspace`，也没有在归档导入主面板显示；只有响应成功且包含
`error_message` 时才会显示文字。此时 `pendingImportId` 仍在，界面继续把导入
视为忙碌，用户没有“重新读取状态”的只读操作，也不能安全判断是否可以再次提交。

## 3. 实施边界

- 对 `failed` / `cancelled` 状态清除 pending busy 状态，保留当前导入会话和
  输入，让用户显式再次点击导入；不自动重放提交。
- 对状态 GET 失败显示稳定的现有错误分类，并提供只读“重试”读取；重试期间
  仍禁用提交，避免在结果未知时重复写入。
- 自适应导入和 `.cr` 归档导入使用同一状态恢复规则。
- 增加有限的导入终态文案，不展示 worker/API 原始异常。
- 不改 API、数据库、worker、幂等合同、导入解析、迁移、资源预算或任务中心。
- 本轮不启动服务、不登录、不运行浏览器/自动化验证，不提交 CI，不部署。

## 4. 变更前指纹

| 文件 | SHA-256 |
|---|---|
| `apps/web/features/import/import-panel.tsx` | `A5256A44B1F557F1E4AC4BD773CD43F410A65D1F1C9EC5B7FB216674EDE6FA...` |
| `apps/web/features/import/adaptive-import-workspace.tsx` | `8B5D440215CF3C6A4212190E1E8CE99AC56F974B15384D2711FB25EEE92D16...` |
| `apps/web/features/import/import-workspace-copy.ts` | `C9279EDB420E87F163244F8375695CF78D480EBFA5C264D6F475D764EAD0A0...` |

上表长哈希为本批次编辑前 PowerShell `Get-FileHash` 输出的前缀；当前工作树
包含此前已授权的导入错误文案改动，本批次不清理、不覆盖。

## 5. 实施后记录

`ImportPanel` 现在在 `committed`、`failed`、`cancelled` 三种明确终态都结束
`pendingImportId`；失败/取消保留当前输入或导入工作区，并通过既有
`POST /api/tasks/{id}/retry` 入口提供显式重试，不自动重放提交。自适应工作区
和 `.cr` 归档主面板都接收状态读取错误，状态读取失败时提供只读 Retry；Retry
期间继续保持提交忙碌态，避免未知结果下重复写入。

终态错误使用 `import-workspace-copy.ts` 的稳定中英文分类，不直接显示 worker
或 API 原始异常。成功状态仍清除 pending 并显示原有完成摘要；API、数据库、
worker、幂等、导入解析、迁移和任务中心合同未改变。

本批新增/使用的源码回归仍未执行；没有启动服务、登录、浏览器、测试、lint、
类型检查、build、CI 或部署，也没有做运行时资源测量。
