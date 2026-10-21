# UX quick review — 表格源码解析中的应用保护

2026-10-21，本地源码审查；先交付发现，再进行定向浏览器复现和修复。

## 范围与证据

范围为现有源码表格工具：编辑 Markdown、等待解析、应用到编辑器草稿。
这是面向整理 Markdown 的混合熟练度用户的 Web 工具，不是新增界面设计。
错误应用可通过编辑器撤销，但可能让用户误以为刚输入的内容已被采纳。
当前发现的置信度仅来自源码；实际挂载交互将在下文追加，不预先声称复现。
[源码摘录](ux-audit-table-pending-parse-2026-10-21-evidence/baseline-source.txt)
与[原始摘要](ux-audit-table-pending-parse-2026-10-21-evidence/baseline.json)相邻保存。
不涉及生产、认证 API、服务器资源、完整 Reader/Share/Offline 或辅助技术验收。

## 最重要的结论

源码输入已经使用延迟解析，但“应用”仍只比较旧 draft 与旧渲染结果。
解析尚未完成时，两者可能仍相等，不能证明它们对应当前 Markdown。
既有边缘操作已经检查 `previewPending`，应用动作应沿用同一安全边界。
这不需要新增弹窗、按钮、服务器接口或框架。

## 发现

| ID | 维度 | 严重度 | 置信度 | 估算 |
| --- | --- | --- | --- | --- |
| ERR-04 | 错误预防、输入与状态反馈 | High | Observed（code）；可点击旧应用的交互暂为 Inferred | S |

**位置：** `apps/web/features/editing/markdown-table-dialog.tsx:151–196` 的
延迟解析、`previewPending` 和 `ready`；同文件 `applyDraft` 使用 `ready`。

**证据：** Markdown 变化先设置 `sourceMarkdownNeedsParse=true`，新 draft 等到
延迟解析后才提交。此间 `previewPending=true`，但 `ready` 不检查它，只要求
`renderedPreviewMarkdown === previewMarkdown` 且旧结构验证通过。现有
`canAddRow`、`canAddColumn` 则已明确禁止 pending 操作。

**影响：** 用户快速输入后点击“应用”，可能将最近的旧表格而非刚输入的内容写回
编辑器并关闭工具。此处没有证据表明数据库已被自动保存，也不属于不可撤销删除。

**建议：** 当前源码还在解析、或富预览尚未追赶时禁止应用；动作本身也走相同
条件。增加可控的“解析暂停”浏览器回归，检查可见待更新状态、原文不变、连续
输入的最新版本最终被应用，并覆盖无效输入的恢复。

## 快速改进与顺序

1. 先在实际组件的测试构建中暂停解析入口，验证旧预览是否可应用。
2. 只修复已确认的条件缺口，保留输入、预览、边缘添加和单次撤销语义。
3. 重跑本地受影响门禁，保存修复前失败与修复后结果，不覆盖旧证据。

## 保留项与未覆盖

保留单一工具模式、现有视觉令牌、四边 `+`、分页和显式应用，不增加长说明。
已有长任务 profile 不能证明唯一瓶颈；延迟解析也不等于 Web Worker 或可中断解析。
前一轮性能改动的补充证据需单独归档，不能把其旧门禁当作本次新修复的通过。
目标继续活动；不推送、不启动 CI、不部署。

## 复现、修复与本轮验证

修复前实际 Chrome 运行在 18 个场景通过后，新增的解析等待场景失败：
界面显示 `Updating table preview…`、旧表头仍为 `A`，但 Apply 为 enabled。
见[失败结果](ux-audit-table-pending-parse-2026-10-21-evidence/baseline-browser-result.json)
与[断言输出](ux-audit-table-pending-parse-2026-10-21-evidence/baseline-browser.txt)。
ERR-04 的交互置信度据此提升为 **Observed（code + mounted Chrome）**；
没有继续点击旧应用并保存消息，不声称复现了数据库内容丢失。

`ready` 现明确要求 `!previewPending`，应用动作复用该条件。当前源码尚未解析时，
旧单格输入也不能回写；无效模型恢复不使用依赖规范物理行的增量替换。
测试构建仅在真实 `inspectMarkdownTableDraft` 函数入口注入可控 Promise 暂停；
不替换解析结果、不修改生产代码、不靠机器恰好慢来制造等待。
原有富渲染暂停仍独立验证，因此两种等待不会相互冒充。

新增两个 Chrome 场景验证：

1. 解析暂停时，当前 Markdown 保留、旧表格不可编辑、四边操作与 Apply 禁用。
   连续改为三列后释放解析，只应用最新三列表格，范围外正文保持不变。
2. 暂停期间改成无效文本，旧解析不能恢复过时模型或覆盖输入；修正后重新可用。

首轮修复后 64 场景通过；最终串行重跑六项门禁仍全部通过：

| 门禁 | 实际结果 |
| --- | --- |
| 五个相关 Node 文件 | 111 通过、0 失败、0 跳过 |
| 全部 69 个 service-free UX 文件 | 1,502 通过、0 失败、0 跳过 |
| Chrome 155.0.8059.82 组件/真实工作区 | 64 场景通过，page/console errors 为零 |
| Web lint | exit 0 |
| 非增量 TypeScript | exit 0 |
| 非 standalone、单 worker Web build | exit 0 |

[回执](ux-audit-table-pending-parse-2026-10-21-evidence/final-gate-receipts.json)、
[最终结果](ux-audit-table-pending-parse-2026-10-21-evidence/result.json)和
[证据清单](../evidence/table-tool-pending-parse-2026-10-21.json)绑定 20 个源码/测试
摘要；门禁前后相同，归档时再次与工作区核对。截图已人工查看：
[1440px 解析等待](ux-audit-table-pending-parse-2026-10-21-evidence/draft-parse-pending-desktop-light.png)、
[375px 富预览等待](ux-audit-table-pending-parse-2026-10-21-evidence/preview-pending-mobile-light.png)。
后者不冒充手机上独立执行了新增的解析暂停场景。

同批可选 profile 仍记录 10×4,000 表格的 52ms、51ms 主线程长任务；它挂载 120
个单元格，200×248 表格仍挂载 400 个。五次合成观察不证明真机延迟、内存稳定平台
或服务器 OOM 已解决。上一轮性能修改、试验和失败边界另见
[自适应预览记录](TABLE_TOOL_ADAPTIVE_PREVIEW_2026-10-20.md)。
本轮无新 migration，全部改动仍仅在本地，目标未标为完成。
