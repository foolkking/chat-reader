# ADR-004: render_blocks 作为可重建 Read Model

## Context

MessageVersion.blocks 已经保存 block 快照，但前端虚拟滚动、搜索定位、高度缓存需要独立表优化查询。

## Decision

message_versions.blocks 是 canonical 快照；render_blocks 是 materialized read model。

## Implications

编辑后必须重建 render_blocks、headings、search_documents。render_blocks 损坏时可从 message_versions.blocks 重建。
