# 全站 UI/UX 审查与改进 · 2026-10-04

## 范围与证据

这是 Context/设置发布 `0219fd5` **之后**的新一轮审查。面向使用电脑或手机保存、查找和继续阅读对话的普通用户，也覆盖管理员与离线入口。优先避免输入丢失、错误导航、失败被伪装为空数据和操作无法触达；沿用安静阅读工作台的纸色、石墨、海绿及现有组件。不会添加维护提醒、模型调用、候选/采用流程或改变分享授权。

初始证据：同版本本地 Web、隔离 PostgreSQL/API、合成项目与对话；浏览器测量 1440×950、375×800，以及短屏 375×400。请求故障通过浏览器注入 503；成功与持久化验收将使用真实 API。浏览器基线记录在 [evidence](ux-audit-whole-site-2026-10-04-evidence/)，包括 JSON 测量与截图。基线脚本通过表示**缺陷已复现**，不表示产品验收通过。之前两次脚本因定位/清理假设错误中断，不计通过。

审查初始已实测新建、项目设置、搜索、任务请求失败、文件请求失败与触屏项目菜单。其余条目基于实际源码，明确标为代码证据，未将推断写成实测。该时点 Share、管理员、离线、导入、源码编辑以及 768px、深色、中文、键盘验收尚待补齐；上一发布的测试不能代替本轮覆盖。无生产数据截图、凭据或真实业务 ID。

## 优先结论

新建对话按 Escape 丢失输入，最先处理。项目设置在短屏上标题不可见，Tab 可离开弹窗。全局搜索的“全部”实际上回到未归档，而“搜索”按钮可能直接跳到第一条结果。多个请求失败界面显示空数据，用户难以判断资料是否丢失。手机项目管理入口透明，任务摘要又可无限堆叠，挤占阅读空间。下列 18 项按独立用户问题计数，不按翻译字符串、按钮或文件拆分；部署前的设置精简不计入。

## 问题清单（实施前快照）

路径均相对 `apps/web/`，行号指发布基线，后续实现可能移动。类型均为缺陷，VIS-01 同时包含布局改进机会；S/M 是当前组件范围的工程估计。

