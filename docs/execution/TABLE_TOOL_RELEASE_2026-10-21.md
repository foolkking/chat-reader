# 表格工具与运维加固发布 — 2026-10-21

## 当前阶段

用户明确要求“提交部署”，本轮进入发布准备。沿用此前明确要求：启动 CI 后停止，
等待用户报告结果，再继续部署。只使用本地令牌与 GitHub API/CLI，不登录、
不操作 GitHub 网页。此记录不宣称 CI 或部署已经通过。

## 提交范围

- 已收尾的表格双向编辑、简化入口、四边增行列、分页/输入保护和单次撤销。
- 共享 Markdown/弹层输入边界的关联修复与合成回归。
- 备份/preflight 的无构建、固定镜像、只读受限 reader 及测试。
- 上一轮发布审计文档与本地表格/运维证据，保留失败和撤回试验的原义。
- 不提交生成的 `apps/web/tsconfig.tsbuildinfo`；不修改用户导入资料。
- 无数据库、CanJSON/Context、离线包、Share URL 或默认 Skill ZIP 合同升级。

提交前远端 `master` 与当前基线一致，为 `50f6de4`；工作流为
`Build release images`（`build-release-images.yml`）。发布只接受精确提交的完整
质量及镜像任务；不选择性绕过失败，不在工作站/生产主机构建 Docker 应用镜像。

## 验证与 CI 准备

既有表格最终门禁为 122 专项、69 文件/1,513 无服务回归、76 Chrome 场景、
lint、非增量 typecheck 和单 worker Web build。20 源码/测试及 29 制品摘要在
本次发布准备时重新复核一致，不能将它们扩大为完整真实账户/真机验收。
既有运维回归为 67 通过/1 Windows flock 跳过。

本次发布前重新执行的六项检查全部通过：

| 检查 | 结果 |
| --- | --- |
| 全部 69 个无服务 UX Node 文件 | 1,513 通过，0 失败/跳过 |
| 四文件运维/恢复 API 专项 | 67 通过、1 Windows flock 跳过；包括 27 项新回归 |
| Web lint | 退出码 0 |
| 非增量 Web typecheck | 退出码 0 |
| Web production build | 退出码 0；`NEXT_BUILD_CPUS=1`、`NEXT_STANDALONE=0` |
| Alembic heads | 单一 `20261017_0052`；没有连接生产或执行迁移 |

完整 PostgreSQL/API、浏览器/PWA、标准构建与镜像门禁仍由本次完整工作流执行，
不能预先记为通过。76 场景的既有 Chrome 证据不记成本次重跑。
本轮回执见相邻 `TABLE_TOOL_RELEASE_2026-10-21-evidence/`。

发布入库前发现 189 个待提交文本制品中 104 个会被 Git 换行规范化，
使原 SHA-256/字节大小声明失效；`.gitattributes` 对本批带日期的原始制品禁用
文本换行转换，保留历史测量字节。不是改写测试结果或重算旧证据。
这些原始制品允许既有 CRLF 和终端末尾空行；应用源码、正常 Markdown 与其他
文件的 whitespace 检查不放宽。
其中 `.txt` 原始 stdout 还保留构建器终端 padding 与断言输出的行尾空白，
不为满足源码格式检查而篡改已留存的回执字节。
运维旧回执的 `.gitattributes` 摘要属于原检查点；本次只追加制品存储属性，
四个运行源码/测试不变，不回写旧回执。入库后另复核 index 中的实际字节。
源码摘要区分当前 Windows 工作副本与 Git 的 canonical blob：普通文本仅允许
Git 的 CRLF→LF 转换，另记 blob SHA-256 和转换路径；冻结制品必须逐字节相同。
本地旧摘要不伪装成 Linux checkout 摘要，完整 CI 验证实际提交后的源码。

## 部署前必须保留的边界

1. CI 启动后停止；用户报告通过之后仍独立核验精确 run/commit 与原始制品。
2. 当前生产的最后验收为 `50f6de4 / 0052`，不是本次新的 live 审计。
3. 先备份并验证五组件，再替换 API/worker/Web；生产配置、PostgreSQL、
   导入原文和卷不改，不执行 `down -v` 或生产压力测试。
4. 同版本部署三个 backup/preflight shell；新 reader 的实际 Docker/停止写入
   备份尚未验收，失败应停止并保留现场，不能自动 build/pull 或改 serving 配置。
5. 只加载精确 CI 镜像并使用现有 no-build 更新路径；保留当前回退镜像和新备份。
6. 表格极大输入长任务、跨浏览器/真机和长期低内存验证仍未完成，
   不因发布通过声称这些风险消失。

本轮不恢复表格无限优化目标，不顺手清理其他任务资料。
