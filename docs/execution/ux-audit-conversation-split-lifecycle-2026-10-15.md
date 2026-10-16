# Conversation split workspace lifecycle audit

- Date: 2026-10-15
- Scope: `apps/web/features/editing/conversation-split-workspace.tsx`
- Evidence basis: current source inspection; no service, browser, login, or production run
- Pre-edit SHA-256: `AE524D2013C747AF47CF9804710F346BFAAC0174AA0C404D7FBC5A7E43351F22`
- Post-edit SHA-256: `F458597CE846E8602108E791F18A9F54DB47D9F06FEEB8126CE3091044F46C74`

## 1. Scope & evidence base

**Audited:** Reader → Split conversation: full dialogue-index read, range/
boundary/discrete selection, preview, execute, close/reopen, and source or
selection replacement.

**Platform:** Next.js web app.

**Audience:** Mixed, with ordinary Reader users as the optimization target.

**Evidence:** Current repository source and neighbouring Reader split call sites
on 2026-10-15; the pre-edit source hash is recorded above. The report was
written before the source edit.

**Not audited, and why:**

- Live browser timing, focus, and responsive layout — no product service or
  browser session was started.
- Real network/API failures, server acceptance after a lost response, and
  screen-reader output — unavailable without runtime access.
- Split API payload validation and database transaction behavior — deliberately
  out of scope; existing contracts are retained.

No accessibility conformance claim is made; this is a source-backed lifecycle
review.

## 2. Executive summary

The split workspace already gives users three explicit selection modes and a
server preview before creating new conversations. Its pre-edit read failure
path does not provide an in-place retry, so a temporary index failure forces a
close/reopen cycle. More seriously, a failed replacement read can leave the
previous dialogue rows in local state, while preview and execute callbacks
have no current-workspace admission check. A late response can therefore
restore an old preview or trigger the parent selection reset after the Reader
has moved on. Plan controls also remain editable while preview or execute is
pending. The bounded repair adds local retry, clears unconfirmed rows, scopes
callbacks, and locks the plan without changing sent requests or server
semantics.

## 3. Quick wins

| ID | Finding | Dimension | Severity | Effort |
|---|---|---|---|---|
| SPLIT-READ-RECOVERY-01 | Keep the workspace open with a read-only Retry | Feedback and states | Medium | S |
| SPLIT-STALE-STATE-02 | Do not show old rows after a replacement read fails | State coverage | High | S |
| SPLIT-ASYNC-03 | Fence callbacks and parent follow-up by workspace scope | Core task flow | High | S |
| SPLIT-LOCK-04 | Lock plan controls during preview/execute | Error prevention | Medium | S |

## User-facing path

An authenticated user selects **Split conversation** from Reader, chooses a
range, boundary, or discrete message set, previews the result, then creates
one or two new conversations. The workspace reads the complete dialogue index
before exposing useful choices. Closing and reopening the workspace or changing
the Reader conversation must not let an earlier read, preview, or split result
change the current workspace.

## 4. Findings (pre-edit evidence)

### SPLIT-READ-RECOVERY-01 — index failure has no in-place retry

| | |
|---|---|
| **Dimension** | Feedback and states |
| **Severity** | Medium |
| **Confidence** | Observed (source); rendered timing inferred |
| **Effort** | S |
| **Location** | `conversation-split-workspace.tsx:38–59, 143–167` before edit |

Evidence: the open effect calls `loadDialogueIndex(conversationId)` and stores
only a local `cancelled` flag. On failure it sets the general `error` string,
but the timeline has no load-error branch or Retry control. The Preview action
stays disabled while the index is empty, so closing and reopening is the only
indirect retry path.

User impact: a temporary network or API read failure strands the split flow and
forces the user to lose the current workspace context. The action is
read-only and should be retryable without starting a split.

### SPLIT-STALE-STATE-02 — failed replacement load can reveal the old timeline

| | |
|---|---|
| **Dimension** | State coverage / data display |
| **Severity** | High |
| **Confidence** | Observed (source); rendered consequence inferred |
| **Effort** | S |
| **Location** | `conversation-split-workspace.tsx:41–58, 143–155` before edit |

Evidence: the open effect resets `preview`, `result`, and `error`, but it does
not clear `items`, message selections, or title state before loading a new
`conversationId`/selection. The render switches away from the loading message
when the read fails and maps the retained `items` as the current timeline.

User impact: after changing the source conversation or reopening for a new
selection, a failed read can make old messages look like the current source.
The preview controls are then based on stale local choices rather than a
confirmed current index.

### SPLIT-ASYNC-03 — preview and execute results are not workspace-scoped

