# 当前用户流程

## Current account flows (deployed, 2026-09-02)

```text
first deployment -> operator provisions one ADMIN interactively
closed/invite/open registration -> email + strong password -> USER workspace
login -> opaque HttpOnly session -> owner-scoped Reader/Projects/Import
account security -> password/session management -> global revocation on change
ADMIN -> registration mode, invitations, user status and reset grants
```

The migrated legacy archive belongs to the single deployment administrator.
Share links remain token-scoped and Offline remains a local snapshot. These
flows are implemented, API-tested and deployed. Authenticated production
browser verification remains `NOT_VERIFIED` until the operator runs the Web
acceptance flow.

## Settings, Tasks and import completion (deployed 2026-09-02)

The global shell footer is named `Settings`. Its lightweight surface owns
appearance/reading preferences and the Offline Library shortcut. A normal user
sees only the personal management categories `Account & security`, `Data
archive` and their own `Skill management`. Import formats and the noise rule
library are system-maintenance controls and are visible only to the Root Admin;
the administrator additionally sees the Administration section. Consequential
or multi-field work opens a focused dialog; dirty password, profile or backup
options cannot be silently discarded, and closing returns through the Settings
hub to the original opener without reloading Reader content.

`Tasks` is a global shell entry for delayed owner work. The existing monitor is
reused for imports, merges, ordered batch deletion, exports and cleanup scans.
Leaving the originating page, refreshing, or switching desktop/mobile
presentation does not change task ownership. Closing the task surface only
dismisses presentation; cancellation keeps the existing per-task semantics.

Import commit has an explicit terminal state. A batch remains in the Import
surface with committed conversation/message counts, warnings and actions to
view the imported set in Library, open the first conversation, or close and
return to the opener. A single import keeps a direct `Open conversation`
action, but no import silently navigates to the first item.

## Owner Skill management (deployed 2026-09-02)

Settings includes a focused Skill management dialog for Export Context and
Conversation Rescue Skills. System defaults are immutable; owner-uploaded UTF-8
Markdown files (512 KiB max) are saved without auto-activation and require an
explicit per-language preferred selection. Disabled or deleted selections fall
back to the system default. Offline and public Share surfaces never access this
owner registry.

## Offline Reader and Context Package (2026-08-11)

When the user opens `/library`, an existing complete offline shell is immediately readable. Resource reconciliation runs in the background and may show a non-blocking update failure; it must not disable `Update conversations`. A first-time device may show that the shell is still preparing, but online navigation remains usable.

Inside an offline conversation, `More -> Current conversation files` is available in the same location as the online Reader. The panel is read-only. A cached attachment can be viewed/downloaded through the unified Viewer; a missing original says `offline-unavailable` and does not spin forever. No server file list or management action is requested.

Offline `Export` creates CanJSON/Markdown locally from the downloaded snapshot. When a local `.context.zip` is ready, the two-step handoff is: (1) upload the Context Package to the new AI, (2) paste the selected parsing Skill. The result offers download, copy and inert text viewing in Chinese or English. Download also attempts copy in the same gesture; a browser clipboard denial is visible and retryable.

## Reader source workspace and merge cancellation (current)

1. Desktop Reader keeps `Edit`, `Search`, `Annotations`, `Focus`, and `More` in that order. Search/annotations/source are mutually exclusive; clicking an open source or annotation action closes it. Share, export, merge, and split remain in `More`.
2. Markdown source opens as a fixed left workspace at 1024px+, covering sidebars while retaining their state. The Reader captures its original main-column edge before opening and yields exactly enough space to keep the main column beyond the workspace. Only the right edge resizes; closing restores the original layout and reading anchor.
3. Smaller widths use a full-width panel. Light/dark CodeMirror themes reconfigure without replacing document, cursor, undo history, or unsaved content. Clean reader scrolling follows through RAF; dirty content locks its message until save/discard/return.
4. A merge copies canonical data in bounded batches. The monitor exposes `取消合并` and `正在取消`; cancellation rolls the target transaction back. Successful publication happens once and leaves sources unchanged.

最后核验：2026-08-05

## 1. 导入资料

```text
选择兼容 JSON（可选 Markdown 校验）或 .cr
-> preview/格式识别/warnings/ImportDraft -> 显式 commit
-> durable job -> worker canonicalize -> 发布 conversation
```

- preview 不写 canonical；JSON 决定 metadata/role/time 与配对有效性，有效配对的 Markdown 决定显示正文。Markdown 配对冲突时必须修复或移除后才能 commit。
- CanJSON v1/v2 由 JSON 控件自动识别；官方 OpenAI 图/ZIP、CSV、TXT 和 Markdown 单文件不是普通导入入口。
- preview 使用 `first_user_message_markdown` 通过系统 Markdown renderer 展示结构；commit 成功后清除旧预览并进入 Reader，队列导入轮询到 committed 后执行同一跳转。Reader 不直接读取 raw artifact。

