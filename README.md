# Chat Reader

## Current access boundary

Chat Reader is deployed as a single-owner application. Business content,
including Share and direct artifact downloads, requires the owner password on
a new browser. Authentication uses server-side per-device sessions with a
48-hour sliding inactivity timeout; no multi-user product feature is exposed.
See [`docs/system/AUTHENTICATION_CONTRACT.md`](docs/system/AUTHENTICATION_CONTRACT.md).

Chat Reader 是面向已经线性化、标准化的 AI 对话内容的长期阅读与管理系统。普通导入使用兼容 JSON（可附 Markdown 做一致性校验），完整恢复使用 `.cr`；系统提供长对话阅读、搜索、批注、Project 管理、分享、导出和离线资料库，但不解析 OpenAI 官方对话图或 ZIP。

## 核心能力

- 三类导入入口：兼容 JSON（含 CanJSON 自动识别、可选 Markdown）、附件 `.crbundle` 和旧 `.cr` 兼容归档；预览通过后才提交。
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

当前没有应用内认证、多用户隔离、在线 AI 生成、完整消息/轮次虚拟列表、HTML/PDF 导出、标签系统或语义搜索。极长消息仅在 blocks 层动态虚拟化；公网部署必须由反向代理提供 HTTPS 和访问控制。
