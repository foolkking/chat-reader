# 当前用户流程

## Reader quiet autosave and navigation readiness (local-only, 2026-10-09)

Passive Reader use does not display a row, toast, blinking indicator or repeated
live announcement for normal position saving, queued/submitted synchronization or
idle state, including an ordinary offline queue. The status component keeps its
observation and recovery effects mounted. Local saving, outbox synchronization,
retry rules and position payload/throttling are unchanged.

Real storage/read/sync failures and cross-device conflicts retain their current
explanations and explicit recovery controls. Failed locating of a chosen position
still offers its exact retry. These exceptional notices keep their existing
placement and can affect layout; the quiet policy is for routine autosaves, not
suppression of failures. Explicitly opened sync-center detail (`showIdle`) still
shows normal pending/saved state, but not routine success beside a current
storage/read/action/locate error.

First-content readiness now follows an accepted, rendered current complete-turn
window on an available Reader surface, including genuine empty success. The
scheduled frame checks visit/auth ownership, connected root identity and current
window/generation. A separate target read can therefore finish readiness while
the obsolete initial query remains failed. Exact locating can still fail after
content becomes readable; its navigation error is not hidden by readiness.

Input and position listeners bind/clean up when the actual Reader surface becomes
available/unavailable, independently of the initial query result. Every explicit
non-restore index/message navigation settles the initial saved-position decision
and cancels an older restore. `restorePosition: true` and programmatic scrolling
do not create user intent. The stable real-DOM anchor algorithm, complete-turn
queries and apply-once window protection remain intact.

The [audit and checkpoint](../execution/ux-audit-reader-navigation-readiness-2026-10-09.md)
separate source/static-markup/extracted-code checks from unexecuted browser tests.
Real geometry, paint timing, touch/focus and network persistence remain unverified.

## Reader initial complete-turn recovery (local-only, 2026-10-09)

When detail is available but its first body window fails, **Retry messages /
重试读取正文** retries the existing complete-turn query with its original URL/saved
anchor. Generic localized error/access copy replaces raw transport text. Loading
does not claim an empty conversation; a genuine successful empty result retains
the existing empty state. Offline errors are unchanged.

Retry requires the current visit/authentication and anchor scope, a live idle/error
query, no accepted current window/messages and no in-progress navigation. It joins
the existing read with `cancelRefetch: false`; it does not reopen the conversation,
repeat recent-open, refresh detail or resubmit a mutation. The original five-turn
loader, missing-anchor fallback, query key and enablement remain intact.

An independently accepted target window retires the original initial error/retry.
The unchanged apply-once guard also prevents a late initial result from replacing
that window. Current-scope focus recovery restores only lost/body focus with
`preventScroll`; another chosen control or newer navigation retains ownership.
The [audit](../execution/ux-audit-reader-initial-window-2026-10-09.md) distinguishes
extracted-code checks from unexecuted browser navigation/focus/scroll assertions.
First-paint and position readiness are covered by the separate local behavior
above; the initial-error checkpoint alone did not establish that broader path.

## Reader detail-read recovery (local-only, 2026-10-09)

A temporary remote detail GET failure keeps the matching cached Reader available,
with **Could not update the conversation. Previously loaded content is shown.**
and **Retry conversation / 重试读取对话**. The compact notice is inside the reading
section but outside its header and scroll subtree; it does not replace loaded
messages or add a new layout key. HTTP 401/403/404, a different cached id and known
merged sources do not retain this reading surface on error. Denied/missing and
wrong-id data also cannot provide the document title. The merged destination
action and existing offline error policy are unchanged.

The same localized read retry exists on an initial remote detail error. It refetches
only that detail query, guards the current visit/authentication generation and
ignores duplicate activation while fetching. Explicit retry joins an in-flight
read (`cancelRefetch: false`); this differs from a newer recent summary invalidating
an older detail GET. Recovery does not recreate a visit, reset a loaded turn window
or replay a mutation. After first successful detail, normal initial dependent reads
and the first recent-open POST can still proceed.

When the focused retry disappears, current-owner recovery targets only lost/body
focus. It focuses the existing labelled **Conversation content / 对话正文** region
with `preventScroll`; another chosen control is left alone. A failed retry can
return lost focus to the current retry control. Real focus, retained DOM identity
and scrolling remain unverified; the [audit](../execution/ux-audit-reader-detail-recovery-2026-10-09.md)
separates source/extracted-code checks from browser acceptance.

## Reader recent-open reconciliation (local-only, 2026-10-09)

Opening a loaded conversation reserves one recent-open attempt for that mounted
conversation/data-source visit. Query refreshes, project-context changes and lost
responses do not automatically post another open; leaving and revisiting can.
Unmount, a different owner or authentication-generation changes fence old admission
and publication. This does not cancel or undo an already-sent server request.
Bookkeeping failures remain non-blocking, without a new error dialog or retry UI.

The recent response contains a list summary, not a complete Reader detail. An older
revision leaves cached detail and its freshness timestamp unchanged. A newer one
invalidates only the exact remote detail key for a full GET, superseding an older
in-flight detail read; it never labels old canonical fields with the new revision.
At equal revisions, only a strictly newer valid reading timestamp replaces the
time/progress pair. Rereading may lower progress. Invalid identity/revision, missing
detail and equal-time results cannot manufacture or regress a detail snapshot.

Valid current remote replies independently refresh `conversations`, `projects`
and `recent-items`; failed refreshes do not replay the open. Offline recording uses
its existing local timestamp update without refreshing remote lists. Complete-turn,
reading-position, DOM-anchor, Share and offline-package behavior is unchanged.
Recent's navigation project context is not redefined as canonical membership.
The [audit](../execution/ux-audit-reader-recent-2026-10-09.md) separates synthetic
Query/API evidence from unexecuted browser and real React lifecycle acceptance.

