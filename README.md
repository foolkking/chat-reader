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

## Stage 03B Windows Local PostgreSQL

本机 Windows 开发环境可以不使用 Docker，直接安装 PostgreSQL 到 E 盘。

推荐路径：

```text
Install: E:\PostgreSQL\17
Data:    E:\PostgreSQL\data
PATH:    E:\PostgreSQL\17\bin
```

本地开发账号：

```text
superuser: postgres / postgres
database:  chat_reader
user:      chat_reader / chat_reader
```

初始化项目数据库后，`apps/api/.env` 应包含：

```env
DATABASE_URL=postgresql+psycopg://chat_reader:chat_reader@localhost:5432/chat_reader
```

验证命令：

```bash
psql --version
where psql
pg_isready -h localhost -p 5432
psql -h localhost -U chat_reader -d chat_reader -c "SELECT current_database(), current_user;"
cd apps/api
alembic upgrade head
alembic current
pytest
```

表验证：

```bash
psql -h localhost -U chat_reader -d chat_reader -c "\dt"
psql -h localhost -U chat_reader -d chat_reader -c "SELECT version_num FROM alembic_version;"
```

## Stage 04 Canonical Persistence / Core Conversation Storage

Stage 04 将 import preview 基于 raw artifacts 重新解析并持久化为内部 Canonical core storage。Preview response 不作为可信持久源。

### 当前完成内容

- Core tables:
  - `conversations`
  - `messages`
  - `message_versions`
  - `render_blocks`
  - `source_message_refs`
  - `conversation_events`
- `imports` 增加：
  - `conversation_id`
  - `committed_at`
- Canonical persistence service:
  - ChatGPT Exporter JSON
  - ChatGPT Exporter Markdown
  - ChatGPT Exporter JSON + Markdown combo
  - Official single conversation JSON
  - Official `conversations.json` list
- Basic render block builder:
  - `paragraph`
  - `heading`
  - `code`
- Read APIs:
  - `GET /api/conversations`
  - `GET /api/conversations/{conversation_id}`
  - `GET /api/conversations/{conversation_id}/messages`
  - `GET /api/messages/{message_id}`
  - `GET /api/messages/{message_id}/blocks`

### Import preview -> commit

```bash
curl -F "files=@ChatGPT-社交训练.json" http://localhost:8000/api/imports/preview
curl -X POST http://localhost:8000/api/imports/{import_id}/commit
curl http://localhost:8000/api/conversations
curl http://localhost:8000/api/conversations/{conversation_id}/messages
curl http://localhost:8000/api/messages/{message_id}/blocks
```

Commit response:

```json
{
  "import_id": "00000000-0000-0000-0000-000000000000",
  "status": "committed",
  "conversation_ids": ["00000000-0000-0000-0000-000000000001"],
  "conversation_count": 1,
  "message_count": 12,
  "warnings": []
}
```

### PostgreSQL migration 验证

```bash
cd apps/api
alembic upgrade head
alembic current
cd ../..
psql -h localhost -U chat_reader -d chat_reader -c "\dt"
psql -h localhost -U chat_reader -d chat_reader -c "SELECT version_num FROM alembic_version;"
```

Expected head:

```text
20260707_0002
```

### 本阶段不包含

- Project CRUD
- Search index
- Reader UI / virtual scroll
- Editing
- Share / export

## Stage 05 Basic Reader API/UI Skeleton

Stage 05 adds the first usable reader loop on top of the canonical APIs from Stage 04.

### Current capabilities

- Home page `/` shows the `chat-reader` title, import panel, and conversation list.
- Import panel supports selecting one or more `.json`, `.md`, `.markdown`, `.txt`, or `.csv` files.
- Import panel can call `POST /api/imports/preview` and display a preview summary.
- Commit button calls `POST /api/imports/{import_id}/commit`.
- After commit, the conversation list refreshes and links to the first committed conversation.
- Reader page `/conversations/{conversation_id}` loads conversation detail and messages with render blocks.
- Basic block renderer supports `paragraph`, `heading`, `code`, and plain-text fallback.
- Imported content is rendered through canonical `message_versions` / `render_blocks`; raw artifact files are not read by the frontend.

### Start API and Web

```bash
cd apps/api
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
corepack pnpm --filter web dev
```

Open:

```text
http://localhost:3000
```

### Manual reader flow

```bash
curl -F "files=@ChatGPT-sample.json" http://localhost:8000/api/imports/preview
curl -X POST http://localhost:8000/api/imports/{import_id}/commit
curl http://localhost:8000/api/conversations
curl "http://localhost:8000/api/conversations/{conversation_id}/messages?include_blocks=true"
```

### Checks

```bash
corepack pnpm --filter web typecheck
corepack pnpm --filter web lint
cd apps/api
alembic current
pytest
cd ../..
git diff --check
```

### Not included in Stage 05

- Project / pin / reading position
- Search / TOC
- Virtual scroll
- Edit / share / export

## Stage 06 Project / Pin / Reading Position

Stage 06 adds the basic organization and reading-state layer.

### Current capabilities

- `projects`, `project_conversations`, `reading_positions`, and `recent_items` tables.
- Default `Inbox` project is created automatically when projects are listed or imports are committed.
- Committed conversations are added to `Inbox` idempotently.
- Conversations can be added to or removed from projects.
- Conversations can be globally pinned in the all-conversations list.
- Conversations can be pinned inside a specific project without changing global pin state.
- Reader records recent opens and saves/restores reading position by message anchor and scroll offset.
- Frontend shows a project sidebar, recent conversations, project conversation pages, and basic pin controls.

