# 测试结果

## 2026-08-09 Adaptive Viewer Presentation

| Check | Status | Result |
| --- | --- | --- |
| Web lint | PASS | zero warnings |
| Web typecheck | PASS | `tsc --noEmit` |
| Web production build | PASS | 9 Next.js routes; conversation first-load JS 698 kB |
| Adaptive Viewer focused tests | PASS | 12/12 presentation resolver, size bounds, mobile fullscreen, maximize/PDF toolbar, Registry/SVG/single-shell contract |
| API full suite | PASS | 211 passed, 1 fixture-gated skipped |
| Migration head | PASS | `20260806_0021` only; no migration in this change |
| PWA/default Playwright | PARTIAL_PASS | 19 passed, 21 online/fixture-gated skipped; skipped cases are not PASS |
| Production before baseline | PASS | real Chrome, five required viewport classes; old 1920 x 1080 single-page PDF was about 1844 x 1016 CSS px |
| Production after screenshots and interaction | PASS | real Chrome verified PDF document/Fit modes, image Focus and workspace Overview, Markdown/JSON reading, 1240px code reading, CSV workspace, compact audio, aspect-ratio video fallback size, maximize/Esc and mobile fullscreen |

The baseline screenshots are transient release evidence and are not committed because repository policy forbids persisting real production conversation identifiers or content.

## 2026-08-09 Attachment Renderer final release

| Check | Status | Result |
| --- | --- | --- |
| Web lint / typecheck / production build | PASS | final registry/thumbnail patch passes all three commands; 9 Next.js routes |
| API full suite | PASS | 211 passed, 1 fixture-gated skipped; skipped case is not counted as PASS |
| Renderer/SVG/single-portal policy | PASS | final focused run 7/7 |
| PWA default | PARTIAL_PASS | 13 passed, 21 conditional skipped |
| Linux release images | PASS | GitHub Actions run `31269172465`, commit `5baea32`, archive SHA-256 `55a53e8606ae1e404255729dbb566172913997b3678648e3630b95be73400f6e` |
| King services and migration | PASS | API/Web/PostgreSQL healthy, worker running, Alembic `20260806_0021`, ClamAV stopped |
| Production Chrome core Viewer | PASS | one body dialog; image Gallery/filmstrip; Markdown Rendered/Source; engineering download fallback; TIFF failure fallback; Esc and scroll restoration |
| Optional complex Viewer | NOT_IMPLEMENTED | Office/Spreadsheet/Presentation/EPUB/Archive/Diagram/CAD/3D use authenticated download-only fallback |
| Conditional Offline/PWA and animation/TIFF derivative matrix | PARTIAL_PASS | not all production scenarios were executed |

## 2026-08-07 attachment workflow release candidate

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| Web lint / typecheck / build | PASS | 三条必需命令通过；Next.js 9 routes，conversation 首次加载 bundle 671 kB |
| API full suite | PASS | 205 passed；1 个真实 fixture 条件 skip，未计入 PASS |
| Alembic | PASS | 单一 head `20260806_0021` |
| PWA default | PARTIAL_PASS | 8 passed / 20 conditional skipped；跳过项不计为通过 |
| Online attachment/Reader/DnD | PASS | 显式启用在线场景后 11/11 passed：5 个附件工作流、配对导入、结构化 DnD、4 个长 Reader 恢复场景 |
| King save latency | NOT_PRODUCTION_VERIFIED | 分段 timing 已实现；须发布本提交后使用专用测试对话记录 p50/p95 |
| King deployment | NOT_PRODUCTION_VERIFIED | 本节为发布候选本地证据，不覆盖下方上一版本生产证据 |

本轮保存路径不再提升上传项或重建整场会话；测试确认已有 Attachment 拖入源码不会上传字节或复制 Attachment/AssetObject，保存后只局部替换当前消息。

执行环境：Windows / PowerShell，本地 SQLite API fixture 与 Next.js production server；未连接生产数据库。

