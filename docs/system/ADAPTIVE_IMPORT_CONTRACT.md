# Adaptive Import Contract

## Adaptive handling classes (2026-08-25)

The analysis response exposes an explicit `handling_class` for every
StructureFamily. The UI uses this field for its primary action:

- `SUPPORTED`: a verified Chat Reader or CanJSON profile is available; show a
  direct-import state and do not open Mapping.
- `MAPPABLE`: deterministic message boundaries were found, but a profile or
  role/content mapping still needs one user confirmation; open the existing
  Mapping Workspace.
- `NOT_MAPPABLE`: the source is not a safely segmentable conversation (for
  example an instruction/document file or invalid source); do not create a
  mapping plan or learned profile. Keep it in the current Import Session and
  offer diagnosis, replacement, exclusion, or contextual Conversation Rescue.

The Web treats this required server field as the only handling authority. It
does not derive capability from `resolution_status`; that status remains a
more detailed lifecycle/profile explanation within the selected class.

`handling_reason` is explanatory metadata with a stable code, detail and
recovery action. `resolution_status` remains the profile/session state and is
not a substitute for the user-facing handling class. A mixed session keeps
resolved families and only blocks import for unresolved retained items.

Repeated role-looking labels alone are not sufficient evidence that Markdown
is a transcript. Context or instruction packages that combine explicit package
markers, instruction sections and line-reference records are classified as
`NOT_MAPPABLE`, even when their historical text contains labels such as
`用户:` or `Assistant:`. They remain eligible for replacement, exclusion and
Conversation Rescue, but never enter Mapping.

The current external conversion default is `chat-transcript-normalizer-skill.zip`.
It produces ChatGPT Markdown Transcript Profile v1, a project-defined interchange
format, not an official OpenAI export schema. Personal Skill selection still wins.
Chat Reader does not execute the uploaded scripts or call an external model.

The adaptive import entry recognizes its ordered bold header and complete message
signatures before generic mapping. Unknown timestamps and assistant model labels
are metadata, not body text. Same-role adjacency is retained; fenced/HTML literal
headings remain body. Model/timestamp displays and historical header values persist
in private SourceMessageRef metadata, separate from canonical message content.
Generated `transcript:N` locators represent file order, not original provider IDs.

The compatibility parser/detector uses the same boundaries. The old
`/api/imports/preview` still requires standardized JSON; standalone transcripts use
`/api/adaptive-import/sessions`. Historical Markdown Skill URLs remain compatibility
resources but are not the current default delivery. Full external serializer and
Context/Offline source-metadata roundtrip acceptance is still pending.

最后核验：2026-08-22。

## 产品边界

Chat Reader 只有两个导入入口：

- `JSON / Markdown`：确定性分析已知或用户学习过的对话格式；支持单 JSON、单 Markdown、JSON + Markdown 和批量文件。
- `.cr` 归档：独立的完整归档恢复流程，不进入 Mapping 或 Profile 匹配。

Chat Reader 是唯一产品。原 AI Conversation Normalization Gateway 已退役，不存在独立品牌、页面、转换结果、下载后再上传或 `.crbundle` 产品流程。它的确定性 Analyzer、候选检测与 Mapping 思路被内化为 Chat Reader 能力；不使用 LLM、爬虫或用户脚本。

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

`ImportSession` 使用 `COLLECTING / ANALYZING / NEEDS_GROUPING / RESOLVING / READY / IMPORTING / COMPLETED`，并可进入 `BLOCKED / FAILED / CANCELED`。`INVALID` 是 Family/InputGroup 的条目级状态，不会把整个 session 变成 `BLOCKED`；同一批次中其他 UNKNOWN/DRIFTED Family 仍可完成 Mapping。`BLOCKED` 只保留给旧会话恢复或真正无法继续的 session 状态。关闭 Overlay 会在当前浏览器会话中保留可恢复的 session；明确重新选择文件会取消 session 并清理该 session 的临时来源。

一个 `InputGroup` 是最终形成一个 Conversation 的 JSON、Markdown 或配对文件集合。文件名只作保守 pairing hint。一个 JSON 和一个 Markdown 可直接配对；多文件混合时只有 normalized stem 唯一匹配的 pair 自动成立，其余进入 Group Resolver。

