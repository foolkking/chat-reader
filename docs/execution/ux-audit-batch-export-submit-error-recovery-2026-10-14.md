# 批量导出提交错误恢复审查 — 2026-10-14

## 1. 范围与证据

本批次只审查普通用户在对话列表中提交批量导出后的即时反馈与重试边界。证据来自当前工作树源码；没有启动本地服务、登录、浏览器或自动化测试，因此文中关于渲染结果的判断均标为源码观察或实现推断。

### 已查看

- `apps/web/features/conversations/use-batch-export.tsx:26-64`
- `apps/web/lib/batch-export-errors.ts:1-24`
- `apps/web/lib/api.ts:95-106,1603-1667,737-742`
- `apps/api/app/api/routes/archive_exports.py:32-47`
- `apps/api/app/services/exporting/conversation_batch.py:27-60`
- `apps/web/e2e/settings-batch-export.spec.ts:88-125`（只读已有行为约定）

### 未查看

- 真实浏览器中的通知视觉效果、屏幕阅读器输出和移动端换行。
- 真实网络中断、网关非 JSON 响应或不同 HTTP 状态下的运行时截图。
- 生产服务日志、任务中心实际查询结果和用户数据。

## 2. 发现

### ERR-01 · 批量导出确定性 4xx 被误报为“未确认”

| | |
|---|---|
| **维度** | 错误恢复与系统反馈（D6/D5） |
| **严重度** | Medium |
| **置信度** | Observed（源码） |
| **工作量** | S |
| **位置** | `apps/web/features/conversations/use-batch-export.tsx:47-50,58-61` |

**证据。** `queueConversationBatchExport` 失败后，hook 将 `error.message` 或 `"CONNECTION_FAILED"` 保存到 `notice.error`。渲染层只对 `BATCH_EXPORT_` 前缀做业务码翻译，其余文本统一走未确认提交文案；因此服务端明确拒绝的 4xx（例如请求选择无效的 422、幂等请求冲突的 409）会被提示为“未确认提交，可安全重试”，而不是告诉用户应刷新、重新选择或先处理冲突。当前实现没有把所有原文直接渲染出来，但 notice 状态仍依赖底层异常字符串，分类边界不稳定。API 错误构造还可能返回响应正文中的 `detail`、`error.message` 或路径和状态组合，后续修改容易把内部文本重新带入用户界面。

**为什么重要。** 批量导出是可重试的后台任务提交，但“已拒绝”和“结果未知”需要不同动作。把确定性 4xx 说成未知结果，会让用户无效重试或误以为任务可能已经进入后台；相反，网络、超时和 5xx 才需要保留幂等安全重试提示。

**修复建议。** 在 API 错误离开 hook 前转换成有限的内部分类：已知 `BATCH_EXPORT_*` 业务码沿用现有文案；明确的账户、资源、冲突和其他 4xx 映射为稳定恢复指引；网络、超时、5xx 和未知异常统一为未确认提交。保留现有幂等键和所选集合，不自动重放、不改变任务中心语义。

## 3. 本批次实施边界

- 只改批量导出错误分类 helper 和 `useBatchExport` 的 notice 状态值。
- 不改请求参数、20 秒超时、幂等键生成/复用、任务查询、选择保留和打开任务中心的行为。
- 不改后台导出大小限制、数据库、迁移、worker 或部署配置。
- 用户已要求本轮自行验证，因此不启动服务，不运行测试、lint、typecheck、build，不提交 CI 或部署。

## 4. 变更前指纹

| 文件 | SHA-256 |
|---|---|
| `apps/web/features/conversations/use-batch-export.tsx` | `4BF4A84883487E07808984494C4AEF7AAB9D3F056320FA7F46FDC36BBE92816E` |
| `apps/web/lib/batch-export-errors.ts` | `3BC8C0171460CFD37C0B48C526159A5939E60B138FD5A78D5EF672A292033566` |

当前代码基线：`84988a260c48fcafb8b3bed6fcb7a1f16348111d`。工作树已有其他用户变更，本批次不清理、不覆盖。

## 5. 已实施的本地修复

- `batchExportFailureCode` 将批量导出提交异常收敛为有限内部分类：
  已知 `BATCH_EXPORT_*`、账户不可用、源对话不可用、请求冲突、其他 4xx，以及未确认结果。
- `useBatchExport` 只把内部分类写入通知，不再保存 `error.message` 或其他底层文本。
- 已确认的业务错误继续给出具体恢复方向；网络、超时、5xx 和未知异常继续保留幂等安全重试提示。
- 没有改变选择保留、幂等键复用、20 秒超时、任务中心入口或后台任务语义。

### 实施后指纹

| 文件 | SHA-256 |
|---|---|
| `apps/web/features/conversations/use-batch-export.tsx` | `BB0D5B118E82FC8F4F43C6F1DBA55573E6050B47159AAAD5036E7D3F5C21AC4D` |
| `apps/web/lib/batch-export-errors.ts` | `A35EDA60AB00E85B4E20EED6E0C089B7DC43E4291871E238CA6B7BC870AE23DB` |

本批次按用户要求未启动服务、未登录、未做浏览器或自动化验证，未提交、未触发 CI、未部署；由用户后续自行验证。
