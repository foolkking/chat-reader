# Adaptive Import Contract

最后核验：2026-08-22。

## 产品边界

Chat Reader 只有两个导入入口：

- `JSON / Markdown`：确定性分析已知或用户学习过的对话格式；支持单 JSON、单 Markdown、JSON + Markdown 和批量文件。
- `.cr` 归档：独立的完整归档恢复流程，不进入 Mapping 或 Profile 匹配。

原 AI Conversation Normalization Gateway 已退役，不存在独立品牌、页面、转换结果、下载后再上传或 `.crbundle` 产品流程。它的确定性 Analyzer、候选检测与 Mapping 思路被内化为 Chat Reader 能力；不使用 LLM、爬虫或用户脚本。

## 稳定数据流

```text
SourceFile[]
-> ImportSession
-> InputGroup[]
-> StructureFamily[]
-> ImportProfileRevision match or Mapping
-> CanonicalConversationDraft[]
-> full-family validation
-> ImportPlan / ImportDraft
-> existing canonical persistence service
-> PostgreSQL
```

`CanonicalConversationDraft` 是格式适配与数据库实体之间的稳定边界。Mapping 不接触 ORM entity，也不通过生成临时 Chat Reader export 再调用旧 importer。Profile 验证成功与数据库提交成功是两个状态：提交失败不会把已经验证的 Profile 标记为无效。

## Session、Group 与 Family

`ImportSession` 使用 `COLLECTING / ANALYZING / NEEDS_GROUPING / RESOLVING / READY / IMPORTING / COMPLETED`，并可进入 `BLOCKED / FAILED / CANCELED`。关闭 Overlay 会在当前浏览器会话中保留可恢复的 session；明确重新选择文件会取消 session 并清理该 session 的临时来源。

一个 `InputGroup` 是最终形成一个 Conversation 的 JSON、Markdown 或配对文件集合。文件名只作保守 pairing hint。一个 JSON 和一个 Markdown 可直接配对；多文件混合时只有 normalized stem 唯一匹配的 pair 自动成立，其余进入 Group Resolver。

`StructureFamily` 只属于当前 session。系统按无正文的结构签名聚类，让同一 Family 只 Mapping 一次，再对 Family 的全部 InputGroup 执行 normalization 和 validation。

一次 session 最多 500 个来源文件、总计 512 MiB；每个文件继续受 50 MiB 上限约束。API 在读取正文前检查文件数量，按 1 MiB chunk 有界读取并逐文件写入受控 session storage，内存中不会同时保留整个批量来源。反向代理只对精确的 Adaptive session 创建路径开放 520 MiB multipart 容量，其他业务路由不扩大。

## Profile 与 Revision

Profile 分为：

- `BUILTIN`：Chat Reader Native JSON / Markdown、CanJSON v1、CanJSON v2、Prompt/Response Markdown。可查看，不可改名、禁用或删除。
- `LEARNED`：用户对 UNKNOWN Family 完成 Mapping 并通过全 Family 校验后保存。可改名、禁用、删除和查看历史版本。

每次修复 DRIFTED 格式创建新的 VERIFIED revision，不覆盖旧 revision。Matcher 会考虑 current 与仍有效的历史 VERIFIED/SUPERSEDED revision，因此旧来源结构仍能继续导入。

匹配结果为 `EXACT_MATCH / COMPATIBLE / DRIFTED / AMBIGUOUS / UNKNOWN / INVALID`。Hard requirements 与 semantic guards 不满足时不能自动套用；unknown role、required mapping 漂移、关系不完整或竞争 Profile 会阻断自动导入。文件名只能影响候选排序。

Profile 只保存结构、selector、role value mapping、relation、noise rule、受控 transform 和 matcher metadata，不保存用户正文或完整样本。原 Gateway 的 SQLite Profile/Revision/Mapping 表在合并前为空，因此没有历史用户 Profile 可迁移；开发 fixture 不进入正式 schema。

## Mapping 与验证

统一 Mapping Workspace 根据 `source_mode` 显示 JSON、Markdown 或 JSON + Markdown。JSON Mapping 包含 message locator、role/content/title/timestamp source；Markdown Mapping 使用 Analyzer 候选 boundary；配对模式额外支持 `ORDER / ID / ROLE_TIMESTAMP` relation。

Role source 与 role value conversion 分开保存。`human/ai` 等来源值可映射为 canonical role；未知值必须由用户确认，不能静默降级为 assistant。Noise v1 只支持确定性的 `KEEP / IGNORE`。Transform 仅允许系统定义、可序列化且不可执行任意代码的操作。

Markdown Analyzer 只把已识别的角色标签作为消息边界。当前确定性词典包括常见英文标签以及 `用户`、`提问者`、`助手`、`AI助手` 等中文标签；`ChatGPT *(model-name)*` 一类模型装饰不属于角色身份。Normalization 必须复用 Mapping 已确认的标签集合，因此消息正文里的同级标题或以冒号结尾的普通句子不会被切成伪消息。

Preview 展示 canonical title、message sequence、role、content 和 timestamp。验证覆盖当前 Family 的所有 InputGroup；Diagnostic 包含 layer、pointer、阻断状态和 action，UI 可定位到来源结构、locator、role mapping 或 relation。

## UI 与设置

普通导入停留在现有轻量 Dialog。复杂 grouping、UNKNOWN、DRIFTED 或 AMBIGUOUS 时扩展为 Chat Reader 内的大型 Overlay，只有三个工作视图：Import Overview、条件式 Group Resolver、统一 Mapping Workspace。没有独立转换产品导航或结果下载页。

设置中的“导入格式”展示 Built-in 与 Learned Profile。Learned Profile 可管理名称、启用状态和历史 revision；发生结构漂移时，通过重新导入代表性来源进入“修复导入格式”，成功后保存新 revision。

设置页的“修复格式”会把下一次代表性 JSON/Markdown session 显式绑定到目标 Learned Profile。来源必须形成恰好一个相同 source mode 的 Family；否则安全拒绝。验证通过后创建新 Revision，不通过删除旧 Profile 来重建。

## 安全与兼容

- `.cr` 保持独立兼容恢复。
- 已有 Chat Reader JSON/Markdown 与 CanJSON v1/v2 通过 Built-in Profile 接入统一 resolution contract。
- Profile signature 不包含正文；来源临时文件沿用受控 Import artifact 生命周期。
- `.crbundle` import route、UI、parser、测试 fixture 和 download-first 产品流程已删除；普通附件、AssetObject、Share/Offline 附件以及 `.cr` 中的附件关系保持不变。
- 批量提交沿用现有 ImportDraft 与 canonical persistence 的事务/worker 语义，不把失败项误报成功。
