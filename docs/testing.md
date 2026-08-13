# Testing Addendum 2026-08-09

## Release A safety baseline (2026-08-13)

The release workflow runs the default commands plus a real PostgreSQL service, `alembic upgrade/current`, the official npm-registry audit policy, a live API/worker, focused production-build browser tests, and the default PWA baseline before any image build. `build-images` requires successful `quality`; diagnostic quality evidence is explicitly non-deployable.

Focused regressions cover production secret rejection/acceptance, Alembic `%` and encoded credentials, actual HTTP security headers, absence of `X-Powered-By`, CSP Report-Only, the single PDF.js `isEvalSupported=false` path, Mermaid strict mode, the long import commit proxy, and workflow ordering. Local results are lint PASS, typecheck PASS, build PASS, API `251 passed / 4 skipped`, Alembic `20260806_0021 (head/current)`, focused browser `6/6`, and default PWA `67 passed / 36 skipped`. The 36 Playwright skips are conditional online-write/fixture/production-copy flows and are not counted as PASS; the release workflow explicitly enables its focused online subset.

Release workflow evidence is three-layered rather than inferred from YAML. Runs `31705576354` and `31706041697` failed at early and late quality stages respectively; both skipped `build-images` and produced no deployable archive. Run `31706522862` passed every quality step and only then built, inspected, checksummed and uploaded the release archive. Production headers are not marked PASS because deployment was stopped by the production-secret gate.

## Manual TOC refresh (2026-08-13)

`test_toc_api.py` 覆盖只更新对话目录、只更新当前对话章节目录、同时更新且章节范围为全部对话、幂等 key、未选择任何目标的 `422`，并断言派生重建不会提升 Conversation revision。`toc-refresh-contract.spec.ts` 固定 Reader 右上角 More 入口、两个默认选中目标、当前对话默认范围、全部对话选项、统一 Dialog focus、worker polling 和精确 query invalidation。

本轮结果：TOC route `3 passed` + builder `1 passed`，Web contract `1 passed`，全 API `236 passed / 4 fixture-gated skipped`，PWA/Playwright `59 passed / 36 environment-gated skipped`，lint/typecheck/build PASS，Alembic single head `20260806_0021`。PWA 的 API-dependent 场景因默认矩阵未启动 API 而 skip，不计为 PASS。

生产 Chrome 使用隔离 QA Conversation 验证 combined/current、dialogue-only、section-only 三种提交、默认值、all-scope 选择器、initial focus、single accessible Close、Esc focus restore、完成 live status 与刷新稳定性。生产没有执行 all-conversations section rebuild，因为它会重建真实业务对话的派生 Heading；该分支由实际 API/worker 集成测试执行，不将其冒充为生产 PASS。

## Import compatibility v5 (2026-08-12)

The import regression matrix now covers Prompt-only/Response-only paired Markdown, arbitrary single-role Markdown rejection, blank JSON messages at head/middle/tail, empty Markdown sections, missing non-empty messages at head/middle/tail, normalized matches without timestamps, duplicate ambiguity, timestamp mismatch, lossy JSON plus rich Markdown, old Markdown repair and the existing full-flow contract.

The user-supplied pair is read directly from `CHAT_READER_IMPORT_PAIR_JSON` and `CHAT_READER_IMPORT_PAIR_MARKDOWN`; the tests perform Preview only and never change the source directory or commit the conversation. Current results: exact supplied-pair compatibility `61 passed / 2 fixture-gated skipped`; isolated production-build file-chooser Preview `1/1 PASS`; real 398-message preview/commit/idempotent-retry matrix `12 passed / 1 fixture-gated skipped`; full API `235 passed / 4 fixture-gated skipped`; Web contract `2/2`; default PWA `57 passed / 36 environment-gated skipped`; Web lint/typecheck/build PASS. Skips are reported separately and are not PASS.

