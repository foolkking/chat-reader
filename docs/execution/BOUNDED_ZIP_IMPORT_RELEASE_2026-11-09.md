# 有界 ZIP 与阅读工具：精确 CI / 部署回执 — 2026-11-09

## 授权与范围

用户将本轮目标更新为“持续修复 CI 至成功并完成部署，每次提交 CI 后等待
50分钟”，替代早先提交后停止的边界。保持 master，无新分支。
应用源码为 **`d61b9c69004c3c482fd915fd6f77481fa1920ae7`**；本回执的
文档提交不是新的应用发布。没有生产构建、配置替换、资料/卷/旧备份清理，
也没有重放用户 ZIP。本地只做静态检查与官方制品数据核验。

## 精确 CI 与修复结论

**42522644855，attempt 1** 的六项 job 全部成功：
web-quality、settings-quality、api-quality、reading-performance-comparison、
build-images、inspect-release-artifact。
派发确认 **04:56:29.183568 +08:00**，首次读取
**05:46:29.441205**，满足本次独立的50分钟门槛。

此前逐轮失败未被删除或改写；[实施记录](BOUNDED_ZIP_IMPORT_2026-11-08.md)
保留证据与修正。后四轮根因分别是导入重试复用新鲜终态缓存而不再轮询、
禁用提交按钮失焦后标签面板收不到 Escape、浏览器 evaluate 未显式传入
测试进程变量，以及阅读工具调整后的旧角色/ID/全页 alert 选择器。
产品修复保留原操作身份、账号隔离和未知写入只读恢复；测试修复不降低
几何阈值、不 force 点击、不删除功能断言或跳过门禁。

| 验收 | 结果与边界 |
| --- | --- |
| API | 6171 passed / 3 optional skipped / 4 warnings |
| Web Node / Web gates | 2161/2161；14/14 |
| Settings / 隔离系统归档恢复 | 470/470；1/1（合成环境，不是生产备份恢复） |
| 阅读 / 同机性能 / 图片控件 | 35/35；9/9；6/6 |
| 逐帧原始数据 | 64原始 +12折叠 +4被动滚动 +cold Viewer；原验证器及阈值不变 |
| Default PWA / Adaptive recovery | 190 passed /822专项环境分流跳过；12 passed /1原有可选跳过 |

五份官方ZIP的API digest和本地流式SHA256一致；制品ID、完整摘要、
内存报告及镜像链保存在[脱敏JSON](../evidence/release-2026-11-09/bounded-zip-deployment-summary.json)。
OCI描述符、config和全部layer/diffid验证；35个blob、375份API内嵌源文件、
Web revision均绑定精确提交，禁止内容未出现在镜像中。没有本地加载/运行镜像。

| 实际内存场景 | 容器硬限制（无额外swap） | 工作集峰值增量 bytes |
| --- | --- | ---: |
| 原小ZIP | 320 MiB | 54,071,296 |
| 新有界small | 320 MiB | 54,259,712 |
| assets100（ZIP 103,243,496 bytes） | 320 MiB | 54,845,440 |
| assets500（ZIP 522,673,896 bytes） | 640 MiB | 53,972,992 |
| long（36消息 /21600blocks） | 320 MiB | 54,341,632 |

五例均真实传感器、精确revision、无OOM/oom_kill/failcnt增长/重启，
增量≤64 MiB；消息、引用、附件SHA与合成预期一致。
这些观测不证明任意大小/压缩比/结构的用户ZIP都能成功，更不等于实际用户文件验收。

## king 部署与独立复核

- 维护 **05:55:56–06:03:02 +08:00（7分6秒）**；
  **06:03:30**独立运行态复核通过，**06:06:22**保全/旧备份复核通过。
- 停服前零运行/排队后台任务、零活动导入。容量可用
  **13,200,348 KiB ≥5,505,983 KiB**，按实际解压layer的560,867,840 bytes
  上调预算；保留原备份/镜像/传输余量，不降低门槛。
- 只停止Web/API/worker，停止后至少448 MiB MemAvailable。
  候选镜像只读附件审计 **403/403 SHA，零问题**。审计/migration一次性容器
  有192 MiB RAM、256 MiB memory+swap、0.5 CPU边界，不把该overlay用于服务。
- 新停写五组件备份 **`chat-reader-20261108T215622Z`**：
  PostgreSQL、imports、exports、offline、assets；SHA、四个tar流与PG TOC
  验证并独立复验通过。无去重/保留清理；不是实际恢复演练。
- 备份后升级 **0059→`20261108_0060`**，单一head/current；
  两个nullable next_run_at及索引有效，迁移时旧行均NULL；
  14张canonical表停写计数不变。旧私人搜索回填保持committed，52/52。
- 仅以 `--no-build --no-deps --pull never --force-recreate` 替换三应用。
  API/worker镜像config为
  `sha256:04458bad09b65a9fbcdeba0054f471d0a7ef4fd5079ae60309d4c4ad9807a78e`；
  Web为`sha256:9846dcbf33c4096bf0df05b5ef84f9ca2dcb6d18d73130743a9f3c2bd8f43186`。
- API/Web/PostgreSQL healthy，worker alive_idle；HTTPS健康与登录200，
  匿名私有API401、诊断与无效图片能力404、50项非法页面方法405；
  无Cookie/重定向泄漏，安全header/no-store正常。
- 原env/Compose/Nginx与服务挂载/环境摘要/资源限制不变；
  PostgreSQL身份/启动时间、其余七个容器身份/状态/配置不变。
  启动错误关键词和新增OOM均零，三应用重启计数零。
  恢复写入后不将业务计数强行与停写快照比较，也没有回滚用户数据。
- 两份备份均重新验证；保留两代八个role tag与旧镜像归档，
  旧归档SHA仍与原回执一致。最终 **10,756,356 KiB可用，74%使用**。
  这是时间点快照，后续仍需重新容量准入，不授权清理。

### 如实保留的部署准备更正

维护前，服务器Python3.6拒绝任务包装脚本的capture_output/text参数；
改为等价PIPE/universal_newlines后继续。Windows传输校验列表的CRLF使
Linux将CR视为文件名部分，校验在停服前拒绝；仅规范化任务目录两份
checksum清单为LF并重新全量验证。上述拒绝均未改生产服务或放宽校验。
额外容量检查使用实际未压缩OCI layer总量，而非只计外层tar大小。

## 保留边界与回退

- 当前发布指针为d61b9c6；**没有直接回退指针**。保留897ba78镜像与备份
  不等于它能消费v2草稿/0060队列；迁移后失败应先停写并前向恢复，
  不自动启动旧worker、downgrade或恢复旧数据。
- 没有清理两份备份、用户资料、数据卷、旧镜像或服务器历史证据。
  原有21份工作区文件在文档收尾前逐字节不变；随后只给8份已改文档
  加入可逆的发布说明，旧内容字节仍完整保留，单独暂存新增说明，不夹带
  原有清理/审查文档及tsbuildinfo。其余13份文件原哈希不变。
- 50分钟CI回查在独立部署复核通过后暂停。后续文档提交不派发新CI或
  改写已验收应用revision；本轮没有永久放宽质量阈值。
- 待用户验收：原ZIP显式重试、真实47对话离线更新、登录后的生产交互、
  物理设备/读屏/剪贴板、持续负载及生产备份隔离恢复。健康检查和合成CI
  不替代这些结论。扫描器仍按原生产配置禁用，不声称恶意文件安全认证。
