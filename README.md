# Chat Reader

## Current access boundary

Chat Reader is a private conversation archive. Production supports one
deployment-provisioned administrator plus isolated user accounts, email/password
login, server-side per-device sessions and a 48-hour sliding inactivity timeout.
Explicit Share URLs remain public-by-link capabilities with an independent
Share password. The deployed account boundary and remaining verification debt
are recorded in [`PROJECT_STATE.md`](PROJECT_STATE.md).
See [`docs/system/AUTHENTICATION_CONTRACT.md`](docs/system/AUTHENTICATION_CONTRACT.md).

Chat Reader 是面向 AI 对话内容的长期阅读与管理系统。Adaptive Import 能确定性识别内置或用户学习过的 JSON / Markdown 格式；陌生结构只需 Mapping 一次，之后会成为可复用的导入格式。完整恢复继续使用 `.cr`。

## 核心能力

- 两类导入入口：Adaptive JSON / Markdown（单文件、配对或批量）和 `.cr` 归档恢复；CanJSON v1/v2 与 Chat Reader 原生格式作为 Built-in Profile 自动识别。
- 对话级附件支持普通上传、当前对话文件、版本 occurrence、Reader/Share/Offline 和基础预览；轻量部署可明确使用 disabled scanner。
- 以完整对话轮次加载长正文，支持远距离定位、连续滚动和稳定阅读位置恢复。
- GFM、Shiki、KaTeX、Mermaid、callout、代码复制及安全链接渲染。
- Project 与未归类对话管理、归档、批量选择、拆分/合并和版本恢复。
- 全局/当前对话搜索、批注与精选笔记、只读 Share，以及 Markdown v2、CanJSON v2、`.cr` 三类职责明确的导出。
- `/library` 独立 PWA：按 conversation revision 增量更新，支持离线阅读、搜索及批注同步。

## 技术栈

- Web：Next.js 14、React 18、TypeScript、Tailwind CSS。
- API：FastAPI、SQLAlchemy 2、Alembic、Python 3.11+。
- 数据与部署：PostgreSQL 16、Dexie、Cache API、Docker Compose。
- 包管理：Corepack + pnpm 9.15.4；Python 包使用 setuptools。

## 快速开始

准备 Node.js、Corepack、Python 3.11+ 和 PostgreSQL，然后在 PowerShell 中运行：

```powershell
Copy-Item .env.example .env
corepack pnpm install
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .\apps\api
Set-Location apps/api
alembic upgrade head
Set-Location ../..
```

分别启动三个进程：

```powershell
corepack pnpm run dev:api
corepack pnpm run dev:worker
corepack pnpm run dev:web
```

打开 `http://localhost:3000`。浏览器始终请求同源 `/api/*`，由 Next.js 转发给 FastAPI。

## 常用检查

| 命令 | 用途 |
| --- | --- |
| `corepack pnpm run lint` | Web ESLint |
| `corepack pnpm run typecheck` | Web TypeScript 检查 |
| `corepack pnpm run test:api` | API pytest |
| `corepack pnpm --filter web build` | Web production build |
| `corepack pnpm --filter web test:pwa` | 构建并运行 Playwright/PWA |

## 文档

- [当前项目快照](PROJECT_STATE.md)
- [完整文档导航](docs/index.md)
- [本地开发](docs/development.md)
- [生产部署](docs/deployment.md)
- [故障排查](docs/troubleshooting.md)

当前没有多用户产品功能、在线 AI 生成、完整消息/轮次虚拟列表、HTML/PDF 导出、标签系统或语义搜索。极长消息仅在 blocks 层动态虚拟化；公网部署必须由反向代理提供 HTTPS。
