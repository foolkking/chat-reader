# 网页升级与恢复

此功能是可选接入，不改变原[手动镜像部署流程](../deployment.md)。首次部署、老版本引入管理界面、变更更新源或更新宿主机工具仍由运维完成。发布标签不会自动更新任何实例。

## 管理员日常使用

在 **设置 → 管理 → 运行状态 → 版本更新** 检查当前版本、Web/API 构建、可信来源、频道和变更。只有根管理员有权限。该区默认收起；单纯打开设置、系统备份或运行状态不会请求更新器。未接入也不向普通用户显示提醒。

先点 **下载并验证**，期间旧服务继续提供读写。准备成功后 30 分钟内可选择 **重启并升级**。未确认、包损坏、盘满、来源改变、发现定制挂载或不支持的 Provider 均不会触发准备阶段停服。过期需重新准备。下载时间是流式传输、落盘和 SHA-256 的时间；“含验证总计”还包含运行态准入、签名复核、解包检查和镜像预装。不是倒计时或服务时限。

确认重启不再访问发布源、不再 `docker load`、不编译。**确认框会区分「仅换程序」和「完整维护」。** 前者列出需要替换的角色和已恢复验证的数据备份时间；后者说明不能走快路径的原因，并显示本机上一次完整操作耗时（如有）。旧实例/旧发布仍走完整维护。最近登录超过 10 分钟需要重新登录根管理员。状态不明先看独立进度页，不重复提交。

| 确认框 | 确认后发生什么 | 失败或回滚 |
|---|---|---|
| 仅换程序 | Web、API 或两者，按签名配对说明选择。只读程序根、实际镜像、配置、挂载、schema、可用空间、恢复凭证和 worker 在线状态都重新核对。不封站、不停 worker/PostgreSQL、不新做全量备份、不迁移。 | 只切回已验证的旧程序；期间的写入保留。慢上传/在途事务允许正常收尾，不为了达标强杀。点击后条件失效会拒绝或要求人工核对，不会悄悄转为完整维护。 |
| 完整维护 | 验证后封入口，等待 worker 空闲、停止三个程序角色，生成 PostgreSQL 和四类文件一致备份，再迁移及切换。 | 只在旧程序兼容当前数据时恢复；否则保留现场，不自动降库。完整回滚也会备份当前数据。 |

仅换程序并不等于零中断：没有双写或两套同端口容器；替换 Web 时该入口可能暂时返回 502，替换 API 时新请求可能暂时不可用。确认成功必须经同源 `/login` 和 `/api/health` **实际读到各自预期的构建标识**、匿名管理接口仍是 401、worker 心跳和数据库版本正常。不能凭 Nginx 返回 200、Docker 显示 running 或前端倒计时认定成功。

### 首次启用仅换程序（独立维护窗口）

1. **先完整安装支持构建标识的应用及已核验签名的工具包。** `v0.1.4` 本身尚不能证明该能力，首次引入更新器/迁移/依赖变更不是快路径。不要为此次接入删除恢复点、改写 `state.json` 或复制个人 SSH 凭据。
2. 在隔离 Linux/Docker 上拷贝一份**已停写生成**的完整五组件备份。以已拉取且核验的对应 PostgreSQL **镜像 ID**，在新的私有 scratch 目录运行工具（参数中的名字均为示意）：

   ```sh
   python3 -I /usr/local/lib/chat-reader-updater/prove_recovery.py \
     /isolated/backups "$backup_relative_path" /isolated/scratch "$pg_image_id" \
     "$trusted_owner_repo" "$numeric_repository_id" /isolated/program-recovery.json
   ```

   工具实际恢复 PG 到无网络、无宿主挂载的临时实例，实际解包并读回四类文件。把签发的结果由运维私下送回对应宿主，以 `root:root`, `0600` 安装到 `/etc/chat-reader/updater/program-recovery.json`。生产备份需保留相同的相对位置、清单和字节，不修改用户卷。这里的日期是**那一份备份**的日期，不是本次点击时刻。
