# ChatGPT 正文阅读兼容审查 — 2026-10-25

> 历史检查点：本文的“2 项实施/18 项暂缓”和回执只对应最初审查。
> 用户随后要求完成剩余工作；当前处置与验证见
> [独立续办记录](CHATGPT_READING_REMAINING_2026-10-25.md)，不覆盖下文原始结论。

## 范围、证据与结论

接续用户最新的“找二十个优化点、建议实施数量、具体建议和实施”请求，
并遵守其随后明确的“只需要阅读”。不是重启已经结束的无限优化。
对象是 Web 阅读产品，用户包含普通读者和需要保真源码的技术读者。
本次检查导入→canonical→共享 Markdown 阅读链，不重做交互工具或视觉品牌。
基线为 `dbfe79e`；已有 `apps/web/tsconfig.tsbuildinfo` 改动不属于本任务。

证据：当前代码、已有测试、同日上一任务的官方页面浏览记录和本轮内置浏览器
官方文档复核。没有 Web Search。没有读取或保存用户对话、导入文件、
Share token、Cookie、凭据。没有登录 ChatGPT 获取私人答案，没有生产 UI 验收。
下表中的“代码观察”不是浏览器现象，“条件机会”不宣称已发生故障。
可访问性及“所有 GPT 正文完全兼容”均不作认证。

**最终建议本轮实施 2/20 项，现已完成；其余 18 项有条件暂缓。**
这 20 项是有取舍的优化候选，不是 20 个已经发生的用户故障。
四项不可达遗留分支调查另列撤回记录，**不计入这 20 项**。
最初对遗留 official normalizer 的检查曾建议六项；沿入口追踪后，
`source_detector.py:81–83` 以及现有 API 测试证实官方对话图输入已明确拒绝。
不能把只调用遗留 helper 的通过测试当作当前用户收益。四项 API 试改、
专用试验测试及 import parser 版本变更全部撤回；不重新开放官方导入。
真正保留的是：富文本恢复不能只验证第一段就改写其余段落。
现有表格、公式、代码、脚注、摘要折叠和附件查看已经可用，应继续复用。
两项共用现有显示投影，不新增组件系统、数据库字段或运行时。
保留原始资料；本次最终实现不改变任何导入规则或已有会话。

## GPT 正文调查及适配边界

上一任务于 **2026-10-25 11:42–11:58 +08:00** 通过内置浏览器实际读取
OpenAI 的 ChatGPT release notes：正文能力已涉及普通文字、写作框、交互代码、
图表，以及 2026-10-07 介绍的 Intelligent UI 比较/图示/小工具。
这是恢复出的同日公开资料证据，不冒充本任务重新登录操作的证据。
本轮重新读取 ChatGPT Learn 的 Features、What's new 和开发者 ChatKit widgets：
公开 UI 能力说明 **不等于** 官方导出 JSON 或第三方导出 Markdown 的完整协议。
尤其不能把 ChatKit 的 Card/Box/Text 节点直接认定为 ChatGPT 导出合同。

本轮官方复核入口：

- `https://learn.chatgpt.com/docs/features`
- `https://learn.chatgpt.com/docs/whats-new`
- `https://developers.openai.com/api/docs/guides/chatkit-widgets`

| 正文类别 | 本项目阅读策略 |
| --- | --- |
| 段落、标题、列表、引用、表格、公式、脚注 | 沿用共享 Markdown/GFM/KaTeX，不换渲染器 |
| 代码 | 复用已导出 Markdown 中的代码围栏；本轮不开放官方 JSON code 路径 |
| 文字与图片混合 | 沿用标准化 Markdown/附件输入；官方对话图仍拒绝，不能称为已支持混合 parts |
| 写作框 | 已导出的 Markdown 正文正常阅读；框的私有协议/外部文档正文不能臆造 |
| 已有 box/row/text/badge/divider 样本 | 安全的显示投影保留文字、顺序和分隔，不追求像素级还原 |
| 交互图表、计算器、游戏、插件 | 不执行脚本；只有实际导出的静态数据/结果才有后续适配依据 |
| 图片、文件、音频、视频 | 继续沿用已有附件策略；指针不等于文件，不能制造可用链接 |
| 搜索引用、卡片实体 | 仅有不透明引用标记时不能生成来源；需匹配的导出元数据才能进一步还原 |

