# 本地系统优化审查与撤销记录 — 2026-10-24

## 范围与结论

用户要求审查已做改动、撤销不必要实现，并将庞大候选池收敛为合理计划。
本次不再开展持续优化、不提交、不触发 CI、不部署。当前事实见
[精简计划](../system/CONTINUOUS_OPTIMIZATION_BACKLOG.md)和
[Project State](../../PROJECT_STATE.md)。

- 原 20 项完成记录：15 项保留，#130 修正，#4/#121/#122/#6 四项撤销。
- #4/#121/#122 共属发布文档检查器一组：删除其 JSON、脚本、专属测试及 CI/命令接线；
  不撤销已纠正的生产文档事实，不改变现有发布质量门禁。
- #6 恢复原数据库健康辅助函数及健康测试；原函数没有生产调用证据，
  不为未出现的使用场景调整异常语义。
- #130 继续保护历史错误读取，补充固定附件/图片/扫描器/下载恢复消息的精确白名单。
  写入分类器→实际持久化任务→任务详情/列表回归在修复前 **18 失败 / 51 通过**；
  动态 provider 值、附加路径/SQL/私有后缀继续回退为安全信号。
- 原 111 项未处理候选中移出 108 项，只留 #135、#120 两项有界后续核查及
  #133 条件只读观察。移出不是修复，也不再维护旧候选矩阵副本。
- 原 4 项 no-change 决策不改。保留的生产实现和本轮无关工作不做重置。

下方保留原 20 项实施记录和 4 项 no-change 记录，供追溯旧验证、失败及限制。
其中 #4/#121/#122/#6 的实现已经撤销，#130 以上述兼容修正为准。
旧记录中的检查器路径、9 项 CI 工具结果和“下一项”仅描述当时，
不是当前存在的命令、当前测试数量或新的执行授权。

## 本次执行与验证

- **最小修正：** `app/services/task_errors.py` 只向现有精确集合增加 18 条经来源核对的
  固定消息，不新增框架或前缀放行。19 个 writer→持久化→REST 参数用例覆盖三类既有
  domain error（其中一条原已允许），另加 5 个附加私有文本/动态 provider 的负例。
  这些测试不是实际扫描器服务或图片处理资源测试。
- **API：201 通过、无跳过。** 运行
  `corepack pnpm run test:api`，选择 `test_health.py`、
  `test_task_error_projection.py`、`test_background_job_errors.py`、
  `test_tasks_api.py`、`test_import_task_results.py`、
  `test_import_analysis_queue.py`、`test_import_draft_streaming.py`、
  `test_cleanup_scan_lifecycle.py`、`test_conversation_management_api.py`，
  使用任务本地 `--basetemp` / `-o cache_dir`。覆盖恢复消息、隐私后缀拒绝、
  旧错误只读投影、导入事务保护、结果查询和删除兼容。
- **原 CI 工具：2 通过。** `corepack pnpm run test:ci-tools`，
  仍验证 changed-area 选择器始终要求完整发布 gate。
- **保留的交互专项：17 通过。**
  `node --test scripts/ux/code-copy-recovery.test.mjs scripts/ux/import-acknowledgement-copy.test.mjs`；
  分别为代码复制 8 项和导入提示 9 项，没有重新声称完整浏览器验收。
- **范围复核：** 发布工作流、`package.json`、数据库辅助函数及健康测试四个 tracked
  文件与 HEAD 无差异，三个新增检查器文件已移除；YAML 解析通过，原五个 job 不变。
  初始 49 个已有工作区文件的 SHA-256 对照中，31 个完全未改（包括预先存在的
  `tsconfig.tsbuildinfo`），18 个仅发生本轮批准的撤销/修正/文档调整；
  另新增历史记录和执行索引入口，没有重置其他实现。
- **文档：** 原 20 项实施和 4 项 no-change 记录正文的摘要保持一致，
  当前计划压缩为 51 行；本轮相关 13 个本地链接有效，差异空白检查通过。删除文件的具体路径只在
  明确标识的历史证据中保留。一次性范围脚本首次摘要比较误删前导空行，
  修正校验方式后通过，没有为通过检查而改写原始记录。
