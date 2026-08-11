# 产品说明

## Current Reader and merge behavior

- Source editing is a persistent Markdown workspace, not a replacement for the rendered message. The desktop panel is left anchored and large; the main reader temporarily makes room. Mobile uses a full-width surface.
- Top-level actions are `Edit -> Search -> Annotations -> Focus -> More`; open workspace actions toggle closed. Share/export/merge/split remain in `More`. Share and Offline Reader remain read-only.
- Merge is non-destructive and canonical: it copies complete message version history, blocks, source refs, annotations and conflict copies, while excluding notebooks. Long merges are cancellable and use bounded batches with a three-attempt stale retry limit.

最后核验：2026-08-05

## 定位

Chat Reader 是单资料拥有者使用的标准化 AI 对话资料库，不是在线聊天客户端、OpenAI 官方导出解析器或任意厂商原始格式兼容层。它接收已经线性化的内容并转换为稳定 canonical 数据，帮助用户长期阅读、检索、批注、整理、分享和备份。

## 主要工作流

1. 选择导出文件，检查格式识别、会话预览和 warnings，再显式提交导入。
2. worker 完成 canonical 构建后，从未归类列表或 Project 打开会话。
3. 通过对话索引、章节目录、搜索、批注或最近位置进入目标正文。
4. 阅读时保存稳定 message/block/offset；重新打开或刷新后恢复。
5. 编辑消息并保留历史版本，或归档、移动、拆分、合并和批量管理资料。
6. 创建受限只读 Share、导出文件，或将资料增量更新到 `/library`。

## 导入与数据

- 产品导入支持兼容 JSON（Markdown 可选配对）、标准附件 `.crbundle` 和旧 Chat Reader `.cr` 兼容归档。CanJSON v1/v2 由 JSON 控件自动识别。
- OpenAI 官方 conversations JSON/ZIP、CSV、TXT、第三方 splitter 和 Markdown 单文件提交均返回 `422 unsupported_source_profile`；既有历史 conversation 不迁移、不删除。
- 形式 1 以 JSON 的 metadata/role/time、源索引和冲突判断为权威；配对时用完整 JSON 角色/时间/顺序序列排除正文和代码示例中的伪 `Prompt`/`Response` 标题，只有唯一最佳完整路径才放行。消息配对有效时以 Markdown 为显示正文，未提供 Markdown 时才使用 JSON `say`。
- preview 写入带校验和和过期时间的受控 ImportDraft JSONL，不写 canonical；commit 校验并流式读取同一 Draft 后进入 PostgreSQL durable queue。
- 第一版消息版本永久不可覆盖/删除；第二版及以后只有用户显式选择“保存到当前版本”时可覆盖，普通编辑仍创建新版本。Reader 只读取 current version 和对应 RenderBlock，不直接渲染 raw source artifact。

## 阅读体验

- Reader 以完整 user-led turn 为加载单位，稳定 DOM 最多 3 轮；超长消息不会先显示截断正文或“立即展开”占位。
- 极长消息（`block_count > 160` 或 `char_count > 50000`）仅虚拟化已完整加载的 blocks，overscan 为 8；导航目标固定挂载到事务结束。
- 远距离导航按 quote、character offset、block、message 依次降级，并在图片、字体和布局稳定后复校。
- 支持 GFM、代码高亮、KaTeX、Mermaid、callout、表格、任务列表、引用和安全链接。
- 桌面保留对话索引与章节 TOC；移动端通过阅读导航 Sheet 使用同一数据。
- 正文宽度、Markdown 垂直间距和 15-22px 字号可独立设置；专注模式可只保留正文。

## 组织与编辑

- 侧栏同时显示可折叠 Project 与未归类对话；一个可见会话最多归属一个 Project。
- 桌面支持拖放移动、Shift 范围选择、键盘选择和上下文批量工具栏；移动端保留单项管理。
- 归档会话保留 Project 关系，取消归档后返回原归属；删除是不可恢复的事务性硬删除，不提供 Trash。
- 消息信息栏在正文上方提供收藏、选择、Markdown 源码编辑和 ChatGPT 风格的单消息版本切换，不遮挡 Markdown。桌面顶栏常驻编辑、搜索、批注和专注，详细操作进入更多；移动端常驻导航、编辑和更多。
- 源码编辑器按需加载为不遮罩正文的浮动工作区，原消息高度保持不变；桌面可拖动/缩放/复位，移动端为全宽面板。真实阅读滚动单向同步源码，干净状态可跨消息跟随，脏状态锁定并要求保存或放弃；保存后浮窗保持打开且正文位置由真实 DOM 锚点补偿。
- 普通编辑和恢复创建新 MessageVersion；v2+ 可显式覆盖或永久删除，选择版本会持久化且只影响当前消息。第一版永久保护。
- 对话拆分支持连续区间、边界双份和离散消息三种预览式复制；会话级拆分/合并创建新会话，不修改来源会话。单消息按字符拆分只保留兼容 API，不在 Reader 暴露。
- 桌面不显示“最近”入口或首页卡片；移动端保留继续阅读卡片，`/recent` 路由仍兼容旧链接。

