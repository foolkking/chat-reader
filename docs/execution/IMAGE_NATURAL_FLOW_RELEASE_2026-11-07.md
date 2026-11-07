# 图片自然排版发布回执 — 2026-11-07

## 授权、身份与结论

用户在本轮完整 CI 成功后明确要求“成功，部署”。此前实施阶段的“不部署”
不覆盖这次单独授权；本次授权不包含清理、自动安排或用户资料重放。

- 应用源码：**`897ba788fd89e18c9634ca2271ba6146339939a0`**，现有 master。
- 精确 CI：**42371615326**，attempt **1**；六项 job 全部成功。
- 维护窗口：**2026-11-07 21:31:35–21:38:56 +08:00**，7 分 21 秒；
  不是零停机。运行态独立复核 **21:39:40**，备份/保全复核 **21:40:37**。
- 当前／直接回退：**`897ba78`／`9cf235f`**；旧 **`67e6336`** 亦保留。
- schema 单一 head/current **`20261105_0059`** 不变；无 migration、
  downgrade、回填重跑、Dexie 升级或旧离线快照覆盖。
- [机器回执](../evidence/release-2026-11-07/image-natural-flow-deployment-summary.json)
  保存脱敏 CI、哈希链、停写/备份、健康、权限及保全证据。
  文档回执提交不是新的应用源码或 CI 镜像。

## 精确 CI 与制品独立验收

首次读取记录 **21:13:16.518 +08:00**，晚于该轮保守边界 **21:05:47**。
未使用旧成功替代新源码验证；五份官方 ZIP 的完整 SHA-256 均与 GitHub
artifact digest 匹配，run/source/producer attempt 对齐，未使用本机重建。

| 门禁 | 结果 |
| --- | --- |
| API | 6078 passed，3 unchanged optional skipped |
| Web Node | 2111/2111，新增四项 Skill adapter 回归通过 |
| Web 浏览器 | 14/14 gate；Source Editor 118/118、Markdown/Viewer 31/31 |
| 图片/阅读 | 35/35，无跳过；64 原轨迹 +12 折叠 +4 被动滚动 +冷 Viewer 外壳 |
| Settings | 466/466，原失败和新增三项真实 API 偏好迟到回归通过 |
| 新实例系统恢复 | 1/1，隔离合成数据，不是生产备份恢复 |
| 性能比较 | 同 runner baseline/candidate 均 9/9 |
| 真实限额镜像 | 320 MiB/no swap，工作集增量 56,160,256 bytes；OOM/failcnt/restarts 均 0 |

Default PWA 为 187 passed/815 环境路由 skips；Adaptive recovery 为
12 passed/1 optional skip，均保留原门禁语义，不能声称所有发现用例都执行。
64 原轨迹共 2235 帧，静止/Viewer 峰值 0.25px、最终 0px；
保留阅读点收起峰值/最终均 0.5px；冷 Viewer 59 帧外壳变化 0px。
未修改阈值。375px 底部尺寸面板和长图 Viewer 合成截图复看无新增阻塞，
不代表生产认证 UI、所有主题/设备或真实图库验收。

| 官方制品 | ID | ZIP SHA-256 |
| --- | --- | --- |
| images | 13575467473 | `087dc93710056e94bfa2ca84fd83211fa011132c7e8a8d822bcb764d27512c84` |
| Web quality | 13574678064 | `51d4bad563e63e81dab9978c9ae4f6a28e68b601d5b9658a9e5fbd6de6e739f6` |
| Settings | 13575850266 | `101ca792540c58fc265a25c27a104b6d2c6c8d395e2112bbf9378d7ace97597c` |
| reading performance | 13575605605 | `b29b34fd93a2e5290fe6c732bc680eaf62e634733c48fb0ef13472fc8db22fe7` |
| small-ZIP memory | 13574917594 | `23cec8b351eb8f1c0eeafb104a86aa06e47fb30cfd616337c4f2735ceefdd586` |

镜像归档 SHA-256：
`a63b4df2c0a286217023d11a17adc3644aae578b8259c6edb9e10530ba0dd531`。
逐项核验全部 35 OCI blobs，解析 index → linux/amd64 manifest → config，
源码 revision 与四个角色标签对应：

- API/worker/migrate config：
  `sha256:0587db97950da863b5997c689f3d47a6c1b8e8190b24ddc58abdab1e2bd8aa4b`
- Web config：
  `sha256:076f844e157534c0bf8afb96a8089028dc99821516d608446816342ce1654fb8`

