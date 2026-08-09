# 前端架构

## Source workspace performance boundary (2026-08-04)

- `ConversationReader` owns only the active source message and dirty/cross-message state. Same-message cursor follow is dispatched imperatively once per animation frame with an offset threshold; wheel input no longer increments a React state counter.
- `FloatingWorkspacePanel` has a source-specific `left-overlay` placement. Its first desktop frame already has `clamp(560px, 32vw, 720px)` width; pointer movement mutates panel width directly, while React state and localStorage update on pointer-up. The Reader captures its unshifted left edge once per editor session and uses that stable baseline for width changes.
- `EditMessageForm` passes `theme="none"` to `@uiw/react-codemirror`. A CodeMirror `Compartment` reconfigures the complete theme extension so document, selection, undo history, and unsaved source survive runtime theme changes.

最后核验：2026-08-05

## 技术与目录

| 类别 | 实现 |
| --- | --- |
| 框架 | Next.js 14.2.23 App Router、React 18.3.1、TypeScript |
| 服务端状态 | TanStack Query |
| 长消息虚拟化 | TanStack Virtual（动态测量 RenderBlock） |
| 本地状态 | React context/state；局部 Zustand |
| 样式 | Tailwind CSS 3 + `app/globals.css` CSS variables |
| 交互 | Lucide、Vaul、dnd-kit |
| Markdown | react-markdown、remark/rehype、Shiki、KaTeX、Mermaid |
| 离线 | Dexie、FlexSearch、fflate、Service Worker/Cache API |
| 测试 | ESLint、TypeScript、Playwright 1.62.0 |

```text
apps/web/
├── app/          route segments、root providers、loading、globals.css
├── components/   全局壳、可调框架、drawer/sheet/dialog、preferences
├── features/     annotations/conversations/editing/exporting/import/
│                 offline/projects/reading/search/sharing/toc
├── lib/          API、types、ReaderDataSource、Dexie、offline repository
├── public/       manifest、Service Workers、icons
└── e2e/          reader-layout、reader-restoration、library-offline
```

页面列表见 [PAGE_AND_ROUTE_MAP.md](PAGE_AND_ROUTE_MAP.md)。根 layout 提供 Query、Preferences、InteractionDialog、ImportDialog、Shortcut、OfflineSync 和 ServiceWorkerRegistration。

## 数据与状态边界

- API client 始终使用相对 `/api/*`；`next.config.mjs` 通过 `API_INTERNAL_URL` rewrite。
- TanStack Query 管理在线列表、详情、TOC、位置和 mutation invalidation。
- `ReaderDataSource` 统一 remote/offline 合同；`capabilities` 控制编辑、Share、Export 等入口。
- PreferencesProvider 先从 localStorage cache 启动，再与 `/api/preferences` 同步跨浏览器偏好。
- Reader target 包含 source identity/revision、conversation/message/block/offset/quote，防止在线、离线和旧 revision 混用。
- 选择控制器统一 Project、未归类和归档列表的桌面/移动批量状态。

## 主要组件关系

```text
RootLayout + providers
├── AppShell
│   ├── ProjectSidebar
│   └── routed list content
├── ConversationReader
│   ├── ReaderSidebarFrame
│   ├── complete-turn window -> MessageItem -> Markdown renderers
│   ├── ConversationIndex + ConversationToc
│   ├── ReaderUtilityDrawer(search/share/export)
│   ├── ConversationFilesPanel -> upload sessions / attachment picker
│   ├── SourceEditorWorkspace -> FloatingWorkspacePanel -> CodeMirror
│   └── AnnotationWorkspace(floating/docked/expanded)
└── LibraryShell -> OfflineReaderDataSource -> ConversationReader
```

## Reader 与渲染

