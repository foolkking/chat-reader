# 功能清单

## 2026-11-08 候选增量（未发布）

紧凑图片比例条、一次性导入适应栏宽、右上角工具分组、一起阅读、位置书签、
含上下文的批注导出和私人标签管理已进入源码候选。旧对照页重定向；
溯源/新增消息不再占 Reader 工具入口，其数据/API 兼容保留。
详见[阅读工具合同](READING_TOOLS_CONTRACT.md)与[验证记录](../execution/READING_TOOLS_2026-11-08.md)。
下方发布记录不能作为本次候选的测试或部署证明。

最后同步：2026-11-06。当前代码/合同是能力依据；CI、部署及尚未完成的用户侧
验收见 [Project State](../../PROJECT_STATE.md)，不以“已实现”冒充交互验收。

## Web 扩展与 Reader（生产基线）

两轮 24 项有界功能已随 `127eae5` 发布；随后 Reader、收藏、富 Markdown 与
ZIP 随 `3b839dc` 发布，`be58b12` 增加小内存 ZIP 恢复；当前 `67e6336`
保留这些能力并发布下述综合优化与恢复一致性。
各轮失败、检查点和人工验收限制仍在[实施记录](../execution/WEB_FEATURE_OPPORTUNITIES_IMPLEMENTATION_2026-10-30.md)
及[Reader 发布记录](../execution/READER_ZIP_RELEASE_2026-11-04.md)，不再将其标成本地未发布。

| 领域 | 本次有界能力 |
| --- | --- |
| 查找与整理 | 命名保存搜索、私人批注收件箱、文件目录、精确 hash 重复候选、已加载结果明确勾选后批量归档 |
| 阅读 | 收藏／手动已读、只读版本差异、会话内完整轮次折叠、分页 split／merge 来源、最多 100 个搜索命中连续阅读并返回原条件 |
| 复用与入口 | 私有来源引用、TSV／CSV 表格导出、粘贴导入、命名导出预设、离线常备清单、快速操作、批量标题修整；合成示例入口已移除 |
| 补齐的五项合同 | 受限访客预览、独立双对话只读对照、账户多标签、显式新增消息基线、有界文字冻结分享；具体排除项见数据合同 |
| 打印 | canonical 分页阅读稿，最多 2,000 消息并明确超限；不是直接 PDF 生成或任意内容保真承诺 |
| 离线下载可靠性 | 跨 ASGI 响应的短租约，避免有效下载被旧产物清理竞争；不改包格式和本机数据 |

当前生产已通过 `.cr` 可选扩展包含收藏、
标签、保存搜索及阅读基线，旧格式兼容，Share/冻结快照仍不便携。冻结分享不支持
附件、批注、笔记或访客导出。完整边界见[归档](DATA_ARCHIVE_CONTRACT.md)。

## 当前综合优化与恢复一致性（已部署）

`67e6336` 的完整 CI `42043078359` 六项与全部制品门禁通过，已于
2026-11-06 经独立授权部署；0059 和 52/52 派生索引回填验收通过。
认证/长期离线、删除回收、私有搜索和
归档扩展见[整合合同](COMPREHENSIVE_OPTIMIZATION_CONTRACT.md)。
后续草稿、离线搜索、导入预览重建、归档容量、Share/标签恢复、搜索分页及
索引回填让出均已发布；CI 浏览器门禁通过，不等于真实用户生产 UI 验收。
见[实施回执](../execution/RECOVERY_CONSISTENCY_2026-11-05.md)与
[发布回执](../execution/RECOVERY_CONSISTENCY_RELEASE_2026-11-06.md)。

## Current account features (deployed, 2026-09-02)

| Capability | Status | Contract |
| --- | --- | --- |
| Email/password login and server sessions | Implemented, automated-tested | HttpOnly cookie, 48-hour sliding inactivity, generic failures and rate limits |
| Registration and invitations | Implemented, automated-tested | `CLOSED`, `INVITE_ONLY`, `OPEN`; public registration creates `USER` only |
| Single deployment administrator | Implemented and deployed | Legacy owner is promoted by migration `20260901_0030`; deployment identity comes from server `.env.production` `ADMIN_EMAIL` / `ADMIN_PASSWORD` |
| Account ownership isolation | Implemented and deployed | Server-derived `owner_user_id` across private domains; cross-account IDs fail closed |
| Users & Access / password reset | Implemented and deployed | ADMIN-only management; SMTP reset or admin-generated grant |

Authenticated production browser acceptance remains `NOT VERIFIED` until the
operator runs the Web flow; the historical rows below are not the current
implementation authority.

