# UX quick review — 表格中的横线内容

2026-10-21；先记录源码与实际 GFM 对照，再补真实工作区失败回归，最后修复并完成
六项本地门禁。范围仅为现有 Web 表格工具的识别、双向编辑和应用；不改布局、模式、
帮助文案或服务器。使用合成数据、当前源码和已安装的 `react-markdown`/`remark-gfm`，
不联网搜索、不 CI、不推送、不部署。

## 最重要的结论

`---`、`:---:` 等符号可以是表头或数据单元格的真实内容，不应因为看起来像分隔线就
拒绝整张表格。修复前，工具解析器拒绝了已被 GFM 正常显示的表格，真实工作区也进入
不可编辑的恢复状态。邻近的含竖线段落还要求按实际结构定位；不能靠更“像表格”的
形状猜测边界。

## 发现与证据

| ID | 类型/维度 | 严重度 | 置信度 |
| --- | --- | --- | --- |
| FLOW-06 | 合法表格被误拒绝；核心编辑流程 | Medium | Observed（代码、真实 GFM SSR 与隔离 Chrome 工作区） |

**位置：** `apps/web/features/editing/markdown-table-tools.ts` 的完整模型检查、
简单草稿快速路径、逐行增量更新及 `tableRange` 光标范围发现。

**修复前证据：** [初始 GFM 对照](ux-audit-table-delimiter-content-2026-10-21-evidence/baseline-gfm-comparison.json)
和 [20 项初始源码摘要](ux-audit-table-delimiter-content-2026-10-21-evidence/baseline-source-sha256.json)
相邻保留。`dash-header`、`dash-body`、`colon-body` 等输入由实际 GFM 渲染为真实表格，
但工具转换器和草稿解析器返回空。真实工作区失败基线在 55 个场景成功后复现：
共享预览里有表格，Table tool 却显示“选择完整表格重试”，没有可编辑草稿。
见[失败摘要](ux-audit-table-delimiter-content-2026-10-21-evidence/baseline-workspace-failure.json)
及[基线截图](ux-audit-table-delimiter-content-2026-10-21-evidence/baseline-delimiter-content-desktop-light.png)。

**影响：** 校对符号、状态或分隔内容的读者无法从正常显示的表格进入工具；
在网格中完成编辑后，也可能因 Apply 路径复用拒绝规则而无法应用。没有真实使用频率
或流失数据，不将这个具体解析缺陷扩大为整体编辑器不可用。

## 修复与验证

完整解析、简单草稿解析和增量行更新不再把合法表头/数据中的 `---` 类单元格误判为
额外分隔结构。自动光标发现按表头之后第一条可用分隔行锚定表格范围。明确多行选区
若只有更晚位置出现分隔行，仍拒绝猜测，避免吞入相邻 pipe prose。没有真实分隔行时，
横线形状的首行也能保留为表头并补出新的分隔行。HTML/代码保护、输入预算、原文边界
和渲染政策不变。

30 组普通/引用/列表、LF/CRLF 合成表格由安装的 ReactMarkdown+remark-gfm 实际渲染；
规范化前后 HTML 完全相同。隔离 Chrome 实际工作区覆盖：

- 桌面横线表头与数据行进入编辑、网格修改、Apply 和单次 Undo；
- 网格修改后经边缘 `+` 加行，再从 Markdown 编辑并应用；
- 周边普通 pipe prose 保留，变更只落在目标表格；
- 375px 触屏及中文/Emoji 单元格编辑；
- 新增源码纯测试覆盖完整/快速/增量路径、选区和游标范围。

最终门禁：**122 专项、76 Chrome、69 文件/1,513 无服务测试**，以及 lint、
非增量 typecheck、单 worker 生产构建全部退出码 0。详细见[门禁摘要](ux-audit-table-delimiter-content-2026-10-21-evidence/final-gates.json)、
[浏览器结果](ux-audit-table-delimiter-content-2026-10-21-evidence/final-browser-result.json)、
[桌面截图](ux-audit-table-delimiter-content-2026-10-21-evidence/final-delimiter-content-desktop-light.png)、
[移动截图](ux-audit-table-delimiter-content-2026-10-21-evidence/final-delimiter-content-mobile-zh.png)
和[源码摘要链](ux-audit-table-delimiter-content-2026-10-21-evidence/source-hash-chain.json)。
20 个源码/测试对象里只修改了解析器源码；其余 19 个哈希与回归基线一致。
随后撤回无效输入试验，再顺序重跑六项门禁；20 个哈希在重跑前后完全一致，
见[命令回执](ux-audit-table-delimiter-content-2026-10-21-evidence/restored-gate-receipts.json)
及[29 项制品清单](../evidence/table-tool-delimiter-content-2026-10-21.json)。

## 边界和后续

Chrome 使用真实表格工作区、CodeMirror、共享 MarkdownRenderer 及真实工具界面；
外部 API/Next 等不相关依赖由本地适配，因此不是认证服务器、全量应用、真机、
辅助技术或 Reader/Share/Offline 验收。既有大表长任务仍是开放问题，不能从本轮通过
推导为性能 SLA 或服务器 OOM 修复。

目标继续活动，无限预算；仅本地修改与验证，无新 migration，不启动 CI、不推送、不部署。
