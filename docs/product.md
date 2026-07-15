# 产品说明

## 定位

`chat-reader` 是 AI 对话资料库，不是聊天生成客户端。它将导出的会话转换为可长期管理的内部格式，使用户可以阅读、搜索、编辑、组织、分享和再次导出。

## 主要工作流

1. 在 Import 中选择导出文件并查看识别结果、消息数和 warning。
2. commit 导入后任务进入后台队列；全局任务条显示阶段和进度，完成后系统自动刷新会话列表。
3. 在全部会话或 Project 中管理会话，通过阅读器查看长对话。
4. 使用对话索引、当前消息章节 TOC 或搜索结果定位内容。
5. 编辑、拆分或合并内容；历史版本保留。
6. 创建只读分享链接，或导出 Markdown / Canonical JSON。

## 支持的导入

- ChatGPT Exporter JSON。
- ChatGPT Exporter Markdown。
- 匹配的 JSON + Markdown 组合，JSON 提供结构，Markdown 提供展示内容。
- 官方 ChatGPT conversations JSON 的 primary path。

上传入口允许 JSON、Markdown、TXT 和 CSV 文件，但当前稳定 canonical parser 重点覆盖上述 JSON/Markdown 路径。CSV/TXT 不应视为完整格式支持承诺。

## 阅读体验

- user 和 assistant 都支持安全 Markdown。
- GFM 表格、任务列表、删除线、嵌套列表和 blockquote。
- Shiki 浅色代码高亮、语言标签、复制、换行切换和长代码展开。
- KaTeX 数学公式、Mermaid 图表和 Obsidian 风格 callout。
- 消息窗口与 heavy blocks 懒加载，加载进度不会阻塞首屏。
- 对话索引、active-message TOC、搜索定位和目标高亮。
- 手机端采用全宽长文阅读，而不是狭窄的左右聊天气泡。

## 组织与编辑

- 每个会话只有一个可见 Project 归属；未归类会话显示在 Conversation history，移入 Project 后不再重复出现。
- Project 支持展开子会话和桌面拖放移动；移动端使用 Project picker。
- 归档会话会从 history 和 Project 隐藏，但保留归属，恢复后返回原位置。
- Project、全局置顶、Project 内置顶、最近打开和阅读位置。
- 重命名、归档、软删除、Project 移动和批量管理。
- 消息编辑、版本恢复、消息拆分/合并。
- 非破坏式会话拆分/合并；源会话不会被修改。合并顺序可拖动调整，并由后台任务按提交顺序处理。

## 搜索、分享和导出

- 搜索 conversation、message 和 heading，可限制 Project 或当前会话。
- 中文、代码标识符、URL 和符号较多查询使用全文与 substring 混合匹配。
- 分享链接可设置标题、描述和过期时间，可延期或撤销。
- 导出格式为 Markdown 和 Canonical JSON，可限制选中消息并选择 metadata/TOC/version 信息。

## 当前限制

- 单用户本地资料库模型，没有认证和权限隔离。
- 不提供在线 AI 回答、streaming 或重新生成。
- 不展示官方导出中的回答分支切换。
- 没有真正虚拟滚动、语义搜索、标签收藏、HTML/PDF 导出。
- 附件、图片、citation 和 tool UI 目前只有前端扩展能力，没有完整持久化模型。
- PWA 不缓存私有会话，离线只提供提示页。
