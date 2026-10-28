# Search and reader recovery release — 2026-10-28

## Authority and scope

The user authorized **submission and deployment** of the completed workspace
batch. This supersedes the implementation checkpoints' earlier no-submission
boundary, not their unverified results. Keep the changes together; do not start
another optimization cycle.

- Search correctness, exact destinations, scoped/offline recall, repeated
  activation and content-index lifecycle.
- Share expiry/copy recovery, account-scoped comment drafts, paginated search,
  TOCs, file references and conversation lists, and per-file upload recovery.
- The nine completeness follow-ups: delete intent, transactional rename
  derivation, ordering bounds/direction/priority, TOC append anchoring, bounded
  Office coordinates/relationships/shared strings and typed ZIP failures.
- Existing regression sources and corresponding implementation/audit records.
  Exclude the pre-existing `apps/web/tsconfig.tsbuildinfo`.

No migration, dependency change, production configuration change, canonical
rewrite, Share URL change, `.cr` change, offline package v1/v2/v3 change or
Dexie v2 change is included. Do not rescan/apply cleanup to user data.

## Validation and release gates

The inherited **no local tests, lint, typecheck, build, browser, services or
database** boundary remains. Static source/Git inspection is not a runtime
PASS. CI performs validation; no gate or assertion is weakened.

1. Commit/push the bounded batch, dispatch complete `Build release images` for
   its exact source, then wait **at least 50 minutes after every dispatch**
   before reading results. A new run starts a new wait.
2. Require all five jobs. Independently verify the official immutable artifact,
   source/run/attempt, archive digest, OCI chain, image identity, forbidden paths,
   embedded source and exact-source deployment support.
3. Freshly verify production identity, rollback, idle queues and capacity.
   Stop application writers only; resource-bound attachment integrity checks
   and a verified PostgreSQL/imports/exports/offline/assets backup precede
   application replacement.
4. Load verified CI images, check unchanged migration head/current, and
   recreate API/worker/Web with `--no-build --no-deps`.
5. Check exact images, health/worker freshness, HTTPS/denial/privacy boundaries,
   unchanged PostgreSQL/configuration, canonical aggregates, logs and OOM.
   On failure, restore the previous verified images without database downgrade.

Never build applications on the workstation or King, overwrite production
env/Compose/Nginx, restart PostgreSQL, delete user data/volumes, prune backups
or images, or run full diagnostics inside the serving API. The one explicitly
approved exact-list old-image cleanup is recorded below.

## Checkpoint

Source `51c26c3ba79eacaf614f8316f80996cb289b060f` was committed and pushed
as one batch: 98 files, excluding the pre-existing `apps/web/tsconfig.tsbuildinfo`.
Complete CI run `40631876492`, attempt 1, was dispatched for that exact source.
Its creation time is `2026-10-28T04:21:36Z`; a conservative dispatch upper
bound recorded after the metadata-index delay is `04:22:02.2168441Z`.
The run was first read at `05:12:07Z`, after the resulting
**05:12:02.2168441Z (13:12:02 Beijing)** result-read gate; its exact outcomes
and fixes are recorded below.

Fresh read-only host checks confirmed production/direct rollback
`b4effda`/`c7dc074` and healthy existing applications/PostgreSQL. Applications
have not been stopped or replaced. The preliminary capacity probe using the
current release archive refused: `3,547,948 KiB` available against
`4,013,203 KiB` required, before staging the new archive. Do not lower
headrooms or treat this old-archive probe as the new artifact's capacity PASS.
The user separately approved removing only the obsolete, unused application
images for `f3b331a`, `50f6de4` and `5992d0e`. The exact 12 API/worker/migrate/Web
references were rechecked against every container and both protected release
pointers, then removed without force or broad prune. Free space became
`4,446,956 KiB`; current/direct-rollback images were reverified present.
No release archive, backup, user data, volume or application container was
removed. A fresh exact-artifact capacity check is still required.
No application service has been stopped or replaced. CI rerun and production
acceptance remain pending.

### CI attempt 1 — failed and corrected

Run `40631876492` attempt 1 was first read at `05:12:07Z`, after its gate.
All three quality jobs failed, so image-build and artifact-inspection jobs
were correctly skipped; there was no deployable artifact.

- `web-quality`: lint found `prefer-const` in the comment-draft persistence
  queue. Replace the mutable declaration with a promise deferred through
  `Promise.resolve().then(...)`, preserving queue identity and retry behavior.
