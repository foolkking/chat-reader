# Chat Reader Product Information Architecture Audit

## 1. Audit Scope & Evidence Base

**Audit type:** Round 1 broad Product Information Architecture / UX audit. This is a discovery and evidence report, not a redesign or implementation plan.

**Audited product:** Chat Reader, the single-owner personal conversation archive and reference workspace.

**Date / repository authority:** 2026-08-25; local `master`, commit `245fc4c` (`fix: process conversation deletion in background`). The existing dirty worktree was preserved and not modified. The current project state records production at the latest deployed runtime with Alembic `20260823_0028 (head)`; a read-only check during this audit returned `200` for both the public root and `/api/health`.

**Primary audience:** one owner using a dense desktop browser as the main environment, with responsive mobile access for continuation, quick review, and maintenance. The product is an archive/reference tool rather than a live chat client; long conversations, imported material, source editing, attachments, projects, and recovery all matter.

**In scope:** authenticated shell, Library/home, Projects and Unclassified, Reader, source editor, search, attachments/viewers, annotations/notebook, Import and Adaptive Import, Share, Offline/PWA library, settings/maintenance, background tasks, archive lifecycle, and desktop/mobile semantic consistency.

**Out of scope:** visual polish, palette/spacing, pure accessibility conformance, backend/query performance, new feature ideation, multi-user expansion, and code quality unless they directly alter information ownership, findability, task completion, interruption, or recovery.

**Evidence base:**

- **Level A / Observed:** supplied production screenshots of Library, Project, Reader, source editor cleanup, formula rendering, task monitor, and mobile/desktop variants; persistent repository screenshots under `docs/execution/screenshots/`.
- **Level B / Strong:** current routes, components, strings, tests, `PROJECT_STATE.md`, `docs/system/USER_FLOWS.md`, `docs/system/FRONTEND_ARCHITECTURE.md`, `docs/system/FEATURE_INVENTORY.md`, and `.interface-design/system.md`.
- **Level C / Historical:** prior release and deployment notes, used only to explain current boundaries where current code confirms them.
- **Not available in this turn:** an authenticated, controlled production browser walkthrough with disposable data, user analytics, and real task-frequency data. Findings that need those are marked `Hypothesis` or have an explicit evidence gap.

No accessibility conformance claim is made. This is an IA/task-flow sample grounded in current code and screenshots.

## 2. Executive Summary

The current information architecture is broadly healthy: users can understand the core model as Projects containing Conversations, with Reader as the main work surface and a separate public Share and offline boundary. The strongest decisions are the progressive Import path (known formats stay direct; unknown structures open mapping only when needed), the Reader's separation of primary and secondary actions, and the distinction between current-conversation search and global search. No Blocker or High-severity IA defect is supported by the evidence collected in this round. The main structural friction is that global settings, backup/restore, learned import formats, and account security are all hidden behind a control labelled “Appearance & language” and then a transient preferences popover; this makes rare but consequential maintenance work depend on recall and an unsuitable surface. Background work is visible, but the task monitor is placed under the Import/Search area even when the task is merge, delete, export, or noise review, so task ownership and re-entry are weaker than the underlying job system. Batch import also reports success and opens only the first imported conversation, which can make the completion state feel like a single-object result rather than a completed multi-object operation; this is a Round 2 candidate, not a confirmed failure without an authenticated batch observation. The word “archive” is understandable in context but is used for both conversation lifecycle and `.cr` system packages, leaving a low-severity terminology debt. Round 2 should concentrate on one maintenance/settings surface contract, one global task-center contract, and the batch-import completion/return path; the Project/Conversation hierarchy, Reader action hierarchy, contextual shortcuts, and responsive object model should be left alone unless new evidence contradicts them.

## 3. Product Mental Model

The stable user-facing mental model supported by the current product is:

1. Chat Reader is a personal archive and reading/reference workspace for conversations, not a second chat client.
2. A **Conversation** is the primary managed and read object; a **Project** is an optional organization container, while **Unclassified** is the visible default container for conversations without a project.
3. **Reader** is the canonical place to read, search within, edit source, inspect files, annotate, share, and use reading/navigation tools for one conversation.
4. Conversation content has durable history: messages have versions, while rendered blocks, headings, search anchors, and attachment occurrences are derived navigation/readability structures.
5. Import, Share, Offline, and `.cr` archive restore are boundary workflows around the same canonical conversation model, not separate products.
6. Background tasks represent delayed work (import, export, merge, deletion, cleanup review) and should be understood as work continuing outside the current surface.
7. Learned Import Profiles explain unfamiliar JSON/Markdown structures once and then turn them into normal import formats; users should not need to understand the analyzer's internal Family/Revision terms during routine imports.

