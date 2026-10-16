# UX quick review - My shares transient reads

2026-10-13 开始，2026-10-14 本地收尾。范围是设置中的“我的分享”列表在暂时性 API 读取失败时的恢复行为。证据来自源码和脚本回归；内置浏览器无法连接本地服务，用户已要求不登录并继续修复。本记录不声明页面渲染或真实网络时序已经验收。

**平台：** Web app。**受众：** 普通用户管理自己的分享链接。**证据：** 仓库 `84988a260c48fcafb8b3bed6fcb7a1f16348111d` 加工作树源码；[Context 上传故障诊断](ux-audit-context-upload-recovery-2026-10-13.md)记录了 Web→API 读取短暂失败、随后服务恢复且任务已提交的生产事实。

## 覆盖边界

已检查 `apps/web/components/my-shares-panel.tsx` 的首屏读取、分页、筛选、刷新和错误分支。没有检查分享编辑器的已登录渲染、真实浏览器网络断开、屏幕阅读器朗读或设备资源占用；这些需要登录会话和浏览器验收。

## Findings

### FBK-SHARE-01 · 暂时性列表读取失败没有自动恢复

| | |
|---|---|
| **Dimension** | Feedback and states / Core task flow |
| **Severity** | Medium |
| **Confidence** | Observed (code); application to the adjacent production outage is inferred, share-specific production reproduction not run |
| **Effort** | S |
| **Location** | `apps/web/components/my-shares-panel.tsx:26,94` |

**Evidence.** `useQuery` explicitly sets `retry: false` for `getMyShares`. Any transient read failure therefore goes straight to the `shares.isError` alert at line 94, and the only recovery path is the refresh button. The query retains `shares.data` when available, but the UI does not distinguish “old list is still usable while retrying” from a final failure. The recent Context upload incident showed that a Web→API read can fail transiently while the server has already accepted the preceding write; the same transport condition can strand a read-only shares view even though no user action is needed.

**Why it matters.** A reader who opens settings shortly after a network or proxy hiccup is told to intervene even when the service recovers seconds later. In the worst case, the stale list remains visible beside an error with no indication whether it is current, so the user may manually retry or edit based on an uncertain view.

**Recommendation.** Use two bounded read retries with the existing short exponential delay used by other recovery surfaces. If an earlier list exists, show a quiet status that the latest list is temporarily unavailable and is being retried; keep the old list and its selection intact. Show the blocking alert only when no list has ever loaded. Keep the existing explicit Refresh control and do not add polling or a success toast.

## Prioritized action

1. Add bounded retry and retry delay to the shares query.
2. Separate retained-data recovery from an initial read failure in the status copy.
3. Add source-level regression coverage for both retained data and initial failure branches; browser verification remains pending until an authenticated browser session is available.

## Evidence log

- **SEEN (source):** `retry: false`, retained `shares.data`, a single manual refresh control, and one generic error branch.
- **SEEN (operational):** the adjacent Context upload incident recovered after a transient Web→API read failure while the server-side job had already committed.
- **NOT SEEN:** authenticated My shares screen in the ChatGPT in-app browser; share-specific production failure; measured retry latency or device resource use.

This is a scoped source review, not a rendered or conformance audit.

## Intermediate local repair and verification (superseded below)

The shares query now retries a read twice with a capped exponential delay. A
previously loaded page remains visible when the final read attempt fails and
receives a quiet recovery status; an initial read still receives the existing
blocking error and explicit Refresh action. No mutation is retried, no polling
was added, and no success notification was introduced.

The existing settings share recovery case now aborts the first list request and
waits for the automatic retry to restore all three rows; its editor, save,
per-item failure, and batch-revoke assertions remain unchanged. The local
authenticated browser case was not executable because the local Web/API
services are not running and the in-app browser has no authenticated session.

Local verification after the edit: **848 script checks passed / 0 failed / 0
skipped**, Web lint passed, TypeScript typecheck passed, and `git diff --check`
passed for the changed source, E2E file, and report. This does not claim a
browser run, CI result, production deployment, or device resource measurement.

See [pre-edit evidence](ux-audit-share-transient-read-2026-10-13-evidence/pre-edit.json)
and [local verification](ux-audit-share-transient-read-2026-10-13-evidence/local-verification.json).

## Reassessment before final acceptance

The preceding 848-check result is an intermediate regression check, not evidence
that the new shares recovery works. Those scripts did not exercise this query.
Installed Query Core 5.101.2's retryer rejects only after its retry budget is
exhausted; `QueryObserver` then exposes `isError`. Consequently, the intermediate
copy saying “Retrying automatically” at `isError` is false when no new read is
scheduled. Its two unconditional retries also repeat permanent HTTP failures.
These are confirmed defects in the new local change, not a demonstrated
production shares incident. The original explicit manual recovery was useful;
its browser assertion must be retained, with transient recovery added separately.

The narrow correction will retry only connection failures and HTTP 408/500/502/
503/504, at most twice. Exhaustion will say that the previous list is shown and
direct the reader to Refresh. No continuous retry or new polling is intended.
Actual QueryObserver tests will cover recovery, exhaustion, manual refresh,
selection retention, and permanent failures; component state/effects and transport
are doubles, so this still cannot substitute for browser acceptance.

The 40-character source identifiers in the first two JSON records were Git blob
object IDs, not SHA-256. Their field names have been corrected without changing
the recorded values. No earlier batch's ledger is changed.

The built-in browser was pointed at `http://127.0.0.1:3107` and returned
`net::ERR_CONNECTION_REFUSED`. It never reached the local application. The
previous online login-page observation is not acceptance of this unshipped
source, and no production upload is authorized as a substitute for local tests.

## Final local correction — 2026-10-14

Retry now applies only to `CONNECTION_FAILED` and HTTP 408/500/502/503/504, at
most twice, with 750/1500 ms delays. Exhausted refresh keeps cached rows and
selection and says to use Refresh; it does not claim continuing background work.
The initial-failure alert and manual Refresh remain. The existing browser test
still holds an outage until manual recovery, then separately injects one transient
failure and expects automatic recovery. Mutation behavior is unchanged.

Ten new tests compile the real component and API error class and exercise the
installed QueryObserver. They cover transient success, initial exhaustion/manual
retry, both localized stale-page messages and selection, and no retries for
401/403/404/422/429 or an unrecognized error. React state/transport are doubles;
actual configured delays are recorded but accelerated, so no latency measurement
is claimed. The whole script suite passes 868 checks; lint and nonincremental
types pass. The two affected sharing/library browser files discover 26 cases,
none executed. Local Web access is unavailable, independently of login.

The initial 848-check run used incremental typecheck, contrary to the intermediate
index wording. It changed an already-dirty buildinfo; it was not reset or included
as source. Final typecheck is nonincremental. Intermediate JSON records retain
their corrected Git-blob labels and limitations. Current source hashes and logs
are in the [final additive checkpoint](ux-audit-offline-resource-check-2026-10-13-evidence/local-verification.json).
No commit, CI or deployment was performed.