The final production multipart Preview of the supplied pair returned HTTP `200` in about 1.5 seconds with one non-empty exact-match message, `can_commit=true` and no warning. It was not committed. The resulting preview-only ImportRecord is left to the existing TTL because the product does not expose a safe immediate-delete endpoint; tests and cleanup must not substitute direct SQL deletion.

Unique role/timestamp identities use the linear alignment regression in `test_exporter_aligner.py`. The 398-message preview assertion must remain under 20 seconds. Structured logs split JSON parsing, Markdown parsing and alignment so a future proxy timeout can be assigned to the actual stage.

## Archived project deletion (2026-08-12)

`test_projects_api.py` verifies that active/default projects cannot be deleted, an archived project can be deleted, its conversations remain under Unclassified with a new offline revision, and a repeated delete returns `404`. `archived-project-delete.spec.ts` freezes the single/batch UI, irreversible confirmation copy, retained-conversation wording, API call and cache refresh contract. Current results: focused API `9/9`, Web contract `1/1`, lint/typecheck/build PASS, full API `220 passed / 3 fixture-gated skipped`, Alembic head `20260806_0021`.

## AI Rich Markdown release (2026-08-12)

The current parser/browser matrix is split by evidence level:

| Suite | Current result |
| --- | --- |
| `ai-rich-markdown-parser.spec.ts` + static contract | `4/4 PASS` |
| Reader/Editor/security/109-formula stress + attachment flow | `8/8 PASS` |
| Real `.md` chooser/upload/save/inline/Viewer | `1/1 PASS` |
| Heavy Owner/Share Reader restoration and wheel regression | `8/8 PASS` |
| Offline KaTeX font inventory + cold start | `1/1 PASS` |
| Default PWA matrix | `45 passed / 31 conditional skipped`; skips are not PASS |

Release browser command (API and production Web server must already be running):

```powershell
$env:PLAYWRIGHT_REUSE_EXISTING_SERVER='1'
$env:E2E_RICH_MARKDOWN='1'
$env:E2E_RICH_MARKDOWN_ATTACHMENT='1'
corepack pnpm --filter web exec playwright test `
  e2e/ai-rich-markdown.spec.ts `
  e2e/ai-rich-markdown-attachment.spec.ts `
  e2e/ai-rich-markdown-parser.spec.ts `
  e2e/ai-rich-markdown-contract.spec.ts `
  --config=playwright.config.ts
```

The browser fixture creates a QA-only two-message Conversation through the canonical create API, validates Reader and Source Editor semantics, and deletes the Conversation through the product API. The attachment fixture waits for upload resolution, then requires the first message PATCH to return 2xx before asserting inline and Viewer semantics. This specifically guards the resolved-draft race where CodeMirror had replaced `cr-upload://` but React still held the stale marker.

The compatibility matrix covers all four math delimiters, golden boxed limit, aligned/matrix/cases/Chinese text, invalid LaTeX, 109 formulas in one message, currency, inline/fenced code exclusion, GFM table/task/strike/autolink, cross-block footnotes, unsafe HTML/URL, untrusted KaTeX command, remote image non-fetch, MathML and 360px local overflow. Screenshot evidence is synthetic QA data only.

KaTeX offline readiness requires the active shell record to contain current `KaTeX_Main` and `KaTeX_Math` font URLs. CSS import alone is insufficient evidence. `library-offline.spec.ts` performs a real service-worker cold start after asserting those required assets.

Production commit `4d07ce4` was exercised with a disposable synthetic Conversation in real Chrome. DOM evidence recorded five KaTeX/MathML expressions, two display expressions, one semantic table, namespaced footnote reference/backlink, code isolation, inert unsafe HTML/link handling, literal currency, and zero page-level horizontal overflow. Source Editor preserved the raw bracket delimiter and selection offset across type/backspace. The QA Conversation was removed through the product API.

