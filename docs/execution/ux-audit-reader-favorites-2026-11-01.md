# Reader / 收藏专项审查 — 2026-11-01

> **当前阶段：审查与设计，不是实施。** 用户要求保留已有修改；本轮不再修改业务代码、
> 测试代码或配置，不运行本地门禁、不提交、不派发 CI、不部署。
> 下方“修改前”是前一阶段检查点；本轮续查及
> [具体设计方案（11 月 2 日续写）](READER_FAVORITES_DESIGN_2026-11-02.md)区分旧实现、保留草稿和待实施事项。
> 用户新增的正文富内容需求另见 [富内容设计](READER_RICH_CONTENT_DESIGN_2026-11-02.md)；
> “正文可以放开”不改变本轮仅审查/设计的阶段。

范围：已有 Web Reader 的收藏入口、快捷键、图片加载和快速滚动。
受众：连续阅读长对话的普通用户；不重新设计产品、不迁移用户收藏数据。
证据：master 工作区源码；上一轮离线修复的本地验证记录。尚未观测本轮真实
生产浏览器故障，不把用户描述或源码推断写成生产复现。

## 优先结论（修改前）

| ID | 类型 / 维度 | 严重性 | 证据与置信度 | 处理 |
| --- | --- | --- | --- | --- |
| NAV-01 | 行为变更 / 收藏 | Medium | Observed(code)：reading-list-button.tsx 的 toggle 保存 unread/read，而非取消收藏 | 同一星标增删，黄色实心表示已收藏；保留 reading-list 存储及路由，旧已读条目也视为收藏 |
| NAV-02 | 缺陷 / 键盘 | Medium | Observed(code)：conversation-reader.tsx 的 Home/End 使用 scrollHeight；J/K 只在 messages 数组内寻找 | 使用完整对话索引解析首尾及相邻消息，再走现有完整轮次/真实 DOM 导航 |
| NAV-03 | 缺陷 / 键盘所有权 | High | Observed(code)，运行时影响 Inferred：markKeyboardIntent 与 handleReadingShortcut 各注册 window keydown；effect 重装可改变监听顺序 | 一个快捷键所有者先登记真实意图、再导航，保留输入/IME/对话框隔离 |
| HELP-01 | 缺陷 / 帮助关闭 | Medium | Observed(code)：reader-keyboard-help.tsx 只有 Escape，没有外部点击关闭；显示用户指定删除的说明 | 图标一致、外部点击与 Escape 关闭、焦点合理返回、删除冗余句子 |
| PERF-01 | 缺陷 / 虚拟阅读 | High | Observed(code)，故障归因 Inferred：assistant-message-renderer.tsx 的 useVisibleVirtualGapRecovery 遇任意可见行即返回，且仅 range 改变时检查 | 覆盖部分空白、无 range 变化和前序内容改变位置，保持已测尺寸缓存及有限 DOM |
| PERF-02 | 风险 / 图片布局 | High | Observed(code)，故障归因 Inferred：InlineImage 未预留固有尺寸；gallery 在 onLoad 才写比例，Reader 禁用原生滚动锚定 | 稳定图片预留空间及消息坐标，验证迟到图片与快速上下滚动，不使用点击强制重绘 |
| OFF-01 | 发布缺口 / 离线 | High | Observed(既有源码与验证记录)：逐对话更新及 PWA 28/28 已完成，现网仍是旧版本 | 不宣称生产修复；发布和真实 47 对话更新留待授权验收 |

详细源码定位均在 `apps/web/` 下；修改前位置：收藏按钮 34–82，
快捷键 852–866 / 1736–1767，空白恢复 450–482，InlineImage 139–182。

## 实施约束

安静的阅读工具栏：沿用纸色表面、墨色正文、细边框、已有字体与 4px 间距。
星形只用小面积黄色表达收藏，辅以实心/空心和 aria-pressed，不靠颜色独立表达。
拒绝额外取消按钮、读完即失去收藏、满屏工具按钮；搜索右侧一个星标完成增删。
帮助沿用同一 44px 触达范围与图标库，短说明不遮挡窄屏正文。
保留完整轮次、虚拟块测量、真实 DOM 锚点、选择与输入保护、离线兼容和旧数据。
修改和验证是后续阶段，不以上述审查推断替代浏览器验收。

## 未覆盖

真实用户设备、生产认证阅读、线上 47 对话更新；这些不以本机合成测试替代。
图片是否是用户跳动的唯一原因仍待验证。不存在依赖升级、API/schema 迁移、
提交、CI 派发或部署授权。

## 本轮续查：完成度与证据边界