- **Migration：** `cd apps/api; python -m alembic heads` 仍只有
  `20261022_0053 (head)`，无新增 migration。

测试输入均为合成数据，临时文件和范围回执位于本任务独立的 `wkkk` 子目录。
本轮未改动 Web 产品源码，未重跑 lint/typecheck/build 或完整 E2E；
保留原测试回执但不把它们记为本轮重跑。未做 PostgreSQL 并发、生产账号、
真实剪贴板或生产资源验收，没有用户导入目录、生产数据或配置操作。

## 有界续办 #135 — 导入结果链接存活性

用户随后要求继续，本轮只处理原计划的 #135，不启动 #120 或条件观察 #133。

- **复现：** 真实删除 service 先提交 `status=deleted` / `deleted_at`，再执行硬删除。
  在首次提交后暂停级联，Reader 已返回 404，但任务详情、列表和导入状态仍返回该 ID。
  合成归属变化也会留下不可访问的结果链接。新用例修复前 **10 失败 / 2 通过**；
  两项归档正例原已通过，并非需要隐藏所有非 active 状态。
- **最小修复：** 只修改 `app/services/import_queue.py::conversation_ids_for_import`：
  committed 结果关联当前会话，使用现有 `OwnershipScope` 按导入 owner 排除归属不符、
  `status=deleted` 或非空 `deleted_at`；legacy 无 owner 导入只匹配无 owner 结果。
  保留事件 SQL 范围、ID-only 读取、稳定排序/去重、主结果优先及未提交 fast path。
  主结果若无对应事件，只补一次有界 ID 查询验证，不信任历史 FK。
- **收益：** 已不可读的主/次结果不再出现在导入任务链接和会话/消息总数中；
  归档结果和仍存活的批次结果不受影响，读取不修改历史或扩大账户访问范围。
- **专项：23 通过。** `corepack pnpm run test:api tests/test_import_task_results.py -q`
  使用任务本地 `--basetemp` / `-o cache_dir`。新增 12 项覆盖真实删除提交间隙、
  单独删除标记、归属变化、归档、普通/legacy owner 和全部不可用结果；
  原 11 项继续覆盖主会话真实 DELETE 的 SET NULL/CASCADE、旧主结果无事件、
  SQL ID-only 查询/四行而非全局历史、重复与稳定排序、未提交零事件查询。
- **相关回归：123 通过、无跳过。** 同一包命令合并运行上述专项以及
  `test_import_queue.py`、`test_tasks_api.py`、`test_conversation_management_api.py`、
  `test_ownership_scope.py`、三个 `test_canonical_persistence_{official,exporter,combo}.py`
  和 `test_auth.py`，共九个模块；123 已包含专项 23 项，不重复累计。
  新增 HTTP 用例使用既有 legacy-owner fixture，普通/无 owner 隔离另由实际查询用例验证。
- **范围复核：** 本次开始时 44 个工作区文件中 35 个逐字节未改；
  只改一个生产 service、一个测试文件和七个现有文档，未新增/删除文件。
  先前撤销的工作流/命令/健康实现仍与 HEAD 一致，预存 `tsconfig.tsbuildinfo`
  和原 24 条历史记录保持不变；Python 语法、差异空白及 13 个相关本地链接检查通过。
  Alembic 仍为单一 `20261022_0053 (head)`。
- **范围：** 未改变 API 字段、认证/授权规则、schema、Share、离线包、Dexie 或资料；
  没有提交、触发 CI 或部署。这里使用隔离 SQLite 和实际 HTTP 路由，不是
  PostgreSQL 并发或生产验收，也不保证结果在读取后被另一请求删除时仍可打开。
  文档仅更新现有入口、接口段落和本记录，不新增审查文件或候选池。

## Original execution records (historical)

### Improvement #1 — current deployment facts

- **Problem:** current navigation and deployment entry points still presented the predecessor `0f116fe`/drop-down checkpoint as current after the accepted `18d4971` slider release.
- **Change:** synchronized current source, CI, acceptance time, verified backup, direct rollback and release link; marked the 2026-10-19 production paragraph as historical without rewriting its dated evidence.
- **Files:** `docs/index.md`, `docs/deployment.md`, `docs/system/DEPLOYMENT_AND_ENVIRONMENT.md`.
- **Verification:** 26 targeted fact/link/stale-assertion checks passed; `git diff --check` passed.
- **Result:** operators and readers now reach one consistent current release and rollback answer from all edited entry points.
- **New findings:** none beyond existing candidates #2–#5.