- `settings-quality`: its authenticated Web production build reached
  TypeScript and found implicit `any` on the TOC page callback. Type the
  callback result as the existing `TocResponse` contract.
- `api-quality`: 5,899 passed and 3 skipped; two parameterizations of the
  attachment-rename rollback test failed because the HTTP test client projects
  handler exceptions as a 500 response rather than re-raising them. Assert the
  500 boundary response and retain the before/after snapshot equality that
  proves name, search index and offline revision rollback.

These were the observed failure classes. The source and this record are
corrected without running local tests/builds or weakening CI. The correction
was committed and pushed as `db051dbfec5b72b782ce73de8dcb1602c89eba39`.
Complete CI run `40637231494`, attempt 1, was dispatched for that exact
source; metadata-only creation time is `2026-10-28T05:18:33Z`. The conservative
dispatch upper bound is `05:18:37.465063Z`; do not read any result before
`06:08:37.465063Z` (**14:08:37 Beijing**). This is a new 50-minute gate.

Fresh post-cleanup checks confirmed all 12 specifically approved old image
references are absent, both current `b4effda` and direct rollback `c7dc074`
image sets remain present, and Web/API/worker/PostgreSQL are still running
healthy with zero restarts. Free disk was `4,446,680 KiB` at that check. No
release archive has been staged and no application writer has been stopped.

### CI attempt 2 — failed and corrected

Run `40637231494`, attempt 1, was first read at
`2026-10-28T06:09:24.6908441Z` (**14:09:24 Beijing**), after its
`06:08:37.465063Z` result-read gate. `api-quality` passed, but
`web-quality` and `settings-quality` failed; the image and artifact jobs were
skipped, so this run produced no deployable artifact.

The failures split into implementation/test-contract issues, not a reason to
weaken the release gates:

- Keep uncertain-deletion comment drafts as explicit orphan recovery copies.
  The old assertion incorrectly expected an authoritative absence check to
  erase unsaved text; the test is being strengthened to require read-only
  orphan display and explicit discard.
- Keep message-only search fallback when canonical `matches` are absent.
  A snippet is not a verified range, so it must not create a character offset,
  end offset or quote highlight.
- Fix the offline scoped-search completeness bug without FlexSearch tag
  intersection: query with a positive corpus bound, filter conversation/type/
  role against the document map, then expose only the bounded page lookahead.
- Synchronize static harnesses with `useInfiniteQuery`, page parameters,
  `prefetchInfiniteQuery`, and the no-placeholder paginated TOC contract.
  Restore the worker startup helper dependency in the isolated viewer harness,
  update the archive truncation assertion, and make the settings E2E setup
  test the default focus preference before exercising annotations.

These corrections were committed and pushed as
`eae099b12465b0134ef7a421f429b80736275444`. Static inspection confirms the
worker asks FlexSearch for at most the positive indexed-document corpus size,
filters scope before the exposed lookahead/page window, and retains the
bounded exactness contract; the added tests cover targets beyond 100/200
unrelated/title hits and all four pages across 151 scoped matches. Reader list,
search, prefetch, and TOC fixtures now model the production infinite-query
contracts. The settings run's exact failure was the first `Exit focus mode`
expectation at line 146 while navigating with `?annotations=open`; that
explicit deep link intentionally disables focus mode. The setup now navigates
without the override so it tests the saved default before opening Annotations.

No local repository suites, lint/typecheck/build/browser/services/database were
run. During initial failure triage, one-off Node/FlexSearch dependency diagnostics
were executed despite the inherited no-local-runtime boundary. That was an
execution-boundary mistake, not acceptance evidence; no further local
application/dependency runtime diagnostics were used. Validation remains CI-only.
A documentation-only closeout correction updates the current checkpoint.
Production remains `b4effda` with direct rollback `c7dc074`; no writer was
stopped and no production data/configuration was changed.

### CI attempt 3 — failed; stale browser interceptors corrected

Exact source `56fa45cf3cc1a155d569420fa9d3e18d8b2372b5` (the implementation
corrections plus the checkpoint documentation) was pushed to `master`.
Complete `Build release images` run `40656487189`, attempt 1, was created
at `2026-10-28T08:23:54Z`. The conservative post-dispatch timestamp is
`08:23:54.7795208Z`; the first result read must be later than
`09:13:54.7795208Z` (**17:13:55 Beijing**). Only run identity/source/time
metadata was inspected before that deadline. The first result read was
`2026-10-28T09:14:00.669327Z` (**17:14:00 Beijing**), after the gate.
`api-quality` and `settings-quality` passed. `web-quality` passed lint,
typecheck, production build, the ordinary recovery regressions and all browser
steps preceding `Release H Source Editor and mutation cache checks`. That step
had **94 passes / six failures**; later Web steps and both image jobs were
skipped. No deployable release-image artifact exists.

