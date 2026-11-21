# 固定内存下的内部工作单元 — 2026-11-21

## 查实的问题与修改

| 原路径 | 本轮处理 | 保留边界 |
|---|---|---|
| v1 canonical 草稿一行包含整条对话，commit 再按完整行估算／加载 | 低内存先验证完整文件和预览计数，磁盘索引消息，再逐条提交 | 不放宽原物化读取的 512 MiB 预留；丰富私有内容、过大单条退回原门槛 |
| ZIP 已逐条处理，独立 Markdown 却仍把完整文件读入内存 | 低内存复用同一 Markdown spool 和 v2 writer | 原始 JSON/混合来源的分析不在此优化范围 |
| stream writer 没有 bulk writer 的默认来源位置记录 | 复用完全相同的 fallback SourceMessageRef | 逐字段对照正文、版本、blocks、来源及元数据；显式 v2 引用不重复 |
| 无论何种 RAM 都使用小单元会损失吞吐 | 头寸充足保留原批量路径 | 不提高生产 RAM/worker 并发；不把附件并发或半成品公开当作省内存 |

没有 migration、依赖、接口、离线格式或生产配置变更。具体合同见
[Adaptive Import](../../system/ADAPTIVE_IMPORT_CONTRACT.md#message-sized-work-under-fixed-memory--candidate-2026-11-21)。

## 真实 Linux 计量，不是模拟内存探针

本机 Docker 的独立网络、PostgreSQL 16 和真实单 worker，worker 限额
**640 MiB**、memory+swap 同限额、1 CPU；保留 `UPLOAD_MEMORY_RESERVE_MB=512`。
按 cgroup `memory.current / memory.peak / memory.events` 取值，包含实际文件缓存，
不扣除缓存、停止心跳或改用内联提交。每次新起正常 worker，再经真实 HTTP 提交。
API 单独 1024 MiB，外层 VM 约 7.4 GiB；因此**不是**总量 1900 MiB 的升级演练。
所有资料为合成内容，不含生产数据。

旧版为上轮精确 CI `508dae710086e607613cb63f1fbef19c786fc7a4` 的 API 镜像；
候选仅把本轮七个实际 Python 文件叠加到该依赖底座，不宣称是正式签名发行包。
[最终逐次原始计量](memory-final.json)绑定 engine ID 和源文件摘要。
成功用例在 worker 外逐条核对全部正文，并核对全部来源引用数量；
单元回归另逐字段比较来源位置，不以“数量相同”代替语义一致。

| 用例 | 最终结果 | 耗时 | worker 峰值 |
|---|---|---:|---:|
| 旧版，800 条 JSON，源 3,163,174 B | `UPLOAD_MEMORY_PRESSURE`，拒绝而非 OOM | 1.625 s | 不拿拒绝时占用当作成功导入成本 |
| 新版，同一 JSON | 800 条及来源引用全部正确 | 28.656 s | 146,345,984 B（139.57 MiB） |
| 新版，800 条 Markdown，源 3,156,400 B | 800 条及来源引用全部正确 | 26.187 s | 147,009,536 B（140.20 MiB） |

以上成功用例 OOM kill 均为零，任务增量约 22–23 MiB，峰值是整个 worker
而非仅解析函数。不是“导入任意大小只需要 140 MiB”的承诺。旧版两条小消息在早期
干净 worker 中通过、最终一轮被拒，证明实际余量影响门槛；没有挑掉这项差异。
早期最终断言错误地要求小样本必然失败，原命令 exit 1 保留，修正的是对照预期，
不是产品内存门槛。

## 本地验证与失败修复

- 新增 **39** 项：64 KiB 边界转义/Unicode、坏 JSON、哈希/尾部/计数/重复字段、
  高低内存选路、来源及 canonical 语义一致、不丢私有内容、第 19 条失败全回滚、
  中途头寸 0/未知、磁盘耗尽、替换文件类型和 oversized 不截断。
- 最终新增＋原 ZIP Markdown 套件 **137 passed**，239.72 s；
  新增＋draft streaming＋bounded ZIP **102 passed / 2 原本地 skips**，213.70 s。
  两者范围重叠，不相加。完整 API **7089 实际收集**，并非 7089 已在本机执行。
- 质量调度 Node **65/65**；Python 调度 **6/6**、镜像候选 **8/8**、
  Web 门禁合同 **6/6**。新增测试独立登记，不改原 7010 项的源码、分片和三项允许跳过。
- 原 **2 failed / 332 passed / 2 skipped** 保留：磁盘索引错误最初漏出 500；
  新 generic lane 最初截获 legacy small ZIP，使原 192 MiB 准入用例变成 429。
  分别修复既有异常边界和排除所有原 ZIP，原失败断言未改。
- 更早 Windows 测试用默认编码读 UTF-8、Markdown 夹具不满足实际原生格式，
  以及把既有内存拒绝 429 误写成 400 的新断言失败均保留于任务日志。
  最终用例使用实际格式/状态合同，不跳过失败。

本轮没有前端改动；不宣称新的视觉或真机验收。当前工作树的完整 CI、1900 MiB
升级负对照、正式发布及生产部署必须各自取得新证据，旧 CI 不能认证本轮代码。
备份恢复和后续授权清理单独记回执；未完成前不删除原唯一已验证恢复点。
