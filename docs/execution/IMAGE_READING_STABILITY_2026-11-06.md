# 图片展示、阅读稳定性与关联审查实施

日期：2026-11-06。基线 `master@06404d57dc92eb74ae5f13436954f6cf3e4e8440`。
该基线是旧发布的文档回执，不能作为本次源码的 CI 证据。

## 授权与边界

实施已确认的图片/视口计划，同时纳入用户追加的 11 月 6 日七项审查。
仅现有 master；不部署、不操作生产、不自动重传原 ZIP、不改本机用户数据。
原 `tsconfig.tsbuildinfo`、两份审查及 evidence 目录逐文件 SHA-256 保全；
本次不提交这些原有文件。不启动本地服务、不运行本地应用测试。

临时与 CI 交接批次：
`C:\Users\86182\Desktop\wkkk\chat-reader-images-reading-20261106`。
当前 run/SHA/首次回查唯一依据仍是
`C:\Users\86182\Desktop\wkkk\chat-reader-recovery-ci-20261105\ci-handoff.json`；
每次新派发归档旧 JSON，核实身份后重新计算至少 50 分钟首次回查。
这份历史记录不覆盖交接 JSON。

## 实施映射

| 项目 | 源码与回归 |
| --- | --- |
| 图片组与保存尺寸分离 | 4:3 固定图格/实际栏宽断点，单图尺寸快照，失败不重新分行；共享整数舍入和显式适读建议；策略 Node 回归及真实图片浏览器矩阵 |
| 关联模块 | Reader/Share/Compare/Offline 同一展示单元；Compare 隐藏写控件；v3 可选校验尺寸、原 SHA 校验及 revision 更新；原链接/复制/Viewer/.cr 继续既有门禁 |
| 阅读抖动 | 每滚动容器一个几何补偿者；文本 Range/真实块锚点；用户输入取消旧定位；虚拟组估算与展示一致；代码高亮前后保留相同换行几何；逐帧证据而非最终截图 |
| NX-SYNC-01 | 全局有界 outbox 选取后按对话独立提交/读取/确认，失败不污染其他对话；鉴权失败全局停；同实体次序、操作 ID、跨标签锁和账号代际不变 |
| NX-DATA-01 | 笔记冲突 local/server/merge/empty 同事务维护私有搜索；真实 API 与 PostgreSQL search_tsv/重复回执/旧版本/owner 隔离回归 |
| NX-NAV-01 | Compare 复用虚拟块租约和真实 DOM 定位，独立错误/重试、输入取消；深目录浏览器回归 |
| NX-NAV-02 | 右侧已提交选择直接来自 URL，输入草稿与 URL 分离；同页 history 状态回归 |
| NX-STATE-01 | 未知保存后只读核对，显示当前基线时间但不冒称操作回执；下一次明确新快照；实际响应丢失浏览器回归 |
| NX-PERF-01 | 先记录真实 worker/FlexSearch 的 100/1000/5000 文档重建/传输，以及浏览器 IndexedDB+小编辑全量重建、长任务/heap。尚未声称增量化收益，保留既有 10 秒故障边界 |
| NX-EXPORT-01 | 服务器 spool 使用既有展开字节上限，拒绝超限且关闭临时流；浏览器直接下载 64MiB fallback 上限、流式进度/取消/截断检测；原导出任务仍是较大输出路径，不能伪报下载成功 |

对旧 justified gallery、分离的重度消息附件渲染、高亮前后不同行高、
多方补偿的源码风险进行了修正。**不能仅凭这些代码推导已经确认了用户
短暂向上抖动的完整触发链**；新逐帧 CI 是验收依据。

## 验证边界

- 本地仅静态 TypeScript/lint/语法/差异与保全审查；未运行应用测试。
- 新 `reading-stability` 纳入完整 release workflow 与汇总，另有强制验收脚本：
  所有新增用例实际通过且无 skip，16 个组合各有 stopped/down/up/Viewer 全帧证据。
