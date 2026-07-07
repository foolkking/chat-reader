# ChatGPT 导出对话阅读器 / Chat Archive Reader：Kiro 风格完整设计文档包

本 ZIP 是用于分阶段实现 **ChatGPT 导出对话阅读器 / AI 对话档案馆** 的设计文档包。

它基于上传的 `design-documentation` skill 组织，核心模板为：

```text
Overview
Architecture
Components and Interfaces
Data Models
Error Handling
Testing Strategy
```

## Stage 00 Foundation / 项目骨架

项目名：`chat-reader`

项目定位：ChatGPT export archive reader。本阶段只建立可运行、可测试、可继续扩展的基础设施，不实现导入、解析、阅读器、搜索、编辑、分享或导出等 Stage 01+ 功能。

### 当前完成内容

- `apps/web`：Next.js + React + TypeScript + Tailwind CSS 前端骨架。
- `apps/api`：FastAPI 后端骨架，包含 `/health` 和 `/api/health`。
- `packages/shared`：共享常量包骨架。
- `docker-compose.yml`：PostgreSQL、API、Web 三个服务。
- `apps/api/alembic`：Alembic 环境已初始化，Stage 00 不创建业务表 migration。
- `.env.example`：本地开发环境变量示例。

### 本地启动要求

- Node.js 20+
- pnpm 9+
- Python 3.11+
- Docker Desktop 或兼容的 Docker Compose

如果本机没有 pnpm，可先运行：

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

### 安装依赖

前端依赖：

```bash
pnpm install
```

后端依赖建议使用虚拟环境：

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e .
cd ../..
```

### 启动 PostgreSQL

```bash
docker compose up chat-reader-postgres
```

默认数据库配置：

```text
POSTGRES_DB=chat_reader
POSTGRES_USER=chat_reader
POSTGRES_PASSWORD=chat_reader
```

### 启动 API

```bash
pnpm dev:api
```

或：

```bash
cd apps/api
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Health endpoints:

```text
GET http://localhost:8000/health
GET http://localhost:8000/api/health
```

### 启动 Web

```bash
pnpm dev:web
```

Web 默认地址：

```text
http://localhost:3000
```

### Docker Compose 启动

```bash
docker compose up --build
```

### 运行测试和检查

```bash
pnpm --filter web typecheck
pnpm --filter web lint
cd apps/api && pytest
cd ../..
git diff --check
```

也可以使用 Makefile：

```bash
make typecheck-web
make lint-web
make test-api
make check
```

### 下一阶段

Stage 01: Source Detection / Raw Artifacts

## Stage 01 Source Detection / Raw Artifacts

Stage 01 完成来源识别、原始文件保存、`imports` / `source_artifacts` 基础表和 Import Preview API。本阶段不解析为 Canonical Conversation，不生成 RenderBlock，不建立搜索索引。

### 当前完成内容

- Source profiles: `chatgpt_exporter_json`, `chatgpt_exporter_markdown`, `official_conversations_json`, `official_conversation_json`, `third_party_splitter_json`, `plain_text`, `csv`, `unknown`。
- 文件基础识别：sha256、size、mime guess、extension、warnings。
- Raw artifact 本地保存：`storage/imports/{import_id}/{safe_filename}`。
- API:
  - `POST /api/imports/preview`
  - `GET /api/imports/{import_id}/source-artifacts`
  - `GET /api/imports/{import_id}/warnings`
- Alembic migration: `imports` 和 `source_artifacts`。

### Import Preview API

```bash
curl -F "files=@sample.json" http://localhost:8000/api/imports/preview
```

响应示例：

```json
{
  "import_id": "00000000-0000-0000-0000-000000000000",
  "status": "previewed",
  "files": [
    {
      "artifact_id": "00000000-0000-0000-0000-000000000001",
      "filename": "sample.json",
      "source_profile": "chatgpt_exporter_json",
      "confidence": 0.95,
      "sha256": "...",
      "byte_size": 12345,
      "mime_guess": "application/json",
      "file_extension": ".json",
      "raw_storage_uri": "storage/imports/00000000-0000-0000-0000-000000000000/sample.json",
      "warnings": []
    }
  ],
  "warnings": []
}
```

查询 artifact：

```bash
curl http://localhost:8000/api/imports/{import_id}/source-artifacts
```

查询 warnings：

```bash
curl http://localhost:8000/api/imports/{import_id}/warnings
```

### Storage

上传文件保存到本地 `storage/imports/`。文件名会 sanitize，同名文件不会覆盖，API 只返回内部相对 URI，不返回本机绝对路径。

### Migration

```bash
cd apps/api
alembic upgrade head
cd ../..
```

### 测试

```bash
corepack pnpm --filter web typecheck
corepack pnpm --filter web lint
cd apps/api && pytest
cd ../..
git diff --check
```

## Stage 02 ChatGPT Exporter JSON + Markdown Preview Import

Stage 02 支持 ChatGPT Exporter JSON、ChatGPT Exporter Markdown，以及 JSON + Markdown combo 的 preview import。当前阶段只生成 conversation preview / canonical draft，不写入正式 `conversations`、`messages`、`message_versions` 或 `render_blocks` 表。

### 当前完成内容

- ChatGPT Exporter JSON parser：解析 metadata、link、dates、messages、role、time、empty message。
- ChatGPT Exporter Markdown parser：按 `## Prompt:` / `## Response:` 做 section-level parse，保留 markdown_text。
- Thinking cleaner：只清理 assistant response 开头明显的导出思考摘要。
- Exporter aligner：支持 `json_only`、`markdown_only`、`exact_match`、`partial_match`、`conflict_detected`。
- Import Preview API 扩展：Exporter JSON/Markdown/combo 上传时返回 `conversation_preview`。

