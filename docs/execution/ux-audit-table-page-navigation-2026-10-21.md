# UX quick review — 大表首尾导航

2026-10-21；先记录发现与设计约束，再增加定向浏览器回归和实现。

## 范围与证据

仅审查现有源码表格工具的分页导航和末页编辑，面向整理长篇技术 Markdown 的
混合熟练度用户。Web、桌面及窄屏触摸；不改变 Reader 导航、服务器数据或表格
规范化语义。当前证据是实际源码与由该源码计算的分页次数，浏览器结果随后追加。
[源码摘录](ux-audit-table-page-navigation-2026-10-21-evidence/baseline-source.txt)与
[摘要/计算](ux-audit-table-page-navigation-2026-10-21-evidence/baseline.json)相邻保存。
不作完整无障碍、跨浏览器、真机键盘、全应用或服务器资源验收。

## 最重要的结论

有界预览是必要且应保留的取舍，但当前只有上一页/下一页，放大了大表的导航成本。
10×4,000 表格每页 11 行，共 364 页；从首到尾需要 363 次“下一页”。
200×248 表格每页一行，也需要 247 次。手改 Markdown 能绕过，但不是在网格中
核对末尾内容的替代方式。补两个边界导航即可，不需要新模式、页码输入或整表挂载。

## 发现与快速改进

| ID | 类型/维度 | 严重度 | 置信度 | 估算 |
| --- | --- | --- | --- | --- |
| NAV-04 | 大数据量导航缺陷 | Medium | Observed（code + calculated）；实际操作暂为 Inferred | S |

**位置：** `apps/web/features/editing/markdown-table-dialog.tsx:107–116` 的分页
计算和 `:353–357` 的两个逐页按钮。

**证据与影响：** 相邻行可以顺利编辑，但用户要查看远端行时，须沿所有中间页
反复点击，或者在原始 Markdown 中搜索后放弃网格定位。这里不声称观察了真实用户
流失，也不将它描述为数据丢失或完全不可达。

**建议：** 同一行保留行范围、上一页、下一页，增加“首批表格行/末批表格行”
两个带边界的箭头。英文无障碍名为 `First table rows` / `Last table rows`。
按钮只切换预览页；不增删内容、不改变 Markdown、不保存、不自动聚焦某个单元格。
处于对应边界时禁用；单页时整个分页条仍不出现。
四个方向按钮均维持 44px 热区，使用既有 `--focus`，不能依赖 hover 才可用。

## 界面工作简报

- **人物/Intent：** 正在校对对话中长表格的读者，需要快速核对首尾并继续编辑，
  保持安静、可撤销的阅读工作台感。
- **Domain：** 阅读轮次、原文、表格行、规范化、草稿、版本撤销。
- **Palette/Color world：** 纸面 `bg-page`、抬升纸面 `bg-raised`、石墨
  `text-primary`、淡墨 `text-secondary`、海绿色 `--focus`。不新增色值。
- **Signature：** 现有“源码→规范草稿”镜像关系：工具标题、可编辑预览、真实行范围、
  下方 Markdown 和显式 Apply/Undo 保持同一份内容，不制造另一套表格数据。
- **Depth/Surfaces：** 保留现有边界与细微面色，只有全局弹层使用原阴影；分页不另加卡片。
- **Typography/Spacing：** 原字体与 `text-xs` 元数据，4px 基准间距、44px 点击区；
  范围数值不换行，按钮不挤缩；在 320/375px 和桌面验证。
- **拒绝默认扩张：** 长页码条→两个首尾按钮；新增数字输入→原行范围；
  放开分页上限→继续有界挂载。没有新的工具栏或帮助段落。

## 顺序、保留项与开放问题

1. 实际 Chrome 证明大表缺少直接首尾入口，保留失败。
2. 沿用现有分页状态及图标库，只补首尾跳转和明确焦点样式。
3. 验证末页修改、首尾往返、Apply/Undo，以及窄屏触摸、单页和模型缩小。
4. 性能观察增加末页编辑，并区分网格输入、源码输入和 GC 阶段。

