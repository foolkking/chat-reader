# 离线下载与恢复操作审计 — 2026-10-06

## 范围与证据

本轮面向普通读者与熟练用户，检查 Web 离线资料库、设置中的离线与同步中心，以及共享下载协调器。基线为 `975c1ee`（应用源码 `b45f049`）。证据来自当前代码与现有浏览器测试；本报告在修复前写入。未对生产账户制造断网、损坏或清理操作；尚未取得本轮实际渲染和浏览器复现证据。代码行为为 Observed (code)，实际出现频率与视觉效果不作确定结论。

## 结论

优先修复取消和失败恢复，而非改变页面风格。下载协调器在断网时停止工作，但取消需要该协调器才能结束，形成相互等待。资料库只捕获提交失败，没有呈现已提交任务后续的失败，用户可能看到进度消失却没有新副本。损坏包的重试没有请求重新生成，与已有错误说明不一致。分页也没有处理最后一页条目减少，可能使剩余内容暂时不可见。既有单写入锁、保留旧副本和账户隔离机制需要继续保留。

## 优先问题

| ID | 维度 | 严重程度 | 证据强度 | 工作量 |
|---|---|---|---|---|
| ERR-01 | 取消与离线恢复 | High | Observed (code) | M |
| FBK-01 | 任务失败反馈 | High | Observed (code); rendering Inferred | M |
| ERR-02 | 损坏包重试 | High | Observed (code) | S |
| NAV-01 | 分页与内容可达性 | Medium | Observed (code); rendering Inferred | S |
| STATE-01 | 异步资源检查顺序 | Medium | Observed (code) | S |

### ERR-01 — 断网取消依赖已停止的下载循环

位置：`apps/web/components/offline-download-manager.tsx:17`、`apps/web/lib/offline-downloads.ts:58`、`apps/web/lib/offline-db.ts:771`。

`run` 在 `!navigator.onLine` 时退出；取消只保存 `cancelRequested` 并中止当前控制器，终态由 `runDownload` 写入。网络中断又使其通过 `parentSignal.aborted` 提前返回。用户在断网后取消，记录仍可能处于 active 状态，界面显示“正在取消”，删除和清理继续被禁用。修复应允许离线处理本地取消，等待写入锁释放并以实际包提交结果决定完成或取消。服务端取消应保留待重连处理的意图，不能阻塞本地取消或把网络失败当确认。

### FBK-01 — 资料库丢失已提交下载的失败反馈

位置：`apps/web/features/offline/library-shell.tsx:232–253,389,480–481`。

订阅只使用 active 与 completed；`startDownload` 的 catch 仅捕获 enqueue 错误。后台生成、下载、空间不足和写入失败不会进入这里。用户不打开设置就不知道为什么进度消失。应从持久化记录显示具体失败及重试，并在尚未下载对话的主内容区呈现同一结果，小屏不必先发现隐藏侧栏。不得增加主动弹窗或伪造成功。

### ERR-02 — 损坏包重试继续使用损坏结果

位置：`apps/web/lib/offline-downloads.ts:65–71`、`apps/web/features/offline/library-shell.tsx:646–650`。

重建条件只有 cancelled、GONE、GENERATION，缺少 MALFORMED。现有文案建议重新生成，但重试复用同一 package。应对结构损坏重新生成；网络和本地空间/写入失败仍复用已有任务及包，避免重复等待。

### NAV-01 — 删除最后一页条目后页码越界

位置：`apps/web/components/offline-sync-center.tsx:109,177`。

`pages` 从实时计数计算，`page` 只在切换标签或翻页时改变；当 21 项删除至 20 项，第二页的 Previous 一并消失，剩余条目不可见，须切标签才能恢复。应在数据完成读取后收敛到最后一个有效页，适用于副本、同步与失败列表，保留键盘恢复位置。

### STATE-01 — 旧资源检查可能覆盖新列表

位置：`apps/web/components/offline-sync-center.tsx:75–78`。

同一个 liveQuery subscription 的每次结果都启动独立的 `Promise.all`，仅检查 effect 是否活跃。较慢的旧检查仍可覆盖较新的列表，短暂重新展示已经删除或旧版本的副本。应以每批读取序号丢弃过时结果；这不改变 Dexie 数据或附件缓存。

## 实施与验收顺序

1. 修复共享下载的离线取消、服务端取消恢复及损坏包重建，保留提交与身份边界。
2. 接通资料库的持久化失败与重试，保持现有组件和中英文文案。
3. 收敛分页，隔离过时资源检查。
4. 用合成账户和真实 IndexedDB/Cache Storage 验证断网取消、跨页删除、实际失败/重试、刷新恢复以及旧副本保留；跑已有离线负面和认证专项。