| 时间（2026-07-27） | 命令 | 结果 | 通过/失败 | 备注 |
|---|---|---|---|---|
| 实施中 | `corepack pnpm --filter web lint` | 通过 | 1/0 | ESLint，0 warnings |
| 实施中 | `corepack pnpm --filter web typecheck` | 通过 | 1/0 | `tsc --noEmit` |
| 实施中 | `python -m pytest -q`（`apps/api`） | 通过 | 146/0 | API 全量测试 |
| 实施中 | `python -m pytest tests/test_annotation_search_index.py -q` | 通过 | 4/0 | CRUD、范围、幂等、异常隔离 |
| 实施中 | `corepack pnpm --filter web build` | 通过 | 1/0 | Next.js production build |
| 实施中 | `corepack pnpm --filter web exec playwright test --config=playwright.config.ts` | 通过 | 5/0 | Library/PWA 原子 staging、冷启动、旧壳保留 |
| 实施中 | `E2E_CONVERSATION_ID=... playwright test e2e/reader-layout.spec.ts` | 通过 | 2/0 | 桌面 Reader/搜索/批注与 390x844 移动布局 |

## 最终复验（2026-07-27）

| 命令 | 结果 | 通过/失败 |
|---|---|---|
| `corepack pnpm run lint` | 通过 | 1/0，ESLint 0 warnings |
| `corepack pnpm run typecheck` | 通过 | 1/0，`tsc --noEmit` |
| `corepack pnpm --filter web build` | 通过 | 1/0 |
| `python -m pytest -q`（`apps/api`） | 通过 | 146/0 |
| `python -m scripts.backfill_annotation_search`（运行两次） | 通过 | `scanned=1, skipped=1, errors=0` each run |
| `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000` + `GET /api/health` | 通过 | 本地隔离 SQLite fixture，HTTP 200 |
| `corepack pnpm --filter web exec playwright test --config=playwright.config.ts` | 通过 | 8/0（PWA 5 + Reader 3） |
| `playwright test e2e/reader-layout.spec.ts`（最终截图复验） | 通过 | 3/0 |

## Chrome 本地 production 点击复审（2026-07-27）

本地隔离地址：`http://127.0.0.1:3110`（Next production build）+ `http://127.0.0.1:8000`（SQLite 合成 fixture API）。

| 场景 | 结果 | 证据/说明 |
|---|---|---|
| 首页 → Reader → 最近 → 恢复 Reader | 通过 | 最近链接携带真实 `messageId`，不伪造进度 |
| Reader 折叠态 `Ctrl+K` | 首次发现焦点竞态，修复后通过 | 侧栏先挂载再聚焦 `sidebar-global-search`；E2E 新增回归断言 |
| 全局搜索 → 批注分类 → Reader 锚点 | 通过 | URL 包含 message/block/offset/annotation ID，批注浮窗打开并聚焦 |
| 当前对话正文与批注搜索 | 通过 | 正文命中、annotation 过滤、类型/颜色展示均正确 |
| 对话 TOC + 当前消息章节 TOC | 通过 | A1 跳转后显示两级 heading，命名和视觉区分明确 |
| 批注浮窗 → 固定覆盖左栏 → 恢复 | 通过 | 未出现第四列，章节 TOC 保持可用 |
| 专注模式 | 通过 | 两个 TOC 宽度归零，恢复后状态正常，无横向溢出 |
| Share / Export | 通过 | 私人内容默认关闭；`.cr`/Markdown/Canonical JSON 入口可用 |
| Library | 通过 | 在线/未下载状态清晰，无横向溢出 |
| 窄屏 Reader | 通过 | Chrome 插件请求 390px 时实际下限为 520px；导航与更多工具 Bottom Sheet 点击通过 |
| 390×844 精确视口 | 通过 | Playwright 390×844 用例，无横向滚动 |

Chrome 控制台仅出现浏览器扩展自身的 message-channel 关闭记录；未发现应用脚本异常。

## 提交前最终闸门（2026-07-27）

| 命令 | 结果 | 通过/失败 |
|---|---|---|
| `corepack pnpm run lint` | 通过 | 1/0，ESLint 0 warnings |
| `corepack pnpm run typecheck` | 通过 | 1/0，`tsc --noEmit` |
| `python -m pytest -q`（`apps/api`） | 通过 | 146/0，82.78s |
| `playwright test e2e/reader-layout.spec.ts` | 通过 | 3/0，17.3s |
| `playwright test --config=playwright.config.ts` | 通过 | 8/0，34.6s |

截图均使用合成测试会话，不包含生产隐私内容。

## 最终缺项审计与 Reader 重构（2026-07-28）

