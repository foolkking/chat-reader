# 设置功能复查与界面精简 — 2026-10-03

本记录对应用户在 Context 迁移完成后、首次提交部署前要求的设置复查。
生产发布后的全站至少十五项改进属于下一批，本批不计入该数量。

## 已实施的界面变更

- 设置菜单只显示功能名，移除常驻同步成功提示、全局限制脚注和重复说明。
  待同步、存储错误、冲突与重试保留；收起的阅读设置不可被 Tab 意外进入。
- 帮助页保留真实功能限制、常见问题和手动诊断；版本、连接、离线完整性和
  授权期限放到底部小字，移除重复介绍与检查时间。读取失败仍显示未知，不伪装正常。
- 分享列表保留标题及状态，来源对话从“更多”打开；访问方式、内容范围和到期时间
  通过状态悬停、聚焦或触摸展开。Escape 或外部点按关闭。浮层优先朝上，避免挡住编辑。
- 账户角色放在身份标题旁；邮箱与用户名在足够宽时同排，小屏分行。
  密码/邮箱说明仅在实际编辑时出现，退出与未同步修改处理保留。
- Skill 管理移除重复标题、说明和浏览器默认“未选择文件”文本，保留文件选择、
  名称、替换确认/取消/错误、下载和个人首选；没有新增查看器。长名称允许换行。
- 导入格式使用 JSON、Markdown、JSON + Markdown 标签及简洁来源状态；版本统计和
  验证摘要放入详情。学习、修复、个人启停和系统发布/撤回不变。
- 噪声库、系统格式/规则/Skill、功能设置、备份、离线与审计移除重复介绍。
  具体匹配范围、权限限制、破坏性后果、未完成状态仍在相关操作展示。
- 普通导入和初次使用空态不再提供 `.cr`。设置“数据与备份 → 恢复归档”保留个人恢复，
  并提供旧单对话 `.cr` 恢复入口；该窗口明确名为“恢复对话归档”。
  错投 `.cr` 或 `.context.zip` 时提示正确入口，不发起导入。

## 功能与证据对应

既有 API 全量 867 通过/4 跳过和 PostgreSQL 验收见
[Context 执行记录](CONTEXT_MIGRATION_2026-10-03.md)。本批为前端交互与入口改动，
未新增 migration、后端权限或归档格式。下列专项验证实际状态与持久化；
最终运行结果填在下一节，不将未启用用例计为通过。

| 设置范围 | 核对的行为 | 浏览器专项 |
| --- | --- | --- |
| 外观/阅读偏好 | 跨账户隔离、持久化、字段冲突、真实锚点恢复 | settings-preferences、settings-reading-sync |
| 离线与同步 | 下载档位、失败保留副本、冲突、未同步清理、过期锁定 | settings-offline-*、settings-pending-*、settings-signout-cleanup |
| 本人分享 | 分页、编辑、批量逐项结果、撤销、范围和密码边界 | settings-shares、settings-presentation |
| 账户与安全 | 资料保存、邮箱验证/修改、设备退出、草稿保护 | settings-presentation、settings-email-change、settings-registration、settings-pending-signout |
| 本人/系统归档 | 预检、新增恢复、重复提交、异常重试、旧单对话恢复 | settings-personal-backup、settings-system-backup、settings-presentation |
| 导入格式 | 学习→发布→使用→撤回后保有、健康检查、修复 | settings-formats、settings-format-health |
| 噪声规则 | 默认保留、显式学习、个人例外、系统推广隔离 | settings-cleanup、settings-rule-learning、settings-rule-publication |
| 个人/系统 Skill | ZIP/Markdown 包装、替换、下载一致、个人选择保留 | context-skill-bundles、context-admin-bundles |
| 用户与访问/审计 | 审批、禁用、后台删除、内容访问、邀请与审计筛选 | settings-admin-users、settings-admin-invitations-audit、settings-registration |
| 帮助/运行状态 | 脱敏、真实指标、失败保留旧值、离线隔离、隐藏暂停刷新 | settings-help-runtime |
| Current/Index 与身份边界 | 草稿、登录过期、跨账户和退出清理 | settings-context-drafts、settings-offline-lock |

## 实际执行

- `settings-presentation-first`：18 通过，5 失败。
  其中三项为新测试未等待导航就绪；一项仍期待已删除的帮助介绍；
  一项发现分享浮层确实挡住编辑按钮。修复测试等待与真实断言，并调整浮层位置。