### Improvement #2 — current migration head documentation

- **Problem:** development and API reference pages called migration 0052 the current production/source head although source and accepted runtime are at the single 0053 head.
- **Change:** identified 0052 as the feature-introduction checkpoint while updating unqualified current-head statements to `20261022_0053`; preserved the conditional 0052→0051 rollback warning.
- **Files:** `docs/development.md`, `docs/api-reference.md`.
- **Verification:** 9 targeted stale/current assertions passed; `python -m alembic heads` returned only `20261022_0053 (head)`; `git diff --check` passed.
- **Result:** setup and API documentation now direct operators to the actual source/production head without rewriting dated 0052 release evidence.
- **New findings:** none.

### Improvement #3 — feature provenance versus current runtime

- **Problem:** API/backend overview text correctly named the 2026-10-19 feature origin but incorrectly called its intermediate `50f6de4/0052` release the current runtime.
- **Change:** retained `f3b331a`/`50f6de4` provenance and original release links while pointing current accepted source/runtime to `18d4971/0053` and `PROJECT_STATE.md`.
- **Files:** `docs/api-reference.md`, `docs/system/BACKEND_AND_API.md`.
- **Verification:** 9 targeted provenance/current-state assertions passed; all four expected historical `50f6de4` mentions remain; `git diff --check` passed.
- **Result:** current operations and historical feature provenance are now distinct instead of mutually contradictory.
- **New findings:** none.

### Improvement #4 — prevent current release documentation drift

- **Problem:** multiple current-fact documents were independently edited and drifted to different release checkpoints.
- **Change:** added a sanitized current-release JSON snapshot, deterministic document-binding validator and schema/drift tests; added the check to CI and the `test:ci-tools` command; indexed the contract. It is read-only and does not inspect production/network state or rewrite historical receipts.
- **Files:** `docs/system/current-release.json`, `scripts/ci/check-current-release-docs.mjs`, its test, `package.json`, `.github/workflows/build-release-images.yml`, `docs/documentation-inventory.md`.
- **Verification:** `corepack pnpm run test:ci-tools` — 5/5 passed; standalone checker — six documents match; JSON parse and `git diff --check` passed. Two first-pass timestamp assumptions were corrected within this same item.
- **Result:** release/runtime fact changes now fail a deterministic CI gate if current entry docs are not updated together.
- **New findings:** none.

### Improvement #5 — label superseded image-scale checkpoint

- **Problem:** the documentation inventory listed the 13:00 floating drop-down release beside the later slider release without an explicit superseded/historical label.
- **Change:** marked the 13:00 release as the preceding checkpoint, linked it to the later slider and final 22:06 acceptance, and preserved the original CI, exact artifact and rollback facts.
- **Files:** `docs/documentation-inventory.md`.
- **Verification:** 7 targeted section, history-preservation and generated-anchor checks passed; current-release snapshot checker and `git diff --check` passed.
- **Result:** readers can distinguish the shipped intermediate selector from the currently accepted slider without losing release history.
- **New findings:** none.

### Improvement #6 — preserve unexpected database health-check failures

- **Problem:** `check_database_connection()` returned `False` for every exception, hiding programming errors as ordinary database unavailability.
- **Change:** catch only `SQLAlchemyError`; added regressions proving database-driver failures still map to `False` and unexpected runtime errors propagate.
- **Files:** `apps/api/app/core/database.py`, `apps/api/tests/test_health.py`.
- **Verification:** `python -m pytest tests/test_health.py -q --basetemp=<task temp>` — 4 passed; `git diff --check` passed.
- **Result:** expected connection failures retain health semantics while unexpected defects remain diagnosable.
- **New findings:** none.

### Candidate #9 — reviewed, no change

