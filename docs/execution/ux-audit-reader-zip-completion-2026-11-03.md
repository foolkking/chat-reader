# Reader 与 ZIP 计划完成度复审 — 2026-11-03

> 后续发布状态：本次审查对应的最终源码 `3b839dc` 已通过完整 CI 并于
> 2026-11-04 部署；生产数据、配置及 schema `0058` 未变。真实认证 UI、
> 用户侧 47 对话离线更新、持续负载和隔离恢复演练仍未验收。
> 详见[发布记录](READER_ZIP_RELEASE_2026-11-04.md)。

**复审结果：九类源码缺口已修正；当前 UX 源码 1,946/1,946、API 专项
134/134、lint/typecheck 通过。计划仍未完成浏览器、性能、PostgreSQL 并发、
完整 CI 与发布验收，不能称为整体已验收。**

## 范围与证据

本次是已批准计划的源码级复审及窄修，不是新功能设计或发布验收。
对象为当前 master 未提交工作区中的 Reader、收藏/帮助、离线恢复、
富 Markdown 与 Adaptive ZIP；受众为长期阅读 AI 对话的混合熟练度用户。
使用源码、已安装依赖源码、既有测试与本轮合成回归；未访问生产、未运行
浏览器/CI/部署，不使用 Web search。渲染观感和真实设备性能仍属于待验收，
不从源码推断为“已经修好”。没有无障碍合规声明。

## 初审结论

主要功能入口已实现，但此前“源码完成”仍遗漏了组合路径与失败恢复缺口。
最重要的是：虚拟阅读恢复会误判正常消息边界并清空测量缓存；ZIP 富 HTML
附件未经过 occurrence 转换；分类草稿在加载下一页时被覆盖。
另有锚点取消状态、重复附件的真实 block 归属、ZIP 路径/代码文本保护、
替换版本和事务失败清理需要修正。上述是具体源码发现，不是新的产品范围。
性能基准、真实多路径浏览器体验、精确源码完整 CI 继续作为独立未完成门禁。
扩大回归另发现离线文本搜索会读取媒体资源，列为 PERF-02 一并修正。

## 计划核对

| 范围 | 源码情况 | 完成度边界 |
| --- | --- | --- |
| O1–O3 离线恢复 | 已有逐对话原子导入、范围复核和错误分类 | 保留既有实现；旧测试回执不替代本轮候选验收 |
| O4 发布/真实更新 | 未验收 | 用户负责，不能标记完成 |
| F1–F4 收藏 | 星形、搜索右侧、旧 key/路由和未知写结果恢复已实现 | 亮暗/窄屏/触屏/多窗口仍需用户浏览器验收 |
| K1–K5 帮助/快捷键 | 外部关闭、三行滚动、真实消息导航和异步退役已实现 | 源码测试与实际焦点/IME 测试区分 |
| R1–R3、R5 几何 | 有实现，但存在 PERF-01/NAV-01 | 本次修正后需重新验收三条阅读路径 |
| R4、P1–P2 性能 | 保留预算，但无本轮基线/候选实测 | 不报告数值提升或性能优化完成 |
| S1–S2 侧栏 | 沿用已实现默认收起/专注隐藏 | 不重复计为本轮新增；联合浏览器门待验收 |
| I1–I3 收藏/批注收件箱 | 真实空态入口、筛选/分页/恢复已有 | 保留，不重写整个收件箱 |
| 有界富 HTML/Obsidian | 常用语法已接入；附件组合有 FLOW-01/02 | 不承诺整个 Obsidian 插件生态 |
| ZIP 导入 | 上传/分类/真实附件主路径已实现 | FORM/DATA/SAFE/STATE 缺口修正后才可称源码收尾 |

## 发现（修正前证据，行号随修正可能变化）