下载中一次只读 GET TLS 中断在重试后完成；已完成 ZIP 重新哈希，未跳过
完整性检查。本机 Node 深路径枚举未发现帧文件，复制至 SHA 完全相同的
短路径后，未改动的 CI 证据验证器通过。这是读取 CI 数据，不是本地应用测试。

## 生产预检与停写备份

生产初始仍为 `9cf235f`、直接回退 `67e6336`，API/Web/PostgreSQL healthy，
worker `alive_idle`；活动/排队后台任务和活动导入均零。运维 checkout 有
20 条 dirty 项，未 pull/reset。九个 deploy helper 从精确源码单独提取到
新的发布目录；服务器完整复核传输和 helper 哈希，未覆盖原配置或 helper。

预检拒绝记录均保留：

1. Compose 2.27 将字节限制序列化为十进制字符串，本地编写的附加只读断言
   原先期待整数；改为解析数值，仍严格要求 192/256 MiB、0.5 CPU 和只读卷。
2. PowerShell JSON 往返把等价 UTC 时间转换成 +08:00，严格 UTC 回执解析
   在 attempt1 的停服前拒绝。仅在 Python 中规范化时间表示，时刻和至少
   50 分钟条件不变。三个应用确认仍 running，独立 attempt2 重新完整预检。

两次拒绝均发生于停写前，没有替换应用、修改生产配置或降低资源门槛。
实际维护前合并文件系统预算：**5,877,764 KiB 可用 ≥5,124,155 KiB 需求**；
沿用 256 MiB 备份、512 MiB 镜像、128 MiB 传输 headroom。

只停止 Web/API/worker，不停止 PostgreSQL。停写后复查可用内存
**515,552 KiB ≥448 MiB floor**。候选镜像单独运行限额、只读文件系统/
业务卷及 PostgreSQL 只读事务附件审计：
**390 文件/390 SHA、378 asset objects、12 Context objects、352 active
attachments，零 issue，complete/clean/read_only 全部 true**。

新备份 **`chat-reader-20261107T133202Z`**：
PostgreSQL custom dump + imports/exports/offline/assets 四个 tar。
禁用 dedup 和 retention；五个 SHA、PG TOC、四个 tar 流均在替换前通过，
部署后再次独立验证。没有下载生产备份或持久化真实正文/对象身份。
停写期间比较 14 个 canonical 表的计数未变；恢复写入后不再与冻结基准
比较，也未为了匹配计数而回滚用户写入。

## 更新与运行态复核

- exact CI archive `docker load` 后逐角色比较 config、平台、revision。
- 候选镜像只读检查单一 head/current 0059，旧 52/52 私有搜索回填仍 committed。
- 仅 `up -d --no-build --no-deps --pull never --force-recreate`
  API/import-worker/Web；没有应用构建、依赖安装、PG 重建或 Scanner 启动。
- 仅验证现有公开图片隐私 Nginx location，未写配置或 reload。
- API/Web/PostgreSQL healthy，worker `alive_idle`；精确镜像、HTTPS health/login
  200、HTTP→HTTPS 301、匿名私有 API 401、公开 diagnostics 404、
  无效图片 capability 404/no-store、安全头通过。
- 本地/Web HTTPS 两条路径共 50 个合成非法页面方法均 405，无 cookie/重定向。
- 三应用启动日志仅保留固定类别/计数/哈希，错误关键词为零，重启/OOM 为零；
  主机 OOM kill 计数保持 487，没有新 kernel OOM。
- env/Compose/Nginx 哈希、PostgreSQL 容器身份和启动时间不变。
- 仅在验收通过后原子更新 current/rollback 指针；随后独立运行态与备份复查。

## 保全、容量与剩余边界

保留三份备份：`chat-reader-20261107T133202Z`、
`chat-reader-20261106T140111Z`、`chat-reader-20261105T160504Z`。
保留当前/直接回退/旧 `67e6336` 三代全部十二个角色标签；
归档、发布证据和全部用户文件未清理。本机十一份用户残留逐一哈希保持不变。

**21:40:37 +08:00：92% 磁盘使用、3,457,056 KiB 可用。**
本轮容量准入通过不等于下次足够；下一轮需新的容量测量，不能自动 prune、
删备份、删卷或降低 headroom。当前部署没有清理授权。

没有使用 web search、运行本地应用/构建/测试、新建或恢复安排、修改用户
导入资料或重传原 ZIP。认证生产 UI、真实 47 对话离线更新、物理剪贴板/
触摸/屏幕阅读器、持续负载仍未验收。服务端备份验证不等于生产恢复演练或
异地容灾；Scanner disabled 仍表示未扫描，不代表文件安全。
