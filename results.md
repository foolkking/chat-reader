# Implementation Results

## Formula Dense Reader Scroll Stabilization - 2026-08-13

The reported slowdown after formulas had already loaded was traced to repeated ReactMarkdown/remark/rehype-KaTeX work on unchanged virtual blocks, compounded by ordinary-text height estimation for long display LaTeX and layout propagation from the full `htmlAndMathml` subtree. The fix keeps complete MathML and all existing KaTeX security settings, but memoizes cross-block projections and block/rendering subtrees, adds formula-aware bounded virtual estimates, and applies local `contain: layout paint` to display math.

Verification: Web typecheck PASS, production build PASS, focused ESLint PASS, parser/layout/browser-independent tests `17/17 PASS`. The full Rich Markdown browser suite was fixture/server-gated in this local run and is not counted as PASS. No database/API/migration/canonical source/attachment/Viewer changes were made. Production wheel trace, frame interval, long-task and real formula-heavy conversation metrics remain `NOT_PRODUCTION_VERIFIED`.

## Manual TOC Refresh - 2026-08-13

The Owner Reader now exposes `更新目录` in the top-right More menu. Its accessible dialog allows dialogue index, section contents, or both; section rebuilding defaults to the current conversation and can explicitly target every non-deleted conversation. At least one target is required.

The implementation preserves one source of truth: dialogue index rows are dynamically projected from current canonical messages, so refresh validates that source and then precisely invalidates the Web query cache. Persisted Heading rows are the only derived materialization rebuilt by the worker. The operation does not bump conversation revision, rewrite messages, reset Reader position, or add a migration. All-conversation rebuilding is idempotently queued and reports per-conversation progress.

Local verification PASS: TOC route + builder `4/4` (route `3/3`, builder `1/1`), Web contract `1/1`, lint/typecheck/production build PASS, full API `236 passed / 4 fixture-gated skipped`, default PWA `59 passed / 36 environment-gated skipped`, Alembic `20260806_0021`. Skipped PWA flows are reported separately and are not PASS.

Production deployment PASS: commit `9d338a001c612bfd837de6a9ee5d06cdb684df61`, Actions run `31621723794`, artifact SHA-256 `8b0123f93a382535d378e16d5d5a046049ba245870d955dc009e1262cbbdca1b`, validated recovery point `/opt/chat-reader/backups/toc-refresh-20260813T012000Z-9d338a0`. API/Web/PostgreSQL are healthy, worker runs, Scanner is stopped and Alembic remains `20260806_0021`.

Real production Chrome PASS for the isolated QA current-conversation flow: More entry, both default targets, current default section scope, all-scope selection, initial focus, exactly one accessible Close, Esc focus restoration, combined/current, dialogue-only and section-only tasks, accessible completion feedback and refresh stability. The current section job produced two headings and the derived operation left revision `5` unchanged. The all-conversations section branch is `NOT_PRODUCTION_VERIFIED` by deliberate data-safety choice; real API/worker integration is PASS. The QA Conversation was deleted through the product API and returned `404` afterward.

Post-acceptance cleanup retained current `9d338a0`, rollback `3ed9dc7` and `latest`; it removed only superseded `9e3bc99` Chat Reader image tags/layers and the transfer archive. Releases are 4 KiB and root free space is about 16 GiB. No business volume, user data, `.env.production`, backup or unrelated image was removed.

## JSON + Markdown Import Compatibility v5 - 2026-08-12

Root cause confirmed: the supplied Markdown contains one `Response` section, and the old detector recognized exporter Markdown only when both literal `## Prompt:` and `## Response:` existed. The route therefore returned `422 unsupported_source_profile` before the existing JSON-aware parser/alignment logic could run; file size was not the cause.

The preview route now classifies the upload batch with JSON message context. Import v5 ignores blank messages anywhere, aligns every non-empty message with a bounded monotonic sequence algorithm, preserves original source indexes, accepts unique timestamp-bound rich Markdown from historical lossy-JSON exporters, and blocks unmatched/ambiguous/unrelated plain content with visible diagnostics. Structured 422 errors are localized in the Chinese Web UI.

Verification PASS: the exact supplied pair previews as one non-empty Assistant message through both API and an isolated production-build file-chooser flow; no commit was performed. Supplied-pair compatibility is `61 passed / 2 skipped`; the real 398-message preview/commit/idempotent-retry matrix is `12 passed / 1 skipped` and preview remains inside the 20-second assertion. Full API is `235 passed / 4 skipped`, Web import contract is `2/2`, default PWA is `57 passed / 36 environment-gated skipped`, and lint/typecheck/production build plus Alembic single-head checks pass. Skips are not counted as PASS. No migration or new dependency was added.

Production Preview PASS: the exact supplied pair returned HTTP `200` in about 1.5 seconds with `can_commit=true`, `alignment=exact_match`, one non-empty message and no warning. The preview was not committed. Its uncommitted ImportRecord remains governed by the existing preview TTL because there is no safe owner-facing immediate-delete endpoint; no direct SQL deletion was used.

The 398-message bottleneck was the unique role/timestamp path still running the full Markdown/thinking comparison for every large message. It now pairs unique monotonic identities in O(n) and performs only bounded validation. Preview logs expose JSON parse, Markdown parse and alignment time separately. Duplicate, reordered and unrelated content retains the guarded conflict path.

## Rich Markdown Scientific-inline Closure - 2026-08-12

Three roots were closed. First, heading rendering applied an element allowlist after KaTeX and unwrapped the semantic tree, making hidden MathML text, TeX annotation and visible HTML appear together. The heading wrapper now retains the shared sanitized KaTeX subtree and suppresses images through its component map. Second, the standalone bracket grammar omitted common scientific commands used by ChatGPT. Third, the v3 production check found eight short conceptual display labels still excluded because they contained English words. V4 adds a distinct, bounded uppercase-label grammar with only `>`/`+` operators and a UI-only `text{...}` projection; lowercase and multiword prose remain text.

Production-equivalent verification is PASS: parser/shared contract `14/14`, Reader/Editor/security/stress `5/5`, and both exact reported-source copies `1/1`; the second full source now has 41 display formulas/MathML and zero residual bracket paragraphs. Neither copy produced math errors or page-level overflow, and canonical source equality held. Full API is `235 passed / 4 skipped`, default PWA is `58 passed / 36 skipped`, lint/typecheck/build PASS and Alembic remains `20260806_0021`.

Production PASS: commit `3ed9dc75e650223b05663000b6429074e1ba4c1b`, Actions run `31614666602`, artifact SHA-256 `e718641b046edadab0560e84363c4d0e0618e994b461a622c29109443c480b92`, validated backup `/opt/chat-reader/backups/import-rich-v3-20260812T151526Z-9e3bc99`. Real Chrome read-only full-source checks confirmed the first page retains 108 display formulas and a single heading formula presentation, while the second page renders `41/41` display formulas/MathML with all eight bounded conceptual labels, zero errors and zero residual literal bracket paragraphs. Source Preview began collapsed and no edit was saved.

King cleanup PASS: current `3ed9dc7`, rollback `9e3bc99` and `latest` remain. Intermediate `e69a510`, superseded `336486b` and their transfer archives were removed only after replacement health. `/opt/chat-reader/releases` is empty and root free space is about 17 GiB. No volume, PostgreSQL data, user file, `.env.production`, retained backup or unrelated image was removed.

## Archived Project Deletion - 2026-08-12

Root cause: the product implemented archive/restore but had neither a project-delete API nor a delete action on the Archived page. The closure adds a guarded terminal operation for archived non-default projects. It preserves every conversation/message by moving project relations to the internal Unclassified project before deleting only the Project row; pins, recent placement, offline revision and placement events are reconciled in the same transaction.

The Archived page now supports per-row and batch permanent deletion with explicit retained-data copy and partial-failure feedback. Verification: project API `9/9`, Web contract `1/1`, lint/typecheck/build PASS, full API `220 passed / 3 skipped`, Alembic `20260806_0021`. Production deployment and real QA flow are recorded after the external image release.