| ID | 维度 | 严重性 | 证据置信度 | 工作量 |
| --- | --- | --- | --- | --- |
| PERF-01 | 感知性能/状态覆盖 | High | Observed（应用与已安装依赖源码）；设备影响 Inferred | M |
| NAV-01 | 导航/恢复 | High | Observed（源码）；真实交互影响 Inferred | S |
| FLOW-01 | 正文核心阅读 | High | Observed（源码）；渲染待专项复现 | M |
| FLOW-02 | 资源身份/定位 | High | Observed（源码）；API 待专项复现 | M |
| SAFE-01 | 数据安全/错误预防 | Medium | Observed（源码） | S |
| DATA-01 | 正文保真/导入 | Medium | Observed（源码） | M |
| FORM-01 | 输入/草稿恢复 | High | Observed（源码）；组件待专项复现 | M |
| STATE-01 | 版本/失败恢复 | High | Observed（源码）；故障注入待专项复现 | M |
| PERF-02 | 离线搜索/资源成本 | High | Observed（源码）；真实设备成本 Inferred | S |

### PERF-01：恢复范围过大，并重置已经测准的行高

位置：`apps/web/features/conversations/assistant-message-renderer.tsx:501–558`。
覆盖检测传入整个 viewport，而非 viewport 与当前消息容器的交集；正常从消息中部
开始/结束也会被认为缺失。随后调用传入的 `virtualizer.measure`。
安装的 TanStack virtual-core 3.17.7 `src/index.ts:1958–1966` 明确清空
`itemSizeCache`，并非只重新计算范围。用户快速滚动或图片迟到时可能反复从实际
行高退回估算，违背 R2/R3 与保留测量缓存要求。修正：限制到消息实际责任区，
确认旧 scrollMargin 先校正；仅重测已挂载行，不调用全量 measure。

### NAV-01：用户打断补偿后，补偿标记可能永远保留

位置：`conversation-reader.tsx:795–800,2132–2166`。
用户意图递增 `geometryTransitionRef`，但只有 token 未变的 finally 才清除
`readerGeometryCompensating`；打断后该标记可能阻止后续全部补偿。
此外 scroll 事件无条件重新捕获锚点，persist 未排除 geometry compensation。
用户的主动滚动必须立即取得控制，补偿也不能被记作用户位置。
修正：按操作所有权释放标记，补偿事件不重采用户锚点或持久化位置。

### FLOW-01：ZIP 的 HTML 图片/链接未走 attachment occurrence 转换

位置：`markdown-renderer.tsx:739–783`；
`remark-safe-html.ts:60–70`；`rich-markdown-config.ts:94–96`。
安全 HTML 放在 `data.hName/hProperties/hChildren`，而 occurrence 插件只遍历
Markdown `link/image`；sanitize 会移除未解析的 `cr-asset` 协议。
用户要求的 HTML 图文卡片因此可能上传成功但没有图片或链接。
修正：在 sanitize 之前，同一 occurrence 游标处理安全 HTML 的 a/img/audio/video，
只解析授权 occurrence 的 URL，保留身份及拒绝未知/被排除资源的边界。

### FLOW-02：同一资源多次出现，被全部绑定到第一块

位置：`apps/api/app/services/adaptive_import/service.py:1230–1263`。
每条 occurrence 都重新 `next(...)` 查找第一个包含 token 的 block；
Markdown 中两段引用同一图片时，两条记录的 block_index 相同。
用户在第二处阅读、查看引用或定位附件时可能缺图/错位。修正：逐真实 block、
按可呈现引用顺序建立 occurrence，不扫描代码文本或把引用塞到最后一块。

### SAFE-01：manifest 路径先“修好”再检查，与安全合同相反

位置：`archive_sources.py:778–783`。
`replace("\\\\", "/").strip("/")` 会将绝对路径/反斜杠路径修正成成员路径，
盘符/冒号/NUL 未在此检查；此前回归只覆盖 `../`。
这不会直接解压到任意磁盘位置，但会误绑定用户本不应允许的资源身份。
修正：解码前后明确拒绝绝对/盘符/反斜杠/NUL/遍历，不猜测路径。

### DATA-01：资源正则会改写行内代码并伪报缺失附件

位置：`archive_sources.py:482–555`。
当前只保护三反引号/波浪号围栏；行内代码或缩进代码中的
`[example](assets/example.txt)` 仍当作资源。用户导入教程/源码时，示例可能变成
内部 UUID，或因为并不存在的“示例资源”被阻断。修正：引用分析与改写共用
代码保护边界，覆盖行内代码、缩进代码和嵌套围栏，保留非资源文本。

### FORM-01：加载 ZIP 下一页会丢掉未保存分类

