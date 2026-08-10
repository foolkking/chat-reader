# Chat Reader Release-Readiness Audit (2026-08-10)

## Executive Summary

**Overall status: `PARTIAL_PASS`.** Chat Reader is close to release readiness: the exercised import, Reader, attachment, Share and scanner-disabled paths work. It should not receive an unconditional release sign-off until the two P1 lifecycle defects below are closed and re-tested.

Strengths:

- The production Reader, bounded attachment previews, CSV table Viewer, SVG-as-image path, Range support and adaptive Viewer panels behaved as contracted.
- The supplied large JSON+Markdown pair no longer produced a preview `500`: its 398 nonempty messages aligned exactly and committed successfully.
- QA Share scope was read-only, did not expose owner controls, and revocation immediately made it unavailable.

Release blockers:

1. Active, unreferenced business Attachments are absent from the Files Panel although export facts retain them.
2. The message delete toast's visible `Undo` action does not restore the deleted QA message and gives no failure feedback.

The first post-create message insertion also submits a stale conversation revision until refresh, and dialogs do not consistently restore focus. These are not release blockers on their own but should be addressed in the same stabilization release where feasible.

## System and User-Flow Understanding

Chat Reader is a single-owner library for imported linearized AI conversations. Its users import records, organise conversations and Projects, read/search/annotate long dialogs, make controlled versioned edits, consume attachments, share restricted read-only views, export portable archives and keep selected content offline.

Core task paths:

1. Import compatible data, preview it and find the new conversation.
2. Read a long conversation, search/navigate/annotate and return to position.
3. Create, insert, edit and safely delete a QA message.
4. Understand an attachment inline, open the matching Viewer or download fallback, and Share within scope.
5. Export/restore or prepare offline material without changing canonical content.

Success means a user can complete those paths independently with clear feedback and recovery. A route merely rendering is not acceptance.

## Evidence and Data Boundary

The original requirement sources were [product.md](../product.md), [USER_FLOWS.md](../system/USER_FLOWS.md), [FEATURE_INVENTORY.md](../system/FEATURE_INVENTORY.md), [ATTACHMENT_RENDERER_CONTRACT.md](../system/ATTACHMENT_RENDERER_CONTRACT.md), and [PROJECT_STATE.md](../../PROJECT_STATE.md).

- Existing Projects, conversations, messages, versions, attachments, Shares, exports and source import files were read-only.
- All writes used a separately created dated QA project/conversation. QA conversations were deleted after testing, QA Share was revoked and the QA Project was archived. No original record was changed.
- A committed QA ImportRecord has no safe owner deletion endpoint and remains under the normal server lifecycle. This is the only known QA metadata residual; it contains no changed user content.
- Screenshots containing existing titles or body text were deleted. Only QA/synthetic cropped evidence remains.

## Test Scope and Limits

| Surface | Result |
| --- | --- |
| Production Chrome | Real UI clicks, text entry, dialogs, refresh, Reader/Viewer, attachment navigation, Share and isolated QA writes were executed. |
| Desktop | 1440x900 and 1280x720 inspected; no page-level horizontal overflow observed. |
| Narrow layouts | 768x1024 and 390x844 inspected; sidebar collapsed and no page-level horizontal overflow observed. |
| 360x800; 125%, 150%, 200% zoom | `NOT_PRODUCTION_VERIFIED`; safe browser zoom control was unavailable in this integration. |
| UI file chooser | `NOT_PRODUCTION_VERIFIED`; this Chrome integration cannot inject chooser files. The same production multipart import API was exercised directly. |
| Fault injection / offline loss / worker crash / two-tab race | Local automated tests where available; intentionally not injected in production. |

## Automated Baseline

| Command | Result | Evidence |
| --- | --- | --- |
| `corepack pnpm run lint` | `PASS` | Completed without reported failure. |
| `corepack pnpm run typecheck` | `PASS` | Completed. |
| `corepack pnpm --filter web build` | `PASS` | Production build completed. |
| `corepack pnpm run test:api` | `PASS` | 216 passed, 3 conditional skips. Skips are not PASS. |
| `cd apps/api; python -m alembic heads` | `PASS` | One head: `20260806_0021`. |
| `corepack pnpm --filter web test:pwa` | `PARTIAL_PASS` | 30 passed, 21 conditional skips. |

