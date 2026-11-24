# 项目导出实测 · 2026-11-23（Asia/Shanghai）

<a id="implemented"></a>
## 修复后：所选 → 请求 → ZIP（2026-11-24，北京时间）

**00:36–00:42 增量复核。** 上一轮实测的是另一端「移出项目」，不等于「删除对话」。补充用例先实际得到 `404`（1 failed）：剩余选择不可恢复。修复后以原选两条、另一端删除一条复测：不提供不可用的原清单、不返回该条标题，明确选择「仅导出仍在项目中的 1 条」才收件，解包只有仍可读的那条。针对不存在、已删除、其他账户三种 ID 的 API 测试要求同等行为；原始项目之外的通用 API 不放宽权限。先前操作也从头复跑：[Chromium 1440](after-deletion-desktop.json) · [Edge 375](after-deletion-narrow.json)。新增路径没有提交、发布或操作生产。

**范围。** 这是未提交开发树，Reader Git 基线 `4afb430cf6d5d03b67474cd8a8d9e5ec2021935c`，不是该提交自身、更不是生产。2026-11-24 00:01–00:04（北京时间），新普通合成账号、真实 Reader Web、Nginx、临时 PostgreSQL 和 640 MiB worker。没有读取现有用户、ChatGPT、GitHub 或生产数据。浏览器访问本机 webpack **开发服务**；另外在同源码隔离副本做了生产构建，不能把两者说成浏览器访问了生产包。

| 从界面做什么 | 实际检查 |
|---|---|
| 103 条活动对话，先勾两条再切换排序，其中一条不在当前 100 行内 | 两端均显示选 2、当前列表 1。额外勾、取消另一条后，请求与实际 ZIP 仍保留**最初两个不同的 ID 及顺序**。首屏不横滑就能看见、聚焦导出；按钮高 44 CSS px。计数文本桌面 220×36、窄屏 126×40 CSS px。 |
| 另一端移出已选对话 | 先 `409`、不排任务。网页提供保留原选或仅当前范围；真实点击后者只导出仍在项目中的 1 条。API 专项用实际下载验证了另一种选择；即使保留原选，也不能纳入别人的数据。 |
| 用键盘打开项目 `⋯ → 导出项目对话…`，确认前移出、加入各一条 | 102 → 102，身份变了仍先拒绝。界面显示“新增 1 条”和“不再属于此范围 1 条”及不同的合成标题。明确确认后，ZIP 的 102 个成员逐一匹配新清单和顺序。 |
| 服务端受理后丢弃本次响应，刷新原标签后点「核对上次导出」 | 找回原任务，所有浏览器 POST **总计 1 次**，ZIP 只含所选条目；没有按标题或时间找“最近任务”。 |
| 在两个项目分别建立同名、首句也相同的对话，在全部对话中勾选两条；另打开空项目 | 两行可见项目名、复选框可访问名称不同，实际 ZIP 两个 ID 和顺序吻合。空项目说明没有活动对话，不给创建空包的按钮。不是多项目结构迁移。 |

**回执与截图（均不含账号、ID、请求正文、凭据）：**