- `settings-presentation-final`：23 通过，0 跳过，约 1.3 分钟。
  三种宽度 375/768/1440、中英文及浅深色；真实用户资料保存、诊断未知值和账户隔离，
  系统 Bundle 替换/首选保留，分享失败重试和逐项撤销均通过。
  两种语言的 375px 用例通过设置完成实际单对话 `.cr` 导出、预览、worker 恢复，
  查询得到新增对话且两条消息均保留。
- 此后补充悬停浮层本身保持显示、非焦点位置按 Escape 的检查。
  `settings-full-reaudit`：123 通过、11 失败、0 跳过。失败保留在历史记录：
  旧测试依赖已移除文案、缺少认证 Origin、重复 Root 登录触发限流，及阅读恢复额外保存。
- `settings-reaudit-failures`：22 通过、6 失败、0 跳过。Bundle 与注册已修复；
  英文 System 定位误点主题选择，另外三项证实恢复旧位置会多创建一次 revision。
- `settings-reading-repair`：22 通过、1 失败、0 跳过。全部偏好与系统备份通过；
  恢复不再产生保存意图，但选择远端时需独立取消尚未结束的启动恢复，已补齐。
- `settings-reading-final`：9 项阅读同步全部通过；附带的 3 项 Context 导航因开关
  未启用跳过，不计通过。随后单独启用导航与长 Reader 门槛复验。
  保留严格 revision/幂等断言；没有放宽预期值或限流。服务端位置选择不再回写一次，
  本机滚动、冲突重入、丢失响应重试、存储失败与离线副本更新均验证实际持久化。
- 合成截图已查看 375px 账户/分享/审计、768px 深色账户/帮助、1440px 帮助
  与深色系统 Skill，以及 375px 系统 Skill。字段、操作和底部环境状态均未横向溢出。
- 最新 lint、typecheck、生产构建通过；唯一 PostgreSQL head/current 为 0046，
  三个默认 ZIP 字节一致性检查通过。旧 `reader-layout` 用例替换真实导入路径为合成
  内存文件，并更新 `.cr` 不在普通导入中的断言；该历史整页用例未计为本次通过。
- 长 Reader 专项第一次因临时配置缺少 Web 工作目录未能启动，零项执行；
  已设置明确 cwd 后重新启动。认证状态仅在测试进程内传递，未写入文档或文件。
- `reader-context-final`：14 通过、0 跳过。三宽度 Current/Index 历史恢复、查找和
  真实引用跳转通过；长 Reader 的直接 URL、虚拟块、目录、滚轮、批注、刷新恢复、
  字号/密度/宽度变化及 Share 均通过。没有复制或使用真实用户对话作为测试夹具。

本批本地验收完成。全设置首次运行的全部失败已有对应通过的复验，不将不同运行
简单累加，也不把首次失败改记为成功。Context/API/离线完整基线沿用上节已有结果。
接下来提交、push、检查 CI，通过后执行独立生产发布，再开始至少十五项全站改进。

临时截图与运行文件使用本次获准的 `.tmp/context-tests/settings-ui-20261003`；
默认 AGENTS 临时路径仍为 C: wkkk，未修改全局环境变量或再次尝试拒绝的清理。
尚未提交、push、CI 或部署；完成本批后依既有备份/发布流程执行。

## 首次 GitHub 发布检查

