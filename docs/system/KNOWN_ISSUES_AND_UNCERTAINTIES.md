# 已知风险与不确定性

最后核验：2026-08-06

已解决问题和实施过程保留在 [execution/](../execution/README.md)，本页只维护当前仍成立的风险。

| ID | 风险/不确定性 | 影响 | 当前控制/验证方式 |
| --- | --- | --- | --- |
| KI-001 | 应用没有认证或多用户 ACL | 公网管理 API 可能被未授权访问 | 反向代理/VPN/访问网关必须限制；代码层若引入 auth 需整体设计 |
| KI-002 | 单个阅读轮次可包含极大正文 | 完整正文数据仍占内存，动态 block 测量也有成本 | >160 blocks 或 >50000 chars 时虚拟化 DOM；直达 URL、批注、下滑刷新 fixture 持续回归 |
| KI-003 | 有效生产 Share 访客页未在文档中保存可复用 token | 生产访客视觉/范围无法由文档直接重放 | 使用隔离测试 token 复验，绝不记录真实 token |
| KI-004 | 浏览器 quota、持久化许可和 cache eviction 因设备而异 | 离线更新/冷启动可能失败 | 原子 staging/transaction、旧数据保留；补充真实设备矩阵 |
| KI-005 | 生产 TLS、证书、访问控制和完整代理配置在仓库外 | 仓库无法证明安全和续期状态 | 运维侧单独审计；仓库只维护 HTTP 示例 |
| KI-006 | 仓库没有集中式监控/APM/告警 | worker 卡死或磁盘/错误趋势可能晚发现 | health、job heartbeat、容器日志；生产应外接监控 |
| KI-007 | 当前工作树包含未提交功能与文档改动 | Git HEAD 不能代表完整部署源 | 发布使用显式 manifest/哈希并记录 dirty 状态；提交前审查 diff |
| KI-008 | 生产 OpenAPI 未经同源 `/api/openapi.json` 暴露 | 外部调试和 schema 发现不便 | 受控环境用 `app.openapi()`；不将 404 解释为 API 缺失 |
| KI-009 | 单个超大 conversation 的 preview/commit 仍会形成完整 Draft 对象 | 峰值 Python 内存仍随单 conversation 增长 | CanJSON 逐行解析和 Draft 流式落盘已降低重复峰值；10,000-message 压测仍需持续记录 |
| KI-010 | 流式导出事件在响应完全消费前写入 | 客户端中断下载时审计事件仍可能显示已导出 | 当前视为“请求已开始”事件；若需严格完成语义，应在异步 artifact 任务中记录完成事件 |
| KI-011 | King 单用户部署主动关闭附件恶意软件扫描和内容安全审查 | `scanner_disabled`/`unscanned` 文件没有经过安全检测 | 这是用户接受的部署策略；UI 明确显示“未扫描”，附件功能正常使用，数据完整性校验继续执行 |
| KI-012 | Office/OCR/CAD/复杂压缩包预览未实现 | 用户只能下载原文件，无法站内查看复杂内容 | 明确 `NOT_IMPLEMENTED`，不在主服务器运行重型转换；基础上传、插入、Range 和浏览器预览不受阻 |
| KI-013 | King 原机 Web 构建会触发 OOM | PostgreSQL checkpointer 可能被杀并进入 WAL 恢复 | 禁止在 King 编译 Next 镜像；改用 CI/独立 Linux 构建机和 registry 或 `docker save/load`。本轮恢复后 dump 已校验 |

## 验证边界

- 2026-07-29 的生产健康、migration、Reader 和离线 TOC 结论是发布时快照，不保证之后未变化。
- 导入、删除、冲突、Share token 和数据恢复等破坏性/敏感流程应使用隔离数据，不能在唯一生产资料上试验。
- 文档不保存真实会话数量、标题、正文、批注内容、ID、token 或凭据；需要诊断时使用脱敏标识。
