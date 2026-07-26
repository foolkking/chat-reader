# 功能清单

最后核验日期：2026-07-26

状态使用 [README.md](README.md) 的统一词汇。“线上未验证”表示未对生产数据执行会改变状态的操作，不表示代码不可用。

## 对话导入与后台任务

| 功能 | 模块 | 入口/路由 | 状态 | 条件与核心操作 | 数据来源 | 前端 | 后端 | 线上验证/证据 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 导入文件选择 | 导入 | 首页“导入数据” | 已确认 | 选 `.cr/.json/.md/.markdown/.txt/.csv`，可多选 | 本地文件 | `components/import-dialog.tsx`, `features/import/*` | `routes/imports.py` | 打开入口，`PAGE-002` | 本次未上传生产数据 |
| 来源检测与预览 | 导入 | 导入对话框 | 已确认（代码/测试） | 上传后检测 profile、显示会话和 warnings | source artifact | `features/import` | `services/import_pipeline/*` | 线上未提交；44 个测试文件含导入覆盖 | 未知 JSON 可被标记 unknown |
| 显式提交导入 | 导入 | 预览后提交 | 已确认（代码） | 预览不落 canonical；commit 后排队或 inline | PostgreSQL + 文件 | Next commit handler | `POST /api/imports/{id}/commit`, worker | 线上未执行写操作 | 文件上限由配置控制，默认 50MB |
| 后台任务监控/重试 | 任务 | 侧栏任务状态 | 已确认（代码） | 查看 active/status、重试失败任务 | `background_jobs` | `components/task-monitor.tsx` | `/api/tasks/*`, `background_task_worker.py` | 生产 worker 运行 | 单独 worker 轮询 durable queue |

## 对话与 Project 管理

| 功能 | 模块 | 入口/路由 | 状态 | 条件与核心操作 | 数据来源 | 前端 | 后端 | 线上验证/证据 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 全量对话流 | 对话 | `/` 对话标签 | 已确认 | 显示 Project 内和未分类活跃对话；排序、打开 | conversations/projects/reading | `project-sidebar.tsx`, conversation list | `GET /api/conversations?scope=all` | `PAGE-001/012` | 列表摘要可用 description 或首条用户消息 |
| Project 树与详情 | Project | 侧栏 Project 标签、`/projects/[id]` | 已确认 | 展开树、查看对话 | projects/project_conversations | `project-sidebar.tsx`, `project-conversation-list.tsx` | `/api/projects*` | `PAGE-004` | 当前无账号级所有权 |
| 创建/重命名/归档 Project | Project | 侧栏 Project 菜单 | 已确认（代码） | 创建、改名、归档/恢复 | PostgreSQL | 同上 | POST/PATCH project APIs | 入口存在，未改生产数据 | 归档 Project 可在归档页恢复 |
| 拖动排序和移动 | Project | Project 树/列表 | 已确认（代码） | 拖动对话到 Project、调整顺序 | project_conversations/order | dnd-kit components | project order/move APIs | 未写生产数据 | 离线禁用 |
| 置顶 | 对话/Project | 侧栏行菜单 | 已确认（代码） | 全局或 Project 内置顶 | pin fields/join row | sidebar/list menus | pin APIs | 未写生产数据 | 有独立全局与 Project pin 数据 |
| Description | 对话 | 侧栏行菜单 | 已确认（代码） | 最多 500 字 Markdown 子集 | `conversations.description_markdown` | description editor/render | PATCH conversation | 未写生产数据 | 仅强调、删除线、行内代码、安全链接 |
| 归档/恢复/软删除 | 对话 | 选择模式、`/archived` | 已确认 | 批量归档、恢复、删除 | conversation status | list + archived list | conversation PATCH/DELETE | 页面/选择工具已验证，`PAGE-005`, `STATE-001` | 删除为服务定义的管理操作；未在生产执行 |
| 全选/反选/清空 | 对话/Project | 主列表、Project、归档选择模式 | 已确认 | 对当前列表选择集合管理 | 前端状态 | `components/selection-toolbar.tsx` | 后续动作调用对应 API | `STATE-001` | 仅进入选择模式后显示批量动作 |
| 对话合并/拆分 | 编辑 | 选择工具/Reader 操作 | 已确认（代码/测试） | 有序合并多个对话；按消息拆分 | canonical tables | list/reader editing UI | conversation merge/split APIs | 线上未执行 | canonical 管理，离线/Share 禁止 |

