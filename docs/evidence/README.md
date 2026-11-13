# 事实证据索引

## CI阻断及夹具修复 — 2026-11-13（本地通过，完整CI仍待通过）

[源码合同/扫描收尾回执](reliability-2026-11-13/ci-focused-verification.json)
保留43436935411在50分钟后读取失败、单次取消、三份官方诊断ZIP，以及
Settings取消前五项失败的链路。新PG红测11失败/3通过，修后相关39通过；
源码合同9及五个负对照、lint/typecheck通过。应用和原门槛未改，没有部署。
两项测试也在Web构建输入内，未继承旧构建；新548输入同依赖隔离构建通过，
source/copy漂移均0，本机Node版本与CI不同的边界保留。
负对照方法错误和PG路径守卫拒绝单独保留，不当作应用功能失败或成功证据。
[API CI端口兼容回执](reliability-2026-11-13/ci-api-port-verification.json)记录
派发前guard拒绝5432、Node18通过/1失败，修后既有CI脚本62与相同PG39
在独立65438通过。只对齐临时数据库，不放宽seeder或任何门槛；
补入五项CI输入后共1388项，548项已构建Web输入不变，完整CI尚未派发。

[夹具回归与取消回执](reliability-2026-11-13/ci-fixture-verification.json)
保留43424349497的真实失败、用户要求取消、两份官方质量ZIP摘要与四项夹具
红测；API/PG34通过/4项Windows跳过、原编辑器99及Unicode20次重复通过。
应用/工作流/部署未改，原超时/信号退出门槛不变，不继承失败CI为发布通过。
当前结论仍只维护[同一台账](../system/SMALL_HOST_IMPROVEMENT_STATUS.md)。
[夹具修复派发回执](reliability-2026-11-13/ci-fixture-dispatch.json)绑定
2ae0ed0与CI43436935411，记录新的50分钟首次读取边界，不是通过/部署回执。

[修复回执](reliability-2026-11-13/ci-repair-verification.json)关联原失败CI、
两条独立编辑器回退红测、最终99场景/20次picker重复/12扫描组、
Node2591、静态检查与548输入隔离构建。原失败与夹具超时保留；
没有放宽原门槛，没有将本机依赖/合成接口等同精确CI或用户验收。
当前结论只维护[同一台账](../system/SMALL_HOST_IMPROVEMENT_STATUS.md)。
[新派发回执](reliability-2026-11-13/ci-repair-dispatch.json)绑定829e1b7与
CI43424349497，记录50分钟首次读取边界；该run随后失败并按指示取消，
不是成功或部署证据，旧派发回执不覆盖。

## 用户任务中断恢复 — 2026-11-13（本地，未提交）

[增量回执](reliability-2026-11-13/owner-recovery-verification.json)记录实际
认证API/PG专项130、Node2503、mounted12、547输入隔离构建、1381项
验证输入前后无漂移及原缓存/旧证据保全。各组与旧结果有重叠，不累加为覆盖率。
首轮权限/断点/状态失败、旧PG夹具冲突、时间偏移断言和延迟启动会话失败
均保留哈希/分类；新截图只含合成内容。自建PG已停止，旧临时任务未动。
没有新提交、CI、生产访问或部署；当前状态和工作偏好仍在
[同一系统台账](../system/SMALL_HOST_IMPROVEMENT_STATUS.md)。

## 本地可靠性故障治理 — 2026-11-12

[机器回执](reliability-2026-11-12/verification.json)记录合成API、PG/真实
进程、组件浏览器、静态与隔离构建检查点、源码哈希和未验收边界。
仅合成内容；无真实对话、Cookie、凭据或生产文件。
不是提交、CI或上线回执；唯一状态台账在
[系统总览](../system/SMALL_HOST_IMPROVEMENT_STATUS.md)。
后续[管理员恢复增量回执](reliability-2026-11-12/admin-recovery-verification.json)
以本地提交`a0faa85`为基线，保留实际PG/API44、Node2502、mounted12、
547输入隔离构建与失败复现；该增量尚未提交或发布，不覆盖上一批回执。

## 生产队列恢复及代码补防护 — 2026-11-12

