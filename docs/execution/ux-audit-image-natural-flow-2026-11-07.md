# 图片展示重构：计划完成度与效果审查

审查日期：**2026-11-07，Asia/Shanghai**

源码候选：**`9ab309c9335ec3a2504932f198d3fc54fb3a5ed9`**，现有 `master`。

结论：**主体实现已提交，但计划尚未完整落实，效果验收尚未成立。**

## 1. 范围与证据

本次是图片展示这一个功能域的有界审查：对照用户批准的替代计划，
检查几何、正文/Markdown、尺寸面板、保存状态、Viewer、离线和验证代码。
产品是面向混合熟练度用户的 Web 阅读工具；尺寸保存会影响已有公开图片链接，
因此错误保存与误导性的成功状态比一般外观问题更重要。
没有扩展为全产品、生产安全或完整无障碍审计。

证据为当前源码、该提交差异、测试/CI 配置和提交前检查记录。
**源码事实可以确认；屏幕表现、时序与用户体验只能推断，不能冒充实测。**
没有使用 web search，没有启动本地应用、构建或应用测试，没有修改应用代码。
本次只新增这份报告，未提交、推送、部署或创建安排。

- 提交前记录：TypeScript、ESLint、Python AST、改动脚本语法与 diff 检查通过。
  本次没有重新执行这些检查；它们不是应用运行或视觉验收。
- CI `42335833670` 已派发；派发命令开始于 **11:50:56 +08:00**，
  保守首次回查门槛为 **12:42:00 +08:00**。
  **本报告未读取该运行的状态、日志或制品，不知道其成功或失败。**
- 已停止之前本地等待回查的命令；远端 CI 未取消，没有自动后续检查。
- 11 月 6 日旧源码的绿灯和截图不能证明本候选通过。
- 原有 build-info 修改、用户审查文件和 evidence 目录保留。

## 2. 摘要

这不是只换按钮的表面改造：原始几何与保存比例已经分离，普通附件图也确实
改成目标宽度优先的自然换行。长图折叠、根节点尺寸面板和原始 CSS 像素
Viewer 都已有实质代码。不过，Markdown 全局旧 CSS 尚未移除，使“一致的
尺寸与行内语义”存在明确缺口。数字失焦保存与快捷比例点击之间也存在
可由代码推导的提交竞争；保存状态隔离与成功反馈还有缺陷。
Viewer 在冷缓存读取附件期间仍会改变外壳尺寸。新增测试是有价值的，
但其中“旧图默认 100%”测试先保存了 100%，不能作为该需求的完整证明。
因此当前应定位为**已提交、待修正及验收的候选**，不能宣称计划完成或效果通过。

## 3. 逐项完成情况

“代码已落地”不等于“运行通过”；本表没有虚构总体百分比。

