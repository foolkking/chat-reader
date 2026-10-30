# Project State

Last updated: 2026-10-30. This is the current snapshot, not a release history.

## Release and active work

**Active completion follow-up — 2026-10-30, not yet released:**
WEB-05/08/11/21/22 now have bounded source implementations: no-side-effect
visitor preview, independent read-only comparison, account tags and offline
name snapshots, explicit message-identity baselines and text-only frozen shares.
Source head is `20261030_0058`; production remains `0d1efac` at `0056` until
fresh exact-source CI, artifact acceptance, backup, migration and deployment pass.
These new server records are not portable `.cr` data. See
[data contracts](docs/system/DATA_AND_STORAGE.md) and the
[implementation record](docs/execution/WEB_FEATURE_OPPORTUNITIES_IMPLEMENTATION_2026-10-30.md).
The older 19-delivered/5-missing statements below describe the accepted release,
not this follow-up worktree.

Follow-up CI `41014403002` failed both the mounted Web adapter and the email
change recovery gate. The adapter dependency correction is committed in
`6dc884d`. API logs show the email change committed before returning 401;
authentication's separate credential-row reads can cross that commit under
READ COMMITTED. A single joined snapshot and deterministic PostgreSQL
interleaving regressions are now pending fresh full CI. Production is unchanged.

**Current production accepted — 2026-10-30:**
Exact source **`0d1efacaa8145dff0c8c70ceda82460af5883854`** passed all five
jobs in full CI **`40992509041`**, attempt 1. Dispatch was
**2026-10-30 02:34:47Z**; the first permitted read was **03:24:47Z**
after the required 50-minute wait, and all jobs were green by **03:36:35Z**.
API passed **5,924 / 3 skipped**, settings **463 plus one independent restore**,
and Web passed **1,863/1,863 UX** plus its adaptive/CSP/Context/focused/Share/
mutation/cleanup/upload/Markdown/PDF/default-PWA/auth/negative gates. The
build-images and inspect-release-artifact jobs also passed.

Official artifact **`12952232763`** matched its GitHub digest; the downloaded
ZIP SHA-256 is
`1aced2fef34f87d9886a34c8445bf3fe4267474edc24416aa7392322734d0730`.
Independent verification passed **35 blobs / 23 layers / 346 embedded API
files**, exact compiled Web revision, and no forbidden paths. Production
acceptance completed at **2026-10-30 04:01:19Z** after maintenance from
**03:51:39Z**; the independent post-deployment recheck at **04:35:55Z** also
passed. Current/direct rollback/older protected image sets are
**`0d1efac` / `f8a6a06` / `b4effda`**. Schema is **`20261030_0056`**.

The new stopped-writer five-component backup
**`chat-reader-20261030T035153Z`** passed independent rehashing. API/Web/
worker/PostgreSQL are healthy, all runtime revisions match the source, HTTPS/
denial/privacy checks pass, 50 page-method probes return the bounded 405
contract, startup error-keyword lines are **0**, new kernel OOM lines are **0**,
and the host OOM counter is unchanged. PostgreSQL identity, canonical stopped-
writer counts, production env/Compose/Nginx and rollback pointers are
unchanged. Available disk at recheck was **3,547,288 KiB**. Authenticated
production UI, physical clipboard, sustained load and an isolated restore drill
remain unclaimed.

**Two-round Web features and download protection — accepted in this release:**
19 candidates have bounded source implementations: saved searches, annotation
inbox, manual reading list, read-only version comparison, bounded print draft,
explicit search-result batch archive, file directory, exact-hash duplicate
review, export presets, quick actions, offline checklists, source citations,
continuous search-hit reading, pasted-text import, table TSV/CSV, turn folding,
event-backed lineage, title-trim preview and the synthetic example.
WEB-05/08/11/21/22 remain explicitly unimplemented contract gaps: visitor
projection, independent dual-Reader state, portable tags, genuine read-content
baselines and frozen-share lifecycle. They are not represented by UI
placeholders or counted as delivered features. The offline download fix protects
a reproducible headers-to-file-open cleanup race with short transfer leases;
the original user failure has no network trace, so its exact cause remains
unproven. Existing Share URLs, `.cr`, offline package v1/v2/v3, Dexie v2 and
local data remain compatible.

The implementation record owns the 24-item disposition, CI history, artifact
receipts, deployment gates and remaining product decisions. The historical
source-only and failed-deployment paragraphs below retain their checkpoint
meaning and do not override this current release state.

**Search and Reader recovery — historical accepted release, 2026-10-29.**
Exact **`f8a6a060ddcaf6bd3a6ce14ece78403c70ffc713`** passed all five jobs in
full CI **`40738934749`**, attempt 1. The complete source/run/attempt/job
verification at **02:50:36 Beijing** was after the 50-minute gate.
Web passed **1,822 UX / 36 Context / 100 mutation / 161 Default PWA /
18 authentication / 19 negative PWA** cases; 750 conditional skips remain.
Both 375/1440px offline body/file/annotation workflows passed retained
Reader/URL and initial/replayed code-word pulses within 2px.
API passed **5,903 / three skipped**; settings **463 matrix cases plus one
independent restore**, including the strengthened genuine blocked-deletion
fixture. No alignment, authentication, cleanup or release gate was weakened.

Official artifact **`12842966625`** passed independent archive/OCI/source
acceptance: **35 blobs / 23 layers / 336 embedded API source files**, exact
Web revision and both-end hashes. Fresh actual-artifact capacity/rollback/
idle-queue checks passed without lowering headrooms. Stopped-writer backup
**`chat-reader-20261028T192159Z`** passed all five component checksums,
database TOC and archive checks; the independent follow-up rehashed all five.
The resource-bounded read-only attachment audit verified **358 hashes**, clean.

Production replacement/acceptance completed at **03:31:15 +08:00**, with an
independent **03:32:31** recheck. Current/direct rollback is
**`f8a6a06`/`b4effda`**; the older `c7dc074` image set is retained.
API/Web are healthy, worker `alive_idle`, exact image identities and HTTPS/
denial/privacy checks pass, with zero startup error-keyword lines/restarts
and no new OOM. Schema remains **`20261022_0053`**, with no upgrade/downgrade;
stopped-writer canonical row counts, PostgreSQL identity/start time,
production env/Compose/Nginx and operational checkout are unchanged.
Maintenance was **03:21:43–03:31:15 +08:00 (9m32s)**, not zero downtime.

No local tests/lint/typecheck/build/browser/services/database validated this
release; the record preserves the earlier one-off dependency diagnostic
exception. No production application build, data/volume deletion or backup
pruning occurred. Only the separately authorized obsolete
`f3b331a`/`50f6de4`/`5992d0e` image cleanup preceded this release.
The pre-existing `apps/web/tsconfig.tsbuildinfo` remains untouched/excluded.
Authenticated production UI, physical clipboard, sustained load and an isolated
restore drill for this backup remain unclaimed. The
[release record](docs/execution/SEARCH_RECOVERY_RELEASE_2026-10-28.md) owns
exact identities, failed-run history, verification receipts and boundaries.

