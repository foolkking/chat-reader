# 功能与导入稳定性发布 — 2026-10-19

本地日期使用 Asia/Shanghai。正式接受时间 **2026-10-19 00:21:58 +08:00**，
即 **2026-10-18 16:21:58 UTC**；独立复核在 16:22:00 UTC 完成。
这是已通过 CI 制品的部署记录，不把此前本地源码检查计为生产验收。
[脱敏机器证据](../evidence/feature-release-2026-10-19.json)。

## 来源和 CI

| 项目 | 已核实结果 |
| --- | --- |
| 源码 | `f3b331a53a593f4cdb84a37f9eb25f13379f3eb5` |
| CI | **39135555660**，尝试 1，五个任务全部成功 |
| 原始镜像制品 | **12141071331**；GitHub API digest 与原始 ZIP SHA-256 一致 |
| 独立镜像核对 | 50 个 OCI blob、全部 layer diff ID、四个标签、两个配置、330 个 API 源文件、内嵌版本与默认 Skill 字节一致；无禁止路径 |
| API | **1562 passed / 3 skipped**；三项跳过需要未配置的真实配对 fixture，不是 POSIX 跳过 |
| PostgreSQL | CI 单一 head/current **20261017_0052** |
| Linux worker | CI 实际 Python 信号与四项外部 POSIX SIGTERM/SIGINT 用例通过；不等于 Docker PID 1 验收 |
| 构建边界 | 仅 CI 构建；工作站和 King 均未构建镜像 |
| 凭据边界 | 使用既有本地凭据与 GitHub REST；无 GitHub 网页登录、无 web search |

### 原始质量制品的门禁摘要

| 门禁 | passed | skipped | failed |
| --- | ---: | ---: | ---: |
| `adaptive-import-recovery` | 9 | 1 | 0 |
| `context-files` | 35 | 0 | 0 |
| `csp-enforcement` | 4 | 0 | 0 |
| `default-pwa` | 151 | 738 | 0 |
| `focused-online-security` | 45 | 0 | 0 |
| `markdown-image-viewer` | 25 | 0 | 0 |
| `pdfjs-maintained-line` | 13 | 0 | 0 |
| `pwa-negative` | 19 | 0 | 0 |
| `settings-stages-1-4` | 463 | 0 | 0 |
| `share-focus` | 2 | 0 | 0 |
| `single-owner-auth` | 18 | 0 | 0 |
| `source-editor-cleanup` | 3 | 0 | 0 |
| `source-editor-mutation` | 100 | 0 | 0 |
| `system-archive-new-instance` | 1 | 0 | 0 |
| `upload-token-atomicity` | 18 | 0 | 0 |

条件跳过保留为 skipped，不冒充执行通过；隔离 CI 浏览器结果也不代表真实
生产账户的完整交互验收。本次没有逐张审阅全部 CI 截图。

## 本次上线范围

- 主动预览的源码表格规范化、创建空表、增加行列和草稿失效保护。
- Owner、Offline、Share Reader 的首次 TOC 跳转前位置返回。
- 固定规则版本可见、规则修订/重扫/比较、受保护匹配的明确批量确认和精确删除反馈。
- 在线已保存批注 Markdown 下载；四类 Context/CanJSON bundle 生产路径采用 1.1、
  根 `annotations.md`；Current/Index 及回传职责保持不变。
- 多文件初次分析进入现有单 worker 后台任务，可在任务中心查看进度、重试和结果；
  其他同步分析路径仍在线程池并受有界准入控制。
- 普通无结构 Markdown 作为单条 assistant 对话导入，页面/侧栏拖放按当前项目或
  未归类预选目的地；可在审核时修改。
- 扫描逐条正文消费、当前消息内紧凑规范化复用、输入规模与 host/cgroup 内存准入、
  multipart 早期溢写和 worker 合作停止修复。

