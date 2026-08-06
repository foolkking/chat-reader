# 执行偏差

| 编号 | 类型 | 规划/预期 | 实际处理 | 产品行为影响 |
|---|---|---|---|---|
| DEV-001 | 文档计数差异 | 摘要称约 46 项 | `EXECUTION_MANIFEST.md` 实际枚举 63 个唯一任务 ID；执行日志逐一记录 63 项 | 无 |
| DEV-002 | 路径差异 | 批注索引回填入口未指定确定路径 | 复用 Python module command，新增 `apps/api/scripts/backfill_annotation_search.py` | 无 |
| DEV-003 | 命令环境差异（已修复） | 根脚本直接调用 `pnpm` | 根 `package.json` 改为显式 `corepack pnpm`，README 中的根命令可直接执行 | 无 |
| DEV-004 | 执行覆盖修正 | OFL-01 原条目提及 schema/重新下载提示 | 按 EX-OVERRIDE-001 保持 Dexie version 1 和 stores 不变，不增加清库或重新下载流程 | 无，属于高优先级覆盖修正 |
| DEV-005 | Reader 加载模型最终覆盖 | 原封板文档保留 30 条 preview、heavy 懒加载和 block 分页 | 按 2026-07-28 用户最终计划改为最多 3 个完整轮次；新增 reader-turn API；删除占位、假高度和主阅读 block 分页 | 修复远距离定位和刷新恢复，不改变 canonical/DB schema |
| DEV-006 | 侧栏 IA 最终覆盖 | D-007 原决定保留对话/项目互斥标签 | 按用户后续明确要求改为 ChatGPT 式单层：Project 与未归类对话同时显示，支持双向拖放 | 改善拖放；路由和 Project 数据语义不变 |
| DEV-007 | Chrome 视口限制 | 请求 390x844 | Chrome capability 实际 CSS viewport 为 520x1126；另用 Playwright 精确覆盖 390x844 | 无；两种断点均无横向溢出 |
| DEV-008 | 离线包协议最终覆盖 | 原执行锁要求 offline package v1 不变 | 按后续用户明确要求升级写协议为 conversation-delta v2，浏览器读取兼容 v1/v2；数据库和 Dexie schema 不变 | 项目/全库更新不再传输或重写未变化 conversation |
| DEV-009 | 离线侧栏最终覆盖 | 原 Library 保留对话/项目互斥标签和内嵌偏好面板 | 按用户最终要求与在线 IA 对齐为项目树 + 未归类列表，并使用共用紧凑偏好弹层；离线入口反向返回在线版 | 不改变离线数据和路由语义，消除列表挤压与重复入口 |

没有自行接受的产品行为偏差，也没有需要用户确认的偏差。

## 2026-07-28 执行事件

| 编号 | 类型 | 预期 | 实际处理 | 产品行为影响 |
|---|---|---|---|---|
| DEV-010 | 生产构建事件 | Docker 顺序构建且服务持续可用 | 停滞的 Docker 客户端诊断期间 daemon 重启；立即恢复 PostgreSQL、migration 和应用容器，重新核对 head、健康检查、镜像和日志后继续发布 | 无数据或产品行为变化；有效 dump 和回滚镜像均在事件前完成 |
| DEV-011 | 本轮浏览器验收阻塞（已关闭） | 部署后使用用户指定 Chrome 点击复验 | 首次扩展通信通道不可用；用户授权后恢复 Chrome 会话并完成生产点击复验。复验还发现离线 TOC 时间戳不一致，补丁后再次点击确认已清理 | 无；本轮验收已完成，详见 `TEST_RESULTS.md` |
| DEV-012 | 生产复验发现离线预览差异（已修复） | 离线 TOC 与在线版使用同等预览语义 | 离线数据源原先只做字符替换，未移除正文首行时间戳；移植在线端的逐行 Markdown/时间戳清洗规则，使用单文件 Web 补丁发布，既有 Dexie 数据无需重新下载 | 离线 TOC 文案与在线版一致；API、worker、数据库无变化 |
| DEV-013 | 低内存构建事件（已恢复） | 仅重建 Web 且其他服务持续可用 | Docker 构建在 1.8 GiB 主机上触发全局 OOM，API、worker、旧 Web 和同机部分服务被回收；停止继续切换，逐项确认 PostgreSQL未重启、应用及同机服务恢复，再完成 Web 切换、HTTPS/Chrome 复验和缓存清理 | 无数据或格式变更；记录事件并要求后续生产构建使用远端构建机或先停用非关键构建负载 |