- 在线/Share 读取 `reader-turn`；Offline 从 Dexie 组装同一 response。完整轮次水合后才加入 DOM。
- 初始/位置恢复窗口最多 5 轮，用真实相邻正文为短消息目标提供阅读线对齐空间；边缘滑动 settled 后通常裁剪为 3 轮。用户进入首/末已加载轮次或接近 sentinel 时预取，返回轮次先按 `turn_key` 合并，锚点恢复后再按整轮裁剪。边缘事务持有阅读 block lease，继续同方向滚动不会取消事务，反向滚动才取消。
- 上下边缘都保留已加载正文直到新轮次挂载完成；加载中不伪造大块空白，只有 `has_more=false` 的真实会话末尾保留底部阅读留白。
- 普通消息完整挂载；仅 `block_count > 160` 或 `char_count > 50000` 的单条消息使用动态块虚拟化，overscan 为目标上下各 8 blocks，正文数据仍全部水合。
- 虚拟导航会先固定目标 block 到 range extractor，再挂载、测量和校正到 120px 阅读线；事务 settled/failed/cancelled 后才释放固定，避免测量过程中目标卸载。
- 单一 RAF sampler 根据 120px 阅读线决定活动位置；程序 scroll 不建立用户意图。
- ReadingPosition 写入 block-relative-v2，恢复按 block id、block/message index、order key、scroll ratio 逐级降级；导航或测量未稳定时不保存。
- Markdown 禁止 raw HTML 执行；链接协议受控。Shiki/Mermaid 失败回退为可读文本，代码/表格/图表在自身容器滚动。
- `reader_density_mode` 作用于 Markdown block 的垂直节奏；`reader_font_size_px` 通过相对字号保持 heading/code/table 层级。

## 响应式与工具面板

- 桌面侧栏、章节 TOC 和 utility drawer 可调宽并 clamp；批注浮窗可拖动/缩放/重置。源码工作区固定覆盖桌面左侧且占满视口高度，只允许拖动右边缘调整宽度；正文以打开前的稳定左边界向右让位，关闭后恢复原布局。移动端固定为顶栏下方全宽面板。
- 搜索、Share、Export 共用 `ReaderUtilityDrawer` 的宽度、Esc、焦点恢复和视口纠偏。
- 源码、搜索、批注等工作区互斥显示但保留已挂载状态。源码编辑不替换 `MessageItem` 正文；Reader 只在最近真实滚动输入且没有导航/恢复/边缘事务时，将活动 block 单向映射到源码。脏状态跨消息锁定，保存通过局部消息替换和 DOM 锚点补偿完成。
- 专注模式隐藏主侧栏、对话索引、章节 TOC、离线提示和普通工具；退出恢复原锚点/面板状态。
- 移动端使用 Vaul/自定义 Sheet；无 desktop separator/rail。首页保留继续阅读，桌面隐藏。

## 浏览器持久化

| Key/存储 | 用途 |
| --- | --- |
| `chat-reader:user-preferences` | 服务器偏好的启动缓存 |
| `chat-reader:reader-default-focus` | 默认专注；旧 focus key 仅迁移一次 |
| `chat-reader:reader-sidebar-expanded`、`sidebar-width` | 侧栏状态/宽度 |
| `chat-reader:section-toc-width`、`reader-navigation-width` | 导航 pane 宽度 |
| `chat-reader:reader-utility-panel-width` | 搜索/Share/Export drawer 宽度 |
| `chat-reader:annotation-workspace-mode/panel` | 批注形态、位置和尺寸 |
| `chat-reader:source-editor-panel` | 源码工作区持久化宽度 |
| `chat-reader:last-library-conversation` | 最近离线对话 |
| `chat-reader:share-position:<hash>` | Share 访客本地位置 |
| Dexie | 离线 conversation/messages/blocks/search/annotations/positions/outbox |
| Cache API | Library active/staging shell revisions |

`chat-reader:*` 中部分值是窗口间事件名，不一定是持久化 key。代码未发现认证 Cookie 管理。

## PWA

- manifest `scope/start_url` 都是 `/library`；`library-sw.js` 不控制普通管理页面或 API。
- 壳资源先写 staging cache，完整校验后原子切换 active revision；失败保留旧壳。
- `/sw.js` 负责注销旧 root-scope worker 和清理 legacy cache。
- 离线数据更新与壳更新独立：前者是 v3 conversation delta（兼容读 v1/v2/v3），后者是 Cache API revision。Dexie v2 保存附件 metadata/occurrence，小型或全量对象按 `asset_mode` 进入 Cache Storage。

