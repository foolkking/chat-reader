# 阅读工具重构：任务完成情况审查

日期：2026-11-08（Asia/Shanghai）。本次仅审查，不修应用代码、不提交或派发 CI、不部署。

## 结论

**功能主体已经落到工作区，但还不能认定本轮需求全部完成。** 本次发现 **2 项高优先级、5 项中优先级问题**。最应先处理的是一起阅读切换时的未落盘笔记保护，以及“保存当前位置”的实际定位精度；此外，图片默认比例的覆盖范围比用户要求窄，批注筛选、移动端导出和非文字书签的呈现还没有形成完整流程。

本次复查的 lint、非增量 TypeScript 检查和 `git diff --check` 均通过。它们证明静态质量检查通过，**不证明交互行为、视觉效果或完整回归通过**。当前候选没有新的 CI、运行时或视觉验收结果；以前版本的成功 CI、部署和旧截图不能用于验收本轮修改。

## 范围与证据边界

- 对象：本轮图片比例、一起阅读、Reader 工具栏、私人标签、批注阅读/导出、位置书签及相关回归。
- 面向用户：需要长文阅读、检索和整理的个人用户，同时考虑快捷键重度使用者。
- 基线：现有 `master`，HEAD 为 `adc7c308aba7ab693ea8383ea0e22b270c76e79d`；审查对象是其上的未提交工作区，不能只用 HEAD 代表候选源码。
- 方法：追踪组件、状态、接口、序列化及测试断言，核对候选合同与实施记录；skill 仅用于组织证据和严重程度。
- **已看到**：实现源码、测试源码、候选文档，以及本次静态命令的退出状态。
- **未看到**：当前候选真实页面渲染、375/800/1440px 截图、触摸/键盘实测、应用测试运行结果、逐帧阅读稳定性证据。没有启动服务或绕过此前工具策略阻断，也没有访问生产或使用 web search。
- 以下问题标为 **Observed (code)** 的部分是已检查的控制流；具体用户操作结果标为 **Inferred**，不冒充浏览器实测。
- 不是全站 UX 审计，也不作 WCAG 合规或性能达标声明。

候选说明：
[阅读工具合同](E:/1project/chat-reader/docs/system/READING_TOOLS_CONTRACT.md)、
[实施记录](E:/1project/chat-reader/docs/execution/READING_TOOLS_2026-11-08.md)。

## 逐项完成情况

| 用户要求 | 源码中已有的实现 | 本次判断 |
|---|---|---|
| 图片尺寸不再使用大弹窗，向上显示单滑杆，适应栏宽放旁边 | 非模态根节点浮层、单滑杆、百分比、相邻 Fit 操作；保留松手提交和未知结果核对 | **主体已实现，视觉待验收**。不能仅凭样式声明断言没有遮挡 |
| 未特意调整的图片默认采用适应后的比例 | 自适应导入新增可选栏宽；新导入附件一次性保存具体比例 | **部分完成**。旧未配置图片、手动上传等仍不在初始化范围，见 IMG-01 |
| 取消对照含义，改为一起阅读，搜索复用、快捷键、多对话 | `/read-together`、Alt+Shift+O、复用搜索、最多八个标签/两个正文、窄屏活动标签、独立滚动与导航归属 | **主体已实现但有流程缺口**。切换保护及栏内附件搜索见 ERR-01、NAV-02 |
| 不再提供追踪溯源、新增消息入口 | Reader 工具栏已移除对应入口；兼容 API/原数据没有删除 | **入口层完成**，不是底层数据清除 |
| 标签移出右上角并易于管理 | 标题标签条、独立 `/tags`、成员列表、重命名/删除/合并、批量关联；合并带所有权及双 revision 检查 | **源码层主体完整**；尚无本候选的运行/视觉验证，未发现足够证据支持新的阻断项 |
| 批注查看/导出具备上下文和合理格式 | 阅读优先卡片，筛选/已选/全部已保存导出，v2 中英文源信息/上下文，在线离线序列化 | **部分完成**。筛选状态、手机选择入口、非文字书签说明见 STATE-01、FLOW-02、CONTENT-01 |
| 保存当前阅读位置并复用批注 | 正常 bookmark 实体、reading point 元数据、去重、保存反馈、书签独立视图 | **未完成关键精度验收且存在源码缺陷**，见 NAV-01 |
| 右上角统一 UI/UX、尺寸和风格适配 | 主操作/更多分组、按栏宽折叠，复用纸面/石墨/强调色和主要 44px 目标 | **结构已实现，效果未验收**；不能认定中英文、明暗主题、临界栏宽下均可用 |