位置：`adaptive-import-workspace.tsx:271–285`。
每次 catalog 对象变化都会从服务端 members 重建整个 draft，包括追加分页及
同版本 refetch；用户先排除几个成员再点“读取其余”会丢修改。
修正：同一分类版本只补新成员，不覆盖本地草稿；版本变化明确处理陈旧编辑，
禁止混合两个版本的分页结果。

续查（Observed 源码）：概览的提交/重新选文件/进入映射按钮尚未关注 ZIP
分类草稿，外层关闭保护也只接收 MappingWorkspace 的状态。用户可以改过分类
却直接导入旧分类，或离开时无提示丢选择。本次一并把 ZIP 草稿接入既有关闭
保护，并在保存/明确放弃之前阻止概览里的冲突操作；不增加第二套对话框体系。

### STATE-01：替换 ZIP 的版本重置和 DB 失败的文件清理未闭合

位置：`archive_sources.py:211`、`adaptive_imports.py:379–427,475–505`、
`service.py:436–459,490–549`。
重新 inspect 将 classification_version 固定为 1；同路径成员 UUID 又复用
artifact 身份，旧标签页可以把旧分类写到替换后的 ZIP。分类/替换会在 DB
commit 前生成派生文件，route 的 commit 失败仅还原 catalog/原 ZIP，未清理
新派生文件；无锁 sidecar 写入也可能互相覆盖。
修正：同会话 mutation 串行保护、替换版本单调递增，失败只清理本次新建文件，
恢复前一 catalog；加入替换后旧版本拒绝和故障注入回归。

实现复核边界：代码区保护不得使用每字符对象数组复制大文档，应使用代码区间
和原文偏移过滤引用，避免为修复 DATA-01 反而引入明显额外内存放大。

### PERF-02：纯文本离线搜索也加载附件内容

扩大源码回归时发现：`reader-data-source.ts` 的
`resolveOfflineSearchResult → getOfflineMessageBlocks → hydrateOfflineBlockAttachments`
会为只需要正文偏移的搜索调用 `getOfflineAttachment`；后者读取缓存 Blob 并建立
object URL。块分页也先解析整个消息的附件再切页，定位同样重复解析。
用户搜索带多媒体的长消息时因此承担了与结果文字无关的读取/内存成本。
修正：搜索和定位只读 canonical blocks，正文块分页先切页再解析附件；保持既有
完整轮次阅读语义和权限检查，不引入另一份搜索正文或新的持久缓存。

## 保留与未覆盖

保留：单 worker、现有服务/组件、canonical 完整轮次、旧 Share/.cr/离线/Dexie、
真实空态与收藏内部身份；不为局部缺口重构全站，不修改用户导入资料。
未覆盖：真实设备视觉/性能、浏览器快捷键焦点、实际用户 ZIP 提交、生产权限/
多进程负载。并发可靠性需 PostgreSQL CI 执行，SQLite 回归不能冒充生产锁验证。

## 调整与验证回执

审查先记录，随后实施。上轮 45/13/125 和全量 API 首轮结果不算本轮候选
的已通过证据。当前 `master` 未提交修改保留，无新分支、提交或部署。

### 已完成修正

