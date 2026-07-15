# chat-reader

`chat-reader` 是面向 ChatGPT 导出内容的长期阅读与管理系统。它把 JSON 和 Markdown 导入为稳定的 canonical 数据，提供适合长对话的阅读、搜索、目录、编辑、Project、分享和导出能力，而不是一个在线聊天机器人。

## 主要能力

- 预览并导入 ChatGPT Exporter JSON/Markdown 组合和官方 conversations JSON。
- 使用 PostgreSQL 保存会话、不可变消息版本、RenderBlock、标题和搜索文档。
- ChatGPT 风格阅读器，支持 GFM、Shiki 代码高亮、KaTeX、Mermaid、callout 和代码复制。
- 长会话窗口加载、heavy message blocks 懒加载、对话索引和当前消息章节目录。
- 中文、代码词、URL 和符号较多内容的全文与子串搜索。
- Project、置顶、归档、软删除、消息/会话拆分与合并。
- 消息编辑与版本恢复、阅读位置和最近打开记录。
- 只读分享链接管理，以及 Markdown、Canonical JSON 导出。
- 响应式移动阅读界面和 PWA-ready 应用壳。

## 技术栈

- Web：Next.js 14、React 18、TypeScript、Tailwind CSS、TanStack Query、Zustand、assistant-ui。
- API：FastAPI、SQLAlchemy 2、Alembic、Python 3.11。
- 数据库：PostgreSQL 16。
- 部署：Docker Compose；浏览器统一请求同源 `/api/*`，由 Next.js 转发给 FastAPI。

## 本地启动

准备 Node.js、Corepack、Python 3.11+、PostgreSQL 和 pnpm，然后：

```powershell
Copy-Item .env.example .env
corepack pnpm install
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .\apps\api
```

创建数据库后执行 migration：

```powershell
Set-Location apps/api
alembic upgrade head
Set-Location ../..
```

分别启动 API 和 Web：

```powershell
corepack pnpm run dev:api
corepack pnpm run dev:web
corepack pnpm run dev:worker
```

打开 `http://localhost:3000`。局域网访问时仍使用 Web 的 3000 端口，业务请求通过同源 `/api/*` 代理，不需要让浏览器直接访问 8000 端口。

## 检查

```powershell
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run test:api
```

生产部署参见 [Docker 部署](docs/deployment.md)。完整文档入口见 [docs/index.md](docs/index.md)，当前实现快照见 [PROJECT_STATE.md](PROJECT_STATE.md)。

## 当前边界

当前没有认证或多用户隔离、真正的虚拟滚动、HTML/PDF 导出、标签/收藏、语义搜索、可任意扩展的通用 Job 类型和离线会话缓存。现有单并发 task worker 处理 import 与 conversation merge。部署到公网前应通过反向代理增加 HTTPS 和访问控制。