源码 `4240080d94bc593abe0bcf7cf20308af4fc082ec` 已提交并推送。
[Actions 37128686750](https://github.com/foolkking/chat-reader/actions/runs/37128686750)
API 全量 868 通过、3 跳过；共享 Runtime 64 通过、Context 专项 53 通过，
唯一迁移 head/current 为 0046。126 项设置测试全部通过。空实例恢复的独立测试仍引用旧菜单说明，
因此在点击入口时失败，未执行恢复；已修正为管理员分组中的实际 System 入口。
Web lint/typecheck/build 通过，但官方 npm 审计发现 `GHSA-vfj7-8cjw-p6xm`，
镜像构建未执行，没有产生可部署产物。

上游 braces 当前最新仍是 3.0.3，暂无修复版。本地锁定补丁在解析与 AST 遍历中
限制嵌套深度；4 项实际依赖回归通过，覆盖漏洞输入、直接 AST 与正常 glob 结果。
冻结安装与 Web 生产构建通过。审计仍报告 1 项 high；精确 FIXED 记录及
2026-11-02 复查期限遵循现有安全策略，CI 必须先运行补丁回归，不声称“零漏洞”。
详见发布安全合同。

第二轮源码 `90c8fda2592483c219deb647af26b73bdb56eed4`，
[Actions 37130648722](https://github.com/foolkking/chat-reader/actions/runs/37130648722)：
API 与设置门槛成功（126 通过），空实例恢复也通过（1 通过）；补丁回归及安全审计通过。Web 后续导入
恢复测试仍查找旧 Conversation Rescue 按钮，迁移后实际为格式转换 Skill。
修正为当前入口并补齐四条遗漏的英文翻译；用实际 ZIP 内容检查下载的是 Normalizer。
没有降低任何解析或恢复断言。

本地 `import-context-interop-final`：33 通过、3 失败、1 外部文件用例跳过。
导入映射/替换/Normalizer 下载、整包回传、三个历史快照、导出、真实离线和 Skill
替换均通过。三项草稿检查硬编码了匿名数据库，在认证 fixture 下读错库；更新测试
读取当前账户的独立命名空间，不修改应用存储或放宽账户隔离。
`context-drafts-auth-final`：3 通过、0 跳过，验证实际草稿字节、并发分支、恢复文件、
保存/取消清理与刷新。新翻译的生产构建通过，等待下一轮完整 CI。

第三轮源码 `a5a8136ed9cfb341e558f973d6d38bd16c560623`，
[Actions 37133732714](https://github.com/foolkking/chat-reader/actions/runs/37133732714)：
API、设置通过，Web 的 Context 门槛 27 通过、3 失败；镜像未构建。
草稿测试适配账户命名空间后遗漏了无认证 fixture：该环境不激活账户，仍使用旧库。
现根据是否存在 active user 明确选择旧库或该账户库，不扫描或认领其他账户数据。
本地 `context-drafts-legacy-final`、`context-drafts-account-final` 各 3 通过、0 跳过，
分别运行无认证 Web shell 和账户 Web shell，后端均为真实认证 PostgreSQL fixture。
覆盖相同的实际保存、两窗口冲突、刷新恢复、下载恢复内容及清理断言。
最初两次本地启动因缺少 Origin、误用未设置的凭据变量失败，未运行测试；未计通过。
生产未变更，等待修正测试后的完整 CI。

2026-10-04 发布网关复查发现 Context 整包回传及 16 MiB Skill Bundle 仍会经过
Next rewrite，存在 10 MiB 截断风险。已补齐窄范围 Nginx 直连路由，分别为 520/20 MiB，
不改变应用限额。实际隔离 Nginx 测试通过：五条 12 MiB 上传字节/认证头完整、
两条超限 413、四条无关路由保持原路径。仅启动独立 loopback 测试进程，未 reload
生产配置。第一次运行因服务器 Python 3.6 不支持 future annotations 未启动；
脚本改为兼容该版本后通过，同脚本纳入 CI。生产应用仍未发布。

第四轮 `4e96dc3` / [Actions 37135406992](https://github.com/foolkking/chat-reader/actions/runs/37135406992)：
API、上传网关、30 项 Context 通过。focused gate 为 42 通过、3 失败，三处中文
批注按钮旧定位已改为实际“全部批注”；不是放宽定位与正文保持断言。
设置为 125 通过、1 失败：清缓存时 durable download 已完成，但后台空闲扫描短暂
持锁，应用误报正在下载。改为无活动任务时有界等待锁交接，取得锁后仍复查账户、
任务与待同步指纹。新增真实浏览器锁屏障，验证不会误报且实际 Cache Storage 变空；
活动下载仍禁用清理。初次中文 Reader 复验为 1 通过、2 Chrome 加载/启动失败，
未计通过；恢复已停止的本地合成服务后改用已安装的 Playwright Chromium 复验。

`reader-clear-cache-lock-final`：6 通过、0 跳过。三项中文批注回归通过，三个宽度的
离线下载/恢复/档位/取消用例均通过；手动持有空闲下载锁时清理排队，释放后实际
Cache Storage 为空且正文副本保留。`release-browser-remainder-final`：27 通过、
0 跳过，覆盖 Share 焦点、源码冲突/撤销、附件上传原子性、噪声显式处理与 PDF/Markdown
查看器。lint、typecheck、Web build 均通过。等待下一轮完整 CI；尚未部署。
