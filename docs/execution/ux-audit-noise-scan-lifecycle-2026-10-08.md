# Noise scan progress, cancellation and failure — 2026-10-08

Batch 25 follows verified completion of batch 24 (progress, not a blocked turn).
Scope: post-import/global noise scanning, its Task Center entry and worker-state
handoff. Audience: people organizing imported conversations, including keyboard
and mobile readers. Initial evidence was current code and preceding synthetic
screenshots; completed runtime reproductions are recorded below. Preserve source, previous
selections and all existing uncommitted work. No commit, CI, deployment or builds
of container images. Task TEMP/TMP: `chat-reader-noise-scan-lifecycle-20261008`.

## Findings before implementation

| ID / dimension | Severity / confidence | Location and evidence | User consequence and correction | Effort |
| --- | --- | --- | --- | --- |
| SCAN-01 / control | High / Observed (code) | `background_jobs.CANCELLABLE_JOB_TYPES` excludes content_noise_scan; NoiseReviewSummary exposes only disabled open/ignore while scanning. | A mistaken large global scan cannot be stopped. Add queued/running cancellation through the existing task service, with source unchanged and fresh rescan available. | M |
| SCAN-02 / feedback | High / Observed (code); rendering inferred | Worker failure/stale-exhaustion changes BackgroundJob only; `_scan_read` exposes the scan's independent SCANNING phase. | The person can wait indefinitely on a task that already failed. Project authoritative task terminal state into scan reads and recovery; do not require a test-only manual scan-status update. | M |
| SCAN-03 / task hierarchy | Medium / Observed (code + preceding screenshot) | ImportTaskMonitor groups ongoing noise scans in Needs attention; queued and processing scans both say noise review progress. | People cannot tell whether anything needs their input or whether a scan has started. Put live scans in In progress, disclose queued/scanning/cancelling, failed under Failed and stopped under recent Cancelled. | M |
| SCAN-04 / recovery integrity | High / Observed (code); cancellation race unverified | Incomplete noise chunks blindly assign queued before commit; other cancellable workers use conditional state updates. | Adding a cancel button alone could resurrect cancelled work. Guard chunk requeue/publication, verify both race directions and stop before further chunks. | M |

## Working design

Intent: a reader should see whether a background review is waiting, scanning,
stopping or finished, and stop unnecessary work without touching conversation
content. Reuse the quiet archive-workbench direction in `.interface-design/system.md`.
Domain: source, canonical messages, scanned ranges, candidates, preserved text,
review and recoverable tasks. Palette: paper/raised paper/graphite/muted ink,
sea-green action, amber review and restrained red error. Signature remains the
explicit source-to-reviewed-content progression; incomplete scanning never looks
like reviewed content. Replace generic attention cards, fake continuous progress
and blind retry with existing divided task rows, actual task status/counts and
read-only outcome checks. Typography uses existing text-sm/text-xs; 4px spacing
scale, 44px actions, border-ui and subtle surfaces, no new modal architecture.

Reuse BackgroundJob as the authoritative execution state and existing scan data
as the partial scanner cursor/result. Cancellation stops work; it does not apply
or expose an incomplete review as READY. Completed scan can win a cancel race;
show its real result instead of claiming cancellation. Unknown responses get a
read-only check. Cancelled rows follow existing terminal-result retention, while
the explicit import/latest-scan route remains readable. No new migration intended.

## Verification

Completed locally on October 8. Final evidence is in
[the evidence directory](ux-audit-noise-scan-lifecycle-2026-10-08-evidence/).

| Gate | Final result |
| --- | --- |
| API regression | 79 distinct cases passed; union of 37 scan/review, 49 shared worker/task and 9 import-retention cases, with overlaps counted once |
| Actual PostgreSQL | 9 passed, including requeue/publication cancellation races, recovery and persistence |
| Browser final implementation | 55 passed in bounded gates: closeout 26, related 18, navigation 11 |
| Focus reproduction | 1 additional focused mobile case passed before the final gates |
| Static/build | lint, nonincremental TypeScript and bounded-memory Web build passed |
| Migration | Single existing local head `20261007_0049`; no new migration |
| Visual review | 79 final synthetic screenshots, both locales, light/dark and 375/768/1440px reviewed; prior and focused images retained separately |

