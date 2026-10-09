# UX quick review — conversation metadata

2026-10-09 · Existing Web conversation menus · Report delivered before application edits.

## Scope and evidence

Audit Rename conversation / 重命名对话 and Edit description / 编辑简介 for ordinary
readers organizing their archive. These are secondary organizing tasks, not message
editing. Evidence is the working tree on parent a12ce9e: the actual menu, shared
prompt, API schema/route, Reader and list query consumers. Source is observed;
rendered layout, focus, announcements and real failure frequency are not observed.
No application service, browser, production account or PostgreSQL fixture was used.
This is not an accessibility conformance evaluation or a redesign.

Excluded: pin, move, archive, delete, exports, Share, offline package/Dexie formats,
message bodies, new API concurrency contracts and cross-navigation draft storage.
The latest user direction permits local improvements only: no commit, push, CI,
deployment, subagents, service startup or fixture restart.

## The three things that matter most

1. The optional description cannot be cleared through its existing prompt.
2. The client silently slices the submitted description, including valid Unicode.
3. The editor closes before saving; neither a retained failed draft nor a result
   check exists, and a confirmed write still waits for unrelated reads.

There is also a concrete cache-key mismatch: the menu invalidates a detail key
that the current Reader does not use. These findings concern metadata and feedback,
not lost conversation messages. The backend already accepts clearing and returns
canonical metadata, so these repairs need no API or migration change.

## Findings and prioritized backlog

| ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| FORM-01 | Optional description is rejected when empty | Input/forms | Medium | Observed (code); interaction Inferred | S |
| FORM-02 | Description is silently truncated by UTF-16 length | Input/forms | Medium | Observed (code); rendered effect Inferred | S |
| ERR-01 | Saving starts after the draft dialog closes, without local recovery | Recovery/states | Medium | Observed (code); failure frequency unknown | M |
| FBK-01 | Confirmed metadata writes wait for follow-up list reads | Feedback/perceived performance | Medium | Observed (code); visible delay Inferred | S |
| STATE-01 | Menu invalidation misses the live remote Reader detail | Data consistency | Medium | Observed (code); active-query effect to reproduce | S |

### FORM-01 — allow an explicitly empty description

Location: `apps/web/features/conversations/conversation-action-menu.tsx:239–250`
and `apps/web/components/interaction-dialog-provider.tsx:78–82`. Every prompt trims
its value and rejects an empty result with “This field cannot be empty.” The
description action uses that prompt. In contrast, `apps/api/app/api/routes/
conversations.py:295–305` explicitly normalizes a supplied empty/null description
to null and bumps the offline revision only when it changes.

A reader can add a description but cannot remove it through this action. Keep
the title required, allow the description to be empty, and show “Optional. Clear
this field to remove the description.” / “可选；清空后保存即可移除简介。” Do not
relax the shared prompt's other callers. The project's existing settings dialog
already supplies the local multiline/optional-field pattern.

### FORM-02 — preserve input and validate the actual limit

Location: the same menu `:243–250`, shared prompt `:91`, and
`apps/api/app/schemas/conversation.py:92–96`. The label promises Markdown and
500 characters, the control is a single-line input, and the client unconditionally
submits `description.slice(0, 500)`. JavaScript counts UTF-16 code units here;
Pydantic's string limit counts Unicode code points.

A reader can submit less than intended without a warning, including text that
fits the backend limit. Use the existing multiline field style, retain the entire
draft, count the normalized submission in code points and show an inline error
above 500. Do not add native `maxLength=500`, which repeats the UTF-16 mismatch.
Keep internal Markdown newlines and make the counting convention explicit.

### ERR-01 — retain the editor until the result is known

Location: menu `:160–168,223–250`, shared prompt `:40–44,82`. The prompt settles
and closes before `updateConversation` runs. `run` has `finally` but no local
catch or error state. Reopening initializes from the old conversation prop,
not the submitted draft. A rejected promise alone is not a recoverable form.

Keep one field-specific draft in a small menu-owned dialog through submission.
Reserve admission synchronously and retain input after validation/network errors.
An unknown result offers “Check current value” / “核对当前内容”, an explicit GET
only. A matching current value can acknowledge the desired state without another
PATCH. A differing value must be shown next to the draft before a deliberate
choice to continue editing or use the current value. A failed check retains
uncertainty. A GET is a current-value observation, **not a write receipt** and not
proof that an earlier request never committed; do not claim otherwise.

Dirty dismissal uses the existing confirmation style. Unknown-outcome dismissal
must say that closing discards the local draft/check state but does not cancel or
undo the server request. The ordinary “unsaved changes” wording alone is not
accurate in that state. Fence old callbacks after unmount/account changes.

### FBK-01 — acknowledge before refreshing

Location: menu `:139–169`. After `await action()`, the menu awaits detail and list
invalidation before closing or clearing busy. The returned canonical PATCH value
is discarded. A slow follow-up read delays the end of a completed edit.

