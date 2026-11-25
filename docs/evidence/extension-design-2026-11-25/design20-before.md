# Chat Reader 统一设计 v2：20 状态接通度复审（2026-11-25）

## 范围与结论

北京时间 17:25–17:42 只读检查点，Extension `codex/reader-extension` / HEAD `be5e8dabd772809635db345a51c8c15c26b468ed` + 未提交候选。此 HEAD 不能代表 dirty 代码；实测输入 hash 见下列 JSON。审查实际设计包五份文本、两张总览及选择/冲突单图，当前源码、主进程真实后端证据和实际扩展截图；不以原型代替生产实现。

**不能判定完整设计已交付。** 已贯通实际扩展导入中心、当前对话导航、共用浮层、短码及逐条导入；但选择操作、批量列表布局、冲突放弃路径、项目上下文入口、主动绑定核对与部分导航细节仍缺。共同把手/浮层取代原生侧栏、站外仅工具栏入口、短码连接、只追加是用户后续明确批准的变化，不按包旧 UI 判为缺陷。网页来源只允许明确账号/工作区下主动发现的部分目录，这一安全限制正确；不得假装提供全账号/整个网页项目。

本报告使用 ux-audit 的证据分级，技能不作为需求权威。主进程的队列安全修复仍在并行，下面是本检查点，非冻结候选最终资格。

## 先交付的阻塞（已向主进程报告；实现前落盘）

### SEL-01 · High / 已批准范围缺失 · 选择/列表 · Observed(code + measured + rendered) · M

- 要求：`<TASK_EVIDENCE>\design\CODEX_PROMPT.md:31,51,61`、`DESIGN.md:33,55`、`screens\12-import-selection.png` 明确三种全选、已选清单逐项移除、真实分组计数、有界分页及固定主操作。
- 当前：`<EXTENSION_REPO>\reader\center.js:69–83,111–114` 只有“选择筛选结果”、清空及 limit+=50；没有本页选择、完整本地项目选择、已选清单。`reader\center.css:15–19` 列表无高度边界、footer 普通文档流。
- 实测：150 条合成来源、3 项目；首批 DOM=50，但筛选全选=150（按钮标签是筛选结果，**不是宣称误把本页命名为全部**）；主按钮 top=4338.03px/viewport=900。点两次更多，DOM=150、文档高=12111px；375px 主按钮 top=4352.53px/viewport=800。已选跨筛选保留，但不能集中核对/删除隐在其他项目的已选项。
- 影响：大量选择必须滚数千像素才能继续，无法直接核对将要发送的完整范围。可完成少量导入不等于设计 G2 已完成。
- 最小修复：纯选择模型 + 固定50行页、已选视图/移除、三种实际 ID 快照。网页永远 partial，不允许整个项目；本地文件只在完成证明及归属明确时允许“本导出包内整个项目”。页面接入由主进程完成；我只新增模块和 tests，不碰 center.js。
- 证据：`<TASK_EVIDENCE>\extension\design20-runtime-KRhcaN\report.json`、`selection-wide-first50.png`、`selection-375.png`。

### REC-01 · Blocker / 可复现交互死路 · 冲突处理 · Observed(code + measured + rendered) · M

- 要求：CODEX_PROMPT.md:47；DESIGN.md:46；16-conflict-review 允许保留旧版并跳过或另存。
- 代码：`<EXTENSION_REPO>\reader\center.js:287–295,302–307,317–334`；`reader\batch-model.js:5,18–24`。
- 合成 `phase=review/action=conflict` 收据实际扩展只显示“新的导入”“确认另存”；取消按钮隐藏。“新的导入”报先处理未完成项；主页“结束此计划”也拒绝。缺少不生成副本的结束路径。不表示已发生用户资料丢失；实际 Reader 对冲突收据的撤销语义由主进程审计。
- 最小修复：主进程提供经原收据确认的“保留原件并跳过”，区分尚未提交/已提交/结果未知；不能直接删 journal 假称已取消。
- 证据：同上 report.json，`conflict-no-skip.png`。不编辑主进程队列。

### NAV-ENTRY · High / 已批准入口缺失 · Observed(code); 真实项目页面未验证 · S–M

- 要求：CODEX_PROMPT.md:18,65；DESIGN.md:13–20；图09/10/19。
- `reader\source-control.js:126–131` 无 chat 即移除保存操作区，项目首页没有“导入到 Reader”。共用把手内可进入 center 是替代路径，不等于指定项目快捷入口。
- `reader\surfaces.js:21–25` 仅传 `?tab`，`center.js` 没有解析 location.search；进入后仍要求重新挑标签。`reader\routes.js:3` 只识别项目首页，不识别项目内对话所属项目；`reader\workspace.js:19,40` 由此不传项目内对话提示。项目首页在用户重新选该 tab 后可由 discover hint 预定位，这部分已接通。
- 最小修复：来源 tab 提示先经用户确认/重新核实；确证 project ID 才预定位，永远零预选，可切回全部。标题只作可见提示，不能由标题/同名猜 scope。不静默扫描或自动读取其他页。

