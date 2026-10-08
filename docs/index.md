# 文档导航

[累计优化发布](execution/OPTIMIZATION_RELEASE_2026-10-08.md)：用户已明确要求提交、
完整 CI、验证后部署，再继续产品审查。当前静态检查、构建、0050 单一 head 和
33 项离线／任务 API 检查通过；439 项设置用例将在隔离 CI 执行，包含待验收的
16 项。本地 Web 启动仍被工具策略拒绝，尚无本地浏览器通过记录。以下各批记录
中的“未授权提交／部署”是此前的历史边界；当前发布进度以上述记录为准。

累计成果已提交为 `a31a1f8`。首轮 CI 的 API 全量 1,181 通过／3 跳过；Web 被
新公布的 Next／sharp 高危公告阻断。修补至 16.3.8／0.35.5 后本机构建、安全
回归和原有审计策略通过，仍需完整精确源码 CI，生产尚未更新。

[本地执行策略排查](execution/local-execution-policy-diagnosis-2026-10-08.md)：
已确认完全访问与 Never 生效，40 条本地规则均为允许，未找到命中禁止项。
当前只能确认工具策略拒绝，具体规则未知；此前“自动审批”的归因未获证实。

最新要求：[使用指定 Chromium 进行本地验收](execution/specified-chromium-preflight-2026-10-08.md)。
151.0.7922.34 已完成真实启动预检，16 项用例已绑定该浏览器；应用用例仍未执行。
用户重启 Codex 后，原启动命令重试一次仍被同样拒绝；新日志没有具体原因。
目标已随用户恢复继续，16 项验收仍待执行；正在等待可能存在的客户端拒绝详情。

[任务中心离线恢复](execution/offline-task-recovery-2026-10-08.md)已接回“离线与同步”：
定位本机记录；没有记录时明确下载到此设备，不再只重试服务器打包。
33 项 API 专项、静态检查与构建通过；无新迁移，浏览器验收仍待完成。

[离线失败指引](execution/offline-error-guidance-2026-10-08.md)已接入具体附件错误原因和
手动重建逻辑，并修正首次下载误称“副本已保留”的问题。静态检查与构建通过；
16 项噪声／离线浏览器用例仅完成发现检查。用户继续后 Web 启动仍被工具策略
拒绝（具体拒绝来源尚未确认），隔离测试服务已停止；浏览器验收未完成，未提交或部署。

[API 整合检查](execution/api-integration-2026-10-08.md)已完成：1,020 通过、153 跳过、
0 失败；[PostgreSQL 补验](execution/postgres-integration-2026-10-08.md)已覆盖其中
149 项，修正一处迁移测试准备问题；仍余 4 项环境／材料条件与浏览器验收待完成。

[离线附件完整性修复](execution/offline-asset-integrity-2026-10-08.md)：
损坏附件不再误报下载成功，失败保留旧包，17 项测试通过；尚未部署。

[离线包快照修复](execution/offline-snapshot-consistency-2026-10-08.md)：
生成期间编辑正文不再混入不同版本数据，19 项 API、5 项 PostgreSQL 通过，尚未部署。

[离线版本并发修复](execution/offline-revision-concurrency-2026-10-08.md)
已修复版本漏增及编辑／搜索外键死锁，49 项 API、12 项 PostgreSQL 通过；尚未部署。

当前线上源码 `b45f049`、唯一 migration `20261006_0048`，CI `37470769275` 五项全过。
[当前发布记录](execution/CONTEXT_EXPORT_INTEGRITY_2026-10-06.md) 记录 Context 导出
完整性、有界处理、并发保护、线上验收、两份备份和旧镜像清理。
[Project State](../PROJECT_STATE.md) 是当前快照。异地副本暂不设置；
本阶段已交付，长期优化目标继续，勿重放已完成的部署与清理。

