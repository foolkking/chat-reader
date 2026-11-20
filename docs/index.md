# 文档导航

- [v0.1.3 标签资格失败与修复](evidence/search-reading-2026-11-20/ci-44757335968-saved-search-placement.json)：冷态检查修复未发版；另定位折叠的已保存搜索晚到造成 32px 位移。[浏览器前后对照](evidence/search-reading-2026-11-20/saved-search-late-read-before-after.png)。
- [v0.1.2 已发布、生产停服前准入拒绝与修复候选](evidence/search-reading-2026-11-20/v0.1.2-publication-and-host-admission.json)：精确完整 CI、签名/GHCR、阅读证据、6.346 秒生产下载及冷态 Docker 扫描的原失败。当前生产仍以 `PROJECT_STATE.md` 为准。
- [搜索与阅读：授权边界、分页、返回现场和滚动所有权](system/SEARCH_READING_CONTRACT.md) · [改动前问题表](evidence/search-reading-2026-11-20/ux-audit.md) · [60 项浏览器验证及失败记录](evidence/search-reading-2026-11-20/verification.json)（本轮候选，生产以精确发布回执为准）
- [后续 CI 44676319339 失败与修复](evidence/search-reading-2026-11-20/ci-44676319339-repair.json)：分页 74px 位移、手机查找关闭焦点及旧弹窗测试适配；后续完整 CI 未通过前不发布。
- [CI 44728601066 失败与修复候选](evidence/search-reading-2026-11-20/ci-44728601066-repair.json)：附件夹具遗漏回调、原生输入与迟到恢复的分阶段观测；保留 72px 原失败及未复现边界。

