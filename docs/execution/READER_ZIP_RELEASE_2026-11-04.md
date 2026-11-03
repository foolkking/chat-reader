# Reader、富 Markdown 与 Adaptive ZIP 发布 — 2026-11-04

## 最终状态

精确源码 **`3b839dc1adfac431b6c44c2e1928a9be946cb42f`** 已部署并接受。
完整 `Build release images` CI **`41633888061`** 的六个 job 全部成功：
API、Web、settings、reading-performance comparison、build-images 和
inspect-release-artifact。官方部署制品为 **`13232957284`**，
归档 SHA-256：

`6b6ba4c080da4e316bf1f12d353a574723a5bfd871413e4432ebf9c15a6250a`

生产接受于 **2026-11-03 16:04:43Z / 2026-11-04 00:04:43 +08:00**；
**16:08:12Z / 00:08:12 +08:00** 独立复核通过。当前／直接回退为
**`3b839dc`／`4b4f34f`**。数据库仍为单一 head **`20261030_0058`**；
只验证 current/head，没有执行 upgrade 或 downgrade。

## 备份与替换

维护窗口 **2026-11-03 15:56:47–16:04:43Z /
23:56:47–2026-11-04 00:04:43 +08:00（7 分 56 秒）**，是有计划的应用停机，
不是零停机。停写期间只读附件审计完整检查 **338 个活动附件、359 个 asset
对象、12 个 Context 对象，共 371 个文件／SHA-256，零问题**；随后创建并校验
五组件停写备份 **`chat-reader-20261103T155702Z`**。以已验证的 CI 镜像
`--no-build --no-deps --force-recreate` 替换 API、worker 与 Web。

最终独立复核时 API、Web、PostgreSQL 均 healthy，worker 心跳 `alive_idle`；
三个应用容器 revision 和镜像 digest 均匹配精确源码。canonical 停写行数、
PostgreSQL 身份／启动时间、生产 env／Compose、Nginx 和 OOM 计数未变；
新内核 OOM 与应用启动错误关键词均为零。HTTPS health/login 为 200，
HTTP→HTTPS 为 301，匿名私有接口拒绝状态、诊断端点 404、缺失图片能力 404
及 25 个公网非法页面方法探针均符合预期。新备份在部署后再次校验通过；
独立检查剩余可用空间 **7,156,904 KiB（约 6.82 GiB）**。共保留五份备份，
没有清理备份、用户资料、volume 或其他镜像。

## 未完成及失败尝试边界

两次早期部署尝试没有形成候选发布：首次在维护前的制品校验处停止，没有
改动生产；下一次在应用替换后，被本地 `127.0.0.1:3000` 的合成
`Next-Action: x` 负向探针触发的一行无效 Server Action 格式日志阻断，
自动恢复原应用。该本地探针绕过了 Nginx 的公网 405 防护，不能代表公网请求
行为；未过滤应用日志或放宽安全响应，而是将该 25 项拒绝探针限定到真实
HTTPS 入口后重新执行。该次恢复前创建的备份仍保留。成功批次无 migration，
生产数据和配置没有改变。

生产认证 UI、实际用户侧 47 对话离线包完整下载／更新、持续负载和隔离恢复
演练没有执行，不以 CI 或健康探针替代这些验收。

详细脱敏回执：
[CI 复核](../evidence/release-2026-11-04/ci-recheck.json)、
[制品与生产复核](../evidence/release-2026-11-04/deployment-summary.json)。
计划完成度及产品范围见
[Reader/ZIP 完成度复审](ux-audit-reader-zip-completion-2026-11-03.md)、
[实施记录](READER_ZIP_IMPLEMENTATION_2026-11-03.md)和
[Adaptive ZIP 合同](../system/ADAPTIVE_IMPORT_ARCHIVE_CONTRACT.md)。