All final gates above have zero skipped cases. The cancelled latest-import read
remains accessible after general-list retention expires. Browser gates exercise
actual account isolation, import cancellation, retry and content preservation;
the fixture boundary is stated below. Earlier failed/interrupted runs are not
counted as passes. This is scoped regression, not a claim that the entire API or
PWA suite was rerun, nor a production acceptance or release.

## Execution notes

- API baseline reproduced both missing cancellation (409) and a real worker
  failure still reported as QUEUED. Initial scoped implementation passed 11;
  expanded scan/rescan/dismissal/outcome regression passed 37. Shared task,
  merge-cancellation and worker regression passed 49 (overlapping lifecycle cases
  are not independent extra coverage). Actual PostgreSQL races passed 9.
- First browser preparation encountered a local port conflict: 65438 had become
  a bound client socket, not an available listener. Two starts failed cleanly.
  A task-owned supervisor copy uses free port 45438 against the same isolated
  test cluster. No unrelated process, system port policy or business data changed.
  Browser fixture assertions accept only the two explicit loopback test ports.
- The first browser attempt was interrupted after one failed assertion: a seeded
  processing job lacked a heartbeat and real stale-job recovery completed it.
  The fixture now sets its claim heartbeat. This failure was test preparation,
  not an observed inability to display a genuinely running scan.
- The corrected nine-case browser run passed eight and reproduced a lost-focus
  defect after the cancellation check removed its control. Added local and
  section-transition focus restoration; deliberate focus movement stays intact.
  The same review clarified APPLYING's label and retained task metadata by job ID
  when retry clears the result scan ID. Seventeen intermediate synthetic images
  were reviewed; final regression and additional account/import checks follow.

The claimed interval in browser cases is seeded to keep a two-message synthetic
scan visible long enough to interact. Cancellation, worker finalization, rescan,
import, authentication and persistence use real API/PostgreSQL transactions.
Actual in-chunk cancellation races are tested separately with PostgreSQL threads.

The first expanded 54-case run passed 52 and failed twice: a mobile dismissal
focus regression and an account-switch assertion using the wrong English empty
label (the actual UI already showed zero tasks). The next 55-case run passed 47:
the mobile focus failure persisted, and seven later cases failed after the
isolated supervisor stopped at its 32 MiB C-drive reserve. The original cause of
the transient disk consumption is not established; no unrelated files were
deleted. Space recovered after the test processes exited. Earlier two proxy read
resets and later connection-refused errors are recorded as diagnostics, not passes.

Restricting live-row focus tracking alone did not fix dismissal. Its animation-
frame callback could run before React committed the result notice/removal. The
final change retains the origin and restores focus in a layout effect only after
the row actually detaches and the notice exists. The focused mobile reproduction
then passed. Final regression is split into bounded runs to release browser
resources between groups; assertions are retained, including both adjacent-row
restoration and deliberate navigation.

The successful task-download assertions in the first expanded run were accompanied
by three Next destination-stream-close diagnostics. The exact cause is not proven;
final task-delivery behavior is recorded separately. No production behavior or
full-suite success is inferred from this local diagnostic.

## Closeout

The final related 18-case gate passed without destination-stream-close or proxy
reset diagnostics. The earlier diagnostics remain recorded above; their original
cause has not been established. All final gates ran after the layout-effect fix.
The 55 final browser cases are distinct across the three bounded gates, rather
than a sum of repeated attempts. Aggregated API evidence likewise de-duplicates
overlapping cases.

Current cleanup, retention, API, backend, frontend, testing and interface-system
contracts were synchronized, along with Project State and the documentation
entries. Isolated PostgreSQL/API/worker/Web services stopped cleanly; their
45438/8008/8328/3107 listeners are absent. The unrelated socket at 65438 was not
modified. Final diff checks pass; staging remains empty. All 25 local batches
remain uncommitted. No push, CI, deployment, container-image build or production
change was performed. The wider optimization goal remains active.