短平快改进为 ERR-02、NAV-01；它们与高优先级下载恢复一起交付，避免仅修文案。

## 保留与未验收

保留现有样式、无主动提醒原则、三档附件、v1/v2/v3 离线包、Dexie version 2、单 worker、账户锁定及待同步修改保护。既有 375/768/1440 浏览器用例覆盖刷新关联、附件档位和在线取消，但不能证明离线取消与本轮新增场景通过。此报告不声称完成全站 UI 审计，也不把源码阅读计为浏览器验收。新增测试、CI、截图与上线结果须另行补录。

## 2026-10-07 工作区实施

已补充离线取消、本机与服务端取消分离、回执丢失后沿用原幂等键、最多五次退避及手动重试。新下载不会覆盖旧取消意图；本机数据写入锁与服务端等待分离。重试读取当前 attempt revision 并在事务内再次检查。资料库从持久记录显示失败，首次下载的主内容区提供恢复；离线时显示暂停。损坏包重新生成，写入/空间与网络失败仍复用结果。分页越界与资源检查返回顺序已修复。

新建 `settings-offline-recovery.spec.ts`，计划五个真实浏览器用例：375/768/1440 的损坏包→刷新→重建→断网取消→重连确认，提交回执丢失的同键重放，以及 21 个真实副本删除最后一页后仍能访问剩余 20 个。断网测试比较实际 IndexedDB message rows；新建任务标识与重复提交 key 均检查服务端真实响应。截图仅使用合成账户/正文。

早期本地 typecheck 发现并修复 optional AbortSignal 与 React Query mutation 第二参数的类型冲突、测试中未收窄的 release callback。随后 typecheck 和改动文件 ESLint 通过。一轮普通 Web build 已完成路由输出，无镜像构建；构建期间/之后仍有后续修正，因此最终源码还需重新构建。浏览器用例、完整 PWA、离线负面与认证专项尚未执行，不能计为通过。

测试前检查只读取了约定临时目录的可用空间（约 86 MiB）和本地开发数据库账户是否能建立独立测试库（否）。未改动数据库，未输出凭据。新一批 E 盘临时目录许可尚待回复。用户要求以后集中改进与验证，不再每发现一处问题就提交、CI、部署；本轮没有提交、CI 或服务器变更，部署等明确指令。

用户随后清理 C 并要求继续使用 C。复查约 1.65 GiB 可用，已在约定任务子目录建立全新 PostgreSQL 17.10 集群（仅 loopback 65438）、API 8008 和单 worker，未复用开发数据库。全量 migration 到 `20261006_0048` 成功。最终源码普通 Web build 完成完整路由表，`test_offline_download_postgres.py` 为 **1 passed**。五个新浏览器用例已开始运行；暂不记录为通过。没有镜像构建或 CI。

### 首轮真实结果与后续修正

[初次浏览器 gate](ux-audit-offline-recovery-2026-10-06-evidence/initial/browser-gate.json)：**0 passed / 5 failed / 0 skipped**。

- 375px、768px 的损坏包→刷新→新任务重建、真实消息保存、断网取消及旧 message rows 保留均通过了中间断言，但最终在重连取消确认上失败；整个用例仍为失败。
- 回执丢失用例完成第二次实际请求，本机已取消，最终同样无法清除服务端取消意图；同键与同 job 的最终断言尚未走到，不能据此声称该用例通过。
- 三处取消失败的 API 日志与源码表明：已经 committed 的任务取消返回 409。后续代码只有再次 GET 确认任务处于 committed/failed/cancelled 才结束该请求；通用 409、仍活动任务或查询失败均不能假定成功。
- 1440px 在生成阶段收到 GENERATION，worker 记录 OSError；分页用例创建数据收到 500。此时 C 再次为 0 可用空间。未获取第五项的确切异常，不能把它算作产品缺陷已修复或测试通过。

已查看 [375px 首次下载失败](ux-audit-offline-recovery-2026-10-06-evidence/initial/offline-recovery-failure-375.png) 与 [768px 离线取消](ux-audit-offline-recovery-2026-10-06-evidence/initial/offline-recovery-cancel-768.png)：主操作可见，没有横向溢出。前者仍在没有任何副本时提到“现有副本已保留”，且重复显示首次说明；后续已缩短该状态文案并按实际已有副本决定是否显示保留提示。这是后续修改，旧截图不证明最终视觉效果。