## 附件 UI

- Reader“更多”中的“当前对话文件”打开独立 `FloatingWorkspacePanel`。桌面首次居中、无遮罩、可拖动/缩放并持久化位置尺寸，可与源码编辑器同时打开；移动端使用覆盖式文件抽屉。面板按已使用、未使用、缺失分组，支持搜索、上传、预览、下载、重命名、定位、插入和移除未引用文件。
- Markdown 源码工作区提供上传与选择已有文件；新文件先独立上传并显式提升为当前对话 Attachment，已有文件通过 `application/x-chat-reader-attachment` 只传递业务 ID，在光标或消息末尾插入 `cr-asset://` 引用。用户无需手写内部协议；若光标位于已有的独立附件行内，插入点移动到该行末尾，避免破坏原引用。
- 源码工作区的 CodeMirror DOM 事件只接受真实 `DataTransfer.files`；拖放通过 `posAtCoords` 显示插入光标，粘贴读取剪贴板文件，二者和文件选择共用 `AttachmentDraftCallbacks`。临时标记拥有独立进度/错误/重试/移除状态，完成后通过命令式文档替换保持阅读位置和源码光标。
- 代码围栏落点返回明确的调整意图并显示选择条；链接内部落点自动放到链接节点后。编辑器滚动和拖放位置不反向驱动 Reader，保存前任何 unresolved upload 均阻止提交。
- `AttachmentViewerProvider` 在根 layout 中只挂载一个 `AttachmentViewerShell` portal；旧 `AttachmentPreviewDialog` 仅是无 DOM 的兼容适配器。统一 shell 负责焦点、Esc/backdrop、共享 body scroll lock、滚动恢复和文件类型内核，Files Panel、Reader、Gallery 与旧入口不再创建第二套预览 DOM。
- Registry 将数据状态、静态 capability、单次 runtime 状态和 RenderPlan 分离。正文只使用 `media`、`preview-panel`、`file-row` 三种皮肤；missing、empty、unsupported、preview-failed 和 offline-unavailable 都是 FileRow variant。SVG 始终使用 `<img>`，Markdown 使用 inert renderer，Office/ZIP/CAD/3D 保持可靠下载降级。
- 连续图片仅在同一当前 MessageVersion 内组团；普通正文立即断组。2–6 张完整展示，超过 6 张显示前 5 张与 `+N` 入口。Viewer identity 使用 `message_version_id + occurrence_key`，`block_index` 只用于顺序和 DOM 定位。完整合同见 [Attachment Renderer Contract](ATTACHMENT_RENDERER_CONTRACT.md)。
- 附件继续只使用一个 `AttachmentViewerProvider -> AttachmentViewerShell`。Shell 前增加纯 UI `ViewerPresentationResolver`：音频为 compact，Markdown/Text/Code/JSON 为 reading，PDF 为 document，图片/视频为 media，CSV 与 Gallery Overview 为 workspace；桌面按内容自适应，移动端统一 100vw × 100dvh。最大化只改变 Shell CSS 状态，第一次 Esc 退出最大化、第二次关闭，不持久化到 Attachment 或 occurrence。
- Viewer Shell 的内容区保持 `min-height: 0; overflow: hidden`，具体 Renderer 是唯一滚动所有者。PDF page/fit/zoom 工具挂载到同一 Shell 顶栏；Fit Page 单页完整居中且不产生纵向滚动，Fit Width/自定义缩放由 PDF viewport 滚动。
- Owner Reader 的 GFM task checkbox 由 `MarkdownRenderer` 的 `interactiveTasks` 合同驱动，点击后进行局部 optimistic update 并调用稳定 task key 接口；Share、Offline 和附件 Markdown renderer 不传写回调，因此保持只读。
- 对话导出面板将格式与附件作为一级选项；简介、批注、笔记和 CanJSON 来源引用位于折叠的二级选项。普通导出与附件 ZIP 使用同一组参数。
- 消息保存使用服务端返回的局部 message/version/blocks/occurrences 投影更新 TanStack Query；不重新加载整场对话，受影响消息单独重测布局，其他 MessageItem 引用保持稳定。
