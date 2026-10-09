# 文档导航

[后续批注与表格审查](execution/ux-audit-followup-annotations-tables-2026-10-09.md)
记录当前冻结候选上新复现的读取恢复／乱序、批量选择范围和 CSV 完整性／资源预算问题。
仅为下一批 pre-edit 证据，不混入当前附件发布候选，也不代表再次授权发布。

[Project State](../PROJECT_STATE.md) 是当前源码、生产、验证边界和下一步的入口。
[累计优化发布记录](execution/OPTIMIZATION_RELEASE_2026-10-08.md) 负责本次提交、
完整 CI、镜像来源、备份迁移和验收；精确候选与生产状态见当前快照。
本次发布已验收完成；当前继续普通用户产品审查，后续改动不等同于已部署。
[后续恢复与导航审查](execution/ux-audit-post-release-recovery-2026-10-08.md)
记录最初六项证据、通过的九项新增浏览器用例，以及后续发现的同版本
离线缓存补齐缺陷和本轮验证边界。CI 37812290017 已全部通过，镜像未部署。
最新授权（2026-10-09）：先完成新建／插入／编辑检查，再优化附件查看（优先 PDF，
控制内存和 CPU）。验证后可提交一轮 CI，通过并独立验收镜像后部署；此后的优化
仍需用户另行明确授权才能发布。附件工作就绪前不提前提交本轮 CI。

[Markdown 原文保真](execution/ux-audit-manual-markdown-2026-10-09.md)与
[附件阅读审查](execution/ux-audit-attachment-reading-2026-10-09.md)现已完成本地修复：
PDF 有界渲染／定位／失败重试、图片切换、JSON／Blob／Worker 恢复和明确不可预览状态。
附件检查点为 601 项 Node、103 项隔离 SQLite API 通过。首轮完整 CI 的 API 通过
1,239 项、跳过 3 项；Web 变更专项超时，设置矩阵 438 通过／1 失败，尚未部署。
[本轮交互修复](execution/ux-audit-release-interaction-2026-10-09.md)区分处理中误关闭
与测试路径问题；修复后 609 项 Node、lint／非增量类型检查／受限构建通过。
该检查点七文件发现 129 项测试、本地浏览器执行 0 项。
[手机阅读与焦点修复](execution/ux-audit-mobile-release-2026-10-09.md)记录第二轮 CI：
API 1,239 通过／3 跳过，设置 439 项及独立全新数据库恢复通过；Web 变更专项
97 通过／2 失败／1 用例超时，未达到 gate 的 20 分钟上限。修复手机标题栏
遮挡及 pending 焦点后，622 项 Node、lint／非增量类型检查／受限构建通过；
八文件发现 144 项测试，本地执行 0 项。第三轮 Web 变更专项 99 通过／1 失败，
API 和设置均通过；剩余手机用例在移动前的滚动准备阶段失败。现只补测试的正文
就绪条件及该流程失败 trace，待同一授权周期完整重跑，仍未部署。
[本轮发布记录](execution/ATTACHMENT_READING_RELEASE_2026-10-09.md)负责接下来的
完整 CI、截图与独立镜像验收、备份和部署；旧 CI 不代表这批改动已验收。

