# 导出回收实施记录 — 2026-10-06

状态：服务端、页面生命周期、两份备份保留与组件去重已本机实现并通过下述专项；完整 CI 与生产发布仍待完成。
生产继续为已验收的 `5d48b68` / `0047`，本机新增唯一 migration `20261006_0048`。
执行依据为 [已确认计划](../planning/EXPORT_RETENTION_AND_BACKUP_2026-10-06.md)。

## 当前代码

- Root 功能策略新增 1–60 分钟保留时间（默认 3）及关闭后提前释放（默认开启）。
  部分更新保留未提交字段，更新记录实际修改时间；旧系统归档缺少字段时使用默认值。
- worker 在既有成功提交前记录生效策略与到期时间；排队、生成不消耗有效期。
  已有产物保留原到期时间，恢复上传不适用此规则。
- ExportArtifact 增加 active/reclaiming/retry/reclaimed 状态、重试及释放记录。
  保留轻量任务/产物元数据；只有成功 unlink 或确认文件已不存在才标记 reclaimed。
- 产物行锁串行协调页面使用、下载领取、真实传输与回收。页面使用最多 45 秒并受原到期时间限制；
  下载领取最多 15 秒且不能越过到期时间；实际响应每 15 秒续占用，失联 90 秒后可回收。
- 下载仍使用原 FileResponse 的 Range 支持，关闭/断开均释放占用；禁用将路径交给服务器稍后读取的
  pathsend 快捷分支，确保响应结束后文件才可回收。
- 同一个 worker 的心跳循环执行有界回收，不等待长导入完成、不增加用户任务并发。
  回收筛选只包含已提交的四种导出任务，活动/未知任务不能阻塞后面的有效清理。
- 路径、文件大小/类型/链接和其他产物引用复核；恢复上传、离线包、导入原件及附件不属于回收范围。
  失败有限退避，日志只含统计与稳定原因码。运行状态增加脱敏清理积压/失败计数。
- 状态、usage、release、download-claims、regenerate 接口均复核所属账户。
  重建复用原选项并重新检查当前源资料；相同请求键重放只返回一个新任务。
  系统归档重建再次要求 Root。原下载 URL 保持兼容。
- Task Center 与归档列表响应开始投影实际到期/回收状态，不能继续声称已过期文件可下载。

## 已运行与未完成的验证

- 首批生命周期 **15 passed**；后续加 busy worker 后，生命周期/事务/worker/导出限制组合 **50 passed**。
- PostgreSQL 第一轮 **2 passed / 1 failed**：迁移测试旧任务 fixture 缺少必填 owner；修正测试后，
  并发/迁移往返/个人恢复/系统恢复组合 **11 passed**。不放松数据库约束。
- 重建测试第一次 **16 passed / 1 failed**：测试用了不存在的附件策略 `none`；改为正式合同
  `metadata_only` 后，实际 ZIP 重建与幂等专项 **1 passed / 16 deselected**。
- 真实慢响应跨过到期及发送中断 **2 passed / 16 deselected**，检查传输字节与租约释放。
- Web lint、typecheck、build 通过；本轮新增的实际页面验收见下方。最终 CI/PWA 仍待执行。
- 完整 API 第一轮 **215 passed / 75 skipped / 634 setup errors**：`PYTEST_ADDOPTS` 中反斜杠被
  shlex 转义，临时根目录不存在。未创建误指向的临时目录；改为正斜杠后重跑 **846 passed / 78 skipped**。
  此失败不计为功能通过，也不隐藏。
- 最终服务端专项 **34 passed / 1 skipped**；加入实际文件缺失状态检查后再跑 **35 passed / 1 skipped**。
  这些专项覆盖完整 API 启动后的补改，不能把新用例计入前一个完整回归。
- PostgreSQL 备份去重、真实恢复、两份保留、损坏备份保留、操作锁、迁移和报表组合 **11 passed**。
- 浏览器六个尺寸/语言/主题组合及两标签页、刷新、断网恢复 **7 passed**；普通导出明确关闭、重入 **2 passed**。
  校验真实 ZIP 字节、真实服务器文件存在/消失与 canonical 对话仍存在；延迟真实领取请求后立即关闭仍下载完整。
