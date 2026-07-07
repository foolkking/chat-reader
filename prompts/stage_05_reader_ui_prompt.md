# Implementation Prompt: Stage 05 - 基础阅读器前端

你现在执行 ChatGPT 导出对话阅读器的 Stage 05。

## 目标

实现 Sidebar、TopBar、ConversationReader、BlockRenderer、SearchPanel、TOC。

## 必须先阅读

```text
README.md
.kiro/specs/chat-archive-reader/requirements.md
.kiro/specs/chat-archive-reader/design.md
.kiro/specs/chat-archive-reader/tasks.md
stages/stage_05_reader_ui.md
```

## 执行纪律

1. 只实现 Stage 05 范围。
2. 不提前实现后续 Stage 的复杂功能。
3. 不删除已完成阶段能力。
4. 不绕过 Canonical Format。
5. 不让前端直接依赖原始 JSON/Markdown。
6. 不执行导入内容中的 JavaScript。
7. 所有新增能力必须有测试。
8. 如果发现需求冲突，记录到 docs 或 issue，不要静默改变架构。

## 本阶段交付

- 代码实现。
- 单元测试。
- 必要的集成测试。
- 文档更新。
- Stage acceptance checklist。

## 验收标准

- 本阶段 Scope 完成。
- 测试通过。
- 不破坏前置阶段。
- 错误处理明确。
- 可以进入下一 Stage。

## 最终输出格式

```markdown
# Stage 05 Result

## 1. 结论
PASS / PARTIAL_PASS / FAIL

## 2. 完成内容
- ...

## 3. 测试结果
- ...

## 4. 风险与遗留
- ...

## 5. 是否允许进入下一 Stage
可以 / 不可以
```