- **Question:** should `admin_runtime._metric()` catch exceptions broadly?
- **Evidence:** `apps/api/app/services/admin_runtime.py:20-28` isolates individual bounded runtime metrics so one query failure does not erase all other operator data. `apps/api/tests/test_admin_runtime.py::test_partial_metrics_and_remote_assets_are_explicit` injects a `RuntimeError`, asserts an unavailable metric, and verifies its private error string is absent from the response.
- **Decision:** preserve this intentional partial-result and redaction boundary.
- **Disposition:** triaged, no change; excluded from actionable remaining count. No tests rerun because source was unchanged.

### Candidate #8 — reviewed, no change

- **Question:** should request middleware narrow the broad exception handling around `call_next()`?
- **Evidence:** `apps/api/app/core/observability.py:141-148` converts unexpected failures to a generic 500 with a server-owned request ID and keeps raw exception text out of logs. `apps/api/tests/test_observability.py::test_request_id_headers_error_correlation_and_server_ownership` verifies 500 correlation and that the synthetic sensitive exception body is absent from logs.
- **Decision:** keep the broad boundary; narrowing it would risk leaking or bypassing the safe error response for unexpected application exceptions.
- **Disposition:** triaged, no change; excluded from actionable remaining count. No tests rerun because source was unchanged.

### Candidate #7 — reviewed, no change

- **Question:** should `structured_event()` propagate or narrow its broad exception handler?
- **Evidence:** `apps/api/app/core/observability.py:115-128` explicitly makes structured logging best-effort; `apps/api/tests/test_observability.py::test_logging_failure_does_not_block_business_request` verifies a logging failure does not fail the request.
- **Decision:** keep the broad boundary. Narrowing it could let logger/formatter failures mask or break business responses; no concrete defect was found.
- **Disposition:** triaged, no change; excluded from actionable remaining count. No tests rerun because source was unchanged.

### Improvement #10 — redact per-item batch deletion failures

- **Problem:** the per-item worker catch stored raw exception text in `result.failed[].error`, which task API reads returned unchanged; SQL/connection/path information could be exposed.
- **Change:** new failures persist only `CONVERSATION_DELETE_FAILED`; the existing best-effort structured logger records the exception class without raw text. Added a real API/worker regression proving two attempts, a retained failed conversation, continued deletion of later items and redacted task/log outputs. Documented the stable code.
- **Files:** `apps/api/app/services/background_jobs.py`, `apps/api/tests/test_conversation_management_api.py`, `docs/api-reference.md`; audit navigation/inventory link the ongoing local work.
- **Verification:** final source ran conversation-management, deletion-admission and tasks API modules together: **44 passed**. Snapshot and diff checks passed. An earlier fixture failed before deletion during import setup (23 passed/1 failed); the final deletion fixture uses existing manual-creation semantics, not lowered admission thresholds.
- **Result:** partial deletion remains useful and diagnosable without returning unexpected internal error strings. No retry/cancellation/ownership policy changed.
- **New findings:** #121–#125, tracked separately; no unrelated implementation included.

### Improvement #121 — portable release-doc comparisons

- **Problem:** a complete CRLF conversion reproduced a false missing-fragment error in the deployment rollback paragraph.
- **Change:** normalize document CRLF to LF before comparison; added LF, CRLF and mixed-ending fixtures without weakening required fact bindings.
- **Files:** `scripts/ci/check-current-release-docs.mjs`, `scripts/ci/check-current-release-docs.test.mjs`.
- **Verification:** the corrected pre-change probe reproduced the rollback mismatch; final CI tools — **8/8 passed**; standalone six-document check and diff check passed.
- **Result:** equivalent Windows and Linux checkouts now receive the same consistency result.
- **New findings:** none.

### Improvement #122 — future release test stability

- **Problem:** the real-repository contract test compared the current JSON snapshot with a fixed synthetic release fixture, so a valid later release would fail.
- **Change:** read expected live facts from the repository snapshot while keeping deterministic synthetic fixtures for drift/schema/line-ending tests; added a later-revision/head case proving bindings change with the supplied snapshot.
- **Files:** `scripts/ci/check-current-release-docs.test.mjs`.
- **Verification:** **9/9 CI tool tests passed**; standalone document check and diff check passed.
- **Result:** future releases update one canonical snapshot plus their current docs, not a test-only copy of the old release.
- **New findings:** none.

### Improvement #124 — safe task cancellation errors

