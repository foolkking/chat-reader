# UX quick review — single-conversation placement

2026-10-09 · Existing Web conversation menus · Written before application edits.

## Scope and evidence

This batch follows ordinary readers moving one conversation to a project or back
to Unclassified from a list or sidebar. It uses the working tree on parent
`a12ce9e287fdddfd4df8a6039a212cec04629568`, including the previous local metadata
batch. Evidence is source code and, when recorded below, synthetic execution.
Rendering, browser focus, touch/IME behaviour and real failure frequency are not
observed. No accessibility conformance claim is made.

Excluded: bulk moves, drag sorting, archive/delete/pin actions, changing project
membership policy, Reader position/navigation, Share and offline formats. No
application service or database fixture is started; no production UI is used.
The user permits local improvements only: no commit, push, CI, deployment or
subagents. Historical verification ledgers are not rewritten for this batch.

## The three things that matter most

1. A failed or unfinished project read can be presented as “No matching projects”.
2. A selected destination can outlive the search and menu session that exposed it.
3. A failed move has no local recovery, while an acknowledged move still waits
   for unrelated reads and does not refresh the real remote Reader detail.

The server already enforces ownership, active destinations and revision conflicts.
This is a client interaction/feedback repair, not an authorization or data-loss
vulnerability. The public conversation summary deliberately hides archived project
membership, so a null project field alone cannot prove physical default membership.

## Findings and prioritized backlog

| ID | Finding | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| STATE-01 | Project read states collapse into an empty search result | State coverage | Medium | Observed (code); rendering Inferred | S |
| FORM-01 | A hidden or previous-session destination remains actionable | Input/error prevention | Medium | Observed (code); interaction Inferred | S |
| A11Y-01 | The embedded picker inherits menu keys and lacks labelled selection | Keyboard/input | Medium | Observed (code); browser/SR effect Inferred | S |
| ERR-01 | Move errors have no retained, explicit recovery path | Error recovery | Medium | Observed (code); failure frequency unknown | M |
| FBK-01 | Completion waits on refresh and misses the remote Reader key | Feedback/data consistency | Medium | Observed (code); visible delay Inferred | M |
| A11Y-02 | Removing the pending action has no lost-focus recovery | Keyboard/state transitions | Medium | Observed (code); browser effect Inferred | S |

### STATE-01 — distinguish reading, failure and empty results

Location: `apps/web/features/conversations/conversation-action-menu.tsx:76–83,
284–336`. Opening the whole menu enables `getProjects`; the picker maps
`projectsQuery.data ?? []` and displays “没有匹配的项目” / “No matching projects”
whenever that filtered array is empty. It has no loading/error branch or retry.
A reader cannot tell whether there are no destinations or the list has not loaded.
Read only when choosing a destination, show “Loading projects…” / “正在读取项目…”,
and offer a read-only “Retry projects” / “重试读取项目” after failure. Retain cached
names as context but disable choices until a successful read. Distinguish no
active projects from no search match; offer clearing the search in the latter.

### FORM-01 — bind the destination to current visible choices

Location: the same menu `:68–70,80–83,290–328`. Search and closing do not reset
`targetProjectId`; submission checks only that it is nonempty and `busy` is null.
Someone can therefore act on a destination no longer shown by the search or a
newly loaded project list. Reset selection with a new picker session, disclose the
selected name, and revalidate against the successful current destination read
before sending. If filtering hides the selection, clear it. Exclude default and
archived records defensively. The ordinary projects endpoint already excludes
archived records; the missing client predicate is not proof it normally returns
archived projects. The backend also rejects invalid destinations.

### A11Y-01 — give the picker its own form and keyboard context

Location: menu `:210–227,291–314`. The menu's bubbling handler intercepts Home,
End and arrow keys without checking the event target. Its search input has only a
placeholder, and selected project buttons carry no selected/checked semantics.
Readers editing a search or using nonvisual controls lack the field/selection
contract afforded by adjacent dialogs. Open a small, labelled destination dialog
from the menu; use labelled search and radio choices, the existing focus helper,
44px actions and an independently scrolling list. Keep input/IME keys out of menu
navigation and sidebar drag handlers. Actual focus, announcements and viewport
behaviour still require browser acceptance.

### ERR-01 — preserve the request and require explicit current-state review

