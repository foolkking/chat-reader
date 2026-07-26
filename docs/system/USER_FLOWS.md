# 当前用户流程

最后核验日期：2026-07-26

以下只描述当前实现。生产核验没有执行导入、编辑、删除、同步等写操作；这些步骤由代码、API 和测试交叉确认。

## 流程 1：首次进入在线系统

**流程名称：** 进入在线资料管理页
**触发条件：** 浏览器可访问生产域名。
**用户目标：** 查看已有资料或开始导入。
**起始页面：** `/`。
**操作步骤：** 打开域名；系统请求 preferences、projects、`scope=all` conversations 和 active tasks；显示“对话/项目”侧栏及列表。
**系统反馈：** 查询期间显示加载状态；有数据时显示列表，无数据时显示相应空状态。
**涉及页面/组件：** `AppShell`, `ProjectSidebar`, conversation list。
**涉及接口：** `GET /api/preferences`, `/api/projects`, `/api/conversations`, `/api/tasks/active`。
**成功状态：** 可打开对话、Project、搜索、归档、导入或设置。
**失败状态/异常处理：** 单项请求显示错误/重试；直接 `/offline` 显示网络重试页。
**权限要求：** 无登录；固定主体 `local:default`。
**已确认限制：** 没有注册/登录步骤。
**证据：** `PAGE-001/012/013`、对应组件和 API。

## 流程 2：导入对话

**流程名称：** 文件预览并导入 canonical 数据
**触发条件：** 在线；持有支持的文件。
**用户目标：** 把外部导出资料加入 Chat Reader。
**起始页面：** `/`。
**操作步骤：** 打开“导入数据” -> 选择一个或多个文件 -> 上传预览 -> 查看检测 profile、warnings 和会话摘要 -> 显式提交。
**系统反馈：** 预览先保存 source artifact；commit 创建 import/background job；任务监控显示状态。
**涉及页面/组件：** `ImportDialog`, `features/import/*`, `TaskMonitor`。
**涉及接口：** `POST /api/imports/preview`, `POST /api/imports/{id}/commit`, status/warnings/source-artifacts, task APIs。
**成功状态：** canonical conversation/messages/versions/blocks/headings/search documents 原子写入并可打开。
**失败状态/异常处理：** 文件大小、格式、解析、commit 或 worker 错误进入 warning/failed 状态，可查询或重试任务。
**权限要求：** 在线管理面。
**已确认限制：** 默认上限 50MB（可配置）；本次未上传生产文件。
**证据：** `PAGE-002`, `routes/imports.py`, `services/import_pipeline/*`。

## 流程 3：组织与批量管理对话

**流程名称：** Project 归类和选择管理
**触发条件：** 已有会话。
**用户目标：** 排序、移动、归档、删除、导出或合并资料。
**起始页面：** `/`、`/projects/[id]` 或 `/archived`。
**操作步骤：** 在对话/Project 视图筛选上下文 -> 开启选择模式 -> 全选/反选/清空 -> 执行移动、移出、归档/恢复、删除、导出；至少两条时可有序合并。单项操作从侧栏行菜单进入。
**系统反馈：** 工具条显示选中数量；mutation 后刷新列表 query。
**涉及页面/组件：** list components, `SelectionToolbar`, `ProjectSidebar`。
**涉及接口：** conversation/project order、move、pin、merge、PATCH/DELETE APIs。
**成功状态：** 对话状态或 Project 关系更新。
**失败状态/异常处理：** interaction dialog 显示请求错误；列表保持可重试。
**权限要求：** 在线 canonical 管理。
**已确认限制：** 离线和 Share 不允许。
**证据：** `PAGE-004/005`, `STATE-001`, 相关路由代码。

## 流程 4：阅读长对话并恢复位置

