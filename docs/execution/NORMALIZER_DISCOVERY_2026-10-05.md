# Normalizer discovery and import recovery — 2026-10-05

Status: implementation after `0d228d4`, local acceptance passed. The inspected
support release `ad82cf4` remains a separate, undeployed artifact. Server capacity
and the pending backup-deduplication decision are unchanged by this work.

## Evidence and behavior

The dated Skill/help review's FLOW-03 remained open: `ImportPanel` only reported
unsupported input, while the Normalizer was available only inside an already
analyzed NOT_MAPPABLE family. The recovery dialog also lacked the shared modal
focus lifecycle. Its large error block repeated the surrounding diagnosis.

- Ordinary import now has an initially collapsed “Format not supported?” entry.
  Opening it obtains the selected personal/system Bundle and shows three steps:
  download, hand the source and Skill to the user's AI, return with converted
  Markdown. No automatic upload, script execution or model call is introduced.
- The same guide serves failed-analysis recovery. Personal selection and pinned
  Bundle URLs are preserved; lookup failure offers retry, never a silent fallback.
- Missing/denied Clipboard support exposes a selectable, read-only request template.
  No success text appears on failure. The template requests preserved messages,
  not a summary or an invented conversation.
- Archive/Context/Skill files are routed to their existing destinations. Permission,
  file/batch limits, transport errors and service failures do not present conversion
  as their recovery action. A literal `SKILL.md` cannot be analyzed as a transcript.
- The guide collapses the oversized drop area while open. Closing it preserves the
  original File objects; selecting a conversion result uses the existing chooser.
  For a multi-file batch the action explicitly says to choose the batch again.
- Analysis disables file replacement and ignores new drops until the response,
  preventing a result from being associated with a later selection. The user's
  existing exit remains available; no indefinite network-dependent dismissal lock.
- Failed-analysis recovery uses the shared focus trap, Escape ownership and return
  focus. Source identity stays compact; no duplicate privacy/error cards or tabs.

## Verification chronology

All input is synthetic. Task storage, the disposable PostgreSQL cluster, API,
worker and browser processes are scoped to
`C:/Users/86182/Desktop/wkkk/chat-reader-normalizer-discovery-20261005`.
Only this task's local services are started; production/user imports are untouched.

- Initial TypeScript passed. Lint found an unused `useQuery` after extracting the
  guide; it was removed and lint passed.
- Transcript-profile API tests: **11 passed**, including actual body/order and
  export/reimport assertions. No parser or server behavior was changed.
- The first browser invocation failed before running all seven selected tests:
  it used the default Chromium location. Reusing the existing bundled-browser
  directory under `wkkk/playwright-browsers` corrected the fixture configuration;
  no new browser download or global environment change occurred.
- The next run gave **5 passed / 2 failed**. The mobile assertion matched hidden
  sidebar text instead of the rendered Reader article; the error assertion matched
  both the actual error and Next's empty route announcer. Locators now target the
  actual message articles and import dialog. Neither application behavior nor test
  assertions were weakened.
- Screenshot review identified excess drop-area height when help was open. Its
  expanded-help presentation was compacted. The contemplated request-wide close
  lock was removed so delayed requests cannot trap the user.
- Final production build and lint passed. The broader import/Skill browser rerun
  uses that build; final results are recorded below when it completes.

Earlier failures stay in `browser.log` / `browser-r2.log`; final logs use
`browser-final.log`, `build-final.log`, `lint-acceptance.log` and `api-transcript.log`.
The external model itself is not run or claimed verified: browser tests provide a
synthetic Profile v1 output, import it through the real API and refresh the Reader.

## Final local acceptance

The final production-build import and Skill matrix completed **17 passed / 1
skipped**. The skipped test requires external paired JSON/Markdown fixture paths.
Coverage includes three widths and both interface languages/themes, original-file
retention, real Bundle downloads and personal selection, missing Clipboard support,
transcript import plus Reader refresh, routing/non-format failures, delayed upload
response, mapping reuse and multi-file recovery. Cases use real storage/API
results; only failure/delay injections are intercepted.

One Next “destination stream closed early” diagnostic appeared while the settings
locale/reload case still passed. A follow-up of that case and the converter passed
**2/2** without that diagnostic; its original log remains. The converter's mobile
dark screenshot and both keyboard wrap directions/Escape/focus return were checked.
Three final guide screenshots were also visually inspected; the expanded source
area no longer displaces all conversion steps below the fold. This does not claim
the earlier stream diagnostic's root cause is proven.

Final build, lint and TypeScript passed. Migration remains the single `0047`
head/current, without a new migration. The **11** API profile tests are distinct
from these browser runs; overlapping checks are not added as unique cases.

Task-owned API/worker processes were matched by recorded PID, command and creation
time before stopping; the disposable PostgreSQL cluster was stopped by its exact
data directory. Playwright's Web process exited with the test runs. Temporary
fixtures and evidence remain; no local residue or production resource was deleted.

## Next work

Commit this change and run its exact-source CI.
Deployment remains separate from local checks and the already inspected support
artifact. Acquisition/Maintainer delivery still needs a review of Clipboard failure
handling: its direct `navigator.clipboard.writeText` call lacks the Normalizer's
manual fallback when Clipboard support is absent. Do not claim all three handoffs
have identical recovery behavior yet.
