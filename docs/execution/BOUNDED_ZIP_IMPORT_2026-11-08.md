# 有界 ZIP 导入实施记录 — 2026-11-08

## 授权与边界

用户要求开始执行大 ZIP／长 Markdown 内存优化计划，保留其已本地提交的
其他工作。实施检查点继续现有 `master`；未提交、推送、派发 CI、部署、清理生产或
重放任何用户 ZIP。未执行本地应用测试、构建或容量实验。
生产指针仍由 Project State 和既有发布回执维护；本记录不是发布回执。

## 源码落点

| 工作包 | 候选实现 |
| --- | --- |
| 准入与探测 | `core/memory.py`、`adaptive_import/memory_budget.py`：有效物理/cgroup容量、128–512 MiB动态保留量、64 MiB工作区；仅合格ZIP路径取消×32。未知探测失败关闭，JSON/混合/旧草稿保留标准规则。 |
| 顺序I/O | `bounded_io.py`、`archive_sources.py`、`local_storage.py`、asset store/scanner：64-KiB分块、哈希/CRC、目录先验限额、写入同步与文件缓存建议；磁盘满独立错误。 |
| 解析与草稿 | `stream_markdown.py`、`stream_native_markdown.py`、`manifest_stream.py`、`record_spool.py`、`stream_draft.py`：真实消息边界、单条1 MiB；manifest不保留正文；内部v2索引草稿与v1共存。 |
| 重用与发布 | `normalization_cache.py`、`stream_enrichment.py`：配置/源哈希绑定的完整分组缓存、不可变generation、附件真实出现位置；部分写入不发布。 |
| 入库和衍生数据 | `canonical/stream_persistence.py`、block builder、TOC、search：单消息写入、行数/字节双批次、磁盘slug计数、读取窗口缩小；保留用户原image-lane适配与原子事务。 |
| 队列与恢复 | `operations.py`、`resource_wait.py`、两类worker队列、migration0060：耗时操作202；15/30/60秒非占槽等待，累计30分钟暂停；原任务继续、等待提交可取消并保留草稿。 |
| Web | 导入面板、任务监视器、health/mapping和API helper：等待/暂停/失败区分；后台GET、账号代际/abort；未知POST不自动重放。 |
| CI | 新API/Node回归及additive exact-image门禁；保留原320 MiB gate，新增v2小ZIP、约100/500 MiB和长Markdown四例，官方报告独立复核。 |

## 完成度复查中的修正

- 旧v1整会话草稿不能因启用新开关取得低内存准入；ZIP→JSON按新来源检查。
- canonical fallback version补齐必需的`based_on_source_version_id`。
- 预览改为`islice`，避免一次物化12条最大消息。
- TOC唯一slug计数落磁盘；block task游标避免重复全量扫描。
- cgroup v1排除非memory挂载；v2真根无限制与后代探测失败分别处理。
- 资源竞争改为非阻塞，不在持有事务时睡眠等待120秒。
- 等待耗尽投影明确暂停；不是再次要求用户缩小文件或误报文件损坏。
- 原生Markdown/Transcript正文、角色、时间和来源信息补等价回归。
- 未确认POST与持有task ID的GET重试分开；关闭轮询不取消服务器工作。
- 仅在后台明确接收后允许关闭窗口，仍确认未保存映射，不提前解锁并发操作。
- 草稿正文及偏移索引均拒绝软链接和非本目录文件名，补路径与链接回归。
- 补第二个对话已写入后故障的整批回滚用例，检查原文件、旧草稿仍在。
- 磁盘容量／配额不足直接报告存储故障，不再被健康检查吞成“映射漂移”。
- cgroup零限额不当作无限制；控制文件无效或挂载无法匹配时不借用宿主机容量。

## 验证状态

本地只运行静态工具；进程TEMP/TMP为任务独立目录
`C:/Users/86182/Desktop/wkkk/chat-reader-bounded-zip-20261108`。
最终静态检查如下；新增测试不等于测试已通过：

| 检查 | 本轮结果与范围 |
| --- | --- |
| Web TypeScript | 全项目`tsc --noEmit --incremental false`通过；不写增量缓存。 |
| Web ESLint | 本轮9个修改的TS/TSX文件通过；不是完整Web运行测试。 |
| Python | 50个修改／新增Python文件AST解析通过；其中非测试源码pyflakes零告警。 |
| Node | 4个新增／修改回归脚本`node --check`通过；未运行测试体。 |
| Workflow | 修改的release workflow YAML解析通过；未触发GitHub Actions。 |
| Migration | 静态检查61个revision，唯一head为`20261108_0060`，父节点完整；未连接数据库或运行Alembic迁移。 |
| Patch | `git diff --check`通过；Git的LF/CRLF工作区提示不是运行验收。 |

待CI验收：完整API/旧小ZIP/JSON/new-v2回归，真实PostgreSQL migration/
隔离恢复/worker取消竞争，Web lint/typecheck/build及Reader/离线/Share专项，
原v1与新4例真实内存门禁。浏览器离开/重入、跨账号、未知响应、中英文状态
及用户文件仍需另行验收。不得预先宣称100/500 MiB已跑通。

## 后续CI提交授权

2026-11-08用户明确要求将本次改动与上一次本地提交`2bb6ef0`一起提交CI。
保留该提交，以追加提交快进现有`master`，派发一次完整`Build release images`。
不新建分支，不纳入旧清理记录、其他审查文件和本机构建缓存。
本次只提交，不等待结果、不部署、不建立自动回查；后续读取结果仍遵守
派发后至少50分钟规则。CI运行证据尚未验收，不能用静态检查替代。

## 已知范围限制

- 重用粒度为**已完成的规范化分组**；中断的单条/分组重算，不是任意字节断点续传。
- 约束运行内存，不承诺固定总磁盘或预留空间；历史派生generation随现有会话
  保留策略处理，不自动清除用户原文件，磁盘满保留旧可用状态。
- 1 MiB正文不是任意密集语法对象的内存保证；guard可停止超工作区输入，
  不会为通过门禁拆分、截断、提高阈值或放宽扫描。
- 新CI只覆盖对应合成负载/本地asset store；远程扫描/S3容量仍需独立测量。
- 内部v2不是portable archive；旧二进制不兼容。关闭开关不能代替回退兼容核验。