- 固定框变化 ≤1px；无输入时锚点逐帧峰值 ≤2px、最终 ≤1px。
  连续阅读检查反向位移，并记录窗口高度和实际挂载/锚点。
- 旧导航、字体/宽度/侧栏/滚动条、搜索/批注、容量、内存、安全、
  复制、离线包/历史数据和归档门禁全部保留，没有通过延时/关闭虚拟化/
  只取最终截图/跳过测试/放宽预算替代。
- **完整精确源码 CI 尚未验收**。本文件不将已编写测试说成已执行，
  不使用旧 `42043078359` 的成功为本次源码背书；没有部署授权。

## 首次精确 CI 失败与修复

源码 `e39afa236ba8b52fb5766b051d0137382b181e7c` 的 run `42158389972`，
用户明确报告 Web 失败后，按提前诊断例外只读取精确失败 job
`127697910735` 的身份、步骤和日志；不将此例外沿用到下一次派发。

Web lint、typecheck、production build 已通过；Node 回归为 **2033/2040**。
七个失败都来自 `share-position-storage-recovery.test.mjs` 的受控文档适配器：
它没有浏览器实际存在的 `document.documentElement.dataset`，新增 Share
几何补偿隔离检查因而在旧回归到达持久化断言前抛错。不是浏览器读不到根节点
的证据，也不能把后续尚未执行的浏览器门禁说成通过。

修复补全适配器的真实滚动容器状态，不削弱产品的补偿/保存隔离检查，
保留全部原断言；新增两个实际 effect 回归，分别验证补偿不反转阅读方向/
污染持久进度，以及已经排队的 idle/unload 保存不能越过补偿所有权。
下一次真实滚动必须恢复正常保存，避免以永远禁用保存换取通过。
本地仍只做语法、静态检查和原文件保全，应用回归由下一轮完整精确 CI 执行。
修复证据批次为 `C:\Users\86182\Desktop\wkkk\chat-reader-images-reading-fix1-20261106`；
当前派发身份与新的至少 50 分钟门限仍只读唯一交接 JSON。

## 第二轮精确 CI：新阅读门禁失败与修复

源码 `6209ffbb497605308653d3125adac933dca10938`、run `42161647311`
attempt 1 在 2026-11-06 05:36:37Z 回查（晚于该 run 的 05:07:54Z 门限）。
API、settings、performance job 通过；Web job `127708486371` 失败，
后续镜像构建/检查未执行。Web Node **2042/2042**，Context 36、focused 45、
Share 2、mutation 118、cleanup 6、upload 18、Markdown 31 等前置专项通过；
新的 `reading-stability` 为 **5 passed / 17 failed / 1 timedOut / 0 skipped**，
其后门禁未执行，不能认定 Web 或完整 CI 通过。

下载精确 Web 证据制品 `13478159720`，SHA-256
`a465afc1a5bfd905917acc7bdbcd692e8938fbaec197c52fc5c21e1c5bc69f00`；
失败日志、合成上下文、部分逐帧数据及核验回执位于
`C:\Users\86182\Desktop\wkkk\chat-reader-images-reading-fix2-20261106`。

| 证据和原因 | 处理 |
| --- | --- |
| 全新 Reader/Offline 没有定位事务，不发布 `navigationStage`；测试却一直等 settled | 以实际几何 owner 就绪及 fresh/settled 为前提；显式隐藏图片定位仍严格等待真实目标和 settled |
| 普通长页包含远离视口、尚未请求的 lazy 图片；全篇 `img.complete` 不可能保证 | 对受控首组五张图片检查完整解码且 naturalWidth>0；另一个用例仍逐组滚动覆盖全部图片和宽度 |
| 手机 Offline 状态在未打开的侧栏；桌面 shell 已就绪不等于包和附件下载完成 | 验证实际消息、六个原 SHA 缓存及字节数，再显式打开状态侧栏并离线；没有延长等待、跳过用例或拿在线缓存替代 |
| Compare Sections 是当前消息范围，初始用户消息不是助手长文 | 从真实 Dialogue index 选择助手，再验证深目录真实虚拟块与另一滚动容器不变 |
| 隐藏图片测试的 block limit=300 超过既有 API 上限 200，返回 422 | 使用既有合法上限，保持真实隐藏 occurrence/五个预览位断言，不改 API 限制 |
| 375px 虚拟 Share 的 Viewer 返回发生 598px 偏移；此前 stopped/down/up 逐帧正常 | 修复窗口恢复错误使用 x/y（浏览器需要 left/top）、锁定晚于模态焦点，以及 Viewer/普通几何补偿和进度保存缺少所有权隔离 |