| ID | 当前实现与覆盖 |
| --- | --- |
| PERF-01 | 检测 viewport 与单条消息真实交集；先修 scrollMargin，再判断覆盖。仅真实挂载行参与并集，前/后/内部缺口均检查；恢复只重测相关行，不调用清空 size cache 的全量 measure。元素/window 两路径的受控几何回归通过。 |
| NAV-01 | 主动输入立即退役几何 token 并清除补偿标记；补偿滚动不重采用户锚点、不持久化；旧意图的锚点不再参与补偿。扩大回归还补上 Reader 不可用时移除正文键盘监听，原拒绝态断言保留。 |
| FLOW-01 | 同一 occurrence 游标遍历 Markdown 与 safe HTML AST，a/img/audio/video 都能解析授权身份；sanitize 后允许从可信上下文恢复离线 blob，未全局放开 blob/原文 data 属性。媒体及失败占位保留真实 occurrence DOM 锚点；策略为 v13。 |
| FLOW-02 | 按真实 render block 和可呈现引用顺序建立记录，重复附件不再全部指向第一块。API 提交验证重复引用的不同 block_index 和持久附件 ID；manifest-only 文件不伪造引用。 |
| SAFE-01 | manifest 资源路径先拒绝危险原始/解码形式，不把绝对、盘符、反斜杠、NUL 或编码遍历“修好”成有效路径；七类负例通过。 |
| DATA-01 | 检查/改写/occurrence 共用原文偏移扫描，保护行内/缩进/嵌套围栏/HTML code 示例及合法代码标签文字。不建立每字符对象数组；删除按每个附件重复扫描全正文的废弃计数。合成大段分配上限回归通过，不等于生产 RSS 测量。 |
| FORM-01 | 同版本分页/refetch/collapse 保留 overrides；混合版本拒绝保存，新版本保留旧草稿并要求明确放弃。未保存时禁用导入/重选/其他概览变更，并接入已有关闭保护；真实组件的受控 hooks/query 状态测试通过，不冒充浏览器原生 select 验收。 |
| STATE-01 | 分类版本跨替换单调递增，旧预览 409。失败快照恢复 catalog 与被覆盖的 canonical-draft，清理仅限本次新建会话文件。锁范围排除状态轮询/活跃分析，保留 job-first 取消；已提交但响应读取失败不删新源、不谎称旧源仍有效。提交前失败、提交后响应失败及活跃分析不取锁的故障注入通过；真实 PostgreSQL 竞争/进程崩溃边界不在本机证明范围。 |
| PERF-02 | 离线搜索与定位使用无媒体读取的 canonical blocks；块分页先切页再 hydrate，页内同一附件只解析一次，不把临时 URL 写回 Dexie。相关搜索偏移/权限退役/分页纯投影测试通过。 |

### 最终本机门禁

所有生成临时内容的进程均设置：
`TEMP=TMP=C:\Users\86182\Desktop\wkkk\reader-zip-completion-review-20261103`。
pytest 使用该目录下独立 `--basetemp`；编译缓存同样放在该目录。
只使用合成输入，没有导入用户真实 ZIP 或修改用户资料。

| 门禁 | 最终结果 |
| --- | --- |
| `node --test`，输入 `scripts/ux/*.test.mjs` 全部文件 | **1,946 passed，0 failed，0 skipped** |
| API 九个专项模块，见下方命令 | **134 passed，0 failed，耗时 167.94s** |
| `corepack pnpm run lint` | **passed** |
| `corepack pnpm --filter web exec tsc --noEmit --incremental false` | **passed** |
| 本轮改动 Python 文件 `py_compile` | **passed** |
| `git diff --check` 与新增关键文件尾空白检查 | **passed** |

API 在 `apps/api` 目录执行：

```text
python -m pytest tests/test_adaptive_import_api.py tests/test_import_responsiveness.py
  tests/test_import_analysis_queue.py tests/test_import_queue.py
  tests/test_canonical_persistence_combo.py tests/test_canonical_persistence_exporter.py
  tests/test_canonical_persistence_official.py tests/test_attachment_reference_rewriter.py
  tests/test_attachment_renderer_contract.py -q --basetemp <任务临时目录>/pytest-final-source
```

上式换行仅为可读性；实际运行是单条命令。

### 失败历史与修复而非放宽断言

首轮扩大 UX 回归为 **1,907 passed / 34 failed（总计 1,941）**：
Reader 抽取式 harness 未带入新几何 ref/layout event，离线搜索走到了新增的
附件 hydrate 路径。补齐依赖并阻止搜索读媒体后，增加五条组件/几何/分页回归；
第二轮 **1,943/1,946**，新组件 harness 缺少 CommonJS exports、旧监听断言未
执行拆分后的键盘 effect。修正 harness 后第三轮 **1,945/1,946**，暴露真实
拒绝态键盘监听未释放。加上 Reader surface guard 后最终 **1,946/1,946**。
没有删除测试、降低容量门槛或把失败记录改写为通过。

前一实施阶段的全量 API **5,772 passed / 197 skipped / 2 failed / 2 warnings**
仍是历史失败结果；本轮没有重跑整个 API suite，不用 134 个专项结果冒充全量。

### 计划剩余门禁与用户交接

1. **R1–R3/R5、F/K/S/I 浏览器验收**：Reader/Share/Offline，慢/损坏图片，
   快速双向滚动、折叠/搜索/批注并发、输入框/IME、亮暗主题与窄屏。
