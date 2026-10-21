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

## CI 失败修复续记

首轮 CI `39561847297` 在 `web-quality` 的 Release H 附件浏览器门禁失败；
API、设置浏览器及该 job 前置的 lint/typecheck/build、1513 项无服务 UX
测试均通过。失败严格集中于 **375px 中英文**的 Viewer Escape 关闭流程：
查看器退出时，保留的移动文件抽屉也被 Reader 的全局 Escape 处理器关闭，
所以原“预览”按钮无法恢复焦点。桌面场景通过。这不是扫描/OOM 故障。

修复复用了 Vaul 已安装的 Radix DismissableLayer 版本并提升 Viewer 的
弹层层级，同时启用其 modal pointer ownership，避免 Viewer 关闭指针事件
被延迟交给底层抽屉。Escape 仍由共享 Viewer focus hook 按常规 bubble
路径处理；Reader 全局处理器现在尊重 defaultPrevented、IME composing
和 legacy keyCode 229。没有替换弹层体系或修改后端/数据格式。

本机复验：完整 service-free UX **1519/1519**；lint、非增量 typecheck、
单 worker Web production build、34 个 release-image/PostgreSQL 工作流
合同测试均通过。真实挂载 Chromium + React + Vaul + Reader/View 的合成
375px 测试 **12/12**（中文/英文、Escape 只关 Viewer 并保留面板/筛选/
选择/焦点、连续 Escape 关闭 Sheet、IME/子控件按键归属、鼠标和触摸关闭）。
合成门禁不覆盖 API/auth、离线包或真实附件存储；本机全 API E2E 因开发
数据库缺少 schema 未能运行，不据此宣称通过。修复前的独立隔离浏览器
基线稳定复现面板被一并关闭；中间一次合成 harness 错误也已单独修复，
最终截图和 JSON 仅作为最后成功证据。

下一提交需在精确源码上重跑完整 CI 并等待用户结果；不得沿用首轮 CI 绿灯
或仅凭本地合成测试部署。CI 通过前不部署。

## 镜像基础源限额失败 — 2026-10-21

Escape 修复提交 `39632abe017bf422272be6691a775d967a9605af` 的完整 CI
run `39593070512` 中，API/Web/Settings 三个质量 job 均通过，`build-images`
在 API Dockerfile 执行前因 ECR Public Python manifest 返回
`429 Too Many Requests / Data limit exceeded` 失败，Web 镜像、镜像检查、
制品打包和独立 artifact acceptance 因依赖关系跳过。API job 日志还证实
PostgreSQL ECR pull 遇到同类限额后成功回退至原先已验证的 Docker Hub
相同 SHA-256 digest；不是 OOM、源码编译错误或测试失败。

新增 CI-only 有界基础镜像解析：Python 与 Node 各从 ECR/Docker Hub 拉取
相同已验证 digest，每个来源最多三次、每次 60 秒并有 10 秒 kill grace；
确认 Linux/amd64 后，只有两者都就绪才写入后续 build step 环境。失败时
不开始任何应用镜像构建、不发布部分 pin、不改浮动 tag。下一提交仍需
重跑完整 workflow；等用户回报结果前不部署。

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