未提交 session 可以随时重新打开 Group Resolver。分析失败的 Group 可以原位替换单个来源文件，或从本次导入中排除；最后一个 Group 不能被排除，必须替换来源或取消 session。替换/排除完成后自动重建 Family 与 ImportPlan。数据库状态先提交，随后才删除被替代的 session 临时文件，因此恢复失败不会先破坏原选择。

`StructureFamily` 只属于当前 session。系统按无正文的结构签名聚类，让同一 Family 只 Mapping 一次，再对 Family 的全部 InputGroup 执行 normalization 和 validation。

一次 session 最多 500 个来源文件、总计 512 MiB；每个导入文件受 500 MiB 上限约束。API 在读取正文前检查文件数量和 spooled 文件大小，按 1 MiB chunk 有界读取；超过 10 MiB 的分析进入单并发 admission gate，并在系统可用内存低于保留水位时返回可重试的 429。反向代理对 Adaptive、Import Preview 和附件上传的精确路径开放 520 MiB multipart 容量；批次总量仍为 512 MiB。

## Profile 与 Revision

Profile 分为：

- `BUILTIN`：Chat Reader Native JSON / Markdown、CanJSON v1、CanJSON v2、Prompt/Response Markdown。可查看，不可改名、禁用或删除。
- `LEARNED`：用户对 UNKNOWN Family 完成 Mapping 并通过全 Family 校验后获得版本授权。可修改个人显示名称、停用自动识别、查看有权使用的历史版本及重新学习；不提供独立新建或上传格式包。

修复 DRIFTED 格式时，完全等价配置复用已有 revision；配置变化才创建新的 VERIFIED revision，不覆盖旧 revision。Matcher 在用户有权使用的 VERIFIED/SUPERSEDED revision 中进行匹配，因此旧来源结构仍能继续导入。

Migration `20260930_0035` 引入个人版本授权、系统发布、个人偏好与旧 ID 别名。学习立即授予该版本；通过系统版本成功提交 canonical 导入后，在同一事务授予所用版本。格式身份独立于来源账户，删除原作者将来源关联置空，保留历史及他人授权。

管理员发布明确且通过全 Family 验证的 revision，个人修复不会自动更新系统发布。撤回仅取消公共可用性，不撤销既有授权。导入已选定的版本保留在该 session，重新分析时仍可匹配；永久授权仍需成功提交。用户列表按稳定身份合并个人持有和系统提供，并标明实际可用的当前版本。个人名称和启停不影响他人。

配置身份包含规范化结构、映射、受控转换、验证规则和 matcher/normalizer 版本。名称、样本和来源账户不参与等价比较。相同结构但映射或转换不同保持独立，继续走歧义确认。历史重复格式只有完整 revision 配置集合一致时才建立别名，保留旧 ID 和 revision 父关系。迁移先建立旧用户授权，且不自动发布全系统。

管理员候选只返回白名单映射、验证计数和来源账户是否存在；不返回原作者私人名称、样本正文、来源文件名或对话信息。发布名称由管理员明确设置。旧 DELETE 接口只隐藏该用户的格式入口，不删除身份、版本或授权；新用户界面不再提供此操作。

匹配结果为 `EXACT_MATCH / COMPATIBLE / DRIFTED / AMBIGUOUS / UNKNOWN / INVALID`。Hard requirements 与 semantic guards 不满足时不能自动套用；unknown role、required mapping 漂移、关系不完整或竞争 Profile 会阻断自动导入。文件名只能影响候选排序。

Profile 只保存结构、selector、role value mapping、relation、noise rule、受控 transform 和 matcher metadata，不保存用户正文或完整样本。原 Gateway 的 SQLite Profile/Revision/Mapping 表在合并前为空，因此没有历史用户 Profile 可迁移；开发 fixture 不进入正式 schema。

## Mapping 与验证

### Full-family health checks (working tree, 2026-10-01)

Settings' Relearn / repair entry accepts representative source files through the
existing import session. Its health action checks the session's pinned saved
revision (or built-in parser), independently of an unsaved mapping draft. It
normalizes every group, reports each group's issues and exposes a repair entry.
Results and check time persist in the owned Family's `match_evidence.health_check`;
source replacement/regrouping creates a new Family and invalidates the result.
This is a check of the submitted batch, not a claim about every future source.
It creates no conversation, grant or profile revision and does not change the
published format's verification status. Missing sources are reported without
exposing server paths. A pinned session can still be checked after withdrawal.

