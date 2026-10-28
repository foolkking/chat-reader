# 已知风险与不确定性

## Current verification boundaries — 2026-10-29

Use [Project State](../../PROJECT_STATE.md) and the
[current release record](../execution/SEARCH_RECOVERY_RELEASE_2026-10-28.md)
for exact source/CI/artifact/backup and production acceptance. Runtime/direct
rollback is `f8a6a06`/`b4effda`, schema `20261022_0053`; all five exact-source CI
jobs, independent artifact acceptance and the stopped-writer deployment/
operational recheck passed. No local application suites/build/browser/services/
database validated this release. Earlier uncommitted/no-deployment statements
below describe their own checkpoints, not the current runtime.

- CI and health/privacy checks do not establish authenticated production UI,
  physical clipboard, screen-reader behavior or sustained-load acceptance.
- Same-runtime failed-delete intent is not crash/forced-reload durable.
  Bounded Office previews are not full-fidelity or hostile-document certification.
- Noise protection remains bounded recognition with the limitations below;
  a passing corpus is not exhaustive Markdown/AI-adapter parity or an
  unmeasured performance guarantee.
- The new five-component backup is verified, not restore-drill accepted.
  Server-local points may share hardlinks; independent off-site recovery and
  scheduled backups remain unconfigured. Future releases need fresh capacity.

## Historical local verification checkpoint — 2026-10-14

The following limitations describe only the local verification checkpoint on
2026-10-14. They are retained for provenance and must not be read as current
defects, current source state, or production verification. The older snapshots
below likewise do not define current debt or deployment state.

| Limitation recorded at that checkpoint | Control / next step recorded then |
| --- | --- |
| Local Web start is rejected before process creation; cause unknown | Preserve the original rejection and fixture; no alternate launcher. Isolated CI is separate from specified-Chromium local acceptance. |
| Local personal-archive callback/limit-read repair has no browser acceptance | All 926 Node checks (36 archive-specific), lint and nonincremental types pass. Three browser files discover 19, execute zero. Controlled authentication/DOM scheduling is not real navigation or rendered-focus evidence; two new screenshots remain planned. Server restore/ownership and Root system archive are unchanged. No new build, CI or deployment. |
| Local task-status final-read recovery has no browser acceptance | 890 Node checks, lint and nonincremental types pass, including 22 task-specific cases. Three browser files discover 24, execute zero. Pending result checks are per-mounted-monitor in memory, not durable across reload. No additional polling frequency, automatic task mutation, CI or deployment. |
| Local offline-resource/share-read repairs have no browser acceptance | All 868 Node checks, lint and nonincremental types pass, including 20 new focused checks. Two affected browser files discover 26 cases, executed zero. In-app local navigation returned `ERR_CONNECTION_REFUSED`; user asked to proceed without login. No new build, CI or deployment. Existing cached-response size validation remains unchanged. |
| Local annotation/CSV, write/composition and notebook label/queue follow-up has no new browser, visual or screen-reader acceptance | Production 84988a2 is accepted through CI 38255213036 and independent deployment checks. Newer local repairs pass 848 Node checks, lint/types and a one-worker/1024 MiB heap build; 54 browser cases are discovered only. Comment and unknown-write state is scoped in memory, not persistent across route changes/reload. Queue tests use explicit storage-latency doubles, not device CPU/RSS measurements. New CI/deployment requires the user's explicit request. |
| Task temporary logs/archives disappeared during the composition checkpoint for an undetermined reason | Repository ledgers remain unchanged; fresh local verification logs are retained in repository evidence. Earlier raw temporary logs and the previously retained local archive copies can no longer be claimed available. This is separate from the two precisely verified duplicate removals recorded before the disappearance. |
| King has about 2 GiB RAM | Never build images there; keep PostgreSQL running and bound one-off release checks. |
| King Compose 2.27 rejects `run --pull never`; `start` may require absent migrate dependencies | Validate a release-only `pull_policy: never` overlay and mounted checks before stopping writers. Guard recovery by migration marker and exact old identities; preserve the actual interruption record. |
| Dependency policy retains an approved braces exception | Keep its existing mitigation, scope and expiry; a passing policy is not zero advisories. |
| SMTP is unconfigured in the verified production snapshot | Email delivery is unavailable; administrator reset links remain. |
| Backups are server-local; identical components may share hardlinks | Two verified logical points are not independent physical copies; no off-site/scheduled backup is configured. |
| Device quota/eviction and malware risk vary | Retain offline-copy recovery; integrity checks do not replace the deliberately disabled malware scanner. |
| Broader production interaction/external-model behavior is unverified | Do not infer it from health checks, isolated CI or static Skill ZIP checks. |

## Current verification boundaries — 2026-10-27