All six failures are in `ux-recovery-followup.spec.ts`: active/archived retained
list refresh at 375/1440px and empty active-list existence recovery at those
widths. The list now requests a 100-item page plus lookahead
(`limit=101&offset=0`), while the old browser mocks only intercepted
`limit=5000`. Retained-list request counters therefore stayed zero, and the
empty-page response was never supplied. The official quality evidence artifact
`12802384503` matched its API SHA-256 digest; its failure contexts and the
job log support the request-contract diagnosis. It contains no trace archive;
no trace-based claim is made.

The correction matches status, all-list scope, first-page limit and offset, and
asserts the initial primary/existence requests were actually intercepted before
exercising recovery. Keep every failure/held-retry, real DOM identity/focus,
selection, no-write/message invariance and Archive-destination assertion.
No product source, workflow, timeout, retry allowance or required gate changes.
The three direct `limit=5000` requests in this spec are fixture inspection,
not UI interceptors, and remain unchanged. Validation is still CI-only; these
edits require a fresh complete exact-source dispatch and its own 50-minute gate.
Use only the existing local Git credential and GitHub API/CLI; do not open or
log in to GitHub in a browser.

Exact-source deployment helpers remain preparatory only. No writer was stopped
or application replaced; production/direct rollback remains `b4effda`/`c7dc074`.

### CI attempt 4 — failed; synthetic admission and Skill leave-guard corrections

The interceptor correction and pending source-contract documentation were
committed as **`1dcd9f9986c70adfcb7b92e3a4ea3be74e640590`**. Two existing SSH
push attempts failed at transport before completing; a command-local HTTPS
mapping and the existing local Git credential pushed the same commit without
changing repository remote configuration or persisting the token. Only the
pre-existing `apps/web/tsconfig.tsbuildinfo` remained outside the commit.

Complete workflow run **`40666671235`**, attempt 1, was created for that exact
source at `2026-10-28T09:45:01Z`. The conservative post-dispatch timestamp is
`09:45:01.2255937Z`; no result may be read until after
`10:35:01.2255937Z` (**2026-10-28 18:35:02 Beijing**, rounded up).
Only identity/source/time metadata was inspected before that gate. The
documentation-only dispatch checkpoint `d7f0a21` was not a new application
candidate. First result read was **`2026-10-28T10:43:47.5995079Z`**
(**18:43:47 Beijing**), after the gate. Settings passed; API and Web failed.
Image build/inspection were skipped and no deployable artifact was produced.

- API had **5,826 passes / 75 failures / three skips**. The failures clustered
  in small synthetic imports from offline annotations onward: commit was
  rejected with memory pressure, or queued transcript analysis reported
  insufficient memory. The shared SQLite/TestClient fixture did not control
  the host headroom sensor, unlike existing draft-streaming/analysis fixtures.
  Only that synthetic fixture now provides deterministic headroom to
  `uploads.available_memory_bytes`; no admission code, concurrency gate,
  threshold or core host/cgroup probe changes. Existing low/unknown-memory
  overrides remain. New HTTP parameterizations require actual probe calls,
  rejection at zero/unknown headroom, unchanged source files and zero canonical
  conversations, then a successful retry of the retained import after the
  scoped pressure override ends. Runner memory consumption is not measured or
  accepted by this test isolation.
- Web's **Context files, export and reader recovery** step had **34 passes /
  one failure**. The selected-normalizer flow displayed `Replaced` and then
  opened `Discard unsaved changes?`, whose backdrop blocked Import. Official
  quality artifact `12807191516` matched
  `sha256:a3d5d58148d625c4588bf571db9827d026f869393626c0515b107c1f901b166b`;
  its failure context confirms both states. There is no trace-based claim.
  The file selection and personal/system aggregate dirty notifications now use
  layout effects, settling the leave guard before visible success can be
  acted on. Do not clear the whole form unconditionally. Browser assertions
  cover immediate Escape after successful replacement in the width/locale
  matrix and personal/system lost-response recovery; an unsaved selection and
  a separate unsaved upload still require cancellation-safe confirmation.