“完全适配”在本项目应解释为：**支持的、实际存在的内容不无声丢失；
不能解析的内容有明确降级；源码和权限边界不受破坏。**
不意味着还原未导出的内容、联网重放工具或兼容未来所有私有语法。

## 20 项优化候选及处置

先记录审查再修改；下表补入了续查证据和最终处置。位置按本轮最终源码，
仅 COPY-01/TRUST-02 的提前返回描述指向基线 `dbfe79e`。
`C` = `apps/web/features/rich-markdown/chatgpt-rich-text-compatibility.ts`；
`R` = `apps/web/features/conversations/markdown-renderer.tsx`。
H/M/L 是高/中/低影响；S/M/L 是小/中/大工作量。条件机会的影响是
**取得样本并确认问题后**的预估，不是现存缺陷评级。
“Observed”均标明代码/合成测量；用户发生频率及未实测的辅助技术行为不作推定。

| 编号 / 维度 | 问题或机会；证据和用户影响 | 建议 / 验收 | 级别；置信度；工作量；本轮处置 |
| --- | --- | --- | --- |
| COPY-01 多段转义 | 基线 C 的检测在第一段平衡 box 就返回；raw→escaped 合成输入未恢复后段标题/强调 | 完整扫描候选并聚合转义；交换顺序结果一致，纯 raw 中刻意转义仍保持字面 | M；Observed（隔离基线/当前对比及 Chrome）；S；**已实施** |
| TRUST-02 部分结构恢复 | 基线提前授权，但投影遍历全部已扫描标签；首段合法、后段已识别但未闭合/错配/超深时发生部分转换 | 全部已识别候选验证结束后才返回 profile；四类负例均保留整段输入，不扩大 HTML 识别范围 | M；Observed（隔离基线/当前对比及 Chrome）；S；**已实施** |
| COPY-02 写作框标题/正文边界 | C:12–13 只识别五个标签；公开功能有写作表面，但没有当前受支持导出的 writing 专项样本 | 样本若含独立标题/正文，保留两者顺序及普通 Markdown；验收空标题、重复标题和多段正文，不复制工具栏 | 条件 M；Hypothesis（代码边界＋公开能力，非格式协议）；M；暂缓 |
| DATA-04 搜索引用可追溯 | R:579–586 从文本只生成 text/reasoning；普通链接/脚注可用，不能据 source 类型声明就宣称私有引用已接通 | 有受支持样本的标记及来源后，复用安全链接/脚注；未知引用保留可见标记，不编造 URL 或仅删标记 | 条件 M；Hypothesis（可达文本链＋公开能力）；M；暂缓 |
| DATA-05 图表静态数值表 | `rich-markdown-config.ts:19–42` 无 series/labels 适配；普通 GFM 表格已有成熟共享呈现 | 只有样本实际含序列、标签、单位时转换为只读数据表，覆盖空值/精度/顺序；不从截图猜数值 | 条件 M；Hypothesis（配置＋公开图表能力）；M；暂缓 |
| DATA-06 附件指针的可用性说明 | R 的 file/image 类型不代表文本输入已解析私有指针；正文链接不能证明对应原文件存在 | 对取得的导出样本核对附件清单：有文件才接现有摄取；缺文件明确“未导出附件”，不生成假链接 | 条件 M；Hypothesis（R:579–624 的文本入口）；L；暂缓 |
| DATA-07 转写的只读时间线 | R:579–586 没有转写字段入口；已有音视频附件可播放不等于有可搜索转写 | 取得实际 transcript 后保留说话顺序、时间和原文，允许仅文字阅读；无 transcript 不启动自动转录 | 条件 M；Hypothesis（文本入口＋公开音视频能力）；M；暂缓 |
| DATA-08 工具结果与工具指令分离 | R:579–586 未从正文提取私有 execution_output；不能把 tool 组件类型当成支持的导入协议 | 取得样本后仅提取明确可见的输出为代码/文字/表格；命令只展示不执行，测试输出为空和错误结果 | 条件 M；Hypothesis（文本入口＋公开工具能力）；M；暂缓 |
| COPY-03 未知 HTML 的纯文本降级 | C 保持未知容器源文；已安装 ReactMarkdown 的 `skipHtml` 对合成未知 HTML 块连同内部文字输出为空，源码未丢失 | 先以真实受支持样本确认需要，再设计有界可见文字降级及代码例外；不打开 raw HTML，不宣称已修复 | M；Observed（合成已安装解析器；非完整组件/用户故障）；M；暂缓 |
| DATA-09 嵌套代码样例保护 | C:162 的 fence 仅识别行首；已建立 raw profile 后，**未闭合的引用内 fence** 中 box 被投影移除；闭合引用是通过的对照 | 用既有 Markdown 解析语义提供 literal range，补 quote/list/未闭合矩阵；不要再扩一套手写 fence 解析器 | M；Observed（合成投影）；M；暂缓，独立解析边界专项 |
| DATA-10 超预算正文的有界恢复 | C:11、17、59、96 的预算耗尽会保留输入，故未恢复标签仍可能不可读；此安全边界不能直接删除 | 真实长样本触发后评估按稳定 canonical 段落做有界只读恢复，保留全局合法性/代码保护及原文；不只提高阈值 | 条件 M；Observed（代码预算），频率未知；L；暂缓 |
| PLAT-01 长正文解析开销 | R:513 按挂载输入投影/解析；历史[大表测量](TABLE_TOOL_PERFORMANCE_2026-10-20.md)仍有 long task，不是本轮新性能结论 | 固定原文、设备和操作测 parse/paint/长任务，再选择减少重复解析；不能以有虚拟化就宣称解析已无成本 | M；Observed（历史测量，本轮未复测）；M；条件性能专项 |
| DATA-11 历史内容的选择性恢复审阅 | 当前 renderer 只消费已有 canonical 文本（R:397–398、579–586）；改显示层能惠及旧文本，**不能恢复 canonical 中本来没有的正文** | 若真实受影响数据及用户原始来源均存在，设计版本化重导入前的逐消息差异/用户选择；无来源不恢复，不自动覆盖 | 条件 M；Inferred（canonical 边界，未发现/读取用户缺失实例）；L；暂缓 |
| COPY-04 显示兼容状态透明度 | C 的 profile 只有 escapedMarkdown；显示转换没有供读者解释“为什么与源码不同”的状态；未证明用户已困惑 | 有反馈后在已有源码预览中按需展示“仅显示转换、原文未变”及识别模式；不加每条常驻告警，不与导入 warnings 混淆 | L；Observed（代码接口），用户影响 Inferred；M；暂缓 |
| PLAT-02 三条真实阅读链的共用 fixture | 已有 Node/源码/隔离 Chrome 不能证明本批在认证 Reader、Share、离线冷启动及真实 DOM 锚点上一致 | 复用本批同一合成正文，补全真实 API→三链、完整轮次、位置恢复和离线包兼容矩阵；不把组件测试改名为 E2E | M；Observed（本批测试边界）；L；后续认证专项 |
| TRUST-03 交互产物的静态阅读替代 | R:579–586 的文本入口和 C 的五标签边界不承载 widget runtime；公开交互能力可能只导出独立静态产物 | 样本若含已导出的图片/PDF/文字快照，按已有附件策略呈现并注明非交互版；不得联网重放、运行脚本或猜缺失状态 | 条件 M；Hypothesis（代码边界＋公开交互能力），非现有漏洞；M；暂缓 |
| DATA-12 支持格式的正文类型校验 | 当前 `exporter_json_parser.py:78` 对 say 强制 str；合成对象被 detector 接受，呈现 Python 对象表示且无警告；`adaptive_import/profiles.py:105–117,187–193` 证实该路径可达 | 明确 say 必须是字符串或给结构化告警/拒绝策略；覆盖 object/list/0/false/null，先决定旧格式兼容，不在 renderer 小修中改导入合同 | M；Observed（当前 detector/parser 合成调用，非 HTTP）；M；暂缓 |
| COPY-05 导入提示被静默截短 | 当前挂载的 `import-panel.tsx:435,483–511` 完成区只显示 warnings.slice(0,4)，该区无余量计数/展开 | 增加“另有 n 条提示”及按需完整列表，五条以上合成警告均可到达；不记录真实警告内容 | M；Observed（当前代码），界面影响 Inferred；S；后续小批次 |
| COPY-06 映射确认缺少实际阅读预览 | `mapping-workspace.tsx:73,135–140` 当前 CanonicalPreviewPane 仅四行纯文本截览，不能据此确认表格/公式/富正文显示 | 复用共享 renderer 提供可切换的只读渲染/源码预览，保留准确源文和有界样本；不改映射写入，不自动展开长正文 | M；Observed（当前代码），用户影响 Inferred；M；后续产品确认 |
| A11Y-01 图示的文字替代 | R:873–875 隐藏 Mermaid header，成功分支 R:1074–1079 只有 `alt="Mermaid diagram"`；错误分支有源码，成功分支无同区文字详情 | 有源 accTitle/accDescr 时安全呈现，或提供按需源码/说明；不自动编造图意。关注 1.1.1 Non-text Content（A） | M；代码事实 Observed，辅助技术影响 **Inferred**（未运行读屏）；M；后续可访问性专项 |