3. 确认没有活动/未解决任务，停止 `chat-reader-updater.service`（独立进度服务可保留），运行 `/usr/local/lib/chat-reader-updater/updater audit-hardening`。此时**不要创建 profile 标记**；工具对原可写容器完整扫描，核验来源、旧程序、本机布置、配置和卷。失败则不接入。
4. `systemctl enable --now chat-reader-program-scratch.service` 准备三个私有磁盘临时目录；全是程序临时文件，不是用户业务卷。父目录仅 root 可遍历，磁盘 bind 挂载 `noexec,nosuid,nodev`，不把大上传挤进小内存 tmpfs。按原维护流程收尾现有上传、事务和 worker；保留 `.env`、Compose 和现有镜像指针。加载受信的 `current-images.env` 并导出其中各角色镜像，沿用本机**原来的**项目名、`--project-directory`、`--env-file` 和两个 `-f`，仅追加 `-f /usr/local/lib/chat-reader-updater/program-profile.yml`，使用 `up -d --no-deps --no-build --pull never api web import-worker` 重建**同版本**程序。不要启动 migrate、不要重建 PostgreSQL。
5. 由 root 建立 `0600` 的 `/etc/chat-reader/updater/program-profile.enabled`，待同版本程序启动，执行 `updater enroll-hardening`。它再次扫描真实程序根、比对原配置、PG 身份和四个原卷，实际读回恢复点后登记。成功再启动协调器并确认旧站正常。未通过时保留现场：如尚未登记新指纹，用原镜像/两个原 Compose 文件恢复同版本、移开新标记，重新核验；不要混用新标记和旧布局，不手写指纹。后续所有运维 Compose 操作均须保留此覆盖层及独立的 `WORKER_IMAGE`。
6. 验证后的恢复点以 root 所有的文件身份、长度、修改/变更时间和清单摘要封存。**七天内**不为每次准备或确认重新扫描大归档；任一改变、消失或超过七天，快路径拒绝。更换已恢复备份或定期独立复核：在无活动任务时停协调器，执行 `updater refresh-recovery` 完整读回并重新登记，再启动协调器。整个过程旧应用可在线；不会替换数据库、删除旧备份或自动恢复损坏的文件。

### 什么版本有资格

发布运行从该仓库同频道的上一正式发布取得签名清单及原镜像包，检查提交祖先关系、公钥、配置 ID 和数据合同。首批只识别静态 JSX 文本/样式、少数 CSS 声明，以及搜索服务中已限定的纯文本函数；不是按目录或 HTTP 方法放行。实际旧/新 API 各写入正常导入，双方各自在 PostgreSQL 独立 SELECT-only 角色、程序根和四个只读业务卷下读两代数据。未覆盖的业务修改、环境变化及不同程序底座走完整路径。受信仓库是 Fork 时全过程使用该 Fork 的真实版本和公钥。

发布物中的 `program-evidence.json` 记录资格；仅通过者附 `program-transition-v1.json` 及 Ed25519 签名，绑定原 release、两侧不可变身份、原清单字节与证据。旧更新器忽略附加文件。预演和签名工作分离；私钥不进入兼容测试容器。初版不把不同配对的结果串联推断：上次仅替换了一部分角色、实际混合布局不在下一对起始证明中，**下一次明确提示完整维护**。回滚仍按最近一次已证实的精确角色布局，而非把未重启的 worker 标记成新版。

进度页由独立进程在 `/__updates/` 提供，停服/刷新不依赖 Next 或 API。它是只读页；必须携带由同源根管理员预先领取、限单个任务的 Secure/HttpOnly/SameSite=Strict Cookie。不要复制 Cookie、URL 参数或日志给其他人。其他管理员重新领取同一任务的票据会替换旧票据。浏览器关闭不取消已提交的任务。

