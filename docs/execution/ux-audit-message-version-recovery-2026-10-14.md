# 消息版本操作恢复审查 — 2026-10-14

## 范围与证据

本报告先于本批产品编辑。范围是已有响应式 Web Reader 的单消息版本箭头、
历史详情和永久删除；受众是普通读者，删除不可撤销。沿用已批准的
paper/graphite/sea-green 界面，不重做主题、源码编辑器或版本数据规则。
用户要求自行验收：本批不启动服务、不登录、不运行浏览器、测试、测试发现、
lint、类型检查、构建、CI 或部署。以下源码缺口为 Observed(code)，时序与
用户影响为 Inferred；没有运行、截图、性能、焦点或可访问性合规结论。

SEEN：`features/editing/version-history-panel.tsx` 完整源码；
`features/conversations/message-item.tsx` 的共享 actions、双操作区、锚点替换；
`conversation-reader.tsx:1855–1958` 的窗口刷新与消息局部替换；
`lib/api.ts` 的版本请求/错误类型/GET deadline；
`lib/types.ts` 的版本历史和写入响应；服务端 messages GET/版本选择/删除及
`message_edit_service.py` 的对应实现。相邻源码保存、任务勾选和确认弹窗提供
可沿用的交互模式。NOT SEEN：真实失败、双击、手机布局、账户切换和请求时序。

修复前 SHA256（工作树，不是生产）：

| 文件 | SHA256 |
| --- | --- |
| version-history-panel.tsx | `88209A7FA01848CB5BF8AD24C24604F0A9245F7F318E71903378CA92DF523620` |
| message-item.tsx | `2A0EFF80D772D57B182ACF44953345BCD85EDB4B52E7EB9179A5725D322971CC` |
| lib/api.ts | `8B4B8B15EAD8F4474D5F716371B573BDE8C8E1D5DCD74BC4752E7AEDF164C441` |

## 摘要

版本选择和删除只有 finally 收尾，没有失败反馈，网络结果未知时箭头重新可用。
服务器已确认的写入与其后的正文替换在同一个 try 内，刷新失败没有独立说明。
手机打开操作菜单后，同时挂载隐藏桌面控件和手机控件，两套写入锁彼此独立。
删除的锁在确认之后才取得，目标与账户/卸载状态没有完整重新校验。
历史读取失败没有恢复入口；缺失当前版本时还把第一版当作当前。
后台索引状态读取失败直接丢弃 job ID，不能再核对，容易把“没读到状态”混同完成。
本批集中修补上述状态合同，不改变 canonical 版本、第一版保护、删除回退、
批注重定位或派生任务规则。

## 发现

| ID | 维度 | 严重度 | 置信度 | 修复前位置 | 建议／工作量 |
| --- | --- | --- | --- | --- | --- |
| ERR-VERSION-01 | 错误恢复／反馈 | High | Observed(code); 运行影响 Inferred | `version-history-panel.tsx:64–80,89–111` | 分开确认写入和正文刷新；未知写入先只读核对，不自动重发。M |
| STATE-VERSION-02 | 生命周期／错误预防 | High | Observed(code); 运行影响 Inferred | `version-history-panel.tsx:19–21,84–88`；`message-item.tsx:167,199,229` | 同一消息只有一个操作 owner；确认前锁定，之后复核目标；淘汰旧消息、路由、账户和卸载回调。M |
| STATE-VERSION-03 | 读取／陈旧状态 | Medium | Observed(code); 呈现 Inferred | `version-history-panel.tsx:26,38,115–116` | 失败可重读，陈旧结果不授权写入；当前版本缺失不猜第一版；正文版本变化时重读历史。M |
| FBK-VERSION-04 | 后台任务反馈 | Medium | Observed(code); 呈现 Inferred | `version-history-panel.tsx:27–35,41–56,125` | 保留 job ID，读取失败暂停原有轮询并提供状态核对；failed/cancelled 不假报正文未保存。S |