**流程名称：** 窗口化长对话阅读
**触发条件：** 打开有效 conversation。
**用户目标：** 连续阅读并在下次返回原位置。
**起始页面：** `/conversations/[id]` 或 `/library?conversationId=...`。
**操作步骤：** Reader 加载初始/目标消息窗口 -> 需要时懒加载 heavy blocks -> 边缘滚动加载相邻窗口 -> active observer 更新 U/A 与章节 -> debounce 保存 message/block/offset。
**系统反馈：** 顶栏进度、正文、对话 TOC、章节 TOC 同步；刷新按 URL 目标或保存位置恢复。
**涉及页面/组件：** `ConversationReader`, `MessageItem`, `ConversationIndex`, `ConversationToc`。
**涉及接口：** conversation detail, message-window, blocks, dialogue-index, toc, reading-position, recent。
**成功状态：** 当前 block 位于阅读区域，位置被保存。
**失败状态/异常处理：** 数据失败显示不可用/重试；无效 ID 见 `STATE-005`。
**权限要求：** 在线无登录；离线需已下载。
**已确认限制：** 离线位置只存本浏览器。
**证据：** `PAGE-007/011/014/016`, Reader 源码。

## 流程 5：搜索并定位正文

**流程名称：** 全局或当前对话搜索
**触发条件：** 输入查询；离线需本地索引。
**用户目标：** 找到标题、正文、章节、代码或用户元数据中的内容。
**起始页面：** `/search`、Reader search 面板或 `/library`。
**操作步骤：** 输入 q/筛选 -> 获取结果 -> 点击结果 -> 带 conversation/message/block/offset 进入统一导航。
**系统反馈：** 结果摘要、类型和上下文；无结果显示空状态。
**涉及页面/组件：** search page/panel, offline search worker, Reader navigation。
**涉及接口：** `GET /api/search`；离线无远程 API。
**成功状态：** 目标窗口加载并定位到 block/offset。
**失败状态/异常处理：** 搜索错误可重试；定位可回退 block/message。
**权限要求：** 无登录；只检索可见数据。
**已确认限制：** 离线范围是已下载 searchDocuments。
**证据：** `PAGE-006`, search/Reader 源码。

## 流程 6：编辑消息和恢复版本

**流程名称：** canonical 正文版本管理
**触发条件：** 在线 Reader 中打开消息管理。
**用户目标：** 修订正文或恢复历史版本。
**起始页面：** `/conversations/[id]`。
**操作步骤：** 消息菜单选择编辑 -> 提交 Markdown -> 新建不可变 MessageVersion 并更新 current version；或查看 versions 并恢复指定版本。
**系统反馈：** Reader query 更新，blocks/headings/search 重建；相关 annotation 尝试重定位。
**涉及页面/组件：** `features/editing/*`, message menu。
**涉及接口：** PATCH message, GET versions, POST restore。
**成功状态：** 新 current version 可读，历史保留。
**失败状态/异常处理：** 服务校验错误显示在交互对话框；原版本不被覆盖。
**权限要求：** 在线管理；离线/Share 禁止。
**已确认限制：** 本次未修改生产正文。
**证据：** editing service/routes/tests。

## 流程 7：创建和管理批注/精选笔记

**流程名称：** 桌面批注管理
**触发条件：** 桌面 Reader 中选择正文或使用消息菜单。
**用户目标：** 标记文字、评论、书签并汇总笔记。
**起始页面：** 在线或离线 Reader。
**操作步骤：** 选文本 -> 选类型与颜色（comment 同时编辑评论），或书签消息 -> 打开工作区筛选/定位/编辑 -> 管理模式全选/反选/批量样式/加入笔记/删除 -> 笔记中排序 reference。
**系统反馈：** CSS Highlight/消息边缘标记；导航显示 loading/stale/failed；离线写入 outbox。
**涉及页面/组件：** `AnnotationWorkspace`, selection/context actions, notebook editor。
**涉及接口：** annotation CRUD/sync, notebook GET/PUT/conflicts。
**成功状态：** revision 更新；离线恢复网络后同步。
**失败状态/异常处理：** revision 冲突保留“冲突副本”；stale 回退 block/message。
**权限要求：** 移动端只能查看、搜索、跳转。
**已确认限制：** 本次只验证管理 UI，未更改生产批注。
**证据：** `PAGE-008`, `STATE-002`, annotation service/repository。

