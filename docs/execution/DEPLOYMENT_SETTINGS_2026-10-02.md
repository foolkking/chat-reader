# 设置与离线完善生产部署记录

用户明确授权部署；阶段五（Skill 完整版本编辑）仍暂停。本记录是 2026-10-02 的
发布证据，当前实现合同由 PROJECT_STATE 与 docs/system 维护。

## 已部署版本

- 地址：https://chat.king.2bd.net
- 源码：`ad223cd4bcbbad7a4ff0c5ea5f33ed2846f3a3ca`。
- [Actions 36955004824](https://github.com/foolkking/chat-reader/actions/runs/36955004824)：
  API、Web、设置、镜像构建、独立产物检查全部成功。
- 镜像归档 SHA-256：`cbe92190111ca4b2cca1c06617f39a9e7d2182fa93d47ef152e67bcf0aa9cfd0`。
- API/worker：`sha256:dcc20270a69ece03623ac1bd77d4ffb65fa79e8ac0b2d17f82e430235c9614f0`。
- Web：`sha256:68ec6ec335a99604b9f9b2dcdd40f229843b2426646298e7b20ed06b67e94b7f`。
- 新服务全部启动时间：2026-10-02 03:26:12 UTC（北京时间 11:26:12）。
- 迁移：`20260927_0033` → `20261002_0042`，唯一 head/current。

## 发布与恢复边界

下载指定运行、指定 attempt 的构建产物，本机及 King 校验归档一致。加载后逐一核对
四个镜像标签的 image ID、OCI revision 和 amd64 架构。容量预检通过：约 11.9 GiB
可用，要求约 5.3 GiB；没有清理文件、镜像或备份来腾出空间。

worker 空闲且无 queued/processing 任务后，停止旧 API 与 worker，保留 PostgreSQL。
一致恢复点 `/opt/chat-reader/backups/chat-reader-20261002T031735Z` 包含数据库 custom
dump、imports、exports、offline、assets；全部 checksum、归档可读性和
`pg_restore --list` 校验成功后才迁移。没有覆盖或移除用户导入资料。

原服务器 checkout 和 Compose 的本地修改保留。当前 Compose 与发布版本的运行
配置一致，仅缺少未使用的本机构建 revision 参数；服务器使用预构建镜像及
`--no-build`，没有编译 Next 或启动 Scanner。发布支持文件保存在版本目录。
PostgreSQL 容器 identity/StartedAt、管理员部署配置和 `.env.production` 校验值
前后相同，数据库未重启或替换。

Nginx 仅增加 `/api/me/archive/previews`、`/api/system/archive/previews` 两条精确
location：520 MiB multipart 上限、流式请求、直连 loopback FastAPI。新增独立
snippet，通过 `nginx -t` 后 reload；原 TLS、其他站点与普通请求上限保留。

当前镜像指针已更新；`5877558` 旧镜像和备份保留。涉及 schema 回退时须评估兼容性
或在备份副本演练，不能把旧镜像存在等同于数据库已回退。未执行清理；发布后约
9.2 GiB 剩余空间。

## 实际验证

| 验证项 | 结果 |
| --- | --- |
| 迁移前后 canonical 计数 | users 2、projects 10、conversations 34、messages 4432、message_versions 4749、attachments 325、asset_objects 301，全部一致 |
| 有界附件存储核验 | 294 个有效附件、301 个对象/文件，301 个 SHA-256 匹配，0 issues；迁移前后完全一致 |
| 运行镜像及嵌入版本 | API/worker/Web 为目标 revision；认证后的 app-info 返回目标源码 |
| 服务与心跳 | PostgreSQL/API/Web healthy，worker alive_idle |
| 新服务启动状态 | 0 restart、无 OOM、最近日志无 error/exception/traceback/fatal/panic 关键词 |
| 公网入口 | HTTPS health 200，HTTP 301 到相同 HTTPS origin |
| 真实管理员 HTTP 登录 | 200；凭据只在服务内存中使用，未输出或保存 Cookie |
| 12 项认证设置读取 | session、capabilities、本人分享、个人/系统归档能力、用户/邀请分页、审计、runtime、噪声规则、偏好、app-info 全部200 |
| HTTP 退出与权限 | logout 204；随后私有 runtime 返回401；不撤销其他设备会话 |
| 公共登录页浏览器渲染 | Codex in-app browser 可见邮箱/密码、登录、注册和重发验证入口 |
| 完整 owner desktop/mobile UI | NOT_VERIFIED：未在浏览器中建立 owner 会话；不以 HTTP/CI 代替此项 |
| 实际邮件发送 | NOT_VERIFIED／不可用：生产 SMTP 未配置，验证与改邮箱发信继续显示未配置状态 |

实施期间的 Windows 换行导致 checksum/helper 首次执行失败，已仅规范化发布副本
后重做并通过。旧版全对话正文附件审计未完成，且观察到旧 API 容器 OOM 标记；该项
不计通过。随后停写建立并验证新备份，改用只取必要列的有界附件存储审计核对全部
对象和实际文件；PostgreSQL 保持原 identity/start time，新服务无 OOM 或重启。
主机 Python 3.6 不支持一次性发布脚本的 capture_output 参数，改用兼容参数后
重新通过最终核验，首次失败发生在更新镜像指针之前。

没有生产备份恢复、真实内容编辑、分享权限变更、账户删除或其他业务数据测试写入。
CI 测试结果及本地合成浏览器验收见
[设置执行记录](SETTINGS_COMPLETION_2026-09-30.md)，不与本次生产探测混为一项。