源码基线为本地 master `54e0e54`（仅运维文档提交，其前一产品版本为 `4b4f34f`）
加用户要求保留的未提交修改。本轮没有重新连接生产；“生产版本”仅指仓库最近的
2026-11-01 发布证据，不声称刚刚重新核验了服务器。

### 1. 离线修复不能标记为全部完成

- **已存在的源码修复**：逐对话串行生成/导入，持久化子任务幂等键及游标；
  三个旧批次入口转换；单对话身份检查；容量错误分类；已有副本及 v1/v2/v3 兼容。
- **既有本机证据**：PWA 28/28、脚本 1,904/1,904、lint/typecheck/build；
  合成 JSON 226,500,459 字节。来源为
  `E:/1project/chat-reader/docs/evidence/offline-large-package-2026-11-01/remediation-verification.json`。
  这是**收藏/键盘草稿之前**的通过记录，不覆盖当前整个工作区，也不是本轮重跑。
- **仍未验收**：当前合并源码门禁、API/worker 真实集成、部署、实际 47 对话更新、
  低内存设备。当前仍同步解压并 JSON.parse 单个包；512/256/512 MiB 是输入预算，
  不是浏览器总内存上限，更不是任意大单对话的支持承诺。

#### OFF-02 · 不可用对话与过期下载包被合并为同一恢复路径

| 项 | 结论 |
| --- | --- |
| 类型 / 维度 | 缺陷；错误恢复 |
| 严重性 / 工作量 | High / M |
| 置信度 | Observed(code)；真实用户是否触发此条件未确认 |
| 位置 | `E:/1project/chat-reader/apps/web/lib/offline-downloads.ts:88–109,182–195,253`；`E:/1project/chat-reader/apps/web/lib/offline-download-errors.ts:9–14,26` |

证据：冻结目标不在新 catalog 时抛出 `GONE`；下载包 404 也抛同一错误。
界面统一称“服务器包已被替换，重试将重新生成”。非旧格式批次重试不重建冻结
目标列表/游标，所以对话持续不可用时仍在同一项失败。这是确定的条件路径，
不是对原始容量故障的替代归因。

用户后果：已经等过一次更新，重试仍无进展，且错误说明指向错误对象。
建议区分**包过期**与**目标不可用**；前者重建同一子包，后者保留完成结果，
提供重新核对范围入口。重新确定范围需用户确认，不能静默跳过后宣称全量成功。

### 2. 收藏、帮助与键盘目前只有部分草稿

| 部分 | 源码可确认的现状 | 尚缺什么 |
| --- | --- | --- |
| 收藏文案/状态 | 中文入口已改收藏，星标增删替代 read/unread 切换；集合页默认 all | 旧数据、多窗口冲突、失败反馈与移动端验收 |
| 收藏位置 | `ReadingListButton` 仍在主操作数组之前；手机搜索仍在更多工具中 | 搜索与星标相邻，且星标在搜索右侧，尚未接入 |
| 收藏颜色 | 当前沿用 warning 色；浅色值 `#a15c00`，深色值 `#f4bd61` | 浅色并非用户要求的黄色；需专用收藏语义，不改全局警告色 |
| 帮助 | 草稿加入 CircleHelp、外部点击/焦点离开关闭、删除指定句子 | 弹层定位、Escape 层级、手机普通模式入口与真实焦点测试 |
| 键盘 | 草稿加入索引首尾/相邻解析、三行步长与单事件所有者 | 错误/忙碌反馈、连续按键策略、访问/页面生命周期及端到端验证 |
| 阅读稳定性 | 本轮前的图像/虚拟列表实现没有修改 | 需先复现，再按方案修复 |

位置证据：
`E:/1project/chat-reader/apps/web/features/conversations/conversation-reader.tsx:3054–3058,3070–3092`；
`E:/1project/chat-reader/apps/web/features/reading/reading-list-button.tsx:81`；
`E:/1project/chat-reader/apps/web/app/globals.css:82,159`。
位置和颜色均为源码观察，未声称本轮看过渲染截图。

#### VERIFY-01 · 当前草稿不能复用上一轮绿色门禁

| 项 | 结论 |
| --- | --- |
| 类型 / 维度 | 未完成实现；状态反馈、验证 |
| 严重性 / 工作量 | Medium / S |
| 置信度 | Observed(code)，没有实际执行门禁 |
| 位置 | `E:/1project/chat-reader/apps/web/features/conversations/conversation-reader.tsx:1730,1774`；`E:/1project/chat-reader/apps/web/eslint.config.mjs`；`E:/1project/chat-reader/apps/web/e2e/reader-location-failure.spec.ts:360–383` |