## Production Acceptance Results

| Area | Result | Actual evidence |
| --- | --- | --- |
| Multi-format Reader | `PASS` | Fixture loaded from its initial loading state; Markdown rendered, CSV/TSV had a bounded table, and code/text previews were readable. |
| Scanner wording | `PASS` | `scanner_disabled/unscanned` displayed as `未扫描`; no clean/safe claim appeared. |
| Attachment fallback | `PASS` | Empty file was `空文件 · 0 B`; TIFF was not placed in the visual gallery; AVI/MKV used download fallback. |
| SVG safety | `PASS` | Fixture SVG used `img`; attachment content did not use `object`, `embed` or iframe. |
| Range | `PASS` | PDF GET/HEAD advertised `Accept-Ranges`; valid single range returned `206` with `Content-Range`. |
| Unified adaptive Viewer | `PASS` | Exactly one Viewer dialog root. Small ZIP visible panel measured 720x420; one-page PDF panel about 1120x786. Screenshot: [compact ZIP](screenshots/ux-audit-20260810/VIEWER-001-compact-zip-redacted.png). |
| Conversation creation | `PASS` | QA flow atomically created nonempty User -> Assistant messages. |
| Insert / pair insert | `PARTIAL_PASS` | Both succeeded after refresh; immediate insert defect recorded as FUNC-002. |
| Task list | `PASS` | Valid standalone task checkbox persisted after reload and version change. |
| Share / revoke | `PASS` | QA Share hid owner controls; revocation rejected the same URL. |
| Large pair import | `PASS` | Preview HTTP 200 in 8.7s; exact 398-message alignment; committed in 28.7s. |
| Offline library landing | `PARTIAL_PASS` | Catalog/storage state rendered; offline loss/cache-miss/update paths not production-injected. |
| QA export / `.cr v4` restore | `NOT_PRODUCTION_VERIFIED` | Existing automated coverage only; no production QA round trip in this audit. |

The dialog overlay intentionally fills the viewport for backdrop and focus semantics. That root is not the visible Viewer panel. Measuring only the root would falsely classify compact/document panels as fullscreen; the visible panel measurements above are the accepted result.

## Findings Summary

| ID | Page / flow | Finding | Type | Severity | User effect | Cost | Blocks release |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FUNC-001 | Current conversation Files Panel | Active unreferenced Attachments disappear from `All` and `Unreferenced` while exports retain them. | FUNC / REQUIREMENT | P1 | Cannot find or insert retained files. | Medium | Yes |
| FUNC-003 | Delete message | `Undo` does not restore and fails silently. | FUNC / UX | P1 | A promised recovery path is false. | Low-Medium | Yes |
| FUNC-002 | First insert after create | Stale revision error until manual refresh. | FUNC / UX / COPY | P2 | Primary edit action fails with no recovery. | Low | No |
| A11Y-001 | Dialogs / Viewer | Close leaves focus on `body`, not opener. | A11Y / UX | P2 | Keyboard context is lost. | Low | No |
| A11Y-002 | Import / insert / delete dialog | Backdrop and visible X are both focusable `关闭` controls. | A11Y | P2 | Tab order is ambiguous. | Low | No |
| UI-001 | Files Panel | Disabled scanner policy is styled as a warning. | UI | P3 | Intentional non-error draws excess attention. | Low | No |
| COPY-001 | Project creation | Chinese UI exposes `Create project`; new field does not receive focus. | COPY / A11Y | P3 | Mixed language and extra keyboard step. | Low | No |

## Detailed Findings

### FUNC-001: Active unreferenced Attachments disappear from Files Panel

