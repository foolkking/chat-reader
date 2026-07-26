# 已知问题与不确定性

最后核验日期：2026-07-26

本页只记录现象、差异和证据，不提供改进设计。

## KI-001：旧产品文档未覆盖现有批注和离线资料

**编号：** KI-001
**类别：** 文档与代码不一致
**现象：** `docs/product.md` 与 `PROJECT_STATE.md` 的部分段落仍描述“没有完整笔记/批注”或“不离线缓存私有对话”，当前代码和生产已有批注、精选笔记、离线包和 `/library` Reader。
**出现位置：** 上述旧文档。
**复现步骤：** 对照旧文档、`features/annotations`, `features/offline`, backend annotation/offline routes 和 `PAGE-008/010/011`。
**实际结果：** 旧描述落后于当前实现。
**预期结果来源：** 文档应反映当前 commit 的维护规则。
**证据：** 源码与生产截图。
**影响范围：** 后续智能体和开发人员理解系统边界。
**确认程度：** 已确认。
**相关代码：** `apps/web/features/annotations`, `apps/web/features/offline`, annotation/offline routes。
**是否阻塞后续 UX 调研：** 否；应以本目录事实基线为准。
**备注：** 旧文档保留历史语境，索引已说明时效。

## KI-002：旧状态文档的 migration head 过期

**编号：** KI-002
**类别：** 文档与代码不一致
**现象：** `PROJECT_STATE.md` 记录 migration head `0013`；源码和生产为 `20260724_0015 (head)`。
**出现位置：** `PROJECT_STATE.md`、Alembic versions、生产容器。
**复现步骤：** 查看旧文档；列出 migrations；生产执行只读 `alembic current`。
**实际结果：** 文档版本落后两个 migration。
**预期结果来源：** Alembic head 与生产只读结果。
**证据：** `apps/api/alembic/versions/20260724_0015_annotation_types.py`, `PROD-RUNTIME-001`。
**影响范围：** 部署、schema 调试。
**确认程度：** 已确认。
**相关代码：** migrations。
**是否阻塞后续 UX 调研：** 否。
**备注：** 本事实文档记录当前 head。

## KI-003：最近页面存在但主侧栏未发现直接入口

**编号：** KI-003
**类别：** 功能状态不明/隐藏
**现象：** `/recent` 页面与 `/api/recent-items` 存在，生产 URL 返回 200；当前 `ProjectSidebar` 未发现指向 `/recent` 的导航项。
**出现位置：** 在线管理壳。
**复现步骤：** 搜索 sidebar 菜单和链接；直接 GET `/recent`。
**实际结果：** 直接路由可访问，常规侧栏入口未发现。
**预期结果来源：** 无明确产品规则；仅记录入口状态。
**证据：** `apps/web/app/recent/page.tsx`, `features/reading/recent-items.tsx`, HTTP-001。
**影响范围：** 页面地图和后续截图覆盖。
**确认程度：** 部分确认。
**相关代码：** `project-sidebar.tsx`。
**是否阻塞后续 UX 调研：** 否；可直接 URL 核验。
**备注：** 不推断是有意隐藏还是遗漏。

## KI-004：公开 Share 页未用有效生产 token 完整核验

**编号：** KI-004
**类别：** 安全边界导致无法核验
**现象：** Share 创建/管理面板、已有记录结构和 token-limited 前后端代码可确认，但本次不复制或记录真实 token，未打开有效生产 Share reader。
**出现位置：** `/share/[token]`。
**复现步骤：** 本次只打开 creator 面板，未读取 token。
**实际结果：** 创建端和代码链路确认，访客视觉/网络请求仅部分确认。
**预期结果来源：** share routes/service 和 public reader。
**证据：** `PAGE-009`, `features/sharing/share-readonly-reader.tsx`, `/api/shared/{token}/*`。
**影响范围：** Share 访客 UX 调研。
**确认程度：** 部分确认。
**相关代码：** sharing frontend/backend。
**是否阻塞后续 UX 调研：** 仅阻塞有效 Share 页面实操。
**备注：** 后续需使用合成/测试 token，不能把生产 token 写入证据。