保留四边 `+`、单模式、可编辑 Markdown、全部源数据和原分页预算。
此前 profile 的长任务观察器覆盖了后续源码输入及 GC；不能将其计数全部归为
“网格输入长任务”。后续按阶段测量，但不回写旧观测数字或宣称已找出唯一瓶颈。
暂无真实设备/真实用户使用频率数据，不能据此推断总体留存或服务器 OOM。
目标继续活动；仅本地，不推送、不启动 CI、不部署。

## 首轮实现发现的焦点缺口（修复前记录）

新增首尾控件的第一轮 Chrome 验证，在到达末页后失败：用户键盘激活的“末批”
按钮变为 disabled，`document.activeElement` 变成 `BODY`，不在工具内。
该结果不是上文原始无入口基线；它属于本次首轮实现，分别保留
[焦点观察](ux-audit-table-page-navigation-2026-10-21-evidence/intermediate-page-navigation-keyboard.json)、
[失败输出](ux-audit-table-page-navigation-2026-10-21-evidence/intermediate-browser.txt)、
[当时源码摘要](ux-audit-table-page-navigation-2026-10-21-evidence/intermediate.json)。

| ID | 类型/维度 | 严重度 | 置信度 | 估算 |
| --- | --- | --- | --- | --- |
| NAV-05 | 分页边界的键盘焦点丢失 | Medium | Observed（mounted Chrome） | S |

**位置：** 首轮 `markdown-table-dialog.tsx` 分页按钮的 `setPage`/`disabled`
组合。**影响：** 用户已到目标位置，但接着按键不再作用于分页，必须重新进入工具
的焦点顺序；不声称此处已经绕过共享焦点陷阱或丢失内容。
**建议：** 只在主动分页且焦点确实属于分页条时请求修复；原按钮禁用后，边界处
将焦点保留在相邻可用的上一页/下一页。原焦点仍有效或用户已另选控件时不移动，
不要自动进入数据单元格。共用这一行为覆盖四个分页动作。

## 实施与最终复查

保留原分页状态、预算、行范围、草稿和应用路径，仅增加两个边界箭头和统一的
`changePage`。一次主动翻页时记录焦点是否属于分页条；布局提交后，只有原控件
已失效且用户尚未另选控件，才聚焦当前边界的上一页/下一页。不会因富预览稍后
追赶再抢焦点。按钮保留可见焦点环及无障碍名称，不添加模式或长说明。

| 发现 | 最终状态 | 复查证据 |
| --- | --- | --- |
| NAV-04 | 已修复；实际 Chrome 从无首尾控件到可一键直达；普通逐页行为保留 | [基线](ux-audit-table-page-navigation-2026-10-21-evidence/baseline-result.json)、[最终范围/挂载](ux-audit-table-page-navigation-2026-10-21-evidence/page-navigation-entry.json) |
| NAV-05 | 已修复；末页后焦点为可用的 Previous，回首页后为 Next，不进入单元格 | [实际焦点](ux-audit-table-page-navigation-2026-10-21-evidence/page-navigation-keyboard.json) |

10×4,000 表格的直达末页操作由逐页 363 次变为一次；这只是界面动作数，不是
用户研究或耗时收益。新浏览器场景验证首尾往返不改 Markdown，末行的管道/emoji
只改变对应单元格，前后正文保留；原始 Markdown 缩成单页时页码安全收敛。
真实源码工作区另在 320/375px 触摸上下文验证末行编辑、Apply、一次 Undo，
没有 API 写入。四个按钮均为 44×44、在视口内且中心命中；320px 行范围正常换行，
没有页面横向溢出。[触摸几何/结果](ux-audit-table-page-navigation-2026-10-21-evidence/page-navigation-mobile.json)。
这不是物理触屏设备、屏幕阅读器或完整应用验收。

