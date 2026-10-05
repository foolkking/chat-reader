# Normalizer discovery and import recovery — 2026-10-05

Status: final source `daf759db2979449ba34e7e8295c56da96fd3f509` is committed/pushed,
passed all five jobs in CI `37307115329`, and its downloaded image artifact passed
local inspection. The initial `ea56227` CI failure and correction remain below.
Production is unchanged; capacity recovery and the backup-deduplication decision
remain pending. The older support artifact is not this release.

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

After authorized capacity recovery, run the final source's own preflight, consistent
backup, migration, live acceptance and authorized superseded-image cleanup.
Acquisition/Maintainer delivery still needs a review of Clipboard failure
handling: its direct `navigator.clipboard.writeText` call lacks the Normalizer's
manual fallback when Clipboard support is absent. Do not claim all three handoffs
have identical recovery behavior yet.

## Release preparation

Run [37304576688](https://github.com/foolkking/chat-reader/actions/runs/37304576688)
was explicitly dispatched after pushing `ea56227`; the returned head SHA matches.
GitHub access uses the existing local Git credential only in the `gh` child
process environment, without interactive login or printing/persisting its token.

Thirteen release helpers are prepared under this task's `release/` directory,
pinned to this source/run. Python and shell syntax passed. The Compose transform
was checked against deployed `3f1d539` and this source for both LF and CRLF inputs:
exactly two quota environment declarations are added, with `.env.production`
preserved. All 17 deployment archive entries match the pinned source after fixing
the local archive generation described below. No helper has run on production.

The preparation script first assumed the older support archive had a `support/`
prefix; inspection established it is extracted into that directory, so the new
archive preserves its actual unprefixed membership. A subsequent exact-byte check
caught `git archive` applying the workstation's CRLF conversion. Generating with
command-local `core.autocrlf=false` fixed it; the complete archive now matches Git
blob bytes, not just normalized text. These local failures did not touch production.

Read-only capacity/health inspection found **3,262,764 KiB** available and healthy
API/Web/PostgreSQL plus public HTTPS health. This remains below the prior measured
**5,278,167 KiB** release requirement; the new artifact still needs its own capacity
preflight. No new artifact was staged, no service was stopped, and no backup/image
was removed. The proposed 15-file backup deduplication remains unapproved.

The completed API job passed **902 tests / 3 skips** with 14 dependency warnings;
reviewed Context runtime **64** and worker/cleanup safety **53** also passed.
Alembic reports the single **20261005_0047 (head/current)**. These results are from
this source's CI, not inherited from the support release. The completed API log
is retained as `ci-api.log` in the task root.

## First CI failure and correction

Run `37304576688` finished with API and Web PASS, settings **135 passed / 1 failed**;
image build and inspection were skipped. This source has no deployable artifact.
The failing request-reply conflict/account-boundary test called `fill` immediately
after reopening the reply form. CodeMirror was still `contenteditable=false` while
`useSupportDraft.reload()` read the account-scoped persisted draft; Playwright
rejected the element type before waiting for it to become editable.

The test now asserts `contenteditable=true` after both reply-form openings before
typing. It does not unlock the editor, add arbitrary sleeps, skip assertions or
change application behavior. Existing real reply persistence, revision-conflict,
expiry locking, retained local draft and cross-account denial checks remain intact.

A fresh `ci_reply_readiness` PostgreSQL database migrated through `0047` in the
task's disposable cluster. With the existing production Web build and real fixture
API/worker, the complete affected scenario passed **10/10** repetitions. Lint and
typecheck also passed. Logs are in the `ci-reply-readiness/` task subdirectory.
Initial cluster startup omitted its nondefault port and failed to bind; restarting
with the recorded `55948` loopback address succeeded. No other cluster was stopped.
The original CI failure and local startup failure remain recorded.

Correction source **daf759db2979449ba34e7e8295c56da96fd3f509** was pushed and
[CI 37307115329](https://github.com/foolkking/chat-reader/actions/runs/37307115329)
dispatched against that exact SHA. API/worker PIDs were checked against saved
command/creation-time records before stopping; the task cluster was stopped by
its exact data path. The previous failed run's Web summary and settings error
context are retained under `ci-r1-web/` and `ci-r1-settings/`.

The final source has separate helpers in `release-final/`, all source-pinned;
syntax, archive bytes and LF/CRLF Compose checks pass. The earlier `release/`
directory belongs to the failed `ea56227` run and must never be deployed. A fresh
read-only storage inventory found the entire server release directory is only
770,232 KiB and build cache 15.37 MB, insufficient to close the capacity gap.
No general Docker prune or backup change was performed.

## Final CI and artifact verification

All five final-source jobs passed: API, Web, settings, image build and independent
artifact download/load. API **902 passed / 3 skipped**, reviewed runtime **64**,
worker/cleanup **53**, single head/current **0047**. Authenticated settings passed
**136/136**, followed by **1/1** fresh PostgreSQL system-archive restore.

The downloaded Web report binds to `daf759d` and reports **13/13** gates PASS:
import recovery **8 passed / 1 external-pair skip**, Context **35**, Reader/security
**45**, Share **2**, source mutation **16**, cleanup **1**, upload atomicity **18**,
image viewer **1**, PDF **5**, CSP **4**, authentication **18**, offline negatives
**17** and default PWA **134 passed / 284 opt-in skips**. Suites overlap; skips
and repeat runs are not added as unique passes. No test or dependency gate was
disabled. The original settings failure remains preserved as failed evidence.

Artifact `chat-reader-images-daf759db2979449ba34e7e8295c56da96fd3f509-1` is retained
under `release-final/artifact/`: **196,631,568 bytes**, SHA-256
`9f6347a49c80c94864536aabc5930c2dac278b538a54c4a958181e4327848406`.
Streaming local inspection checked all **50** blobs and **4** tags, exact workflow
provenance, Linux/amd64 configuration and source labels without running the images.
API/worker/migrate image:
`sha256:19dbfdf7cd94dbc2d267ce8e364750b086a7f977567dda2eb8409efcb3248973`;
Web image:
`sha256:6ee78928b84c1cbe6f2b5a0898e04fb033e78586724a03f5adfa911dd2259a6f`.

Final live read-only check: API and Web still select **3f1d539**, Alembic is
**20261003_0046 (head/current)**, public HTTPS health passes and **3,326,888 KiB**
is available. This is still below the previous ~5.03 GiB release preflight
requirement. No new archive was uploaded to production, and no production backup,
image load, migration, service replacement or cleanup was performed. The proposed
15-file deduplication still needs explicit authorization; further optimization or
an instruction to continue is not treated as approval of that backup operation.

Evidence is stored in `ci-final.json`, `ci-final-summary.json`, `ci-final-api.log`,
`ci-final-settings.log`, `ci-final-web/`, `ci-final-settings/` and
`release-final/local-artifact-verification.json`. External model Skill execution
and authenticated production UI acceptance remain unverified for this release.
