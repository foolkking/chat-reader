# UX audit — Reader share panel read recovery

2026-10-14（本地日期）。本批继续普通用户恢复性审查，只修改阅读器内
分享管理面板的列表读取错误分支。没有登录、没有启动服务、没有使用线上页面；
用户明确要求本批不做本地或浏览器验证，后续由用户自行验收。

## Scope & evidence

范围是 `apps/web/features/sharing/share-panel.tsx` 中已创建分享链接列表的
读取、缓存保留和错误恢复。设置页“我的分享”的独立恢复修复由
[`ux-audit-share-transient-read-2026-10-13.md`](ux-audit-share-transient-read-2026-10-13.md)
负责，本批不重复修改。

修复前源文件 SHA-256：
`26AE7F10CF8BA1690F6A0CBB94852ED7839BD3EF1DD4B675DF44720795CEA7C0`

### ERR-SHARE-PANEL-READ-01 · 分享列表读取失败没有局部恢复入口

| | |
|---|---|
| **Dimension** | Error prevention & recovery / System status |
| **Severity** | Medium |
| **Confidence** | Observed (source) |
| **Effort** | S |
| **Location** | `apps/web/features/sharing/share-panel.tsx` |

**Evidence.** `getConversationShares` 使用默认 `useQuery`，列表失败时只渲染
`sharesQuery.error.message`，没有局部 `refetch()` 控件。列表本身使用
`(sharesQuery.data ?? [])`，因此已有缓存可以继续显示，但错误分支没有告诉读者
这是旧列表，也没有提供在当前面板恢复读取的入口。底层 API 错误可能是面向
开发者的状态或服务文本，不适合作为稳定的用户界面文案。

**Why it matters.** 阅读器内分享面板发生短暂代理、网络或 API 读取失败时，
读者既看到技术细节，又必须关闭面板或重新进入才能恢复。已有的分享链接仍在
缓存中时，这会把可继续使用的旧结果误呈现为不可用状态。

## Implemented narrow repair

列表读取错误现在使用稳定的中英文用户文案，并提供当前面板内的只读“重试”
按钮。已有列表继续保留；有缓存时会明确说明正在显示上次结果，没有缓存时显示
初始读取失败。重试期间按钮禁用，且只重新执行同一个 GET 查询。

本批没有加入自动轮询、写操作重试、缓存格式变化、分享 URL 或权限语义变化。
创建、更新、撤销分享的写入错误路径保持原状。

## Verification boundary

按用户要求，本批不运行服务、浏览器、脚本测试、lint、typecheck、build、CI
或部署。后续人工验收应覆盖：首次读取失败、已有缓存下失败、重复点击保护、
重试恢复，以及读失败时不再显示底层错误详情。
