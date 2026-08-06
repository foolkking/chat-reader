# 当前用户流程

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
-> 底部上下文栏 -> 移动、归档/恢复、导出、合并或删除
```

- 桌面对话可拖入折叠 Project 或拖回未归类区。
- 合并先确认顺序，删除二次确认；部分失败保留失败项选择。
- Project 与 Conversation 使用独立三点菜单；归档保留 Project 关系，取消归档后回到原位置。删除需要显示标题并二次确认，随后立即事务性硬删除，不进入 Trash，也没有 restore；当前 Reader 被归档后进入 `/archived`，被删除后跳到下一个可用对话或安全空状态。

## 附件上传、插入与导出

1. “当前对话文件”或 Markdown 源码编辑器创建上传 session，文件流式写入暂存区并返回 MIME、hash、大小和扫描状态。
2. 当前部署扫描器关闭时显示 `scanner_disabled`；策略允许继续使用不代表文件安全。
3. 文件抽屉提交后成为当前对话 Attachment，可保持未放置，也可从编辑器在光标处或消息末尾插入。
4. 保存消息时以 base version 做并发校验，并在同一事务创建 MessageVersion、Occurrence、RenderBlock 和派生索引。删除正文引用不会删除对话级 Attachment。
5. 对话导出只选择 CanJSON/Markdown 与“包含附件”：分别得到 `.canjsonl`/`.context.zip` 或 `.md`/可移植 Markdown ZIP。系统 `.cr v4` 从设置的数据与备份导出，并只恢复到空实例。
- 拖拽使用 Pointer/Touch/Keyboard sensors：未归类、Project、项目内插入槽是不同 drop target；跨项目移动只更新单一关系，移回未归类不删除会话，失败按 revision 回滚 optimistic cache。

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

全局搜索、当前对话搜索、对话索引、章节 TOC、最近位置和批注复用同一事务；失败时保留当前正文并允许重试。

## 5. 编辑、版本与会话变换

- 消息信息栏在正文上方提供收藏、选择、源码编辑和版本控件；桌面 hover/键盘聚焦显示，移动端进入底部操作菜单，不覆盖 Markdown 标题。
- 桌面顶栏常驻顺序为“编辑、搜索、批注、专注、更多”，分享、导出、合并和拆分进入“更多”；移动端常驻“导航、编辑、更多”，搜索、批注和专注位于更多面板首组。
- 从长消息当前阅读块打开非模态 CodeMirror 浮动源码工作区后，原正文保持挂载且高度不变。桌面浮窗可拖动、四边缩放、复位并持久化尺寸；移动端使用顶栏下方全宽面板。
- 真实正文滚动在同消息内只调整源码位置；进入下一消息时，干净编辑器自动切换，脏编辑器锁定原消息并显示返回原文、保存后切换和放弃后切换。搜索定位、位置恢复和 Reader 导航等程序化滚动不触发切换；源码滚动也不反向推动正文，只能显式“在正文中定位”。
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
- `.crbundle` 是附件导入输入；图片、文本、Markdown、JSON、CSV、代码、原生媒体和 PDF 可在线预览，Office/ZIP 下载降级，Share 再做 token 与消息范围校验。当前不执行附件内容秘密扫描；未扫描状态会保留到 Reader、Share 和导出。
- 对话导出一级选项为 CanJSON/Markdown 和“包含附件”；二级选项可包含简介、批注、笔记和来源引用，ZIP manifest 记录实际选择。

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
