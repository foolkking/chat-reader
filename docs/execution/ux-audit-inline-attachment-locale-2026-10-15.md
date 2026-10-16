# UX 审查与修复前证据：内嵌附件块语言一致性

日期：2026-10-15

## 范围与证据

审查 Reader、Share 和其他消息正文中的内嵌附件块在英语界面下的可见文案、
按钮标签和辅助技术名称。证据来自当前源码
`apps/web/features/attachments/attachment-block.tsx`；没有启动服务、
浏览器或测试，因此没有观察真实 locale 切换、读屏输出或 CSS 布局。

## 发现

### LOCALE-INLINE-ATTACHMENT-01 · 英语界面仍显示硬编码中文附件状态

| | |
|---|---|
| **Dimension** | Clarity / Accessibility / Internationalization |
| **Severity** | Medium |
| **Confidence** | Observed (code); user confusion is Inferred |
| **Effort** | S |
| **Location** | `apps/web/features/attachments/attachment-block.tsx:83–347` |

**Evidence.** 内嵌附件块直接写入中文字符串，包括加载中的“正在加载”、失败
的“附件信息加载失败”、重试、空文件、缺失、不可预览、未缓存、展开/收起、
打开完整预览、查看、播放、下载，以及 `aria-label`。该文件没有读取当前
界面 locale，也没有把语言传入这些子组件；因此英文界面下仍会出现中文可见
文案和辅助技术标签。

**Why it matters.** 用户可以理解文件名但无法稳定理解状态或操作，读屏用户
还会收到与界面语言不一致的控件名称。附件错误、下载和打开操作属于高频且
需要快速判断的消息内控件。

**Recommendation.** 从现有 PreferencesProvider 读取 resolved locale，在附件
块内生成最小的中英文文案，并传递给加载、失败、媒体、预览、文件行和下载
控件。只改展示文案和 ARIA/title，不改附件访问、缓存、Viewer、上传或
Reader anchor。

## 修复边界

- 只修改 `attachment-block.tsx` 的可见文案、`aria-label`、`title` 和语言传递。
- 保持现有 attachment render plan、Query、Object URL、Viewer、下载 URL、
  Reader/Share 定位和资源策略不变。
- 不把真实对话正文、ID 或 token 写入文档或日志。
- 新回归为未执行的源码/状态检查；真实英文界面、locale 切换、浏览器和
  屏幕阅读器验收仍待授权后的专项验证。

本报告先于本批产品源码修改创建。本批不启动服务、不运行测试、lint、类型检查、
build 或浏览器，不提交、不触发 CI、不部署。

## 已实施的源码修复

内嵌附件块现在读取当前 resolved locale，并将最小的中英文文案传入各展示子块。
加载、失败、重试、空文件、缺失、格式不支持、展开/收起、打开、查看、播放、
下载和辅助标签随界面语言切换；附件访问、渲染、缓存、下载和定位语义不变。

`scripts/ux/inline-attachment-locale.test.mjs` 已编写为源码/状态回归，但未执行；
它不挂载 React、不切换真实 locale，也不建立浏览器或屏幕阅读器验收。本批仍未
启动服务、运行 lint／类型检查／build，未提交、触发 CI 或部署。