Production PASS: commit `0f004f7ce79cc6b97e68a8756c6ea21d6a75cc9f`, Actions run `31576690022`, artifact SHA-256 `1d34431be81000854736a1185264a523ec875db5252c3bb0ea8b1c1f4f6a4d67`, validated backup `/opt/chat-reader/backups/project-delete-20260812T0810Z-0f004f7`. Real Chrome completed create -> archive -> delete -> project absent -> conversation retained under Unclassified -> refresh, then removed the disposable QA conversation through the product API.

King image-package cleanup is complete: 18 legacy top-level archives, six legacy release directories containing only Chat Reader image tar/checksum pairs, the transfer archive and superseded `4d07ce4` images were deleted. `/opt/chat-reader/releases` fell from about 3.8 GiB to 4 KiB; final root free space is about 5.2 GiB. Current `0f004f7`, rollback `336486b`, `latest`, volumes, PostgreSQL, `.env.production` and validated backups were retained.

## Rich Markdown Consumed-inline Closure - 2026-08-12

The reported production message retained math bodies but lost additional outer delimiters during ChatGPT clipboard ingestion: `\(n^6\)` became `(n^6)`, while `[\nf(x)=x^2.\n]` lacked a named LaTeX command and failed the v1 bare-bracket gate. The shared parser now uses `ai-rich-markdown-v2`: compact mathematical parentheses and standalone bracket expressions become semantic `inlineMath`/`math` nodes, while prose, dates, versions, uppercase identifiers, currency and code remain unchanged. This is an AST presentation rule; canonical source and persisted data are untouched.

Production-build results: parser/core `12/12`, Reader/Editor/security/stress `5/5`, reported full-source copy `1/1`, Markdown attachment `1/1`, lint/typecheck/build PASS, API `220 passed / 3 skipped`, default PWA `54 passed / 34 conditional skipped`, Alembic `20260806_0021`. The explicit full-source preview rendered 108 display formulas and at least 108 MathML nodes with zero math errors and no document horizontal overflow. The ephemeral QA copies were deleted through the product API. Conditional PWA skips are not counted as PASS. Production deployment and read-only verification are appended after the external release.

Production PASS: commit `9e3bc99595dfc958c0167763a68b95890b98f431`, Actions run `31580890665`, artifact SHA-256 `493f080d973c7b2aedcf3e61f18762471f613a04599b0bd051943afe16de4dba`, validated 434 MiB backup `/opt/chat-reader/backups/rich-inline-20260812T090711Z-9e3bc99`. Real Chrome on the reported Conversation confirmed renderer v2, default-collapsed preview, 108 display formulas, 130 MathML trees, recovered `n^6`/`k`/`f(x)=x^2`, zero math errors and no page overflow. The source editor was closed without saving.

King cleanup PASS: the deployment archive and superseded `0f004f7` API/worker/migrate/Web layers were removed only after health and Chrome acceptance. Current `9e3bc99`, rollback `336486b` and `latest` remain. `/opt/chat-reader/releases` is 4 KiB and final root free space is about 4.1 GiB after retaining the verified backup. Volumes, PostgreSQL, `.env.production`, historical backups and unrelated images were untouched.

Backup retention cleanup PASS: a read-only audit found `/opt/chat-reader/backups` consuming about 15 GiB. After checksum/archive/PostgreSQL validation of the protected recovery chain and confirmation that no container mounted the directory, 50 redundant historical snapshots (13,701,926,937 bytes) were removed. Retained coverage comprises the July 30/31 baseline, `38c57c1` Release Closure, `336486b` rollback, and `9e3bc99` current release. Backups now use 1.5 GiB; root availability increased from 4.1 GiB at 90% usage to 17 GiB at 56% usage. API/Web/PostgreSQL remained healthy, the import worker remained running, public and same-origin health returned `ok`, and no business volume, database, user file, environment file, current/rollback image, or unrelated service was removed.

## AI Rich Markdown Rendering Release - 2026-08-12

### Root cause and implementation

- The previous pipeline already had `remark-math` and KaTeX, but CommonMark consumed the backslashes in ChatGPT `\[`/`\]` and `\(`/`\)` before `remark-math`; the parser therefore produced literal brackets/text instead of math nodes. Dollar parsing also interpreted currency ranges too aggressively.
- `remarkAiMathCompatibility` now recovers ChatGPT delimiters from mdast source positions only in ordinary text, produces `math`/`inlineMath` nodes, excludes code, and demotes currency-like single-dollar nodes. There is no regex source rewrite and no DOM auto-render pass.
- Reader, Source Editor preview and Markdown attachment inline/Viewer use one shared GFM/Math/footnote/security core. Source is not changed or persisted as generated HTML. No migration, API or export format changed.
- KaTeX uses local `htmlAndMathml`, `trust=false`, `maxExpand=1000`, `maxSize=20`; malformed math is isolated. Math/table/code own overflow. Unsafe HTML/links stay inert and remote Markdown images are not fetched automatically.
- Offline shell revisions now explicitly include current same-origin `KaTeX_*` font assets rather than depending on an incidental online font request.
- The real Markdown attachment flow exposed an upload-completion race: the draft could become `ready` before React received CodeMirror's `cr-asset://` replacement. Completion now seeds the canonical editor document before enabling save; the regression requires the first PATCH to return 2xx.

### Verification before deployment

| Check | Result |
| --- | --- |
| Web lint / typecheck / production build | PASS |
| Rich parser + shared-core static tests | `4/4 PASS` |
| Reader/Editor/security/109-formula stress/attachment matrix | `8/8 PASS` |
| Real Markdown attachment upload/save/inline/Viewer | `1/1 PASS` |
| Heavy Reader Owner/Share regression | `8/8 PASS` |
| Default PWA matrix | `45 passed / 31 conditional skipped` (`PARTIAL_PASS`; skips not PASS) |
| Offline KaTeX inventory and cold start | `1/1 PASS` |
| API suite | `218 passed / 3 skipped` |
| Alembic | one head `20260806_0021`; no migration |
| Production deployment / Chrome | PENDING at candidate stage; appended after release |

Golden screenshots: `docs/execution/screenshots/ai-rich-markdown-desktop-1440x900.png` and `ai-rich-markdown-mobile-360x800.png`. They contain only synthetic QA content and supplement DOM/source assertions; they are not the sole evidence.

Current statuses: `AI_RICH_MARKDOWN_CORE=PASS`, four delimiter modes PASS, Math error/security/accessibility/overflow PASS, GFM table/task/strike/autolink PASS, footnotes PASS, code isolation PASS, Reader/Editor/Markdown attachment PASS, Long Reader PASS, 360px reflow PASS, and `OFFLINE_KATEX_ASSETS=PASS` in production-equivalent PWA.

### Production deployment and Chrome acceptance

| Check | Result |
| --- | --- |
| Commit / Actions | `4d07ce40fd8f130c219e8535bcd2c2f8d9910d97` / run `31560459470` PASS |
| Release archive | SHA-256 `c47168693d2d3efb9aca3ca8fe4b7ff122a08ee511ce9cfeef77f10c0442a2e5` matched locally and on King |
| Backup | Validated PostgreSQL and import/export/offline/asset archives at `/opt/chat-reader/backups/ai-rich-markdown-20260812T034100Z-4d07ce4` |
| Migration / health | `20260806_0021`; API/Web/PostgreSQL healthy; worker running; Scanner stopped |
| Golden formula / delimiters | PASS: 5 KaTeX roots, 2 display roots, 5 MathML trees; currency remained text |
| GFM / footnotes / code | PASS: semantic table/del/task markers, scoped reference/backlink, fenced and inline code excluded from math |
| Security / overflow | PASS: no executable unsafe link, no script execution, no document-level horizontal overflow |
| Source Editor | PASS: raw `\[`/`\boxed` preserved; shared formula preview rendered; type/backspace kept selection offset |
| Offline shell UI | PASS: `/library` immediately reported `可离线启动 · 78 项资源`; exact font membership is PASS in production-build SW cold-start E2E |
| Exact 360/390 production Chrome | NOT_PRODUCTION_VERIFIED in the current bridge; exact production-build 360/390/768 is PASS |
| Production screenshot | NOT_CAPTURED: Chrome capture timed out; production DOM assertions plus synthetic local screenshots are retained |
| QA cleanup | PASS: disposable synthetic Conversation deleted via product API |
| Image cleanup | PASS: retained current `4d07ce4` and rollback `3b544fe`; removed obsolete `1cdadc4` and transfer archive |

