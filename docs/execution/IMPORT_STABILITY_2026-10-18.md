# 多文件导入、噪声检测与服务稳定性记录

日期：2026-10-18
范围：当前本地工作树；未提交、未推送、未启动 CI、未部署。

## 问题判断

截图中的“暂时无法验证登录状态”与导入多个文件同时出现时，最需要先排除的不是登录状态本身，而是 API 进程被导入分析拖慢或拖垮：

- 自适应导入接口原来是 `async def`，但在请求事件循环中同步执行文件解析、结构分析、规范化和计划生成；单 worker 时会阻塞同一进程中的登录状态读取。
- 多个分别较小的文件原来只按“单文件超过阈值”判断是否进入重分析准入，累计正文可能绕过串行分析槽。
- 分析计划和 canonical 提交路径已经改成逐组生成／写入；本次继续确保入口不会把重 CPU 工作放在异步事件循环中。

这解释了“导入慢时登录验证也像服务挂掉”的代码风险。截图本身不能证明
OOM；后续只读服务器检查已经取得独立内核证据，见下一节。

## 本次生产事故证据（只读，不属于修复验收）

2026-10-18 **10:31:45 北京时间／02:31:45 UTC**，内核记录
`global_oom`、`CONSTRAINT_NONE`，杀死 API 的 `uvicorn`，当时其匿名 RSS
为 260,456 KiB。API 于 02:31:53 UTC 重新启动，观察时 restart count 为 1；
worker 和 Web 的 restart count 均为 0。

观察主机约 1.83 GiB RAM，02:47:22 UTC 可用内存约 180 MiB。
这是**主机级内存竞争**，不是已经证实的正常服务停止或单个 worker
容器超限。重启后的 `OOMKilled=false` 不能推翻之前的内核事件。

这能确认 API 是受害进程，**不能确认它是唯一内存来源，也不能证明噪声
扫描当时在运行或是唯一原因**。worker 没重启也不表示它不占用主机内存。
没有用进程 RSS 简单相加来估计 PostgreSQL 的共享页。

检查只读取了有界内核日志、容器状态和主机内存字段；没有启动额外诊断
Python、压力测试、重启、改配置或部署。脱敏结构化证据：
[`import-service-oom-2026-10-18.json`](../evidence/import-service-oom-2026-10-18.json)。

## 已实施

1. 自适应导入创建与替换路由改为 FastAPI 同步路由。FastAPI 会把它们放入线程池，文件读取和同步分析不再占用异步事件循环；登录、会话检查等轻量请求仍可由事件循环处理。
2. 普通导入预览也改为同步路由，避免 JSON/Markdown 检测和预览解析在异步事件循环中长时间运行。
3. 增加同步的有界上传读取器，仍按每文件上限、1 MiB 分块和部署总量限制读取。
4. 重分析准入同时检查：
   - 最大单文件大小；
   - 本次所有文件的累计字节数。

   因此很多个“各自没有超过阈值”的小文件也会进入同一个有界分析槽，不能并发堆积。
5. 自适应导入的重分析、重新分组、排除后重分析、映射验证、格式健康检查、
   预览和 profile 选择统一使用已保存源文件大小进行准入；队列满或内存余量
   不足返回带 `Retry-After: 15` 的可重试 429，不误判为 500 或映射 422。
6. 分析只保留每个结构族的代表结果；逐组生成 draft、逐条写入 JSONL、
   canonical 逐条转换并提交，避免同时保留全批完整正文。
7. 流式 draft 后部损坏必须回滚此前尚未提交的 canonical 写入。隔离 SQLite
   复现发现 legacy savepoint 在没有显式外层事务时会留下早期对话，已在
   savepoint 前确保真实外层事务；PostgreSQL 沿用已有事务语义。
8. 线程池并发首次准入时，信号量初始化加锁。受控 8 线程测试在修复前为
   分析／附件 staging 分别创建了 8 个独立信号量；修复后各自只创建 1 个。
   分析与仅写磁盘的附件 staging 仍使用独立槽位，不互相阻塞。
