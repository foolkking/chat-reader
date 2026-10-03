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