### 撤回调查（不计入 20 项）

原 DATA-01（混合 parts）、DATA-02（official code）、TRUST-01（未知对象）
和 DATA-03（official text 空白）均在 `official_normalizer.py` 的遗留官方图路径。
`source_detector.py:81–83` 和 API 回归确认当前标准化入口拒绝该格式。
相关四项试改、试验测试及 import parser 版本 bump 已全部撤回；不报告为
已修复的用户问题，也不把它们留在优化候选中凑数。DATA-12 是另一个当前
**受支持且可达**的 exporter say 类型问题，不是把已撤回的 official 问题重新计数。

## 实施优先级及快速收益

1. COPY-01：同一输入中前段 raw、后段 escaped 的合法富文本都参与识别。
2. TRUST-02：对所有识别到的 box 完成检查后返回，不跳过后续畸形/超深结构。

以上复用一个既有兼容模块及其测试，显示策略版本提升为 v6。
新增四项 Node 回归和两项 Chrome 场景。随后以隔离 HEAD blob 与当前文件的
同输入控制对比验证：七项预期基线仅符合 2 项，当前符合 7 项；源码不替换。
这不是“全部测试先红后绿”的时间顺序声明，早先重叠试验日志不当作干净基线。
接口结构、DB、Share URL、`.cr`、离线包 v1/v2/v3 和 Dexie 不变。
Reader/Share/Offline 共同消费现有 canonical 文本和显示投影，不做三套实现。