[脱敏恢复/回归回执](small-host-2026-11-11/server-queue-recovery-2026-11-12.json)：
只取消核验后的辅助进度语句，导入回滚保留两个原文件且实际SHA一致，
两个导出完成；活动任务/锁等待清零，心跳恢复。未重启、部署或清理资料。
新增心跳跳锁本地专项91通过/4 Windows信号跳过，不属于旧K/L CI。
[总览与后续边界](../system/SMALL_HOST_IMPROVEMENT_STATUS.md)。


## 收尾失败 / 原任务重试 / 可选本机记录 — 2026-11-11（未部署）

[M/N/O本地验证](small-host-2026-11-11/import-mno-verification.json)：
未知COMMIT保全、清理不覆盖主错误、准入释放、canonical重试读取隔离及
浏览器存储拒绝时继续正确收尾。API229通过/2可选外部资料跳过、Node2472、
静态、mounted12+12及544输入构建；包含失败复现及测试包装错误，未删失败记录。
两张375中文/1440英文截图是实际Panel的归档读取恢复，明确保留合成夹具边界。
[K/L精确CI核验](small-host-2026-11-11/ci-kl-acceptance.json)记录六job成功、
四份质量制品哈希和实际摘要、64+16非空帧文件；旧baseline失败及各门禁skip
保留，不冒称零跳过。镜像仅CI检查，未独立下载；此CI不覆盖之后M/N/O源码。

## 首次上传恢复 / 阅读诊断 — 2026-11-11（未部署）

[K源码及分层验证](small-host-2026-11-11/import-upload-verification.json)：
身份绑定、慢上传、只读核对、暂放/原请求重试和明确本页释放。
最终静态/Node与较早API/PG/mounted检查分列；C盘容量预检失败保留。
用户批准E盘后[最新mounted12](small-host-2026-11-11/import-kl-mounted-final.json)
含粘贴恢复通过，375中文/1440英文合成截图已检查；
[精确隔离构建及扩展验证](small-host-2026-11-11/import-kl-build-final.json)
记录544输入、API112（含重复）、来源测试23及新PG正常停止。
本地整站服务启动策略拒绝未绕过；随后K/L精确CI结果见上方独立回执。
[J精确CPU诊断](small-host-2026-11-11/reader-diagnostic-j.json)保留原CI失败
及诊断九组原始指标摘要；未复现不等于已修，不替代不带Profiler的发布门禁。
[L已知任务/目录读取](small-host-2026-11-11/import-read-verification.json)记录
有限等待、原任务恢复、畸形结果保护与真实TSX回调验证；后续Settings精确结果另列。
[整批提交前核验](small-host-2026-11-11/import-kl-submission-audit.json)补充
Node2434、静态、544输入精确构建、依赖策略与前轮CI失败核对。
warm解析计数不再冒用渲染次数；这不证明Reader长任务已修复。

## 小机器接续写入恢复 — 2026-11-11（合成、未部署）

[J整批源码/测试摘要](small-host-2026-11-11/context-write-verification.json)：
只读结果核对、已确认写入/失败刷新、原字节恢复、认证/对话隔离；
375/800/1440中英明暗12组及两张合成截图。包含前轮Settings失败原因，
不把本地组件适配器或此前成功CI当作本次整站/生产验收。

## 可恢复操作发布与授权清理 — 2026-11-11

[脱敏机器回执](release-2026-11-11/recoverable-operations-deployment-summary.json) /
[发布记录与18项验收](../execution/RECOVERABLE_OPERATIONS_RELEASE_2026-11-11.md)：
精确3564cbf/CI42828329240、官方制品、原稳定性/恢复/内存证据，
生产验收、A–D清理及最终单份备份。零错误复核警告和未验证项未隐藏。
[原合成证据](recoverable-operations-2026-11-10/README.md)及失败批次不覆盖；
下方“尚未CI/部署”均为其日期的历史检查点。

## 阅读交互 / 缺附件 ZIP 已发布 — 2026-11-09

[脱敏机器回执](release-2026-11-09/reading-interaction-zip-deployment-summary.json)
与[发布记录](../execution/READING_INTERACTION_ZIP_RELEASE_2026-11-09.md)
绑定865b0a6、CI42594459199、五份制品、19组新增Reader、原稳定性轨迹、
三份备份和独立运行态复核。保留两轮失败、首次维护保护中止/恢复。
以下本地候选/旧生产均是历史检查点，真实用户资料仍未自动回放。