## 阅读、渲染与导航

| 功能 | 模块 | 入口/路由 | 状态 | 条件与核心操作 | 数据来源 | 前端 | 后端 | 线上验证/证据 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 长对话窗口阅读 | Reader | `/conversations/[id]`, `/library` | 已确认 | 目标附近窗口、边缘加载、heavy blocks 懒加载 | message window/blocks | `conversation-reader.tsx`, `message-item.tsx` | message-window/messages/blocks | 在线和离线均加载内容，`PAGE-007/011/014/016` | 当前窗口大小是实现细节，不是数据上限 |
| Markdown/GFM | 渲染 | 消息正文 | 已确认（代码） | 标题、列表、引用、链接、表格、换行 | message version/block | `markdown-text.tsx` | render blocks | 生产当前样本有 Markdown/代码；格式支持由代码确认 | HTML 经 sanitize |
| 代码高亮/复制 | 渲染 | 代码块 | 已确认 | Shiki light/dark、懒加载语言、复制、wrap | code block | `code-block.tsx`, highlighter loader | render blocks | 当前样本存在代码块 | 高亮失败回退普通代码，不阻断阅读 |
| 数学公式 | 渲染 | Markdown | 已确认（代码） | remark-math + KaTeX | Markdown | markdown pipeline | 无专用 API | 当前生产样本未出现 | 线上视觉待有公式数据核验 |
| Mermaid | 渲染 | Mermaid code | 已确认（代码） | 动态渲染，失败显示 source/error | code block | `mermaid-block.tsx` | 无专用 API | 当前样本未出现 | 线上视觉待验证 |
| 图片/附件呈现 | 渲染 | 导入消息内容 | 部分确认 | 渲染已有 image/attachment parts 与链接 | 导入 canonical 内容 | message part renderer | import/canonical APIs | 当前样本未出现 | 未发现面向用户的图片/附件上传功能；音视频专用播放器未发现 |
| 对话 TOC | 导航 | Reader“阅读导航” | 已确认 | U/A 序号、全量/分页、跳号、active row | dialogue-index | `toc/conversation-index.tsx` | dialogue-index APIs | 桌面/移动验证，`PAGE-015` | 移动端在 Bottom Sheet |
| 章节 TOC | 导航 | Reader 右侧/导航 Sheet | 已确认 | 当前消息 headings、active marker、visible/rail | headings | `toc/conversation-toc.tsx` | toc APIs | `PAGE-007/011/015` | 无 heading 时为空；加载中保留上一份可用数据 |
| 精确目标导航 | 导航 | TOC、搜索、批注、URL query | 已确认（代码），线上部分确认 | 取消旧 token，加载目标 window/block，quote/offset 校准，block/message 回退 | ReaderDataSource | `conversation-reader.tsx`, `reader-navigation.ts` | dialogue-index/window/blocks/toc | TOC 已操作；远距离批注未制造专用生产数据 | stale 锚点会降级并提示 |
| 阅读位置/最近打开 | 阅读状态 | Reader 自动 | 已确认（代码/API） | 保存 message/block/offset；刷新恢复；记录 recent | reading_positions/recent_items/Dexie | reading hooks/reader | reading/recent APIs | API/页面代码确认；本次未改位置做对照 | 离线本地较新位置优先，不进入批注 outbox |
| 键盘阅读 | Reader | Reader 聚焦 | 已确认（代码） | 方向键、J/K、PageUp/Down、Space、Home/End | DOM scroll | `conversation-reader.tsx` | 无 | 线上未逐键验证 | 输入控件聚焦时有保护 |
| Reader 标题 | 浏览器 | 打开对话 | 已确认 | 有 Project：`项目 / 对话`；否则对话名 | conversation metadata | route metadata + client title | conversation GET | 生产标签格式已验证 | 失败回退 `chat-reader` |