最终截图已经逐张核对：
[桌面首批](ux-audit-table-page-navigation-2026-10-21-evidence/page-navigation-first-desktop-light.png)、
[桌面末批](ux-audit-table-page-navigation-2026-10-21-evidence/page-navigation-last-desktop-light.png)、
[320px](ux-audit-table-page-navigation-2026-10-21-evidence/page-navigation-last-mobile-320-zh.png)、
[375px](ux-audit-table-page-navigation-2026-10-21-evidence/page-navigation-last-mobile-375-zh.png)。

## 分段性能观察

[最终 profile](ux-audit-table-page-navigation-2026-10-21-evidence/final-performance.json)
与本轮 20 个源码/测试摘要绑定。Windows、Chrome 155.0.8059.82、未节流 headless、
实际工作区、合成普通单元格；每个已执行的位置五次按键，下面是中位数。
“更新帧/就绪”分别指 Markdown 更新后的下一动画帧、预览不再 busy 后的下一帧；
不是物理显示器绘制或 INP，也没有硬件相关通过阈值。

| 表格 | 首行更新帧/就绪 ms | 末行更新帧/就绪 ms | 源码 DOM 值帧/新表头帧 ms |
| --- | --- | --- | --- |
| 12×80 | 17.8 / 51.3 | 13.3 / 41.2 | 未执行 |
| 10×4,000 | 61.9 / 91.0 | 62.8 / 84.3 | 29.4 / 54.4 |
| 200×248 | 47.2 / 84.7 | 55.6 / 93.7 | 23.6 / 83.6 |

完整 `longTasksMs` 仍保留为全程观察；新 `longTasksByPhaseMs` 按任务
`startTime` 归到首行网格、源码、末行、导航或最终 GC，不按延后送达的 observer
回调时间归类。源码段包含插入及恢复用 Backspace。最终大窄表仍有首行 51ms、
末行 54ms 长任务；不能宣称已消除卡顿。各工作负载的最终挂载数在不同页采样，
例如窄表首批 120、末批 80，不是悄悄放宽/降低源数据上限。
显式 GC 后 heap 跨越所有阶段、位置及编辑，不能与旧较小工作负载直接作泄漏
或优化结论，更不能替代服务端 RSS/OOM 验收。

旧观察把整段长任务错误称为仅网格输入，已经在
[自适应记录](TABLE_TOOL_ADAPTIVE_PREVIEW_2026-10-20.md)更正列名及解释，
不改动历史数字、原始文件或其门禁。新分段数据不能补推旧任务的来源。

## 门禁、交付边界与仍未验证项

最终串行运行全部六项本地门禁：

- 111/111 专项；69 文件/1,502 项无服务回归，无失败或跳过。
- 67/67 Chrome 场景，页面/控制台错误均为空。
- Web lint、非增量 typecheck、单 CPU/non-standalone build 均退出 0。
- 20 个源码/测试摘要在门禁前后不变；HEAD 保持 `50f6de4`。

[回执](ux-audit-table-page-navigation-2026-10-21-evidence/final-gate-receipts.json)、
[源绑定](ux-audit-table-page-navigation-2026-10-21-evidence/final-source-sha256-after.json)、
[浏览器结果](ux-audit-table-page-navigation-2026-10-21-evidence/final-browser-result.json)、
[30 份制品清单](../evidence/table-tool-page-navigation-2026-10-21.json)均相邻持久化。
原始两次失败均在前 12 个场景通过后停止，不能把后续未运行项算作基线通过。
基线日志明确只是有界摘录；最终日志和各门禁输出单独保存。

无 API、数据库、migration、依赖、全局缓存或生产配置变更。浏览器使用实际
工作区/CodeMirror/Renderer，但 API、Next 动态加载及无关富视图依赖保留显式测试
适配器；不是登录服务器、Reader/Share/Offline/PWA、跨浏览器或长期资源验收。
当前仍有大表主线程长任务，真实辅助技术和物理设备未验证。
仅本地；不推送、不启动 CI、不部署。持续目标仍活动，不把本次局部通过当作
全部优化目标已经结束。