- **Severity/type:** P1, FUNC / REQUIREMENT. **Frequency:** Reproducible in the acceptance fixture.
- **Location:** `当前对话文件` desktop panel, `全部` and `未引用` filters.
- **Steps:** Open fixture; select `消息操作 -> 当前对话文件`; select `全部`, then `未引用`.
- **Expected:** The fixture's 76 Attachment records include two active zero-reference files. They appear in `All` and `Unreferenced`, with normal insert/manage actions.
- **Actual:** Panel shows 74 entries under used files and `未引用` reports no match. Portable export facts retain the two business Attachment records.
- **Impact:** The documented workflow "preserve/upload a file -> leave it unplaced -> find it later -> insert it" cannot complete.
- **Root-cause hypothesis:** Query/summary filtering conflates `active + zero current occurrences` with `detached`. Confidence high for behavior, medium for exact cause.
- **Fix:** Audit API predicates and summary aggregation by `Attachment.status` plus current-version occurrence count. Include active zero-reference in `All`/`Unreferenced`; exclude only detached. Add two distinct Attachments sharing one AssetObject regression.
- **Acceptance:** Panel count reconciles with export attachment count; each active unreferenced file can insert without creating another Attachment/AssetObject.
- **Cost/blocker:** Medium / yes.

### FUNC-003: Delete Undo silently fails

- **Severity/type:** P1, FUNC / UX. **Frequency:** Reproduced once with an exact toast selector in QA data.
- **Location:** Delete confirmation then post-delete `撤销` toast.
- **Steps:** Delete a QA message; wait for toast; click its exact `撤销`; wait; refresh.
- **Expected:** Message returns locally and remains after refresh, or an actionable error/retry appears.
- **Actual:** Toast accepted the click; message count stayed reduced and refresh did not restore it. No alert/retry was shown.
- **Impact:** Users are told deletion is reversible when it is not, damaging data confidence.
- **Root-cause hypothesis:** Stale message/revision data, wrong restore request, or swallowed restore rejection. Confidence medium.
- **Fix:** Trace click-to-request; carry fresh deletion revision into restore; await success before dismissing toast. Keep toast with retry on error.
- **Acceptance:** Restore works once, is idempotent on repeated click, refresh persists it; a forced 409 retains a visible recovery action.
- **Cost/blocker:** Low-Medium / yes.

### FUNC-002: First insertion after create submits stale revision

- **Severity/type:** P2, FUNC / UX / COPY. **Frequency:** Reproduced directly after QA conversation creation.
- **Steps:** Create nonempty QA User -> Assistant pair; without refresh insert one valid message after the first message.
- **Expected:** Insert uses the create response revision or refreshes it before submit.
- **Actual:** Draft remains but response is `Conversation changed since it was loaded.`. After refresh the same insert succeeds.
- **Evidence:** [Redacted QA capture](screenshots/ux-audit-20260810/FUNC-002-insert-stale-revision-redacted.png).
- **Impact:** First core edit looks broken and recovery is undocumented.
- **Fix:** Seed Reader/query cache and insert form from the create response revision, or fetch before enabling actions. Localize the response and offer reload while preserving draft/cursor.
- **Acceptance:** First insert succeeds without refresh; genuine 409 is Chinese, actionable and preserves content.
- **Cost/blocker:** Low / no.

### A11Y-001: Dialog close loses trigger focus

- **Severity/type:** P2, A11Y / UX. **Frequency:** Reproduced for dialog and Viewer close paths.
- **Steps:** Keyboard-focus opener; open dialog; close with Escape or close control; inspect active element.
- **Expected:** Focus returns to opener or deterministic adjacent fallback.
- **Actual:** `document.activeElement` is `body`.
- **Fix/acceptance:** Common controller stores connected trigger and restores it after unmount; Esc, X and backdrop paths each return to the trigger and never target a hidden element.
- **Cost/blocker:** Low / no.

### A11Y-002: Duplicate focusable close controls

- **Severity/type:** P2, A11Y. **Frequency:** Reproduced in import, insert and delete dialogs.
- **Steps:** Open dialog and Tab through controls.
- **Expected:** One visible accessible close button; pointer backdrop is not a tab stop.
- **Actual:** Full-screen backdrop button and visible X both announce `关闭`.
- **Fix/acceptance:** Make backdrop non-focusable (`tabIndex=-1`, hidden from accessibility tree) while retaining pointer behavior. Assert exactly one accessible close control.
- **Cost/blocker:** Low / no.

### UI-001: Disabled scanner policy has warning visual weight

- **Severity/type:** P3, UI.
- **Expected/actual:** `未扫描` is required, but panel-wide yellow warning treatment suggests an attachment fault rather than intentional DisabledScanner policy.
- **Fix/acceptance:** Use neutral informational text or info affordance; leave row metadata `friendly type · size · 未扫描`; do not change Scanner behavior.