仅统计本任务临时目录约 **62 MiB**（独立 PostgreSQL 约 61 MiB）；未扫描其他目录，不能断言剩余空间被何者消耗。已停止自己启动的 PostgreSQL、API、worker 和测试 Web；四个测试端口均无监听，未删除任何本机残留。用户选择继续使用 C，无新 E 盘许可。

上面的 Web build 是首轮测试版本；409 与文案修正之后需要重新构建、重跑新增五项及既有离线/认证/负面专项。后续不触发 CI、提交或部署，等待用户明确发布指令。当前阶段尚未验收完成。

最新 409/文案修正后的非增量 TypeScript 与七个改动文件 ESLint 均通过，`git diff --check` 无错误。现有开发 PostgreSQL 仍为原 PID 的 5432 服务；只停止了本任务的独立实例。HEAD 保持 `975c1ee`，所有本轮变化尚未提交；原有 tsbuildinfo 改动保持不暂存。下一步在 C 恢复可用后重新启动本任务已确认归属的独立集群（不要重新 initdb），重建 Web 并复测。勿重放上一阶段部署/备份/清理。

### 续跑观察：额外两处可直接改善的入口问题

重新检查可用空间后恢复独立集群，新构建成功。恢复测试达到 4 passed / 1 failed；余下一项是脚本在移动侧栏挂载前点到其后方的空状态按钮，补上挂载等待后，真实 21→20 个副本的分页删除场景单独通过。详情保留于 `evidence/rerun/`；尚未完成关联负面/认证专项。

| ID | 维度 / 程度 / 工作量 | 证据与后果 | 修复建议 |
|---|---|---|---|
| NAV-02 | 导航 / Medium / S | Observed (code + rendered control), desktop effect Inferred。`library-shell.tsx` 空状态的“打开资料库”只改变 mobileOpen；桌面折叠侧栏依赖 desktopSidebarExpanded。1440px 截图还显示侧栏已经打开时此按钮仍存在。桌面用户点它无法展开已折叠的资料库。 | 同一入口展开桌面侧栏或移动抽屉；桌面已展开时隐藏冗余入口。用实际桌面收起→点击→重新可搜索验证。 |
| FBK-02 | 反馈 / Medium / S | Observed (rendered)。`rerun/offline-recovery-failure-1440.png` 同时在侧栏和主区重复显示同一损坏提示与重试按钮。 | 当前未下载对话的主区承担该条失败反馈；侧栏保留其他范围或其他操作的错误。移动抽屉打开时仍需能查看其状态。 |

这两项在本段记录之后实施，并纳入已有 768/1440 恢复用例；不扩大到全站风格改造。另补充“无法读取服务器终态时保持取消请求”和“断网取消后确实能删除指定本地副本”的真实边界，避免只验证按钮可见。

### 最终恢复用例及关联回归（2026-10-07）

C 盘恢复空间后，继续使用原任务目录，没有扫描／清理其他目录，没有使用 E 盘临时例外。
桌面“打开资料库”现已实际展开侧栏并聚焦搜索；已展开时隐藏该按钮。同一首次下载错误只在主区显示，侧栏只有在重复同一错误时隐藏，其他错误和移动抽屉保留反馈。

- 全量 Web lint、非增量 TypeScript、普通 Web build 通过；修改旧测试定位器后，相关测试 ESLint 和非增量 TypeScript 再次通过。
- [最终恢复 gate](ux-audit-offline-recovery-2026-10-06-evidence/final/browser-gate.json)：**5 passed / 0 failed / 0 skipped**。375/768/1440 实际损坏→刷新→新任务重建→离线取消通过。375px 实际清除本地消息后，服务器对话仍在；1440px 故障注入终态查询 503 后，取消意图保留，解除故障后由真实响应清除。回执重放保持相同 key 和 job；21→20 副本分页恢复通过。
- 已查看最终 375px 首次失败、1440px 首次失败以及 375px 分页恢复截图；没有横向溢出、重复首次错误或桌面无效入口。768px/1440px 还检查了实际搜索焦点。
- [关联初次 gate](ux-audit-offline-recovery-2026-10-06-evidence/final/related-initial-gate.json)：**18 passed / 20 failed**。18 项认证用例均通过；其中修改密码场景改变了测试管理员密码，后续 20 项仍以旧密码登录而失败。一次改用新密码的立即重跑又触发了登录限流：[限流 gate](ux-audit-offline-recovery-2026-10-06-evidence/final/settings-throttled-gate.json)，**0 passed / 20 failed**。这是本轮测试编排错误，不改变产品认证规则，不计作通过。
- 通过 PostgreSQL `data_directory` 和测试用户名确认独立集群后，只重置该合成管理员的 login rate key 与 principal throttle，保留密码测试结果和其他数据。使用旋转后的测试密码，[关联重跑](ux-audit-offline-recovery-2026-10-06-evidence/final/settings-rerun-gate.json) **19 passed / 1 failed**。余下一项是旧中文取消定位器同时命中任务状态和新增说明；改为精确匹配合成任务的取消状态，没有删除断言。
- [中心最终 gate](ux-audit-offline-recovery-2026-10-06-evidence/final/center-final-gate.json)：三个宽度 **3 passed**。结合未修改且已通过的其他 17 项，关联离线／同步／锁定／阅读进度场景 20 项均有通过证据；不把重复跑过的中心用例累加为更多独立测试。

