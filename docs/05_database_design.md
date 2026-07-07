# Design Document: Database Design

## Overview

数据库使用 PostgreSQL + JSONB。PostgreSQL 负责关系数据、一致性、复杂索引、全文搜索和长期存储；JSONB 用于 blocks、warnings、raw metadata 等结构弹性区域。

## Architecture

主要分层：

```text
Core tables: conversations, messages, message_versions
Read model: render_blocks, headings, search_documents
Organization: projects, project_conversations, tags
Import trace: imports, source_artifacts, source_message_refs
UX state: reading_positions, recent_items, user_preferences
Ops: jobs, conversation_events
Sharing: shares
```

## Components and Interfaces

### Core Storage

- conversations：会话元数据。
- messages：消息位置与角色。
- message_versions：消息正文版本。

### Read Model

- render_blocks：按 block 拆分后的渲染数据。
- headings：目录数据。
- search_documents：搜索索引源。

### Traceability

- imports：一次导入行为。
- source_artifacts：原始文件 artifact。
- source_message_refs：官方 node / branch 溯源。

## Data Models

完整 SQL 见 `schemas/database_schema.sql`。

## Index Strategy

建议索引：

```sql
CREATE INDEX idx_conversations_sort_time ON conversations(sort_time DESC);
CREATE INDEX idx_messages_conversation_order ON messages(conversation_id, order_key);
CREATE INDEX idx_render_blocks_version_index ON render_blocks(message_version_id, block_index);
CREATE INDEX idx_headings_conversation_order ON headings(conversation_id, order_key);
CREATE INDEX idx_search_documents_vector ON search_documents USING GIN(search_vector);
CREATE INDEX idx_project_conversations_project ON project_conversations(project_id, is_pinned, sort_order);
CREATE INDEX idx_source_message_refs_source_node ON source_message_refs(source_conversation_id, source_node_id);
```

## Error Handling

- 导入必须事务化写入 canonical 核心表。
- 搜索索引可以异步重建，失败不应导致 canonical 导入回滚。
- render_blocks 可以重建，不作为唯一真实来源。

## Testing Strategy

- Alembic migration tests。
- Foreign key cascade tests。
- Unique constraint tests。
- Search vector tests。
- Rollback tests。
