# 小机器持续改进实施账本

日期：2026-11-11。应用基线3564cbf，前序收尾文档5149062。
新代码尚未部署，不代表生产行为已经改变。
[方案](../planning/SMALL_HOST_OPERATIONS_2026-11-11.md)是本轮工作范围，
当前源码合同仍在system文档；已有用户修改与历史证据保持原样。

## A：活性与后台维护隔离

真实路径：单并发worker的心跳线程原来同步调用导出与到期Share回收。
按条数限制不能防止单次文件操作/行锁阻塞；真实线程合成复现先失败。

已实现：
- 同进程独立维护线程；单飞、脉冲合并，不增加用户任务并发。
- 每轮2秒协作预算，导出/Share各最多20条，交替优先、错误分别隔离。
- PostgreSQL事务本地statement1500ms/lock250ms；Share跳过占用行。
- worker心跳先提交，任务心跳被锁只影响该次任务更新，不掩盖worker活性。
- 停止/接管/心跳失败禁止新维护；中断保留现有reclaiming记录供下次核对。
- 原下载租约、路径验证、来源权限、外层事务语义不变。

验证：

| 检查点 | 结果 | 说明 |
| --- | --- | --- |
| 修前新线程用例 | 1失败、2通过 | 慢维护确实阻断后续心跳，保留失败证据 |
| 第一轮worker/export专项 | 80通过、4跳过 | Windows不支持POSIX SIGTERM语义 |
| 扩充PG与Context专项 | 119通过、2失败、4跳过 | 两个新PG夹具漏必需owner，未进入被测行为 |
| 修复夹具完整重跑 | **121通过、4跳过** | 实际PG行锁/连接超时还原/下载租约/取消与Context回归 |

最后一次命令从`apps/api`执行：

```powershell
python -m pytest tests/test_worker_maintenance_isolation.py `
  tests/test_worker_maintenance_postgres.py tests/test_worker_liveness.py `
  tests/test_worker_shutdown.py tests/test_worker_requeue_postgres.py `
  tests/test_export_retention.py tests/test_export_retention_postgres.py `
  tests/test_web_feature_completion.py tests/test_context_return.py `
  tests/test_context_return_postgres.py -q
```

所有数据库、文件与内容均为合成；PG只监听本机任务端口，随机数据库经现有
隔离fixture迁移/销毁。TEMP/TMP、pytest basetemp与日志放在指定wkkk任务目录；
没有重放用户ZIP，没有生产清理/配置变更/部署。
该测试不是完整Linux内存/Reader逐帧验收；原CI门槛保留。

## CI 与后续块

派发前已确认上一轮完整CI42828329240/3564cbf成功；再前一轮失败是历史，
不冒充本轮结果。新的CI绑定源码后另记，不等待CI才继续下一块，不建安排。
B：取消后的文件清理回执、恢复入口与真实状态统计正在调查，未完成。
C：阅读资源与导航边界未完成。D：简约管理员摘要尚待完整设计/验证。

## B：明确放弃后的来源清理恢复

修前两项复现均失败：清理PermissionError没有持久结果，暂停/取消别名遗漏。
已在原ImportRecord/analysis_summary上增加服务端清理回执，不加migration，
不生成第二个后台任务。只有明确放弃才授权清理；Task Center的20条独立
待处理窗口及原任务retry只重试文件，不重启分析。根变化、缺失存储根、
symlink/junction、非目录替换和非UUID目标保护；未知写回保留可核对状态。
Root运行摘要补齐状态及待处理数，只在异常/非零时展开额外内容。
账户删除把未完成回执交给Root，按50条批量剥离文件名、分析内容与子记录，
不因级联删除而丢失清理凭据，也不保留被删账户的普通工作区。

本地验证：
- 初步48通过/1未开启PG跳过；扩展实际PG专项160通过/3平台symlink跳过。
- 账户/根边界32通过/1symlink跳过；最后脱敏转交代码15通过/1symlink跳过。
  第一次账户PG命令缺测试认证secret，1项夹具失败；设置合成secret后重跑通过。
- Web lint/typecheck通过；UX Node2261通过（含新task恢复用例）。
- 原Task Center真实Chromium合成矩阵12通过，375/800/1440、中英文、明暗；
  加入清理未知结果、键盘提交、只读核对、不重复写入及44px/no-overflow检查。
  人工查看375中文截图，动作没有遮挡、无需新增管理页面。
- 同源码/相同安装依赖的任务隔离Next生产构建通过；初次复制未带.bin，
  pnpm直接build没有找到next，改用相同已安装next入口后成功。
  typecheck初次多传`--`、Windows Node通配符未展开也如实保留，
  修正命令后通过，未改变测试断言。

A已提交/推送cc94de1，完整CI42868364815在运行；本块准备提交时已复查：
API和Web quality成功，Settings与Reader比较仍运行，无已知失败。
SSH传输首次连接重置；改为同仓库HTTPS后推送/派发成功，没有改远端配置。
未等CI结束继续B/C。所有检查仍为本地隔离/合成，生产不变。
