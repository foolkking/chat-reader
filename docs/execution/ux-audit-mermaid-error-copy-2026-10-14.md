# UX 审查与修复前证据：Mermaid 渲染失败提示

日期：2026-10-14

## 范围与证据

本次审查覆盖在线 Reader 的 Markdown Mermaid 代码块失败状态。证据来自当前
源码；没有启动服务、登录、浏览器、测试或构建，因此没有运行时截图或真实
图表样本。

已查看：

- `apps/web/features/conversations/markdown-renderer.tsx`
- `apps/web/components/preferences-provider.tsx`

## 发现

### FBK-READER-01 · Mermaid 解析器原文直接进入阅读界面

| | |
|---|---|
| **Dimension** | System status & feedback / Error recovery |
| **Severity** | Medium |
| **Confidence** | Observed (code); rendered consequence Inferred |
| **Effort** | S |
| **Location** | `apps/web/features/conversations/markdown-renderer.tsx:952–956` |

**Evidence.** `MermaidDiagram` 捕获动态导入或 `mermaid.render` 的异常后，把
`Error.message` 或任意异常值写入 `error`，随后仅在源码回退区显示固定的
“Mermaid 渲染失败”之外，没有展示该值；当前状态已保留原始代码，所以异常
细节不参与恢复。

**Why it matters.** Mermaid 解析器消息属于实现细节，可能随依赖版本变化、包含
内部语法定位或英文堆栈片段。它不能帮助用户恢复图表，反而会让正文中的错误
区域变得不稳定、难以阅读。

**Recommendation.** 只显示稳定的本地化恢复提示，说明图表未能渲染但源码仍可
查看；保留现有源码回退、主题配置、动态加载和错误边界，不展示底层异常文本。

## 修复契约

- 将渲染失败状态收敛为内部标记，不把异常文本写入用户界面。
- 根据当前界面语言显示稳定的中英文提示。
- 保留 Mermaid 源码回退，不增加重试、网络请求、依赖或轮询。
- 不改变成功渲染、主题、性能探针和安全配置。

本报告在源码编辑前写入，后续只做上述范围内的本地修复。

## 已实施的源码修复

`MermaidDiagram` 现在只保留内部失败标记，按当前界面语言显示稳定的
“图表无法渲染，源码已保留”提示，不再把 Mermaid 或动态加载异常文本放入
阅读正文。源码回退、动态加载、主题配置、安全配置和现有性能探针均未改变。

本批仅做源码与文档修复，未启动服务、登录、运行测试／构建／静态验证，未提交、
未触发 CI，也未部署；运行时效果由用户后续验证。
