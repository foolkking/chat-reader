# 下一轮方向审查：检索结果生命周期与重复定位 — 2026-10-27

## 同日实施跟进（源码完成，未验收）

用户随后授权按本审查优化；[实施记录](SEARCH_LIFECYCLE_2026-10-27.md)覆盖
NAV-REPLAY、OFFLINE-FRESHNESS 和 OFFLINE-DUPLICATE：内存激活意图驱动重复定位，
本地批注实体／删除状态优先，窄内容订阅驱动有代际的索引重建。SEARCH-CAP 继续暂缓。
已补回归、未执行；无本地门禁、浏览器、服务、CI、提交或部署。
下方正文与行号保留**实施前只读审查**的历史含义，不是当前实现或运行验收。

## 范围与证据

这是面向下一轮取舍的源码 quick review，不是全产品 UX 验收或实施授权。检查当前
未提交的搜索工作树，聚焦 `/library` 离线搜索的结果激活、批注索引更新与结果完整性。
这两批搜索改动尚未经过本地门禁或 CI；本审查不把源码推断写成运行复现。

证据来自 `ac9ed3a` 基线上的当前未提交源码、已有测试源码和此前记录；未访问生产资料，
未进行 web search，未运行测试、lint、typecheck、构建、浏览器或服务，未触发 CI、
提交或部署。标为 **Observed (code)** 的内容是源码事实；用户实际遇到的频率及
浏览器表现仍待验证。本次只新增审查与文档导航，没有修改产品代码。

## 结论

1. 下一步不宜继续叠加搜索匹配算法；更直接的方向是让结果在重复点击和离线数据
   更新后仍然可靠。
2. 有两项应先验证并修复的离线体验风险：相同 `/library` 结果再次激活可能不触发
   Reader 导航；批注索引既可能陈旧，也可能把同一批注列出两次。
3. 当前对话搜索的分页/截断提示是次级机会，应以真实长对话需求决定是否进入后续小批，
   不与索引生命周期修复捆成大型搜索重构。

## 发现

| ID | 类型 | 发现 | 严重度 | 置信度 | 工作量 |
| --- | --- | --- | --- | --- | --- |
| NAV-REPLAY | Defect 候选 / 再次定位 | `/library` 中重新点击同一精确结果可能被 Reader 当作已处理的同一个 URL 目标 | Medium | 源码链路高；浏览器后果待复现 | S–M |
| OFFLINE-FRESHNESS | Defect / 离线索引一致性 | Reader 修改批注后，已初始化的 worker 索引没有明确的失效/重建订阅 | Medium | Observed (code)；用户可见程度待验证 | M |
| OFFLINE-DUPLICATE | Defect / 精确度 | 同一批注可由持久搜索文档与私有批注投影各生成一个离线结果 | Medium | Observed (code) | S–M |
| SEARCH-CAP | Opportunity / 完整性提示 | 当前对话面板固定只请求第一页，且单文档命中数有上限，没有“还有更多”状态 | Low–Medium | Observed (code)；真实触发频率未知 | M，条件进入 |

### NAV-REPLAY：相同目标再次激活

资料库结果列表在 `apps/web/features/offline/library-shell.tsx:797–815` 先读取结果，
成功后调用父级 `openSearchResult`（`:425–430`），后者通过 `router.replace` 设置
精确目标 URL。Reader 的 URL 导航 effect 在
`apps/web/features/conversations/conversation-reader.tsx:1621–1647` 以目标字段组成
`navigationKey`；若该值等于 `targetNavigationKeyRef.current` 就直接返回
（`:1629–1633`）。该 ref 仅在 Reader 切换会话/消息时由 `:830` 重置。于是当 Reader
仍挂载、用户滚离目标后再次点同一个结果，源码没有新的显式导航意图可与原 URL 区分。
这是源码推断，不是已运行浏览器复现。

此前当前对话搜索修复只合并“仍在 pending 的同一命中”，不覆盖 Reader 已完成首次
导航后再激活相同 URL 目标。现有离线浏览器用例
`apps/web/e2e/library-offline.spec.ts:375–429` 分别验证正文、附件、批注目标一次，
没有在同一 Reader 实例中滚动离开后再次激活相同目标。建议用独立“激活意图”驱动
已有导航流程，避免用随机 URL 参数或扩大 Reader 重挂载范围来绕过问题。

**验收：** 同一离线正文精确命中在首次定位、用户滚离、再次点击后均重新定位并显示
正确完成状态；对附件和批注至少覆盖同目标重复激活；直接打开/刷新书签 URL 仍只
执行正常的一次初始定位，切换目标不重复执行旧导航。

### OFFLINE-FRESHNESS：批注变化后索引快照可能过期

