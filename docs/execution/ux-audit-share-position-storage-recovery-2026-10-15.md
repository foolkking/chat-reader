# UX quick review — Share position-storage recovery

2026-10-15 · pre-edit source evidence. Full ordinary-user goal remains active.

## Scope and evidence

Mainstream public/unlocked Share visitors, responsive Web, specifically failure
of the optional device reading-position store. Reading the authorized content
must not depend on this optional persistence. No visual redesign, new position
format, access-policy change or server write is proposed.

SEEN: `apps/web/features/sharing/share-readonly-reader.tsx:55–60,118–122,
187–199,235–238,516–540,580–588,622–623,664–668,1004–1018`;
the existing Share visit/readiness/query and saved-position retirement
regression; existing state/retry and fixed-height header patterns.
NOT SEEN: mounted React, actual crypto or browser storage-denial/quota cases,
scroll/position geometry, keyboard/screen-reader announcement or CPU/RSS.
Facts about branches are Observed (code); rendered consequences and occurrence
frequency are Inferred. No conformance, browser or test-pass claim is made.
Tests/gates, services, production, commits and release remain off.

## Executive summary

Share waits for a token-derived position key before enabling its first content
window. The digest promise has only a success branch, so rejection leaves this
optional readiness gate unsettled. Storage reads themselves are already caught,
but access denial is indistinguishable from having no saved position. Later
scroll/page-hide writes and permanent-access-error removal are not caught.
Visitors can be left waiting for content or be given no indication that their
place is not being saved. Settle failed initialization into explicitly
nonpersistent reading, contain storage failure once per visit, and reuse the
existing fixed-height header line for finite local feedback.

## Findings and quick wins

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| STATE-SHARE-POSITION-01 | Defect / state coverage; recovery | High | Observed (code); runtime consequence Inferred | S |
| FBK-SHARE-POSITION-01 | Defect / feedback; local persistence recovery | Medium | Observed (code); runtime consequence Inferred | M |
| STATE-SHARE-POSITION-02 | Defect / state coverage; discard ownership | Medium | Observed (code); runtime consequence Inferred | S |

**STATE-SHARE-POSITION-01.** Locations: pre-edit 187–199 and 622–623, with the
first-window query gate at 118–122. `sharePositionStorageKey(token)` awaits
`crypto.subtle.digest`, but the effect has no rejection branch. Only success
sets `storageReady` and tags `storageVisit`; the loading branch and query gate
both require them. A visitor whose browser cannot compute the key never gets
to the authorized reading content or even its server retry/access outcome.
Catch current-visit failure, clear the in-memory key/anchor, settle readiness
for that visit and allow the existing unanchored first-window query. Never
fall back to a raw token key, another visit's position or another hash scheme.
Retired success and rejection must both remain unable to publish.

**FBK-SHARE-POSITION-01.** Locations: pre-edit `readSharePosition` at 1010–1018,
scroll/idle/page-hide writers at 516–540 and permanent-error removal at
235–238. The read helper returns null for both blocked storage and absent/bad
JSON; later writers/removal directly access `localStorage`. A visitor can keep
reading without knowing that resume is unavailable, and every later save can
throw again. Distinguish storage access failure from malformed JSON at the
local initialization boundary, contain read/write/remove failure, disable
further persistence attempts for this visit and retain readable content.
Expose a finite warning using the existing header line, not raw exception
detail or a new banner that shifts the reading document. Preserve corrupt-JSON
null fallback, original SHA-256 keys/position bytes, save-idle timing and
transient/password-error retention. Do not claim a denied removal succeeded.

**STATE-SHARE-POSITION-02.** Follow-up source evidence recorded before its
repair: the successful permanent-error removal leaves the in-memory key,
anchor and mounted position-saving effect intact. That effect depends on
message count/key/readiness, not Share access error, and its page-hide handler
can save the cached position again after removal. A visitor's old resume
record can therefore reappear after the existing policy chose to discard it.
Disable the current visit's persistence synchronously before the removal,
then clear only its in-memory key/anchor on either outcome. Keep the existing
permanent/transient/password classification and never claim a denied disk
removal succeeded. Use one visit-tagged in-memory disable ref for this and
failure paths, so another effect's retained writer cannot probe storage again
before React commits the null-key state.