## 流程 8：分享或导出

**流程名称：** 受限分享与文件导出
**触发条件：** 在线 Reader。
**用户目标：** 只读分享或备份资料。
**起始页面：** `/conversations/[id]`。
**操作步骤：** Share 选择 full/selected、有效期、主题/语言、include flags、allow export -> 创建/复制/延期/重生/撤销；Export 选择 `.cr`/Markdown/Canonical JSON 和范围/options -> 直接或后台生成下载。
**系统反馈：** Share 列表显示状态；archive job 显示进度；下载 artifact。
**涉及页面/组件：** share/export panels, public reader。
**涉及接口：** shares/shared/export/artifact APIs。
**成功状态：** token URL 或文件产生。
**失败状态/异常处理：** 过期/撤销 token 不可读；job 可查状态。
**权限要求：** 创建端在线；访客只持 token。
**已确认限制：** description/annotations/notebook 默认不包含；本次未复制 token 或下载生产内容。
**证据：** `PAGE-009`, share/export code/tests。

## 流程 9：下载并离线冷启动

**流程名称：** 准备 PWA 壳与离线资料
**触发条件：** 至少一次在线打开 `/library`。
**用户目标：** 断网后仍能启动和阅读。
**起始页面：** `/library` 或在线 Reader“离线资料库”。
**操作步骤：** hydration 收集实际静态资产 -> `PREPARE_LIBRARY_SHELL` 写 staging cache 并校验 -> 原子切 active revision -> 请求持久化/检查配额 -> 选择 conversation/project/all -> 后台生成包 -> 下载并事务导入 Dexie。
**系统反馈：** 壳状态、进度、估算、占用、最后更新、错误/重试。
**涉及页面/组件：** `LibraryShell`, service worker registration, offline DB/repository。
**涉及接口：** offline catalog/packages/download。
**成功状态：** 断网 `/library?...` 从 active shell 启动并读取 IndexedDB。
**失败状态/异常处理：** staging/配额/导入失败保留旧 active shell 和旧数据；没有完整壳时返回 503 文本。
**权限要求：** 浏览器支持 SW/Cache/IndexedDB；首次在线。
**已确认限制：** 本次验证线上入口与本地副本，未切断网络冷启。
**证据：** `PAGE-010/011/016`, `public/library-sw.js`, `e2e/library-offline.spec.ts`。

## 流程 10：移动端导航与错误恢复

**流程名称：** 窄屏阅读导航
**触发条件：** 390x844 视口打开首页或 Reader。
**用户目标：** 使用侧栏、TOC 和 actions，不依赖桌面 rail。
**起始页面：** `/`、online/offline Reader。
**操作步骤：** 打开侧栏 Bottom Sheet -> 选对话 -> 展开右上 actions -> 打开阅读导航 -> 切换对话/章节 TOC -> 点击目标后返回正文。错误时使用重试或返回列表。
**系统反馈：** 移动端无 desktop separator/rail；actions trigger/X 固定；成功定位后 sheet 关闭。
**涉及页面/组件：** mobile sheets, header action rail, Reader TOC。
**涉及接口：** 与桌面 Reader 相同。
**成功状态：** 正文无横向溢出，导航状态保持。
**失败状态/异常处理：** 定位失败保留面板并允许重试；网络页提供重试。
**权限要求：** 无账号；批注移动端只读。
**已确认限制：** 当前生产往返切换 TOC 未复现“暂无 TOC”。
**证据：** `PAGE-012` 至 `PAGE-016`, `STATE-003/004`。

## 不适用流程

注册/登录/退出、创建空白聊天、发送消息、停止或重新生成、上传聊天附件、购买会员和管理员审核在当前系统中不适用；事实依据见 `FEATURE_INVENTORY.md` 与 `USER_ROLES_AND_PERMISSIONS.md`。