9. 重型分析准入不再只检查固定 512 MiB 水位：它还预留输入总字节数乘以
   `UPLOAD_ANALYSIS_MEMORY_FACTOR`（默认 32）的估算工作集。合成测量发现
   代表性 transcript 的 analyze_json 峰值约为输入的 4.47 倍，密集小对象
   （最终被判定为无消息结构）约为 25.01 倍，因此默认值提高到 32；
   详细数据见下一节。Linux 内存探针
   同时读取主机 `MemAvailable` 和可见的 cgroup v1/v2 当前余量，采用较小值，
   并检查可见父级限制。探针未知或当前余量不足时，重型分析立即返回可重试
   429，而不是占用请求线程等待 120 秒。此因子是保守准入估算，不是 JSON
   解析峰值的硬上界；不能替代解析器流式化或 2 GiB 实测。
10. 补上了路由前的 multipart 内存入口：Starlette 每个上传文件默认可以
    先留在 `SpooledTemporaryFile` 内存中，导致多文件批次在 endpoint 准入前
    已经抬高 API RSS。现在由 `MULTIPART_SPOOL_MAX_SIZE_KB`（默认 64 KiB）
    统一设置 spool 阈值，超过阈值的文件落到任务临时目录；该阈值不改变
    单文件／批次业务大小限制，也不把附件磁盘 staging 错误地纳入解析器内存门。

## Adaptive JSON 内存展开合成测量

可重复脚本：`python scripts/performance/measure-import-analysis-memory.py`。
Windows/Python 3.11.7 上，`analyze_json` 对 transcript-like 的 2,700,014
字节样本分配峰值 12,066,496 traced bytes（4.47×）；对由 200,000 个
短对象组成、最终被拒绝为 `NO_MESSAGE_STRUCTURE` 的 1,600,001 字节样本，
峰值为 40,010,852 bytes（25.01×）。后一例说明无效 JSON 也可能在解析后才被
拒绝，不能仅按导入结果类型估算峰值。

据此把默认 `UPLOAD_ANALYSIS_MEMORY_FACTOR` 从 8 调高为 32，并记录于
[`import-analysis-memory-2026-10-18.json`](../evidence/import-analysis-memory-2026-10-18.json)；
证据绑定 analyzer/contracts/config 三个源码哈希。它只是一组 Python
`tracemalloc` 合成样本，未包含 RSS、allocator 碎片、并行宿主负载或所有
输入形状，32 仍不是可证明的硬上界，也不替代 Linux/低内存实测。

## 噪声资源修复与测量

- 每个扫描批次只保留有界 ID 列表，按消息加载完整正文；下一条加载前释放
  前一条正文及其检测上下文。游标、偏移、提交边界和低优先级调度不变。
- 同一消息、同一大小写配置只规范化一次，最多两种配置；保护索引首次
  命中才生成。复用仅限当前消息／校验操作，不是进程级正文缓存。
- 来源坐标使用紧凑数组，而非每字符一组 Python tuple/int，避免双配置
  复用导致映射列表同时常驻的大额成本。原始偏移与 Unicode 语义不变。
- 候选分页不再 join/hydrate 完整 `MessageVersion`（其中还包含 plain text
  和 blocks）；先分页读取 occurrence 与必要元数据，再按相邻 version
  只取一份 `display_text`。受保护确认试跑与批量决策也按版本 ID 分页，
  每个版本只投影一次正文。每页候选仍有界，单条正文／单条返回仍受来源
  大小影响。

可重复的合成脚本：
`python scripts/performance/measure-noise-detection.py`；
追加 `--mixed-case-profiles` 测量双配置。最终测量为 Windows/Python 3.11.7、
单次函数 wall time 与 `tracemalloc`，**不是 RSS、生产吞吐或 OOM 压力验收**。
20 条规则（最终源码绑定证据中的复测）：

| 合成输入／配置数 | 逐规则独立检测 → 当前消息复用 | peak traced bytes（独立 → 复用） |
|---|---|---|
| ASCII 67,513 字符／1 | 4,609 → 492 ms（约 9.4 倍） | 2,039,783 → 1,737,650 |
| Unicode 39,013 字符／1 | 19,306 → 1,224 ms（约 15.8 倍） | 6,952,967 → 6,651,584 |
| ASCII／2 | 4,160 → 651 ms（约 6.4 倍） | 2,039,767 → 3,213,689 |
| Unicode／2 | 19,149 → 2,128 ms（约 9.0 倍） | 6,952,747 → 7,700,533 |

