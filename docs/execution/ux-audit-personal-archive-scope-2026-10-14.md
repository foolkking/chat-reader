# 个人归档回调边界与上传限制状态审查 — 2026-10-14

## 范围与证据

面向普通阅读者的 Web「数据归档」：个人备份、上传预检、确认新增恢复、
取消／重试、移除临时上传文件和切换操作。先审查并交付本记录，再编辑产品。
证据来自 `84988a2` 之后的本地工作树、已部署的归档合同，以及实际组件编译后
接入已安装 QueryClient／QueryObserver 的受控回归。Hook 调度、网络、确认框、
账户代次和 DOM／动画帧是测试替身，不等同于浏览器时序或真实账户切换验收。

不登录、不启动此前被策略拒绝的本地 Web，不提交、CI 或部署。Root 系统归档、
归档格式、恢复事务、API 权限、数据库、生产文件和数据不在本批改动范围。
实际浏览器、移动布局、屏幕阅读器和性能测量未执行；不宣称无障碍符合性。

## 摘要

现有流程已正确保留失响应时的幂等键和文件选择，也区分坏文件替换与暂时故障
重试。新发现的是异步动作的归属边界：部分晚到结果在面板关闭后仍写入任务
缓存；账户代次变化也没有被组件完整检查。一个仍等待确认的移除动作可以在
面板退休后继续发出请求。上传限制读取失败则仍声称正在读取，容易使人继续
等待。修复应复用账户设置已有的 mounted＋authenticationGeneration 守卫，
并在确认返回后重新检查归属。反馈只改上传限制旁的文字与已有重试按钮，
不增加例行通知、轮询、依赖或上传短超时。

## 发现与优先级

| ID | 类型／维度 | 严重度／置信度 | 位置与证据 | 后果与建议 | 工作量 |
| --- | --- | --- | --- | --- | --- |
| STATE-01 | Defect；异步状态归属 | Medium；Observed (code + controlled component regression)，浏览器结果未观察 | `personal-backup-panel.tsx:63–98`；backup／restore／cancel／retry 成功后无有效归属检查。基线中关闭面板并清空真实查询缓存，释放响应后缓存又出现旧任务；原账户代次改变后也发生 | 离开的操作仍可能影响之后的缓存与焦点。提交、反馈、缓存发布、刷新、动画帧均需当前挂载／账户守卫；已被服务器接收的任务仍由原账户历史和 Task Center 恢复 | M |
| ERR-01 | Defect；确认后的动作有效性 | Medium；Observed (code + controlled component regression)，真实导航未观察 | `personal-backup-panel.tsx:100–108`；移除／切换确认返回后不重新检查挂载与账户。基线关闭面板再接受确认仍发出 DELETE；旧切换继续清状态 | 用户离开后不应提交旧确认。确认之后重新检查有效归属和同步在途状态；取消确认不修改选择。服务端仍独立做权限与活动任务校验，不把此处称为权限绕过 | S |
| FBK-01 | Defect；加载／失败反馈 | Medium；Observed (code + controlled component regression)，视觉表现 Inferred | `personal-backup-panel.tsx:129–131`；无 limit 一律“正在读取上传限制…”，QueryObserver 已进入 error 时仍如此，中英基线均失败 | 用户无法判断该继续等待还是重试。在原位置区分读取中、读取失败、离线暂停；保留选中文件，既有重试只读取限制，在途／离线时禁用 | S |

STATE-01 优先于文字修正，因为它影响操作归属；ERR-01 共享同一小范围守卫。
不提高服务端权限或数据丢失结论的置信度：本批没有观察到跨账户服务端写入，
也没有证据显示 canonical 恢复数据遭破坏。

## 修复前证据

- [基线日志](ux-audit-personal-archive-scope-2026-10-14-evidence/baseline.log)：
  **11 项，1 pass／10 fail／0 skip，667.8706 ms**。
  唯一通过的控制项是当前有效面板仍立即接收备份任务。
- [修复前绑定](ux-audit-personal-archive-scope-2026-10-14-evidence/pre-edit.json)：
  保留原组件 SHA，不能将后续通过结果套用于此前源码。
- 已阅读既有 [归档恢复](ux-audit-archive-recovery-2026-10-07.md)与
  [文件替换](ux-audit-archive-replacement-2026-10-07.md)记录；不重复已发布修复。

## 保留的行为与设计决定

保留个人新增恢复、同归档重复提交保护、默认不导入偏好、已有文件可用性分类、
取消上传的中性反馈、历史分页和现有轮询预算。关闭不是取消已登记任务；不为
元数据守卫给大文件上传套短超时。不修改共享 API 的账户或归档序列化合同。

