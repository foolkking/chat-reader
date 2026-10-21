# UX quick review — 表格中的 HTML 字面示例

2026-10-20；先记录修复前审查，再修改实现。范围是现有 Web 表格工具的单元格
识别及完整草稿校验，面向整理技术对话的混合用户；不新增 HTML 执行或表格模式。

## 范围与证据

- 已读实际表格转换器、弹层及共享 Markdown 预览；沿用已批准的纸面/石墨/
  海绿色令牌，不调整字体、间距、深度或四边控件。
- 本地 Chrome、1440px、合成源码工作区与真实 CodeMirror/预览/弹层；
  API、Next loader、无关 UI 是明确适配器，不是认证服务器验收。
- 实际 GFM 服务端渲染、纯转换接口与单元格校验的失败基线。
- 不检查生产、服务器资源、Reader/Share/Offline、Safari/Firefox、屏幕阅读器。
  不作完整可访问性或真实剪贴板兼容性认证。

## 最重要的结论

一张已经正确渲染的 Markdown 表格，仅因单元格包含反引号包裹的 HTML 标签，
就无法打开表格工具。界面要求“完整选中”，但问题在于整个候选片段的字符串黑名单，
并不是选区不完整。`colspan="2"` 这样的普通文字同样被误当成合并单元格。
真实 HTML 表格结构仍不能用管道表格可靠保存，这个限制应保留。
应在已有单元格解析中区分字面内容和真实标签，而不是放宽 HTML 渲染或再写解析器。

## Finding

| ID | 维度 | 严重度 | 置信度 | 估算 |
| --- | --- | --- | --- | --- |
| FORM-02 | 输入、恢复、内容保真 | Medium | Observed（真实 Chrome 工作区 + 实际 GFM/纯转换） | S |

### FORM-02 — HTML 代码示例被误当成真实表格结构

**位置：** 修复前 `apps/web/features/editing/markdown-table-tools.ts:42–44`；
完整候选正则不区分代码、转义或普通属性说明。

**证据：** 单元格为 `` `<td colspan="2">` ``。源码预览有 1 张正常表格，
工具中却为 0，原文未变、保存请求为 0；见
[观测](ux-audit-table-html-cells-2026-10-20-evidence/baseline-html-cell-observations.json)、
[截图](ux-audit-table-html-cells-2026-10-20-evidence/baseline-html-cell.png)和
[浏览器结果](ux-audit-table-html-cells-2026-10-20-evidence/baseline-browser-result.json)。
既有 59 场景通过后新场景失败。[纯转换基线](ux-audit-table-html-cells-2026-10-20-evidence/baseline-unit.txt)
为 35 通过、2 失败；另外发现单格校验允许真实 HTML 标签、完整草稿却拒绝，
两条路径的合同不一致。未将这个额外源码症状宣称为已验收的浏览器 Apply 行为。

**影响：** 用户不能在可视表格中整理技术标签示例；反复完整选择也不能恢复。
这是可用性误拒绝，不是已保存原文丢失或安全漏洞。

**建议：** 把真实 HTML 表格标签检查收进已有单元格扫描，统一整表和增量校验。
代码、明确转义、引用标识/图片替代文本和普通属性说明保持字面意义；
真实 HTML 表格/合并单元格仍拒绝。校验按当前偏移做固定形式标签匹配，
避免对每个 `<` 复制后缀或引入空白正则回溯。错误沿用现有紧邻 Markdown 的
单行提示，不增加模式、额外确认或说明面板。

## 优先顺序与保留项

1. 先保留失败基线，再统一分类；同时校验多反引号、转义和真实结构拒绝。
2. 实际工作区验证预览、单格编辑、无效恢复、Apply、单次 Undo 和原文边界。
3. 重跑专项、共享焦点、无服务 UX、Chrome、Web lint/typecheck/build。

保留当前双向编辑、输入法按键所有权、四边 `+`、显示预算和显式应用。
不执行用户 HTML，不引入渲染器、依赖、全局缓存或服务器接口。

## 尚未定性/未覆盖

单行控件的[独立输入诊断](ux-audit-table-html-cells-2026-10-20-evidence/single-line-input-diagnostic.json)
显示：Chrome CDP `Input.insertText` 把 LF/CRLF 折为一个空格，保留文字；
Tab 保留在同一个单元格，竖线正确转义。它不是实际剪贴板粘贴，也不是 TSV
网格导入验收。没有证据支持“粘贴丢字”结论，本轮不擅自增加批量粘贴模式。

物理输入法、原生剪贴板、多行单元格产品约定及跨浏览器仍需相应验证；
不把未测路径当作缺陷凑数。持续目标保持活动，不推送、不启动 CI、不部署。

## 修复与续验（保留上文修复前记录）

检查已移入现有 `parseRow`：仅在非代码、非明确转义、非字面引用/alt 数据中，
用按当前偏移匹配的固定标签表达式拒绝真实表格结构。普通属性说明不再误拒绝；
同时修正代码内反斜杠不能转义闭合反引号的判断。整表与单格现在共用结果，
保持实际 HTML 结构、合并单元格拒绝和 `skipHtml`。未增加依赖、模式、缓存、
服务端接口或 migration。错误复用原位置、字号和令牌，缩为一行校正提示。

最终六项门禁全通过：106 专项（含 20 shared-focus）、69 文件/1,497 无服务检查、
61 Chrome 场景、全量 lint、非增量 typecheck 和单 worker build；运行期间
20 个源码/测试摘要不变。截图已查看：[桌面字面代码](ux-audit-table-html-cells-2026-10-20-evidence/verified-html-cell.png)
正常渲染，[375px 中文触摸错误](ux-audit-table-html-cells-2026-10-20-evidence/verified-unsupported-mobile.png)
可读、没有页面横向溢出或遮挡操作。真实结构输入保留、阻止 Apply，
改为代码后可以应用；桌面一次 Undo 恢复完整原文。没有服务器保存请求。
一条隔离 Worker 检查保留 150,000 空白和 25,000 重复角括号的完整文字；
10 秒只是防止测试进程挂起，不是延迟/内存 SLA。

中途 104 通过/1 失败来自新 fixture 的错误假设：`[<td>][literal]` 的 HTML
位于链接正文，不是引用 ID；改为 `[caption][<td>]`，该纠正未改变产品。
[原输出](ux-audit-table-html-cells-2026-10-20-evidence/intermediate-reference-fixture-failure.txt)
独立保留，不计作新的产品缺陷。[最终回执](ux-audit-table-html-cells-2026-10-20-evidence/verified-gate-receipts.json)
和日志均在报告旁；[证据摘要](../evidence/table-tool-html-cells-2026-10-20.json)
包含源码绑定、边界和原失败，不覆盖前一输入法检查点。

视觉/交互核对仅针对本次可见内容与恢复：原令牌/字体/层级不变，标签示例、
明确错误、手机不溢出和原输入恢复通过。未重新测量全部对比度、辅助技术或全应用，
不声称完整设计 checklist/无障碍认证。持续优化目标仍活动、无限预算、仅本地。