所有对照的命中数量、原始范围、保护决策摘要一致。双配置仍比**紧凑映射的
逐规则独立检测**占用更多峰值，但有明确的两份上限；没有把此权衡隐去。
早期普通列表复用的双配置峰值曾达 18,212,617／11,282,193 bytes，
因此没有采用这一迭代。单规则不承诺加速；以上测量有运行波动和探针成本。

最终证据（包含两个实现文件的 SHA-256）：
[`compact single-profile`](../evidence/noise-detection-compact-reuse-2026-10-18.json)、
[`compact mixed-profile`](../evidence/noise-detection-compact-reuse-mixed-2026-10-18.json)。
保留的
[`普通列表迭代`](../evidence/noise-detection-reuse-2026-10-18.json)和
[`双配置内存回退`](../evidence/noise-detection-reuse-mixed-2026-10-18.json)
属于被后续紧凑实现替代的历史测量，不能作为最终源码门禁。

针对审阅分页另有合成 SQLite 对照
[`noise-review-allocation-2026-10-18.json`](../evidence/noise-review-allocation-2026-10-18.json)：
100 条候选／约 59,070 字符来源时，一个简化旧式“每候选 join 完整 version”
对照峰值 traced allocation 约 **60.1 MB**，新“分页元数据＋按 version
投影 display_text”约 **1.06 MB**；摘要和候选摘要 digest 一致。旧式对照
只为可重复的较低边界，不是旧端点精确重演；当前约 301ms，高于该简化对照
约172ms，因此仅得出重复整正文 materialization 显著减少的结论，不宣称
端到端耗时更快。两者均非 PostgreSQL/RSS/cgroup/OOM 验收。

## 本地验证

### 初次多文件分析改为可恢复后台任务（2026-10-18，本地追加）

根据用户确认的实际使用方式，导入确认后不应继续占着前端等待解析，而应
排序进入已有单 worker 后台任务队列，并能在任务中心查看过程和结束结果。
因此 adaptive session 首轮结构分析不再在上传 HTTP 请求内同步完成：

- POST 对每个上传流按有界块写入服务器暂存来源并计算 fingerprint，随后在
  一个提交中写入 `adaptive_import_analysis` BackgroundJob，返回
  `ANALYZING/queued` 会话及 task ID。multipart route 前 spool 也受独立
  64 KiB 默认阈值限制，防止很多小文件先在 API 内存中各缓存一份。
- 现有单 worker 按普通 BackgroundJob FIFO 领取初次分析；noise scan 仍在
  normal import/background work 之后低优先运行。阶段／计数写入任务和导入
  会话，Task Center 在关窗、导航和刷新后仍可重新打开导入会话。
- 失败保留源文件并重试相同任务 ID；排队取消可安全移除来源，正在执行时
  只请求取消，由 worker 在安全边界确认后清理，避免与 canonical import
  争锁。canonical commit 在首轮分析可审阅前返回状态冲突。
- 该任务类型复用 `BackgroundJob` 泛型表，不新增 migration。普通预览、
  来源替换和其他后续重分析仍在线程池同步路由执行；此次只把用户反馈的
  初次多文件分析移出交互请求，不把所有导入处理都描述为后台任务。

本轮已完成的验证：

- 队列及流式上传专项在早期检查点 **26 passed**；之后加入的 FIFO 排队、
  小任务低内存准入、重试幂等及 canonical-import 竞争用例由下方最终
  API 全量结果覆盖。
- 独立 PostgreSQL 17 worker 事务／路由取消竞态 **4/4 passed**：包括
  worker 持有导入记录锁期间的处理取消及发布前暂停；源文件在 worker
  确认前保留，失败取消无 canonical conversation/group/family 泄漏。
- 导入状态 React/Query 生命周期合成测试 **13 passed**；全体 UX Node
  回归 **1,439 passed / 0 failed / 0 skipped**。
- 真实 Playwright 导入任务矩阵 **12/12 passed**：375、768、1440px，
  中英文、亮暗主题；覆盖关窗后切页与刷新、任务中心重新打开、分析完成、
  失败读重试及结果恢复。实测还修复了重新打开导入对话框焦点落到 body
  的键盘可达性问题。