## Single-conversation placement recovery (local-only, 2026-10-09)

**Move to project / 移动到项目** opens a labelled project picker from the existing
conversation menu. **Move to unclassified / 移到未分类** remains a one-click command.
One mounted list/sidebar owns the request and feedback outside the source row;
the sidebar's desktop/mobile copies share one owner and one dialog outside the
cloned sidebar contents. Removing a moved row does not erase its result.

Project reads distinguish loading, failure, no active destinations and no search
match. Failed reads offer an explicit read-only Retry; cached names are contextual,
not actionable. Native radio choices and labelled search retain normal editing
keys. A new picker clears selection; filtering away a target clears it too. Just
before PUT, the target must still be present, active and non-default in the latest
successful, idle project query and match the current search.

The existing placement PUT sends `target_project_id`, `target_section: normal`
and `expected_offline_revision`. A synchronous reservation admits only one request.
Writes/checks use 15-second timeout/abort signals; abort does not undo a server
commit. Unknown results retain **Check current location / 核对当前归属**, a GET only.
The resulting comparison enables **Move again using current state / 按当前状态再次移动**
only as a new explicit decision, using that read's revision. Checks/reopening never
automatically resend; newer checks retire older comparisons and failed reads do
not leave stale retry actions enabled.

GET's null public project summary can mean either Unclassified/default or an
archived project. The comparison says **Unclassified (may belong to an archived
project) / 未分类（也可能属于归档项目）**. It is a current observation, not a receipt
or proof that an earlier request did not commit. The unchanged atomic PUT is the
authority for an explicitly requested move to the internal default project.

A valid acknowledgement publishes only to existing remote Reader/list/project/
recent entries before independently refreshing. It preserves higher revisions,
detail-only data, reading anchors and global pins. Confirmed old-project/history
rows are removed; missing target rows, ordering, relation timestamps and counts
come from GET, not guesses. Same-project no-ops preserve pin/order/revision.
Offline data, Share, bulk actions and DnD remain unchanged.

Closing pending/unknown recovery keeps a page-level review entry without cancelling
the request. Dismissing a check does not undo the server move. Scope/account/unmount
guards fence old actions and late responses; unavailable access hides retained
names. Recovery is local to this owner, not persisted across full navigation/reload
or tabs. A pending write retains its disabled submit button's label and footprint
so Back cannot replace that action. The compact pending body can still resize;
live pending-state guards ignore backdrop clicks and prevent them from blurring
the recovered focus. Explicit Close, Back and Escape remain usable and do not
cancel the server request. Lost/body focus, or focus retained on the newly disabled
submit, returns to Close with `preventScroll`; another chosen control keeps focus.
The [initial audit](../execution/ux-audit-conversation-placement-2026-10-09.md) and
[CI repair](../execution/ux-audit-release-interaction-2026-10-09.md) distinguish
synthetic checks, CI failures and pending browser reacceptance.

## Conversation metadata recovery (local-only, 2026-10-09)

Rename conversation / Edit description opens a field-specific draft using the
existing modal/focus system. Titles remain required; descriptions allow clearing,
internal Markdown newlines and at most 500 Unicode code points after trimming.
Long drafts remain intact with inline validation. No-op edits send no PATCH.
Rename writes only title/display_title; description writes only that field.

Save locks repeat submissions and keeps the draft until acknowledged. The Web
helper accepts an optional abort signal; this editor bounds writes/checks to
15 seconds. A timeout cannot cancel or undo a server commit. Unknown responses
retain read-only **Check current value / 核对当前内容**. A match acknowledges the
desired current state without replay. A differing value is shown for comparison;
**Continue editing draft / 保留草稿继续编辑** or **Use current value / 采用当前内容**
is explicit. Keeping the draft alone sends no write. When stored and display titles
differ, both appear in the comparison; a reviewed rename compares the full pair
before becoming a no-op. Untouched initial editors still send nothing. Every new
check retires the old comparison actions, even if the new read also succeeds.
A GET is not a receipt or proof of non-application.

Confirmed metadata updates only existing remote Reader/list/project/recent entries
before detached refresh. Newer cached revisions, unrelated records, project
relations and recent reading anchors are preserved; offline/Share namespaces are
not rewritten. Dirty close confirms; unknown close also explains that discarding
the local draft/check state does not cancel the server save. Stale callbacks after
close, unmount or account change cannot submit or publish. Recovery is not persisted
across full navigation/reload or shared across separate menu instances/tabs.

The [audit](../execution/ux-audit-conversation-metadata-2026-10-09.md) separates
callback/query/API checks from unexecuted browser, focus, IME and visual acceptance.
Same-field metadata concurrency remains last-write-wins; no backend/migration change.

## Merge admission recovery (local-only, 2026-10-09)

Select conversations → set title/order → submit one merge request. The title and
order describe the submitted request and stay read-only while submitting or
unconfirmed. An uncertain response offers **Check merge result**, a read-only
owner-scoped lookup. Failed/incomplete reads preserve uncertainty. Only a confirmed
missing result enables **Resubmit original merge**, with the original key/title/order;
checking/reopening never automatically submits. A found failed/cancelled task is
reported as that same task, not silently restarted.

One unresolved request per account/tab/project scope is retained in sessionStorage,
with in-memory fallback and an explicit storage warning. Reopening retains it;
locking/changing accounts fences late callbacks. Confirmed admission closes the
dialog and announces the outcome before independent task-list refresh; a completed
receipt may link to its merged conversation. Existing source data and the global
Task Center remain authoritative. Receipt lifetime is separate from the
[active-result window](RETENTION_CONTRACT.md).

Both list pages keep one recovery owner outside their loading/empty/error and
selection branches. A retained request shows **Review merge request / 核对原合并**
without selecting anything. Opening restores the original title/order with safe
labels for missing source rows; it does not automatically look up or submit a
merge. The dialog's existing account-capabilities GET may still run on open.
Fresh merges still require two selections. Project 401/403/404 hides retained
project rows and merge UI.
Closing or switching project fences old callbacks immediately, before passive
cleanup; the pending request remains in its original scope.

