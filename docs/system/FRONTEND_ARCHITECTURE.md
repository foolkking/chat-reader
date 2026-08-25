# 前端架构

## IA Round 2 shell ownership (2026-08-25, local)

`SidebarPreferences` is a lightweight Settings hub. Data/backup, learned
Import Format management and Account Security are rendered in the shared
focused dialog pattern (`SettingsFocusedDialog`) so dirty state, Escape/close
and focus restoration are owned by the focused surface rather than a transient
popover. Existing Reader and import contextual shortcuts still call the same
underlying panels.

`ProjectSidebar` exposes a stable `Tasks` launcher. `TaskCenterDialog` renders
the existing `ImportTaskMonitor` in a global surface; sidebar and mobile
representations are shortcuts to that same monitor, not separate task stores.
No worker, queue or task-history model was added.

`ImportPanel` keeps a committed import open long enough to present a truthful
terminal summary. The response's existing conversation IDs are used for
compact direct links and Library return; no ImportBatch entity or persistent
results route is introduced.

## Reader semantic Markdown copy (current)

Owner Reader, public Share and Offline Reader use one copy boundary. Complete
render blocks contribute the same Markdown source used by their renderer;
partial DOM selections are serialized semantically so emphasis, strikethrough,
links, inline/fenced code, headings, lists, quotations and tables remain useful
Markdown. Message metadata, role labels, toolbars and controls are excluded,
and cross-message bodies are separated by one blank line.

For long virtualized messages, the virtualizer temporarily pins the inclusive
block interval between the selection anchor and focus. It releases those rows
when the selection collapses or leaves the message, so semantic copy does not
disable the existing long-message virtualization contract. If a selection
cannot be represented reliably, the boundary leaves the browser's native copy
behavior untouched rather than returning truncated content.

## PWA negative-path resilience (2026-08-15)

Release E keeps the existing /library Service Worker architecture but makes
offline negative states explicit. A cached Library navigation is served only
when the active shell's critical resources are still present; missing critical
JavaScript or stylesheet resources return a standalone offline-incomplete page
with retry guidance. Optional Skill markdown files do not block Library or
Reader startup.

Offline package updates preserve the last committed conversation package.
Attachment bytes are written to immutable attachment id plus sha256 cache keys,
validated before use, and only supersede old cache entries after the Dexie
transaction commits. Cache quota errors, truncated packages, Dexie aborts,
browser/SW restarts and corrupted bytes cannot mark partial data ready.

## Offline shell and offline Reader attachments (2026-08-11)

`offline-shell.ts` separates shell availability from background update phase. A complete active service-worker shell is usable immediately; dynamic viewer warming and deterministic shell reconciliation never gate Library interaction or conversation-package downloads. The inventory contains document scripts/styles/icons, the offline search worker, declared viewer runtime chunks and the two inert Skill files. It deliberately excludes API responses, images and historical `performance` resource entries. If reconciliation fails, the previous active shell remains ready and the UI exposes a retryable background-update state.

Offline Reader uses `ReaderDataSource.capabilities.attachments = "read-only"`. The same `current conversation files` action opens the existing `reader-floating` workspace (or mobile sheet), but the panel reads only `offlineDb.attachments`, displays occurrence locations and offers cached Viewer/download actions. It cannot upload, insert, rename, detach or delete and never enumerates server attachments. Missing cached originals resolve to `offline-unavailable`; Object URLs are released after consumption. Viewer opening still follows the single `AttachmentViewerProvider -> AttachmentViewerShell` path.

Offline export is a browser-local projection of the downloaded snapshot. It does not call export APIs, workers, search, derivatives or batch ZIP. The local `.context.zip` keeps the established manifest/JSONL shape and includes only cached assets; missing assets stay explicit records. The Context Package result links the two static Skill resources and handles clipboard denial as a visible retryable state. The English and Chinese Skill files are inert text and are never parsed as Markdown by the viewer.

## Reader wheel and virtual-layout contract (2026-08-10)

The Reader keeps the existing six-message window and TanStack block virtualization. Wheel responsiveness depends on stable row estimates and a single hot path rather than disabling virtualization or weakening navigation accuracy.

