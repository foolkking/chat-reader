# 生产 HTTP 只读记录

日期：2026-07-26
目标：`https://chat.king.2bd.net`
安全：未记录 Cookie、token、真实 ID、标题或正文。

## 页面与静态入口

| 路径 | 方法 | 状态 | 摘要 |
| --- | --- | --- | --- |
| `/` | GET | 200 | Next 页面；`Cache-Control: no-cache, no-store, must-revalidate` |
| `/archived` | GET | 200 | 归档页面 |
| `/recent` | GET | 200 | 最近页面路由存在 |
| `/search` | GET | 200 | 搜索页面 |
| `/library` | GET | 200 | 离线资料库入口 |
| `/offline` | GET | 200 | 连接失败静态页 |
| `/library/manifest.webmanifest` | GET | 200 | `start_url=/library`, `scope=/library`, display standalone |
| `/library-sw.js` | GET | 200 | library scope Service Worker |
| `/sw.js` | GET | 200 | 旧 root worker 清理脚本 |

响应 `Server` 标识为 Nginx。未记录任何生产 TLS 私钥、证书内容或配置值。

## API

| 路径 | 状态 | 脱敏响应事实 |
| --- | --- | --- |
| `/api/health` | 200 | JSON 包含 `status`, `service`, `stage` |
| `/api/conversations?scope=all&limit=1` | 200 | 数组；项目/标题/ID 值未保存；字段包括列表标题、摘要、Project、offline revision、状态、置顶和最近阅读 |
| `/api/projects` | 200 | 数组；核验时返回 2 条，名称/ID 未保存 |
| `/api/offline/catalog` | 200 | 包含 revision/generated_at/estimated_bytes/conversations/projects；核验时 catalog 各含 1 个可下载对象 |
| `/api/preferences` | 200 | 包含主题、语言、阅读宽度、章节 TOC、列表排序及时间字段 |
| `/api/openapi.json` | 404 | 生产同源路径没有暴露 FastAPI schema；接口清单由本地 `app.openapi()` 生成 |

以上仅是核验时快照，数量不是产品常量。