Manual close targets the recovery entry; confirmed admission targets the result
notice, which also survives empty/error list branches. These are locally tested
focus-target contracts, not observed browser focus. The
[audit](../execution/ux-audit-merge-admission-2026-10-09.md) records exact evidence.
Browser/focus/layout and PostgreSQL concurrency remain unverified; none of this
batch is in passing CI 37812290017.

## Archived-project recovery (local-only, 2026-10-09)

`/archived` retains cached project rows and selection during transient read errors,
with a localized stale-content notice and read-only Retry. Initial/empty-cache
errors are not known emptiness; HTTP 401/403/404 hides cached rows and results.
Confirmed single/bulk restores publish acknowledged canonical metadata to existing
cache entries and announce completion before independent refresh. The result owner
survives loading, error and removal of the final archived row, outside fetch-wide
`aria-busy`. It only restores lost focus, not a later user-chosen focus target.

An unknown restore offers **Check restore result / 核对恢复结果**, which only reads
the full owner-scoped project list. It distinguishes restored, still archived and
unavailable; a failed check keeps uncertainty and prevents blind restore/delete.
Only an explicit action can retry known still-archived projects. Checks may replace
an older background read; unresolved state belongs to this mounted section.

Actionable selection contains only current archived ids. Captured callbacks and
confirmed container deletion recheck the latest rendered scope; changed scope
causes no deletion request and asks the user to review selection. The API already
rejects deleting an active project; this client check avoids a stale request and
does not establish server atomicity. Existing deletion confirmation and conversation-preservation
semantics remain intact. Browser focus/layout and cross-device timing are unverified;
see the [audit and local checks](../execution/ux-audit-archived-project-recovery-2026-10-09.md).

## Project archive feedback (local-only, 2026-10-09)

**Archive project / 归档项目** uses one controller in the sidebar, shared by desktop
and mobile menu copies. Admission is reserved before confirmation; cancellation
sends no write. Confirmation rechecks the latest rendered active/non-default scope
and access. Late confirmation/response callbacks after owner unmount do not submit
or publish, but an already-sent server request is not cancelled or rolled back.

A confirmed archive immediately leaves active project choices and updates an
existing include-archived cache record. The notice stays outside the disappearing
row and fetch-busy list while background reads refresh; it links to `/archived`.
No conversation membership or revision is guessed from cached data. The unchanged
API preserves project relations and returns archived conversations to Unclassified.

An uncertain response retains **Check archive result / 核对归档结果** outside the menu.
This reads the full owner-scoped project list only. Failed checks stay uncertain;
successful checks distinguish archived, active and unavailable. An active result
allows a fresh explicit archive from its menu, with confirmation, never automatic
replay. The state survives closing menus/mobile drawers within this sidebar instance;
it is not persisted across navigation, unmount, reload or tabs. Access denial hides
private notice identity and blocks actions until access/read recovery.

The [audit](../execution/ux-audit-project-archive-feedback-2026-10-09.md) owns the
pre-edit baseline and local checks. Focus restoration is conditional on a lost
opener, not a new user-chosen target; real browser focus/layout remains unverified.

## Sidebar read recovery (local-only, 2026-10-09)

The sidebar's project list, Unclassified list and expanded project conversations
each own their read-only Retry. Transient failures retain current-query rows and
real reading links with a localized stale-content notice. Initial/empty-cache
failures say the read failed; expanded projects show drop guidance only after a
successful empty read. Unknown Unclassified counts use a dash, not a claimed zero.
HTTP 401/403/404 hides the affected cached private rows; it does not clear unrelated
query caches. Archived/default project records remain excluded from the active
sidebar even when present in an existing cache.

Retry repeats only that region's GET with the same sort/scope. Its busy state
does not disable navigation, expand another project, mutate membership or replay
a drag. Existing DnD sensors, placement/revision logic and links are unchanged.
This does not guarantee old rows after a new sort key's terminal read error.
The [audit](../execution/ux-audit-sidebar-read-recovery-2026-10-09.md) separates
static/query evidence from unexecuted browser DOM/focus/drag assertions.

## Conversation undo and read recovery

Project settings saves only normalized fields changed from the opening draft.
Clearing the description is a real metadata update; untouched color/icon defaults
are not written back. The confirmed canonical response updates existing project
cache variants and closes the dialog before follow-up reads. Older pending reads
are cancelled; refresh failure does not turn the completed write into an error.
Dirty-field updates protect unrelated edits, not same-field concurrency.

The project conversation list retains same-project rows/selection during a
transient refresh failure, with a localized Retry that only repeats the read.
An initial error is not an empty project. HTTP 401/403/404 hide cached rows and
bulk actions; sort placeholders never reuse another project's rows. These
project changes are local-only; current verification is in
[the audit](../execution/ux-audit-project-recovery-2026-10-09.md).

The `/` active-conversation and `/archived` lists also retain cached current-mode
rows/selection through transient read failures, with a read-only Retry and an
explicit stale-content notice. HTTP 401/403/404 still hides cached rows and bulk
controls. Same-mode sort placeholders do not borrow the other mode; a new sort
key's final error may have no retained result. With no cached rows, a read error
is not a confirmed empty list.

The root list requests all active conversations, including those in projects.
When empty, a successful empty saved-conversation check keeps the first-run
import action. Otherwise **No active conversations / 暂无活动对话** links to
**View archive / 查看归档**; it does not claim that records were filed in projects.
A failed secondary check explicitly retries only that read. These local-only
changes and their unexecuted browser coverage are recorded in the
[conversation-list audit](../execution/ux-audit-conversation-list-recovery-2026-10-09.md).