## 2. 组织与批量管理

```text
Project/未归类/归档列表 -> checkbox/Shift/键盘/移动长按
-> 顶部上下文栏 -> 移动、归档/恢复、导出、合并或删除
```

- 桌面对话可拖入折叠 Project 或拖回未归类区。
- “批量操作”入口在选择模式中保持原位和原宽，并切换为“完成批量操作”；不会因工具栏出现而消失。
- 合并是工具栏一级动作；标题和顺序在脱离工具栏宽度约束的 focused dialog 中确认。删除继续二次确认；部分失败保留失败项选择。
- Project 与 Conversation 使用独立三点菜单；归档保留 Project 关系，取消归档后回到原位置。删除需要显示标题并二次确认，随后立即事务性硬删除，不进入 Trash，也没有 restore；当前 Reader 被归档后进入 `/archived`，被删除后跳到下一个可用对话或安全空状态。

## 附件上传、插入与导出

1. “当前对话文件”或 Markdown 源码编辑器创建上传 session，文件流式写入暂存区并返回 MIME、hash、大小和扫描状态。
2. 当前部署扫描器关闭时显示 `scanner_disabled`；策略允许继续使用不代表文件安全。
3. 文件抽屉提交后成为当前对话 Attachment，可保持未放置，也可从编辑器在光标处或消息末尾插入。
4. 上传完成后先显式提升为当前对话 Attachment；保存消息时以 base version 做并发校验，并在同一事务创建 MessageVersion、Occurrence、RenderBlock。搜索、TOC、统计和摘要在提交后异步重建。删除正文引用不会删除对话级 Attachment。
5. 对话导出只选择 CanJSON/Markdown 与“包含附件”：分别得到 `.canjsonl`/`.context.zip` 或 `.md`/可移植 Markdown ZIP。系统 `.cr v4` 从设置的数据与备份导出，恢复文件统一从“导入数据”选择，服务端只允许恢复到空实例。
- 源码模式可把真实文件拖到具体文本位置，或粘贴剪贴板图片/文件；文件选择、拖放和粘贴共用上传 session、逐文件进度、取消与重试。上传中/失败项必须处理后才能保存。
- 拖到 fenced code block 时先选择放到代码块之后、仍按普通文本插入或取消；拖到现有 Markdown 链接内部时移到完整链接之后。多文件保持原始顺序并分别生成 occurrence。
- 关闭尚未保存的源码时，已完成上传可保留为“当前对话文件”的未放置附件，也可删除；正在上传的项会取消。源码中手动删除附件语法只影响当前新版本 occurrence，不删除对话级 Attachment。
- 桌面“当前对话文件”默认在 Reader 右上安全区域打开为注释式浮窗；整个表头可拖动，边缘可缩放，位置/尺寸可复位并持久化。表头使用抓手光标和附件专属图标；移动端使用全宽 sheet。该入口管理 Attachment，源码编辑器继续负责 occurrence 编排。
- 拖拽使用 Pointer/Touch/Keyboard sensors：Project 容器始终按自定义顺序展示，新建 Project 追加到项目区末尾；Project 内和未分类 Conversation 继续使用独立的对话排序偏好。项目排序槽、Project 对话接收区、conversation row/insert slot 与未分类标题行是不同 drop target；打开的 Project 右侧工作区也是明确的当前项目接收区。整行是唯一 dnd-kit 拖拽表面，预览保持源行尺寸且不使用浏览器原生链接拖影；普通点击仍导航。移动成功后保留当前 URL 和滚动上下文。跨项目移动只更新单一关系，移回未归类不删除会话，失败按 revision 同时回滚项目列表、项目对话和侧栏 optimistic cache。侧栏查询刷新保留上一份数据，避免拖拽期间卸载目标；菜单和键盘移动仍是非拖拽替代路径。

## 3. 阅读长对话并恢复位置

```text
conversation + reading position 并行加载
-> 读取包含目标 message 的完整 reader-turn
-> 原子挂载 -> 对齐 120px 阅读线 -> 预取相邻轮次
-> 稳定 1 秒后保存 message/block/offset
```

- 边缘切换捕获真实锚点，轮次完成水合后 prepend/replace，再补偿位置。
- 刷新直接从保存轮次恢复，不先挂载普通 30 条窗口。
- 用户 wheel/touch/pointer/阅读键输入可取消程序导航。

## 4. 搜索、TOC 或批注定位

```text
选择结果 -> 取消旧导航 -> 加载目标完整轮次
-> quote/offset/block/message 解析 -> 等待媒体/布局稳定
-> 复校 -> 继续预取
```