Recognition, health, mapping preview and confirmed learning use one full-family
validator. A failing member does not stop the remaining groups or copy its error
onto valid groups. Only a bounded selected sample is retained for preview; a
failed selected source never silently displays a different source's preview.
Repair preloads the saved mapping and allows selecting another source content
field from analyzer-provided field paths. New configurations still require full
batch validation before a version is learned. Health result pages contain up to
20 groups, with an optional failed-only filter. No new migration is needed.

统一 Mapping Workspace 根据 `source_mode` 显示 JSON、Markdown 或 JSON + Markdown。JSON Mapping 包含 message locator、role/content/title/timestamp source；Markdown Mapping 使用 Analyzer 候选 boundary；配对模式额外支持 `ORDER / ID / ROLE_TIMESTAMP` relation。

Role source 与 role value conversion 分开保存。`human/ai` 等来源值可映射为 canonical role；未知值必须由用户确认，不能静默降级为 assistant。Noise v1 只支持确定性的 `KEEP / IGNORE`。Transform 仅允许系统定义、可序列化且不可执行任意代码的操作。

Markdown Analyzer 只把已识别的角色标签作为消息边界。当前确定性词典包括常见英文标签以及 `用户`、`提问者`、`助手`、`AI助手` 等中文标签；`ChatGPT *(model-name)*` 一类模型装饰不属于角色身份。Normalization 必须复用 Mapping 已确认的标签集合，因此消息正文里的同级标题或以冒号结尾的普通句子不会被切成伪消息。

Preview 展示 canonical title、message sequence、role、content 和 timestamp。验证覆盖当前 Family 的所有 InputGroup；Diagnostic 包含 layer、pointer、阻断状态和 action。Mapping 内的 Diagnostic 可定位到来源结构、locator、role mapping 或 relation；文件级错误在 Import Overview 显示只读位置上下文以及替换、排除和重新组合动作，不提供无效的 Mapping 定位按钮。

`handling_class` 同时是服务端能力边界。`NOT_MAPPABLE` Family 对 Mapping preview、Mapping save 和已保存 Profile selection 均返回结构化 `FAMILY_NOT_MAPPABLE`，不生成 canonical preview、Mapping draft 或 Learned Profile；前端隐藏入口不是唯一保护。

## UI 与设置

Import Overview、分组和 Mapping Workspace 的操作文案跟随账户语言；来源正文、
文件名和角色原值保持原样。Mapping 未保存时关闭或返回需明确放弃，取消后保留
草稿并恢复焦点；页面卸载提供浏览器保护。验证/保存期间禁止修改映射、切换示例、
重复提交与关闭。连接失败显示可重试说明并保留输入；验证覆盖完整 Family，
成功后才允许保存。文件级诊断只提供实际可执行的修复动作。

普通导入停留在现有轻量 Dialog。复杂 grouping、UNKNOWN、DRIFTED 或 AMBIGUOUS 时扩展为 Chat Reader 内的大型 Overlay，只有三个工作视图：Import Overview、条件式 Group Resolver、统一 Mapping Workspace。没有独立转换产品导航或结果下载页。

设置中的“我的导入格式”优先展示已学习及系统提供的结果，随后展示内置格式。个人改名显式保存并有草稿退出保护；来源、可用版本与验证摘要合并为一条记录。发生结构漂移时，通过重新导入代表性来源进入“重新学习／修复”。管理员专区的“系统导入格式”支持候选分页、配置查看、明确版本发布和撤回。

设置页的“修复格式”会把下一次代表性 JSON/Markdown session 显式绑定到目标 Learned Profile。来源必须形成恰好一个相同 source mode 的 Family；否则安全拒绝。验证通过后创建新 Revision，不通过删除旧 Profile 来重建。

## 安全与兼容

- `.cr` 保持独立兼容恢复。
- 已有 Chat Reader JSON/Markdown 与 CanJSON v1/v2 通过 Built-in Profile 接入统一 resolution contract。
- Profile signature 不包含正文；来源临时文件沿用受控 Import artifact 生命周期。
- `.crbundle` import route、UI、parser、测试 fixture 和 download-first 产品流程已删除；普通附件、AssetObject、Share/Offline 附件以及 `.cr` 中的附件关系保持不变。
- 批量提交沿用现有 ImportDraft 与 canonical persistence 的事务/worker 语义，不把失败项误报成功。