The exact 360/390/768 suite remains production-build browser evidence. The external Chrome extension advertised viewport control but did not return a callable override in this session, so it is not relabeled as exact production viewport evidence. A production screenshot timed out; this does not replace the passing DOM/source assertions, and local synthetic screenshots remain the visual evidence. The `/library` DOM reported an active 78-resource offline shell; exact `KaTeX_*` cache membership is asserted by the production-build service-worker cold-start test because Cache Storage is not exposed by the Chrome read-only page evaluator.

The reported production ChatGPT fixture adds distinct compatibility regressions: outer backslashes may already be gone, delimiters may be `/[`/`]/`, the surviving formula may span paragraph and heading API RenderBlocks, and inline `\(n^6\)` may arrive as bare `(n^6)`. `ai-rich-markdown-parser.spec.ts` asserts strict source-range recognition, compact inline/bracket expressions, slash delimiters, bounded Setext normalization and prose/date/version/code/currency exclusion. `ai-rich-markdown.spec.ts` asserts Reader/Editor semantics, MathML, canonical-source preservation and Preview-default-collapsed behavior. `production-rich-markdown-copy.spec.ts` accepts an ephemeral UTF-8 Base64 source, creates a QA-only copy, expands Source Preview for full semantic coverage and deletes the copy through the product API.

Current v4 focused results: parser/shared contract `14/14`, Reader/Editor/security/stress `5/5`, two exact reported-source copies `1/1` each, and Markdown attachment shared renderer `1/1`. The default PWA matrix is `58 passed / 36 conditional skipped`; skipped online/fixture-gated cases are not PASS. The first full-source preview rendered 108 display formulas and at least 108 MathML trees. The second renders 41 display formulas/MathML, includes common scientific commands and the eight bounded conceptual labels, and leaves zero formula errors or bracket paragraphs. Earlier v1/v2/v3 evidence remains historical rather than final v4 production proof.

## Formula scroll stabilization (2026-08-13)

Focused Reader block estimator and Rich Markdown parser regressions pass `17/17`. Coverage includes display formula bounded-height estimation, aligned multi-row estimation, code/currency exclusion, ChatGPT delimiter compatibility and canonical parser behavior. Web typecheck, production build and focused ESLint pass. The full browser Rich Markdown suite was skipped because the local run lacked its API/fixture server; those cases are not counted as PASS. Production frame interval, long-task, cache-hit and long-reader wheel metrics remain `NOT_PRODUCTION_VERIFIED` until a production-equivalent fixture run is executed.

Production Chrome v3 evidence is an intermediate release check: the first reported page rendered one visual heading formula without exposing the hidden MathML/annotation layers, and the second rendered 33 scientific display formulas with zero errors. That check discovered eight standalone conceptual labels still displayed as brackets, so v3 is not the final PASS.

Final v4 production evidence is PASS. Read-only Source Preview audits began collapsed and were expanded explicitly. The first reported page retained 108 display formulas, zero errors and one semantic/visual heading formula. The second produced `41/41` display formulas and MathML trees, all eight bounded conceptual labels exactly once, zero errors and zero residual literal bracket paragraphs. Both editors were returned to reading mode without saving. The default PWA matrix remains `58 passed / 36 conditional skipped`; those skipped online/fixture-gated cases remain separate verification debt rather than PASS.

## Offline/context delivery regression coverage (2026-08-11)

`apps/web/e2e/library-offline.spec.ts` covers active-shell immediate startup, failed update preservation, deterministic Skill asset caching, read-only current-conversation files, cached/missing attachment handling, local CanJSON/Markdown/`.context.zip` export, both Chinese and English Skill SHA-256 values, download-plus-copy clipboard rejection, inert Skill viewing/download and exact 360x800, 390x844 and 768x1024 reflow.

The full local matrix completed with `41 passed / 27 skipped`. The skips are conditional API/fixture-backed flows (upload/import/online reader/share) because the PWA web server was intentionally run without an API at `127.0.0.1:8000`; they are not counted as PASS. Offline quota exhaustion, interrupted package writes, reconnect synchronization and production network interception remain `NOT_PRODUCTION_VERIFIED`.

