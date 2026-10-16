# 离线导出附件数量读取恢复审查 — 2026-10-15

## 1. 范围与证据

本批次只审查已存在的离线对话导出面板，目标是普通用户在选择“包含已缓存附件”
时看到的本地附件数量和读取失败状态。平台是 Next.js Web 应用，受众按当前产品
定位视为混合用户；本次只使用仓库源码证据，没有启动服务、登录、打开产品浏览器、
触发 IndexedDB 故障或运行自动化验证。

已查看：

- `apps/web/features/exporting/offline-export-panel.tsx`
- `apps/web/lib/offline-export.ts` 的离线导出边界与已有错误分类
- 离线 Reader 中 `OfflineExportPanel` 的两个挂载入口

未查看或未验证：

- 真实浏览器中的 Dexie/IndexedDB 读取失败表现
- 导出文件实际内容、浏览器布局、屏幕阅读器和移动端渲染
- 服务端、数据库、worker、离线包格式和生产环境

## 2. 发现

### ERR-OFFLINE-EXPORT-ATTACHMENT-COUNT-01 · 本地附件数量读取失败被显示为“0 个附件记录”

| | |
|---|---|
| **Dimension** | Error prevention & recovery / State coverage |
| **Severity** | Medium |
| **Confidence** | Observed (code); rendered result inferred |
| **Effort** | S |
| **Location** | `apps/web/features/exporting/offline-export-panel.tsx:31-36, 83-90` |

**Evidence.** 面板通过 `useQuery` 从本地 `offlineDb.attachments` 读取当前对话的
附件数量，但 JSX 直接使用 `attachmentCountQuery.data ?? 0`。因此初始读取尚未完成、
读取失败和成功读取到零条记录，都会显示同一条“0 个附件记录”或其英文版本；当前
分支没有读取错误提示，也没有只重开这次数量读取的按钮。导出按钮没有被这个查询
阻塞，说明这是附件选项范围的反馈问题，而不是导出写入本身的失败证据。

**Why it matters.** 用户勾选“包含已缓存附件”时，`0 个附件记录` 会让他误以为
当前离线副本没有可包含的附件，可能取消一个本来应保留附件的导出；反过来，读取
失败也被伪装成正常空状态，用户没有办法判断是确实没有缓存还是本地读取暂时失败。

**Recommendation.** 将附件数量拆成读取中、读取成功为零/非零、读取失败三种状态。
读取失败时保留导出按钮，明确说明数量暂时不可确认，并提供只重试附件数量读取的
按钮；重试不取消、不重放导出，也不改变“包含已缓存附件”的勾选值。只有成功读取
后才显示具体数量。

## 3. 实施边界

- 只修改离线导出面板的附件数量反馈与局部 `refetch`。
- 不阻塞或自动重放离线导出，不改变导出选项、附件缓存策略、文件格式、离线包
  v1/v2/v3 兼容或 Blob URL 生命周期。
- 增加源码级回归契约；按当前用户边界不运行测试、lint、类型检查、build、服务、
  浏览器、CI 或部署。

## 4. 变更前指纹

| 文件 | SHA-256 |
|---|---|
| `apps/web/features/exporting/offline-export-panel.tsx` | 待编辑前读取，当前工作树含此前已授权改动 |

## 5. 实施后记录

已完成最小源码修复：

- 附件数量按读取中、读取成功和读取失败分别反馈；只有读取成功时才显示具体数量。
- 读取失败保留导出按钮，显示稳定的中英文提示，并提供只重开本地数量查询的
  `refetch`；重试期间只禁用该 Retry 控件。
- `generate` 仍直接使用既有 `exportOfflineConversation`，不等待、不依赖、不重放
  附件数量查询，也不改变附件勾选值或导出内容合同。

新增 `scripts/ux/offline-export-attachment-count-read.test.mjs` 作为源码/结构回归
契约，当前未执行。没有启动服务、调用 Dexie、运行测试、lint、类型检查、build、
浏览器、CI 或部署，因此不宣称 React、IndexedDB、布局、屏幕阅读器或资源验收。