## 4. Information Object Map

| Object | User meaning and relationship | Primary owner surface | Create / find / modify / remove | IA notes |
|---|---|---|---|---|
| Project | A named organization container for Conversations; one Conversation belongs to at most one Project or Unclassified. | Sidebar and Project page | Create in project controls; find in sidebar/Projects; rename/reorder/move from project/sidebar menus; remove via project controls. | Clear container concept; drag/drop and menu movement are contextual alternatives. |
| Unclassified | The default visible container for Conversations without a Project. | Sidebar and home/list | Created implicitly by removing project relation; found in sidebar; moved through drag/menu. | A useful explicit container, not merely an empty state. |
| Conversation | The primary personal archive/read unit. | Library/list and Reader | Imported/created; found by Projects, Unclassified, Recent, search, links; edited, archived, exported, shared, deleted. | Core object is consistently named and remains the center of navigation. |
| Archived Conversation | A lifecycle state of a Conversation, not a different content type. | Archived page | Archive/unarchive from conversation actions; find in Archived; restore/unarchive or delete. | Distinct from `.cr` package only by surrounding wording; see IA-R1-004. |
| Message / MessageVersion | A turn and its immutable source/history authority. | Reader, source editor, version/history controls | Created by import/edit/merge/split; found in Reader/search; modified by creating a new version; old versions remain history. | Versioning is mostly an implementation detail, correctly kept out of routine navigation. |
| RenderBlock / Heading | Derived reading and navigation units for long content. | Reader index/TOC and source-to-reader locate | Derived on render/version; found by Reader navigation; regenerated with content versions. | Supports long-document orientation without replacing Message as the ownership object. |
| Attachment / AssetObject / occurrence | A file and its physical identity/placements in conversation content. | Files panel, Viewer, Reader/source editor | Uploaded/imported; found through Files, message links, viewer; downloaded/managed through scoped file actions. | Physical dedupe identity is not exposed as a competing user object. |
| Annotation / Notebook (“精选笔记”) | User-created reference marks and extracted notes attached to conversation content. | Reader annotation workspace and notebook | Created in Reader; found in annotation surface; edited/removed there. | Contextual placement is appropriate; it does not compete with conversation navigation. |
| Share | A public-by-link capability scoped to one Conversation, optionally protected by an independent password. | Reader More menu and Share surface | Created/changed/revoked from Reader; found by link or owner Share controls; revoked from same context. | Public Share has a deliberately separate shell and cannot become owner navigation. |
| Offline package / Offline Library | A local reading copy and its package lifecycle, distinct from server archive. | `/library` PWA/offline shell | Prepared from Reader or preferences; found in Offline Library; refreshed/read locally. | Separate route is a meaningful boundary, not a duplicate online Library. |
| ImportSession / InputGroup / StructureFamily | Temporary import analysis objects used to collect, group, and resolve source files. | Import dialog and adaptive overlay | Created by Import; found only during an active session; resolved/cancelled/completed. | Correctly progressive: hidden in routine known-format imports. |
| ImportProfile / Revision | A reusable explanation of a learned source format. | Import Format settings and mapping workspace | Built-in or learned; found in low-frequency settings; renamed/disabled/repaired/deleted; revisions preserve history. | Ownership is correct conceptually but discoverability is currently weak (IA-R1-001). |
| BackgroundTask / CleanupScan | Delayed work and review candidates with progress, retry/cancel, and completion. | Task monitor and review dialog | Created by import/export/merge/delete/cleanup; found in task monitor; completed/cancelled/ignored/reviewed. | Object is global, but its current surface placement is import-centric (IA-R1-002). |
| `.cr` system archive | A complete Chat Reader backup/restore package, including projects, versions, files, notes, and related data. | Preferences backup panel + Import dialog | Exported in data/backup settings; restored through Import; not a Conversation lifecycle state. | The package boundary is explicit in helper text but shares the word “archive” with lifecycle state. |

## 5. Surface Ownership Matrix