- 1440×900 Chromium 151：[运行结果](fixed-desktop-result.json) · [选择工具栏](fixed-desktop-selection.png) · [同数量成员变更](fixed-desktop-whole-changed.png)。
- 375×900 Edge 158 触屏模拟：[运行结果](fixed-narrow-result.json) · [选择工具栏](fixed-narrow-selection.png) · [同数量成员变更](fixed-narrow-whole-changed.png)。[修复前窄屏工具栏](recheck-narrow-selection.png)。非移动真机。
- [复现脚本](../../../scripts/extension-beta/project-export.cjs)：两次退出 0。用[实验夹具说明](../../../scripts/extension-beta/README.md#project-export)建立固定 loopback 实例，在仓库根设置允许的独立 `TEMP`/`TMP` 后，分别 `node scripts/extension-beta/project-export.cjs chromium` 和 `node scripts/extension-beta/project-export.cjs edge`。实际解压通过同源已认证请求取回的 worker 制品，**不声称每次都操作了系统下载对话框**。截图只裁切操作区域。

**代码级门槛。** `pytest` 的项目范围 5、原批量导出 17、独立的选择性追加 2：**24 passed in 81.00s**，不混算为 24 个项目导出场景。另在隔离 PostgreSQL 16 测了原批量并发、快照、取消、失权的 7 项。`pnpm run lint`、TypeScript、同源码 Web 生产构建通过。全部 API 原生收集 7,111 项，收集不等于全跑；Settings 原生收集 7 个原导出身份，未放宽时限或删断言。**未跑完整 Actions，未发布、未部署。**

**保留失败。** 首轮两个冷编译导航超时、后续桌面点击／排序定位失败；不能把失败当浏览器验收。改为等待实际 DOM、以“完成批量操作”所在区域定位项目排序（而非同名侧栏排序），保留时限。桌面实际截图还发现计数曾被按钮挤成一列，调整工具栏宽度分配后才通过几何门槛。跨项目夹具首次只给初始提问，服务端正确返回 422，已改夹具提供所要求的一问一答。API 回归中曾过度把实例条数限制前移到通用旧入口（1 failed / 20 passed），缩小改动到新项目入口，未修改旧断言。另有长中文／emoji 名称曾在 Linux 暂存文件上报 `ENAMETOOLONG`（详见审查）；现实际生成并可重开 ZIP。历史运行按时间与结果另存[脱敏清单](fixed-attempts.json)。

**来源核对。** 浏览器与构建副本的 13 个相关前端文件按 LF 规范化 SHA-256 和当前工作树相同。项目范围服务 `6901bb0e821258639b7037076d15bf57de126214fca8bab828bcec691b4a4fc3`、提交 hook `6691f01edc1d7f1f4a8f2ca70780a81a450d6881b30c42cf3cfbf9237c6620b3`、复现脚本 `48a01e79eda69ce2084d0c99e8dd9b8409a697a1d2f089be6d80c56043400c01`。下文为修复前的基线。

只用全新的合成普通用户、合成内容和隔离环境。未保存下载的 ZIP、用户信息、对话 ID、登录／下载凭证或来源会话。截图仅裁剪合成选择工具栏。结论和优先级见[审查报告](../../planning/ux-audit-project-batch-export-2026-11-23.md)。

| 证据 | 条件与实际结果 |
|---|---|
| [桌面收据](reader-desktop.json)、[列表刷新后截图](stale-selection-desktop.png) | 1440×900 中文，19:19–19:20。103 条活动中全选首批 100，加载更多后未再全选。100 个 ZIP 条目顺序与请求逐一匹配。在另一次两项选择中，外部移出一项后，工具栏显示 2，实际发 1，worker 也成功处理 1。 |
| [窄屏收据](reader-narrow.json)、[首次可见工具栏](selection-narrow.png) | 375×900 中文，19:29。加载更多后再次明确全选，103 个条目含两条同名对话；5 个附件元数据和 5 条消息关联，0 个二进制成员，无批注和笔记。移出一条后的同一计数矛盾再次复现。 |
| [Fork 实包和离线原型](extension.json) | 19:23。全新构建／浏览器配置；只提供合成来源页面，禁止外站网络。单对话／项目页导航及侧栏文件输入检查；不进行采集、上传或设备授权。另将未打包的本地索引单独喂 4 条合成记录，其结果单列，不当作插件能力。 |

## 重现（只在隔离环境）

1. 使用本项目隔离 Web、API、worker、PostgreSQL 和本机浏览器。新建普通合成账号和项目，放入 103 条活动对话、另设 1 条归档、1 条项目外和 1 条其他账号的对话。两条同名；五条有真实合成文件关联、批注和笔记。不要使用生产配置、真实用户或主浏览器配置。
2. 项目页「批量操作 → 全选已加载」；确认 100。加载更多，第一次保持原选择发起「导出」；另一组加载更多后再明确「全选」。在任务中心下载 ZIP，比较所发 ID 的数量与顺序、包内每个 CanJSON 的清单、消息及附件记录。两份 ZIP 分别做常规导入**预览**，再取一个成员单独预览，均不提交。两次均得到：整包 `201 → FAILED / ZIP_MARKDOWN_REQUIRED`；单个成员 `201 → READY`。
3. 同一项目新打开，任选 2 条均在前页的对话。另一客户端经正常项目接口移出其中一条（不删除对话），原页切换到标题排序以重新取数。对照工具栏、可见勾选、`POST /api/conversations/batch-export` 的 ID 数及成功任务实际条数：`2 / 1 / 1 / 1`。与此独立，包含异主 ID 的混合提交两次均为 `404`。
4. 两端工作树均为 `codex/reader-extension`，基线见报告。Web 构建源五个相关文件与工作树文本逐一比对，规范化 CRLF 后相同；API／worker 只读挂载本项目应用代码。本地 SQLite 专项在 `apps/api` 下运行 `python -m pytest -q -p no:cacheprovider tests/test_conversation_batch_export.py --basetemp <本次独立临时目录>`，`TEMP`／`TMP` 为批准的任务子目录，**退出 0，17 passed in 29.95s**。两次真实浏览器与 Fork 探针均退出 0——这是对**现状复现成功**，不表示产品缺陷已修复。未运行完整 CI、独立 PG 并发专项或生产测试。

<a id="second-pass"></a>
## 第二次复核：项目没变、项目变了但尚未刷新、回执丢失

2026-11-23 北京时间 **20:27:36–20:27:58**（1440×900）及 **20:29:26–20:29:45**（375×900）。两次均用新建合成账号、103 条对话、真实 Chromium 151.0.7922.34、同源 API、PostgreSQL 16、独立 worker。对比入队清单和实际 HTTP 下载的每个成员的身份与顺序；本次没有提交导入。只保留聚合、布尔值、文件哈希及裁切工具栏，不保存下载文件、真实标识或凭据。

| 复核证据 | 如何重现／用途 |
|---|---|
| [桌面收据](recheck-desktop.json)、[窄屏收据](recheck-narrow.json)、[只换排序后的窄屏工具栏](recheck-narrow-selection.png) | 标题升序勾两条 → 降序，一条落到已加载的 100 条之外 → 比对当前成员和实际 ZIP。第二组先移出一条，但不刷新原页。第三组提交已到服务端，只丢弃返回给网页的响应，分别原页重试、刷新后重选重试。每个重复任务均独立查询至完成。收据中的 `sha256` 标识当次字节，不作为跨运行恒定值。 |
| [自包含复核脚本](recheck.cjs) | 按[本机隔离内测说明](../../../scripts/extension-beta/README.md)准备实验服务，仅接受固定 loopback、`APP_ENV=test`、实验库名和全新合成账号。用仓库根目录作 cwd；把本进程的 `TEMP`、`TMP` 设为许可的独立子目录，`AUDIT_WIDTH` 分别设 `1440`、`375`，运行 `node docs/evidence/project-batch-export-2026-11-23/recheck.cjs`。两次均退出 0。该脚本是现状观测，不是修复后的绿灯断言。 |
| 单独运行现有后台专项（未改断言） | `apps/api` 下 `python -m pytest -q -p no:cacheprovider tests/test_conversation_batch_export.py --basetemp <独立子目录>`：**17 passed in 29.68s，退出 0**。再用全新、随机本机端口、tmpfs 的 PostgreSQL 16 实验实例，仅在本进程指向该实例并设 `SETTINGS_POSTGRES_INTEGRATION=1`，运行 `tests/test_conversation_batch_export_postgres.py`：**7 passed in 34.77s，退出 0，无跳过**。覆盖并发重复入队、跨对话一致快照、取消、停用账号、来源被删除及不发布半包。没有使用开发机常驻数据库、CI 或生产数据库；仅销毁本次带唯一标签的独立 PG 临时实例。 |

Reader 工作树基线 `4afb430cf6d5d03b67474cd8a8d9e5ec2021935c`。与已构建 Web 树的项目列表、选区 hook、排序菜单、选择栏、导出 hook 规范化换行后均相同。项目列表 Git blob `3986c37fbafbc1330acfab88bbcfc21191d1b193`；提交 hook `c630a83533dba2714875f492074eade36683b5d3`；后台写包 `d7fd52c5c3acc51324d7a5987715109adea297ac`。两次新复核均未连接 ChatGPT、GitHub 或 `king`，不证明官方账号／项目数据格式、移动真机或完整版本资格。

证据读回的第一次脚本运行遗漏了一处 UTF-8 指定，在 Windows 默认 GBK 下读取中文回执时报 `UnicodeDecodeError`（退出 1）。用显式 UTF-8 对同一份原回执重新做数量、来源标记、重试次数、脱敏与相对文件链接检查后退出 0，未重写回执或修改产品断言。

<a id="project-objects"></a>
## 按项目而不是按对话：同名、空项目、两种归档

2026-11-23 **21:07:46–21:08:11**、**21:16:14–21:16:42**（北京时间）。两组各使用新的普通合成账号、真实本机 PostgreSQL、worker、浏览器和同源下载，未连接外网、生产或个人账号。每个账号通过正常 API 建 A、B 和空项目，A/B 各有一条同名对话，A 有另一个已归档对话，另有未归类对话。先在全部对话页跨项目勾选，再在两个项目页各导出一份，逐项对比请求、已完成任务、真实下载成员及 HTTP 下载文件名。另检查空项目和归档项目批量工具。未执行删除、恢复或对现有对话追加。375px 是桌面 Edge 触屏模拟，不是手机真机。

| 独立运行 | 首次／重复收据 | 界面证据 |
|---|---|---|
| 1440×900 Chromium 151.0.7922.34 | [首次](objects-chromium-desktop.json) · [重复](objects-chromium-desktop-repeat.json) | [两条同名对话的真实选择行](same-title-chromium-desktop.png) |
| 375×900 Edge 158.0.4370.33 | [首次](objects-edge-narrow.json) · [重复](objects-edge-narrow-repeat.json) | [两条同名对话的真实选择行](same-title-edge-narrow.png) |

每次对比实际项目归属、勾选行、POST 字段及 ZIP：两个所选对话均在、未选不在；两个成员文件名互异，包中没有测试项目的名称／ID 或项目目录。两次按项目分开导出的字节不同，但下载响应建议文件名相同。对空项目观察到零行、导出禁用；归档 B 不等于归档 B 的成员。两个截图仅纵向拼接同次运行的两个原始裁切，没有重绘、替换文本或拍到地址栏。独立读回四份收据，仅时间和新账号对应的 ZIP 摘要不同，其余记录一致。

[仅限实验服务的复现脚本](project-objects.cjs)：仓库根目录、许可的独立进程级 `TEMP`/`TMP`、`AUDIT_BROWSER=chromium` 或 `edge`，运行 `node docs/evidence/project-batch-export-2026-11-23/project-objects.cjs`，四次均退出 0。只在固定 loopback、实验环境和实验库名完全匹配后创建合成账号；不输出身份、请求正文或原始 ZIP。[项目批量入口](../../../apps/web/features/projects/project-conversation-list.tsx#L394)、[跨项目选择行](../../../apps/web/features/conversations/conversation-list.tsx#L635)、[归档项目操作](../../../apps/web/features/projects/archived-project-list.tsx#L267)、[项目活动成员查询](../../../apps/api/app/services/projects/project_service.py#L493)、[制品命名与打包](../../../apps/api/app/services/exporting/conversation_batch.py#L68)分别解释这些现象。与本机已构建 Web 的 7 个相关文件经 CRLF 归一化逐一全等；首次 PowerShell 比较表达式错误，未用该输出作证明，改用独立变量和失败即退出的逐项比较后 7/7 相同。此为观察行为的检查，不是修复后的验收。

## 最终合理性复核 · 2026-11-24

**结论：现有实现适合作为「把所选对话数据下载到本机」和「把单个 Reader 项目的活动对话批量下载」功能；不适合作为项目迁移、整项目备份或 ChatGPT Project 采集功能。** 这条边界现在由两个不同入口、项目页的活动/归档说明、ZIP 内容说明及非备份提示共同表达，不需要为了“批量”把两种范围合成一个含糊按钮。

合理性依据是实际界面、请求清单、任务回执和解包成员逐一对应：所选身份不随排序/分页变化；单项目入口在确认前显示真实活动成员数，成员增删即使总数不变也要求重看；已失效或失权成员不能被原始确认悄悄带入；确认后任务固定有序 ID，不因后来加入成员而扩张；生成失败不发布半包，网络回执不明时可查询原任务。1440px Chromium、375px Edge 及隔离 PostgreSQL 的结果见本文件上文，且本轮专项测试保留所有原断言。

当前**仍不包含**项目目录/ID/排序关系、归档对话、附件原始字节、批注和笔记；单项目导出一次只覆盖一个项目，超过系统门槛需在项目列表明确分批。它不是逐字节冻结于用户点击时刻的数据库备份：任务打包时使用一致读取快照，下载过期重建会读取原选 ID 的当前可用内容。这些限制已由合同/页面说明，分别应使用个人可恢复归档、单对话 `.context.zip` 或离线阅读入口解决；不建议在此 ZIP 中暗加数据或另建多项目格式。

所以本轮没有再扩展「多项目迁移」或「ChatGPT 项目批量导入」：前者需要独立的可恢复格式合同，后者还缺少经授权且有已知项目、分支、附件真值的真实来源样本。当前结论只覆盖 Reader 项目批量导出，不推断线上部署、手机真机或完整 CI 已通过。

2026-11-24 最终复跑项目范围与批量打包 API 专项：`python -m pytest -q -p no:cacheprovider tests/test_project_export_scope.py tests/test_conversation_batch_export.py --basetemp <本任务独立临时目录>`，**23 passed in 42.01s，exit 0，无跳过**。该结果是当前工作树的 SQLite/服务专项；不替代隔离 PostgreSQL 并发 7 项、真实浏览器 ZIP 下载或完整 CI，后者分别按上文已有回执标记。
