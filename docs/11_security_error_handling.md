# Design Document: Security and Error Handling

## Overview

系统处理用户私密对话导出，因此必须保护原始 artifact、分享链接、导入内容渲染安全，并提供可恢复的错误体验。

## Security Boundary

```text
不执行导入内容中的 JavaScript
不直接信任外部 URL
不渲染未清洗 HTML
不允许 arbitrary file read
分享链接使用随机 token
raw artifact 需要权限控制
```

## Error Categories

1. Validation Errors。
2. Parse Errors。
3. Alignment Errors。
4. Official Graph Errors。
5. Persistence Errors。
6. Search Index Errors。
7. Permission Errors。
8. Rendering Errors。

## Error Response Strategy

```json
{
  "error": {
    "code": "SOURCE_UNSUPPORTED",
    "message": "未识别文件格式",
    "details": {},
    "retryable": false
  }
}
```

## Recovery Mechanisms

- JSON + MD 不匹配时允许 JSON-only。
- 搜索索引失败时创建 rebuild job。
- render_blocks 异常时从 message_versions.blocks 重建。
- 编辑误操作可 Undo 或版本回退。
- 导入失败保留 job error 和 warning。

## Testing Strategy

- HTML sanitization tests。
- Share token access tests。
- Raw artifact permission tests。
- Malformed file fuzz tests。
- Error response contract tests。