- [本地未发布：单条对话内查找](system/NAVIGATION_SEARCH_IMPORT_EXPERIENCE.md#reader-find) · [长对话快速下滑与书签恢复](system/IMAGE_READING_STABILITY_CONTRACT.md#virtual-reply-offset) · [验证回执](evidence/reader-find-motion-2026-11-20/verification.json)
- [当前生产 v0.1.1：发布、部署、两种耗时与备份边界](deployment.md#v011-production) · [发布回执](evidence/reader-media-motion-2026-11-19/v0.1.1-production.json) · [当前单份备份恢复与清理回执](evidence/online-update-2026-11-18/king-backup-retention-2026-11-20.json)
- [历史：合并前候选的精确 CI 与当时的保护规则阻塞](evidence/reader-media-motion-2026-11-19/release-qualification.md#subsequent-exact-full-ci)
- [历史：11 月 19 日本机真实恢复与当时单份服务器备份](deployment.md#最新保留状态本机隔离恢复与单份服务器备份--2026-11-19)
- [Reader 正文媒体滚动复审与逐帧验证](evidence/reader-media-motion-2026-11-19/ux-audit.md)（合成数据、本机真实浏览器；对应修复已部署）
- [网页升级：安全接入、Fork 发布、回滚与故障恢复](system/ONLINE_UPDATES.md) · [`king` 已接入；下一次升级的容量条件](system/ONLINE_UPDATES.md#king-enrollment)
- [侧栏前后截图与在线升级隔离验收](evidence/online-update-2026-11-18/verification.md)

## 历史生产：排序、搜索与导入管理，26b35501 / 0062 — 2026-11-18

[实现合同、界面规则和验证边界](system/NAVIGATION_SEARCH_IMPORT_EXPERIENCE.md)：
导入来源可信度／停止放弃、分范围排序0062、服务端对话聚合搜索及精简布局。
16:13:43 +08:00发布，16:18:42备份后独立运行态／TLS复核通过。
CI44235842239/attempt1的成功由用户确认；本地精确制品的17项前置质量证据、
五项真实内存门禁及镜像身份已核验，不声称通过SSH查询了Actions实时状态。
停写备份、0061→0062迁移、业务数据保全及健康核验见
[脱敏发布回执](evidence/navigation-search-import-2026-11-17/production-release-26b35501.json)。
只删除批准的两份旧传输包；新旧两份备份保留，产品体验与生产恢复演练未验收。
[依赖风险与复核期限](system/RELEASE_SAFETY_BASELINE.md#dependency-policy)与整站验收分开记录。
此前991eabc/44135067562等失败仍保留；下方旧生产指针和暂停指令均为历史检查点。

## 历史：第二轮CI两次全绿，实测20分39秒 / 22分24秒 — 2026-11-17

精确修复提交3d46555的普通完整CI43942265966、43952795958均attempt1、19 job全绿，
原API7010/7007通过/3跳过、Web14、Settings470+restore1、Reader及五项内存门禁、
独立原生结果和镜像制品核验均通过。较57分47秒基线缩短61%–64%，观察到的总runner
分钟增加约16%；峰值14。两次本机55分钟等待不计入CI耗时，不把失败运行当收益。
[两轮完整证据](evidence/reliability-2026-11-16/ci-scheduling-v2-two-green-results.json) /
[发布合同](system/RELEASE_SAFETY_BASELINE.md) /
[唯一状态台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。
两次均观察到依赖缓存命中；Windows空缓存安装/全新检出离线复用通过，
**完整冷缓存LinuxCI仍未验证**。生产71342129/schema0061未变，不需CI-only重部署。
指定五项旧断言已独立修复8adaf9f；首个19-job运行43928590278的四处合同适配遗漏见
[失败证据](evidence/reliability-2026-11-16/ci-scheduling-v2-failure-43928590278.json)。
[定点修复与缓存诊断](evidence/reliability-2026-11-16/ci-scheduling-v2-contract-repair.json)
作为历史保留，不用后续成功覆盖旧失败。详细分片、关键路径与剩余验证以唯一台账为准。

## 前一检查点：71342129 已部署并独立核验 — 2026-11-17

ZIP 辅助子目录中的 Markdown 默认不再作为对话导入；只选择安全归一后的最外层正文，
更深文件需正文引用或显式启用。详见[源码合同](system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md#markdown-resource-selection--source-candidate-2026-11-16)。

71342129 / CI43820675687 attempt1 普通完整 CI 六 job 全绿，耗时57分47秒；真实55分钟
双时钟等待及独立制品核验完成。生产于**2026-11-16 21:46 +08:00**原子切换到
**71342129 / schema0061**，21:49 +08:00独立核验通过，未执行迁移。新的0061停写备份、
零issue只读附件审计和保护文件复核通过；具体边界见[发布证据](evidence/reliability-2026-11-16/ci-zip-markdown-production-release.json)。
产品验收由用户完成，不因技术部署而改标通过。

首轮优化完整CI `43888192134/attempt1`（`c4e825f`）在43分29秒失败于两个Web shard；
API、Reader、两个Settings shard及原470聚合/restore通过，下游镜像/制品跳过。根因已定位并最小修复：
普通Web shard不再错误运行依赖历史Git树的image-only策略测试，Markdown测试接受代码已有的中英文按钮名；
未放宽断言、超时或其他门禁。修复本地Node152、Python16+102、lint/typecheck和Actionlint通过，
浏览器门禁仍待新一轮精确普通完整CI。失败时长不算提速收益；修复与复跑边界见
[失败回执](evidence/reliability-2026-11-16/ci-scheduling-failure-43888192134.json)、
[修复验证](evidence/reliability-2026-11-16/ci-scheduling-repair-verification.json)和
[唯一状态台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。CI-only修复不需重新部署应用。
见[唯一状态台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。

## 部署前检查点：ZIP CI通过、现役恢复、fresh部署待容量（历史）— 2026-11-16

任意辅助子目录Markdown误作对话的修复已提交71342129；
普通完整CI43820675687 attempt1六job全绿，**57分47秒**，新真实55分钟双时钟
等待和[独立制品核验](evidence/reliability-2026-11-16/ci-zip-markdown-independent-release.json)
完成。API7007/3原skip、213 portable（含ZIP98）、Web14、Settings470+restore1、
Reader9/27 cold及原五memory通过。不是产品验收或已经部署。
见[源码合同](system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md#markdown-resource-selection--source-candidate-2026-11-16) /
[唯一状态台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。
现役仍2463f298/0061；两项具体清理获确认并完成，只留11月16日旧备份，
dnf根目录、镜像、数据及八文件保全。7134镜像已完整加载，但原容量门禁拒绝；
18:56恢复三个原现役容器并撤除任务屏障，19:02独立健康/保全复核通过。
最新仍差约31.4MiB；仅提议额外删除已验证且本机完整保留的169.4MiB传输包，
尚未获准。未启动候选应用、创建新备份或迁移，不重放旧hold/load。
[清理、失败与恢复证据](evidence/reliability-2026-11-16/ci-zip-markdown-production-resumption.json) /
[清理前readiness](evidence/reliability-2026-11-16/ci-zip-markdown-production-readiness.json)。
[受限清理控制与新只读预检](evidence/reliability-2026-11-16/ci-zip-markdown-cleanup-controls.json)
完成Linux74/0skip及真实Python3.6.8宿主20项重叠纯控制；17:26清理前元数据预检的
拒绝/confirmation false和预测约89MiB余量原样保留，不冒充后续实际释放或准入。
隔离CI优化现为[15文件本地候选](evidence/reliability-2026-11-16/ci-scheduling-isolated-verification.json)，
实际完整CI收益未测；ZIP成功部署后才接回。用户负责产品验收。

## 上一发布：2463f298/0061已部署（随后CI优化已暂停）— 2026-11-16

已提交/推送2463f298，普通完整CI43737444629六job全绿，58分03秒；
真实新55分钟双时钟等待完成，API6909/原3跳过、115新增逐项通过，
Web14、mounted45、Settings470+restore1、Reader9/27 cold及五项memory通过。
[独立精确制品证明](evidence/reliability-2026-11-16/ci-cold-merge-independent-release.json) /
[唯一台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。
生产63/64/74/75已完成，独立84在11:50 +08:00核验精确镜像/RootFS、健康、
匿名/TLS、配置及其他容器、两备份和8个保护文件通过，现役2463f298/schema0061。
8文件已按单独批准可逆移动并保留全部字节/inode/元数据；原865b0a6备份与
新停写3564cbf/0060独立备份均保留，无旧worker直接回退，不重放本次发布。
[发布及独立复查](evidence/reliability-2026-11-16/ci-cold-merge-production-release.json) /
[历史阻塞及保全](evidence/reliability-2026-11-16/ci-cold-merge-production-held.json) /
[后端修复合同](system/BACKEND_AND_API.md#cold-merge-policy-resolution--source-2026-11-16) /
[原失败与本地限制](evidence/reliability-2026-11-16/ci-cold-merge-verification.json)。
用户已恢复真实使用，不干预新导入或要求全卷恒等于停写快照；原871个导入文件
全部字节仍由新备份保护，后续19个live文件缺失的具体删除原因未全部证明。
接续优化不必要的串行调度，保留全部门禁与独立DB/单worker，必须用新完整CI
实测；新派发后真实等55分钟自行查看，不建安排。产品验收归用户，旧151ms
原因不改标，未来发布仍需fresh容量/备份/兼容性/精确镜像与独立健康准入。

## 前一检查点：小预算 worker 冷启动与持续发布闭环 — 2026-11-15

4ca1ed5/43688838312四项质量全部通过，builder在原320MiB/no-swap、
180秒v1 ZIP分析门禁失败；末态/OOM未保留，无可部署制品。
[正式失败](evidence/reliability-2026-11-15/ci-worker-budget-failure.json) /
[worker合同](system/BACKEND_AND_API.md#worker-registration-and-single-use-preparation--source-2026-11-15) /
[ZIP资源边界](system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md#single-use-worker-preparation--source-2026-11-15) /
[只读失败取证](system/OBSERVABILITY_CONTRACT.md#synthetic-resource-failure-projection--source-2026-11-15) /
[唯一台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。
当前单次待机解释器不持DB连接/执行lease，不与维护、恢复或另一执行重叠；
原注册/格式兼容和全部门槛保留。五项本机资源实测、Linux生命周期142、
ORM10/失败投影5及静态通过；更高的约116MiB真实idle代价必须一起说明。
最新完整Windows相关矩阵仍1失败/1079通过/14跳过；Linux收集失败和中断矩阵
不改标通过。仅新增测试的严格libmagic只读发现边界修复后，真实Linux75、
原Nginx1和Windows隔离18通过；6904项/新增107只是实际收集，不是全量执行。
[定点验证](evidence/reliability-2026-11-15/ci-worker-budget-verification.json) /
[1422输入](evidence/reliability-2026-11-15/ci-worker-budget-inputs.json)
保留原失败/69旧回执，不用局部通过覆盖广泛失败；尚非新精确CI验收。
接续普通完整CI后新真实等55分钟自行查看，失败继续修，通过并核验新制品后
部署，再优化CI耗时；用户负责产品验收，旧151ms根因不改标。

## 前一检查点：Reader 原生滚动回退修复与持续发布闭环（历史）— 2026-11-15

2e0a1fe/43681565051仅候选Reader plain10000冷1失败：真实锚点回退120px，
高度/挂载数不变且没有长任务。API6794、Web14、Settings470+restore1通过；
独立诊断9通过不能替代主失败，两发布job跳过。
[正式失败](evidence/reliability-2026-11-15/ci-reader-scroll-failure.json) /
[Reader合同](system/FRONTEND_ARCHITECTURE.md#reader-edge-physical-motion-fence--2026-11-15) /
[唯一当前台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。
边界恢复仅接受capture时物理位置及自身实际写入；外部滚动退役旧恢复，
不伪造用户意图或动态改变真实锚点。原25/43用例主体保留，本地37/45/
UX2556、CI89/Python100、静态及新550输入Windows构建通过，尚非新Linux验收。
[验证](evidence/reliability-2026-11-15/ci-reader-scroll-verification.json) /
[1413输入](evidence/reliability-2026-11-15/ci-reader-scroll-inputs.json)
保护64旧回执/13无关文件。普通完整CI后真实新等55分钟自行查看，失败继续修，
通过并核验新制品后部署，再优化CI耗时；剩余产品验收归用户，旧151ms根因未改标。

## 前一检查点：离线批次等待延迟修复与持续发布授权（历史）— 2026-11-15

d983521/43629368808仅Settings失败：真实21副本准备在原60秒内发起20份/
下载19份，尚未进入分页断言；前19份已完成任务的状态观察累计晚11.043476秒。
[正式诊断](evidence/reliability-2026-11-15/ci-offline-latency-failure.json) /
[离线合同](system/PWA_OFFLINE_RESILIENCE_CONTRACT.md) /
[唯一当前台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。
最新授权覆盖历史暂停条款：修复验证后提交普通完整CI，真实新等55分钟后
自行查看；失败继续修，通过并核验制品后部署，再优化CI耗时。用户负责产品验收。
当前有界观察/辅助进度/健康交接候选的Windows原21份探测仍失败；
不能标吞吐修复或用控制测试替代新的精确LinuxCI，详细边界只在同一台账。
[本地371/214/静态与完整失败回执](evidence/reliability-2026-11-15/ci-offline-handoff-verification.json) /
[1413输入](evidence/reliability-2026-11-15/ci-offline-handoff-inputs.json)保留13无关文件与62旧回执。

## 前一检查点：Reader 失败取证，性能根因仍未确认（历史）— 2026-11-15

2495fb1/43613433508仅候选math10000冷2失败：原生长任务151ms超过原150ms，
总计231ms仍在250ms内。API6751、Web14门禁、Settings470+restore1通过；
候选8/1，历史baseline0/9，两发布job跳过，无镜像。
[正式失败](evidence/reliability-2026-11-15/ci-reading-capacity-failure.json) /
[本地验证](evidence/reliability-2026-11-15/ci-reading-diagnostics-verification.json) /
[1410输入](evidence/reliability-2026-11-15/ci-reading-diagnostics-inputs.json) /
[性能合同](system/PERFORMANCE_CAPACITY_CONTRACT.md) /
[唯一台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。
补普通原生时间跨度/归因和失败后的独立全序列CPU诊断，不放宽原门槛；
诊断通过不能抹掉主失败，也不宣称151ms产品根因已修复。
选择性提交/正常推送，仅派发一次空quality source普通完整CI；实际身份由
随后`ci-reading-diagnostics-dispatch.json`登记，确认即暂停，不回查/安排/取消/部署。

## 前一候选：可靠性整块治理（历史）— 2026-11-14

普通完整CI3d8f77f/43604634535最终仅Web失败，API6751、Settings470+restore1、
候选阅读比较9通过；后十项Web及两发布job未执行，不能继承为新发布验收。
[最终失败](evidence/reliability-2026-11-14/ci-full-quality-final-failure.json)核验四日志/三诊断ZIP。
只修原安全测试的旧工作流合同并加33拒绝控制；本地源码36/Python100/Node77、
lint/typecheck通过，[验证](evidence/reliability-2026-11-14/ci-release-contract-verification.json) /
[1409输入](evidence/reliability-2026-11-14/ci-release-contract-inputs.json)。
业务、工作流、依赖及资源门禁不改；选择性提交/正常推送，空quality source只派发
一次完整CI。随后`ci-release-contract-dispatch.json`出现即以其实际run为准并暂停，
不等待/轮询/安排/取消/部署；旧派发和仍在运行时的Web快照原字节保留。

以下为此前独立事件/部分CI快照，不覆盖上方最新修复：
最新独立停止请求已完成：原worker自行回滚失败，4个来源实际哈希全部保全；
23:12 +08:00复核活动/排队任务及锁等待为0，worker空闲，生产仍3564cbf/schema0060。
[本次事件](evidence/reliability-2026-11-14/production-stall-recovery-followup.json)。
普通CI3d8f77f/43604634535的Web在线专项44通过/1失败，旧工作流字面断言待修；
[独立失败](evidence/reliability-2026-11-14/ci-full-web-failure.json)不代表整次已结束。
本轮未修测试、重新提交/派发、取消CI或部署；旧事件与派发字节保留。

最新授权改走普通完整CI：选择性提交/正常推送，只派发一次原工作流，
`quality_source_run_id`为空，四项质量及镜像/独立制品门禁全部新跑。
确认派发身份后暂停，不等待/轮询/安排/取消/部署；随后独立
`ci-full-quality-dispatch.json`存在后不得重复派发。
b84ac1d/43599055418在下载原API日志时失败，控制37+34/Node77通过，
镜像/内存未执行、制品0；HTTP错误类型未保留，不能定性为权限或网络根因。
本地GET容错/脱敏及完整模式控制通过100项，原工作流/业务/资源输入不改。
[当前发布合同](system/RELEASE_SAFETY_BASELINE.md#ordinary-full-ci-after-image-only-failure--2026-11-14) /
[独立失败](evidence/reliability-2026-11-14/ci-image-only-selector-failure.json) /
[本地验证](evidence/reliability-2026-11-14/ci-evidence-transport-verification.json) /
[唯一台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。不复用旧质量或扩展来源链。

### 前一精确selector授权（历史，唯一派发已失败）

用户已单独批准精确selector夹具及来源链修正、选择性提交/推送和一次仅镜像CI。
当前准入固定4481→74f→单一直系候选，先验证74f全Git树及原严格修复证明，
再绑定唯一测试SHA；原37控制和补丁不改，新增34控制及两处depth3检出。
原37/新增34、干净与合成脏Node77、真实Git准入/十项拒绝、静态语法均通过；
不等于新完整质量、Linux内存/镜像或生产验收。全部资源/制品门禁仍须新跑。
确认唯一派发后立即暂停，不回查/安排/取消/部署，由用户反馈。
新`ci-image-only-selector-dispatch.json`出现后禁止重复派发。
[当前发布合同](system/RELEASE_SAFETY_BASELINE.md#authorized-selector-fixture-repair--2026-11-14) /
[独立验证](evidence/reliability-2026-11-14/ci-image-only-selector-lineage-verification.json) /
[唯一台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。

### 前一镜像控制失败与本地诊断（历史）

镜像补跑74f4636/CI43591310367已失败：新增控制步骤中策略37通过、Node71/1，
镜像、内存和来源证明尚未执行，制品0。原selector测试依赖脏工作区；
本地改为独立Git夹具，保留两原场景并追加五项，干净/脏检出均77项通过。
原发布策略未扩大，拒绝后续新parent及旧测试变更；再次仅镜像提交/派发须
单独审核并获准，不能直接重跑或绕过门禁。未提交/推送/派发或操作生产。
[本次失败](evidence/reliability-2026-11-14/ci-image-only-failure.json) /
[本地修正](evidence/reliability-2026-11-14/ci-image-only-selector-verification.json) /
[唯一台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。

### 前一受保护镜像补跑检查点（历史，原严格证明保留）

最新授权：修正4481fa3/CI43578495558的镜像验证脚本，并只补跑镜像路径。
正式结果确认四项质量job成功，Settings470+独立restore1完整通过；
build-images在正常`failure:null`状态读取时崩溃，资源报告不完整，不是内存通过。
默认完整六job保留；只有指定该run且应用/依赖/原测试/资源输入字节未变、
精确一行脚本修正和受保护workflow补丁才可复用质量结果。内存五例、
镜像及独立制品门禁全部新跑，失败/过期/未知来源拒绝，不自动绕过或回退。
[发布合同](system/RELEASE_SAFETY_BASELINE.md#authorized-image-only-control-plane-repair--2026-11-14) /
[失败回执](evidence/reliability-2026-11-14/ci-build-images-failure.json) /
[本轮验证](evidence/reliability-2026-11-14/ci-image-only-verification.json) /
[唯一台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)。
选择性提交/推送并仅派发一次；确认后暂停，由用户反馈，不轮询/安排/部署。
原回执字节保留，新`ci-image-only-dispatch.json`只记录本轮实际提交与run。

### 前一离线依赖修复（历史）

11月14日本轮最新指示：修复、选择性提交/推送、只派发一次完整精确CI，
不设项目job/step总限时；确认后立即暂停，不等待/轮询、建安排或部署，
由用户反馈结果。GitHub每job仍有六小时平台上限，原用例/worker/PG/
内存/逐帧与发布门禁不变。4a943ea的CI43566365014已完成失败：
Settings跑63分32秒，470矩阵469通过/1失败，不是job总超时；独立restore未运行。
本轮仅延后未选中的FastAPI/HTTPX依赖，保留真实Request/异常、离线及保留语义。
最终API486通过/72显式PG或平台跳过、CI72/离线Node205、静态/单head通过；
1399输入及十三保护文件保全，旧548输入不变不称新build/PWA。
[本批验证](evidence/reliability-2026-11-14/ci-offline-optional-verification.json) /
[本机诊断](evidence/reliability-2026-11-14/ci-offline-optional-import-diagnosis.json) /
[独立失败回执](evidence/reliability-2026-11-14/ci-offline-optional-failure.json)。
当前执行以[唯一台账](system/SMALL_HOST_IMPROVEMENT_STATUS.md)及随后独立
`ci-offline-optional-dispatch.json`为准；原派发回执不重写，旧run成功项不继承。
回执出现后不得根据旧“待派发”重提交；生产未复查或变更。

### 前一冷启动及发布检查点（历史）

11月13日最新指示：验收由用户完成，本任务负责选择性提交/推送、等待完整
精确CI，成功后按安全流程备份/迁移/部署。既有自动门禁不放宽，
不清理生产、不重放用户资料；下方较早的“未授权再次提交”是历史边界。
冷启动最小修复已本地验证：按任务/格式加载原处理器，扫描不加载应用写回/
索引服务，保留原错误与委托接口，维护原2秒预算包含导入。最终46模块
API **591通过/65跳过**（含新增23项）、CI脚本64、lint/typecheck/单head通过；
1395输入/十三保护文件无漂移。Windows纯导入诊断不冒充Linux或整次CI提速。
[本地验证](evidence/reliability-2026-11-14/ci-worker-startup-verification.json) /
[导入诊断](evidence/reliability-2026-11-14/ci-worker-startup-import-diagnosis.json)；
待选择性提交和新完整CI，不提高60分钟/并发，不继承旧结果。
此前修复`9a084146`已选择性提交/推送十四文件，十三保护文件无漂移；
完整精确[CI43543975636](https://github.com/foolkking/chat-reader/actions/runs/43543975636)
在**10:01:44.250642 +08:00**确认派发。wall-clock边界10:51:44.250642；
原等待器10:03:18.450682启动，须另满足新3000秒monotonic等待，实际首读
UTC预计**10:53:18.450682**。实际请求**10:53:18.448494**、结果收到
**10:53:21.276186**，派发wall-clock3094.197852秒/新monotonic3000秒通过；
首次快照API/阅读比较成功，Web/Settings执行中；**11:04:21.516068**独立确认
整次completed/cancelled，Settings触及原60分钟上限，取消请求0次。
API/Web/阅读比较成功，两发布job跳过；451项打印通过、三项终止窗口失败，
470矩阵/独立restore未完成，整次CI/制品/部署未验收。
[独立失败/耗时回执](evidence/reliability-2026-11-14/ci-settings-scheduling-failure.json)
保留正式注解、实际未完成gate及四日志/三ZIP；尾部失败与API关闭时序尚未定性。
同名344项打印耗时少440.5秒仍超时，当前调研fresh-child冷启动成本，
不提高超时/并发、不重启本机PG或完整站点。
[首读实际时钟回执](evidence/reliability-2026-11-14/ci-settings-scheduling-first-read.json)
保留UTC预计的2.188ms差异，未改写原时间；
[本次派发回执](evidence/reliability-2026-11-14/ci-settings-scheduling-dispatch.json)
不覆盖下方失败/事件回执，不继承旧run的局部成功。
[等待期最终核验](evidence/reliability-2026-11-14/ci-settings-scheduling-consumer-final-preparation.json)
仅为本地消费者/安全控制：83项通过，要求新官方日志的17唯一监督场景、
真实PG的poll1/poll20及原Settings470+restore1通过；不冒充新CI、应用重测
或fresh生产准入，不继承旧制品诊断。
基线候选`b2d3a65`已选择性提交/推送二十文件，十三保护文件无漂移。
完整精确[CI43531859718](https://github.com/foolkking/chat-reader/actions/runs/43531859718)
首读**08:56:06.772164 +08:00**满足新3000秒双边界；**09:09:01**独立确认
completed/cancelled，取消请求0次。API/Web/阅读比较通过，Settings原60分钟
上限超时，取消前344项通过；API关闭后的五条失败不是此前断言失败。
470矩阵/独立restore未完成，两发布job跳过，未部署。
[独立失败与耗时回执](evidence/reliability-2026-11-14/ci-runtime-frame-failure.json)
保留[派发](evidence/reliability-2026-11-14/ci-runtime-frame-dispatch.json)及官方诊断；
当前仅修复子进程结束后的无条件idle等待，所有租约/核对/空队列节流不变。
新完整CI仍须通过，不继承本次局部成功；详情只维护同一台账。
[本地最终回执](evidence/reliability-2026-11-14/ci-settings-scheduling-verification.json)
记录API153通过/43跳过、CI脚本64及静态/单head；1392输入与十三文件保全。
548项旧Web构建输入未变，不冒称新build、真实PG/Linux或完整CI验收。
前次修复`74a1e86`选择性提交/推送十九个白名单文件，十三个无关文件保全。
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