Archive/restore → Undo keeps one owner outside loading/empty/error list branches.
Only successfully acknowledged initial changes create an Undo. Pending clicks are
guarded; confirmed undo items leave the retry set. A lost/error acknowledgement
offers Check result (GET only), then retries only remaining known-unapplied items;
failed reads keep checking available. Confirmed writes are acknowledged before
list refresh and are not replayed because the refresh fails. Conversation and
project lists share this component; no task, schema or archive-format change is
introduced. Release/verification status belongs to Project State.

Search selection follows document identity within its query/filter scope when
later pages insert earlier result groups. Scope changes or removal clear it;
arrow keys still traverse visual order. Project-filter loading/error feedback
retains an applied scope even when its name cannot be read. Retry reloads projects
without resetting other filters or search history.

Recent reading distinguishes first-load failure from a failed update. Failed
updates retain cached cards and exact saved-position links with a localized
alert/retry; progress bars expose the existing localized Reading progress name.

Batch export: select conversations in a conversation/project list → Export →
Task Center → Download result. Admitted jobs continue after closing or refreshing
the list. Failed admission retains selection and permits same-key retry. Tasks
provides cancellation/retry and temporary ZIP expiry/regeneration. The ZIP keeps
numbered CanJSON entries in the selected order; it is not a backup/Context bundle.

Direct export: select Markdown or CanJSON → Download file → browser download.
While preparing, the button prevents duplicate requests and exposes Cancel.
Failures retain Reader and the selected options with an inline retry action.
Changing format/options or closing the export panel cancels this direct download;
it does not cancel queued Context/archive jobs. Success only reports that the
download was handed to the browser, not that a file was saved to disk.

## Whole-site recovery and mobile flows (2026-10-04)

New conversation, message insertion and project settings retain unsaved input
when closing is cancelled or submission fails. In-flight writes lock editing and
repeat submissions. Project creation, settings, archive and restore work on phones;
saved project symbols/colors appear in navigation and project lists.

Search → optionally expand filters → inspect ordered results → open an explicit
selection. All includes archives; clearing filters keeps the query. Scope changes
reset paging without stealing focus. Failed searches offer retry, and input-method
confirmation/stale matches cannot navigate. Files retain failed rename/removal
input for retry. Export checks resume the same job. One bounded task shortcut opens
all relevant work in Task Center; closing it never cancels a task.

设置中的未保存状态在界面提交阶段同步传到外层退出保护；修改后立即按 Esc
仍须确认放弃。取消确认保留输入并恢复焦点，不依赖下一次后台 effect 或延时。

管理员「用户与访问」中的邀请按需展开创建，当前链接只显示一次，复制失败保留
链接，撤销后立即失效；历史邀请按状态服务端分页。跨用户正文搜索归入用户查看，
点击结果打开完整只读 Reader 并留审计。审计面板按操作/结果筛选，账户及时间范围
渐进展开，记录详情保留已删除账户的历史标识。账户删除完成后的文件清理单独显示
待处理数量，可从任务中心重试，不将已删除账户误报为“资料已保留”。当前合同见
[Administration Contract](ADMINISTRATION_CONTRACT.md)。

## 个人数据与备份（工作树，2026-10-02）

个人设置先选择「备份我的数据」或「恢复归档」。备份展示本人资料清单，
可选择是否包含归档内容；任务完成后下载 `.cr`，过期或文件移除后重新生成。
Root 的个人面板仍是本人范围，系统级备份另在管理员专区。

恢复按「上传 → 后台预检 → 核对清单 → 确认新增恢复」进行。预检覆盖全部
内容，清单各显示前 50 项项目/对话；缺失附件明确提示。账户偏好默认不勾选。
恢复新增项目和对话，不覆盖当前资料；同归档再次提交返回既有恢复结果。
用户可关闭或刷新，再从归档记录或 Task Center 的预检入口继续。窗口关闭
与任务取消分离；未上传文件/未确认偏好有丢弃确认，响应丢失重试保持幂等。

界面分组使用既有阅读工作台 tokens，清单按需展开，确认按钮留在当前滚动
区域底部。上传显示进度与取消，后台任务显示阶段/失败/重试；移除上传文件
只释放临时来源。离线明确提示服务器备份与恢复需要网络，保留资料库已有
离线快照能力，不新增提醒。系统流程见下。

## 系统备份与恢复（工作树，2026-10-02）

Root 的「系统」面板分为备份与恢复。备份列出整个实例的资料、账户身份和配置，
任务完成后下载，过期可重新生成。恢复先上传并后台预检，再核对内容清单与
「来源账户 → 目标账户」。Root 固定关联当前管理员；普通账户可新建，邮箱
冲突与旧 v4 来源需要明确选择。目标账户可搜索/分页，无需手写 UUID。

来源清单支持分页/只看待确认，草稿自动保存，关闭与刷新后仍在。所有页均确认且
实例为空才执行恢复；重复归档返回原结果。新建账户须重设密码。任务中心与本面板
互相进入；上传丢响应可重试，后台任务可取消；失败后可重试或修改归属重新确认。
另一窗口改过归属时要求重新核对。移除上传不会删除已恢复资料。系统归档不是
服务器灾备；离线时暂停新操作，已入队服务器任务继续。

## 修改邮箱（工作树，2026-10-01）

普通用户在“账户与安全 → 修改邮箱”输入新邮箱和当前密码，发送验证邮件；界面显示服务器保存的待验证地址及有效期，刷新后仍可查看、重新发送/更换地址或取消申请。管理员只显示部署配置说明。未配置 SMTP 时入口说明不可用，不能仅显示发送成功。

新邮箱中的链接打开确认页，预览不会消费授权；确认前旧邮箱继续有效。必须使用发起申请的同一账户：未登录时可在新标签页登录原账户，再回到确认页重新检查。页面明确显示新地址、到期时间及其他设备会话撤销影响。确认后当前设备保持登录，账户 UUID、内容和离线资料归属不变；其他设备需用新邮箱重新登录。错误/过期/已使用/错误账户链接不产生更换。