- 个人归档上传失败恢复、三宽度新增恢复/去重及帮助/运行页的离线、鉴权、轮询组合 **11 passed**。
- 浏览器首次环境缺 PUBLIC_WEB_BASE_URL 导致登录同源检查 403；补齐隔离环境，未修改生产同源校验。

测试日志与临时文件：`C:/Users/86182/Desktop/wkkk/chat-reader-export-retention-20261006/`。
PostgreSQL 17 使用独立目录 `postgres/` 和 loopback 55948，测试只创建/删除独立数据库。
生产库不参与测试，本机与服务器均未构建镜像。

## 页面与备份实现

- 导出、维护准备、个人/系统归档和任务中心共用 ExportArtifactDelivery；过期仍可下载 Skill，重新生成用原选项和当前源资料。
- 明确关闭使用独立 scope；领取请求先于关闭进入同一客户端队列，关闭等待领取和下载派发。
  普通卸载、响应式布局和页面隐藏不发送提前回收。路由离开关闭旧页面 scope；刷新由短租约/截止时间兜底。
- 账户 generation 检查阻止旧页面在新账户发起领取、释放或回写结果。服务端逐请求校验归属。
- 使用服务端 server_now/expiry 计算本页剩余期限，不依据客户端时钟变快判定服务端已经过期。
- backup.sh 在写入临时目录并校验之后一次 rename 发布；与清理共享排他锁，失败不影响既有恢复点。
- backup_housekeeping.py 支持 Python 3.6+，保留五组件格式。对最新两份中的字节相同组件，用硬链接替换未发布新副本，
  最后重新做五 SHA、四 tar 与真实 pg_restore --list。它们是两份逻辑快照，不是两份独立物理副本。
- prune 默认拒绝，只有明确传入发布已验收标记才执行；先验证至少两份完整恢复点，再精确删除更早的八个固定成员。
  异常成员、符号链接、损坏/未知目录、并发操作锁不被绕过，不访问业务 volume。

## 续跑顺序

1. 完成最终代码审查、CI 和余下 Reader/Share/PWA/认证及空实例系统归档专项。
2. CI 成功后独立发布 0048，先记录历史过期产物数量/字节与业务基线；停写备份、迁移、健康验证后收敛两份备份。
3. 验证 worker 对历史过期导出的实际回收和管理员策略；确认业务数据/附件/离线对象未误删。
4. 删除精确旧镜像标签，保留核验过的回滚归档，记录最终磁盘差额。镜像只使用 CI 产物。

异地副本按用户决定暂不设置。长期目标保持进行中，不能把本机专项通过等同生产交付。

## 首轮 CI 与补改

已推送实现 `585d61f`，首轮 CI `37354343891` 发现：API **928 passed / 3 skipped / 1 failed**；
旧 Skill migration 测试在 0045 schema 上调用当前 feature-policy service，读取了 0048 列。
修正为直接建立旧 Skill/首选数据，先升 0046 验证重置与个人内容保留，再升 head 验证真实解析。
本机 PostgreSQL 全部 Skill archive/concurrency/migration 专项 **6 passed**。

Web Context gate **26 passed / 9 failed**；新增临时导出状态使旧复制提示选择器匹配两条 status。
选择器改为定位复制状态，保留真实剪贴板内容断言，不删除导出状态或屏蔽可访问提示。
其他后续 gate 在失败后未执行，不能记通过。

最终复查补上任务中心关闭后的异步重生成回调保护；真实请求延迟、关闭后任务仍完成且面板不重开，
独立浏览器用例 **1 passed**。补改后 Web build 再次通过。此时生产仍是 5d48b68/0047。

修正后的 Context 导出/指引浏览器专项 **10 passed**，覆盖三种宽度和中英文；首轮 CI 的
认证设置矩阵实际 **145 passed**，独立空实例 PostgreSQL 恢复 **1 passed**。新提交仍需完整 CI。

