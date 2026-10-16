# 章节目录陈旧读取恢复审查 — 2026-10-15

## 1. 范围与证据

本批次只审查 Reader/Share 章节目录查询在已有旧条目可显示时的刷新失败反馈与
恢复路径。平台是 Next.js Web 应用，受众按当前产品定位视为混合用户；本次只使用
仓库源码证据，没有启动服务、登录、打开产品浏览器、触发 API 故障或运行自动化验证。

已查看：

- `apps/web/features/toc/conversation-toc.tsx`
- `apps/web/lib/api.ts` 与 `apps/web/lib/types.ts` 中章节目录读取边界
- `apps/web/components/preferences-provider.tsx` 中当前界面语言读取

未查看或未验证：

- 真实浏览器中的章节目录刷新失败视觉、焦点和屏幕阅读器结果
- FastAPI 目录接口的实际错误响应、超时和生产网络配置
- Markdown heading 重建、Reader/Share 导航、服务、worker、数据库、离线包和部署

## 2. 发现

### ERR-CONVERSATION-TOC-STALE-READ-RECOVERY-01 · 旧章节目录在刷新失败时静默显示

| | |
|---|---|
| **Dimension** | Error prevention & recovery / State coverage |
| **Severity** | Medium |
| **Confidence** | Observed (code); rendered result inferred |
| **Effort** | S |
| **Location** | `apps/web/features/toc/conversation-toc.tsx:30, 39-47, 67-73` |

**Evidence.** 章节目录查询使用 `placeholderData` 保留上一份结果，并在查询数据不可
用时回退到本地 `cachedItems` 或 `activeItems`。但错误壳只在
`tocQuery.isError && visibleItems.length === 0` 时渲染；当刷新失败而旧条目仍可见
时，组件直接返回目录列表，没有 stale/未刷新提示，也没有只重试该目录查询的入口。

**Why it matters.** 用户可能把旧标题、已删除标题或尚未重建的章节位置当成当前
目录真值，尤其是在消息编辑或后台目录更新后。网络短暂失败时，他们不知道应继续
使用旧目录、等待，还是重新读取；反复点击标题还可能把目录陈旧误判为 Reader 定位
失败。

**Recommendation.** 旧条目继续可用，但在同一章节目录面板内显示紧凑的刷新失败
提示和局部 Retry；Retry 只调用现有 `tocQuery.refetch()`，成功后由查询状态自然
清除提示。初始空目录的既有错误壳保留；不改变 fallback 优先级、查询 key、导航
回调、heading/block DOM id、Reader/Share/Offline 数据合同。

## 3. 实施边界

- 只修改 `conversation-toc.tsx` 的陈旧读取提示与本地 Query Retry。
- 增加源码级回归契约，覆盖“有旧条目仍显示”与 Retry 只重读目录。
- 不修改 API、数据库、migration、worker、消息内容、heading 解析、Share URL、
  `.cr`、离线包、Dexie、阅读位置或真实 DOM 定位合同。
- 按当前用户边界不运行测试、lint、类型检查、build、服务、浏览器、CI 或部署。

## 4. 变更前指纹

| 文件 | SHA-256 |
|---|---|
| `apps/web/features/toc/conversation-toc.tsx` | 待编辑前读取，当前工作树含此前已授权改动 |

## 5. 实施后记录

已在 `apps/web/features/toc/conversation-toc.tsx` 中完成窄修：

- 当旧章节条目仍可显示但目录 Query 刷新失败时，保留旧条目并显示局部
  `role="alert"`，明确说明当前是上次内容。
- 提供只调用现有 `tocQuery.refetch()` 的 Retry；读取进行中禁用该按钮，成功后
  由 Query 错误状态自然清除提示。
- 初始读取失败且无可见条目的既有错误壳、fallback 顺序、heading/block DOM id、
  导航回调、Reader/Share/离线和 API 合同未修改。

`scripts/ux/conversation-toc-stale-read-recovery.test.mjs` 已编写但未执行，属于源码/
结构回归，不代表 React、API、导航、焦点、滚动、浏览器或屏幕阅读器验收。按当前
边界未运行测试、lint、类型检查、build、服务、浏览器、CI、部署或资源测量。
