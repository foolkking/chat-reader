# Chat Reader 0.3.0 核心整改：改动前审查

**交接更新，2026-11-26。** 本文保留每个中间时点的原观察及失败。后续补齐 >250 条的真实后台写包、保存与追加的统计隔离、设备收据回读、批量选择和反向容器定位。最终安装包与隔离 Reader 回归、三轮复审和个人账号验收范围统一记录在交接页。[最终候选和验收证据](../evidence/extension-core-2026-11-26/README.md)

日期：2026-11-26，Asia/Shanghai。范围是已发布浏览器客户端的保存、导航、追加、工作区及其 Reader 合同，不是重新设计数据管理系统。面向需要反复保存、阅读和交接长对话的用户；正文、附件、来源身份及追加的不可覆盖边界优先于视觉调整。

## 证据与边界

- Reader 工作树 HEAD：`61daf63338b89e47c02ef6624ffa4487d11e2b8c`；插件 HEAD：`e18bb4cae7674af66a08fd3be50c113475f34e5a`。两仓沿用 `codex/reader-extension`。既有未提交文件不属于本轮改动。
- `PROJECT_STATE.md` 记录生产为 v0.1.10 / `7c4574b005d663a79e99698a2fa7d9eabf3e4cc4`、schema `20261125_0065`。这是已有部署证据，不能代替本轮实时核对。
- 用户提供的九张图是本轮**设计与交互基准**，不是故障日志或当前运行截图。尤其第三图要求目录只由三横线打开；第四图明确工作区展开时隐藏外部保存条。
- 已审查实际插件 `fast-text`、`capture`、`source-file`、`visible`、`page-index`、`progress`、`source-control`、`overlay`、`surfaces`、`append-picker`、封包脚本及关联测试。已运行下述合成重现，**尚未复现用户真实 ChatGPT 对话失败**。
- 用户先要求“不用 Chrome”，随后明确授权使用指定的测试 Chromium（`C:\Users\86182\Desktop\wkkk\playwright-browsers\chromium-1234\chrome-win64\chrome.exe`，已有测试账号和插件），并要求使用 Playwright 而非 Computer Use。普通 Chrome 配置仍不在范围内。没有真实来源验收的项目保持未验证；不以合成 DOM、模拟接口或历史 CI 替代。
- 本轮没有生产发布、部署、数据清理或安装目录替换授权。只修改候选源码及隔离测试。

## 最重要的三个结论

1. **存在可重复的保存阻断，不仅是 UI 问题。** 图片占位消息在原解析器中计算了非空备用正文，却未写回实际输出；Reader 因空正文在生成包前拒绝。应补齐真实备用表示并保留缺件标记，不能删除空包校验。
2. **网页适配存在两套不一致的判断。** 原导出器已经识别新消息属性和新版停止按钮；Reader 仍以旧属性为主，并会读取隐藏历史容器的状态。分支保护必须保留，但必须依据当前可见正文和已核验消息身份，而不是隐藏 DOM 或复制按钮文案。
3. **进度与操作区缺少共享状态。** 单阶段显示会丢掉已完成统计；打开浮层只收起保存菜单而未隐藏保存条，批量任务还跳出到新页。需要在核心保存恢复后，按九张图统一任务和展示状态，而非再加一层按钮。

## 优先问题表