- **Problem:** unexpected cancellation/request or transaction-commit failures were mislabeled as 409 conflicts and returned raw exception text.
- **Change:** preserve existing `MessageEditError`/`AdaptiveImportError` business conflicts, but roll back and re-raise unexpected failures to the existing sanitized, request-correlated 500 middleware. Added request- and commit-failure regressions and documented the contract.
- **Files:** `apps/api/app/api/routes/tasks.py`, `apps/api/tests/test_tasks_api.py`, `docs/api-reference.md`.
- **Verification:** both new tests first reproduced 409 with the private synthetic error; final task/import-analysis/observability plus existing merge-cancel regression — **43 passed**. Both failure phases preserve the queued task and hide internal text from response/logs.
- **Result:** genuine server failures are distinguishable from user-action conflicts without disclosing internal error details.
- **New findings:** #126 tracks pre-commit staged-source deletion separately.

### Candidate #11 — reviewed, no change

- **Question:** should ambiguous notification failures propagate instead of becoming UNKNOWN?
- **Evidence:** `support_notifications.process_notification()` commits SENDING before delivery because SMTP acceptance cannot be atomic with the database; support tests cover timeout→UNKNOWN, no replay after a send marker, and bounded explicit retries after negative SMTP responses.
- **Decision:** keep the broad transport boundary to prevent duplicate externally delivered email. No production message was sent during this audit.
- **Disposition:** triaged, no change; not counted as an implemented improvement.

### Improvement #126 — cancellation cleanup follows transaction outcome

- **Problem:** cancellation deleted staged sources before committing its database state; a failed commit left the still-queued/recoverable import without inputs.
- **Change:** schedule deduplicated cleanup on the owning SQLAlchemy transaction, transfer successful savepoints to their parent, delete only after the outer commit, and discard pending deletion on rollback/close. Capture the original root and retain resolved-directory guards. Post-commit filesystem failures keep the orphan and emit only exception-class telemetry.
- **Files:** `apps/api/app/services/adaptive_import/service.py`, `apps/api/tests/test_import_analysis_queue.py`, `docs/system/ADAPTIVE_IMPORT_CONTRACT.md`, `docs/documentation-inventory.md`.
- **Verification:** all **8** new transaction-failure/savepoint tests first failed on the old code. Final focused cancellation run: **16 passed**. Import-analysis, task and adaptive API regression: **82 passed / 4 PostgreSQL-only skipped**; the subsequently added root-capture test passed separately (**83 distinct passing cases** in total). Single migration head remains `20261022_0053`; release-doc and diff checks passed.
- **Result:** both HTTP cancellation paths and worker acknowledgement keep valid sources until cancellation is durable, without masking a successful cancellation as a failure when filesystem cleanup is unavailable.
- **New findings:** #127 tracks the separate post-commit session-creation cleanup hazard. No PostgreSQL concurrency acceptance or production deployment is claimed.

### Improvement #127 — preserve inputs after unconfirmed creation

- **Problem:** a committed admission followed by a refresh/response failure entered staging cleanup, deleting the inputs of an existing queued task. COMMIT acknowledgement loss has the same uncertain-outcome risk.
- **Change:** distinguish pre-commit staging from a commit attempt. Roll back and clean partial staging only before COMMIT begins; retain sources after an attempted commit, even when the request cannot confirm its outcome. Existing status/error codes remain compatible.
- **Files:** `apps/api/app/api/routes/adaptive_imports.py`, `apps/api/tests/test_import_analysis_queue.py`, `docs/system/ADAPTIVE_IMPORT_CONTRACT.md`, `docs/api-reference.md`, `docs/documentation-inventory.md`.
- **Verification:** baseline **4 failed / 1 passed**; focused final **5 passed**, covering failure before/after commit, refresh, response preparation and partial staging. Final package-command API regression across analysis/tasks/adaptive/responsiveness: **101 passed / 4 PostgreSQL-only skipped**. Persisted jobs were reopened and processed to READY from their original input. Release-doc and diff checks passed. An initial `pnpm` invocation passed `--` through to pytest and collected no tests; the corrected invocation produced the reported result.
- **Result:** an HTTP acknowledgement failure no longer destroys potentially durable work. A definitely rolled-back COMMIT can leave an orphan intentionally; source safety takes precedence over aggressive deletion when the request cannot prove the outcome.
- **New findings:** #128 tracks misleading re-upload advice separately.