当前工作区保留[离线恢复审计](execution/ux-audit-offline-recovery-2026-10-06.md)
及[分享设置恢复审计](execution/ux-audit-share-recovery-2026-10-07.md)的未提交改进。
新增[归档任务恢复审计](execution/ux-audit-archive-recovery-2026-10-07.md)：修复旧列表
压住新任务状态、刷新占住操作和错误空态，29 项 API、8 项 PostgreSQL、15 个
独立浏览器场景通过；个人／系统备份规则不变。
离线恢复、基线 PWA 和负面矩阵已验证；分享新增并发保护、草稿比较、逐项重试
和分页恢复，19 项 API、13 个独立浏览器场景有通过记录。失败和跳过单独记录；
本轮不触发 CI 或部署，部署等待用户明确要求。

第四批[帮助请求导航审计](execution/ux-audit-support-navigation-2026-10-07.md)已完成：
刷新保留列表、返回定位、筛选末页恢复和回复页码校正，失败提示靠近操作。
21 个浏览器场景通过，15 张截图已检查；中间失败完整记录，所有改动仍未提交。

第五批[归档替换审计](execution/ux-audit-archive-replacement-2026-10-07.md)已完成：
损坏归档直接选择其他文件、过期预检重传、未知故障保留重试，任务中心可进入
失败详情。26 个浏览器场景通过且无跳过，15 张截图已检查；保留中间失败及
故障注入边界。独立测试服务已停止，五批改动均未提交、未部署。

第六批[用户管理恢复审计](execution/ux-audit-admin-account-recovery-2026-10-07.md)已完成：
账户操作立即采用服务端确认状态，筛选末页与返回焦点恢复，失效详情移除，
丢失删除响应可按原操作核对结果。51 项独立 API、4 项 PostgreSQL、14 个浏览器
场景通过，12 张最终截图已检查。六批改动保持未提交，生产不变。

此前任务中心发布保留在[历史执行记录](execution/TASK_CENTER_CLARITY_2026-10-06.md)。

第七批[噪声审查恢复审计](execution/ux-audit-cleanup-recovery-2026-10-07.md)已完成：
保存确认与后台刷新分离，已选末页和返回焦点恢复，旧差异刷新失败时禁止确认，
候选读取失败可重试且明确标注旧列表。69 项 API、6 项 PostgreSQL、18 个浏览器
场景通过，17 张最终截图已检查；中间失败保留。七批仍未提交、未部署，测试服务已停止。

## 开始这里

第二十八批[噪声校验计算复用](execution/cleanup-validation-work-2026-10-08.md)：同条
消息的 128 个候选不再各自重跑检测器。合成样例预览约 975→42ms，应用约
1052→154ms；仅代表本地样例。85 项独立 API、11 项 PostgreSQL 检查通过，
保护区及来源校验保留。无新迁移、未提交／部署；浏览器验收仍待完成。

第二十七批[清理与源码版本保护](execution/cleanup-source-safety-2026-10-08.md)已复现
并修复“替换当前版本后沿用旧清理确认”和并发编辑被覆盖的问题；新增精确源码
指纹及写入锁核对。本地唯一 head 更新为 0050，生产仍 0048。84 项 API 相关
测试及 11 项真实 PostgreSQL 检查通过，无跳过；中间失败单列。
浏览器验收待完成；未提交、未部署。

第二十六批[噪声选择响应恢复](execution/ux-audit-noise-selection-recovery-2026-10-08.md)
进行中：保存响应不明时，先读取服务器已存选择，再继续修改或预览。代码和
8 个浏览器用例已补充；本地 Web 启动被自动审批拦截，浏览器验收尚未执行。

第二十五批[导入／全局噪声扫描状态与取消](execution/ux-audit-noise-scan-lifecycle-2026-10-08.md)
已完成：排队、扫描、取消和失败显示真实状态，取消保留导入内容；修复后台取消
竞争与移动端结束审查焦点恢复。最终 55 个浏览器、79 项独立 API、9 项真实
PostgreSQL 检查通过，无跳过；79 张最终合成图已复查。准备错误、空间中断及
中间失败单列。二十五批仍未提交／部署，无新迁移；独立测试服务已停止。