## 阅读交互 / 缺附件 ZIP — 2026-11-09（本地候选）

[合成证据](reading-interaction-zip-2026-11-09/README.md)保留Reader交互/公式
逐帧数据、Viewer焦点回归与截图；只含合成内容。完整Next隔离构建通过，
早期跨盘失败留档；CI/PWA/生产仍未验收。后续授权与审查修正另见
[完成度审查](../execution/ux-audit-reading-interaction-zip-2026-11-09.md)，
不能把原本地证据改写成新发布已经通过。

## 有界 ZIP 与阅读工具发布 — 2026-11-09

[脱敏汇总](release-2026-11-09/bounded-zip-deployment-summary.json)与
[发布回执](../execution/BOUNDED_ZIP_IMPORT_RELEASE_2026-11-09.md)
绑定d61b9c6、CI42522644855、五份官方制品/五例内存、0060迁移、
新停写备份及独立运行态/保全核验。原失败与静态证据仍是历史检查点，
未改写成运行成功；不包含用户正文/ID、Cookie、凭据或原始应用日志。


## 阅读工具审查修正 — 2026-11-08（仅静态）

[检查摘要与清单](reading-tools-audit-fixes-2026-11-08/README.md)记录七项
定向修正后的 lint、非增量类型检查、语法检查和候选源码哈希。
应用测试、浏览器/视觉验收仍未运行；证据检查点没有提交、CI 或部署。
随后用户仅授权一次本地提交，不改变上述验收边界。
修正前的审查证据保留，不用旧版本绿色结果代替本候选验收。

## 独立授权存储清理 — 2026-11-08

[脱敏清理汇总](storage-cleanup-2026-11-08/summary.json)与
[回执](../execution/KING_STORAGE_CLEANUP_2026-11-08.md)记录精确授权范围、
92%→66% 容量变化、最新备份/镜像包复验、63 份元数据保全及运行态不变。
当前应用仍为 `897ba78`，但只留最新备份与镜像，不保留直接本地回退。
原部署/CI 证据不变；系统日志、业务资料和卷未删除。

## 历史发布 — 图片展示与阅读稳定性 — 2026-11-06

[脱敏汇总](release-2026-11-06/image-reading-deployment-summary.json)与
[发布回执](../execution/IMAGE_READING_STABILITY_RELEASE_2026-11-06.md)
绑定精确 `9cf235f`、CI `42217357688`、五份制品、64 条阅读轨迹、
新停写备份、0059 不变及运行态独立复核。不含用户正文或凭据。
部署回执保留当时四份备份/十六个标签的事实；随后单独授权的
[清理汇总](release-2026-11-06/image-reading-cleanup-summary.json)记录仅移除
两份旧备份和八个旧标签、保留两份重验备份及当前/直接回退。
用户资料、数据卷、镜像归档与原发布证据未删除，未重传用户 ZIP。

## 上一发布 — 恢复一致性 — 2026-11-06（历史）

[脱敏汇总](release-2026-11-06/recovery-deployment-summary.json)与
[发布回执](../execution/RECOVERY_CONSISTENCY_RELEASE_2026-11-06.md)
绑定精确 `67e6336`、CI `42043078359`、制品、停写备份、0059/52 项回填
和运行态独立复核；不含用户内容、凭据或原始应用日志。

## 上一发布与知识收尾 — 2026-11-04（历史）

[小内存 ZIP 脱敏发布汇总](release-2026-11-04/small-zip-deployment-summary.json)
与[发布回执](../execution/SMALL_ZIP_MEMORY_RELEASE_2026-11-04.md)绑定精确 CI、
OCI/config 哈希链、运行版本、备份及已授权清理；原用户 ZIP 尚待显式重试。
[知识收尾](../execution/KNOWLEDGE_CLOSEOUT_2026-11-04.md)记录文档/规则/工作区
审计、清场预览、汇报后授权的本地安全清理和保全核验；
本轮没有新增发布或生产删除，官方制品与测试证据仍保留。

## 图片展示比例 — 2026-10-23（已部署）