### Improvement #123 — classify public generic worker errors

- **Problem:** generic worker failures stored `str(exc)`, exposing SQL/parameters, paths or content through task and adaptive-session reads. Formatting an unexpected exception could itself fail.
- **Change:** retain bounded, explicit domain validation errors plus a finite set of existing authored `ValueError` conditions; unexpected exceptions become `TASK_FAILED` without formatting their text. Existing archive/account-deletion policies remain separate. Added domain compatibility, raw SQL/path, unprintable-error and real failed-analysis regressions.
- **Files:** `apps/api/app/services/background_jobs.py`, `apps/api/tests/test_background_job_errors.py`, `apps/api/tests/test_import_analysis_queue.py`, `docs/api-reference.md`, `docs/system/OBSERVABILITY_CONTRACT.md`, `docs/documentation-inventory.md`; `PROJECT_STATE.md` points to this ongoing local ledger without changing accepted runtime facts.
- **Verification:** baseline **10 failed / 17 passed**; focused final **29 passed**. Twelve-module task/import/export/offline/Context/merge/attachment/TOC regression: **187 passed**. All **9 CI tool tests**, release-doc binding and diff checks passed.
- **Result:** new unexpected BackgroundJob failures expose a stable safe signal while authored recovery conditions, retry identity and original staged inputs remain available.
- **New findings:** #129 covers the separate canonical import writer; #130 covers historical persisted raw errors; #131 covers whole-event-history materialization during task reads. No historical error rewrite, migration or production action.

### Improvement #131 — scope import-result queries

- **Problem:** each committed import result loaded every `conversation_imported` ORM event and filtered its payload in Python, repeating global-history materialization for task/status reads.
- **Change:** bind the requested import ID in the SQL JSON predicate, select only conversation IDs, deduplicate with a set, and stabilize secondary order by event time/ID while keeping the primary first. Existing noncommitted fast paths remain unchanged.
- **Files:** `apps/api/app/services/import_queue.py`, `apps/api/tests/test_import_task_results.py`, `docs/system/BACKEND_AND_API.md`, `docs/api-reference.md`, `docs/documentation-inventory.md`.
- **Verification:** baseline **2 failed / 4 passed** reproduced **1,004** materialized rows and unstable tie ordering. Final focused/task/queue regression **31 passed**; two real synthetic adaptive commit/destination flows also passed (**33 distinct cases**). All four exercised helper/task-list/task-detail/import-status reads fetched only **4** matching ID rows, with **0 event ORM objects**, while unrelated payloads were excluded. PostgreSQL-bound JSON SQL compilation, release-doc and diff checks passed. An initial nonexistent test-path invocation collected no tests and was corrected.
- **Result:** Python row materialization in the synthetic history fixture fell from 1,004 to 4 per lookup without a result-format or schema change. This is not a PostgreSQL EXPLAIN/production latency or constant-time-index claim.
- **New findings:** #132 covers surviving batch results when the primary conversation is deleted; that eligibility behavior is deliberately unchanged here.

### Improvement #128 — tell users when import admission is unconfirmed

- **Problem:** known create-session persistence/analysis errors told users the work was not saved and to choose/upload files again, even though a task may already have committed.
- **Change:** Chinese/English known-code and structured API-message paths now say to check Tasks for the batch before uploading again. Server responses after any attempted COMMIT use matching uncertainty language; definite pre-COMMIT staging failures keep their existing, specific messages. No automatic retry or extra navigation/state was added.
- **Audit:** [scoped source/fault evidence and limits](../execution/ux-audit-import-acknowledgement-2026-10-24.md).
- **Files:** `apps/web/features/import/import-workspace-copy.ts`, `scripts/ux/import-acknowledgement-copy.test.mjs`, `apps/api/app/api/routes/adaptive_imports.py`, `apps/api/tests/test_import_analysis_queue.py`, `docs/system/ADAPTIVE_IMPORT_CONTRACT.md`, `docs/api-reference.md`, `docs/documentation-inventory.md`, the audit record.
- **Verification:** error-copy red baseline **8 failed / 1 passed**; post-commit response red baseline **4 failed / 1 passed**; final localized/API-form compatibility **9/9**, creation fault cases **5/5**, related import UI lifecycle/background/restore checks **27/27**, broader API analysis/tasks/adaptive/responsiveness **104 passed / 4 PostgreSQL-only skipped**. Web-target ESLint, nonincremental typecheck, all **9 CI tool tests**, release-doc binding and diff checks passed.
- **Result:** the first instruction after an ambiguous upload no longer risks telling users to duplicate a durable queued batch; safe precommit failure and existing alert/recovery contracts are preserved.
- **New findings:** #133 handles eventual orphan cleanup; #129 remains the next candidate.

