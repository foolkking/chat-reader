# 事实证据索引

最后核验日期：2026-07-26
线上版本：`e752e9ddf25595c3f373977a1803956354ca71b0`

截图记录线上现状，不包含改进稿。生产会话标题、正文、标识符和 Share token 均不写入文本索引；图片中的主要私有内容区域已遮挡。

## 截图索引

| 编号 | 文件 | 页面/状态 | URL | 视口 | 身份 | 前置条件和事实 | 日期 | 脱敏 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PAGE-001 | [首页](screenshots/PAGE-001-home-main-desktop-redacted.png) | 在线主页面 | `/` | 1440x900 | 本地资料拥有者 | 直接访问；侧栏、对话/Project 标签和列表框架 | 2026-07-26 | 是 |
| PAGE-002 | [导入对话框](screenshots/PAGE-002-import-dialog-desktop-redacted.png) | 导入入口 | `/` | 1440x900 | 同上 | 打开导入；文件类型、多文件、预览/提交入口 | 2026-07-26 | 是 |
| PAGE-003 | [偏好](screenshots/PAGE-003-preferences-desktop.png) | 外观与语言 | `/` | 1440x900 | 同上 | 打开设置；主题、语言、阅读宽度 | 2026-07-26 | 是 |
| PAGE-004 | [Project](screenshots/PAGE-004-project-view-desktop-redacted.png) | Project 详情 | `/projects/[redacted]` | 1440x900 | 同上 | 从 Project 树进入；列表与选择入口 | 2026-07-26 | 是 |
| PAGE-005 | [归档](screenshots/PAGE-005-archived-desktop-redacted.png) | 归档管理 | `/archived` | 1440x900 | 同上 | 侧栏进入；归档列表 | 2026-07-26 | 是 |
| STATE-001 | [归档选择](screenshots/STATE-001-archived-selection-mode-redacted.png) | 选择模式 | `/archived` | 1440x900 | 同上 | 开启选择；全选、反选、清空、完成 | 2026-07-26 | 是 |
| PAGE-006 | [搜索空态](screenshots/PAGE-006-search-empty-desktop-redacted.png) | 全局搜索 | `/search?q=[synthetic]` | 1440x900 | 同上 | 使用无匹配合成查询；筛选与空结果 | 2026-07-26 | 是 |
| PAGE-007 | [在线 Reader](screenshots/PAGE-007-reader-desktop-redacted.png) | 长对话阅读 | `/conversations/[redacted]` | 1440x900 | 同上 | 打开已有对话；侧栏、正文、章节 TOC、操作轨 | 2026-07-26 | 是 |
| PAGE-008 | [批注工作区](screenshots/PAGE-008-annotations-workspace-desktop-redacted.png) | 批注浮窗 | 同上 | 1440x900 | 同上 | 打开批注；三个视图、筛选、拖动/缩放边界 | 2026-07-26 | 是 |
| STATE-002 | [批注管理](screenshots/STATE-002-annotation-manage-desktop-redacted.png) | 批注管理模式 | 同上 | 1440x900 | 同上 | 开启管理；全选、反选、清空、批量样式/笔记/删除 | 2026-07-26 | 是 |
| PAGE-009 | [Share](screenshots/PAGE-009-share-panel-desktop-redacted.png) | 分享面板 | 同上 | 1440x900 | 同上 | 打开 Share；scope、有效期、可选私有内容与管理项 | 2026-07-26 | 是 |
| PAGE-010 | [资料库](screenshots/PAGE-010-library-desktop-redacted.png) | 离线资料管理 | `/library` | 1440x900 | 同上 | 直接进入；壳状态、下载/删除、空间信息 | 2026-07-26 | 是 |
| PAGE-011 | [离线 Reader](screenshots/PAGE-011-library-reader-desktop-redacted.png) | 资料库阅读 | `/library?conversationId=[redacted]` | 1440x900 | 同上 | 打开本地副本；共享 Reader 框架和在线版入口 | 2026-07-26 | 是 |
| PAGE-012 | [移动首页](screenshots/PAGE-012-home-mobile-redacted.png) | 在线首页 | `/` | 390x844 | 同上 | 窄屏；正文不横向溢出 | 2026-07-26 | 是 |
| PAGE-013 | [移动侧栏](screenshots/PAGE-013-sidebar-sheet-mobile-redacted.png) | 侧栏 Bottom Sheet | `/` | 390x844 | 同上 | 打开导航；对话/Project 标签 | 2026-07-26 | 是 |
| PAGE-014 | [移动 Reader](screenshots/PAGE-014-reader-mobile-redacted.png) | 在线阅读 | `/conversations/[redacted]` | 390x844 | 同上 | 打开已有对话；无桌面 rail/separator | 2026-07-26 | 是 |
| STATE-003 | [移动操作轨](screenshots/STATE-003-reader-actions-mobile-redacted.png) | Reader actions 展开 | 同上 | 390x844 | 同上 | 展开更多；触发点与关闭按钮位置一致 | 2026-07-26 | 是 |
| PAGE-015 | [移动阅读导航](screenshots/PAGE-015-reader-navigation-mobile-redacted.png) | 对话/章节 TOC Sheet | 同上 | 390x844 | 同上 | 反复切换两个 TOC；未复现空 TOC | 2026-07-26 | 是 |
| PAGE-016 | [移动离线 Reader](screenshots/PAGE-016-library-reader-mobile-redacted.png) | 资料库阅读 | `/library?conversationId=[redacted]` | 390x844 | 同上 | 本地副本；在线版入口，无桌面 separator | 2026-07-26 | 是 |
| STATE-004 | [连接失败](screenshots/STATE-004-offline-status-desktop.png) | 静态错误页 | `/offline` | 1440x900 | 任意 | 直接访问；网络检查与重试 | 2026-07-26 | 不含私有数据 |
| STATE-005 | [对话不可用](screenshots/STATE-005-reader-not-found-desktop-redacted.png) | 无效资源 | `/conversations/[synthetic-invalid-id]` | 1440x900 | 本地资料拥有者 | 使用合成 UUID；显示不可用状态 | 2026-07-26 | 是 |

## 请求与运行记录

| 编号 | 文件 | 操作 | 脱敏结果 | 关联事实 |
| --- | --- | --- | --- | --- |
| HTTP-001 | [PRODUCTION_HTTP_2026-07-26.md](request-records/PRODUCTION_HTTP_2026-07-26.md) | 只读 GET/HEAD | 路径、状态、键名 | 线上入口、API schema、缓存头 |
| API-001 | [LOCAL_OPENAPI_2026-07-26.md](request-records/LOCAL_OPENAPI_2026-07-26.md) | 本地 `app.openapi()` | 67 paths / 79 operations | API 清单 |
| PROD-RUNTIME-001 | [PRODUCTION_RUNTIME_2026-07-26.md](request-records/PRODUCTION_RUNTIME_2026-07-26.md) | King SSH 只读检查 | commit、服务状态、migration；无配置值 | 部署事实 |

## 安全规则

- 不保存 Cookie、Token、密钥、密码或真实环境变量值。
- 不保存未脱敏的私密聊天正文、真实 ID、项目名或分享地址。
- 请求记录只保存方法、路径模板、状态、响应字段和脱敏计数。
- 后续新增证据需在本页登记，并注明视口、身份、日期和脱敏状态。