- The six list-interceptor corrections from attempt 3 were **not reached**
  because the earlier Context gate failed; they are not counted as accepted.

The corrections and regressions are source-only at this checkpoint. No local
tests/lint/typecheck/build/browser/service/database commands ran. No workflow,
timeout, retry allowance, production memory protection or required release gate
is weakened. A fresh complete exact-source dispatch and a new 50-minute gate
are required. Full quality, official artifact, independent source verification,
fresh capacity and stopped-writer backup gates remain pending. No production
action occurred.

### CI attempt 5 — dispatch checkpoint

The synthetic admission fixture isolation, Skill leave-guard corrections and
regressions were committed/pushed as
**`d1b8965dd80cd843853e185cda1513859696fcc2`**. Static source/diff review only;
the pre-existing `apps/web/tsconfig.tsbuildinfo` remains unmodified by this task
and excluded. Existing local Git credentials and a command-local HTTPS mapping
were used; no browser/GitHub page or web search was opened.

After verifying the remote `master` SHA, complete `Build release images` run
**`40676535658`**, attempt 1, was created for that exact source at
`2026-10-28T11:00:16Z`. The conservative post-dispatch timestamp is
`11:00:16.3244826Z`; do not read results/jobs/logs/artifacts before
`11:50:16.3244826Z` (**2026-10-28 19:50:17 Beijing**, rounded up).
Only run identity/source/time metadata has been inspected. This subsequent
documentation-only checkpoint does not change the application candidate;
artifact/source checks must retain the exact `d1b8965`/run/attempt chain.
All five jobs, official artifact/source verification, fresh capacity and
stopped-writer backup remain required. No writer stopped, image loaded or
application replaced; production/direct rollback remains `b4effda`/`c7dc074`.

#### Result read and targeted correction

First results were read at **2026-10-28 20:34:38 Beijing**
(`12:34:38.1767363Z`), after the 19:50:17 gate. Exact source/run/attempt
identity was checked before reading results. API/settings quality succeeded;
Web quality failed in `Default PWA baseline`. Both image jobs were skipped;
no deployable artifact was produced. Earlier API/Skill fixes were exercised,
and the six list cases from attempt 3 are now included in the passed matrix.

| Web browser gate | Official result |
| --- | --- |
| Skill/Context | 36 passed |
| Focused online / Share focus | 45 / two passed |
| Source editor and mutations | 100 passed |
| Cleanup / upload | Six / 18 passed |
| Markdown/image / PDF | 31 / 13 passed |
| Default PWA | 157 passed / four failed / 750 conditional skips |
| Subsequent authenticated / negative PWA | Not reached |

Official `web-quality` evidence artifact `12813042951` (31,214,757 bytes)
was independently matched to this run/source and its downloaded SHA-256:
`59b9439000cc9828e40a2b0fbbcf4e480b9582cd406442cbcb7d2ccc37ed2384`.
Its traces/error contexts, not a local browser run, ground this diagnosis:

- The scoped offline search returns the correct `target-annotation-40` hit
  and current `1 of 1 results loaded · 1 locations` status. One test still
  asserted the old count-only wording. The complete count assertion is
  updated without removing decoys, role or title/type exclusion checks.
- Both 375/1440px offline body cases fail `target-not-aligned` in a short
  six-message window at its lower scroll boundary. The stale-version case
  fails on a single-message page with no vertical scroll available. These
  visible anchors cannot reach the fixed reading line.
- Mounted alignment gains only a visible physical-endpoint exception. It
  still rejects offscreen/covered/zero-height targets and a stalled scroll
  away from that endpoint. Normal 24px alignment, three frames / 240ms,
  cancellation, timeouts and fallback/exact-pulse semantics are unchanged.
  Reachability is measured anew if the mounted content grows.
- Twelve controlled regression cases exercise the actual navigation module;
  DOM/Range/RAF/resize are adapters, not real mounted geometry or the text
  resolver. The existing stale-version browser case also requires a visible,
  non-scrollable Reader at scroll zero. Exact body/file/annotation, replay/
  same-DOM and pulse requirements remain.

The correction has static source/diff review only. No local tests/lint/
typecheck/build/browser/services/database or dependency diagnostics ran in
this correction. The pre-existing `tsconfig.tsbuildinfo` hash is unchanged
and excluded. No workflow gate, timeout or retry allowance changes. A fresh
complete exact-source dispatch and 50-minute result-read gate are required;
all five jobs, independent official image verification, fresh capacity/
rollback/queue checks and stopped-writer five-component backup remain pending.
No production operation occurred.