This stable heading retains the original local-only noise-review checkpoint.
Its uncommitted/acceptance-limit statements are historical; read the
[2026-10-29 boundaries](#current-verification-boundaries--2026-10-29) above for
later CI and production acceptance. The semantic limitations below remain;
SHA-pinned source contracts alone are not a fresh remote CI result.

### Noise matching

- Protection remains bounded source recognition, not a full Markdown parser or
  exhaustive CommonMark/GFM/AI-adapter implementation. Earlier matrices and
  test counts describe their own dated checkpoints, not current full-suite or
  production error-rate evidence.
- Reviewed dollar-math scope/width, multiline single-dollar math, link-title
  delimiter ownership and HTML flow code fallback are corrected. A shared small
  fixture checks the actual app plugins/projection and backend decisions in
  LF/CRLF, plus normal and legacy scan/apply source persistence.
- Bare-bracket display recovery currently covers standalone pairs containing a
  recognized LaTeX command and not overlapping already protected syntax. Other
  frontend recovery forms (including bare parentheses/command-free expressions)
  are not fully mirrored. Source-changing display-math normalization and
  inherited block profiles are not exhaustively mapped by this fixture.
- Inline HTML remains visible text, not blanket-protected code. Unsupported
  HTML flow is protected as the application's literal code fallback. Only a
  conservative simple supported box-layout subset is exempt: ambiguous code,
  indentation, large inputs or unsupported/malformed markup retain extra
  protection. This favors safety over claiming projection equivalence.
- Existing conservative malformed-reference, attachment-label, field/example
  and container-prefix/newline protection can exceed native node spans. A
  protected candidate requires explicit review; ordinary classification is not
  proof of absence from every possible extension syntax. Preview exact source.
- The #36 monotonic provenance optimization is withdrawn after sparse synthetic
  whole-detection regressions (construction included). Source mapping still
  computes the smallest contiguous raw envelope, including reordered marks.
  Dense lookup gains alone do not justify a global speed claim. Remaining
  indexing/tokenization changes also have setup costs; no universal latency,
  RSS, complexity or OOM guarantee is made.

See [review-fix validation and remaining limits](../execution/ux-audit-noise-matching-2026-10-25.md#37-review-fixes-and-application-renderer-contract--2026-10-27).
All preceding corpus sizes, timing controls and immutable receipts live in that
dated execution record; they are not repeated here as current acceptance.

### Acceptance limits

No new production access/deployment, authenticated browser UI, physical
clipboard, screen-reader or sustained-load acceptance is claimed. Local SSR
is not browser acceptance; scoped SQLite tests are not PostgreSQL concurrency,
Share/PWA or complete API validation. The earlier interrupted full API run is
not a pass, and its import-fixture failures have not all been attributed.
The temporary-disk interruption was recovered after the user freed space.
Scoped modular regression completed; the extra artifact-cleanup symlink test
was skipped because Windows could not create a symlink. That capability remains
unverified. Interrupted runs remain historical, not passes; the agent did not
execute the denied temporary-directory cleanup.
The October 14 rows above remain historical, not freshly reproduced defects.

## Current verification boundaries — 2026-10-26

This heading is retained only as a stable link for older documents. Read the
[reconciled 2026-10-27 boundaries](#current-verification-boundaries--2026-10-27)
above; historical checkpoint details remain in the dated execution record.

## Historical status (2026-09-02)

Release K production verification, Release L worker liveness and protected
diagnostics, Release M disaster recovery, Release N single-owner
authentication, the final product audit and the later scoped formula/source
position fixes are closed. The historical Release K reconciliation below is a
checkpoint record, not current debt. The deployed snapshot contains the
multi-account owner boundary and migration `20260901_0030`; authenticated
production browser acceptance remains pending. Current deferred decisions are
automatic artifact cleanup and strict nonce CSP/reporting
by product decision; AssetObject GC, capacity optimization and Turbopack remain
conditional future work. None is an active defect in the deployed snapshot.

最后核验：2026-09-02

已解决问题和实施过程保留在 [execution/](../execution/README.md)，本页只维护当前仍成立的风险。

## Historical Release K verification reconciliation

| ID | Current item | Classification | Current evidence / owner |
| --- | --- | --- | --- |
| K-001 | Real Chrome page zoom 125%, 150% and 200% | `HISTORICAL_CHECKPOINT` | Retained as the original Release K reconciliation; later release evidence and the final product audit supersede its debt classification. |
| K-002 | Production Mermaid renderer | `HISTORICAL_CHECKPOINT` | Retained as the original Release K reconciliation; strict-mode coverage and later product audit evidence supersede its debt classification. |
| K-003 | DOCX/ODT, XLSX/ODS and PPTX/ODP browser-Worker Viewers | `HISTORICAL_CHECKPOINT` | Retained as the original Release K reconciliation; later scoped viewer evidence and final product audit supersede its debt classification. |
| K-004 | Idle worker heartbeat and protected internal diagnostics | `DEFERRED_BY_DESIGN` | Owned by Release L; not a Release K product defect. |
| K-005 | Automatic cleanup | `DEFERRED_BY_PRODUCT_DECISION` | Disabled; manual review/apply remains the current contract. |
| K-006 | Strict nonce CSP and CSP reporting | `DEFERRED_BY_PRODUCT_DECISION` | The current CSP contract remains unchanged; no active hardening track is planned. |
| K-007 | AssetObject GC, Turbopack and real-device storage variance | `CONDITIONAL_FUTURE_TRACK` | No current defect or unconditional Release K gate. |

Historical RA/RB rows below retain their original checkpoint meaning. Later
Release evidence closes active-unreferenced visibility, delete/undo, Share
focus, exact narrow reflow, production chooser, PWA negative paths and `.cr v4`
round trip. They are not current debt. The current count is
`CURRENT_VERIFICATION_DEBT_COUNT = 0`; unknown/unclassified records are zero.

| ID | 风险/不确定性 | 影响 | 当前控制/验证方式 |
| --- | --- | --- | --- |
| KI-001 | 工作树多账户 migration 尚未发布 | 生产仍运行历史单 owner snapshot；工作树账号能力尚未获得生产数据迁移证据 | `20260901_0030`、聚焦 API 测试和源码隔离已完成；生产备份/migration/认证浏览器验收仍为 `NOT_VERIFIED` |
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
