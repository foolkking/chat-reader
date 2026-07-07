# Testing Strategy

## Overview

测试覆盖导入、canonical 转换、数据库、API、前端阅读器、搜索、编辑、性能和安全。

## Unit Testing

### Import Pipeline

- SourceDetector。
- ExporterJsonParser。
- MarkdownParser。
- OfficialJsonParser。
- PrimaryPathResolver。
- JsonMarkdownAligner。
- Cleaner。
- Canonicalizer。
- BlockBuilder。
- HeadingBuilder。
- SearchBuilder。

### Domain Services

- ProjectService。
- ConversationService。
- MessageService。
- SearchService。
- ExportService。

## Integration Testing

- Import preview。
- Import job。
- Conversation message pagination。
- Batch blocks API。
- Search API。
- Export API。

## E2E Testing

Critical paths：

```text
上传 JSON + MD -> 导入 -> 打开会话 -> 搜索 -> 复制
上传官方 conversations.json -> 拆分 -> 导入 -> 查看 source info
编辑消息 -> 查看版本历史 -> 恢复版本
移动会话到 Project -> 置顶 -> 最近打开
```

## Performance Testing

- 500 messages。
- 2000 messages。
- 100MB source file preview。
- Search index rebuild。

## Security Testing

- XSS payload in Markdown。
- External URL sanitization。
- Unauthorized share/raw artifact access。

## Acceptance

每个 Stage 必须满足：

```text
unit tests pass
integration tests pass when applicable
no known data loss
no unsafe rendering
stage acceptance checklist complete
```