Production logs contained only the known extension message-channel error. API/Web logs and health contained no new application error. The production formula phase therefore passes its release gate; unrelated unexecuted PWA quota/interruption negative paths remain outside this phase and are not upgraded to PASS.

### ChatGPT bare-bracket follow-up

Read-only inspection of the reported production Conversation found 21 standalone `[`/`]` formula pairs, 6 `\\boxed`, 51 `\\frac` and 15 `\\sqrt` commands, but zero surviving outer `\\[`/`\\]`. The API block builder had also divided formulas at blank lines. The first release correctly handled intact delimiters but could not reconstruct a formula after both delimiter loss and RenderBlock splitting.

The parser now accepts a bare-bracket display only when standalone `[`/`]` or `/[`/`]/` delimiters bound a multiline body containing a recognized LaTeX command and the source range does not intersect code or HTML. It also repairs pasted Setext equality/heading artifacts only after that boundary is established. The Reader adds a UI-only paragraph/heading cross-block projection before the shared parser; canonical Markdown, persisted RenderBlocks and export remain unchanged. Ordinary bracket prose, headings and fenced LaTeX remain ordinary/code. Source Editor preview now starts collapsed at every viewport and keeps an explicit accessible toggle.

Focused parser/Reader/Editor verification is `10 passed`. The exact production canonical source was copied into a transient local QA Conversation: all `22/22` formula groups rendered as display math with `22/22` MathML trees, zero KaTeX error fallbacks, no visible raw `\\boxed`/`\\frac`/`\\sqrt`, and no page-level horizontal overflow. The QA copy was deleted through the product API. Web lint/typecheck/build PASS; API `218 passed / 3 skipped`; Alembic single head `20260806_0021`; default PWA `49 passed / 32 conditional skipped`. Conditional skips are not PASS.

Deployment PASS: commit `336486b89c12c1536763698feda4c550502b49eb`, Actions run `31573557959`, artifact SHA-256 `c3e6463a9689061430d7b28a7970550553cab6fdcf2020d2f2b19b04a96627e3`, verified backup `/opt/chat-reader/backups/rich-markdown-followup-20260812T072512Z-336486b`. King used external images, migration preflight and `--no-build`; API/Web/PostgreSQL are healthy, worker runs, Scanner is stopped and Alembic remains `20260806_0021`. Real Chrome on the reported Conversation confirmed 22 display formulas, 22 MathML trees, zero errors, zero visible raw LaTeX and no page overflow. Source Editor default preview was absent with its toggle false; after explicit expansion it rendered all 22 formulas. No production data was changed. Cleanup retained current `336486b` and rollback `4d07ce4`, and removed older `3b544fe` plus the transfer archive.

## Offline Startup, Attachments and Context Skill Delivery - 2026-08-11

### Root causes closed

- The Library shell was hard-coded to `preparing`, waited for `window.load` and dynamic viewer imports, and used historical Performance entries for its revision. That made a valid active shell appear blocked and could block downloads. Availability is now independent from background reconciliation; active shells are ready immediately, the inventory is deterministic, and the update is retryable without blocking the page.
- Offline Reader had no corresponding current-conversation-files entry and offline attachment URL misses could leave a blank/indefinite Viewer. It now exposes a read-only panel through the existing workspace and unified Viewer; cache misses are explicit `offline-unavailable` and object URLs are released.
- Context Package delivery had no bilingual Skill path and could allow clipboard failure to obscure the package handoff. The result now offers download/copy/view for both Skill files. Download always starts first, clipboard failure is visible and retryable, and both static files are inert and checksum-pinned.

### Verification

| Check | Result |
| --- | --- |
| Web lint | PASS |
| Web typecheck | PASS |
| Web production build | PASS |
| API suite | `218 passed / 3 skipped` |
| Alembic | PASS, one head `20260806_0021` |
| PWA/Playwright full local matrix | `41 passed / 27 skipped` |
| Offline startup and active-shell preservation | PASS |
| Offline read-only attachment panel and unified Viewer path | PASS |
| Local CanJSON/Markdown/`.context.zip` export | PASS |
| Chinese/English Skill view, download, checksum | PASS |
| Clipboard rejection after package download | PASS |
| Exact 360/390/768 offline reflow | PASS |
| Quota/interrupted package/reconnect/production offline interception | NOT_PRODUCTION_VERIFIED |

The 27 PWA skips are API/fixture-gated online flows in the no-API local web matrix and are not counted as PASS. The local offline exporter is a bounded snapshot projection; it does not alter the server export/import contract.

### Production deployment and Chrome

| Check | Result |
| --- | --- |
| Commit / Actions | `3b544fe` / run `31486218261` PASS |
| Release archive | SHA-256 `1e83d68a5f3c7321e9e9d6f2d5602b043aa32ae127ab5cf3c320e75fa3b7bfe7` PASS |
| Backup | PostgreSQL plus four business archives validated at `/opt/chat-reader/backups/offline-context-20260811T112745Z-3b544fe` |
| Migration / health | `20260806_0021`; API/Web/PostgreSQL healthy; worker running |
| `/library` startup | PASS: `checking` to `ready` in about 2.5 seconds, 27 shell resources, update action usable |
| Existing offline Reader | PASS: 398-message snapshot opened, no page overflow |
| Offline current-conversation files | PASS: read-only entry/panel present, no management actions |
| Offline local `.context.zip` | PASS: generated from the existing snapshot without server mutation |
| English Skill viewer | PASS: content and pinned SHA visible |
| Production download event / clipboard readback | NOT_PRODUCTION_VERIFIED_IN_THIS_BROWSER_BRIDGE; UI reported success and production-build Playwright is PASS |
| Image cleanup | PASS: retained current `3b544fe` plus rollback `1cdadc4`; removed obsolete `b6ce0e6` and transferred archive |

Offline quota exhaustion, interrupted package writes, stale-package reconnect and a real production network cut remain verification debt. Therefore this release does not claim the complete PWA negative matrix as PASS.

## Reader Scrollbar Jump Blank-Window Closure - 2026-08-10

### Root cause

- Production Chrome reproduced persistent empty Reader content after large scrollbar jumps: the visible article remained mounted, but `visibleBlocks=0` and its nine virtual rows were placed roughly 33,000px below the viewport.
- The API and message data were present. A stale per-message `scrollMargin` survived edge-window growth and upstream virtual-height correction, so the virtualizer selected a valid range in the wrong coordinate system.
- Native thumb dragging also allowed the sentinel load to merge more messages before pointer release, changing total scroll height during the gesture.

### Remediation

- Visible virtual gaps now rebase from the real DOM offset without clearing measured row sizes.
- Pointer-down proactively requests a coordinate rebase. Sentinel visibility is still tracked during drag, but the fetch/merge is deferred until pointer release and invoked once.
- Ordinary wheel scrolling does not perform the recovery DOM scan unless the virtual range changes and the message shell is actually visible without a visible row.

### Verification before deployment

| Check | Result |
| --- | --- |
| Web lint / typecheck / production build | PASS |
| Reader restoration, navigation, Share and wheel suite | `8 passed` |
| Blank-jump + continuous-wheel repeat (3x each) | `6 passed` |
| API | `216 passed, 3 skipped` |
| Alembic | single head `20260806_0021` |
| Default PWA matrix | `37 passed, 25 conditional skipped` (`PARTIAL_PASS`) |

## Reader Wheel Performance Stabilization 2026-08-10

### Root cause and implementation

- The six-message Reader window was working, but three mounted Assistant messages contained 402, 389 and 501 virtual blocks. Coarse estimates (including a fixed 260px for code) caused approximately 550–640px total-height corrections during small wheel sequences.
- The wheel path also scanned mounted messages/blocks with repeated rectangles, observed the changing virtual total-height container and retained two edge-load triggers. These combined measurement, compensation and state updates made the wheel feel detached from user input.
- The fix introduces metric-aware block estimates, Unicode/CJK visual-line accounting, bounded compensation above the reading line, stable-width observation, one Owner/Share active-target resolver, one 80ms/trailing scroll coordinator, a single idle reading-position save, sentinel-authoritative edge loading and memoized TOC following.