| Surface | Primary job / context owned | Persistence and entry | Exit / return | Desktop / mobile semantic notes | Assessment |
|---|---|---|---|---|---|
| App shell + Project Sidebar | Global orientation, Projects, Unclassified, Archived, Import, quick search, preferences. | Persistent desktop; drawer on mobile. | Navigate to destination; mobile closes drawer. | Same object hierarchy; mobile adds Recent as a direct continuation shortcut. | Strong global orientation. |
| Library / home list | Browse, sort, select, and continue conversations. | Route-level page; entered from logo/home, project context, or mobile Recent. | Open Conversation or return to shell. | Desktop list and mobile Recent differ in layout but preserve “find/continue conversation.” | Clear overview surface. |
| Project page | Browse and organize Conversations in one Project. | Persistent route; sidebar and direct links. | Open Reader, move conversation, return via sidebar/back. | Desktop drag/drop; mobile menu/picker alternative. | Contextual ownership is clear. |
| Reader | Read one Conversation and own message-level work. | Route-level persistent workspace. | Back/sidebar/search return; overlays close to opener. | Desktop index/TOC/panels; mobile sheets/drawers. | Strong primary workspace. |
| Reader toolbar / More menu | High-frequency edit/search/annotation/focus actions plus lower-frequency share/export/files/merge/split. | Instant contextual surface; opened from Reader. | Close/escape restores Reader focus. | Mobile condenses into toolbar/sheet. | Good progressive disclosure; do not flatten. |
| Source editor workspace | Edit canonical Markdown/source, upload, preview, save/version. | Floating/docked workspace entered from Reader. | Save/close returns to Reader; source-to-reader locate preserves context. | Full-width mobile editor keeps same job. | Appropriate ownership; selection/cleanup is contextual. |
| Files panel / Viewer | Inspect attachment inventory or render one file. | Contextual drawer/viewer from Reader/source. | Close/Esc restores opener; download is scoped. | Sheets on mobile. | Clear separation between inventory and rendered artifact. |
| Annotation / Notebook workspace | Review and manage annotations/notes. | Contextual floating/docked workspace. | Close returns to Reader/selection. | Mobile sheet keeps same conceptual scope. | Specialized but coherent. |
| Import dialog / Adaptive overlay | Select source type, analyze, resolve unknown formats, preview, commit direct import. | Global modal from sidebar/list; overlay expands only for complex states. | Cancel/back retains or clears session according to explicit state; commit leads to imported result. | Modal/sheet behavior follows responsive shell. | Progressive disclosure is a major strength. |
| Global Search page | Search across titles/messages with filters and result navigation. | Sidebar search or direct `/search`. | Result opens Reader; browser back is the apparent return path. | Same conceptual search; mobile layout adapts. | Scope is distinct from Reader local search. |
| Preferences popover | Theme/language, offline link, reader preferences, backup, import formats, account security. | Footer button; transient popover, max-height scroll. | Outside/Esc/X closes. | Same popover concept; mobile uses same trigger in drawer. | Surface is overloaded and too transient for maintenance/security (IA-R1-001). |
| Background task monitor | Show delayed work progress, completion, retry/cancel, cleanup review. | Immediately below sidebar search/import on desktop; fixed card on mobile. | Task-specific action or dismissal. | Placement changes substantially; task identity does not. | Global object lacks a stable global owner (IA-R1-002). |
| Public Share surface | Read one shared Conversation without owner shell; optional share password. | Direct `/share/{token}`. | Leave link/close browser; no owner return assumption. | Responsive public reader. | Correctly isolated capability surface. |
| Offline Library / Reader | Browse and read local packages when online service is unavailable or intentionally offline. | `/library` PWA shell; linked from preferences and contextual Reader preparation. | Back online link or package navigation. | Separate mobile-capable shell. | Boundary is meaningful, not an accidental duplicate. |
| Toast / status / alert | Confirm save, move, import, task completion, errors, and recovery. | Transient or attached to surface. | Auto-dismiss or explicit retry/open. | Same semantics; some task cards become mobile-fixed. | Status exists; ownership consistency needs Round 2 for background work. |

## 6. Navigation Map

### Global authenticated map

```text
App shell
├── Home / all conversations
│   ├── Conversation → Reader
│   └── Recent (direct mobile route; continuation view)
├── Archived → archived Conversation list → Reader / restore / delete
├── Projects
│   └── Project → Project conversation list → Reader
├── Unclassified → Conversation list → Reader
├── Quick search → /search → result → Reader
├── Import data
│   ├── JSON / Markdown → known READY → direct import
│   ├── JSON / Markdown → unknown/drift/ambiguous → Adaptive overlay → direct import
│   └── .cr archive → independent restore preview → restore
└── Preferences popover
    ├── theme / language / reader preferences
    ├── Offline Library → /library
    ├── data and backup (.cr export)
    ├── import formats (built-in / learned profiles)
    └── account security (password / logout)
```

### Reader contextual map

```text
Reader
├── primary: source edit · current-conversation search · annotations · focus
├── More: share · export · files · TOC refresh · merge · split
├── left conversation index / right heading TOC
├── source editor → save/version → Reader
├── files → viewer/download → Reader
├── annotation workspace → Reader
└── background task / cleanup review → task monitor or review dialog → Reader
```

### Boundary map

```text
/share/[token]  = public-by-link, share-scoped, no owner shell
/library        = offline/PWA local library boundary
/login          = owner authentication boundary
```

### Trunk-test sweep