## 导入与后台任务

| 能力 | 状态 | 当前语义 |
| --- | --- | --- |
| 两种导入入口 | 已确认 | Adaptive JSON/Markdown/ZIP 与独立 `.cr` 归档；`.crbundle` 产品入口已删除 |
| Adaptive Import | 已确认 | 单 JSON、单 Markdown、配对、批量与有界 ZIP；Session/Group/Family、Built-in/Learned Profile、Revision、drift、Mapping 与显式提交；ZIP 安全和小内存资格见 [Archive Import](ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md) |
| Profile 安全匹配 | 已确认 | hard requirements、无正文 signature、semantic guards、unknown role 阻断、全 Family validation |
| preview -> ImportDraft -> commit | 已确认 | preview 写受控 JSONL/digest metadata；commit 校验路径、统计和到期并读取同一 Draft，幂等排队 |
| CanJSON v2 | 已确认 | JSONL 流式导入/导出；正文一次；支持 gzip、selected、可选 versions/annotations/notebooks/source refs |
| durable worker | 已确认 | PostgreSQL queue、heartbeat、stale recovery、retry；单并发 |
| 全局任务入口 | 已确认 | Shell `任务` 打开现有 ImportTaskMonitor；导入、合并、删除、导出和内容审查共用同一后台任务 owner，不新增历史表 |
| 导入完成态 | 已确认 | Import surface 展示批量提交数量、消息数、warnings，并提供查看导入对话、打开第一条和关闭返回入口 |
| `.cr` round-trip | 已确认 | 后台 ZIP64 JSONL 导出、校验 preview、确定性 ID 重映射导入 |
| 历史 auto-clean | 已确认 | 新建消息版本并重建 blocks/TOC/search，不覆盖历史 |

## 对话与 Project 管理

| 能力 | 状态 | 当前语义 |
| --- | --- | --- |
| Project + 未归类单层侧栏 | 已确认 | 同时显示；Project 内对话不在未归类重复 |
| 移动与排序 | 已确认 | Project 容器固定为自定义拖放顺序且新建项追加到底部；Project 内/未分类 Conversation 保留独立排序、移动端 picker 与置顶 |
| 归档/删除 | 当前源码 | 归档可取消并保留归属；确认删除后 tombstone 与可重试清理任务同事务落库，Share 立即失效；无 Trash/restore |
| Linear 式批量选择 | 已确认 | hover checkbox、Shift 范围、X、Cmd/Ctrl+A、Esc、移动长按 |
| 批量操作 | 已确认 | 顶部入口在选择模式中保持原宽并切换为“完成批量操作”；移动、归档/恢复、导出、合并和删除直接位于上下文工具栏，合并标题与顺序由独立 focused dialog 持有 |
| 拆分与合并 | 已确认 | 消息原位版本化；会话变换非破坏式创建新会话 |
| 最近记录 | 已确认 | 路由/API 保留；仅移动端显示入口/继续阅读卡片 |

## 设置与账户

| 能力 | 状态 | 当前语义 |
| --- | --- | --- |
| Settings hub | 已确认 | 全局入口在侧栏底部向上展开为非模态 region；普通用户仅见账户安全、数据归档和自己的 Skill 管理，Root Admin 额外见系统管理、导入格式与噪声规则库 |
| Consequential settings dismissal | 已确认 | 密码、导入格式名称和备份选项的未提交状态不能被 incidental close 静默丢弃 |

## Reader、渲染与导航

| 能力 | 状态 | 当前语义 |
| --- | --- | --- |
| 完整轮次窗口 | 已确认 | 稳定 DOM 最多 3 轮，单轮全部 blocks 完成后挂载 |
| 极长消息 block 虚拟化 | 已确认 | >160 blocks 或 >50000 chars；动态测量、overscan 8、导航目标固定挂载 |
| 远距离导航 | 已确认 | quote -> character offset -> block -> message；布局稳定后 24px 内复校；成功后仅显示短时精确文字脉冲或左侧 fallback 标记 |
| 连续上下阅读 | 已确认 | 相邻轮次预取、prepend/trim 真实锚点补偿 |
| 阅读位置 | 已确认 | v2 block/version/order/ratio/字符偏移；按 block id -> index/message -> order -> ratio 恢复，兼容 v1 |
| 双 TOC | 已确认 | 对话索引跨消息；章节 TOC 绑定消息/heading |
| Markdown | 已确认 | GFM、Shiki、KaTeX、Mermaid、Obsidian callout/highlight、安全 HTML/details/media；策略 v13，不执行脚本或承诺全部插件。在线 Owner 任务列表可立即切换，Share/Offline/附件预览只读 |
| 收藏与快捷键帮助 | 已确认（源码/自动化） | 搜索右侧星标、收藏变黄；保留 `reading-list` API/数据；帮助外部点击/Escape 关闭、方向键约三行、Home/End 消息边界及 J/K；真实设备体验仍待验证 |
| 阅读偏好 | 已确认 | 宽度、Markdown 间距、15-22px 字号、主题、语言、默认专注 |
| 专注模式 | 已确认 | 临时隐藏侧栏、TOC、提示和工具，退出恢复锚点/面板 |

