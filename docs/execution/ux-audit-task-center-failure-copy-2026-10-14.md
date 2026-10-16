# 任务中心失败文案审查 — 2026-10-14

## 1. 范围与证据

本批次审查普通用户打开全局任务中心后看到失败任务的错误反馈。证据来自当前工作树源码和已有浏览器用例文本；没有启动服务、登录、浏览器或自动化测试，因此没有把运行时视觉效果或真实 worker 文本写成已观察事实。

### 已查看

- `apps/web/features/import/import-task-monitor.tsx:373-445,453-575`
- `apps/web/lib/batch-export-errors.ts:1-24`
- `apps/web/components/archive-ui.tsx:1-27`
- `apps/web/lib/offline-download-errors.ts`
- `apps/web/e2e/task-center-dismissal.spec.ts:176-205`（只读现有失败任务约定）
- `apps/web/e2e/task-center-refresh-contract.spec.ts:1-25`（只读任务中心状态约定）

### 未查看

- 真实任务中心在不同窗口尺寸、语言和屏幕阅读器下的渲染。
- 生产 worker 的全部失败文本及各类任务的实际失败比例。
- 真实失败任务是否在失败前已经产生部分副作用。

## 2. 发现

### ERR-02 · 未分类后台失败把 worker/API 文本直接带入任务中心

| | |
|---|---|
| **维度** | 错误恢复与系统反馈（D6/D5） |
| **严重度** | Medium |
| **置信度** | Observed（源码） |
| **工作量** | S |
| **位置** | `apps/web/features/import/import-task-monitor.tsx:421-423` |

**证据。** 任务中心已对离线包、批量/附件/上下文导出、归档任务、账户删除和停用的 Context 校验提供专门反馈，但其他失败分支最终渲染 `task.error_message`。因此普通对话导出、合并、批量删除、内容扫描、导入和其他后台任务的 worker/API 文本会直接成为用户提示。已有浏览器用例还把合成 worker 文本作为通知内容断言，说明这条原文输出是当前实现契约的一部分。

**为什么重要。** 任务中心是跨页面的全局反馈面。内部异常、路径、状态拼接或未经本地化的 worker 文本会在用户离开原操作后持续出现；不同任务的提示语言和恢复动作也不一致。用户需要知道任务类型、当前结果是否可确认以及下一步应检查、重试、刷新还是保留原资料。

**修复建议。** 将失败文本统一收敛到按任务类型和少量稳定关键词分类的中英文文案：已存在的具体导出、归档和离线映射保持不变；对话导出、合并、批量删除、扫描、导入、接续和未分类任务使用稳定的结果边界与下一步提示。不要展示原始 `error_message`，不要自动重试，不改变现有 Retry、Cancel、任务详情和结果链接。

## 3. 本批次实施边界

- 只改任务中心失败文案选择逻辑。
- 保留现有导出、归档、离线、账户删除和停用流程的专门分支。
- 不修改任务轮询、任务排序、重试/取消请求、结果链接、数据库、worker 或任务 API。
- 当前 `import-task-monitor.tsx` 已有用户工作树改动，本批次只在失败文案附近做最小 additive 修改，不覆盖其他差异。
- 用户已要求后续自行验证，因此不启动服务，不运行测试、lint、typecheck、build，不提交 CI 或部署。

## 4. 变更前指纹

| 文件 | SHA-256 |
|---|---|
| `apps/web/features/import/import-task-monitor.tsx` | `FC5F1FA6F4EF2B9EB195278205A8AF70DC8D024832A1267F48A28B18CB105927` |

## 5. 已实施的本地修复

- 任务中心失败区域现在通过 `taskFailureMessage` 按任务类型和有限的稳定关键词选择中英文恢复文案，不再把未分类的 `task.error_message` 直接渲染给普通用户。
- 保留离线包、批量/附件/上下文导出、归档、账户删除与停用流程已有的专门反馈；对话导出、合并、批量删除、内容扫描、导入、接续和未知后台任务分别给出检查、刷新、核对或重试方向。
- 暂时性服务/连接错误优先排除资源不可用分类，避免把 `service unavailable` 等文本解释为对话或附件已经移除。
- 保留失败任务的 Retry、Cancel、结果链接、归档处理入口及任务排序、轮询和状态语义；没有自动重试，也没有修改 worker、API、数据库或任务状态模型。
- 同步更新任务中心浏览器用例：验证稳定的导出恢复文案，并明确原始合成 worker 文本不应出现在用户反馈中。该用例未在本批次执行。

## 6. 变更后指纹与验证边界

| 文件 | SHA-256 |
|---|---|
| `apps/web/features/import/import-task-monitor.tsx` | `58681EC334542691B875B8111C172B186459F12FA0C5F995C01C7DED0A57BF24` |
| `apps/web/e2e/task-center-dismissal.spec.ts` | `4FBD897B901F9C844B14101E71A180EE568B0B9368AEF10EDE5BF1CA6289A8C6` |

本批次没有启动本地服务、登录、浏览器或自动化验证；没有运行 lint、typecheck、build，也没有提交、触发 CI 或部署。用户将自行验证。此前工作树中 `import-task-monitor.tsx` 已存在其他用户改动，本次只在失败文案选择处做 additive 修改并保留其余差异。