| Location | What the user can infer | Orientation assessment |
|---|---|---|
| Home/Library | “I am browsing my conversations; I can search, sort, open, import, or organize.” | Pass from screenshots and shell code. |
| Project | “These are conversations in this named project; I can move/open them.” | Pass; current-project drag target reinforces ownership. |
| Reader | “I am reading this conversation; the toolbar acts on this conversation.” | Pass; title/count, index, TOC, and toolbar establish context. |
| Search | “These are global results, not only this conversation.” | Strong from route and filter model; return-state preservation still needs live confirmation. |
| Source editor | “I am editing the source of the current message.” | Pass; opener and source-position locate are explicit. |
| Files/Viewer | “I am inspecting an attachment related to this conversation.” | Pass; contextual drawer/viewer ownership is clear. |
| Settings/maintenance | “This is appearance/language” is the visible label, but the panel also owns backup, import profiles, password, and logout. | Fail on ownership label/disclosure; IA-R1-001. |
| Share/Offline | “This is a scoped public or local reading boundary.” | Pass conceptually; separate shells make the boundary explicit. |

### Navigation depth notes

Routine reading is shallow: shell → Project/Unclassified or search → Reader. Contextual Reader tasks are one menu/drawer deep. Unknown import is intentionally deeper because it is an exception path. Maintenance/security is deeper than its risk warrants: footer control → “Appearance & language” popover → More settings/section → target action.

## 7. User Job Map

| Job | Trigger / starting context | Primary entry and surface | Completion evidence | Return / recovery | Frequency |
|---|---|---|---|---|---|
| Continue reading a known Conversation | User opens app or remembers a title | Library, Project, Unclassified, Recent, or search → Reader | Reader renders target Conversation and position | Sidebar/back; stored reading anchor | Daily |
| Find a passage in current Conversation | In Reader, remembers a term | Reader search | Exact match highlighted; previous/next and return-to-search state | Search context returns to result list | Daily/weekly |
| Find a Conversation globally | Knows title/content but not container | Sidebar quick search → `/search` | Result opens correct Reader | Browser/sidebar back; filter preservation needs live check | Weekly |
| Edit source safely | Sees a correction or wants to clean Markdown | Reader edit → source workspace | Saved version/updated Reader content | Close/save returns to same Reader context | Weekly |
| Inspect or download a file | Message has attachment | Reader More → Files/viewer/download | File opens or download begins with status | Close/Esc returns to Reader | Occasional |
| Capture and review an annotation | Wants a reference note | Reader annotation action | Annotation appears in workspace/notebook | Close restores Reader/selection | Occasional |
| Organize Conversations | New import or backlog needs grouping | Sidebar/project page, drag or menu | Project relation/list updates and toast/status | Current Project/Reader remains open | Weekly |
| Import known data | Has supported JSON/Markdown or `.cr` | Sidebar Import data | READY/restore preview then committed count/status | Imported result/list; current code opens first imported conversation | Occasional |
| Teach a new source format | First unknown JSON/Markdown structure | Import → Adaptive mapping overlay | Profile revision saved, full-family validation, direct import | Session resume/cancel via dialog/session state | Rare but high value |
| Export or create public Share | Wants to move/read elsewhere | Reader More → export/share | Download or scoped Share URL/status | Return to Reader; public link leaves owner shell | Occasional |
| Prepare/read offline | Connectivity or travel concern | Reader offline preparation or Preferences → Offline Library | Package ready; local library opens | Back online or package navigation | Occasional |
| Manage lifecycle | Wants archive, restore, merge, split, delete | Conversation menu, Archived page, Reader More | Status/task completion and list update | Task monitor/retry; history remains where applicable | Occasional/maintenance |
| Run content cleanup | Sees source noise or wants a batch review | Source editor cleanup or rule library scan | Review candidates, user decisions, applied MessageVersions | Scan monitor/review; version history is recovery | Occasional |
| Backup/restore system | Maintenance or disaster recovery | Preferences data/backup + Import `.cr` | Archive downloaded or restore committed | Task status / import result | Rare/high consequence |
| Recover account/settings | Password/security issue | Preferences account security | Password changed or logout completes | Login/reset operator path | Rare/high consequence |

## 8. Entry Point Matrix