| ID | 问题、具体证据与用户影响 | 级别 / 证据等级 | 最小修复 / 工作量 |
|---|---|---|---|
| FLOW-01 | 插件 `extension/fast-text.js:173–175` 计算 `md` 备用值，但输出仍展开原 `normalized`。合成图片独占消息通过真实 capture→host→package→upload 路径得到 `Empty source message`，且尚未发送 Reader 请求。 | Blocker；Observed（代码＋合成路径重现），不是用户现场根因证明 | 写回经过规范化的备用正文，保留 `needsAssets`/partial，新增贯穿路径回归；S |
| NAV-01 | `reader/page-index.js` 只读取 `[data-message-id]`，新属性合成样本中预期两条消息，实得零条。`capture.js` 又直接读 `el.dataset.messageId`。 | High；Observed（代码＋合成 DOM） | 与原导出器共用可见来源适配；显式处理节点 ID、消息 ID、轮次候选及歧义，不凭排列认领；M |
| STATE-01 | PageIndex 和 capture 的停止状态查询未限定真实可见内容。隐藏停止按钮使 `generating=true`；隐藏历史 `data-current-node-id` 被当当前 leaf。 | High；Observed（代码＋合成 DOM） | 可见对话作用域、新旧生成控件统一、分支变化独立验证；M |
| STATE-02 | 无 `.markdown` 包装的消息将整个容器文本用于版本判断；仅把按钮 Copy 改为 Copied 就把 revision 从 1 改为 2；正文改变控制组仍正确失效。 | High；Observed（代码＋合成 DOM） | 仅对语义正文取指纹，保留真实正文、路由、分支变化取消；M |
| FBK-01 | `reader/progress.js` 仅允许单阶段 done/total/pages/messages/files；`source-control.js` 收到更新直接替换 step，无法保留此前字节、阶段或耗时。 | High；Observed（代码）；当前像素表现未验证 | 一份累计任务记录，阶段计量分开，未知总量不显示百分比，失败保留诊断；M |
| NAV-02 | `overlay.js` 打开只调用 `ReaderCloseSaveMenu`；`source-control.js` 仍显示独立保存条。`surfaces.js` 的 openCenter 默认创建新标签。 | High；Observed（代码）；双区实际遮挡程度未验证 | 单一展示控制器，三视图，展开时保存迁入；批量复用内部视图，维持私有 iframe 授权；L |
| FLOW-02 | `append-picker.js` 的初始选择为空、每页24条、上限250，缺少轮次全选/区间/反选。 | High；Observed（代码），与第九图明确冲突 | 默认全选但不自动提交；保留来源顺序、末尾确认、并发冲突保护；先核对后端合同再设计超限提交；M |
| NAV-03 | 目录以轮次行和标题列表展示，未形成用户要求的回答节点与完整标题层级；active 跟踪基于消息，而非章节。 | High；Observed（代码），视觉层级尚未实测 | 先统一定位，再做真正树与章节活动路径；消息降级不宣称章节成功；L |

### 可复现命令与原失败保留

临时根：`E:\chat-reader-temp\extension-core-20261126`；每个进程先设置 TEMP/TMP，禁止使用生产资料。

- `node E:\chat-reader-temp\extension-core-20261126\g0\source-dom-red.cjs`
  - 结果存于同目录 `source-dom-red.json`。
  - 新属性 0/2、隐藏 stop 误判、隐藏 leaf 误判、复制按钮误触 revision；正文真实修改控制组仍触发失效。
  - 该命令输出测量结果而非通过门禁，exit 0 不代表缺陷通过。
- 解析器侧审查：`parser-audit\parser-audit.test.cjs` / `parser-audit-red.log`。
  - 3个控制通过、2个回归失败，exit 1；保留原失败。
  - 既有定向 Node 测试29/29通过，说明原测试未覆盖该输入，不证明真实网页正常。
  - BOM、UTF-8、转义、小分块和已支持的响应结构控制通过；不能因此删除来源树/父链校验。

## 九张参考图的实施合同

1. 累计进度：阶段各自的量纲、已完成记录和当前附件同时可查，收起不重置任务。
2. 异常：系统可恢复的传输/准备问题自动有界恢复并显示状态；权限、目标变更等用户可处理问题给明确动作；不可恢复时保留事实和脱敏诊断，不假报成功。
3. 折叠态：仅一组「三横线 / 保存 / 更多」；目录不常驻正文。
4. 展开态：导航、资料库、导入；外部保存控件隐藏，保存迁入工作区。
5–6. 批量：默认紧凑，复杂映射可扩大；选中与任务不因切视图丢失，不自动新开标签。
7. 目录：轮次→提问/每个回答→各级章节，展开操作与定位操作分开。
8. 定位：身份核验→必要加载→精确锚点→可见及稳定验证；精确、消息降级、未定位明确区分。
9. 追加：默认全选、轮次/角色/区间/Shift/搜索/预览；显示完整选择总量；固定目标和最终确认，永不覆盖原消息。

## 执行顺序及尚缺证据

G0 先保留现场与合成失败；G1 恢复单对话采集/封包/导入并做隔离全链路；G2 累计进度/恢复；G3 统一定位；G4 树与追加；G5 互斥工作区；G6 打包和三轮复审。**不得因 G0 的合成结果直接宣告真实 G1/G6 完成。**

已存在的设备认证、私有扩展页隔离、收据、OPFS、分块上传、来源绑定、末尾争用保护和完整性检查保留。未知项包括用户失败所处的确切阶段、实际来源响应变体、登录真实页的远距离定位与长对话体验。没有接触真实来源的结论明确保留，不要求用户重复提供设计图。

## 补充：指定测试 Chromium 的真实页面观察

2026-11-26，Asia/Shanghai。证据保存于
`E:\chat-reader-temp\extension-core-20261126\live-chromium\control-and-navigation.json`，
画面仅保存已遮蔽正文和标题的 `installed-navigation-redacted.png`。