| 检查 | 结果 | 证据 |
|---|---|---|
| Web lint | 通过 | `npm run lint`，0 warnings |
| TypeScript | 通过 | `npm run typecheck` |
| Production build | 通过 | `npm run build`，9 个页面路由生成成功 |
| API 全量 | 通过 | `python -m pytest -q`，150/150 |
| Reader/Share turn API | 通过 | `test_reader_performance_api.py`、`test_sharing_api.py` 包含完整 blocks 与 scope 断言 |
| PWA/Offline Playwright | 通过 | 5/5；旧 active shell、staging failure、移动 cold start、离线远距离批注 |
| 长对话专项 | 通过 | `E2E_LONG_READER=1` 连续重复 10 轮，10/10；100 消息、目标第 35 轮、刷新恢复、跨轮次后 DOM 仍为 3 轮 |
| 本地 Chrome production | 通过 | 完整正文 6 条消息/3 轮；批注落点约 4px；刷新恢复相同 block/offset；滚动从 `000069–000074` 切换到 `000075–000080` |
| 本地 Chrome UI | 通过 | 侧栏 tablist=0，Project 与未归类同时显示；三点菜单无离线入口；外观与语言中离线入口=1；移动断点无横向溢出 |

长对话专项使用本地隔离 fixture；没有把生产会话正文、Share token 或凭据写入测试结果。

专项压力测试曾稳定捕获两条低概率竞态并在最终 10 轮前修复：窗口真实高度缩短时不得由普通 `scroll` delta 反推用户方向；用户产生 wheel/touch/pointer drag/阅读键输入后，必须同时取消当前定位步骤与整个刷新恢复降级循环。边缘加载会等待新窗口消息真实挂载后再恢复锚点，并通过 `data-reader-edge-stage` 保留无正文内容的诊断阶段。

## 离线增量专项（2026-07-28）

| 检查 | 结果 | 证据 |
|---|---|---|
| Reader 完整水合 + Offline API targeted pytest | 通过 | 11/11 |
| 相同 revision | 通过 | `estimated_bytes=0`，v2 package `conversations=[]` |
| 在线 revision 变化 | 通过 | package 只含变化 conversation，revision 增长 |
| v1 兼容 / v2 导入 | 通过 | TypeScript 类型与 importer 双版本分支；Dexie version 仍为 1 |
| Web typecheck / lint | 通过 | `tsc --noEmit`；ESLint 0 warnings |

## 最终本地回归闸门（2026-07-28）

| 命令 | 结果 | 通过/失败 |
|---|---|---|
| `corepack pnpm --filter web lint` | 通过 | 1/0，ESLint 0 warnings |
| `corepack pnpm --filter web typecheck` | 通过 | 1/0，`tsc --noEmit` |
| `corepack pnpm --filter web build` | 通过 | 1/0，9 个页面路由 |
| `python -m pytest -q`（`apps/api`） | 通过 | 150/0，89.77s |
| `playwright test` | 通过 | 5/0，4 个需显式 fixture 的用例按条件跳过 |
| `E2E_LONG_READER=1 playwright test e2e/reader-restoration.spec.ts --repeat-each=10` | 通过 | 10/0，107.9s |

## 离线一致性补充回归（2026-07-28）

| 检查 | 结果 | 证据 |
|---|---|---|
| 未读本地对话完整列出 | 通过 | 新增 `last_read_at=null` fixture；修复前稳定失败，改为全表读取后通过 |
| Project + 全部对话单层侧栏 | 通过 | 两个 heading 同时可见，旧 tablist=0，Project/未归类不重复 |
| 自动增量更新生命周期 | 通过 | revision 组合键替代一次性 ref；运行中互斥，后续 revision 可再次触发 |
| 紧凑偏好弹层 | 通过 | 打开前后 footer 高度差 0px；Escape、关闭按钮与外部点击可收起 |
| 在线/离线入口语义 | 通过 | 在线为 `/library`；Library 为当前 `/conversations/{id}` 或首页 |
| PWA/Offline Playwright | 通过 | 6/6，21.0s；另单独重跑新增用例 1/1 |
| Web typecheck / lint / build | 通过 | `tsc --noEmit`、ESLint 0 warnings、9 个页面路由 |

## King 生产发布与 Chrome 复验（2026-07-28）