[发布证据](image-display-scale-release-2026-10-23.json)绑定精确源码、每次 CI 的
50 分钟等待、五项全绿、独立镜像/源码核验、停止写入备份和运行时验收。
[合成界面证据](image-display-scale-2026-10-23/receipt.json)保留本地与 CI
验证边界；不等同于安装版外部客户端、生产认证界面或长期压力验收。

## 表格收尾与备份读取器 — 2026-10-21（仅本地）

[表格收尾](../execution/ux-audit-table-closeout-2026-10-21.md)复核既有 20 份源码
与 29 份证据，未追加表格改动。[运维修复](../execution/OPS_BACKUP_READERS_2026-10-21.md)
及相邻制品区分基线 Compose one-off 拒绝、测试 fixture 更正、最终 67 通过/
1 Windows flock 跳过；真实 shell 不等于真实 Docker/cgroup/数据库恢复验收。

## 大表 Markdown 单行输入试验 — 2026-10-21（已撤回）

[试验与更正证据](../execution/ux-audit-table-raw-input-2026-10-21.md)保留 profile、
试验功能绿灯和实际事件计数：React 回调不携带 `inputType`，新增路径零次调用。
新增代码/专属测试已撤回，20 摘要恢复横线修复检查点；无时延改善或 OOM 验收声明。

## GFM 横线内容表格误拒绝 — 2026-10-21（仅本地合成数据）

[修复记录](../execution/ux-audit-table-delimiter-content-2026-10-21.md)和
[29 项制品清单](table-tool-delimiter-content-2026-10-21.json)保留
实际渲染成功/工具失败的基线与修复后 30 组 GFM 输出等价、桌面 Apply/Undo 和
375px 触摸。最终 122 专项、76 Chrome、69 文件/1,513 无服务回归以及 lint、
typecheck/build 均通过，撤回试验后重跑六项门禁的 20 摘要不变；无 CI、推送或部署。

## 表格输入与内容保真 — 2026-10-21（仅本地合成数据）

[输入续查证据](table-tool-input-layout-2026-10-21.json)绑定最终 20 个未变化的
源码/测试摘要、六项门禁和 24 份相邻制品：117 专项、1,508 无服务回归、
72 Chrome 场景。早期诊断摘录不冒充完整源码绑定；未保留的展示试验与最终共享
渲染链分开记录。Unicode/焦点修复通过，大表长任务仍存在，不接受服务器 OOM。

## 大表首尾与焦点 — 2026-10-21（仅本地合成数据）

[首尾导航证据](table-tool-page-navigation-2026-10-21.json)绑定缺少入口的基线、
首轮 BODY 焦点失败及最终 30 份相邻制品。六项门禁通过：111 专项、1,502 无服务
回归、67 Chrome 场景，20 摘要不变。桌面与真实 320/375px 浏览器触摸上下文可
核对末行编辑和一次撤销，不等同于物理真机验收；分段性能观察仍有长任务。

## 表格解析等待与自适应输入 — 2026-10-21（仅本地合成数据）

[解析等待证据](table-tool-pending-parse-2026-10-21.json)绑定真实 Chrome 中
18 场景后失败的旧 Apply 状态、修复后 64 场景和六项本地门禁。111 专项、
1,502 无服务回归、20 个源码/测试摘要及截图均可核对；未接受服务器资源行为。
[前一轮自适应输入](table-tool-adaptive-preview-2026-10-20.json)单独保存其 62 场景
检查点、增量/分页试验与解释边界，不将顺序性能观察归因为某一个微优化。

## 表格工具双向编辑 — 2026-10-20（仅本地合成数据）

[字面反引号证据](table-tool-code-spans-2026-10-20.json)绑定合法表格误拒绝的
修复前渲染/转换器输出、70 通过/4 失败检查、线性匹配与双向编辑修复。
111 专项、62 Chrome、1,502 无服务回归和六项本地门禁通过；900 合成 GFM
输出一致，20 源码/测试摘要不变。截图、日志和仍有长任务的独立性能观察随
[审查](../execution/ux-audit-table-code-span-2026-10-20.md)保存，不声称资源问题全部解决。

