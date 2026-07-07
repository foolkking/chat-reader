# ChatGPT 导出对话阅读器：完整需求与设计总纲

本文件是项目完整总纲，详细阶段实现以 `.kiro/specs/`、`docs/`、`stages/` 和 `prompts/` 为准。

## 项目定位

面向 ChatGPT 导出内容的长期阅读、整理、搜索、编辑、合并、分享和归档系统。

## 来源体系

1. 第一来源：ChatGPT Exporter JSON + Markdown。
2. 第二来源：官方 conversations.json。
3. 第三来源：DarkIlluminatus 等 splitter 生成的 JSON/TXT。
4. CSV：备用导入/导出格式。

## 核心原则

- JSON 管结构，Markdown 管渲染。
- 官方 conversations.json 管完整来源结构。
- Canonical Format 管长期稳定存储。
- 不直接渲染原始 JSON。
- 不长期依赖原始 Markdown。
- 不把官方 conversations.json 当内部格式。
- 不把第三方 TXT 当主结构。
- 不滚动时解析 Markdown。
- 不一次性渲染全部 DOM。
- 不编辑覆盖原内容。
- 不丢失原始来源可追溯性。

## 核心功能

- 多来源导入。
- 导入预览。
- 思考摘要清洗。
- Canonical 转换。
- Project 管理。
- ChatGPT 风格阅读器。
- 目录。
- 搜索。
- 编辑版本。
- 阅读范围。
- 分享。
- 导出。
- 性能优化。
- 移动端适配。

## 技术栈

- Next.js + React + TypeScript。
- Tailwind CSS。
- TanStack Query。
- TanStack Virtual。
- Zustand。
- FastAPI。
- PostgreSQL + JSONB。
- SQLAlchemy 2.x + Alembic。
- PostgreSQL Full Text Search。

## 阶段

Stage 00 到 Stage 10，详见 `docs/13_stage_roadmap.md`。