已有真实 PostgreSQL 下载入队测试 **1 passed**。独立集群内新建空的 `offline_pwa` 数据库并完整迁移至 `20261006_0048`，用于默认无认证 PWA fixture；认证数据库仍保留。基线和负面矩阵待完成后补录。全程没有修改生产环境、构建镜像、提交、推送或触发 CI。

### 最终检查追加 ERR-03（修复前记录）

Observed (code)，Medium，S：新失败列表允许显示“副本已完成，但先前服务端取消失败”的记录；该分支仍无条件展示“重试下载”，而 `retryOfflineDownload` 对 completed 直接返回。这样会新增一个无实际作用的按钮。应只对 failed/cancelled 显示下载重试，完成记录保留真正需要的“重试取消服务器任务”。追加真实场景：取消旧尝试→成功重下→旧取消五次失败→仅重试服务器取消→真实终态清除意图，检查未额外创建下载任务且副本不变。

### 本批验收结果（尚未提交／发布）

ERR-03 已修复。最新[恢复 gate](ux-audit-offline-recovery-2026-10-06-evidence/final/recovery-complete-gate.json) 为 **6 passed / 0 failed / 0 skipped**。新增用例保留真实退避时间，验证自动尝试恰好五次后停止；下载成功的副本仍可用；用户手动重试由真实服务端终态确认；只创建原始与重下两个任务，没有第三次下载。已查看[完成副本的取消恢复截图](ux-audit-offline-recovery-2026-10-06-evidence/final/offline-completed-cancellation-recovery.png)。

| 检查 | 真实结果与范围 |
|---|---|
| `corepack pnpm run lint` | 全量通过；最后 UI 条件和新增用例再运行改动文件 ESLint 通过 |
| `corepack pnpm --filter web exec tsc --noEmit --incremental false` | 通过；避免改动既有 tsbuildinfo，最终构建也完成类型检查 |
| `corepack pnpm --filter web build` | 普通及独立负面构建均通过，最新普通构建未包含测试故障桥 |
| 新恢复场景 | 6 passed，见最新恢复 gate |
| 认证／恢复 | 18 passed，失败的混合 gate 中前 18 项全过；后续 settings 因测试密码被修改而失败，未混算 |
| 离线中心／同步／锁定／阅读位置 | 17 项通过，中心三宽度最终 3 passed，共 20 个独立用例有通过证据 |
| [默认 PWA](ux-audit-offline-recovery-2026-10-06-evidence/final/default-pwa-gate.json) | 135 passed / 329 条件跳过；先构建再直接运行同一 Playwright gate，未重复执行包含构建的 `test:pwa` 包装命令 |
| [负面 PWA](ux-audit-offline-recovery-2026-10-06-evidence/final/pwa-negative-gate.json) | 17 passed / 0 skipped；真实缓存、IndexedDB、配额覆盖、损坏包、重启及 v1/v2/v3 兼容 |
| PostgreSQL 下载入队 | 前序本批 `test_offline_download_postgres.py` 1 passed；入队幂等与串行化 |
| Migration | `python -m alembic heads` 和 `scripts/verify_migration_state.py --require-current` 均为唯一 `20261006_0048` |
| 差异检查 | `git diff --check` 通过 |

默认 PWA 基线仅早于最后的 completed 行按钮条件；下载、缓存和同步代码无后续变化。负面矩阵及六个恢复场景覆盖最终代码；没有为了重复全量计数而重跑无关用例。全量 API、全站 UX、生产浏览器、独立外部 Skill 使用本批未跑，不能计为新通过。本批没有改动 API 实现、migration、Skill ZIP 或 Current/Index 行为。

已停止本任务独立 PostgreSQL、API、worker；不清理用户本地残留。普通构建留在工作区；测试故障桥构建保留在独立 `.next-pwa-negative`，不是交付镜像。未构建 Docker 镜像、未提交、未推送、未触发 CI、未部署。整体优化目标继续；下一批从新的实际用户问题出发，不重放已完成的生产部署或备份清理。