[HTML 字面单元格证据](table-tool-html-cells-2026-10-20.json)绑定原误拒绝、统一校验、
实际桌面 Apply/Undo 与 375px 触摸修正，保留失败和中途 fixture 错误。
106 专项、61 浏览器、1,497 无服务回归与六项门禁通过；20 源码/测试摘要不变，
截图、日志和输入诊断随[审查](../execution/ux-audit-table-html-cells-2026-10-20.md)保存。

[输入法按键证据](table-tool-input-composition-2026-10-20.json)绑定共享弹层错误关闭
的修复前失败、受信任 Chrome CDP 前后事件和相邻持久化截图/日志。103 专项、
59 浏览器、1,494 无服务回归及六项门禁通过，20 个源码/测试摘要不变。
见[审查](../execution/ux-audit-table-input-2026-10-20.md)，不宣称物理候选窗口验收。

[恢复动作证据](table-tool-recovery-actions-2026-10-20.json)记录移除无表格时的
不可操作 Apply、保留已识别草稿保护，以及对话框的恢复说明关联。基线在 56 场景
通过后失败；最新 57 浏览器、83 专项、1,491 无服务回归及六项门禁重新绑定。

[空状态证据](table-tool-empty-state-2026-10-20.json)绑定 56 场景后失败的基线、
空白禁用字段移除、禁用原因及返回焦点。中途错误手机截图的实际桌面尺寸与
最终真实 1440/375px 记录分别保留；最终 57 浏览器、83 专项、1,491 无服务回归、
六项门禁及 18 个源码/测试摘要见[记录](../execution/TABLE_TOOL_EMPTY_STATE_2026-10-20.md)。

[GFM 上下文证据](table-tool-gfm-context-2026-10-20.json)绑定实际渲染链探针、
三处 HTML 语义差异、源坐标映射、复用/限额，以及 32 场景通过后失败的浏览器
基线。最终 83 专项、56 浏览器、1,491 无服务回归与六项门禁、18 个受影响
源码/测试摘要和修复后视觉探针分别绑定，见
[续查记录](../execution/TABLE_TOOL_GFM_CONTEXT_2026-10-20.md)。

[字面块阶段证据](table-tool-literal-context-2026-10-20.json)绑定 HTML、CRLF 的独立
失败基线/修复、实际完整源码预览与 49 浏览器场景，以及最终六项门禁。
另列随后发现的 `textarea` 差异和新引入的合法引用表格误拒绝，不与其通过场景合并；
修复见后续 GFM 记录。见
[续查记录](../execution/TABLE_TOOL_LITERAL_CONTEXT_2026-10-20.md)，无全上下文或服务器验收声明。

[边缘控件证据](table-tool-viewport-edges-2026-10-20.json)绑定宽表/长表控件不可达
的独立失败、四边 CSS 定位及真实坐标点击/触摸与 hit-test、45 浏览器场景和六项
最终本地门禁。中途横屏测试假设错误另列，不记作产品失败或最终通过。
见[续查记录](../execution/TABLE_TOOL_VIEWPORT_EDGES_2026-10-20.md)，无服务器验收声明。

[代码上下文证据](table-tool-code-context-2026-10-20.json)绑定 5 个既有误判的
修复、相同 GFM 输出、冻结树复用/回退、列表缩进保真和 41 浏览器场景；
71 项专项、1,479 项无服务回归及 Web 门禁有独立回执。原失败与有限性能观察
分别保留，见[续查记录](../execution/TABLE_TOOL_CODE_CONTEXT_2026-10-20.md)。

[键盘与焦点证据](table-tool-navigation-2026-10-20.json)绑定跨页导航、四边新增
定位和 Shift+方向键选字的失败基线/修复、最终六项本地门禁；也明确列出 5 个
当时尚未修复的 GFM 围栏上下文差异，不把它们混入通过数。见
[续查记录](../execution/TABLE_TOOL_NAVIGATION_2026-10-20.md)。

[括号索引证据](table-tool-bracket-index-2026-10-20.json)绑定原嵌套图片重扫
小样本、线性索引修复、围栏扫描的深引用超时/修复、240,000 字符无效输入恢复，
以及最新 37 浏览器场景及本地
门禁。包含输入规模、样本、源码/日志摘要，不含用户正文；性能/验收边界见
[续查记录](../execution/TABLE_TOOL_BRACKET_INDEX_2026-10-20.md)。

