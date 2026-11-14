# 文档导航

## 当前候选：可靠性整块治理 — 2026-11-14

11月13日最新指示：验收由用户完成，本任务负责选择性提交/推送、等待完整
精确CI，成功后按安全流程备份/迁移/部署。既有自动门禁不放宽，
不清理生产、不重放用户资料；下方较早的“未授权再次提交”是历史边界。
当前修复`74a1e86`选择性提交/推送十九个白名单文件，十三个无关文件保全。
完整精确CI`43503483829`首次读取**05:28:55.244142 +08:00**满足50分钟
双边界，**05:39:07**独立确认失败结束，取消请求0次。API6656通过、
Settings470+独立restore1通过；Web五项旧交互测试失败，阅读math10000
cold0真实213ms超过原150ms门槛，两发布job跳过，未部署。
[独立失败回执](evidence/reliability-2026-11-14/ci-probe-pagination-failure.json)
保留四份官方日志/三份诊断ZIP，均非可部署制品。Web挂载117及Files15
本地通过，不替代真实API网络或完整新CI；性能根因未定，不能宣称已修。
精确失败SHA的完整九例CPU诊断`43514182245`已失败结束，首次读取
**06:40:15.205718 +08:00**满足新50分钟wall-clock及3000.015秒monotonic边界；
[诊断派发回执](evidence/reliability-2026-11-14/ci-runtime-frame-diagnostic-dispatch.json)
及[诊断结果](evidence/reliability-2026-11-14/ci-runtime-frame-diagnostic-result.json)
保留18份测量/54份冷CPU证据。raw scrollTop回收误判和轮间真实回跳漏检已用
实际Reader正负对照区分；[测量v4合同](system/PERFORMANCE_CAPACITY_CONTRACT.md#reading-coordinates--measurement-v4)
以每帧/每wheel共享真实DOM锚点判断，原输入/预算、raw失败和全部帧保留。
最终Reader42（原39保留）、Node2519/CI64/PWA20、静态和新548输入构建通过；
[本地最终回执](evidence/reliability-2026-11-14/ci-runtime-frame-verification.json)
及1391项最终输入不冒充完整精确CI、Linux或生产验收。原213ms未复现，不称已修；
必须新完整CI全绿和fresh发布检查，不创建安排或改变生产。
[独立派发回执](evidence/reliability-2026-11-14/ci-probe-pagination-dispatch.json)
不代表通过、不覆盖旧失败/事件回执；下方7f8a642及其CI失败属于前一检查点。
前次修复`7f8a642`已选择性提交/推送十九个任务文件，十三个无关文件保全；
完整精确CI`43483733253`在**02:33:11.802991 +08:00**确认派发，
首次读取**03:23:11.814857 +08:00**满足50分钟边界；API触及原45分钟
full-suite上限，Web比较恢复用例等待不存在的嵌套footer `contentinfo` 超时。
**03:26:36.093662**单次取消，**03:27:03.210582**独立确认结束；
Settings取消前另有一项真实分页失败，未完整执行；两发布job均零step，未部署。
三份原job日志及两份官方
诊断ZIP摘要已核验；修复不放宽门槛，详见同一台账及
[独立失败回执](evidence/reliability-2026-11-14/ci-recovery-failure.json)和
[分页补充回执](evidence/reliability-2026-11-14/ci-recovery-settings-failure.json)。
本地修复保留严格retention断言、真实main/footer及原20秒materialization等待
边界，最终API/PG专项39通过；完整新CI仍待通过，不继承旧结果。
[本批回执](evidence/reliability-2026-11-14/ci-probe-pagination-verification.json)
保留mounted102、Node/静态和新548输入隔离构建、1391项最终输入及十三文件保全；
自建PG已停止、资料保留，未启动完整本地站点或部署。
端口修复`5fcb835`已选择性提交/推送；完整精确CI`43459604614`在
00:07:59.560391 +08:00派发，00:58:03.927117首次读取满足50分钟边界。
API/阅读性能通过，Web两项失败，Settings四项失败后达到原60分钟job上限；
本轮未发取消请求，下游发布跳过。恢复流程/人工任务收尾修复已本地验证，
新派发不继承旧成功项，未部署；当前进度只由
[同一台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)维护。
11月14日随后两次独立授权立即结束旧版卡住导入，均由原worker自行回滚失败、
保留全部源字节。最新00:44:39 +08:00独立快照无活动/排队任务或锁等待；
服务未重启，生产仍旧版，不是永久修复或发布。详见同一台账及
[脱敏事件回执](evidence/reliability-2026-11-14/production-stall-recovery.json)。
夹具修复`2ae0ed0`已选择性提交/推送；CI`43436935411`在50分钟后首次读取，
Web失败，22:39:58 +08:00单次请求取消并独立确认。Settings取消前五项失败，
不是60分钟超时；下游发布未开始。当前断言/人工任务收尾修复已通过API/PG39、
源码合同9及五项负对照；新完整CI仍待通过，未部署。
该修复已推送为a8d859b但未派发；派发前将API测试库对齐受保护的65438
临时端口，未放宽seeder/超时或跳过回归。相同PG39及CI脚本62通过，
其余工作流字段、六job和生产配置均未改；后续完整CI见上方当前派发记录。
修复`829e1b7`已选择性提交/推送，完整CI`43424349497`的API/Web失败；
按用户指示取消，21:14:35 +08:00确认结束。首次有效读取21:12:16遵守50分钟边界。
四项测试夹具修正已通过API/PG34（4项Windows信号跳过）、编辑器99与
Unicode20次重复；未改应用、工作流或原门槛，新完整CI仍待通过，未部署。
前一候选`adc80ac`的完整CI`43389645130`失败：API/Web失败，
Settings原60分钟门槛超时，下游发布跳过。首次读取遵守50分钟边界；
前批CI阻断修复已通过本地专项，包含一次性编辑器输入、Undo/Redo请求消费及
20次picker重复；本次真实失败、夹具修正及宿主只读风险仍见同一台账。
生产仍3564cbf/schema0060。

用户已批准新方案实施；下方“目标结束/等待下一步”是前一检查点。
从[同一状态台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)查看A–D修复、
失败回归及尚未通过的发布门槛，不新增另一套总览。
源码候选head0061；生产仍3564cbf/schema0060。11月12日追加授权一次本地检查点
提交后继续下一批，不等待CI；不推送、派发CI、部署或清理生产。
本地检查点为`a0faa85`；后一批管理员定点停止/核对已包含在`adc80ac`，
见[管理合同](system/ADMINISTRATION_CONTRACT.md#execution-interruption-and-recovery-local-2026-11-12)。
11月13日接续补用户任务中断恢复、批量删除断点回执和扫描独立停止状态；
恢复的工作偏好及未验收项仍只记在同一台账；最新发布授权与执行进度也在该页。
核心合同：[源码/附件保存](system/SOURCE_EDITOR_UPLOAD_ATOMICITY_CONTRACT.md)、
[执行与状态](system/OBSERVABILITY_CONTRACT.md)、
[文件生命周期](system/ARTIFACT_LIFECYCLE_CONTRACT.md)、
[兼容接口](api-reference.md)、[迁移边界](system/DEPLOYMENT_AND_ENVIRONMENT.md)。

## 小机器优化目标收尾 — 2026-11-12

从[唯一状态总览](system/SMALL_HOST_IMPROVEMENT_STATUS.md)查看已完成内容、
已部署/已提交/本地待提交的区别、四块后续路线和目标结束条件。
现役仍3564cbf；候选7a4d61b的完整CI通过但未部署；M/N/O和心跳补丁待提交。
[生产队列定点恢复](execution/SERVER_QUEUE_RECOVERY_2026-11-12.md)已完成，
不是发布：一个导入安全失败并保留原文件、两个导出完成，无清队列/删资料。
按用户要求停止扩展、提交/CI/部署，等待下一步。
[原方案](planning/SMALL_HOST_OPERATIONS_2026-11-11.md)和
[实施账本](execution/SMALL_HOST_OPERATIONS_2026-11-11.md)仅保存历史过程。

## 当前发布：可恢复操作与阅读接续 — 2026-11-11

现役 **3564cbf / schema0060**，完整CI **42828329240** 六项及五份制品已核验；
00:08:06 +08:00部署验收。导入顺序/停止保留/来源修复、离线/导出恢复、
表格及短时反馈、触摸边界和跨端位置显式接续均已发布。
按随后明确批准的A–D清理；最终**只留一份**最新停写备份，
保留当前和该备份匹配的镜像，保护有效资料。没有自动清理安排或用户ZIP重放。
[发布与逐项验收回执](execution/RECOVERABLE_OPERATIONS_RELEASE_2026-11-11.md) /
[机器证据](evidence/release-2026-11-11/recoverable-operations-deployment-summary.json) /
[实施及失败历史](execution/RECOVERABLE_OPERATIONS_2026-11-10.md)。
独立复核保留一条被拒绝的无效静态请求日志；实体设备、生产认证操作和
备份恢复演练未验证。下方旧版本/候选/备份数量均是历史，本节为当前入口。

## 历史发布：阅读交互 / 缺附件 ZIP — 2026-11-09

现役 **865b0a6 / schema0060**，完整CI **42594459199** 六项、五份制品、
14项Web门禁、19组新增Reader和原64+12+4轨迹独立通过。
18:55:46 +08:00发布验收，18:56:43运行态、19:01:13备份/保全复核通过。
首次维护保护中止及原服务恢复如实留档；无migration、生产配置替换或清理。
保留三备份/三代镜像，无直接旧worker回退，不自动重放用户ZIP。
[完整回执](execution/READING_INTERACTION_ZIP_RELEASE_2026-11-09.md) /
[机器证据](evidence/release-2026-11-09/reading-interaction-zip-deployment-summary.json)。
下方候选、待CI及此前“当前生产”均为历史检查点；本节优先。


## 阅读交互 / 缺附件 ZIP 发布候选 — 2026-11-09

[阅读交互与缺附件 ZIP 实施记录](execution/READING_INTERACTION_ZIP_FIXES_2026-11-09.md)：
公式性能、标题/消息序号/标签、专注搜索、返回阅读入口及缺附件非阻断导入。
现行源码规则见阅读工具与 ZIP 合同；下方生产指针不变。
后续目标已授权审查修正、提交完整CI至通过并部署；每次派发至少50分钟
后首次回查，不创建安排或重放用户ZIP。
见[完成度审查](execution/ux-audit-reading-interaction-zip-2026-11-09.md)。
本地静态/专项及同源码、同版本依赖的隔离Next构建已通过；CI/PWA与64条
矩阵未运行，不可把本地检查当作发布验收。

## 当前生产与验收 — 2026-11-09

现役 **d61b9c6 / schema0060**，完整CI **42522644855** 六项、五份制品、
14项Web门禁及五例真实内存门禁独立通过。06:03:02 +08:00发布验收，
06:03:30运行态、06:06:22备份/保全复核通过。原配置/PostgreSQL不变；
两份备份与两代镜像保留，无直接旧worker回退，未清理或重试用户ZIP。
见[发布回执](execution/BOUNDED_ZIP_IMPORT_RELEASE_2026-11-09.md)、
[ZIP合同](system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md)及
[阅读工具合同](system/READING_TOOLS_CONTRACT.md)。CI回查已暂停。
下方11月7–8日“当前/候选/未验收/未授权”仅为旧检查点；
本节与Project State的最新发布摘要优先，既有清理历史不覆盖或删除。


入口同步：**2026-11-08**。先读 [Project State](../PROJECT_STATE.md) 和
[AGENTS](../AGENTS.md)，再进入任务专题。当前代码、配置与 migration 是真值；
带日期的 planning/execution/evidence 只说明各自检查点，不能当成新工作指令。

## 当前状态与验收边界

11 月 7 日图片自然排版 **`897ba78`** 的精确 CI **42371615326** 六项及
五份制品独立核验通过，随后按“成功，部署”单独授权发布。
维护 **21:31:35–21:38:56 +08:00**，**21:39:40** 独立运行态复核通过；
生产 **`897ba78`**，schema **0059** 不变；11 月 8 日清理后不保留直接本地回退。
Web 14/14、阅读 35/35、Settings 466/466 加独立恢复 1/1，
原 64 条轨迹及新增 12+4 和冷 Viewer 记录通过，未放宽阈值。
部署时保留三份备份和三代镜像；随后用户明确确认仅留最新并清理审查表全部项。
11 月 8 日 **01:42:13 +08:00** 独立复核：仅保留最新重验备份、当前四个 role tag
及镜像包；旧备份/镜像/传输包、闲置 VS Code 版本及缓存已清理，日志和业务数据未动。
磁盘 **66% 使用、13,680,388 KiB 可用**，净增加约 **9.78 GiB**；
服务未重启，旧回退指针归档。后续仍需独立授权及容量预检，不能自动清理或降低预算。
见[清理回执](execution/KING_STORAGE_CLEANUP_2026-11-08.md)、
[发布回执](execution/IMAGE_NATURAL_FLOW_RELEASE_2026-11-07.md)、
[现行源码合同](system/IMAGE_READING_STABILITY_CONTRACT.md)、
[实施与验证](execution/IMAGE_NATURAL_FLOW_2026-11-07.md)。
本轮没有启动本地应用、重传用户 ZIP 或创建安排；认证生产 UI/真实设备
仍非本轮验收。每次派发后至少 50 分钟首次回查规则保留。

历史：11 月 6 日图片/阅读稳定性及七项追加审查通过精确 CI `42217357688`：
六项 job、14 项 Web 门禁、阅读 23/23 与 64 条逐帧轨迹、五份制品独立核验。
后续单独授权部署于 **22:07:48 +08:00** 验收，**22:10:03** 独立复核通过。
当时生产／直接回退为 **`9cf235f`／`67e6336`**，schema **`20261105_0059`**
不变。随后单独授权清理，仅删除两份旧验证备份和八个无引用旧镜像标签；
保留 11 月 6 日、11 月 5 日两份重验备份及当前／直接回退镜像。见
[发布回执](execution/IMAGE_READING_STABILITY_RELEASE_2026-11-06.md)、
[行为合同](system/IMAGE_READING_STABILITY_CONTRACT.md)及
[实施映射](execution/IMAGE_READING_STABILITY_2026-11-06.md)。
清理后独立复核为 85% 使用、6,167,416 KiB 可用；后续发布仍必须重新容量预检，
不能据此扩大删除范围。用户资料、数据卷、镜像归档和发布证据未动。
回退仍需停写、job/data 兼容检查；禁止自动 downgrade。
原用户 ZIP 重试、真实 47 对话离线更新与认证生产 UI 仍待单独验收。
11 月 5 日候选已通过隔离合成 PostgreSQL/附件备份恢复演练，不等于生产备份恢复。
前一恢复一致性 `67e6336` 的 0059 升级与 52/52 回填仍由
[上一发布回执](execution/RECOVERY_CONSISTENCY_RELEASE_2026-11-06.md)保存。
CI 回查保持暂停，没有创建或恢复安排。
此前知识整理及汇报后获准的本地安全清场已完成，该收尾任务本身未重新发布；
见[收尾回执](execution/KNOWLEDGE_CLOSEOUT_2026-11-04.md)中的删除范围与保全核验。

## 开始这里

**11月8日新增导入候选（已授权与阅读工具一并提交CI，尚未验收／部署）：**
[有界ZIP合同](system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md) /
[实施与验证边界](execution/BOUNDED_ZIP_IMPORT_2026-11-08.md)。
按消息磁盘索引、动态资源准入、异步恢复及候选migration0060；
100/500 MiB容量门禁已编写但未运行，不改变生产0059指针。

**11 月 8 日源码候选（尚未通过完整 CI/部署）：**
[阅读工具合同](system/READING_TOOLS_CONTRACT.md) /
[实现与验证边界](execution/READING_TOOLS_2026-11-08.md)。
覆盖紧凑比例条、一起阅读、位置书签/批注导出及标签管理；
不改写上方已发布版本和独立存储清理回执。阅读工具已本地提交为`2bb6ef0`；
用户随后明确授权与本次ZIP优化一起推送`master`并派发完整CI。
随后用户授权修正[完成度审查](execution/ux-audit-reading-tools-completion-2026-11-08.md)
中的七项问题，见[修正记录](execution/READING_TOOLS_AUDIT_FIXES_2026-11-08.md)；
本地修正不等于运行/视觉验收，本次不等待CI结果、不部署或创建回查安排。

| 文档 | 长期职责 |
| --- | --- |
| [README](../README.md) | 产品入口、快速开始与常用命令 |
| [Project State](../PROJECT_STATE.md) | 当前源码／运行态、稳定决策和待验证边界 |
| [AGENTS](../AGENTS.md) | 开发、安全、临时目录与验证规则 |
| [产品说明](product.md) | 用户工作流、能力与产品限制 |
| [系统事实索引](system/README.md) | 功能、页面、权限、数据与运行专题 |
| [文档台账](documentation-inventory.md) | 所有权、分类与历史维护记录 |

## 开发与运行

| 文档 | 内容 |
| --- | --- |
| [系统架构](architecture.md) | Web/API/PostgreSQL、canonical 数据和关键数据流 |
| [API 参考](api-reference.md) | 当前业务接口与兼容接口 |
| [本地开发](development.md) | 环境、安装、migration、启动和测试 |
| [测试](testing.md) | 按风险选择测试、CI gate 与证据边界 |
| [生产部署](deployment.md) | 精确制品、容量、停写备份、部署与回退 |
| [故障排查](troubleshooting.md) | 代理、Reader、离线、构建与容器问题 |

## 按任务进入合同

| 任务 | 权威专题 |
| --- | --- |
| 导入格式／ZIP／小内存恢复 | [Adaptive Import](system/ADAPTIVE_IMPORT_CONTRACT.md)、[Archive Import](system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md) |
| 正文与富内容 | [Rich Markdown](system/AI_RICH_MARKDOWN_CONTRACT.md)、[附件](system/ATTACHMENT_RENDERER_CONTRACT.md)、[消息 Markdown 复制](system/MESSAGE_MARKDOWN_COPY_CONTRACT.md) |
| 图片尺寸／自然排版／长图／Viewer | [图片与阅读稳定性](system/IMAGE_READING_STABILITY_CONTRACT.md)；源码候选、CI 和生产边界分别记录 |
| 收藏／批注／标签／数据语义 | [功能清单](system/FEATURE_INVENTORY.md)、[数据与存储](system/DATA_AND_STORAGE.md)、[API](api-reference.md) |
| 页面／导航／阅读流程 | [路由地图](system/PAGE_AND_ROUTE_MAP.md)、[用户流程](system/USER_FLOWS.md)、[前端架构](system/FRONTEND_ARCHITECTURE.md) |
| 编辑与上传 | [后端/API](system/BACKEND_AND_API.md)、[Source Editor 上传原子性](system/SOURCE_EDITOR_UPLOAD_ATOMICITY_CONTRACT.md) |
| Context／归档 | [Context](system/CONTEXT_PACKAGE_CONTRACT.md)、[数据归档](system/DATA_ARCHIVE_CONTRACT.md) |
| 账户／管理员／Share | [认证](system/AUTHENTICATION_CONTRACT.md)、[权限](system/USER_ROLES_AND_PERMISSIONS.md)、[管理](system/ADMINISTRATION_CONTRACT.md) |
| 离线/PWA | [离线韧性](system/PWA_OFFLINE_RESILIENCE_CONTRACT.md)、[任务与离线保留](system/RETENTION_CONTRACT.md) |
| 本轮认证／离线／搜索／归档整合 | [当前行为合同](system/COMPREHENSIVE_OPTIMIZATION_CONTRACT.md)、[实施与验证](execution/COMPREHENSIVE_OPTIMIZATION_2026-11-05.md)；0059 已部署，生产认证 UI 仍未验收 |
| 恢复一致性／预览过期／容量／分页 | [当前行为合同](system/COMPREHENSIVE_OPTIMIZATION_CONTRACT.md#recovery-consistency-follow-up)、[本轮验证](execution/RECOVERY_CONSISTENCY_2026-11-05.md) |
| 噪声与内容清理 | [内容清理](system/CONTENT_CLEANUP_CONTRACT.md)、[已知风险](system/KNOWN_ISSUES_AND_UNCERTAINTIES.md) |
| 发布／依赖／浏览器安全 | [发布安全](system/RELEASE_SAFETY_BASELINE.md)、[Next 迁移与现行版本](system/NEXT_LTS_MIGRATION_CONTRACT.md)、[CSP](system/CSP_ENFORCEMENT_CONTRACT.md) |
| 文件／运行诊断／安全清理 | [Artifact 生命周期](system/ARTIFACT_LIFECYCLE_CONTRACT.md)、[可观测性](system/OBSERVABILITY_CONTRACT.md)、[安全清理](system/CLEANUP_CONTRACT.md) |
| 性能与容量 | [性能合同](system/PERFORMANCE_CAPACITY_CONTRACT.md)、[部署环境](system/DEPLOYMENT_AND_ENVIRONMENT.md) |

## 近期证据（历史记录，不替代当前状态）

- 图片/阅读：[完整 CI／部署回执](execution/IMAGE_READING_STABILITY_RELEASE_2026-11-06.md)。
- 恢复一致性：[完整 CI／部署回执](execution/RECOVERY_CONSISTENCY_RELEASE_2026-11-06.md)。
- 小内存 ZIP：[诊断与实施](execution/SMALL_ZIP_MEMORY_2026-11-04.md)、
  [精确 CI／部署回执](execution/SMALL_ZIP_MEMORY_RELEASE_2026-11-04.md)。
- Reader／收藏／键盘／几何／富 Markdown／ZIP：
  [完成度复审](execution/ux-audit-reader-zip-completion-2026-11-03.md)、
  [实施](execution/READER_ZIP_IMPLEMENTATION_2026-11-03.md)、
  [上一发布点](execution/READER_ZIP_RELEASE_2026-11-04.md)。
- 真实离线大包待复验：[诊断与恢复边界](execution/OFFLINE_LARGE_PACKAGE_DIAGNOSIS_2026-11-01.md)。
- 两轮 24 项有界功能：[实施与发布](execution/WEB_FEATURE_OPPORTUNITIES_IMPLEMENTATION_2026-10-30.md)。
- 本轮知识与工作区收尾：[检查结果和保留现场](execution/KNOWLEDGE_CLOSEOUT_2026-11-04.md)。

## 历史、规划与数据资产

| 位置 | 使用边界 |
| --- | --- |
| [planning/](planning/README.md) | 带日期的设计；仅经当前授权才能转为工作项 |
| [execution/](execution/README.md) | 审查、失败过程、测试及发布证据 |
| [evidence/](evidence/README.md) | 脱敏测量、合成截图和请求快照 |
| [前一状态入口快照](archive/PROJECT_STATE-history-2026-11-04.md) | 保留原检查点和源码 hash，不再冒充当前状态 |
| [前一长导航快照](archive/documentation-index-history-2026-11-04.md) | 保留旧审查索引与逐批摘要，避免丢失检索线索 |
| [早期 UX 交接](agent-context/UX_AUDIT_HANDOFF.md) | 历史范围；新会话仍从 Project State 开始 |
| [早期优化账本](system/CONTINUOUS_OPTIMIZATION_BACKLOG.md) | 历史审查与决策，不是持续无限优化指令 |

`apps/api/storage/imports/**/*.md`、`examples/**/*.md` 与应用内 Skill Markdown
是用户资料或产品/测试输入，不属于文档整理对象；不要自动改写、移动或纳入知识链接校验。
