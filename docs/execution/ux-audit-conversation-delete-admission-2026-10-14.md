# 永久删除请求恢复审查 — 2026-10-14

## 边界与证据

本报告先于本批产品编辑。用户要求直接继续本地修复，并明确后续自行验证：
不启动服务、不登录、不使用浏览器、不运行脚本、测试、lint、类型检查或构建，
不提交、推送、触发 CI 或部署。生产仍为 84988a2，数据库 0050。
证据仅为工作树源码；未观察真实网络断开、重复任务、渲染或用户操作。

任务：普通账户从主列表、项目列表或单项菜单提交永久删除，响应丢失后仍能确认
原请求，而不是把未确认结果当作失败后重新创建任务。删除不可在应用内撤销；
worker 的逐项提交、部分结果、停止后续项目和现有 task retry/cancel 保持不变。

## 修复前发现

| ID | 严重度／置信度 | 源码证据 | 用户风险与处理 |
| --- | --- | --- | --- |
| ERR-DELETE-01 | High／高，Observed(code) | `apps/web/lib/api.ts` 的 `queueConversationBatchDelete` 每次生成新 key；两个列表和 `ConversationActionMenu` 的删除回调只有 finally，没有 catch | 响应丢失后没有恢复入口；下一次操作不是原请求重试。保留一个不可变的 key 和有序目标快照，未知时先只读核对 |
| STATE-DELETE-02 | High／高，Observed(code) | `background_jobs.py` 在回执查询前验证源对话存在；回执仅匹配 active/committed，不比较 payload，也没有同键事务锁 | 原任务删除源之后重试会 404；failed/cancelled 同键会重新 admission；同键不同目标可能返回不相关任务，并发可能重复入队。先查所有状态的原回执、比较原顺序并沿用 merge 的 PostgreSQL advisory lock |
| STATE-DELETE-03 | Medium／高，Observed(code)；影响 Inferred | 三个调用方等待确认之后才设置 busy，异步完成时直接清选择或导航 | 快速二次点击、确认期间切换范围或账户的旧回调缺少共同围栏。请求 owner 在确认前同步锁定，确认前后检查当前账户与路由，旧调用方不接收迟到成功 |

排序：先完成同一请求端到端恢复；不合并其他 archive/move/selection 审查。
没有证据宣称生产已经出现重复删除，也不宣称现有所有 4xx 均未发生写入。

## 修复前源码 SHA256

| 文件 | SHA256 |
| --- | --- |
| `apps/api/app/services/background_jobs.py` | C4A568AA4FC0D6B562D6F604F83E67AF4E8168457BE986CCA077B3DB1FBBEE38 |
| `apps/api/app/api/routes/conversations.py` | 5087243F49B7946A84D9C74DB9811AC7B5EB1992016FEFADF32722273F21C212 |
| `apps/api/app/schemas/task.py` | CAD472A799A7019D2BA99EA2ED54C3DF854B5F11ED7C702E6BB34572A47D52F5 |
| `apps/web/lib/api.ts` | B60E861796434787866C8944E294A51CF1EDB2D99531319961184049BD848AE7 |
| `apps/web/app/layout.tsx` | 0B4AECFE3C68DA874277449A55723022CC7C8347615C958A132904D5276DBC03 |
| `apps/web/features/conversations/conversation-list.tsx` | D5E1C5586A8831BEF6176B6F8EAA418C585E0E79695E1B348CD8A4539A75BF24 |
| `apps/web/features/projects/project-conversation-list.tsx` | 11C55417D1BCCAD449F796FD0C0B0677FBD35A0544B9D5FA8A339F4C5FAC1A2E |
| `apps/web/features/conversations/conversation-action-menu.tsx` | 75ECBA84EBE77B32DC3757B9F0ABCF01AB4AB1A1C47BA22934C5CD29BF1B1683 |

## 状态与界面合同（实施计划）