ERR-VERSION-01：读者不知道操作失败还是仅没拿到响应，可能重复永久删除或再次
切换；旧代码也没有稳定的中英文错误分支。已确认成功先更新本地历史，再处理
正文刷新；刷新失败仅允许读，不把它改写成“删除失败”。无回执的写入先读取当前
历史、消息正文和对话 revision；这些 GET 不是原请求回执，不声称原请求成功/失败。
核对后仍需用户明确选择继续使用当前状态，不重发原操作。

STATE-VERSION-02：两个控件分别使用自己的 operationInFlightRef；删除在
await confirm 后才加锁，没有再次校验可见当前版本。采用消息级共享 controller，
只共享数据、写入/恢复和派生状态；桌面/手机各自保留展开状态。锁必须在确认前取得，
确认后检查 live 目标与历史 head；失效只取消客户端等待，不能声称撤销服务器写入。
不建立全局消息 Map 或跨页面持久化操作队列。

STATE-VERSION-03：读者可能把读失败当成没有版本；历史缓存的 head 优先于
新正文 prop，findIndex 找不到时 Math.max(0,…) 又展示第一项。正常空历史、
初次失败、旧历史读失败与 head 不一致分别处理；保留可读旧预览，但不启用写入。
只在 canonical 正文版本变化时触发一次历史更新，不增加历史轮询。

FBK-VERSION-04：读状态失败不说明后台失败，更不说明正文写入失败。保留原
job ID 与局部反馈，手动核对只调用 GET；不增加轮询频率，不自动重新排队或重试任务。

## 修复合同与取舍

| 状态／入口 | 行为 | 恢复与边界 |
| --- | --- | --- |
| 正常历史 | 原有上一版／下一版和详情 | 不增加例行成功 toast 或正文上方通知 |
| 初次/后续读失败、head 不一致 | 明确局部状态；旧预览可读，写入禁用 | 只读核对版本与正文 |
| 切换、确认删除、写入中 | 同一消息两个操作区共同锁定 | 仍可收起详情/手机菜单，不全屏阻塞 |
| 确认后目标变化 | 不发送 DELETE | 重新读取后才能作新决策 |
| 写入已确认、正文刷新失败 | 保留已确认的新 head/删除结果 | 只重读与替换，不重发写入 |
| 写入结果未知 | 保留一个异常恢复状态并禁用版本写入 | 主动 GET；不推断回执，用户确认当前状态后才继续 |
| GET 核对间发生版本变化 | 不应用相互矛盾的历史与正文 | 保持写入锁，允许再次核对 |
| 派生任务 GET 失败 | 保留 job；暂停 1.5 秒轮询 | 手动 GET，不更改正文/任务 |
| 消息/路由/账户/卸载失效 | 旧请求、确认和 finally 不修改新 owner | 不保证卸载或整页重载后保留未知请求 |

工程选择：一个消息级 hook 供两个视图使用，article 不换 wrapper、不 remount
真实 DOM 锚点；只读 Share/Offline 的 hook 使用静态 inactive query key，
不读取受保护历史/任务、不启用写入。它们会有禁用 observer 的开销；本批没有
CPU/RSS 测量，不声称“零成本”。不选择全局注册表（过期所有权/持久化负担）或
复制两套 controller（不能解决重复 owner）。异常恢复是按需目标消息 GET，正常
操作不增加全窗口重读；使用现有 20 秒信号 deadline，不安装库或增加定时器。

界面 checkpoint：Intent 是读者在同一消息比较/切换版本，必要时恢复而不丢阅读
位置；Palette 保留纸色、graphite 和既有 warning/danger token；Depth 保留
border-ui/raised 的局部详情层；Surfaces 不新增卡片或正文 banner；Typography
使用现有 text-sm/text-xs 和应用字体；Spacing 保持 4px 网格与现有 40–44px 控件，
新增恢复按钮至少 44px。手机详情放在操作区可滚动区域，桌面仍为局部 disclosure。
不重新征询已批准平台/主题，不做竞品或新视觉方向研究。使用 product-design-and-ux
的确认结果边界、interface-design 的现有 tokens、senior-designer 的状态/文案纪律。
用户拒绝运行验收，视觉 checklist 留待真实渲染后评分，不能给虚构通过分数。