| ID / 维度 | 严重性 / 可信度 | 位置及证据 | 用户后果与具体修复 | 工作量 |
|---|---|---|---|---|
| FORM-01 输入保护 | High · Observed (code + measured) | `features/conversations/new-conversation-dialog.tsx:31`，Escape 后重开正文为空；message-insert 与 project-settings 有相同关闭路径（后两者初始仅代码） | 误触丢失编写内容。统一脏表单退出确认；提交时锁定关闭及编辑，防重复提交，失败保留输入。 | M |
| A11Y-01 弹窗可达性 | High · Observed (measured + rendered) | `features/projects/project-settings-dialog.tsx:46`；375×400 时 y=-85、高485；Save 后 Tab 离开弹窗 | 手机标题/关闭入口被裁切，键盘操作背景。复用 focus hook、可滚动正文与固定页脚，焦点回到入口。 | S |
| DATA-01 项目外观真实性 | Medium · Observed (code); rendering Inferred | `project-settings-dialog.tsx:67` 接收任意图标名；`project-sidebar.tsx:699` 固定 Folder | 保存的图标/颜色无实际作用。提供有限具名图标选择、预览；侧栏与项目/归档使用实际配置，未知旧值兼容。 | M |
| NAV-01 项目操作入口 | High · Observed (code + measured) | `features/projects/project-action-menu.tsx:30`；触屏入口 computed opacity=0，菜单无方向键处理 | 手机用户找不到设置/归档。触屏显示入口，菜单初始焦点/方向键/Escape/Tab可用，菜单不能被侧栏裁切。 | M |
| STATE-01 整理操作恢复 | High · Observed (code); failure rendering Inferred | `conversation-list.tsx:131`、`project-conversation-list.tsx:115` 排序无 catch；project-action-menu 归档、archived-project-list 单个恢复缺少错误反馈 | 整理失败似乎没发生，无法确认服务器顺序。保留原列表，显示错误及恢复操作，提交期间禁止重复，归档列表读取可重试。 | M |
| NAV-02 搜索旧结果跳转 | High · Observed (code); race Inferred | `features/search/sidebar-search.tsx:35`、`conversation-search-panel.tsx:90`；输入变化后 debounce 前仍可 activate 旧 items，无 IME guard | 快速输入或中文选词可能打开旧匹配。只激活与当前输入一致的结果；空结果不产生负索引；输入法 Enter 不触发导航。 | M |
| STATE-02 搜索失败恢复 | High · Observed (code + measured) | `search-page.tsx:98` 同时显示失败与空结果，Retry=0；另两个搜索无 error 分支 | 用户把连接失败理解为内容不存在。分离加载/失败/空数据，真实重试并保留可辨识的旧结果。 | M |
| FILTER-01 全部范围失效 | High · Observed (measured) | `search-page.tsx:59` 删除所有 all 参数，但 status 默认 active | 无法搜索全部归档范围。按每个字段的真实默认值编码，保留 status_scope=all，验证真实归档结果。 | S |
| VIS-01 搜索筛选占屏 | Medium · Observed (rendered) | `search-page.tsx:88`，手机六项筛选始终展开；empty 建议清除但无操作 | 查找结果被挤到屏外。可展开紧凑筛选，显示活动数、一键清除且保留关键词；日期倒置就地说明。 | M |
| NAV-03 搜索命令与历史 | High · Observed (code + measured) | `search-box.tsx:19` 相同 query 的 submit 调用 openSelection；initialQuery 只用于初始 state | 点搜索却离开页面；后退时输入与结果不符。按钮始终搜索；只有显式方向键选择后 Enter 打开；URL 改变同步输入。 | M |
| A11Y-02 搜索结果顺序 | Medium · Observed (code); keyboard effect Inferred | `search-results.tsx:9` 按类型重排；search-page 仍按 API 顺序导航 | 上下键跳来跳去且当前项可能在屏外。使用同一视觉顺序；键盘选择时滚入可见范围并提供可感知的当前项。 | M |
| STATE-03 附件加载真实性 | High · Observed (measured + code) | `conversation-files-panel.tsx:68` 注入503后无alert、无retry；export-panel 同类失败默认为0 | 用户以为附件丢失或不会导出。未知数量显示未知，失败可重试，不能显示空文件假结论。 | S |
| ACTION-01 附件操作反馈 | High · Observed (code); failure rendering Inferred | `conversation-files-panel.tsx:80,85,174`，改名/移除无 onError，原生 prompt/confirm，复制未等待 | 无法确认操作是否成功，批量部分失败易漏处理。复用交互弹窗，操作锁、逐项结果、保留失败选择、真实复制反馈。 | M |
| STATE-04 导出状态中断 | High · Observed (code); failure rendering Inferred | `features/exporting/export-panel.tsx:48` task query 无失败分支，未知status按生成中处理 | 断网后看似永久生成。保留 job ID、显示状态连接错误、重查已有任务而非重复排队。 | S |
| STATE-05 任务失败恢复 | High · Observed (code + measured) | `import-task-monitor.tsx:39,60,69,146`；tasks503显示 No tasks are currently running；cancel/retry无可见错误 | 不知道任务还在运行，取消/重试失败静默。读取失败单独显示并重试，动作pending/error就地反馈，任务消失检查捕获错误。 | M |
| COPY-01 编写语言一致 | Medium · Observed (rendered + code) | `new-conversation-dialog.tsx:93` 英文账户标题“新建对话”；message-insert 同类硬编码 | 核心编辑按钮难以理解。两套编写表单的标题、角色、计数、错误、快捷键与按钮使用账户语言。 | M |
| VIS-02 任务摘要有界 | High · Observed (code + rendered desktop); mobile effect Inferred | `import-task-monitor.tsx:141,175` 渲染全部待审查扫描，0命中仍显示审查；截图侧栏8条重复 | 侧栏和手机底部可能被摘要占满，干扰阅读。非中心视图显示一个有界任务入口；0命中不称待审查，明细在既有任务中心。 | M |
| NAV-04 手机新建项目缺失 | High · Observed (code + baseline rendered) | `project-sidebar.tsx:646,681` 入口与表单均为 hidden/md 显示，手机项目标题旁无新建入口 | 手机用户只能浏览已有项目。恢复触屏入口和紧凑表单，增加可见取消，名称与按钮跟随账户语言。 | S |

## 实施顺序与低成本收益

1. FORM-01、A11Y-01、NAV-01：保护输入和基础可达性。
2. FILTER-01、NAV-03、NAV-02、STATE-02、VIS-01、A11Y-02：形成一致搜索流程。
3. STATE-03、ACTION-01、STATE-04、STATE-05、VIS-02：修复失败恢复及任务占屏。
4. DATA-01、STATE-01、COPY-01：配置实际生效、整理恢复、语言一致。

其中范围编码、附件失败分支、导出任务重试和弹窗滚动/焦点是高收益小改动。需真实 mutation 持久化、故障注入、键盘与屏幕检查后才记完成。

## 保留的设计

