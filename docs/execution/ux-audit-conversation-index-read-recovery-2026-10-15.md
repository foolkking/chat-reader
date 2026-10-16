# 对话索引跳转与分页读取恢复审查 — 2026-10-15

## 1. 范围与证据

本批次只审查 Reader 对话索引在“跳到编号”和分页读取时的网络失败反馈与恢复
路径。平台是 Next.js Web 应用，受众按当前产品定位视为混合用户；本次只使用仓库
源码证据，没有启动服务、登录、打开产品浏览器、触发 API 故障或运行自动化验证。

已查看：

- `apps/web/features/toc/conversation-index.tsx`
- `apps/web/lib/api.ts` 与 `apps/web/lib/types.ts` 中对话索引分页读取合同
- `apps/web/lib/i18n.ts` 中索引失败、重试、前后页和跳转文案

未查看或未验证：

- 真实浏览器中的分页/跳转失败视觉表现、焦点和屏幕阅读器结果
- FastAPI 索引接口的实际错误响应、超时和生产网络配置
- Reader 导航目标定位、服务、worker、数据库、Share、离线包及部署

## 2. 发现

### ERR-CONVERSATION-INDEX-READ-RECOVERY-01 · 索引跳转和分页失败后没有局部反馈或重试

| | |
|---|---|
| **Dimension** | Error prevention & recovery / State coverage |
| **Severity** | Medium |
| **Confidence** | Observed (code); rendered result inferred |
| **Effort** | S |
| **Location** | `apps/web/features/toc/conversation-index.tsx:163-167, 220-225, 246-263` |

**Evidence.** Sheet 模式的编号跳转和前后页按钮都调用本地异步读取函数。读取函数
在开始时设置 `pageLoading`，在 `finally` 中恢复空闲，但没有 `catch`、错误状态或
局部重试。网络/API 读取失败时，组件会回到可操作状态而保持旧索引；用户看不到
“跳转/翻页未完成”的原因，也没有重试同一请求的入口。初始索引查询已有错误壳和
重试，但它覆盖不到交互过程中触发的后续 page load。

**Why it matters.** 长对话用户依赖编号跳转和分页快速定位内容。一次短暂网络失败
会让用户停留在旧页，却可能误以为目标编号不存在或按钮没有响应；反复点击还可能
把一次失败误判成导航/数据错误，增加无效操作和定位成本。

**Recommendation.** 只为交互式索引读取增加局部错误提示，并保留最后一次失败的
跳转编号或分页方向，提供只重试该索引读取的按钮。成功读取后清除提示；不改变
`loader` 的 offset/limit/anchor 合同、目标 `onNavigate`、已有初始查询重试、
筛选范围、真实 DOM 滚动锚点或任何 Reader/Share/离线语义。

## 3. 实施边界

- 只修改 `conversation-index.tsx` 的交互读取状态、失败提示和同请求 Retry。
- 增加源码级回归契约，覆盖跳转/分页失败后的状态与重试意图保存。
- 不修改 API、数据库、migration、worker、附件、Share URL、`.cr`、离线包、
  Dexie、消息版本或导航定位合同。
- 按当前用户边界不运行测试、lint、类型检查、build、服务、浏览器、CI 或部署。

## 4. 变更前指纹

| 文件 | SHA-256 |
|---|---|
| `apps/web/features/toc/conversation-index.tsx` | 待编辑前读取，当前工作树含此前已授权改动 |

## 5. 实施后记录

已在 `apps/web/features/toc/conversation-index.tsx` 中完成窄修：

- 交互式索引 loader 失败时保留原 `remotePage`，显示局部 `role="alert"` 和
  `Retry`，不把旧页误报为空或已完成跳转。
- Retry 保存最后一次跳转 ordinal 或 previous/next 方向，以及该次读取的
  `offset`/`limit`，只重读相同索引页，不自动导航或重放其他操作。
- 读取成功后清除局部错误；跳转成功读取与既有 `onNavigate` 仍分开，导航异常
  不会被伪装成索引 loader 错误。
- 初始 Query、筛选、分页边界、真实 DOM 滚动锚点、消息/版本、Reader、
  Share、离线和 API 合同未修改。

`scripts/ux/conversation-index-read-recovery.test.mjs` 已编写但未执行，属于源码/
结构回归，不代表 React、API、导航、焦点、滚动、浏览器或屏幕阅读器验收。按当前
边界未运行测试、lint、类型检查、build、服务、浏览器、CI、部署或资源测量。