### Improvement #129 — sanitize canonical import worker failures

- **Problem:** the separate canonical `ImportRecord` worker persisted arbitrary exception text through `_safe_error`; `CommitImportError` can wrap and echo database, file-path or source details, then `/api/tasks/{id}` and import status return the field directly.
- **Change:** retain bounded, authored `ImportDraftError` guidance (including when explicitly preserved as a commit error's cause); map other `CommitImportError` to `IMPORT_COMMIT_FAILED` and unexpected exceptions to `IMPORT_FAILED` without formatting their text. Failure logs continue to record only exception class.
- **Files:** `apps/api/app/services/import_queue.py`, `apps/api/tests/test_import_draft_streaming.py`, `docs/api-reference.md`, `docs/system/OBSERVABILITY_CONTRACT.md`, `docs/documentation-inventory.md`.
- **Verification:** injected canonical-write RuntimeError and SQLAlchemy `StatementError` traverse the real queued worker, Task Center and import-status APIs. A first broad regression run caught that memory-pressure diagnostics are wrapped by `CommitImportError`; classification was narrowed to inspect only its explicitly typed `ImportDraftError` cause. Final streaming/import-queue/task/preview regression: **45 passed**; all **9 CI tool tests**, release-doc binding and diff checks passed. Original source/draft remains retryable and no canonical conversation is published.
- **Result:** new native import worker failures no longer expose raw persistence error text while memory-pressure guidance, retry, and source preservation remain.
- **New findings:** #130 covers errors already persisted by older software; a duplicate legacy-error candidate was merged into it, not counted as another improvement. No historical row rewrite or migration is included.

### Improvement #130 — safe historical task-error projections

- **Problem:** new-writer hardening left old raw exception strings exposed through task list/detail/receipt, import status/session, failed noise-scan jobs and historical batch-deletion item results.
- **Change:** add one bounded, finite public-error projection. Preserve recognized offline/export/memory/archive recovery signals and tightly constrained numeric draft/retry diagnostics; use safe family-specific fallbacks for unknown strings, including code-shaped values. Clone batch-result items rather than modifying ORM JSON. Preserve stored history and existing retry/navigation contracts.
- **Files:** `apps/api/app/services/task_errors.py`, task/import/cleanup routes, adaptive-import session payload, `test_task_error_projection.py`, task/scan-lifecycle tests, API/observability contracts and inventory.
- **Verification:** initial narrow regression **67 passed** after retaining the two exact authored memory-pressure messages. Expanded fixtures exposed a missing scan/job binding in the new test; corrected the fixture, not the ownership gate. Final eleven-module combined regression **192 passed / 6 host-headroom failures**; all six failed cases passed unchanged in the subsequent isolated run (**9 passed / 23 deselected**), covering **198 distinct passing cases** across the runs. The 45 projection unit cases include private paths/SQL, unknown code-like strings, suffix injection, Unicode numeric spoofing and safe recovery compatibility. All **9 CI tool tests**, release-doc binding and diff checks passed. No PostgreSQL concurrency or production acceptance is claimed.
- **Result:** historical persisted exception text no longer bypasses the public error boundary; old database values remain byte-for-byte available internally and actionable known recovery signals survive.
- **New findings:** #134 tracks test resource determinism separately. Next #132 checks surviving batch-import result links.

### Improvement #132 — retain surviving batch-import result links

- **Problem:** deleting a committed batch's primary conversation sets `imports.conversation_id` to NULL; the lookup then returned early and hid every remaining result.
- **Change:** only noncommitted imports take the early return. Committed imports continue using the existing scoped ID-only event query even without a primary FK. No new query shape, format or restoration path.
- **Files:** `apps/api/app/services/import_queue.py`, `apps/api/tests/test_import_task_results.py`, API/backend contracts and inventory.
- **Verification:** the new real DELETE/task/list/status regression first failed with two surviving results replaced by `[]`. Final result/query/queue/task/deletion regression **53 passed**. The test enables SQLite foreign keys and verifies actual SET NULL and event CASCADE, duplicate removal, surviving message totals, and an empty result only after the final deletion. Eight noncommitted fast-path cases still issue no event query. Release-doc/diff checks and single migration head `20261022_0053` passed. This is not PostgreSQL concurrency acceptance.
- **Result:** users can still open the other conversations from a completed import after removing its original primary; deleted conversations are not recreated.
- **New findings:** #135 records the separate transient tombstone/visibility question. Next #134 addresses observed resource-dependent test failures without weakening production admission.

### Improvement #134 — isolate synthetic worker tests from desktop memory

- **Problem:** correctness/fault-injection tests with kilobyte sources consulted transient live host memory, sometimes failing before their intended transaction or exception path ran.
- **Investigation:** a separate test-process plugin forced the headroom sensor to zero before fixtures. Four correctness cases failed with the admission diagnostic while the explicit low-memory case passed; this confirms the hidden environment dependency, not a production parser defect or a proven engine-memory leak.
- **Change:** use the already-established draft-streaming module's scoped synthetic-sensor pattern for this small-source analysis suite. Keep actual worker/admission execution and add zero/unknown to the existing 64 MiB negative worker test.
- **Files:** `apps/api/tests/test_import_analysis_queue.py`, `docs/testing.md`, documentation inventory.
- **Verification:** unchanged zero-headroom fault: **34/34 analysis cases pass** after fixture setup, including all three explicit negative sensors; independent upload/expanded-input/draft guards: **44/44 passed**. This round changes no production file, settings value or reserve, and provides no real-host/OOM acceptance.
- **Result:** these worker and transaction tests now reach the path they intend to validate regardless of desktop free RAM, while low/unknown headroom still prevents analysis in the safety tests.
- **New findings:** no confirmed fixture-retention defect; no disposal/GC change was made on that unproven hypothesis. Next #125 is the code-block clipboard failure path.

### Improvement #125 — recover from code-copy clipboard failures

- **Problem:** code-block copy awaited the Clipboard API without handling missing/denied access, leaving readers without feedback or a complete manual alternative for collapsed source.
- **Change:** reuse the existing source-scoped clipboard hook; disable pending duplicate clicks, localize status, and show a focused/selected labelled read-only full-source field on failure. Retry/source changes retire stale feedback. Existing rendering, wrap/expand and source text remain unchanged.
- **Files:** `apps/web/features/conversations/markdown-renderer.tsx`, `scripts/ux/code-copy-recovery.test.mjs`, `scripts/ux/code-copy-browser.mjs`, the existing rich-text SSR fixture, rich-Markdown/testing contracts, inventory and [scoped audit/evidence](../execution/ux-audit-code-copy-recovery-2026-10-24.md).
- **Verification:** focused red baseline **1 passed / 7 failed**, then **8/8 passed**; **5/5 local Chrome component cases** passed and both desktop/375px synthetic screenshots were reviewed. Full service-free UX regression **1,582/1,582 passed** after its first run caught the existing SSR fixture's missing new import; it now loads the actual hook. Web lint, nonincremental typecheck, one-worker production build, **2** rich-Markdown source-contract Playwright tests, **9** CI-tool tests, release-doc binding and diff checks passed.
- **Result:** missing permission/API now has a complete, selectable recovery path instead of an unhandled promise rejection; pending and success states remain truthful for the current source. Browser checks use explicit device/preferences/highlighting adapters, not real OS clipboard, permission prompts or complete authenticated Reader/Share/Offline E2E.
- **New findings:** none confirmed in this round. Per the user's closeout request, no next candidate starts. Highest concrete follow-ups remain #135 (result-link liveness characterization) and #133 (read-only orphan-source inventory before any cleanup).