## KI-005：真实离线冷启动和失败注入未在本阶段执行

**编号：** KI-005
**类别：** 环境问题导致无法核验
**现象：** PWA 壳、原子 cache、Dexie、离线包和 Playwright 场景存在；本次没有切断网络、清空 cache、耗尽 quota 或故意破坏 staging asset。
**出现位置：** `/library`。
**复现步骤：** 只在线打开 library/reader 并检查 SW/manifest/代码。
**实际结果：** 在线入口和本地副本可用；完全离线冷启动仍是代码/自动化确认。
**预期结果来源：** `library-sw.js`, offline E2E。
**证据：** `PAGE-010/011/016`, `apps/web/e2e/library-offline.spec.ts`。
**影响范围：** PWA 真实设备与网络异常调研。
**确认程度：** 部分确认。
**相关代码：** SW/offline DB/library shell。
**是否阻塞后续 UX 调研：** 阻塞离线失败态的现场截图，不阻塞在线页面审计。
**备注：** 本阶段禁止影响生产或清理浏览器数据。

## KI-006：写链路未对生产数据执行

**编号：** KI-006
**类别：** 待验证问题
**现象：** 导入、编辑、删除、批量操作和同步入口/API/测试存在；为避免影响生产资料，本次只打开入口和读取状态。
**出现位置：** import、canonical editing、bulk management、offline sync。
**复现步骤：** 查看 `PAGE-002/STATE-001/STATE-002` 与代码，不提交 mutation。
**实际结果：** UI/代码链路确认，当前生产部署上的成功/失败反馈未完整走通。
**预期结果来源：** routes/services/tests。
**证据：** 功能清单相应行。
**影响范围：** 可写流程的端到端 UX。
**确认程度：** 部分确认。
**相关代码：** import/editing/annotations/projects/conversations。
**是否阻塞后续 UX 调研：** 需要隔离测试数据后才能完整核验。
**备注：** 不能以未执行生产写操作推断功能失效。

## KI-007：生产 TLS/Nginx 完整配置不在仓库

**编号：** KI-007
**类别：** 实现状态不明确
**现象：** 公网 HTTPS 和 Nginx 响应可确认；仓库 `deploy/nginx-chat-reader.conf` 仅为 HTTP 示例，无法从仓库确认真实证书、续期和全部规则。
**出现位置：** 生产反向代理。
**复现步骤：** 对照公网响应和 repo deploy 文件。
**实际结果：** 运行结果确认，配置来源部分确认。
**预期结果来源：** 现有部署结构。
**证据：** HTTP-001, `deploy/nginx-chat-reader.conf`。
**影响范围：** 部署维护和故障排查。
**确认程度：** 部分确认。
**相关代码：** deploy config。
**是否阻塞后续 UX 调研：** 否。
**备注：** 未读取仓库外生产敏感配置。

## KI-008：生产 OpenAPI schema 未经同源 `/api` 暴露

**编号：** KI-008
**类别：** 已确认现象
**现象：** `/api/openapi.json` 返回 404；FastAPI 本地 `app.openapi()` 正常生成 67 paths/79 operations。
**出现位置：** 生产 API 文档入口。
**复现步骤：** GET 生产 `/api/openapi.json`；本地调用 `app.openapi()`。
**实际结果：** API 正常工作，但该 schema URL 不公开。
**预期结果来源：** 无证据要求生产必须公开，仅记录差异。
**证据：** HTTP-001, API-001。
**影响范围：** 外部调试/接口发现。
**确认程度：** 已确认。
**相关代码：** `main.py`, `next.config.mjs`。
**是否阻塞后续 UX 调研：** 否。
**备注：** 不将 404 解释为业务 API 不存在。

## 代码与线上差异汇总

截至核验时，本地和生产 Git commit 相同，已查看的核心页面能力与代码一致；未发现有证据的“代码有而同 commit 线上缺失”或“线上有而当前代码找不到”。KI-001/002 是旧文档与当前实现差异，不是当前代码与生产差异。