为什么不是顺手全改：另 18 项涉及真实导出样本、导入类型/旧数据兼容、
解析器上下文、产品交互或认证测试环境；并非两处显示层修复的必要前置。
其中 DATA-09、DATA-12 和 COPY-05 已有具体证据，值得下一次有界排期，
不是已解决项；COPY-02、DATA-04～08、TRUST-03 则需先有样本再决定立项。
不启动旧无限优化池，也不把“暂缓”变成后台持续执行授权。

## 保持不动

- 不更换 Markdown、表格、KaTeX、脚注和附件组件；保留既有局部 overflow。
- 不添加卡片皮肤、全屏编辑器或 ChatGPT 同款工具栏：只阅读的收益不足。
- 不自动清理噪声、删除思考摘要、修改历史版本、批量重导入。
- 不加载远程图片或执行 HTML/JS/插件动作来追求“完全还原”。
- 审查阶段不修改生产、不推送、不启动 CI；是否发布需要新的明确授权。
  本批随后已获得用户的提交与部署授权，生产结果不由本审查提前宣称。

## 未知项与验收边界

公开说明不能提供所有导出协议；写作框/图表/引用的具体字段需要脱敏样本。
测试用合成内容，不复制真实消息。API 专项确认官方图仍拒绝、标准化导入/
block builder 仍保真；Web 专项覆盖真实共享渲染、源码偏移、代码保护、
Reader/Share/Offline 接线及负向案例。按风险运行 lint、typecheck、build、
migration heads 及可运行的浏览器合同检查。
本地服务替身、SSR、SQLite 不称为生产/PostgreSQL/真实离线设备验收。
代码审查未发现本批新增远程执行或加载路径；不等于完整安全审计。
未运行 NVDA、axe 全站扫描、全链键盘/缩放矩阵，不作 WCAG 符合性结论。

