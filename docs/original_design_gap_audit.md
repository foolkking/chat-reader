# Original Design Gap Audit

This audit compares the uploaded full product design with the current `chat-reader` implementation after the Stage 10A-R6 fixes.

## Status Legend

| Status | Meaning |
|---|---|
| Done | Implemented in the current app and covered by API/UI paths. |
| Partial | Implemented as a usable baseline, but not at the final design depth. |
| Not yet | Still future work. |
| Out of scope for now | Explicitly deferred by staged requirements. |

## Feature Matrix

| Area | Current status | Notes |
|---|---|---|
| JSON import | Done | ChatGPT Exporter JSON and official conversations preview/commit are supported. |
| Markdown import | Done | Exporter Markdown preview/commit is supported and paired with JSON when available. |
| JSON + Markdown alignment | Partial | JSON drives structure; Markdown improves display text/blocks. More conflict UI is still future work. |
| Thinking summary cleanup | Partial | Import-time cleaner removes obvious leading assistant thinking traces; frontend still folds historical traces as a safety net. |
| Canonical persistence | Done | Conversations, messages, versions, render blocks, source refs, events are persisted. |
| Projects | Done | Inbox/default project, project membership, project pinning and project pages exist. |
| Conversation pinning | Done | Global and project-level pin APIs/UI exist. |
| Reader transcript | Partial | ChatGPT-like transcript exists; ongoing polish targets Obsidian Border-like Markdown readability. |
| Markdown rendering | Partial | Safe GFM/math/callout/code/table rendering exists. Mermaid/raw HTML/image execution remain disabled for safety. |
| Conversation index | Partial | Left dialogue index exists with U/A numbering and anchor-window jumps. True virtual scroll remains future work. |
| Markdown section TOC | Partial | Right rail is active-message aware and can jump via anchor windows; hierarchy polish continues. |
| Search | Partial | PostgreSQL full text plus substring fallback exist. Advanced scoped filters and saved searches are future work. |
| Reading position | Done | Recent item recording and reading position save/restore exist. |
| Message editing | Done | Editing creates new versions and rebuilds blocks/search/TOC. |
| Version history/restore | Done | Restore creates a new version and logs events. |
| Message split/merge | Done | Message split and adjacent same-role merge APIs exist; reader exposes split and selected-message merge. |
| Conversation merge/split | Partial | Non-destructive conversation merge/split APIs exist; homepage exposes multi-conversation merge. Range split UI is minimal through reader selection. |
| Share links | Done | Token-hashed read-only shares with revoke/expiry exist. |
| Export Markdown/JSON | Done | Canonical JSON and Markdown export are supported with selected messages. |
| HTML export | Not yet | Requested in original design but not part of Stage 09 scope. |
| Tags/bookmarks | Not yet | Explicit future work. |
| Reading modes/preferences | Not yet | Compact/focus/range preference system is future work. |
| Command palette | Not yet | Future UI productivity feature. |
| Undo toast | Not yet | Events exist, but undo UI/workflow is not implemented. |
| Batch blocks API | Not yet | Single-message block loading exists; batch loading is future performance work. |
| True virtual scroll | Not yet | Current reader uses windowed auto-loading, not TanStack Virtual. |
| Jobs/progress system | Not yet | Import/export/reindex are synchronous local APIs for now. |
| Mobile reader | Partial | Responsive shell exists; final mobile QA still needs screenshot/browser verification. |

## Current Improvement Priorities

1. Replace windowed rendering with true message virtualization while preserving anchor-window jumps.
2. Add a batch block endpoint to reduce heavy-message expansion latency.
3. Finish range-based conversation split UI and add clearer merge/split previews.
4. Add reading modes and reading-range controls.
5. Add tags/bookmarks only after reader navigation is stable.
6. Add undo toast for destructive edits and merges.
7. Add HTML export after Markdown/Canonical JSON regressions remain stable.

## Safety Notes

- The app still renders only canonical message/current-version/render-block content.
- Raw source artifacts are not used as reader/export/search body sources.
- Raw HTML execution remains disabled in Markdown rendering.
- Share tokens are still only returned at creation time and are not stored in plaintext.
