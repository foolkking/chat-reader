# 检索完整性与离线入口 — 2026-10-27

## 授权与边界

用户要求继续根据[最新方向审查](ux-audit-search-recall-2026-10-27.md)优化。
在 `ac9ed3a` 及上一轮未提交搜索源码之上实施五项有界跟进，不扩展搜索架构。
禁止本地测试、lint、typecheck、构建、浏览器、服务及 migration 命令的约束继续
生效；未做 web search，也未触发 CI、提交或部署。当前生产／回退状态以
`PROJECT_STATE.md` 为准；本记录不是发布或测试通过回执。

## 已实施源码

| 审查项 | 实施 | 保留边界 |
| --- | --- | --- |
| TYPE-01 | `OfflineSearchDocument.message_version_id` 声明为可选 nullable；本机批注索引也保留其版本 | 上轮类型遗漏收尾，不单独计新功能；没有包／Dexie 升级或 `any` 绕过，真实 typecheck 待授权 CI |
| DATA-02 | 在线 `conversation_id` 查询按文档身份保留相同正文的不同消息 | 全局／仅项目仍按 hash 折叠，`occurrence_count` 仍计会话；同消息多个 matches 不合并成一个 |
| DATA-01 | scope 从 data source 经 bridge 进入实际 worker，先按 conversation/type/role 筛选再限量；合并后去重／限量 | 不提高旧全库候选倍数，不创建逐对话全文索引；不改 SQL 分页 |
| DATA-03 | 当前对话查询内容域，全局保留标题；内部 type 不再是全文字段；附件自己的名称保留在文件内容域 | 不通过删除所有空 matches 消息来假修召回；旧包缺块仍可消息级打开 |
| NAV-01 | 共享 canonical 投影与 `/library` 目标链接；正文范围、文件身份、批注保存锚点各用原有导航 | 不跳到在线会话路由，不自动预览／下载；description/notebook 保持原行为，读取失败保留本机副本与重试 |

资料库激活在异步读取前登记选择，阻止同一条目的重复点击；较新的选择替代旧选择。
query、结果集、路由和组件卸载退休旧选择，迟到成功／失败不能再次导航或发布反馈。
列表只展示与当前输入相符的已提交查询结果；旧查询结果不以新查询的名义激活。
共享投影仅接受属于索引会话的 message，并在返回前校验已捕获的离线访问代际。

## 实际依赖源码决定的筛选策略

只读核对本机已安装 FlexSearch 0.8.212 的 `src/document/search.js`、
`src/document/add.js`、`src/intersect.js` 及类型声明：多个 tag 列表通过
`intersect_union` 合并，是并集，不可当作 conversation/type/role 的逻辑与。
因此为每个文档生成最多七种固定维度组合，查询只选择一个复合范围 tag。
字段结果与这个 tag 相交后才应用上限；回传再去重／截断。

这不是对整个内部查询工作量、峰值内存或实际性能的测量；既有 tokenization、
词法召回和排序不保证与在线完全一致。没有新的索引服务或持久化格式。

## 兼容与回归

离线当前对话和资料库使用同一投影：保留索引版本，缺字段才回退本机当前版本；
正文只从真实 blocks 计算 Unicode code-point 范围；heading/code 限定所属块。
annotation/comment、attachment/extract 不产生伪正文范围，失效范围仍由 Reader
安全降级。缺文件身份的旧响应进入已有文件列表，缺记录的提示沿用原面板。
离线包 v1/v2/v3、Dexie v2、Share URL、`.cr`、阅读位置语义及用户导入资料未改。

回归分层与显式适配器见
[Testing](../testing.md#scoped-search-and-offline-entries--2026-10-27-source-only)：
API 同会话重复消息／全局折叠；真实 FlexSearch 筛选；bridge 传参；共享原文范围；
受控资料库异步选择；375/1440px 断网正文／文件／批注入口。用例全部未运行，
不把 transpileModule 适配器当作类型检查、真实 DOM 或旧包迁移验收。

## 验证与剩余门禁

源码与测试仅做只读审查；`git diff --check` 无空白错误，新增文件的
`git diff --no-index --check` 也无空白诊断（该模式的差异退出码 1 不是测试失败）。
Git 的 LF→CRLF 提示不属于测试回执。未运行任何本地测试、lint、typecheck、
构建、浏览器、服务或 migration 命令；未触发 CI。
senior-designer 约束沿用既有布局、字体和语义 tokens，没有视觉改版；
没有实际渲染／对比度输出，不登记清单分数或视觉验收。

本批与上一轮搜索源码均需未来获授权的真实 Web 类型／构建、API、UX 与 PWA CI。
没有提交或部署；原有 `apps/web/tsconfig.tsbuildinfo` 不属于本任务，未改动。
数据库分组／分页性能方向继续待隔离测量；不进入本批，也不启动噪声算法新一轮修改。