- `ReaderBlockLayoutMetrics` is derived from the stable Reader content width, computed font size/line height and density. It changes only after mount, font readiness, explicit Reader layout events or real width/preference changes; ordinary wheel input cannot invalidate it.
- `estimateReaderBlockSize` estimates paragraph visual lines with explicit newlines and Unicode display width, derives heading geometry by level and line count, and derives code geometry from actual source lines plus the renderer header/padding/collapse cap. Empty content uses the real minimum rhythm. Tables, media and attachments retain bounded type-specific estimates.
- A measured virtual row remains authoritative. Measurement compensation is allowed only for rows wholly above the current reading line; first measurement of partially visible or later rows cannot rewrite the active wheel displacement.
- `ActiveReadingTarget` is resolved at the reading line with `elementsFromPoint()`. Only whitespace misses use the bounded rendered-block registry and mounted-message fallback; the scroll frame never scans every mounted block.
- Owner and Share readers use one passive listener per scroll owner. Active sampling runs at most every 80ms plus one trailing sample. Reading-position persistence is one idle write after approximately one second; the full character anchor is not calculated during dense wheel input.
- Edge loading is sentinel-IntersectionObserver driven. The listener records direction only; an already-visible sentinel can consume that intent once, but no pixel threshold issues a second request.
- The virtual total-size container is not a Reader layout observer target. Per-row measurement remains enabled, while `scrollMargin` is recalculated only for mount/window merge/prepend and explicit layout changes.
- TOC rows are memoized and receive the derived active heading. Auto-follow is scheduled in a frame and changes the TOC's own scroll only when the heading is outside its viewport. Conversation Index updates only when the active message changes.

Public APIs, persistence formats, Reader width, revision semantics and stable DOM navigation anchors are unchanged.

## Attachment inline lanes (2026-08-09)

`AssistantMessageRenderer` groups adjacent attachment RenderBlocks without crossing ordinary text. `AttachmentInlineGroup` resolves each Attachment through the shared access/query and RenderPlan registry, partitions consecutive semantic runs, and mounts one centralized lane. The six primitives are RichPreview, DataPreview, ImageGallery, AudioList, VideoPreview and FileList.

Geometry is centralized in `app/globals.css`: 45rem reading, 55rem data, full-width gallery, 38rem audio/file and 43rem video. Individual Renderer components only render group-internal rows/panels. Runtime image/media failure reports back to the group and moves the item to FileList without changing static capability. The unified adaptive Viewer remains unchanged except that the inline `+N` tile requests its existing Overview mode.

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

AI Rich Markdown 使用一个共享 semantic core：Reader、Source Editor live preview 与 Markdown 附件 inline/Viewer 均复用 `rich-markdown-config.ts`。`remarkAiMathCompatibility` 在 mdast 阶段恢复 ChatGPT `\(...\)` / `\[...\]`，`remark-math` 处理 dollar delimiters，GFM/footnote/code/link 安全策略保持一致。canonical Markdown 不改写；KaTeX 使用本地 CSS/font、MathML、`trust=false` 与有界 expansion/size。详细合同见 [AI_RICH_MARKDOWN_CONTRACT.md](AI_RICH_MARKDOWN_CONTRACT.md)。

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
- 搜索、Share、Export 共用 `ReaderUtilityDrawer` 的宽度、Esc、焦点恢复和视口纠偏。Share trigger 在 More 菜单因 React 重渲染而失联时，Drawer 通过稳定 action identity 回退到当前 More trigger，绝不把焦点落到 `body`。
- 桌面“当前对话文件”复用批注式右侧 `reader-floating` 工作区：默认位于 Reader 右上安全区域，整个 header 可拖动，边缘可缩放，位置/尺寸可复位并持久化。header 使用 `grab`/`grabbing` 光标和强调色 `Paperclip`，不再默认占据左侧整高区域。移动端仍退化为顶栏下方全宽 sheet。
- 源码、搜索、批注等工作区互斥显示但保留已挂载状态。源码编辑不替换 `MessageItem` 正文；Reader 只在最近真实滚动输入且没有导航/恢复/边缘事务时，将活动 block 单向映射到源码。Reader 的全局键盘滚动意图明确忽略 CodeMirror、表单和可编辑目标。CodeMirror 使用稳定 memoized setup/update callback，并将外部基线文档与逐键 draft state 分离，避免输入或删除一个字符时重配置、回放旧 value 或切换活动消息。脏状态跨消息锁定，保存通过局部消息替换和 DOM 锚点补偿完成。
- 专注模式隐藏主侧栏、对话索引、章节 TOC、离线提示和普通工具；退出恢复原锚点/面板状态。
- 移动端使用 Vaul/自定义 Sheet；无 desktop separator/rail。首页保留继续阅读，桌面隐藏。

## 浏览器持久化

### Formula-heavy Reader performance