| 状态／入口 | 可见行为与动作 | 持久化／恢复边界 |
| --- | --- | --- |
| idle → confirming | 使用现有危险操作确认；按当前可见顺序冻结目标；确认前同步锁定 | 取消或账户／路由改变不 POST |
| submitting | 等待有界 admission；不得并行开始另一删除请求 | 中止浏览器等待不等于取消已受理任务 |
| confirmed | 原任务登记任务缓存；正常成功沿用列表/菜单反馈，不增加例行全局提示 | 缓存刷新不是 admission 结果；旧路由调用方不清选择或跳转 |
| unknown / checking | 固定浮层提示“结果未确认”；只读核对按钮、任务中心入口；核对失败仍 unknown | 同一个原 key/目标保留在当前 provider 内存；关闭行菜单或应用内导航不丢失；完整刷新/owner 卸载不保证保留 |
| missing | 仅明确 `{found:false, task:null}` 解锁“原请求重试”；重试再次危险确认 | 显式重试用相同 key/有序目标；不会静默 POST，也不会用新选择替换目标 |
| found terminal | 告知任务已找到，跳转现有任务中心查看部分结果/失败/取消 | 返回同一任务；不自动重开 failed/cancelled |
| conflict / known rejection | 稳定中英文说明；明确 `DELETE_REQUEST_CONFLICT` 表示本次目标未受理，要求先查看已有任务，不把不相关任务宣称为本次成功 | 明确输入/资源拒绝可结束本次请求；未分类的 409 等异常仍 unknown，不显示底层文本 |
| owner retired | 不展示旧账户私有目标、不向新账户任务缓存发布结果 | 原服务器任务不被自动取消 |

UI checkpoint：Intent 为异常恢复而非阅读状态提醒；Palette 沿用 paper/graphite/
sea-green 与现有 danger；Depth 为已有 border + raised 浮层；Surfaces 不改变
Reader/header 高度；Typography 为已有 text-sm 与 semibold 标题；Spacing 为
12–16px、44px 点击目标、可换行按钮及 safe-area 底部留白。只在异常或明确恢复后
出现，不自动聚焦、不自动滚动、不加动画或新主题。恢复提示可收起但仍保留原请求，
再次删除会打开其恢复入口，不绕过核对。

使用 ux-audit 的源码证据分级，product-design-and-ux 的状态/界面合同，以及
interface-design、senior-designer 的现有系统约束。视觉、触屏、键盘和评分均未验收。
不增加依赖、轮询、worker 并发、数据库迁移或用户导入处理。唯一新增网络路径为
用户主动触发的回执 GET；原请求设置现有 20 秒 deadline。

## 实施及验证状态

源码实现已完成，尚未运行或验证：

- `background_jobs.py` 增加 owner/key 只读查询；在可变源校验前 replay 最早保留任务，
  比较首次出现去重后的 ID 顺序；沿用 merge 的 PostgreSQL 事务 advisory lock，
  限制非空 key 为最多 200 字符。旧无 key 调用仍可用，worker 删除执行没有改动。
- schema/routes 增加静态 `GET /api/conversations/batch-delete/requests/{request_key}`，
  放在动态详情路由之前。复用正常 task presenter 和服务端 ownership，不暴露 payload/key。
- Web API 允许显式原 key/AbortSignal，并复用既有 20 秒 deadline；增加回执 GET。
  新 `ConversationDeletionProvider` 嵌入既有 root provider，三个调用方接入。
  一次只保留一个 bounded request；仅异常/显式恢复时显示浮层，收起不会绕过核对，
  完整刷新/owner 卸载不保证恢复。没有新增持久化。
- 确认前同步锁定，固定原目标；当前账户/generation/路由 visit 与调用方挂载状态
  隔离旧回调，包括离开又返回同一 pathname。明确受理独立于任务缓存刷新；不抢焦点，
  不自动滚动。非 workspace 页面提供返回列表链接，避免无监听者的任务中心按钮。
- 新增 API 回归文件（15 个参数展开用例）、PostgreSQL 并发文件（2 个用例）及
  手机/桌面浏览器文件（8 个用例）。这些数字是手工按文件参数计算，不是测试发现
  或执行报告；全部未执行。覆盖 all-status replay、变化目标/顺序冲突、原去重语义、
  worker 完成后 replay、部分取消、保留窗口只读、owner 隔离、key 上限，以及
  响应丢失后的原请求重试、失败检查、取消/失败不重开、菜单关闭和页面切换恢复。

新增 UI 回归使用合成源与模拟 admission/回执，不能代替真实 API/worker 网络验收。
账户变化、迟到确认、真实 deadline、按钮 focus/touch、geometry 和设备 CPU/RSS
仍需用户后续检查；没有视觉评分或生产验收。没有运行服务、登录、浏览器、测试发现、
测试、lint、类型检查、构建、CI 或部署，没有提交或推送。保留无关工作树及 buildinfo。
