# 前端架构

最后核验日期：2026-07-26

## 技术栈（锁文件版本）

| 类别 | 实现 |
| --- | --- |
| 框架/路由 | Next.js 14.2.23 App Router，React/ReactDOM 18.3.1 |
| 语言/构建 | TypeScript 5.9.3，pnpm 9.15.4，Next build |
| 样式 | Tailwind CSS 3.4.19 + `app/globals.css` CSS variables；无通用成品 UI kit |
| 服务端状态 | TanStack Query 5.101.2 |
| 本地状态 | React state/context；Zustand 5.0.14 用于局部 store |
| 图标/交互 | Lucide React 1.24.0，Vaul 1.1.2，dnd-kit 6.3.1/10.0 |
| Markdown | react-markdown 10.1.0，remark-gfm/breaks/math，rehype-sanitize/katex |
| 富内容 | Shiki 4.3.1，KaTeX 0.17.0，Mermaid 11.16.0 |
| 离线 | Dexie 4.4.4，FlexSearch 0.8.212，fflate 0.8.3，Service Worker/Cache API |
| 测试/规范 | Playwright 1.62.0，ESLint 9.39.4；现有 PWA E2E 文件 1 个 |

版本证据：`pnpm-lock.yaml`；`package.json` 中范围仅用于依赖声明。

## 目录与路由

```text
apps/web/
├── app/                 Next route segments、layout/loading、CSS
├── components/          全局壳、侧栏框架、可调面板、对话框、providers
├── features/            annotations/conversations/editing/exporting/import/
│                        offline/projects/reading/search/sharing/toc
├── lib/                 API、types、ReaderDataSource、Dexie、offline repository
├── public/              manifest、library/root service workers、icons
└── e2e/                 library-offline.spec.ts
```

页面清单见 `PAGE_AND_ROUTE_MAP.md`。根 `layout.tsx` 组合 Query、Preferences、InteractionDialog、ImportDialog、ShortcutManager、OfflineSyncManager 和 ServiceWorkerRegistration providers。

## 数据请求与状态

- `lib/api.ts`/feature request functions 使用同源 `/api/*`；`next.config.mjs` rewrite 到 `API_INTERNAL_URL`。
- TanStack Query 管理远程列表、详情、TOC、阅读位置等；mutation 后按 query key 失效/更新。
- `ReaderDataSource` 统一 remote/offline Reader：remote 组合现有 API；offline 读取 Dexie。`capabilities` 控制 canonical 管理、share/export 等入口。
- Reader target context 使用 data source identity/revision、conversation/message/block/offset/quote，避免在线与离线或旧 revision query 混用。
- 全局偏好由 `PreferencesProvider` 先读 localStorage，再在线同步 `/api/preferences`。

## 主要组件关系

```text
RootLayout
└── providers
    ├── AppShell
    │   ├── ProjectSidebar -> Conversation/Project lists
    │   └── routed list/detail content
    ├── ConversationReader
    │   ├── ReaderSidebarFrame(ProjectSidebar or LibrarySidebar)
    │   ├── Message window -> MessageItem -> Markdown/Code/Mermaid
    │   ├── ConversationIndex + ConversationToc
    │   ├── Search/Share/Export dock panels
    │   └── AnnotationWorkspace
    └── LibraryShell -> OfflineReaderDataSource -> ConversationReader
```

## 阅读渲染

- Markdown pipeline 支持 GFM、soft line breaks、math、sanitize 和 KaTeX；链接通过安全组件处理。
- Shiki 按语言动态加载并配合 light/dark theme；失败回退为纯代码文本。
- Mermaid 动态 import，渲染失败保留 source/error；不会阻断普通正文。
- Message renderer 支持 canonical text/block 以及导入内容中的 image/attachment parts；未发现音视频专用播放器。
- callout、reasoning `<details>`、引用、列表、表格和代码复制为自定义 components。

## 主题、国际化与响应式

