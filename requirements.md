# Requirements: ChatGPT 导出对话阅读器

## 1. 产品目标

系统必须支持将 ChatGPT 导出的 JSON、Markdown、CSV、官方 `conversations.json` 以及第三方 splitter 结果导入，转换成统一的 Canonical Conversation Format，并提供长期阅读、整理、搜索、编辑、合并、分享和归档能力。

## 2. 用户故事

### R1：导入 ChatGPT Exporter JSON + Markdown
作为用户，我希望上传 ChatGPT Exporter 的 JSON 和 Markdown 文件，系统能够自动识别、配对、清洗、转换并展示为接近 ChatGPT 官网的阅读体验。

**验收标准：**
- 能识别 JSON metadata 与 messages。
- 能识别 Markdown 中的 Prompt / Response 分区。
- 能在文件不完全匹配时提示 partial alignment。
- 能删除 Response 开头的导出思考摘要。
- 能保存 raw source artifact。

### R2：导入官方 conversations.json
作为用户，我希望上传官方导出的 `conversations.json`，系统能拆分多个 conversation，解析 mapping / current_node，并导入默认主线消息。

**验收标准：**
- 能识别官方完整 conversations 数组。
- 能识别单个官方 conversation JSON。
- 能从 current_node 回溯 primary path。
- 能保存 source_message_refs，保留 node / branch 溯源。
- 非主线分支第一版不展示，但不丢失来源信息。

### R3：统一内部格式
作为系统维护者，我希望所有来源都转换为统一 Canonical Format，前端不依赖原始 JSON / Markdown。

**验收标准：**
- Conversation、Message、MessageVersion、RenderBlock、Heading、SearchDocument 结构稳定。
- messages 只表达角色与顺序，正文由 message_versions 保存。
- render_blocks 是可重建 read model。

### R4：Project 组织
作为用户，我希望用 Project 管理不同主题的对话。

**验收标准：**
- 支持创建、重命名、删除 Project。
- 支持导入到 Project。
- 支持会话移动到 Project。
- 支持 Project 置顶与 Project 内会话置顶。

### R5：阅读体验
作为用户，我希望像阅读 ChatGPT 官网对话一样阅读历史内容，但不需要输入框。

**验收标准：**
- 支持 Prompt / Response 展示。
- 支持 Markdown block 渲染。
- 支持代码块、表格、引用、标题、分隔线。
- 支持复制消息、复制 Markdown。
- 支持目录、搜索定位、继续阅读。

### R6：搜索能力
作为用户，我希望搜索当前会话、当前 Project 或所有会话。

**验收标准：**
- 支持全文搜索。
- 支持按 role、block type、project、conversation 过滤。
- 搜索结果可跳转到 message / block。
- 搜索不依赖 DOM。

### R7：编辑与版本
作为用户，我希望编辑导入后的消息，但保留原始版本。

**验收标准：**
- 编辑消息生成新 message_version。
- 删除、恢复、拆分、合并生成事件日志。
- 支持版本回退。
- 危险操作支持 UndoToast。

### R8：性能
作为用户，我希望大对话也能流畅打开和滚动。

**验收标准：**
- 消息级虚拟滚动。
- heavy message 支持 block 级懒加载。
- Markdown 不在滚动时解析。
- 左侧栏使用轻量 read model。

### R9：分享与导出
作为用户，我希望分享或导出会话。

**验收标准：**
- 支持导出 Canonical JSON / Markdown / HTML。
- 支持分享完整会话、阅读范围、选中消息。
- 分享链接可取消，可设置过期时间。

## 3. 非功能需求

### 性能
- 左侧栏首次加载目标：< 500ms。
- 普通会话首屏：< 800ms。
- 大会话首屏：< 1500ms。
- 当前会话搜索：< 500ms。
- 全局搜索：< 1500ms。

### 安全
- 不执行导入内容中的 JavaScript。
- 不渲染未清洗 HTML。
- 原始 artifact 需要访问控制。
- 分享链接使用 token。

### 可维护性
- Parser、Cleaner、Canonicalizer、BlockBuilder 分离。
- 每个 Stage 都有测试与验收标准。
- 所有关键决策记录 ADR。
