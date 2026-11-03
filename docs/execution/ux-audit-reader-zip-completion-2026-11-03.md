# Reader 与 ZIP 计划完成度复审 — 2026-11-03

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
