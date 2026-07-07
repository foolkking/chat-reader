# ADR-005: 使用 Stage-based Delivery

## Context

项目范围大，包含导入、阅读、搜索、编辑、分享、性能、安全。一次性实现容易失控。

## Decision

按 Stage 00 到 Stage 10 分阶段交付。

## Rationale

每个 Stage 有明确 scope、测试和验收标准，便于一个阶段一个阶段推进。
