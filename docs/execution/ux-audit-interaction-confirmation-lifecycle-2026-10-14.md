# 共用确认弹窗生命周期审查 — 2026-10-14

## 范围与证据

本报告先于本批产品编辑，接续全站普通用户操作审查。平台为已有响应式 Web；
对象是确认/输入弹窗及等待其结果的调用方。源码可用，但用户明确要求后续自行验证：
不启动服务、不登录、不运行浏览器、测试、lint、类型检查、构建、CI 或部署。
本批不改变弹窗外观、文案、输入裁剪/空白校验、API 或数据写入语义。

SEEN：`components/interaction-dialog-provider.tsx` 完整源码，邻近
`use-dialog-focus.ts` 完整源码，AuthBoundary 的挂载边界，共用 confirm/prompt
调用位置及 `features/editing/restore-version-button.tsx` 的确认后写入路径。
NOT SEEN：实际多次点击、路由/账户切换时序、键盘/触屏、真实焦点恢复、视觉布局、
浏览器内存和网络请求。代码缺口标为 Observed(code)，用户影响为 Inferred，
不把源码阅读当成运行验证，也不声称生产已发生误操作。

修复前 `interaction-dialog-provider.tsx` SHA256：
`937C5D5D2B8F9EF75D24717327B373EFA62D96B1A05709B7B83F2DB24941FD89`。

## 摘要

共用弹窗已有危险操作说明、取消/关闭/背景关闭、Escape/Tab 与输入空白校验。
目前却只保存一份 resolver，后来的 confirm/prompt 直接覆盖它，前一个等待者
不会收到结果。这个问题可能让依赖 finally 收尾的操作停留在等待状态。
弹窗由 root provider 持有，也没有统一的路由、账户代次和卸载取消边界。
部分调用方已有自己的围栏，但共用组件不能依赖所有调用方恰好都实现同样的保护。
本批只补齐一次决策的生命周期，不排队执行过期请求、不新增提示或网络调用。

## 发现与优先级

| ID | 维度 | 严重度 | 置信度 | 位置 | 建议／工作量 |
| --- | --- | --- | --- | --- | --- |
| STATE-CONFIRM-01 | 状态覆盖／错误预防 | High | Observed(code); 运行影响 Inferred | `interaction-dialog-provider.tsx:33,44,51` | 同时只允许一个等待请求；后来的请求立即返回 false/null，保留第一个弹窗及其输入；卸载结束原 Promise。S |
| ERR-CONFIRM-02 | 错误预防／范围一致性 | High | Observed(code); 运行影响 Inferred | `interaction-dialog-provider.tsx:38–57`；`restore-version-button.tsx:20` | 决策绑定路由 visit 与 authentication generation；旧上下文函数和旧 DOM 回调不得确认新请求；范围失效仅取消等待，不取消已受理服务器工作。M |

STATE-CONFIRM-01：用户第二次触发操作后，第一个调用者可能永远等不到取消或
确认。旧源码的 confirm/prompt 都直接赋值 `resolverRef.current`，没有结束已有
等待者，也没有卸载清理。处理采用 first-pending-wins，而非替换第一个弹窗或建立
队列：保留可见决策及输入，后来的请求按取消结束，不在未来突然出现另一项操作。

ERR-CONFIRM-02：用户已离开原页面或账户代次已失效时，旧确认不应继续授权写入。
组件没有对应 scope 校验；例如 RestoreVersionButton 在确认后调用捕获的 onRestore，
没有共用边界保证旧确认被取消。正向结果必须匹配当前请求 token、当前路由 visit 和
当前账户代次；同一 pathname 离开再返回也不是原 visit。旧 prompt 输入/提交、
关闭按钮或 Escape 回调不得清除或确认新的等待者。

## 决策状态合同

| 入口／状态 | 返回与行为 | 边界 |
| --- | --- | --- |
| 无等待请求 → confirm/prompt | 展示原有弹窗，保存原请求 token/scope | 不发送服务器请求 |
| 已有有效等待者 → 再次请求 | 新 confirm 返回 false；新 prompt 返回 null | 不替换原标题、类型、输入，不排队 |
| 明确确认／输入提交 | 只结束当前 token；空白 prompt 仍显示原校验 | 原 confirm 返回 boolean，prompt 返回 string/null，无类型 cast 混用 |
| Close/Cancel/背景/Escape | 结束当前等待者，confirm=false、prompt=null | 中性取消，不增加错误 toast |
| 路由/账户代次失效 | 隐藏旧决策，取消其 Promise | 新范围可重新发起；旧上下文函数立即取消，不借新 scope 显示旧目标 |
| Provider 卸载 | 取消当前等待者，不对卸载组件 setState | 不取消/回滚已经受理的 API/worker 工作 |
| 旧 DOM 提交／输入／关闭回调 | 不改变新请求、输入或结果 | 同时使用请求 token 与 live scope 校验 |

query/hash 变化、同一路由内业务对象变化、父级面板关闭但 provider 仍在的情况，
仍由调用方的业务 scope/草稿围栏负责，本批不宣称共用组件替代了它们。
已经得到 true/string 的调用方写入也不被这里自动取消。

## 保留与后续验收

保留既有警告内容、模态外观、按钮、输入裁剪规则和 useDialogFocus，不新增
依赖、持久化、计时器、轮询或网络请求。此次使用 ux-audit 的源码证据分级及
状态/错误预防审查，视觉和正式可访问性合规未评估，不提供视觉评分。
高优先级先关闭 resolver 丢失，再补范围与 token 围栏；实现后补写未执行回归。

以上是先交付的修复前报告。用户后续应检查快速重复调用、确认与输入交叉、
关闭/卸载、路由往返、账户失效及旧回调不能影响新弹窗；实际焦点/键盘/触屏
仍需真实浏览器检查。生产、数据库、已有 CI 和部署授权边界不变。

## 本地实施状态（后补）

已修改 `apps/web/components/interaction-dialog-provider.tsx`，未运行或验证。
等待者现在持有独立的 view/token、route visit、authentication generation 与
类型安全的 completion；删除原来的 resolver 强制类型 cast。有效等待者优先，
后续请求立即取消且不重置原输入。context 函数本身绑定创建时 scope，旧函数不能
借用新账户/路由打开旧目标。render 隐藏失效决策，effect/授权事件取消等待，
卸载只结束 Promise、不 setState；旧表单、输入和取消回调只作用于自己的 token。
已结束的 provider 输入清空，但不会清除调用方持有的草稿或取消已受理服务器操作。

新增 `scripts/ux/interaction-confirmation-lifecycle.test.mjs`，覆盖重叠类型组合、
既有取消入口、卸载/事件清理、live 账户失效、路由往返、旧 context/DOM 回调、
空白校验/trim、单次 completion 及明确的后续弹窗。该文件编译真实 provider 源码，
但 hook 调度、路由、账户和 focus helper 都是受控替身，不是浏览器或真实 React
生命周期验收。本次没有执行它，没有基线失败/修后通过/发现用例数量的运行证据。

审查影响本次实施方式：保留第一个可见决策而非覆盖或排队，取消为中性 false/null，
不增加误报/例行提示。没有改 useDialogFocus、API、数据库、worker、生产配置、
用户 imports、无关工作树或 buildinfo。没有启动服务、登录、运行验证、提交、
推送、CI 或部署；所有新源码及真实 focus/touch/keyboard/调度验收待用户后续检查。