| 检查 | 结果 | 证据 |
|---|---|---|
| 服务与镜像 | 通过 | API/PostgreSQL/Web healthy，worker running，migrate exited 0；最终 Web `89cf21043354...` |
| 上传完整性 | 通过 | 首次 32 文件 SHA `33dcc95b...`；补丁 5 文件 SHA `7cee70aa...`，服务端一致 |
| 公网 HTTP | 通过 | `/api/health`、`/library`、生产 Reader HTTP 200 |
| 生产远距离批注 | 通过 | 目标 Range 对齐阅读线误差 2px；完整 3 轮、无长内容占位 |
| 生产刷新恢复 | 通过 | 首次同 block/offset 误差 0px；最终 Web 复验同 block、17px offset |
| 生产连续阅读 | 通过 | `next:settled`，窗口从 `000029-000034` 前进到 `000037-000042`，仍为 3 轮 |
| 生产项目移动 | 通过 | 拖到未归类成功；通过 UI 恢复原项目，最终未归类 0、项目内 1 |
| 生产离线侧栏 | 通过 | Project/全部对话同时可见，项目折叠控制 1，旧 tablist=0 |
| 生产偏好入口 | 通过 | Library“返回在线版”链接到记忆对话；在线“离线资料库”各 1 个；footer delta=0px |
| 日志 | 通过 | 最终 12 分钟 API/Web/worker 无 error/exception/traceback/fatal/panic |

生产证据只记录状态、数量、order key 与像素偏差，不记录对话正文、批注正文、Share token 或凭据。

## 视觉与操作体验最终回归（2026-07-28）

| 检查 | 结果 | 证据 |
|---|---|---|
| Web lint | 通过 | ESLint 0 warnings |
| TypeScript | 通过 | `tsc --noEmit` |
| Production build | 通过 | Next production build，9 个页面路由生成成功 |
| API 全量 | 通过 | `python -m pytest -q`，150/150，162.49s |
| Web Playwright | 通过 | 11/11；普通套件按条件跳过长对话专项 |
| 长对话专项 | 通过 | `E2E_LONG_READER=1`，1/1；100 条消息、远距离批注与刷新恢复 |
| Reader 布局专项 | 通过 | 5/5；1440x900、1280x720、390x844、抽屉纠偏、批注重置、专注与阅读预设 |
| Library/PWA 专项 | 通过 | 6/6；增量更新、统一侧栏、紧凑设置、移动离线与远距离批注 |
| 本地 Chrome | 通过 | 1830x823 实点分享私人选项、搜索筛选、专注锚点、三档预设、批注纠偏及中英文 Library |
| King Chrome | 通过 | 远距离批注后继续阅读并刷新，恢复同一 block，阅读线偏差约 0.21px；正文无长内容占位 |
| King UX | 通过 | 分享抽屉未越界且私人选项可点击；专注模式、紧凑偏好、离线入口去重、Library 增量摘要均通过 |

截图和自动化证据未写入生产正文、批注正文、Share token 或凭据。

## 截图证据

- `docs/execution/screenshots/home-light-1440x900.png`
- `docs/execution/screenshots/search-annotation-light-1440x900.png`
- `docs/execution/screenshots/search-empty-light-1440x900.png`
- `docs/execution/screenshots/reader-default-light-1440x900.png`
- `docs/execution/screenshots/reader-default-dark-1440x900.png`
- `docs/execution/screenshots/reader-annotation-floating-1440x900.png`
- `docs/execution/screenshots/reader-annotation-docked-1440x900.png`
- `docs/execution/screenshots/library-light-1440x900.png`
- `docs/execution/screenshots/share-panel-light-1440x900.png`
- `docs/execution/screenshots/reader-error-light-1440x900.png`
- `docs/execution/screenshots/home-mobile-light-390x844.png`
- `docs/execution/screenshots/reader-mobile-light-390x844.png`

## 2026-07-28 批量管理、Markdown 排版与批注阅读回归

