# 当前用户流程

## 两轮 Web 功能 — 2026-10-30（本地源码，未部署）

- 搜索可命名保存现有条件；重新打开仍按当前权限检索，不保留结果快照。
  已加载命中支持明确逐对话勾选后归档，不隐式作用于全部结果。
  连续阅读最多 100 个安全目标，可上一／下一／返回原搜索条件或退出；临时队列
  按账号隔离，目标失效沿用 Reader 安全降级，不把程序滚动记作已读。
- `/annotations`、`/files`、`/duplicates` 为私人服务端分页入口。来源锚点、
  文件下载仍由原合同授权；正文 hash 相同只是候选，不自动删除／合并。
- Reader 可显式加入待读（初始未读）、手动标已读／未读或移除；清单按加入时间
  逐批加载，最多 500。打开、预览、搜索跳转、位置恢复不会自动改状态。
- 历史面板可只读比较两个已加载版本，比较不写当前版本；每轮可单独折叠，
  保留真实 article／block 身份，定位前先展开。来源追溯只显示明确本地 split／
  merge 事件并独立读取相关标题，服务暂时失败可留在面板重试。
- 导出面板可保存现有选项预设；离线中心可保存最多 50 个目标的常备清单并显式更新。
  保存清单不表示当前设备已下载，队列和冲突仍走原流程。配置暂不进便携包。
- `Alt+Shift+P` 打开可检索快速操作：方向键／Enter、Tab 环绕、Escape 恢复焦点，
  输入法合成不触发执行。已有搜索、编辑和阅读快捷键不改。
- 私有来源引用复制只接受单条消息正文选区，不创建 Share／公开图片能力；
  TSV／CSV 从完整 HAST 表格结构导出，默认防公式、超限明确停用，复制拒绝有手动恢复。
  粘贴导入只在明确点击分析后上传，复用现有导入任务／预览／提交。
- 打印稿从 canonical 分页，最多 2,000 条并显示实际数量和超限提示；不默认带私人
  批注／笔记，不承诺浏览器页码或任意 Mermaid／附件保真 PDF。
  `/example` 是可跳过的只读合成示例，不写 canonical 库、最近记录或任务。

WEB-05/08/11/21/22 尚未实现，分别需要访客投影、双 Reader 隔离、便携多标签、
真正已读内容基线和冻结分享生命周期合同。不能把上述本地源码当作生产能力；
逐项处置及验证见[实施记录](../execution/WEB_FEATURE_OPPORTUNITIES_IMPLEMENTATION_2026-10-30.md)。

## 当前发布能力 — 2026-10-19

以下能力已随 `f3b331a / 0052` 上线；实际 CI、维护、数据和运行验收见
[发布记录](../execution/FEATURE_RELEASE_2026-10-19.md)。
完整生产移动端交互和长期低内存负载不在本次验收中。

### 多文件导入：上传确认后转后台任务

选择多份 JSON/Markdown 并提交后，前端等待的只是有界上传和服务端落盘，
不等待格式识别、分组或结构族分析。服务器返回任务 ID 后，浏览器释放
选中的 File 对象；用户可以关闭导入窗口、切换页面或刷新，任务继续由单
worker 执行，并可在任务中心查看进度、失败原因和结果。任务结果可重新
打开原导入会话继续映射/导入，不会再次上传。

首轮分析失败时服务器保留暂存源，任务中心允许以同一任务身份重试；取消
排队任务会删除本次临时来源，已在运行的任务则先请求取消，由 worker 在
安全边界确认后清理。尚未完成首轮分析的会话不能进入 canonical commit。
这改变的是初次分析的执行位置，不代表替换来源、映射验证等所有后续分析
也都成为后台任务。此变更复用通用 BackgroundJob，无新增 migration，
已随本轮发布上线；0052 migration 仅用于噪声保护确认，不属于后台分析任务类型。

### 普通 Markdown 与页面拖放导入

没有可靠重复消息边界的普通 `.md` 文件不会再被强行拆分：分析通过安全
检查后，保留整个文件为一条 `assistant` 消息，标题优先取第一条 H1；
空文件、编码错误、指令/Context 包和未闭合代码块仍按原错误恢复。

Owner Reader 页面支持把文件拖到页面任意位置，或拖到左上角的“导入数据”
按钮。全部对话页默认导入到“未归类”；项目页使用当前项目；从项目打开且
带有项目上下文的 Reader 使用该项目。直接打开某个 Reader 时，待 Reader
读取到当前对话的真实项目关系后也会使用该关系；读取尚未完成时安全地按未归类
处理。导入对话会显示目的地，用户可在审核阶段改选未归类或其他活动项目；
服务端再次校验所有权和归档状态，canonical commit 开始后目的地锁定。
`.cr` 仍进入独立归档恢复流程。

### 源码编辑器表格工具 — 2026-10-21 本地续改，尚未发布

源码编辑器的“表格工具”是用户主动打开的面板，不在正常阅读或输入时
自动改写。当前只有规范表格工作流，不再显示模式按钮和重复说明：上方就是
可点击编辑单元格的实际 Markdown 渲染表格，下方为可编辑 Markdown，两者
双向同步，不再额外复制一份网格。链接和图片在这个编辑表格中保持惰性，点击
只编辑单元格，不顺带导航或请求远程图片。四边的 `+` 可在顶部/底部增加行、
左侧/右侧增加列；桌面靠近边缘或键盘聚焦时显示，触摸设备常显。图形为小圆点，
交互区域仍至少 44px。四个控件定位于可见预览的四边，表格本身在中间滚动，
不会因整张表格太宽或太长而把 `+` 藏到全内容中点。各边预留完整点击区域，
不覆盖单元格或滚动条；不增加模式、工具栏、说明或滚动/尺寸监听器。
短横屏需要时正常纵向滚动弹层工作区，不要求所有内容同时塞进屏幕。

Enter/方向键可移动单元格，文本选区、光标中间的左右移动和输入法组合输入
保持原生行为；Enter 不会提交底层消息表单，Escape 先退出单元格，再关闭面板
并恢复编辑器焦点。弹层持有焦点时，底层编辑工具快捷键不会抢焦点；工具栏入口
也称“表格工具”，不再误称“插入表格”。顶部撤销/重做直接调用 CodeMirror
公共命令，不再向外层 DOM 派发无效键盘事件。大表按页查看，每页最多
30 条数据行，通常最多 400 个表格单元格。源表格（含表头/分隔行）超过 3,200
个单元格时采用 120 个可视化单元格预算，但至少保留完整表头和一行数据，
因此 200 列宽表仍可能显示 400 个单元格；
追加到底部会显示真实末页。多页时可用首批/上一页/下一页/末批直接到首尾，
并显示实际行范围；单页不显示分页条。四个按钮均为 44px，窄屏不足时行范围换行，
不挤缩按钮。到边界后焦点留在相邻可用翻页按钮上，不自动进入单元格。
翻页不改变草稿；完整原文一直保留在 Markdown 区域和最终应用范围中。
Enter/↓ 及 Shift+Enter/↑ 可以跨页定位相邻数据行，末行没有下一行时仍保持
输入框；编辑中的 Shift+方向键用于原生文本选择，不跳出当前单元格。
首列向左、末列向右没有目标时也保持输入框。纯文本单元格编辑成粗体、链接等
内容时，连续输入不被预览更新打断；退出编辑后显示真实格式，Escape 焦点
仍回到对应的当前单元格。
点击四边 `+` 后聚焦新行的第一个单元格或新列的表头。定位等待预览时，
用户若已转到 Markdown 或其他控件，就取消旧焦点请求，不把焦点抢回来。
为避免单个巨大文本/公式拖慢富文本解析，当前页中超过 32,768 个 UTF-16 代码单元的
单元格在渲染表格中以省略号代替，并显示页内数量提示；完整值仍可从下方 Markdown
查看/编辑，也保留在单元格编辑器与规范化/应用数据中。该显示预算仅限制可视化解析，
不会截断源文或提交值。

共享弹层忽略输入法合成中、旧式 keyCode 229 和已经被子控件处理的按键。
取消候选用的 Escape 不得关闭表格或丢掉未应用草稿；这也适用于下方 Markdown。
普通 Escape 仍先退出单元格，再关闭弹层。[输入审查](../execution/ux-audit-table-input-2026-10-20.md)
保留失败基线和受信任 Chrome CDP 事件，不将其等同于真实候选窗口验收。

Markdown 未完成或超限时保留原输入与最近有效预览，但预览只读、不可应用。
快速输入时编辑值立即更新，整表解析与富渲染预览可延后追赶；源码尚未解析时
同样不能应用旧表格。规范且有效的网格草稿只序列化改动行并增量检查 UTF-8
预算；原始 Markdown、无效草稿恢复和增行列仍完整检查。追赶期间保留正在编辑的
单元格输入，但禁用其他单元格的进入/跳转、边缘增行列和应用，避免对旧预览操作。
这时 Escape 退出单元格后聚焦 Markdown，待最新预览完成结构检查后恢复操作。
后台编辑器正文改变时保留工具草稿，必须明确重新预览，不能用旧位置覆盖新文。
应用前验证现有 GFM 渲染链确实生成表格，随后用一个 CodeMirror transaction
写入草稿；一次撤销恢复原文，保存仍走现有消息版本流程。规范化保留引用/列表
容器与文档换行约定；混合 CRLF/LF 的源偏移按每条实际换行计算。
单元格边界只规范普通空格和 Tab，不删除 NBSP、BOM 等 Unicode 空白内容。
纯文本、链接、实体、公式等均走共享渲染链，不用另一张手工生成的表格代替验证。
表头或数据单元格里的 `---`、`:---:` 等字面内容不会再被当作额外分隔行拒绝。
光标范围依据首个可用结构分隔行及其上一行定位；明确选区中只有更晚位置出现
分隔结构时仍拒绝猜测，不静默吸收前方正文。普通/引用/列表、LF/CRLF 的实际 GFM
输出对照及桌面/375px Apply/Undo 见
[横线内容审查](../execution/ux-audit-table-delimiter-content-2026-10-21.md)。
自动识别不吸收
相邻带竖线的普通段落，代码围栏示例只能明确选中处理；HTML 合并单元格和不可靠
边界不猜测。1 MiB UTF-8、5,000 行、200 列、50,000 单元格的限制仍生效，
超限不截断原文。创建等旧纯转换能力保留兼容，但不作为面板模式展示。

单元格内的 HTML 标签代码、明确转义及 `colspan=2` 等普通说明可以正常编辑，
不再由全片段字符串黑名单误拒绝。真实 HTML 表格结构仍不支持；完整草稿和单格
输入共用这一判断，禁止应用时保留输入，修正后可继续。[字面单元格审查](../execution/ux-audit-table-html-cells-2026-10-20.md)
记录实际桌面/375px 触摸流程；这不放开用户 HTML 或合并单元格。

不成对的行内反引号按普通文字处理，不再阻止已经正常渲染的表格进入工具或
继续单格输入。只有存在等长闭合符的片段才作为代码；字面反引号不能吞并后面的
列分隔符，也不能绕过真实 HTML 结构检查。未转义竖线仍按普通列边界处理，
规范化按最大列数补齐、保留额外内容。[反引号审查](../execution/ux-audit-table-code-span-2026-10-20.md)
包含桌面双向编辑、应用/单次撤销及 375px 触摸验证，不增加模式或说明控件。

确定的行内公式竖线不会再误拆为多列；单竖线和 `\|` 范数保留不同含义，
代码内的连续反斜杠也不会被多删。规范化只在用户应用时写入草稿。
复杂 TeX 字面参数、数组前导声明或会改名的未转义引用 ID 不猜测修复；用户仍可
回源码修改。公式竖线转义后的 UTF-8 膨胀也计入工具上限。

预览按冻结源码读取表格外的链接定义，不把定义写入下方 Markdown 或应用范围，
也不加载远程资源。上下文读取最多 1 MiB 源码，投影最多 256 条/32 KiB 定义；
超限、跨行标识或暂未投影的脚注正文显示一条局部提示，可在完整源码预览核对。
原定义、标题、顺序和表格外正文不变。

输入时复用冻结的原表格与已经生成的规范 Markdown，避免每个按键重读原文和
重复解析同一预览。单元格回调更新独立于 Markdown 解析，当前输入与事件仍同步；
仍校验草稿，并在最终应用时重新校验真实编辑器内容及范围。
优化不扩大可处理范围，不引入长期全局缓存。

初始验证见[表格续改](../execution/TABLE_TOOL_EDITING_2026-10-20.md)，真实工作区
与 CodeMirror、客户端保存 payload 的合成边界见
[后续集成记录](../execution/TABLE_TOOL_WORKSPACE_2026-10-20.md)，22 场景及
有界大表性能观察见[输入续查](../execution/TABLE_TOOL_PERFORMANCE_2026-10-20.md)。
当前 27 场景、公式 MathML/引用保真与最新完整门禁见
[内容续查](../execution/TABLE_TOOL_CONTENT_INTEGRITY_2026-10-20.md)。
单元格长文本的有界显示、原文及未编辑应用保真见
[长单元格续查](../execution/TABLE_TOOL_LONG_CELL_2026-10-20.md)。
回调变化不重复解析，以及旧预览等待期的保护见
[解析复用续查](../execution/TABLE_TOOL_PARSER_REUSE_2026-10-20.md)。
嵌套图片/引用的括号分类使用按本次操作惰性建立的线性后缀索引，避免未闭合
`![` 反复重扫。没有增加嵌套层数截断或长期缓存。超过已有 1 MiB 工具预算的
单元格输入在解析前拒绝，保留上次接受的草稿并提示缩小范围；无效但未超限的
Markdown 仍可完整编辑修复，不能应用到原文。原先逐行围栏识别的性能边界见
[括号索引续查](../execution/TABLE_TOOL_BRACKET_INDEX_2026-10-20.md)；
当前已由下述真实解析上下文判断替代，不恢复会回溯的旧正则。
表格预览完成后若实际 DOM 不是预期的表格形状，会显示可读错误并关联应用
按钮，而不是只留下无说明的禁用状态；编码器复用只减少对象构造，不缓存正文。
键盘/焦点的失败基线和最新门禁见
[交互续查](../execution/TABLE_TOOL_NAVIGATION_2026-10-20.md)。
自动识别现读取 CodeMirror Markdown 的代码块上下文：引用/列表样式的内容
不会被误当作闭围栏；离开引用或列表容器后，外层正常表格可重新识别。缩进代码
也不能仅靠光标自动识别，但完整选区仍可明确编辑代码示例。无表格或受保护时
给出完整选区的恢复说明，而不是重复要求已经在表格中的用户移动光标。

