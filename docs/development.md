# 本地开发

## 依赖

- Node.js 20+ 与 Corepack。
- Python 3.11+。
- PostgreSQL 16（其他受支持版本需要自行验证）。
- Docker Desktop 可用于只启动数据库或完整容器环境。

## 环境变量

从 [`.env.example`](../.env.example) 创建 `.env`。主要变量：

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | FastAPI 使用的 SQLAlchemy PostgreSQL URL |
| `API_INTERNAL_URL` | Next.js 服务端 rewrite 的 FastAPI 地址 |
| `CORS_ORIGINS` | 直接访问 FastAPI 时允许的 Web origins |
| `PUBLIC_WEB_BASE_URL` | 分享链接使用的公开 Web 根地址 |
| `MAX_IMPORT_FILE_SIZE_MB` | 单个导入文件上限 |
| `IMPORT_STORAGE_DIR` | raw import artifact 存储目录 |

不要把 `API_INTERNAL_URL` 改成浏览器端 public 变量。浏览器只请求同源 `/api/*`。

## 安装

```powershell
corepack pnpm install
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .\apps\api
```

## 数据库和 Migration

可以使用仓库开发 compose 启动 PostgreSQL：

```powershell
docker compose up -d postgres
```

应用 migration：

```powershell
Set-Location apps/api
alembic upgrade head
alembic current
Set-Location ../..
```

创建 migration 前先核对 SQLAlchemy model 与现有 migration，不要通过 `create_all` 绕过 Alembic。

## 启动

在两个终端中分别运行：

```powershell
corepack pnpm run dev:api
corepack pnpm run dev:web
```

Web 监听 `0.0.0.0:3000`，API 监听 `0.0.0.0:8000`。`0.0.0.0` 仅是监听地址，不能作为浏览器请求地址。localhost 和 LAN 浏览器均通过 Web 的 `/api/*` 代理访问业务接口。

辅助脚本：

```powershell
.\scripts\start-local.ps1
.\scripts\check-local.ps1
.\scripts\qa-local.ps1
```

## 检查与测试

```powershell
corepack pnpm --filter web typecheck
corepack pnpm --filter web lint
corepack pnpm --filter web build
Set-Location apps/api
alembic current
pytest
```

提交前还应执行：

```powershell
git diff --check
rg "dangerouslySetInnerHTML" apps/web
```

第二条命令预期无结果。构建可能更新 `apps/web/tsconfig.tsbuildinfo`，不要把无关缓存变化提交。

## 测试数据

测试应优先使用 `apps/api/tests` 中的 fixture。`examples/` 和 `apps/api/storage/` 可能包含本地导入样例或用户数据，不属于项目文档，也不应默认提交。

## 修改文档

新增或修改行为时同步更新 [产品说明](product.md)、[架构](architecture.md) 或 [API 参考](api-reference.md)。不要恢复阶段 prompt、施工日志或重复的设计总稿。
