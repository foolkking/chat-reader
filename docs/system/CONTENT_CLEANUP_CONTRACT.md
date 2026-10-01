# Content Cleanup Contract

Content cleanup is a review workflow, not an automatic deletion facility. Its primary entry is the Markdown Source Editor: the owner selects persisted source text, chooses **Clean noise**, and reviews the exact selection in a central dialog. The same deterministic rule registry and scan engine serve this source-selection workflow and low-priority post-import scans.

## Rules

Rules have immutable revisions. Built-in rules reference versioned detector identifiers; user rules contain an explicit literal value, optional case-sensitivity, canonical role filter, match mode and boundary mode. User match modes are raw exact, NFKC/case/whitespace normalized, and bounded approximate. Boundary modes are anywhere, whole line and block end. Approximate matching is anchored and edit-bounded; arbitrary regular expressions, scripts, cross-message matching and LLM classification are not supported. Rule values are business configuration and must not be emitted to logs or documentation. The cleanup dialog owns the rule-library entry. Built-ins can be inspected or disabled; user literal rules can also be removed from the personal list while retaining acquired versions. Deleting a rule does not rewrite existing MessageVersion history.

## Detection and review

Detection is layered rather than a single global regular expression. Built-in syntax noise first uses exact structural grammar. Known short syntax tokens may then use NFKC normalization or at most one edit only when an exact citation-reference grammar anchors the candidate. User literals use their selected exact, normalized or bounded-approximate mode. Approximate scanning does not compare arbitrary full message windows and has bounded anchors, length and edit distance.

Each occurrence records detector version, match mode and evidence codes in addition to its location. Candidates default to `KEEP`; protected Markdown ranges remain `PROTECTED` and cannot be selected for batch deletion. Explicit decisions persist immediately and record their save time. Rules never modify source while scanning. Normal fields, tables and syntax examples do not become noise merely by containing marker keywords. Unknown and approximate markers remain suggestions requiring confirmation.

The review workspace groups by rule and conversation, uses a group-list/detail flow on small screens, and supports selected-only filtering. Filtered bulk decisions cover all matching pages, excluding protected and conflicted rows. Full before/after text is paged by message; the apply confirmation names conversation, message and fragment counts. A version/selection-bound preview token rejects changes made after preview. Legacy apply callers remain compatible, but cannot delete candidates without a recorded explicit decision.

## Scan Scope

Source selection scans include `message_id`, `selection_start_offset` and `selection_end_offset`. All three fields are required together, the range must be non-empty and inside the current persisted MessageVersion, and active detectors are evaluated inside that range before the manual fallback is considered. A fully selected structural occurrence keeps its detector identity and evidence. A partial structural selection expands to the exact candidate boundary and is kept by default for explicit review. A selection with no rule match remains a manual candidate. Selection text is never copied into scan persistence. Unsaved editor changes must be saved before scanning so the offsets have stable server authority.

General review scans support the current conversation, a selected set of active conversations, or a one-time snapshot of all active conversations. The Rule Library can explicitly queue a low-priority scan of all active conversations, including project and unclassified conversations. Archived and deleted conversations are rejected when targets are created and again when the worker reads targets or applies a decision.

Import commit is independent from review. A successful import queues a `content_noise_scan` job that yields between bounded message batches and has lower scheduling priority than imports and normal background work.

## Position Authority

An occurrence stores a rule revision, conversation/message/version identity, Unicode code-point offsets, display line/column, reason and review decision. It does not store message bodies, Markdown copies, context, file names or attachment content. Context is generated from the referenced `MessageVersion.display_text` only when a review is opened. Scans and targets retain the account ownership needed for access checks.

Variable-length fenced and inline code, indented code blocks, dollar and LaTeX-delimited math, Markdown link destinations, reference definitions/uses, autolinks and attachment references are protected. Both decision writes and apply recheck protected regions; source editing is the explicit way to change them. A changed current MessageVersion, an archived target, overlapping ranges, or a deletion that would empty the message creates a conflict instead of changing content. Application reruns the detector and role guard against the immutable MessageVersion range; a stale or no-longer-matching candidate cannot be deleted.

## Apply

Only explicit `DELETE` decisions are applied. The service revalidates target and version authority, creates a normal MessageVersion, rebuilds render blocks, attachment occurrences, annotation anchors, search and TOC, and advances the offline revision. Existing MessageVersion history remains the sole recovery mechanism; there is no cleanup-specific or batch undo.