“实现记录已本地收尾”不能替代逐项验收，尤其不能据此宣称精确定位和全部默认比例已完成。

## 最重要的三件事

1. **先守住未保存内容**：一起阅读的活动对话变化不能绕过现有笔记草稿保护。
2. **让“当前位置”名实相符**：保存长段落中间的位置，不能只选文本节点首尾。
3. **补齐默认行为和后续操作**：新导入的默认 Fit 不等于所有未调整图片默认 Fit；书签保存、查看、筛选、导出必须能连续完成。

## 发现汇总

| ID | 问题 | 严重程度 | 置信度 | 预计工作量 |
|---|---|---|---|---|
| ERR-01 | 一起阅读切换/关闭活动对话绕过未落盘笔记保护 | High / P1 | Observed (code)；特定存储失败下的丢失为 Inferred | M |
| NAV-01 | 保存当前位置只取文本节点首尾，并混用 UTF-16 与码点偏移 | High / P1 | Observed (code)；具体偏移距离为 Inferred | M |
| IMG-01 | 默认适应比例仅覆盖部分新导入，不覆盖所有未调整图片 | Medium / P2 | Observed (code + contract)；具体呈现为 Inferred | M |
| NAV-02 | 一起阅读栏内搜索允许附件结果，却必然走失败分支 | Medium / P2 | Observed (code)；页面反馈为 Inferred | S–M |
| STATE-01 | 批注/书签分栏后复用不相容筛选，可能隐藏刚保存的书签 | Medium / P2 | Observed (code)；交互结果为 Inferred | S–M |
| FLOW-02 | 手机提供“已勾选”导出，却没有进入勾选模式的入口 | Medium / P2 | Observed (code)；移动端呈现为 Inferred | S–M |
| CONTENT-01 | 非文字位置书签被显示成整条消息书签，导出伪造文字位置 0 | Medium / P2 | Observed (code)；导出易读性影响为 Inferred | M |

### ERR-01 · 一起阅读切换绕过草稿保护