## 搜索、编辑与版本

| 功能 | 模块 | 入口/路由 | 状态 | 条件与核心操作 | 数据来源 | 前端 | 后端 | 线上验证/证据 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 全局搜索 | 搜索 | 侧栏、`/search` | 已确认 | q、类型、role、Project、status、日期、分页 | search_documents | `features/search/search-page.tsx` | `GET /api/search` | 合成空查询验证，`PAGE-006` | PostgreSQL tsvector/trigram + fallback |
| 当前对话搜索 | Reader | 顶栏 actions | 已确认（代码） | 限定 conversation，结果进入统一导航 | server/offline index | conversation search panel | search API / FlexSearch | 面板入口已验证 | 离线只检索已下载文档 |
| 离线本地搜索 | 离线 | `/library` | 已确认（代码/PWA 测试） | Web Worker FlexSearch 搜标题、正文、章节、代码、description、批注、笔记 | IndexedDB searchDocuments | `offline-search-worker.ts` | 无远程请求 | 生产入口存在，未切断网络测试 | 取决于离线包内容 |
| 消息编辑 | canonical | 消息菜单 | 已确认（代码/测试） | 修改正文生成新 version | messages/message_versions | `features/editing/*` | PATCH message | 未改生产数据 | 离线和 Share 禁止 |
| 版本查看/恢复 | canonical | 消息版本 UI | 已确认（代码/测试） | 查看 versions，恢复指定版本为当前 | message_versions | editing UI | versions APIs | 未改生产数据 | 历史版本不进入紧凑离线包 |
| 自动清理 | canonical | Reader 管理动作 | 已确认（代码） | 对话级 auto-clean | messages/versions | reader action | POST auto-clean | 未执行 | 具体清理规则见 editing service |

## 批注与精选笔记

| 功能 | 模块 | 入口/路由 | 状态 | 条件与核心操作 | 数据来源 | 前端 | 后端 | 线上验证/证据 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 文本批注 | 批注 | 桌面正文选择 | 已确认（代码） | highlight/underline/strikethrough/comment，黄绿蓝粉 | annotations | selection toolbar/CSS Highlight API | annotation CRUD | 创建未写生产；工作区已验证 | 移动端不创建/编辑 |
| 消息书签 | 批注 | 消息菜单 | 已确认（代码） | 整条消息 bookmark | annotations | message action/event | annotation CRUD | 入口代码确认 | 不要求文本 range |
| 锚点重定位 | 批注 | 点击“定位” | 已确认（代码/测试），线上待专项验证 | version/block/offset/quote/prefix/suffix；active/relocated/stale | annotations + target context | reader navigation | annotation relocation services | 普通 TOC 导航验证；远距离专用数据待验证 | stale 回退到 block/message |
| 单项管理 | 批注工作区/正文上下文 | Reader 批注 | 已确认 | 改类型/颜色/评论、加入笔记、删除、定位 | annotations/notebook | shared annotation actions | PATCH/DELETE annotation | 面板已验证，`PAGE-008` | 删除为软删除/同步语义 |
| 批量管理 | 批注工作区 | 管理模式 | 已确认 | 筛选、全选、反选、清空、批量样式、加入笔记、删除 | annotations/notebook | `annotation-workspace.tsx` | annotation CRUD/sync | `STATE-002` | 移动端只读 |
| 精选笔记 | 批注 | 工作区“精选笔记” | 已确认（代码） | Markdown 段落 + annotation reference，拖动排序 | conversation_notebooks | notebook editor + dnd-kit | GET/PUT notebook | 页面入口验证，未改生产 | 私有内容默认不分享/导出 |
| 离线同步/冲突副本 | 离线批注 | 自动 | 已确认（代码/测试） | UUID、base revision、outbox、idempotency receipt；冲突保留副本 | Dexie + DB | offline repository/sync manager | POST annotations/sync | 未制造生产冲突 | 仅批注/笔记允许离线写 |