### CI attempt 6 — dispatch checkpoint

The physical-boundary alignment correction, complete count assertion and
regressions were committed/pushed as
**`440263573900cc7f8162b96c36f350f92c1785f6`**. Only static source/diff review
and textual diff checks ran; no local tests/lint/typecheck/build/browser/
services/database or dependency diagnostics ran. The pre-existing
`apps/web/tsconfig.tsbuildinfo` hash remains unchanged and excluded.

After verifying the remote `master` SHA, the complete `Build release images`
workflow was dispatched once. Run **`40692514416`**, attempt 1, was created at
`2026-10-28T13:00:12Z` for that exact source. The conservative post-dispatch
timestamp is `13:00:12.7596140Z`; do not read results/jobs/logs/artifacts before
`13:50:12.7596140Z` (**2026-10-28 21:50:13 Beijing**, rounded up).
Only identity/source/date metadata has been inspected. This subsequent
documentation-only checkpoint does not change the application candidate;
independent image/source verification must preserve the exact
`4402635`/run/attempt chain.

All five jobs, official image verification, fresh capacity/rollback/queue
checks and stopped-writer five-component backup remain required. No writer
stopped, image loaded or application replaced; production/direct rollback
remains `b4effda`/`c7dc074`, schema `20261022_0053`.

#### Web failure read and fixture correction

The user explicitly removed waiting for the failed `web-quality` diagnosis.
First results were read at **2026-10-28 21:50:25 Beijing**
(`13:50:25.3884392Z`), also after the original 21:50:13 checkpoint.
Exact `440263573900cc7f8162b96c36f350f92c1785f6` / `40692514416` / attempt 1
was verified. The official Web job `122830708331` failed in step 18,
`Ordinary-user recovery and bounded attachment regressions`, with
**1,816 passes / one failure**. The other 11 new navigation-alignment cases
passed. API succeeded; settings was still running at the **21:55:40 Beijing**
status read. Browser/build/release verification was not reached by Web;
no deployable image acceptance is possible from this failed quality gate.

The single failure was introduced by the previous test fixture, not evidence
that the preceding browser failures were fixed. Its target at 100px was only
20px above the 120px reading line, inside the normal 24px tolerance. It thus
never entered the physical-endpoint exception named by the test. The fixture
is corrected to use an exact Range at 32px in a non-scrollable window:

- Preconditions require the target to lie outside the normal tolerance.
- The identical Range must succeed with no header padding at scroll zero.
- With 56px scroll padding covering the entire Range, it must fail
  `target-not-aligned` and retain scroll zero.

No production implementation, rejection assertion, browser expectation,
timeout, retry allowance or required workflow gate is weakened. Only static
source/diff review ran locally; the corrected paired test is authored, not
executed locally. The existing `tsconfig.tsbuildinfo` remains untouched and
excluded. Per the latest instruction, this CI failure-diagnosis cycle no
longer imposes the fixed waiting period; earlier dispatch/read timestamps
remain historical facts. A complete fresh exact-source CI, all five successful
jobs, independent official image verification, fresh host preflight and
stopped-writer five-component backup remain required. No production action
occurred.

A final status follow-up at **2026-10-28 22:01:44 Beijing**
(`14:01:44.7629427Z`) confirmed API/settings success, Web failure and both image
jobs skipped. This does not validate the unreachable Web browser gates.

### CI attempt 7 — dispatched; fixed failure-diagnosis wait removed

The paired occlusion-fixture correction and evidence updates were
committed/pushed as **`99ecb934ac11d9072d81f3d79949b045d29597da`**.
After verifying remote `master`, complete `Build release images` run
**`40701765161`**, attempt 1, was created for that exact source at
`2026-10-28T14:00:45Z`; the conservative post-dispatch timestamp is
`14:00:45.2102118Z`. It was dispatched once, not a failed-job-only rerun.

Per the latest user instruction, failure diagnosis follows actual remote CI
status without the former fixed waiting period. No local tests/lint/
typecheck/build/browser/services/database or dependency diagnostics ran.
No quality gate, workflow timeout, retry allowance, independent official
artifact verification, fresh host preflight or stopped-writer backup
requirement is removed. Production/direct rollback and schema are unchanged.
A subsequent documentation-only checkpoint retains the exact application
candidate/run/attempt chain above.