Publish confirmed metadata into existing relevant caches and close the editor
before detached, handled refresh. Do not convert refresh errors into write errors.
Ordinary Query invalidation errors resolve by default; a rejecting callback is
a separate defensive double, not evidence that every GET 503 throws from `finish`.

### STATE-01 — use the actual private Reader key

Location: menu `:143`, `conversation-reader.tsx:451–454`,
`apps/web/lib/reader-data-source.ts:111`, and `project-sidebar.tsx:811`. The sidebar
can edit metadata alongside an open Reader. The menu invalidates
`["conversation", id]`; the Reader reads `["conversation", "remote", id]`.
List refresh callbacks do not invalidate that detail key.

The open Reader can therefore retain old metadata after a sidebar edit. Update
and invalidate the exact remote detail, including list/project/recent metadata
copies that already exist. Preserve project relations, recent reading anchors,
unrelated conversations and offline/Share query namespaces. Cancel older relevant
reads before publishing; never create a fabricated missing list/detail record.

## Implementation brief and unchanged decisions

Intent: a reader can edit one catalog field, see honest save feedback, and recover
without retyping or blindly repeating an uncertain write. Palette: approved paper,
graphite, sea-green and semantic danger tokens. Depth: existing portal modal with
quiet borders, raised surface and modal-only shadow. Typography: preserve the app
font stack and small working copy; use readable mobile field text. Spacing: 4px
base, existing 20px sections and 44px action targets. Header/actions stay fixed;
only the working body scrolls. `.interface-design/system.md` remains authoritative.

Use a focused `ConversationMetadataDialog`, mounted only for one field, and the
existing focus/confirmation infrastructure. No new dependency, global editor,
API, migration, design token or persisted private draft. A no-op edit sends no
PATCH. Rename continues to update title and display_title together; description
updates do not send title/status/placement. Success adopts canonical response data,
not optimistic guesses. Same-field cross-client writes remain last-write-wins.

Rejected alternatives: expanding all shared prompts broadens unrelated behavior;
silently truncating input hides loss; automatic PATCH retry cannot prove a prior
failure. Per-field save plus current-value comparison follows existing recovery
surfaces without introducing a new task product.

## Quick wins, controls and open questions

FORM-01/02, FBK-01 and STATE-01 are small fixes but share the same editor boundary;
implement them together with ERR-01 to avoid a partially repaired save flow.
Preserve existing menu labels, DnD event boundaries, other menu actions, field
semantics, API ownership and canonical/offline revision behavior.

First record a failing baseline with actual compiled callbacks/JSX, controlled
hook/transport/confirmation doubles and the installed QueryClient/QueryObserver.
Then test normalization, Unicode, exact write scope, no-ops, draft recovery,
read-only checks, synchronous admission, stale callbacks and cache namespaces.
Add isolated API contract tests without changing the API, plus discoverable
browser assertions. Only discover the browser file under the current startup
restriction; do not run or work around the denied Web launch.

Real React lifecycle, keyboard/IME/portal focus, 375px/1440px rendering, visual
checklist and screen-reader announcements remain **NOT_VERIFIED** without browser
execution. Recovery is local to the mounted editor, not durable across navigation,
reload, tabs or devices. Current-value reads cannot settle same-field concurrency.

Pre-edit SHA-256: menu `63c0072ab20606033360e471fcd74bd1a111a750e8d86e4eb57628a2abed7010`;
shared prompt `937c5d5d2b8f9ef75d24717327b373efa62d96b1a05709b7b83f2db24941fd89`;
Reader `bd45902276aa3731e1a243cdd251e8cbb688f05a33757592074ff359a9188d5e`.

## Controlled pre-edit baseline

The [baseline](ux-audit-conversation-metadata-2026-10-09-evidence/baseline.json)
records **5 passed / 15 failed / 0 skipped / 0 cancelled** across 20 checks,
1695.3325ms. These are five findings, not fifteen defects. Controls preserve
rename payloads, required titles, description prefill/internal newlines and
offline/unrelated detail isolation. Newline execution is a callback check, not
proof that the old single-line browser input accepts typed newlines.

The first test-construction run had 20 failures because the `useCallback` double
invoked its argument. That harness error was corrected before the valid baseline
and before any application edit; it is not product evidence. Discarded async
promises are captured only to prevent node:test from crashing, without supplying
an application catch or recovery state.

## Recovery-edge review before checkpoint closeout

The initial repair passed 56 metadata checks (304 with the preceding suites),
19 SQLite metadata/management API tests, lint, nonincremental typecheck and the
bounded build. The browser file discovered 51 cases; none ran. Final review found
two remaining edges within ERR-01, not new product scope:

- `conversation-metadata-dialog.tsx:197–210,147` compares both `title` and
  `display_title` during a read-only check, but renders only the effective title
  and reduces the checked base to that one string. If the display title already
  matches the draft while the stored title differs (or a separate display title
  is absent), **Continue editing draft** followed by **Save** can close as a
  no-op without applying the intended pair. The comparison must expose both
  values only when they differ; an explicit save after comparison must compare
  the complete rename payload. An untouched initial editor must remain a no-op.