## 优先顺序、保留与待验收

先统一 owner 和 scope，随后区分写入/刷新/未知，补只读恢复与派生状态读取。
低成本收益是历史错误不再静默消失、后台 read error 不再丢 job；
共同 owner 和未知结果恢复需一起实施，避免补提示后仍能重复写。
第一版保护和服务端删除回退已经明确，保持不变。未接入活跃路径的
RestoreVersionButton/VersionHistoryButton 不新增入口；本批修的是实际版本
select/delete，不宣称实现“复制旧版本为新版本”的新功能。

需用户后续验收：中/英文、桌面/手机、双操作区锁、取消/失效确认、响应丢失、
已提交但正文回调失败、陈旧读取、GET 不一致、索引读取错误/failed/cancelled、
关闭重开菜单、稳定真实 DOM 阅读锚点、只读无私有请求。并发改正文/任务勾选/
其他设备不是一个服务器原子操作；这里的读核对也不是跨请求一致性事务或请求
回执。跨组件并发与真正请求完成的观测仍需运行环境验证，不能由源码断言解决。

## 本批实施记录（源码已修改，未运行）

已完成以下局部修复：

- 将桌面与移动端版本控件收拢到同一个消息级 controller；两种展示不会各自
  发起版本写入或恢复操作，展开状态仍各自独立。
- 版本写入在确认前取得锁，确认后重新检查 scope、当前 head 和目标；已确认的
  服务端写入与正文局部刷新分开反馈，正文刷新失败不会要求重发写入。
- 对网络、超时、5xx 和中断前无法确认的写入保留目标与操作类型，只能先执行
  GET 核对；不自动重发。核对结果与待确认目标不匹配时继续按钮保持禁用。
- 历史读取失败、当前 head 缺失或缓存陈旧时不再猜测第一版；保留可见旧预览但
  禁用写入，并提供局部核对入口。后台派生任务读取失败保留 job ID，暂停轮询，
  可手动核对或进入任务中心。
- 保留既有 `["message-versions", messageId]` 查询键，使源码编辑等已有精确
  invalidation 继续命中；账户代次、路由、卸载和授权锁通过 owner guard 与取消
  处理，不把代次暴露为新的缓存分片。

涉及文件：`apps/web/features/editing/use-message-version-history.ts`、
`apps/web/features/editing/version-history-panel.tsx`、
`apps/web/features/conversations/message-item.tsx`、`apps/web/lib/api.ts`，
以及对应的源码回归草稿 `scripts/ux/message-version-recovery.test.mjs`。
本批没有改服务端 API、数据库、migration、worker、imports 或部署配置；
`lib/api.ts` 仅补充客户端对现有消息读取接口的 signal 传递和读取封装，未新增
服务端路由。

修改后工作树 SHA256：

| 文件 | SHA256 |
| --- | --- |
| use-message-version-history.ts | `DDD458EB959C8FDB9F1E50D61A1E706FAC8FD29C5413A0C9108BE99C9326E4AC` |
| version-history-panel.tsx | `D92FD7F1850A04B22212E99246E177B0D9AF2E7599D8416C57A0CA12645D5A51` |
| message-item.tsx | `530E686D9BA8CF3BACB08AAA58DBC5ED4C891BD9D2EE540747EDE86E9895435C` |
| lib/api.ts | `332A45C7BAEBE3CD063544DB405C8F7BEED96EF2A82EF58AC3D1B267C4FE9B9E` |

按用户要求，本批未启动服务、未登录、未运行测试或测试发现、lint、类型检查、
构建、CI、部署或浏览器验收；运行时并发、焦点、真实移动布局和性能仍待用户
后续验证。生产和发布边界不变。