### COPY-001: Project creation naming and focus are inconsistent

- **Severity/type:** P3, COPY / A11Y.
- **Expected/actual:** Chinese UI has accessible `Create project`; opening inline field does not focus it.
- **Fix/acceptance:** Use `新建项目` consistently, autofocus opened input, and restore trigger on Escape.

## Core Flow Matrix

| Flow | Expected goal | Actual result | Status | Main obstacle |
| --- | --- | --- | --- | --- |
| Find/open conversation | Locate Reader from library | Worked | PASS | Empty-library first-use not production-verified. |
| Create QA conversation | Atomic User -> Assistant | Worked | PASS | None. |
| Insert single/pair | Correct role/order | Worked after refresh | PARTIAL_PASS | FUNC-002. |
| Edit task marker | Persist state/version | Worked after refresh | PASS | None. |
| Delete and undo | Safe recovery | Undo failed | FAILED | FUNC-003. |
| Import supplied pair | Preview/commit large pair | 398 exact messages, no 500 | PASS | Browser chooser only unverified. |
| Long Reader | Show large conversation | Windowed Reader loaded 10/398 | PARTIAL_PASS | Full navigation/search/annotation stress not repeated. |
| Attachment consume | Render/open/download/fallback | Exercised formats work | PARTIAL_PASS | FUNC-001. |
| Share/revoke | Restricted read-only lifecycle | Worked | PASS | Expiry unverified. |
| Export/restore | QA portable round trip | Not run | NOT_PRODUCTION_VERIFIED | Existing automated coverage only. |
| Offline library | Catalog and offline state | Catalog works | PARTIAL_PASS | Negative offline states unverified. |

## UI, Performance and Extension Review

### UI strengths

- Reader remains visually primary while Files Panel serves management.
- Attachment formats use semantics rather than one generic preview: rendered Markdown, bounded code/data, image safety, explicit media fallback and compact/archive/document Viewer panels.
- Narrow inspected widths collapsed the sidebar without a page-level horizontal scroll.

### Performance and feedback

- The paired import preview completed in 8.7s and worker commit in 28.7s; this is a successful scenario, not production p50/p95 evidence.
- The 398-message Reader did not remain in a blocking loader.
- FUNC-002 is both correctness and perceived-performance debt because it fails immediately with English/no recovery.
- Browser integration Statsig/extension transport errors were not attributed to the application because code inspection found no app-owned Statsig integration.

### Extension decisions

| Category | Recommendation | Benefit / cost / decision |
| --- | --- | --- |
| Before release | Fix zero-reference Files Panel and delete Undo | Restores documented lifecycle/trust; medium and low-medium cost; required. |
| Post-release priority | Dialog focus consolidation and first-write revision handoff | High-frequency confidence/accessibility gain; low cost; do next. |
| Optional | Minimal empty-library import guidance | Improves first-use comprehension; low cost; validate with users. |
| Not recommended | Trash, a new Scanner, heavy Office/CAD services, a second Viewer | Conflicts with accepted lifecycle/DisabledScanner/2 GiB hosting/one-Viewer boundaries. |

## Remediation Roadmap

1. **Release blockers:** Fix FUNC-001 and FUNC-003, add regression tests and rerun QA paths.
2. **Core experience:** Fix FUNC-002, A11Y-001 and A11Y-002; run 360px/200% keyboard acceptance.
3. **Visual efficiency:** Demote scanner-policy warning and correct project-creation language/focus.
4. **Only after closure:** Add onboarding or export-progress refinements; do not widen the Viewer format/service scope.

## Final Decision and Evidence

**Do not declare unconditional general availability yet.** The core product is usable and several complex routes passed, but the two P1 items affect attachment retrieval and deletion recovery. After both regressions pass, the remaining P2 work can be shipped in the same stabilization release or tracked with an explicit accessibility follow-up.

| Artifact | Scope | Purpose |
| --- | --- | --- |
| [FUNC-002 screenshot](screenshots/ux-audit-20260810/FUNC-002-insert-stale-revision-redacted.png) | QA-only | Valid insertion draft retained with stale-revision feedback. |
| [Compact ZIP Viewer screenshot](screenshots/ux-audit-20260810/VIEWER-001-compact-zip-redacted.png) | Synthetic fixture | Confirms archive viewer presentation is compact, not an oversized content panel. |