`LibraryShell` 在 `apps/web/features/offline/library-shell.tsx:179–236` 读取
`searchDocuments`、批注和笔记，调用 `initializeOfflineSearch` 构建 worker 索引；
搜索 effect `:400–412` 仅由查询文本和本地 `searchIndexRevision` 驱动。
该 revision 在 `reloadLocal` 成功重建索引后递增（`:236`）。而离线批注仓储在
`apps/web/lib/annotation-repository.ts:73–106` 会立即创建、更新或软删除批注及其
搜索文档；`localEdit` 在 `:148–153` 只发出 outbox 事件。LibraryShell 当前源码未订阅
该批注写入事件并重建 worker，因此已打开页面中的 worker 可继续保留旧文本或已删除
批注的快照，直到其他路径触发 `reloadLocal`。

**建议：** 为已有离线搜索索引增加窄范围的失效/重建协调（可合并短时间连续更新），
或让既有写入者显式通知拥有索引的 LibraryShell。保留当前离线访问代际检查、重建失败
恢复与已下载资料，不另起数据库/索引架构。

**验收：** 在 LibraryShell 保持挂载时编辑并删除批注，不整页刷新、不手动重试，后续
搜索只反映最新本地内容；较早的异步重建不能覆盖较新的批注状态；失效/退出登录期间
不泄露或重新载入已锁定账户的数据。

### OFFLINE-DUPLICATE：一个批注可能显示成两个独立结果

重建时 `library-shell.tsx:179–236` 把持久 `documents` 与为全部非删除批注生成的
`privateDocuments` 拼接后传给 worker。离线仓储
`apps/web/lib/offline-db.ts:1063–1089` 又会为本地批注写入
`local-annotation:<id>` 文档；LibraryShell 投影的同一批注使用
`annotation:<id>`。worker 在 `apps/web/lib/offline-search.worker.ts:21–35` 仅按文档
自身 ID 建表，不按批注实体 ID 合并。因此同一批注同时存在两条搜索文档时，两者都会
保留为候选。两个条目的正文/标题投影不同，也会使重复项在排序或限量时挤占其他结果。

**建议：** 在索引投影边界为批注实体定义唯一权威记录/稳定身份；按批注 ID 合并持久
索引与私有本地状态，确保最新本地版本优先。不要通过删除离线包数据、改 Dexie schema
或丢弃旧包字段来去重。

**验收：** 同一个批注无论来自新包、旧包或本地编辑，只返回一条；编辑后内容、保存锚点
与删除状态一致；同名但不同 ID 的批注仍是不同结果。

### SEARCH-CAP：第一页与单文档命中上限缺少明确状态

当前对话面板在 `apps/web/features/search/conversation-search-panel.tsx:110–135`
固定请求 `limit: 50`，将返回项目展平成命中列表；界面只显示已展平数量
（`:202`），没有用响应里的 `total` 或 `offset` 呈现/获取下一页。后端 service
`apps/api/app/services/search/search_service.py:240–276` 已计算总项目数并返回分页字段，
而同文件 `:429–437` 对单文档最多生成 100 个匹配范围。故长对话中超出第一页或单文档
匹配上限的结果不会在此面板继续展示，也没有明确的截断提示。此项是完整性机会，不代表
当前 50/100 上限本身不合理。

**建议：** 若真实对话中确有超过首屏的高频查询，再为当前对话面板增加有界“加载更多”
或明确的“显示前 N 项”提示，并在无法完整枚举单文档命中时给出截断状态。不要仅提高
常数、一次性加载全部命中或声称响应数量就是全量总数。

**验收：** 合成数据超过 50 个匹配文档时可继续获取后续结果，稳定命中身份和当前选择
不因追加而错位；超过单文档范围上限时明确提示是否截断；小结果查询不增加额外请求。

## 建议的有界下一批

1. **先做 NAV-REPLAY**：加入同一 Reader 实例、同目标二次激活的回归，再修复显式激活
   与 URL 初始恢复之间的意图区分。
2. **接着合并 OFFLINE-FRESHNESS 与 OFFLINE-DUPLICATE**：统一批注实体投影，并让本地
   索引随批注变化安全刷新；只处理 LibraryShell 搜索结果，不扩展为全站缓存治理。
3. **SEARCH-CAP 暂缓**：先从真实使用/合成容量场景确认翻页价值，再单独做有界 UI/API
   接线；它不应阻塞前两项。

保留上一轮已完成的字面查询、Unicode 范围、canonical 锚点校验、离线 scope 过滤和
资料库目标类型处理。数据库候选分页性能仍需独立测量；本轮不提出新的 schema、
Dexie/offline package 版本、搜索引擎或生产数据改动。