沿用已批准 Web 的纸面／石墨／海绿体系、现有字体和 4px 间距。意图是让离开
操作不再打扰后来操作，失败在文件旁解释；保持 border-ui 与原有表单层次，
text-xs 限制说明、text-sm 44px 重试按钮。拒绝全局 toast、额外确认弹窗和
自动重传，因为这些会增加注意力或重复请求成本。没有新视觉方向需要批准。

## 验证计划与未决项

先完成上述三个窄修，再补充当前有效成功、未知响应原键重试、文件超限、
在途重复激活、延迟确认、账户变化／关闭和失败限制重读的回归。执行完整
脚本、lint 和非增量 TypeScript；新增浏览器回归只能发现，不能冒充运行。
真实面板关闭后的时序、认证边界与 375／1440px 外观留待有服务时验收。
按 senior-designer 清单，本批未观察 rendered 输出，不提供虚假的完整评分。

本记录是 pre-edit 审查交付；实施与最终验证在后续追加，不回写旧检查点。

## 已实施

- STATE-01：复用现有 mounted＋authenticationGeneration 方案，保护动作起点、
  成功缓存发布、失败反馈、后续刷新、上传进度和晚到动画帧。用同步在途 ref
  保证一次操作只占一个请求。服务器已登记的任务不被 UI 守卫取消。
- ERR-01：移除／切换等待确认时保留单一确认，返回后重新检查有效归属。
  拒绝旧确认不会调用 DELETE；取消确认不清文件。有效移除仍只释放临时来源。
- FBK-01：文件旁区分失败、读取中与离线暂停，保留原重试按钮，在途禁用。
  重读只请求 capabilities，既有文件与上传幂等键不变；不自动上传。
  成功后的焦点恢复只针对仍聚焦重试或已丢失的焦点，并使用 preventScroll。
  用户另选控件时不抢焦点。已有有效限制在刷新失败时继续保留。

## 中途发现与最终检查

首次窄修 11 项全部通过。扩展后
[28 项中间运行](ux-audit-personal-archive-scope-2026-10-14-evidence/focused-expanded.log)
为 **27 pass／1 fail**：QueryObserver 没有数据时开始 refetch，会从 error 变回
pending，原条件立即移除重试按钮。不是修改预期或放宽等待来处理：组件显式保留
重读中的控件，再追加焦点与重复读取守卫测试；原失败日志保留。

| 检查 | 结果与边界 |
| --- | --- |
| [最终专项](ux-audit-personal-archive-scope-2026-10-14-evidence/focused-final.log) | 36 pass／0 fail／0 skip，1098.0041 ms；真实源码、helpers、已安装查询库，其他调度与 transport 为受控替身 |
| [全部脚本](ux-audit-personal-archive-scope-2026-10-14-evidence/all-node.log) | 33 文件，926 pass／0 fail／0 skip，10518.7251 ms |
| [lint](ux-audit-personal-archive-scope-2026-10-14-evidence/lint.log)／[非增量类型](ux-audit-personal-archive-scope-2026-10-14-evidence/types-check.json) | exit 0；最终类型检查在浏览器焦点断言补充后执行。类型命令没有 stdout，PowerShell TeeObject 未产生空文件，以明确的执行结果记录代替不存在的原始日志 |
| [浏览器发现](ux-audit-personal-archive-scope-2026-10-14-evidence/discovery.log) | 三文件 19 项，仅发现／执行 0；新增 375px 中文及 1440px 英文限制读取失败、文件保留、无上传、焦点恢复断言 |
| 构建／API／生产 | 本批没有新构建、API 测试、真实恢复、登录、提交、CI 或部署；不借用此前 CI 作为新源码验收 |
| diff／缓存 | 范围内 diff 检查通过，仅 Git CRLF 提示；已有 dirty buildinfo 保持 `70c9f839…`，不还原或提交它 |

验收还包含同 payload 原键显式重试、改变备份选项才换键、未知上传保留同一 File、
取消上传中性提示、超限不发请求、取消确认不修改选择、失效回调不重新发布缓存，
以及成功数据仍立即显示的控制项。这里没有实际浏览器会话，也没有设备 CPU/RSS
测量；新增的是常数个 ref/state 守卫，未增加依赖或轮询频率。

证据从本批 `wkkk/chat-reader-personal-archive-20261014` 明确复制到邻接目录并验证
一致性。后续 [additive checkpoint](ux-audit-personal-archive-scope-2026-10-14-evidence/local-verification.json)
绑定最终源码与日志，不回写 task-status、offline 或更早 ledger；旧 notebook ledger
缺失的边界仍保留。本批完成本地窄修，整体持续优化目标仍 active。