- **控制已实际建立。** 通过仓库 Playwright 的 persistent context / pipe 启动用户指定的 Chromium 151.0.7922.34，保留原测试配置；真实点击历史对话和插件把手。运行中 service worker 的 manifest 为 Chat Reader 0.3.0。没有使用 Computer Use、普通 Chrome、配置复制、凭据导出或修改安装目录。
- **已安装插件的真实回归。** 本条对话有四个新版 `data-chatgpt-search-message-ids` 节点，没有旧 `data-message-id` 或 `data-message-author-role`。点击目录第一个轮次立即出现“未能确认原文位置”。打开浮层后独立保存条仍可见；正文宽度变化为 0 CSS px，不能将双操作区问题误述为宽度挤占。
- **新版正文结构已核实。** 两个回答节点含重复的同一身份 token、一个 1×1 的 `h4.sr-only[data-conversation-role]` 和完整的 `[data-response-body]`；没有 `article` 或 `conversation-turn` 祖先。角色由明确语义和 API 记录确认，不按 DOM 顺序猜测。无障碍角色标题不能计作回答章节。
- **同一真实响应的解析对照。** 通过已安装插件自己的“重新读取”获得 263,779 字节响应，仅在内存中比较；17 个 mapping 节点，原 Fork、已安装 Reader 字节解析器及候选解析器均得到四条消息，身份、顺序、正文、来源路径和资源投影一致。正文 UTF-8 合计 12,484 字节，无附件，五条转换警告保留：三条 `thoughts`、两条 `reasoning_recap`，均为无 channel 的 assistant 特殊记录。这会使普通正文已有四条时仍显示“部分目录”；不能直接删警告或把这些特殊记录说成已完整转换。这个样本没有复现空正文封包故障，不能据此宣布所有导入失败已解决。
- **候选适配器的真实页定向验证。** 在同一真实页的独立脚本世界载入候选源码，不替换插件、不调用 Reader 写接口。分支验证通过，识别四条消息及 27 个正文标题。恢复正常可见窗口后，首消息、末消息、两个回答首章节的四次定位均通过真实身份、可见和稳定检查，耗时分别为 2,001、1,404、402、1,480 ms；远跳经过两次实况探测。
- **真实手势取消。** 候选远跳进行中发送真实滚轮输入，任务返回 `AbortError` 并转为 `cancelled`，没有把取消伪报成成功。本轮结束后已刷新原页面，移除临时隔离世界和内存响应引用，保留原插件及测试浏览器打开。
- **原失败仍保留。** 测试浏览器最初处于 minimized，双 RAF 实测约 1,010 ms；同四项中的两项返回 `hidden`，另外两项约九秒才成功。改为 normal 可见窗口后的通过不能替代后台／最小化导航验收，未放宽定位门槛。

边界：上述为一个真实无附件短对话的控制、读取、解析和候选定位证据；
不是候选安装包完整 G6，不覆盖长对话、真实附件或 Reader 端最终回执。
没有提交导入、发送 ChatGPT 消息、发布、部署或修改生产数据。

## 本轮候选集成：G4/G5 与验证记录

所有以下回执在 `E:\chat-reader-temp\extension-core-20261126`；仅两个既有子任务参与，均已冻结。没有新建分支。

### 具体修复

- 追加选择器默认保留全量选择，按轮次/角色/区间/Shift和分页操作；搜索和完整预览从来源 provider 按需读取。主 capture 只保留选择元数据，再逐条水合已选正文，不建立第二份全量正文数组。1001条及跨页稀疏选择的回归核对最终顺序、问题归属和数量；旧服务不能截断或先开始上传超限片段。
- Reader 新增能力及范围编码，保持 Web 最终确认、单次原子提交、末尾确切正文摘要及加锁后重查。独立 PG/API/worker 的1001条追加与重复跳过读回通过；worker 640 MiB、峰值147,615,744字节、无OOM。该合成包不是用户真实采集。
- 统一工作区把同一个保存 DOM 移入底部，私有资料库/导入 frame 各自绑定来源与 view，收起/切换不销毁队列。普通网页的主动工具栏入口恢复固定原生侧栏，失败时才使用固定独立页，ChatGPT 不调用原生侧栏挤占正文。
- 额外发现保存时展开目录会再次读取整条来源，以及在目录读取中保存会并行两个读取。新增红测两项重现后，保存先终止旧导航/目录读取；保存中展开不开始第二次完整读取，保留已有目录、进度和用户任务。不是全局禁读或取消已受理任务。
- 额外发现静态 provider 的转换警告被首尾重复计数。先保留3通过/1失败回执，再修为只累计迭代后新增警告；懒加载图片告警依然保留。中间一次错误修复使两项图片告警计数失败，已保留并修正，不删除原断言。

### 执行命令与结果

Node路径为 `C:\Users\86182\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`，版本24.22.3；以下命令在对应仓库运行前设置 `TEMP/TMP=E:\chat-reader-temp\extension-core-20261126\ui-review`。浏览器命令的 `EDGE_PATH` 或 `READER_BROWSER` 都显式设为用户指定的 `chromium-1234\chrome-win64\chrome.exe`，实际产品为 Chrome/151.0.7922.34，**目录历史命名含edge不代表本轮用了Edge**。