- The comparison actions at `:208–216,272–274` guard the phase but not the
  identity of the checked snapshot. After a second successful check, a captured
  handler from the first comparison can act on the older value. Tie each action
  to its own current snapshot; starting another check retires prior actions.

These are **Medium**, **Observed (code)** recovery defects with **Inferred**
rendered consequences and unknown real-world frequency; effort S. Seven targeted
callback/markup regressions will record the remaining failures before these
small application edits. This does not change the original baseline or any
previous checkpoint hashes. The interface brief above still applies: paper and
graphite comparison rows, existing typography, quiet borders and 44px actions;
no new tokens, dependencies, screens or persistent drafts.

## Local implementation and final verification

All five initial findings have a local repair. Rename and description now use
one field-specific `ConversationMetadataDialog`; the shared prompt and unrelated
menu actions retain their existing behavior. Drafts survive failed/unknown
responses, optional descriptions clear explicitly, multiline text is preserved,
and the 500-character check uses normalized Unicode code points without cutting
input. Synchronous admission and account/mount/close guards fence stale callbacks.

Confirmed values update existing remote Reader/list/project/recent caches before
independent refresh. Project relations, recent anchors, unrelated records and
higher revisions survive; absent caches/records are not fabricated. Offline and
Share namespaces are untouched. `updateConversation` accepts an optional third
abort signal without changing its JSON payload or two-argument callers. No API
implementation, schema, migration or dependency changed for this metadata batch.

Read-only recovery compares current values, not a receipt. A mismatch offers a
deliberate choice; retaining a draft alone never writes. Differing stored/display
titles are shown separately, and a subsequent explicit save compares the whole
rename pair. Every new check retires both old comparison callbacks. Dismissal
of an uncertain edit explains that it cannot cancel or undo the server write.

The [recovery-edge baseline](ux-audit-conversation-metadata-2026-10-09-evidence/recovery-edge-baseline.json)
reproduced **58 passed / 5 failed**, 5039.6127ms: five assertions across the two
edges above. The same 63 checks then passed, 4365.7225ms. Two added controls
confirm that untouched initial titles still perform no write or refresh, even
when their stored/display values differ. The historical 20-case baseline and
the intermediate 304-pass/51-discovered checkpoint remain distinct.

The [final local ledger](ux-audit-conversation-metadata-2026-10-09-evidence/local-verification.json)
owns exact commands, counts, source hashes and the earlier failed runs:

| Check | Final result and boundary |
| --- | --- |
| Combined Node scripts | **311 passed / 0 failed / 0 skipped / 0 cancelled**, 7591.8971ms; 63 metadata + 248 preceding checks |
| Metadata/management API | **19 passed**, 40.85s on disposable SQLite; API/schema/test sources unchanged since that run |
| Web lint | Passed after the final component and browser-test edits |
| Nonincremental typecheck | Passed with `tsc --noEmit --incremental false` |
| Bounded Web build | Passed; Next 16.3.8, one worker, standalone disabled; compile 22.2s, built-in TS 7.5s, 14 pages in 3.1s |
| Browser discovery | **53 discovered / 0 executed**; ten metadata cases in the shared follow-up file |
| Prior API checkpoint | 41 SQLite passes remain a separate historical run; seven relevant implementation/test hashes still match |
| PostgreSQL concurrency | Two previously skipped cases remain **NOT_VERIFIED**, not rerun |
| Visual/focus/accessibility acceptance | **NOT_VERIFIED**; no screenshot, rendered checklist score or conformance claim |

The final source snapshot covers 45 files. Of the prior checkpoint's 34 files,
32 are unchanged; only the shared Web API helper and browser spec changed for
this batch. Original source hashes and previous ledgers are not overwritten.
Document links and source/count consistency are checked separately in the ledger.

Browser assertions cover 375px Chinese/light and 1440px English/dark, retained
and cancelled input, Unicode validation/clearing, real Reader acknowledgement
while refresh GETs are held, applied/unapplied unknown responses, failed checks
and complete title comparison. The Reader case now waits for the initial visible
title before testing its sidebar toggle. Assertions and intended screenshots are
not evidence of execution. Synthetic Node hooks/effects/transport/auth/portal/focus
remain doubles, not actual React lifecycle or browser interaction.

Recovery remains local to this mounted editor; it is not persisted across full
navigation, reload, tabs or menu instances. Same-field concurrency is still
last-write-wins, and checking current values cannot prove non-application of an
earlier write. No service/fixture was started, no production UI was accessed and
no image was built. This checkpoint is uncommitted and excluded from passing
CI 37812290017. Production remains the accepted 30a0d32 release; further CI or
deployment still needs a new explicit user request. The overall goal stays active.
