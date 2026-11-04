# 小内存 ZIP 导入恢复 — CI、生产部署与清理回执 — 2026-11-04

## 结果

源码 `be58b12b191e9f0fa4010f8ed4293781fec01157` 的完整 CI
`41737744696`（attempt 1）六个 job 全部通过。Run 于
**2026-11-03 23:15:54Z** 创建，结果在 **2026-11-04 00:05:54Z**、
满 50 分钟后读取。官方制品 `13282163237` ZIP SHA-256：

`8503d136eeed056b51d7d6b1b69f7f4f3c1f440d52342e3668ffb3cd5d83808b`

制品中的 `chat-reader-images.tar.gz` SHA-256 为
`c801088021ec5cc0064362a5f39e00e4cb5d14095c2155466d1e2023206e969b`。
制品 manifest 和 CI inspection 的 API/Web 身份相同。独立展开 OCI 内容后，
确认 OCI index、linux/amd64 image manifest、config blob 各自的 SHA-256
链接有效，config 中的源码 revision 均为 `be58b12...`，Docker archive 中
对应 repo tag 均引用相同 config：

| 角色 | OCI index | linux/amd64 manifest | config / Docker image ID |
| --- | --- | --- | --- |
| API（同时供 worker、migrate 使用） | `sha256:7d1533392fc2617b32d36d8ed50fff53c7a4954e6652d7a48b7ff505a0ab2d0c` | `sha256:32c78b87788db793d65da83332796a4f28f8da7d7054a98a3cd71c4dc9a9309b` | `sha256:ff8ea4d608e88472a83ebf35627a6bbb0a1c20d7d15192b1686718ddd2710ddb` |
| Web | `sha256:1f47961434e65d351a69a9fc1e61d9cf1b7e45b8e12583c11cc3680ab6b0f63c` | `sha256:261a7666b053772e63db619ba3d94ad7a711b9922afaf2bed43d8714d13b03b4` | `sha256:7904dee611b40cab19805680936e59039e83ca2b632a2edfbd2bcf845d0b6799` |

因此 CI 的 OCI index digest 与服务器 `docker image inspect .Id` 显示的
config digest 是不同对象的摘要，不是镜像漂移。远端重新检查脚本生成的
`image-inspection.json` 是 Docker config ID 快照；本次 CI 原始 JSON 与
发布制品才用于 OCI index 对比。

生产当前版本为 **`be58b12`**，直接回退为 **`3b839dc`**。API、Web、
PostgreSQL 均 healthy，worker `alive_idle`；三个应用容器使用当前 release，
无重启。PostgreSQL 容器身份和启动时间未变，schema 仍是单一 head
`20261030_0058`，只验证 current/head，没有 upgrade/downgrade。生产 env、
Compose、Nginx 未改。HTTPS health/login、HTTP→HTTPS、匿名私有接口拒绝、
公开诊断端点不可访问、缺失图片能力拒绝及公网非法方法探针通过。

完整但有限的线上检查不代表已完成真实用户 ZIP 的重试。原始 ZIP 没有被自动
重新导入，需用户显式重试后再确认导入结果。

## 部署后数据保全

停写基线于 **2026-11-04 00:40Z** 采集。服务恢复后，到 **01:40:06Z**
的聚合计数观察到变化；新 imports 与 messages 均为 0，而 conversations
增加 1、attachments 与 asset objects 各增加 14、message versions 增加 4、
source artifacts 增加 1、offline package artifacts 增加 46。
同期记录到 1 个 `content_noise_scan`、2 个
`conversation_derived_rebuild` 和 46 个 `offline_package` 后台任务完成。
这些差异发生在写入恢复之后，不能全部归因于后台任务，也没有证据将其归为
本次部署造成；因此没有尝试恢复数据库或回滚这些数据。用户资料按线上现状保留。

部署验收时新 OOM 增量为 0，既有 OOM counter 保持 487；生产 Postgres 未重启。
发布后的 backup verifier 与 housekeeping 只读报告均通过。

## 用户授权的旧镜像与备份清理

- 清除三个过期应用 revision（`0d1efac`、`127eae5`、`4b4f34f`）的
  `api`、`import-worker`、`migrate`、`web` 标签，共 12 个标签。
  清理前确认这些标签没有容器引用；未运行全局 Docker prune。
- 保留生产当前 `be58b12` 与直接回退 `3b839dc` 的全部应用标签，共 8 个。
- 清理四份较旧备份，保留最新两个已核验恢复点：
  `chat-reader-20261104T004004Z`（新版本部署前创建并验证）和
  `chat-reader-20261103T155702Z`。
- 备份文件解除链接 **2,926,529,217 bytes**。最后复查时可用空间
  **9,385,372 KiB**，磁盘使用率 77%；清理前可用空间为 5,609,448 KiB。
- 未删除 volume、PostgreSQL 数据、用户导入资料、当前/回退镜像或生产配置。

## 未声称通过的项目

原始用户 ZIP 的生产重试与 canonical 导入结果、认证生产 UI、真实用户侧
47 对话离线包完整下载/更新、持续负载和隔离恢复演练仍待单独验证。CI 合成归档
的真实限内存 worker 通过，不替代这些用户数据验收。

脱敏汇总见
[small-zip-deployment-summary.json](../evidence/release-2026-11-04/small-zip-deployment-summary.json)。
小内存策略与错误恢复合同见
[实施记录](SMALL_ZIP_MEMORY_2026-11-04.md)。