### API examples

```bash
curl http://localhost:8000/api/projects

curl -X POST http://localhost:8000/api/projects \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Research\"}"

curl -X POST http://localhost:8000/api/projects/{project_id}/conversations/{conversation_id}

curl -X PATCH http://localhost:8000/api/conversations/{conversation_id}/pin \
  -H "Content-Type: application/json" \
  -d "{\"is_pinned\":true}"

curl -X PATCH http://localhost:8000/api/projects/{project_id}/conversations/{conversation_id}/pin \
  -H "Content-Type: application/json" \
  -d "{\"is_pinned\":true}"

curl -X PUT http://localhost:8000/api/conversations/{conversation_id}/reading-position \
  -H "Content-Type: application/json" \
  -d "{\"message_id\":\"...\",\"block_index\":0,\"scroll_offset\":1200,\"anchor_data\":{\"order_key\":\"000010\"}}"

curl -X POST http://localhost:8000/api/conversations/{conversation_id}/recent

curl http://localhost:8000/api/recent-items
```

### Migration and checks

```bash
cd apps/api
alembic upgrade head
alembic current
pytest
cd ../..

corepack pnpm --filter web typecheck
corepack pnpm --filter web lint
git diff --check
```

Expected head:

```text
20260707_0003
```

### Not included in Stage 06

- Search / TOC
- Virtual scroll
- Edit / share / export
- Auth / tags / bookmarks

## Stage 07 Search / TOC / Reader Performance

Stage 07 adds keyword search, generated conversation TOC, and basic reader performance protection.

### Current capabilities

- `search_documents` table stores canonical search documents.
- `headings` table stores generated TOC items from heading render blocks.
- Import commit rebuilds headings and search documents in the same transaction.
- `POST /api/search/reindex` rebuilds one conversation or all conversations.
- `GET /api/search` supports keyword search, pagination, conversation filter, project filter, and document type filter.
- Search snippets are plain text; no HTML highlighting is emitted.
- `GET /api/conversations/{conversation_id}/toc` returns generated headings.
- `GET /api/conversations/{conversation_id}/message-window` returns paginated reader messages.
- Reader page loads messages in windows with a `Load more` button.
- Heavy messages are collapsed until `Load blocks` is clicked.

### API examples

```bash
curl "http://localhost:8000/api/search?q=keyword"

curl -X POST http://localhost:8000/api/search/reindex \
  -H "Content-Type: application/json" \
  -d "{}"

curl -X POST http://localhost:8000/api/search/reindex \
  -H "Content-Type: application/json" \
  -d "{\"conversation_id\":\"...\"}"

curl http://localhost:8000/api/conversations/{conversation_id}/toc

curl "http://localhost:8000/api/conversations/{conversation_id}/message-window?limit=50&offset=0&include_blocks=true"
```

### Migration and checks

```bash
cd apps/api
alembic upgrade head
alembic current
pytest
cd ../..

corepack pnpm --filter web typecheck
corepack pnpm --filter web lint
git diff --check
```

Expected head:

```text
20260707_0004
```

### Not included in Stage 07

- Semantic search / embeddings / vector database
- Full virtual scroll engine
- Edit / share / export
- Auth / tags / bookmarks

## Stage 08 Message Editing / Version History

Stage 08 adds message editing, version history, and restore on top of the canonical version model from Stage 04. This stage does not add a migration because `message_versions`, `render_blocks`, `conversation_events`, and `messages.current_version_id` already contain the required fields.

### Current capabilities

- `PATCH /api/messages/{message_id}` creates a new `message_versions` row for a manual edit.
- Existing `message_versions` rows are immutable; imported text is not overwritten.
- `messages.current_version_id`, `content_hash`, `block_count`, `char_count`, and `is_heavy` are updated after edit.
- New current-version `render_blocks` are generated from edited display text.
- `headings` and `search_documents` are rebuilt after edit or restore.
- `GET /api/messages/{message_id}/versions` returns version history in descending version order.
- `POST /api/messages/{message_id}/versions/{version_id}/restore` creates a new `restore` version rather than pointing back to the old row.
- `GET /api/conversations/{conversation_id}/events` returns edit and restore events.
- Reader message cards include basic `Edit` and `Versions` controls using a textarea and plain text version preview.

### API examples

```bash
curl -X PATCH http://localhost:8000/api/messages/{message_id} \
  -H "Content-Type: application/json" \
  -d "{\"display_text\":\"Edited message\",\"edit_reason\":\"Fix typo\"}"

curl http://localhost:8000/api/messages/{message_id}/versions

curl -X POST http://localhost:8000/api/messages/{message_id}/versions/{version_id}/restore \
  -H "Content-Type: application/json" \
  -d "{\"edit_reason\":\"Restore previous version\"}"

curl "http://localhost:8000/api/conversations/{conversation_id}/events?event_type=message_edited"
```

### Migration and checks

```bash
cd apps/api
alembic upgrade head
alembic current
pytest
cd ../..

corepack pnpm --filter web typecheck
corepack pnpm --filter web lint
git diff --check
```

Expected head remains:

```text
20260707_0004
```

### Not included in Stage 08

- Share / export
- Auth / collaboration
- Semantic search / embeddings
- Rich text editor / WYSIWYG editor
- Message diff viewer
- Delete / split / merge / bulk edit

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