Viewer 锁移到焦点前的 layout effect，保存来源容器与真实触发 occurrence，
关闭时一次补偿实际位移；下一帧释放所有权并重新采锚。独立 Compare 不跨
容器恢复；Reader/Share 不把 Viewer 控制输入或返回滚动记为阅读意图/进度。
共享模态初始/兜底焦点禁止隐式滚动。新增实际源码的窗口坐标、锁生命周期、
重开/嵌套、真实触发位置和 Compare 隔离回归，以及几何 owner、Share 保存与
模态输入的覆盖。**这些代码缺陷与失败现象相关，但旧证据没有完整 Viewer
逐帧链，不能声称已证明 598px 的唯一完整原因。**

新门禁为全部 16 组合增加 Viewer 开关全帧峰值/最终位移断言和制品校验，
强制 **64** 份轨迹；失败时也保留已有部分逐帧数据。23 个用例、所有旧门禁、
预算、超时和零 skip 要求不变。本轮仍只做本地静态检查，新增回归须由下一次
完整精确源码 CI 执行；未部署。新 SHA/run/至少 50 分钟门限以交接 JSON 为准。

## 第三轮精确 CI：独立 Share 导航适配器遗漏

源码 `c3a21f50496f2b371e19df4de67010fb68e98630`、run `42174449666`
attempt 1 于 2026-11-06 07:20:21Z 回查，晚于 07:16:43Z 门限。
Web job `127749564806` 的 lint/typecheck/build 通过，Node 为
**2052 passed / 2 failed / 0 skipped**；上轮新增 12 项受控源码回归均通过，
但浏览器尚未启动，汇总明确 **14 NOT_VERIFIED**。API/settings/performance
job 通过，不能代替本轮完整验收。

两个失败都在 `share-navigation-retirement.test.mjs`：其单独抽取的
`markScrollIntent` 调用新增 Viewer guard 时，受控 `document` 缺少真实浏览器
必有的 `documentElement.dataset`，在原“手动输入取消导航/恢复”断言前抛错。
上轮只补全 storage effect 的另一个适配器，没有覆盖这个独立抽取路径；
这是测试依赖审查遗漏，不是浏览器缺失根节点，也不是已复现新的图片抖动。

修复只补全该测试适配器，不改产品 guard、不改旧断言、不加可选链掩盖遗漏。
另加四项实际回调回归，交叉验证显式导航/保存位置恢复：Viewer 内输入不取消
待定位目标，关闭后真实阅读输入必须仍能取消；无新输入时原目标继续完成，
租约正常释放且不启动额外 fallback。静态盘点七个 Share 源码抽取测试：
仅 retirement 和 storage 两处执行这组输入/持久化 guards；其他五处的抽取
范围为 query、edge、sheet、unlock 和 focus，不执行该手动输入回调。

精确 Web 制品 `13483400571` 的 SHA-256 为
`3c298f5d90d35a0f1f9f8fe29298eeca32d4b0f5519a75a64882572bed644f7e`，
包含 NOT_VERIFIED 汇总而无浏览器逐帧证据。日志、制品核验、依赖盘点和静态
检查保存于 `C:\Users\86182\Desktop\wkkk\chat-reader-images-reading-fix3-20261106`。
本地未执行应用测试；23 个阅读用例、64 份轨迹及全部旧门禁仍待新精确 CI。
再次派发仍归档旧交接、重算至少 50 分钟；本轮没有部署。