全局搜索、当前对话搜索、对话索引、章节 TOC、最近位置和批注复用同一事务；失败时保留当前正文并允许重试。定位成功后只在精确文字首个可见行显示约 720ms 的短时脉冲；只能退化到 block/message 时显示左侧短标记，不再给整条消息持续填色。搜索自身的精确命中高亮保持独立。

### 手动更新目录

Owner Reader 右上角“更多”提供“更新目录”：

```text
更新目录
  ├─ 对话目录（可独立选择）
  └─ 章节目录（可独立选择）
       ├─ 当前对话（默认）
       └─ 全部对话
```

至少选择一项才能提交。任务进入统一后台队列并显示排队、进度、完成或失败状态；失败不替换当前目录并保留重试入口。完成后只刷新 dialogue-index/TOC 查询缓存，不重新获取整条 Reader、不改变阅读位置，也不提升 Conversation revision。对话目录直接来自当前 canonical 消息；章节目录从 current MessageVersion 的 heading RenderBlock 重建。Share 与 Offline Reader 保持只读，不显示该入口。

## 5. 编辑、版本与会话变换

- 消息信息栏在正文上方提供收藏、选择、源码编辑和版本控件；桌面 hover/键盘聚焦显示，移动端进入底部操作菜单，不覆盖 Markdown 标题。
- 桌面顶栏常驻顺序为“编辑、搜索、批注、专注、更多”，分享、导出、合并和拆分进入“更多”；移动端常驻“导航、编辑、更多”，搜索、批注和专注位于更多面板首组。
- 从长消息当前阅读块打开非模态 CodeMirror 浮动源码工作区后，原正文保持挂载且高度不变。桌面浮窗可拖动、四边缩放、复位并持久化尺寸；移动端使用顶栏下方全宽面板。
- 真实正文滚动在同消息内只调整源码位置；进入下一消息时，干净编辑器自动切换，脏编辑器锁定原消息并显示返回原文、保存后切换和放弃后切换。搜索定位、位置恢复和 Reader 导航等程序化滚动不触发切换；CodeMirror 的方向键、Home/End、空格和编辑输入也不登记为 Reader 滚动意图。源码滚动不反向推动正文，只能显式“在正文中定位”。
- 保存后只局部替换当前消息并重建 blocks/TOC/search/摘要/offline revision，浮窗保持打开；保存前后的真实 DOM 锚点补偿阅读位置。切换其他工作区或专注模式前必须先处理未保存修改。
- 默认保存创建新 MessageVersion；当前为第二版或更高时可显式覆盖当前版本。第一版永久不可覆盖/删除，未保存关闭提供保存、放弃和继续编辑。
- 左右箭头立即持久化当前单消息版本，刷新和换设备后继续显示；删除当前历史版本时自动回退到较早的最近可用版本，删除/覆盖均保留不含被删正文的审计事件。
- Reader 不显示按字符拆分单消息入口；“拆分对话”工作区先展示完整轻量时间线和结果预览，再执行连续区间、边界双份或离散消息复制。三种模式均创建新 conversation，来源保持不变。

## 6. 批注与精选笔记

```text
选中文字/书签消息 -> 类型与颜色 -> 保存 annotation
-> 工作区筛选、定位、批量样式/删除/加入精选
-> 连续阅读或逐条回顾
```

- stale anchor 按 block/message 降级并提示。
- 精选笔记可插入 Markdown、引用批注和排序；移除引用不删除原批注。
- 离线操作进入 outbox，联网后幂等同步；revision 冲突保留副本。

## 7. Share 与导出

- Share 选择 full/selected、expiry、private flags 和 allow export；创建后可复制、更新或撤销。
- 访客只读取 `/api/shared/{token}/*` 授权范围。
- Markdown v2/CanJSON v2 可流式导出；`.cr` 通过后台 job 生成临时 artifact。CanJSON v1 只保留 Legacy 兼容。
- `format=context_package` 通过同一后台 job 生成 `<title>.context.zip`；只包含 manifest、当前版本 `conversation.canjsonl` 和 content-addressed available assets，支持完整对话/当前阅读范围两种 scope。历史版本、blocks、TOC 和 search 仍仅属于 `.cr`。
- `.crbundle` 已从产品导入流程移除；附件通过对话内普通上传或 `.cr` 完整归档恢复进入系统。图片、文本、Markdown、JSON、CSV、代码、原生媒体和 PDF 可在线预览，Office/ZIP 下载降级，Share 再做 token 与消息范围校验。当前不执行附件内容秘密扫描；未扫描状态会保留到 Reader、Share 和导出。
- 对话导出一级选项为 CanJSON/Markdown 和“包含附件”；二级选项可包含简介、批注、笔记和来源引用，ZIP manifest 记录实际选择。
- 当前对话导出只投影 active Attachment；从文件面板 detach 的业务文件不会再次出现在当前 `.canjsonl`、`.context.zip`、`.md` 或 Markdown ZIP 中，历史引用只在系统 `.cr v4` 中保留。隐藏文件名、Unicode、空格、大小写和复合扩展名在可移植 ZIP 中保持。