## Ordered repair and acceptance

1. Add scoped failure settlement for initialization with a finite unavailable
   flag, null key/anchor and current readiness. Optional storage cannot block
   ordinary authorized content loading.
2. Contain later write/remove failures and stop further storage probes in the
   live visit. Guard deferred old writers by the existing visit/current-store
   identity. Do not add polling, automatic retry or mid-reading restore.
3. Reuse the fixed-height header's existing small read-only line for the
   current visit's warning, translated at render time. No extra document-flow
   height or exposed storage/crypto detail.
4. Author source-based regressions for rejection/denial/quota/removal,
   readiness/query fallback, unchanged successful bytes/key/timing, old
   completion/writer retirement and local feedback. Leave them unexecuted.
5. After authorization, use task-specific TEMP/TMP for focused and relevant
   Web checks, then actual browser denied storage/crypto failure, scroll,
   reload/restore, Share access/password/permanent errors and announcements.

## What stays and open questions

The current token visit, complete-turn query/anchor contract, saved-position
fallback order, idle-only capture and cached unload save remain. Nothing
rewrites imports, server data, Share URLs, package/Dexie or API/schema.
An unavailable visit reads without persistence; a later fresh visit may try
the existing initialization again. No automatic read retry is introduced,
because a late saved-anchor read must not move an already-reading visitor.

Valid-but-malformed position-object schema, indefinitely pending digest rather
than rejection, cross-browser geometry, underlying storage durability,
unlock/edge loading and actual assistive feedback remain separate evidence
needs. This batch does not add a timeout, replace SHA-256 or certify saving.

## Implemented source checkpoint

Current digest/read rejection now settles the visit as ready with null
in-memory key/anchor and a finite unavailable flag. The existing authorized
first-window query can proceed unanchored. The read helper still catches bad
JSON, while storage access errors reach the containing effect. Success and
rejection both retain visit/cancel/disable checks; disabled initialization
replay does not probe again and a fresh visit can initialize normally.

A memory-only visit-tagged disable ref fences every writer immediately,
including before null-key state commits. Write failure is contained and
reported without another storage attempt. Permanent-error discard disables
first, contains removal failure and clears only the in-memory key/anchor on
either outcome. Retained page-hide/idle writers cannot recreate a discarded
key. A denied or unavailable store is not claimed durably deleted. Existing
password/transient classification remains; no new deletion policy or unsafe
token/hash fallback.

The live persistence effect keeps idle sampling/cached-unload timing and
position serialization. Its cleanup retires deferred callbacks, and visit/
current-store checks fence capture/write. Reading-position tracking remains
active when saving is disabled. The existing fixed-height read-only header
line shows current-visit finite translated feedback with full explanatory
title, not a new document-flow banner or underlying error detail.

The updated `scripts/ux/share-navigation-retirement.test.mjs` and new
`scripts/ux/share-position-storage-recovery.test.mjs` are **unexecuted**.
The former adds actual initialization/read/query failure, stale rejection,
bad-JSON, disabled replay and fresh-visit cases with required fixture adapters.
The latter extracts actual persistence/discard effects, classification/error
class and status JSX for idle/key/bytes, one contained failure, current/old
writer retirement, permanent removal success/failure, transient retention and
fixed-line finite feedback assertions. Storage, digest, query, capture,
layout/commits and timers/events are controlled, not real browser or durability
results. No pass count is asserted.

Current state/architecture/flows, navigation/testing and inventory are synced.
No tests/gates, syntax check, lint, typecheck, build, services, browser, commit,
CI, deployment or CPU/RSS measurement ran. Full ordinary-user goal remains
active; formatting-only review is recorded below.

Formatting-only `git diff --check` for tracked Share source and the six edited
current documents exited **0**. Existing LF→CRLF warnings remain, without
normalization. The untracked report and both untracked regressions were not
covered by that command. This does not validate syntax, types, tests, browser
behavior, CPU or memory use.
