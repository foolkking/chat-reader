# AGENTS.md

开始工作前先阅读 `PROJECT_STATE.md`，再按任务进入 `docs/index.md` 中的专题文档。

## 项目上下文

- 这是 Next.js Web + FastAPI/PostgreSQL API + 单并发后台 worker 的 monorepo。
- 浏览器使用同源 `/api/*`；Next.js 通过 `API_INTERNAL_URL` 转发到 FastAPI。
- canonical 数据以 PostgreSQL、Alembic migration 和当前代码为准；导入原文不是渲染真值。
- Reader、Share 和 Offline Reader 使用完整轮次语义；兼容的 message-window/block 接口不是主阅读路径。
- `/library` 使用 Dexie version 1 和 offline package v2，必须保留 v1 包读取兼容。

## 必需命令

| 任务 | 命令 |
| --- | --- |
| Web lint | `corepack pnpm run lint` |
| Web typecheck | `corepack pnpm run typecheck` |
| Web build | `corepack pnpm --filter web build` |
| API tests | `corepack pnpm run test:api` |
| Migration head | `cd apps/api; python -m alembic heads` |
| Playwright/PWA | `corepack pnpm --filter web test:pwa` |

测试范围按改动风险选择；Reader、离线、Share、migration 或共享数据合同变化必须运行对应专项测试。

## 工作规则

- 优先沿用现有组件、service、schema 和测试模式；不要为局部改动引入新架构。
- PostgreSQL migration 必须保持单一 head，并同步 schema/model/tests 和部署文档。
- 不得破坏已有 Share URL、`.cr`、离线包 v1 读取、Dexie 数据或阅读位置语义。
- 不要把程序化滚动当作用户滚动；Reader 导航与位置恢复必须使用稳定真实 DOM 锚点。
- 不要执行 `docker compose down -v`，不要删除生产 volume，不要用本地 `.env` 覆盖服务器配置。
- 不要修改或删除 `apps/api/storage/imports/` 中的用户导入资料，除非用户明确要求。

## 文档规则

- 当前事实写入 `PROJECT_STATE.md` 或 `docs/system/`；入口保持简短并链接详细文档。
- `docs/planning/`、`docs/execution/`、`docs/evidence/` 是带日期的历史记录，不作为当前代码真值。
- 结构、命令、migration、接口或部署边界变化时，同步更新相关文档与 `docs/documentation-inventory.md`。
- 不在文档、截图或日志中持久化真实对话正文、ID、Share token、Cookie、凭据或 `.env` 值。