<a id="king-enrollment"></a>
## `king` 已接入：日常使用与运维边界

**当前：2026-11-21 02:23:18（北京时间）已升级至 `v0.1.4`。** 正式签名包通过已接入的宿主机更新器安装；实际 API 桥复查稳定源，没有更高版本，上一版为 `v0.1.1`。镜像回退与数据库兼容，但当前剩余空间不足以新建回滚前备份；不要反复确认或手动绕过。见[生产计时与复核](../deployment.md#v014-production)。

**历史，2026-11-20 22:41：** `v0.1.2` 已签名发布，但两次重启准入在停服前拒绝，当时仍为 `v0.1.1`，未产生新备份、迁移或切换。准备下载 6.346 秒、含准入／验镜像 255.561 秒。只清理已授权的 DNF 缓存约 217 MiB；停写前容量预检通过不是忽略后续完整性检查的理由。详见[失败和发布证据](../evidence/search-reading-2026-11-20/v0.1.2-publication-and-host-admission.json)。

源码修复把本机 Docker **固定容器完整性扫描** `GET /containers/<64hex>/changes` 的读取期限单独设为 120 秒：非原生 overlay diff 会遍历文件系统，冷态不能套用快速元数据的 15 秒期限。其他 Docker 读取仍为 15 秒；16 MiB 响应上限、HTTP 状态、核心目录变动拒绝和超时失败关闭均保留。它不是 15 秒重启承诺。已接入的旧执行器不会随应用镜像升级：只能由运维核验修复版签名工具包，在无进行中任务时更新；不得修改 journal 或跳过扫描。

2026-11-20 **03:17:15 北京时间**复核：协调器及独立进度服务均为 `active` / `enabled`。实际 API 桥用自己的非 root 身份，经专用 socket 检查了公开源 `foolkking/chat-reader` 的 `stable` 频道；返回的签名清单与现役 **`v0.1.1`** 一致，没有更高版本。根管理员可在上方入口点击 **检查更新**。此次没有使用管理员会话，也没有在生产演练升级；首次登记不凭旧镜像或数据备份虚构网页回滚选项。

| 运维对象 | 此实例的边界 |
| --- | --- |
| 配置 | `/srv/chat-reader-online` 是仅 root 可写的生效部署目录。环境文件与原已核验配置字节相同；Compose 保留原部署的 worker 限制和 `pull_policy: never`，程序角色不含构建并要求明确镜像。原 `/opt/chat-reader` 未改权限，不是更新器配置来源。不要在两个目录间手动同步秘密或从旧工作树执行特权命令。 |
| 一次性变动 | 仅重建同镜像 API，以只读方式挂入控制 socket 目录并加入专属组；worker、Web、PostgreSQL 和另七个容器未重启。只在本站 TLS server 增加一个签名进度/维护片段。没有迁移或重置管理员，三个应用容器均无 Docker socket。 |
| 备份 | `/var/lib/chat-reader-online-backups` 有一份本次切换前 `v0.1.1` 的停写备份，五组件已独立校验；配套程序仍在。旧目录另保留已在隔离环境实际恢复过的 `chat-reader-20261119T182358Z` 及配套 `26b35501` 程序。此次未删除备份。 |
| 下次升级／回滚的空间 | 11 月 21 日 02:28:29，已保留镜像的预算需 **7,110,916 KiB**，可用 **3,290,120 KiB**（约 3.14 GiB），缺 **3,820,796 KiB**。新版本还需按实际下载包和展开大小另计。扩容或单独核验、整理保留点后重新预检；不删唯一验证恢复点，不降余量。 |

运维连接 `king` 后，可用以下**只读**命令定位同一组四个容器。后置的已登记镜像指针和 socket override 都不能省略。手动更换镜像或变更配置是独立维护操作；若与登记不再匹配，停止并重新审计，不要编辑更新器状态来解除保护。

```sh
sudo env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C DOCKER_HOST=unix:///var/run/docker.sock \
  docker compose --project-directory /srv/chat-reader-online -p chat-reader \
    --env-file /srv/chat-reader-online/.env.production --env-file /etc/chat-reader/release-state/current-images.env \
    -f /srv/chat-reader-online/docker-compose.production.yml -f /usr/local/lib/chat-reader-updater/api-socket.yml \
    ps -q api web import-worker postgres
```

[接入回执](../evidence/online-update-2026-11-18/king-enrollment-2026-11-20.json)保留首次 Nginx 检查拒绝、操作端等待超时后的成功回执及清理前的磁盘拒绝；[后续恢复与清理回执](../evidence/online-update-2026-11-18/king-backup-retention-2026-11-20.json)记录单份保留、空间与健康复核。两次操作都不是生产下载或重启测速。

## 接入前提和信任根

- Linux/amd64、systemd、Python 3.6+、能运行仓库备份脚本的 GNU 工具、Docker Engine 25+ 与支持 `healthcheck.start_interval` 的 Compose v2。采用仓库生产 Compose、同源 TLS Nginx、PostgreSQL、本机四个命名业务卷。只支持声明的 `local-assets-v1` 和 `reader-jobs-v1`。外置数据库、S3、绕过网关的入口、共享可写卷、源码 bind mount、未证明来源的旧镜像，不接入。
- 已有管理员、`.env`、Compose、代理配置、固定卷名和生产指针保留。API/Web 宿主端口必须只监听回环，PostgreSQL 不对外。审计也要包括 Docker 以外的写入者（宿主机定时脚本、其他网关）；不能独占写入则不启用此流程。
- 应用和 worker 不拥有 Docker socket、签名私钥、GitHub 凭据、宿主机备份或发布目录。只有 API 得到控制 socket 的只读目录挂载和专属补充组；命令对端还检查 API 数字 UID。Nginx 只加入独立进度组，不得加入控制组。
- 接入前从**仓库以外的可信渠道**取得该发行方 Ed25519 公钥（PEM），独立核对指纹、仓库全名、不可变数字 repository ID。不要从待验证镜像或同一下载页自举信任。没有来源证明的实例默认按定制版对待。私有源可把仓库 Contents read 的最小凭据仅写到宿主机 `/etc/chat-reader/updater/release-read-token`（root:root 0600）；公开源无需凭据。此凭据不用于个人 Git 操作，不复制个人 SSH 私钥。

### 首次安装（运维，维护窗口）

1. 离线取得同一 Release 的 `chat-reader-updater-linux-amd64.tar.gz`、`updater-kit.sha256` 和 `.sig`，在空的工作目录验证**签名及精确文件名**后解包。此处 `issuer.pem` 是独立取得的公钥。不要执行下载页上的脚本。

   ```sh
   set -eu
   umask 077
   base64 -d updater-kit.sha256.sig > kit.sig.bin
   openssl pkeyutl -verify -pubin -inkey issuer.pem -rawin -in updater-kit.sha256 -sigfile kit.sig.bin
   test "$(wc -l < updater-kit.sha256)" -eq 1
   grep -Ex '[0-9a-f]{64}  chat-reader-updater-linux-amd64\.tar\.gz' updater-kit.sha256 >/dev/null
   sha256sum -c updater-kit.sha256
   tar -xzf chat-reader-updater-linux-amd64.tar.gz
   sh deploy/updater/install.sh deploy/updater/updater-linux-amd64 nginx
   ```

   Nginx 用户按机器选择 `nginx` 或 `www-data`。安装器只安装文件和 systemd 单元，不下载、不注册、不启动升级。

2. root 配置 `/etc/chat-reader/updater/source.json` 和 `host.json`（目录 0700，文件 0600，以下为结构示例，不含真实配置）。`public_key` 是该 Ed25519 公钥 32 字节原始值的标准 Base64；`command_uid` 是**可信 API 镜像内实际的非 root UID**，不要猜；两个 GID 分别取安装器创建的 `cr-update-control`、`cr-update-status`。默认选择 `stable`；明确同意 RC 才用 `preview`。

   ```json
   {"repository":"OWNER/REPO","repository_id":123,"channel":"stable","public_key":"<RAW_PUBLIC_KEY_BASE64>","command_uid":10001,"command_gid":28001,"status_gid":28002}
   ```
   ```json
   {"project":"chat-reader","project_dir":"/srv/chat-reader","compose":"/srv/chat-reader/docker-compose.production.yml","env_file":"/srv/chat-reader/.env.production","origin":"https://reader.example.org","release_state":"/etc/chat-reader/release-state","backups":"/srv/backups/chat-reader","protected_files":["/etc/nginx/conf.d/chat-reader.conf","/usr/local/lib/chat-reader-updater/nginx.conf"]}
   ```

   全部路径用已经存在的绝对真实路径，不用 symlink。`project` 必须是现有 Compose 项目名；备份目录由 root 独占。`protected_files` 列全生效的入口/依赖片段。操作系统证书库必须信任真实站点证书。本地 API 探针以外的验收不使用 `-k`。私有 Release 的临时 CDN URL 不进入日志。

3. 使用现有部署的**精确镜像指针**和项目名，一次性把 `/usr/local/lib/chat-reader-updater/api-socket.yml` 作为生产 Compose 的最后一个 `-f` 加入；保持同一 `.env`、原 Compose、卷、数据和镜像，不使用默认 `latest`，不重建数据库。在对应 TLS `server` 内 `include /usr/local/lib/chat-reader-updater/nginx.conf;`，核对所有写入口经过它；`nginx -t` 成功后让新 worker 获得进度组再接流量。API 必须是包含新路由和界面的版本；老版先走原有合格镜像手动部署一次。以后手动 Compose 操作也应使用相同 override。不要只把 socket 暴露给 API 却绕过访问围栏。
4. 将已经验证的**当前安装版本** `update-v1.json` 及其签名放到 `installed-update-v1.json` 和 `installed-update-v1.json.sig`（在上述 `/etc` 目录）；不要用候选版本代替当前版本。旧实例有独立可信证据时才可构造 `baseline.json`：`version:"legacy"`，不可变 `revision`、`repository`、`repository_id`、`schema`、`provider_abi`、`job_abi`，以及 API/Web 各自的 `config`、`engine_ids` 和 `rootfs`。这些必须来自**原发布制品及独立检查**，不能从可疑的运行容器抄回后自认官方。
5. 执行 `/usr/local/lib/chat-reader-updater/updater enroll`，然后 `systemctl enable --now chat-reader-update-status.service chat-reader-updater.service`。接入会拒绝覆盖已有登记。无票据访问 `/__updates/status` 应为 404；未登录访问 `/api/admin/updates` 应为 401；普通用户不能读取；确认 Web/worker 没有控制挂载且三个服务都没有 Docker socket。上线前在非生产副本验证停写和恢复。签名根、配置、部署挂载变更要按新实例审计并重新接入；不要编辑宿主机 journal 绕过拒绝。

## Fork 发布（官方也遵循同一规则）

Fork 自己同步上游、合并、测试、签名、发版。应用不自动合并源码，不能下载 URL、切换发行方或上传更新包。一个签名清单同时声明源码 SHA、Actions run/attempt、制品 ID/digest、镜像 config/RootFS、GHCR digest、归档大小与 SHA-256、变更、来源和最低更新器协议。

1. 对稳定 `vX.Y.Z` 和预览 `vX.Y.Z-rc.N` 标签启用仓库 ruleset，限制创建/修改和 workflow 变更；启用受审核的 `signed-releases` 环境，只允许受保护发行标签。使用 Fork **自己的** numeric repository ID，将仓库变量 `UPDATE_DISTRIBUTION` 设为 `OWNER/REPO:ID`。
2. 在受保护的 `signed-releases` 环境配置 `UPDATE_SIGNING_KEY`（Base64 编码的 Ed25519 PKCS#8 PEM 私钥），并钉住 `UPDATE_PUBLIC_KEY`（原始公钥 Base64）。要签发快路径，还要把同一个**公钥**设为仓库 Actions 变量 `UPDATE_PUBLIC_KEY`，让无签名权限的兼容测试能验证旧发布。不要把私钥设为仓库变量。签名器独立核对密钥配对；普通 CI 和演练均无签名/发行写权限。
3. 在开发者自己的经授权测试命名空间验证发行流程：完整原 CI → 此精确提交的独立制品检查 → 隔离更新演练 → 推送同一制品内的镜像到 GHCR → 按 digest 回读并比对 → 以 draft 上传并核对所有文件 → 公布 Release。发布确认同时检查发起运行、尝试和关联资格运行；不选“最近成功”。仅首次完整资格运行的 attempt 1 可用于发布，重试须重新发起完整资格验证。历史 image-only 修复白名单不适用于 Fork。实例首版只从签名 Release 包升级，不另走可变镜像标签。
4. 修改 schema/Provider/job 合同时先验证迁移、备份和上一版的读写语义，再显式维护 `deploy/updater/compatibility.json`。v1 只接受已知 ABI，只允许相同 schema/ABI 的程序回退。旧读取语义不明时宁可拒绝。更换公钥/发行方是单独维护操作，不由待升级版本自行授权。

## 失败、恢复与磁盘

| 现象 | 处理 |
|---|---|
| 无可用宿主机、验签失败、磁盘不足、定制状态不符 | 原版继续运行。查主机时间、信任、实际磁盘和凭据；不以删除备份或改写登记作为重试手段。 |
| `refused` / `restored` | 前者未切换；后者只有重核旧程序/数据成功才会报告。读取具体原因，排除后从“检查更新”开始。 |
| `recovery_required`、指针/卷不一致或检测到异常写入 | 保持围栏。保存 `/var/lib/chat-reader-updater/state.json`、`jobs/<job>/`、原新镜像指针、备份和安全日志；不要重复启动迁移、清维护标记、降库或覆盖卷。 |
| 宿主机在迁移/确认中重启 | systemd 启动后先核对真实程序、挂载、schema、持久指针和维护记号；不能证明安全则隔离，不盲目重放。 |
| 需要验证或实际恢复 | 用复制出的备份在**新的隔离 PostgreSQL 和四个新业务卷**中先运行原 `verify_backup.sh`、恢复并核对 schema、关键行、四类文件、worker 和 HTTPS。先备存事发数据。人工选择数据权威版本后再制定切流步骤，不向生产卷就地解包。 |

完整维护备份位置为 `<backups>/update-<job>/chat-reader-<UTC>`，包含 `postgres.dump`、四类归档、TOC、清单和校验和。归档落盘时算 SHA，发布备份目录前独立读回；同一遍验证文件摘要、gzip 完整性、tar 结构，PG 另验 TOC。旧备份格式和手动路径保留。**仅换程序不生成新备份；两条路径都不自动删除恢复点。** 镜像准备目录位于宿主机状态路径，不在应用卷中。快路径只预算实际下载、镜像装载临时包、新层及余量。`king` 的历史容量不能证明下一次准入，本功能不在 `king` 演练。

性能目标：制品传输并落盘 30 秒、确认重启到健康恢复 15 秒；分别记录网络传输、准备总时间、用户视角恢复和实际维护间隔。大数据备份、繁忙 worker、慢链路/磁盘、慢启动或 schema 变化都可能超过目标；绝不按计时器提前报成功。当前实测、截图、失败与尚未验证的边界见[隔离验收记录](../evidence/online-update-2026-11-18/verification.md)。