| Job | Primary entry | Secondary entry | Contextual entry | Mobile entry | Notes |
|---|---|---|---|---|---|
| Open Conversation | Library / Project / Unclassified | Global search, Recent | Share/Offline link | Recent and sidebar drawer | Multiple entries reflect different recall contexts; not competing primaries. |
| Current search | Reader search icon | — | Reader keyboard/search context | Reader search sheet | Correctly scoped; do not merge with global search. |
| Global search | Sidebar search | `/search` direct route | Search from shell | Sidebar drawer | Return-state persistence is unverified. |
| Source edit | Reader edit | — | Source attachment/upload actions | Full-width editor | Clear ownership. |
| Files/viewer | Reader More → Files | Attachment link in message | Source editor attachment action | Files sheet/viewer | Contextual shortcuts are useful. |
| Annotation | Reader annotation | Notebook/annotation workspace | Selection-based annotation | Annotation sheet | Contextual entry avoids global clutter. |
| Organize/move | Project/sidebar drag | Conversation menu | Current Project drop target | Menu/picker; drag alternative not required | Good desktop/mobile semantic parity. |
| Import | Sidebar Import data | Empty/list import action | Settings restore guidance | Sidebar drawer/import dialog | One clear global entry. |
| Learned import formats | Preferences → Appearance & language → More settings → Import formats | Adaptive mapping repair link | Import drift action | Same drawer/popover | Findability cost and surface mismatch; IA-R1-001. |
| Backup/restore | Preferences → Appearance & language → More settings → Data and backup; restore through Import | Import `.cr` | — | Same preferences flow | Low frequency but high consequence; IA-R1-001. |
| Password/logout | Preferences → Appearance & language → More settings → Account security | — | Auth boundary/login | Same drawer/popover | Security action shares a transient preference surface; IA-R1-001. |
| Background task recovery | Task cards under sidebar Import/Search area | Import task monitor | Cleanup review link | Fixed bottom task card | Completion is visible, but global task ownership is ambiguous; IA-R1-002. |
| Public Share | Reader More → Share | Direct `/share/[token]` | Shared resource links | Responsive public surface | Correct separate capability surface. |
| Offline library | Preferences offline link | Reader prepare-offline action | `/library` direct | Library route | Two entries are complementary: global library vs current conversation preparation. |

## 9. Terminology Table

| Product term | Meaning | Where shown | Alternate / collision | Risk assessment |
|---|---|---|---|---|
| 对话 / Conversation | Primary archive/read unit | Lists, Reader, search | None material | Stable and clear. |
| 项目 / Project | Conversation organization container | Sidebar, Project page | None material | Stable and clear. |
| 未分类 / Unclassified | No-project container | Sidebar/list | “Default” is not shown to users | Clear enough; explicit container is helpful. |
| 已归档 / Archived | Conversation lifecycle state | Sidebar, archived page, actions | “归档” also appears in `.cr 归档` | Low-level collision; surrounding copy usually disambiguates. |
| `.cr 归档` / system archive | Complete backup/restore package | Import dialog, Data and backup | Same root word as lifecycle archive | IA-R1-004, Low consistency debt; do not confuse with deletion or unarchive. |
| 导入 / Import | Bring source or archive into Chat Reader | Sidebar/dialog/settings | Restore is used for `.cr` action | Mostly clear because `.cr` has its own helper text. |
| 恢复 / Restore | Reconstitute `.cr` data | Preview/action | Unarchive is lifecycle restore | Could be more explicit at the object level; low priority. |
| 导入格式 / Import format | Persistent built-in/learned explanation of source shape | Settings/mapping | Internal Profile/Revision/Family terms | User-facing setting is good; internal terms should remain progressive. |
| 清理噪声 / Content cleanup | Review/delete selected noise occurrences | Source editor/task review | Background scan/review | Concept belongs to source/content context; task monitor placement is separate issue. |
| 分享 / Share | Public scoped capability | Reader/share surface | Export is adjacent but different | Clear after contract change. |
| 离线资料库 / Offline Library | Local reading copy | Preferences/PWA | Offline route/connection error | Boundary is understandable. |
| 外观与语言 / Appearance & language | Visible footer preferences trigger | Sidebar popover | Actually contains appearance, offline, backup, imports, security | Main terminology/ownership defect: IA-R1-001. |

## 10. Desktop / Mobile Semantic Notes

The responsive model is conceptually consistent even where the layout is not identical:

- Desktop keeps the Project Sidebar persistent; mobile opens the same hierarchy as a drawer. Mobile adds a `/recent` continuation route, which is a useful thumb-friendly shortcut rather than a competing object model.
- Desktop Reader exposes index/TOC and utility workspaces around the content; mobile turns those into sheets/drawers while retaining Reader as the owner of the Conversation.
- Desktop project organization supports drag/drop; mobile retains menu/picker movement. This is a valid interaction adaptation because the job and result are the same and a visible non-gesture path exists.
- Source editing, file viewing, Share, and annotation retain the same conceptual scope on mobile. No evidence shows a mobile-only alternate data model.
- Offline Library is a separate shell on both form factors, preserving the online/offline boundary.
- Background tasks move from a sidebar section to a fixed mobile card. This preserves visibility but changes the apparent owner and return path; it is part of IA-R1-002, not a generic responsive defect.
- A mobile-specific “Recent” entry is intentionally not mirrored as a new desktop top-level destination. Current evidence supports leaving this alone unless usage data shows desktop users cannot resume effectively.