| 命令/操作 | 实际结果及回执 | 范围 |
|---|---|---|
| 插件 `node --test --test-reporter=tap tests/*.test.cjs` | 最新 **360 passed / 0 failed / 63既有私有样本skip**，exit0；`ui-review\extension-current-final.log/.json`记录起止时间、HEAD、全部输入前后摘要 | 当前候选源码，不是CI |
| 插件 `node scripts/reader-navigation-check.cjs <TEMP>` | 四种宽度/语言/主题共40项，exit0；`ui-review\edge-navigation-b8znPc\results.json` | 120轮合成虚拟对话；精确ID、111处完整分页、重复标题/附件、真实手势及焦点 |
| 插件 `node scripts/reader-navigation-boundaries-check.cjs` | 42项，exit0；`ui-review\nav-bound-entry-Qt5QSl\report.json` | 1440/375/320px合成来源、完整预览、150附件分页、项目入口和无注入边界 |
| 插件 `node scripts/reader-progress-check.cjs <TEMP>` | 四种布局全部通过、正文宽度变化均0；`ui-review\edge-progress-oWLaWh\results.json` | 真实 Chromium + 合成进度；单控件局部渲染，不认证整个工作区全部任务状态 |
| 插件 `node --test tests/reader-workspace-state.test.cjs tests/reader-excerpt-capture.test.cjs tests/reader-image-capture.test.cjs` | 12/12，exit0；`ui-review\workspace-lazy-capture-green.log` | 保存/导航重复读取、1001条逐条封包、缺件partial |
| Reader子任务完整命令 | `backend-audit\g4-handoff-20261126T063239Z\handoff.json`、README | PG及ranges36项、兼容57项、Web逻辑9项、lint/tsc通过；不是全Web浏览器/build/CI |

导航40项的首轮三个窄屏均在取消手势处30秒超时，原日志和截图保留于 `ui-review\edge-navigation-YGGvbb`。实际原因是旧坐标落在新版工作区标题，事件正确没有当作正文滚动；测试改为先断言落点属于暴露正文，再发真实滚轮。保留全部取消/迟到回调不回拉断言与原30秒时限。不能把这一修正称为定位性能提速。

### 实际候选安装包的私有页边界验证

为避免覆盖测试账号原扩展授权，额外使用**同一指定可执行文件、全新任务profile**，加载只绑定 `https://reader.invalid` 的不可交付测试包。原测试账号配置没有复制，原桌面安装目录没有替换。

- 打包命令：`node scripts/package-reader.cjs https://reader.invalid E:\chat-reader-temp\extension-core-20261126\isolated-package\extension --zip`。
- 58成员逐字节读回；ZIP SHA256 `6acc4314af507e032d59ce717d618e457c92a4e1cb44610bb5976d1f6775b105`。这是**当时源码快照**，早于最后警告计数与重复读取修复，不可当最终交付包。
- 真实点击扩展浮层，资料库/import两个授权frame同时存活；没有新开标签，收起再开仍是同一个import frame。
- 真实原生sidePanel观察到 sender `hasTab=false`，无`frameId`/`documentLifecycle`；受限的`batch-tabs`授权通过。未用模拟MessageSender冒充这一观察。直接从后台调用open首先被真实浏览器以缺用户手势拒绝；随后使用隔离扩展页的真实按钮打开，不绕过手势门槛。工具栏本身的真实OS按钮点击尚未测试。
- 回执 `isolated-package\actual-package-workspace.json`，合成图 `actual-workspace-import-1440-corrected.png`。第一次测试选择器误选嵌套扩展文档按钮，导致测试源导航到被阻断地址；原截图与错误保留，随后只遍历顶层shadow，不再把iframe局部坐标用作顶层点击。
- 此隔离profile测试结束已关闭。后续核对发现原测试浏览器控制连接也已关闭，原因未取得证据；确认指定可执行文件没有运行中的进程后，以同一原配置重新打开原测试页，未清登录或扩展数据。不能归因于产品或用户。

### 尚未完成的门禁

尚未提交CI/发布/部署；不能将358/360本机测试与历史正式CI混称。真实短对话定向验证没有附件；用户失败任务的完整真实读取→附件→上传→Reader提交尚未复现/验收。长分页真实来源、实际分支切换、候选完整安装+Reader测试实例整轮、Reader范围选择器布局/键盘、三轮最终审查仍待完成。批量紧凑/扩展视图目前复用旧四步数据逻辑，完整来源选择状态尚未逐一对照九张参考图；不能仅凭一个来源入口截图称设计全部达到。