### SEL-META · Medium / 明确数据展示和主动核对缺口 · Observed(code) · M

- 要求：CODEX_PROMPT.md:29,31,33；DESIGN.md:34。选择行需已知更新时间/附件信息；用户可主动确认范围后核对已存绑定。
- `reader\source-file.js:66` header 白名单丢弃 conversation update_time；`reader\archive-source.js:31` 目录只留 id/title/group/字节段；`reader\center.js:75` 仅标题/组名。中心不存在主动“核对已存版本”入口或绑定结果层；当前只是在真正逐条提交时遵循已有去重。
- 不能编造时间、附件0或“内容一致”。最小扩展只保留真实可用元数据、缺失留未知；主动绑定核对只发送确认范围的来源ID，接口能力未确认前不假装实现。实现难度不构成将明确需求变成 future 的理由。

### NAV-BOUND · Medium / 导航附件列表与提问预览不完全符合 · Observed(code + measured) · S

- 要求：NAVIGATOR_SPEC.md 目录完整预览、长列表有界渲染。
- `reader\overlay.js:180–190` 附件“更多”仍 limit+=64（目录/正文搜索已经固定分页）。150 合成附件实际 DOM 64→128→150，无业务硬上限但也无渲染边界。
- `reader\page-index.js:56` 提问仅保留220字，`overlay.js:148–149` title直接用截断值；335字合成问题 tooltip=220，末尾证据不可见，没有按需全文预览。不能为了 tooltip 常驻整库长正文；利用现有 loadBody 按需单条预览，取消/失效释放。
- 证据：`<TASK_EVIDENCE>\extension\design20-nav-u9TbKr\report.json`。这两项尚未修；本轮授权选择模块不包含这些文件。

### QUEUE-UI · Medium / 大批次定位不完整 · Observed(code); 大批次真实渲染未测 · M

- 图15/17及 CODEX_PROMPT.md:51 要求异常筛选/结果状态清晰、列表有界及稳定操作区。
- `reader\center.js:275–281` 每次可见状态改变重建全部 plan.items，无结果/异常筛选；汇总只有完成及已接收数。`center.css` 队列/操作普通文档流。两条真实收据成功证明链路，不证明大批次可扫描性。主进程按真实回执增加紧凑状态计数/筛选与分页即可，不增加另一任务中心。

## 20 状态符合度（行为状态，不冒充20项完整验收）

| 图 | 当前判定 | 接通证据 / 仍差的内容 |
|---|---|---|
|01 默认收起|按后续决策符合；合成Edge已测|共用右侧窄把手，save独立，不挤正文；不是包旧的独立目录图标。|
|02 轮次/章节|部分符合|120轮远跳、真实标题/重复标题定位、当前项与手动展开已测；完整问题预览缺220字后内容（NAV-BOUND）。真实ChatGPT未测。|
|03 当前正文搜索|合成Edge范围符合|111处全部分页64+47，第101处真实DOM Range；本地50001条/50111处无业务cap，只有页片段；真实DOM/公式特性未知。|
|04 当前附件|部分符合|独立附件项、轮次角色、同名ID消歧/安全消息回退已测；多页累积DOM未有界（NAV-BOUND）。|
|05 保存菜单|基本接通|普通/项目chat有批量导入，菜单/导航互斥、保存期间禁定位；忙时暂不开放另一任务合理。追加共存最终真实场景未测。|
|06 Reader资料库|按后续决策接通|浮层内扩展独立frame、全局导入、短码；dynamic WAR真实Edge已过；无原生sidePanel是批准变更。名称搜索主进程真实API证据有效。|
|07 紧凑浮层|合成Edge符合|320/375/1440中英深浅，composer避让，宽度delta0，成功收起/焦点；没有真机/真实ChatGPT认证。|
|08 追加模态|源码保留/集成证据不足|source-control append先关闭导航，原showModal及焦点恢复保留；本轮没完整点击真实追加modal回归，不用截图假称完成。|
|09 项目首页导入|缺失指定快捷入口|只有共用把手→资料库→导入，项目首页未注入设计要求的导入操作（NAV-ENTRY）。|
|10 项目对话菜单|部分接通|批量菜单存在；project chat不产生项目hint，?tab未消费（NAV-ENTRY）。|
|11 选择来源|合成Edge+真实后端链路符合|独立center文件已打包；未连接可打开；明确选tab/本地包，不隐式传原包或预选。|
|12 全局目录选择|不符合完整G2|标题/项目筛选与零选择有；三种全选、已选清单、真实元数据/主动核对、固定分页/主操作缺（SEL-01/META）。|
|13 跨项目勾选|部分符合|跨项目保留Set已实测；不可集中查看/移除，分组已选计数未实现（SEL-01）。|
|14 Reader映射与确认|核心接通，部分细节差|真实两目标组、正文/附件、opt-in映射、冻结计划及不移动旧归属已测；默认one而设计要求默认分组、每组数未显示。不是数据安全失效结论。|
|15 队列|部分符合|逐条上传/收据、暂停/续跑/原回执、重载已测；异常筛选/大列表边界/冲突跳过缺（REC-01/QUEUE-UI）。|
|16 冲突核对|阻塞|只另存，没有保留原件并跳过；不愿另存时计划无法结束（REC-01）。|
|17 结果汇总|部分符合|每条实际目标/动作/完整性和打开Reader可用；缺按失败/待核对汇总/筛选，且同列表无界。|
|18 来源不可用|源码接通，未完整实测|无tab、未知scope有降级文字，合法ZIP入口始终保留；无需复制原型弹窗。没有真实账号撤权/目录断页验收。|
|19 项目预定位|部分符合|项目首页再次选择tab后hint+零预选+全局切换可用；入口上下文丢失，项目chat未识别；不可信/未知不能猜测。|
|20 站外全局入口|按后续决策接通|仅工具栏开独立center；不在普通网页注入，也不恢复原生侧栏。未连接仍可挑来源。|

