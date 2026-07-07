# ADR-003: 官方 conversations.json 第一版只展示 Primary Path

## Context

官方 conversations.json 是 mapping 树，包含 regenerate 分支。阅读器第一版以线性阅读为主。

## Options Considered

### 展示全部 mapping 节点
- Pros: 不丢内容。
- Cons: 顺序混乱，废弃分支会干扰阅读。

### 只导入 current_node 回溯主线，丢弃分支
- Pros: 简单。
- Cons: 丢失原始结构。

### 展示 primary path，保存分支 source refs
- Pros: 阅读清晰，不丢溯源。
- Cons: 需要 source_message_refs。

## Decision

选择第三种。

## Rationale

第一版保证阅读体验，后续可基于 source refs 做分支 UI。
