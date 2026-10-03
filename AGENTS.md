# AGENTS.md

开始工作前先阅读 `PROJECT_STATE.md`，再按任务进入 `docs/index.md` 中的专题文档。

## 项目上下文

- 这是 Next.js Web + FastAPI/PostgreSQL API + 单并发后台 worker 的 monorepo。
- 浏览器使用同源 `/api/*`；Next.js 通过 `API_INTERNAL_URL` 转发到 FastAPI。
- canonical 数据以 PostgreSQL、Alembic migration 和当前代码为准；导入原文不是渲染真值。
- Reader、Share 和 Offline Reader 使用完整轮次语义；兼容的 message-window/block 接口不是主阅读路径。
- `/library` 使用 Dexie version 2 和 offline package v3，必须保留 v1/v2/v3 包读取兼容及已有本机数据。

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

## 临时文件与缓存

- 本机任务临时目录统一使用 `C:\Users\86182\Desktop\wkkk`，每个任务或测试批次建立可辨认的独立子目录。
- 运行会生成临时文件的命令前，在当前 PowerShell 进程设置 `TEMP` 和 `TMP`；启动的 API、worker、构建与测试进程继承该设置。不要修改机器或用户级全局环境变量。
- pytest 的 `--basetemp`、浏览器测试临时配置、临时下载、解压文件及一次性脚本均放入此目录的任务子目录；不再使用系统默认 Temp 或项目 `.tmp` 新建这些临时内容。仓库要求保留的测试证据与交付文件仍按文档规则存放。
- 清理时只处理可确认归属当前任务且不再使用的文件，不清空整个 `wkkk`，不清理其他任务或用户资料；递归删除前核验绝对路径和链接边界。

```powershell
$taskTempRoot = 'C:\Users\86182\Desktop\wkkk\chat-reader-task-name'
New-Item -ItemType Directory -Force -Path $taskTempRoot | Out-Null
$env:TEMP = $taskTempRoot
$env:TMP = $taskTempRoot
```

## 文档规则

- 当前事实写入 `PROJECT_STATE.md` 或 `docs/system/`；入口保持简短并链接详细文档。
- `docs/planning/`、`docs/execution/`、`docs/evidence/` 是带日期的历史记录，不作为当前代码真值。
- 结构、命令、migration、接口或部署边界变化时，同步更新相关文档与 `docs/documentation-inventory.md`。
- 不在文档、截图或日志中持久化真实对话正文、ID、Share token、Cookie、凭据或 `.env` 值。