| | |
|---|---|
| **Dimension** | Core task flow / feedback and states |
| **Severity** | High |
| **Confidence** | Observed (source); cross-context consequence inferred |
| **Effort** | S |
| **Location** | `conversation-split-workspace.tsx:89–116` before edit |

Evidence: `requestPreview()` and `execute()` publish `setPreview`, `setTitles`,
`setResult`, `setError`, `setBusy`, and `onCompleted` without a current
workspace/operation check. Only the index-read effect has a `cancelled` flag.
Closing/reopening or changing `conversationId` can therefore allow an older
preview or confirmed split response to update the new view. The parent
`onCompleted` callback also clears the Reader selection and invalidates the
conversation list, so a late callback can affect a newer Reader context.

User impact: users may see a preview for a prior conversation, or a completed
split notice/selection reset after they have started working on another one.
The server write itself must not be replayed or cancelled; only stale UI
publication and the parent follow-up should be suppressed.

### SPLIT-LOCK-04 — selection controls remain editable during preview/execute

| | |
|---|---|
| **Dimension** | Error prevention / forms and input |
| **Severity** | Medium |
| **Confidence** | Observed (source); mismatch consequence inferred |
| **Effort** | S |
| **Location** | `conversation-split-workspace.tsx:133–167` before edit |

Evidence: `busy` disables the Preview/Create buttons, but mode buttons,
message selectors, timeline toggles, and result-title inputs do not consume
that lock. A user can change the local plan while a preview or split request
is in flight, leaving the visible plan and returned response from different
inputs.

User impact: the workspace can look like it previewed or created the current
selection when the response belongs to an earlier one. This also weakens the
existing duplicate-submit protection.

## 5. Prioritized backlog and implementation

Add a workspace scope and operation sequence for load, preview, and execute;
retire it synchronously on close and on source/selection changes. Clear the
old timeline/selection before a replacement read, add a local index-read Retry,
and display stale/failed reads without claiming the old timeline is current.
Use the existing read-only error copy and request functions. Disable only the
workspace plan controls while a preview or execute request is pending. Do not
abort already-sent requests, replay writes, change split API payloads, or alter
server validation and generated conversation URLs.

Implemented in `conversation-split-workspace.tsx`: the index read now clears
the previous rows and choices, exposes an in-place **Retry reading** action,
and reports a load error without rendering old rows. Workspace and operation
refs fence the index, preview, execute, error, busy, result and parent
follow-up publication. Close retires the scope synchronously, while the
existing split requests remain non-cancellable and are never replayed.
Mode, message and title controls are disabled during preview/execute.

## Acceptance boundary

- A failed current index read cannot render the previous conversation's rows as
  the current timeline and has an in-place Retry.
- Old load/preview/execute responses cannot publish into a newer workspace
  scope; a stale execute does not clear a newer Reader selection.
- The current plan is locked while preview or execute is pending.
- Confirmed writes remain confirmed; no automatic retry or cancellation is
  introduced.
- No API, schema, `.cr`, Share URL, offline package, canonical data, or
  stable Reader-anchor change.
- Source-only verification is limited to diff whitespace checking; browser,
  API, build, CI, and production acceptance remain pending.

## 6. What's working, and what I left alone

**What's working.** The workspace uses the complete dialogue index rather than
trimming the source to an arbitrary message window. It presents a server
preview before the write, keeps generated conversation links after a confirmed
split, and already uses stable bilingual error classification.

**What I left alone, and why.** Split modes, selection semantics, title
payloads, API functions, server validation, parent list invalidation, generated
URLs, Reader anchors, and request cancellation policy were not redesigned.
They are existing product contracts; the observed defects were in local
admission and feedback state.

## 7. Open questions

- **Live failure timing:** Does the production transport return a response after
  the workspace is closed often enough to affect perceived recovery? A browser
  test with a delayed synthetic response would settle the frequency, but the
  source guard is still required for correctness.
- **Post-commit close behavior:** If a user closes immediately after the split
  request is accepted, should the parent conversation list invalidate in the
  background even though the retired workspace must not clear a newer
  selection? The current bounded repair prioritizes avoiding cross-context UI
  mutation; this is a product-policy question.

## Appendix — evidence log

**SEEN**

- `apps/web/features/editing/conversation-split-workspace.tsx` before and after
  the edit, including the Reader parent callback.
- `apps/web/lib/api.ts` split preview/execute functions and their unchanged
  payload boundary.
- Existing `ux-audit-conversation-split-error-recovery-2026-10-14.md` and local
  split recovery conventions.

**NOT SEEN**

- Running Reader, real API/network ordering, mobile layout, keyboard focus,
  screen-reader output, server commit behavior, CPU/RSS, and production data.