No real conversation IDs, titles, bodies, tokens, cookies, credentials or unredacted screenshots are retained here.

## Remediation Result (2026-08-10)

The historical findings above remain unchanged as audit evidence. The following closure changes were implemented after root-cause tracing:

| Finding | Root cause confirmed | Remediation | Automated result | Production result |
| --- | --- | --- | --- | --- |
| FUNC-001 active unreferenced files | The API already starts from active Attachment rows; only explicit `detached` status hides a row. The missing UI evidence represented detached acceptance records, not a safe reason to infer status from occurrences. | API now exposes `current_occurrence_count`; client filters/sorts use the current-version projection and keep active zero-reference rows distinct from detached. Existing upload/unplaced and keep-in-conversation regressions remain covered. | PASS: attachment API targeted tests and full API suite. | NOT_PRODUCTION_VERIFIED after this release; existing production rows were not changed. |
| FUNC-002 immediate insert revision | Create/insert responses were canonical, but the Web create callback discarded the response and did not seed the conversation cache. | Create seeds `conversation/{mode}/{id}`; insert applies returned canonical revision before Reader refresh. 409 wording remains localized and draft-preserving. | PASS: full API, typecheck/build; online UI flow remains flag/fixture gated. | NOT_PRODUCTION_VERIFIED after this release. |
| FUNC-003 delete/undo | Delete/restore changed `offline_revision` in the transaction but response/toast used the pre-delete client revision; failed restore was cleared without an actionable error. | Delete/restore return post-commit revision; Undo stores it, has deleting/restoring/restored/restore_failed states, visible retry/live region, refresh persistence, and idempotent restore. | PASS: manual message API including repeated restore; build/typecheck. | NOT_PRODUCTION_VERIFIED after this release. |
| A11Y-001/A11Y-002 dialog focus/close | Dialogs had per-component lifecycle, backdrop buttons and no shared focus restoration. The first Viewer migration also omitted the close-button ref and later restored before pointer defaults, so production Chrome exposed both failures. | `useDialogFocus` now uses synchronous layout focus, one pointer-only backdrop, Tab trapping, and next-task logical restoration. Viewer falls back to the current Attachment trigger when React replaced the opener. | PASS: lint/typecheck/build and focused stabilization contracts `4 passed`. | PASS: real Chrome verified one Shell/one close, immediate close focus, Shift+Tab/Tab containment, and Esc/X/backdrop restoration. |
| UI-001/COPY-001 | DisabledScanner note used warning styling; project create trigger exposed English metadata, did not autofocus and had no Escape restoration. | Neutral Info/secondary `未扫描`; Chinese `新建项目`, autofocus, Escape cancellation and next-task trigger restoration. | PASS: lint/typecheck/build and focused contract. | PASS: real Chrome verified input focus and Escape returning to `新建项目` without submitting. |

Why the previous tests missed these issues: API-only tests asserted status codes and persistence but not client cache handoff, toast state, focus restoration or post-refresh DOM. The default Playwright matrix intentionally skips API-backed mutation, chooser and long Reader scenarios unless services/flags are supplied. New API response assertions and client contracts prevent the revision regression; the remaining browser/production gates are explicitly not promoted to PASS.

### Current release closure

- Core local code checks: PASS. Final focus commit `ed9116a`, external build `31374507130`, verified archive SHA-256 and King health deployment are PASS.
- Attachment lifecycle semantics: PASS in API/contract tests; production recheck pending.
- Delete/Undo API and idempotency: PASS; real browser flow pending.
- Dialog/Viewer focus infrastructure: PASS in production Chrome for initial focus, Tab loop, Esc/X/backdrop close and logical restoration.
- Requested 390px rendered as 433px in the browser bridge and passed without horizontal overflow. Exact 360/390, 125/150/200% zoom, two-tab race and forced-offline negative paths remain NOT_PRODUCTION_VERIFIED.
- No original production records were modified or deleted. The prior QA cleanup remains as documented; no new QA data was created in this code-only closure.