The local offline exporter is intentionally bounded to the downloaded snapshot and does not replace the server export contract. Any future change to manifest compatibility must add an API/import round-trip test before release.

## Reader wheel stabilization 2026-08-10

The production-equivalent fixture contains three heavy Assistant messages with 402, 389 and 501 mixed paragraph, CJK, emoji, heading, list, table and short/long-code blocks. It may be created by the suite or reused explicitly:

```powershell
$env:E2E_LONG_READER='1'
$env:E2E_LONG_READER_CONVERSATION_ID='<qa-conversation-id>'
$env:E2E_LONG_READER_TARGET_MESSAGE_ID='<qa-message-id>'
$env:E2E_LONG_READER_TARGET_BLOCK_INDEX='180'
$env:E2E_LONG_READER_ANNOTATION_QUOTE='<qa-quote>'
corepack pnpm --filter web exec playwright test e2e/reader-restoration.spec.ts e2e/reader-block-layout.spec.ts --config=playwright.config.ts
```

The suite asserts estimator bounds, direct/search/annotation navigation, refresh restoration, TOC virtualization, preference anchoring, Owner and Share reuse, 30 monotonic wheel steps, at most six mounted messages, bounded virtual rows, no row gaps/overlap, no middle-window turn fetch, no save during wheel input and exactly one save after idle. Current result: `9 passed`.

Performance gating is opt-in so slow CI hardware does not hide functional failures:

```powershell
$env:E2E_READER_PERF_BUDGET='1'
corepack pnpm --filter web exec playwright test e2e/reader-restoration.spec.ts --config=playwright.config.ts --grep 'continuous wheel' --repeat-each=3
```

Current production-build Chromium results were `16.7ms` p95 frame interval in all three runs; longest task was `72/68/70ms` and five-second long-task total was `72/68/70ms`. Budgets are p95 `<=34ms`, no task `>150ms`, and total long-task time `<=250ms`.

Release checks for this change: Web lint/typecheck/build PASS; API `216 passed / 3 skipped`; Alembic one head `20260806_0021`; PWA default `37 passed / 22 conditional skips`. Conditional PWA skips remain `PARTIAL_PASS`, not PASS.

## Release-Readiness Audit 2026-08-10

- Required local baseline: lint, typecheck and production Web build passed; API `216 passed, 3 conditional skips`; PWA `30 passed, 21 conditional skips`; Alembic has one head `20260806_0021`. Conditional skips are not PASS.
- Real production Chrome acceptance was read-only for existing business data. QA-only conversations verified creation, insertion, source task toggle, deletion/undo, restricted Share/revocation and the direct API import follow-up. Existing acceptance fixture verified attachment Renderers, Range and adaptive visible Viewer panels.
- The supplied JSON + Markdown pair previewed exactly 398 nonempty messages and committed without a 500 through the production multipart API. Browser chooser interaction remains `NOT_PRODUCTION_VERIFIED` because this Chrome integration cannot inject chooser selections.
- Release blockers: active unreferenced Attachments missing from Files Panel filters and a non-functional delete-undo toast. The detailed report, QA cleanup record and redacted evidence are in [UX_RELEASE_READINESS_AUDIT_2026-08-10.md](evidence/UX_RELEASE_READINESS_AUDIT_2026-08-10.md).
- Production negative offline/weak-network faults, 360px and browser zoom matrix, QA export/restore round trip and conditional PWA scenarios remain `NOT_PRODUCTION_VERIFIED` until separately executed.

## Release Stabilization 2026-08-10