| 检查 | 结果 | 证据 |
|---|---|---|
| Web lint | 通过 | ESLint 0 warnings |
| TypeScript | 通过 | `tsc --noEmit` |
| Production build | 通过 | Next.js 14.2.23，9 个页面路由生成成功 |
| API 全量 | 通过 | `python -m pytest -q`，150/150 |
| Reader 布局专项 | 通过 | `reader-layout.spec.ts`，6/6；覆盖 Linear 式选择、桌面隐藏最近、批注展开/返回、Markdown 间距与字号 |
| Library/PWA 专项 | 通过 | `library-offline.spec.ts`，6/6 |
| 长对话恢复专项 | 通过 | `E2E_LONG_READER=1`，1/1；100 条消息、远距离批注、刷新恢复和边缘加载 |
| King 公网与数据接口 | 通过 | `/api/health`、`/library`、998 条生产对话页面均为 HTTP 200；reader-turn 首轮所有 block 完整、0 截断 |
| King 迁移与日志 | 通过 | `20260728_0016 (head)`；API/Web/PostgreSQL healthy，worker running；最近 20 分钟无 error/exception/traceback/fatal/panic |
| 本轮 King Chrome 点击 | 通过 | 用户指定 Chrome 已完成生产长对话、远距离批注、继续滚动/刷新、批量选择、批注展开、Markdown/字号、桌面/移动与离线入口点击复验；后续发现并修复离线 TOC 时间戳后再次点击确认 |

本轮浏览器验收使用用户指定的生产长对话；截图和自动化证据不写入生产正文、批注正文、Share token 或凭据。

## 2026-07-29 离线 TOC 修复与最终 King Chrome 复验

| 检查 | 结果 | 证据 |
|---|---|---|
| 离线预览清洗 | 通过 | `reader-data-source.ts` 复用在线端时间戳、思考时长和 Markdown 清洗规则；既有 Dexie 数据无需重新下载 |
| 本地回归 | 通过 | Web typecheck、lint、production build；`library-offline.spec.ts` 6/6 |
| 生产补丁发布 | 通过 | Web `7714e9a9d96c33cb68908a9d57b1de50cb4883d9827de63f26f3c846232deb65`；旧 Web `51f51e6499bbce06d7f7bfe23cfc79e05417ea98a0d3957ae06ca70d3504992f` 保留为 `rollback-offline-toc-20260729T014534Z` |
| 上传完整性 | 通过 | 单文件归档 `offline-toc-web-20260729T014534Z.tar.gz`，本地/服务器 SHA-256 `30a92d9d98df7615ebf79381332e2dfa69969330ea35cfcbbed785a723acbbcf` |
| 生产离线点击 | 通过 | TOC 50 项无时间戳；点击 U5 后 6 条消息、1062 blocks、无占位、无横向溢出 |
| 生产在线回归 | 通过 | 在线长对话 6 条消息、1062 blocks；无占位、无加载错误、无横向溢出；Web healthy |

生产 Web 补丁只替换 Web 容器，API、worker、PostgreSQL 和 migration 均未变更。

## 2026-07-30 Mobile Header and Canonical Export Production Verification

| Check | Result | Evidence |
|---|---|---|
| Web typecheck / lint / production build | Pass | `tsc --noEmit`, ESLint 0 warnings, Next.js 14.2.23 production build |
| API regression | Pass | Full API suite 151 passed; export-specific suite 4 passed, including a 998-message fixture |
| Web Playwright | Pass | Full suite 14 passed / 1 conditional skip; focused mobile regression 3 passed; navigation-settled header test passed |
| Shared mobile CR header | Pass | Chrome at 390x844: `/`, `/archived`, `/search`, `/recent`, and `/projects/default-id`; all headers start at y=0 with no horizontal overflow |
| Mobile sort and bulk mode | Pass | Sort sheet is closed after hydration/reload, opens within viewport, and closes after selection; zero-selection toolbar is above the first row and all row checkboxes are visible |
| Reader restore and header | Pass | Production long conversation restored at scrollTop 65532 with CR header visible, 6 fully hydrated messages, no expand placeholders, and no horizontal overflow |
| Canonical JSON UI | Pass | Local and production mobile Export panels expose Canonical JSON and generate the expected `format=canonical_json` download URL; production Chrome request returned HTTP 200 |
| Canonical JSON full export | Pass | Production 998-message export completed at 87,047,589 bytes in 66.77s; API stayed healthy at about 80-89 MiB without OOM |
| King deployment | Pass | API/worker image `ed48f11b7f47...`; Web image `d52287980053...`; migration `20260728_0016 (head)`; HTTPS and `/api/health` return 200 |
| King cleanup | Pass | Old Chat Reader images and build cache removed; build cache 0 B; only latest Chat Reader service tags retained; root disk reduced from 51% to 42% |