[解析复用证据](table-tool-parser-reuse-2026-10-20.json)绑定不变文本回调更新时的
失败基线、解析复用和等待期保护、35 浏览器场景与最新本地门禁；脚本只包装真实
解析器进行计数/测试阻塞，不以替身渲染器通过测试。详见
[续查记录](../execution/TABLE_TOOL_PARSER_REUSE_2026-10-20.md)。

[长单元格证据](table-tool-long-cell-2026-10-20.json)单独绑定单元格展示预算、
40,000 字符保真、400-cell 页预算与 30 个浏览器场景，不改写前序检查点计数；范围与限制见
[续查记录](../execution/TABLE_TOOL_LONG_CELL_2026-10-20.md)。

[预览调度续查证据](table-tool-deferred-preview-2026-10-20.json)绑定 React deferred
预览、Apply 追赶门控、源码哈希、30 浏览器场景和本机五样本诊断；未证明稳定性能收益，
长任务仍在。详见[续查记录](../execution/TABLE_TOOL_DEFERRED_PREVIEW_2026-10-20.md)。

[内容保真证据](table-tool-content-integrity-2026-10-20.json)及同名截图目录绑定
公式/代码/引用修复、实际失败与测试适配边界；61 项专项、27 场景和完整门禁
不改写之前的 13/20/22 场景记录。详见[续查记录](../execution/TABLE_TOOL_CONTENT_INTEGRITY_2026-10-20.md)。

[大表输入证据](table-tool-performance-2026-10-20.json)单独绑定后续优化源码、
22 场景、完整门禁及前后四组本机观察；保留长任务和小样本边界，不覆盖原记录。

[真实工作区证据](table-tool-workspace-2026-10-20.json)和
`table-tool-workspace-2026-10-20/` 截图记录实际工作区/CodeMirror 的 20 场景，
包括新增失败基线、撤销/重做、嵌套快捷键和客户端保存 payload；
API、Next loader 等适配范围见[续验记录](../execution/TABLE_TOOL_WORKSPACE_2026-10-20.md)。

[本地表格证据](table-tool-editing-2026-10-20.json)及
`table-tool-editing-2026-10-20/` 截图绑定实际源码/测试与隔离 Chrome 组件验收。
没有账户、真实业务内容或外部服务；不宣称完整工作区、Reader/Share/Offline、
WCAG 或服务器资源验收。说明见[本地续改记录](../execution/TABLE_TOOL_EDITING_2026-10-20.md)。

## 最新 OOM 发布与清理 — 2026-10-19

[OOM 发布验收](oom-release-2026-10-19.json)记录 **50f6de4/0052**、
CI **39231559224** attempt 1、真实镜像摘要、轻量运行验收、备份保留与清理后复核。
包括实际失败和未执行项目，不含用户内容、身份或凭据。
完整解释见[发布记录](../execution/OOM_RELEASE_2026-10-19.md)。

## OOM 发布准备 — 2026-10-19（历史检查点）

[发布准备](oom-release-preflight-2026-10-19.json)分别记录完整 API 失败结果、
49 项独立复查、单次本机内存采样、Web/源码 head 与脚本控制流测试。
不是完整本地 release check 或生产验收通过；
说明见[发布记录](../execution/OOM_RELEASE_2026-10-19.md)。

## 本地 OOM 续查 — 2026-10-19（发布前的局部证据）

[索引分配续查](search-retention-2026-10-19.json)与
[压缩输入准入](compressed-admission-2026-10-19.json)分别记录本轮开始时的本地
快照对比、合成零/充足余量探针和输出等价性；不含真实业务内容或身份。
说明见[后续修复记录](../execution/OOM_SEARCH_GZIP_FOLLOWUP_2026-10-19.md)，
不是生产 RSS/低内存压力验收。

[正文保留与分配对比](server-body-retention-2026-10-19.json)只含合成规模、
源码哈希、分配/对象数量、格式等价性及测试边界。不是生产 RSS 或低内存压力验收。
完整解释见[本地修复记录](../execution/OOM_IMPORT_EXPORT_FOLLOWUP_2026-10-19.md)。

## 前一次功能发布 — 2026-10-19