**证据。** [conversation-compare.tsx:69–98](E:/1project/chat-reader/apps/web/features/compare/conversation-compare.tsx#L69) 的激活、选择和关闭直接变更 `activeId`；[125–137](E:/1project/chat-reader/apps/web/features/compare/conversation-compare.tsx#L125) 将同一个批注工作区绑定到活动对话。[together-pane.tsx:253–254](E:/1project/chat-reader/apps/web/features/compare/together-pane.tsx#L253) 使另一栏的按下/聚焦也会触发切换。现有 [annotation-workspace.tsx:393–397](E:/1project/chat-reader/apps/web/features/annotations/annotation-workspace.tsx#L393) 的“草稿尚未写入本机”确认只在其自身关闭动作使用；[1134](E:/1project/chat-reader/apps/web/features/annotations/annotation-workspace.tsx#L1134) 的笔记组件按 scope 重新挂载。[notebook-view.tsx:64–97](E:/1project/chat-reader/apps/web/features/annotations/notebook-view.tsx#L64) 明确允许本机保存失败，并只增加了页面卸载保护。

**触发与影响。** 在 A 对话的笔记中输入，当本机草稿保存失败且服务器也未成功保存时，点击 B 栏或关闭 A 标签，可能直接卸载 A 的内存草稿；SPA 活动栏变化不会触发 `beforeunload`。失焦保存不是可靠补救：该条件下保存本来就可能失败或已被作用域失效阻断。这里不是声称每次切换都会丢失已落盘草稿。

**建议与验收。** 把同一离开保护接到激活、选入、关闭和返回动作，或在明确切换前固定批注所属对话；存储失败时保留原 scope 的内存草稿。模拟本机写失败及服务器失败，分别通过点击另一栏、键盘切换、关闭当前标签离开，均应提供取消/重试，不能无提示丢失输入。

### NAV-01 · “当前位置”不是实际阅读行

**证据。** [reading-position-capture.ts:51–68](E:/1project/chat-reader/apps/web/features/conversations/reading-position-capture.ts#L51) 调用 [reader-navigation.ts:304–339](E:/1project/chat-reader/apps/web/features/conversations/reader-navigation.ts#L304) 的估算器。后者每个 DOM 文本节点仅测首字符和末字符，不测中间行，并以 `text.length` 累计 UTF-16 单元。[reading-bookmark.ts:8–18](E:/1project/chat-reader/apps/web/features/annotations/reading-bookmark.ts#L8) 却将所得偏移当作 `Array.from` 后的 Unicode 码点索引。[reader-locator-target.ts:35–51](E:/1project/chat-reader/apps/web/features/conversations/reader-locator-target.ts#L35) 对文字书签优先采用该文字位置；像素补偿只用于非文字书签。

**触发与影响。** 一个自然换行的长段落只有一个文本节点时，在段落中部保存会选择其开头或末尾，而不是当前行；偏移前含 emoji 时还会产生索引体系差异。结果可能是返回错误行、摘录不对应所读位置，乃至不同阅读行被去重为同一点。估算器虽为旧代码，但本轮将其用于用户主动“保存当前位置”，因此是本任务的完成缺口。

**建议与验收。** 使用真实阅读线上的 caret/Range 计算，并统一转换为 canonical 码点偏移；无法精确定位时保留诚实的块内像素回退，不用节点端点冒充精确文本锚点。补单文本节点多行、emoji、内联格式和虚拟化返回测试。现有 [reading-tools-contracts.test.mjs:18–33](E:/1project/chat-reader/scripts/ux/reading-tools-contracts.test.mjs#L18) 手工传入 `character_offset: 1`，只能验证序列化，不能验证 DOM 捕获。

### IMG-01 · 默认 Fit 的覆盖范围小于需求

**证据。** [canonical/persistence.py:904–914](E:/1project/chat-reader/apps/api/app/services/canonical/persistence.py#L904) 仅在导入记录包含 `image_lane_width` 时调用一次性初始化；[upload_service.py:221–235](E:/1project/chat-reader/apps/api/app/services/assets/upload_service.py#L221) 的手动上传只补几何，没有该初始化。[image_display.py:106–115](E:/1project/chat-reader/apps/api/app/services/assets/image_display.py#L106) 对未配置图片仍返回 100%，[image-display-controls.tsx:143–172](E:/1project/chat-reader/apps/web/features/attachments/image-display-controls.tsx#L143) 也使用 100% 回退。候选合同明确排除了旧导入、手动上传和恢复流程。

**触发与影响。** 对原宽 1200px、栏宽 720px 的未配置旧图/手动上传，正文可以已适应到 720px，但比例仍为 100%；主动 Fit 才会保存为 60%。从 100% 改到 90% 仍可能不改变正文宽度。这不是“图片完全没有适应栏宽”，而是用户要求的默认具体比例尚未普遍成立。

**建议与验收。** 至少将真正新增的手动上传纳入安全的一次性初始化，并明确历史未配置图片的默认语义。不要在读取时偷偷改写公开链接、已保存设置或旧离线快照；历史数据需采用如实说明的未配置适应状态，或经明确授权进行初始化。验收分别覆盖新导入、新上传、历史未配置、显式 100%、已有比例及旧离线副本；不能只测导入一路。

### NAV-02 · 栏内搜索展示无法处理的附件结果

**证据。** [conversation-search-panel.tsx:235](E:/1project/chat-reader/apps/web/features/search/conversation-search-panel.tsx#L235) 保留附件筛选；[265–275](E:/1project/chat-reader/apps/web/features/search/conversation-search-panel.tsx#L265) 将附件结果映射为仅有 `attachmentId` 的目标。但 [together-pane.tsx:273–274](E:/1project/chat-reader/apps/web/features/compare/together-pane.tsx#L273) 对没有 `messageId` 的目标直接返回 `block-not-found`，没有附件定位或完整 Reader 退路。

**触发与影响。** 在一起阅读某栏内搜附件名，结果虽然可选，却无法打开。这是结果类型处理遗漏，不是偶发网络错误。

**建议与验收。** 复用结果分派逻辑，为附件提供实际 Viewer/occurrence 处理，或像 [together-chooser.tsx:58–60](E:/1project/chat-reader/apps/web/features/compare/together-chooser.tsx#L58) 一样明确提供“在完整阅读页查看此结果”。补附件结果端到端操作，检查选中后有可达目的地且另一栏不动。

### STATE-01 · 旧筛选可以隐藏书签

**证据。** [annotation-workspace.tsx:713–724](E:/1project/chat-reader/apps/web/features/annotations/annotation-workspace.tsx#L713) 先按批注/书签分栏，再叠加同一组类型、颜色、搜索和当前消息筛选。[1168–1170](E:/1project/chat-reader/apps/web/features/annotations/annotation-workspace.tsx#L1168) 切换标签只修改 `view`，类型下拉仍在批注视图提供“书签”。[1144](E:/1project/chat-reader/apps/web/features/annotations/annotation-workspace.tsx#L1144) 的保存成功“查看”同样没有清理阻挡目标的筛选。

**触发与影响。** 在批注中选高亮或黄色后切到书签，结果会为空；在批注视图把类型设成书签也会得到逻辑上必空的结果。保留旧筛选后点击“阅读位置已保存 → 查看”，刚保存的记录可能仍不可见，造成保存失败的错觉。

**建议与验收。** 对分栏使用相容筛选，移除无效选项；显式“查看此书签”应清除阻挡目标的条件并定位实际记录，必要时说明已调整筛选。补类型/颜色/查询/当前消息筛选跨标签，以及保存后查看的组合测试。

### FLOW-02 · 手机端“已勾选导出”缺少勾选入口

**证据。** [annotation-workspace.tsx:753–762](E:/1project/chat-reader/apps/web/features/annotations/annotation-workspace.tsx#L753) 在所有尺寸提供“已勾选”导出，零选择并不禁用；[1170](E:/1project/chat-reader/apps/web/features/annotations/annotation-workspace.tsx#L1170) 的“管理”入口只在 `desktop` 下显示，[1152–1163](E:/1project/chat-reader/apps/web/features/annotations/annotation-workspace.tsx#L1152) 的上下文选择也限桌面，[1250](E:/1project/chat-reader/apps/web/features/annotations/annotation-workspace.tsx#L1250) 的逐条勾选仅在 `selectionMode` 开启时渲染。

**触发与影响。** 新进入手机批注界面，没有路径进入选择模式，却可选“已勾选（0）”并请求空文档。桌面先开启选择再缩小视口不能算手机流程可用。

**建议与验收。** 给手机提供明确的选择/完成入口，复用同一选择状态；零选择时禁用已勾选导出并提示先选择。若本轮不支持手机选择，应隐藏不可用范围而非保留无效操作。用 375px 全新会话完成选择两条、导出两条、取消选择，并验证中英文。

### CONTENT-01 · 图片位置书签缺少可辨认的说明

**证据。** [reading-bookmark.ts:15–23](E:/1project/chat-reader/apps/web/features/annotations/reading-bookmark.ts#L15) 保留非文字块的 `reading_anchor.block_offset`，但 [annotation-workspace.tsx:1253](E:/1project/chat-reader/apps/web/features/annotations/annotation-workspace.tsx#L1253) 把所有无 quote 项都显示为“整条消息书签”。[annotation_document.py:142–143](E:/1project/chat-reader/apps/api/app/services/exporting/annotation_document.py#L142) 和 [annotation-document.ts:40](E:/1project/chat-reader/apps/web/lib/annotation-document.ts#L40) 对空文字偏移统一输出“文字位置 0”。

**触发与影响。** 同一长图在两个不同块内偏移处保存的书签，数据和定位可能是独立的，但卡片均称整条消息，导出均称文字位置 0；没有手写评论时，仅凭导出正文难以区分。这里不是说原始位置数据已丢失，而是查看和可携带文档未如实解释它。

**建议与验收。** 区分整条消息、文字位置和非文字阅读点；用图片名/替代文本、所在段落及块内位置提供上下文，无文字时不要制造文字索引。加入同一图片两个位置的在线/离线一致性样例，检查两条可区分且均可返回各自位置。

## 修正顺序

| 顺序 | 项目 | 原因 |
|---|---|---|
| 1 | ERR-01 | 先处理条件性的输入丢失风险 |
| 2 | NAV-01 | 位置书签是核心新承诺，不能只验证存储成功 |
| 3 | STATE-01、FLOW-02 | 较小改动即可补齐查看/筛选/导出的实际路径 |
| 4 | NAV-02 | 搜索结果应可操作或明确给出退路 |
| 5 | IMG-01 | 落实新上传默认，明确历史数据和既有公开链接边界 |
| 6 | CONTENT-01 | 补全非文字书签的阅读与导出上下文 |

本表是后续建议，**不是本次自动修复或启动 CI 的授权**。

## 哪些方向应保留

- 单滑杆及相邻 Fit 比旧尺寸大面板更符合本次要求；不要因修正默认值重新加回整套弹窗。
- 私人标签、独立管理页、保留无关成员的批量关联和原子合并，比直接删除标签更能满足整理需求。本次未看到需要整体重做标签架构的依据。
- 八标签、最多两正文及窄屏单活动正文是明确的阅读布局取舍，不应当作“只能同时打开两个对话”的缺陷。
- 保存未知结果先核对、公开链接/旧离线副本不偷偷重写、所有权和并发边界应继续保留。
- 原有纸面/石墨视觉体系和现有 Viewer 不需因本轮审查替换。没有当前渲染证据，不对字体、色板和留白作审美评分。

## 验证结果与待验收清单

### 本次实际运行

| 项目 | 结果 |
|---|---|
| `corepack pnpm run lint` | 通过，退出码 0 |
| `corepack pnpm --filter web exec tsc --noEmit --incremental false` | 通过，退出码 0 |
| `git diff --check` | 通过，退出码 0 |
| 原有 `tsconfig.tsbuildinfo` | 哈希未变化；未覆盖用户已有增量文件 |
| API/Node 应用测试、Playwright/PWA、Web build | 本次未运行 |
| 当前候选浏览器操作、截图/逐帧检查 | 本次未执行 |
| commit / push / CI / 部署 | 均未执行 |

记录：[static-review.json](./ux-audit-reading-tools-completion-2026-11-08-evidence/static-review.json)、
[lint.log](./ux-audit-reading-tools-completion-2026-11-08-evidence/lint.log)、
[证据说明](./ux-audit-reading-tools-completion-2026-11-08-evidence/README.md)。

### 测试源码不等于验收结果

已有新增测试涉及导入 Fit、标签合并、书签去重/重定位、导出字节一致性、滑杆事务和一起阅读布局。这些应保留，但不足以覆盖本报告的完整用户路径。例如书签测试手填偏移，未测真实阅读线捕获；手机“已勾选”导出缺少从零进入选择的覆盖。不能用“已有测试文件”代替“已验证”。

修正后，至少还需以下运行与视觉验收：

1. 长段落中间、emoji、内联格式、图片内部的保存/返回，以及切换标签后的锚点精度。
2. 本机存储失败、离线/服务器失败时，一起阅读的切换/关闭/返回保护。
3. 新导入、新手动上传、历史未配置与显式已保存图片的比例合同，包含现有公开 URL 和旧离线副本。
4. 带旧筛选保存书签并查看；手机选择/导出；在线与离线非文字上下文一致。
5. 一起阅读栏内的正文、批注、附件搜索分别处理，另侧不产生程序化移动或被动进度写入。
6. 375/800/1440px、真实栏宽临界点、明暗/中英、键盘/触摸；检查工具栏、图旁按钮、单滑杆和批注列表实际截图。
7. 用户后续明确要求提交 CI 后，再运行精确候选源码的完整门禁；保留原有 64+12+4 阅读证据及 Viewer/Share/Offline、权限/并发与资源门禁，不降低阈值。

本轮审查到此停止；既没有应用修正，也没有提前提交 CI。
