# 已知风险与不确定性

最后核验：2026-08-16

已解决问题和实施过程保留在 [execution/](../execution/README.md)，本页只维护当前仍成立的风险。

## Release K current verification reconciliation

| ID | Current item | Classification | Current evidence / owner |
| --- | --- | --- | --- |
| K-001 | Real Chrome page zoom 125%, 150% and 200% | `CURRENT_VERIFICATION_DEBT` (3 records) | Fresh continuation-session discovery found no allowed Chrome control tool or MCP browser resource/template; product failure is not established. |
| K-002 | Production Mermaid renderer | `CURRENT_VERIFICATION_DEBT` | Strict-mode CI passes, but no later production Mermaid fixture supersedes the Release A gap. |
| K-003 | DOCX/ODT, XLSX/ODS and PPTX/ODP browser-Worker Viewers | `CURRENT_VERIFICATION_DEBT` (3 records) | Current capability exists; ZIP has production evidence, but these three Viewer groups do not. |
| K-004 | Idle worker heartbeat and protected internal diagnostics | `DEFERRED_BY_DESIGN` | Owned by Release L; not a Release K product defect. |
| K-005 | Automatic cleanup | `DEFERRED_BY_DESIGN` | Disabled; owned by Release N. Release J manual first apply remains PASS. |
| K-006 | Strict nonce CSP and CSP reporting | `DEFERRED_BY_DESIGN` | Owned by Release O; Release H enforcing CSP remains PASS. |
| K-007 | AssetObject GC, Turbopack and real-device storage variance | `CONDITIONAL_FUTURE_TRACK` | No current defect or unconditional Release K gate. |

Historical RA/RB rows below retain their original checkpoint meaning. Later
Release evidence closes active-unreferenced visibility, delete/undo, Share
focus, exact narrow reflow, production chooser, PWA negative paths and `.cr v4`
round trip. They are not current debt. The current count is
`CURRENT_VERIFICATION_DEBT_COUNT = 7`; unknown/unclassified records are zero.

| ID | 风险/不确定性 | 影响 | 当前控制/验证方式 |
| --- | --- | --- | --- |
| KI-001 | 应用没有认证或多用户 ACL | 公网管理 API 可能被未授权访问 | 反向代理/VPN/访问网关必须限制；代码层若引入 auth 需整体设计 |
| KI-002 | 单个阅读轮次可包含极大正文 | 完整正文数据仍占内存，动态 block 测量也有成本 | >160 blocks 或 >50000 chars 时虚拟化 DOM；直达 URL、批注、下滑刷新 fixture 持续回归 |
| KI-003 | 有效生产 Share 访客页未在文档中保存可复用 token | 生产访客视觉/范围无法由文档直接重放 | 使用隔离测试 token 复验，绝不记录真实 token |
| KI-004 | 浏览器 quota、持久化许可和 cache eviction 因设备而异 | 离线更新/冷启动可能失败 | Release E adds deterministic Chromium quota/cache/IndexedDB negative coverage, explicit unavailable states and old-package preservation. Real device/browser eviction variance remains an operational compatibility risk. |
| KI-005 | 生产 TLS、证书、访问控制和完整代理配置在仓库外 | 仓库无法证明安全和续期状态 | 运维侧单独审计；仓库只维护 HTTP 示例 |
| KI-006 | 仓库没有集中式监控/APM/告警 | worker 卡死或磁盘/错误趋势可能晚发现 | health、job heartbeat、容器日志；生产应外接监控 |
| KI-007 | 当前工作树包含未提交功能与文档改动 | Git HEAD 不能代表完整部署源 | 发布使用显式 manifest/哈希并记录 dirty 状态；提交前审查 diff |
| KI-008 | 生产 OpenAPI 未经同源 `/api/openapi.json` 暴露 | 外部调试和 schema 发现不便 | 受控环境用 `app.openapi()`；不将 404 解释为 API 缺失 |
| KI-009 | 单个超大 conversation 的 preview/commit 仍会形成完整 Draft 对象 | 峰值 Python 内存仍随单 conversation 增长 | CanJSON 逐行解析和 Draft 流式落盘已降低重复峰值；10,000-message 压测仍需持续记录 |
| KI-010 | 流式导出事件在响应完全消费前写入 | 客户端中断下载时审计事件仍可能显示已导出 | 当前视为“请求已开始”事件；若需严格完成语义，应在异步 artifact 任务中记录完成事件 |
| KI-011 | King 单用户部署主动关闭附件恶意软件扫描和内容安全审查 | `scanner_disabled`/`unscanned` 文件没有经过安全检测 | 这是用户接受的部署策略；UI 明确显示“未扫描”，附件功能正常使用，数据完整性校验继续执行 |
| KI-012 | Office/OCR/CAD/复杂压缩包预览未实现 | 用户只能下载原文件，无法站内查看复杂内容 | 明确 `NOT_IMPLEMENTED`，不在主服务器运行重型转换；基础上传、插入、Range 和浏览器预览不受阻 |
| KI-013 | King 原机 Web 构建会触发 OOM | PostgreSQL checkpointer 可能被杀并进入 WAL 恢复 | 禁止在 King 编译 Next 镜像；改用 CI/独立 Linux 构建机和 registry 或 `docker save/load`。本轮恢复后 dump 已校验 |
| KI-014 | 2026-08-08 附件呈现与任务清单已部署，但请求的 Chrome 扩展验收连接不可用 | 服务健康和路由检查不能替代生产 CSS、最终 DOM 与真实交互体验 | 应用继续运行已发布镜像；Chrome 扩展恢复连接后验证有界 Viewer、附件正文策略和任务 checkbox，再将该项关闭 |
| KI-015 | 2026-08-09 统一 Attachment Viewer 合同仅完成本地自动化验证 | 真实多格式文件的视觉、codec、PDF worker、长 Markdown 与移动端体验尚不能标为生产 PASS | 使用外部 Linux 镜像部署后，在隔离测试对话执行 Chrome 逐类型验收；默认矩阵跳过项保持 `PARTIAL_PASS` |