[功能与导入稳定性发布](feature-release-2026-10-19.json)记录 f3b331a/0052 的
精确 CI 制品、受限维护、数据及只读运行验收；不含对话标识符、正文、Cookie 或配置值。
完整解释见[发布记录](../execution/FEATURE_RELEASE_2026-10-19.md)。

## 历史基线 — 2026-07-26

最后核验日期：2026-07-26
线上版本：`e752e9ddf25595c3f373977a1803956354ca71b0`

> 历史基线：本目录只表示 2026-07-26 的生产状态，截图中的旧标签、入口和布局不代表当前 UI。当前代码事实见 [PROJECT_STATE.md](../../PROJECT_STATE.md)，后续发布证据见 [execution/README.md](../execution/README.md)。

截图记录线上现状，不包含改进稿。生产会话标题、正文、标识符和 Share token 均不写入文本索引；图片中的主要私有内容区域已遮挡。

## 截图索引

| 编号 | 文件 | 页面/状态 | URL | 视口 | 身份 | 前置条件和事实 | 日期 | 脱敏 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PAGE-001 | [首页](screenshots/PAGE-001-home-main-desktop-redacted.png) | 在线主页面 | `/` | 1440x900 | 本地资料拥有者 | 直接访问；侧栏、对话/Project 标签和列表框架 | 2026-07-26 | 是 |
| PAGE-002 | [导入对话框](screenshots/PAGE-002-import-dialog-desktop-redacted.png) | 导入入口 | `/` | 1440x900 | 同上 | 打开导入；文件类型、多文件、预览/提交入口 | 2026-07-26 | 是 |
| PAGE-003 | [偏好](screenshots/PAGE-003-preferences-desktop.png) | 外观与语言 | `/` | 1440x900 | 同上 | 打开设置；主题、语言、阅读宽度 | 2026-07-26 | 是 |
| PAGE-004 | [Project](screenshots/PAGE-004-project-view-desktop-redacted.png) | Project 详情 | `/projects/[redacted]` | 1440x900 | 同上 | 从 Project 树进入；列表与选择入口 | 2026-07-26 | 是 |
| PAGE-005 | [归档](screenshots/PAGE-005-archived-desktop-redacted.png) | 归档管理 | `/archived` | 1440x900 | 同上 | 侧栏进入；归档列表 | 2026-07-26 | 是 |
| STATE-001 | [归档选择](screenshots/STATE-001-archived-selection-mode-redacted.png) | 选择模式 | `/archived` | 1440x900 | 同上 | 开启选择；全选、反选、清空、完成 | 2026-07-26 | 是 |
| PAGE-006 | [搜索空态](screenshots/PAGE-006-search-empty-desktop-redacted.png) | 全局搜索 | `/search?q=[synthetic]` | 1440x900 | 同上 | 使用无匹配合成查询；筛选与空结果 | 2026-07-26 | 是 |
| PAGE-007 | [在线 Reader](screenshots/PAGE-007-reader-desktop-redacted.png) | 长对话阅读 | `/conversations/[redacted]` | 1440x900 | 同上 | 打开已有对话；侧栏、正文、章节 TOC、操作轨 | 2026-07-26 | 是 |
| PAGE-008 | [批注工作区](screenshots/PAGE-008-annotations-workspace-desktop-redacted.png) | 批注浮窗 | 同上 | 1440x900 | 同上 | 打开批注；三个视图、筛选、拖动/缩放边界 | 2026-07-26 | 是 |
| STATE-002 | [批注管理](screenshots/STATE-002-annotation-manage-desktop-redacted.png) | 批注管理模式 | 同上 | 1440x900 | 同上 | 开启管理；全选、反选、清空、批量样式/笔记/删除 | 2026-07-26 | 是 |
| PAGE-009 | [Share](screenshots/PAGE-009-share-panel-desktop-redacted.png) | 分享面板 | 同上 | 1440x900 | 同上 | 打开 Share；scope、有效期、可选私有内容与管理项 | 2026-07-26 | 是 |
| PAGE-010 | [资料库](screenshots/PAGE-010-library-desktop-redacted.png) | 离线资料管理 | `/library` | 1440x900 | 同上 | 直接进入；壳状态、下载/删除、空间信息 | 2026-07-26 | 是 |
| PAGE-011 | [离线 Reader](screenshots/PAGE-011-library-reader-desktop-redacted.png) | 资料库阅读 | `/library?conversationId=[redacted]` | 1440x900 | 同上 | 打开本地副本；共享 Reader 框架和在线版入口 | 2026-07-26 | 是 |
| PAGE-012 | [移动首页](screenshots/PAGE-012-home-mobile-redacted.png) | 在线首页 | `/` | 390x844 | 同上 | 窄屏；正文不横向溢出 | 2026-07-26 | 是 |
| PAGE-013 | [移动侧栏](screenshots/PAGE-013-sidebar-sheet-mobile-redacted.png) | 侧栏 Bottom Sheet | `/` | 390x844 | 同上 | 打开导航；对话/Project 标签 | 2026-07-26 | 是 |
| PAGE-014 | [移动 Reader](screenshots/PAGE-014-reader-mobile-redacted.png) | 在线阅读 | `/conversations/[redacted]` | 390x844 | 同上 | 打开已有对话；无桌面 rail/separator | 2026-07-26 | 是 |
| STATE-003 | [移动操作轨](screenshots/STATE-003-reader-actions-mobile-redacted.png) | Reader actions 展开 | 同上 | 390x844 | 同上 | 展开更多；触发点与关闭按钮位置一致 | 2026-07-26 | 是 |
| PAGE-015 | [移动阅读导航](screenshots/PAGE-015-reader-navigation-mobile-redacted.png) | 对话/章节 TOC Sheet | 同上 | 390x844 | 同上 | 反复切换两个 TOC；未复现空 TOC | 2026-07-26 | 是 |
| PAGE-016 | [移动离线 Reader](screenshots/PAGE-016-library-reader-mobile-redacted.png) | 资料库阅读 | `/library?conversationId=[redacted]` | 390x844 | 同上 | 本地副本；在线版入口，无桌面 separator | 2026-07-26 | 是 |
| STATE-004 | [连接失败](screenshots/STATE-004-offline-status-desktop.png) | 静态错误页 | `/offline` | 1440x900 | 任意 | 直接访问；网络检查与重试 | 2026-07-26 | 不含私有数据 |
| STATE-005 | [对话不可用](screenshots/STATE-005-reader-not-found-desktop-redacted.png) | 无效资源 | `/conversations/[synthetic-invalid-id]` | 1440x900 | 本地资料拥有者 | 使用合成 UUID；显示不可用状态 | 2026-07-26 | 是 |