2. **R4/P1/P2 性能测量**：沿用既有 frame/long-task/DOM/查询/worker RSS 预算，
   同一候选与基线比较；源码分配上限测试不是设备内存或帧耗时证明。
3. **ZIP/离线兼容与真实权限**：分页编辑、旧标签页、故障恢复、HTML 卡片、
   多次附件引用；真实 PostgreSQL 并发、旧 `.cr`/包 v1/v2/v3/Dexie 数据专项。
4. **完整候选门禁**：全量 API、Web build、Playwright/PWA、完整 CI、线上
   与实际用户 ZIP 验证、提交部署，由用户执行。

结论是“已完成本轮源码审查、针对性修正与本机专项验证”，不是“全部产品体验、
性能和生产门禁均已完成”。没有为了凑完成度加入新架构或放开任意 HTML/JS。

## GitHub Actions 失败复盘与测试修正 — 2026-11-03

精确提交 `9db9fd30f8136c174c470117a60d30df0324bb68` 的完整 CI
`41572783373` 未通过：API 与阅读性能比较通过；设置浏览器矩阵
457/463，Web Context gate 35/36；构建/镜像检查因质量 gate 失败而跳过。

六条设置失败来自测试夹具与离线更新规划不一致：当本地包 revision 与目录
一致时，规划器会跳过不必要的包生成；夹具却伪造 worker 故障、等待下载响应
或改写一次请求来强制同 revision 生成包。现在相关测试先真实修改服务端会话
描述，制造可观察的新 content revision，再验证任务故障恢复、取消及阅读位置
冲突在包更新期间的保留。生产规划与离线包规则不变。

剩余 Web 失败在旧成员兼容场景：测试重写 package.json 并生成新 ZIP，却将
抓取响应的原传输元数据一并带入替换响应。现在移除不适用的内容编码/校验器，
并按新 ZIP 设置 Content-Length；`project_context` 与 `annotation_versions`
仍按可选成员兼容合同测试。这个修正针对合成响应，不改变应用导入逻辑。

上述均为浏览器测试夹具修正，不增加本机 CI 执行；新的完整 exact-source
GitHub Actions 结果仍待确认。失败 run 不产生可部署镜像，不部署。

### 第二轮 CI 阻塞 — 2026-11-03

修复提交 `f9d65d384f814bc79bfb49b3db859ed844ae6178` 的 run
`41580801427` 在 API gate 通过后，设置构建、Web typecheck 和性能比较
构建均被一个共同 TypeScript 错误阻断：锁定版本的 Playwright `APIResponse`
只有 `headers()`，没有 `allHeaders()`。性能比较未得到候选测量结果，不能视为
性能回归或通过。现已改用受支持的 `headers()`；不运行本地 CI，等待新一轮完整
GitHub Actions。当前仍无新镜像、无部署。

### 第三轮 CI 阻塞 — 2026-11-03

完整 run `41584161914` 对应精确 SHA `8d1b8d29037e83685a9aaa4594ddfb7f767bd3ae`。
API、settings、reading-performance comparison 通过；Web focused online/security
为 **42/45**，失败 gate 阻止 release image build 与 artifact inspection。

三项失败分别处理如下：

1. 富 Markdown 浏览器测试改为检查 callout summary 可见且文本精确为
   “展开提示”；移除对 plain Markdown 标题必须嵌套 `<strong>` 的错误结构假设，
   不改变渲染。
2. Reader 在拖动期间有意暂停 IntersectionObserver 加载。释放时原来只查缓存
   visibility ref，可能漏掉拖动期间尚未回调的边缘哨兵。现在按拖动起止位置确定
   方向，并在释放时重新读取 root/sentinel 几何，在现有 45% 预取范围内调用既有
   加载 action；拖动期间仍不扩展窗口，既有加载与窗口状态 guard 不变。
3. Source Editor 合同测试原来匹配已移除的旧选择器。复核真实组件后，浮动编辑器
   本身没有 `data-testid="floating-source-workspace"` 或 dialog role，其内部
   `data-source-editor-shell="true"` 才是稳定边界。快捷键目标筛选现保护这个 shell
   以及 ARIA textbox，并让合同测试验证当前 helper 和调用点。