面板冻结当前源码及已解析位置对应的编辑器语法树，在打开、编辑和应用中复用。
旧源码或未覆盖表头的树不能用于判断；没有可用树的独立调用只解析到表头行，
不解析表格后方正文、不保留全局历史 AST。极长前文的独立回退仍有相应解析成本。
预览只渲染表格本体，不用脱离父列表的缩进把合法表格变成代码块；引用/列表前缀
仍完整保留在下方 Markdown 和最终应用中。该检查点 **41** 场景、5 个诊断差异修复及
500 个 GFM 代码上下文对照见
[代码上下文续查](../execution/TABLE_TOOL_CODE_CONTEXT_2026-10-20.md)。
先前 200 列宽表增行 `+` 不可达，以及随后复现的长表增列 `+` 不可达，已在
[边缘控件续查](../execution/TABLE_TOOL_VIEWPORT_EDGES_2026-10-20.md)修复。
该检查点 **45** 个浏览器场景用真实坐标点击/触摸和 hit-test 验证滚动开头/中间/末尾；
不是仅检查 DOM 存在，也不让测试动作自动把隐藏按钮滚入。完整草稿、跨页新增
和新单元格焦点语义不变。

含 `<` 的冻结源码另由现有 GFM 渲染链做一次有界只读校验，不能再拿编辑器的
HTMLBlock/Paragraph 当作最终依据。只提取字面块和实际引用定义的源范围，在
HAST/KaTeX/DOM 生成前清空探针树；单元格/Markdown 编辑复用该次结果。
因此 `textarea` 跨空行的内容仍被保护、其中的示例引用不能影响外部表格，而
引用内普通 HTML 被空行结束后的真实表格可继续编辑。
完整选区仍允许编辑示例，但不删除外层标记、不改变 Reader 的 HTML 安全策略。
超出 1 MiB UTF-8、100,000 节点或 8,192 范围的上下文不作自动授权，提示完整
选中表格重试；不截断或改写原文。
上下文坐标组合现有公式/富文本显示投影的映射；CRLF、Unicode、引用 ID/URL
和最终应用始终对应原始源码。引用提取先按实际字面范围等长遮蔽，再用编辑器
读取原始拼写；未通过实际定义范围校验的结果不会进入预览。
GFM 上下文检查点 **56** 场景与 **83** 项专项见
[GFM 上下文续查](../execution/TABLE_TOOL_GFM_CONTEXT_2026-10-20.md)。
[此前字面块检查点](../execution/TABLE_TOOL_LITERAL_CONTEXT_2026-10-20.md)的 75/49
绿灯范围不足，也引入过合法引用表格误拒绝；原失败保留，未被改记通过。
无可处理表格时不显示空白、禁用的 Markdown 编辑区或不可操作的“应用”；简短
恢复说明关联到对话框，提供“返回源码”并恢复编辑器焦点。真正的无效/陈旧表格草稿
仍保留可编辑 Markdown 和禁用的 Apply，不用空状态替换或丢弃。最新 **57** 场景及
实际 375px 紧凑布局见[恢复动作证据](../evidence/table-tool-recovery-actions-2026-10-20.json)；
[先前空状态检查点](../execution/TABLE_TOOL_EMPTY_STATE_2026-10-20.md)保留当时的禁用按钮行为。
这些本地 Chromium 结果不等于登录后服务器保存、Reader/Offline/Share 或低内存
验收；未启动 CI、未推送、未部署。

### TOC 返回阅读原点

Owner Reader、Offline Reader 和 Share Reader 都只保留当前访问会话内的
一个“第一次目录跳转前”真实 DOM 锚点。后续目录跳转、手动滚动、搜索和
焦点模式不会覆盖它；右上角和移动端直接可达的至少 44px 返回入口恢复
消息/版本/块/字符偏移。成功返回后清除，目标加载失败或用户中断时保留并
提供重试及“定位原消息”降级入口。它不接管浏览器后退、不新增数据库进度
字段，也不把程序化滚动当作用户滚动；账户、对话、Share 访问切换会清除。

### 批注导出

批注仍是独立结构化记录。在线批注页的“导出全部批注”忽略页面筛选、勾选
和当前消息，只下载服务器已保存且未删除的批注；未保存草稿不混入。离线
页面明确说明单独下载需要在线访问。Context ZIP 1.1 在根目录增加可读
`annotations.md`，而 `continuation/current.md` 与 `continuation/index.json`
继续保持原路径和用途；回传只处理 Current/Index，不把 Markdown 批注文档
当作写回格式。

### 噪声审阅

候选同时显示实际匹配文本、规则名称/固定版本、匹配模式、保护原因和可展开
上下文。规则修改按试跑、保存、原范围重扫进行；新扫描不复制旧选择。受保护
匹配按规则和明确筛选范围一次确认，确认只保存待删除状态，最终预览和服务端
仍重新校验源版本、候选集合和删除片段。复选框、文字状态、底色和精确删除
片段标记共同表达状态，不能只依赖颜色。

## Noise review with editable ranges (deployed 2026-10-16)

For many scanned candidates, choose a rule/conversation group, inspect context,
and select any number of items. Bulk actions explicitly name the current scope
and cover all its pages, not just visible rows. Selected-only review and the
global selected count expose choices in other groups. No item must be deleted.
Checkbox, state text and row tint show selection; saving is separate from saved
state, and stale/protected/conflict/completed rows never receive a pending check.

Selected candidates now strike only exact proposed removal text, with retained
words left plain after refinement. Unselected candidates keep the original
suggestion highlight, not a deletion line. Completed rows say completed rather
than kept/rescan; invalid refinements show recovery guidance instead of guessed
markers. The local markup checks were followed by passing 375/1440px browser
cases and original synthetic screenshot review in exact-source CI 38902167421.

Open **Adjust deletion ranges** on a candidate, select the actual noise in its
read-only text, choose **Only remove selection**, and optionally add more
selections (up to 20 ranges). Remove a range to retain that part, or restore the
whole candidate. The retained context updates immediately. **Save ranges and
select** saves this review choice only; unchecking and reselecting retains it.
No future rule is changed. To keep everything, return and uncheck the candidate;
to widen the match or rewrite text, use the existing Markdown source editor.

Return to the preserved list position, inspect the required full-message change
preview, then confirm application. Source/protection changes block unsafe edits.
Unconfirmed saves preserve the draft and require read-only reload before another
save; a differing choice requires explicit adoption, and changed source requires
rescan. Closing does not undo a choice that may already have saved.

