# UX quick review — Table tool 输入与按键所有权

2026-10-20；修复前证据记录，先交付审查再修改产品。范围是现有 Web 源码工作区
内的表格单元格、Markdown 字段与其共享弹层键盘入口；读者是使用中英文整理原文
的混合用户。保留草稿比快捷关闭更重要。

## 范围与证据

- 已读实际 `markdown-table-dialog.tsx`、`use-dialog-focus.ts` 和外围工作区。
- 在本地 Chrome 1440×900、合成对话中挂载真实 workspace、CodeMirror、React
  及表格工具；API、Next loader、无关组件仍是明确测试适配器。
- 向实际输入节点派发 `isComposing: true` 的 Escape，观察真实 React/DOM
  冒泡结果；**不是 Windows 输入法候选窗口、真实软键盘或跨浏览器 IME 验收**。
- Share 导航实际 hook 的受控 DOM 测试补充合成状态、旧式 229、已处理事件；
  不把该适配器测试当作 Share 浏览器验收。
- 未审查认证保存、完整 Reader/Offline/Share、服务器内存或生产环境。
  不作可访问性或输入法兼容性完整认证。

## 最重要的结论

已复现一个会丢掉未应用表格草稿的按键所有权缺陷。原有 57 个浏览器场景全部通过，
但新增的合成中 Escape 场景失败，说明原 Enter 检查没有覆盖取消候选的路径。
单元格已经识别合成键，丢失发生在其后的共享弹层监听器，不能靠更多单元格提示修复。
同时，受控 hook 的三条新测试确认它也会接管 229 和已处理按键。
源文没有被保存或删除，但用户刚做的表格修改会随着弹层关闭消失。
应在共享键盘入口尊重输入法和子控件所有权，而不是再加一个弹窗或等待定时器。

## Finding

| ID | 维度 | 严重度 | 置信度 | 估算 |
| --- | --- | --- | --- | --- |
| FORM-01 | 输入、错误预防、焦点 | High | Observed（代码 + Chrome DOM 合成事件；229/已处理标志为受控 hook） | S |

### FORM-01 — 输入法取消键被当成关闭表格

**位置：** 修复前 `apps/web/components/use-dialog-focus.ts:64–79`；
`apps/web/features/editing/markdown-table-dialog.tsx:372–375` 已有局部合成键判断。

**证据：** 单元格输入合成草稿后，派发合成中的 Escape。实际表格弹层及单元格
输入节点数量均从 1 变成 0，保存请求为 0；截图只剩底层原始源码工作区。
[浏览器结果](ux-audit-table-input-2026-10-20-evidence/baseline-browser-result.json)记录
57 场景通过后失败；[状态观测](ux-audit-table-input-2026-10-20-evidence/baseline-composition-observations.json)
与[截图](ux-audit-table-input-2026-10-20-evidence/baseline-composing-escape.png)保存在报告旁。
[受控 hook 输出](ux-audit-table-input-2026-10-20-evidence/focus.txt)是 17 通过、3 失败；
[退出码](ux-audit-table-input-2026-10-20-evidence/baseline-receipts.json)两项均为 1，
外层刻意接纳预期失败不代表测试通过。

**影响：** 用户原本只是在处理输入法候选，却会失去本次所有未应用表格修改；
重新打开只能看到修改前的源码。不能将其描述成数据库损坏或已保存原文丢失。

**建议：** 共享弹层在处理 Escape/Tab 之前，忽略 `isComposing`、旧式
`keyCode === 229` 和 `defaultPrevented` 事件；不取消浏览器的输入法默认行为。
保留普通 Escape 的单元格退出、弹层关闭、嵌套所有权、Tab 边界及焦点恢复。
这是已有单元格处理方式的向外补齐，不增加依赖或新状态机。

## 顺序与保持不变的部分

1. 先修共享键盘入口并保留失败证据，再覆盖单元格与 Markdown 字段。
2. 检查现代/229/已处理标志、普通 Escape/Tab、嵌套弹层和 Apply/Undo。
3. 对实际浏览器的合成会话增加观测；不能用脚本派发事件替代真机候选框验收。

双向 Markdown 编辑、真实渲染预览、四边 `+`、范围授权及显式应用仍是正确的
设计，未因本问题改为自动保存、输入延迟或额外模式。纸面/石墨/海绿色等批准的
样式令牌与布局不在本次修改范围内。

## 未验证问题

- 真实 Windows/移动端输入法的候选取消、候选确认和不同浏览器事件时序是否相同？
  需要真实设备输入法验证；本报告不把该推断提升为已观察结果。
- 多行/TSV 粘贴尚未在本次审查中定性，不作为已发现缺陷。

本报告只含一个已复现缺陷，不用推测凑数。持续目标保持活动；不推送、不启动 CI、
不部署。

## 修复与续验（保留上文修复前记录）

共享 `useDialogFocus` 在处理弹层命令前忽略 `defaultPrevented`、`isComposing`
和旧式 229；不取消输入法默认行为，不新增状态、依赖或保存路径。
受控 hook 的 20 项检查通过，正常 Escape/Tab、嵌套所有权和逻辑焦点恢复仍受测。
工作区浏览器脚本保留原失败用例，并加入 Chrome CDP 合成会话：单元格与下方
Markdown 都实际产生 `isTrusted=true, isComposing=true` 的 Escape，弹层保持打开、
输入保留焦点、未保存原文；结束合成后普通 Escape 仍按原层级退出。

修复前的[原生事件观测](ux-audit-table-input-2026-10-20-evidence/native-pre-fix.json)
显示弹层数为 0，bundle 摘要已与前一恢复动作检查点独立核对；修复后的
[两字段观测](ux-audit-table-input-2026-10-20-evidence/native-post-fix.json)
均为 1。[单元格](ux-audit-table-input-2026-10-20-evidence/native-post-fix-cell.png)
和 [Markdown](ux-audit-table-input-2026-10-20-evidence/native-post-fix-markdown.png)
截图保存在报告旁。CDP 是浏览器真实合成状态，但没有物理候选窗口，不能替代
Windows/移动真机或 Safari/Firefox 输入法验收。

最终六项本地门禁：103 专项（含 20 shared-focus）、69 文件/1,494 无服务检查、
59 Chrome 场景、全量 lint、非增量 typecheck、单 worker build，均通过。
[回执](ux-audit-table-input-2026-10-20-evidence/verified-gate-receipts.json)及日志相邻保存；
20 个源码/测试摘要在运行前后不变。完整摘要、测试构造错误和限制见
[本次证据](../evidence/table-tool-input-composition-2026-10-20.json)。
两个临时探针的错误选择器/资源目录已纠正，未计作产品失败或通过。
这不接受完整 Share/Offline/Reader、服务器资源、生产或辅助技术行为。