## 验证边界

- 2026-07-29 的生产健康、migration、Reader 和离线 TOC 结论是发布时快照，不保证之后未变化。
- 导入、删除、冲突、Share token 和数据恢复等破坏性/敏感流程应使用隔离数据，不能在唯一生产资料上试验。
- 文档不保存真实会话数量、标题、正文、批注内容、ID、token 或凭据；需要诊断时使用脱敏标识。
## 2026-08-10 Release-Readiness Findings

| ID | Risk / uncertainty | Current control / required closure |
| --- | --- | --- |
| RA-001 | Historical acceptance evidence showed active zero-current-occurrence rows missing from the Files Panel. | Root cause audit confirmed explicit `detached` status is the only exclusion; API now exposes `current_occurrence_count` and lifecycle regression tests preserve active/unreferenced semantics. Production recheck after this code release remains `NOT_PRODUCTION_VERIFIED`. |
| RA-002 | Historical Web delete-undo toast did not restore the dedicated QA message and gave no failure feedback. | Delete/restore now return post-commit revision; Web keeps a retryable restore state and API restore is idempotent. Local API/build verification PASS; production browser recheck remains `NOT_PRODUCTION_VERIFIED`. |
| RA-003 | Historical first insertion after conversation creation used an obsolete revision until manual refresh. | Create response now seeds the canonical conversation cache and insert applies the response revision. Online browser flow remains flag-gated and is not yet production-verified. |
| RA-004 | Historical dialog/viewer focus restoration and duplicate backdrop close controls blocked keyboard sign-off. | Shared `useDialogFocus` migrated to managed dialogs; backdrop is pointer-only/aria-hidden and one visible close remains. Local compile/contract checks PASS; full keyboard browser sign-off remains pending. |
| RA-005 | 360px, 125/150/200% zoom, production chooser, negative Offline faults and QA `.cr v4` restore were not safely completed. | Keep `NOT_PRODUCTION_VERIFIED`; do not promote conditional skips to PASS. |
| RB-001 | Filesystem and PostgreSQL cannot be one physical transaction. | Release B protects canonical references with stage -> validate -> publish -> outer commit -> cleanup. Crashes can leave `SAFE_TEMP`, `ORPHAN_FINAL` or `SUPERSEDED_ARTIFACT` cleanup debt; only a dry-run classifier exists. Automatic cleanup is `NOT_IMPLEMENTED`. |
| RB-002 | Actual production Chrome Share Drawer focus verification is pending because Chrome was not running during final deployment. | Production-equivalent E2E asserts `document.activeElement` for Esc/X/backdrop and remounted-trigger fallback. Production API/Offline/Export/Import QA passed, but this UI item remains `NOT_VERIFIED`; Release B is `PARTIAL_PASS`. |
| RB-003 | Dry-run reports four unreferenced final artifacts totaling 659,673 bytes. | They are cleanup debt, not canonical references. Automatic cleanup is `NOT_IMPLEMENTED`; no artifact was deleted. All 29 current/protected artifacts were classified `UNSAFE_PROTECTED`, never safe deletion candidates. |
