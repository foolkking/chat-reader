# UX 审查与修复前证据：内嵌附件预览残留旧内容

日期：2026-10-14

## 范围与证据

本次审查覆盖 Reader 消息中的内嵌 Markdown、文本、代码、JSON 和表格
预览在附件切换、重新读取和网络失败时的内容生命周期。证据来自当前源码；
没有启动服务、浏览器、测试或构建，因此没有真实网络时序采样。

已查看：

- `apps/web/features/attachments/attachment-block.tsx`
- `apps/web/features/attachments/attachment-viewer.tsx`

## 发现

### DATA-ATTACHMENT-03 · 新附件读取期间仍显示上一附件文本

| | |
|---|---|
| **Dimension** | Data display / Feedback |
| **Severity** | High |
| **Confidence** | Observed (code); wrong-content window Inferred |
| **Effort** | S |
| **Location** | `apps/web/features/attachments/attachment-block.tsx:145–172` |

**Evidence.** `InlineTextPreview` 的 effect 在 `attachment.content_url` 改变
时启动带 `AbortController` 的新 Range 读取，但 effect 开始时没有执行
`setText(null)`，失败分支也只写入 runtime 状态而不清空已有 `text`。因此
组件复用到另一个附件或新读取失败时，上一附件的文本仍可渲染在当前附件标题
下；加载指示器只在 `text === null` 时出现。

**Why it matters.** 用户查看连续消息中的附件时，会先看到错误的正文，且在
新请求失败时没有明确的“当前附件不可用”空状态。这是内容身份错误，不只是
加载闪烁，尤其影响代码、JSON 和表格核对。

## 修复契约

- `content_url` 改变或重新读取开始时立即清空旧文本，并回到加载状态。
- 当前读取失败时不显示上一附件文本，保留现有 runtime 失败反馈和打开完整预览
  入口。
- 不改变 128 KiB Range 上限、AbortController、表格/Markdown 渲染、附件下载
  或 viewer 查询语义。
- 本报告在源码编辑前写入；本批不启动服务，不运行浏览器、测试／构建，不提交、
  不触发 CI，也不部署，运行时效果由用户后续验证。

## 已实施的源码修复

内嵌预览在 `content_url` 改变或重新读取开始时立即清空文本并收起展开状态，
因此在新 Range 请求完成前只显示加载状态；请求失败时不会回退显示上一附件的
文本。原有 128 KiB 读取上限、取消请求、错误反馈、渲染方式和完整 viewer
入口保持不变。

本批仅做源码与文档修复，未启动服务、运行浏览器、测试／构建／静态验证，未提交、
未触发 CI，也未部署；运行时效果由用户后续验证。