| 计划领域 | 源码完成情况 | 效果/验收判断 |
| --- | --- | --- |
| 原始几何与保存尺寸分离 | 已有 `image_geometry_v1`、SHA 校验、方向修正、有界解析、上传/导入补充与单附件只读补读；未增加 migration | 主体落地；新增 API 测试执行结果未读取，不能宣称全链路通过 |
| 普通附件图尺寸与自然换行 | 共用计算函数，flex source-order/8px/顶部对齐/行居中；删除固定列数和图格尺寸约束；隐藏导航挂载真实 occurrence | 代码方向正确；300/500px 与 607/608px 临界有真实图片测量测试，结果待验 |
| Markdown、真正行内、链接与表格图片 | 尺寸数据和组件分支已接通，图片段落使用 span，链接/表格保留原生 img | **部分完成**：全局旧高度上限和 block 样式仍生效，见 IMG-01 |
| 长图折叠与阅读位置 | 保留宽度、下方展开入口、会话缓存、真实 occurrence 收起导航均已实现 | 代码落地；收起前后锚点两分支、用户打断与完整对外长图证据不足，见 TEST-02 |
| 小图、图注、加载失败、透明图 | 普通附件图不再常驻灰底/裁角；媒体、图注和操作分离；44px 交互容器；Viewer 三种检查背景 | 主体落地；没有本候选截图审查。原生 Markdown 失败占位仍是独立旧分支，需专项检查 |
| 尺寸面板 | 根 portal、约 320px、固定打开锚点、侧栏避让、移动底部面板、百分比/快捷项/栏宽建议均有实现 | 部分完成；数字转快捷操作存在提交竞争，见 FORM-01；虚拟键盘尚未验 |
| 保存状态及只读入口 | 有 pending 去重、认证代次防护、未知结果只读核对、区分 409/413/422/429 | 部分完成；写状态作用域缺失、草稿仍显示已保存，见 STATE-01/02 |
| Viewer | 保留现有库，真实画布计算 fit/width/1:1，工具移出画布，桌面/手机缩略图入口 | 主体落地；冷加载/切图外壳仍可先缩后放，见 VIEW-01 |
| 公开输出与离线 | 原公开 URL/转换安全路径未改；离线 v3 增加可选几何，Dexie v2 及旧包入口保留；正文离线尺寸不借 owner 保存缓存 | 兼容方向正确；没有证据表明改成折叠裁片或自动公开；仍需完整 CI，不将“未改接口”当兼容验收 |
| 阅读稳定性与验证 | 门禁仍要求至少 27 个用例、64 条完整逐帧证据，峰值 ≤2px、稳定后 ≤1px；已有四条新增集成用例 | 门禁没有放宽，但尚无本候选执行结果；默认未保存旧图场景有验证缺口，见 TEST-01 |
| 视觉、响应式、语言与交互 | 新合成 PNG 含文字、表格线、图形和透明内容；375/800/1440 及明暗/中英文组合进入测试代码 | **效果未验收**：未检查新截图；控件适配器测试不等于完整 Reader/Share/Offline 实测 |
| 文档与交付边界 | 当前文档注明候选而非生产；本次无新依赖、migration、部署 | 边界保持；合同中的一致性描述仍须以本报告发现的实现缺口为准 |

主要正向证据：

