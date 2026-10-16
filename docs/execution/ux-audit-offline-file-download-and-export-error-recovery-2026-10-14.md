# UX audit — offline file download and export error recovery — 2026-10-14

这是持续普通用户体验优化中的下一批本地源码修复。本批只处理离线附件下载和离线
导出失败时的错误反馈；不改 IndexedDB 表结构、离线包 v1/v2/v3 兼容、Service
Worker、导出内容合同或服务端接口。不启动服务、不登录、不做浏览器或自动化验证，
用户将自行验收。本记录先于源码修改建立。

## 范围与修改前证据

检查范围：

- `apps/web/features/attachments/offline-conversation-files-panel.tsx`
- `apps/web/features/exporting/offline-export-panel.tsx`
- 相关底层行为：`getOfflineAttachment()`、`getOfflineAttachmentBytes()` 和
  `exportOfflineConversation()`

修改前文件 SHA-256：

| 文件 | SHA-256 |
|---|---|
| `apps/web/features/attachments/offline-conversation-files-panel.tsx` | `D73E52DB2AD7F4C7F1DE27196851F096A70613EEABE766A7AE2B732088899713` |
| `apps/web/features/exporting/offline-export-panel.tsx` | `E7E30B3B1905471B85C69298DD0EB8E843D6A96C7269CBB0552ACAFB416DB565` |

## Findings

### OFFLINE-FILE-DOWNLOAD-ERR-01 · 下载失败直接展示底层异常

| | |
|---|---|
| **Dimension** | Error prevention & recovery / Match with the real world |
| **Severity** | Medium |
| **Confidence** | Observed (code) |
| **Effort** | S |
| **Location** | `apps/web/features/attachments/offline-conversation-files-panel.tsx` |

`getOfflineAttachment()` 找不到本地元数据、缓存读取失败或访问轮次变化时，组件的
`catch` 直接把 `Error.message` 放入 `role="alert"`。这会把 IndexedDB、Cache API
或访问状态的技术文本暴露给读者；“已缓存”列表中的下载按钮也没有稳定的恢复方向。
没有下载地址的记录还通过抛出本地化 `Error` 进入同一 raw-message 分支。

### OFFLINE-EXPORT-ERR-02 · 英文导出失败直接展示异常文本

| | |
|---|---|
| **Dimension** | Error prevention & recovery / Consistency |
| **Severity** | Medium |
| **Confidence** | Observed (code) |
| **Effort** | S |
| **Location** | `apps/web/features/exporting/offline-export-panel.tsx` |

`localizeOfflineExportError()` 在英文界面直接返回传入的底层消息；中文只识别
`256 MiB` 和 `not found`，其他错误虽然已兜底，但中英文行为不一致。底层导出还
可能来自 IndexedDB 事务、访问轮次和本地附件读取，普通用户不应看到这些实现文本。

## Planned local repair

- 没有缓存下载地址时直接显示稳定的“文件未缓存／离线不可下载”提示。
- 其他离线附件下载异常统一显示稳定的中英文恢复提示，不展示原始异常。
- 离线导出保留 256 MiB 和离线对话缺失这两个可行动分类；其他异常统一显示稳定
  的中英文提示。
- 保留现有下载、重试、导出选项、结果清理和附件缺失计数行为；不增加轮询、重试
  风暴、缓存写入或新的资源消耗。

## 实施记录

`offline-conversation-files-panel.tsx` 现在：

- 没有 `download_url` 的记录直接显示“未缓存／离线不可下载”，不再通过抛出
  本地化异常进入 raw-message 分支。
- `getOfflineAttachment()` 或缓存读取的其他失败统一显示稳定的中英文恢复提示；
  仍在 finally 中释放已创建的对象 URL。

`offline-export-panel.tsx` 现在：

- 256 MiB 安全上限继续给出联网导出的明确方向。
- 离线对话不存在时给出重新打开离线资料库的恢复方向。
- 其他本地导出异常在中英文界面都使用稳定兜底文案，不展示传入的底层消息。
- 导出选项、结果 URL 清理、缺失附件计数和现有格式行为保持不变。

修改后文件 SHA-256：

| 文件 | SHA-256 |
|---|---|
| `apps/web/features/attachments/offline-conversation-files-panel.tsx` | `1F32B15E79C42A16DB9DB4D948B4B1C002E71EC652B86E3F20B57273B1BB6173` |
| `apps/web/features/exporting/offline-export-panel.tsx` | `2BC92866F91348F205F54CB78589461F30FF8301BE7AFBD97FC83D330A81BB07` |

## Verification boundary

按用户要求，本批不启动服务、未登录、未运行浏览器／脚本／lint／类型检查／构建，
不提交、未触发 CI 或部署。源码修改不代表运行时验收，由用户自行验证。