Formula rendering continues to use the shared AI Rich Markdown pipeline with local KaTeX `htmlAndMathml`, `trust=false`, bounded expansion and local error isolation. The Reader now memoizes cross-block math projections and block/rendering subtrees so ordinary scroll updates do not re-run Markdown parsing for unchanged formula blocks. Virtual block estimation recognizes display math separately from code and currency, caps multi-row environments, and treats long display formulas as local horizontal surfaces. `.katex-display` owns horizontal overflow and uses layout/paint containment; the Reader body width and MathML accessibility output are unchanged.

| Key/存储 | 用途 |
| --- | --- |
| `chat-reader:user-preferences` | 服务器偏好的启动缓存 |
| `chat-reader:reader-default-focus` | 默认专注；旧 focus key 仅迁移一次 |
| `chat-reader:reader-sidebar-expanded`、`sidebar-width` | 侧栏状态/宽度 |
| `chat-reader:section-toc-width`、`reader-navigation-width` | 导航 pane 宽度 |
| `chat-reader:reader-utility-panel-width` | 搜索/Share/Export drawer 宽度 |
| `chat-reader:annotation-workspace-mode/panel` | 批注形态、位置和尺寸 |
| `chat-reader:source-editor-panel` | 源码工作区持久化宽度 |
| `chat-reader:conversation-files-workspace-floating-v2` | 当前对话文件浮窗的位置与尺寸 |
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

- Reader“更多”中的“当前对话文件”复用 `FloatingWorkspacePanel` 的 `reader-floating` 形态。桌面默认在 Reader 右上侧显示约 400x620 的注释式浮窗；整个表头可拖动，左/右/下边缘可缩放，几何状态持久化且支持复位。表头使用抓手光标并显示强调色附件图标；若源码编辑器已打开则保留其状态，文件面板关闭或完成插入后回到源码。移动端使用覆盖式全宽文件抽屉。面板按已使用、未使用、缺失分组，支持搜索、上传、预览、下载、重命名、定位、插入和移除未引用文件。
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
# 2026-08-09 Addendum: Conversation Editing And Complex Viewers

- The sidebar exposes a New Conversation dialog with title, project, User and Assistant fields. Both message bodies are required and submitted atomically.
- Reader message actions expose insertion before/after (single or User -> Assistant pair) and soft delete with an undo toast. Insert/delete mutations refresh only the affected reader data; no Trash UI is introduced.
- The single `AttachmentViewerProvider -> AttachmentViewerShell` remains the only body-level viewer. `ViewerKind` now includes document, spreadsheet, presentation and archive. A lazy `ComplexAttachmentViewer` starts a module Worker only after opening one of these supported attachments.
- The complex Worker enforces source, ZIP-entry, expanded-size and preview-byte caps before extracting read-only DOCX/ODT paragraphs/tables, XLSX/ODS bounded grids, PPTX/ODP static slide text, or ZIP directory entries with bounded text/image previews. Unsupported formats keep a reliable download row.

## Reader Scroll Hot Path

- `ReaderBlockLayoutMetrics` is derived from stable content width, font size, line height and density. Paragraph and code estimates are content-aware; the metrics cache changes only for width, font, density, font-load or explicit Reader layout events.
- TanStack Virtual owns measured row sizes. Automatic scroll compensation is limited to rows wholly above the 120px reading line, preventing partially visible rows from counter-moving a wheel gesture.
- `resolveActiveReadingTarget` uses `elementsFromPoint()` at the reading line and falls back to a bounded rendered-block registry only when the line is in whitespace. Owner and Share Readers use the same resolver.
- One passive listener coordinates direction, 80ms active-position sampling and a trailing sample. Reading-position persistence uses one trailing idle timer and calculates the full character anchor after scrolling stops. The container's changing total height is not observed.
- Previous/next sentinel IntersectionObservers are the only reader-window loading triggers. TOC receives the derived active heading and scrolls its own list asynchronously only when that item is out of view.
- Native scrollbar-thumb dragging is an explicit Reader gesture. Mounted virtual messages rebase their absolute coordinate before movement; edge-window fetch/merge is deferred until pointer release so `scrollHeight` cannot change underneath the captured thumb.
- A virtual message whose shell intersects the Reader viewport but whose mounted rows all miss that viewport is treated as a stale-coordinate gap. It reads its real absolute offset once and repairs `scrollMargin` without clearing TanStack's measured-size cache. This bounded recovery also covers Home/End, accessibility tooling and programmatic large jumps without adding layout reads to the ordinary wheel hot path.