### Verified locally

| Check | Result |
| --- | --- |
| Estimator + Owner/Share long Reader suite | PASS, `9/9` |
| 30-step wheel monotonicity | PASS, no reverse correction over 2px |
| Warm 1000px virtual-height drift | PASS, within 200px budget |
| Mounted messages / virtual rows | PASS, `<=6` messages and bounded row overscan |
| Wheel persistence | PASS, zero writes during input and one after idle |
| Middle-window edge traffic | PASS, no Reader turn request |
| Three Chromium performance runs | PASS, median p95 `16.7ms`, longest task `70ms`, total long-task time `70ms` |
| Web lint/typecheck/build | PASS |
| Full API | PASS, `216 passed / 3 skipped` |
| Default PWA matrix | PARTIAL_PASS, `37 passed / 22 conditional skips` |
| Alembic | PASS, one head `20260806_0021` |

Production deployment and read-only Chrome verification are appended after the external image release. No existing production message or attachment is modified for this acceptance.

## Release Stabilization / Lifecycle Closure 2026-08-10

### Implemented

- Mutation responses now carry the committed conversation revision, and the Web uses it as canonical cache state. Conversation creation seeds the new conversation query; insert/edit/task/version/delete/restore handoffs no longer leave the next action on a stale revision.
- Delete -> Undo uses the delete response revision, has visible restoring/failure/retry states, refresh persistence coverage and idempotent repeated restore. This remains short soft-delete recovery, not Trash.
- Attachment API exposes current-version occurrence count independently from active/detached status. Scanner-disabled metadata is neutral `未扫描`. Dialogs use shared initial focus/trapping/restoration and non-focusable backdrops; project creation copy/autofocus is localized.

### Verified this release (local)

| Check | Result |
| --- | --- |
| Targeted attachment + message lifecycle API | PASS, 10 passed |
| Full API suite | PASS, 216 passed / 3 conditional skips |
| Web lint | PASS |
| Web typecheck | PASS |
| Web production build | PASS |
| PWA default matrix | PARTIAL_PASS, 30 passed / 21 conditional skips |
| Alembic | PASS, one head `20260806_0021` |

### Production browser closure

Final commit `ed9116a` was externally built by Actions `31374507130` and deployed incrementally to King from archive SHA-256 `a6132d7801253da105893967a87e373a151587795c1c220ecb741f53bba1788b`. PostgreSQL and existing imports were backed up at `/opt/chat-reader/backups/stabilization-20260810T0815Z-248b771`; checksums pass. Migration preflight remained at the single head `20260806_0021`, and API/Web/PostgreSQL are healthy while the worker is running.

Real production Chrome now passes the Attachment Viewer initial-focus, Tab/Shift+Tab loop, single Shell/single accessible close, Esc/X/backdrop close and trigger restoration paths. Project creation passes Chinese naming, input autofocus and Escape cancellation with trigger restoration. A requested 390x844 viewport resolved to 433x938 in the browser bridge; that narrow layout has no page horizontal overflow, a non-zero Viewer content area and approximately 44px close/download targets. Exact 360/390 sizing, real 125/150/200% browser zoom, keyboard-only mutation flow, genuine two-tab race, browser chooser, forced-offline negative paths, full online Playwright mutation/Reader fixture and QA `.cr` round trip remain `NOT_PRODUCTION_VERIFIED`; skipped tests are not PASS. Existing production records were not modified or deleted.

## 2026-08-10 CSV Table Viewer And Production Release

| Area | Status | Evidence |
| --- | --- | --- |
| CSV/TSV detail default | PASS | `ViewerBody` maps `table` to rendered bounded table mode; production Chrome displayed `MANIFEST.csv` as a table with 70 rows and sticky header |
| Table/Raw toggle | PASS | Production Chrome switched `Table -> Raw -> Table`; Raw used one source `<pre>`, returning restored the table |
| CSV parser bounds | PASS | Quoted fields and embedded delimiters covered by focused test; parser caps 10,001 rows and 256 columns |
| Web lint/typecheck/build | PASS | lint, typecheck and Next production build passed |
| Focused attachment tests | PASS | `13/13` attachment layout/presentation tests passed |
| Production deployment | PASS | commit `5cc491f`, Actions run `31325841867`, archive SHA-256 `d75a66b214932a542fc39f8630f674128f134b61eb51445da59eb75cce117f17`, deployed with `--no-build` |
| Production backup | PASS | `/opt/chat-reader/backups/csv-table-20260810T010711Z`; database and business volumes checksummed successfully |
| Production health | PASS | API/Web/worker/PostgreSQL healthy; `/api/health` status `ok`; capability endpoint reports scanner `disabled` |
| Old image cleanup | PASS | previous service tags removed; current full SHA and `latest` retained; no volume deletion |

Production Chrome screenshot evidence was captured in the deployment acceptance run (2032x975 viewport). The broader PWA matrix remains `PARTIAL_PASS` because 21 online/fixture-gated cases were skipped and are not counted as PASS.

The caption-only follow-up commit `6d025e7` was built by Actions run `31347470091` and deployed from archive SHA-256 `158dc6e03d2fa6abb536a1c0a66e297e8c42e17512db57b7af6e4e1afb5f88f9`. Final Chrome acceptance found zero redundant legacy `Attachment:`/`附件：` footer captions while retaining all three CSV table actions. Current API, Web, Worker and PostgreSQL are healthy. Status: `PASS` for the CSV Viewer and caption closure; `PARTIAL_PASS` for the larger conditional PWA matrix.

## 2026-08-09 Attachment Inline Layout System Candidate

| Area | Status | Evidence |
| --- | --- | --- |
| Group-level alignment | PASS | `AttachmentInlineGroup` partitions adjacent current-version attachments into one of six semantic lanes; individual `mx-auto`/renderer max-width card geometry was removed |
| Reading/Data lanes | PASS | 45rem/55rem centralized limits, bounded preview body, fade/expand and group-stable headers/footers |
| Image Gallery | PASS | no permanent per-image header; aspect-ratio rows, centred capped last row, full occurrence session and dedicated five-plus-`+N` Overview entry |
| AudioList/FileList | PASS | one group surface, row dividers, 38rem lane, progressive actions; Office/archive/CAD/download-only entries no longer form independent cards |
| Video runtime fallback | PASS | supported video uses the 43rem video lane; codec/decode runtime states re-partition to FileList without mutating static capability |
| Scanner/status contract | PASS | `scanner_disabled/unscanned` remains low-weight `未扫描`; no clean/safe wording or Scanner service change |
| Web lint/typecheck/build | PASS | all required Web commands passed; production build generated 9 routes |
| Focused inline/viewer tests | PASS | 12/12 passed |
| API regression | PASS | 216 passed; 3 skipped and not counted as PASS |
| Alembic | PASS | single head `20260806_0021`; no migration added |
| PWA default matrix | PARTIAL_PASS | 28 passed; 21 conditional online/fixture tests skipped and not counted as PASS |
| Production deployment / visual acceptance | NOT_PRODUCTION_VERIFIED | candidate not yet deployed at this documentation checkpoint |

## 2026-08-09 Conversation Editing, Import Stability And Complex Viewer Addendum