- [共享尺寸公式与自然行高估算](E:/1project/chat-reader/apps/web/lib/image-display.ts#L23)
- [原始几何解析](E:/1project/chat-reader/apps/api/app/services/assets/image_geometry.py#L14)
- [授权后的单附件只读补足](E:/1project/chat-reader/apps/api/app/services/assets/attachment_service.py#L131)
- [上传/导入字段处理](E:/1project/chat-reader/apps/api/app/services/canonical/persistence.py#L800)
- [自然换行 CSS](E:/1project/chat-reader/apps/web/app/globals.css#L515)
- [长图和独立操作区](E:/1project/chat-reader/apps/web/features/attachments/attachment-block.tsx#L150)
- [Viewer 原始像素变换](E:/1project/chat-reader/apps/web/features/attachments/image-viewer-geometry.ts#L5)
- [离线快照读取](E:/1project/chat-reader/apps/web/lib/offline-db.ts#L1134)
- [64 条证据校验器](E:/1project/chat-reader/scripts/ci/verify-reading-stability.mjs#L9)

## 4. 优先发现

共 **8 项**：两项高优先级实现问题、一项高优先级验证缺口，以及五项中等问题/缺口。
没有把未做的视觉审查计作已观察到的视觉缺陷。

### IMG-01 — Markdown 旧 CSS 仍覆盖新尺寸和行内规则

- **类型 / 维度：** 缺陷；布局、文档语义、一致性。
- **严重性：High（优先修复）。**
- **可信度：Observed（code）；具体渲染后果 Inferred，未浏览器测量。**
- **位置：**
  [globals.css:249](E:/1project/chat-reader/apps/web/app/globals.css#L249)；
  [markdown-renderer.tsx:1046–1086](E:/1project/chat-reader/apps/web/features/conversations/markdown-renderer.tsx#L1046)。
- **证据：** 全局规则仍是
  `.reader-rich-image { display: block; max-height: min(70vh, 40rem); }`。
  该规则位于 Tailwind utilities 之后。新 img 仍带 `reader-rich-image`，
  添加的 `inline-block` 是同等 specificity 的 utility，不能抵消后面的 block；
  inline style 虽有 `width` / `height:auto`，但没有清掉 `max-height`。
- **用户后果：** 真正行内图片仍会被 block 布局打断；链接、表格、行内长图
  继续受到另一套高度上限约束，无法保证与普通附件图同尺寸、等比例。
  此处不声称已测得某个具体缩窄或变形数值。
- **建议：** 明确原生图片与块级图片的 display 策略，移除旧全局高度上限；
  不用加更多局部上限掩盖问题。对长图的行内/表格/链接分支单独测实际
  bounding box、长宽比和段落行盒，保留合法 DOM。
- **工作量：S（CSS 修正）；M（补齐语义与尺寸回归）。**

### FORM-01 — 数字输入失焦保存可能吞掉紧接着的快捷比例选择

- **类型 / 维度：** 缺陷风险；输入与核心保存流程。
- **严重性：High。**
- **可信度：Observed（code）；浏览器事件序列及最终表现 Inferred，待复现。**
- **位置：**
  [image-display-controls.tsx:100–103](E:/1project/chat-reader/apps/web/features/attachments/image-display-controls.tsx#L100)、
  [131–138](E:/1project/chat-reader/apps/web/features/attachments/image-display-controls.tsx#L131)、
  [181–189](E:/1project/chat-reader/apps/web/features/attachments/image-display-controls.tsx#L181)；
  [image-scale-slider.tsx:103–105](E:/1project/chat-reader/apps/web/features/attachments/image-scale-slider.tsx#L103)。
- **证据：** 数字框 `onBlur` 立即调用 `save()`；保存同步写入共享
  `phase:"saving"`，之后的 `save()` 会因同一缓存锁直接返回。
  快捷项仅在 `onClick` 触发保存，没有协调这一次内部焦点切换。
- **推导场景：** 已确认 100%，数字框输入 50%，不按 Enter，直接点击 75%。
  数字框失焦先提交 50%；75% 点击随后被 disabled 或保存锁拒绝。
  具体事件表现需要真实鼠标/触摸复现，但当前代码没有保留第二个选择。
- **用户后果：** 用户点的是 75%，最终可能保存成 50%，且已有公开图片链接
  也随之更新。用户不得不重新操作才能得到刚刚选择的值。
- **建议：** 将同面板内的“数字输入 → 快捷项/栏宽建议/滑杆”识别为一次
  最终选择；只提交最后明确选择的值。外部失焦和 Enter 仍可保存，
  不引入“应用”步骤，也不在结果未知时自动重发。
- **工作量：M。**
- **验收：** 上述 100→输入50→点击75 路径只发一次 PUT，值为75；
  加慢网与真实触摸，检查 body、状态和服务器最终值一致。

### STATE-01 — 写状态没有按 owner / Share / Offline 访问域隔离

- **类型 / 维度：** 缺陷；状态覆盖、只读行为与离线隔离。
- **严重性：Medium。**
- **可信度：Observed（code）；跨入口显示/请求后果 Inferred。**
- **位置：**
  [image-display-controls.tsx:30–38](E:/1project/chat-reader/apps/web/features/attachments/image-display-controls.tsx#L30)、
  [87–93](E:/1project/chat-reader/apps/web/features/attachments/image-display-controls.tsx#L87)、
  [178](E:/1project/chat-reader/apps/web/features/attachments/image-display-controls.tsx#L178)；
  对照 [image-presentation.ts:48–56](E:/1project/chat-reader/apps/web/features/attachments/image-presentation.ts#L48)。
- **证据：** 几何/尺寸缓存含 `access.kind` 与 scope，写状态却只含
  `generation + attachment.id + SHA`；SizeEditor 的 React key 同样没有访问域。
  错误区不以 editable 为条件，`read()` 也不检查 editable，
  始终调用 owner 的 `/api/attachments/:id/image-display`。
- **用户后果：** 同一认证会话里，owner 未确认的保存状态可能出现在同一附件的
  Share/Offline 小图选项中，诱导只读入口去核对 owner 的在线结果。
  Offline 面板说明可能因此与自己的快照不一致。
  **没有发现这会绕过后端授权或改写 Dexie；不将其夸大为权限越权或数据丢失。**
- **建议：** 把 owner 写状态与只读展示隔离；错误恢复入口及读取函数均执行
  权限/数据源约束。只有同一可编辑 owner 域的重复引用共享提交状态。
- **工作量：M。**
- **验收：** owner 产生 uncertain 后进入同附件 Offline/Share/只读 Compare；
  不出现 owner 写恢复动作，Offline 不发 owner image-display 请求。

### STATE-02 — 新草稿仍显示上一轮“已保存”

- **类型 / 维度：** 缺陷；保存反馈。
- **严重性：Medium。**
- **可信度：Observed（code）；屏幕状态组合 Inferred。**
- **位置：**
  [image-display-controls.tsx:79](E:/1project/chat-reader/apps/web/features/attachments/image-display-controls.tsx#L79)、
  [183](E:/1project/chat-reader/apps/web/features/attachments/image-display-controls.tsx#L183)、
  [203–204](E:/1project/chat-reader/apps/web/features/attachments/image-display-controls.tsx#L203)。
- **证据：** 成功后 phase 保持 `saved`；继续输入或拖动仅更新 draft，
  不清除/区分该成功状态。状态行仅凭 phase 显示“已保存”。
- **用户后果：** 用户看到新的比例和像素选择，旁边却仍是“已保存”，
  容易把未松手的草稿当成已更新的对外尺寸。
- **建议：** 不修改“松手保存”决定；将状态与最后确认的百分比绑定。
  draft 不同于确认值时隐藏旧成功提示，或显示
  “当前选择尚未保存，松手即保存”。成功后明确“已保存为 50%”。
- **工作量：S。**
- **验收：** 保存50成功后拖到75但不松手，PUT数不变，不能仍宣称75已保存；
  取消回到50，松手后才确认75。

### VIEW-01 — Viewer 冷缓存或切换未读附件时，外壳仍会缩放

- **类型 / 维度：** 缺陷；布局稳定、感知性能。
- **严重性：Medium。**
- **可信度：Observed（code）；尺寸切换可由公式推导，视觉过程 Inferred。**
- **位置：**
  [attachment-viewer.tsx:190–209](E:/1project/chat-reader/apps/web/features/attachments/attachment-viewer.tsx#L190)、
  [302](E:/1project/chat-reader/apps/web/features/attachments/attachment-viewer.tsx#L302)；
  [viewer-presentation.ts:67–94](E:/1project/chat-reader/apps/web/features/attachments/viewer-presentation.ts#L67)。
- **证据：** Viewer 使用独立的 attachment-viewer query，初始无附件数据时
  `viewerKind=null`，走 compact 尺寸；读取成功才进入固定 image 尺寸。
  切换到另一个冷 query 同样可能退回 null，且外壳保留 width/height transition。
  按代码公式，1440×900 桌面从 compact **720×414** 变为 image **1100×810**；
  这些是计算值，不是截图测量值。
- **用户后果：** 加载或翻图期间工具位置和画布大小改变，与“同一图片会话
  外壳稳定”的决定不符。缩放本身已不驱动外壳，但加载阶段仍未完成。
- **建议：** 用已有图片入口/会话类型确定并保持图片外壳，
  不把暂时缺少详情当作普通 compact 附件；不改其他附件架构。
- **工作量：M。**
- **验收：** 延迟详情、延迟解码、冷缓存上一张/下一张，
  非用户最大化/视口变化期间 panel rect 不变。

### DATA-01 — 折叠长图的“正文实际显示”没有区分完整成像与当前可见区域

- **类型 / 维度：** 说明缺口；数据展示、微文案。
- **严重性：Medium。**
- **可信度：Observed（code）；理解误差 Inferred。**
- **位置：**
  [attachment-block.tsx:186–197](E:/1project/chat-reader/apps/web/features/attachments/attachment-block.tsx#L186)、
  [222–223](E:/1project/chat-reader/apps/web/features/attachments/attachment-block.tsx#L222)；
  [image-display-controls.tsx:195](E:/1project/chat-reader/apps/web/features/attachments/image-display-controls.tsx#L195)。
- **证据：** 媒体容器高度为折叠后的 `body.height`，面板收到的却是
  `body.fullHeight`，标签统一为“正文实际显示”。以900px有效小视口、
  240×4000长图为例，当前可见高度是630，面板显示240×4000。
  img 本身确实是4000高，只是被裁切展示，因此不是指控像素计算错误。
- **用户后果：** 三组像素本来用于解释真实效果，却没有解释为什么
  “实际显示”与眼前可见内容不一致。
- **建议：** 保留完整成像尺寸，折叠时附“当前可见 240×630，长图已折叠”，
  或明确标签为“正文完整尺寸（已折叠）”；不得把折叠高当作保存高。
- **工作量：S。**

### TEST-01 — “旧图默认 100%”集成测试先保存 100%，证明对象不完整

- **类型 / 维度：** 验证缺口；核心首次使用与回归可信度。
- **严重性：High（验收阻断，不等于已证明功能失败）。**
- **可信度：Observed（test code）。**
- **位置：**
  [image-natural-flow.spec.ts:76–99](E:/1project/chat-reader/apps/web/e2e/image-natural-flow.spec.ts#L76)；
  [test_image_geometry.py:16](E:/1project/chat-reader/apps/api/tests/test_image_geometry.py#L16)。
- **证据：** 名为 legacy/default 一致性的浏览器用例第一步是
  `setSize(...,100)`，然后仅在 reader-turn 响应中删除元数据。
  单附件详情仍可返回服务器已经保存的100%。
  API 单测确有未保存旧图的只读几何场景，但没有把它贯通到首次正文布局。
- **用户后果：** 即使这条集成测试通过，也不能排除“真正从未保存过比例、
  数据库也没有几何的旧图，首次仍然显示错误”。
- **建议：** 独立创建真正无两个保留字段的旧图 fixture，不预先 PUT；
  首次可见读取后断言实际尺寸和读取零写入；再在 UI 显式保存100，
  比较前后同一真实图片 bounding box。保留现有已配置旧图场景。
- **工作量：M。**

### TEST-02 — 长图收起的阅读位置分支还没有相应逐帧证明

- **类型 / 维度：** 验证缺口；导航稳定性、内容完整性。
- **严重性：Medium。**
- **可信度：Observed（test code）。**
- **位置：**
  [image-natural-flow.spec.ts:112–139](E:/1project/chat-reader/apps/web/e2e/image-natural-flow.spec.ts#L112)；
  [reading-stability.spec.ts:195–315](E:/1project/chat-reader/apps/web/e2e/reading-stability.spec.ts#L195)。
- **证据：** 新用例证明的目标包括展开4000高、虚拟重挂保留状态、点击收起和
  Viewer 模式；没有测收起前后“存活阅读锚点”与“锚点落入隐藏区”两个分支。
  原64条轨迹主要围绕加载、阅读滚动和Viewer返回，不覆盖这次新折叠动作。
  本用例也未读取公开输出，检查折叠后对外仍是完整240×4000。
- **用户后果：** 最容易因大幅高度变化而回跳的动作，仍缺需求对应的证据；
  保留旧轨迹数量不能替代新增行为的验证。
- **建议：** 在原门禁之上增加两种收起位置的逐帧场景，以及收起导航中
  用户立即滚动使旧恢复失效的场景；覆盖不同滚动容器，不移动Compare另一侧。
  另断言对外长图完整，不仅测img元素高度。
- **工作量：M。**

## 5. 修正与验收顺序

这是建议顺序，**本次尚未执行修复**。

1. **先修 IMG-01 与 FORM-01。** 前者直接破坏统一尺寸/文档语义；
   后者可能保存非最后选择的比例。为两个问题增加真实浏览器回归。
2. **同批修 STATE-01/02 与 VIEW-01。** 收口状态来源、草稿/确认语义，
   稳定冷加载和切图外壳。DATA-01 可以一并低成本修正文案。
3. **补 TEST-01/02。** 不用已保存数据冒充未保存旧图，也不用原64条
   加载/返回轨迹宣称新折叠行为已被覆盖。
4. **读取首轮 CI 只能在既定门槛之后。** 它只能说明 `9ab309c`，
   即使全绿也不能自动关闭本报告指出的未覆盖问题。
5. 修正后需要**新精确源码的完整 CI**，每次派发重新遵守至少50分钟首次回查；
   不只跑局部门禁，不创建安排，不部署。
6. 在该源码的制品上逐张审查正文、尺寸面板和Viewer截图：
   375/800/1440、栏宽临界、长横/长竖、文字/表格/流程图/透明/小图，
   检查遮挡、余白、图注归属和操作可发现性。成功数字不能替代截图审查。

低成本且不改变既定产品决定的改进是：清除冲突CSS、让“已保存”绑定确认值、
补充折叠说明。**不建议另加应用按钮、大中小模式、第二套尺寸或新Viewer。**

## 6. 已做对、应保留的部分

- 不把图格稳定误当作尺寸正确；新的实际图片测量和临界栏宽测试是正确方向。
- 普通附件图不再按高度把240×4000压成细条，折叠和导出路径是分离的。
- 几何获取不必先保存比例；授权后单读、批量不扫描、失败仍保留原图访问，
  这是合理的数据边界。
- 原图与公开派生图、安全转换限制、普通Markdown、离线显式更新没有被
  另起架构替代；没有新增依赖或migration。
- 按权限隐藏保存控件、未知提交不自动重发、关闭不等于取消服务器写入，
  主状态设计值得保留，修复作用域和反馈即可。
- 保留百分比、使用图外操作、44px命中范围、真实CSS像素1:1和现有阅读所有权，
  不因本次审查反复推翻已确认的设计决定。

## 7. 仍需实测的问题，不列为已确认缺陷

1. 移动底部面板在软键盘出现、横屏和系统放大文字时是否仍可操作？
   当前有dvh/safe-area，但没有本轮真实虚拟键盘证据。
2. panel 的 ResizeObserver 会重新计算避障位置；保存状态/错误说明改变高度时，
   是否仍达到“打开期间不跳走”？仅捕获旧触发点不能替代坐标测试。
3. owner 的 Infinity 尺寸缓存优先于新传入 metadata：
   另一设备修改比例后，本会话重新进入正文是否会长期显示旧值？
   需要两客户端/新快照回归，不在本报告断言已观察到跨设备错误。
4. 真正行内/链接/表格图片的失败占位仍采用旧 fallback 文本框：
   小图失败时是否破坏真实几何或遮挡邻近内容？需要这些分支的失败截图。
5. Viewer “适合宽度”当前不自动放大小图；这是现行候选的明确策略，
   本次不把它擅自改成放大，也不把该取舍本身判为缺陷。
6. 源码级四并发、SHA与认证代次隔离已存在，但排队期间换账号、替换来源、
   中途卸载的实测覆盖仍需核对完整CI，不能仅凭纯函数测试宣布无竞态。

**本轮退出条件：交付审查，不是交付完成声明。**
应用源码仍停留在上述候选；下一步应是有针对性的修正和补证，
而不是用旧绿灯、静态检查或“测试已写”代替计划验收。