这些跟进修改尚未执行本地测试/CI；必须以后续精确 SHA 的完整 GitHub Actions
通过才能接受。失败 run 不产生可部署镜像，不部署。

### 第四轮 CI 阻塞 — 2026-11-03

精确提交 `bcbdda16bf69464311863ceb4dd5f6aca0248cc1` 的 run
`41598513621` 中，API passed；Web focused online/security **43/45**，
settings 与 reading-performance comparison passed，release image/artifact
steps skipped，完整 CI 终态为 failure。

失败一：Reader drag 测试已看到 pointer-release 后产生一次 next-window 请求，
但状态变为 `next:cancelled:direction`。证据快照显示方向在加载转换中变成 up；
release handler 根据拖动起止滚动位置选择 down，却未将该完成手势同步回
`scrollDirectionRef`，因此加载 guard 仍读取旧方向。修复保留拖动起止净位移
方向，在启动边缘加载前用该方向提交一次用户 intent。拖动期间的
布局/几何补偿 scroll 事件不再伪装为用户方向变化；现有加载状态和
complete-turn/window generation guard 保留。既有拖动回归新增 settled direction
断言，原有请求、settlement 和单次加载断言不变。

失败二：AI Rich Markdown 卡片包含外层布局与内层文本两个嵌套 `<div>`，
两者都会被 renderer 标记为 safe HTML block。测试却把总 wrapper 数硬编码为 1。
现在改为查找含卡片目标链接的 HTML block，并验证其中图片的可访问名称；
后者同时适配原生图片与加载失败后的 `role="img"` 替代内容，不错误要求保留
已被替代的 `<img>`。原生 details、fallback 与禁止嵌套链接的断言保留，无安全
策略或 renderer 行为放宽。

本轮修正没有运行本地 CI；必须等待新的精确 SHA 完整 GitHub Actions 与 release
artifact checks 才能接受。当前无可部署镜像、未部署。

### 第五轮 CI 阻塞 — 2026-11-03

精确提交 `9621b6e9821b9f96c55254fbce59ecc70c8f45f4` 的 run
`41613950618` 中，上一轮 focused online/security 已 **45/45**，Share focus
**2/2**，API 与 reading-performance comparison passed。新的 Web 失败位于
后续 Source Editor/mutation gate：**109 passed / 1 failed**；后续七个 Web gate
未验证，不能宣称完整 CI 通过。

375px 的首屏正文故障后索引恢复夹具仍直接查找“阅读导航”，但当前移动端入口位于
“更多 → 阅读工具 → 阅读导航”；失败快照中只有“更多”，不存在独立导航按钮。
现在通过实际工具 sheet 选择导航，并检查工具 sheet 被替换。原有定位读取、旧错误
退出、同一 Reader DOM、首次内容标记、请求计数和阅读位置保存断言全部保留。

同类静态复核发现后续 default-PWA 的离线 Reader 375px 夹具也直接查找导航按钮。
该夹具复用已有 `openReaderHeaderAction`，把章节操作限定到导航 sheet，并按
`navigateFromNavigationSheet` 的现有成功合同断言自动关闭，不再点击已消失的关闭键。
这是源码复核发现的同类夹具缺口，不是该失败 run 已运行或通过的测试。

本轮仅修改浏览器测试与证据记录，不改产品、接口、超时、skip、retry 或发布门禁；
不运行本地 CI。提交现有 `master` 后触发新的精确源码 CI，不等待结果、不部署。

### 第六轮 CI 阻塞 — 2026-11-03

精确提交 `e0c0f581f334af9810c59944c54aefabb71bb242` 的 run
`41620114844` 中，focused online/security **45/45**、Share focus **2/2**，
API、settings 与 reading-performance comparison passed。上一轮 375px
Reader 恢复夹具已通过。Source Editor/mutation 仍为 **109 passed / 1 failed**，
但失败已经变为搜索日期快速编辑与历史恢复，不是移动导航。

失败发生在前进/后退后刷新并打开筛选时：全页面的 `getByLabel("From")`
严格匹配到两个 date input，两者都保留预期日期；错误可访问性快照只有一组
可访问的日期控件。现有 SearchWorkspace 源码也只声明一组日期字段。
因此此次失败是全局 label 选择器包含非可访问副本的歧义，不是日期丢失。
证据未提供该测试的 trace，无法仅凭快照确认副本由哪一个框架生命周期生成；
不将推测写成产品根因或宣称修复了用户日期问题。