功能合同分别在 [用户流程](../system/USER_FLOWS.md)、
[Adaptive Import](../system/ADAPTIVE_IMPORT_CONTRACT.md)、
[Content Cleanup](../system/CONTENT_CLEANUP_CONTRACT.md) 和
[Context Package](../system/CONTEXT_PACKAGE_CONTRACT.md)。
固定默认 Skill ZIP **没有替换**；只有 editable/reviewed 运行时支持新增批注文档，
不能把本轮应用发布描述为默认 Skill 升级。

## 维护过程、失败与恢复

1. 先核对精确源码/原始制品、生产镜像和配置。容量检查有约 7,240,240 KiB 可用，
   合并需求 4,383,279 KiB；未通过删除文件或减小预算来放行容量。
2. 第一轮停止应用后未达到原先的 512 MiB 可用内存门槛；在任何备份、load 或
   migration 前停止，恢复原有 3e68d1f 应用。原 PostgreSQL 与 schema 0051 保留。
3. 修订的是**一次性发布进程**预算：从 384 MiB 上限/128 MiB 额外余量，改为
   **192 MiB 上限 + 256 MiB 额外余量**，总门槛 448 MiB；memory+swap 384 MiB、
   0.5 CPU、只读根与数据卷。第二轮停止写入后实测可用 **522,240 KiB / 510 MiB**。
   这不是调低业务内存准入，也没有更改 API/worker/Web、swap 或其他应用配置。
4. 停止 Web/API/worker 后创建并验证五组成备份
   **chat-reader-20261018T160748Z**。PostgreSQL 未停止。这是停止应用写入期间的
   连续组件备份，不声称文件系统级原子快照；各 dump/tar 校验均通过。
5. 加载四个精确 CI 标签；受限 one-off 读取迁移前数据，只运行 Alembic 0051→0052，
   再读取相同数据并比较。未运行 owner-auth ensure-configured、回填或源文修复。
6. 新版健康后，任务验收脚本把不存在的 `/api/diagnostics` 错当公开诊断入口，
   其匿名 401 导致登记流程停止。真正的 `/api/internal/diagnostics` 是预期的
   公网 404。保留失败日志，只修正最终登记检查；**未再次停止服务或重复迁移**。
7. 登录/只读接口/退出登录、轻量健康、HTTPS 和独立运行审计通过后，正式发布
   current/rollback 指针和 0052 回退警告。

本次是计划维护，有停机窗口；不是滚动零停机发布。所有原始失败记录留在私有
版本化 release 目录，不因最终成功而删除。

## 数据和运行验收

| 项目 | 结果 |
| --- | --- |
| 迁移 | 单一 current/head `20261017_0052`；仅新增 nullable JSON `protection_review` |
| 旧数据 | **84 张表所有旧字段**的有序指纹不变，包含原有 `reviewed_ranges` |
| 新列 | 现有行全部 SQL NULL，未回填任何旧选择为保护确认 |
| 文件 | imports/exports/offline/assets 四根的文件路径/内容指纹不变 |
| 附件 | **313** SHA-256 校验通过，完整性报告 clean |
| 稳定表计数 | 迁移前后 **67** 张表一致；未重做上线后的全量 live hash |
| 应用 | API/Web healthy，worker `alive_idle`；精确镜像，零重启/OOM/startup error-keyword lines |
| HTTP | HTTPS health 200，HTTP→HTTPS 301，真实公开诊断路径 404 |
| 登录 | 登录及 13 个只读检查 200，退出 204，退出后私有请求 401；三份默认 Skill 下载字节一致 |
| PostgreSQL/配置 | 容器身份/启动/重启数、生产环境、Compose、Nginx、运维 checkout 均保持不变 |
| 内核 | 自首次发布预检 2026-10-18 15:36:17 UTC 起，无新 OOM 关键字行 |

认证 smoke 只产生正常的短期登录/退出会话写入，不创建/编辑对话，不执行导入、
噪声删除或批注写入。未把其结果当作生产浏览器交互验收。
未在 serving API 中执行完整诊断，没有停止其他应用、删除 volume、移动导入资料、
清理镜像或裁剪备份。当前保留四个服务器恢复点，磁盘快照约 5.65 GiB 可用；
不宣称已应用两点保留清理，也没有配置异地/定时备份。

## 回退边界