## 7.1 Markdown 任务清单

1. 在线 Owner Reader 将用户或助手正文中的 GFM `- [ ]` / `- [x]` 渲染为可操作 checkbox；代码围栏内的示例不成为任务。
2. 点击立即给出 optimistic 状态并提交 `message_id + base_version_id + task_key + checked`。当前 v1 创建 v2，当前 v2+ 覆盖该版本；操作不影响后续消息。
3. API 409 或 task key 过期时回滚 checkbox 并提示重新加载，Reader 不刷新整场对话。
4. Share、Offline Reader 和附件 Markdown 预览始终只读，避免访客或派生内容写回 canonical 消息。

## 8. 离线资料库

```text
首次在线打开 /library -> staging/校验/激活 PWA 壳
-> catalog 与本地 revisions 比对 -> 请求 v3 增量包（none/small/all attachments）
-> 校验并在 Dexie transaction 中导入 -> 离线阅读/搜索
```

- 无变化时显示“离线资料已是最新”；后续 revision 变化可再次自动更新。
- staging、下载或导入失败时保留旧 active shell 和旧数据。
- canonical 管理离线禁用；批注/笔记可离线编辑并同步。
- Dexie v2 保存附件 metadata；清洁小/全部附件保存到 Cache Storage，移除本地会话会同时清理对应 Blob。

## 9. 移动端

- 首页保留继续阅读卡片和 `/recent` 入口；桌面不显示它们。
- Reader 顶栏为返回、标题、导航和更多；工具使用 Bottom Sheet。
- 移动端优先阅读与单项管理，消息操作菜单可打开 Markdown 源码编辑与版本控件；复杂批量和 Project 管理以桌面为主。

注册、登录、发送消息、停止生成、选择模型、会员购买和管理员审核不属于当前流程。
# 2026-08-09 Addendum: Message Organization

1. Select New Conversation, enter a title, project (or unclassified), User text and Assistant text, then submit. Empty bodies are rejected before the request and by the API.
2. Use the plus action between messages to insert before or after the anchor. Single insertion defaults to the opposite role of the adjacent message; pair insertion always creates User then Assistant.
3. Delete uses a confirmation, hides the message optimistically, and offers a short undo. It is a soft delete and does not create a user-visible Trash. Delete/restore responses carry the post-commit conversation revision; restore is idempotent and the undo surface remains actionable on failure. A stale revision returns 409 and leaves the reader unchanged.
4. Opening DOCX/ODT, XLSX/ODS, PPTX/ODP or ZIP uses the existing unified Viewer Shell and lazy browser Worker. The body shows bounded semantic content; parser limits or unsupported legacy formats fall back to an original-file download.

## 2026-08-11 Lifecycle closure

1. Creating a conversation seeds the canonical response and revision before navigation completes. Initial Notebook/recent bootstrap reads do not advance Conversation revision, so the first insert, edit or delete can run without a refresh.
2. Delete is complete when the message disappears and the server returns the new revision. Undo is complete only after restore succeeds, the Reader reconciles the returned canonical message/revision, and refresh still contains the message.
3. Undo 409/500/network failure keeps a localized live error and a retry action. It never silently closes or claims the message was restored.
4. A genuine second-tab 409 preserves the source draft and does not overwrite the other tab. `加载最新状态` fetches the current Conversation revision and MessageVersion base without replacing the editor draft; the user reviews and saves again against that explicit latest base.
5. An active Attachment with zero current-version occurrences remains visible in Files Panel `全部/未引用`. Occurrence removal with keep does not detach the Attachment, and multiple Attachment business identities may share one AssetObject.
6. Files navigation carries Attachment/occurrence/version/block identity. If the exact reference is stale, Reader preserves the current body and exposes exact retry, message-level fallback, and a truthful Files-index refresh that refetches current occurrences; refresh does not claim to repair canonical attachment data.
# Archived project deletion (2026-08-12)

Project deletion is available only from the Archived page. The user archives a project first, then may restore it or permanently delete the project container. A destructive confirmation explains that the project itself cannot be restored but all conversations and messages are kept and return to Unclassified. Batch deletion uses the same contract and retains failed rows as selected.

The API rejects default or active project deletion. On accepted deletion it atomically moves each `ProjectConversation` to the internal default project, clears project pin state, updates recent placement and the conversation offline revision, records a placement event, then deletes only the archived Project row. Conversation, message, attachment and export lifecycle is unchanged.