Each conversation commits its versions and `APPLIED` occurrence markers together. A retry skips those completed markers. A scan row lock and renewable five-minute apply lease prevent simultaneous requests; failures return the remaining work to review, and an expired lease can be recovered without replaying completed changes. Successful apply deletes the completed scan, occurrences and its rule snapshot. A zero-match scan retains a readable completion until dismissed, preventing the client from polling a deleted result. Explicit ignore deletes the scan. Closing a dialog keeps saved selections, including source-selection scans. A rescan creates a new scan over the original active conversations and never guesses positions after source changes.
# Personal built-in rule switches (working tree, 2026-09-30)

`content_cleanup_rule_preferences` stores per-user enablement separately from
the global built-in registry. The existing rule PATCH accepts only `status`
for a built-in and writes the requesting account's preference; name/matcher
changes are rejected. List responses show effective personal status and new
scans exclude that user's disabled rules. A different user or Root Admin sees
their own preference, and existing scan revision snapshots remain pinned.
Migration `20260930_0036` adds explicit decision timestamps and apply leases.
Legacy `DELETE` candidates reset to `KEEP` because old records cannot prove
whether selection was automatic or deliberate; content and candidate locations
remain intact. The new detector version is `noise-v4`.

## Personal exceptions and learning (working tree, 2026-10-01)

Migration `20260930_0037` adds account-owned exceptions. An explicit preview and
confirmation bind the selected rule revision, canonical role, literal text and
up to 48 Unicode code points on each side, including message-edge flags. The
scope must match exactly; a rule revision or context change is reviewed again.
Exceptions run after detector precedence, so an overlapping generic detector
cannot recreate the same ignored hit. They apply to future scans and set only
the confirmed current candidate to KEEP; other existing decisions stay intact.
Ordinary KEEP never learns a persistent exception. Settings list and revoke
exceptions with pagination. Tokens bind the account, source version and scope,
expire after ten minutes, and cannot be used by another account. Confirming the
same scope concurrently creates one exception. Manual selections have no
automatic rule to exempt. Scopes over 4,096 characters require a smaller match.

The review and rule settings use the same learning/editor flow: explicit text,
role, case handling and boundary, then a deterministic trial, then confirmation.
The default matcher is EXACT. Trials check at most 100 active messages and
250,000 characters; messages over 20,000 characters are skipped. The UI reports
scanned, skipped, matched and protected counts and up to ten contextual examples.
A current-conversation trial is available when learning from a review. This is
a bounded trial, not a claim that every conversation was checked; a normal
low-priority full scan remains available from the rule library. Trials do not
persist source examples or alter rules/content. Confirmation tokens bind the
account, normalized configuration and edit base and expire after ten minutes.

Edits append immutable revisions and check the supplied base revision under a
rule-row lock. Explicit null clears a role filter. Conflicts preserve the Web
draft, show the current server configuration and allow adopting that base before
another trial. Settings expose paginated revision history. The legacy explicit
create/PATCH endpoints remain compatible; the new Web uses trial/learn for
configuration changes. Personal enablement remains independent of built-ins.

Bulk selection reclassifies legacy protected KEEP rows instead of failing the
whole batch. Balanced/escaped parentheses in Markdown destinations are protected.
## Acquired revisions and system publication (working tree, 2026-10-01)

Migration `20261001_0038` establishes existing literal revisions as personal
grants before changing source-account deletion to SET NULL. It adds explicit
system publication, old-ID aliases and personal label/current-version/hidden
preferences. Historical rules are not automatically published. Equivalence
includes matcher version, literal, role, case, boundary, normalization, distance
and scope; only identical complete historical revision sets receive aliases.
Old revision parents, exceptions and pinned scan references remain intact.

Equivalent explicit learning reuses a canonical identity and immutable revision
under a PostgreSQL configuration lock. Editing locks that identity, checks the
base version (including optional UUID), reuses an equivalent version within the
identity or appends one, and grants/selects it for this user only. Independent
historical lineages are not silently merged after a converging edit. Personal
history exposes only entitled versions, with the current effective version first.

Root Admin publishes a specified validated configuration and public name. The
candidate list contains matcher configuration, validation state and source-account
existence, never a private label, sample context, filename or source conversation.
Publication and withdrawal are audited. A scan retains its admitted immutable
revision after withdrawal; a successfully applied literal match grants that version
in the same transaction as MessageVersion and the durable APPLIED marker. Merely
listing, selecting, scanning or keeping a public match does not acquire it.

One personal row combines held/public availability. An acquired/learned selected
version remains selected when a newer public version appears; the user may select
another entitled version explicitly. Withdrawal falls back to a held version if
the selected public version was never acquired. Removing a personal rule only
hides/disables it and keeps history, grants and ongoing reviews; learning again
restores it. Personal names and switches do not alter anyone else's configuration.
Deleting the author retains shared rules, versions and grants and clears source
links. Full-family format health behavior is in `ADAPTIVE_IMPORT_CONTRACT.md`.