表单输入有未保存退出确认；失败保留输入，重发替换旧链接。确认响应丢失时，只有重新读取的服务器会话同时匹配原 UUID 和预览的新邮箱才显示恢复成功。链接始终放在 URL fragment，成功后清除 fragment。没有用户自助注销入口。

## Current account flows (deployed, 2026-09-02)

```text
first deployment -> operator provisions one ADMIN interactively
closed/invite/open registration -> email + strong password -> USER workspace
login -> opaque HttpOnly session -> owner-scoped Reader/Projects/Import
account security -> password/session management -> global revocation on change
ADMIN -> registration mode, invitations, user status and reset grants
```

The migrated legacy archive belongs to the single deployment administrator.
Share links remain token-scoped and Offline remains a local snapshot. These
flows are implemented, API-tested and deployed. Authenticated production
browser verification remains `NOT_VERIFIED` until the operator runs the Web
acceptance flow.

## Settings, Tasks and import completion (deployed 2026-09-02)

The global shell footer is named `Settings`. Its lightweight surface owns
appearance/reading preferences and the Offline Library shortcut. A normal user
sees only the personal management categories `Account & security`, `Data
archive` and their own `Skill management`. Import formats and the noise rule
library are system-maintenance controls and are visible only to the Root Admin;
the administrator additionally sees the Administration section. Consequential
or multi-field work opens a focused dialog; dirty password, profile or backup
options cannot be silently discarded, and closing returns through the Settings
hub to the original opener without reloading Reader content.

`Tasks` is a global shell entry for delayed owner work. The existing monitor is
reused for imports, merges, ordered batch deletion, exports and cleanup scans.
Leaving the originating page, refreshing, or switching desktop/mobile
presentation does not change task ownership. Closing the task surface only
dismisses presentation; cancellation keeps the existing per-task semantics.

Import commit has an explicit terminal state. A batch remains in the Import
surface with committed conversation/message counts, warnings and actions to
view the imported set in Library, open the first conversation, or close and
return to the opener. A single import keeps a direct `Open conversation`
action, but no import silently navigates to the first item.

## Personal/system Skill management (local migration, 2026-10-03)

Settings offers Acquisition, Maintenance and Format conversion. Users upload ZIP
Bundles or UTF-8 Markdown (automatically packaged as a same-name ZIP), replace
files and download the selected revision. Personal preferences require explicit
selection and survive system updates; disabling/deleting a preference falls back
to the available system default. Root manages system replacements independently.
No Skill content/history viewer or multi-file editor is exposed. Offline delivers
the cached built-in Acquisition Bundle; Share never includes personal Skills.
See [Context contract](CONTEXT_PACKAGE_CONTRACT.md) for limits and compatibility.

Each conversation has its own Current/Index workspace beside annotations. Users
read, edit or drop the corresponding file on a tab; dropping a `.context.zip`
updates its members without importing Raw. Updates save directly and retain the
latest three snapshots. Local drafts remain separate from saved files. Context
return is not part of ordinary transcript import or a global Context page.

## Offline Reader and Context Package (2026-08-11)

When the user opens `/library`, an existing complete offline shell is immediately readable. Resource reconciliation runs in the background and may show a non-blocking update failure; it must not disable `Update conversations`. A first-time device may show that the shell is still preparing, but online navigation remains usable.

Inside an offline conversation, `More -> Current conversation files` is available in the same location as the online Reader. The panel is read-only. A cached attachment can be viewed/downloaded through the unified Viewer; a missing original says `offline-unavailable` and does not spin forever. No server file list or management action is requested.

Offline `Export` defaults to `.context.zip`, independently of attachment inclusion; CanJSON/Markdown remain available. It uses the downloaded snapshot and optional cached Current/Index. The result offers the built-in Acquisition ZIP and copies usage instructions in the selected language, without displaying Skill contents. Package download remains available if clipboard access fails. Current/Index can be read offline; updating them requires a connection.

## Reader source workspace and merge cancellation (current)

1. Desktop Reader keeps `Edit`, `Search`, `Annotations`, `Current / Index`, `Focus`, and `More` in that order. Search/annotations/source are mutually exclusive; clicking an open source or annotation action closes it. Share, export, merge, and split remain in `More`.
2. Markdown source opens as a fixed left workspace at 1024px+, covering sidebars while retaining their state. The Reader captures its original main-column edge before opening and yields exactly enough space to keep the main column beyond the workspace. Only the right edge resizes; closing restores the original layout and reading anchor.
3. Smaller widths use a full-width panel. Light/dark CodeMirror themes reconfigure without replacing document, cursor, undo history, or unsaved content. Clean reader scrolling follows through RAF; dirty content locks its message until save/discard/return.
4. A merge copies canonical data in bounded batches. The monitor exposes `取消合并` and `正在取消`; cancellation rolls the target transaction back. Successful publication happens once and leaves sources unchanged.

以下导入与交付入口更新：2026-10-03。

## 1. 导入资料

```text
选择 JSON / JSONL / gzip 或 Markdown
-> Adaptive Import 分析、分组与格式识别 -> 显式确认导入
-> durable job -> worker canonicalize -> 发布 conversation
```

- 分析不写 canonical。使用内置或已学习格式解析；未知结构进入映射学习。具体字段与全 Family 校验遵循 [导入合同](ADAPTIVE_IMPORT_CONTRACT.md)。
- CanJSON v1/v2、受支持的导出 JSON 及 Markdown 可自动识别。任意 ZIP、CSV/TXT 不作为普通对话直接导入；格式不支持时可下载 Normalizer Skill。
- `.cr` 在设置「数据与备份」恢复；旧单对话归档有独立恢复窗口。系统归档从管理员「系统」恢复，仍要求空实例。`.context.zip` 在对应对话的 Current/Index 工作区回传，不导入或替换正文。
- preview 使用 `first_user_message_markdown` 通过系统 Markdown renderer 展示结构；commit 成功后清除旧预览并进入 Reader，队列导入轮询到 committed 后执行同一跳转。Reader 不直接读取 raw artifact。

