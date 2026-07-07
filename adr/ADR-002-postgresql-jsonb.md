# ADR-002: 使用 PostgreSQL + JSONB

## Context

系统需要关系数据、一致性、全文搜索、版本系统、Project/Pin/Tag 关系，以及灵活存储 RenderBlock 和 raw metadata。

## Options Considered

### SQLite
- Pros: 简单。
- Cons: 后续迁移成本、并发和全文搜索能力受限。

### MongoDB
- Pros: 文档灵活。
- Cons: 关系、事务、复杂索引、版本一致性成本更高。

### PostgreSQL + JSONB
- Pros: ACID、关系强、全文搜索、JSONB 灵活。
- Cons: 初期部署比 SQLite 重。

## Decision

使用 PostgreSQL + JSONB。

## Rationale

长期知识库需要稳定关系模型与灵活 block 存储，PostgreSQL 最平衡。