- 主题：light/dark/system；全部设计 token 集中在 `apps/web/app/globals.css` 的 `:root`（53 个 light 变量）和 `[data-theme="dark"]`（53 个 dark 值）中。
- 设计 token 体系（globals.css）：`--page`、`--sidebar`、`--surface`、`--subtle`、`--border` 背景层级；`--text`、`--text-secondary` 文字层级；`--accent`、`--accent-soft` 强调色；`--focus`、`--danger` 语义色；含 markdown-*、callout-*、code-* 等富内容 token。
- `tailwind.config.ts` 的 `theme.extend` 为空对象（无自定义 Tailwind token），所有自定义值通过 CSS 变量 + `.bg-*/.text-*` 工具类使用；`html[data-theme="dark"]` 覆写规则处理库硬编码色值。
- 语言：auto/zh/en，由本地偏好立即生效并在线同步；没有独立翻译平台依赖。
- 阅读宽度：compact/standard/wide。
- Desktop breakpoint 下显示可折叠/可调左侧栏、visible/rail 章节 TOC、可调 dock 和可拖缩批注窗口。
- Reader 布局网格由 `globals.css` 中的以下 CSS 类控制：`.reader-frame`（container-type 基础容器）、`.reader-layout-grid`（grid 容器）、`.reader-content-column`（居中消息正文，max-width 受 data-reader-width 控制）、`.reader-toc-column`（右侧章节 TOC sticky，≥62rem container 触发）、`.reader-index-column`（左侧对话 TOC rail sticky，≥1280px 触发）。两个 TOC 列均属于正文区域，非独立侧栏。
- Mobile 使用 Vaul/自定义 Bottom Sheet，不显示 desktop rail/separator；批注只读/搜索/导航。
- 可调宽 helper 使用 pointer capture、clamp、双击默认值、`role=separator` 与 localStorage。

## 浏览器持久化键

| Key | 用途 |
| --- | --- |
| `chat-reader:user-preferences` | 主题、语言、阅读宽度等缓存 |
| `chat-reader:reader-sidebar-expanded` | Reader 侧栏折叠 |
| `chat-reader:sidebar-width` | 在线/离线共享左侧栏宽度 |
| `chat-reader:section-toc-width` | 章节 TOC 宽度 |
| `chat-reader:reader-navigation-width` | Reader 导航 dock 宽度 |
| `chat-reader:reader-utility-panel-width` | search/share/export dock 宽度 |
| `chat-reader:annotation-workspace-panel` | 批注窗口位置和尺寸 |
| `chat-reader:last-library-conversation` | 资料库最近对话 |
| `chat-reader:share-position:<hash>` | Share 页局部阅读位置；键使用 token 派生 hash |

另有 IndexedDB 和 Cache API，详见 `DATA_AND_STORAGE.md`。代码未发现认证 Cookie 管理。

## PWA 与 Service Worker

- Manifest 的 `start_url` 和 `scope` 都是 `/library`。
- `/library-sw.js` 只拦截同源 GET 的 library navigation 和允许的静态壳资源；普通 `/`、管理页和 API 不被其 fallback。
- library navigation 最多进行两次 2 秒网络请求，中间等待 350ms；响应小于 500 直接返回，持续 5xx/异常才读 active `/library` shell。
- shell 通过 staging cache 完整写入并校验 JS/CSS/worker 后原子激活；失败保留旧 revision。
- `/sw.js` 仅注销旧 root-scope worker并清理 legacy cache；页面注册器在非 library 路径继续清理错误 scope。

## 错误处理与测试

- API 错误由 request helper 转为 Error，再由页面 inline state 或 InteractionDialog 展示；没有统一遥测 SDK。
- React Query 提供 retry/cache；关键导航另有 token cancellation、明确阶段结果和 fallback。
- PWA 自动化位于 `apps/web/e2e/library-offline.spec.ts`；脚本 `test:pwa` 构建后运行 Playwright。
- 2026-07-27 最终执行已完成 `lint`、`typecheck`、production build 与 Playwright；结果见 `docs/execution/TEST_RESULTS.md`。

## 2026-07-27 前端结构更新

全局设计 token 继续位于 `app/globals.css`。Reader frame 通过 `data-focus-mode` 隐藏辅助栏而不销毁 TOC；annotation workspace 使用 floating/docked 两态，docked 覆盖左侧导航。在线与离线 Reader 仍共享 ReaderDataSource。离线批注搜索记录写入既有 `searchDocuments` store，Dexie version/stores 不变。