## 2. 组织与批量管理

```text
Project/未归类/归档列表 -> checkbox/Shift/键盘/移动长按
-> 顶部上下文栏 -> 移动、归档/恢复、导出、合并或删除
```

- 桌面对话可拖入折叠 Project 或拖回未归类区。
- “批量操作”入口在选择模式中保持原位和原宽，并切换为“完成批量操作”；不会因工具栏出现而消失。
- 合并是工具栏一级动作；标题和顺序在脱离工具栏宽度约束的 focused dialog 中确认。删除继续二次确认；部分失败保留失败项选择。
- Project 与 Conversation 使用独立三点菜单；归档保留 Project 关系，取消归档后回到原位置。删除需要显示标题并二次确认，随后立即事务性硬删除，不进入 Trash，也没有 restore；当前 Reader 被归档后进入 `/archived`，被删除后跳到下一个可用对话或安全空状态。

## 附件上传、插入与导出

1. “当前对话文件”或 Markdown 源码编辑器创建上传 session，文件流式写入暂存区并返回 MIME、hash、大小和扫描状态。
2. 当前部署扫描器关闭时显示 `scanner_disabled`；策略允许继续使用不代表文件安全。
3. 文件抽屉提交后成为当前对话 Attachment，可保持未放置，也可从编辑器在光标处或消息末尾插入。
4. 上传完成后先显式提升为当前对话 Attachment；保存消息时以 base version 做并发校验，并在同一事务创建 MessageVersion、Occurrence、RenderBlock。搜索、TOC、统计和摘要在提交后异步重建。删除正文引用不会删除对话级 Attachment。
5. 对话导出可选 Context Package、CanJSON 或 Markdown；Context 始终生成 `.context.zip`，附件独立选择。系统 `.cr v5` 从管理员「系统」备份和恢复，服务端只允许恢复到空实例；个人与旧单对话归档从设置「数据与备份」恢复。
- 源码模式可把真实文件拖到具体文本位置，或粘贴剪贴板图片/文件；文件选择、拖放和粘贴共用上传 session、逐文件进度、取消与重试。上传中/失败项必须处理后才能保存。
- 拖到 fenced code block 时先选择放到代码块之后、仍按普通文本插入或取消；拖到现有 Markdown 链接内部时移到完整链接之后。多文件保持原始顺序并分别生成 occurrence。
- 关闭尚未保存的源码时，已完成上传可保留为“当前对话文件”的未放置附件，也可删除；正在上传的项会取消。源码中手动删除附件语法只影响当前新版本 occurrence，不删除对话级 Attachment。
- 桌面“当前对话文件”默认在 Reader 右上安全区域打开为注释式浮窗；整个表头可拖动，边缘可缩放，位置/尺寸可复位并持久化。表头使用抓手光标和附件专属图标；移动端使用全宽 sheet。该入口管理 Attachment，源码编辑器继续负责 occurrence 编排。
- 拖拽使用 Pointer/Touch/Keyboard sensors：Project 容器始终按自定义顺序展示，新建 Project 追加到项目区末尾；Project 内和未分类 Conversation 继续使用独立的对话排序偏好。项目排序槽、Project 对话接收区、conversation row/insert slot 与未分类标题行是不同 drop target；打开的 Project 右侧工作区也是明确的当前项目接收区。整行是唯一 dnd-kit 拖拽表面，预览保持源行尺寸且不使用浏览器原生链接拖影；普通点击仍导航。移动成功后保留当前 URL 和滚动上下文。跨项目移动只更新单一关系，移回未归类不删除会话，失败按 revision 同时回滚项目列表、项目对话和侧栏 optimistic cache。侧栏查询刷新保留上一份数据，避免拖拽期间卸载目标；菜单和键盘移动仍是非拖拽替代路径。

## 3. 阅读长对话并恢复位置

```text
conversation + reading position 并行加载
-> 读取包含目标 message 的完整 reader-turn
-> 原子挂载 -> 对齐 120px 阅读线 -> 预取相邻轮次
-> 稳定 1 秒后保存 message/block/offset
```

- 边缘切换捕获真实锚点，轮次完成水合后 prepend/replace，再补偿位置。
- 刷新直接从保存轮次恢复，不先挂载普通 30 条窗口。
- 用户 wheel/touch/pointer/阅读键输入可取消程序导航。

## 4. 搜索、TOC 或批注定位

```text
选择结果 -> 取消旧导航 -> 加载目标完整轮次
-> quote/offset/block/message 解析 -> 等待媒体/布局稳定
-> 复校 -> 继续预取
```

全局搜索、当前对话搜索、对话索引、章节 TOC、最近位置和批注复用同一事务；失败时保留当前正文并允许重试。定位成功后只在精确文字首个可见行显示约 720ms 的短时脉冲；只能退化到 block/message 时显示左侧短标记，不再给整条消息持续填色。搜索自身的精确命中高亮保持独立。

### 手动更新目录

Owner Reader 右上角“更多”提供“更新目录”：

```text
更新目录
  ├─ 对话目录（可独立选择）
  └─ 章节目录（可独立选择）
       ├─ 当前对话（默认）
       └─ 全部对话
```

至少选择一项才能提交。任务进入统一后台队列并显示排队、进度、完成或失败状态；失败不替换当前目录并保留重试入口。完成后只刷新 dialogue-index/TOC 查询缓存，不重新获取整条 Reader、不改变阅读位置，也不提升 Conversation revision。对话目录直接来自当前 canonical 消息；章节目录从 current MessageVersion 的 heading RenderBlock 重建。Share 与 Offline Reader 保持只读，不显示该入口。