- Root-cause fixes: delete/restore now return the committed conversation revision; edit/task/version responses do the same; Web seeds the create response, applies insert/edit/task/version/delete/restore revisions immediately, and preserves a retryable Undo state. Restore is idempotent.
- Attachment API rows expose `current_occurrence_count` as a projection. Active zero-reference rows remain eligible for All/Unreferenced; detached rows remain excluded. No occurrence/AssetObject merge or migration was introduced.
- Managed dialogs use `useDialogFocus` for synchronous meaningful focus, Tab/Shift+Tab trapping, Escape and logical trigger restoration after pointer defaults. Backdrops are pointer-only `aria-hidden` surfaces, so each dialog has one accessible visible close button. Attachment Viewer restoration falls back to the current connected Attachment trigger if React replaced the opener node.
- Disabled Scanner messaging is neutral `Info` + `未扫描`; it is not rendered as clean/safe or as an attachment fault. Project creation uses Chinese `新建项目` labels and autofocuses the inline field.
- Verification: targeted API `10 passed`; full API `216 passed / 3 skipped`; Web lint/typecheck/build PASS; focused stabilization contracts `4 passed`; PWA default `30 passed / 21 skipped`. Production Chrome on final commit `ed9116a` passes Viewer initial focus, keyboard loop, Esc/X/backdrop restoration, single close/Shell, and Project-create autofocus/Escape restoration. The bridge's requested 390px viewport rendered at 433px without page horizontal overflow. Exact 360/390, real 125/150/200% zoom and forced-offline negative paths remain `NOT_PRODUCTION_VERIFIED`; skips are not release PASS.

## Attachment Inline Layout System

- Focused Playwright policy tests: `13 passed` across InlinePresentation mapping, six centralized lane contracts, justified last-row bounds, progressive disclosure, runtime FileList fallback, CSV/TSV Table/Raw behavior and unchanged adaptive Viewer behavior.
- Web lint, typecheck and production build: PASS.
- API regression: `216 passed, 3 skipped`; skipped fixture-gated cases are not PASS.
- PWA default matrix: `28 passed, 21 skipped` (`PARTIAL_PASS`). Online/fixture-gated upload, full Reader and restoration scenarios require explicit services/flags.
- Alembic: one head `20260806_0021`; no migration.
- Production Chrome evidence: the deployed acceptance conversation verified group-owned lanes, one Viewer shell, CSV Table default, Raw toggle and return to Table. The broader visual matrix (all requested formats and mobile widths) remains `NOT_PRODUCTION_VERIFIED` unless separately captured; skipped cases are not PASS.
- Caption follow-up: focused policy tests `6 passed`; final production Chrome found zero legacy `Attachment:`/`附件：` captions duplicating Preview-header filenames. All three CSV Table actions remained available.

Local checks for the conversation, import and viewer addendum:

- `pytest -q` API suite: `216 passed, 3 skipped`.
- Real JSON + Markdown fixture (`CHAT_READER_E2E_FIXTURE_DIR=<EXAMPLES_DIR>`): 398-message preview, commit and repeated commit passed; local test harness elapsed 17.7 seconds.
- Web lint, typecheck and production build: PASS.
- Attachment renderer policy/presentation Playwright tests: PASS.
- Full King browser verification of new message dialogs and complex Office/ZIP viewers: `NOT_PRODUCTION_VERIFIED` until a dedicated deployment test is run. Skipped scenarios are not PASS.

## Reader Wheel Performance Regression

- `reader-block-layout.spec.ts` verifies paragraph, CJK/emoji, explicit-line, heading, code and empty-block estimates against stable layout metrics.
- `reader-restoration.spec.ts` verifies monotonic 30-step wheel input, bounded warmed height correction, no middle-window turn request, one idle position write, TOC follow, preference anchoring, annotation/refresh restoration and Share Reader reuse.
- Performance budgets run on a production build three times; report the median and every raw run. Functional invariants must never be skipped because a CI host is slow. Timing-budget failure may be reported as environment-specific only when all functional invariants still pass.
- 2026-08-10 local production-build result: p95 frame interval 16.7ms; longest task 72/68/70ms; total long-task time 72/68/70ms. Production Chrome read-only wheel evidence was monotonic with zero reverse steps and an 85px warmed height correction over about 1,080px.

