# 复杂附件子视图状态隔离审查（2026-10-14）

## 范围与修改前证据

本记录先于本批源码修改建立，范围是浏览器内 DOCX/ODT、XLSX/ODS、
PPTX/ODP 与 ZIP 只读预览。按用户当前要求，本批不启动服务、不登录、
不运行浏览器或自动化验证、不提交 CI、不部署。

修改前文件：

- `apps/web/features/attachments/complex-attachment-viewer.tsx`
- 修改前 SHA-256：`CF5ABCBB52CA19B0CF10C2999073DBEA79E52C00802F11D092E7B1126D204D9E`

源码证据：

- `ComplexAttachmentViewer` 按 `result.kind` 渲染 `SpreadsheetView`、
  `PresentationView` 或 `ArchiveView`，没有把附件身份传给这些子视图。
- `SpreadsheetView` 的 `sheetIndex`、`PresentationView` 的 `index` 和
  `ArchiveView` 的 `selectedPath` 都是子组件本地状态，只在首次挂载时初始化。
- 同一种类型的附件切换时，React 会复用同一个子组件实例；旧附件的页签、
  幻灯片或目录路径因此可能继续保留。新附件没有对应路径时会出现空白/空状态，
  或者用户停留在并不属于当前附件的子视图。

这属于身份切换造成的阅读状态错误，不是服务端数据损坏的证据；解析结果仍会
在新读取开始时清空，下载与原文件内容不受影响。

## 处理决策

以附件 ID 加当前资产哈希（无哈希时回退 content URL）作为复杂预览子视图的
React key。更换附件或同一附件替换资产时，工作表、幻灯片和压缩包目录都会
从第一个有效子项重新开始；不增加解析、网络请求、Worker、定时器或渲染预算。

## 本地实现与边界

已在 `ComplexAttachmentViewer` 的三类有本地导航状态的子视图上加入身份 key，
身份由附件 ID 与资产 SHA-256 组成，无资产哈希时回退到内容 URL。
文档段落视图没有本地选择状态，不需要额外处理。没有改变 Worker、50 MiB
输入上限、重试、下载、Blob URL 释放或附件权限语义。

本批不宣称浏览器布局、真实焦点、CPU/RSS 或运行时验收结果；用户可在后续自行
验证附件类型切换和资产替换场景。
