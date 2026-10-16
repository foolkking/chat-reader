# Project State

Last updated: 2026-10-16. This is the current snapshot, not a release history.

## Release and active work

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
was not running; it is not a passing browser gate. CI/deployment acceptance is
pending.

| Item | Verified state |
| --- | --- |
| Release in progress | [UX release execution](docs/execution/UX_RELEASE_2026-10-16.md): exact-source run 38857719980 (`feba956`) passed API but failed settings (460 passed / 3 failed) and default PWA (137 passed / 2 failed). Follow-up repairs the Response-method assertion, pre-open Dexie fault injection and a reproduced durable-notebook save admission gap; scoped cleanup owns its failed-sync fixture timing. Latest local checks: associated settings 105/105, default PWA 139 passed / 737 conditional skips, UX Node 1,421/1,421, CI contracts 15/15, lint/nonincremental typecheck/build passed. Earlier failed and diagnostic runs remain separately recorded. New full exact-source CI remains required. After the next dispatch, wait for the user to report its result; do not watch CI or deploy. Production has not changed |
| Production | Source `84988a260c48fcafb8b3bed6fcb7a1f16348111d`; accepted [CI 38255213036](https://github.com/foolkking/chat-reader/actions/runs/38255213036), all five jobs; original artifact 11752048475 independently verified |
| Production database | Single head/current `20261008_0050`; this release remained 0050→0050 with no migration, reconcile or backfill; API/Web/PostgreSQL healthy and worker `alive_idle` |
| Data acceptance | 84 stopped-writer all-column table fingerprints and four storage roots unchanged; 310 attachment object hashes verified; 67 stable table counts unchanged after restart |
| Latest release CI | API **1,239 passed / 3 skipped**; all 13 Web gates pass, including Context 35, mutation 100, attachment 21 and PDF 13; settings **439 passed / 0 failed / 0 skipped**, plus one passing fresh-instance restore case |
| Earlier candidate CI | Canonical-URL revision repair a12ce9e passed CI 37812290017; its artifact was never deployed separately. Its changes are included in accepted 84988a2 |
| Local UX closeout | The resumed ordinary-user UX implementation and permitted service-free verification are complete at the pre-release checkpoint. Noise supports cross-page multiple candidates and exact editable removal ranges; rich-text uses bounded display-only compatibility, not arbitrary HTML/widgets. The administrator Skill and system archive recovery changes remain in the same release batch. The user explicitly authorized commit, CI and deployment on 2026-10-16; runtime and release acceptance now proceed through the gates below |
| Latest local verification | [Service-free UX continuation](docs/execution/ux-audit-service-free-regression-2026-10-16.md): repaired fourteen stale test adapters without skipping cases; all 63 Node files passed **1,412/1,412**, full Web lint, nonincremental typecheck and Web build passed. Release preflight API **1,129 passed / 159 skipped**; local PWA stopped after missing-API timeouts, not accepted. A reproduced Share edge entry defect is fixed: retired callbacks cannot start a read or loading/error work. PostgreSQL/PWA, CI and deployment acceptance remain pending |
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
| Release authorization | The authorized cycle is complete: 14 synthetic screenshots reviewed, original images checked, backup/data/runtime acceptance and pointer/retention finalization passed. [Deployment acceptance](docs/execution/ATTACHMENT_DEPLOYMENT_2026-10-12.md) owns evidence. Further optimization is local; **no additional CI or deployment without a new explicit user request** |
| Recovery points | Current/rollback 84988a2/30a0d32; exact rollback images loaded. Verified backups 20261008T134403Z and 20261012T143850Z; older 20261006T141424Z removed after acceptance under the two-point policy |
| Release owner | [Accumulated optimization release](docs/execution/OPTIMIZATION_RELEASE_2026-10-08.md) owns exact commits, every failed run, artifacts and acceptance |

The user authorized this order: commit accumulated improvements, pass complete
exact-source CI, deploy those verified images to King, then continue the
ordinary-user product audit. The overall goal remains unfinished. At least 15
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
release is now independently accepted at 84988a2; King retains 30a0d32 for rollback.

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
0 skipped**; it was not rerun for this UI/test-only repair. Source still has one
Alembic head `20261008_0050`. Older checkpoint counts overlap and are not added.
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

- Local lint, nonincremental typecheck, bounded Web build and single source head
  0050 have passing evidence. Accepted-production full API CI is **1,239 passed /
  3 skipped**. Local and older suites overlap; do not add them as unique cases.
- In the accepted release CI, all 13 Web gates pass, including the
  100-case mutation gate. Default PWA: **135 passed / 699 conditional skips**;
  adaptive-import recovery has one conditional skip. Skips are not passes.
- The 16 formerly pending selection/offline cases ran in isolated settings CI.
  This is not local acceptance with the user's specified Windows Chromium.
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
- The completed release verified provenance, 310 attachment hashes, capacity and
  a consistent five-component backup. Stop application writers, not PostgreSQL,
  when a future migration requires it; use `--no-deps --no-build`. Never replay
  completed release helpers or automatically downgrade/restore the database.
- Current verified backups: `chat-reader-20261008T134403Z` and
  `chat-reader-20261012T143850Z`. The exact older 20261006T141424Z point was pruned only
  after acceptance under the two-backup policy; final report has no candidates.
  No off-site or scheduled backup is configured.
- Current rollback points to 30a0d32; its exact API/Web images are already loaded.
  Older rollback pointers are historical, not the active recovery target.
  Follow [deployment](docs/deployment.md), not old commands from dated records.
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

Next: continue the full ordinary-user audit after the local rich-text checkpoint
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
overall optimization goal remains active.