后续 `79109a2` / CI `37357508873` 五项全过：API **929 / 3 skipped**，Context **35**，
设置 **146**、空实例恢复 **1**，基线 PWA **134 / 294 skipped**，认证 **18**、离线负面 **17**。
本机基线首次因沿用认证变量、服务却关闭认证而等待登录表单超时，中止后清空该进程变量，
重跑 **138 / 294 skipped**，没有修改认证逻辑。所有本机合成服务已停止，证据保留。

该产物已核验并暂存，尚未部署。发布复核发现旧的未到期导出 `retention_seconds=null` 会被
前端显示成 0 分钟；改为无虚构时长的兼容提示，保留原到期时间，并增加真实持久化/下载浏览器用例。
这一小项需要最终源码重新通过 CI，不能复用上一源码的通过结论。

`67d6a9a` / CI `37361616753` 的 API **929 / 3 skipped**、Web 全部通过；设置 **146 passed / 1 failed**。
新增旧导出用例通过，失败来自原个人归档测试：服务端移除文件后，页面仍在等待缓存刷新，测试便关闭并期待焦点恢复。
补充等待恢复操作退出、文件上传入口恢复可操作，再关闭；保留原始焦点断言和未保存退出保护。
第一次补写误以为移除后仍停留预检提示，本机 2 次失败后停止，取消 `2ab1e40` / CI `37365456772`。
改为实际上传入口状态后，本机连续 **3 passed**；不把已取消 CI 计为通过。

## 最终源码与外部 CI 故障断点

最终功能/测试源码为 `6b4ee0aec8bf399d2bd5eefabfb9c538f2933632`，CI `37366294097`。
attempt 1 Web 全部通过；API/设置没有获得 runner、没有执行步骤，15 分钟后被平台取消。
官方 annotation：`The job was not acquired by Runner of type hosted even after multiple attempts`。
仅重跑未成功任务，attempt 2 的 API **929 passed / 3 skipped**、设置 **147 passed**、
独立 PostgreSQL 空实例恢复 **1 passed**，并保留已通过 Web。Web 精确源码结果包括 Context **35**、
PWA **134 passed / 295 skipped**、认证 **18**、离线负面 **17**；Markdown 导入 **8 / 1 skipped**。
API 三项与 Markdown 导入一项跳过均因未配置可选外部 JSON/Markdown 样本，不能计为通过。

attempt 2 镜像构建成功，但独立检查再次未获 runner、步骤为空，于 21:06 UTC 被平台取消，
annotation 同上。重跑 build-images 及其依赖的独立检查，产生 attempt 3，保留已通过质量门禁。
工作流按 run attempt 命名 artifact，因此不能仅重跑独立检查而引用不存在的新 attempt 产物。
此重试仍全部由 GitHub 构建，不在本机或 King 构建，不改变应用源码。

GitHub 官方 `https://www.githubstatus.com/api/v2/summary.json` 同时报告
`Incident with Actions` / `investigating`，Actions 为 `degraded_performance`，
事件更新时间 2026-10-05 19:50:50 UTC；后续升级为 `major_outage`，21:09 UTC 通告确认
Hosted Runners 故障持续。此处是服务商故障，不修改产品代码尝试绕过。

生产仍是 `5d48b68` / `0047`。本轮仅上传了未部署的 `79109a2` 已核验传输产物；
未 docker load、未停写、未迁移、未删除备份/导出/镜像。本机专项服务全部停止，证据保留。
服务器两份备份再次核验通过；历史导出只读基线为 57 个、1,118,258,860 bytes。
最终源码通过 CI 后，从 `chat-reader-export-final-20261006/CONTINUE.md` 继续；
最终 artifact 后缀应使用实际 attempt（当前为 3，下载到 `artifact-3/`），不能复用旧源码镜像，
也不能把本机 `artifact/` 内未通过独立检查的 attempt 2 产物当作发布版本。