| Area | Status | Evidence |
| --- | --- | --- |
| New conversation | PASS | API and schema tests create a non-empty User -> Assistant pair atomically; Web dialog was typechecked and built |
| Message insertion | PASS | API tests cover before/after, inferred opposite role, User -> Assistant pair, ordering and stale revision 409; Web plus dialog is implemented |
| Message delete/undo | PASS | API tests cover soft delete and restore without Trash; optional revision query is validated; Web confirmation/undo toast is implemented |
| JSON + Markdown pairing | PASS | Unique role/timestamp fast path; real `<EXAMPLES_DIR>` fixture has 398 sections with no empty messages |
| Real fixture preview/commit/retry | PASS | Preview, commit and repeated commit passed in the local API harness; elapsed 17.7 seconds, source fixture is read-only |
| Pairing budget failures | PASS | Candidate/transition/deadline guards return structured 422 rather than generic 500 |
| DOCX/ODT Viewer | NOT_PRODUCTION_VERIFIED | Browser Worker extracts bounded paragraphs/tables; build and static contract tests pass |
| XLSX/ODS Viewer | NOT_PRODUCTION_VERIFIED | Browser Worker exposes bounded read-only sheets/grid; build and static contract tests pass |
| PPTX/ODP Viewer | NOT_PRODUCTION_VERIFIED | Browser Worker exposes bounded static slide navigation; build and static contract tests pass |
| ZIP Viewer | NOT_PRODUCTION_VERIFIED | `fflate` Worker validates central directory and bounded text/image entry previews; no King browser acceptance yet |
| Legacy Office/TAR/EPUB/CAD/3D | NOT_IMPLEMENTED | Reliable authenticated download-only fallback remains intentional |
| Web lint/typecheck/build | PASS | `corepack pnpm run lint`, `corepack pnpm run typecheck`, and `corepack pnpm --filter web build` passed |
| API suite | PASS | `216 passed, 3 skipped`; skipped tests remain disclosed and are not counted as PASS |
| Migration head | PASS | `20260806_0021`; no migration added |
| Production verification for this addendum | NOT_PRODUCTION_VERIFIED | No deployment or production data mutation was performed in this round |

The existing production release entries below are historical evidence and are not upgraded by this local implementation. A King release still requires a backup, CI/external Linux image build, GitHub synchronization, pull, migration preflight and `--no-build` recreation.

## 2026-08-09 Adaptive Viewer Presentation Candidate

| Area | Status | Evidence |
| --- | --- | --- |
| Unified Viewer architecture | PASS | one `AttachmentViewerProvider -> AttachmentViewerShell`; PDF tools mount into the same shell toolbar and do not create a second dialog |
| Presentation resolver | PASS | compact/reading/document/media/workspace mapping is unit-covered; presentation remains transient UI state |
| Desktop adaptive sizing | PASS | compact 720px, reading 1000/1240px, document 1120/1280px, intrinsic media <= 90vw x 90vh, workspace 96vw x 94vh |
| Mobile shell | PASS | every presentation resolves to 100vw x 100dvh below 768px and the overlay has no mobile inset |
| Maximize state machine | PASS | CSS-only 96vw x 94vh maximize; first Escape exits maximize and second Escape closes |
| Single-page PDF | PASS | defaults to Fit Page, page is centered in one non-scrolling PDF viewport, page/fit/zoom tools occupy the shared toolbar |
| Multi-page PDF | PASS | large document presentation, Fit Width/custom scrolling, page navigation and collapsible thumbnail rail implemented |
| Renderer scroll ownership | PASS | Shell viewport is overflow-hidden; Markdown, code, table, PDF and media keep renderer-owned content behavior |
| Focused Viewer tests | PASS | 12/12 presentation/policy/SVG/single-shell tests |
| Web lint/typecheck/build | PASS | all required Web commands passed; production build generated 9 routes |
| API regression | PASS | 211 passed; 1 fixture-gated test skipped and not counted as PASS |
| Alembic | PASS | single head `20260806_0021`; no migration added |
| PWA default matrix | PARTIAL_PASS | 19 passed; 21 online/fixture-gated scenarios skipped and not counted as PASS |
| Production old-layout baseline | PASS | Chrome measured the old single-page PDF shell at about 1844 x 1016 CSS px in a 1920 x 1080 viewport, confirming universal 96vw x 94vh behavior |
| Adaptive production deployment / Chrome | PASS | commit `a89bc28` deployed from Actions run `31294947752` (archive SHA-256 `4d48d4d55c461be318c5ccab2b06eaabeefb11e1c32dcb73b2201aa3d833e5be`); Chrome verified document/reading/media/compact/workspace, maximize/Esc, Fit Page/Fit Width, five viewport classes and mobile 100vw x 100dvh |

The adaptive change does not alter inline attachment layout, Reader width, data models, upload, Files Panel, Share, export, `.cr v4`, Scanner, Range or permissions.

Production backup `/opt/chat-reader/backups/adaptive-viewer-20260809T050228Z-a89bc28` is 378 MiB. Its PostgreSQL custom dump passed `pg_restore --list`; import/export/offline/asset archives passed tar reads and every SHA-256 entry passed. King pulled source before loading prebuilt images, ran migration, and recreated API/worker/Web with `--no-build`; API/Web/PostgreSQL are healthy, worker is running, Alembic is `20260806_0021`, ClamAV is stopped, and Scanner remains disabled.

## 2026-08-09 Attachment Renderer Contract Candidate

| Area | Status | Evidence |
| --- | --- | --- |
| Four-layer state and Registry | PASS | data/capability/runtime/plan are separate; runtime unsupported and failure do not mutate static capability |
| Inline skins and display mode | PASS | only media/preview-panel/file-row are emitted; auto/small/medium/large normalization and width caps are covered |
| Unified Viewer portal | PASS | root Provider owns the single body portal; source assertions cover the portal count and compatibility adapter |
| Occurrence identity propagation | PASS | Reader turn, direct message/block and Offline payloads include messageVersionId + occurrenceKey metadata |
| Image/Markdown/media runtime fallback | PASS | image/text/PDF/media retry issues were corrected; load failure no longer leaves a blank Viewer stage |
| Inert SVG/Markdown path | PASS | SVG uses IMG and attachment paths reject inline SVG/object/embed/window.open; Markdown skips/sanitizes raw HTML and does not auto-load external images |
| Text search / derivative / batch ZIP API | PASS | focused API tests cover capability privacy, stale cursors and distinct business filenames sharing one AssetObject |
| Office/Spreadsheet/Presentation/EPUB/Archive/CAD/3D Viewer | NOT_IMPLEMENTED | reliable authenticated download-only fallback remains the approved behavior |
| Web lint/typecheck/build | PASS | all required commands passed on 2026-08-09; build uses browser PDF.js with optional Node canvas excluded |
| API suite | PASS | 211 passed; 1 fixture-gated test skipped and not counted as passed |
| Alembic | PASS | one head `20260806_0021`; no migration added |
| Attachment policy/SVG/portal tests | PASS | final focused run 7/7 passed, including generic `text/plain` refinement and trusted binary MIME precedence |
| PWA default matrix | PARTIAL_PASS | 13 passed; 21 online/fixture-gated scenarios skipped and not counted as passed |
| Production deployment | PASS | final commit `5baea32` was built by run `31269172465`, archive SHA-256 `55a53e8606ae1e404255729dbb566172913997b3678648e3630b95be73400f6e`, and deployed with migration plus `--no-build` service recreation |
| Production Chrome core Viewer acceptance | PASS | real multi-format conversation verified one body dialog, image Gallery/filmstrip, Markdown Rendered/Source, OBJ/STL/DXF download-only behavior, TIFF non-broken fallback, Esc and scroll restoration |
| Optional/conditional Viewer matrix | PARTIAL_PASS | Offline/PWA conditional scenarios, animation frame enforcement and TIFF converted first-page preview were not fully exercised in production |

Contract approval markers and the implementation/verification boundary are recorded in `docs/system/ATTACHMENT_RENDERER_CONTRACT.md`.

Release backup `/opt/chat-reader/backups/release-20260808T170034Z-254b5bb` is 378 MiB. Its PostgreSQL custom dump passed `pg_restore --list`; SHA-256 manifests cover the dump and all four business-volume archives. Production capabilities report Viewer, Range, derivatives, text search and batch download enabled; scanner provider remains disabled, unscanned use is allowed, and complex preview remains disabled.

## 2026-08-08 Attachment Rendering And Task Checklist Release Candidate