最新[第六轮完整 CI](https://github.com/foolkking/chat-reader/actions/runs/37936101205)：
变更专项 100、附件专项 21 全通过；API 1,239 通过／3 跳过，设置 439 项及独立恢复通过。
PDF 七通过／六断言失败／零用例超时，后续三个 Web gate 未运行，无镜像、未部署。
[附件发布阻塞审查](execution/ux-audit-attachment-release-2026-10-09.md)保留第四／第五轮历史；
[PDF 发布阻塞审查](execution/ux-audit-pdf-release-2026-10-10.md)记录小数滚动边界造成页码回退，
并区分重绘消耗一次性故障的测试问题。窄修后 666 项 Node、lint／非增量类型／单 worker
构建通过；149 项浏览器用例仅发现、本地执行 0 项。修复提交 2f046f9 已进入同一周期的
[第七轮完整 CI](https://github.com/foolkking/chat-reader/actions/runs/37967470601)，同样在 PDF 后续步骤失败，未构建镜像或部署。
[会话与几何修复审查](execution/ux-audit-pdf-session-2026-10-10.md)记录父组件重绘误关闭、缩放中间滚动反馈造成定位漂移的复现。
窄修后 53 项附件专项、699 项仓库脚本 Node 检查及 lint／非增量类型／单 worker 构建通过；149 项浏览器用例仅发现。
修复提交 96b31b0 的[第八轮完整 CI](https://github.com/foolkking/chat-reader/actions/runs/37979802613)
在合成附件 fixture 清理 DELETE 断连时失败，业务断言已完成，不是 PDF 再次失败。
[清理诊断与窄修](execution/ux-audit-upload-cleanup-2026-10-10.md)只在一次只读核对明确
404 后接受清理完成；30 项专项、726 项完整 Node、lint／非增量类型检查通过。
149 项浏览器用例仅发现、本地执行 0；产品源码不变。修复提交 87eae8d 已启动
[第九轮完整 CI](https://github.com/foolkking/chat-reader/actions/runs/37986179840)，仍在
同一授权周期内，不放宽断言、预算或部署条件；尚未验收镜像或部署。

第九轮的 PDF **13**、附件 **21**、上传 **18** 和变更专项 **100** 均通过。
默认 PWA 的一条旧源码断言仍要求删除后等待刷新，导致 **134 通过／1 失败／699
条件跳过**，后续认证与负向 PWA 未运行。[诊断与测试合同修复](execution/ux-audit-archive-contract-2026-10-10.md)
保持产品源码不变，18 条本地源码合同、44 条归档专项和完整 730 条 Node 检查通过；
lint／非增量类型检查通过。本地未启动 Web、未运行浏览器，等待同一周期完整重跑。

[项目设置与读取恢复审查](execution/ux-audit-project-recovery-2026-10-09.md)
是接续的本地批次，记录清空元数据、局部保存和刷新失败的源码证据与验证边界；
不属于已通过的 CI，也未提交或部署。

[合并受理与恢复审查](execution/ux-audit-merge-admission-2026-10-09.md)
接续处理重复提交、原请求核对和确认后收尾；本地回归通过不等于浏览器或
PostgreSQL 并发验收。无需重新选择对话的恢复入口已完成本地实现，记录包含
该检查点的 93 项本地专项通过、旧回调隔离和仍未执行的浏览器断言；未提交或部署。

[会话列表读取与空状态审查](execution/ux-audit-conversation-list-recovery-2026-10-09.md)
记录刷新失败保留已读列表、独立重试，以及活动列表为空时的真实归档入口。
该检查点合并专项共 121 项通过，浏览器文件当时发现 19 项但未执行；旧检查点保留，
这些本地改动未提交、未触发 CI，也未部署。

[归档项目恢复审查](execution/ux-audit-archived-project-recovery-2026-10-09.md)
接续处理缓存项目读取、确认恢复后的独立通知、未知结果核对和删除确认后的范围复核。
该检查点专项共 161 项通过，lint、独立非增量类型检查和受限构建通过；浏览器文件
当时发现 29 项但未执行。后续记录补充了既有后端归档删除保护及测试清理脚本纠正。

[侧边栏读取恢复审查](execution/ux-audit-sidebar-read-recovery-2026-10-09.md)
接续处理项目／未归类／展开项目的读取错误、缓存链接保留和局部重试。
该检查点专项共 205 项通过（含 3 项合成 fixture 清理检查），lint、独立非增量类型检查
和受限构建通过；浏览器文件发现 37 项但未执行。真实浏览器、焦点及 PostgreSQL
并发验收仍未完成；全部新改动继续只留在本地。

[项目归档反馈审查](execution/ux-audit-project-archive-feedback-2026-10-09.md)
记录三项本地修复：确认后的独立反馈、未知归档结果核对和确认期间的操作隔离。
20 项初始用例从 4 通过／16 失败变为全部通过，扩展专项 43 项通过；最新合并专项
248 项通过，lint、独立非增量类型检查与受限构建通过。浏览器文件发现 43 项但未执行，
仍未提交、触发 CI 或部署；旧检查点及其源码哈希不回写。

[会话元数据审查](execution/ux-audit-conversation-metadata-2026-10-09.md)
接续处理简介清空／Unicode 长度、失败草稿、当前值核对和 Reader 缓存更新。
20 项基线由 5 通过／15 失败变为全部通过；标题完整比较和旧核对动作隔离的
补充复核后，合并专项 311 项通过，lint、非增量类型检查和受限构建通过，独立
API 合同／管理测试 19 项通过。浏览器文件发现 53 项但未执行；仍只在本地，
详情和验证边界归该审查所有，不覆盖此前检查点。

[单会话归属移动审查](execution/ux-audit-conversation-placement-2026-10-09.md)
接续处理项目选择器、旧目标防护、未知结果核对和确认后即时反馈；完整失败基线
及后续焦点复核单独保留。该检查点合并专项 371 项通过，SQLite 归属／项目合同测试
18 项通过，lint、非增量类型检查和受限构建通过。浏览器发现 61 项、执行 0 项；
当前值读取不是移动回执，真实焦点／视觉／PostgreSQL 并发仍未验收，全部只在本地。

[Reader 最近打开审查](execution/ux-audit-reader-recent-2026-10-09.md)
处理迟到摘要覆盖新版本、旧页面回调、Recent 缓存失效和失败后的重复计数。
初始 24 项由 7 通过／17 失败变为全部通过；扩展专项 37 项通过，该检查点合并专项
408 项通过，隔离 SQLite 最近打开／阅读位置测试 11 项通过，lint、非增量类型检查
和受限构建通过。浏览器发现 65 项、执行 0 项；真实调度、焦点和视觉仍未验收，
旧检查点不回写，所有后续改动继续不提交、不触发 CI、不部署。

[Reader 详情读取恢复审查](execution/ux-audit-reader-detail-recovery-2026-10-09.md)
接续处理暂时刷新失败时保留正文、权限失败时隐藏缓存，以及局部只读重试。
22 项基线由 5 通过／17 失败变为全部通过；扩展专项 27 项、该检查点合并专项 435 项通过，
lint、非增量类型检查与受限构建通过。浏览器发现 69 项、执行 0 项；真实正文节点、
滚动、焦点和视觉仍未验收。本批未改动或重跑 API，仍不提交、不触发 CI、不部署。

[Reader 首批完整轮次恢复审查](execution/ux-audit-reader-initial-window-2026-10-09.md)
接续处理正文首次失败的只读重试，以及成功导航后仍残留的旧首批错误。
24 项基线由 5 通过／19 失败变为全部通过，扩展专项 32 项、该检查点合并专项 467 项通过；
lint、非增量类型检查与受限构建通过。浏览器发现 75 项、执行 0 项。加载／锚点算法
和 API 未改；导航后的首屏就绪信号另列候选，未在本批修复或验收。仍只在本地。

[Reader 静默自动保存与导航就绪审查](execution/ux-audit-reader-navigation-readiness-2026-10-09.md)
接续处理用户提出的频繁保存提示，以及独立导航成功后的监听和旧位置恢复边界。
常态保存不显示正文上方提示，真实失败与冲突仍保留恢复入口。两组 29 项基线分别由
10／11 项通过变为全部通过；扩展后自动保存 31 项、导航 29 项，最新合并专项 527 项通过。
lint、非增量类型检查和受限构建通过；浏览器发现 79 项、执行 0 项，真实几何／触控／
同步仍未验收。证据绑定 72 个源码／测试文件；不提交、不触发 CI、不部署。

此前三十余批摘要保存在[历史入口快照](archive/PROJECT_STATE-before-release-2026-10-08.md)
及各自 execution 记录中。“未提交／未授权部署”等旧状态不覆盖当前用户授权。
本地 Web 启动仍被未确定来源的工具策略拒绝；隔离 CI 浏览器证据不等同于
指定 Windows Chromium 的本地验收。具体边界见当前快照和发布记录。

## 开始这里

| 文档 | 长期职责 |
| --- | --- |
| [README](../README.md) | 产品入口、快速开始和常用命令 |
| [Project State](../PROJECT_STATE.md) | 当前仓库、实现、风险和验证快照 |
| [AGENTS](../AGENTS.md) | 最小开发与智能体工作规则 |
| [产品说明](product.md) | 当前用户能力、工作流和边界 |
| [系统事实索引](system/README.md) | 页面、功能、数据、权限和运行事实 |
| [文档台账](documentation-inventory.md) | 文档分类、所有权与维护方式 |

## 开发与运行

| 文档 | 内容 |
| --- | --- |
| [系统架构](architecture.md) | Web/API/PostgreSQL、canonical 数据和关键数据流 |
| [API 参考](api-reference.md) | 当前 FastAPI 业务接口与兼容路径 |
| [本地开发](development.md) | 环境、安装、migration、启动和测试 |
| [测试](testing.md) | 按风险选择测试、CI gate 和证据边界 |
| [生产部署](deployment.md) | CI 镜像、备份、迁移、验收、回退与运维 |
| [故障排查](troubleshooting.md) | 数据库、代理、Reader、离线、构建和容器问题 |

## 关键合同

| 合同 | 内容 |
| --- | --- |
| [发布安全](system/RELEASE_SAFETY_BASELINE.md) | 依赖风险、secret fail-fast、质量 gate、镜像检查和来源 |
| [CSP](system/CSP_ENFORCEMENT_CONTRACT.md) | 资源白名单、浏览器执行策略和验证 |
| [认证](system/AUTHENTICATION_CONTRACT.md) | 账户、设备会话、Share 与离线身份边界 |
| [离线/PWA](system/PWA_OFFLINE_RESILIENCE_CONTRACT.md) | 兼容包、旧副本保护、故障恢复与真实设备下载 |
| [内容清理](system/CONTENT_CLEANUP_CONTRACT.md) | 规则、选择、版本、源码冲突与明确确认 |
| [Artifact 生命周期](system/ARTIFACT_LIFECYCLE_CONTRACT.md) | staging、发布、事务边界和孤立文件 |
| [任务与离线保留](system/RETENTION_CONTRACT.md) | 任务结果窗口、服务器包和本机副本的区别 |
| [可观测性](system/OBSERVABILITY_CONTRACT.md) | 脱敏日志、诊断、请求与任务状态 |
| [安全清理](system/CLEANUP_CONTRACT.md) | grace、dry-run、明确 apply 和执行时重查 |

其他页面、流程、前后端、数据、权限和依赖专题从
[system/README.md](system/README.md) 按需进入；当前代码和 migration 优先。
带日期的验证只能说明相应时间点，不等于重新验收。

## 历史与数据资产

| 位置 | 使用边界 |
| --- | --- |
| [planning/](planning/README.md) | 带日期的规划；部分决定已被后续用户要求覆盖 |
| [execution/](execution/README.md) | 审计、失败过程、测试和发布证据；不替代当前事实 |
| [evidence/](evidence/README.md) | 各时间点的脱敏测量、合成截图和只读请求证据 |
| [早期 UX 交接](agent-context/UX_AUDIT_HANDOFF.md) | 历史范围说明，新任务从 Project State 开始 |
| [早期状态归档](archive/PROJECT_STATE-history-2026-09-01.md) | 2026-09-01 压缩前快照，不是当前状态 |

`apps/api/storage/imports/**/*.md` 与 `examples/**/*.md` 是用户资料或解析 fixture，
不属于文档系统。不要自动改写、移动或纳入文档链接校验。