## 11. Findings — sorted by Severity

### IA-R1-001 — Global maintenance and security are owned by an “Appearance & language” popover

**Classification:** Structural Friction / Discoverability Risk / Recovery Risk
**Severity:** Medium
**Confidence:** Strong (current code and labels; screenshot-supported shell; no controlled authenticated task test this turn)
**Affected user job(s):** manage backup/restore; manage learned import formats; change password/log out; prepare offline library
**Affected surface(s):** Sidebar footer, `SidebarPreferences`, `PreferencesPanel`, Data and backup, Import Format settings, Account Security
**Location / Entry point:** sidebar footer → “Appearance & language” → scroll/“More settings” → maintenance/security section (`apps/web/components/sidebar-preferences.tsx`, `preferences-panel.tsx`)

**Evidence:**

- The footer trigger is labelled `appearanceLanguage` and opens a role-dialog with the same label.
- The panel contains theme/language plus Offline Library, reader preferences, Data and backup, Import Format settings, and Account Security (`preferences-panel.tsx:40-97`).
- Data backup explicitly covers complete system data and restore is routed through Import; learned profiles include rename/disable/repair/delete; Account Security includes password change and logout.
- The panel is a transient popover that closes on any outside pointer or Escape (`sidebar-preferences.tsx:13-23`), and its content is internally scrollable.

**Current structure:** A lightweight appearance/language control is acting as the only global gateway for appearance, offline, data lifecycle, import-format administration, and account security. High-consequence jobs are one or two disclosure levels below a label that does not name them.

**User consequence:** A user looking for backup, a learned format, password change, or logout must recall that these live under an appearance control. Once inside, a long scroll and a transient outside-click dismissal make a multi-field security or maintenance task easier to abandon or restart. The cost is not visual; it is recall, search, and recovery effort at precisely the moments where users may already be under time or failure pressure.

**Why this is an IA / task-flow issue:** The problem is ownership and disclosure: the visible entry label does not match the object/action families it owns, and a transient preference surface owns persistent maintenance/security workflows. It crosses object boundaries rather than being a single copy defect.

**Round 1 direction:** Give global preferences, data/backup, import formats, and account security an explicit, stable ownership model; keep lightweight appearance controls separate from consequential maintenance without forcing a new page unless evidence shows that is needed.

**Round 2 required:** Yes.
**Evidence still needed:** Authenticated task test for “find backup,” “repair learned profile,” and “change password”; accidental outside-click during password change; mobile drawer/popover re-entry; support/search logs if available.

### IA-R1-002 — Background work has no stable global task-center owner

**Classification:** Structural Friction / Recovery Risk / Consistency Debt
**Severity:** Medium
**Confidence:** Observed (provided task-monitor screenshots) + Strong (current component placement and task types)
**Affected user job(s):** recover failed imports; monitor merge/delete/export; review cleanup scans; resume delayed work
**Affected surface(s):** `ImportTaskMonitor`, Project Sidebar, mobile fixed task card, cleanup review dialog
**Location / Entry point:** sidebar Import/Search area (`project-sidebar.tsx:598-603`) and mobile fixed placement (`project-sidebar.tsx:473`)

**Evidence:**

- The same monitor handles import, conversation merge, batch delete, export, and content-cleanup scans (`import-task-monitor.tsx`).
- On desktop it is rendered immediately under sidebar search and Import; on mobile it becomes a fixed bottom card.
- Supplied production screenshots show cleanup results presented as “candidates found in existing conversations” beneath the general sidebar rather than under a named Tasks/Activity surface.
- Task cards include progress, open review, ignore, retry/cancel paths, so the underlying status model is stronger than its placement suggests.

**Current structure:** A global object (delayed work across the whole app) is visually attached to the Import entry area. Its location changes on mobile, and cleanup review uses a different vocabulary from ordinary task cards.

**User consequence:** After starting merge, deletion, export, or a batch scan from another context, a user may not know where to return to monitor or recover it. A completed or failed task can look like an Import issue, while a mobile bottom card feels like an interruption rather than a persistent work queue. This increases state-recovery cost and makes cancellation/completion harder to predict.

**Why this is an IA / task-flow issue:** The task object is cross-surface and cross-domain, but its owner surface is named and positioned as if it belonged to Import. This is a mismatch between object scope and navigation ownership, not merely a card styling choice.

**Round 1 direction:** Establish one discoverable global task/activity ownership model with task-type-specific entry links, while preserving contextual shortcuts from Import, cleanup, merge, and delete surfaces.

