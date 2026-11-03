# Reader 富内容与 Obsidian Markdown 设计 — 2026-11-02

**状态更新（2026-11-03）：**有限安全富内容、相邻 HTML AST 分片合并、真实
Reader 可视区缺段检测和变化前真实锚点补偿均已进入当前源码；本地专项
Reader/rich-content/geometry 回归已通过。Web 浏览器视觉、真实设备、
性能基准、CI、线上核验和部署仍由用户执行，本设计记录不把源码/单测通过
当作这些门禁的验收。11 月 2 日[完成度复审](ux-audit-plan-completion-2026-11-02.md)
是当时的历史快照，其“尚未实施”清单已由后续源码接续。
同日[再次复审](ux-audit-reader-zip-completion-2026-11-03.md)补齐安全 HTML 中附件
occurrence 解析、离线 blob 授权恢复和音视频真实锚点，渲染策略更新为 v13；
几何恢复限制到消息可见交集，取消后释放补偿状态，不再全量重置行高缓存。

本批接续
[Reader、收藏与离线恢复设计](READER_FAVORITES_DESIGN_2026-11-02.md)，目标是在不引入
任意 HTML 执行面、不破坏 Reader/Share/Offline 的虚拟化和定位语义的前提下，让正文
能够承载常见的 Obsidian/AI 导出内容。canonical Markdown 仍是数据真值；渲染增强不写回
原文，不改变 `.cr`、离线包 v1/v2/v3 或 Dexie v2。

## 已有能力与本批范围

| 内容 | 当前处理 |
| --- | --- |
| CommonMark、GFM 表格、任务列表、删除线、自动链接、硬换行 | 继续沿用现有渲染链 |
| 数学公式、KaTeX 错误保留、Mermaid 源码回退 | 继续沿用现有有界渲染 |
| 脚注、代码块、代码复制、主题和移动端溢出 | 继续沿用现有能力 |
| Obsidian callout | 支持 `NOTE/TIP/INFO/WARNING/IMPORTANT/CAUTION/DANGER/QUESTION/TODO` 及 `abstract/summary/tldr/success/check/done/failure/fail/missing/bug/example/quote/cite` 等别名；`+` 默认展开、`-` 默认收起 |
| Obsidian `==高亮==` | 仅转换普通 Markdown 文本节点；代码块、行内代码和跨行/空内容标记不转换 |
| 原生折叠 | 允许安全的 `<details><summary>…</summary>…</details>`；相邻 HTML AST 分片与中间空白节点可合并，跨普通 Markdown/代码块不拼接。精确定位会展开匹配目标的折叠祖先，不打开无关卡片 |
| 静态富 HTML | 有限文本、列表、表格、链接、图片、卡片布局和有限 CSS；相邻 HTML 节点可在同一父节点内合并；事件/危险属性丢弃，脚本/未知标签/不平衡或超预算内容惰性回退 |
| 图片 | 仅本同源路径、受信附件 URL 或本地 blob；支持可信 `width/height` 预留比例；普通外部图片不自动请求，失败保留替代内容和安全链接。ZIP 资源必须先通过 Adaptive Import 成员分类与附件身份绑定 |
| 音频/视频 | 仅本同源路径或授权附件上下文的本地 blob，强制 `controls`、`preload=metadata`，不允许 autoplay；失败保留安全打开入口及 occurrence 锚点 |
| PDF/普通附件 | 继续使用现有 `cr-asset://` 附件块/文件查看器；ZIP 内相对 `assets/...` 必须先由导入器绑定附件身份，普通原始 HTML 不猜测本机或服务器资源路径 |

## 安全边界

`remark-safe-html.ts` 在 Markdown AST 层建立有界白名单，限制源码 50,000 字符、节点
1,500 个、嵌套深度 24；只投影允许标签和受控属性。样式只接受布局、间距、圆角和尺寸的
有限值，拒绝 `url()`、`expression`、`@import`、反斜杠和尖括号。之后仍经过
`rehype-sanitize`，React 组件再次限制媒体源和尺寸。

禁止项包括 `<script>`、`iframe`、`object`、`embed`、SVG 动画、事件属性、`srcdoc`、
外部图片/音频/视频、`data:`/`javascript:`/`vbscript:`/协议相对地址，以及把未知 HTML
当作可执行内容。解析失败的原文只作为惰性代码/文本回退，不进入 DOM HTML 执行面。

## 几何与性能合同

- 图片在加载前使用源 `width/height` 建立稳定比例盒；未知比例不伪造大尺寸。
- HTML 卡片、details、callout、Mermaid 和媒体加载后的高度变化继续由现有
  `ResizeObserver`/TanStack virtualizer 测量。
- 消息容器高度变化会在合并后的下一帧通知已挂载消息重新核对绝对偏移；
  这只更新 `scrollMargin`，不清空行高缓存，也不写 `scrollTop`，避免迟到资源
  把窗口滚动路径留在旧坐标。
- 元素滚动和 window 滚动路径都在虚拟范围变化时核对消息容器的真实绝对偏移，
  只更新 `scrollMargin`，不清空已测行尺寸、不把坐标修复写成用户阅读位置、不写
  `scrollTop`。
- 虚拟区按真实可视区与挂载行区间并集检测空白/内部缺段，只在已确认缺口时
  重测相关挂载行并有限恢复；变化前捕获真实行锚点后，按滚动意图/导航所有权
  判定是否补偿，不把程序化补偿登记为用户阅读位置。
- 该几何实现已有源级回归；三种 Reader/Share/Offline 实际浏览器路径、慢资源
  及不同输入设备仍需由用户的 Web/CI 测试验收。
- Reader 的资源失败应显示稳定替代状态，不因图片/媒体失败把正文行折叠成不可见空洞。
- 未测得 p95、long task、RSS 或真实设备内存收益；必须由用户按现有 Web/CI/线上门禁
  验证，不能用本地源码检查替代。

## 尚未宣称支持的 Obsidian 功能

Wikilink、`![[附件]]`、Bases、Dataview 查询、Canvas、社区插件、宏、任意 JS 和需要
附件目录解析的相对资源尚没有可靠的产品目标或 canonical 资源身份，因此本批不把它们
伪装成已支持。若后续要支持 `![[附件]]`，必须先定义附件名冲突、版本、权限、离线包
路径和 Share 只读映射，再接入现有 `cr-asset://`/附件渲染合同。

## 交付与验证边界

当前源码改动涉及安全 Markdown 配置、正文渲染器、虚拟布局恢复、全局 Reader 样式和
富 Markdown 回归。Adaptive ZIP 附件为既有 Adaptive Import/canonical attachment
合同的扩展，见[ZIP 合同](../system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md)；未新增
migration、离线包版本或 Dexie 字段。用户负责 Web build、专项浏览器测试、CI、
线上测试和部署，并应重点观察：

1. 360/375/768/1440px 下卡片、details、callout、图片失败替代内容不横向溢出；
2. 快速向下/向上滚动时不再出现必须点击正文才能恢复的上下空白；
3. 外部媒体不产生网络请求，脚本不执行；
4. 折叠展开、媒体迟到、搜索定位与 Reader/Share/Offline 的真实锚点不漂移；
5. 原有收藏、帮助、离线失败复核和旧 Markdown/附件回归保持通过。

富 HTML 块和折叠块还会约束自身最大宽度及 flex 子项的最小宽度，
避免长链接或卡片文本把正文撑出水平滚动条。