## 5. 编辑、版本与会话变换

- 消息信息栏在正文上方提供收藏、选择、源码编辑和版本控件；桌面 hover/键盘聚焦显示，移动端进入底部操作菜单，不覆盖 Markdown 标题。
- 桌面顶栏常驻顺序为“编辑、搜索、批注、专注、更多”，分享、导出、合并和拆分进入“更多”；移动端常驻“导航、编辑、更多”，搜索、批注和专注位于更多面板首组。
- 从长消息当前阅读块打开非模态 CodeMirror 浮动源码工作区后，原正文保持挂载且高度不变。桌面浮窗可拖动、四边缩放、复位并持久化尺寸；移动端使用顶栏下方全宽面板。
- 真实正文滚动在同消息内只调整源码位置；进入下一消息时，干净编辑器自动切换，脏编辑器锁定原消息并显示返回原文、保存后切换和放弃后切换。搜索定位、位置恢复和 Reader 导航等程序化滚动不触发切换；CodeMirror 的方向键、Home/End、空格和编辑输入也不登记为 Reader 滚动意图。源码滚动不反向推动正文，只能显式“在正文中定位”。
- 保存后只局部替换当前消息并重建 blocks/TOC/search/摘要/offline revision，浮窗保持打开；保存前后的真实 DOM 锚点补偿阅读位置。切换其他工作区或专注模式前必须先处理未保存修改。
- 默认保存创建新 MessageVersion；当前为第二版或更高时可显式覆盖当前版本。第一版永久不可覆盖/删除，未保存关闭提供保存、放弃和继续编辑。
- 左右箭头立即持久化当前单消息版本，刷新和换设备后继续显示；删除当前历史版本时自动回退到较早的最近可用版本，删除/覆盖均保留不含被删正文的审计事件。
- Reader 不显示按字符拆分单消息入口；“拆分对话”工作区先展示完整轻量时间线和结果预览，再执行连续区间、边界双份或离散消息复制。三种模式均创建新 conversation，来源保持不变。

## 6. 批注与精选笔记

```text
选中文字/书签消息 -> 类型与颜色 -> 保存 annotation
-> 工作区筛选、定位、批量样式/删除/加入精选
-> 连续阅读或逐条回顾
```

- stale anchor 按 block/message 降级并提示。
- 精选笔记可插入 Markdown、引用批注和排序；移除引用不删除原批注。
- 离线操作进入 outbox，联网后幂等同步；revision 冲突保留副本。

## 7. Share 与导出

- Share 选择 full/selected、expiry、private flags 和 allow export；创建后可复制、更新或撤销。
- 设置中的「我的分享」集中查询本人的有效、过期和已撤销链接，支持对话/分享标题搜索、仅此对话筛选和服务端分页。跨页保留最多 100 项选择；“选择本页”只覆盖当前页可撤销项，筛选变化清空选择。撤销先确认，逐项显示结果，失败项保留并可重试。管理员关闭分享后仍可查询和撤销，公共 Share 的原有策略检查不变。
- 分享编辑在独立详情中调整标题、说明、有效期、密码、整个对话/所选消息和私人内容标记；消息选择同样分页保留。应用前确认访问范围，失败保留输入，离开未保存详情需确认。成功后沿用原链接；移除密码使用现有密码版本和解锁会话失效机制。返回列表恢复焦点与滚动位置；打开来源关闭设置及手机侧栏。分享管理需要联网，离线显示明确状态，不加入离线资料包。
- 分享列表默认显示状态、来源、访问摘要和“复制链接／编辑分享”；打开分享、来源定位、仅此对话和撤销收纳进“更多”。菜单支持方向键、Home/End、Escape 返回触发器；Escape 不穿透关闭设置。进入“批量管理”后才显示复选框、当前页选择与固定底部撤销栏，结束选择会清空本次选择。状态筛选采用带明确选中态的按钮组；空结果提供清除筛选入口。
- 编辑详情按“分享内容／访问权限／链接外观”逐项展开，默认仅展开内容，每组显示当前选择摘要。附加内容默认收起；批注、笔记说明其私人性质。访问方式用“持有链接的人／需要密码”及简短说明呈现，已有密码默认保留，可显式更换；有效期支持永久、从现在起 7/30 天或自定义，未修改的到期时间保留精度。固定底部显示未保存状态和保存操作；错误会展开并聚焦相应字段，修改输入后清除旧错误。手机纵向选择项与桌面并排选择项沿用同一行为。
- 访客只读取 `/api/shared/{token}/*` 授权范围。
- Markdown v2/CanJSON v2 可流式导出；`.cr` 通过后台 job 生成临时 artifact。CanJSON v1 只保留 Legacy 兼容。
- `format=context_package` 通过同一后台 job 生成 `<title>.context.zip`；包含 manifest、canonical JSONL、可选附件对象及已保存的 Current/Index。附件独立选择；完整对话可携带接续文件，部分阅读范围排除它们。Raw 包含批注定位必需的旧版本，完整应用历史和恢复关系仍由 `.cr` 承担。见 [Context 合同](CONTEXT_PACKAGE_CONTRACT.md)。
- `.crbundle` 已从产品导入流程移除；附件通过对话内普通上传或 `.cr` 完整归档恢复进入系统。图片、文本、Markdown、JSON、CSV、代码、原生媒体和 PDF 可在线预览，Office/ZIP 下载降级，Share 再做 token 与消息范围校验。当前不执行附件内容秘密扫描；未扫描状态会保留到 Reader、Share 和导出。
- 对话导出一级选项为 Context Package / CanJSON / Markdown，附件独立选择；二级选项可包含简介、批注、笔记和来源引用，ZIP manifest 记录实际选择。
- 当前对话导出只投影 active Attachment；从文件面板 detach 的业务文件不会再次出现在当前 `.canjsonl`、`.context.zip`、`.md` 或 Markdown ZIP 中，历史引用只在系统 `.cr v4` 中保留。隐藏文件名、Unicode、空格、大小写和复合扩展名在可移植 ZIP 中保持。