**Round 2 required:** Yes.
**Evidence still needed:** Live start/interrupt/re-entry tests for each task type on desktop and mobile; whether task cards survive route changes/reload; whether a user can find a failed task without remembering its origin; usage data for task frequency.

### IA-R1-003 — Batch import completion is reported as a first-conversation navigation

**Classification:** Structural Friction / Entry-Result Mismatch
**Severity:** Medium if confirmed
**Confidence:** Strong (current `ImportPanel` code; completion screenshot/controlled batch observation not available in this round)
**Affected user job(s):** import multiple conversations; confirm batch completion; find imported results
**Affected surface(s):** Import dialog, Adaptive Import workspace, Reader, Library/sidebar
**Location / Entry point:** `apps/web/features/import/import-panel.tsx:57-71`

**Evidence:**

- `finishCommittedImport` invalidates conversations/projects, stores the commit result, then takes `result.conversation_ids[0]` and pushes `/conversations/{id}`.
- The same result contains `conversation_count`, and the dialog reports “已导入 N 个对话,” so the operation is explicitly batch-capable.
- No current evidence shows a post-import result overview with links to all imported Conversations or a stable batch scope.

**Current structure:** A multi-object Import completion is collapsed into one Reader navigation, specifically the first returned Conversation. The import result exists in state, but the dominant next surface is a single object rather than the completed batch.

**User consequence:** After importing several files or Families, the user may believe only the first Conversation was imported, or may need to return to Library/search to locate the remainder. The completion state and the next navigation target do not express the same scope.

**Why this is an IA / task-flow issue:** The entry is a batch operation while the result surface is singular. This is an entry/result contract mismatch and a potential context-loss point, not a request for another feature by itself.

**Round 1 direction:** Define one dominant batch-completion return path that preserves the imported set and still offers “open first Conversation” as a shortcut; verify whether this belongs in Import, Library, or the task center before designing UI.

**Round 2 required:** Yes.
**Evidence still needed:** Authenticated batch import with 2–10 disposable Conversations; observe what the user thinks completed, whether all results are discoverable, and whether task monitor already supplies an adequate result set.

### IA-R1-004 — “Archive” names two different user concepts

**Classification:** Consistency Debt
**Severity:** Low
**Confidence:** Strong (current labels, docs, and import/backup copy)
**Affected user job(s):** archive/unarchive a Conversation; export/restore a complete system archive
**Affected surface(s):** Archived page/sidebar, conversation action menus, Data and backup, Import dialog
**Location / Entry point:** `archived` lifecycle labels and `.cr 归档` / “恢复 Chat Reader 归档” labels

**Evidence:**

- “已归档/Archived” is a Conversation lifecycle area where items can be restored or permanently deleted.
- `.cr 归档` is a complete system backup/restore package; the dialog helper text explains it separately.
- Current surrounding context usually disambiguates the two, so this is not observed as a blocker.

**Current structure:** One root term covers an object state and a transport/package boundary.

**User consequence:** During recovery or cleanup, a user can briefly confuse “restore this Conversation” with “restore a system archive,” especially when navigating from the same sidebar and Import settings. The likely cost is hesitation or an unnecessary detour, not data loss under the current confirmations.

**Why this is an IA / task-flow issue:** The ambiguity crosses lifecycle and backup object models; it is not simply a translation preference.

**Round 1 direction:** Keep the existing model, but assign explicit object-qualified language to lifecycle vs system package at the owning surfaces; do not merge the two concepts.

**Round 2 required:** No.
**Evidence still needed:** First-time user wording test or support evidence showing actual confusion.

### H-R1-001 — Global search may not preserve the full result context after opening Reader

**Classification:** Recovery Risk / Hypothesis
**Severity if confirmed:** Medium
**Confidence:** Hypothesis (route/code evidence; no authenticated browser test this turn)
**Affected user job(s):** find a Conversation globally, compare several results, return to filtered results
**Affected surface(s):** `/search`, Reader, browser history
**Location / Entry point:** Sidebar quick search → `/search` result → `/conversations/{id}`

**Evidence:** The product has an explicit persistent return-to-search model for Reader-local search, while the global search path appears to rely on route/browser back. Current source review did not establish whether filters, selected result, and result scroll position are encoded or restored.

**Current structure:** Two search scopes exist with different return semantics: local search advertises its context; global search's full re-entry contract is not visible in the inspected code.

**User consequence if confirmed:** Comparing several global results could force the user to repeat a query, filters, or scroll position, increasing recall and navigation cost.

**Why this is an IA / task-flow issue:** It concerns scope ownership and return context across a route boundary, not the visual layout of search.