`keyboardNavigationError` 只写入、未读取/展示；现有 ESLint 将未使用变量定为 error。
原浏览器用例仍要求 “Add to reading list → Mark read → Mark unread”，与新收藏
增删合同冲突。不能把这两个源码问题描述成已运行的 CI 失败；它们说明草稿尚未收尾。
按用户要求全部保留，实施阶段再补反馈并更新实际行为测试，不能仅删除断言。

### 3. 阅读跳动与空白：证据链与尚未证明之处

#### PERF-01 续查 · “点击才恢复”与坐标刷新触发条件吻合

确定的源码链路：

1. 每个长消息有自己的 `scrollMargin`；前一消息高度变化会移动后一消息的起点。
2. `useVirtualLayoutMeasurements` 的 ResizeObserver 只接受宽度变化；
   高度变化由本消息的行测量处理，但没有等价地通知所有后续消息重算绝对起点。
3. `useVisibleVirtualGapRecovery` 只要找到**一个**与视口相交的行就返回。
   首/尾索引及行数不变时 effect 也不重新执行，因此“部分仍可见、另一半空白”
   和“坐标变了、索引没变”不是可靠覆盖的场景。
4. 常规 scroll 只有单次位移大于 `max(1200,1.5×视口高度)` 才通知重算。
   连续高速的小步滚动，不等于一次越过该阈值。
5. 正文 pointerdown 无条件发出布局重算事件。用户描述的点击恢复因此有直接对应
   代码路径；但仍需复现证明现场就是这条路径。

位置：
`E:/1project/chat-reader/apps/web/features/conversations/assistant-message-renderer.tsx:261–312,450–481,733–755`；
`E:/1project/chat-reader/apps/web/features/conversations/conversation-reader.tsx:831–840,2050–2058`。

**置信度：Observed(code)，用户故障归因 Inferred。** 不把“与症状吻合”改写成
“已在真实数据上复现”。另一个边界：同一 gap hook 在 WindowVirtualizedBlocks
也被调用，但内部必须找到 element Reader root；独立 Share 的 window 滚动路径
不能据此假定已经拥有同样兜底。

#### PERF-02 续查 · 图片并非完全没有空间预留，问题是预留不稳定

修正初步表述：Gallery 已有行高，不能笼统说“所有图片均未预留空间”。
实际缺口是未知比例默认 1.5，首次布局宽度默认 720，真实宽度和图片比例随后才更新，
可以导致行重排。单图片 `<img>` 没有固有 width/height；即使
`image_display_v1` 已有可信宽高，也主要只使用 width，没有完整利用比例预留。
虚拟化后的单附件块与非虚拟化 Gallery 还是两条不同布局路径。

位置：
`E:/1project/chat-reader/apps/web/features/attachments/attachment-inline-layout.tsx:173–191,225–230`；
`E:/1project/chat-reader/apps/web/features/attachments/attachment-block.tsx:143–171`；
`E:/1project/chat-reader/apps/web/features/attachments/image-display-controls.tsx:14–20`；
`E:/1project/chat-reader/apps/web/features/conversations/assistant-message-renderer.tsx:74–117,320–334`。

Reader 根禁用了浏览器原生锚定；自行补偿只覆盖若干特定操作。图片/图表迟到增长、
跨消息起点失效、已有导航补偿同时发生，是需要分离验证的链条，不能只给 img
加高度就宣称解决全部跳动。置信度仍是 **Observed(code)，阅读跳动归因 Inferred**。

#### 原有空白测试不足以排除本次症状

`E:/1project/chat-reader/apps/web/e2e/reader-restoration.spec.ts:85–133`
模拟一次 8000px 前序增长和大幅滚动，检查可见块数大于零及一个阅读线距离；
后续跳转采样只要求至少有一个可见块。它能发现整屏空白，却不等于上下半屏覆盖。
这是测试覆盖缺口，不表示已运行测试失败。新增验收必须覆盖延迟图片、局部空白、
小步高速滚动及不点击自动恢复，并区分真实列表尾部留白与异常虚拟占位。

## 审查后的优先级

1. 保留草稿、冻结发布结论；补 OFF-02 恢复设计和真实全量更新验收链。
2. 用合成迟到图片/前序高度变化复现局部空白，完成坐标同步与滚动补偿归属设计。
3. 按用户确定的收藏语义完成入口及响应式设计，再收尾键盘与帮助状态。
4. 实施得到授权后才修改代码、运行对应门禁；生产验收另行授权。

## 做得对且不应撤销的部分

完整轮次、真实 DOM 锚点、选择固定块、已测尺寸缓存、有限 DOM、旧包读取及已有
本地副本保护继续保留。收藏只改展示及增删交互，不迁移 collection key，不改已有
URL，不把“已读”自动解释成“取消收藏”。本轮不增加依赖，不移除虚拟化，不对整个
Reader 高频全量 measure，不放宽既有性能预算，不增加生产正文采集。
