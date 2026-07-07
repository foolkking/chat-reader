# ADR-001: 使用 Canonical Conversation Format 作为长期内部格式

## Context

系统需要支持 ChatGPT Exporter JSON + Markdown、官方 conversations.json、第三方 splitter、CSV 等多来源。如果前端或数据库长期依赖某一种来源格式，后续兼容、编辑、搜索、导出都会变得脆弱。

## Options Considered

### Option 1: 直接渲染原始 JSON/Markdown
- Pros: 初期实现快。
- Cons: 格式耦合、难编辑、难搜索、难兼容官方 mapping。

### Option 2: 官方 conversations.json 作为内部格式
- Pros: 结构信息完整。
- Cons: 树状 mapping 不适合阅读、搜索、编辑、Project 管理。

### Option 3: 自定义 Canonical Format
- Pros: 稳定、可扩展、适合阅读和编辑。
- Cons: 需要 parser/canonicalizer。

## Decision

选择 Option 3。

## Rationale

Canonical Format 能把不同来源统一为 Conversation / Message / MessageVersion / RenderBlock，同时通过 source refs 保留官方 mapping 信息。

## Implications

所有来源必须经过导入管线，前端不得直接依赖原始来源。
