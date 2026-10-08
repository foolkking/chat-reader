# Noise review results and dismissal — 2026-10-07

Batch 24 follows the completed rescan batch; the preceding goal turn made
verified progress. This batch improves import/global review completion and
dismissal from source evidence, without commit, CI, deployment or production work.
Use task-owned C-drive TEMP/TMP `chat-reader-noise-dismissal-20261007`; retain
existing data and uncommitted work. Previous services were confirmed stopped.

## Findings recorded before edits

| ID | Severity / confidence | Evidence and user impact | Intended correction |
| --- | --- | --- | --- |
| DISMISS-01 | High / source-confirmed | EmptyReview invokes DELETE without displaying failure. Lost successful response makes subsequent DELETE return 409; user cannot distinguish failure from completion. | Durable owner-scoped dismissal on the existing task, idempotent retry and read-only recovery beside action. |
| DISMISS-02 | High / source-confirmed | dismiss_scan deletes the review but leaves a failed BackgroundJob. Task Center still renders the orphan failed noise task. Scan status is not refreshed/locked before deletion, unlike apply. | Atomic terminal dismissal receipt/job update with the same scan lock used by apply; no source mutation. |
| DISMISS-03 | Medium / source-confirmed | READY/zero reviews are excluded from every Task Center list; import hides its review button. A completed global scan has no accessible result even though the scan persists. | Show recent zero-result scans in Completed, no sidebar attention reminder; allow opening from import completion. |
| DISMISS-04 | Medium / source-confirmed, layout observed in prior batch | EmptyReview says “No safe cleanup candidates” even though protected matches use a nonempty review. Full-height empty state and invisible failure make a small result hard to understand. | Compact factual result: current rules found no candidates, source unchanged. Keep meaningful rules/finish actions; stable feedback and keyboard return. |
| DISMISS-05 | Medium / source-confirmed | Task Center waits for pending-list invalidation before acknowledging ignore and shows errors above unrelated tasks. | Row-owned feedback, immediate confirmed removal, retained other rows and focus, shared dismissal behavior. |

These are hypotheses grounded in current code, not claims of passing tests.
Runtime reproductions and final checks are recorded below. Applicable interface
direction is `.interface-design/system.md`: quiet divided rows, existing tokens,
44px actions, progressive disclosure and explicit recoverable outcomes. No new
wizard, reminder, automatic deletion, worker or task architecture. Dismissal only
removes this review's decisions; canonical versions remain authoritative.

## Implemented behavior

Started October 7 and completed verification October 8 local time. Empty results
open from import completion and recent Completed tasks, without an attention
badge. Their compact dialog keeps Rules/Done and factual current-rule wording.
Ending a review atomically removes decisions and commits a small owner-scoped
dismissal receipt on the existing job. Canonical message versions do not change;
failed tasks no longer leave an orphan retry row. Fresh scan/job locks reject
active work. Existing admission identity and cleanup completion remain separate.
This batch adds no migration; the previous local head remains 0049.

One shared Web action handles conditional saved-selection confirmation, bounded
requests, read-only result checks and explicit retry. Confirmed removal updates
lists without waiting for refresh. Task Center captures the row before cache
removal and restores adjacent-row/result-notice focus only when focus is lost;
deliberate focus elsewhere is preserved. Reopening an ended review uses its
receipt and retains earlier/newer-review navigation. Nothing automatically applies
or discards selections when a dialog closes.

## Reproductions and failed attempts

- Before the backend fix, both API baseline cases failed: a repeated successful
  dismissal returned 409, and a dismissed failed scan retained a failed job.
- The initial implementation's scoped API suite passed 22 cases; expanded final
  API regression passed 31, including running-state rejection and account isolation.
- The first browser run passed 9/12; all three failures reproduced missing focus
  after a lost-response check removed its row. A disabled button/body cannot
  identify the originating row. The action now passes its attached DOM origin
  before updating caches. Added adjacent-row and intentional-focus-move checks
  retain the original assertions rather than weakening them.
- The first 59-case regression passed 57 and failed both cross-account late-task
  cases. Its Web process inherited `AUTH_ENABLED=false` from API fixtures, bypassing
  the private browser boundary. This was a harness configuration error, not evidence
  of an account-boundary pass. Corrected browser startup explicitly enables auth.
  Its screenshot variable was also misspelled; final capture uses the actual
  `SETTINGS_SCREENSHOT_DIR`. The failed aggregate remains preserved.
- That same run logged one Next “destination stream closed early” diagnostic
  during an export-delivery regression. All three delivery assertions passed;
  the message alone does not establish its cause. Final-run behavior is recorded
  below rather than treating this diagnostic as an unexplained pass.

Actual PostgreSQL tests passed 7 cases across dismissal/rescan/outcomes, including
concurrent dismissal, rollback, cached state refresh and the preceding migration
index checks. Tests use synthetic accounts and isolated task storage. No cleanup
workaround was attempted after the preceding batch's rejected directory deletion.
The user cleared C; this continuation retained the required C-drive temp root.

## Final checks and closeout

| Gate | Verified final result |
| --- | --- |
| API | 31 passed / 0 skipped; dismissal, rescan/scan requests, outcomes and ownership |
| Actual PostgreSQL | 7 passed / 0 skipped; dismissal, rescan and outcomes |
| Authenticated browser | 59 passed / 0 skipped across six specs; includes 14 dismissal cases and cross-account late-task checks |
| Visual | 15 intermediate and 89 final synthetic images reviewed using contact sheets and key full-size images; 375/768/1440px, short-height regressions, both locales/themes |
| Static/build | lint, nonincremental TypeScript, bounded-memory Web build and diff check passed; Alembic single head 20261007_0049 |

The corrected 59-case gate explicitly set Web `AUTH_ENABLED=true`; both previously
failing account-switch cases passed without weakening assertions. No destination-
stream-close diagnostic recurred in that gate. The earlier diagnostic's original
cause remains unproven. Build used process-local 1536 MiB heap/one V8 pool thread,
two UV threads and two Rayon threads; no global memory/build settings changed.

Evidence: [API/PG aggregate](ux-audit-noise-dismissal-2026-10-07-evidence/api-pg-summary.json),
[first browser run](ux-audit-noise-dismissal-2026-10-07-evidence/noise-dismissal-first.json),
[misconfigured regression](ux-audit-noise-dismissal-2026-10-07-evidence/noise-dismissal-final.json),
[authenticated final regression](ux-audit-noise-dismissal-2026-10-07-evidence/noise-dismissal-auth-final.json),
and `first/` / `final/` images in that evidence directory. Only aggregate reports
and synthetic images were copied; request logs, credentials and raw traces remain
outside repository evidence. No full API/PWA suite, external Skill acceptance or
production verification is claimed for this bounded change.

Owned API/worker/PostgreSQL/mailbox and Playwright Web processes are stopped;
their four listening ports are absent. C had 1.63 GiB available at the final
check. Head remains 975c1ee, index empty, pre-existing tsbuildinfo unstaged. All
24 optimization batches remain uncommitted; no push, CI, deployment, local image
build or production operation. Current API/cleanup/retention/frontend/backend,
testing, design-system and entry documents reflect the implementation. The wider
optimization goal remains active; subsequent changes still require source-backed
user value rather than an arbitrary number of cosmetic edits.