## 请求与运行记录

| 编号 | 文件 | 操作 | 脱敏结果 | 关联事实 |
| --- | --- | --- | --- | --- |
| HTTP-001 | [PRODUCTION_HTTP_2026-07-26.md](request-records/PRODUCTION_HTTP_2026-07-26.md) | 只读 GET/HEAD | 路径、状态、键名 | 线上入口、API schema、缓存头 |
| API-001 | [LOCAL_OPENAPI_2026-07-26.md](request-records/LOCAL_OPENAPI_2026-07-26.md) | 本地 `app.openapi()` | 67 paths / 79 operations | API 清单 |
| PROD-RUNTIME-001 | [PRODUCTION_RUNTIME_2026-07-26.md](request-records/PRODUCTION_RUNTIME_2026-07-26.md) | King SSH 只读检查 | commit、服务状态、migration；无配置值 | 部署事实 |

## 安全规则

- 不保存 Cookie、Token、密钥、密码或真实环境变量值。
- 不保存未脱敏的私密聊天正文、真实 ID、项目名或分享地址。
- 请求记录只保存方法、路径模板、状态、响应字段和脱敏计数。
- 后续新增证据需在本页登记，并注明视口、身份、日期和脱敏状态。
# Release readiness audit (2026-08-10)

- [UX release-readiness audit](UX_RELEASE_READINESS_AUDIT_2026-08-10.md) records the redacted production Chrome, QA-data and local automated evidence. It is a dated audit record, not a replacement for current code/system facts.
- `screenshots/ux-audit-20260810/` retains only cropped QA/synthetic fixture evidence. Unredacted captures of existing conversation data were removed before the report was persisted.