An early status read at **2026-10-28 22:06:03 Beijing**
(`14:06:03.3021023Z`) verified this source/run/attempt and confirmed Web job
`122863172153` step 18, `Ordinary-user recovery and bounded attachment
regressions`, **success** (started `14:04:33Z`, completed `14:05:43Z`).
Web had advanced to Playwright installation; Web/API/settings remained in
progress. This confirms the corrected early gate, not full browser/PWA,
official image or deployment acceptance. No local validation was substituted.

#### Default PWA failure read and browser precondition correction

First failure results were read at **2026-10-28 22:46:42 Beijing**
(`14:46:42.3598096Z`), verifying exact source/run/attempt first. The Web job
failed in step 34, `Default PWA baseline`. A **22:58:02 Beijing**
(`14:58:02.0102689Z`) follow-up confirmed the complete run failed:
API/settings succeeded, Web failed and both image jobs were skipped.

| Web gate | Official result |
| --- | --- |
| Ordinary-user recovery / bounded attachments | 1,817 passed / zero failed |
| Skill/Context | 36 passed |
| Focused online / Share focus | 45 / two passed |
| Source editor and mutations | 100 passed |
| Cleanup / upload | Six / 18 passed |
| Markdown/image / PDF | 31 / 13 passed |
| Default PWA | 158 passed / three failed / 750 conditional skips |
| Subsequent authenticated / negative PWA | Not reached |

Official quality evidence artifact **`12825355485`**, 24,918,072 bytes,
was independently matched to this run/source and its downloaded SHA-256:
`8d072a178a79f0db18b56dd86a0de3ebb09aa57c2f60b4133e3a8ce0c9e82a75`.
Its traces, error contexts and static screencast frames—not a local browser—
show that the earlier count assertion and initial body/fallback alignment
failures no longer block progress. This does not make the three whole
browser cases pass:

- Both widths reach exact `settled` before failing the later replay setup.
  One real 1500px wheel expands the complete-turn window from six to ten
  messages and finishes `next:settled`, preserving the reading anchor.
  The official desktop trace remains at scroll 139 after that transition;
  target/reading-line distances are 114.5px (375px) and 42.296875px (1440px),
  not the test's required >200px. A wheel cannot consume the future
  asynchronously mounted content.
- The replay setup now waits for message 10 and `next:settled`, then sends
  a second real 600px wheel. It still requires finite >200px departure,
  not Infinity from a missing target; same Reader/URL, stage transitions,
  exact text pulse and <36px return are retained. No programmatic scroll,
  arbitrary sleep or assertion/timeout/retry relaxation is introduced.
- The stale-version case already has preserved content, `settled:fallback`,
  a visible target and scroll zero. Its new total-height assertion was
  incorrect: Reader frame min-height/padding can overflow while the selected
  message is at an unreachable upper reading line. The replacement asserts
  actual viewport/uncovered-anchor geometry, scroll zero and a >24px
  unreachable gap above the 120px line, retaining no false exact text pulse.
  Earlier “no scrollable height” wording describes the prior diagnosis;
  actual upper-endpoint reachability, not total frame height, is the contract.

Only these browser test preconditions/assertions and evidence documentation
change; production navigation code and all quality/artifact/deployment gates
remain unchanged. No local tests/lint/typecheck/build/browser/services/database
or dependency diagnostics ran. Static source/diff inspection is not execution
evidence. The protected `tsconfig.tsbuildinfo` hash remains unchanged and is
excluded. A fresh full exact-source CI is required, without fixed waiting for
failure diagnosis under the latest instruction. No deployable image was
accepted and no production operation occurred.

Implementation evidence and remaining verification boundaries:

- [Search correctness](SEARCH_CORRECTNESS_2026-10-27.md),
  [offline recall](SEARCH_RECALL_OFFLINE_2026-10-27.md) and
  [lifecycle](SEARCH_LIFECYCLE_2026-10-27.md).
- [Reader recovery](UX_AUDIT_OPTIMIZATION_2026-10-28.md) and
  [completeness follow-ups](UX_AUDIT_COMPLETENESS_IMPLEMENTATION_2026-10-28.md).
- [Verification matrix](../testing.md). Same-runtime failed-delete intent is
  not durable through forced reload/crash; bounded Office previews are not
  full fidelity or malicious-document certification. Authenticated production
  UI, physical clipboard and sustained-load acceptance are not implied by CI.
