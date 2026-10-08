# Import/global noise rescan recovery — 2026-10-07

## Scope and evidence

Batch 23 continues the active optimization goal after the completed publication
batch. Focus: restarting import/global review, source conflicts, interrupted
rescan admission and access to earlier saved selections. No commit, CI, deployment,
production changes or local image builds. Existing work remains untouched outside
necessary shared request/receipt contracts. Use the isolated C-drive task directory
`chat-reader-rescan-recovery-20261007` under the AGENTS wkkk root.

Source inspection covers `cleanup-review-workspace.tsx`, `content-cleanup-panel.tsx`,
`content_cleanup.py` routes, `cleanup_scan_requests.py`, `cleanup_outcomes.py` and
their tests. Source findings below precede edits. Reproduction and actual results
are recorded separately; this is not a full-site usability study.

## Findings and ordered work

| ID | Dimension / severity / confidence | Evidence and consequence | Recommendation / effort |
| --- | --- | --- | --- |
| RESCAN-01 | Recovery / High / Observed (code) | Rescan POST always uses force_new and ignores any request key. A retry after response loss can enqueue another review. | Reuse a durable account/original-scan/request receipt and offer read-only checks before retry. M |
| RESCAN-02 | Data integrity / High / Observed (code) | Completion rewrites job.idempotency_key; global admission lookup only reads that column. A completed review loses its admission lookup. | Preserve the original request key through completion with an indexed lookup; verify an actual apply followed by retry. M |
| RESCAN-03 | Navigation / Medium / Observed (code); rendered impact to verify | New scans start with KEEP and immediately replace the current review. Saved old decisions are retained on the server, but the new review has no direct return link. | Explain the reset when selections exist and provide access to the prior review, without copying decisions to new offsets. M |
| RESCAN-04 | Feedback / Medium / Observed (code) | Rescan calls have no deadline or dedicated recovery; error text is at the end of the long list. | Put submitting/check/retry feedback beside the rescan control in all three entry states. M |

Quick win: RESCAN-04 local feedback. Resolve admission/receipt correctness before
presenting same-request retry as safe. Empty-review dismissal also lacks error
feedback (source observation); it is deferred to separate evidence, not counted
as fixed by this rescan work.

## Interface direction and preserved behavior

Use the existing quiet reading-workbench system: source, candidate, version,
selection, review and task receipt are the domain. Paper/raised-paper, graphite,
muted ink, sea-green action, amber review and restrained danger use existing tokens.
Keep 4px spacing, app typography and subtle border/surface depth. Rescan feedback
stays next to its command; no permanent explanation card. Confirm only when saved
selections make the fresh KEEP state surprising; no mandatory wizard. An earlier
review remains inspectable, while changed-source positions are never guessed.

Original import parent binding, active-only scope, single worker, personal rules,
protected ranges, source text and explicit apply semantics stay in effect. Existing
task storage carries request metadata; any new index must have a single migration
head and a real PostgreSQL upgrade/downgrade test. Admission identity and completion
receipt identity have different lifecycles and must not overwrite each other.

## Verification record

Completed locally; no release action. Source findings above preceded edits, but
the initial pytest preparation failed with C-drive ENOSPC, so it is not a runtime
baseline or a product failure. User cleared space and explicitly said to continue
on C. The attempted guarded deletion of five stopped batch-22 pytest directories
was rejected by automatic approval with only `blocked by policy`; nothing was
deleted and no alternate deletion method was attempted. No E-drive exception was
used in this batch.

## Implementation and additional evidence

Global/rescan receipts retain admission identity in the private task payload;
completion keeps its existing independent lookup. New migration 0049 indexes the
owner/type/payload expression. Original/request/account-scoped rescan retries use
a transaction advisory lock; lookup remains read-only and reports ended reviews
without replay. Import parent and original active scope are retained. Old decisions
and canonical message versions do not change when rescanning.

One parent-owned Web controller serves selection, conflict and failed scan views.
Requests have a 20-second deadline, account/original-review session persistence
and guarded cancellation. New tasks open before list refresh. Conditional
confirmation explains retained old choices and fresh KEEP; previous/newer
navigation remains available when the prior review has ended.

The first browser run had **10 passes and one actual cache failure**: returning
to a recently closed review reused the shared 15-second cache and exposed its
old candidate list. Scan/group/page revisits now use fresh reads; failed scan
reads cannot leave a stale actionable workspace. The corrected final 35-case
gate includes this scenario. Intermediate screenshots also showed feedback
wrapping beside preview; the final footer keeps commands together and puts
recovery below, including on 375px screens.

## Checks and actual results

| Gate | Final evidence |
| --- | --- |
| API | **24 passed / 0 skipped**, rescan requests, global requests, outcomes, ownership and group search |
| PostgreSQL | **5 passed / 0 skipped**, same-key concurrency, real apply/version counts, receipt retention and reversible index/model comparison |
| Browser | **35 passed / 0 skipped**, 13 rescan cases plus 22 import/navigation/cleanup regressions |
| Visual | 19 intermediate and 53 final synthetic screenshots inspected using contact sheets and key full-size views; both locales/themes and 375/768/1440px, including short-height regression |
| Static | lint, nonincremental TypeScript and Web build passed; Alembic single head `20261007_0049` |

The API sequence retained 2 initial passing recovery cases, then 21 passes/2
failures caused by tests using nonexistent POST-dismiss instead of the actual
DELETE endpoint. Corrected nine-case rerun passed; the final 24-case suite also
covers a pre-update pending job without the new payload key. These intermediate
failures are not counted as baseline product defects.

Two Web builds failed with V8 native/Zone OOM, including one after stopping the
fixture services. Successful builds used process-local `NODE_OPTIONS` with a
1536 MiB heap and one V8 pool thread, `UV_THREADPOOL_SIZE=2`, and
`RAYON_NUM_THREADS=2`; no product/build configuration, system memory setting or
global environment was changed. Both the first browser build and final adjusted
build completed with these limits. Final standalone lint/TypeScript also passed.

Evidence: [aggregate API/PG results](ux-audit-rescan-recovery-2026-10-07-evidence/api-pg-summary.json),
[first browser gate](ux-audit-rescan-recovery-2026-10-07-evidence/rescan-recovery-first.json),
[final browser gate](ux-audit-rescan-recovery-2026-10-07-evidence/rescan-recovery-final.json),
and `intermediate/` / `final/` synthetic screenshots in the evidence directory.
Raw request logs, XML traces and credentials were not copied into repository
evidence. Temporary files remain under the owned C-drive task root.

The browser failed-scan status branch uses an explicit status-only fault injection;
its admission and recovery still use real PostgreSQL/API/worker. Dropped responses,
read failures and delayed responses use transport fault injection. No full-site,
full API/PWA, production, new offline package or external Skill acceptance is
claimed. Missing historical admission identities are not reconstructed.

## Closeout and follow-up

Owned API/worker/PostgreSQL and Playwright Web processes are stopped. Head remains
975c1ee; all 23 optimization batches are uncommitted, and pre-existing tsbuildinfo
is unstaged. No push, CI, deployment, local image build, production operation or
unrelated cleanup. Production remains b45f049 / 0048. Current API, cleanup,
frontend/backend, deployment, testing, design-system and entry docs reflect the
new local contract. Wider optimization goal remains active.

Next bounded candidate: empty-result dismissal recovery and its misleading
“safe candidates” wording. That source observation remains unimplemented here;
it needs its own reproduction and user-impact check before claiming completion.