## 搜索、编辑与版本

| 能力 | 状态 | 当前语义 |
| --- | --- | --- |
| 全局搜索 | 当前源码 | conversation/message/heading/code/annotation/attachment，加本人 notebook/description 与标签筛选；全文 + trigram substring |
| 当前对话搜索 | 已确认 | 类型/角色筛选、计数、高亮、键盘导航和统一目标事务 |
| 消息编辑/恢复 | 当前源码 | 默认新建版本，也支持显式 replace-current；同 ID/版本号的内容仍可变化，草稿基线使用 hash；重建派生 read models |
| 重复结果折叠 | 当前源码 | 相同 content hash 返回 occurrence count，其他出处分页展开 |

## 批注与精选笔记

| 能力 | 状态 | 当前语义 |
| --- | --- | --- |
| 五类批注与四色 | 已确认 | highlight/underline/strikethrough/comment/bookmark |
| 锚点状态 | 已确认 | valid/remapped/orphaned/needs_review；旧 active/relocated/stale 在 API/离线读取时兼容映射 |
| 工作区形态 | 已确认 | 可拖动/缩放浮窗、左侧 dock、全屏阅读层 |
| 阅读模式 | 已确认 | 全部批注/精选笔记；连续阅读/逐条回顾 |
| 管理 | 已确认 | 单项编辑、批量样式/加入精选/删除、notebook 排序和 Markdown 说明 |
| 离线同步 | 已确认 | UUID/base revision outbox、幂等 receipt、冲突副本 |

## Share、导出与离线资料库

| 能力 | 状态 | 当前语义 |
| --- | --- | --- |
| Share 管理 | 已确认 | full/selected、expiry、revoke、include flags、allow export |
| Share Reader | 已确认（自动化） | token 约束 reader-turn/index/TOC/annotations/notebook；只读 |
| 导出 | 已确认 | Markdown v2、CanJSON v2、`.cr`；CanJSON v1 位于 Legacy；私人内容默认关闭 |
| Library PWA | 已确认 | 独立 `/library` scope、原子 shell staging、离线冷启动 |
| 增量数据更新 | 已确认 | `known_revisions` -> v3 conversation delta；未变化不传输/重写，读 v1/v2/v3 |
| 对话附件 | 已确认（生产与自动化回归） | 四种正文策略、连续附件分组、类型化 Viewer、普通上传暂存、左侧对话文件管理工作区、已有附件拖入源码、版本 occurrence、Reader/Share/Offline 与 Range |
| 附件导出 | 当前源码（不等于已部署） | conversation export 排除 detached、CanJSON metadata-only、AI 承接包、Markdown 占位、隐藏文件名、可移植 Markdown ZIP；系统 `.cr v5` 保留历史并读取旧格式；私有批量 ZIP 复核扫描/删除策略 |
| 离线 Reader/搜索 | 已确认 | 在线同一 ReaderDataSource 语义；只覆盖已下载资料 |
| 离线写入 | 已确认 | 仅批注/精选笔记和本地阅读位置；canonical 管理禁用 |

## 明确不包含

明确不包含：绕过格式/安全约束的任意归档或完整 Obsidian vault 导入、回答分支切换、团队协作、日历、语义/向量搜索、直接 HTML/PDF 导出和完整消息虚拟列表；有界打印稿不是 PDF 生成器。账号、管理员和权限边界以[身份专题](USER_ROLES_AND_PERMISSIONS.md)与[管理专题](ADMINISTRATION_CONTRACT.md)为准。DOC（提取正文）、DOCX/ODT、XLSX/ODS、PPTX/ODP 和 ZIP 具有浏览器内有界只读预览，并保留原文件下载；XLS/PPT、其他未支持压缩格式、OCR、CAD、3D、图表/工程格式和 EPUB 仍为未实现或下载降级，不应与已支持格式混写。自动化回归不等于全部格式真实设备验收，详见[附件合同](ATTACHMENT_RENDERER_CONTRACT.md)。