当前/直接回退为 **f3b331a / 3e68d1f**，精确旧 API/Web 镜像已经加载。
现在跨越 **0052→0051**，不能照搬上一版“只切镜像、不降级”的说明。

- 先停止写入并创建、验证新的完整备份。
- 使用保留的本次精确新镜像执行已测试的 `alembic downgrade 20261015_0051`。
- 该 downgrade 在去掉 `protection_review` 前，将已确认受保护 DELETE 改回 PROTECTED，
  防止旧代码把新授权错误解释为普通删除；保留旧 `reviewed_ranges` 和 canonical 原文。
- 验证 schema/选择/存储后才启动旧 API/worker；禁止自动降级或直接恢复唯一数据库。
- 更老的 0051→0050 回退还必须另行执行此前撤销精调授权的降级规则。

版本化 release 下保留了上一组指针，`release-state/rollback-0052-warning.txt` 已安装。
即使回退，也只能使用新版轻量健康检查，不能把完整诊断放回 serving API。

## 尚未验收与风险

- 共享主机总 RAM 约 **1.83 GiB**，独立检查时可用约 **252 MiB**。
  发布成功不保证所有导入都能获得资源；大批次可能明确失败并要求重试。
  没有证明噪声检查是此前生产 OOM 的唯一原因，也没有证明全部业务 OOM 已消除。
- **未运行约 2 GiB/60 分钟/20 循环综合压力测试**，未实测一次性进程峰值 RSS，
  未完成 Docker PID 1 停止验收；不能把本次受限维护当作这些项目通过。
- 没有对真实生产资料做导入/删除压力实验，也没有完整生产移动端交互、键盘/读屏验收。
- 固定默认 Skill 不支持新增批注文档识别；reviewed 构建是独立对象，替换默认仍需授权。

## Documentation Update Summary

| File | Action | Why |
| --- | --- | --- |
| `PROJECT_STATE.md`、`docs/index.md` | 更新 | 当前生产/CI/0052 与历史本地检查点明确分开 |
| 部署、API、用户流程与专题合同 | 定向更新 | 对齐已发布范围与跨 0052 回退边界 |
| `docs/development.md`、`docs/system/BACKEND_AND_API.md`、`docs/testing.md` | 更新 | 删除仍将后台导入、生产 schema 或 worker 修复描述为仅本地/0051 的现役表述；保留原日期测试边界 |
| 本记录、脱敏 JSON 与文档台账 | 新增/更新 | 记录实际成功、失败恢复和未验收边界 |

### Project Profile

- Type: Next.js 前端 + FastAPI/PostgreSQL/单 worker Web monorepo。
- Language: TypeScript / Python；pnpm 9.15.4，应用 Python 3.11+，宿主辅助脚本兼容 3.6。
- Commands: 沿用仓库 lint/typecheck/build/API/Playwright/Alembic 命令；本轮接受精确 CI 结果。
- Docs: 保留既有结构和历史证据，不改 AGENTS/README，不整体搬迁或删除旧档案。
- Closeout audit: rules, Git/worktree and Markdown inventory checked; 46 added relative links and `git diff --check` pass. The 18 dirty paths are intentional documentation/evidence changes only; no source-code change, commit, push, CI dispatch or deployment was made during closeout.
- Release stop: 本次发布后仅同步本地文档；不再主动推送、触发 CI、部署或持续优化。

## Post-report workspace cleanup

After the closeout report, the user explicitly authorized cleanup of the
repository-local generated residue. The following seven directories were
removed after confirming they were inside the repository, were not reparse
points, had no tracked files, and no test/build process was using them:

- `.tmp`
- `.tmp-auth-review`
- `.tmp-ci-33524605037`
- `.cache`
- `.pytest_cache`
- `.ruff_cache`
- `apps/web/test-results`

The repository source, release artifacts, documentation evidence and the
task-specific external temporary directory were not removed. A final existence
check confirms all seven paths are absent; `git diff --check` passes and the
remaining dirty paths are the intentional documentation/evidence closeout
changes listed above. No commit, push, CI dispatch or deployment was made.
