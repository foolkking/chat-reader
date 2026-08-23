# Content Cleanup Contract

Content cleanup is a review workflow, not an automatic deletion facility. Its primary entry is the Markdown Source Editor: the owner selects persisted source text, chooses **Clean noise**, and reviews the exact selection in a central dialog. The same deterministic rule registry and scan engine serve this source-selection workflow and low-priority post-import scans.

## Rules

Rules have immutable revisions. Built-in rules reference versioned detector identifiers; user rules contain an explicit literal value, optional case-sensitivity, canonical role filter, match mode and boundary mode. User match modes are raw exact, NFKC/case/whitespace normalized, and bounded approximate. Boundary modes are anywhere, whole line and block end. Approximate matching is anchored and edit-bounded; arbitrary regular expressions, scripts, cross-message matching and LLM classification are not supported. Rule values are business configuration and must not be emitted to logs or documentation. The cleanup dialog owns the rule-library entry. Built-ins can be inspected or disabled; unused user literal rules can also be deleted. Deleting a rule does not rewrite existing MessageVersion history.

## Detection and review

Detection is layered rather than a single global regular expression. Built-in syntax noise first uses exact structural grammar. Known short syntax tokens may then use NFKC normalization or at most one edit only when an exact citation-reference grammar anchors the candidate. User literals use their selected exact, normalized or bounded-approximate mode. Approximate scanning does not compare arbitrary full message windows and has bounded anchors, length and edit distance.

Each occurrence records detector version, match mode and evidence codes in addition to its location. Every detected candidate is shown to the owner and defaults to `KEEP`; protected Markdown ranges remain `PROTECTED`. There is no confidence or similarity classification in the cleanup contract.

## Scan Scope

Source selection scans include `message_id`, `selection_start_offset` and `selection_end_offset`. All three fields are required together, the range must be non-empty and inside the current persisted MessageVersion, and active detectors are evaluated inside that range before the manual fallback is considered. A fully selected structural occurrence keeps its detector identity and evidence. A partial structural selection expands to the exact candidate boundary and is kept by default for explicit review. A selection with no rule match remains a manual candidate. Selection text is never copied into scan persistence. Unsaved editor changes must be saved before scanning so the offsets have stable server authority.

General review scans support the current conversation, a selected set of active conversations, or a one-time snapshot of all active conversations. The Rule Library can explicitly queue a low-priority scan of all active conversations, including project and unclassified conversations. Archived and deleted conversations are rejected when targets are created and again when the worker reads targets or applies a decision.

Import commit is independent from review. A successful import queues a `content_noise_scan` job that yields between bounded message batches and has lower scheduling priority than imports and normal background work.

## Position Authority

An occurrence stores a rule revision, conversation/message/version identity, Unicode code-point offsets, display line/column, reason and review decision. It does not store message bodies, Markdown copies, context, file names, attachment content or user identifiers. Context is generated from the referenced `MessageVersion.display_text` only when a review is opened.

Variable-length fenced and inline code, indented code blocks, math, Markdown link destinations, reference definitions, autolinks and `cr-asset://` destinations are protected. A changed current MessageVersion, an archived target, overlapping ranges, or a deletion that would empty the message creates a conflict instead of changing content. Application reruns the same detector and role guard against the immutable MessageVersion range; a stale or no-longer-matching candidate cannot be deleted.

## Apply

Only explicit `DELETE` decisions are applied. The service revalidates target and version authority, creates a normal MessageVersion, rebuilds render blocks, attachment occurrences, annotation anchors, search and TOC, and advances the offline revision. Existing MessageVersion history remains the sole recovery mechanism; there is no cleanup-specific or batch undo.

Successful apply deletes the completed scan, occurrences and its rule snapshot in the same workflow. A zero-match scan is deleted as soon as scanning completes. Explicit ignore also deletes the scan rather than retaining review history. Conflicted scans remain visible only until the owner reviews or ignores them.