Location: menu `:160–168,322–330,342–355`; placement route
`apps/api/app/api/routes/conversations.py:393–440`. `run` sets React busy state
but has no synchronous admission guard and no catch/recovery UI. Placement can
return 409 for stale revision or 422 for invalid state/target. A network failure
can also lose a committed acknowledgement. The reader should not have to repeat
an uncertain operation from a fresh, stale row.

Use one list/sidebar-owned controller, not the row that may disappear. Retain the
conversation, intended destination and revision through failure; reserve writes
synchronously. An uncertain result offers “Check current location” / “核对当前归属”
and sends only GET. Present the observed current value, then require another
explicit decision before writing with the newly read revision. Do not replay a
PUT automatically or remove its precondition. A failed check removes any older
actionable comparison. Fence closed/replaced operations and account/owner changes.
Menu/drawer closure must not erase an outstanding result; full owner navigation
is not a durable cross-navigation recovery store.

`_conversation_item` at `conversations.py:873–896` maps both default and archived
projects to null. Therefore a read displaying null must say it can mean an
archived project, not “the move to Unclassified succeeded”. GET is a current-value
observation, never a receipt or proof that an earlier request did not commit.
The existing detail GET suffices for honest review; do not add a new membership
API merely to claim stronger acknowledgement. A deliberate retry to null still
uses the canonical revision and the existing atomic placement endpoint.

### FBK-01 — publish confirmation before independent refresh

Location: menu `:141–168`; `conversation-reader.tsx:452`; list/sidebar callers
at `conversation-list.tsx:454`, `project-conversation-list.tsx:388` and
`project-sidebar.tsx:811`. The canonical placement response is discarded, then
`finish()` waits for list refresh and invalidates `['conversation', id]`, whereas
the Reader uses `['conversation', 'remote', id]`. Row removal can also remove
row-local feedback. A reader may see stale location or no acknowledgement even
after a successful write.

Publish the response to existing relevant remote caches and acknowledge from the
parent owner before handled, detached refresh. Preserve higher revisions; do not
create absent lists/rows, fabricate a full Detail from the partial response, or
modify reading positions/offline/Share data. Remove confirmed moved rows from old
project/history lists, but refresh to obtain missing destination rows/order/counts
instead of guessing them. A failing refresh is not a failed move. Query invalidation
usually resolves despite GET errors; a rejecting callback is a separate defensive
test case, not proof that every GET 503 rejects `finish()`.

## Implementation brief and unchanged decisions

### Final-review addition, recorded before its repair

A11Y-02 location: `conversation-placement.tsx:277–290,299–301,361–367` and
`components/use-dialog-focus.ts:55–104`. The placement surface removes the submit
or check button when it enters moving/checking. The shared focus helper runs on
opening/closing, not those phase changes; its Tab boundaries require focus on
the first/last enabled control. A keyboard reader whose removed button leaves
focus on the document body could continue outside the modal. This is a source
inference, not an observed browser escape. Recover only body/lost focus on phase
changes to the first enabled button (the persistent, labelled Close control),
with `preventScroll`; leave any deliberately focused control alone. Do not focus
the negative-tabindex form root, which is not a boundary in the existing trap.
Add synthetic positive and non-interference checks before patching this branch.

Intent: a reader filing one conversation can see the exact destination, then an
honest result without losing their reading context. Palette: the approved paper,
graphite, sea-green and semantic status tokens. Depth/surfaces: quiet borders,
raised modal and modal-only shadow. Typography: existing app font stack, text-sm
working copy, readable mobile inputs. Spacing: 4px base, 20px dialog sections and
44px controls. Apply `.interface-design/system.md`; platform and design direction
are already approved. No new dependency, token, brand work or additional feature.

Reuse the metadata dialog's focus/layout pattern and project archive's parent
owner/feedback pattern. Sidebar desktop/mobile representations share one owner
and one dialog. Keep “Move to unclassified” a one-step reversible command, with
the same recovery feedback if needed; do not add a confirmation to its happy path.
Keep bulk/DnD callbacks untouched. The server's single relation, normal-section
cross-project rule, same-project no-op and pin/revision rules remain authoritative.

Quick wins are the read-state distinctions and destination/keyboard guards.
Implement the recovery/acknowledgement owner in the same scoped batch because
moving can remove the source row. First run a failing synthetic baseline, then
patch the application and verify the existing server contract with disposable
SQLite TestClient tests. Browser discovery is not browser execution.

## Evidence status and open questions

- Seen: exact menu and three owners; shared focus/metadata/project-archive patterns;
  API helper/types, placement route/service and summary serialization; existing
  atomic-placement API test; approved design system.
