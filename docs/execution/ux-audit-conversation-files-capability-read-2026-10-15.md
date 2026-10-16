# 当前对话文件能力读取恢复审查 — 2026-10-15

## 1. 范围与证据

本批次只审查在线 Reader 的“当前对话文件”面板，目标是普通用户在上传附件
前看到的附件能力状态和恢复路径。平台是 Next.js Web 应用，受众按当前产品
定位视为混合用户；本次只使用仓库源码证据，没有启动服务、登录、打开产品浏览器、
触发 API 故障或运行自动化验证。

已查看：

- `apps/web/features/attachments/conversation-files-panel.tsx`
- `apps/web/features/conversations/conversation-reader.tsx` 中在线文件面板的挂载边界
- `apps/web/lib/api.ts` 与 `apps/web/lib/types.ts` 中 `getCapabilities` 和附件能力字段

未查看或未验证：

- 真实浏览器中的能力请求失败、加载时序、上传按钮视觉表现和屏幕阅读器结果
- 服务端能力策略、上传接口的实际响应和生产配置
- 附件上传、数据库、worker、部署和权限系统

## 2. 发现

### ERR-CONVERSATION-FILES-CAPABILITY-READ-01 · 附件能力未知时上传仍显示为可用

| | |
|---|---|
| **Dimension** | Error prevention & recovery / State coverage |
| **Severity** | Medium |
| **Confidence** | Observed (code); rendered result inferred |
| **Effort** | S |
| **Location** | `apps/web/features/attachments/conversation-files-panel.tsx:105-109, 279-286` |

**Evidence.** 文件面板通过 `useQuery` 读取 `/api/capabilities`，其中
`attachments.upload_enabled` 是上传按钮的能力门控字段；但按钮当前仅在该字段
明确为 `false` 时禁用。首次读取尚未完成或查询失败时，`data` 为 `undefined`，
条件为假，因此上传按钮仍可点击；同时面板没有显示能力读取失败或提供能力查询
的局部重试。该面板由 Reader 只在 `dataSource.capabilities.attachments === "manage"`
时挂载，说明这里是普通在线文件管理路径，而不是无权限用户的隐藏组件。

**Why it matters.** 用户会把“能力尚未确认/暂时无法读取”理解为“上传可用”，
随后才在上传会话请求中得到泛化失败；在部署暂时关闭上传、网络短暂失败或能力
服务异常时，用户无法知道应等待、重试能力读取还是重新选择文件。

**Recommendation.** 只有能力读取成功且 `upload_enabled` 为真时显示可用上传；
读取中或无缓存数据的读取失败状态应临时禁用上传并显示稳定提示，提供只重试
`getCapabilities` 的按钮。若已有成功能力数据但后台刷新失败，保留已确认的上传
状态，不改变附件列表、上传请求、文件选择或服务器合同。

## 3. 实施边界

- 只修改文件面板的能力读取状态反馈、上传按钮门控和局部 `refetch`。
- 不改变附件上传 session/item/finalize 流程、附件列表查询、权限合同、文件内容、
  Share URL、离线包或 Reader 定位语义。
- 增加源码级回归契约；按当前用户边界不运行测试、lint、类型检查、build、服务、
  浏览器、CI 或部署。

## 4. 变更前指纹

| 文件 | SHA-256 |
|---|---|
| `apps/web/features/attachments/conversation-files-panel.tsx` | 待编辑前读取，当前工作树含此前已授权改动 |

## 5. 实施后记录

已在 `apps/web/features/attachments/conversation-files-panel.tsx` 中完成窄修：

- 上传按钮只有在附件能力读取成功且 `upload_enabled === true` 时保持可用。
- 首次读取进行中，或读取失败且没有旧成功数据时，上传入口保持暂停，并显示
  稳定的中英文状态提示。
- 读取失败且没有旧成功数据时，面板提供只重读 `getCapabilities` 的局部 Retry；
  Retry 不创建上传 session、不选择或重传文件，也不改变附件列表。
- 已有成功能力数据的后台刷新失败时继续使用旧的已确认能力，不把短暂刷新失败
  误转成禁用或重放上传。
- 附件列表读取、upload session/item/finalize、重命名、移除、插入、权限和存储
  合同均未修改。

`scripts/ux/conversation-files-capability-read.test.mjs` 已编写但未执行，属于源码/
结构回归，不代表 React、API、浏览器或屏幕阅读器验收。按当前边界未运行测试、
lint、类型检查、build、服务、浏览器、CI、部署或资源测量。