## 2026-07-31 Hybrid Virtualization Overlap Regression

| Check | Result | Evidence |
|---|---|---|
| Web typecheck / lint / production build | Pass | `tsc --noEmit`, ESLint 0 warnings, Next.js production build |
| Long-reader Playwright | Pass | `reader-restoration.spec.ts`, 2/2; direct virtual target plus far annotation/refresh restoration |
| Local Chrome typography matrix | Pass | Production build; `15px + compact + wide`, `22px + loose + narrow`, and `17px + comfortable + standard`; three virtual lists, maximum adjacent-row delta below 0.0004px |
| Production Chrome default layout | Pass | Two virtual lists (`329` and `548` blocks); maximum adjacent-row delta about 0.0025px, no visible overlap |
| Production Chrome extreme presets | Pass | `22px + loose + narrow` below 0.0014px; `15px + compact + wide` below 0.0008px |
| Refresh and continued scrolling | Pass | After refresh below 0.0034px; after scrolling to virtual indexes around 320/275 below 0.0019px; screenshots show separate text, list, code, and heading rows |
| Preference restoration | Pass | Production preference returned to `17px + comfortable + standard`; no horizontal overflow |
| Public and Compose health | Pass | Public `/api/health` HTTP 200; Web/API/PostgreSQL healthy, worker running; Web restart count 0 |

Subpixel values are browser geometry rounding; the acceptance threshold is 1px and no mounted row crossed the next row's visible content.

## 2026-08-02 Markdown Typography and Anchor Regression

| Check | Result | Evidence |
|---|---|---|
| Web lint / typecheck / production build | Pass | ESLint 0 warnings, `tsc --noEmit`, Next.js production build |
| Markdown spacing and list rendering | Pass | Ordered-list starts, inline Markdown headings, density geometry, and non-virtual/virtual block spacing covered by focused Playwright tests |
| Long Reader navigation | Pass | `reader-restoration.spec.ts` 3/3 with direct virtual target, rapid layout preference changes, far annotation navigation, and refresh restoration |
| Reader/Offline/Share regression | Pass | Focused suite 15/15 after rerunning the isolated search-layout case with its fixture indexed |
| Local Chrome desktop | Pass | Focus mode enter/exit preserved the same real block and reading-line offset with 0px measured drift |
| Local Chrome mobile | Pass | Equivalent 390x844 viewport; CR header visible after reload, no horizontal overflow, and no virtual block overlap in screenshot inspection |

The local browser fixture and evidence contain only synthetic content. No production conversation text or identifiers were persisted.

## 2026-08-03 Reader Edge Loading and Paired Import Update

| Check | Result | Evidence |
|---|---|---|
| Local regression | Pass | Web lint, typecheck, and production build passed; API 170/170; default PWA matrix 7 passed with 12 fixture-dependent skips; long Reader restoration suite 4/4 |
| Paired JSON/Markdown samples | Pass | 11 filename pairs previewed without ambiguity and 424 non-empty messages committed in the isolated local verification database; canonical content remained JSON-authoritative |
| Production backup | Pass | PostgreSQL dump was validated with container `pg_restore`; source, import storage, and offline storage were archived before service replacement; rollback image tags were retained |
| Upload integrity | Pass | 307 explicit runtime files; local and King SHA-256 `16308b2fbcc4fb98d54cf179af9f8bb219215fac160eaeb01363a82da840fd37`; no environment files, local storage, databases, logs, caches, or `tsbuildinfo` were uploaded |
| King deployment | Pass | API `96fb790608b1...`, worker `04ca2a031527...`, Web `e560f52bc1e0...`; migration `20260730_0017 (head)` |
| Public and Compose health | Pass | Public `/api/health` and `/library` returned HTTP 200; PostgreSQL, API, and Web were healthy, worker running; recent application logs contained no error, exception, traceback, fatal, or panic entries |
| Chrome production smoke | Partial | User-selected Chrome refreshed the production UI and clicked into the existing long Reader; the initial window exposed 6 message nodes and 42 mounted block nodes. Continued wheel-scroll verification was interrupted by the Chrome extension control channel timing out, so edge continuity and refresh restoration were not marked passed in this production run |