[Contract](CONTENT_CLEANUP_CONTRACT.md#editable-candidate-ranges-local-source-2026-10-15).
Exact-source PostgreSQL 16 and dedicated native-pointer mobile/desktop browser
cases now pass, including checkbox off/on preservation, full preview and exact
canonical apply. This is not real-device touch or assistive-technology acceptance.
Production `aea13fe`/0051 was accepted on 2026-10-16 after verified backup,
user-authorized non-deleting isolation and migration/data/runtime acceptance.
The earlier preflight/OOM incident remains recorded; it is not the current state.
No production conversation was edited merely to demonstrate the feature.

## Conversation split workspace recovery (local source-only repair, 2026-10-15)

The split workspace reads the complete current dialogue index before showing
usable choices. A failed read stays in the workspace and offers **Retry
reading**; it does not claim that the previous conversation's rows are the
current source. Replacing the source or selection clears the old timeline,
selection and preview state before the new read begins.

Preview and execute completions belong to the current workspace and operation.
Closing, reopening, or switching the Reader context retires older callbacks;
they cannot publish an old preview, result, error or parent selection reset
into a newer split. While preview or execute is pending, mode, message and
title controls are locked. Requests already sent are not cancelled or
replayed, and confirmed split links remain valid. The source-only regression is
unexecuted; real API, React, browser and screen-reader acceptance remains
pending.

## Support Requests capability read recovery (local source-only repair, 2026-10-15)

When the Support Requests surface opens, its account role and request
capabilities are read before selecting the personal or administrator inbox.
The read and the existing offline cached-role fallback belong to the current
mounted panel, authentication generation and latest retry. A retry is
read-only, clears unconfirmed role/capability state while loading, and a late
response cannot change the inbox mode or expose a stale request control.

Existing offline-access checks, cached fallback, support request/draft/API
contracts, backend permission checks and request data are unchanged. The
source-only regression is unexecuted; real API, React, browser and
screen-reader acceptance remains pending.

## Adaptive import session action lifecycle (local source-only repair, 2026-10-15)

Within one adaptive import session, profile choice, invalid-file replacement,
group exclusion, reanalysis, grouping confirmation and mapping save are
serialized by one local action owner. While an action is pending, other
session-changing controls, leaving the workspace and final import submission
are paused. Only the still-current response updates the visible session; a
late response from a retired or different session is ignored. Requests already
sent to the server are not cancelled.

The grouping editor rebuilds its local values when the ordered source-artifact
identity set changes, preventing removed files from being submitted or new
files from appearing without a value. Import files, analysis, API endpoints,
server ordering and commit semantics are unchanged. The authored source
regression is unexecuted; real network ordering, React remount, keyboard and
screen-reader acceptance remain pending.

## Conversation TOC stale-read recovery (local source-only repair, 2026-10-15)

When a Reader or Share section-contents refresh fails but older heading entries
remain usable, the directory keeps those entries and shows a compact notice
that the previous contents are being shown. A local **Retry** only reopens the
existing section-contents query; a successful response clears the notice.

An initial failure with no visible headings keeps the existing error shell and
Retry. Heading parsing, `message/block` navigation, real DOM anchors, Reader
position behavior, Share access and offline semantics are unchanged. The
authored source regression is unexecuted; real API, React, focus, scrolling,
browser and screen-reader acceptance remains pending.

## Conversation index jump/page read recovery (local source-only repair, 2026-10-15)

In the Reader's sheet conversation index, a failed numbered jump or previous/next
page read leaves the last readable index in place and shows a compact local
error with **Retry**. Retry reuses the same ordinal or page direction and the
same bounded `offset`/`limit`; it only reads the index page. A successful read
clears the notice and preserves the existing target `onNavigate` behavior.

The initial index query's existing retry, filtering, real DOM scroll anchor,
complete-turn Reader semantics, Share URL and offline package behavior are
unchanged. The authored source regression is unexecuted; real API, React,
focus, scrolling, browser and screen-reader acceptance remains pending.

## Conversation-files capability read recovery (local source-only repair, 2026-10-15)

The online Reader's conversation-files panel enables **Upload** only after
the attachment capability read has confirmed that upload is enabled. While
the initial read is pending, the button is paused with a status message. If
the read fails without prior successful data, the button stays paused and the
panel offers a capability-only **Retry settings** action. A stale successful
capability result remains usable during a background refresh failure.

Attachment list reads, upload session/item/finalize flow, rename/detach/insert
actions, permissions and stored data remain unchanged. The authored source
regression is unexecuted; real API, React, browser and screen-reader acceptance
remains pending.

## Offline library download-status recovery (local source-only repair, 2026-10-15)

The Library's local download-status subscription now distinguishes “cannot read
status” from a confirmed queued/downloading/writing/failed record. If the
subscription errors, old progress and failure projections are removed from the
surface; the user is told a download may still be running and can choose
**Retry status read**. This action only recreates the existing local
`liveQuery`; it does not cancel, enqueue, replay or label the background task.
The next successful emission restores normal progress/completion/failure mapping.

Normal download-start errors, local-library read errors, task cancellation,
offline package compatibility and stored records retain their existing owners.
Source regressions are authored but unexecuted; liveQuery, IndexedDB, worker,
browser and screen-reader acceptance remains pending.

## Offline library local read feedback (local source-only repair, 2026-10-15)

`/library` distinguishes the first local conversation/message read from search
index preparation. Until the local list succeeds, it does not claim that no
offline copies exist. An initial local read failure says that copies were not
deleted and offers **Retry read**. If a later refresh fails, the last
successfully read list remains visible with a separate local-refresh notice and
the same retry path. The existing serialized reload owner is reused; Retry
does not enqueue a download, replay a mutation or navigate.

The selected catalog-only download deep link remains available while local
library data is loading or unavailable. Search waits for the local list and
continues to own its separate Worker/index failure state. Dexie v2, offline
package v1/v2/v3, selection, delete protection, Share and reading-position
semantics are unchanged. Source regressions are authored but unexecuted; real
IndexedDB, React, focus, browser and screen-reader acceptance remains pending.

## Adaptive import-session restore feedback (local source-only repair, 2026-10-15)

When the Import surface remounts, it reads the saved adaptive-session UUID with
an explicit restoring state. A transient read failure retains the UUID and
shows stable read-error feedback with **Retry**; Retry only reads the same
session again. The page does not create a new import, replay commit, cancel the
session or delete the pointer on an unconfirmed error. Confirmed terminal
sessions and explicit new-file selection retain their existing cleanup behavior.

The restore state is separate from import commit/status errors. The authored
source regression is unexecuted; real sessionStorage, API, React remount,
browser refresh and screen-reader acceptance remain pending.

## Source editor attachment-picker read feedback (local source-only repair, 2026-10-15)

The source editor's current-conversation attachment picker separates a
successful empty list from a failed list read. When no cached rows are
available, a read failure says that available files could not be loaded and
offers **Retry**; when old rows are available, they remain visible with a
stale-refresh notice. Retry only refetches the attachment list and does not
insert, upload or delete an attachment. The empty message appears only after a
successful read. The authored source regression is unexecuted; API, Query
cache, browser and focus acceptance remains pending.

## Inline attachment locale feedback (local source-only repair, 2026-10-15)

Inline attachment blocks now follow the resolved interface locale for loading,
failure, retry, empty/missing/unsupported/offline states, preview controls,
open/view/play/download labels and their ARIA/title text. Shared attachment
type metadata also has localized labels. Attachment access, render selection,
Viewer, cache, download and Reader/Share anchors are unchanged. The authored
source regression is unexecuted; real locale switching, browser and
screen-reader acceptance remains pending.

## Offline export attachment-count read recovery (local source-only repair, 2026-10-15)

The offline export panel distinguishes loading, confirmed zero/non-zero results
and a failed local attachment-count read. A failed count read keeps
**Generate offline export** available, explains that the count is temporarily
unconfirmed and offers a local **Retry count** action. Retry only reopens the
existing count query; it does not change the attachment checkbox, replay export
generation or alter offline package v1/v2/v3 compatibility. The authored source
regression is unexecuted; real Dexie, React, export artifact, browser and
screen-reader acceptance remains pending.

## Shared confirmation lifecycle (local source-only repair, 2026-10-14)

The shared confirm/prompt provider owns at most one waiting decision. A later
request immediately returns its cancellation value (false/null), retaining the
first visible decision and input without queuing another operation. A decision
belongs to its pathname visit and authentication generation. Leaving and
returning to the same pathname is a new visit; obsolete context functions cannot
open decisions in the new scope. Invalid decisions are hidden during render
and their promises are cancelled through lifecycle cleanup or a live callback.
Authorization-failure/access-lock events and provider unmount also cancel waiting
decisions. Unmount does not update retired state. Old form/input/close/focus-helper
callbacks cannot confirm, edit or dismiss a newer decision.

Existing confirmation/prompt return types, whitespace validation, trimming,
visuals, labels and shared focus helper are preserved. Normal completion clears
the provider's unused input value. Already accepted server work is not cancelled
or undone. Query/hash changes, same-route business scope and caller-owned drafts
still require their own guards. No queue, persistence, dependency, timer, polling,
network call or routine notification was added. The source and new callback
regressions are intentionally unexecuted; real React scheduling, focus, keyboard,
touch and browser rendering remain unverified.

## Conversation permanent-deletion recovery (local source-only repair, 2026-10-14)

The main/archive list, project list and single-conversation menu share one
bounded deletion-admission owner. Targets retain their original visible order
through confirmation; duplicate clicks and retired account/route callbacks do
not start a second request or clear a newer surface's selection. A lost response
keeps the selection and original request in memory and exposes compact recovery
outside Reader layout. It can be minimized without abandoning the request.
Row/menu closure and private in-app navigation retain it; full reload, owner
unmount and sign-out do not guarantee browser recovery.

Checking is an explicit read-only receipt GET. Failed/incomplete checks remain
unknown; only a definite missing receipt enables an explicitly confirmed retry
with the original key and targets, never the new selection. Found failed or
cancelled work is not restarted. Normal confirmed submission retains existing
list/menu feedback; refresh failures do not change admission. Recovery links to
the current task center, or back to the conversation list on surfaces without
that center. Server replay covers all retained statuses before source validation,
binds the normalized ID order, and serializes PostgreSQL same-key admission.
Per-item deletion, partial results, task retry/cancel and source retention are
unchanged; no migration, dependency, polling or automatic write was added.
All implementation and newly written regressions are intentionally unexecuted
per user direction; runtime, layout, focus, keyboard and touch remain unverified.

## Content-cleanup scan error recovery (local repair, 2026-10-14)

清理噪声面板不再直接显示扫描创建异常或 FAILED/STALE worker 的原始消息。
范围不存在、权限不足、规则未启用、已有任务和版本变化分别给出稳定中英文
提示；未知扫描失败明确“正文未改变”，并保留现有重扫或任务中心核对方向。
不新增请求、自动重试、轮询、删除、规则、持久化或资源策略。本地源码尚未运行
或验证，用户将自行检查。

## Adaptive import error recovery (local repair, 2026-10-14)

Adaptive import upload/analysis, saved-format selection, mapping preview/save,
format health checks, replacement, grouping and commit share localized
operation-error handling. Known permission, size, session-state, analysis and
replacement codes receive specific guidance. Source-validation diagnostics
remain available; health-check transport failures use localized copy while
keeping the existing explicit Retry. If an unclassified write loses its
response, the UI says its result is unconfirmed and advises checking current
import state before another submission. API 5xx handling preserves only a
structured code and does not expose server error detail. No network request,
automatic retry, persistence or commit semantics were added. This local
source-only repair has not been run or verified; the user will verify it.

## Import format settings error recovery (local repair, 2026-10-14)

The user's learned-format list, revision history and personal setting updates use
stable Chinese/English recovery messages instead of raw API or transport errors.
Known permission, unavailable-record, concurrent-change, rejected-input and
rate-limit responses are distinguished. An unconfirmed update asks the user to
refresh and check the current format before deciding whether to retry; name drafts
remain in the existing editor. Read retries and format/cache behavior are unchanged.
This is a source-only change without runtime or automated verification; the user
will verify it.

## Account security failure feedback (local repair, 2026-10-14)

Account settings distinguish unsaved preference persistence and unreadable local
pending-state checks from logout/password requests. Local preflight failures say
that the server action was not submitted; unreadable sign-out state keeps the
existing explicit discard-and-sign-out confirmation. Authentication status errors
use stable localized recovery copy rather than raw server/browser messages. If a
password request has an unknown result, the user is told to try the new password
in a separate tab before considering another submission. Password drafts and the
existing pending-change sync/export/discard review are retained. This source-only
repair has no runtime or automated verification; the user will verify it.

## Notebook draft write queue (local repair, 2026-10-13)

Local draft input starts a write immediately. While it is pending, newer input
replaces one waiting snapshot instead of queuing every intermediate whole note.
The draining promise covers the latest snapshot before remote save or draft cleanup.
Each successful write advances the existing expected version; failures leave it
unchanged and retain the latest input for explicit retry. No debounce timer,
background retry, storage format or additional success notice is introduced.

The [queue audit](../execution/ux-audit-notebook-draft-write-queue-2026-10-13.md)
separates measured callback/write counts from unmeasured browser/device performance.
The existing before-unload and panel-close draft safeguards remain in effect.

## Notebook title accessible name

标题输入的无障碍名称随界面语言切换：简体中文为“精选笔记标题”，英文为
`Notebook title`。它不依赖可能消失的 placeholder；组件合同测试覆盖两种语言。
屏幕阅读器语音输出没有真实设备验收。

## Annotation creation and adding to notes (local repair, 2026-10-13)

Text annotations and bookmarks share one creation owner from the initial action.
The comment prompt includes the original selected quote. One UUID and the full
payload are retained on failure, with expandable quote/comment content. Recovery
first reads annotations; only a successful missing-ID check enables explicit
same-payload retry. An existing ID finishes without another create. Late success
clears only the original matching selection; a newer selection remains usable.
Cancelling the prompt releases ownership, and old-scope completions cannot publish.

Single and bulk Add to notes share an original target set and stable reference
IDs. Unknown results retain that set and offer a read-only check of current
annotations, notebook and conflicts. Explicit retry adds only valid missing
original targets using the newest notebook title, blocks and revision. Existing
references are not duplicated; missing annotations are disclosed. Exceeding the
5000-block limit prevents the write rather than silently truncating it, with an
exit to finish the pending addition and organize the notebook. Dependent notebook
saves and annotation deletion remain blocked while an addition is unresolved.

These controls live in the annotation workspace, with no routine Reader save
notice, polling, dependency or format change. Recovery is scope-local memory;
read-only checks are not mutation receipts. Browser, focus and touch acceptance
are pending; see the [composition audit](../execution/ux-audit-annotation-composition-2026-10-13.md).

## Annotation write recovery (local repair, 2026-10-13)

Comment input belongs to its annotation and current conversation/repository/auth
scope. Filtering, closing the panel and changing styles do not replace the draft.
Failed saves retain it and do not repeat on blur. Current-comment checking is
read-only; a different stored comment requires explicit comparison/confirmation.
Typing during a request or confirmation is preserved. Comments and unknown-write
recovery remain in memory within the workspace; they are not cross-route storage.

Style updates publish each acknowledgement before proceeding. Partial failure
offers a current-state read; only a later explicit action submits nonmatching
items. Deletion confirms the original targets, deletes first and then cleans
their notebook references. Partial/unknown failures stop the chain; checking
never writes. Only confirmed-absent original targets qualify for explicit
reference cleanup, using the current notebook revision. Cleanup failure does
not re-delete annotations. Absence is not a receipt for the earlier request.

Bookmark creation holds a fixed UUID while pending/unknown. Its recovery checks
that ID, offers explicit same-ID retry only after a successful missing-result
check, and relies on existing remote/offline uniqueness. Notebook saved-draft
cleanup has a separate expected-version retry and does not resubmit the notebook
or erase newer drafts. Recovery appears in the annotation workspace; no routine
position-save notice is added to Reader. These changes are local and have no new
browser acceptance; see the [write audit](../execution/ux-audit-annotation-writes-2026-10-13.md).

## Annotation reads, selections and CSV previews (local repair, 2026-10-13)

These changes are newer than production 84988a2. Annotations, notebook and
conflicts publish independently and offer resource-specific retry. A transient
failure preserves usable data within the same conversation/repository/auth scope;
unavailable access clears that resource. Old responses and old UI completions
cannot replace a new scope. Closing keeps legitimate Reader highlights, and a
Reader bookmark can still be created while the panel is closed.

Unknown notebook/conflict reads block dependent saves, add-to-notes and deletion;
the local draft remains editable and retained. Recovery does not replay a write.
Confirmed notebook writes retire earlier reads. The existing revision and offline
outbox contracts are unchanged; these are client guards, not new server transactions.

Batch actions use the same valid selected annotations across filters. The toolbar
shows hidden selections and provides Show all/Clear; visible Select/Invert retain
hidden selections. Applicable counts exclude bookmark styling and duplicate note
references. Delete confirmation discloses hidden targets and rechecks surviving
original IDs and the current notebook revision; it never expands to a new selection.

CSV/TSV preview retains the true header and ordered prefix. Parsing stops explicitly
at 10,001 rows (including header), 256 columns, 50,000 cells, 4,096 UTF-16 units per
field or 2,097,152 scanned units; unclosed quotes are also disclosed. It does not skip
wide rows or claim an incomplete prefix is the full file. Raw/download remain
available and the existing 50 MiB text-download limit is unchanged. Rendering uses
at most 50 rows and 2,000 data cells per page, with continuous row numbers, keyboard
buttons and an independently scrolling table. No library, polling or worker added.

See [audit and verification limits](../execution/ux-audit-followup-2026-10-13.md).
Browser geometry, focus/scroll behavior and device CPU/RSS remain unverified for
this local batch. Earlier dated sections describe their original checkpoints;
current release acceptance is recorded in Project State.

## Mobile Reader header reserve (local repair, 2026-10-09)

The first message remains below the mobile header even when offline guidance
wraps. A React ref owns one border-box size observer and a parent CSS property;
the reading region uses that height for top and native scroll padding. It writes
only on size changes, ignores callbacks after cleanup and restores the property's
previous value without overwriting a newer owner. Header auto-hide only transforms
the header and does not shrink the reserve; desktop uses normal header flow and
zero extra padding. No scrolling, saving, user-intent or anchor logic is added.

The [mobile release audit](../execution/ux-audit-mobile-release-2026-10-09.md)
records the original synthetic 375px English obstruction and local callback
checks separately from pending exact-source browser acceptance. This is a bounded
layout repair, not a full visual/accessibility or measured resource-cost claim.

## Reader quiet autosave and navigation readiness (local-only, 2026-10-09)

Passive Reader use does not display a row, toast, blinking indicator or repeated
live announcement for normal position saving, queued/submitted synchronization or
idle state, including an ordinary offline queue. The status component keeps its
observation and recovery effects mounted. Local saving, outbox synchronization,
retry rules and position payload/throttling are unchanged.

Real storage/read/sync failures and cross-device conflicts retain their current
explanations and explicit recovery controls. Failed locating of a chosen position
still offers its exact retry. These exceptional notices keep their existing
placement and can affect layout; the quiet policy is for routine autosaves, not
suppression of failures. Explicitly opened sync-center detail (`showIdle`) still
shows normal pending/saved state, but not routine success beside a current
storage/read/action/locate error.

First-content readiness now follows an accepted, rendered current complete-turn
window on an available Reader surface, including genuine empty success. The
scheduled frame checks visit/auth ownership, connected root identity and current
window/generation. A separate target read can therefore finish readiness while
the obsolete initial query remains failed. Exact locating can still fail after
content becomes readable; its navigation error is not hidden by readiness.

Input and position listeners bind/clean up when the actual Reader surface becomes
available/unavailable, independently of the initial query result. Every explicit
non-restore index/message navigation settles the initial saved-position decision
and cancels an older restore. `restorePosition: true` and programmatic scrolling
do not create user intent. The stable real-DOM anchor algorithm, complete-turn
queries and apply-once window protection remain intact.

The [audit and checkpoint](../execution/ux-audit-reader-navigation-readiness-2026-10-09.md)
separate source/static-markup/extracted-code checks from unexecuted browser tests.
Real geometry, paint timing, touch/focus and network persistence remain unverified.

## Reader initial complete-turn recovery (local-only, 2026-10-09)

When detail is available but its first body window fails, **Retry messages /
重试读取正文** retries the existing complete-turn query with its original URL/saved
anchor. Generic localized error/access copy replaces raw transport text. Loading
does not claim an empty conversation; a genuine successful empty result retains
the existing empty state. Offline errors are unchanged.

Retry requires the current visit/authentication and anchor scope, a live idle/error
query, no accepted current window/messages and no in-progress navigation. It joins
the existing read with `cancelRefetch: false`; it does not reopen the conversation,
repeat recent-open, refresh detail or resubmit a mutation. The original five-turn
loader, missing-anchor fallback, query key and enablement remain intact.

An independently accepted target window retires the original initial error/retry.
The unchanged apply-once guard also prevents a late initial result from replacing
that window. Current-scope focus recovery restores only lost/body focus with
`preventScroll`; another chosen control or newer navigation retains ownership.
The [audit](../execution/ux-audit-reader-initial-window-2026-10-09.md) distinguishes
extracted-code checks from unexecuted browser navigation/focus/scroll assertions.
First-paint and position readiness are covered by the separate local behavior
above; the initial-error checkpoint alone did not establish that broader path.

## Reader detail-read recovery (local-only, 2026-10-09)

A temporary remote detail GET failure keeps the matching cached Reader available,
with **Could not update the conversation. Previously loaded content is shown.**
and **Retry conversation / 重试读取对话**. The compact notice is inside the reading
section but outside its header and scroll subtree; it does not replace loaded
messages or add a new layout key. HTTP 401/403/404, a different cached id and known
merged sources do not retain this reading surface on error. Denied/missing and
wrong-id data also cannot provide the document title. The merged destination
action and existing offline error policy are unchanged.

The same localized read retry exists on an initial remote detail error. It refetches
only that detail query, guards the current visit/authentication generation and
ignores duplicate activation while fetching. Explicit retry joins an in-flight
read (`cancelRefetch: false`); this differs from a newer recent summary invalidating
an older detail GET. Recovery does not recreate a visit, reset a loaded turn window
or replay a mutation. After first successful detail, normal initial dependent reads
and the first recent-open POST can still proceed.

When the focused retry disappears, current-owner recovery targets only lost/body
focus. It focuses the existing labelled **Conversation content / 对话正文** region
with `preventScroll`; another chosen control is left alone. A failed retry can
return lost focus to the current retry control. Real focus, retained DOM identity
and scrolling remain unverified; the [audit](../execution/ux-audit-reader-detail-recovery-2026-10-09.md)
separates source/extracted-code checks from browser acceptance.

## Reader recent-open reconciliation (local-only, 2026-10-09)

Opening a loaded conversation reserves one recent-open attempt for that mounted
conversation/data-source visit. Query refreshes, project-context changes and lost
responses do not automatically post another open; leaving and revisiting can.
Unmount, a different owner or authentication-generation changes fence old admission
and publication. This does not cancel or undo an already-sent server request.
Bookkeeping failures remain non-blocking, without a new error dialog or retry UI.

The recent response contains a list summary, not a complete Reader detail. An older
revision leaves cached detail and its freshness timestamp unchanged. A newer one
invalidates only the exact remote detail key for a full GET, superseding an older
in-flight detail read; it never labels old canonical fields with the new revision.
At equal revisions, only a strictly newer valid reading timestamp replaces the
time/progress pair. Rereading may lower progress. Invalid identity/revision, missing
detail and equal-time results cannot manufacture or regress a detail snapshot.

Valid current remote replies independently refresh `conversations`, `projects`
and `recent-items`; failed refreshes do not replay the open. Offline recording uses
its existing local timestamp update without refreshing remote lists. Complete-turn,
reading-position, DOM-anchor, Share and offline-package behavior is unchanged.
Recent's navigation project context is not redefined as canonical membership.
The [audit](../execution/ux-audit-reader-recent-2026-10-09.md) separates synthetic
Query/API evidence from unexecuted browser and real React lifecycle acceptance.

## Single-conversation placement recovery (local-only, 2026-10-09)

**Move to project / 移动到项目** opens a labelled project picker from the existing
conversation menu. **Move to unclassified / 移到未分类** remains a one-click command.
One mounted list/sidebar owns the request and feedback outside the source row;
the sidebar's desktop/mobile copies share one owner and one dialog outside the
cloned sidebar contents. Removing a moved row does not erase its result.

Project reads distinguish loading, failure, no active destinations and no search
match. Failed reads offer an explicit read-only Retry; cached names are contextual,
not actionable. Native radio choices and labelled search retain normal editing
keys. A new picker clears selection; filtering away a target clears it too. Just
before PUT, the target must still be present, active and non-default in the latest
successful, idle project query and match the current search.

The existing placement PUT sends `target_project_id`, `target_section: normal`
and `expected_offline_revision`. A synchronous reservation admits only one request.
Writes/checks use 15-second timeout/abort signals; abort does not undo a server
commit. Unknown results retain **Check current location / 核对当前归属**, a GET only.
The resulting comparison enables **Move again using current state / 按当前状态再次移动**
only as a new explicit decision, using that read's revision. Checks/reopening never
automatically resend; newer checks retire older comparisons and failed reads do
not leave stale retry actions enabled.

GET's null public project summary can mean either Unclassified/default or an
archived project. The comparison says **Unclassified (may belong to an archived
project) / 未分类（也可能属于归档项目）**. It is a current observation, not a receipt
or proof that an earlier request did not commit. The unchanged atomic PUT is the
authority for an explicitly requested move to the internal default project.

A valid acknowledgement publishes only to existing remote Reader/list/project/
recent entries before independently refreshing. It preserves higher revisions,
detail-only data, reading anchors and global pins. Confirmed old-project/history
rows are removed; missing target rows, ordering, relation timestamps and counts
come from GET, not guesses. Same-project no-ops preserve pin/order/revision.
Offline data, Share, bulk actions and DnD remain unchanged.

Closing pending/unknown recovery keeps a page-level review entry without cancelling
the request. Dismissing a check does not undo the server move. Scope/account/unmount
guards fence old actions and late responses; unavailable access hides retained
names. Recovery is local to this owner, not persisted across full navigation/reload
or tabs. A pending write retains its disabled submit button's label and footprint
so Back cannot replace that action. The compact pending body can still resize;
live pending-state guards ignore backdrop clicks and prevent their default blur.
Pointer-down on the retained disabled submit also uses the live pending guard,
without stealing focus from another intentionally selected control. Explicit
Close, Back and Escape remain usable and do not
cancel the server request. Lost/body focus, or focus retained on the newly disabled
submit, returns to Close with `preventScroll`; another chosen control keeps focus.
The [initial audit](../execution/ux-audit-conversation-placement-2026-10-09.md) and
[CI repair](../execution/ux-audit-release-interaction-2026-10-09.md) distinguish
synthetic checks, CI failures and pending browser reacceptance; the subsequent
[mobile repair](../execution/ux-audit-mobile-release-2026-10-09.md) retains the
real double-click, one-write and keyboard-cycle browser assertions.

## Conversation metadata recovery (local-only, 2026-10-09)

Rename conversation / Edit description opens a field-specific draft using the
existing modal/focus system. Titles remain required; descriptions allow clearing,
internal Markdown newlines and at most 500 Unicode code points after trimming.
Long drafts remain intact with inline validation. No-op edits send no PATCH.
Rename writes only title/display_title; description writes only that field.

Save locks repeat submissions and keeps the draft until acknowledged. The Web
helper accepts an optional abort signal; this editor bounds writes/checks to
15 seconds. A timeout cannot cancel or undo a server commit. Unknown responses
retain read-only **Check current value / 核对当前内容**. A match acknowledges the
desired current state without replay. A differing value is shown for comparison;
**Continue editing draft / 保留草稿继续编辑** or **Use current value / 采用当前内容**
is explicit. Keeping the draft alone sends no write. When stored and display titles
differ, both appear in the comparison; a reviewed rename compares the full pair
before becoming a no-op. Untouched initial editors still send nothing. Every new
check retires the old comparison actions, even if the new read also succeeds.
A GET is not a receipt or proof of non-application.

Confirmed metadata updates only existing remote Reader/list/project/recent entries
before detached refresh. Newer cached revisions, unrelated records, project
relations and recent reading anchors are preserved; offline/Share namespaces are
not rewritten. Dirty close confirms; unknown close also explains that discarding
the local draft/check state does not cancel the server save. Stale callbacks after
close, unmount or account change cannot submit or publish. Recovery is not persisted
across full navigation/reload or shared across separate menu instances/tabs.

The [audit](../execution/ux-audit-conversation-metadata-2026-10-09.md) separates
callback/query/API checks from unexecuted browser, focus, IME and visual acceptance.
Same-field metadata concurrency remains last-write-wins; no backend/migration change.

## Merge admission recovery (local-only, 2026-10-09)

Select conversations → set title/order → submit one merge request. The title and
order describe the submitted request and stay read-only while submitting or
unconfirmed. An uncertain response offers **Check merge result**, a read-only
owner-scoped lookup. Failed/incomplete reads preserve uncertainty. Only a confirmed
missing result enables **Resubmit original merge**, with the original key/title/order;
checking/reopening never automatically submits. A found failed/cancelled task is
reported as that same task, not silently restarted.

One unresolved request per account/tab/project scope is retained in sessionStorage,
with in-memory fallback and an explicit storage warning. Reopening retains it;
locking/changing accounts fences late callbacks. Confirmed admission closes the
dialog and announces the outcome before independent task-list refresh; a completed
receipt may link to its merged conversation. Existing source data and the global
Task Center remain authoritative. Receipt lifetime is separate from the
[active-result window](RETENTION_CONTRACT.md).

Both list pages keep one recovery owner outside their loading/empty/error and
selection branches. A retained request shows **Review merge request / 核对原合并**
without selecting anything. Opening restores the original title/order with safe
labels for missing source rows; it does not automatically look up or submit a
merge. The dialog's existing account-capabilities GET may still run on open.
Fresh merges still require two selections. Project 401/403/404 hides retained
project rows and merge UI.
Closing or switching project fences old callbacks immediately, before passive
cleanup; the pending request remains in its original scope.

Manual close targets the recovery entry; confirmed admission targets the result
notice, which also survives empty/error list branches. These are locally tested
focus-target contracts, not observed browser focus. The
[audit](../execution/ux-audit-merge-admission-2026-10-09.md) records exact evidence.
Browser/focus/layout and PostgreSQL concurrency remain unverified; none of this
batch is in passing CI 37812290017.

## Archived-project recovery (local-only, 2026-10-09)

`/archived` retains cached project rows and selection during transient read errors,
with a localized stale-content notice and read-only Retry. Initial/empty-cache
errors are not known emptiness; HTTP 401/403/404 hides cached rows and results.
Confirmed single/bulk restores publish acknowledged canonical metadata to existing
cache entries and announce completion before independent refresh. The result owner
survives loading, error and removal of the final archived row, outside fetch-wide
`aria-busy`. It only restores lost focus, not a later user-chosen focus target.

An unknown restore offers **Check restore result / 核对恢复结果**, which only reads
the full owner-scoped project list. It distinguishes restored, still archived and
unavailable; a failed check keeps uncertainty and prevents blind restore/delete.
Only an explicit action can retry known still-archived projects. Checks may replace
an older background read; unresolved state belongs to this mounted section.

Actionable selection contains only current archived ids. Captured callbacks and
confirmed container deletion recheck the latest rendered scope; changed scope
causes no deletion request and asks the user to review selection. The API already
rejects deleting an active project; this client check avoids a stale request and
does not establish server atomicity. Existing deletion confirmation and conversation-preservation
semantics remain intact. Browser focus/layout and cross-device timing are unverified;
see the [audit and local checks](../execution/ux-audit-archived-project-recovery-2026-10-09.md).

## Project archive feedback (local-only, 2026-10-09)

**Archive project / 归档项目** uses one controller in the sidebar, shared by desktop
and mobile menu copies. Admission is reserved before confirmation; cancellation
sends no write. Confirmation rechecks the latest rendered active/non-default scope
and access. Late confirmation/response callbacks after owner unmount do not submit
or publish, but an already-sent server request is not cancelled or rolled back.

A confirmed archive immediately leaves active project choices and updates an
existing include-archived cache record. The notice stays outside the disappearing
row and fetch-busy list while background reads refresh; it links to `/archived`.
No conversation membership or revision is guessed from cached data. The unchanged
API preserves project relations and returns archived conversations to Unclassified.

An uncertain response retains **Check archive result / 核对归档结果** outside the menu.
This reads the full owner-scoped project list only. Failed checks stay uncertain;
successful checks distinguish archived, active and unavailable. An active result
allows a fresh explicit archive from its menu, with confirmation, never automatic
replay. The state survives closing menus/mobile drawers within this sidebar instance;
it is not persisted across navigation, unmount, reload or tabs. Access denial hides
private notice identity and blocks actions until access/read recovery.

The [audit](../execution/ux-audit-project-archive-feedback-2026-10-09.md) owns the
pre-edit baseline and local checks. Focus restoration is conditional on a lost
opener, not a new user-chosen target; real browser focus/layout remains unverified.

## Sidebar read recovery (local-only, 2026-10-09)

The sidebar's project list, Unclassified list and expanded project conversations
each own their read-only Retry. Transient failures retain current-query rows and
real reading links with a localized stale-content notice. Initial/empty-cache
failures say the read failed; expanded projects show drop guidance only after a
successful empty read. Unknown Unclassified counts use a dash, not a claimed zero.
HTTP 401/403/404 hides the affected cached private rows; it does not clear unrelated
query caches. Archived/default project records remain excluded from the active
sidebar even when present in an existing cache.

Retry repeats only that region's GET with the same sort/scope. Its busy state
does not disable navigation, expand another project, mutate membership or replay
a drag. Existing DnD sensors, placement/revision logic and links are unchanged.
This does not guarantee old rows after a new sort key's terminal read error.
The [audit](../execution/ux-audit-sidebar-read-recovery-2026-10-09.md) separates
static/query evidence from unexecuted browser DOM/focus/drag assertions.

## Conversation undo and read recovery

Project settings saves only normalized fields changed from the opening draft.
Clearing the description is a real metadata update; untouched color/icon defaults
are not written back. The confirmed canonical response updates existing project
cache variants and closes the dialog before follow-up reads. Older pending reads
are cancelled; refresh failure does not turn the completed write into an error.
Dirty-field updates protect unrelated edits, not same-field concurrency.

The project conversation list retains same-project rows/selection during a
transient refresh failure, with a localized Retry that only repeats the read.
An initial error is not an empty project. HTTP 401/403/404 hide cached rows and
bulk actions; sort placeholders never reuse another project's rows. These
project changes are local-only; current verification is in
[the audit](../execution/ux-audit-project-recovery-2026-10-09.md).

Project creation, project settings saves, conversation moves and project reorders
show stable localized recovery copy for duplicate names, permission/not-found,
concurrent-change, rejected-input and transient failures. Raw API/transport
messages are used only for classification, never displayed directly. Failed
settings saves retain the draft; failed optimistic moves/reorders retain the
existing rollback and refresh behavior.

The `/` active-conversation and `/archived` lists also retain cached current-mode
rows/selection through transient read failures, with a read-only Retry and an
explicit stale-content notice. HTTP 401/403/404 still hides cached rows and bulk
controls. Same-mode sort placeholders do not borrow the other mode; a new sort
key's final error may have no retained result. With no cached rows, a read error
is not a confirmed empty list.

The root list requests all active conversations, including those in projects.
When empty, a successful empty saved-conversation check keeps the first-run
import action. Otherwise **No active conversations / 暂无活动对话** links to
**View archive / 查看归档**; it does not claim that records were filed in projects.
A failed secondary check explicitly retries only that read. These local-only
changes and their unexecuted browser coverage are recorded in the
[conversation-list audit](../execution/ux-audit-conversation-list-recovery-2026-10-09.md).

## 项目列表、批量操作与拆分回执 — 2026-10-29 source-only

项目主列表、侧栏项目分支和未分类历史按 100 项连续加载；分页 GET 保留原查询 key，
每页多读一项确定是否有后页，去重只用于显示。项目主列表和未分类列表明确显示已加载
数量／更多状态，侧栏提供追加与失败重试。只选择已加载项；未加载到末页时不提供全局
尾部拖放槽。位置缓存更新、删除进度和元数据刷新同时处理旧数组与分页查询对象。
这不构成跨请求快照或数据库一致性保证。

项目手动排序沿用服务端固定 canonical 顺序；项目 custom 不显示不起作用的升降序设置，
不改变全局排序偏好。主列表仅在完整、当前、未超过 500 项的范围启用整组拖拽；
分页未完成、读取中、失败、项目／排序／方向／读取版本变更会拒绝旧拖拽写入。
超过 500 项需选其他排序，不能通过重复拖动解决。

手机项目页可就地打开共享排序菜单。空项目直接使用现有新建对话和导入流程，并把项目
作为目标；项目信息失败／权限失败不显示可执行入口，恢复读取后再操作。界面沿用纸面
归档台账的浅层分隔、既有语义色与按钮样式，不引入新设计令牌。

批量移动先选目标、展示冻结的数量／名称，再明确确认；目标选择和取消本身不写入。
首次批量移动／归档／恢复分为已确认、明确拒绝、未确认和未开始；当前项目或列表拥有
独立的只读当前状态核对，即使最后一行离开列表也可访问。当前 GET 不是原请求回执，
匹配到归档状态不会自动扩大 Undo 或重放。重新允许选择须由用户完成核对后明确继续。
进度并列展示成功、明确失败、未确认、在途和未开始；“停止后续操作”仅停止新派发，
在途请求照常结算，不撤销已经接收的操作。未知项阻止重复批量操作；核对状态按当前
列表范围及账号隔离，暂存于挂载实例，不承诺刷新／跨标签持久化。

批量导出最多选择 5,000 项。超过上限时不发任务、不静默截断，保留所选内容；同一次
丢响应导出的安全重试键不因一次无效超限选择被替换。

拆分工作区在打开时冻结所选消息；父级清空选择不清除成功结果链接。键盘焦点进入关闭
操作，在弹窗内回绕，Escape 关闭并回到 Reader 原入口。反向连续区间显示错误并禁用预览，
不会将端点暗中交换。网络结果未知时保留计划与相同幂等身份，只提供原计划安全重试；
已确认完成显示一或两个结果链接并禁止再次创建。

以上均为源码实施，具体改动与逐项回归目录见
[2026-10-29 实施记录](../execution/UX_NEXT_BATCH_IMPLEMENTATION_2026-10-29.md)。
回归未运行；浏览器焦点／触摸、提交后丢响应、PostgreSQL 并发与迁移均未验收。
该批新增源码 migration `20261029_0054`，不代表当前生产 schema 已改变。

Archive/restore → Undo keeps one owner outside loading/empty/error list branches.
Only successfully acknowledged initial changes create an Undo. Pending clicks are
guarded; confirmed undo items leave the retry set. A lost/error acknowledgement
offers Check result (GET only), then retries only remaining known-unapplied items;
failed reads keep checking available. Confirmed writes are acknowledged before
list refresh and are not replayed because the refresh fails. Conversation and
project lists share this component; no task, schema or archive-format change is
introduced. Release/verification status belongs to Project State.

Search selection follows document identity within its query/filter scope when
later pages insert earlier result groups. Scope changes or removal clear it;
arrow keys still traverse visual order. Project-filter loading/error feedback
retains an applied scope even when its name cannot be read. Retry reloads projects
without resetting other filters or search history.

Recent reading distinguishes first-load failure from a failed update. Failed
updates retain cached cards and exact saved-position links with a localized
alert/retry; progress bars expose the existing localized Reading progress name.

Batch export: select conversations in a conversation/project list → Export →
Task Center → Download result. Admitted jobs continue after closing or refreshing
the list. Failed admission retains selection and permits same-key retry. Tasks
provides cancellation/retry and temporary ZIP expiry/regeneration. The ZIP keeps
numbered CanJSON entries in the selected order; it is not a backup/Context bundle.

Direct export: select Markdown or CanJSON → Download file → browser download.
While preparing, the button prevents duplicate requests and exposes Cancel.
Failures retain Reader and the selected options with an inline retry action.
Changing format/options or closing the export panel cancels this direct download;
it does not cancel queued Context/archive jobs. Success only reports that the
download was handed to the browser, not that a file was saved to disk.

## Whole-site recovery and mobile flows (2026-10-04)

New conversation, message insertion and project settings retain unsaved input
when closing is cancelled or submission fails. In-flight writes lock editing and
repeat submissions. Project creation, settings, archive and restore work on phones;
saved project symbols/colors appear in navigation and project lists.

Search → optionally expand filters → inspect ordered results → open an explicit
selection. All includes archives; clearing filters keeps the query. Scope changes
reset paging without stealing focus. Failed searches offer retry, and input-method
confirmation/stale matches cannot navigate. Files retain failed rename/removal
input for retry. Export checks resume the same job. One bounded task shortcut opens
all relevant work in Task Center; closing it never cancels a task.

设置中的未保存状态在界面提交阶段同步传到外层退出保护；修改后立即按 Esc
仍须确认放弃。取消确认保留输入并恢复焦点，不依赖下一次后台 effect 或延时。

管理员「用户与访问」中的邀请按需展开创建，当前链接只显示一次，复制失败保留
链接，撤销后立即失效；历史邀请按状态服务端分页。跨用户正文搜索归入用户查看，
点击结果打开完整只读 Reader 并留审计。审计面板按操作/结果筛选，账户及时间范围
渐进展开，记录详情保留已删除账户的历史标识。账户删除完成后的文件清理单独显示
待处理数量，可从任务中心重试，不将已删除账户误报为“资料已保留”。当前合同见
[Administration Contract](ADMINISTRATION_CONTRACT.md)。

设置左侧的 Administration 分组只有在当前账户能力读取成功并确认角色为 ADMIN 后
才显示；能力读取失败或重试期间不把旧角色当作当前事实。能力读取按当前挂载、账户
代次和最新请求隔离，连续重试只保留最新状态，后端仍是最终权限边界。

## 个人数据与备份（工作树，2026-10-02）

个人设置先选择「备份我的数据」或「恢复归档」。备份展示本人资料清单，
可选择是否包含归档内容；任务完成后下载 `.cr`，过期或文件移除后重新生成。
Root 的个人面板仍是本人范围，系统级备份另在管理员专区。

恢复按「上传 → 后台预检 → 核对清单 → 确认新增恢复」进行。预检覆盖全部
内容，清单各显示前 50 项项目/对话；缺失附件明确提示。账户偏好默认不勾选。
恢复新增项目和对话，不覆盖当前资料；同归档再次提交返回既有恢复结果。
用户可关闭或刷新，再从归档记录或 Task Center 的预检入口继续。窗口关闭
与任务取消分离；未上传文件/未确认偏好有丢弃确认，响应丢失重试保持幂等。

个人面板的动作回调与确认归属当前挂载和账户代次；关闭或账户状态改变后，晚到
结果不再发布到任务缓存、刷新或安排焦点，旧移除确认也不继续提交。已经登记的
服务器任务仍保留，重开从历史／任务中心读取。上传限制读取失败在文件旁解释，
明确重试只读取限制，不上传、不生成恢复任务；文件选择保留。重读期间原按钮
保留并禁用，成功后仅在焦点留在原按钮或已丢失时无滚动地回到文件选择。离线则
提示联网读取；已有有效限制可保留。系统面板现在也按挂载与认证代次隔离晚到
回调，延迟移除／切换确认会二次核对，上传限制错误不会伪装成持续加载。

界面分组使用既有阅读工作台 tokens，清单按需展开，确认按钮留在当前滚动
区域底部。上传显示进度与取消，后台任务显示阶段/失败/重试；移除上传文件
只释放临时来源。离线明确提示服务器备份与恢复需要网络，保留资料库已有
离线快照能力，不新增提醒。系统流程见下。

## 系统备份与恢复（工作树，2026-10-02）

Root 的「系统」面板分为备份与恢复。备份列出整个实例的资料、账户身份和配置，
任务完成后下载，过期可重新生成。恢复先上传并后台预检，再核对内容清单与
「来源账户 → 目标账户」。Root 固定关联当前管理员；普通账户可新建，邮箱
冲突与旧 v4 来源需要明确选择。目标账户可搜索/分页，无需手写 UUID。

来源清单支持分页/只看待确认，草稿自动保存，关闭与刷新后仍在。所有页均确认且
实例为空才执行恢复；重复归档返回原结果。新建账户须重设密码。任务中心与本面板
互相进入；上传丢响应可重试，后台任务可取消；失败后可重试或修改归属重新确认。
另一窗口改过归属时要求重新核对。移除上传不会删除已恢复资料。系统归档不是
服务器灾备；离线时暂停新操作，已入队服务器任务继续。

系统面板的上传、备份、恢复、重试和刷新完成后只有当前挂载且认证代次仍有效时
才能更新任务缓存、选择、进度和错误；已经发出的服务器任务不被伪造为取消。
确认框返回后若页面已卸载或账户已切换，移除上传和切换模式不再执行。上传限制
读取失败、离线与读取中分别给出可行动提示，重试只重新读取限制。

## 修改邮箱（工作树，2026-10-01）

普通用户在“账户与安全 → 修改邮箱”输入新邮箱和当前密码，发送验证邮件；界面显示服务器保存的待验证地址及有效期，刷新后仍可查看、重新发送/更换地址或取消申请。管理员只显示部署配置说明。未配置 SMTP 时入口说明不可用，不能仅显示发送成功。

新邮箱中的链接打开确认页，预览不会消费授权；确认前旧邮箱继续有效。必须使用发起申请的同一账户：未登录时可在新标签页登录原账户，再回到确认页重新检查。页面明确显示新地址、到期时间及其他设备会话撤销影响。确认后当前设备保持登录，账户 UUID、内容和离线资料归属不变；其他设备需用新邮箱重新登录。错误/过期/已使用/错误账户链接不产生更换。

表单输入有未保存退出确认；失败保留输入，重发替换旧链接。面板的读取、发送、
取消和资料刷新按当前挂载、账户代次与操作序列隔离，旧账户的晚到结果不会覆盖新账户
状态。取消或收起确认返回后会再次核对当前面板。未知网络／5xx 结果不被说成已明确失败，
也不自动重复提交；先刷新申请状态，再决定是否重发或取消。确认响应丢失时，只有重新
读取的服务器会话同时匹配原 UUID 和预览的新邮箱才显示恢复成功。确认页的重新检查
不并发，预览、确认和恢复读取按当前挂载、账户代次、操作序列及 URL token 隔离；旧
检查或旧账户响应不会覆盖当前状态。链接始终放在 URL fragment，成功后清除 fragment。
没有用户自助注销入口。

## Current account flows (deployed, 2026-09-02)

```text
first deployment -> operator provisions one ADMIN interactively
closed/invite/open registration -> email + strong password -> USER workspace
login -> opaque HttpOnly session -> owner-scoped Reader/Projects/Import
account security -> password/session management -> global revocation on change
ADMIN -> registration mode, invitations, user status and reset grants
```

The migrated legacy archive belongs to the single deployment administrator.
Share links remain token-scoped and Offline remains a local snapshot. These
flows are implemented, API-tested and deployed. Authenticated production
browser verification remains `NOT_VERIFIED` until the operator runs the Web
acceptance flow.

### Registration availability read lifecycle (local repair, 2026-10-14)

The registration page uses one latest-request lifecycle for its setup/session
availability check. A slow initial read cannot replace the result of a newer
explicit retry, and an unmounted page ignores late responses. Closed,
invite-only, open, setup-required and already-authenticated routing semantics,
registration submission and the API contract remain unchanged. This is a local
source repair and has not been runtime-verified or deployed.

### Offline library refresh lifecycle (local repair, 2026-10-14)

The Offline Library serializes local refreshes that read IndexedDB and
initialize the search worker. When several refresh triggers overlap, queued
work is coalesced to the latest request; an older or unmounted request cannot
publish conversations, search state or storage estimates. Download completion,
automatic update, deletion, explicit search retry, offline package formats and
selection semantics remain unchanged. This is a local source repair and has
not been runtime-verified or deployed.

### Reader reading-position visit lifecycle (local repair, 2026-10-14)

Reading-position status is scoped to the current Reader conversation visit.
When the conversation changes, the previous local/server view, conflict,
locating target and read failure are cleared before the new subscription
publishes. Old live-query, conflict-choice and retry callbacks cannot update
the new conversation's status. Routine autosave remains silent in Reader;
explicit sync-center detail, offline storage and server resolution semantics are
unchanged. This is a local source repair and has not been runtime-verified or
deployed.

### Inline attachment preview content lifecycle (local repair, 2026-10-14)

Embedded Markdown, text, code, JSON and table previews clear the previous
content and collapse the preview when a new attachment read begins. During the
Range request and after a failure, the previous attachment's text is not
presented as the current file. The bounded read, cancellation, renderer,
download and full-viewer semantics remain unchanged. This is a local source
repair and has not been runtime-verified or deployed.

### Complex attachment subview lifecycle (local repair, 2026-10-14)

When an Office or ZIP attachment changes, spreadsheet tabs, presentation slides
and archive paths restart from the first valid subview for the current
attachment asset. A replaced asset on the same attachment ID also receives a
fresh subview identity. This resets local view state only; parser, Worker,
download, permission and resource-budget semantics remain unchanged. This is a
local source repair and has not been runtime-verified or deployed.

### Attachment viewer session lifecycle (local repair, 2026-10-14)

Each call that opens the unified attachment viewer receives a fresh local
session boundary. Opening another attachment therefore resets the active item,
transient Raw/rendered or image-overview mode, maximized state and derived media
metrics instead of inheriting the previous viewer shell. The renderer body and
image zoom container also use attachment ID plus asset SHA-256, falling back to
the content URL when no hash is available, so a replaced asset under the same
attachment ID does not retain the previous renderer state. Gallery navigation
within one session remains user-controlled; download, permission, PDF and
resource-budget semantics are unchanged. This is a local source repair and has
not been runtime-verified or deployed.

### Attachment thumbnail asset lifecycle (local repair, 2026-10-14)

Thumbnail and image-overview failure placeholders are scoped to the current
attachment asset, not only its attachment ID or content URL. Replacing an asset
therefore clears the old local failure marker and allows the new image to load
again; the existing near-viewport loading, active-thumbnail loading, retry,
Blob URL release, permission and resource-budget semantics remain unchanged.
This is a local source repair and has not been runtime-verified or deployed.

### Inline attachment asset lifecycle (local repair, 2026-10-15)

Inline attachment runtime failures, gallery image ratios and bounded text
preview state are scoped to attachment identity: attachment ID plus asset
SHA-256, falling back to the content URL when no hash exists. Replacing an
asset at the same inline item no longer retains the previous failure downgrade,
layout ratio or text/expanded state. Existing lazy reads, cancellation,
permissions, cache, viewer opening and resource budgets remain unchanged. This
is a local source repair and has not been runtime-verified or deployed.

### Attachment file-panel refresh lifecycle (local repair, 2026-10-15)

The online conversation-files panel keeps only the active preview/detail
attachment IDs and resolves their display objects from the latest file-list
query. A rename, refresh or external list update therefore updates an open
surface to the current attachment metadata; if an attachment disappears, its
surface closes. Selected IDs are also trimmed to attachments still present in
the current list, so stale selections do not leave inert batch actions.
Offline file-panel behavior, attachment requests, viewer sessions, permissions,
upload protocol and resource budgets are unchanged. This is a local source
repair and has not been runtime-verified or deployed.

### Project-sidebar drag feedback lifecycle (local repair, 2026-10-15)

Project-sidebar drag feedback uses one cancellable timer. A newer move replaces
the prior timer; starting another drag, dismissing the notice or unmounting the
sidebar clears it. This prevents a previous notice from removing a newer
message early. Notice copy, 3.2-second duration, placement, drag mutation,
optimistic update and rollback semantics remain unchanged. This is a local
source repair and has not been runtime-verified or deployed.

## Settings, Tasks and import completion (deployed 2026-09-02)

The global shell footer is named `Settings`. Its lightweight surface owns
appearance/reading preferences and the Offline Library shortcut. A normal user
sees only the personal management categories `Account & security`, `Data
archive` and their own `Skill management`. Import formats and the noise rule
library are system-maintenance controls and are visible only to the Root Admin;
the administrator additionally sees the Administration section. Consequential
or multi-field work opens a focused dialog; dirty password, profile or backup
options cannot be silently discarded, and closing returns through the Settings
hub to the original opener without reloading Reader content.

`Tasks` is a global shell entry for delayed owner work. The existing monitor is
reused for imports, merges, ordered batch deletion, exports and cleanup scans.
Leaving the originating page, refreshing, or switching desktop/mobile
presentation does not change task ownership. Closing the task surface only
dismisses presentation; cancellation keeps the existing per-task semantics.

Local repair (2026-10-14, not deployed): unavailable latest status is distinct
from last-known progress; a failed cached-empty read does not confirm no tasks.
If a task disappears and its final GET fails, explicit Retry rechecks that
result independently of the active list and never resubmits/cancels work. Pending
checks do not modify shared query data; concurrent reads are deduplicated and
obsolete-account/unmounted responses ignored. Recovery records belong to the
mounted monitor in memory, not persistent cross-reload history. Context package
progress failure likewise reports an unconfirmed latest state, not continued work.

Import commit has an explicit terminal state. A batch remains in the Import
surface with committed conversation/message counts, warnings and actions to
view the imported set in Library, open the first conversation, or close and
return to the opener. A single import keeps a direct `Open conversation`
action, but no import silently navigates to the first item.

## Personal/system Skill management (local migration, 2026-10-03)

Settings offers Acquisition, Maintenance and Format conversion. Users upload ZIP
Bundles or UTF-8 Markdown (automatically packaged as a same-name ZIP), replace
files and download the selected revision. Personal preferences require explicit
selection and survive system updates; disabling/deleting a preference falls back
to the available system default. Root manages system replacements independently.
No Skill content/history viewer or multi-file editor is exposed. Offline delivers
the cached built-in Acquisition Bundle; Share never includes personal Skills.
See [Context contract](CONTEXT_PACKAGE_CONTRACT.md) for limits and compatibility.

### Administrator system Skill recovery (local repair, 2026-10-15)

Root administrators may unify a legacy default conflict or restore a customized
bundled Skill from the existing settings surface. A confirmed write is reported
before the related Skill list refresh; a refresh failure keeps the write result
separate and offers only a read-only list reload, never an automatic repeated
write. Permission, conflict, validation, rate-limit, service and unknown-result
states use bounded bilingual recovery copy rather than raw API detail. The
confirmation, Skill content, cache and request contracts are unchanged; browser
and production acceptance for this local repair remain pending.

Each conversation has its own Current/Index workspace beside annotations. Users
read, edit or drop the corresponding file on a tab; dropping a `.context.zip`
updates its members without importing Raw. Updates save directly and retain the
latest three snapshots. Local drafts remain separate from saved files. Context
return is not part of ordinary transcript import or a global Context page.

## Offline Reader and Context Package (2026-08-11)

When the user opens `/library`, an existing complete offline shell is immediately readable. Resource reconciliation runs in the background and may show a non-blocking update failure; it must not disable `Update conversations`. A first-time device may show that the shell is still preparing, but online navigation remains usable.

Inside an offline conversation, `More -> Current conversation files` is available in the same location as the online Reader. The panel is read-only. A cached attachment can be viewed/downloaded through the unified Viewer; a missing original says `offline-unavailable` and does not spin forever. No server file list or management action is requested.

Offline `Export` defaults to `.context.zip`, independently of attachment inclusion; CanJSON/Markdown remain available. It uses the downloaded snapshot and optional cached Current/Index. The result offers the built-in Acquisition ZIP and copies usage instructions in the selected language, without displaying Skill contents. Package download remains available if clipboard access fails. Current/Index can be read offline; updating them requires a connection. If the offline conversation or its initial message window cannot be read, Reader shows stable localized recovery copy pointing back to the library/offline copy instead of exposing a raw local-storage or adapter exception; this adds no request or retry loop.

### Single-conversation offline cleanup sync (local repair, 2026-10-14)

Before deleting one offline conversation copy or clearing only its attachment
cache, the pending-change panel reads, retries and submits only that
conversation's annotation, notebook and reading-position outbox records. It
does not reset retry attempts, errors or backoff state for other conversations.
The account-level sign-out path has no conversation scope and retains its
existing global preference and outbox synchronization. Scoped and global
synchronization requests are serialized per local database; no new polling,
request type or server contract is introduced.

### Offline sync failure guidance (local repair, 2026-10-14)

The Offline & sync center distinguishes transient connectivity failures,
unconfirmed account authorization, server-rejected edits and unknown failures
with stable localized guidance. It states that local edits remain on the
device and directs the user to reconnect, confirm the account or open the
related content for review. Existing conversation links, conflict comparison,
outbox attempts/backoff, automatic synchronization and the single global
retry action remain unchanged; raw transport or API error text is not shown.

### Offline sync-center partial reads (source only, 2026-10-15)

When one local ledger cannot be read, successful sibling sections remain
available instead of the whole tab becoming unavailable. A persistent local
alert names the missing sections and offers `Retry local read`; this only
reopens the local subscription, not synchronization or downloads. Unread/
failed sections do not claim they are empty or reuse another tab/page/mode's
rows. A shared page count waits for all its contributing reads. An initial
task link waits for a successful download-status lookup before reporting that
no local record exists. Cleanup waits for known download status, and combined
pending export waits for its required local reads. Preferences, task actions,
conflict review, stored copies, drafts and background managers are unchanged.
The [report](../execution/ux-audit-sync-center-partial-read-recovery-2026-10-15.md)
records source evidence only; runtime/browser acceptance remains pending.

The [inspection scheduling follow-up](../execution/ux-audit-sync-center-inspection-coalescing-2026-10-15.md)
keeps one active Copies page check plus the latest pending check within a local
subscription, rather than overlapping every progress-triggered scan. It still
uses the real verifier and does not reuse earlier results. Queued work is
retired on read failure/navigation/exit; started work is not actively cancelled.
This source-only scheduling bound is not measured device-resource acceptance.

### Offline conflict merge draft refresh (source only, 2026-10-15)

After a reader edits a manual merge, `Compare again` refreshes the two versions
without replacing the current annotation/notebook draft, including when its
local save failed or is still pending. `Retry saving draft` retries the retained
edit; dirty-state exit protection remains. Explicit `Use local as draft` and
`Use server as draft` choices keep their existing replacement/save behavior.
Changing language translates feedback without re-reading or refocusing the
comparison. Opening a different conflict resets the view and prevents an older
read/save completion from updating that visit. Confirmation, pending-resolution
retry, receipts and stored draft keys remain unchanged. The
[report](../execution/ux-audit-offline-conflict-merge-draft-refresh-2026-10-15.md)
and unexecuted regression are source evidence only, not browser/storage/focus
acceptance or a cross-tab draft reconciliation claim.

### Offline conflict resolution recovery (source only, 2026-10-15)

If saved-request status cannot be read, initially or after a resolution
failure, the review says that status is unconfirmed instead of offering a
fresh choice or assuming a pending request. `Recheck resolution status` reads
the marker and, if needed, comparison versions without submitting or retrying
the write. Once confirmed, an existing non-STALE request exposes the original
`Retry resolution`; no request or STALE exposes comparison. Current merge
memory and dirty protection remain. If the reader switches/exits while
confirmation or processing waits, the older continuation does not start its
next step, update the new view or trigger return. Already-started storage/
network work is not cancelled. The
[report](../execution/ux-audit-offline-conflict-resolution-recovery-2026-10-15.md)
and updated shared regression remain source-only and unexecuted; actual
double-failure, receipt retry, navigation/focus and storage acceptance is open.

### Mermaid rendering fallback (local repair, 2026-10-14)

When a Mermaid block cannot be rendered, Reader shows stable localized guidance
that the diagram is unavailable while preserving the original source for
reading and copying. Parser or dynamic-loading exception text is not shown in
the conversation. Successful rendering, theme and strict security settings,
dynamic loading and the existing performance probe remain unchanged.

### Administrator access error recovery (local repair, 2026-10-14)

The administrator access panel uses stable localized recovery guidance for
connection, authorization, concurrent-change, validation, rate-limit, service
and unknown failures. Server response details are not shown. Existing
permission checks, confirmation dialogs, input state, one-time links and
request semantics remain unchanged.

### Administrator access independent reads (local repair, 2026-10-14)

The administrator access panel reads its overview, user list, invitation list
and current profile independently. Successful sections remain available when
another read fails; previously displayed data is retained and failed sections
show a retry-oriented partial-read message instead of a false empty state. User
mutation controls remain hidden until the current administrator identity is
known. No extra polling or request type is introduced.

### Login authentication read lifecycle (local repair, 2026-10-14)

The login page checks local sign-out cleanup separately from server
authentication setup/session reads. A clear cleanup state causes one setup/session
read; a pending cleanup keeps the recovery surface visible and causes one fresh
read after recovery completes. Redirect, reauthentication, password-reset
availability and login submission semantics remain unchanged.

### Multi-image attachment lazy loading (local repair, 2026-10-14)

In the attachment viewer's image overview, only images near the visible region
enable the existing attachment query; distant entries remain lightweight
numbered placeholders until approached. The horizontal thumbnail strip only
loads the active image unless another item is selected. Online/offline access,
retry, Blob URL release, navigation, zoom and download semantics remain
unchanged.

### Offline library navigation refresh isolation (local repair, 2026-10-14)

The offline library keeps initial conversation selection separate from local
library refresh. Opening or switching a conversation no longer re-reads all
local messages, search documents, annotations and notebooks or rebuilds the
search worker solely because navigation changed. Download completion, deletion
and explicit retry continue to refresh the library; offline package versions,
message-count reconciliation, search content and selection semantics remain
unchanged.

## Reader source workspace and merge cancellation (current)

1. Desktop Reader keeps `Edit`, `Search`, `Annotations`, `Current / Index`, `Focus`, and `More` in that order. Search/annotations/source are mutually exclusive; clicking an open source or annotation action closes it. Share, export, merge, and split remain in `More`.
2. Markdown source opens as a fixed left workspace at 1024px+, covering sidebars while retaining their state. The Reader captures its original main-column edge before opening and yields exactly enough space to keep the main column beyond the workspace. Only the right edge resizes; closing restores the original layout and reading anchor.
3. Smaller widths use a full-width panel. Light/dark CodeMirror themes reconfigure without replacing document, cursor, undo history, or unsaved content. Clean reader scrolling follows through RAF; dirty content locks its message until save/discard/return.
4. A merge copies canonical data in bounded batches. The monitor exposes `取消合并` and `正在取消`; cancellation rolls the target transaction back. Successful publication happens once and leaves sources unchanged.

以下导入与交付入口更新：2026-10-03。

## 1. 导入资料

```text
选择 JSON / JSONL / gzip 或 Markdown
-> Adaptive Import 分析、分组与格式识别 -> 显式确认导入
-> durable job -> worker canonicalize -> 发布 conversation
```

- 分析不写 canonical。使用内置或已学习格式解析；未知结构进入映射学习。具体字段与全 Family 校验遵循 [导入合同](ADAPTIVE_IMPORT_CONTRACT.md)。
- CanJSON v1/v2、受支持的导出 JSON 及 Markdown 可自动识别。任意 ZIP、CSV/TXT 不作为普通对话直接导入；格式不支持时可下载 Normalizer Skill。
- `.cr` 在设置「数据与备份」恢复；旧单对话归档有独立恢复窗口。系统归档从管理员「系统」恢复，仍要求空实例。`.context.zip` 在对应对话的 Current/Index 工作区回传，不导入或替换正文。
- preview 使用 `first_user_message_markdown` 通过系统 Markdown renderer 展示结构；commit 成功后清除旧预览并进入 Reader，队列导入轮询到 committed 后执行同一跳转。Reader 不直接读取 raw artifact。

## 2. 组织与批量管理

```text
Project/未归类/归档列表 -> checkbox/Shift/键盘/移动长按
-> 顶部上下文栏 -> 移动、归档/恢复、导出、合并或删除
```

- 桌面对话可拖入折叠 Project 或拖回未归类区。
- “批量操作”入口在选择模式中保持原位和原宽，并切换为“完成批量操作”；不会因工具栏出现而消失。
- 合并是工具栏一级动作；标题和顺序在脱离工具栏宽度约束的 focused dialog 中确认。删除继续二次确认；部分失败保留失败项选择。
- Project 与 Conversation 使用独立三点菜单；归档保留 Project 关系，取消归档后回到原位置。删除需要显示标题并二次确认，随后立即事务性硬删除，不进入 Trash，也没有 restore；当前 Reader 被归档后进入 `/archived`，被删除后跳到下一个可用对话或安全空状态。

## 附件上传、插入与导出

1. “当前对话文件”或 Markdown 源码编辑器创建上传 session，文件流式写入暂存区并返回 MIME、hash、大小和扫描状态。
2. 当前部署扫描器关闭时显示 `scanner_disabled`；策略允许继续使用不代表文件安全。
3. 文件抽屉提交后成为当前对话 Attachment，可保持未放置，也可从编辑器在光标处或消息末尾插入。
4. 上传完成后先显式提升为当前对话 Attachment；保存消息时以 base version 做并发校验，并在同一事务创建 MessageVersion、Occurrence、RenderBlock。搜索、TOC、统计和摘要在提交后异步重建。删除正文引用不会删除对话级 Attachment。
5. 对话导出可选 Context Package、CanJSON 或 Markdown；Context 始终生成 `.context.zip`，附件独立选择。系统 `.cr v5` 从管理员「系统」备份和恢复，服务端只允许恢复到空实例；个人与旧单对话归档从设置「数据与备份」恢复。
- 源码模式可把真实文件拖到具体文本位置，或粘贴剪贴板图片/文件；文件选择、拖放和粘贴共用上传 session、逐文件进度、取消与重试。上传中/失败项必须处理后才能保存。
- 拖到 fenced code block 时先选择放到代码块之后、仍按普通文本插入或取消；拖到现有 Markdown 链接内部时移到完整链接之后。多文件保持原始顺序并分别生成 occurrence。
- 关闭尚未保存的源码时，已完成上传可保留为“当前对话文件”的未放置附件，也可删除；正在上传的项会取消。源码中手动删除附件语法只影响当前新版本 occurrence，不删除对话级 Attachment。
- 桌面“当前对话文件”默认在 Reader 右上安全区域打开为注释式浮窗；整个表头可拖动，边缘可缩放，位置/尺寸可复位并持久化。表头使用抓手光标和附件专属图标；移动端使用全宽 sheet。该入口管理 Attachment，源码编辑器继续负责 occurrence 编排。
- PDF 查看器的分页、缩放、适合页面/宽度、缩略图和局部失败恢复文案跟随当前界面语言；语言分支只作用于显示和无障碍名称，不改变 PDF.js 的分页、虚拟化、渲染队列或资源预算。
- 统一附件查看器的外壳、图片/文本/JSON/媒体以及文档、表格、演示文稿、压缩包预览状态也跟随当前界面语言；重试、下载和导航名称不暴露 Worker 原始错误，读取与资源策略保持不变。
- 拖拽使用 Pointer/Touch/Keyboard sensors：Project 容器始终按自定义顺序展示，新建 Project 追加到项目区末尾；Project 内和未分类 Conversation 继续使用独立的对话排序偏好。项目排序槽、Project 对话接收区、conversation row/insert slot 与未分类标题行是不同 drop target；打开的 Project 右侧工作区也是明确的当前项目接收区。整行是唯一 dnd-kit 拖拽表面，预览保持源行尺寸且不使用浏览器原生链接拖影；普通点击仍导航。移动成功后保留当前 URL 和滚动上下文。跨项目移动只更新单一关系，移回未归类不删除会话，失败按 revision 同时回滚项目列表、项目对话和侧栏 optimistic cache。侧栏查询刷新保留上一份数据，避免拖拽期间卸载目标；菜单和键盘移动仍是非拖拽替代路径。

## 3. 阅读长对话并恢复位置

```text
conversation + reading position 并行加载
-> 读取包含目标 message 的完整 reader-turn
-> 原子挂载 -> 对齐 120px 阅读线 -> 预取相邻轮次
-> 稳定 1 秒后保存 message/block/offset
```

- 边缘切换捕获真实锚点，轮次完成水合后 prepend/replace，再补偿位置。
- 刷新直接从保存轮次恢复，不先挂载普通 30 条窗口。
- 用户 wheel/touch/pointer/阅读键输入可取消程序导航。

## 4. 搜索、TOC 或批注定位

```text
选择结果 -> 取消旧导航 -> 加载目标完整轮次
-> quote/offset/block/message 解析 -> 等待媒体/布局稳定
-> 复校 -> 继续预取
```

全局搜索、当前对话搜索、对话索引、章节 TOC、最近位置和批注复用同一事务；失败时保留当前正文并允许重试。定位成功后只在精确文字首个可见行显示约 720ms 的短时脉冲；只能退化到 block/message 时显示左侧短标记，不再给整条消息持续填色。搜索自身的精确命中高亮保持独立。

[Reader 导航退出后续](../execution/ux-audit-reader-navigation-retirement-2026-10-15.md)
（2026-10-15，仅源码）将既有导航 token 与 Reader 访问／账户代次保护合并；被新选择、
切换来源／对话、账户变化或卸载取代后，旧读取／lease／对齐／稳定回调及异常返回取消，
不覆盖新定位状态、目录缓存或已确认 locator，也不启动调用者下一阶段。已取得的 lease
仍释放，只有所属 token 清理进行中标记。底部搜索条关闭、返回搜索或被新上下文替换后，
旧上一／下一命中完成不能恢复它；真正切换来源／对话时清理旧搜索高亮、失败／重试目标
和短脉冲，并清理旧来源的批注验证记忆；退出清理递增 token，避免相同 owner 再次激活时
恢复旧导航。面板内存查询／选择仍保留。未主动中止已开始的传输或完整轮次 helper 内部工作，
不改变真实 DOM 锚点和定位预算；回归已编写但未执行，真实调度／几何仍待验收。

共用 Reader 的[导航面板生命周期后续](../execution/ux-audit-reader-navigation-sheet-lifecycle-2026-10-15.md)
（2026-10-15，仅源码）将手机／平板索引和章节选择的等待、结果及自动关闭归属到当前
激活、页签、断点、Reader 访问／账户与最新操作。关闭或切换工具时同步淘汰旧操作，
旧定位不能关掉后来打开的搜索、文件、分享或导出；同批关闭／重开也创建新激活范围，
旧回调不能重新准入。
相同等待目标不重复启动，可选另一目标；取消中性，当前失败保留面板供重新选择，
有限状态文案在渲染时翻译。切换来源／对话、隐藏、源码编辑器、卸载和 effect 重放也隔离
旧反馈。在线／离线查询、预取、真实锚点及保存位置不变，不主动中止已开始的核心定位；
回归未执行，真实面板焦点、播报及调度仍待验收，延迟打开工作区／源码确认的内部流程另计。

当前对话搜索的[选择身份后续](../execution/ux-audit-conversation-search-selection-2026-10-15.md)
（2026-10-15，仅源码）按精确命中而非行号保留明确选择；同一查询重排文档或同文档中的
匹配后仍选中原处。选中项消失时不自动替换，提示重新选择，Enter 不定位；方向键从
当前可见选择继续，缺失时从首行重新选择。查询／角色／类型变化清空明确选择。
点击／触屏激活在导航前通过既有内存面板状态传回命中身份，返回搜索可按身份恢复；
旧数字位置仍兼容。远程／离线查询、结果顺序、重试和真实锚点事务不变。回归已编写但
于 2026-10-16 以 48/48 通过，且定向 ESLint、Web typecheck 和 diff
检查通过；不代表实际键盘、触屏、焦点、滚动或浏览器验收。独立的离线重试和导航
生命周期回归仍未执行。

当前对话搜索的[导航生命周期后续](../execution/ux-audit-conversation-search-navigation-lifecycle-2026-10-15.md)
（2026-10-15，仅源码）只允许当前激活结束等待、报告失败、关闭面板和发布 Reader 搜索
上下文／高亮。改写查询（不等待防抖）、切换角色／类型／来源／对话、关闭／卸载，以及
源码编辑器隐藏桌面搜索，都会隔离旧完成结果。同一等待中命中的重复点击／Enter 不重启
定位，另一命中仍可替代它。等待中显示“正在定位匹配…”，失败保留列表并提示重试或选择
其他结果，取消不报错；不自动重试。此边界不主动取消已经开始的 Reader 加载或滚动，
该面板修复原本不涵盖底部上一／下一搜索结果，现由上述 Reader 导航退出后续隔离其
上下文发布。两批回归均已编写但未执行。

### 手动更新目录

Owner Reader 右上角“更多”提供“更新目录”：

```text
更新目录
  ├─ 对话目录（可独立选择）
  └─ 章节目录（可独立选择）
       ├─ 当前对话（默认）
       └─ 全部对话
```

至少选择一项才能提交。任务进入统一后台队列并显示排队、进度、完成或失败状态；失败不替换当前目录并保留重试入口。完成后只刷新 dialogue-index/TOC 查询缓存，不重新获取整条 Reader、不改变阅读位置，也不提升 Conversation revision。对话目录直接来自当前 canonical 消息；章节目录从 current MessageVersion 的 heading RenderBlock 重建。Share 与 Offline Reader 保持只读，不显示该入口。

## 5. 编辑、版本与会话变换

- 消息信息栏在正文上方提供收藏、选择、源码编辑和版本控件；桌面 hover/键盘聚焦显示，移动端进入底部操作菜单，不覆盖 Markdown 标题。
- 桌面顶栏常驻顺序为“编辑、搜索、批注、专注、更多”，分享、导出、合并和拆分进入“更多”；移动端常驻“导航、编辑、更多”，搜索、批注和专注位于更多面板首组。
- 从长消息当前阅读块打开非模态 CodeMirror 浮动源码工作区后，原正文保持挂载且高度不变。桌面浮窗可拖动、四边缩放、复位并持久化尺寸；移动端使用顶栏下方全宽面板。
- 真实正文滚动在同消息内只调整源码位置；进入下一消息时，干净编辑器自动切换，脏编辑器锁定原消息并显示返回原文、保存后切换和放弃后切换。搜索定位、位置恢复和 Reader 导航等程序化滚动不触发切换；CodeMirror 的方向键、Home/End、空格和编辑输入也不登记为 Reader 滚动意图。源码滚动不反向推动正文，只能显式“在正文中定位”。
- 保存后只局部替换当前消息并重建 blocks/TOC/search/摘要/offline revision，浮窗保持打开；保存前后的真实 DOM 锚点补偿阅读位置。切换其他工作区或专注模式前必须先处理未保存修改。
- 默认保存创建新 MessageVersion；当前为第二版或更高时可显式覆盖当前版本。第一版永久不可覆盖/删除，未保存关闭提供保存、放弃和继续编辑。
- 源码保存、未保存附件关闭和加载最新状态失败时，编辑器按冲突、暂时不可用、消息不存在、内容限制或附件处理失败分类显示稳定的中英文提示；保留源码/附件草稿和可用恢复入口，不直接显示 API、上传或清理层原始异常，也不自动重试或覆盖草稿。
- 左右箭头立即持久化当前单消息版本，刷新和换设备后继续显示；删除当前历史版本时自动回退到较早的最近可用版本，删除/覆盖均保留不含被删正文的审计事件。
- 同一消息的桌面版本控件和移动操作菜单共用一个操作 owner；确认删除前即锁定，确认后重新核对当前 head 和目标。正常操作不显示例行成功通知；只有读取失败、陈旧 head、正文刷新失败或写入结果未知时，在版本详情内显示局部恢复状态，不挤压正文。
- 已确认的版本写入与正文刷新分开处理；正文刷新失败不会要求重发。网络、超时、5xx 等未知结果保留原目标，只能先读取当前消息和版本历史，用户确认当前状态后才可继续，不自动重发。核对结果不匹配时继续按钮保持禁用。
- 历史读取失败不等同于没有历史；当前 head 缺失或历史陈旧时禁用版本写入并提供只读核对。派生搜索／目录任务的状态读取失败保留 job ID、暂停轮询并提供手动核对或任务中心入口。
- Reader 不显示按字符拆分单消息入口；“拆分对话”工作区先展示完整轻量时间线和结果预览，再执行连续区间、边界双份或离散消息复制。三种模式均创建新 conversation，来源保持不变。

## 6. 批注与精选笔记

```text
选中文字/书签消息 -> 类型与颜色 -> 保存 annotation
-> 工作区筛选、定位、批量样式/删除/加入精选
-> 连续阅读或逐条回顾
```

- stale anchor 按 block/message 降级并提示。
- 精选笔记可插入 Markdown、引用批注和排序；移除引用不删除原批注。
- 离线操作进入 outbox，联网后幂等同步；revision 冲突保留副本。

## 7. Share 与导出

- Share 密码页按当前访问及唯一等待中的尝试隔离：快速重复提交只发送一次，旧请求不能在切换或退出后启动旧分享的后续读取、覆盖错误或结束新尝试的等待状态。等待时锁定密码输入，允许编辑后清除旧错误；当前失败保留原密码和有意义的空格，仅当前信息读取成功后清空输入。切换访问或生命周期重放重置密码／等待／错误；不持久化密码、不新增自动重试或取消已发送请求，既有认证、Cookie、限流和本机位置保留策略不变。该批仅源码及未执行回归，真实认证、键盘／密码管理器与慢响应切换仍待验收。
- Share 阅读到上下边缘时，上一页／下一页请求入口、完整轮次的合并、真实 DOM 锚点恢复、错误和等待收尾都绑定当前 token 访问；合并和失败还检查窗口代次与滚动方向。退出后的旧回调不启动请求或加载反馈，迟到请求不再写入已退出阅读器；同次反向滚动不显示旧方向错误；已发传输仍不主动取消，轮次、裁剪、lease 和位置合同不变。2026-10-16 九项实际源码适配回归通过，慢响应、反向滚动、退出和真实锚点浏览器验收仍未执行。
- Reader 源码编辑器在阅读位置移动到另一消息且当前草稿未保存时，导航横幅的“放弃后切换”先取消当前附件上传、删除草稿专属暂存／已完成附件并刷新文件列表，之后才切换消息；清理失败保留当前编辑器并给出有限反馈，快速重复点击不重复清理。关闭并保留文件、保存后切换和正常删除语义不变。该批仅源码及未执行回归，慢上传、真实服务对象回收和焦点仍待验收。
- Reader 源码编辑器的“选择当前对话文件”弹层复用统一 modal 焦点生命周期：打开进入搜索框，Tab/Shift+Tab 在弹层内回绕，Escape 使用原关闭回调，背景层不参与 Tab，关闭后恢复原触发焦点。查询、筛选和附件选择语义不变；该批仅源码及未执行回归，真实键盘、读屏和移动端仍待验收。
- Share 选择 full/selected、expiry、private flags 和 allow export；创建后可复制、更新或撤销。
- 阅读器内已创建分享链接列表读取失败时，在当前面板提供只读重试；已有列表继续显示并明确标为上次结果，未加载过列表则显示初始读取失败。该恢复只重读列表，不自动重试创建、更新或撤销。
- 公开 Share 阅读器首个正文窗口读取失败时保留阅读框架并显示只读重试；网络、超时、限流和服务器错误可重试，永久访问失败不显示无意义的重试。短暂读取失败和密码保护解锁不会清除本机阅读位置。加载和恢复文案跟随分享语言；分享信息尚不可用时跟随访客界面语言。密码页、导航名称和解锁失败提示也不混用语言或暴露底层异常。
- Share 导航和位置恢复按当前 token 访问隔离：新定位、手动输入、切换或退出后，旧定位的后续阶段、异常与高亮计时器不能覆盖当前定位。用户接管或取消后不再继续尝试下一保存锚点；显式目录/索引跳转结束等待中的自动恢复决定。切换 token 后，首个完整轮次窗口等待本次本机位置读取就绪，不沿用旧分享的锚点。已有哈希键、位置字节、锚点及旧服务器可选定位接口兼容不变；已开始的传输不主动中止。该定位/恢复批仅源码及未执行回归；面板反馈另见下一条，存储失败恢复仍未验收。
- Share 本机进度为可选能力：摘要计算拒绝或存储读取失败时，本次访问不使用保存锚点、不写入替代键，但继续现有授权正文读取。后续写入失败在本次同步停用持久化；永久访问失败沿用原分类，先停用所有写入再尝试删除，并清空内存键/锚点，删除被拒绝不声称磁盘记录已消失。停用标记按访问隔离，旧回调和同次初始化重放不再探测，新的访问可重新初始化；不自动重试或在阅读途中恢复旧锚点。原固定高度顶栏以“本机进度无法保存”有限提示反馈，不插入移动正文的横幅，不暴露底层异常；临时失败和密码页仍保留位置，哈希键、位置字节和空闲/卸载保存节奏不变。仅源码及未执行回归，实际拒绝/配额存储、滚动和播报待验收；位置字段保护见下一条，摘要一直挂起仍为独立事项。
- Share 本机进度解析后只验证恢复所必需的结构和有限数值：非空消息字符串、锚点对象、有限像素偏移，以及缺省/空或非负安全整数块索引。不可用记录按无保存锚点读取，不删除/改写原键，也不把仍可用的存储标为失败。有效 v1/v2 位置、可选数值锚点提示和未知附加元数据原样保留，不要求新增模式/时间戳字段、不强制 UUID、不改查询或恢复顺序；后续正常保存/永久错误清理仍沿用现有策略。仅源码及未执行回归，真实浏览器恢复待验收；字段正确但已失效或不在分享范围内的目标仍由既有定位/访问策略处理。
- Share 手机导航面板和平板抽屉的索引/章节选择共用局部等待与失败反馈；同一等待目标不重复启动，不阻止选择另一目标。关闭、重开、切换页签/断点/Share 访问或隐藏后，旧完成不能关闭新面板或覆盖新反馈；只有当前成功定位自动关闭。显式打开以本次内存激活创建新范围，即使同批关闭再重开或布尔值未变，也不复活旧回调或把新选择留在失效范围。取消中性处理，当前失败保留面板供重新选择，有限状态文案随现有翻译在渲染时更新。不改桌面导航，也不把面板关闭等同于主动中止核心定位。该批仅源码及未执行回归，实际面板焦点、播报和滚动仍待验收。
- Share 平板导航在实际可见时复用现有对话框聚焦钩子，面板具有现有翻译的导航名称、modal dialog 语义和备用聚焦点。打开聚焦内部控件，Tab/Shift+Tab 在边界回绕，只有顶层对话框处理 Escape，并通过当前面板关闭处理器退出；关闭清理按现有策略不滚动地恢复焦点，后来打开的对话框继续持有焦点。不改手机/Vaul、桌面导航、视觉尺寸或定位/存储合同；不新增背景 inert 隔离。该批仅源码及未执行回归，真实键盘、读屏、断点切换和阅读位置仍待验收。
- 设置中的「我的分享」集中查询本人的有效、过期和已撤销链接，支持对话/分享标题搜索、仅此对话筛选和服务端分页。跨页保留最多 100 项选择；“选择本页”只覆盖当前页可撤销项，筛选变化清空选择。撤销先确认，逐项显示结果，失败项保留并可重试。列表读取遇到连接错误或 HTTP 408/500/502/503/504 时最多自动重试两次；权限及其他永久错误不自动重试。重试耗尽后，已有列表和选择保留，提示当前显示上次结果并可手动刷新；首次读取最终失败显示明确错误。管理员关闭分享后仍可查询和撤销，公共 Share 的原有策略检查不变。
- 分享编辑在独立详情中调整标题、说明、有效期、密码、整个对话/所选消息和私人内容标记；消息选择同样分页保留。应用前确认访问范围，失败保留输入，离开未保存详情需确认。成功后沿用原链接；移除密码使用现有密码版本和解锁会话失效机制。返回列表恢复焦点与滚动位置；打开来源关闭设置及手机侧栏。分享管理需要联网，离线显示明确状态，不加入离线资料包。
- 分享列表默认显示状态、来源、访问摘要和“复制链接／编辑分享”；打开分享、来源定位、仅此对话和撤销收纳进“更多”。菜单支持方向键、Home/End、Escape 返回触发器；Escape 不穿透关闭设置。进入“批量管理”后才显示复选框、当前页选择与固定底部撤销栏，结束选择会清空本次选择。状态筛选采用带明确选中态的按钮组；空结果提供清除筛选入口。
- 编辑详情按“分享内容／访问权限／链接外观”逐项展开，默认仅展开内容，每组显示当前选择摘要。附加内容默认收起；批注、笔记说明其私人性质。访问方式用“持有链接的人／需要密码”及简短说明呈现，已有密码默认保留，可显式更换；有效期支持永久、从现在起 7/30 天或自定义，未修改的到期时间保留精度。固定底部显示未保存状态和保存操作；错误会展开并聚焦相应字段，修改输入后清除旧错误。手机纵向选择项与桌面并排选择项沿用同一行为。
- 访客只读取 `/api/shared/{token}/*` 授权范围。
- Markdown v2/CanJSON v2 可流式导出；`.cr` 通过后台 job 生成临时 artifact。CanJSON v1 只保留 Legacy 兼容。
- `format=context_package` 通过同一后台 job 生成 `<title>.context.zip`；包含 manifest、canonical JSONL、可选附件对象及已保存的 Current/Index。附件独立选择；完整对话可携带接续文件，部分阅读范围排除它们。Raw 包含批注定位必需的旧版本，完整应用历史和恢复关系仍由 `.cr` 承担。见 [Context 合同](CONTEXT_PACKAGE_CONTRACT.md)。
- `.crbundle` 已从产品导入流程移除；附件通过对话内普通上传或 `.cr` 完整归档恢复进入系统。图片、文本、Markdown、JSON、CSV、代码、原生媒体和 PDF 可在线预览，Office/ZIP 下载降级，Share 再做 token 与消息范围校验。当前不执行附件内容秘密扫描；未扫描状态会保留到 Reader、Share 和导出。
- 对话导出一级选项为 Context Package / CanJSON / Markdown，附件独立选择；二级选项可包含简介、批注、笔记和来源引用，ZIP manifest 记录实际选择。
- 离线导出面板读取当前副本的附件数量时，明确区分读取中、成功数量和暂时无法确认；读取失败保留“生成离线导出”入口，并提供只重读数量的 Retry。该提示不改变附件勾选、导出内容或 v1/v2/v3 离线包读取兼容。
- 当前对话导出只投影 active Attachment；从文件面板 detach 的业务文件不会再次出现在当前 `.canjsonl`、`.context.zip`、`.md` 或 Markdown ZIP 中，历史引用只在系统 `.cr v4` 中保留。隐藏文件名、Unicode、空格、大小写和复合扩展名在可移植 ZIP 中保持。

## 7.1 Markdown 任务清单

1. 在线 Owner Reader 将用户或助手正文中的 GFM `- [ ]` / `- [x]` 渲染为可操作 checkbox；代码围栏内的示例不成为任务。
2. 点击立即给出 optimistic 状态并提交 `message_id + base_version_id + task_key + checked`。当前 v1 创建 v2，当前 v2+ 覆盖该版本；操作不影响后续消息。
3. API 409 或 task key 过期时回滚 checkbox 并提示重新加载，Reader 不刷新整场对话。
4. Share、Offline Reader 和附件 Markdown 预览始终只读，避免访客或派生内容写回 canonical 消息。

## 8. 离线资料库

本地未发布修复（2026-10-14）：更新前的离线资源检查失败时，侧栏明确提示并提供
“重新检查离线资源”，不再一直显示“正在检查”。操作只重做现有完整性检查，不主动
开始下载或移除对话；已有校验仍可丢弃大小不符的缓存响应。切换附件范围或本地资料
变化后，旧检查结果立即失效，成功完成当前检查后才恢复批量更新入口。

本地未发布更新（2026-10-08）：任务中心的离线任务进入同一个“离线与同步”面板，
定位本机下载记录及所在失败页；没有记录时，用户明确点击“下载到此设备”。
打开面板不会自动重试。服务器生成完成与本机下载完成分别表示，取消服务器生成
不冒充本地取消。旧任务缺少范围时保留资料库手动选择入口。当前 33 项 API 专项
通过，浏览器操作验收待完成；详见[离线恢复合同](PWA_OFFLINE_RESILIENCE_CONTRACT.md#task-center-recovery--2026-10-08-worktree-not-deployed)。

```text
首次在线打开 /library -> staging/校验/激活 PWA 壳
-> catalog 与本地 revisions 比对 -> 请求 v3 增量包（none/small/all attachments）
-> 校验并在 Dexie transaction 中导入 -> 离线阅读/搜索
```

- 无变化时显示“离线资料已是最新”；后续 revision 变化可再次自动更新。
- staging、下载或导入失败时保留旧 active shell 和旧数据。
- canonical 管理离线禁用；批注/笔记可离线编辑并同步。
- Dexie v2 保存附件 metadata；清洁小/全部附件保存到 Cache Storage，移除本地会话会同时清理对应 Blob。

## 9. 移动端

- 首页保留继续阅读卡片和 `/recent` 入口；桌面不显示它们。
- Reader 顶栏为返回、标题、导航和更多；工具使用 Bottom Sheet。
- 移动端优先阅读与单项管理，消息操作菜单可打开 Markdown 源码编辑与版本控件；复杂批量和 Project 管理以桌面为主。

注册、登录、发送消息、停止生成、选择模型、会员购买和管理员审核不属于当前流程。
# 2026-08-09 Addendum: Message Organization

1. Select New Conversation, enter a title, project (or unclassified), User text and Assistant text, then submit. Empty bodies are rejected before the request and by the API.
2. Use the plus action between messages to insert before or after the anchor. Single insertion defaults to the opposite role of the adjacent message; pair insertion always creates User then Assistant.
3. Delete uses a confirmation, hides the message optimistically, and offers a short undo. It is a soft delete and does not create a user-visible Trash. Delete/restore responses carry the post-commit conversation revision; restore is idempotent and the undo surface remains actionable on failure. A stale revision returns 409 and leaves the reader unchanged.
4. Opening DOCX/ODT, XLSX/ODS, PPTX/ODP or ZIP uses the existing unified Viewer Shell and lazy browser Worker. The body shows bounded semantic content; parser limits or unsupported legacy formats fall back to an original-file download.

## 2026-08-11 Lifecycle closure

1. Creating a conversation seeds the canonical response and revision before navigation completes. Initial Notebook/recent bootstrap reads do not advance Conversation revision, so the first insert, edit or delete can run without a refresh.
2. Delete is complete when the message disappears and the server returns the new revision. Undo is complete only after restore succeeds, the Reader reconciles the returned canonical message/revision, and refresh still contains the message.
3. Undo 409/500/network failure keeps a localized live error and a retry action. It never silently closes or claims the message was restored.
4. A genuine second-tab 409 preserves the source draft and does not overwrite the other tab. `加载最新状态` fetches the current Conversation revision and MessageVersion base without replacing the editor draft; the user reviews and saves again against that explicit latest base.
5. An active Attachment with zero current-version occurrences remains visible in Files Panel `全部/未引用`. Occurrence removal with keep does not detach the Attachment, and multiple Attachment business identities may share one AssetObject.
6. Files navigation carries Attachment/occurrence/version/block identity. If the exact reference is stale, Reader preserves the current body and exposes exact retry, message-level fallback, and a truthful Files-index refresh that refetches current occurrences; refresh does not claim to repair canonical attachment data.
# Archived project deletion (2026-08-12)

Project deletion is available only from the Archived page. The user archives a project first, then may restore it or permanently delete the project container. A destructive confirmation explains that the project itself cannot be restored but all conversations and messages are kept and return to Unclassified. Batch deletion uses the same contract and retains failed rows as selected.

The API rejects default or active project deletion. On accepted deletion it atomically moves each `ProjectConversation` to the internal default project, clears project pin state, updates recent placement and the conversation offline revision, records a placement event, then deletes only the archived Project row. Conversation, message, attachment and export lifecycle is unchanged.


## Administrator account inspection and deletion (current)

Users & access starts with the searchable, paginated account directory. Open an
account for access actions, password assistance and opt-in content inspection.
Conversation links open the complete-turn read-only Reader in a separate tab,
retaining the directory position. Search navigates to a real message; attachment
viewing/download uses audited Root routes. Delete opens a separate impact page;
confirm locks the account and queues work. Failed tasks retain canonical data
and can be retried from the account or Task Center. Successful completion removes
the row. See [Administration](ADMINISTRATION_CONTRACT.md).
