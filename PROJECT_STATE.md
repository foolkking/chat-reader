# Project State

**2026-11-21 导入低内存候选（未部署）：** 普通 Markdown 可逐条分析，符合有界条件的旧 v1 JSON 草稿可逐条提交；内存充足保留原批量路径，不降低全局预留或增加 worker 并发。真实 640 MiB／禁额外 swap 容器中，800 条 JSON 草稿由旧版内存拒绝变为成功，800 条 Markdown 也成功，正文及来源引用核对一致；不是任意 JSON 原始格式的流式分析。新增 39 项和原 ZIP 兼容回归通过。完整 CI 与原 1900 MiB 升级演练尚未重验；备份恢复核验／清理进行中，生产仍为下述 v0.1.4。[合同与限制](docs/system/ADAPTIVE_IMPORT_CONTRACT.md#message-sized-work-under-fixed-memory--candidate-2026-11-21) · [实测、失败记录](docs/evidence/import-units-2026-11-21/README.md)。

**工作分支候选（不是生产版本）：** 在线升级区分签名版本对的「仅换程序」与「完整维护」，按角色保留真实镜像；老实例默认仍走完整备份。见[管理员及运维接入边界](docs/system/ONLINE_UPDATES.md#首次启用仅换程序独立维护窗口)及[隔离验证记录](docs/evidence/program-cutover-2026-11-21/README.md)。`king` 不作为性能演练环境。

**2026-11-21 16:28（北京时间）候选资格：** `508dae710086e607613cb63f1fbef19c786fc7a4` / `44883010518/1` 完整 CI **19/19**；命令等待 1500.011 秒后读取精确运行，下载制品与实际镜像身份再次独立核验。两轮各 30 次隔离浏览器升级最慢分别为 11.46 / 11.392 秒，不代表生产或 GitHub CDN 耗时。**未发布、未部署：** 默认 640 MiB worker 的导入提交验收仍因内存预留拒绝；768 MiB 独立对照通过，不替代默认门禁。首次接入仍需完整维护，而生产备份盘尚不足。见[精确 CI 与制品回执](docs/evidence/program-cutover-2026-11-21/ci-44883010518-qualified.json)及[验收边界](docs/evidence/program-cutover-2026-11-21/README.md#最终资格与交付边界)；本条之后的证据文档提交不冒充该 SHA 的代码资格。

**当前生产：`king` 已于 2026-11-21 02:23:18（北京时间）升级到 `v0.1.4` / `8d093ef59a488b3c4820b6a26575f79120c1b8de`。** 搜索与阅读修复已上线。精确资格 `44772266798/1` 19/19、签名发布 `44765766532/2` 3/3、阅读稳定性 60/60。02:26:53 独立核验 HTTPS、实际镜像、worker 心跳、业务卷和配置通过；未迁移数据库（`20261117_0062`）。
生产下载 **6.497 秒**；确认升级至登录页重新开放 **549.739 秒**，未达到 15 秒目标。最新停写备份已校验；旧备份曾在隔离环境成功恢复，仍保留。02:28:29 的只读预算显示下次升级／回滚空间不足，不可仅凭面板显示上一版就开始操作。见[部署、备份与实测](docs/deployment.md#v014-production)和[完整脱敏回执（含失败尝试）](docs/evidence/search-reading-2026-11-20/v0.1.4-production.json)。

**历史资格，2026-11-20：** `v0.1.3` 精确标签 `ed9b1ad` 的资格 `44757335968/1` 为 15 成功、1 失败、3 跳过，父发布没有执行演练或公布 Release。
独立的已保存搜索读取在收起状态结束时移除 32px 提示行，把已选命中拉离指针；不是先前 74px 的连续阅读入口问题。
本机真实组件复现 32px；修复后中英文、375/1440px、两种续页共 8 组均 0px，原断言未放宽。见[原失败、前后测量与验证边界](docs/evidence/search-reading-2026-11-20/ci-44757335968-saved-search-placement.json)。此检查点不宣称新候选已发布部署。

**2026-11-20 22:41（北京时间）发布／部署检查点：** `v0.1.2` / `c3dbd75728928b859c5fbe4a14fb930eb07cd8ff`
已发布，精确资格 `44745323215/1` 19/19、签名发布 `44745297688/1` 3/3 均通过；签名包、GHCR 和 60 项阅读证据独立核验通过。
`king` 仍为下述 `v0.1.1`：在线准备下载 6.346 秒、总计 255.561 秒，但两次重启准入均在停服前拒绝。
Docker 非原生 overlay diff 的完整性扫描冷态实测超过 15 秒；当前修复只给这一个固定只读操作 120 秒有界等待，其余查询仍 15 秒，核心路径检查及失败关闭不变。
修复尚待精确发布 CI 与签名工具包接入，不手改生产执行器或状态。仅清理已授权 DNF 缓存约 217 MiB，未删备份、镜像或用户数据。
见[正式发布、原失败与宿主机准入证据](docs/evidence/search-reading-2026-11-20/v0.1.2-publication-and-host-admission.json)。

**上一生产版本：`v0.1.1` / `1d1a3c759e11c82f02865bd0c3359c9fbeaa2eba` / schema `20261117_0062`。**
2026-11-20 02:34:30（北京时间）`king` 已切换，02:36:50 完成备份后的独立运行态、HTTPS 和 worker 心跳复核。
PR #2 合并后的精确标签通过完整 CI `44576778073/1`（19/19）；发布 `44568680941/2` 的资格、隔离演练与签名发布均通过。
第一次发布尝试在 `docker push` 失败，证据保留；正式包及 GHCR 的两份镜像已独立核验。数据库未迁移。
侧栏、设置和正文阅读修复已部署。`king` 随后单独接入宿主机网页更新器；03:17:15 复核两个服务均运行且开机启用，真实 API 桥检查签名稳定源返回当前 `v0.1.1`、无新版。没有发起生产版本切换。
03:48:16 复核：部署前的最新备份已在本机隔离恢复，`king` 只留这一份和配套回滚镜像。删除旧备份后可用 **7.16 GiB**，`--retained-images` 预检通过；比本版完整包参考预算仅多 **57.7 MiB**，下次仍须按实际制品重算。见[恢复与清理回执](docs/evidence/online-update-2026-11-18/king-backup-retention-2026-11-20.json)和[运维边界](docs/system/ONLINE_UPDATES.md#king-enrollment)。
[部署与保留边界](docs/deployment.md#v011-production) · [签名、失败尝试、实测与生产回执](docs/evidence/reader-media-motion-2026-11-19/v0.1.1-production.json)。

**发布前候选记录，2026-11-20：** [搜索与阅读合同](docs/system/SEARCH_READING_CONTRACT.md)覆盖手机边读边找、独立授权分享查找、离线中文句中命中与续页、全局结果返回现场，以及旧刷新和缓存书签抢滚动的修复。隔离生产构建的 **60 项阅读／媒体／搜索浏览器测试**和独立证据检查通过；另通过 7 项离线与 1 项保存搜索恢复测试。未在生产演练，不代表 iOS／Android 真机验收。见[修改前问题表](docs/evidence/search-reading-2026-11-20/ux-audit.md)及[本轮验证、失败记录和截图](docs/evidence/search-reading-2026-11-20/verification.json)。之前的 [52 项本机检查点](docs/evidence/reader-find-motion-2026-11-20/verification.json)作为历史保留，不代替本轮精确 CI。

**历史：第二次 CI 失败及当时的候选验证：** `9ae0a64` / `44728601066/1` 为 14 成功、2 失败、3 下游跳过。
附件浏览器夹具遗漏真实 Escape 回调的依赖，启动报错被掩盖成 30 秒超时；已补齐实际回调并让页面异常直接报错。
阅读门禁 59/60 通过，手机迟到书签例记录 72px；旧基线没有确认最后一段原生输入已完成。
新观测仅在响应仍扣留时等待最终输入和连续静止帧，不吞掉释放响应后的位移，峰值 ≤2px／最终 ≤1px。
本机真实组件 24 例及 72px 故障注入验证通过，但未重现该 Linux CI 位移，原因仍不能定论；
不将组件结果当作整站或新 SHA 资格。见[完整失败表、修复及未验证边界](docs/evidence/search-reading-2026-11-20/ci-44728601066-repair.json)。

**历史：第一次 CI 修复：** `60c431a` 的 `44676319339/1` 为 14 成功、2 失败、3 下游跳过，不能发布。
分页出现连续阅读栏使已有命中移动 74px；将入口放到结果后，同源浏览器红绿对照为 0px。
手机专注查找改为行内条后，旧弹窗门禁未适配；同时补齐正文获焦后 Escape 的恢复路径，
保留定位、焦点和滚动断言。原整站 60 项通过属于上一候选；本次本地整站启动被执行策略拒绝，
仅宣称实际通过的组件浏览器与源码门禁。见[失败全表、红绿证据和验证边界](docs/evidence/search-reading-2026-11-20/ci-44676319339-repair.json)。

**历史：2026-11-19 候选全绿、当时合并受阻。** `a3512d7103fd8d5f2b9fc3941ba206cf50313f1c`
完整 CI `44551142239/1` 19/19 成功，真实命令等待1500.085秒后读取，精确镜像包独立核验通过。
PR #2 为 `codex/fix-release-project-sort`；`br` 对全分支禁止更新且无例外，Git SSH推送和PR合并被阻。
尚未更改保护规则、重写`v0.1.0`、创建新标签、正式Release或部署。恢复/发布证据文档为之后的工作树更新，
不能把候选CI用于认证这些文档的新提交。见[精确检查点](docs/evidence/reader-media-motion-2026-11-19/ci-and-publication-checkpoint.json)。

**2026-11-19 保留状态更新，未部署新版。** 本机加密隔离恢复11月18日备份通过：93表、91业务表指纹、
四类4,155文件及配套镜像验证一致。11月16日备份完整收存后，其服务器副本已按授权删除；
`king`只留11月18日一份，现役仍26b35501/0062，23:15 +08:00独立健康复核通过。
精确容量和恢复边界见[部署状态](docs/deployment.md#最新保留状态本机隔离恢复与单份服务器备份--2026-11-19)。

**2026-11-19，首次签名发布资格未通过。** `v0.1.0` 固定在 `71f5b7e`：
资格运行 `44531226887/1` 在短正文滚轮门禁失败；父运行 `44531165012/1` 正常阻止发布。
修复只保留已加载且有明确大小上限的简单短对话前缀，不改门槛或大型对话的回收。
见[失败制品与本机红绿对照](docs/evidence/reader-media-motion-2026-11-19/release-qualification.md)；
不表示新版本已发布或已部署。

后续完整 CI `44542132920/1` 的阅读分片通过，Web 分片 2 在 375px 空项目页首次排序点击超时。
项目自身的排序元数据现从稳定的项目列表键读取，不因目录展示顺序晚到而在按下和松开之间禁用按钮。
本机保留原失败并用真实指针事件作红绿对照；权限、版本写入和原端到端断言不变。

**发布前工作树验证（以下功能随后进入 `v0.1.1`）**：侧栏搜索固定为全部对话；项目与未归类收起仅保留标题。
“最近”不再作为侧栏标签；手机首页和两端快捷操作保留入口。左下设置的排序按栏宽排列。
根管理员在 **设置 → 管理 → 运行状态 → 版本更新** 可选接入宿主机分两步升级：后台下载、验签并预装，明确确认后才停写、备份、切换和核验。普通设置和系统备份不显示版本提示。
Reader 另修复公式虚拟行外边距逃逸、图片行首次宽度估算及跨轮加载后的延迟锚点回拉；桌面/触屏真实浏览器矩阵和既有阅读稳定性套件均通过。
另外确认纯文本停滚回收也可能跳跃：仅在同步裁剪造成浏览器钳位时恢复原 DOM 锚点；同一挂载夹具的漂移从 495.375px 降到 0.375px。这不是对 CI 长任务成因的推断。
对于向下翻页，只有可证明原有全部轮次、消息和上边界未变且原滚动容器已经溢出时，追加后才不再同步读取布局。向上加载、内容变化、数据过大而无法比对等情况仍走原锚点校正。运行状态的执行恢复与版本面板使用独立身份，收起恢复面板即卸载其内容。
见[Reader 媒体几何合同](docs/system/IMAGE_READING_STABILITY_CONTRACT.md)、[复审与脱敏验证](docs/evidence/reader-media-motion-2026-11-19/ux-audit.md)、[在线更新接入与隔离验证](docs/system/ONLINE_UPDATES.md)。
上述为发布前的验证边界；实际生产版本以本页最上方的精确发布回执为准。

## Historical production: 26b35501 / schema 0062 — 2026-11-18

Exact **26b35501bf7011910a83bb23e8982139f8129b7b** was deployed at
**16:13:43 +08:00**; independent backup verification completed at16:17:38,
followed by a fresh runtime/TLS check at**16:18:42**. API/Web are healthy;
worker heartbeat, exact image configs/RootFS, configuration and protection checks pass.
PostgreSQL and seven unrelated containers were not restarted.

CI **44235842239 / attempt1** success is user-confirmed. The locally available
exact-run release evidence independently passes17 prerequisite-job identities,
five real memory cases and archive/image identity checks. SSH confirmed Git
refs, **not live Actions status**; no browser CI inspection or token fallback.
Fresh stopped71342129/0061 backup preceded the exact0062 migration; legacy-column
digests across91 tables, expected preference backfill and four business volumes
were checked. Read-only attachment audit verifies3,088 objects with zero issues.
Only the two approved old transfer archives were removed (338MiB allocated).
The new and prior verified backups remain; no additional image/backup pruning,
automatic downgrade or production restore exercise. Product acceptance is user-owned.
[Authoritative release evidence](docs/evidence/navigation-search-import-2026-11-17/production-release-26b35501.json) /
[behavior and remaining acceptance](docs/system/NAVIGATION_SEARCH_IMPORT_EXPERIENCE.md).
Older production pointers and pause instructions below are historical checkpoints.

## Historical repair checkpoint: navigation, search and import UX — 2026-11-18

The candidate adds source-bound import previews, scoped sorting (schema 0062)
and paginated search. At this earlier checkpoint it was not deployed or
product-accepted; production was71342129/schema0061.

Full CI **44135067562** on `991eabc` failed the PostgreSQL ordering race, Web
recovery/sort cases and the dependency audit. The local repair keeps the
winning write's response inside its transaction and separates project metadata
needed for sorting from list data needed for reading. See the
[navigation contract and verification boundary](docs/system/NAVIGATION_SEARCH_IMPORT_EXPERIENCE.md).
The [Next pin](docs/system/NEXT_LTS_MIGRATION_CONTRACT.md) is now 16.4.5;
the [separate picomatch exception](docs/system/RELEASE_SAFETY_BASELINE.md#dependency-policy)
requires review by 2026-11-25. This checkpoint authorized one full Linux CI with
empty `quality_source_run_id`, followed by a pause. The later explicit deployment
authorization and completed release above supersede that pause.
The [earlier failure on 7f9ef44](docs/evidence/navigation-search-import-2026-11-17/ci-failure-44063757196-repair.json)
and the successful runs below are historical, not acceptance of this candidate.

## Historical: two optimized full CI runs independently verified — 2026-11-17

Exact source **3d465553bf1cf1ae4cd380bc35dfbaa090b341ec** passes two new,
ordinary full runs, **43942265966 / 43952795958**, both attempt1 with all19 jobs
and independent native/API/resource/OCI verification successful.
Elapsed time is **20m39s / 22m24s**, versus57m47s baseline:37m08s /35m23s saved
(64.3% /61.2%). Observed runner minutes rise149.1→173.3 /172.8, about16%;
peak concurrency is14. These are observed timings, not a guaranteed duration
or billed usage. Each new55-minute local wait is excluded from CI elapsed time.

All original gates remain:7010 API cases/7007pass/3 original skips, Web14,
Settings470+restore1, Reader9/27cold, mounted45 and five real memory cases.
Native execution/collection, genuine blob merges, candidate-to-release byte
identity,35 OCI blobs/23 layer diff IDs and393 embedded API files are verified.
[Two-run evidence](docs/evidence/reliability-2026-11-16/ci-scheduling-v2-two-green-results.json) /
[timing and remaining-verification ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md).
Both full runs restored dependency caches. Task-owned Windows cold installs
and fresh-checkout offline reuse passed, but **complete cold-cache Linux CI
remains unverified**. No additional CI or deployment is part of this closeout.
Production remains71342129/schema0061; product acceptance remains user-owned.
Documentation-only closeout commits are not new CI-tested application revisions.

### Historical implementation and repair checkpoints

The repeated43907985394 failure was five stale mounted-workflow assertions,
not a new runtime regression; the separate repair is commit8adaf9f.
The second-round candidate now has19 jobs: API4, Settings4, Web3 weighted
whole-unit shards; independent restore1; and early non-deployable image preparation.
All original quality/resource gates precede publication of the exact tested
candidate. Engine/OCI IDs are distinguished from actual image config IDs.

Local UX2556, CI Node156/Python138, detector13, lint/typecheck, Actionlint and
single head0061 pass. Two independent7010-case API collections match, with only
the explicit stable gzip ID; Settings470 collection/source-timeout binding and
genuine four-way native blob controls pass. These are not full Linux/browser
or five-memory-case execution acceptance. [Implementation proof](docs/evidence/reliability-2026-11-16/ci-scheduling-v2-local-verification.json).
At this implementation checkpoint, two new complete green CI runs, observed cache
modes, timing and runner-minute comparison remained required;20–25minutes was
only a target. The two-run results above now supersede that pending status.
Production71342129/schema0061 is unchanged; no CI-only redeployment.
Both commits are pushed. Candidate **f209b0c / CI43928590278 attempt1** failed
after the fresh55-minute wait. Four integration omissions were identified:
the pinned-base helper admitted only the old image job; a migration assertion
still searched the parent workflow; native Python controls assumed TEMP;
and Playwright security assertions still assumed ten jobs. No release artifact.
Settings470+restore1 and Reader passed; actual API executed7006pass/1fail/3skip,
with identical7010 collections across all four runners.
[Failure](docs/evidence/reliability-2026-11-16/ci-scheduling-v2-failure-43928590278.json).
The local repair retains all original assertions and adds early actual
Playwright source controls:88pass, UX2556, CI Node159/Python139, migration source1,
lint/typecheck/Actionlint and RUNNER_TEMP-only fixtures pass.
LPT assignments/weights and all original resource/native bounds are unchanged;
only the migration test's source binding changes.
[Repair](docs/evidence/reliability-2026-11-16/ci-scheduling-v2-contract-repair.json).
Owned Windows cold/offline dependency checks pass, not cold full Linux acceptance.
[Dispatch](docs/evidence/reliability-2026-11-16/ci-scheduling-v2-dispatch-f209b0c.json).
At this repair checkpoint, two complete green runs and measured savings were still
required; they are now recorded above. The
[single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md) owns current status.
Repair committed/pushed as **3d46555**; ordinary full **CI43942265966 attempt1**
was dispatched at03:43 +08:00. Its fresh55-minute UTC/monotonic wait completed;
independent success is recorded above, not inherited from the failed run.
[Dispatch](docs/evidence/reliability-2026-11-16/ci-scheduling-v2-dispatch-3d46555.json).

## Previous checkpoint: ZIP fix deployed; first scheduling repair — 2026-11-17

The ZIP importer now defaults to the outermost Markdown layer after safe wrapper
normalization; deeper Markdown files are resources unless referenced or explicitly
enabled as a body. The source contract and compatibility boundaries are in the
[archive import contract](docs/system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md#markdown-resource-selection--source-candidate-2026-11-16).

Commit **71342129** passed ordinary full CI **43820675687/attempt1** (all six jobs,
57m47s) after a fresh real 55-minute UTC/monotonic wait. Independent release
artifact verification is preserved in
[CI evidence](docs/evidence/reliability-2026-11-16/ci-zip-markdown-independent-release.json).
Production switched atomically to **71342129 / schema 20261112_0061** at
**2026-11-16 21:46 +08:00**; independent image/runtime, health, TLS, backup and
protection verification passed at **21:49 +08:00**. No migration ran. The worker
remains at 640 MiB memory / 1280 MiB swap / 45-second stop timeout. The exact
release record is [here](docs/evidence/reliability-2026-11-16/ci-zip-markdown-production-release.json).

The approved single image-transfer file was deleted only after its full identity
and authorization were rechecked; its complete local verified copy remains.
Post-deletion capacity and a fresh continuation admission passed the original
margins. A new stopped 2463/0061 five-component backup and a read-only, complete,
zero-issue attachment audit (3,027 SHA-verified objects) passed. The prior
11/16 backup and all eight protected files remain verified. An earlier failed
image-load receipt remains a failure; images were not reloaded to fabricate
success. The backup phase's local wrapper returned no projection, but the remote
completion receipt was independently verified and was not retried.

The first optimized ordinary full CI, **43888192134/attempt1** at exact commit
**c4e825f**, failed after **43m29s**: both Web shards failed, so Web aggregation
and image/release jobs were skipped and no deployable artifacts were produced.
API, Reader and both Settings shards passed; the original Settings470 aggregation
and restore1 also passed. The failures were traced to image-only historical
policy suites redundantly running in a shallow ordinary-Web checkout, and an
English-only locator against an existing Chinese accessible label. A minimal
repair removes only that misplaced invocation, accepts either exact existing
button label, and adds a scheduling regression guard; no product/runtime code,
assertion, timeout or gate was relaxed. The exact official failure and local
repair evidence are [here](docs/evidence/reliability-2026-11-16/ci-scheduling-failure-43888192134.json)
and [here](docs/evidence/reliability-2026-11-16/ci-scheduling-repair-verification.json).

The repair passes Node152, scheduling Python16, the separate image-only policy
suite102, lint/typecheck and Actionlint1.7.12 locally. The unchanged browser
gate still requires a new exact-source ordinary full CI with empty quality
source, followed by a fresh real55-minute UTC/monotonic wait and independent
result/artifact review. The failed 43m29s run is not successful speedup evidence;
measure savings only against a complete green run. User owns product acceptance;
CI-only repairs do not require redeploying the already verified production app.
The [single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md) tracks the work.

## Historical checkpoint before 71342129 production deployment — 2026-11-16

The user paused CI optimization to prioritize Markdown attachments in ZIPs,
including arbitrarily named auxiliary directories. New generic inspection
selects only the outermost Markdown layer after safe wrapper normalization;
deeper Markdown is excluded unless referenced as a file or explicitly enabled
as a body. Existing review, dedicated exports and older catalog choices remain.
[Current source contract](docs/system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md#markdown-resource-selection--source-candidate-2026-11-16).

Committed/pushed **71342129 / CI43820675687 attempt1**, ordinary full mode with
empty quality source, passes all six jobs in **57m47s** after the new real
55-minute UTC/monotonic wait. API7007/3 original skips executes all213 portable
controls, including ZIP98; Web14, mounted45, Settings470+restore1, Reader9/27 cold
and all five original memory gates pass. Official artifacts, OCI graph/layers,
393 API files and Web revision are independently verified.
[Byte-preserved release proof](docs/evidence/reliability-2026-11-16/ci-zip-markdown-independent-release.json).

Production remains **2463f298 / 20261112_0061**, not this candidate. The user
confirmed the two exact cleanup targets: November10 backup removal and dnf cache
contents only. Cleanup and independent191-record journal/full retained-backup
verification pass; November16 backup, all service/recovery images and eight
protected files remain. New staging/hold pass and7134 images are fully loaded,
but the unchanged post-load capacity gate fails. The three ORIGINAL current
containers resume once; the task-only ingress fence and empty guard are removed.
Independent **19:02 +08:00** verifies11 containers, real health/heartbeat,
anonymous/TLS boundaries, configuration and all eight protected files.
Available6,808,376KiB versus required6,840,568KiB still lacks **31.4MiB**.
Only the verified169.4MiB server transmission file is proposed for NEW approval;
it has not been deleted. No candidate application or migration ran; a new
stopped0061 backup and candidate clean-attachment audit are still required.
[Cleanup, retained failure and current resumption](docs/evidence/reliability-2026-11-16/ci-zip-markdown-production-resumption.json).

The pre-cleanup candidate passes74 native Linux controls/0skip;20 overlapping
pure controls run on the actual Python3.6.8 host. It uses immutable stdlib models,
strict UTC parsing and `listdir(fd)`, not unavailable dataclasses/fromisoformat/
scandir(fd), backports or a pathname fallback. Original fixture/loader failures
remain. A new17:26 +08:00 metadata-only preview verifies11 unchanged containers,
idle/zero-active0061 and the two exact trees. Available3,569,446,912 bytes versus
required7,360,783,109 still fails; predicted post-cleanup margin93,138,171 bytes
is not actual reclamation or admission. That preview's confirmation remains
false; the later approved cleanup has its own completed receipt above.
[Controls and fresh read-only preview](docs/evidence/reliability-2026-11-16/ci-zip-markdown-cleanup-controls.json).

CI optimization is isolated at7134:15 source files and their logs are reverified,
but Settings shard collection is not browser acceptance and savings are unmeasured.
[Local-only proof](docs/evidence/reliability-2026-11-16/ci-scheduling-isolated-verification.json).
Resume it only after this ZIP fix's fresh deployment. Do not replay completed2463
operations, interrupt new imports or lower capacity/resource gates; product
acceptance remains user-owned. The
[single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md) owns remaining work.

## Earlier: 2463f298 / schema0061 deployed; CI scheduling optimization — 2026-11-16

Committed/pushed **2463f298 / CI43737444629 attempt1** passes all six jobs in
**58m03s**, with empty quality source and a completed real55-minute dual-clock
wait. API6909 passes/3 original skips, all115 new cases actually PASSED; Web14,
mounted45, Settings470+independent restore1, Reader9/27 cold physical-frame
checks and all five original memory gates pass. OCI provenance,35 blobs,
23 application-layer diff IDs,393 exact API files and embedded Web revision
are independently verified. [Exact release proof](docs/evidence/reliability-2026-11-16/ci-cold-merge-independent-release.json).
The cold merge policy repair and its earlier failures remain documented in the
[contract](docs/system/BACKEND_AND_API.md#cold-merge-policy-resolution--source-2026-11-16) /
[scoped verification](docs/evidence/reliability-2026-11-16/ci-cold-merge-verification.json).

Production is now **2463f298 / 20261112_0061**. Authorized preparation63,
migration64, forward rollout74 and atomic pointer75 completed; independent
live verification84 passed at **2026-11-16 11:50 +08:00**. Exact images/RootFS,
API/Web/PG health, worker heartbeat, anonymous/TLS boundaries, configuration,
other containers, both backups and the eight protected files were verified.
Production retains **640 MiB memory /1280 MiB swap** for the worker; this is
not CI's no-extra-swap setting. [Scoped release evidence](docs/evidence/reliability-2026-11-16/ci-cold-merge-production-release.json).

The separately approved eight-file reversible move preserves all3,359,426 bytes,
inodes and metadata outside automatic cleanup. Original backup
`chat-reader-20261110T155821Z` (source865b0a6) and new independent five-component
`chat-reader-20261116T024231Z` (stopped source3564cbf/schema0060) remain.
No direct old-worker rollback or automatic downgrade. Original46/65/70 failures
and the [held preparation](docs/evidence/reliability-2026-11-16/ci-cold-merge-production-held.json)
remain historical, not the current release status.

User writes have resumed and canonical counts advanced. A later frozen-volume
equality diagnostic failed; independent83 verified all original871 import files/
1,141,001,405 bytes in the retained backup. The19 subsequently missing live files
have no inspected noncancelled SourceArtifact or draft references; the cause for
15 without inspected references is not proven. Do not restore files, interrupt
new imports or require post-release data to equal the stopped snapshot.

Remaining work is CI scheduling optimization and a fresh complete exact-source
CI with a real55-minute UTC/monotonic wait, not another deployment of2463f298.
Keep every quality/resource/native gate and isolation boundary; product
acceptance remains user-owned, and the older151ms cause is not proven.
Final native operator controls224 Linux passes/0skip overlap earlier113/175/218,
not additive coverage. Current progress belongs to the
[single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md).

## Earlier: bounded worker startup and retained resource failure — 2026-11-15

Exact4ca1ed5/43688838312 completed/failure: API6794/3 skips/5 warnings,
Web14, Settings470+independent restore1 and candidate Reader9 pass. The builder
failed the unchanged180-second v1 ZIP analysis wait at320 MiB/no-extra-swap;
final task/OOM observations were absent, so formal OOM is not proven.
There are no deployable artifacts.
[Official failure](docs/evidence/reliability-2026-11-15/ci-worker-budget-failure.json).

The standard worker source candidate prepares one independent, single-use
interpreter under the healthy lease boundary before genuine initial idle.
It holds no idle DB connection/execution lease or user source. Selected complete
model closures and lazy format/operation imports retain every existing class,
schema and compatibility export. Retirement precedes another physical child;
uncertain delivery never starts a substitute. Failure evidence is read-only
and privacy-projected; original native/resource/success assertions remain.
[Runtime contract](docs/system/BACKEND_AND_API.md#worker-registration-and-single-use-preparation--source-2026-11-15).

Final local diagnostic image passes all five original real-memory cases.
Idle includes the standby interpreter: about116 MiB, higher than the old single
parent; absolute peaks about131–134 MiB and increments about15–18 MiB are both
reported. Real Linux/PG lifecycle controls142 pass without skips; original ORM
helper7 plus3 diagnostic controls, failure projection5, CI Node89/Python100,
lint/typecheck and single head0061 pass. The latest complete related Windows
matrix remains1 failed/1079 passed/14 skipped; the failed child's exact memory
admission is unavailable. Retained Linux collection/interrupted-matrix failures
are not full passes. A new-test-only, strictly scoped libmagic discovery guard
repair passes real Linux75 and the original Nginx1; Windows guard18 passes.
Actual API collection is6904/new107, not full-suite execution.
[Scoped verification](docs/evidence/reliability-2026-11-15/ci-worker-budget-verification.json) /
[1422 inputs](docs/evidence/reliability-2026-11-15/ci-worker-budget-inputs.json)
preserve every prior failure and69 historical receipts. No new exact CI/deployment
acceptance follows from these local results. The
[single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md) owns remaining work.

Continue verification/selective commit/normal push and ordinary full CI with
empty quality source, then a new real55-minute wait and self-check; repair
failures, independently prove artifacts before deployment, then optimize CI.
User owns product acceptance. Production3564cbf/schema0060 is only the last
verified pointer, not rechecked; the older151ms product cause remains unproven.

## Earlier: Reader native-motion fence and continuous release loop — 2026-11-15

Exact2e0a1fe/43681565051 completed/failure: API6794/3 skips/5 warnings,
Web14 gates and Settings470+independent restore1 pass. The unchanged60-second
21-copy preparation now passes in that complete matrix. Candidate Reader8/1
fails plain10000 cold1: one real120px backward frame, unchanged2319px extent
and16 messages/24 blocks, no long tasks. The separate9/27-profile diagnostic
passes but cannot replace the primary failure; both release jobs skipped.
[Official failure](docs/evidence/reliability-2026-11-15/ci-reader-scroll-failure.json).

The edge-only candidate captures the physical scroll offset before awaiting
its real anchor pin. Restoration checks that fence before ownership and after
geometry reads; only its own actual, possibly clamped write advances it.
External motion retires stale compensation without inventing user intent or
changing the fixed DOM anchor. Online/offline previous/next edges opt in;
Share and other explicit restoration defaults remain unchanged.
Original25 navigation and43 mounted case bodies remain; final navigation37,
UX Node2556, mounted45, CI Node89/Python100 and lint/typecheck pass locally.
Two genuine native-wheel controls advance120px with zero physical reversal;
the same controlled pre-repair Reader writes back120px. A fresh same-dependency
550-input Windows production build passes, not Linux/PWA acceptance.
[Verification](docs/evidence/reliability-2026-11-15/ci-reader-scroll-verification.json) /
[1413 inputs](docs/evidence/reliability-2026-11-15/ci-reader-scroll-inputs.json)
retain1409 unchanged inputs,700 API/schema files,64 receipts and13 unrelated files.

Continue selective commit/normal push, ordinary full CI with empty quality
source, then a fresh real55-minute wait and self-check; repair failures,
independently prove new artifacts before deployment, then optimize CI duration.
No original test/resource/native bounds change. The older151ms product cause
remains unproven. Production3564cbf/schema0060 is only the last verified pointer,
not rechecked; user owns product acceptance. The
[single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md) owns current progress.

## Earlier: offline batch observation latency and release loop (history) — 2026-11-15

Exact d983521/43629368808 is completed/failure: API6751, Web14 gates and
candidate Reader9 pass; Settings469/470 pass. Its unchanged60-second real
21-copy preparation admitted20/downloaded19 before pagination assertions.
The first19 completed jobs accumulated11.043476 seconds of completion-to-read
lag. [Official diagnosis](docs/evidence/reliability-2026-11-15/ci-offline-latency-failure.json).
Both release jobs skipped; there are no new deployable images.

The source candidate bounds browser observation and avoids unchanged Dexie
writes. Supervised PostgreSQL offline progress snapshots are sampled at1 second,
without suppressing phase accounting, business checkpoints or commit fencing.
Supervision wakes on process exit within the existing250ms wait; only a fresh
claim proving no legacy recovery inputs avoids a no-op recovery child.
A healthy, explicitly empty lane gets a250ms handoff wait for at most5 seconds
after a real child exit; empty reads do not renew it. Unknown/blocked claims,
outages and ordinary idle retain configured backoff. Maintenance, single-child
admission, real publication, native deadlines and resource limits remain.
All Windows21-copy probes, including this handoff candidate, still fail60 seconds;
the candidate is not an accepted throughput fix. Final related real-PG371
(five original environment skips), offline Node214, lint/typecheck and single
head0061 pass;550 prior production-build inputs are unchanged, not a new build.
[Verification](docs/evidence/reliability-2026-11-15/ci-offline-handoff-verification.json) /
[1413 inputs](docs/evidence/reliability-2026-11-15/ci-offline-handoff-inputs.json)
preserve1405 inherited inputs,62 receipts and13 unrelated files.
Fresh exact Linux CI remains required, not replaced by local controls.

Latest authorization supersedes the historical “dispatch then pause”: repair,
verify, selectively commit/push ordinary full CI with empty quality source,
wait a new real55 minutes and self-check; continue on failure, prove artifacts
before deployment, then optimize CI duration. User owns product acceptance.
Production3564cbf/schema0060 is only the last verified pointer, not rechecked.
Current progress lives in the [single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md).

## Earlier: Reader failure diagnostics, not a proven performance fix — 2026-11-15

Exact2495fb1/43613433508 completed/failure solely in candidate math10000,
cold2: native tasks80/151ms, exceeding the unchanged150ms maximum; total231ms
passes250ms. API6751/3 skips/5 warnings, Web14 gates and Settings470+restore1
pass. Candidate8/1, historical baseline0/9; both release jobs skipped, no images.
[Official failure](docs/evidence/reliability-2026-11-15/ci-reading-capacity-failure.json)
reverifies four logs/three ZIPs. Task start times/profiles were absent; the151ms
product root cause remains unresolved, not attributed to runner/GC/KaTeX.

Only four existing harness/workflow files and one new CI control change.
Ordinary native task spans and optional privacy-projected animation attribution
are retained. The ordinary original two-phase primary loop stays unprofiled.
After an ordinary candidate failure, one independent exact-source nine-case/
27-cold CPU phase collects evidence; even a passing replay leaves primary FAIL.
Original v4 inputs, assertions and resource/native bounds remain.
[Verification](docs/evidence/reliability-2026-11-15/ci-reading-diagnostics-verification.json):
mounted43, Reader Node379 (including23 capacity controls), CI Node89
(including12 executed-shell controls), Python100, source-only36, lint/typecheck,
Actionlint1.7.12/Bash78 pass locally. No fresh production Next build, serving
stack, PG or Linux capacity acceptance. Other1405 of1410 inputs,62 historical receipts and13
unrelated files remain byte-identical; user tsbuildinfo is preserved.
[Inputs](docs/evidence/reliability-2026-11-15/ci-reading-diagnostics-inputs.json).

Selectively commit/normal push and dispatch ordinary full CI once with empty
quality source; confirm identity, then pause. `ci-reading-diagnostics-dispatch.json`
owns that new run once present; do not resubmit, poll results, wait, cancel,
schedule or deploy. Production3564cbf/schema0060 is only the earlier verified
pointer, not rechecked or modified; remaining acceptance belongs to the user.

## Earlier full-CI contract repair and retained incident — 2026-11-14

Exact3d8f77f/43604634535 is completed/failure: API6751/3 skips/5 warnings,
Settings470+independent restore1 and candidate reading comparison9 pass.
Web alone failed its old literal release-workflow assertion (44/1); ten later
Web gates and both image-release jobs did not run.
[Final failure](docs/evidence/reliability-2026-11-14/ci-full-quality-final-failure.json)
verifies four official logs/three diagnostic ZIPs, not deployable artifacts.

Only the existing security spec changes: current exact full/reuse selectors,
mandatory source proof before builds, and independent consumer proof remain
strict;33 additive rejection controls supplement the original case.
Local source-only36, Python100, Node77 and lint/typecheck pass. All other1408
inputs,58 historical receipts and13 unrelated files remain byte-identical.
[Verification](docs/evidence/reliability-2026-11-14/ci-release-contract-verification.json) /
[inputs](docs/evidence/reliability-2026-11-14/ci-release-contract-inputs.json).
No application/workflow/resource change, local serving stack or new build.

Selectively commit/push and dispatch ordinary full CI once with empty quality
source; confirm identity, then pause. The independent
`ci-release-contract-dispatch.json` owns that new run once present; do not repeat
submission, poll results, wait, cancel, schedule or deploy. No project job/step
total timeout; native bounds and GitHub's six-hour job cap remain.

The separately requested current-import stop is complete: the legacy worker
rolled back to failed, with all four source files hash-verified and retained.
The independent23:12 +08:00 snapshot has zero active/queued tasks or lock waits,
an idle worker, and unchanged11 containers/configuration/volumes.
[New incident receipt](docs/evidence/reliability-2026-11-14/production-stall-recovery-followup.json).
Production is still3564cbf/schema0060; this is not deployment or a permanent fix.

The [earlier Web snapshot](docs/evidence/reliability-2026-11-14/ci-full-web-failure.json)
still records its original in-progress observation; its bytes are not changed
into the later final result. Production is not rechecked or modified this turn.

## Earlier reliability candidate — 2026-11-14 (its ordinary full CI failed)

After the latest image-only failure, the user authorized a normal full CI.
Selectively commit/push and dispatch the existing release workflow once with
empty `quality_source_run_id`; confirm its identity, then pause. No result
polling, waiter, automation, cancellation or deployment. The subsequent
`ci-full-quality-dispatch.json` owns that actual candidate/run; do not repeat
submission once its receipt exists.

Exact b84ac1d / CI43599055418 failed in the source-proof step while downloading
the original API job log. Policy37/selector34/Node77 passed; images, memory and
the independent consumer never ran, and artifacts are zero. The HTTP error was
not retained, so neither permission failure nor a transient network cause is
proven. A fresh local download matches the previous log bytes, not the CI token.
[Independent failure](docs/evidence/reliability-2026-11-14/ci-image-only-selector-failure.json).

The local evidence GET adapter adds at most three identical read-only attempts
for classified transient errors within the original shared180-second deadline.
Authentication/missing/unknown errors and invalid evidence still fail closed;
only safe error classes/counts are reported. Local Python100/Node77 pass,
including29 new fault/full-mode controls. The workflow and all application,
dependency, existing-test, resource and migration inputs are unchanged.
[Local verification](docs/evidence/reliability-2026-11-14/ci-evidence-transport-verification.json) /
[current policy](docs/system/RELEASE_SAFETY_BASELINE.md#ordinary-full-ci-after-image-only-failure--2026-11-14) /
[single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md).

Full mode requires fresh quality jobs from the new exact candidate/run; it
does not read or inherit43578495558 logs/artifacts, broaden image-only lineage,
or accept old image/resource results. All six jobs and original native/resource
gates remain, without custom job/step total timeouts. Production remains the
previously verified3564cbf/schema0060 pointer, not rechecked or changed.

## Earlier selector-lineage authorization (history; sole dispatch failed)

The user separately approved the exact selector fixture patch, source-lineage
proof, selective commit/push and **one image-only dispatch**. Confirm the sole
dispatch, then immediately pause: no result polling, waiter, automation,
cancellation or deployment. The new independent
`ci-image-only-selector-dispatch.json` will own the actual candidate/run;
once present, do not repeat the pending submission.

Admission now proves **4481fa3 → fixed74f4636 → one direct non-merge candidate**.
The entire prior mode/blob tree and original strict repair proof are verified;
only the SHA-bound selector test and necessary policy/checkout controls may
change. The original37 controls/patch/helper/ORM7 and all application, dependency,
API/Web/Reader/Settings, fixture and resource inputs remain unchanged.
Producer and consumer fetch exactly three ancestry levels; the new pinned patch
adds only those two depth changes and34 additive controls. Default empty input
still runs all six jobs; only43578495558 is a quality source. All five memory
cases, image builds and independent artifact gates must run anew.

Local original37/new34, package7 and clean/dirty Node77 pass. Real depth3 Git
qualification succeeds; depth2 and ten actual Git/checkout negative controls
fail closed. Actionlint1.7.12 and78 Bash parses pass without shell execution.
This is not new Linux/image/memory/full-quality or production acceptance.
[Current release policy](docs/system/RELEASE_SAFETY_BASELINE.md#authorized-selector-fixture-repair--2026-11-14) /
[independent verification](docs/evidence/reliability-2026-11-14/ci-image-only-selector-lineage-verification.json) /
[single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md).

### Earlier image-only failure and local fixture diagnosis (history)

The sole image-only dispatch **74f4636 / CI43591310367** completed/failure.
Its nine-second builder stopped at the added negative-control step: policy37
passed, Node71/1 failed. Provenance, Docker construction, all memory/ORM gates
and the consumer did not execute; there are zero artifacts. The four quality
jobs were deliberately skipped, not new quality successes.
[Independent failure](docs/evidence/reliability-2026-11-14/ci-image-only-failure.json).

The unchanged local selector test assumed uncommitted docs/tooling existed.
A clean exact checkout reproduces that failure; synthetic ambient changes
make it pass. The local repair changes only that test to isolated Git fixtures,
retains its two original scenarios/assertions and adds five controls. Selector,
application, dependencies, workflows and resource inputs remain unchanged.
Clean and dirty isolated Node suites both pass77; unchanged policy unittests
pass37. This is local control verification, not Linux/images/release acceptance.
[Verification](docs/evidence/reliability-2026-11-14/ci-image-only-selector-verification.json).

The original direct4481/unchanged-existing-test policy is **not extended**:
actual qualification rejects a new repair child of74f4636. Another image-only
commit/dispatch needs separate review/approval of the exact fixture patch and
source-lineage proof, not a relaxed parent/allowlist. No new workspace commit,
push, CI dispatch, waiter, automation, cancellation or production operation.
Progress and the pending authorization stay in the
[single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md).

### Earlier authorized image-only checkpoint (history; original proof preserved)

The user reported **4481fa3 / CI43578495558** failed only at build-images.
Official attempt1 confirms API/Web/Settings/reading comparison succeeded;
Settings completed **470+independent restore1**. The image job failed because
its control-plane status helper called `.get()` on the valid `failure:null`.
The 320MiB report is incomplete/false; no memory pass or deployable image exists.
[Independent failure](docs/evidence/reliability-2026-11-14/ci-build-images-failure.json).

The latest explicit approval permits this one-line helper repair and **one
protected image-only dispatch**, not another hour-long full quality matrix.
The existing workflow retains all six jobs and defaults to the full gate.
Only `quality_source_run_id=43578495558` opts in; a direct repair child of4481fa3
must keep every application/dependency/existing-test/resource input unchanged.
A pinned byte-exact workflow patch adds qualification/proof checks; arbitrary
source or workflow changes fail rather than fall back or skip acceptance.
Producer and independent consumer both check official source jobs/evidence and
Git inputs. New images retain the candidate's exact OCI revision and manifest;
quality provenance separately names4481fa3/attempt1. All five real memory cases,
no-swap320/640MiB, image inspection and immutable artifact checks still run anew.
See [release policy](docs/system/RELEASE_SAFETY_BASELINE.md#authorized-image-only-control-plane-repair--2026-11-14)
and [local verification](docs/evidence/reliability-2026-11-14/ci-image-only-verification.json).

Final local controls pass: policy37, real ORM7, original API80/2 explicit
Windows symlink skips, CI scripts72, lint/typecheck and single head0061.
Actionlint1.7.12 and78 Bash syntax checks pass without executing CI shells.
The frozen1404 inputs include the prior1399, the previously uninventoried
existing status helper and four additive controls; full Git-tree equivalence
separately protects every other tracked input. This is not fresh Linux memory,
full Web/PWA, real-PG or production acceptance.

Selectively commit/push, confirm the sole dispatch, then pause immediately.
No agent status polling, waiter, automation, cancellation or deployment.
No custom CI job/step timeout; GitHub's six-hour cap and native bounds remain.
Production only retains the previously verified3564cbf/schema0060 pointer.
The original offline dispatch receipt stays byte-identical historical evidence;
the new `ci-image-only-dispatch.json` will record the actual candidate/run.

### Earlier offline child import repair (history)

The latest November14 instruction authorizes this repair, selective commit/push
and one full exact-source CI with no custom job/step total timeout. Confirm the
dispatch, then immediately pause: no status polling, waiter, automation or
deployment; the user will report the result. This supersedes the earlier
automatic waiting/deployment sequence for this turn. Native test/worker/PG,
memory/frame and release-safety gates remain. Hosted jobs still have GitHub's
six-hour platform cap, not unlimited execution.

The user reported **4a943ea / CI43566365014** failed. Settings finished its
470-case matrix in a **63m32s job:469 passed/1 failed**, not a job timeout.
The failure was the unchanged60-second preparation of21 offline copies, before
pagination assertions. Trace records20 admissions/19 successful downloads;
the retained worker log eventually records20 commits, not a stuck execution
or independent proof of19 Dexie rows. Restore was not run; release jobs were
skipped. [Official failure](docs/evidence/reliability-2026-11-14/ci-offline-optional-failure.json)
preserves four logs/three verified diagnostic ZIPs, not deployable images.

Five application import boundaries now avoid unselected FastAPI/HTTPX loading:
Request remains FastAPI's exact Starlette object; account/export HTTP errors
retain the real FastAPI exception, and only configured remote scans load HTTPX.
Business AST, lifetime/lease/scan policy, worker and native test bounds remain.
Final43-module API regression **486 passed/72 explicit PG/POSIX skips** includes
35 new controls; CI scripts72, offline Node205, lint/typecheck and single head0061
pass. All1399 inputs, thirteen protected files and2103 prior task files remain
stable;548 prior Web build inputs are unchanged, not a new build/PWA claim.
Windows matched text-package median **1.777052→1.338086s** is diagnostic, not
Linux/21-copy/whole-CI acceptance. [Diagnosis](docs/evidence/reliability-2026-11-14/ci-offline-optional-import-diagnosis.json) /
[final local verification](docs/evidence/reliability-2026-11-14/ci-offline-optional-verification.json) /
[1399 inputs](docs/evidence/reliability-2026-11-14/ci-offline-optional-inputs.json).

The original `ci-settings-completion-dispatch.json` bytes remain historical.
The subsequent independent `ci-offline-optional-dispatch.json` records this
repair's sole submission; once present, pause until user feedback. No waiter,
status polling, automation, cancellation, production recheck or deployment.
Production's last verified pointer remains3564cbf/schema0060.
The [previous platform-default checkpoint](docs/evidence/reliability-2026-11-14/ci-settings-completion-verification.json)
and its earlier timeout receipt remain separate historical evidence.

### Earlier cold-start checkpoint (history)

The preceding repair defers unselected task/format handlers and scan write/index
services, preserves editing-error reexports and includes imports in the original
two-second maintenance budget. Final46-module API regression passes
**591/65 skipped**, including23 new controls; CI scripts64, lint/typecheck and
single head0061 pass. All1395 inputs/thirteen protected files remain stable.
Three-sample Windows pure-import bundles improve locally, not proof of Linux
or whole-CI timing. [Import diagnosis](docs/evidence/reliability-2026-11-14/ci-worker-startup-import-diagnosis.json)
and [local verification](docs/evidence/reliability-2026-11-14/ci-worker-startup-verification.json)
require a new full exact CI before deployment; no local PostgreSQL/serving stack
or production operation is added.

Earlier dispatched repair **`9a0841461671dfdabd5d50a56f55e68f8ffde227`** is selectively
committed/pushed: fourteen owned files, thirteen unrelated files byte-preserved.
Full exact [CI `43543975636`](https://github.com/foolkking/chat-reader/actions/runs/43543975636)
was confirmed dispatched at **10:01:44.250642 +08:00**. Its dispatch wall-clock
boundary is **10:51:44.250642**; the existing waiter started at **10:03:18.450682**
and completed a fresh3000 monotonic seconds. The first request was
**10:53:18.448494**, with the result received at **10:53:21.276186**:
dispatch wall-clock3094.197852 seconds and fresh monotonic3000 seconds both pass.
At that snapshot API/reading comparison succeeded; Web/Settings were running.
The run was independently confirmed **completed/cancelled at11:04:21.516068
+08:00**: API/Web/reading comparison succeeded; Settings exceeded its unchanged
60-minute job limit and both release jobs were skipped. It printed451 passes
and three termination-window failures; the470-case matrix and independent
restore remain incomplete. The actual gate is still `running/test_count470`,
without final result counts. The tail failure causes and untimestamped API
shutdown timing are not yet established. No cancellation request was sent.
[Independent failure/timing receipt](docs/evidence/reliability-2026-11-14/ci-settings-scheduling-failure.json)
preserves four official logs/three digest-verified diagnostic ZIPs, not
deployable artifacts. The entire CI, artifacts and deployment remain unaccepted.
[First-read receipt](docs/evidence/reliability-2026-11-14/ci-settings-scheduling-first-read.json)
preserves the actual clocks, including the2.188ms difference from the prior UTC
estimate. [Dispatch receipt](docs/evidence/reliability-2026-11-14/ci-settings-scheduling-dispatch.json)
does not inherit the preceding run's partial success.
Waiting-period [final consumer/operator preparation](docs/evidence/reliability-2026-11-14/ci-settings-scheduling-consumer-final-preparation.json)
passes83 local controls and rechecks1392 inputs/thirteen protected files. It
requires all17 exact supervisor unit cases and both real-PG poll1/poll20 cases
in the new official log, plus the unchanged470+restore1 Settings matrix;
retained failed-run schema/frame/performance outputs are not inherited CI acceptance.

Base candidate **`b2d3a653f9655a6480d4f669cc12446030655037`** was selectively
committed/pushed with twenty owned files and thirteen unrelated files preserved.
Full exact **CI `43531859718`** was first read at **08:56:06.772164 +08:00**
after the fresh complete3000-second wall-clock/monotonic boundary. Independently
confirmed **completed/cancelled at09:09:01 +08:00**, with no cancellation request.
API/Web/reading comparison succeeded; Settings exceeded its unchanged60-minute
job limit. It printed344 passes before API shutdown, then five tail failures;
the470-case matrix and fresh-instance restore are not complete. Actual gate
evidence remains `running`, without final result counts. Both release jobs were
skipped. [Independent failure/timing receipt](docs/evidence/reliability-2026-11-14/ci-runtime-frame-failure.json)
preserves the [dispatch](docs/evidence/reliability-2026-11-14/ci-runtime-frame-dispatch.json)
and four official logs/three digest-verified diagnostic ZIPs, not deployable artifacts.

Local repair removes only the mandatory idle poll after a supervised child exits.
The next iteration still checks shutdown/supersession, the supervisor lease,
canonical reconciliation and the execution lease before claiming. Empty queues,
unavailable boundaries and errors retain the configured1-second poll; fresh-child,
maintenance, stall/grace, signal and memory limits are unchanged. Matched344-case
printed timings increased22.9% despite1138 unchanged exact application/Settings/
workflow inputs; this does not establish a code regression or prove the whole
slowdown fixed. In9a's official logs, matched344-case printed timings fell
3415.803→2975.303 seconds (440.5 seconds less), but the run still timed out.
Worker logs contain zero maintenance-deferred/scheduling-paused lines; this
does not measure helper cold-import cost. The new pure-import/local regression
above does not inherit this failed CI or establish a Linux throughput result.
Production remains3564cbf/schema0060.
Final selected API regression **153 passed/43 skipped**, CI script tests **64**,
lint/typecheck and single migration head0061 pass. All1392 final inputs are
unchanged across the final regression; thirteen protected files and all548
earlier Web build inputs remain byte-identical. No new build, real PostgreSQL,
Linux memory/signal or full-site acceptance is claimed.
[Repair verification](docs/evidence/reliability-2026-11-14/ci-settings-scheduling-verification.json)
and [exact inputs](docs/evidence/reliability-2026-11-14/ci-settings-scheduling-inputs.json)
do not substitute for fresh full exact CI.

Focused repair **`74a1e8605bc00d64b543544041c3095566f2881f`** is selectively
committed and pushed: nineteen task files, thirteen unrelated files byte-preserved
and unstaged. Full exact CI **`43503483829`** was first read at
**05:28:55.244142 +08:00**, after its fresh fifty-minute wall-clock/monotonic
boundary. Independently confirmed **completed/failure at 05:39:07 +08:00**;
no cancellation was requested. API **6656 passed / 3 skipped / 5 warnings**,
Settings **470 passed plus independent restore1**; Web failed five cases and
Reader math10000 cold0 measured **213ms against the unchanged 150ms bound**.
Both release jobs were skipped. Four official logs and three official diagnostic
ZIPs are verified, not deployable artifacts.
[Failure receipt](docs/evidence/reliability-2026-11-14/ci-probe-pagination-failure.json)
preserves the [dispatch](docs/evidence/reliability-2026-11-14/ci-probe-pagination-dispatch.json)
and original failure; no earlier partial success is inherited.

The Web fixes align the old tests with the existing reference-caret, automatic
KEEP, sequential upload and original-receipt recovery contracts; application,
workflow, migration and deployment code are unchanged. Mounted editor **117**
(all original102 plus fifteen scenarios) and Files **15** pass with explicit
HTTP adapters, not authenticated server acceptance. The first mounted run's
final console-check failure is retained; every deliberate500 is now checked by
exact message, request URL and count, without suppressing unrelated errors.
Selected real API/TestClient checks **75** remain earlier local evidence with
unchanged API inputs, not an additional rerun. Final Reader **42** retains all
original39 scenarios plus three real-collector coordinate controls; Node UX
**2519**, CI scripts **64**, security/PWA unit **20**, lint/typecheck and a new
**548-input** same-installed-dependency isolated build pass. Final **1391**
source/test/config inputs were recaptured after the diagnostic fixture correction;
thirteen protected files and the empty index are verified. No local serving
stack or PostgreSQL restart. [Local verification and input manifests](docs/evidence/reliability-2026-11-14/ci-runtime-frame-verification.json)
do not replace a new full exact CI.

The unexplained213ms is not claimed fixed. Diagnostic-only full-sequence CPU run
**`43514182245`** completed/failure; its first read at **06:40:15.205718 +08:00**
passed the fresh fifty-minute wall-clock boundary and **3000.015** monotonic
seconds. All eighteen measurements and fifty-four cold profiles are retained.
Its three assertion failures concern raw scrollTop, not a proven TOC/GC/KaTeX
cause. Independent mounted evidence distinguishes legitimate whole-turn rebasing
from real backwards movement missed by the old wheel-only comparator.
Measurement **v4** uses shared connected real DOM anchors on every frame and
wheel sample, preserves raw reversals/all frames/long tasks, and retains the
original **2/34/150/250/40/120** budgets and **30×120px +34ms** inputs.
[Diagnostic result](docs/evidence/reliability-2026-11-14/ci-runtime-frame-diagnostic-result.json)
is not release acceptance. Only tests/fixtures and owned documentation changed;
no scheduler or production action. The two authorized old-import cancellations
are complete and are not reused for later imports.

Preceding repair **`7f8a6425a1d3b9f5c255925ce55340a406a3e063`** is selectively committed
and pushed: nineteen task files, thirteen unrelated files byte-preserved and
unstaged. Exact full CI **`43483733253`** was confirmed at
**02:33:11.802991 +08:00**; the first read at **03:23:11.814857 +08:00**
respected the 50-minute wall-clock/monotonic boundary. API hit its original
45-minute full-suite limit; Web's conflict-recovery test timed out waiting for
a nonexistent nested-footer `contentinfo` landmark. One cancellation request at
**03:26:36.093662 +08:00** was independently confirmed **03:27:03.210582**.
Settings is cancelled/incomplete; its retained log also contains one real
pagination failure (20 rather than 21 unique IDs across two changing snapshots).
Both release jobs executed zero steps.
Three existing job logs and two official diagnostic ZIP digests are verified,
not deployable artifacts. No repeated cancellation, scheduler or deployment.
The [single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md) owns the focused
repair, evidence and local test limitations; production is unchanged.
The focused repair preserves strict retention checks while avoiding unnecessary
full-heap GC, scopes comparison to the actual nested footer, and waits within
the existing 20-second boundary for the original insertion's materialization
before pagination. Final selected API/PG regression passes **39**; a fresh full
exact-source CI is still required, not inherited from any earlier run.
Mounted editor **102**, Node UX **2510**, CI scripts **62**, security/PWA unit
tests **20**, lint/typecheck and a fresh **548-input** same-installed-dependency
isolated build pass. Final **1391** inputs and thirteen protected files are
verified; the owned test PostgreSQL is stopped with its data retained.
[Repair provenance](docs/evidence/reliability-2026-11-14/ci-probe-pagination-verification.json)
is selected local evidence, not release acceptance.

Preceding API fixture-port repair **`5fcb835b23bb76779f203519ce6346422544e14a`** was
selectively committed and pushed. Exact full CI **`43459604614`** was dispatched
at **00:07:59.560391 +08:00**; the first read at
**00:58:03.927117 +08:00** respected the 50-minute boundary. API and reading
comparison succeeded, Web failed, and Settings reached its original 60-minute
job limit after four failures. No cancellation request was sent for this run;
both release jobs were skipped. Recovery-test and exact synthetic-task closeout
repairs are locally verified; the new full CI above does not inherit its results.
No deployment is claimed.
The [single ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md) owns progress;
thirteen unrelated files remain preserved, and no scheduler was created.

Two later, separate November14 instructions authorized safely ending the old
stalled import and a different newly stalled import before CI completion.
Both rolled back through the old worker's own failure path; all source bytes
were hash-verified and retained. The latest independent **00:44:39 +08:00**
snapshot had no active/queued tasks, leases or lock waits and a fresh idle
heartbeat. Services/configuration/volumes remain unchanged; this is incident
recovery, not deployment or a permanent fix to production's legacy code.

Focused repair **`a8d859b`** was committed and pushed, but was not dispatched.
Pre-dispatch validation found that API CI's default PostgreSQL port conflicted
with the guarded synthetic scan fixture. The follow-up confines API quality to
the existing dedicated **65438** port; all six jobs and every other workflow
field/bound remain unchanged. The same **39** cases pass on that owned port,
and CI fixture/source checks pass **62**. Exact-source CI is still required.

Fixture repair **`2ae0ed0ff26d1bc4cfe49b617cb6a08981f99a51`** is selectively
committed and pushed. Full CI **`43436935411`** was first read at
**22:38:46.069844 +08:00**, after the fresh 50-minute boundary. Web failed;
one cancellation was requested at **22:39:58 +08:00** and independently confirmed.
Settings had five pre-cancellation failures, not a 60-minute timeout; release
jobs never started. The focused repair passes API/PG **39**, source contracts
**9** and five rejection controls. It preserves synthetic-task/source receipts
and the original worker/gate bounds. A fresh **548-input** same-installed-dependency
isolated build passed; the old build was not inherited. Full CI is required; no deployment.

Repair **`829e1b794a795e4bee9a456717825089e88dd354`** is selectively committed
and pushed. Full CI **`43424349497`** failed API/Web and was cancelled at the
user's request, confirmed **21:14:35 +08:00**. The first valid result read at
**21:12:16 +08:00** respected the 50-minute boundary; the initial TLS read
failure is retained. Four test-fixture repairs now pass selected regression:
API/PG **34 passed / 4 Windows POSIX skips**, mounted editor **99** and **20**
exact Unicode repetitions. Application/workflow/deploy code and all **548**
previously built Web inputs are unchanged. Fresh full CI is still required;
no deployment is claimed. The preceding candidate `adc80ac` and
full CI **`43389645130`** failed: API/Web failed, Settings reached
its original 60-minute timeout, and downstream release jobs were skipped.
The first read at **16:48:50 +08:00** respected the 50-minute minimum.
CI-blocking repairs now pass local regression: PostgreSQL modules, 99 mounted
editor scenarios, twenty picker repetitions, twelve scan-recovery groups,
2591 Node cases and the 548-input isolated build. The editor repairs address
both initial-value replay and repeated header history commands, not merely
picker deduplication. The single ledger owns evidence and limitations;
no new accepted CI or deployment is claimed. Thirteen unrelated dirty files
remain byte-identical and unstaged. Waiting-period production checks found a
legacy import/progress/heartbeat lock chain and capacity risk; they are not fresh
release admission. Do not force-restart that import into automatic replay.

The user has now authorized implementation of the four-block reliability plan.
The earlier pause below remains historical; it does not prohibit this local work.
The [single current ledger](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md) owns
implementation, regression evidence and outstanding acceptance items.

- Source snapshots/exact content baselines, original-request receipts, multiple
  references and missing-file editing are implemented locally.
- The worker now supervises one fresh execution process with an independent stop
  record, bounded auxiliary writes, business checkpoints and outcome reconciliation.
- Candidate schema head is **`20261112_0061`**; production remains **`3564cbf /
  20261108_0060`**. This work does not inherit any earlier CI result.
- Local synthetic/API/PostgreSQL/browser checks are recorded in the ledger.
  Linux combined-process320/640MiB and the full original frame matrix await
  a successful full repair CI. Physical tablet and host-backup restoration remain
  **not accepted**; the user will perform remaining acceptance.
- Preserve earlier M/N/O edits and evidence. The November 12 follow-up authorizes
  one local checkpoint commit and continuation of the next batch, without waiting
  for CI. No push, CI dispatch, deployment, production cleanup or real-user-source
  replay is authorized by this checkpoint.
- Checkpoint **`a0faa85`** preceded the following administrator batch, now included
  in `adc80ac`. The batch adds Root's on-demand execution stop/result-check flow, exact execution
  fencing and atomic audit receipts; account-deletion interruption retains its
  original recovery path. No CI or production action was performed.
- The November13 continuation adds owner-task interruption recovery: existing
  cancellation permissions, batch-deletion checkpoint/receipt preservation and
  independent stopping in Tasks/noise scans. The same ledger owns verification
  and recovered working preferences. The subsequent release authorization
  supersedes the earlier local-only commit restriction; the exact-source CI
  above failed and is not accepted.

## Small-host goal closeout — 2026-11-12

**Paused for the user's next decision, not declared complete.** One current
[status / completed areas / remaining route](docs/system/SMALL_HOST_IMPROVEMENT_STATUS.md)
replaces the repeated running summaries. Historical sections below are provenance.

- Production remains `3564cbf`; schema `20261108_0060`.
- Committed candidate `7a4d61b` (A–L): exact CI `43025451379` passed all six jobs,
  not deployed. Later work does not inherit that result.
- M/N/O and the latest heartbeat skip-lock correction remain uncommitted.
  Their local results and limitations are in the overview; exact CI is pending.
- The November12 authorized queue recovery finished: one blocked import safely
  failed with its two source files hash-verified, two waiting exports completed,
  no active tasks or lock waits, worker heartbeat resumed. No restart/deployment,
  direct task-row rewrite, user-file deletion or automatic import replay.
  [Incident receipt](docs/execution/SERVER_QUEUE_RECOVERY_2026-11-12.md).
- Stop new exploration, commits, CI, deployments and cleanup after this closeout;
  preserve the user's work and evidence. The old continuous-work instructions
  below do not override the latest request to stop and summarize.

## Current release — recoverable operations — 2026-11-11

Application **`3564cbfdc1157cddcec53e85462b8e0a410fc4a2`**, exact CI
**42828329240**, six jobs/five official artifacts independently verified.
Deployed **November11 00:08:06 +08:00**; schema **20261108_0060** unchanged.
Ordered import recovery, retained stop/resume, source repair, quiet table/image
feedback, touch-boundary loading and explicit cross-device handoff are released.
Runtime health/images/config preservation passed; one later malformed static
Server Action request produced a retained warning, not a clean-log claim.

The separately approved A–D cleanup is complete. **Exactly one** verified backup
remains: **`chat-reader-20261110T155821Z`** (November10 23:58:21 +08:00).
Current images and that backup's matching recovery images remain; no direct
old-worker rollback, scheduled purge, production config replacement or user ZIP
replay. Successful sources, the recent failed source and live data are protected.
[Release, cleanup and eighteen-requirement receipt](docs/execution/RECOVERABLE_OPERATIONS_RELEASE_2026-11-11.md) /
[machine evidence](docs/evidence/release-2026-11-11/recoverable-operations-deployment-summary.json).
Physical tablet/production authenticated UI and backup restore/off-site recovery
remain unverified. Follow-up is a local documentation commit, not another CI or deployment.

Earlier candidate runs are retained in the
[implementation ledger](docs/execution/RECOVERABLE_OPERATIONS_2026-11-10.md).
All older release/backup counts below are historical; this section is authoritative.

## Previous release — reading interaction / missing ZIP assets — 2026-11-09

Application **`865b0a6e381bb3d5c2afba06b5c3aa4c59a61092`**, full CI
**42594459199**: six jobs, five official artifacts and independent acceptance.
API6199, Web Node2175, Web14 gates, Settings470+restore1, Reader19 groups,
candidate performance9, original64+12+4 traces and cold Viewer, five real-memory cases.
Formula reading, canonical header/tags, focus tools, timed Return and nonblocking
missing-asset ZIP imports are deployed; no migration/offline format change.
Final maintenance **18:48:16–18:55:46 +08:00**; runtime recheck **18:56:43**,
backup/preservation **19:01:13**. Schema **20261108_0060** unchanged.
First maintenance safely aborted on task-verifier mount-order/JSON comparison;
old services restored before corrected preflight/redeployment. Full history in
[receipt](docs/execution/READING_INTERACTION_ZIP_RELEASE_2026-11-09.md).
Three verified backups and three image generations remain, no cleanup/direct
rollback. Final free-space snapshot **7,819,320 KiB**. Original config/PG retained.
No real-user ZIP replay or authenticated production UI acceptance.
The candidate/pending/previous-current sections below are historical checkpoints;
this release and receipt supersede their status, not their preserved evidence.


## Release candidate — reading interactions / missing ZIP assets — 2026-11-09

Candidate: formula-cost virtualization, scoped hover/geometry reads,
canonical current-message header/title tag editing, focus-mode search and
timed Return presentation; missing ZIP resources import as honest fileless
attachments with warnings, without bypassing integrity/scanner/source checks.
No migration or portable/offline schema change. Local static/synthetic checks
and limitations: [implementation record](docs/execution/READING_INTERACTION_ZIP_FIXES_2026-11-09.md).
Local lint/typecheck, 2174 Web cases, 186 API cases (3 Windows symlink skips),
13 Reader and 12 Viewer browser groups passed. Full Next build passed in a
task-local, source-hashed copy with the same installed dependency versions;
earlier cross-drive/junction build failures remain in the record.
Full PWA/64-frame CI remains unrun.
The current release below is unchanged. The subsequent user goal authorizes
completion review, corrections, commit/push and full CI through successful
deployment. Each dispatch requires a fresh **50-minute minimum before the
first status read**; no schedules or real-user source replay.
[Review](docs/execution/ux-audit-reading-interaction-zip-2026-11-09.md)
identified missing CI wiring and incomplete language/theme cross-coverage;
the additional required browser gate does not replace the original matrix.

## Current release — bounded ZIP and reading tools — 2026-11-09

Current application **`d61b9c69004c3c482fd915fd6f77481fa1920ae7`**, full CI
**42522644855**: all six jobs, five artifacts, 14 Web gates and five real-memory
cases independently accepted. Production single head/current **20261108_0060**.
Maintenance **05:55:56–06:03:02 +08:00**; independent runtime check **06:03:30**,
backup/preservation recheck **06:06:22**. API/Web/PostgreSQL healthy, worker alive_idle.
Original production configuration, PostgreSQL and seven other containers unchanged.
Two verified backups and two image generations remain; **no direct rollback** to
the old worker after v2 drafts/0060. Available-space snapshot: **10,756,356 KiB**.
No cleanup, local application tests or user-ZIP replay; CI heartbeat is paused.
[Release receipt](docs/execution/BOUNDED_ZIP_IMPORT_RELEASE_2026-11-09.md) /
[contract](docs/system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md).

**Historical release checkpoints below:** the November 7–8 production/candidate,
pending-CI and former authorization statements before “Project and source map”
remain provenance, not current release instructions. The current section above
supersedes them; existing user-written cleanup history is retained verbatim.


Last synchronized: **2026-11-08**. Current facts and verification boundaries only;
dated implementation, CI failures and release narratives belong in execution records.
Start with [AGENTS](AGENTS.md), then [documentation navigation](docs/index.md).

**Additional unreleased candidate (2026-11-08):** disk-backed ZIP import,
message-indexed internal draft v2, async recovery and durable resource waiting.
Candidate migration **0060** adds queue eligibility fields; production remains
**0059**. On November 8 the user authorized committing this candidate and
submitting it with local reading-tools commit `2bb6ef0` to full CI on `master`.
CI acceptance is pending; no deployment or user-ZIP replay is authorized.
Static and pending runtime gates are separated in the
[record](docs/execution/BOUNDED_ZIP_IMPORT_2026-11-08.md) and
[contract](docs/system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md).
The user's existing local reading-tools commit and unrelated changes are preserved.

## Current release — natural image sizing

**Unreleased local candidate (2026-11-08):** compact image slider and
once-only adaptive-import fit; reorganized Reader tools, read-together tabs,
location bookmarks/contextual exports and private tag management. Static checks
have passed at review checkpoints; full exact-source CI and visual acceptance
are still pending. The November 8 completion audit found seven source-level
gaps; the user then authorized targeted corrections (draft guards, real-line
capture, manual-upload/default-fit semantics, search destinations and annotation
filter/export context). Corrections are in local checkpoint `2bb6ef0` and
require runtime/visual acceptance. The subsequent November 8 instruction
authorizes pushing that commit together with the bounded-ZIP candidate and
dispatching full CI once; it does not authorize deployment or automatic polling.
This does not change the production release below.
[Candidate contract](docs/system/READING_TOOLS_CONTRACT.md) /
[verification record](docs/execution/READING_TOOLS_2026-11-08.md).
[Audit](docs/execution/ux-audit-reading-tools-completion-2026-11-08.md) /
[correction record](docs/execution/READING_TOOLS_AUDIT_FIXES_2026-11-08.md).

Exact **`897ba788fd89e18c9634ca2271ba6146339939a0`** passed full CI
**`42371615326`** and was deployed after the user's separate “成功，部署”
authorization on **2026-11-07**. Source-bound original geometry, one saved
percentage, natural wrapping and width-preserving long-image folding replace
fixed preview cells. Controls commit on release; Viewer zoom measures intrinsic
CSS pixels. Optional offline v3 geometry preserves Dexie v2 and older packages.
The Skill panel retains its opening-language query hint while labels localize;
all three controlled preference-hydration regressions passed.
[Current contract](docs/system/IMAGE_READING_STABILITY_CONTRACT.md) /
[implementation and CI history](docs/execution/IMAGE_NATURAL_FLOW_2026-11-07.md) /
[release receipt](docs/execution/IMAGE_NATURAL_FLOW_RELEASE_2026-11-07.md).

All six jobs and five official artifact ZIP digests/content checks passed.
Reading/image cases **35/35**, original **64** frame traces plus **12** collapse,
**4** passive-wheel guards and a cold Viewer shell trace passed without relaxing
thresholds. API **6078 passed / 3 optional skipped**, Web Node **2111/2111**,
Web gates **14/14**, Settings **466/466** plus isolated restore **1/1**,
performance baseline/candidate **9/9**, exact-image **320 MiB** memory gate passed.
Synthetic CI is not authenticated production UI or physical-device acceptance.

## Release and runtime

Maintenance lasted **21:31:35–21:38:56 +08:00** (7m21s). Independent runtime
recheck passed at **21:39:40**; backup/preservation recheck completed at
**21:40:37**. No migration or Dexie upgrade; existing offline copies retain their
own snapshots. Only API/worker/Web were recreated from verified CI images.

| Boundary | Verified snapshot |
| --- | --- |
| Source / branch | Existing `master`; deployed application source `897ba788fd89e18c9634ca2271ba6146339939a0`; subsequent documentation-only receipts are not new application releases |
| Accepted / deployed-source CI | `42371615326`, attempt 1; six jobs and all five artifact contents passed after the 50-minute first-read gate |
| Production / retained rollback images | `897ba78` only after separately authorized November 8 cleanup; four current role tags and verified current archive retained; no direct local rollback |
| Runtime recheck | API, Web and PostgreSQL healthy; worker `alive_idle`; canonical HTTPS health and login return 200 |
| Database | Production single head/current `20261105_0059`, unchanged this release; prior private-search backfill remains committed, 52/52 |
| Verification / delivery | Stopped-writer five-component backup `chat-reader-20261107T133202Z` independently reverified after November 8 cleanup; original release attachment audit 390/390 hashes, zero issues. No local application tests, production build or raw ZIP replay |

The deployed release adds natural image sizing, explicit pixel/column feedback,
offline geometry snapshots and unified reading compensation, retaining the
consolidated authentication/offline and recovery consistency work, bounded small-ZIP memory path and structured failure/retry
handling. Qualifying single-document archives use 192 MiB effective-free admission,
a 128 MiB reserve and a 64 MiB workspace-growth budget; other imports keep standard
admission. Real exact-image 320 MiB worker CI is not proof of success on user data.
[Release receipt](docs/execution/IMAGE_NATURAL_FLOW_RELEASE_2026-11-07.md) owns official
artifact hashes, OCI/config identity, stopped-writer backup, deployment and preservation
evidence. [Adaptive ZIP contract](docs/system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md)
owns qualification and compatibility details.

The deployment initially retained three backups and three image generations.
On **2026-11-08**, the user separately approved latest-only retention and all
items in the reviewed cleanup table. Only `chat-reader-20261107T133202Z`,
the four current `897ba78` role tags and its verified image archive remain for
Chat Reader. Two older backups, eight old role tags, twelve old transfer
archives, four inactive VS Code Server versions and bounded caches were removed.
Mixed-transfer receipts/helpers were preserved and hashed; logs, business data,
volumes, unrelated images and the live VS Code launcher were not removed.
The old rollback pointer was archived, not falsely replaced with the current
revision. **No direct local rollback remains**; restoring an older application
requires reacquiring verified exact images and fresh stopped-writer/job/data
checks. Never automatically downgrade.
Independent check **2026-11-08 01:42:13 +08:00**: **66% used,
13,680,388 KiB available**, an observed increase of **9.78 GiB** from the
pre-cleanup snapshot. All eleven container identities/start times/restart counts,
mount sets, runtime configurations and volumes were unchanged. Retained backup
SHA/tar/PG TOC and current image-archive verification passed; this is not a
restore drill or redundant/off-site protection.
[Cleanup receipt](docs/execution/KING_STORAGE_CLEANUP_2026-11-08.md).
Future releases need fresh capacity admission, not automatic cleanup or reduced budgets.
Capacity and aggregate data counts are time-point
observations, not invariants. Writers resumed after deployment; do not claim all
canonical row counts stayed unchanged or restore data to make them match.
Production environment/Compose/Nginx and PostgreSQL were not replaced.

## Project and source map

| Area | Authority / entry |
| --- | --- |
| Runtime stack | Next.js **16.4.1**, React **19.2.8**, TypeScript; FastAPI, SQLAlchemy, Python 3.11+; PostgreSQL 16 |
| Dependencies | `pnpm-lock.yaml`, API `requirements-{runtime,test,build}.lock` with hashes; Corepack + pnpm **9.15.4**; Web CI/image Node **22.13.1** |
| Web | `apps/web/app/`, `features/`, `components/`, `lib/`; browser checks in `apps/web/e2e/` |
| API | `apps/api/app/main.py`, `api/routes/`, services/models/schemas; `apps/api/tests/` |
| Worker | `apps/api/app/workers/import_worker.py`; one concurrent background job |
| Data | PostgreSQL and `apps/api/alembic/versions/`; `schemas/` is reference material |
| Delivery | `.github/workflows/build-release-images.yml`, `docker-compose.production.yml`, `deploy/` |
| Detailed facts | [System index](docs/system/README.md), [API](docs/api-reference.md), [testing](docs/testing.md) |

The browser uses same-origin `/api/*`; Next forwards through `API_INTERNAL_URL`,
which matters at build time as well as runtime. Current canonical PostgreSQL data,
Alembic and code are rendering truth; raw imports and Continuation files are not.

## Stable product boundaries

| Area | Required behavior / current capability |
| --- | --- |
| Import | Adaptive JSON/Markdown/ZIP and separate `.cr` restore; preview and explicit commit precede worker canonical writes; never silently retry a user's source |
| Reader | Owner, public Share and Offline retain separate access; complete turns, stable real DOM anchors and no programmatic-scroll-as-user-scroll |
| Reading UX | Conversation favorites use a star beside search; existing `reading-list` route/API/data stay compatible; keyboard/help, collapsible sidebar and geometry corrections are deployed, not universal device acceptance |
| Rendering | Rich Markdown policy **v13**: bounded sanitized static HTML/details/media, Obsidian callouts/highlights and existing GFM/math/code; no arbitrary HTML/script execution or claim of all Obsidian plugins |
| Collections | Owner-scoped favorites/read state, saved searches, private annotation inbox, tags, new-message baseline and bounded read-only comparison; synthetic-example entry removed |
| Offline | `/library`, Dexie **v2**, package **v3**; retain v1/v2/v3 reads and existing device data; failed replacement keeps the last readable copy |
| Accounts | One deployment-provisioned administrator plus isolated users; private owner UUID comes from the session; explicit public Share remains capability/password scoped |
| Device boundary | Explicit trusted-browser permission keeps downloaded copies readable after online expiry; new/unupgraded devices retain legacy protection; explicit revocation/local lock and account switching still fence access |
| Context | Current/Index view, edit and drop beside annotations; saves retain the other member and latest three snapshots; no semantic validation/candidates/adoption |
| Context exchange | Conversation-scoped `.context.zip`; return does not modify Raw/assets; restricted/Share exports exclude private Continuation |
| Source tables | Rendered table/Markdown editing uses bounded paging, stale/pending guards and one undoable CodeMirror transaction; historical focused tests do not prove arbitrary extreme-table performance |
| Skills | ZIP/Markdown upload and replacement with user-supplied defaults; no Skill viewer/editor/history UI, uploaded-script execution or application model calls |
| Archives | Personal v1/system v5 accept additive `user_features_version:1` for collections and reading baselines; old formats remain readable; sessions, device trust, browser drafts and Share links are excluded |
| Cleanup / sync | Default KEEP, explicit source-bound review and versions; revision/outbox/conflict recovery; remote positions do not force Reader jumps |
| Recovery | Unknown writes require explicit read-only result checks; failed refresh does not undo confirmed writes; browser downloads differ from retained server tasks |

Detailed behavior and limits live in [product](docs/product.md),
[feature inventory](docs/system/FEATURE_INVENTORY.md),
[rich Markdown](docs/system/AI_RICH_MARKDOWN_CONTRACT.md),
[Context](docs/system/CONTEXT_PACKAGE_CONTRACT.md) and
[data/storage](docs/system/DATA_AND_STORAGE.md).

Implementation, measurements, review and CI receipts:
[comprehensive optimization](docs/execution/COMPREHENSIVE_OPTIMIZATION_2026-11-05.md),
[recovery/consistency follow-up](docs/execution/RECOVERY_CONSISTENCY_2026-11-05.md).
Current cross-module behavior:
[optimization contract](docs/system/COMPREHENSIVE_OPTIMIZATION_CONTRACT.md).

## Pending verification and operational limits

- **Original user ZIP:** production retry and canonical import result await an
  explicit user retry; deployment did not silently re-import it.
- **Real 47-conversation offline update:** bounded per-conversation recovery is
  deployed and CI-tested; the actual user download/update has not been repeated.
  See [diagnosis](docs/execution/OFFLINE_LARGE_PACKAGE_DIAGNOSIS_2026-11-01.md).
- Authenticated production UI, physical clipboard, screen-reader/real-device
  interactions and sustained load remain unverified. A real pg_dump/pg_restore
  drill against isolated synthetic PostgreSQL/asset data passed on 2026-11-05;
  this does not establish recovery of a production backup or off-site recovery.
- Scanner-disabled attachments are **unscanned**, not safe. Bounded previews are
  not hostile-document certification. Device quota/eviction remains a risk.
- Server-local backup points may share hardlinks; independent off-site recovery
  and scheduled backups remain unconfigured in the verified release snapshot.
- SMTP is unconfigured in the verified release snapshot; administrator reset
  grants remain available. Source-editor drafts now survive reload in the
  account-scoped browser store; other unknown-write/draft protections remain
  scope-bound, not a universal promise of crash durability.
- Noise detection is bounded recognition, not exhaustive Markdown/adapter parity
  or a universal latency/RSS guarantee. [Risk contract](docs/system/KNOWN_ISSUES_AND_UNCERTAINTIES.md)
  owns detailed limits and preserves older checkpoint provenance.

## Work and verification boundary

Follow the command and temporary-directory rules in [AGENTS](AGENTS.md).
Use process-local TEMP/TMP under `C:/Users/86182/Desktop/wkkk/<task-name>`.
Do not modify user imports, production volumes/configuration or unrelated residues.
The server operational checkout is dirty: do not pull/reset it or replay completed
release helpers; future releases need exact-source staging and fresh preflight.

Documentation/governance closeout and the subsequently approved bounded local
cleanup are complete. Only the merged local branch and reviewed regenerable
caches/empty directory were removed; no remote branch or production data changed.
The later image/reading plan includes all seven follow-up audit items and
commit/push on existing master. Each submitted run obeyed its fresh minimum
50-minute first-read boundary except explicit user-reported failure diagnoses.
Exact `897ba78` is fully green. The subsequent explicit “成功，部署” request
authorized the accepted release above; deployment and independent recheck are complete.
The CI recheck remains paused; no schedule was created or resumed.
The later November 8 cleanup was separately authorized and is complete; it does
not authorize future deletion, automatic retention changes or replaying the user's source ZIP.
The unrelated `apps/web/tsconfig.tsbuildinfo` modification and release/test
evidence remain preserved.
[Closeout receipt](docs/execution/KNOWLEDGE_CLOSEOUT_2026-11-04.md) records checks,
six-facet status, post-report approval and the verified cleanup result.

## History

The [pre-closeout state](docs/archive/PROJECT_STATE-history-2026-11-04.md) preserves
all earlier checkpoint text with source hash and rebased links. Use the
[execution index](docs/execution/README.md) and
[documentation inventory](docs/documentation-inventory.md) for dated evidence.
Historical “local-only”, “uncommitted” or “next action” instructions are not current
work orders and do not override the runtime/authorization boundaries above.