- Web lint、typecheck、Next build 和导入相关 Python Ruff 均通过；完整
  API suite **1,383 passed / 177 skipped**。全量 API 套件约 44 分 53 秒；
  Windows 测试 runner 峰值 working set 约 3.84 GB 后正常退出。这是本地
  测试进程资源记录，不是服务进程或生产内存结论。另有独立 PostgreSQL 17
  取消竞态测试 4/4；全量 suite 设置 `SETTINGS_POSTGRES_INTEGRATION=0`，
  跳过项不计通过。

- 首次导入专项 **50 passed**；加入 ASGI 并发和流式 draft 测试后
  **61 passed**，均保留各自检查点边界。
- 最新上传准入＋并发响应专项 **21 passed**，包括真实 ASGI 路由解析等待时
  轻量请求仍能完成、七种已保存来源分析入口的可重试压力响应、8 线程
  首次准入单信号量回归。后续更大检查点见本记录更新，不把旧进程加载的
  模块冒充最终源码。
- 内存准入与探针补强专项 **35 passed**：单独验证 Linux host/cgroup
  v1/v2 余量取最小值、嵌套父限制、工作集估算边界、不可观测时 fail-closed、
  以及附件 staging 不受解析器内存准入影响。
- 将当前所有 `test_cleanup_*.py`、`test_content_cleanup.py`，以及导入分析、
  draft/canonical 回滚、ASGI 响应、内存探针与准入专项合并复跑：
  早期合并检查点为 **381 passed / 34 skipped**；之后同一工作树全量 API
  suite **1,383 passed / 177 skipped**，以前者不覆盖本条目的完整 API 范围。
  新增 multipart spool 配置回归；跳过项不计为通过。
- 噪声复用、原始偏移／Unicode、保护确认、精调删除和校验工作专项：
  **130 passed**。
- 扫描正文保留专项 **2 passed**：20 条合成消息、chunk size 1／20，
  SQLAlchemy 加载事件和弱引用确认下一条加载时只存活当前 1 条完整
  `MessageVersion`，最终全部释放。它不是 RSS 峰值测量。
- 候选页正文投影专项 **1 passed**：100 条候选只计算一次 exact source
  fingerprint、不建立不必要的保护解析器，并只查询目标版本的
  `display_text`。扫描坐标滚动计算在 120 个 CRLF/LF 合成命中上逐项等同
  旧式绝对 count/rfind 结果。
- 曾有一次临时目录设置把 pytest basetemp 与 TEMP 设为同目录，导致
  Windows 文件锁错误；修正为子目录后重跑通过，不计产品通过项。
- 之前本轮的 Web lint/typecheck/build、完整 UX Node、相关 API、Skill 和
  Context 兼容性结果见
  `CHAT_READER_TABLE_TOC_CLEANUP_ANNOTATIONS_2026-10-17.md`；本次新增了导入内存/
  队列错误的中英文恢复文案，Web lint/typecheck/build 与 UI 回归仍需复跑。
  Context 合同未变。

## 尚未验收与边界

- Windows 本地不能证明 Linux PID 1、Docker SIGTERM grace period 或约 2 GiB
  Linux 持续 60 分钟资源测试；这些仍标为未验收。
- 没有使用真实用户导入资料，也没有修改
  `apps/api/storage/imports/`。
- 线程池隔离可以避免事件循环被单个导入同步阻塞，但不能把单个超大文件的解析
  内存变成与文件大小无关，也不是 CPU/GIL 完全隔离；输入倍数是风险估算，
  不是 parser hard cap。来源文件解析和单消息 Unicode 来源映射仍可能有显著
  峰值，当前不能承诺任意合法上限输入都适合 2 GiB 共享主机。
- 没有证明生产内存泄漏、噪声唯一致因或所有 OOM 均已解决。主机还承载
  其他进程；本地降低应用峰值不能替代真实负载的主机容量验收。
- 本地改动仍未提交、未启动 CI、未部署；生产服务不会因本地代码自动改变。
- 全量 API 测试 runner 的 3.84 GB Windows working set 说明超大本地套件本身
  有较高资源成本；该值不能外推为服务 OOM，也不能替代要求中的隔离约 2 GiB
  Linux 服务压力验收。后者和 Linux worker shutdown 仍未执行。
