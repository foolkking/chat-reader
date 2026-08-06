# 外部依赖

最后核验：2026-08-05

## 运行依赖

| 依赖 | 用途 | 失败影响 | 降级 |
| --- | --- | --- | --- |
| PostgreSQL 16 | canonical、搜索、任务、Share、偏好、批注 | 在线 API/管理不可用 | 已下载 Library 仍可读 |
| 本地/volume 文件系统 | import/export/offline artifacts 与默认 AssetObject 存储 | 对应上传、下载、导出或包任务失败 | 已发布 canonical 不自动删除 |
| 可选 S3 兼容对象存储 | 较大部署的 AssetObject 后端；通过 `chat-reader-api[s3]` 安装 | 仅配置为 S3 时附件对象读写失败 | 切回已正确挂载的本地 AssetStore |
| 可插拔附件扫描器 | Disabled、ClamAV 或远程扫描节点 | 按部署策略阻止提交，或明确保留 `scanner_disabled` | King 当前禁用扫描并允许单用户使用未扫描对象 |
| 反向代理 | HTTPS、访问控制、上传限制 | 公网不可达或失去安全边界 | 服务器回环仍可 health check |
| 浏览器 IndexedDB/Cache/SW/Storage API | 离线正文、壳、搜索、outbox、配额 | 离线能力不可用 | 在线 canonical 不受本地清理影响 |
| npm/Python package registry | 构建依赖安装 | 新构建失败 | 已有镜像可继续运行 |

Next/React、TanStack Query、Dexie/FlexSearch、Markdown/Shiki/KaTeX/Mermaid、FastAPI/SQLAlchemy/Alembic/psycopg 是构建/运行库，不是运行时第三方业务 API。

## 仓库未发现

| 类别 | 状态 |
| --- | --- |
| OpenAI/其他模型 API | 不适用；无生成 route、provider SDK、SSE/WebSocket |
| OAuth/外部登录 | 不适用；无认证依赖 |
| 支付/会员、邮件/短信 | 不适用 |
| 云厂商专有对象存储 | 未绑定；附件支持标准 S3-compatible adapter，默认仍为本地/volume |
| 解析 SaaS | 未发现；parser 在仓库内 |
| Sentry/OTel/analytics | 未发现；当前仅应用/容器日志 |

“未发现”只表示当前仓库与可见配置；生产基础设施可能另有 CDN、WAF、VPN、备份或监控服务，需要独立运维文档确认。

King 的 2 GiB 主机不运行 ClamAV 病毒库、Office 转换、OCR 或视频转码。`ATTACHMENT_SCANNER=disabled` 只表示部署策略允许未扫描附件进入单用户工作流，不表示文件安全；主动内容保持下载/隔离降级。