第二十四批[噪声空结果与结束审查](execution/ux-audit-noise-dismissal-2026-10-07.md)
于 10 月 8 日完成：导入和近期已完成任务可查看无命中结果；结束审查支持恢复，
修复失败任务残留和键盘焦点丢失，正文不变。真实登录模式下 59 个浏览器、
31 项 API、7 项 PostgreSQL 检查全过，89 张最终合成图已复查；中间失败单列。
二十四批仍未提交／部署；无新迁移，本地 head 0049、生产 0048，测试服务已停止。

第二十三批[导入／全局噪声重扫恢复](execution/ux-audit-rescan-recovery-2026-10-07.md)
已完成：重试不重复建任务、旧选择保留、新旧审查切换、响应不明时只读核对。
修复返回已关闭审查仍显示旧缓存的问题。35 个浏览器、24 项 API、5 项 PostgreSQL
检查全过；最终 53 张图已复查。新增本地单一 head 0049 仅增加请求索引，生产仍
为 0048；二十三批未提交／部署，独立测试服务已停止。失败过程单列。

第二十二批[系统噪声规则发布恢复](execution/ux-audit-rule-publication-2026-10-07.md)
已完成：保存及时确认、丢响应只读核对、旧窗口比较后重试，版本和匹配说明同步。
35 个独立浏览器、27 项 API、7 项 PostgreSQL 检查有通过证据；最后调整后相关
24 个浏览器场景再次全过。中间失败单列；二十二批未提交／部署，服务已停止。

第二十一批[个人规则编辑并发](execution/ux-audit-rule-edit-concurrency-2026-10-07.md)
已完成：修复只改名称的旧草稿覆盖、编辑时意外启用已停用规则；冲突保留草稿并
明确比较重试。51个浏览器、18项API、8项PostgreSQL检查全过，另有1例补测。
60张图已复查；两条非规则列表连接重置单列。二十一批未提交／部署，服务已停止。

第二十批[导入／全局噪声选择范围](execution/ux-audit-noise-selection-scope-2026-10-07.md)
已完成：预览旁说明其他分组的已选项，一键集中查看；统计覆盖全部分页，分组
按需显示保护／冲突数量。45个浏览器、40项API、6项PostgreSQL检查全过，73张
合成图已复查。首次测试导航失败单列；二十批未提交／部署，独立服务已停止。

第十九批[个人噪声规则操作恢复](execution/ux-audit-rule-actions-2026-10-07.md)已完成：
启停／切版本及时确认，删除反馈与焦点恢复，丢响应先只读核对；失败历史禁止
切换，配置字段改为中英文可读文案。78个浏览器、11项API、6项PostgreSQL检查
全部通过，真实扫描验证旧审查和正文保留。2张基线／96张最终图已检查；历史
缓存、类型和内存准备失败单列。十九批未提交／部署，独立服务已停止。

第十八批[全局噪声扫描恢复](execution/ux-audit-global-scan-recovery-2026-10-07.md)
已完成：排队及时确认、丢响应只读核对、刷新恢复、同请求重试不重复扫描，以及
任务中心焦点交接。67个浏览器、9项API、5项PostgreSQL检查全部通过，另有两次
单例补测通过；1张基线／74张最终合成图已复查。原焦点失败、空间保护导致的
环境中断和流关闭诊断均单列。十八批未提交／部署；下一批处理个人规则操作恢复。

第十七批[噪声忽略例外恢复](execution/ux-audit-exception-recovery-2026-10-07.md)
已完成：保存及时更新候选、未知结果只读核对、失败范围禁止确认；撤销支持末页
恢复和幂等重试，返回保留展开上下文。60 个独立浏览器、39 项 API、6 项 PostgreSQL
检查有通过证据：完整浏览器运行 59 过／1 焦点失败，修复后相关 35 例全部通过。
2 张基线和 72 张最终合成图已复查；准备失败另列，十七批均未提交／部署。