**Two-round Web features and download protection (2026-10-30; CI follow-up, not released):**
19 candidates have bounded source implementations: saved searches, annotation
inbox, manual reading list, read-only version comparison, bounded print draft,
explicit search-result batch archive, file directory, exact-hash duplicate
review, export presets, quick actions, offline checklists, source citations,
continuous search-hit reading, pasted-text import, table TSV/CSV, turn folding,
event-backed lineage, title-trim preview and the synthetic example.
WEB-05/08/11/21/22 remain explicitly unimplemented: visitor projection,
independent dual-Reader state, portable tags, genuine read-content baselines
and frozen-share lifecycle need contract work; no UI placeholders claim them.
Migrations 0054→0055→0056 add split receipts, account-scoped feature entries and
short offline transfer leases. A reproducible headers-to-file-open cleanup race
is protected until transfer completion/disconnect; the user's original failure
has no supplied network trace and is not claimed to have that exact cause.
Final local lint/typecheck/build passed, UX **1,856/1,856**, focused API **21/21**
plus duplicate review **2/2**, and Playwright **15/15** (includes two helper
checks and one inventory check). Head is `20261030_0056`. Full local API ended
with 5,724 passes, 192 conditional skips and two lease-test clock failures:
collection-time timestamps expired during the 79-minute run. Tests now create
their clocks per case and the full focused files passed; a new full CI, not that
failed local run, must certify the final source. Buildinfo was restored to its
original pre-task SHA-256 and stays excluded. Final review includes unread-on-add,
membership/limit concurrency, account-isolated search return, lineage paging and
modal keyboard recovery. Full PostgreSQL/PWA CI and production gates are pending.
Production/direct rollback remains the last accepted f8a6a06/b4effda at 0053,
not revalidated by these local checks. User authorized commit, full CI, a fresh
50-minute wait after each dispatch, then deployment only after all release gates.
The precise checklist and receipts are in
[the implementation record](docs/execution/WEB_FEATURE_OPPORTUNITIES_IMPLEMENTATION_2026-10-30.md)
and [testing boundary](docs/testing.md#two-round-web-features--2026-10-30-local-integration).
Exact `bb5d4f4` was pushed; first CI `40956346174` was read after 50 minutes.
API passed 5,924 / three skipped. Web's stale table assertion and settings'
project merge failure blocked release. A mounted reproduction found colliding
New/Merge React keys leaving duplicate portals; distinct scoped keys repair it,
with single-dialog/order/title/close/reopen checks. Fix validation passed
lint/build/TypeScript, 1,856 UX and 19 Playwright cases. Second exact-source CI
`40965493242` passed API/settings but failed Web: four merge-recovery tests
selected the wrong semantic element and a 375px fixed sort menu was clipped by
sticky-header blur. The real mobile issue is repaired by isolating the blur
layer; the test now matches the focused result div. Post-fix build/lint, 1,856 UX
and 19 Playwright pass. This required a fresh complete CI and wait; production
was not changed.
Third full CI **`40973535996`** targeted
`75177a0e5c994f02fdaa20f0e542949fc2138a5b` and was first read at
2026-10-30 08:20:03 +08:00 after the 50-minute wait. API and settings passed;
Web had one Task Center sort-menu focus assertion fail after 170 passes, so
image gates were skipped. The test incorrectly expected an outside pointer
click to return focus to the sort trigger, contrary to the component's contract
that the clicked outside target owns focus. It now clicks the sidebar search
input and checks that it retains focus; Escape separately restores the sort
trigger. Focused Playwright **1/1** and file lint pass. In a complete local
file attempt, 21 cases passed and 12 persistence cases failed because the local
API was not running; this is not counted as a product or full-file pass. A
fresh exact-source full CI is required; production remains unchanged.

**Next-batch optimization (2026-10-29; historical pre-validation checkpoint):**
all 15 directions in the [review](docs/execution/ux-audit-next-batch-2026-10-29.md)
have a bounded [implementation](docs/execution/UX_NEXT_BATCH_IMPLEMENTATION_2026-10-29.md):
project/sidebar pagination and safe ordering, batch outcome checks/progress/stop,
explicit move confirmation, export limits, split result/idempotency/focus/range
recovery, mobile sorting and project-scoped empty actions. Regressions are
authored, not run. Source adds migration `20261029_0054` after `20261022_0053`
for split receipts; no migration has executed. No local tests/lint/typecheck/
build/browser/services/database, CI dispatch, commit, push or deployment ran.
Production, direct rollback, offline/Dexie/archive formats and the pre-existing
buildinfo are unchanged. See the [verification boundary](docs/testing.md#next-batch-project-batch-and-split--2026-10-29-source-only).

**Follow-up review and Web opportunities (2026-10-29; documents only):**
the [follow-up audit](docs/execution/ux-audit-next-batch-followup-2026-10-29.md)
records 10 bounded recovery/form/ordering directions, separating five new
interactions from five inherited issues. The
[Web opportunity review](docs/execution/web-feature-opportunities-2026-10-29.md)
adds 14 user-facing candidates, with existing capabilities, demand hypotheses,
smallest useful scope and acceptance boundaries distinguished. Neither document
is implementation authorization, a verified fix or an accepted product scope.
No product code, tests, CI, migration, commit, push or deployment was changed
or executed by this review; the preceding source-only and production states remain.

**Web opportunity extension (2026-10-30; documents only):**
the [second-round review](docs/execution/web-feature-opportunities-round2-2026-10-30.md)
adds 10 non-duplicate candidates, bringing the two-round pool to 24. Suggested
validation starts with pasted-text import, source-linked quotations, table data
export and continuous search-hit reading. User demand remains hypothetical;
snapshot sharing and read-content baselines require explicit contract design.
No product implementation, runtime verification, CI, commit, push or deployment
ran. Production was not rechecked; its last accepted record above is unchanged.

### Historical implementation checkpoints

The dated source-only entries below retain their original pre-submission
meaning. They do not override the later authorization, exact-source CI,
artifact verification or production state in the release summary above.

**Completeness follow-up optimization (2026-10-28; source implemented, unverified):**
the [source review](docs/execution/ux-audit-completeness-review-2026-10-28.md)
recorded nine bounded gaps: two new recovery/paging interactions and seven
inherited issues. The [implementation record](docs/execution/UX_AUDIT_COMPLETENESS_IMPLEMENTATION_2026-10-28.md)
now covers discard-intent recovery, attachment rename derivation, 500-item
ordering limits, descending custom order, TOC append anchoring, sparse/
relationship-aware previews, shared-string identity and typed ZIP errors.
Regressions are authored, **not executed**; see the
[follow-up verification boundaries](docs/testing.md#completeness-follow-up-optimization--2026-10-28-source-only).
No local gate, browser/service/database check, CI dispatch, commit, push or
deployment ran; this batch remains unaccepted.

**Reader completeness and recovery (2026-10-28; local, unsubmitted):**
the [12-direction review](docs/execution/ux-audit-optimization-directions-2026-10-28.md)
now has a bounded [source implementation](docs/execution/UX_AUDIT_OPTIMIZATION_2026-10-28.md).
Custom Share expiry cannot silently become permanent; copying has feedback and
manual recovery. Same-tab comment drafts persist in existing account-scoped
settings with CAS and explicit recovery. Current-conversation search resets on
content changes, paginates and discloses bounded matches/totals. Owner/Offline/
Share TOCs, offline file references and conversation lists expose continuation.
Attachment upload queues support per-file retry/cancel and check unknown
finalization before replay; bounded complex previews disclose truncation.
Capability documentation is reconciled. Search candidate/grouping performance
remains conditional: only a synthetic measurement protocol is delivered, not an
unmeasured query rewrite. Regression cases are authored, **not executed**.
No local tests/lint/typecheck/build/browser/services/database, CI dispatch,
commit, push or deployment ran. See the [verification boundaries](docs/testing.md#reader-completeness-and-recovery--2026-10-28-source-only).
All unsubmitted batches remain unaccepted; production/rollback, schema,
offline packages v1/v2/v3 and Dexie v2 are unchanged.

**Search lifecycle and replay (2026-10-27; local, unsubmitted):**
the [review](docs/execution/ux-audit-search-lifecycle-2026-10-27.md) now has a
bounded implementation follow-up. Repeating an equivalent Library search target
reuses the existing Reader with an in-memory activation, not a URL nonce or wider
remount. File/annotation targets reveal filtered-out rows; single-item annotation
review aligns once without discarding drafts or modes. Read-only annotation
projection prefers local entities/tombstones. A narrow content subscription
invalidates old hits, coalesces serialized rebuilds and fences stale/auth-retired
work; explicit retry can reattach a failed watcher. SEARCH-CAP was deferred at
this checkpoint; its source follow-up is the 2026-10-28 batch above.
See the [source contract](docs/system/PWA_OFFLINE_RESILIENCE_CONTRACT.md#search-lifecycle-and-replay--2026-10-27-source-only),
[implementation record](docs/execution/SEARCH_LIFECYCLE_2026-10-27.md) and
[verification boundaries](docs/testing.md#search-lifecycle-and-replay--2026-10-27-source-only).
Cases are authored, not executed; no local runtime checks, browser/services, CI,
commit or deployment ran. All three search batches remain unverified; production,
rollback, schema and offline formats are unchanged.

**Scoped search and offline entries (2026-10-27; local, unsubmitted):**
the [review](docs/execution/ux-audit-search-recall-2026-10-27.md) has a source
implementation follow-up. The optional offline message-version field is declared;
conversation-scoped online search preserves distinct identical messages, while
global/project hash folding remains. Offline queries filter conversation/type/role
before the result limit and separate content from global titles. Library results
reuse canonical body ranges and file/annotation destinations without leaving
`/library`; retired asynchronous selections cannot reopen old results.
Regression cases are authored, not executed. No local tests, lint, typecheck,
build, browser, services, CI dispatch, commit or deployment ran. See the
[implementation record](docs/execution/SEARCH_RECALL_OFFLINE_2026-10-27.md) and
[verification boundaries](docs/testing.md#scoped-search-and-offline-entries--2026-10-27-source-only).
This closes the type omission in source, not the pending real typecheck gate.
The search work remains unverified; production/rollback is unchanged.

**Search correctness and exact navigation (2026-10-27; local, unsubmitted):**
literal SQL wildcard escaping, canonical Unicode code-point match ranges,
bounded match construction and shared exact result links are implemented.
Attachments open the existing file panel; annotations use their saved anchors,
not comment/extract offsets. Content-free links hydrate only against the
authorized current RenderBlock; stale/invalid ranges fall back without an
exact highlight. Offline v1/v2/v3 and Dexie v2 remain unchanged. Regression
cases and documentation are authored, but no local tests, lint, typecheck,
build, browser or services ran under the user's no-local constraint. No CI
dispatch, commit or deployment is authorized for this batch. See the
[current source contract](docs/system/BACKEND_AND_API.md#搜索与编辑),
[verification boundaries](docs/testing.md#search-correctness-and-exact-navigation--2026-10-27-source-only)
and [implementation record](docs/execution/SEARCH_CORRECTNESS_2026-10-27.md).
The accepted production/rollback remains `b4effda`/`c7dc074`, recorded below.

### Earlier accepted releases (historical)

**Deployed and accepted (2026-10-25): bounded ChatGPT reading/import compatibility and
noise-matching precision fixes.** The
[continuation](docs/execution/CHATGPT_READING_REMAINING_2026-10-25.md) completes
the evidenced follow-ups to the original 20-candidate audit; that audit's two
implemented/eighteen-deferred checkpoint remains historical. Display policy
`ai-rich-markdown-v7` preserves unsupported HTML visibly and inertly, protects
nested fenced examples, and retains all-or-nothing rich-layout recognition.
Import completion exposes all warnings; mapping offers bounded rendered/source
previews; Mermaid retains supplied descriptions and accessible source.
Exporter parser `chat-reader-import-v6` rejects non-string `say` rather than
coercing it; missing/null values retain explicit empty-text warnings.
Canonical text, schema, Share URLs, archives, offline packages and Dexie remain
unchanged. Sample-dependent adapters are not invented or counted as completed.
See the [current contract](docs/system/AI_RICH_MARKDOWN_CONTRACT.md#bounded-chatgpt-rich-text-reading-fallback)
and [local validation limits](docs/testing.md#chatgpt-reading-compatibility--2026-10-25-local-only).
Noise rules preserve intentional edge whitespace through trial/save/rescan;
bounded trial samples span messages and identify the actual match mode without
weakening protected-candidate confirmation. Exact source **`c7dc0749e3ba18394cb0a37b8d66e9f01837c5a8`**
passed all five jobs in CI **`40199643009`** after the required wait gate.
Independent official-artifact/OCI/source verification and stopped-writer
five-component backup **`chat-reader-20261025T145945Z`** passed. Production
accepted at **2026-10-25 23:08:17 +08:00**; current/direct rollback is
**`c7dc074`/`3fbf79d`**, both at **`20261022_0053`**. Runtime health, worker
freshness, HTTPS/denial, unchanged PostgreSQL/config/Nginx and no new OOM passed;
23:11 +08:00 recheck remained healthy. No migration, production build,
user-data/volume deletion or backup/image pruning. See the
[release record](docs/execution/CHATGPT_NOISE_RELEASE_2026-10-25.md).
Authenticated production UI, physical clipboard and sustained load are unclaimed.

**Noise/CI corrections (2026-10-27; deployed and accepted):** retain the
trial-sampling, code/container, link/URL and table-boundary fixes. Dollar math
now closes at an equal-width delimiter inside its actual inline scope; valid
multiline math remains protected. Complete link titles cannot steal later code
delimiters. Unsupported HTML flow displayed as literal code is protected;
recognized simple rich layouts retain ordinary-text matching. Ambiguous rich
layouts keep conservative protection rather than guessing their projection.
The standalone bare-bracket LaTeX reproduction is covered, without claiming
complete parity with every AI-math adapter. The #36 monotonic provenance fast
path is withdrawn because including construction cost regressed sparse
synthetic detection; Unicode source-envelope mapping is retained. #120 keeps
all 41 immutable action refs, with repaired SHA-aware CI contracts. Shared
application-renderer/API fixtures and normal/legacy scan-apply checks are
version-controlled. See [current cleanup semantics](docs/system/CONTENT_CLEANUP_CONTRACT.md),
[review fixes and validation](docs/execution/ux-audit-noise-matching-2026-10-25.md#37-review-fixes-and-application-renderer-contract--2026-10-27),
and [remaining boundaries](docs/system/KNOWN_ISSUES_AND_UNCERTAINTIES.md#current-verification-boundaries--2026-10-27).
Earlier checkpoint counts and receipts remain historical. The user now authorizes
committing and deploying this reviewed batch; that release gate is complete.
CI run `40451679590` (source `0c5f033`) failed in the unrelated
default-PWA Task Center keyboard-focus assertion after the dedicated noise
cleanup gate passed; downstream auth/PWA-negative and image jobs were skipped.
The user subsequently authorized debugging CI to completion without local
test/build/browser execution. The narrow repair moves Task Center focus
restoration from a single mutation animation frame to the committed DOM
replacement, and adds held retry/cancel response and deliberate-focus tests.
The exact source `b4effda45c74b0295823736a7da5db70265f57dd` passed all five jobs
in CI run `40463956431`, attempt 1; the result was first read at
`2026-10-27 07:45:12Z`, after the required 50-minute gate. The official
artifact `12717900348` matched its GitHub digest; independent verification
passed 35 OCI blobs, 23 image layers, 21,339 layer entries and 336 embedded API
source files with no forbidden paths. Production accepted at
`2026-10-27 16:06:17 +08:00` after a stopped-writer five-component backup
`chat-reader-20261027T075731Z`. Current/direct rollback are now
`b4effda`/`c7dc074`; schema remains `20261022_0053`. API/Web/worker revisions,
health, HTTPS/denial/privacy checks, unchanged PostgreSQL/config/Nginx,
canonical counts, startup logs and OOM counters passed. No migration,
production build, user-data/volume deletion, configuration change or backup/
image pruning occurred. Authenticated production UI, physical clipboard and
sustained load remain unclaimed. See the
[release record](docs/execution/NOISE_REVIEW_RELEASE_2026-10-27.md).

**Previous accepted release (2026-10-24): reviewed system optimization.** The
[short disposition and follow-up plan](docs/system/CONTINUOUS_OPTIMIZATION_BACKLOG.md)
replaces the open-ended candidate pool: 15 completed records retained, one
repaired and four reverted. Commit-aware import-source protection, safe task
errors, scoped/surviving result links and code-copy recovery remain; fixed
attachment recovery messages now survive error redaction. The extra release-doc
checker/snapshot and unused health-helper exception change are removed. Of 111
unfinished candidates, 108 leave the plan. On the user's bounded continuation,
#135 now filters deleted or no-longer-owned import results while retaining
archived/legacy results; at that review checkpoint #120 and conditional
read-only #133 were not started. The local workflow files now contain #120's
unsubmitted SHA pins. Original verification
and limits are preserved in the [dated review](docs/execution/SYSTEM_OPTIMIZATION_REVIEW_2026-10-24.md).
The user subsequently authorized this reviewed batch's submission/deployment,
not a new optimization cycle. After the first audit-blocked CI, existing
transitive Zod moves to fixed 4.6.6 and a withdrawn advisory's stale exception
is removed; the shipped braces guard and all release gates remain.
Exact source **`3fbf79dd0f1da2906ff32d202dfa85cb8544c612`** passed all five jobs
in CI **`40095860923`**, first read after its fresh 50-minute gate. Independent
artifact/source verification and stopped-writer five-component backup passed.
Production accepted at **2026-10-24 22:02:16 +08:00**; then-current/direct rollback
was **`3fbf79d`/`18d4971`**, schema **`20261022_0053`**. Backup:
**`chat-reader-20261024T135352Z`**. API/Web/worker health, exact revisions,
HTTPS/denial, unchanged PostgreSQL/config/Nginx and no new OOM passed.
No production build, migration, data/volume deletion or backup/image pruning.
See the [release record](docs/execution/SYSTEM_OPTIMIZATION_RELEASE_2026-10-24.md);
authenticated production UI, physical clipboard and sustained load are unclaimed.

**Previous accepted release (2026-10-23): noise rules, summaries and image slider.** Imports
preserve complete summary source; legacy automatic cleaning is now read-only.
Reader, Share and Offline fold only a conservative opening, duration-terminated
summary, without trusting historical block flags or hiding ordinary introductions.
The summary noise rule defaults off only when no personal preference exists;
saved enablement and pinned scans remain intact. Citation/footer boundaries,
fuzzy anchors/deduplication, Markdown protection and literal-rule editing/trials
are corrected. No historical text restoration, migration, offline/Dexie format
change. The user subsequently authorized commit and deployment of the completed
work, including the pending image slider below. Full exact-source CI must pass;
wait 50 minutes after each dispatch before reading results, then independently
verify the artifact, back up and deploy without production builds/config changes.
Initial source `c08953b` was submitted; full CI `39949370623` failed and
produced no deployable artifact. Its stale import assertion and desktop image
menu occlusion were repaired. Exact source
`18d4971339a0927bdf4120680aa16ce36365098d` passed all five jobs in CI
`39958042690`, and the official artifact was independently verified. Production
was accepted at **2026-10-23 22:06:42 +08:00**; then-current/rollback were
`18d4971`/`0f116fe`, schema remains `0053`. The five-component backup is
`chat-reader-20261023T135839Z`; no database downgrade, production build,
configuration/Nginx change, import/volume change or OOM occurred. The user
separately authorized deleting old release transfer archives: 18 removed,
recent/current/rollback archives retained; no backups, images, user data or
configuration were removed.
See the [current cleanup contract](docs/system/CONTENT_CLEANUP_CONTRACT.md)
and [release record](docs/execution/NOISE_SUMMARY_RELEASE_2026-10-23.md).

**Deployed (2026-10-23): magnetic image-scale slider.** The owner image control
now opens a continuous 1–100% slider instead of the percentage list. Fast pointer
movement attracts to 25/50/75/100%; slow dragging and keyboard retain exact 1%
adjustment. Drag release commits once, with explicit preset buttons; cancelled
gestures do not save. Original bytes, existing URLs and the bounded file-drop
behavior are unchanged. Initially held without submission, it is now included in
that release; the current batch retains this interaction unchanged. See the
[current behavior](docs/system/MESSAGE_MARKDOWN_COPY_CONTRACT.md#owner-selected-image-size).

**Deployed and accepted (2026-10-23): compact image scale and bounded file drop.**
The owner image-scale UI is now a lower-right floating 1–100% selector; original
bytes, original-relative sizing and existing public-link semantics are unchanged.
Workspace file drag now shows a dimmed/blurred surface with explicit central and
sidebar Import targets. Ordinary page drops no longer import, while the Markdown
source editor retains attachment-at-cursor uploads and Context continuation keeps
its local update target. No migration, API, offline package or Dexie change. Web
lint, typecheck and production build passed before the user stopped additional
local validation. Source `0f116fe012bc1ed39eced7d9289caf94975f336e` passed all five
jobs in CI `39897308692`, first read after the required 50-minute wait. Independent
artifact acceptance passed; production accepted at **2026-10-23 13:00:36 +08:00**.
API/Web are healthy, worker is fresh, PostgreSQL/config/Nginx remain unchanged,
and no deployment OOM occurred. Verified stopped-writer five-component backup is
`chat-reader-20261023T045237Z`; direct rollback is `cfaa6ed`, both at 0053.
No authenticated production UI or sustained-load acceptance is claimed.
See the [release record](docs/execution/IMAGE_SCALE_DROP_RELEASE_2026-10-23.md).

**Previous accepted release (2026-10-23): original-relative image scale.** Owner inline images
have a 1–100% control, original/target dimensions and Restore 100%. Original bytes
are retained; the same attachment and previously published URL follow the saved
selection. External caches/forced widths are not controllable. Source-bound
metadata and existing derivatives are reused; no migration or offline format
change, head remains `20261022_0053`. The release also upgrades existing Next to
16.4.1 and DOMPurify to 3.4.17 after the first CI's security-audit failure; no
new direct dependency or audit exception. Read-only size inspection now checks
stored/actual encoded bytes before Pillow, with original-access recovery. See the
[current contract](docs/system/MESSAGE_MARKDOWN_COPY_CONTRACT.md#owner-selected-image-size)
and [implementation/release record](docs/execution/IMAGE_DISPLAY_SCALE_2026-10-23.md).
Exact runtime source `cfaa6edb43ebf3fe302cb2feb06c64689c0bb670` passed all five
jobs in run `39848602312`, checked only after its required 50-minute wait.
Independent artifact acceptance verified 35 blobs, 343 source files and archive
SHA-256 `b036b4ca2f1a4bb2ca8b12e3879945574a58a186d7ffff34f7cac919fd445fe5`.
Production accepted at **2026-10-23 05:30:52 +08:00**: API/Web/worker match the
source, health/HTTPS and denial checks pass, PostgreSQL/config/Nginx and canonical
row counts are unchanged, with no deployment OOM. Stopped-writer five-component
backup `chat-reader-20261022T212316Z` is verified; direct rollback is `8ca8e90`.
The release includes unchanged-query/early-Back input recovery and a 44px View
hit area that does not enlarge the selected bitmap. First/second failed runs and
their separate 50-minute waits remain in the execution record. No authenticated
production UI, installed external-client or sustained-load acceptance is claimed.

**Current work (2026-10-22): single-message Markdown copy.** The owner Reader's
top copy action is immediately before bookmark. It prepares complete canonical
source, publishes only explicitly copied images as stable public URLs, converts
bounded SVG to inert PNG, and omits other attachment nodes. Share/Offline/admin
read-only views cannot publish. Auth/version retirement and clipboard fallback
are covered; portable archives, Dexie and offline versions are unchanged.
Source Alembic has one new head **`20261022_0053`** (parent `20261017_0052`).
See the [current contract](docs/system/MESSAGE_MARKDOWN_COPY_CONTRACT.md) and
[implementation/release record](docs/execution/MESSAGE_MARKDOWN_COPY_2026-10-22.md).

**Previous release (2026-10-22, historical): deployed and accepted.** Exact source
`8ca8e906ddf90fb7029efea24d6504316213c43f` passed all five jobs in workflow
run `39767746528`; the independently verified image archive SHA-256 is
`d07895113d0757aa41f3fa429d4985ce55d7c4d81fce5711d641ca18ca00c984`.
Production runtime acceptance confirmed API/Web/worker at that revision,
schema `20261022_0053`, unchanged PostgreSQL/config and canonical row counts,
healthy services, HTTPS/public-route denial checks, clean startup logs and no
deployment OOM. The five-component backup was verified before migration;
rollback image remains `91e015e`. See the [release record](docs/execution/MESSAGE_MARKDOWN_COPY_2026-10-22.md).
The first three guarded attempts aborted and restored the prior app; attempt 4
passed. No migration downgrade was performed.

### Previous table-release preparation checkpoint (historical)

**Release authorization (2026-10-22):** the user requests commit and deployment
of the shared-body table/compact structure work below. This supersedes its
local-only release boundary for this batch, not its validation limits. Verify
the existing source/artifact receipts, exclude the pre-existing generated
`tsconfig.tsbuildinfo`, commit/push and start the complete `Build release images`
workflow. **Stop after CI starts and wait for the user's result before
deployment.** Use existing local credentials and GitHub API/CLI only, without
login or GitHub web UI. No production operation has started in this batch;
no new migration. See the [release record](docs/execution/TABLE_BODY_RELEASE_2026-10-22.md).

**Current local scope (2026-10-22): shared body tables and compact structure
editing.** Normal message tables and the Table tool now share presentation
primitives, in addition to their existing semantic parser. Long body cells have
bounded wrapping/local overflow. The tool can insert/delete the focused row or
column across the whole draft, with bounded structural Undo. Following the
user's density feedback, row/column menus and Undo live in the header; there are
no per-cell action handles or separate Undo bar, and a small table starts with a
96px Markdown input. The safe 44px edge-control gutters remain after a tighter
trial failed the existing no-overlap gate.

Local gates pass: **1,522 service-free tests (including 105 focused tests),
81 Chrome scenarios, two source-contract Playwright checks, lint,
nonincremental typecheck and one-worker production build**. The browser gate
mounts real body MarkdownRenderer and tool/workspace/CodeMirror code with
explicit external adapters; it is not authenticated Reader/Share/Offline
end-to-end or server-memory acceptance. No new dependency, migration or data
format. Exact-source body-to-editor entry and expanded viewing remain proposals,
not implemented features. The implementation checkpoint was local only;
the new release authorization above now governs push/CI/deployment. See the
[implementation and evidence](docs/execution/TABLE_BODY_SHARED_PRESENTATION_2026-10-22.md).
The following 2026-10-21 release notes are historical checkpoints, not the
release status of these new changes.

### Previous release and table checkpoints — 2026-10-21

**Release authorization (2026-10-21):** the user now requests commit and
deployment of the completed local table work and bounded backup/preflight
repair. This supersedes the earlier no-push/no-CI/no-deployment boundary for
this release only. Run the complete `Build release images` workflow against
the exact submitted source, then stop and wait for the user's CI result
before deployment. Run `39561847297` first failed the 375px English/Chinese
attachment Viewer Escape-return cases; that UI defect is repaired. Its exact
repair commit `39632abe017bf422272be6691a775d967a9605af` then passed API, Web
and settings quality, but image build run `39593070512` failed before the API
build could start: ECR Public returned `429 Data limit exceeded` for the
pinned Python base image. Logs also confirm the disposable PostgreSQL jobs
encountered the same ECR throttle and succeeded through the already-verified
Docker Hub digest fallback. A bounded, digest-preserving ECR→Docker Hub fallback
for both Python and Node image bases is now under repair; the full workflow
must rerun on the repair commit and the user must report its result. Do not
deploy from either failed run. The complete API-backed browser checks passed
in run `39593070512`; no production action has started.
No production action has started; schema remains 0052.
See the [release preparation](docs/execution/TABLE_TOOL_RELEASE_2026-10-21.md).

**Current local scope (2026-10-21): table phase closed.** At the user's request,
stop open-ended table work; remaining extreme-table long tasks are a
conditional backlog, not a reason to keep changing the editor. Bidirectional
editing, simplified entry, edge `+`, paging and Apply/Undo are locally verified.
The final **122 focused / 1,513 service-free / 76 Chrome** checkpoint still
matches all 20 source/test hashes and 29 evidence artifacts. No table product
code changed during closeout. See the [value/closeout review](docs/execution/ux-audit-table-closeout-2026-10-21.md).

**Bounded next step (2026-10-21):** locally repaired backup/preflight's implicit
Compose-build path. A shared shell reader pins the existing API container/image,
checks all four data mounts and reads them only in a no-pull, networkless,
read-only 64 MiB helper; stopped-writer backups remain supported. Real shells
with synthetic Docker pass **67 tests / 1 Windows-only flock skip** across four
operator/recovery files. This is not actual Docker, PostgreSQL restore, Linux
resource or production acceptance. See the [repair and limits](docs/execution/OPS_BACKUP_READERS_2026-10-21.md).
No new migration, CI, push or deployment; existing local work/evidence is retained.
The table optimization goal is closed, not converted into another unlimited audit.

### Historical table checkpoints — superseded by the closeout above

**Withdrawn local trial (2026-10-21):** a React `onBeforeInput` optimization
passed content tests but did not execute on actual Chrome typing: a counting-
only probe observed `textInput` without `inputType`, zero hint-path calls and
five fallback calls. The new callbacks, trust hints, state and dedicated trial
test were removed; all 20 source/test hashes restore the delimiter-fix
checkpoint below. No input-latency improvement is claimed. See
[the trial/correction record](docs/execution/ux-audit-table-raw-input-2026-10-21.md).
The original conservative draft reuse remains, and large-table long tasks are
still open. The unlimited local goal remains active; no migration or release.

**Latest local continuation (2026-10-21):** fixed a parser inconsistency where
GFM-valid header/body cells such as `---` and `:---:` made the Table tool
unavailable even while the shared renderer displayed the table. Full, fast and
incremental draft parsing now preserve those cells; automatic discovery uses
the first eligible separator after a header, while ambiguous complete selections
still fail closed. Actual GFM before/after HTML, desktop Apply/Undo, edge-added
rows, surrounding pipe prose and 375px touch are covered. **122 focused, 76
Chrome, 69 files / 1,513 service-free checks**, lint, nonincremental typecheck
and single-worker build pass locally. See
[the delimiter-content review](docs/execution/ux-audit-table-delimiter-content-2026-10-21.md)
and its adjacent evidence. No migration, CI, push or deployment; the unlimited
local goal remains active.

**Active local work (2026-10-21):** the source editor Table tool now uses one
editable rendered table above editable Markdown, with bidirectional updates,
four edge `+` controls and bounded row/cell paging. Invalid or stale drafts
cannot overwrite source; application is one undoable CodeMirror transaction.
The latest [input/layout continuation](docs/execution/ux-audit-table-input-layout-2026-10-21.md)
preserves Unicode cell-boundary content, repeated grid/raw edits and horizontal
boundary focus. It retains bounded canonical-row/plain-draft reuse but withdraws
direct-table rendering and DOM/frame-write experiments with no stable input
latency gain. All previews still use the shared GFM/math chain. Six source-bound
local gates pass: **117 focused**, **69 files / 1,508 service-free cases**,
**72 Chrome scenarios**, lint, nonincremental typecheck and one-worker build;
20 source/test hashes stay unchanged. Large-table long tasks remain, with no
server OOM or real-device acceptance. The unlimited-budget goal stays active.
The preceding [row-boundary review](docs/execution/ux-audit-table-page-navigation-2026-10-21.md)
adds direct first/last-page controls without removing bounded rendering. Keyboard
focus stays on an enabled pager control at either boundary; 320/375px touch can
edit the last row and undo once without saving. At that checkpoint, all six source-bound local gates
pass: **111 focused**, **69 files / 1,502 service-free cases**, **67 Chrome
scenarios**, lint, nonincremental typecheck and one-worker build; 20 source/test
hashes stay unchanged. Phase-scoped profiling still finds main-thread long tasks.
The preceding [pending-parse review](docs/execution/ux-audit-table-pending-parse-2026-10-21.md)
reproduces and repairs Apply staying enabled while raw Markdown parsing was still
pending behind an old verified preview. Both parsing and rich-preview catch-up
now block Apply, new cell entry and edge actions; only the latest parsed input
can become the applied table. That source-bound local rerun passes **111 focused**,
all **69 files / 1,502 service-free cases**, **64 Chrome scenarios**, lint,
nonincremental typecheck and one-worker build; 20 source/test hashes stay unchanged.
The [adaptive-input continuation](docs/execution/TABLE_TOOL_ADAPTIVE_PREVIEW_2026-10-20.md)
also archives deferred source parsing, canonical row/UTF-8 delta updates and the
120-cell large-input preview budget, with its wide-table exception and remaining
main-thread long tasks. Neither record accepts server OOM or cross-device latency.
The preceding [literal-backtick review](docs/execution/ux-audit-table-code-span-2026-10-20.md)
repairs false rejection of already-rendered tables containing unmatched inline
backticks. Only runs with an equal-length closer establish code context; literal
ticks cannot hide column boundaries or actual HTML structures. The existing cell
scanner and pipe serializer share a lazy per-row/cell linear match index, not a
global cache. Actual GFM output stays equal across 900 synthetic escaped-pipe/
backtick/backslash combinations. Final local gates pass **111/111** focused
checks (including **20** common-focus checks), **62/62** Chrome workspace
scenarios, all **69 service-free UX files / 1,502 cases**, Web lint,
nonincremental typecheck and single-worker build. Desktop Apply/Undo, raw/grid
edits and 375px touch remain exercised; 20 source/test hashes stay unchanged
during the gates. Large-table long tasks still occur in the opt-in profile.
The preceding [HTML-cell review](docs/execution/ux-audit-table-html-cells-2026-10-20.md)
repairs false rejection of literal HTML examples and attribute prose in Markdown
cells. Structural-tag checks now live in the existing cell scanner, shared by
whole-table and incremental validation; actual HTML table structures remain
unsupported. Code/escapes/reference data stay literal, and no HTML-rendering
policy is relaxed. Desktop Apply/Undo and 375px touch correction are exercised.
The preceding [input review](docs/execution/ux-audit-table-input-2026-10-20.md)
repairs a shared modal-keyboard bug: an Escape intended to cancel IME composition
closed the Table tool and discarded its unapplied draft. The shared focus hook
now leaves composing, legacy-229 and already-handled events to their owner.
Native Chrome CDP composition verifies trusted Escape in both cell and Markdown
inputs, followed by ordinary Escape behavior; physical candidate windows and
other browsers remain unverified. The preceding
[recovery-action evidence](docs/evidence/table-tool-recovery-actions-2026-10-20.json)
removes the dead Apply action when no table is available; the concise recovery
reason describes the dialog, and Back to source restores editor focus.
Invalid or stale drafts of an identified table retain their editable Markdown
and disabled Apply safeguards. The preceding
[empty-state continuation](docs/execution/TABLE_TOOL_EMPTY_STATE_2026-10-20.md)
records the earlier removal of the inert blank Markdown editor.
The preceding [GFM-context continuation](docs/execution/TABLE_TOOL_GFM_CONTEXT_2026-10-20.md)
repairs three observed editor/renderer disagreements: textarea contents after a
blank line are literal, their definitions cannot leak into an outside table,
and a real table after a quoted HTML blank boundary stays editable. Sources
containing `<` get one bounded read-only probe through the existing renderer,
not a second HTML scanner; it emits no preview DOM and is reused during edits.
Its source-position map composes the existing math/rich-layout projections.
Complete explicit selections still edit examples without removing wrappers.
Oversized/incomplete context fails closed with selection recovery; ordinary
Markdown retains the frozen editor-tree reuse path. Reference extraction uses
same-width masking and the original label/URL spelling, never rewritten source.
The preceding [edge-reachability continuation](docs/execution/TABLE_TOOL_VIEWPORT_EDGES_2026-10-20.md)
keeps all four `+` targets around the visible preview, outside its scrollable
cells and scrollbars. Wide/long tables no longer hide these controls at their
full-content midpoint; additions still target the whole draft and focus the new
cell. It uses CSS layout, not scroll/resize listeners or a second table.
The preceding [code-context continuation](docs/execution/TABLE_TOOL_CODE_CONTEXT_2026-10-20.md)
repairs all five previously observed fence/container mismatches. Automatic
discovery now uses CodeMirror's Markdown code-block context instead of a second
fence scanner, normally reusing the exact editor snapshot. An explicit complete
selection still permits editing examples. Nested-list tables render a neutral
editable preview while Markdown and Apply preserve their original indentation.
The preceding [keyboard/focus continuation](docs/execution/TABLE_TOOL_NAVIGATION_2026-10-20.md)
keeps vertical navigation across row pages, focuses newly added edge cells and
preserves native Shift+arrow text selection inside a cell. Enter at the final
row keeps editing instead of closing the input. Deferred focus never overrides
a newer move to Markdown or another control.
The preceding [bracket/fence continuation](docs/execution/TABLE_TOOL_BRACKET_INDEX_2026-10-20.md)
removes quadratic suffix rescans for unclosed nested image syntax, retaining
code/escape/reference semantics with one lazy per-operation linear index.
Its former line-by-line fence scan removed exponential regex backtracking;
the newer context repair supersedes that scan without restoring the regex.
Oversized cell input is rejected before syntax allocation under the existing
1 MiB tool budget; accepted content is never truncated. Earlier checkpoints
retain their own counts and source bindings rather than inheriting the latest
gate results.

Earlier dated checkpoints retain their original source bindings:
[workspace/Undo integration](docs/execution/TABLE_TOOL_WORKSPACE_2026-10-20.md),
[math/code/reference fidelity](docs/execution/TABLE_TOOL_CONTENT_INTEGRITY_2026-10-20.md),
[long-cell display bounds](docs/execution/TABLE_TOOL_LONG_CELL_2026-10-20.md)
and [parser reuse/pending-preview protection](docs/execution/TABLE_TOOL_PARSER_REUSE_2026-10-20.md).
Raw Markdown values stay synchronous while source parsing and rich previews may
be deferred. Display-only cell shortening and the normal 400-cell/adaptive
120-cell page budgets preserve full Markdown and Apply data; a complete header
plus one data row still allows 400 mounted cells for a 200-column table.
General large-table main-thread long tasks remain; no cross-device latency or
server-memory/OOM acceptance is claimed.
The five-case GFM comparison now agrees on identical renderer output. Its
earlier failure is preserved, and 500 bounded contexts are checked against
actual GFM code rendering rather than the old scanner's incorrect semantics.
Standalone transformations without a usable editor snapshot parse only the
prefix through the table header; work can still grow with a very large prefix.
No global AST cache or full code-context/real-device performance acceptance is
claimed.
The preceding [literal-context checkpoint](docs/execution/TABLE_TOOL_LITERAL_CONTEXT_2026-10-20.md)
passed 75 focused/49 Chrome cases but was insufficient: it missed the textarea
cases and introduced a false refusal of a legitimate quoted table. Those
failures remain recorded separately; the latest probe repairs the observed
cases without relabeling the earlier green scope as complete HTML acceptance.
The probe caps input at 1 MiB UTF-8, traversal at 100,000 nodes and retained
ranges at 8,192. These are fail-closed work/result bounds, not a parser-time SLA.
The prior 200-column row-control probe and a subsequent long-table column-control
failure are retained separately from final passes. New Chrome coordinate/hit-test
checks cover horizontal/vertical start, middle and end, 1440px desktop and 375px
touch. The short landscape dialog may still scroll its working area normally;
controls never require searching the table's full-content midpoint.
This work remains local, with no new migration, push, CI or deployment; it is
not a production, full Reader/Offline/Share or server-resource acceptance.
At these historical checkpoints the optimization goal had no token budget.

### Last accepted release — historical audit, not rechecked during closeout

**Accepted release (2026-10-19):** production runs exact source
`50f6de4b2e72ad33bd4d351ada6f95c0b3583898`, independently audited at
**2026-10-19 12:27:23 UTC / 20:27:23 +08:00**. Exact-source CI **39231559224**
attempt 1 passes all five jobs; the deployed API/Web digests match its manifest.
API/Web/PostgreSQL health, worker `alive_idle`, HTTPS and login-page smoke pass.
All three applications have zero restarts/OOM at acceptance and the later
12:50 UTC recheck. No new kernel OOM since API startup was found at audit.
Five reviewed Web errors named invalid Server Action ID `x`; a synthetic
negative check returned 404. They are not described as zero error-keyword lines.

Schema remains **20261017_0052**: the migration command completed with no
pending schema upgrade and unchanged administrator deployment configuration.
PostgreSQL was not restarted; production `.env`, operational checkout and user
import data were not changed. Current/direct rollback is **50f6de4/f3b331a**,
both at 0052. Older rollback across 0052→0051 still requires the consent-revoking
downgrade before old code starts.

Fresh verified five-component backup: **chat-reader-20261019T115316Z**.
Following successful release acceptance, existing retention removed three
older verified backups and kept this recovery point plus
**chat-reader-20261018T160748Z**. Unchanged components may share hardlinks;
these are not independent physical copies. Only current/direct-rollback
application images remain. After transfer-archive cleanup, root filesystem
available space is about **9.0 GiB**. See the
[release and cleanup record](docs/execution/OOM_RELEASE_2026-10-19.md) and
[sanitized acceptance evidence](docs/evidence/oom-release-2026-10-19.json).

The [import/export repair](docs/execution/OOM_IMPORT_EXPORT_FOLLOWUP_2026-10-19.md)
and [search/gzip continuation](docs/execution/OOM_SEARCH_GZIP_FOLLOWUP_2026-10-19.md)
are now included in production. Their earlier local failures, focused test
counts and environment limits remain historical; deployment does not relabel
those attempts as passes. The previous feature release's schema/data checks
remain in its [historical record](docs/execution/FEATURE_RELEASE_2026-10-19.md),
not a claim of a new full data comparison in this deployment.

Shared RAM remains about **1.83 GiB**, with about **340.5 MiB** available at audit.
This is **not** 60-minute/2 GiB workload, Docker PID 1 or authenticated browser
acceptance, nor proof that all OOM paths are fixed. Fixed default Skill ZIPs
remain unchanged. A preflight one-off unexpectedly built an unused `latest`
image because the helper did not pin an existing image/fail closed on builds;
that image was removed. Hardening preflight/backup against implicit builds is
an unresolved **P1 in production**; the local-only repair above has not been
released or Docker-accepted. Do not use unsupported Compose flags as a workaround.

**Historical production incident (2026-10-18, read-only evidence):** at
**10:31:45 Asia/Shanghai / 02:31:45 UTC** the kernel recorded another host-level
`global_oom` and killed API `uvicorn`; API restarted eight seconds later
(observed restart count 1), worker/Web remained at zero restarts. The ~1.83 GiB
host had ~180 MiB available at the later observation. This proves the victim
and restart, not noise scanning as the sole cause. No production mutation or
new diagnostic process was used. [Sanitized evidence](docs/evidence/import-service-oom-2026-10-18.json).
The earlier 2026-10-17 release acceptance remains historical, not a claim of
zero restarts through the present observation.

Verification overlay (2026-10-16): the [service-free continuation](docs/execution/ux-audit-service-free-regression-2026-10-16.md)
ran all **63** current `scripts/ux/*.test.mjs` files: **1,412 passed / 0 failed /
0 skipped**, plus full Web lint and nonincremental typecheck. Dated source-only
rows below retain their original batch's execution boundary; for the named Node
files, this newer run supersedes “authored but unexecuted.” It does not verify
unlisted regressions, mounted/browser behavior, IndexedDB/Worker, PostgreSQL,
full API/PWA/build, resource usage or deployment. On 2026-10-16 the user
explicitly authorized the release path; local lint, typecheck and Web build have
passed. Full local API tests passed **1,129 / 159 skipped**; a separate disposable
PostgreSQL 17 range migration/concurrency suite passed **2/2**. Full PostgreSQL 16
acceptance remains for CI. The local PWA attempt stopped after two timeouts because the API
was not running; it is not a passing browser gate. Those are historical local checkpoints. Exact-source CI **38902167421** attempt 2
now passes all five jobs for `aea13fe`; original images/support were independently
verified. Production accepted **`aea13fe` / `20261015_0051`** on 2026-10-16
at **15:34:26 UTC**. A fresh five-component backup precedes the user-authorized
non-deleting isolation of **12 files / 974,628 bytes**. All 84 stopped-writer
pre-existing-column fingerprints, four post-isolation storage roots, 313 attachment
hashes and 67 live stable-table counts pass. HTTPS and authenticated read-only
acceptance pass; PostgreSQL/configuration were preserved. The earlier old-API
OOM remains recorded, not erased by the successful resume. See the
[accepted release](docs/execution/UX_RELEASE_2026-10-16.md#accepted-low-memory-deployment).

**OOM follow-up (2026-10-17):** kernel evidence identifies `global_oom`, not a
normal service stop. The old explicit full diagnostic added a second Python
process (~125 MiB) beside API (~162 MiB) on a shared ~1.87 GiB host and could
not use the available swap reliably (`swappiness=0`). Source now separates a
lightweight heartbeat/readiness probe from a serialized, resource-limited
one-off diagnostic; low/unknown memory defers and filesystem/SQL work is
bounded. Focused local API suite **112 passed / 3 skipped**, disposable
PostgreSQL 17 transaction/timeout and actual heartbeat SQL **2/2**, Linux
synthetic operator-shell/lock checks **27**. Exact source **`3e68d1f`** now
passes all five jobs of CI **38933466143**, attempt 2; original artifact
**12082341034**, 50 OCI blobs and embedded repair source/support were independently
verified. King accepted it on **2026-10-17 at 00:53:53 UTC** without migration:
API/Web healthy, worker fresh, all three applications zero restarts/OOM/startup
error-keyword lines. PostgreSQL, environment, Compose, Nginx and operational
checkout are unchanged. Direct rollback is `aea13fe`, on the same 0051 schema;
do not downgrade for this rollback. See [acceptance and limits](docs/execution/OOM_STABILITY_2026-10-17.md#accepted-release).

**2026-10-17 worker/noise follow-up checkpoints:** the
[worker shutdown](docs/execution/WORKER_SHUTDOWN_2026-10-17.md),
[literal matching](docs/execution/NOISE_LITERAL_MATCHING_2026-10-17.md), and
[Unicode normalization](docs/execution/NOISE_UNICODE_NORMALIZATION_2026-10-17.md)
records retain the original focused-test and environment boundaries. Their
released status is recorded in the accepted release above; those historical
function-level results are not Docker PID 1 or low-memory stress acceptance.

| Item | Verified state |
| --- | --- |
| Release accepted | Exact source `50f6de4b2e72ad33bd4d351ada6f95c0b3583898`, CI **39231559224** attempt 1; five jobs and deployed image digests independently verified. [Accepted release](docs/execution/OOM_RELEASE_2026-10-19.md) |
| Production | Source `50f6de4`; audited 2026-10-19 12:27:23 UTC / 20:27:23 +08:00. API/Web/HTTPS/login-page smoke pass, worker fresh; zero application restarts/OOM at audit and 12:50 UTC recheck. Authenticated browser acceptance not rerun |
| Later production incident | 2026-10-18 02:31:45 UTC host-level OOM killed the then-3e68d1f API, which restarted. That incident precedes the accepted import/noise repair; noise-specific causation remains unproven. No new kernel OOM from release preflight through independent audit; not long-running OOM acceptance |
| Production database | Single head/current `20261017_0052`; this release's migration command had no pending schema upgrade and reported unchanged administrator deployment configuration. PostgreSQL not restarted. The prior release added nullable `protection_review` |
| Last accepted data evidence | The previous feature release checked all old columns in 84 tables, four storage roots, 313 attachment hashes and 67 stable counts across 0051→0052. Not rerun here. This release removed only verified old backup sets, unused application images and its transfer archive |
| Latest accepted image CI | `50f6de4`: all five jobs of **39231559224** attempt 1 pass. Prior feature CI **39135555660** and its API **1562 / 3 skips** remain historical counts, not this run's test totals |
| Previous UX CI | `aea13fe`: PostgreSQL 16 API **1,288 passed / 3 skipped**, single head/current 0051; all **13 Web gates** pass, including exact noise ranges at 375/1440px, attachment **25**, PDF **13**, auth **18**, negative PWA **19**, default PWA **139 / 737 conditional skips**; settings **463 / zero skips** plus one fresh-instance restore. These are that earlier release's counts, not new OOM-release counts |
| Earlier candidate CI | Canonical-URL revision repair a12ce9e passed CI 37812290017; its artifact was never deployed separately. Its changes are included in accepted 84988a2 |
| Local UX closeout | The resumed ordinary-user UX implementation and permitted service-free verification are complete at the pre-release checkpoint. Noise supports cross-page multiple candidates and exact editable removal ranges; rich-text uses bounded display-only compatibility, not arbitrary HTML/widgets. The administrator Skill and system archive recovery changes remain in the same release batch. The user explicitly authorized commit, CI and deployment on 2026-10-16; runtime and release acceptance now proceed through the gates below |
| Latest local verification | [Service-free UX continuation](docs/execution/ux-audit-service-free-regression-2026-10-16.md): repaired fourteen stale test adapters without skipping cases; all 63 Node files passed **1,412/1,412**, full Web lint, nonincremental typecheck and Web build passed. Release preflight API **1,129 passed / 159 skipped**; local PWA stopped after missing-API timeouts, not accepted. A reproduced Share edge entry defect is fixed: retired callbacks cannot start a read or loading/error work. The later exact-source CI and production acceptance above supersede this local-only boundary |
| Latest local repair | [Noise candidate exact markers](docs/execution/ux-audit-noise-candidate-range-markers-2026-10-15.md), verified 2026-10-16 local: selected refined rows mark/strike only actual removal fragments; retained text stays plain. Unusable refinements fall back to plain source with recovery copy, and completed/stale/conflict/protected states are accurately described beside the checkbox. Existing unselected match highlighting and accessible names remain. **13 passed** (six helper + seven actual React server-markup tests), targeted Web ESLint, nonincremental typecheck and diff whitespace passed. No API/migration change or rerun of the prior API batch; browser/mounted-event/assistive acceptance, services, build, CI and deployment were not performed |
| Earlier local repair | [Noise review editable ranges](docs/execution/ux-audit-noise-range-editing-2026-10-15.md) completes the earlier bulk-selection batch: many candidates can be selected across filtered pages, and each candidate can retain 1–20 exact deletion subranges, with retained-context feedback and required preview/apply. Saving ranges only saves/selects the review choice; KEEP/reselect preserves refinements. Version-bound edit tokens, source/protection checks and the shared scan lock reject stale edits; preview/apply use the same ranges. Checkbox state/text/tint and scope-wide saving feedback exclude stale/conflict/applied/protected rows. Focused API **65 passed**, Unicode/CRLF helper **4 passed**, targeted Web ESLint, nonincremental Web typecheck and diff whitespace passed in that batch. Source has one Alembic head `20261015_0051` after 0050, **not applied**; production stays 0050. No services, browser, PostgreSQL migration/concurrency run, build, commit, new CI or deployment |
| Latest source-only repair | Administrator system Skill “unify default” and “restore built-in” now use bounded bilingual `AdminRequestError` recovery copy; confirmed writes are shown separately from list-refresh failure with a read-only reload action. Confirmation, permissions, request/cache contracts and Skill content remain unchanged. Browser and full gates were not run |
| Latest source-only repair | [System archive scope recovery](docs/execution/ux-audit-system-archive-scope-2026-10-15.md) fences system backup/restore/upload/retry/refresh callbacks by mount and authentication generation, rechecks delayed destructive confirmations, guards deferred focus, and distinguishes upload-limit failure/offline/loading copy. System archive v4/v5, ownership mapping, `.cr`, request/cache keys and server-task semantics remain unchanged. Only diff whitespace was checked; browser, tests, services, build, CI and deployment were not run |
| Latest source-only repair | [Email-change panel lifecycle](docs/execution/ux-audit-email-change-panel-lifecycle-2026-10-15.md) fences email-change reads, send/cancel results and profile refresh callbacks by mount, authentication generation and operation sequence; delayed cancel/close confirmations are rechecked, and unknown network/5xx outcomes require a read-only status refresh before retry. Email grant, 30-minute expiry, resend replacement, cancel API, SMTP and session contracts remain unchanged. Only diff whitespace was checked; browser, tests, services, build, CI and deployment were not run |
| Latest source-only repair | [Email-change confirmation lifecycle](docs/execution/ux-audit-email-change-confirmation-lifecycle-2026-10-15.md) prevents concurrent confirmation-page checks, fences preview/confirmation/fallback-session reads by mount, authentication generation, operation sequence and current URL token, and keeps lost-response recovery bound to the previously previewed account and address. Grant, session, fragment URL and confirmation semantics remain unchanged. Only diff whitespace was checked; browser, tests, services, build, CI and deployment were not run |
| Latest source-only repair | [Preferences capability read lifecycle](docs/execution/ux-audit-preferences-capability-read-lifecycle-2026-10-15.md) fences the account-capability read that controls Administration navigation by mount, authentication generation, latest request sequence and abort signal; retries no longer leave older reads able to restore a stale role, and unconfirmed admin controls stay hidden while reading. Personal categories, backend role checks, event key and permissions remain unchanged. Only diff whitespace was checked; browser, tests, services, build, CI and deployment were not run |
| Latest source-only repair | [Support Requests capability read lifecycle](docs/execution/ux-audit-support-capability-read-lifecycle-2026-10-15.md) fences the Support Requests account-capability bootstrap and offline cached-role fallback by mount, authentication generation, latest retry sequence and abort signal; a retry clears unconfirmed role/capability state, so stale reads cannot switch inbox mode or expose the wrong request surface. Offline access checks, cached fallback, request/draft/API contracts and support permissions remain unchanged. Only diff whitespace was checked; browser, tests, services, build, CI and deployment were not run |
| Latest source-only repair | [Conversation split lifecycle](docs/execution/ux-audit-conversation-split-lifecycle-2026-10-15.md) adds an in-place full-index read Retry, clears old rows/selections before replacement reads, fences load/preview/execute publication by the current workspace and operation, and locks the plan controls while a request is pending. Split payloads, server validation, confirmed writes, generated links and Reader selection semantics remain unchanged. Only diff whitespace was checked; browser, tests, services, build, CI and deployment were not run |
| Latest source-only repair | [Adaptive import session action lifecycle](docs/execution/ux-audit-import-session-action-lifecycle-2026-10-15.md) gives profile selection, invalid-artifact replacement, group exclusion, reanalysis, grouping confirmation and mapping save one workspace-local action lease/token. Competing controls, navigation and commit are disabled; stale or wrong-session responses cannot publish, and grouping assignments resync when artifact identity changes. Existing requests, API/server semantics, source retention and import contracts remain. Regression is authored but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Share unlock lifecycle](docs/execution/ux-audit-share-unlock-lifecycle-2026-10-15.md) coalesces rapid submissions through an owned in-memory attempt and fences follow-up reads/error/finally by current visit and attempt. Visit setup resets ephemeral gate state; pending edits are locked, permitted edits clear old feedback, failed input/whitespace remain, and only a current successful metadata read clears the password. Existing POST/auth/refetch/rate-limit policy remains; sent requests are not aborted. Regression is authored but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest local repair | [Share edge-window loading lifecycle](docs/execution/ux-audit-share-edge-loading-lifecycle-2026-10-15.md) fences previous/next entry, complete-turn merge, anchor restoration, errors and final loading feedback by the active visit as well as generation/direction. Retired callbacks start no new reads; pending completions cannot publish into the retired reader, and reversed requests show no stale failure. The nine extracted-loader cases passed in the 2026-10-16 full local run. Existing sent-request, lease, merge, real-DOM anchor and no-abort contracts remain; no browser or resource acceptance is claimed |
| Latest source-only repair | [Source-editor discard-and-switch cleanup](docs/execution/ux-audit-source-editor-discard-switch-2026-10-15.md) routes the navigation banner through the existing attachment-job cancellation/deletion and list invalidation before changing source target; rapid clicks are coalesced, cleanup failure keeps the editor open with finite feedback, and unmount retires old jobs. Save/keep-files/normal editor and attachment contracts remain. Regression is authored but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Source-editor attachment picker dialog](docs/execution/ux-audit-source-editor-attachment-picker-dialog-2026-10-15.md) connects the current-file picker to the shared dialog-focus lifecycle, marks its backdrop out of the Tab sequence and uses the search field as initial focus. Existing close/query/filter/attachment semantics remain. Regression is authored but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Share stored-position shape](docs/execution/ux-audit-share-position-shape-2026-10-15.md) validates resume-required record/message/anchor shape, finite pixel offset and optional safe nonnegative block index at the existing read boundary. Unusable JSON becomes a null anchor without deletion or marking accessible storage unavailable; valid current/legacy/extra metadata remains unchanged. Query/restore/write/key formats remain. Shared regression is extended but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Share position-storage recovery](docs/execution/ux-audit-share-position-storage-recovery-2026-10-15.md) settles current digest/read failure into unanchored nonpersistent reading instead of blocking authorized content. A visit-tagged in-memory disable ref contains write/remove failure and fences old/replayed writers; permanent-error discard disables before removal and clears the in-memory key/anchor on either outcome, without claiming denied deletion succeeded. Existing fixed-height header shows finite current-visit progress-unavailable feedback. SHA-256 namespace/bytes, idle capture/cache-unload timing, transient/password retention, access and complete-turn/anchor contracts remain. Regressions are authored/updated but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Share tablet navigation dialog](docs/execution/ux-audit-share-tablet-navigation-dialog-2026-10-15.md) connects the actually visible tablet panel to existing `useDialogFocus` and gives its section a translated modal dialog name/ref/fallback focus target. Existing hook owns initial focus, boundary Tab wrapping, top-dialog Escape, cleanup and delayed no-scroll restoration; close uses the current sheet handler. Phone/Vaul, desktop rails, visual dimensions, navigation/storage/access contracts and the shared hook remain. This does not add background inertness or prove browser/assistive focus. Regression is authored but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Reader navigation-sheet lifecycle](docs/execution/ux-audit-reader-navigation-sheet-lifecycle-2026-10-15.md) scopes shared online/offline index/TOC feedback and auto-close by visible activation, tab, viewport, visit/account and latest action. The stable internal utility transition callback retires old sheet intent before selecting another surface; a memory-only activation counter forces a fresh scope even for batched close/reopen, so old callbacks cannot regain admission. Current failure remains local, cancellation is neutral and same-pending-target activation coalesces. Core positioning/query/storage/prefetch contracts remain; begun helper/transport work is not aborted. Regression is authored but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Share navigation-sheet lifecycle](docs/execution/ux-audit-share-navigation-sheet-lifecycle-2026-10-15.md) scopes local feedback/auto-close to visible activation, tab, viewport, Share visit and latest action. Explicit open/close/tab paths retire synchronously; a memory-only counter forces a fresh scope on open even for batched close/reopen or same-value open, without reviving old callback admission. Layout cleanup/sequence projection also fences same-scope replay. Mobile/tablet index/TOC share pending/failure handling, same-pending-target coalescing and neutral cancellation. Begun core navigation is not physically cancelled; Share access/storage/anchors remain. Regression is authored but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Share navigation retirement](docs/execution/ux-audit-share-navigation-retirement-2026-10-15.md) fences its independent locator/neighborhood/lease/mount/settle completion and rejection by current token visit, retains lease release and owns one highlight timer. Saved-position fallback stops on cancellation or changed input/choice; explicit navigation settles delayed restoration. Storage readiness and saved anchors are tagged by visit, with ephemeral state reset on token change. Share access/URL, hashed position bytes, optional resolver compatibility and real-anchor/complete-turn behavior remain. Regression is authored but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Reader navigation retirement](docs/execution/ux-audit-reader-navigation-retirement-2026-10-15.md) combines the existing navigation token and visit/account guard at admission and exposed async stage boundaries, returning cancellation before stale failure/stage/cache/locator publication or follow-up work. Lease/finally bookkeeping remains. Footer search completion cannot resurrect dismissed/replaced context; source/conversation reset clears old search/recovery/pulse/locator-validation state, and cleanup retires old tokens without discarding panel return state. Transport/helper-internal work is not aborted. The Reader-retirement-specific regression remains unexecuted; the shared conversation-search component file passed 48/48 in its separate continuation. No service, browser, build, commit, CI, deployment or resource measurement ran |
| Latest local verification | [Conversation-search navigation lifecycle](docs/execution/ux-audit-conversation-search-navigation-lifecycle-2026-10-15.md) fences panel completion/close and Reader search-context/highlight publication by current activation and query/filter/source/visit scope, including source-editor hiding of desktop search. Same-pending-match activation is coalesced; failures have finite local feedback and cancellation is neutral. Begun Reader loads/scrolls are not actively cancelled. The shared component regression passed 48/48 on 2026-10-16; the separate offline-retry regression and mounted-browser/cancellation acceptance remain unexecuted |
| Latest local verification | [Conversation-search selection](docs/execution/ux-audit-conversation-search-selection-2026-10-15.md) follows exact document/message/version/block/range/quote identity through same-query document or match reorder. A removed selection shows a neutral notice and cannot redirect Enter to a replacement; arrows use the visible index. Activated identity is published before navigation through the existing ephemeral panel-state callback, retaining legacy numeric restore and query/filter reset. Search requests, retry policy, complete-turn navigation and anchors remain. The controlled-component regression passed 48/48 on 2026-10-16; targeted ESLint, nonincremental Web typecheck and diff check also passed. No service, login, browser, full API/PWA suite, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Conflict resolution recovery](docs/execution/ux-audit-offline-conflict-resolution-recovery-2026-10-15.md) contains a second failed status read after resolution failure, distinguishes unknown from confirmed pending/comparison state and offers read-only status/comparison recheck without replaying writes. Existing generation guards now fence already-waiting confirmation, preparation, retry, recovery-read and invalidation continuations after visit retirement. Merge memory/dirty protection, saved-operation receipts and storage contracts remain. Shared regression is updated but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Conflict merge draft refresh protection](docs/execution/ux-audit-offline-conflict-merge-draft-refresh-2026-10-15.md) refreshes comparison versions without replacing an initialized annotation/notebook merge, including failed or pending saves. Locale changes translate finite feedback without another comparison read; an actual conflict-key change resets visit state and retires old read/save completions. Draft keys, save/retry, confirmation and resolution receipts remain. Regression is authored but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Sync-center inspection coalescing](docs/execution/ux-audit-sync-center-inspection-coalescing-2026-10-15.md) keeps one active Copies page scan and one replaceable latest pending scan per local effect. Started siblings all settle before the next page starts; newer failures/navigation/cleanup retire queued work. Existing verification, row order, mode and result fences remain; no cached verifier result or cancellation claim is added. Shared regression is updated but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or CPU/RSS measurement ran |
| Latest source-only repair | [Sync-center partial-read recovery](docs/execution/ux-audit-sync-center-partial-read-recovery-2026-10-15.md) isolates tab-owned local section failures so successful copies/tasks/edits/drafts/conflicts remain readable. Missing sections are named, empty/paging claims require their own successful reads, and local Retry remains read-only. Initial-task lookup waits for successful task reads; cleanup/export keep their required-read guards. Shared regressions are updated but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Conversation TOC stale-read recovery](docs/execution/ux-audit-conversation-toc-stale-read-recovery-2026-10-15.md) keeps readable old section headings visible but labels a failed refresh and offers a query-only Retry when stale items remain. Initial empty/error behavior, heading/block anchors, navigation and Reader/Share/offline contracts are unchanged. Regression is authored but unexecuted; no service, tests/gates, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Conversation index read recovery](docs/execution/ux-audit-conversation-index-read-recovery-2026-10-15.md) adds a local alert and same-intent Retry for interactive Reader index jumps and previous/next page reads after loader failure. It preserves the old page, offset/limit contract, navigation callback, initial query retry, DOM anchors and Reader/Share/offline semantics. Regression is authored but unexecuted; no service, tests/gates, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Offline library local read state](docs/execution/ux-audit-offline-library-local-read-state-2026-10-15.md) separates local conversation/message loading, ready, initial failure and refresh failure from search-index state; empty claims wait for a successful local read, failures retain existing copies and offer local Retry, and catalog download deep links remain available. Regression is authored but unexecuted; no service, tests/gates, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Offline library download status read](docs/execution/ux-audit-offline-library-download-status-read-2026-10-15.md) reports a failed local download-status subscription separately, removes unverifiable stale progress/failure projection and offers a status-only Retry without claiming cancellation or replaying a download. Regression is authored but unexecuted; no service, tests/gates, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Import session restore recovery](docs/execution/ux-audit-import-session-restore-recovery-2026-10-15.md) retains the saved adaptive-import session pointer after an unconfirmed restore-read failure, exposes stable read feedback and a read-only Retry, and clears only on confirmed terminal state or explicit new-file selection. Regression is authored but unexecuted; no service, tests/gates, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Import commit status recovery](docs/execution/ux-audit-import-status-recovery-2026-10-15.md) ends pending busy state on committed/failed/cancelled results, keeps input/workspace for explicit retry, and exposes read-only status refetch for both adaptive and archive import surfaces without replaying unknown writes. Regression remains unexecuted; no service, tests/gates, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Source editor attachment picker read recovery](docs/execution/ux-audit-source-editor-attachment-picker-read-recovery-2026-10-15.md) separates failed attachment-list reads from a confirmed empty list, retains stale available rows with a notice, and provides a read-only Retry. Regression is authored but unexecuted; no service, tests/gates, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Offline export attachment-count read](docs/execution/ux-audit-offline-export-attachment-count-read-2026-10-15.md) separates loading, confirmed success and failed local attachment-count reads, retains export availability, and provides a status-only local Retry without changing attachment selection or export contents. Regression is authored but unexecuted; no service, tests/gates, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Conversation-files capability read](docs/execution/ux-audit-conversation-files-capability-read-2026-10-15.md) gates the online attachment upload affordance on a confirmed capability read; initial/error-without-data states show stable bilingual feedback and a local capability-only Retry, while stale successful capability data remains usable. Regression is authored but unexecuted; no service, tests/gates, browser, build, commit, CI, deployment or resource measurement ran |
| Latest source-only repair | [Inline attachment locale feedback](docs/execution/ux-audit-inline-attachment-locale-2026-10-15.md) makes inline attachment states, controls, accessible labels and shared type metadata follow the current Chinese/English locale without changing attachment access, render, cache, download or anchor semantics. Regression is authored but unexecuted; no service, tests/gates, browser, build, commit, CI, deployment or resource measurement ran |
| Latest verified local batch | Rich-text v5 continuation rerun: **27/27** focused parser/component SSR checks and **5/5** selected pure API importer/exporter checks passed; **1 external paired fixture remained explicitly deselected**. The earlier checkpoint also records **106/106** selected Node checks, lint and nonincremental types. [Source gate recovery](docs/execution/ux-audit-resumed-source-gates-2026-10-15.md) owns the repaired type/lint directives and stale fixtures. No build, PWA/browser execution, service, production, or CPU/RSS acceptance; the wider source-only batches remain unverified |
| Previous verified local batch | [Personal archive scope repair](docs/execution/ux-audit-personal-archive-scope-2026-10-14.md) fences retired action/confirmation callbacks, preserves explicit original-key retries and distinguishes upload-limit failure from loading. All 926 Node checks (36 archive-focused), lint and nonincremental types passed at that checkpoint; three archive browser files discovered 19 cases, executed zero. No build or release in that batch; later offline-files and Reader-share retries remain unaccepted outside the limited current checks |
| Earlier local follow-up | Five [annotations/table follow-up](docs/execution/ux-audit-followup-2026-10-13.md) findings had local repairs: independent/scoped reads, protected drafts, consistent hidden selections and bounded CSV parsing/paging. At that checkpoint, all 806 Node checks and bounded Web build passed; 40 browser cases were discovered, none executed locally |
| Latest source-only repair | [Sync-center tab read scope](docs/execution/ux-audit-sync-center-tab-read-scope-2026-10-15.md) limits existing Dexie reads to the visible tab: Copies uses copy rows/count and tasks, Pending uses operations/drafts/conflicts, and Failures uses tasks/conflicts/failed rows plus bounded displayed-copy existence. Initial-job task targeting remains. Ordering, paging, read-state guards, visible asset checks, managers and mutations remain. Inner-reader regressions are authored but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or performance measurement ran |
| Latest source-only repair | [Sync-center read states](docs/execution/ux-audit-sync-center-read-states-2026-10-15.md) binds local read completion to tab/page/mode, suppresses unread/failed empty claims and stale-scope ledgers, and separates read feedback from action errors. Matching successful data can remain visible while refreshing; local Retry reopens only the local subscription. Ledger failures fence older inspection publication. Preference status, download/catalog controls and stored data remain. Shared regressions are authored but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or performance measurement ran |
| Latest source-only repair | [Sync-center hidden inspection](docs/execution/ux-audit-sync-center-hidden-inspection-2026-10-15.md) limits attachment cache/Blob inspection to visible Copies. Pending/Failures retain their ledgers without asset work; conflict/cleanup replacement subviews pause the parent ledger until return. Visible verification, task navigation, global download/sync managers and cleanup policy remain; already-started inspections are not actively cancelled. Regressions are authored but unexecuted; no tests/gates, services, browser, build, commit, CI, deployment or CPU/RSS measurement ran |
| Latest source-only repair | [Offline continuation read states](docs/execution/ux-audit-offline-continuation-read-states-2026-10-15.md) separates pending/failed reads, missing conversations, absent optional members and readable files. Transient refresh failures retain matching cached content with a notice; locked-access read errors hide it. Local Retry is non-cancelling, missing rows resolve to null and awaited reads are database/access fenced. Member/source choices, Index navigation and stored data remain. Regressions are authored but unexecuted; no tests/gates, services, browser, build, commit, CI or deployment ran |
| Latest source-only repair | [Offline attachment query scheduling](docs/execution/ux-audit-offline-attachment-query-policy-2026-10-15.md) permits the local file list and inline/Viewer shell/item metadata to execute while marked offline. Owner/Share/admin policies and arguments, lazy gates, query lifetimes, verified-cache reads and Object URL cleanup remain. Sampled annotation/notebook reads are direct and offline continuation already has a local policy, so no scheduling edits there. Regressions are authored but unexecuted; no tests/gates, services, build, product browser, commit, CI or deployment ran |
| Latest local verification | [Offline Reader query scheduling](docs/execution/ux-audit-offline-reader-query-policy-2026-10-15.md) makes local metadata, saved position, initial complete-turn window and dialogue/section navigation queries/prefetches independent of the online gate. All four navigation placements receive an explicit source policy; remote/Share options omit the override and retain inherited defaults. Query identities, enabled conditions and DOM anchors are unchanged. On 2026-10-16 the focused regression passed **10/10**; targeted ESLint, nonincremental Web typecheck and diff whitespace passed. No service, login, product browser, full API/PWA suite, build, commit, CI or deployment ran. Attachment utility queries are covered by the separate follow-up above |
| Latest local verification | [Offline search readiness/retry](docs/execution/ux-audit-offline-search-readiness-2026-10-15.md) fences absent/reset/replaced Worker indexes instead of reporting false zero results, waits for started initialization and binds the corpus to its access generation. Reader manual retry reuses Library's queued rebuild; local search bypasses the online gate without rebuilding on typing or changing remote policy. On 2026-10-16 the two actual compiled bridge/panel regressions passed **19/19**, targeted ESLint, nonincremental Web typecheck and diff whitespace passed. No service, browser, build, commit, CI or deployment ran; Worker/IndexedDB/device acceptance remains open. Broader Reader query scheduling is handled by the separate follow-up above |
| Latest local verification | [Sidebar search selection](docs/execution/ux-audit-sidebar-search-selection-2026-10-15.md) retains explicitly selected document identity through same-query result refreshes, preventing reorder from changing the Enter target and removal/shrink from leaving a dead index. Initial first-result behavior, debounce, queries and URL parameters remain; a missing selected result falls back to full results. On 2026-10-16 the compiled handler regression passed **12/12**; targeted ESLint, nonincremental Web typecheck and diff whitespace passed. No service, login, build, full API/PWA suite, product browser, commit, CI or deployment ran |
| Latest source-only repair | [Batch export submit recovery](docs/execution/ux-audit-batch-export-submit-error-recovery-2026-10-14.md) converts batch-export submission failures to finite internal categories before they reach the notification, preserving known business guidance and idempotent retry wording without exposing API or gateway text. Selection, timeout, task-center and backend job semantics are unchanged. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Task center failure copy](docs/execution/ux-audit-task-center-failure-copy-2026-10-14.md) maps failed background tasks to stable bilingual recovery guidance by task type and bounded keywords, removing the raw worker/API `error_message` fallback while preserving specialized flows, Retry, Cancel, result links and task status semantics. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Admin import-format error copy](docs/execution/ux-audit-admin-import-format-error-copy-2026-10-14.md) maps system import-format read, publish and withdraw failures to stable bilingual guidance for access, availability, conflict, validation, service and unconfirmed outcomes, removing direct management API text while preserving drafts, confirmation, pagination and request semantics. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Permanent deletion admission recovery](docs/execution/ux-audit-conversation-delete-admission-2026-10-14.md) retains one original key/ordered target snapshot across menu closure and private navigation, offers explicit read-only receipt checking and confirmed original-key retry only after definite missing. Server replay covers every retained status before source validation, rejects changed payloads and serializes PostgreSQL same-key admission; failed/cancelled work is not automatically restarted. No migration, polling, dependency or deployment change. New API/PostgreSQL/browser regressions are written but intentionally unexecuted; user verification is pending |
| Latest source-only repair | [Shared confirmation lifecycle](docs/execution/ux-audit-interaction-confirmation-lifecycle-2026-10-14.md) preserves one visible decision/draft, cancels later overlapping requests instead of losing the first resolver, and retires old route/account/unmount decisions and callbacks with false/null. Existing visuals, input validation and focus helper remain; already accepted work is not cancelled. New controlled-callback regressions are written but intentionally unexecuted; no service, validation, commit, CI or deployment was run |
| Latest source-only repair | [Account-security error copy](docs/execution/ux-audit-account-security-error-copy-2026-10-14.md) separates preference/local-state preflight failures from logout/password requests and maps authentication status/unknown outcomes to stable bilingual recovery guidance; unsaved local-change review and password drafts remain. Per user direction, no local checks, CI or deployment were run; user verification is pending |
| Latest source-only repair | [Share write recovery](docs/execution/ux-audit-share-write-recovery-2026-10-14.md) separates confirmed share writes from a failed follow-up list refresh, keeps generated links visible, and maps create/update/password/regenerate/revoke failures to stable bilingual recovery guidance; unknown writes require a read-only list check before retry. Per user direction, no local checks, CI or deployment were run; user verification is pending |
| Latest source-only repair | [Skill settings recovery](docs/execution/ux-audit-skill-settings-recovery-2026-10-14.md) maps user Skill upload/selection/status/rename/delete failures to stable bilingual recovery guidance, separates confirmed writes from list-refresh failures, and scopes late success feedback to the mounted category/locale without adding viewer/editor/history or semantic-validation UI. Per user direction, no local checks, CI or deployment were run; user verification is pending |
| Latest source-only repair | [Conversation create/insert recovery](docs/execution/ux-audit-conversation-create-insert-recovery-2026-10-14.md) maps new-conversation and manual-message-insertion failures to stable bilingual recovery guidance, retains all drafts, and distinguishes unknown write results without auto-replay. Per user direction, no local checks, CI or deployment were run; user verification is pending |
| Latest source-only repair | [Reader message mutation recovery](docs/execution/ux-audit-reader-message-mutation-recovery-2026-10-14.md) maps manual merge/delete failures to stable bilingual Reader feedback, distinguishes unknown results and requires a read-only refresh before retry without changing selection, undo, version, attachment or position semantics. Per user direction, no local checks, CI or deployment were run; user verification is pending |
| Latest source-only repair | [My shares revoke recovery](docs/execution/ux-audit-my-shares-write-recovery-2026-10-14.md) separates confirmed revoke writes from the follow-up list read, replaces raw revoke exceptions with stable bilingual recovery guidance, and retains selection for unconfirmed outcomes. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Export error recovery](docs/execution/ux-audit-export-error-recovery-2026-10-14.md) replaces raw export-queue and unknown worker errors with stable bilingual guidance, keeps known export codes actionable, and requires task-center verification before retrying an unconfirmed submission. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Offline library error recovery](docs/execution/ux-audit-offline-library-error-recovery-2026-10-14.md) replaces raw catalog, offline-shell, download-start and Service Worker messages with stable bilingual guidance, adds a read-only catalog retry, and retains local copies and selection. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Offline file download and export error recovery](docs/execution/ux-audit-offline-file-download-and-export-error-recovery-2026-10-14.md) replaces raw offline attachment download and local export errors with stable bilingual guidance, keeps actionable 256 MiB and missing-conversation directions, and preserves cache, export and result semantics. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Conversation split error recovery](docs/execution/ux-audit-conversation-split-error-recovery-2026-10-14.md) replaces raw split-index/preview/execute errors with stable bilingual guidance and separates confirmed split writes from follow-up list-refresh failures while retaining generated links. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Reader task toggle recovery](docs/execution/ux-audit-reader-task-toggle-recovery-2026-10-14.md) replaces raw task-toggle errors with stable bilingual guidance and separates confirmed task writes from message-refresh failures while retaining the checked-state override. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Message version recovery](docs/execution/ux-audit-message-version-recovery-2026-10-14.md) gives each message one shared desktop/mobile version owner, separates confirmed writes from body refresh failures, preserves unknown-result recovery targets for explicit read-only checking, and retains derived-task IDs when status reads fail. Existing history query invalidation and version semantics remain; per user direction, no service, login, validation, CI or deployment was run |
| Latest source-only repair | [Scoped offline cleanup sync](docs/execution/ux-audit-scoped-offline-cleanup-sync-2026-10-14.md) keeps single-conversation cleanup from resetting or submitting other conversations' annotation, notebook and reading-position outbox records; account-level sign-out retains global preference and outbox synchronization. Per user direction, no service, login, validation, CI or deployment was run |
| Latest source-only repair | [Offline sync failure guidance](docs/execution/ux-audit-offline-sync-failure-guidance-2026-10-14.md) gives NETWORK, AUTH, INVALID and unknown outbox failures stable bilingual recovery directions while retaining local edits, original-content links, conflict handling and the existing global retry semantics. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Mermaid error copy](docs/execution/ux-audit-mermaid-error-copy-2026-10-14.md) keeps Mermaid parser and dynamic-loading exception text out of Reader content, shows stable localized fallback guidance, and preserves the source fallback, theme, security and performance behavior. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Admin access error copy](docs/execution/ux-audit-admin-access-error-copy-2026-10-14.md) maps administrator access-panel connection, authorization, conflict, validation, rate-limit, service and unknown failures to stable bilingual guidance without exposing server detail text; request, permission, confirmation and one-time-link semantics remain unchanged. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Admin access independent reads](docs/execution/ux-audit-admin-access-independent-reads-2026-10-14.md) keeps successful access overview, user, invitation and profile reads visible when another read fails, retains prior data, avoids false empty states and hides user mutations until identity is known. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Offline library navigation reload](docs/execution/ux-audit-offline-library-navigation-reload-2026-10-14.md) separates initial conversation selection from local-library refresh so opening or switching conversations no longer rebuilds the full IndexedDB search input and worker; download completion, deletion and explicit retry still refresh as before. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Login auth read duplication](docs/execution/ux-audit-login-auth-read-duplication-2026-10-14.md) separates local sign-out-cleanup detection from server authentication reads so an initial login page no longer repeats setup/session requests when cleanup state changes from unknown to clear; cleanup recovery still triggers one fresh read after completion. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Attachment image lazy loading](docs/execution/ux-audit-attachment-image-lazy-loading-2026-10-14.md) limits multi-image overview queries to items near the viewport and stops prefetching inactive bottom thumbnails, reducing online/offline reads and Blob URL pressure while preserving navigation, retry, zoom, release and download semantics. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Registration availability race](docs/execution/ux-audit-registration-availability-race-2026-10-14.md) gives register setup/session checks a latest-request and mounted-page guard, so a slow initial check cannot overwrite a newer retry or update the page after unmount; redirect, invitation, submit and API semantics remain unchanged. Per user direction, no service, login, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Offline library refresh race](docs/execution/ux-audit-offline-library-refresh-race-2026-10-14.md) serializes local-library reloads, coalesces queued calls to the latest request and fences stale/unmounted writes around IndexedDB and search-Worker initialization; offline package, selection, download, deletion and search contracts remain unchanged. Per user direction, no service, browser, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Reading position conversation switch](docs/execution/ux-audit-reading-position-conversation-switch-2026-10-14.md) clears prior conversation sync state on Reader switches and fences old live-query, conflict, locate and retry callbacks by visit; quiet autosave, sync-center detail and storage/server contracts remain unchanged. Per user direction, no service, browser, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Inline attachment preview stale content](docs/execution/ux-audit-inline-attachment-preview-stale-content-2026-10-14.md) clears embedded attachment text and expansion state when a new Range read starts, preventing older Markdown/text/JSON/table content from remaining visible during load or failure; limits, cancellation and viewer contracts remain unchanged. Per user direction, no service, browser, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Complex attachment view state isolation](docs/execution/ux-audit-complex-attachment-view-state-2026-10-14.md) resets spreadsheet tabs, presentation slides and archive paths when the attachment asset identity changes, preventing a new file from inheriting an old subview selection without adding parser, Worker or resource work. Per user direction, no service, browser, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Attachment viewer session state isolation](docs/execution/ux-audit-attachment-viewer-session-state-2026-10-14.md) gives each viewer open a fresh local session boundary, resetting the active item, display mode, maximized state and derived media metrics; renderer and image zoom keys also include attachment asset identity so same-ID replacements do not inherit old view state. Per user direction, no service, browser, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Attachment thumbnail asset state](docs/execution/ux-audit-attachment-thumbnail-asset-state-2026-10-14.md) scopes thumbnail and image-overview failure placeholders to the current attachment asset, so same-ID replacements do not retain an old failed marker; lazy loading, query, Blob URL, permission and resource-budget semantics remain unchanged. Per user direction, no service, browser, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Inline attachment asset state](docs/execution/ux-audit-inline-attachment-asset-state-2026-10-15.md) scopes inline failure state, gallery image ratios and bounded text-preview refreshes to the current attachment asset, so same-position replacements do not retain an old failure downgrade, layout ratio or text/expanded state. Existing lazy loading, cancellation, permission, cache and resource-budget semantics remain unchanged. Per user direction, no service, browser, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Attachment panel refresh state](docs/execution/ux-audit-attachment-panel-refresh-state-2026-10-15.md) keeps online attachment preview/detail surfaces and batch selection IDs aligned with the latest file-list query, so rename/refresh/external removal does not leave stale metadata, an orphaned surface or inert selections. Existing attachment requests, viewer sessions, permissions, upload protocol and resource budgets remain unchanged. Per user direction, no service, browser, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Project-sidebar drag notice lifecycle](docs/execution/ux-audit-project-drag-notice-lifecycle-2026-10-15.md) gives drag feedback one cancellable timer, so rapid consecutive moves do not let an older callback clear a newer notice; start, manual dismissal and unmount all clean up the timer. Existing copy, duration, placement and drag mutation semantics remain unchanged. Per user direction, no service, browser, validation, CI or deployment was run; user verification is pending |
| Latest source-only repair | [Import-format settings recovery](docs/execution/ux-audit-import-format-error-recovery-2026-10-14.md) replaces raw API/transport errors in the learned-format list, revision history and personal update controls with status-aware bilingual guidance; read retries and existing name drafts remain, and unknown writes ask the user to check current state before retrying. Per user direction, no runtime or automated verification, CI or deployment was run |
| Latest source-only repair | [Adaptive-import error recovery](docs/execution/ux-audit-adaptive-import-error-recovery-2026-10-14.md) preserves API status/code through import feedback, localizes known import failures and marks unclassified write outcomes as unconfirmed; source-format diagnostics and existing explicit read retry remain. Per user direction, no runtime or automated verification, CI or deployment was run |
| Latest source-only repair | [Content-cleanup error copy](docs/execution/ux-audit-cleanup-error-copy-2026-10-14.md) keeps scan-admission and FAILED/STALE worker errors out of the cleanup panel, classifies known scope/rule/task/version cases, and states that content is unchanged before rescan. Existing scan, retry, task and deletion semantics are unchanged; per user direction, no service, login, validation, CI or deployment was run |
| Previous source-only repair | [Project mutation error copy](docs/execution/ux-audit-project-mutation-error-copy-2026-10-14.md) keeps raw API and transport exceptions out of project creation, settings save, conversation move and project reorder feedback; status-aware localized recovery copy preserves drafts, optimistic rollback and existing retry/refresh behavior. Per user direction, no local checks, CI or deployment were run |
| Previous source-only repair | [Reader offline error copy](docs/execution/ux-audit-reader-offline-error-copy-2026-10-14.md) keeps local-copy, IndexedDB and adapter exceptions out of canonical Reader conversation/window failure states; offline failures now use stable localized recovery copy without changing retry, permission, position or resource behavior. Per user direction, no local checks, CI or deployment were run |
| Previous source-only repair | [Source editor error recovery](docs/execution/ux-audit-source-editor-error-recovery-2026-10-14.md) keeps API, upload and cleanup exceptions out of the editor's user-facing error panel; save, close-attachment and reload failures now use stable localized recovery copy while preserving drafts and conflict recovery. Per user direction, no local checks, CI or deployment were run |
| Previous source-only repair | [Attachment viewer locale consistency](docs/execution/ux-audit-attachment-viewer-locale-2026-10-14.md) follows the current interface locale across the viewer shell, common attachment errors and complex previews; Worker raw errors are replaced by stable recovery copy without changing reads or resource behavior. Per user direction, no local checks, CI or deployment were run |
| Previous source-only repair | [PDF viewer locale consistency](docs/execution/ux-audit-pdf-locale-2026-10-14.md) follows the current interface locale for PDF controls, page feedback, thumbnails and retry/download labels without changing rendering or resource behavior. Per user direction, no local checks, CI or deployment were run |
| Previous source-only repair | [Public Share recovery language](docs/execution/ux-audit-share-recovery-locale-2026-10-14.md) follows the configured Share locale for loading, error and retry states, falling back to the visitor locale before Share metadata loads. Per user direction, no local checks, CI or deployment were run |
| Current diagnosis | [Context package upload recovery](docs/execution/ux-audit-context-upload-recovery-2026-10-13.md) confirms successful large-package acceptance/commit alongside transient Web-to-API Docker DNS `EAI_AGAIN` during status reads. Local Nginx `/api/` loopback routing, Web retry/stale-data repair and one transient-502 browser regression are verified; no CI or deployment was started |
| Release authorization | The explicitly requested 2026-10-16 UX release cycle is complete: exact CI/artifact, original backup, non-deleting isolation, additive migration, data/runtime acceptance and pointer/retention finalization pass. Further CI/deployment requires a new explicit request |
| Recovery points | Current/direct rollback `f3b331a`/`3e68d1f`; exact old images loaded. Crossing 0052→0051 requires the tested consent-revoking downgrade before old code starts, after a fresh verified backup. New stopped-writer five-component backup `20261018T160748Z` passes. The three prior points and independent orphan preservation remain; no backup/image/data pruning |
| Release owner | [UX release](docs/execution/UX_RELEASE_2026-10-16.md#accepted-low-memory-deployment) owns this accepted cycle; [accumulated optimization](docs/execution/OPTIMIZATION_RELEASE_2026-10-08.md) and [attachment release](docs/execution/ATTACHMENT_DEPLOYMENT_2026-10-12.md) are historical |

### Earlier authorization and checkpoints (historical)

The user originally authorized this order: commit accumulated improvements, pass complete
exact-source CI, deploy those verified images to King, then continue the
ordinary-user product audit. That earlier audit then continued; the separately authorized 2026-10-16 release goal is now complete. At least 15
improvements was not a ceiling; over 30 scoped batches are already accumulated.
Do not repeat the previously accepted Context/Skill/Task Center deployments.
Do not use subagents unless the user newly requests them.

Latest user direction (2026-10-09): finish the current creation/insertion/editing
review, then review all attachment viewing paths, prioritizing high-value PDF
reading improvements without significant CPU/memory overhead. After implementing
and verifying that work, **one CI submission cycle and deployment after complete
exact-source CI acceptance are authorized**. Necessary fixes/retries belong to
that cycle. Do not publish before the attachment work is ready; subsequent
optimization requires a new explicit release request. This supersedes the earlier
release pause, not the deployment safety requirements. The newly authorized
earlier release was accepted at 84988a2/rollback 30a0d32; the current pair above supersedes it.

All three cache-count cases pass, including actual zero-cache, download,
cancellation and persistence assertions. The import-retry case now retains its
injected outage until the real click and also passes. Twelve new selection-state
screenshots across six cases and four import-completion/retry screenshots were
reviewed; the other two new selection cases have assertion-only evidence.
The release is accepted, including authenticated read-only smoke, exact runtime
image/source checks and backup finalization. Production configuration and
PostgreSQL were preserved. The follow-on audit is delivered before its scoped
repairs. The new Undo owner, identity-based search selection and read-state fixes
pass their 26-case mutation gate, including nine new cases, with eight reviewed
exact-source synthetic screenshots. The latest settings job passes all 439 matrix
cases and one fresh-instance restore. The canonical-URL revision repair passes
all 13 Web gates, including 18 negative PWA cases, plus API, settings, image build
and independent inspection. All nine expanded synthetic shell regressions, lint,
nonincremental typecheck and the bounded Web build also pass locally.
The authorized attachment deployment is accepted; newer local work is not part of that release.
Latest instruction (2026-10-12): the user returned the passing CI result. The
requested waiting interval ended; the authorized no-migration release is now
accepted and finalized. Continue the broader audit and scoped local repairs;
another CI/deployment requires new explicit authorization.
The [search filter audit](docs/execution/ux-audit-search-filter-race-2026-10-08.md)
records the separately reproduced and CI-verified rapid-input/history repair.

The local merge batch retains one owner/project-scoped request through uncertain
responses, offers read-only receipt checking and permits only explicit original-key
retry after a confirmed missing result. Retained failed/cancelled jobs do not
silently restart; changed payloads conflict. Confirmed admission no longer waits
for refresh to close its dialog. Page-level **Review merge request** recovery is
now independent of current selections and loading/empty/error list branches;
project 401/403/404 still hides it. Opening recovery does not automatically look
up or submit a merge; the existing account-capabilities read may still run.
The active/archive conversation lists now retain cached current-mode rows and
selection through transient read failures. Empty active lists point to Archive;
failed existence checks offer their own read-only Retry instead of claiming the
conversations are filed in projects. Archived projects now retain cached rows,
acknowledge confirmed restores before refresh and offer explicit read-only checking
for unknown outcomes. Current archived membership fences stale selection and is
rechecked after deletion confirmation; this is not an atomic server precondition.
The API already rejects deleting active projects; the client guard avoids stale
requests, not a demonstrated active-project deletion vulnerability. Sidebar
project, Unclassified and expanded-project reads now have scoped read-only retries,
retained cached links and explicit error/empty distinctions without changing DnD
placement. Project archiving now has one sidebar-owned controller across desktop
and mobile menus, acknowledgement before refresh, explicit read-only unknown-result
checks and current-scope confirmation guards. Active project caches exclude confirmed
archives; state survives menu/drawer closure, not full owner unmount/navigation.
Conversation metadata now retains a field-specific draft, allows an empty multiline
description, validates 500 Unicode code points without truncation and sends no-op
edits nowhere. Unknown writes offer explicit current-value comparison, not a receipt
or automatic retry. Rename recovery exposes differing stored/display titles and
compares the full pair before treating a reviewed save as a no-op; newer checks
retire older comparison actions. Confirmed metadata updates existing remote Reader/list/project/recent
caches before independent refresh; offline data and reading anchors are untouched.
Single-conversation placement now has one list/sidebar owner, explicit project
read states, current-visible destination guards and retained unknown-result recovery.
Checking only reads current location; another move requires explicit confirmation
with its newly read revision. A null summary may mean archived membership, not a
receipt for a move to Unclassified. Confirmed moves update existing remote caches
before independent refresh, preserving newer revisions, reading data and offline
copies. Recovery survives row/menu/drawer closure, not full owner navigation.
Pending-action focus recovery only targets lost/body focus, never a chosen control.
The placement repair keeps the disabled submit's label/footprint during a write,
guards backdrop dismissal against live pending state and prevents its second click
from blurring recovered focus. Explicit Close/Back/Escape remain available. A
newly disabled submit can return focus to Close; unrelated chosen controls cannot.
Reader recent-open responses now belong to one mounted conversation/data-source
visit and its authentication generation. Failed responses do not automatically
repost a non-idempotent open. Older summaries cannot lower the detail revision;
newer summaries request a full remote detail instead of relabelling old content.
Equal-revision reading time/progress advances only with a newer timestamp, allowing
progress to decrease while rereading. Valid remote replies independently invalidate
Recent and existing list keys; offline recording stays local. Reading anchors and
complete-turn queries are unchanged.
Remote detail-read failures now retain the matching cached Reader unless access is
denied/missing or the source is known to be merged. Localized recovery retries only
the detail GET, with current visit/auth and pending-read guards; normal first-load
dependent reads and the first recent-open may follow. A compact notice stays outside
scroll/header content. Lost focus returns without scrolling; chosen controls are not
interrupted. Denied/missing and wrong-id caches do not supply the document title.
Initial body errors now offer localized **Retry messages** on the same complete-turn
query/anchor. Current visit/auth/anchor, live read state, accepted-window and navigation
guards fence duplicate or stale actions; the existing apply-once rule protects newer
target windows. Obsolete initial errors disappear once current content is accepted.
Offline errors and complete-turn loading are unchanged. A subsequent readiness
repair follows the accepted current window, not the obsolete initial query. Input
and position listeners follow the available Reader surface; explicit non-restore
navigation retires the old saved-position decision. Saved-position restoration
and programmatic scrolling still do not manufacture user intent; stable DOM anchor
capture and position payload/throttling algorithms are unchanged.
Routine autosave pending/submitted/idle states, including normal offline queues,
now remain silent in Reader without a layout row, toast or repeated announcement.
Real storage/read/sync failures, conflicts and failed explicit locating retain
their existing recovery. Explicit sync-center detail still shows normal status;
current errors cannot also claim routine saved success. Exceptional notices can
still affect layout; real browser geometry has not been accepted.
The mobile Reader now reserves its mounted header's actual border-box height,
including wrapped offline guidance, instead of assuming 56px. One size observer
updates a parent CSS property only when height changes and disconnects on ref
cleanup. Auto-hide transforms keep that reserve; desktop stays in normal flow.
Native scroll padding shares the reserve. No scroll, intent or position-save
call is added. First-message pointer access and pending-placement focus still
require exact-source browser reacceptance; local doubles do not prove geometry.
Manual create/insert/edit now validates nonblank input without trimming accepted
Markdown. Whitespace-only edits count as real edits; canonical/edit/export source
retains leading/trailing whitespace. The separate paragraph projection in the
block builder is unchanged: this is not a claim that all indented-code rendering
or historical blocks are repaired.
PDF Fit Page keeps one page; continuous Fit Width/custom and thumbnails use the
installed virtualizer with overscan one, two concurrent renders per document,
4 Mi-pixel/4096-edge canvas budgets and settled cancellation/lease cleanup.
Direct page entry, actual fit zoom, current-page preservation, short-last-page
handling and page-local retry share the existing shell. Gallery shortcuts use
current identity and exclude editable/media/modifier events; replacing an image
resets its transform and restores only lost focus. JSON transport retry and
Raw/formatted switching are distinct; CSV parsing is memoized without changed
limits. Unsupported/empty/missing states do not mount a false renderer. Blob URLs
retain identity on retry. Office/ZIP worker startup and late callbacks recover
locally. Native audio/video remain metadata-only preload and no autoplay.

The file-panel bridge keeps a session across callback-only redraws, notifies the
latest callback once on explicit close and fences disposed callbacks. PDF intrinsic
geometry is page/document scoped; current CSS geometry does not wait for its
bounded bitmap queue. Continuous positioning uses public measurement APIs and one
native scroll after the new sizer commits; intermediate layout scrolls do not
select another page and real input can interrupt immediately. There is no new
polling, observer, dependency or render-budget increase.

Context editing now propagates dirty transitions synchronously to panel and
workspace guards, so immediate drops, tab navigation and close cannot depend on
a later passive effect. Reverting to original and confirmed save/discard clear
the guard immediately; failed writes retain it. The callback baseline reproduces
eight failures in 12 cases; all 12 pass after repair, with four extra lifecycle
cases bringing the focused suite to 16. Exact original CI scheduling remains
unknown. All **756 Node cases pass / zero failed / zero skipped** in 27 script
files, plus lint, nonincremental types and one-worker Web build. Three Context
browser files discover 11 cases, with zero local execution; the drop case now
requires actual confirmation and retains failure traces. The new
[checkpoint](docs/execution/ux-audit-context-drop-2026-10-12-evidence/local-verification.json)
preserves all preceding source and evidence ledgers and unrelated buildinfo.

Preceding CI-source local checks: **740 Node passed / 0 failed / 0 skipped** across
all 26 repository-script test files, including ten new official-image source
contracts. Actionlint and parsed-workflow comparison pass with all existing gates,
steps and budgets preserved; lint and nonincremental types pass. This is not a
container/browser execution or a passing CI. The CI-source
[checkpoint](docs/execution/ci-registry-source-2026-10-10-evidence/local-verification.json)
inherits 117 bindings with only workflow changed and adds two Dockerfiles plus
the new source-contract file, for 120; prior evidence/buildinfo remain intact.
The preceding archived-project source contract is
repaired without changing product code: 18 source-only Playwright cases across
six files go from 17 passes/one failure to all 18 passing, without Web or browser
fixtures. The original 40 archive callbacks remain unchanged and four added
single/bulk held/failed-refresh cases pass. Lint and nonincremental types pass;
build/API were not rerun. The new
[checkpoint](docs/execution/ux-audit-archive-contract-2026-10-10-evidence/local-verification.json)
inherited 116 source bindings, changed one Node test and added the static E2E file
for 117; prior ledgers and unrelated buildinfo remain unchanged.
Upload cleanup's preceding 30-case baseline has
21 passes/nine failures, then all 30 pass after the test-only repair. Only an
ECONNRESET from DELETE permits one same-fixture GET; only 404 confirms cleanup.
Other errors remain failures and the existing HTTP-500 bound is unchanged.
The earlier PDF baseline (41/48) and repaired 53 cases remain historical; their
product code is unchanged. Earlier 699/666 counts overlap, not additional passes.
Lint and nonincremental types pass; the preceding bounded one-worker build is
retained, not rerun for the test-only delta. Fractional-boundary and persistent
page-local outage checks remain; PDF browser acceptance is still missing.
The preceding unchanged-API SQLite batch passed **103 / 0 failed /
0 skipped**; it was not rerun for this UI/test-only repair. At that earlier checkpoint source had one
Alembic head `20261008_0050`; at that checkpoint, the source/production head was 0051. Older checkpoint counts overlap and are not added.
Discovery finds **149 tests in ten files**, retaining the previous 144 and adding
the CSP and rich-attachment cases; **zero browser cases executed locally**.
Seventh CI's full API/PostgreSQL, settings, 100-case mutation and 21-case attachment
passed, but PDF did not; no CPU/RSS measurement,
visual score or production acceptance is implied. The next complete CI retains
all 13 Web gates, full API/PostgreSQL and 439-case settings matrix plus fresh-instance
restore. The new [cleanup checkpoint](docs/execution/ux-audit-upload-cleanup-2026-10-10-evidence/local-verification.json)
inherits all 115 source bindings with only its cleanup Node test changed, and
adds the upload E2E file for 116 bindings. It verifies unchanged product/assertions,
preserved earlier ledgers and unrelated buildinfo. No browser or service executed locally.
Earlier ledgers remain unchanged.

## Verification boundaries and release safety

- Exact-source CI `40738934749` / `f8a6a06` passed all five jobs:
  API **5,903 passed / 3 skipped**, Web UX **1,822**, mutation **100**,
  Default PWA **161 passed / 750 conditional skips**, authentication **18**
  and negative PWA **19**; settings **463** plus **1** independent restore.
  Skips are not passes; older overlapping counts are not additive.
- No local tests/lint/typecheck/build/browser/services/database validated this
  correction/release. CI acceptance is not specified-Windows-Chromium,
  authenticated production UI, physical-clipboard or sustained-load acceptance.
- One authorized original local Web start was rejected before process creation
  with only `blocked by policy`. Cause remains unknown. No alternate launcher
  was used; do not retry through a different route. See the
  [policy diagnosis](docs/execution/local-execution-policy-diagnosis-2026-10-08.md)
  and [Chromium checkpoint](docs/execution/specified-chromium-preflight-2026-10-08.md).
- Dependency policy passes with Next **16.3.8**, sharp **0.35.5** and the existing
  narrowly mitigated braces exception. This is not a zero-vulnerability claim.
- King is a low-memory host. Build images only in CI, never locally/on King.
  Preserve its operational checkout, Compose, `.env.production` and PostgreSQL.
  Stage exact-source support separately; never pull/reset the server checkout.
- The current release verified provenance, actual staged capacity, a bounded
  read-only attachment audit and stopped-writer five-component backup
  `chat-reader-20261028T192159Z`. Stop application writers, not PostgreSQL,
  before future consistent release backups; use `--no-deps --no-build`.
  Never replay completed release helpers or automatically restore the database.
- Existing verified backups are retained; no backup pruning was authorized in
  this batch. Server-local backups may share hardlinks and are not independent
  physical/off-site copies. No off-site or scheduled backup is configured.
- Current/direct rollback is `f8a6a06`/`b4effda`, both at `20261022_0053`;
  image rollback needs no schema downgrade. The older `c7dc074` image set is
  retained. Older rollback pointers and downgrade commands are historical.
  Follow [deployment](docs/deployment.md) and the current release record.
- King Compose 2.27 does not accept `run --pull never`. Release-only overlays use
  `pull_policy: never`; validate configuration and mounted checks before stopping
  writers. The interrupted first attempt and verified recovery remain recorded.

## Project and source map

| Area | Authority / entry |
| --- | --- |
| Profile | Frontend/backend monorepo: Next.js 16, React 19, TypeScript; FastAPI, SQLAlchemy, Python 3.11+; PostgreSQL 16 |
| Packages | Corepack + pnpm 9.15.4; `package.json`, `pnpm-lock.yaml`, `apps/api/pyproject.toml` |
| Web | `apps/web/app/`, `features/`, `components/`, `lib/`; `apps/web/e2e/` |
| API | `apps/api/app/main.py`, routers/services/models/schemas; `apps/api/tests/` |
| Worker | `apps/api/app/workers/import_worker.py`; one concurrent background job |
| Data | PostgreSQL + `apps/api/alembic/versions/`; `schemas/` is reference material |
| Delivery | `.github/workflows/build-release-images.yml`, `docker-compose.production.yml`, `deploy/` |
| Current references | [System facts](docs/system/README.md), [API](docs/api-reference.md), [testing](docs/testing.md) |

Browser requests use same-origin `/api/*`; Next forwards them through
`API_INTERNAL_URL`, which matters at build time as well as runtime.
Canonical PostgreSQL data, Alembic and current code are the rendering authority.
Raw imports and Continuation files are not a second canonical data source.

## Current product decisions

| Area | Required behavior |
| --- | --- |
| Reading | Projects/Unclassified → Conversation → Reader; owner, public Share and Offline Reader retain separate access boundaries, complete turns and stable real DOM anchors |
| Offline | `/library`, Dexie v2, offline package v3; retain v1/v2/v3 reads and existing device data; failed replacement keeps the last readable copy |
| Authentication | One deployment-managed Root Admin plus isolated user accounts; server-authenticated UUID owns private data/tasks; public Share remains token/password scoped |
| Device boundary | Expired authorization locks local protected data; only the same verified account can resume it; signout/cleanup account for pending edits and drafts |
| Context | Current/Index read, edit and drop beside annotations; direct saves retain the other member and latest three snapshots; **no semantic validation, candidates or adoption** |
| Context return/export | Conversation-scoped `.context.zip`; returns do not modify Raw/assets; full export may include user-managed saved files without endorsing claims; restricted/Share exports exclude private Continuation |
| Source editor tables | Local-only, phase closed: editable rendered table and Markdown, four edge `+`, bounded paging, invalid/stale/pending guards and one undoable CodeMirror transaction. Final checkpoint: **122 focused / 1,513 service-free / 76 Chrome**, with 20 source hashes rechecked at closeout. Extreme-table long tasks remain; no authenticated Reader/Offline/Share, physical-device or server-OOM acceptance. See the [closeout and reopen criteria](docs/execution/ux-audit-table-closeout-2026-10-21.md) |
| Skills | ZIP/Markdown upload and replacement; unchanged instructions and user-supplied Acquisition/Maintainer/Normalizer defaults; **no Skill viewer/editor/history UI** |
| External tooling | No application model calls or execution of uploaded scripts; reviewed external Bundles are separate from defaults; independent external-model behavior is unverified |
| Settings/archives | Personal settings before Root tools; `.cr` restore in Data & backup; additive personal restore previews/deduplicates; system v5 preserves ownership; old formats remain readable |
| Cleanup/rules | Default KEEP; explicit review creates normal versions; stable rule revisions, acquired permissions and explicit publication; source fingerprints prevent reuse of stale deletion consent |
| Recovery | Unknown writes require explicit read-only result checks; confirmed writes are not undone by failed refresh; retained tasks differ from browser downloads |
| Synchronization/admin | Field revisions, real reading anchors, outbox/conflict recovery; remote positions do not force Reader jumps; audited Root access does not weaken user ownership |

## Known limitations

The [annotations/table follow-up](docs/execution/ux-audit-followup-2026-10-13.md),
[write recovery](docs/execution/ux-audit-annotation-writes-2026-10-13.md) and latest
[creation/addition repair](docs/execution/ux-audit-annotation-composition-2026-10-13.md)
are implemented locally. Their browser, focus, touch, visual and device CPU/RSS
acceptance remain pending. Unknown writes and retained comment input belong to
the current workspace scope in memory, not persistent cross-route recovery.
The [My shares transient-read review](docs/execution/ux-audit-share-transient-read-2026-10-13.md)
adds bounded transient-error retries and retained-list feedback that directs to
Refresh after exhaustion. Its 10 new actual QueryObserver checks pass. The
[offline inspection repair](docs/execution/ux-audit-offline-resource-check-2026-10-13.md)
has 10 passing compiled-sidebar checks. Local browser access returned connection
refused; no actual browser acceptance follows from test discovery. The user
requested continuing local fixes without login. No further CI/deployment started.
The [task-status repair](docs/execution/ux-audit-task-status-recovery-2026-10-14.md)
has 22 passing compiled-component/query checks, including the failing pre-edit
cache-mutation/manual-retry probe. Unresolved checks remain scoped to the mounted
monitor in memory; browser lifecycle, focus and screenshots remain unverified.
Current-state checks are not original mutation receipts. A local build resource
failure was resolved with a lower process heap cap; that is not product memory
measurement. Some task temporary logs and archives later disappeared for an
undetermined reason; fresh local verification is recorded in repository evidence.
The [personal archive repair](docs/execution/ux-audit-personal-archive-scope-2026-10-14.md)
has 36 passing component/query checks for retired callbacks, delayed confirmations,
metadata-only retries, retained files/keys and conditional no-scroll focus recovery.
It does not cancel accepted server tasks when a panel closes or change restore data.
The latest local source-only batch adds a local retry to the offline conversation
files panel, a localized cache-preserving retry to the Reader share panel, and
initial recovery plus position-preservation fixes to the public Share reader.
This batch was intentionally not validated or published per the user's direction;
browser, service, script, lint, typecheck, build, CI and deployment evidence remain
absent for these three changes. Authentication navigation and rendered layout
remain unverified. Production and release authorization are unchanged.
The [account-security error-copy repair](docs/execution/ux-audit-account-security-error-copy-2026-10-14.md)
also separates local preflight failures from logout/password outcomes and avoids
rendering raw exceptions. It is source-only and intentionally unverified; the user
will perform follow-up verification. No CI or deployment was started.

SMTP remains unconfigured in the verified production snapshot; administrator reset
links remain available. Attachments are not malware-scanned under the accepted
low-memory deployment policy; integrity checks do not mean they are safe.
Browser eviction/quota and real-device variance remain operational risks.
Do not claim a full interactive production browser matrix, an external semantic
Skill trial, or a fix for the earlier unrelated Next stream-close observation.
The follow-on audit uses source, synthetic checks and isolated CI evidence, not
production browsing. Findings must be recorded before further product edits.

## Commands and workspace rules

| Check | Command |
| --- | --- |
| Web lint / typecheck | `corepack pnpm run lint` / `corepack pnpm run typecheck` |
| Web build | `corepack pnpm --filter web build` |
| API tests | `corepack pnpm run test:api` |
| Migration head | `cd apps/api; python -m alembic heads` |
| Playwright/PWA | `corepack pnpm --filter web test:pwa` |

Follow [AGENTS](AGENTS.md). Task temporary files belong under
`C:/Users/86182/Desktop/wkkk/chat-reader-release-resume-20261008`, with process-local
TEMP/TMP. The stopped isolated fixture remains under
`wkkk/chat-reader-offline-recovery-20261006`; preserve it, do not re-initdb.
Do not touch user imports, production volumes or unrelated local residues.
Existing unrelated `apps/web/tsconfig.tsbuildinfo` and the two auth-resume test
directories remain outside release commits.

## History and next action

[Archived entry checkpoints](docs/archive/PROJECT_STATE-before-release-2026-10-08.md)
retain the earlier batch summaries and their original failed/skipped/local-only
meaning. [Execution records](docs/execution/README.md) own dated evidence;
[documentation inventory](docs/documentation-inventory.md) owns document roles.
Historical “uncommitted/no deployment authorized” statements do not override the
current user-authorized release above.

Current next-action boundary: the accepted release and independent
post-deployment recheck are complete. The subsequently authorized, bounded
15-item 2026-10-29 source batch above is implemented but unverified/unsubmitted.
Do not dispatch CI, commit, push, migrate or deploy it without authorization;
do not start an additional optimization cycle.
Exact-source backup/preflight helpers have passed actual Docker/stopped-writer
verification; that does not prove an isolated restore drill.
Do not restart the historical unlimited audit or remaining resource/browser
gates automatically. Preserve the pre-existing build-info change and evidence.

### Earlier ordinary-user audit backlog — historical, not an active work order

The earlier next action was to continue the ordinary-user audit after the local rich-text checkpoint
and subsequent source-only sidebar/offline-search/Reader/attachment-query and
offline-continuation read-state repairs, plus sync-center hidden-inspection, scoped-read feedback,
tab-read-scope, partial-read recovery, visible-inspection coalescing, conflict
merge draft refresh protection, resolution recovery and conversation-search
selection/navigation-lifecycle, shared Reader retirement and independent Share
navigation/saved-position retirement, Share sheet and shared Reader
navigation-sheet lifecycle follow-ups.
Continue uncovered Reader/search/settings/offline recovery;
search selection/lifecycle/retirement, partial-read, inspection and conflict browser/storage
acceptance is still pending, as is resource measurement where relevant. Do not replay the
completed scheduling audits. Panel search completion/close now has source-only
ownership fences, not active load/scroll cancellation. Shared Reader failure/
stage publication and footer search dismissal now also have source-only fences;
their browser/anchor/real-scheduler acceptance is still pending. Do not replay
those completed source reviews as verification. Share stage ownership, restore
takeover and token-scoped local readiness now have source-only repairs, not
mounted React, storage or real-anchor acceptance. Share sheet completion/feedback
now has separate source-only scope/sequence/fresh-open activation fences,
including batched close/reopen; its real overlay/focus/
announcement acceptance is pending. Shared Reader navigation-sheet completion
and other-utility transition now also have source-only fences, not accepted
online/offline overlay or scheduler results. Share tablet navigation now also
reuses the existing dialog focus lifecycle and labeled modal section, with
authored but unexecuted regressions; real keyboard/screen-reader, background
browse-mode isolation and breakpoint/scroll acceptance remain pending.
Share position initialization and later storage failure now have source-only
nonpersistent-reading/feedback/disable fences, not actual crypto, denied/quota
storage, durable removal or scroll/announcement acceptance. Stored-position
shape now has a source-only read guard and unexecuted compatibility/query/
restore cases; well-shaped stale/out-of-scope positions and indefinitely
pending digest remain separate. Share unlock now also has source-only owned
attempt/visit retirement and gate-state recovery, with unexecuted regressions;
real auth/cookie, keyboard/password-manager and slow-response acceptance remain
pending. Share edge-window entry/completion/error/finally now also checks the active
visit, with nine actual-loader adapter checks passed on 2026-10-16; real scroll reversal/unmount acceptance
remains pending. Delayed workspace-open/source-editor confirmation work remains
separate.
The sampled direct
annotation/notebook reads did not need Query scheduling edits, but their broader
recovery/browser acceptance remains separate. Record evidence before changes.
The earlier [notebook draft queue checkpoint](docs/execution/ux-audit-notebook-draft-write-queue-2026-10-13.md),
revision comparison and My shares reviews retain their own pending browser
acceptance. The deployment cycle is finished; do not replay its helpers,
dispatch CI or deploy further changes without a new explicit release request.
Historical failed runs retain their original meanings in the release record.
Do not retry the denied local service start. Keep local callback/element evidence
distinct from actual browser execution and device CPU/RSS measurements. The
overall optimization goal was active at that historical checkpoint; the current
table closeout above supersedes that instruction.