| Area | Status | Evidence |
| --- | --- | --- |
| Attachment presentation policy | PASS | Markdown renders as Markdown; image metadata/download controls, bounded text/code/table previews, TIFF/media failure fallbacks, and download-only complex formats are covered by code policy and focused browser tests |
| Preview workspace UX | PASS | portal/backdrop remains viewport-level while visible panels are type-specific: bounded dark image/video stage, compact audio panel, and bounded document/PDF workspace; focus trap, Esc, backdrop close, scroll lock and restoration remain covered |
| SVG contract | PASS | Reader and preview content use `IMG`; focused tests reject inline SVG/script/object/embed and independent document opening |
| Attachment grouping | PASS | consecutive images/files are grouped with bounded initial item counts and explicit expansion |
| Conversation export projection | PASS | detached Attachments are excluded from conversation CanJSON/Markdown packages; manifest counts are recalculated; system `.cr v4` history remains unchanged |
| Portable hidden filenames | PASS | leading dots are preserved while path confinement and collision handling remain active |
| Interactive task lists | PASS | owner user/assistant tasks toggle immediately; v1 creates v2, v2+ replaces current, refresh persists, conflict rollback is API-covered, and Share remains read-only |
| Web lint/typecheck/build | PASS | required commands passed on 2026-08-08 |
| API suite | PASS | 208 passed; 1 real-fixture test was conditionally skipped and is not counted as passed |
| Alembic | PASS | single head `20260806_0021` |
| PWA baseline | PARTIAL_PASS | 10 passed; 20 online/fixture-gated scenarios skipped by the default matrix and are not PASS |
| Real attachment browser fixture | PASS | 1/1 passed; product import, Markdown attachment rendering, bounded image dialog, SVG DOM, file groups, Share authorization/revocation and hard-delete cleanup completed |
| King incremental deployment | PASS | GitHub Actions run `31242030506` built commit `65585eb`; King verified archive SHA-256 `ef3480b2c0afa3b69ed342e53c602ca5028d523561f7859a196683c0af8ea18d`, used backup `release-20260808T053116Z-4983a8d`, ran migration, and recreated API/worker/Web with prebuilt images only |
| King service and capability checks | PASS | public health and Reader routes return HTTP 200; API/Web/PostgreSQL are healthy, worker is running, Alembic is `20260806_0021`, scanner provider is disabled, unscanned use is allowed, basic preview is enabled, and complex preview remains disabled |
| King Chrome attachment visual acceptance | NOT_PRODUCTION_VERIFIED | the requested Chrome extension was not connected after deployment; no substitute browser was used, so bounded viewer panels, inline attachment presentation, and interactive task toggles still require the requested Chrome click pass |

The large fixture previously duplicated full Share-page hydration and consumed the test timeout after owner assertions. The fixture now verifies Share authorization directly; the dedicated Share UI path remains separately covered. This was a test-scope performance issue, not an attachment content API failure.

## 2026-08-07 Attachment Workflow Release Candidate

| Area | Status | Evidence |
| --- | --- | --- |
| Message save transaction | PASS | uploaded files are finalized before save; message PATCH performs batch ownership validation, current Markdown/version/block/occurrence persistence and pointer update only |
| Derived rebuild | PASS | search, TOC, statistics and summary rebuild is queued only after commit and coalesced per conversation |
| Save response and Reader cache | PASS | response includes message/version/blocks/occurrences/attachment summary; Web replaces the current message and remeasures only its layout |
| Existing Attachment drag | PASS | `application/x-chat-reader-attachment` inserts the existing conversation Attachment at the CodeMirror location without uploading bytes or creating another Attachment/AssetObject |
| Removed reference confirmation | PASS | save-time comparison defaults to keep; detach is refused while another current occurrence exists; historical versions remain readable |
| Conversation file workspace | PASS | desktop floating workspace is unmasked, resizable and geometry-persistent; it coexists with the source editor; mobile retains its overlay panel |
| Structured sidebar DnD | PASS | project order, project receiver, conversation rows/slots and the unclassified header are separate targets; the dedicated E2E moved conversations across projects, reordered, and returned one to unclassified |
| Web lint/typecheck/build | PASS | all three required commands passed on 2026-08-07 |
| API suite | PASS | 205 passed; 1 real-fixture test was conditionally skipped and is not counted as passed |
| Alembic | PASS | single head `20260806_0021` |
| PWA baseline | PARTIAL_PASS | 8 passed; 20 online/fixture-gated tests skipped by the default command |
| Online attachment/Reader/DnD suite | PASS | 11/11 passed with explicit online flags: 5 attachment workflows, paired import, structured DnD, and 4 long Reader restoration scenarios |
| Save p50/p95 on King | NOT_PRODUCTION_VERIFIED | instrumentation is implemented; production measurements require this release candidate to be deployed and exercised on a dedicated test conversation |
| 2026-08-07 King deployment | NOT_PRODUCTION_VERIFIED | current production evidence below describes the previous `af17c93` release until the new commit/image is deployed |

The default PWA command's 20 skipped scenarios and the fixture-gated API test are disclosed separately; they are not PASS. Office/OCR/CAD/complex archive preview remains `NOT_IMPLEMENTED` with authenticated download fallback.

## 2026-08-06 Release

## Status Vocabulary

- `PASS`: executed and passed in the stated environment.
- `PARTIAL_PASS`: the executed subset passed, but a related scenario remains unverified.
- `NOT_PRODUCTION_VERIFIED`: implemented or locally verified, but not verified on King in this release.
- `NOT_IMPLEMENTED`: intentionally outside the completed baseline.
- `FAILED`: executed and failed; the exact failing path is not approved for reuse.
- `BLOCKED`: cannot proceed without an external dependency or decision.

## Local Verification

| Area | Status | Evidence |
| --- | --- | --- |
| Web lint | PASS | `corepack pnpm run lint`; zero warnings |
| Web typecheck | PASS | `corepack pnpm run typecheck` |
| Web production build | PASS | Next.js build; 9 application routes |
| API suite | PASS | 203 passed, 1 fixture-gated skip in the default command; the real attachment fixture module was rerun with `CHAT_READER_E2E_FIXTURE_DIR` and passed 9/9 |
| Alembic | PASS | single head `20260805_0020` |
| PWA baseline | PARTIAL_PASS | 8 passed; 19 online/fixture scenarios conditionally skipped by the default command |
| Attachment/SVG/Share Playwright | PASS | real Bundle fixture: SVG is an `IMG` in Reader and the body-level dialog; focus, scroll lock, Share access and revoke behavior passed |
| Attachment upload Playwright | PASS | 4/4: file selection, exact-position drop, clipboard paste, fenced-code choice, independent drafts, message save, Reader rendering and preserve-as-unplaced close behavior |
| Long Reader Playwright | PASS | 4/4 target mounting, TOC, layout-anchor and annotation restoration scenarios passed |
| Attachment export options | PASS | streaming and background ZIP tests cover description, annotations, notebook and source refs |
| Message version rendering | PASS | API regression proves selecting a version returns its persisted render blocks immediately |

## Real Fixture Baseline

The fixture is read through `CHAT_READER_E2E_FIXTURE_DIR` and packed only in a temporary test directory. Tests do not modify the source fixture or persist its conversation body.

| Metric | Verified |
| --- | ---: |
| Conversations / messages | 1 / 8 |
| Attachment records | 20 |
| Resolved / missing | 19 / 1 |
| Physical objects | 18 |
| Occurrences | 21 |
| Unplaced attachments | 1 |
| Resolved scan state | 19 `scanner_disabled` |

The AI context package contains 18 content-addressed objects and reports partial asset completeness. The portable Markdown ZIP contains 19 business attachment paths, rewrites links to relative paths, and contains no `cr-asset://` URI.

## King Production Acceptance

