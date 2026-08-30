# 功能清单

最后核验：2026-08-31

## 导入与后台任务

| 能力 | 状态 | 当前语义 |
| --- | --- | --- |
| 两种导入入口 | 已确认 | Adaptive JSON/Markdown 与独立 `.cr` 归档；`.crbundle` 产品入口已删除 |
| Adaptive Import | 已确认 | 单 JSON、单 Markdown、配对和批量；Session/Group/Family、Built-in/Learned Profile、Revision、drift、Mapping 与直接导入 |
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
| 归档/硬删除 | 已确认 | 归档可取消并保留归属；删除二次确认后立即物理执行，无 Trash/restore |
| Linear 式批量选择 | 已确认 | hover checkbox、Shift 范围、X、Cmd/Ctrl+A、Esc、移动长按 |
| 批量操作 | 已确认 | 顶部入口在选择模式中保持原宽并切换为“完成批量操作”；移动、归档/恢复、导出、合并和删除直接位于上下文工具栏，合并标题与顺序由独立 focused dialog 持有 |
| 拆分与合并 | 已确认 | 消息原位版本化；会话变换非破坏式创建新会话 |
| 最近记录 | 已确认 | 路由/API 保留；仅移动端显示入口/继续阅读卡片 |

## 设置与账户

| 能力 | 状态 | 当前语义 |
| --- | --- | --- |
| Settings hub | 已确认 | 全局入口在侧栏底部向上展开为非模态 region；外观/阅读保留轻量偏好，数据归档、导入格式、账户安全和 Skill 管理进入 focused dialog |
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
| Markdown | 已确认 | GFM、Shiki、KaTeX、Mermaid、callout、表格、引用；在线 Owner 的任务列表可立即切换，Share/Offline/附件预览只读 |
| 阅读偏好 | 已确认 | 宽度、Markdown 间距、15-22px 字号、主题、语言、默认专注 |
| 专注模式 | 已确认 | 临时隐藏侧栏、TOC、提示和工具，退出恢复锚点/面板 |

## 搜索、编辑与版本

| 能力 | 状态 | 当前语义 |
| --- | --- | --- |
| 全局搜索 | 已确认 | conversation/message/heading/code/annotation；全文 + trigram substring |
| 当前对话搜索 | 已确认 | 类型/角色筛选、计数、高亮、键盘导航和统一目标事务 |
| 消息编辑/恢复 | 已确认 | 每次创建不可变 MessageVersion，重建派生 read models |
| 重复结果折叠 | 已确认 | 相同 content hash 返回 occurrence count |

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
| 附件导出 | 已确认（自动化；生产基线保持） | conversation export 排除 detached、CanJSON metadata-only、AI 承接包、Markdown 占位、隐藏文件名、可移植 Markdown ZIP；系统 `.cr v4` 保留历史 |
| 离线 Reader/搜索 | 已确认 | 在线同一 ReaderDataSource 语义；只覆盖已下载资料 |
| 离线写入 | 已确认 | 仅批注/精选笔记和本地阅读位置；canonical 管理禁用 |

## 明确不包含

注册/登录、多用户 ACL、在线消息生成、模型选择、未经 Adapter 标准化的 OpenAI 官方图/ZIP 导入、回答分支切换、团队协作、标签、日历、语义/向量搜索、HTML/PDF 导出、完整消息虚拟列表和应用内管理后台均不适用或未实现。Office/OCR/CAD/复杂压缩包预览为 `NOT_IMPLEMENTED`，只提供下载降级。