- Not seen: live desktop/mobile rendering, IME, focus restoration, screen reader,
  real transport races or PostgreSQL locking. No claim is made for those.
- Exact baseline, final local checks and source hashes are recorded below and
  beside this report. Previous batch ledgers keep their original meaning.
- Hypothesis (unverified): long translated project names or the mobile keyboard
  could crowd the picker. The new browser cases must test narrow/short viewports;
  source inspection cannot establish their layout quality.

## Implemented local checkpoint

`useConversationPlacement` now belongs to each list/sidebar, with one surface
outside disappearing rows and outside the sidebar frame's cloned representations.
The menu only opens that owner. Choosing a project uses independent read states,
a labelled search and native radios. Search/session/current-query guards prevent
hidden or stale destinations from being sent. The one-click Unclassified path and
all unrelated actions remain unchanged.

The owner reserves before awaiting, retains uncertain requests, checks only with
GET and requires explicit fresh-revision retry. Closing or reopening does not
resend/cancel. New checks retire old comparison actions; account/scope/unmount and
closed-dialog guards fence old callbacks. Malformed/mismatched acknowledgements
remain uncertain; denied access hides retained names. This is owner-local state,
not durable recovery across navigation, refresh or tabs.

Valid acknowledgements update existing remote/list/project/recent caches before
independent, handled refresh. Higher revisions and reading/detail-only data are
preserved. Missing target rows, counts and relation timestamps require GET; no
data is manufactured from the partial response. Project/default membership, no-op,
pin/revision, ownership and inactive-state rules remain the existing server's job.
No API implementation, migration, offline format or Share behavior changed.

The final focus guard uses the persistent Close button only when a phase change
finds body/lost focus. It never steals from another chosen control. The guard and
its negative controls are synthetic logic evidence only. The existing held-write
and held-check browser cases now require real Close focus and Tab/Shift+Tab
containment, but have not executed.

## Verification ledger

| Checkpoint | Result | Interpretation |
| --- | --- | --- |
| Original menu baseline | 3 passed / 19 failed, 22 cases | [Baseline](ux-audit-conversation-placement-2026-10-09-evidence/baseline.json); corrected legacy-picker adapter before the valid run |
| Initial repair | 22 passed | Original failing contracts repaired locally |
| Recovery-edge review | 38 passed / 6 failed, 44 cases | [Edge baseline](ux-audit-conversation-placement-2026-10-09-evidence/recovery-edge-baseline.json); old account/scope/closed actions, null response and denied identity |
| Final focus baseline | 58 passed / 2 failed, 60 cases | [Focus baseline](ux-audit-conversation-placement-2026-10-09-evidence/focus-baseline.json); two passing non-interference controls |
| Final combined Node suite | 371 passed / 0 failed / 0 skipped / 0 cancelled | 60 placement + preceding 311; actual compiled callbacks/JSX and installed QueryClient/Observer, explicit lifecycle/transport/focus doubles |
| Placement/projects API | 18 passed / 0 failed, 37.02s | 8 new placement + 10 existing project cases on disposable SQLite TestClient, not PostgreSQL |
| Lint / nonincremental typecheck | Passed | Local only |
| Bounded Web build | Passed | Next 16.3.8, one worker, standalone disabled; no Web service started |
| Browser discovery | 61 found / 0 executed | Eight new placement cases, 375px Chinese/light and 1440px English/dark; not browser acceptance |

The complete [local verification record](ux-audit-conversation-placement-2026-10-09-evidence/local-verification.json)
owns commands, durations, file hashes and final consistency checks. The API first
run was 17 passed / 1 failed because the new test read `messages` instead of the
actual message-window `items`; fixing the test and adding a 200-status assertion
yielded the complete 18-pass rerun. This was not an API defect. The earlier Windows
wildcard and four isolated-harness import failures remain recorded separately;
only dependency mocks were added to those old harnesses, not changed assertions.
Earlier 19- and 41-pass API checkpoints overlap contracts and are not summed or
reported as fresh reruns. Earlier browser discoveries and source hashes remain
dated snapshots, even when this batch intentionally changes shared Web files.

Real browser/React lifecycle, focus/IME/screen-reader behavior, viewport/visual
checklist and PostgreSQL concurrency remain **NOT_VERIFIED**. No visual score or
conformance claim is assigned. No commit, push, CI, image build, deployment,
production request, service fixture restart or subagent was used for this batch.
The full optimization goal remains active; passing a local checkpoint does not
authorize publishing it.