| Area | Status | Evidence |
| --- | --- | --- |
| Incremental deployment | PASS | GitHub Actions run `31083578130` built the Linux images for commit `af17c93`; King pulled the same commit, verified artifact SHA-256 `918dc9a3121e8d83dd917839b55b778e53a9c3b8d303937624124dab9650cd17`, loaded the images, ran migration, and recreated API/worker/Web without an on-host build |
| Migration and capabilities | PASS | production head `20260805_0020`; scanner disabled, unscanned allowed, basic preview enabled, complex preview disabled |
| Attachment Bundle import | PASS | checksum-scoped fixture imported once; expected 1/8/20/19/1/18/21/1 statistics verified |
| Reader attachment rendering | PASS | Chrome observed 20 attachment blocks, 3 inline images in the loaded view and 6 inline text previews after hydration |
| Full-page attachment preview | PASS | Chrome verified the dialog is a direct `body` child, equals the viewport, locks body scrolling and displays the original image endpoint |
| SVG attachment preview | PASS | Production Chrome verified inline SVG uses one `IMG`; the body-level dialog content also uses one `IMG`, with no inline SVG/script/object/embed/iframe; focus trap, Esc, backdrop close, scroll restoration and trigger focus restoration passed |
| Export secondary options | PASS | Chrome exposed description/annotations/notebook/source-ref controls; generated manifest recorded `true/true/false/true` for the selected options |
| Failed task dismissal | PASS | two stale failed cards were closed; reload kept them hidden in the same browser profile |
| CanJSON/Markdown packages | PASS | context and portable Markdown ZIP counts, hashes, relative links and completeness were inspected on King |
| Structured sidebar DnD | PASS | dedicated synthetic conversation moved into a project and back to unclassified; reload preserved placement |
| Share attachment scope | PASS | user-confirmed production E2E: allowed image/text/media preview and download worked; out-of-scope ID access was rejected; revocation invalidated attachment access |
| Ordinary attachment upload from API | PASS | production upload session/finalization created a `scanner_disabled` conversation attachment |
| Ordinary attachment upload through Chrome | PASS | user-confirmed production E2E: file selection -> upload session -> conversation attachment -> message version/Reader -> refresh -> download/export |
| Message version immediate attachment rendering in Chrome | NOT_PRODUCTION_VERIFIED | deployed and API-covered; hidden hover-only version control could not be activated reliably through the browser bridge |
| System `.cr v4` export | PASS | production archive generated and contents inspected; no secret/config/cache paths present |
| System `.cr v4` restore | PASS | user-confirmed empty-instance production-equivalent restore: projects, conversations, versions, attachments/objects, annotations, notebook, source refs, placement/order, hashes, derived rebuild and Reader opening passed |
| Acceptance data cleanup | PASS | fixture and synthetic conversations hard-deleted; synthetic project archived because the product has no project-delete endpoint |
| GitHub/server synchronization | PASS | Application source and deployed image source resolve to `af17c93b344947f3d58bb7af0a77bb40a35a27fe`; King backup `release-20260806T081207Z-af17c93` contains PostgreSQL and four business-volume archives, and the pre-sync server worktree remains recoverable in `stash@{0}` |

## Production Incident

| Event | Status | Result |
| --- | --- | --- |
| Build Web image on the 2 GiB King host | FAILED | Even with the 418 MiB worker stopped, `next build` caused the kernel to kill the PostgreSQL checkpointer |
| PostgreSQL recovery | PASS | Container stayed running, WAL recovery completed, health returned, and a post-recovery custom dump passed `pg_restore -l` |
| Future deployment method | REQUIRED | Build Linux images in CI/an independent host and deliver through a registry or `docker save/load`; do not compile Web on King |

## Scanner and Content Policy

- The current deployment actively disables attachment malware scanning and content security review.
- Attachments remain usable in the explicit `scanner_disabled`/`unscanned` state; the Chinese UI displays “未扫描”, never clean/safe or “已通过扫描”.
- This is an accepted policy for the current single-user deployment and does not mean that any file passed a security check.
- Object status, byte size, SHA-256, storage-key confinement and authenticated content routes remain enforced.

## Deliberate Limits

| Capability | Status | Fallback |
| --- | --- | --- |
| Office conversion/inline preview | NOT_IMPLEMENTED | Authenticated download |
| OCR | NOT_IMPLEMENTED | Original file download |
| CAD preview | NOT_IMPLEMENTED | Original file download |
| Complex archive browsing/conversion | NOT_IMPLEMENTED | Authenticated download |
| Local ClamAV on the 2 GiB King host | NOT_IMPLEMENTED | `DisabledScanner`; optional remote scanner later |
| Full online Playwright matrix in default PWA command | PARTIAL_PASS | Conditional tests require running API and explicit fixture flags |
## 2026-08-10 Comprehensive Release-Readiness Audit

| Area | Status | Evidence |
| --- | --- | --- |
| Production Chrome core Reader/attachment/Share acceptance | `PARTIAL_PASS` | Real Chrome verified rendered Reader, Markdown/CSV/SVG/PDF/ZIP, Range, Scanner-disabled `未扫描`, adaptive visible Viewer panels and Share revocation. |
| Large JSON + Markdown import | `PASS` | Production multipart preview HTTP 200 in 8.7s, exact 398 nonempty messages, commit completed in 28.7s; browser file chooser remains `NOT_PRODUCTION_VERIFIED`. |
| New conversation / insertion | `PARTIAL_PASS` | QA atomic pair and pair insertion pass; immediate first insert exposes stale revision until refresh. |
| Message delete / undo | `FAILED` | QA delete works, visible undo did not restore and gave no error. Release blocker FUNC-003. |
| Unreferenced attachment Files Panel | `FAILED` | Active zero-reference records disappear from All/Unreferenced despite export facts. Release blocker FUNC-001. |
| Share permission boundary | `PASS` | QA Share exposed read-only scope and revocation invalidated the URL. |
| Local required checks | `PASS` | lint, typecheck, build, API `216 passed / 3 skipped`, Alembic single head. |
| PWA/Offline full matrix | `PARTIAL_PASS` | 30 passed, 21 conditional skips; production negative offline and 360/zoom cases remain `NOT_PRODUCTION_VERIFIED`. |

Detailed findings, screenshots and QA cleanup: `docs/evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md`.

## Reader Scroll Stabilization - 2026-08-10

### Root cause and remediation

- Coarse virtual-block estimates caused repeated 550-640px total-height corrections during normal wheel input. Estimates are now metric-aware for paragraphs, CJK/emoji, code, headings, tables and media.
- The changing virtual total-height container is no longer a layout-observation source. Width/font/density/layout events invalidate metrics; TanStack row measurements remain canonical.
- Active position, direction and idle persistence share one passive scroll coordinator; sentinel IntersectionObserver alone owns edge loading.

### Automated verification

- Web lint/typecheck/production build: PASS.
- API: `216 passed, 3 skipped`; Alembic: one head `20260806_0021`.
- PWA default matrix: `37 passed, 22 skipped` (`PARTIAL_PASS`; skips are not PASS).
- Focused Reader suite: `9 passed` (estimators, TOC, preference anchoring, restoration, annotation/refresh, continuous wheel and Share Reader).
- Three production-build Chromium performance runs: p95 frame interval `16.7ms`; longest task `72/68/70ms`; total long-task time `72/68/70ms`. Budgets 34/150/250ms passed.

### Production verification and deployment

- Real production Chrome, read-only: 30 wheel steps had `minDelta=119.576px`, `reverseSteps=0`, six mounted messages. The warmed 1,080px segment had 85px height correction. TOC followed block 54 -> 62; server position persisted and restoration settled back to block 68.
- GitHub Actions run `31385483844`; release commit `e4bc9c3ce00ed7071d896546df330cdd1a0f1b53`; artifact SHA-256 `1deddb658a8c663111e530ffd793cb3f437cc9498ca68fded7dd498934f8c777`.
- King used verified backup, migration preflight and `--no-build`; API/Web/Postgres are healthy. Backup: `/opt/chat-reader/backups/reader-scroll-20260810T120035Z-e4bc9c3`.
- Production bridge has no page console/network stream and timed out on viewport screenshot capture. Exact 360px/zoom/offline-negative and a full production edge-sentinel trace remain `NOT_PRODUCTION_VERIFIED`; local functional invariants are not relabeled as production PASS.

## Reader Scrollbar-Thumb Blank-Window Closure - 2026-08-10

