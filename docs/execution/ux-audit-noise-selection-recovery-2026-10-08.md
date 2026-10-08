# Noise selection response recovery — 2026-10-08

Batch 26 follows the completed scan-lifecycle batch. Audience: ordinary and expert
readers reviewing imported or globally scanned conversations on desktop/mobile.
Scope: individual and cross-page KEEP/DELETE decisions, their acknowledgement,
lost-response recovery and actual persisted selections. Production, deployment,
automatic cleanup and semantic detection changes are outside this batch.

## Findings before implementation

| Finding | Severity / confidence | Evidence | Correction |
| --- | --- | --- | --- |
| Lost save leaves actionable old choices | High / observed source, runtime pending | CleanupReviewWorkspace removes its pending checkbox state on every settled mutation; errors neither reread decisions nor disable preview/next writes. updateCleanupDecisions/updateCleanupFilter have no deadline or caller signal. | Bound requests, identify unconfirmed state, block dependent actions and offer explicit read-only recovery. |
| Generic retry cannot establish actual selection | Medium / observed source | The mutation error renders only reviewError; no selection reread action exists. Retrying a checkbox can repeat a now-obsolete intention; selected-only bulk KEEP can remove every visible row. | Read current scan/page/groups without sending PATCH, then let the user review actual choices and act deliberately. Preserve failure retry and close/reopen recovery. |

Use the existing quiet workbench direction and compact status/recovery row near
the actual selection controls. Keep canonical content unchanged until preview and
explicit apply. Current saved state is not proof of which request caused it.
No new architecture, migration, receipt table or automated replay is needed.

## Verification

Pending baseline reproduction, actual server saves with dropped responses,
single/bulk deselection including selected-only pagination, failed reads, slow
requests, close/reopen and account/unmount protection. Verify both locales and
375/768/1440px with real API/PostgreSQL; report injected transport separately from
actual persistence. Task TEMP/TMP: `chat-reader-noise-selection-recovery-20261008`.
No commit, CI or deployment. The larger optimization goal remains active.

## Execution notes

- Implemented bounded, abortable individual and filtered saves. Unknown results
  disable dependent actions and expose a read-only recovery action. Current scan,
  page and groups are read together; cross-page selected-only removal recalculates
  the page before acknowledgement. Recovery never sends a decision PATCH.
- Added eight browser cases using actual API writes and injected transport loss:
  single-save/read-failure recovery at three widths, cross-page deselection at
  three widths, an unsent save/reopen and a deadline with a delayed response.
- Baseline runtime reproduction was not executed: automatic approval rejected
  `corepack pnpm --filter web exec next start --hostname 127.0.0.1 -p 3107` with
  only `blocked by policy`. The combined script stopped before Playwright.
  No alternative launch mechanism was attempted. Explicit user input was requested
  before any repeat of the rejected startup.
- The independent task-owned PostgreSQL/API/worker supervisor started successfully
  and was then stopped via its owned control marker. It reported
  `ISOLATED_SERVICES_STOPPED`; production and unrelated processes were not changed.
- Lint, nonincremental TypeScript and the bounded Web build passed after the
  implementation and all eight cases were added. Web build used one worker and
  a 2048 MiB Node heap; all 14 static pages generated. No browser result is implied.

Browser results and screenshots are missing, not passes. No broad API/Reader/PWA
claim is made. Existing batch 25 evidence does not validate these new changes.

On October 8 the user explicitly continued. The isolated fixture reached 0050 and
started, but automatic review again rejected the same loopback Web startup with
only `blocked by policy`. The fixture stopped cleanly. All eight selection cases
were discovered by a list-only Playwright command, not executed. This renewed
block is recorded in the [offline browser preparation follow-up](offline-error-guidance-2026-10-08.md).
No alternative launch or browser pass is implied.
