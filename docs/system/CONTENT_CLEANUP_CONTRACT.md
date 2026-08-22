# Content Cleanup Contract

Content cleanup is a review workflow, not an automatic deletion facility. Its primary entry is the Markdown Source Editor: the owner selects persisted source text, chooses **Clean noise**, and reviews the exact selection in a central dialog. The same deterministic rule registry and scan engine serve this source-selection workflow and low-priority post-import scans.

## Rules

Rules have immutable revisions. Built-in rules reference versioned detector identifiers; user rules contain an explicit literal value, optional case-sensitivity and an optional canonical role filter. Arbitrary regular expressions, scripts, cross-message matching and LLM classification are not supported. Rule values are business configuration and must not be emitted to logs or documentation. The cleanup dialog owns the rule-library entry. Built-ins can be inspected or disabled; unused user literal rules can also be deleted. Deleting a rule does not rewrite existing MessageVersion history.

## Scan Scope

Source selection scans include `message_id`, `selection_start_offset` and `selection_end_offset`. All three fields are required together, the range must be non-empty and inside the current persisted MessageVersion, and the scan creates exactly one manually selected candidate. Selection text is never copied into scan persistence. Unsaved editor changes must be saved before scanning so the offsets have stable server authority.

General review scans support the current conversation, a selected set of active conversations, or a one-time snapshot of all active conversations. Archived and deleted conversations are rejected when targets are created and again when the worker reads targets or applies a decision.

Import commit is independent from review. A successful import queues a `content_noise_scan` job that yields between bounded message batches and has lower scheduling priority than imports and normal background work.

## Position Authority

An occurrence stores a rule revision, conversation/message/version identity, Unicode code-point offsets, display line/column, reason, confidence and review decision. It does not store message bodies, Markdown copies, context, file names, attachment content or user identifiers. Context is generated from the referenced `MessageVersion.display_text` only when a review is opened.

Fenced/inline code, math, link destinations and `cr-asset://` destinations are protected. A changed current MessageVersion, an archived target, overlapping ranges, or a deletion that would empty the message creates a conflict instead of changing content.

## Apply

Only explicit `DELETE` decisions are applied. The service revalidates target and version authority, creates a normal MessageVersion, rebuilds render blocks, attachment occurrences, annotation anchors, search and TOC, and advances the offline revision. Existing MessageVersion history remains the sole recovery mechanism; there is no cleanup-specific or batch undo.

Successful apply deletes the completed scan and all occurrences in the same workflow. A zero-match scan is deleted as soon as scanning completes. Explicit ignore also deletes the scan rather than retaining review history. Conflicted scans remain visible only until the owner reviews or ignores them.