## 分享、导出与离线资料库

| 功能 | 模块 | 入口/路由 | 状态 | 条件与核心操作 | 数据来源 | 前端 | 后端 | 线上验证/证据 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 创建/管理 Share | 分享 | Reader Share 面板 | 已确认 | full/selected scope、有效期、主题/语言、复制、延期、重生、撤销 | shares | `features/sharing/*` | shares APIs | 面板和已有记录结构已验证，`PAGE-009` | description/annotations/notebook 默认关闭 |
| 公开只读 Reader | 分享 | `/share/[token]` | 已确认（代码），线上未完整验证 | token 限制内容、TOC、局部阅读位置；可选导出 | shared APIs | `share-readonly-reader.tsx` | `/api/shared/{token}/*` | 未使用真实 token | 无 canonical 写操作 |
| 导出 Markdown/JSON | 导出 | Reader/选择模式 | 已确认（代码/测试） | selected/full，metadata/toc/versions/private flags | canonical data | export panel | GET export / POST export | 面板代码确认，未下载生产内容 | 私有三项默认关闭 |
| `.cr` 归档 | 导出/导入 | Export/Import | 已确认（代码/测试） | v2 可选 entries，兼容读 v1；后台 artifact | ZIP artifact | export/import UI | archive job/download/import | 未对生产文件操作 | 原始服务器路径/token 不入包 |
| 离线 catalog/下载 | 离线 | `/library`、Reader“离线资料库” | 已确认 | conversation/project/all，估算、进度、更新、删除本地副本 | catalog/package artifacts | `library-shell.tsx` | `/api/offline/*` | `PAGE-010` | 删除本地副本不删服务器数据 |
| PWA 冷启动壳 | 离线 | `/library` | 已确认（代码） | staging 原子预缓存、状态/重试、active revision | Cache API | SW registration/offline shell | 无 API | manifest/SW 线上 200；未断网冷启 | 首次必须成功联网准备一次 |
| 在线/离线互跳 | Reader | 两端顶栏 | 已确认 | 传 conversation/message/block/offset | URL + ReaderDataSource | online/offline reader | catalog/reader APIs | 两端入口已验证 | 离线打开在线版需网络 |
| 本地空间与持久化 | 离线 | `/library` | 已确认 | StorageManager persist/estimate、占用、警告、重试 | browser storage | library shell | 无 | 页面结构验证 | 受浏览器配额和清站点数据影响 |

## 当前边界中不适用或未发现

| 能力 | 状态 | 证据范围 |
| --- | --- | --- |
| 注册、登录、退出、用户资料、账号设置 | 不适用（当前构建） | 前端路由/菜单、API、模型、middleware 全局搜索 |
| 普通/会员/管理员角色、套餐、余额、支付 | 不适用（当前构建） | 同上；无 billing/member/admin 依赖或表 |
| 在线发送消息、停止生成、重新生成、模型选择、Prompt/角色 | 不适用 | README 明确不是在线机器人；无输入/生成 API、SSE/WebSocket/模型 client |
| 面向用户的图片/附件上传 | 待验证后续规划；当前未发现入口 | 导入文件选择不是消息附件上传；代码可渲染导入内容中的图片/附件 |
| 音频/视频播放器 | 待验证 | 当前 renderer 搜索未发现专用实现 |
| 系统级管理后台、用户管理、审计日志 UI | 不适用（当前构建） | 页面/API/model 搜索未发现 |
| `/recent` 直接菜单入口 | 部分实现/隐藏 | 页面和 API 存在，当前 `ProjectSidebar` 未发现链接 |