第十六批[噪声规则学习恢复](execution/ux-audit-rule-learning-recovery-2026-10-07.md)
已完成：已保存反馈不再等待列表刷新，丢响应只读核对，冲突用字段比较并保留
草稿，手机并排对照及键盘返回。49个浏览器、11项API、6项PostgreSQL检查通过；
2张基线和57张最终截图已复查，失败准备过程单列。十六批均未提交／部署。

第十五批[噪声差异判读](execution/ux-audit-noise-diff-2026-10-07.md)已完成：完整
前后文精确标注删除片段、逐处同步定位、手机双区对照；旧接口或错误范围退回
完整纯文本，冲突仍保留原文。40项API、6项PostgreSQL、43个独立浏览器场景通过；
1张基线和64张最终合成截图已复查。十五批均未提交／部署，独立测试服务已停止。

第十四批[导入与全局噪声导航](execution/ux-audit-noise-navigation-2026-10-07.md)已完成：
导入完成直达本批审查、跨页查找对话、明确筛选范围、按对话跨规则审查，以及预览
返回原位。70项API套件、6项PostgreSQL、44个独立浏览器场景有通过证据；3张基线、
65张最终截图已复查。中途失败、修正重跑和早期跳过均单列。十四批均未提交／部署。

第八批[清理完成恢复审计](execution/ux-audit-cleanup-completion-2026-10-07.md)已完成：
丢失响应可核对真实结果，正文刷新失败只重试读取，最终正文与完成记录原子提交；
全部已知冲突阻止确认，手机源码入口保留首次选区焦点。101 项 API、8 项 PostgreSQL、
35 个浏览器场景通过，失败记录与截图均保留。八批均未提交／部署，测试服务已停止。

第九批[清理布局审计](execution/ux-audit-cleanup-layout-2026-10-07.md)已完成：
精确命中与来源先显示，完整上下文／规则按需展开；完成态缩小并去除旧选区与
扫描操作。33个真实浏览器场景通过，包含360px短高屏；4张基线、45张最终截图
已检查。九批均未提交／部署，独立服务已停止；长期优化目标继续。

第十批[账户与安全恢复审计](execution/ux-audit-account-security-recovery-2026-10-07.md)
已完成：刷新设备保留表单草稿，保存不覆盖新输入，退出其他设备的成功与刷新
失败分别反馈。25 个浏览器场景通过，含邮箱与离线退出回归；3 张有效基线、
31 张最终截图已检查。十批均未提交／部署，测试服务已停止；失败和验收边界见审计。

第十一批[Skill 替换恢复审计](execution/ux-audit-skill-replacement-recovery-2026-10-07.md)
已完成：替换立即更新下载，冲突保留文件、下载比较后明确替换，支持恢复内置
后的版本 0；丢失响应重试不重复建版本。23 个浏览器、34 项 API 检查通过，
30 张最终截图已检查。默认三个 ZIP 未改动；十一批仍未提交／部署。

第十二批[功能策略恢复审计](execution/ux-audit-feature-policy-recovery-2026-10-07.md)
已完成：防止旧表单重新开启他人关闭的权限，冲突保留输入，未知结果只读取核对，
比较后明确保存。58 项 API、3 项 PostgreSQL、40 项浏览器 gate 检查通过（其中
1 项为诊断序列化）；46 张最终截图已检查。十二批均未提交／部署，测试服务已停止。

第十三批[注册策略恢复审计](execution/ux-audit-registration-recovery-2026-10-07.md)
已完成：旧窗口不能关闭新审批要求，保存结果可核对，语言同步和策略恢复保留
邀请草稿。62 项独立 API、3 项 PostgreSQL、22 项 Playwright 检查通过，明确区分
19 个集成流程／2 个 UI mock／1 项源码检查；19 张最终截图已检查。十三批均未提交、
未部署，独立测试服务已停止。

