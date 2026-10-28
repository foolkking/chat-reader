# 搜索正确性与精确定位 — 2026-10-27

## 范围与证据

计划阶段的只读审查以源码 `ac9ed3a` 为基线；本记录在实施阶段固化这些证据。
用户选择“只做检索闭环”，随后授权执行计划，不包含提交、CI 触发或部署。
禁止本地测试、构建、浏览器与服务的既有约束继续生效。

| 发现 | 等级 / 证据置信度 | 基线源码证据 |
| --- | --- | --- |
| 全局结果遗漏附件，计数和键盘候选仍包含附件 | P2 / 高（Observed: code） | `search-results.tsx` 的五类固定分组；API 已允许 `attachment` |
| `%`、`_` 被 SQL LIKE 解释为通配符 | P2 / 高（Observed: code） | `search_service.py` 直接构造 `%{query}%`，没有显式转义 |
| 摘要使用 `matches`，全局/侧栏链接只使用旧单点字段 | P2 / 高（Observed: code） | 三个入口各自构造 URL，未使用 message version、block ID、范围终点 |
| 折叠索引被用于截取原文，密集命中先全量构造再截断 | P2 / 高（Observed: code） | API casefold/空白折叠与 offline UTF-16/空白折叠均丢失原文对应关系 |

用户实际受影响频率、浏览器渲染和生产耗时尚未测量，不能把源码证据表述成
已完成的浏览器复现。附件摘录和批注正文不是 RenderBlock 的偏移域，不得伪造
正文命中。旧版本结果不得把原范围应用到新正文。

## 实施合同

- API LIKE 显式转义 `\`、`%`、`_`；符号查询不被全文检索候选分支放宽。
- `SearchMatch` 是 canonical `RenderBlock.plain_text` 原文的 Unicode code point
  左闭右开范围；quote 必须等于对应原文切片。章节/代码限定所属 block。
- 命中构造每结果最多 100 条，配额进入内部循环；不声称数据库候选分页或总查询
  内存已经优化。离线保留 FlexSearch 召回，不增加完整 Unicode casefold 召回承诺。
- 附件新增可选响应字段 `attachment_id`、`attachment_display_name`，复用已有索引，
  不迁移、不重建用户数据。附件点击进入现有文件面板，不自动下载或预览。
- 全局/侧栏共享链接合同，保留旧链接；URL 只含身份和数值范围，不携带正文摘录。
  Reader 使用已授权当前块验证范围；无效或过期时退到消息并提示重新搜索。
- 已授权当前块在内存中还原 quote/context；相同摘录重复出现时，真实范围优先。
  批注只传保存锚点并打开批注；离线读取沿用已有主表回退，兼容未重建的旧索引，
  真正缺失块的旧离线结果保持消息级定位。
- 文件目标清除文件列表筛选并定位实际行；手机面板切换不会被搜索的晚到关闭撤销，
  桌面旧搜索面板恢复焦点也不得覆盖目标文件行。
- Web 沿用已批准布局、字体、语义 tokens 和既有列表/文件面板，不新增设计系统、
  依赖或视觉改版。静态检查不代替 senior-designer 的实际渲染/对比度验收。

## 验证状态

源码、回归用例与文档实施完成，尚未测试验收。用例接入既有 API 全量、
service-free UX、默认 Reader 与隔离附件浏览器 CI 门禁；没有新增 workflow。
详细用例及显式适配器边界见[Testing](../testing.md#search-correctness-and-exact-navigation--2026-10-27-source-only)。
本地未运行测试、lint、typecheck、build、浏览器或服务；未触发 CI、提交或部署。
唯一执行的检查是只读 Git 差异检查；`git diff --check` 未发现空白错误，
Git 的 LF→CRLF 提示不属于测试回执。
不得将 authored 用例、静态检查或先前版本的成功 CI 当作本批验收。
senior-designer 渲染/对比度清单没有实际输出可评分，不登记满分或视觉验收。
工作区原有 `apps/web/tsconfig.tsbuildinfo` 不属于本批，保留不动。

## 不在本批

数据库候选分组/分页改造、语义搜索、OCR、新索引服务、全量重建、Dexie migration、
离线包格式变化、生产配置、运维备份和磁盘清理。

## 同日后续

[检索完整性与离线入口](SEARCH_RECALL_OFFLINE_2026-10-27.md)补齐本轮离线版本
字段的类型遗漏，并跟进当前对话身份、离线筛选／字段域与资料库目标一致性。
两批源码都尚未执行测试、提交或部署；后续源码不回写成本记录的已验收结果。
