# 备份／发布检查的无构建读取器 — 2026-10-21

## 范围与结论

作为[表格阶段收尾](ux-audit-table-closeout-2026-10-21.md)之后的一个有界下一步，
修复 2026-10-19 已记录的 preflight/backup 隐式构建风险。仅本地源码与测试，
没有 CI、推送、部署、生产访问或新 migration；不声称解决全部服务 OOM。

旧脚本通过 `compose run ... api` 执行 `du` 和 `tar`，而 API 同时带 image/build
配置，缺少默认镜像时可能构建。合成 Docker 明确拒绝这个路径，两份旧脚本
均退出 99；调用日志保留在相邻证据。历史生产的意外构建另见
[2026-10-19 发布记录](OOM_RELEASE_2026-10-19.md)，本次没有再现生产故障。

## 保留的修复

- `deploy/backup_volume_reader.sh` 由两个原脚本共享，不引入服务或应用架构。
- 只接受当前 Compose 项目恰好一个完整 API 容器 ID；`ps -a` 兼容停止写入后备份。
- 读取容器实际 immutable image ID，确认本地 image ID 相同及四个 `/data/*` 挂载齐全。
- 使用 Docker 原生命令、`--pull=never`、`--volumes-from <source>:ro`、只读根目录、
  无网络、无额外 capabilities、no-new-privileges、64 MiB memory/swap 和 32 PID 上限。
  不继承 Compose 应用环境/命令，不 build/pull/up，不使用不兼容的 `run --no-build`。
- Docker 大小读取不放进会隐藏退出码的 POSIX pipeline；读取/打包错误直接失败。
- 继续验证归档后才原子发布原五组件目录；失败清理仅限本次 staging/lock。
  现有恢复、去重和旧备份格式不变，未清理任何已有备份/用户数据。
- `.gitattributes` 将三个相互依赖的 shell 固定 LF；后续发布需携带同版本三文件。

## 测试、失败与证据

新文件 `apps/api/tests/test_backup_shell_safety.py` 共 **27 项**：
调用两个真实 shell，使用合成 Docker，真实 tar/gzip/SHA-256 和带空格的合成路径。
检查成功路径、无来源/多来源/坏 ID/缺镜像/错镜像/缺挂载、大小读取失败、
无效大小、归档失败不发布部分备份、非法余量及原有空值默认行为。
所有 Docker 调用走测试桩；没有连接 Docker daemon。

| 批次 | 结果 | 解释 |
| --- | --- | --- |
| 首次基线 | 2 失败 | 一份被 Windows `C:` 归档路径解释提前拦住，不算产品基线；另一份拒绝旧 Compose one-off |
| 修正 POSIX 路径后的基线 | 2 失败 | 两份旧脚本均触发被拒绝的 Compose one-off，退出 99 |
| 首次修复回归 | 24 通过 / 2 失败 | 测试未识别 MSYS SHA-256 的 `*` 标记，以及误把原有空值默认行为当作非法输入；修正测试，不改产品兼容语义 |
| 最终四文件回归 | **67 通过 / 1 跳过** | 新增 27 项包含在总数中；唯一跳过为 Windows 无法运行的 Linux flock 争用 |
| 三份 shell 语法 | **通过** | `bash -n`；不能替代实际 Linux/Docker 执行 |

证据：
[旧 preflight 调用](OPS_BACKUP_READERS_2026-10-21-evidence/baseline-preflight-calls.txt)、
[旧 backup 调用](OPS_BACKUP_READERS_2026-10-21-evidence/baseline-backup-calls.txt)、
[新 preflight 调用](OPS_BACKUP_READERS_2026-10-21-evidence/final-preflight-calls.txt)、
[新 backup 调用](OPS_BACKUP_READERS_2026-10-21-evidence/final-backup-calls.txt)、
[最终测试回执](OPS_BACKUP_READERS_2026-10-21-evidence/pytest-final.txt)、
[源码与检查边界](OPS_BACKUP_READERS_2026-10-21-evidence/verification.json)。
日志中的容器、镜像及数据均为重复字符 ID 和合成资料，不是生产身份。

## 尚未验收与后续发布要求

1. 真实 Docker 对现存/停止容器的只读 volumes-from、断源失败与 cgroup 限制。
2. 完整五组件停止写入备份、真实 PostgreSQL dump/restore 和去重复验；
   shell 测试的数据库输出为桩，不能宣称已验证数据库恢复。
3. API 容器不存在时明确拒绝；不为首次引导自动创建应用或猜测数据卷。
4. 这不是跨组件原子快照、全量 OOM 修复、60 分钟负载或 Docker PID 1 验收。
5. 原生产版本/配置/0052 schema 均未改变；需要新发布授权才能采用修复。

## 知识收尾

| 事实面 | 状态 |
| --- | --- |
| 代码 | changed-and-verified：本地 shell/合成数据回归；Docker 行为仍 pending |
| 运行态 | out-of-scope：不重新访问生产，沿用明确日期的历史审计 |
| 文档 | changed-and-verified：状态/索引/测试/部署合同同步，局部链接检查 |
| 规则 | verified-current：遵守 AGENTS；任务 TEMP/TMP 独立，不改用户导入数据 |
| 记忆 | not-applicable：未写机器生成记忆 |
| 工作区 | pending：已有未发布改动/证据全部保留，未清场 |

表格开放式优化到此结束；本项局部修复也到此结束，不自动转为新的无限排查。
