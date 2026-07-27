# 测试结果

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