| 文档 | 长期职责 |
| --- | --- |
| [README](../README.md) | 产品入口、快速开始和常用命令 |
| [Project State](../PROJECT_STATE.md) | 当前仓库、实现、风险和验证快照 |
| [AGENTS](../AGENTS.md) | 最小开发与智能体工作规则 |
| [产品说明](product.md) | 当前用户能力、工作流和边界 |
| [系统事实索引](system/README.md) | 页面、功能、数据、权限和运行事实 |
| [文档台账](documentation-inventory.md) | 每个 Markdown 的分类、所有权和维护方式 |

## 开发与运行

| 文档 | 内容 |
| --- | --- |
| [系统架构](architecture.md) | Web/API/PostgreSQL、canonical 数据和关键数据流 |
| [API 参考](api-reference.md) | 当前 FastAPI 业务接口与兼容路径 |
| [本地开发](development.md) | 环境、安装、migration、启动和测试 |
| [生产部署](deployment.md) | Compose、备份、升级、回退和运行维护 |
| [故障排查](troubleshooting.md) | 数据库、代理、Reader、离线、构建和容器问题 |

## 当前系统参考

[system/README.md](system/README.md) 是详细事实入口。该目录按产品总览、页面/流程、前后端、数据/存储、权限、依赖和已知风险拆分；它不保存实施计划。

## 历史档案

| 目录 | 时间与用途 | 使用限制 |
| --- | --- | --- |
| [planning/](planning/README.md) | 2026-07-27 改造决策与执行清单 | 已完成且被后续决策部分覆盖，不作为当前真值 |
| [execution/](execution/README.md) | 2026-07-27 至 2026-07-29 实施、测试和发布证据 | 只表示对应发布批次，不替代重新验证 |
| [evidence/](evidence/README.md) | 2026-07-26 生产基线截图与只读请求 | 时间点快照，不表示当前生产状态 |
| [agent-context/UX_AUDIT_HANDOFF.md](agent-context/UX_AUDIT_HANDOFF.md) | 2026-07-26 UX 调研交接 | 历史范围说明，当前任务从 Project State 开始 |

## Markdown 数据资产

`apps/api/storage/imports/**/*.md` 与 `examples/**/*.md` 是用户导入内容或解析 fixture，不属于文档系统。不要自动改写、移动或纳入文档链接校验；详细边界见 [文档台账](documentation-inventory.md)。
Current release contracts: [Release Safety Baseline](system/RELEASE_SAFETY_BASELINE.md) covers dependency risk, production secret fail-fast, security headers, quality gating, image inspection and artifact provenance; [CSP Enforcement Contract](system/CSP_ENFORCEMENT_CONTRACT.md) defines the current application policy, resource allowlist and browser enforcement gate.

Artifact publication and cleanup contract: [Artifact Lifecycle Contract](system/ARTIFACT_LIFECYCLE_CONTRACT.md), covering Offline/Export staging, validation, transaction boundaries, orphan semantics, bounded Import recovery and dry-run cleanup.

Task/offline retention contract: [Task And Offline Retention Contract](system/RETENTION_CONTRACT.md), distinguishing the bounded Task Center result window, canonical server packages, manual cleanup grace and browser-managed Offline Library lifetime.

Operational evidence and cleanup safety: [Observability Contract](system/OBSERVABILITY_CONTRACT.md) and [Cleanup Contract](system/CLEANUP_CONTRACT.md), covering request IDs, redacted structured logs, diagnostics enablement, aggregate storage/job state, grace windows, explicit manual apply and final race rechecks.

The pre-compression historical project-state snapshot is retained at
`archive/PROJECT_STATE-history-2026-09-01.md`; it is historical evidence only,
not a current-state authority.