修正：将日期与其他筛选校验限定到当前可见的 `global-search-filters` 面板，
在初次进入、刷新后、清除筛选再后退时明确校验只有一个可见面板。
不使用 `.first()` 任取控件；两个可见面板仍会触发唯一性失败。
同文件相邻的分页/日期焦点用例同步采用这个范围。快速编辑的双日期值、
焦点、完整 URL、逐次前进/后退、刷新后角色/类型/状态以及清除筛选断言保留。

本轮仅静态检查与 `git diff --check`，不运行本地测试、构建或 CI。
后续七个 Web gate 仍未验证，release image/artifact jobs skipped。
修正提交现有 `master` 后派发新的精确源码完整 CI；按用户要求不等待结果、
不部署，也不纳入已有的本机 `tsconfig.tsbuildinfo` 修改。

### 第七轮 CI 阻塞 — 2026-11-03

精确提交 `96a65cf8c3b14779cec2d41ef0bc9af201a9ba15` 的 run
`41626975020` 已通过 Source Editor/mutation **110/110**，包括上一轮搜索
日期/历史用例。前十个 Web gate 均通过：cleanup **6/6**、upload atomicity
**18/18**、image viewer **31/31**、PDF **13/13** 也首次在本批完整路径验证。
失败推进至 default-PWA：**183 passed / 4 failed / 760 flag-skipped**。
API 与 reading-performance passed；检查时 settings 仍在运行，后续 auth/
negative-PWA 未执行，不宣称全量通过或有可部署制品。

1. **320/375px 专注目录切换，两项失败：产品回焦竞争。**
   CI trace 记录 Escape 关闭索引、索引触发器恢复焦点后，测试立即 focus 章节
   触发器并 Enter，结果却重新打开索引；没有发出 `/toc` 请求。
   本机安装的 Radix FocusScope 源码明确用 `setTimeout(..., 0)` 延迟卸载回焦，
   与 frame 的同步回焦重复；旧 sheet 可以抢走已经交给新控件的焦点。
   现在共享 MobileReaderSheet 发现外部已连接焦点拥有者时，取消自身及默认
   回焦；body/失效节点/仍属关闭内容时仍按既有合同恢复 opener。Viewer 优先
   拦截规则保留。不是给测试增加等待或去掉 `/toc` 请求、正文身份/几何检查。
2. **1440px 批注项目与排序连续筛选，一项失败：产品丢条件。**
   CI 报错中的最终 URL 保留 attention 与 sort，却丢失刚选择的 project_id。
   `useCollectionView` 每次从 render 的 searchText 创建参数，再异步
   router.replace；上一导航未完成时，第二次编辑基于旧参数覆盖第一次。
   修正复用已有搜索页的原生 History 集成，从当前同步 URL 合成条件，
   以 replaceState 保持原有历史替换语义；分页与过滤重置边界不变。
   这个共享修正同时覆盖收藏。旧 route 回调不得把已离开的页面重新导航回来。
   现有 375/1440px 夹具在双编辑期间阻挡可选 RSC 导航，并增加完整 URL、
   下拉值与 summary API 范围校验，不等待第一导航完成来掩盖竞态。
3. **批注失败后页码钳制，一项失败：测试 alert 歧义。**
   真正失败提示与 Next.js route announcer 都具有 alert role。
   现在按批注失败文本限定唯一错误面板，在该面板点击 Retry，检查错误退出；
   失败期间不钳制、成功后回首页且保留 query/type 的断言全部保留。

新增七个 collection hooks 源码用例，覆盖两个入口同 render 连续编辑、
清除/分页、历史恢复/旧 route 拒绝及失败到成功的页界恢复；在现有 sheet
测试增加三个回焦归属用例。只编写、不在本机执行；新测试不是已通过证据。
本轮只做静态复核和 `git diff --check`，不改变 timeout/skip/retry/CI 门禁。
保留既有 `tsconfig.tsbuildinfo` 修改，不纳入提交；现有 `master` 提交后
派发完整精确源码 CI，不等待结果、不部署。