“符合”只针对注明证据范围，不是完整G0–G3/真实ChatGPT发布验收。未用百分数/平均分掩盖阻塞。

## 有效证据，不应推倒重做

1. 本次真实Edge只读复现：`design20-runtime-KRhcaN/report.json`，运行exit0，实际扩展包，150条合成资料+合成冲突收据；输入文件前后hash相同，截图已亲自查看。脚本 `<TASK_EVIDENCE>\extension\design20-readonly-check.cjs`；不是线上来源或真实API。
2. 当前导航 `edge-navigation-O6lv5i/results.json` 4视口/主题/语言×10=40检查；真实Edge合成虚拟DOM。`edge-navigation-memory-b3hDHg/results.json` 50001消息/109.2MiB Blob/50111匹配，稳定分页和JSheap记录（非RSS）。
3. `surface-final-runtime-a.json` 7项：实际扩展frameId/parent document/一次ticket、短码不在宿主DOM、width700→700、center存在。旧dynamicWAR红日志仍保留。
4. 主进程 `<TASK_EVIDENCE>\main\center-browser-NYIbnF\report.json` 16项：真实Edge+真实FastAPI/PostgreSQL/worker、合成用户/导出包和ChatGPT页。本人核对报告及选择/目标/结果截图，不称本轮由我运行。
5. 主进程 `main\canonical-integrity.json` 11项：两条正文/角色/归属、20字节附件独立SHA、未选资料未上传。证明确实逐条入库，不证明整个设计。
6. 主进程 `main\real-api\catalog-browser-Gqvu3G\report.json` 1万对话+10万正文索引，20次浏览器输入结束到结果P95=239ms，项目29/29、正文独有0。不能等同真实网络或后端单独P95。
7. 当前精确capture集成 `capture-integration-final-20261125T171221/result.json` 15/15；此前fullsuite160pass/63原有privatefixture skips仅属于该次输入，不继承到后续修改。

## 最小修复接口（新授权范围）

只新增 `<EXTENSION_REPO>\reader\center-selection.js` 与 `tests\reader-center-selection.test.cjs`；center.js由主进程集成。本模块不发网络、不读正文、不改收据、不决定目标项目，不以标题认领来源。

`ReaderCenterSelection.create({source,chosen,groupName})` → `view({query,group,page,selectedOnly})` 固定50条；`snapshot('page'|'filtered'|'project', filters)` 冻结ID；`apply(snapshot)`；`set/remove/clear/selected/summary`。

`project(group)` 必须 `kind=archive`、明确完成、本地digest与scope一致、全部归属明确且group非unknown/unclassified；即使web.complete=true仍拒绝。archive当前没有complete字段，解析器未显式证明之前保持禁用。UI必须说“此导出包内整个项目”，不说覆盖线上完整项目。其他修改等待授权。

## 尚未验证 / 真正发布门槛

- 上述REC-01是可复现核心死路，SEL-01/NAV-ENTRY/META/QUEUE-UI/NAV-BOUND为已批准设计差异；不能以计划“完成”跳过。
- G0真实ChatGPT来源适用性、真实Chrome及Edge登录页面、真实工作区/分页/分支/媒体DOM验收未执行；无权限时不得读取私人资料或用合成数据冒充。可按已验证本地包路径交付明确受限版本，但须主用户同意范围，不能我自行降低要求。
- 本次没有改已有源码/测试、未提交/推送/CI/发布、未新建agent、未触及生产。后续选择模块新增记录单独列明；完整两仓冻结全测由主进程统一执行。