保留完整轮次与真实 Reader 锚点，Continuation 不是第二套正文。设置精简已经上线，不恢复介绍卡片。保留个人 Skill 及默认回退，Context 回传仍在对话内部。备份、分享、离线授权的权限与协议不因布局修改而扩大。现有归档和离线恢复功能不是重复新增功能的理由。

## 未证实的问题与后续证据

本轮尚无真实用户行为分析或可用性访谈，不推断放弃率。并非每个页面都必须改动；后续覆盖应说明未发现高价值问题的页面。大批量工具横向滚动属于待复现假设，不计入上述18项。深色任务文案的硬编码将随任务组件处理，但不单列凑数。真实用户自定义 Skill 的外部语义效果不属于本轮 UI 验收。

实施状态：18 项已实现。完整结果、失败尝试与后续复验见 [执行记录](../execution/WHOLE_SITE_UX_2026-10-04.md)。以下补充后续实测，保留上方审查时点的证据等级；未执行项目不计为通过。

## 完成结果与复查证据

18 项均已实现；最终新增浏览器专项 **14/14 通过**，包括真实写入后刷新、失败重试、
跨页搜索、八条独立扫描与手机创建/归档/恢复。完整 API **867 通过、4 跳过**；
离线 Context 两类包、分享焦点、源码上传原子性、任务中心与 DnD 的专项也已通过。
完整失败历史与非重叠计数见执行记录，不把失败修正前的运行或跳过算作通过。

| 已检查界面 | 最终结果及边界 |
|---|---|
| 新建、插入、项目设置 | 关闭保护、失败保留、提交锁、键盘焦点与短屏固定操作区通过；六种宽度/语言主题组合均有实际持久化。 |
| 项目、最近、归档 | 触屏管理及创建恢复、图标/颜色生效、归档恢复失败路径与 DnD 实测。排序异常反馈另有代码审查；未宣称穷尽所有拖动组合。 |
| 搜索 | 50→60 条消息分页、角色筛选→30、无关范围清除、日期错误/焦点、返回历史、IME 和旧结果保护通过。 |
| 文件、导出、任务 | 请求失败/未知数量、保留改名草稿、批量失败选择、同一任务重查、单行任务入口和真实忽略持久化通过。 |
| Reader、源码、导入 | 三宽度视觉复查、浅深色及中英文账户；源码13项原子上传回归通过。完整轮次/锚点及导入边界保持。 |
| 用户设置、Root 管理 | 本轮认证集成已覆盖设置展示6项、分享管理5项、管理员4项；不以旧线上截图代替新源码证据。 |
| 公开 Share、登录 | 三宽度视觉复查。公开 Share 按分享者配置显示，不随匿名浏览器深色偏好改写；登录截图为匿名英文浅/深色。 |
| 离线资料库/Reader | 三宽度查看空资料库及已有列表；实际下载、断网重载、Context 再导出通过。UUID过期锁定用独立认证场景验收。 |

已逐图查看：

- [375px 全站](ux-audit-whole-site-2026-10-04-evidence/surfaces-375-after.png)、[768px 全站](ux-audit-whole-site-2026-10-04-evidence/surfaces-768-after.png)、[1440px 全站](ux-audit-whole-site-2026-10-04-evidence/surfaces-1440-after.png)。九类界面 × 三宽度 × 两套外观共54帧；界面拼图保留图名。
- [短屏项目设置](ux-audit-whole-site-2026-10-04-evidence/project-settings-375-false.png)：正文滚动后页头/页脚仍可用，不遮挡输入。
- [手机搜索](ux-audit-whole-site-2026-10-04-evidence/search-mobile-after.png)：结果优先、筛选按需展开，图中是保留结果同时重查的状态。
- [文件操作结果](ux-audit-whole-site-2026-10-04-evidence/files-dark-after.png)、[有界任务入口](ux-audit-whole-site-2026-10-04-evidence/tasks-mobile-bounded.png)。
- [断网重载的缓存 Reader](ux-audit-whole-site-2026-10-04-evidence/offline-reader-after-reload.png)：正文继续可读；该故障截图也保留现有连接错误表现，不当作无错误正常态。

保留原有布局的页面包括公开 Share、登录、Reader 和离线资料库：本轮没有为了凑数
重做它们。仍可进一步改善的点是离线资料库在部分连接失败时直接显示
`CONNECTION_FAILED`，以及匿名页面语言/主题的更多组合；前者不影响已缓存正文及
本次导出实测，但更友好的错误文案和重试入口值得后续单独修正。两者均不计入18项完成数。
没有真实用户访谈，不声称这些改动已经测得留存率或任务耗时改善。