## 实施与验证结果

**2026-10-25 本地实施完成。** 本批随后与噪声匹配修复合并为同一提交/
发布批次；生产验收仍以标准 CI、制品、备份和部署门禁为准。
最终仅改既有识别器、显示策略版本和对应测试；没有 API/schema/import parser 改动。
识别器现在必须扫描完当前输入中全部已识别候选，聚合 escaped 标志，并对
已识别的后续错配/未闭合/超深结构拒绝授权。未知属性/不支持标签仍由旧 scanner
跳过，不宣称升级为通用结构校验。canonical 块继承全文的临时 profile，
不把合法的块片段误当独立坏格式。源码偏移、复制和稳定锚点没有新增写入。

| 检查 | 实测结果 | 边界 |
| --- | --- | --- |
| 隔离 HEAD/当前控制对比 | 7 项当前全部符合；基线 2/7 | 合成输入，包含两个通过的对照；不是生产故障率 |
| Web 聚焦 Node | 82/82 通过 | `chatgpt-rich-text`、`manual-markdown-fidelity`、`thinking-summary` |
| 完整无服务 UX | 75 文件，1,586/1,586 通过，零跳过 | 真实解析器/SSR/显式组件适配器，不冒充认证 E2E |
| 隔离 Chrome | 83/83 场景；page/console errors 均为空 | 实际共享 MarkdownRenderer；新增两个正文场景，合法混合正文检查 1440/375px；API/Next-loader/周边 UI 有明确适配器 |
| API 导入/保真专项 | 7 文件，16 passed / 1 deselected | 纯函数/本地测试；真实成对用户 fixture 主动排除，不读取用户原文，不声称完整 API/PG 验收 |
| Playwright 源码合同 | 4/4 通过 | rich-Markdown 与 import compatibility 两文件；无浏览器/服务器，不叫 PWA/E2E |
| Web lint / typecheck / production build | 全部通过 | 非增量 tsc；标准 `.next` build，`NEXT_BUILD_CPUS=1` / `NEXT_STANDALONE=0`；不部署 |
| Alembic heads | 单一 `20261022_0053 (head)` | 无 migration 变更，不声称生产数据库重验 |

命令与源码 SHA-256 见[脱敏验证回执](ux-audit-chatgpt-reading-2026-10-25-evidence/verification.json)；
用例结果见[基线对比](ux-audit-chatgpt-reading-2026-10-25-evidence/controlled-regression.json)、
[say 类型探针](ux-audit-chatgpt-reading-2026-10-25-evidence/supported-say-type-probe.json)和
[Chrome 回执](ux-audit-chatgpt-reading-2026-10-25-evidence/browser-result.json)。
两张人工检查过的合成截图：
[1440px](ux-audit-chatgpt-reading-2026-10-25-evidence/reading-rich-1440.png)、
[375px](ux-audit-chatgpt-reading-2026-10-25-evidence/reading-rich-375.png)。
临时日志/配置均在本任务独立 `wkkk` 子目录；未清理其他任务资料。

保留失败事实：四项 API 方向试改因入口不可达撤回；早先重叠日志不计为隔离基线。
完整 Node 首次命令在 Windows 未展开 `*.test.mjs`，未进入测试，改为
PowerShell 显式枚举 75 文件后全部通过，没有为通过而删测试或放宽断言。
新增合成探针仍复现 DATA-09/DATA-12/COPY-03，故不宣称所有正文已完整恢复。
本轮没有认证 Reader/Share/Offline 全链、真实离线设备、完整 PWA、PostgreSQL、
生产、物理剪贴板或 CPU/RSS/持续负载验收；旧发布回执不替新改动背书。
预先存在的 `apps/web/tsconfig.tsbuildinfo` 改动保持原 SHA-256，未代为提交或恢复。