### 不支持内容

- 官方 `conversations.json` 仍只做 source detection，不做正式 parser。
- 不生成 RenderBlock、Heading、SearchDocument。
- 不提供正式导入提交 API。
- 不实现阅读器 UI、搜索、编辑、分享或导出。

### curl 示例

```bash
curl -F "files=@ChatGPT-社交训练.json" -F "files=@ChatGPT-社交训练.md" http://localhost:8000/api/imports/preview
```

响应会包含：

```json
{
  "conversation_preview": {
    "title": "社交训练",
    "source_type": "chatgpt_exporter_combo",
    "source_profile": "chatgpt_exporter_combo",
    "alignment_status": "exact_match",
    "message_count": 2,
    "prompt_count": 1,
    "response_count": 1,
    "empty_message_count": 0,
    "cleaned_thinking_summary_count": 1,
    "messages": []
  }
}
```

Preview messages 默认最多返回前 20 条。

### 测试

```bash
corepack pnpm --filter web typecheck
corepack pnpm --filter web lint
cd apps/api && pytest
cd ../..
git diff --check
```

## Stage 03 Official conversations.json Preview Import

Stage 03 支持官方 ChatGPT 导出的 `conversations.json` 和单个 official conversation JSON 的 preview import。同时继续要求真实 PostgreSQL migration 验证：`imports` / `source_artifacts` 必须能通过 Alembic 在 PostgreSQL 中创建。

### 当前完成内容

- Official JSON parser：支持顶层 list 和单 conversation object。
- Primary path resolver：从 `current_node` 沿 `parent` 回溯到 root，再反转为默认主线。
- Branch metadata preview：`children` 数量大于 1 的节点计为 branch point；非主线 message node 只进入 branch metadata，不进入默认 messages。
- Official normalizer：把 primary path 上的 official nodes 转成 preview messages。
- Import Preview API：支持 `official_conversation_json` 和 `official_conversations_json`，并返回 `conversation_preview` / `conversation_previews`。

### 不支持内容

- 不把 official `mapping` 当内部长期格式。
- 不创建正式 `conversations`、`messages`、`message_versions`、`render_blocks` 表。
- 不实现完整分支 UI、阅读器、搜索、编辑、分享或导出。

### curl 示例

```bash
curl -F "files=@conversations.json" http://localhost:8000/api/imports/preview
```

响应会包含：

```json
{
  "conversation_preview": {
    "title": "Official Sample",
    "source_type": "official_chatgpt_export",
    "source_profile": "official_conversations_json",
    "alignment_status": "official_primary_path",
    "message_count": 2,
    "node_count": 4,
    "message_node_count": 3,
    "primary_path_length": 3,
    "branch_count": 1,
    "branch_node_count": 1,
    "has_branches": true
  },
  "conversation_previews": []
}
```

### PostgreSQL migration 验证

Docker Compose 方式：

```bash
docker compose up -d chat-reader-postgres
cd apps/api
alembic upgrade head
alembic current
cd ../..
docker compose exec chat-reader-postgres psql -U chat_reader -d chat_reader -c "\dt"
docker compose exec chat-reader-postgres psql -U chat_reader -d chat_reader -c "SELECT version_num FROM alembic_version;"
```

非 Docker PostgreSQL 方式：

1. 创建数据库 `chat_reader`。
2. 创建用户 `chat_reader`，密码 `chat_reader`。
3. 确认 `DATABASE_URL=postgresql+psycopg://chat_reader:chat_reader@localhost:5432/chat_reader`。
4. 执行：

```bash
cd apps/api
alembic upgrade head
alembic current
psql -U chat_reader -d chat_reader -c "\dt"
psql -U chat_reader -d chat_reader -c "SELECT version_num FROM alembic_version;"
cd ../..
```

如果当前环境没有 Docker 和 PostgreSQL CLI，只能执行 offline SQL 检查：

```bash
cd apps/api
alembic upgrade head --sql
cd ../..
```

### 测试

```bash
corepack pnpm --filter web typecheck
corepack pnpm --filter web lint
cd apps/api && pytest
cd ../..
git diff --check
```

## 如何使用

建议按以下顺序阅读和执行：

1. `.kiro/specs/chat-archive-reader/requirements.md`：需求总表。
2. `.kiro/specs/chat-archive-reader/design.md`：总设计文档。
3. `.kiro/specs/chat-archive-reader/tasks.md`：总任务拆分。
4. `stages/`：逐阶段实现设计文档。
5. `prompts/`：可直接交给编码智能体执行的 Stage Prompt。
6. `schemas/`：Canonical JSON、SQL schema、OpenAPI 草案。
7. `adr/`：关键架构决策记录。

## 推荐执行顺序

```text
Stage 00：项目骨架与基础设施
Stage 01：来源识别与 Raw Artifact
Stage 02：ChatGPT Exporter JSON + Markdown 导入
Stage 03：官方 conversations.json 导入
Stage 04：Canonical 存储、搜索、目录
Stage 05：基础阅读器前端
Stage 06：Project / Pin / Reading Position
Stage 07：性能优化与虚拟滚动
Stage 08：编辑、版本、Undo
Stage 09：分享与导出
Stage 10：安全、测试、发布硬化
```

## 实现原则

```text
不要直接渲染原始 JSON
不要长期依赖原始 Markdown
不要把官方 conversations.json 当内部格式
不要把第三方 TXT 当主结构
不要滚动时解析 Markdown
不要一次性渲染全部 DOM
不要编辑时覆盖原内容
不要让搜索依赖 DOM
不要让目录依赖 DOM 扫描
不要丢失原始来源可追溯性
```