## 搜索、批注与精选笔记

- 全局搜索覆盖 conversation、message、heading、code 和 annotation；中文、URL、标识符和符号查询结合全文与 trigram 子串。
- Reader 内搜索提供结果计数、角色/内容筛选、命中高亮和统一远距离定位。
- 批注支持 highlight、underline、strikethrough、comment 和 bookmark，以及黄/绿/蓝/粉四种颜色。
- 批注工作区可浮动、固定到左侧或展开为全屏阅读层；“全部批注”和“精选笔记”支持连续阅读与逐条回顾。
- 精选笔记由 Markdown 说明和 annotation reference 组成；移除引用不会删除原批注。

## 分享、导出与离线

- Share token 只在创建时返回原文；数据库仅保存 hash/prefix。scope、过期、撤销、private include flags 和 `allow_export` 由每个公开接口重新校验。
- 对话导出只显示 CanJSON、Markdown 和“包含附件”：无附件分别输出 `.canjsonl`/`.md`，含附件分别输出 AI 承接 `.context.zip`/可移植 Markdown ZIP。系统 `.cr v4` 位于设置的数据与备份，保存完整版本与关系并只允许恢复到空实例；旧对话级 `.cr` 只保留导入兼容。
- 需要携带二进制附件时可导出 `Markdown + 附件` 或 `CanJSON + 附件` Bundle；物理对象按 SHA-256 内容寻址。简介、批注、笔记和来源引用作为折叠的二级内容选项，不增加新的顶级格式。
- 当前单用户部署主动关闭附件恶意软件扫描和内容安全审查；附件以 `scanner_disabled`/`unscanned` 状态正常使用，中文 UI 显示“未扫描”，不显示 clean/safe 或“已通过扫描”。这不代表文件经过安全检测。正文附件只采用 rich、compact、file-card、fallback 四种层级；连续图片/文件会分组。Viewer 的遮罩属于全页面，但实际内容窗口按类型受限：图片/视频为深色舞台，音频为紧凑面板，Markdown/文本/表格/PDF 为文档工作区。SVG 始终通过 `<img>` 显示。
- 在线 Owner Reader 的 GFM 任务 checkbox 可点击并立即保存；第一次切换从 v1 创建 v2，后续在 v2+ 覆盖当前消息版本。Share、Offline 和附件 Markdown 保持只读。
- `/library` 是独立 PWA scope。首次需在线准备壳并下载资料，之后可离线阅读、搜索和编辑批注/精选笔记；离线附件可选择仅 metadata、小附件或全部附件。
- 离线更新提交本地 conversation revisions，服务端 v3 package 只传输新增或变化的 conversation；浏览器仍兼容 v1/v2 包。
- 变化 conversation 在单个 Dexie transaction 中替换，未变化数据不传输、不重写；本地待同步批注/笔记和更新的阅读位置受到保护。

## 当前限制

- 固定主体 `local:default`，没有登录、多用户、租户隔离或应用内管理员。
- 不提供在线 AI 回答、streaming、重新生成或分支切换 UI。
- 没有完整消息/轮次虚拟列表；极长消息 blocks 会虚拟化 DOM，但该轮完整正文数据仍进入内存。
- 不提供标签、全局笔记中心或语义搜索；`.crbundle` 是附件导入包。普通上传、左侧对话文件管理工作区、已有附件拖入源码、消息插入和基础预览已经实现；King 扫描器关闭时附件显示“未扫描/scanner_disabled”。消息保存不重新上传或扫描已提升的文件，Reader 只局部替换受影响消息。
- 附件文件名和受限 `text_extract` 派生文本进入现有全文搜索；复杂 Office/OCR/CAD/压缩包预览为 `NOT_IMPLEMENTED`，只提供受控下载，不阻塞基础附件链路。
- 浏览器离线数据受配额、持久化授权和清除站点数据影响。
- 应用本身不构成公网访问控制；部署方必须提供 HTTPS、认证/网络限制和备份。