## 7.1 Markdown 任务清单

1. 在线 Owner Reader 将用户或助手正文中的 GFM `- [ ]` / `- [x]` 渲染为可操作 checkbox；代码围栏内的示例不成为任务。
2. 点击立即给出 optimistic 状态并提交 `message_id + base_version_id + task_key + checked`。当前 v1 创建 v2，当前 v2+ 覆盖该版本；操作不影响后续消息。
3. API 409 或 task key 过期时回滚 checkbox 并提示重新加载，Reader 不刷新整场对话。
4. Share、Offline Reader 和附件 Markdown 预览始终只读，避免访客或派生内容写回 canonical 消息。

## 8. 离线资料库

本地未发布更新（2026-10-08）：任务中心的离线任务进入同一个“离线与同步”面板，
定位本机下载记录及所在失败页；没有记录时，用户明确点击“下载到此设备”。
打开面板不会自动重试。服务器生成完成与本机下载完成分别表示，取消服务器生成
不冒充本地取消。旧任务缺少范围时保留资料库手动选择入口。当前 33 项 API 专项
通过，浏览器操作验收待完成；详见[离线恢复合同](PWA_OFFLINE_RESILIENCE_CONTRACT.md#task-center-recovery--2026-10-08-worktree-not-deployed)。

```text
首次在线打开 /library -> staging/校验/激活 PWA 壳
-> catalog 与本地 revisions 比对 -> 请求 v3 增量包（none/small/all attachments）
-> 校验并在 Dexie transaction 中导入 -> 离线阅读/搜索
```

- 无变化时显示“离线资料已是最新”；后续 revision 变化可再次自动更新。
- staging、下载或导入失败时保留旧 active shell 和旧数据。
- canonical 管理离线禁用；批注/笔记可离线编辑并同步。
- Dexie v2 保存附件 metadata；清洁小/全部附件保存到 Cache Storage，移除本地会话会同时清理对应 Blob。

## 9. 移动端

- 首页保留继续阅读卡片和 `/recent` 入口；桌面不显示它们。
- Reader 顶栏为返回、标题、导航和更多；工具使用 Bottom Sheet。
- 移动端优先阅读与单项管理，消息操作菜单可打开 Markdown 源码编辑与版本控件；复杂批量和 Project 管理以桌面为主。

注册、登录、发送消息、停止生成、选择模型、会员购买和管理员审核不属于当前流程。
# 2026-08-09 Addendum: Message Organization

1. Select New Conversation, enter a title, project (or unclassified), User text and Assistant text, then submit. Empty bodies are rejected before the request and by the API.
2. Use the plus action between messages to insert before or after the anchor. Single insertion defaults to the opposite role of the adjacent message; pair insertion always creates User then Assistant.
3. Delete uses a confirmation, hides the message optimistically, and offers a short undo. It is a soft delete and does not create a user-visible Trash. Delete/restore responses carry the post-commit conversation revision; restore is idempotent and the undo surface remains actionable on failure. A stale revision returns 409 and leaves the reader unchanged.
4. Opening DOCX/ODT, XLSX/ODS, PPTX/ODP or ZIP uses the existing unified Viewer Shell and lazy browser Worker. The body shows bounded semantic content; parser limits or unsupported legacy formats fall back to an original-file download.

## 2026-08-11 Lifecycle closure

1. Creating a conversation seeds the canonical response and revision before navigation completes. Initial Notebook/recent bootstrap reads do not advance Conversation revision, so the first insert, edit or delete can run without a refresh.
2. Delete is complete when the message disappears and the server returns the new revision. Undo is complete only after restore succeeds, the Reader reconciles the returned canonical message/revision, and refresh still contains the message.
3. Undo 409/500/network failure keeps a localized live error and a retry action. It never silently closes or claims the message was restored.
4. A genuine second-tab 409 preserves the source draft and does not overwrite the other tab. `加载最新状态` fetches the current Conversation revision and MessageVersion base without replacing the editor draft; the user reviews and saves again against that explicit latest base.
5. An active Attachment with zero current-version occurrences remains visible in Files Panel `全部/未引用`. Occurrence removal with keep does not detach the Attachment, and multiple Attachment business identities may share one AssetObject.
6. Files navigation carries Attachment/occurrence/version/block identity. If the exact reference is stale, Reader preserves the current body and exposes exact retry, message-level fallback, and a truthful Files-index refresh that refetches current occurrences; refresh does not claim to repair canonical attachment data.
# Archived project deletion (2026-08-12)

Project deletion is available only from the Archived page. The user archives a project first, then may restore it or permanently delete the project container. A destructive confirmation explains that the project itself cannot be restored but all conversations and messages are kept and return to Unclassified. Batch deletion uses the same contract and retains failed rows as selected.

The API rejects default or active project deletion. On accepted deletion it atomically moves each `ProjectConversation` to the internal default project, clears project pin state, updates recent placement and the conversation offline revision, records a placement event, then deletes only the archived Project row. Conversation, message, attachment and export lifecycle is unchanged.


## Administrator account inspection and deletion (current)

Users & access starts with the searchable, paginated account directory. Open an
account for access actions, password assistance and opt-in content inspection.
Conversation links open the complete-turn read-only Reader in a separate tab,
retaining the directory position. Search navigates to a real message; attachment
viewing/download uses audited Root routes. Delete opens a separate impact page;
confirm locks the account and queues work. Failed tasks retain canonical data
and can be retried from the account or Task Center. Successful completion removes
the row. See [Administration](ADMINISTRATION_CONTRACT.md).
