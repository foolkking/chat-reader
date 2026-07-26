# King 生产运行只读记录

日期：2026-07-26
路径：`/opt/chat-reader`
执行性质：仅查看 Git、Compose、migration 与 health 状态；未 pull、build、restart、写配置或修改数据。

## 结果

- Git branch：`master`。
- Git commit：`e752e9ddf25595c3f373977a1803956354ca71b0`，与本地相同。
- 工作树：只有生产既有未跟踪目录 `backups/`；未触碰。
- Compose：API healthy，Web healthy，PostgreSQL healthy，import worker running。
- Alembic：`20260724_0015 (head)`。
- 服务器本机 `http://127.0.0.1:3000/api/health` 成功。
- 公网 HTTPS 入口成功，Nginx 在前置代理位置。

未记录 `.env.production` 内容、数据库凭据、备份文件名、volume 数据或用户数据。