**Round 1 direction:** Verify the global search return contract before changing it; only unify semantics if the evidence shows context loss.

**Round 2 required:** Yes, only if reproduced.
**Evidence still needed:** Authenticated browser test with filters, non-first result, back/forward, refresh, and mobile route transition.

## 12. What Is Working / Deliberately Left Alone

**What is working:**

- The Project → Conversation hierarchy and explicit Unclassified container are easy to explain and are consistently represented in sidebar, Project pages, and lists.
- Reader owns Reader work. Edit, local search, annotations, focus, files, Share, export, merge, and split are divided into primary and secondary actions instead of flattening every operation into the global shell.
- Adaptive Import uses strong progressive disclosure: known formats bypass mapping; unknown/drifted/ambiguous formats open the larger workspace only when needed; `.cr` stays on an independent restore pipeline.
- Local search has a notably strong context model: exact occurrence navigation, previous/next, return to results, and focus restoration are represented as one Reader-owned flow.
- Public Share and Offline Library are separate capability boundaries rather than accidental variants of the owner shell.
- Destructive and delayed work has real status/recovery mechanisms: background deletion, task progress, retry/cancel, content-cleanup review, and MessageVersion history.

**Deliberately left alone:**

- The desktop persistent sidebar versus mobile drawer, and desktop drag/drop versus mobile menu movement. The interaction changes are platform-appropriate while the object model remains the same.
- Mobile-only Recent. It is a continuation shortcut, not evidence of a second navigation hierarchy.
- Reader's dense index/TOC/annotation/file tooling. The target user manages long personal archives; the density is purposeful and the ownership model is clear.
- Contextual Share/Files/Annotation entry points. They are multiple entrances with distinct context, not duplicate primaries.
- `.cr` as a separate restore pipeline and Share as a separate public-by-link surface. Collapsing these into the ordinary Conversation route would damage the mental model.

## 13. Out of Scope Observations

- Some task and cleanup strings are still English inside an otherwise Chinese UI. This is a localization/content-consistency observation; it was not promoted to a separate IA defect because the underlying task ownership is the more important structural issue.
- Screenshot fixtures include some historical/error-state and dense-content captures. They are useful evidence of surfaces and states, but not proof that every captured error is currently reproducible.
- Formula/Markdown rendering, exact source-to-reader alignment, and long-document performance are important product concerns, but this round did not re-audit them except where they establish Reader/source surface ownership.
- No attempt was made to redesign the global visual system, add a command palette, introduce a new page solely for consistency, or expand the product roadmap.

## 14. Evidence Gaps / Untested Areas

- No authenticated controlled production browser walkthrough was performed in this turn. Health and root availability were checked only read-only; private task success was not claimed.
- No live test confirmed whether the preferences popover actually causes typed password/profile/backup input loss on outside click, or whether users routinely find the footer control.
- No live global-search back/forward test confirmed filter, selected-result, scroll, or mobile restoration.
- No disposable batch Import with multiple Conversations was run to confirm whether opening the first Conversation is confusing in practice or whether an existing task result surface is sufficient.
- Background task re-entry was not tested across route changes, reload, mobile dismissal, worker failure, or simultaneous task types in this round.
- No usage telemetry, support tickets, or first-time user tree test was available to quantify frequency or validate the archive terminology collision.
- Rare Group Resolver, drift repair, Share password, Offline reconnect, and maintenance recovery states were structurally inspected but not fully exercised.
- No code, schema, dependency, deployment, or product source changes were made; no test gate was rerun because this deliverable is audit-only.

## 15. Round 2 Candidate List

Only the following candidates meet the Round 2 gate. Round 2 is **not started** by this report.

| Candidate | Related findings | Why structural | Evidence strength | Priority |
|---|---|---|---|---|
| R2-A — Settings and maintenance surface ownership | IA-R1-001 | One transient, misleading entry owns preferences, offline, backup/restore, learned formats, and security; it affects multiple rare but consequential jobs and recovery paths. | Strong; needs task observation | 1 |
| R2-B — Global task/activity ownership and re-entry | IA-R1-002 | Delayed work is cross-domain, but the only visible owner is Import/Search-adjacent and changes placement on mobile. | Observed + Strong | 2 |
| R2-C — Batch import completion and result return contract | IA-R1-003 | A multi-object job currently resolves into a single-object Reader destination; the correct owner (Import, Library, or Tasks) needs user-flow evidence. | Strong code evidence; behavior unverified | 3 |
| R2-D — Global search return context | H-R1-001 | Potential scope/re-entry defect, but it must be reproduced before becoming a formal finding. | Hypothesis | 4 (conditional) |

The low-severity archive terminology debt (IA-R1-004) does not justify a separate Round 2 structural track without first-time-user evidence.