## Reader Scrollbar Jump Regression

- `reader-restoration.spec.ts` changes an upstream virtual height after a heavy message has cached its absolute margin, jumps into that message, and requires a visible block plus reading-line coverage within the recovery budget. A visible Message shell without a visible block is a failure.
- The pointer-drag regression holds an active pointer while moving the Reader to the edge. It asserts that no `reader-turn` request starts while the pointer is held, then that exactly one request starts after release.
- Run the production-equivalent path with `E2E_LONG_READER=1`; the default PWA matrix intentionally reports these fixture-gated cases as skipped rather than PASS.

## Final Release Closure 2026-08-11

### Current command results

| Check | Result |
| --- | --- |
| Web lint / typecheck / production build | PASS |
| Full API | PASS: 218 passed, 3 skipped |
| Alembic | PASS: one head `20260806_0021` |
| Default PWA | PARTIAL_PASS: 37 passed, 27 conditional skipped |
| Mutation lifecycle/stabilization | PASS: 5/5 |
| Long Reader restoration | PASS: 8/8 |
| Offline baseline | PASS: 6/6 |
| File chooser/upload lifecycle | PASS: 5/5 |
| Flagged import/task/DnD | PASS: 3/3 |
| Sharing/system archive/manual targeted | PASS: 13/13 |

The default 27 skips are classified, not erased: 18 long-Reader/layout cases are environment/fixture-gated, 8 upload/import/task/DnD/mutation cases are online environment-gated, and 1 attachment case is fixture-gated. Release runs explicitly enabled the meaningful mutation, upload, import/task/DnD and long-Reader suites. A local reader-layout attempt using a production-only conversation ID produced four fixture-resolution failures; it is not a product PASS or failure and is superseded by exact production viewport checks and the valid long-Reader fixture.

### Release test status rules

- API PASS does not imply a complete user-flow PASS.
- Latest higher-level production E2E overrides older component/API evidence.
- A conditional skip remains unverified until its required service, fixture and flag are supplied.
- Device-scale-factor is not accepted as browser 125/150/200% zoom.
- Production bridge chooser limitations are recorded separately from Playwright's real `setInputFiles` coverage.
- `.cr v4` restore runs only in an empty production-equivalent instance, never by clearing production.

Actual browser zoom and the Offline negative matrix (runtime chunk miss, original/derivative miss, quota, interrupted package and reconnect) remain `NOT_PRODUCTION_VERIFIED`; therefore the strict Core and PWA release gates remain `PARTIAL_PASS`.

## Attachment Workspace And Markdown Source Regression 2026-08-11

- `release-stabilization-contract.spec.ts` freezes `reader-floating`, `left/top` CSS geometry, the whole-header drag handle, `grab/grabbing`, the accent `Paperclip`, stable CodeMirror setup/update callbacks, external `editorDocument` ownership and the Reader editable-target keyboard guard.
- `release-mutation-lifecycle.spec.ts` reads the real CodeMirror selection through the host's `data-cursor-offset`. DOM `Range` is not valid evidence for the whole source because CodeMirror virtualizes lines. The test moves to the bottom of a long source, types one character, deletes it and asserts exact cursor restoration plus no backward scroll correction.
- Current release results: API `218 passed / 3 skipped`; Alembic one head `20260806_0021`; default PWA/Playwright `39 passed / 27 conditional skipped`; static stabilization contract `6/6` PASS; production-equivalent source cursor/mutation flow `2/2` PASS. Production Chrome repeated the type/delete path at source offset 21860 with an unchanged 41091px scrollTop and unchanged active message.
- Production Chrome verified the attachment workspace default geometry, visible accent icon and computed `cursor: grab`. The bridge does not expose a physical pointer API; real drag/persistence/reset remains covered by the Playwright `reader-layout` mouse test and must not be reported as a production-bridge pointer PASS.
