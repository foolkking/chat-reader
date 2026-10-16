# 管理员系统导入格式错误反馈审查 — 2026-10-14

## 1. 范围与证据

本批次审查管理员在“系统导入格式”设置中读取候选格式、发布版本或撤回系统提供失败时的反馈。证据来自当前工作树源码和已挂载路径；没有启动服务、登录、浏览器或自动化测试，因此没有把运行时视觉效果写成已观察事实。

### 已查看

- `apps/web/components/admin-import-format-settings.tsx:1-54`
- `apps/web/components/settings-focused-dialog.tsx` 中 `admin-formats` 的实际挂载
- `apps/web/lib/admin-client.ts` 中 `AdminRequestError`、系统导入格式 API 和状态保留
- `apps/web/components/admin-noise-rule-settings.tsx`
- `apps/web/components/admin-noise-publication-row.tsx` 中已有的稳定错误与未确认结果模式

## 2. 发现

### ERR-03 · 管理员格式设置把管理 API 原文直接展示给用户

| | |
|---|---|
| **维度** | 错误恢复与系统反馈（D6/D5） |
| **严重度** | Medium |
| **置信度** | Observed（源码） |
| **工作量** | S |
| **位置** | `apps/web/components/admin-import-format-settings.tsx:18,52` |

**证据。** 候选格式读取失败直接渲染 `query.error.message`；发布或撤回失败直接渲染 `mutation.error.message`。`admin-client.ts` 会把响应体 `detail` 原文或状态码构造为 `AdminRequestError`，网络异常还可能产生浏览器底层错误。因此权限、记录不存在、并发变化、参数拒绝、网关文本和连接错误会以不稳定的语言或内部细节进入设置界面。

**对照。** 同一设置区的系统噪声规则已经按 401/403/404、409、422 和未知结果提供稳定恢复方向，并在结果未确认时要求先核对当前状态；系统导入格式目前没有这层边界。

## 3. 实施边界

- 只修改系统导入格式设置的读取和发布/撤回错误文案选择。
- 401/403、404、409、400/422、429、其他确定性 4xx，以及 408/5xx/网络与未知错误使用稳定的中英文管理员恢复提示。
- 保留现有重试按钮、发布确认、草稿、分页、成功刷新和请求语义；不自动重复发布或撤回。
- 不修改 API、数据库、权限、格式校验或其他管理员设置。
- 用户已要求后续自行验证，因此不启动服务，不运行测试、lint、typecheck、build，不提交 CI 或部署。

## 4. 变更前指纹

| 文件 | SHA-256 |
|---|---|
| `apps/web/components/admin-import-format-settings.tsx` | `ABBEF175ABE3D60C49AB29845ADADA295E476246B4659D0A08A28599CA7B7344` |

## 5. 已实施的本地修复

- 新增 `adminImportFormatError`，按读取或发布/撤回操作区分稳定的中英文提示。
- 401/403、404、409、400/422、429 和其他确定性 4xx 分别给出权限、记录不可用、并发变化、输入拒绝或频率限制的恢复方向；408/5xx/网络与未知写入结果使用未确认提示，不再渲染 `AdminRequestError.message` 或浏览器底层异常。
- 对需要核对当前发布状态的写入失败，明确通过“关闭后重新打开设置”读取当前状态，不指向界面里不存在的重载控件。草稿仍在当前面板保留，但关闭设置会遵循现有的未保存更改确认。
- 保留原有读取重试、确认对话框、名称与版本草稿、分页、成功后的缓存失效和发布/撤回请求；没有自动重放未知写入。

## 6. 变更后指纹与验证边界

| 文件 | SHA-256 |
|---|---|
| `apps/web/components/admin-import-format-settings.tsx` | `8B35FE17876FE68977B51D9617DC12B6E307E34B219D659D63F6E6D505D4A286` |

本批次没有启动本地服务、登录、浏览器或自动化验证；没有运行 lint、typecheck、build，也没有提交、触发 CI 或部署。用户将自行验证。