- Root cause: a mounted message could intersect the Reader while its per-message TanStack virtualizer still used a stale absolute `scrollMargin`. A large native scrollbar-thumb jump then selected rows far outside the visible message, producing an apparently empty page although API data and the message shell were present. Native thumb movement could also trigger an edge-window merge while Chromium still held the thumb, changing `scrollHeight` during the gesture.
- Fix: visible-message gap recovery rebases the virtual coordinate system without discarding measured row heights; pointer-held thumb gestures defer edge-window transitions until release; viewport-scale non-wheel jumps publish a layout rebase event. Ordinary wheel scrolling retains the measurement-free hot path.
- Automated: lint, typecheck and Web production build PASS; API `216 passed, 3 skipped`; Alembic `20260806_0021 (head)`; default PWA `37 passed, 25 conditional skipped`; focused final Reader regressions `3/3` PASS, with the earlier full Reader restoration suite `8/8` PASS.
- Production: commit `771f4c8`, Actions run `31398377216`, archive SHA-256 `b8c6dc8e7769cfe4e03e9523595b179f50308a045f78ebe8beb71a44291e1000`. Native Chrome thumb drags in both directions immediately retained 15/14 visible blocks; a further five-position distant-drag sweep had `blankCount=0` and 11-15 visible blocks at every destination. API/Web/PostgreSQL are healthy; worker running; Scanner disabled.
- Current status: `READER_SCROLLBAR_BLANK_GAP = PASS`, `NATIVE_THUMB_DRAG = PASS`, `ORDINARY_WHEEL_REGRESSION = PASS`. Conditional PWA cases remain `PARTIAL_PASS`, not PASS.

## Final Release Closure - 2026-08-11

| Area | Status | Evidence |
| --- | --- | --- |
| Create -> immediate insert | PASS | Real production creation followed by single and pair insert without refresh; refresh preserved lexical order. |
| Delete -> Undo -> refresh | PASS | Real production delete, forced restore 500, localized retry, successful restore and refresh persistence. |
| Active unreferenced Attachment | PASS | Production QA reconciled 2 active/unreferenced business rows with current count 0; both were visible. |
| Shared AssetObject identity | PASS | Two distinct Attachment IDs for identical bytes shared one AssetObject without UI/API merging. |
| Two-tab concurrency | PASS | Production stale write returned 409, preserved draft, loaded the latest base explicitly and saved the retained draft without overwriting silently. |
| Exact 360/390/768 reflow | PASS | Headless Chrome against production real long Reader: document widths exactly matched viewports with no page overflow. |
| Browser 125/150/200% zoom | NOT_PRODUCTION_VERIFIED | Device-scale checks are not accepted as browser zoom. |
| File chooser | PASS | Production-build Playwright real chooser/upload/insert/refresh 5/5; production bridge itself cannot control the native chooser. |
| Long Reader | PASS | Owner/Share restoration, search/jump, native thumb/wheel and blank-window recovery suites pass; production narrow regression remained populated. |
| Share scope/revoke/expiry | PASS | Production QA expiry was allowed before expiry and rejected after expiry; revoke returned success. |
| `.cr v4` round trip | PASS | Empty production-equivalent restore preserved referenced/unreferenced Attachments and distinct business identities sharing an AssetObject. |
| Offline/PWA | PARTIAL_PASS | Baseline 6/6; runtime-chunk/cache-miss/quota/interruption/reconnect negative matrix remains unverified. |

Required commands: lint/typecheck/Web production build PASS; API `218 passed / 3 skipped`; Alembic one head `20260806_0021`; default PWA `37 passed / 27 conditional skipped`; mutation closure `6/6`; long Reader `8/8`; upload chooser `5/5`; Offline baseline `6/6`. Skipped scenarios are not counted as PASS.

Deployment: commit `38c57c12191bb85ebca0a7caf9aea80f11070993`, Actions run `31453697905`, artifact SHA-256 `430dd0d88c927a6329da132aced75c742124ac4035b4c05c348bdbeda549e11c`, validated backup `/opt/chat-reader/backups/final-closure-20260811T030600Z-38c57c1`, King migration preflight and `--no-build` recreation. API/Web/PostgreSQL are healthy, worker running, Scanner disabled.

```text
CORE_WEB_RELEASE = PARTIAL_PASS
PWA_OFFLINE_RELEASE = PARTIAL_PASS
OVERALL = PARTIAL_PASS
ONLINE_WEB_GA_READY = NO
```

Historical failure rows above remain evidence of the state observed on 2026-08-10; this section is the current release status.

## Attachment workspace and Markdown cursor closure - 2026-08-11

- Settings retains system `.cr` export but no longer exposes a second restore file picker; `.cr` selection stays in Import data.
- Desktop `当前对话文件` now uses the annotation-style `reader-floating` workspace at the Reader's upper-right safe region. Production Chrome verified approximately 400x620 at `y=72`, a whole-header `grab` handle and an accent attachment icon. Mobile remains a full-width sheet.
- Markdown source editing no longer reconfigures CodeMirror per draft render, no longer classifies CodeMirror keys as Reader keyboard scrolling, and no longer echoes every keystroke through the external controlled value. Production Chrome verified offset `21860 -> 21861 -> 21860` with invariant `scrollTop=41091` after type/delete on the same message.
- Web lint/typecheck/build PASS; API `218 passed / 3 skipped`; Alembic one head; default PWA/Playwright `39 passed / 27 conditional skipped`; focused source/placement contract `6/6`; production-equivalent source cursor/mutation flow `2/2`; production public health PASS. The Chrome bridge verified production geometry/cursor/icon and source stability. Physical pointer drag is covered by the production-equivalent `reader-layout` mouse regression; the Chrome bridge itself does not expose a physical mouse API.
- Release commit `1cdadc4f90115d7b46ce55d07a2b4f23c90471d4`; Actions run `31470442426`; artifact SHA-256 `429fb5384dc1dbf57eec68aecad4632c01bd71a58fca6ea9f276468c6d8630fb`; validated backup `/opt/chat-reader/backups/file-workspace-cursor-20260811T075200Z-1cdadc4`. King used migration preflight and `--no-build`; API/Web/PostgreSQL are healthy, worker running, Scanner disabled and Alembic remains `20260806_0021`.
- After health and browser acceptance, 48 exact tags from 12 old releases were removed. Current `1cdadc4`, rollback `b6ce0e6` and `latest` remain; Docker images dropped from 4.919 GB to 2.510 GB and root free space rose from 1.4 GB to 3.9 GB. No volume or non-Chat-Reader image was removed.
# Release A local gate - 2026-08-13

Release A local verification is complete. Next is patched to `14.2.35`, Mermaid to `11.16.1`, and PostCSS resolves to `8.5.26`; compatible transitive overrides reduce the official audit from 2 critical/29 high to 1 critical/16 high. The remaining 17 critical/high records are exact, expiring exceptions: unsupported Next 14 runtime debt, PDF.js 3 mitigated by `isEvalSupported=false`, and its optional canvas/node-pre-gyp/tar build chain mitigated by disabled lifecycle scripts. Next supported-LTS and PDF.js supported-line migrations remain required.

Local gates: lint PASS; typecheck PASS; production build PASS; API `251 passed / 4 skipped`; Alembic `head=current=20260806_0021`; Release A browser `6/6`; default PWA `67 passed / 36 skipped`; audit policy `17 approved / 0 unapproved / 0 policy errors`. Production secret, encoded Alembic URL, actual response headers, CSP Report-Only, PDF/Mermaid settings, long import proxy, and workflow dependency have focused regression coverage. GitHub image inspection/SHA-256 and production health/header/browser evidence remain pending until the committed release workflow and King deployment complete.

Controlled failure evidence: Actions run `31705576354` stopped at package-manager bootstrap because the runner's bundled Corepack trust store did not contain the current pnpm signing key. The `quality` job failed, `build-images` was skipped, and no deployable artifact was produced. The remediation pins pnpm through `pnpm/action-setup` and updates the Web image's Corepack without disabling integrity checks.

Actions run `31706041697` then passed bootstrap, locked install, lint, typecheck and production build. API ended at `249 passed / 4 skipped / 2 failed` because two default-value tests inherited the workflow's synthetic cursor secret. The tests now clear that variable only for the default-value assertion. `build-images` was again skipped, proving that a late quality failure also cannot produce the deployable artifact.