No production conversation text, identifiers, credentials, Share tokens, or cookies were persisted in this record.

## 2026-08-06 Attachment Preview and Export Increment

| Check | Result | Evidence |
|---|---|---|
| Web lint / typecheck / build | Pass | ESLint 0 warnings, `tsc --noEmit`, Next.js production build |
| Full API suite | Pass | 203 passed with one fixture-gated skip in the default command; the real attachment fixture module separately passed 9/9 with the fixture path enabled |
| Source editor attachment workflow | Pass | 4/4 online Playwright: file selection, exact drop, clipboard paste, fenced-code decision, independent upload drafts, save/Reader rendering and preserve-as-unplaced close |
| Migration | Pass | local and King single head `20260805_0020` |
| PWA default matrix | Partial | 8 passed; 16 online/fixture scenarios conditionally skipped and not counted as pass |
| King attachment Reader | Pass | 20 blocks; loaded view showed 3 images and 6 text previews; image opened through a direct-body full-viewport dialog |
| King export secondary options | Pass | UI exposed description/annotations/notebook/source refs; generated manifest preserved the selected flags |
| Failed task dismissal | Pass | two stale failure cards stayed hidden after reload in the specified Chrome profile |
| Scanner capabilities | Pass | disabled, unscanned allowed, basic preview enabled, complex preview disabled |
| Chrome ordinary file chooser | Pass | user-confirmed production E2E covered file selection, upload session, conversation attachment, message version, Reader persistence and download/export |
| Share attachment E2E | Pass | user-confirmed production scope/preview/download/ID authorization/revocation chain; local real-fixture Playwright also passed SVG Share preview and revoke |
| System `.cr v4` empty-instance restore | Pass | user-confirmed production-equivalent restore covered projects, conversations, versions, attachments/objects, annotations, notebook, source refs, order/placement, hashes, derived rebuild and Reader |
| King on-host Web build | Failed method | PostgreSQL checkpointer was OOM-killed; WAL recovery and a verified post-recovery dump completed |

The acceptance fixture and DnD conversation were deleted after verification. The synthetic project was archived because no project hard-delete API exists. No production conversation text, identifiers, tokens, credentials, or environment values are recorded here.

## 2026-08-06 SVG Dialog and Source Attachment Release Closeout

| Check | Result | Evidence |
|---|---|---|
| GitHub Actions release build | Pass | Run `31083578130`; Linux API/worker/migrate/Web images for `af17c93`; archive SHA-256 verified locally and on King |
| Production source/image alignment | Pass | Loaded application source and images use `af17c93`; the later docs-only evidence commit does not alter runtime files |
| Production source editor paste | Pass | Synthetic PNG pasted at the CodeMirror cursor in Chrome; upload completed as `scanner_disabled`, v2 saved, Reader showed one `IMG` attachment, source panel closed, and refresh preserved the attachment |
| Production cleanup | Pass | Synthetic acceptance conversation was hard-deleted and the public conversation endpoint returned 404 |
| Migration and service health | Pass | Alembic `20260805_0020 (head)`; API/Web/PostgreSQL healthy, worker running; public health and capabilities returned expected values |
| Disabled scanner policy | Pass | Production reports provider disabled, unscanned allowed, status `scanner_disabled`, basic preview enabled and complex preview disabled; no scanner container is running |
| Source editor attachment flow | Pass | Local production Web/API E2E: file selection, exact-position drop, clipboard paste, fenced-code choice, independent upload drafts, save, Reader rendering and preserve-as-unplaced close all passed (4/4) |
| SVG inline DOM | Pass | Production Chrome found one `IMG` and no inline SVG/script/object/embed/iframe in the attachment block |
| SVG full-page dialog | Pass | Direct `body` child, full viewport, `aria-modal=true`, one content `IMG`, no inline active document nodes, focus entry/trap, Esc and backdrop close, scroll/focus restoration, no new tab |
| Acceptance cleanup | Pass | Temporary conversation hard-deleted and local bundle removed after verification |

The Chrome extension did not have local-file URL access for automated chooser control in this run. The fixture was therefore staged through the same production Bundle API and the UI was verified in Chrome. This does not replace or downgrade the user's previously confirmed production file-chooser upload E2E, which remains Pass.
