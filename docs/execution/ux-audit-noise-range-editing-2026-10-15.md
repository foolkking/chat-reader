# Noise range editing — source audit and interaction contract, 2026-10-15

## Scope and evidence

Ordinary users reviewing many scanned noise candidates in the Web application.
Source was inspected; no live application, production data, browser screenshots,
assistive-technology session or services were accessed. The preceding bulk-selection
batch made progress, but did **not** deliver the requested candidate-range editor.
This record is written before the new implementation.

| Finding | Severity / confidence | Source evidence | Consequence and action |
| --- | --- | --- | --- |
| FORM-RANGE-01 | Medium / Observed (code); runtime untested | `CleanupDecisionInput` has only occurrence ID and KEEP/DELETE; `CleanupCandidate` has no range editor; preview is read-only | An overbroad match cannot be narrowed without leaving review. Add persisted, version-bound deletion subranges while retaining the original detector match. Effort M |
| FBK-RANGE-02 | Medium / Observed (code); runtime untested | Bulk pending overlay applies DELETE to all visible non-PROTECTED rows, including stale/CONFLICT/APPLIED rows | A disabled, ineligible item can appear selected for deletion. Overlay only actionable items. Effort S |
| FBK-RANGE-03 | Medium / Observed (code); runtime untested | Selection mutation starts `void refresh()` then clears its pending overlay | Saved checkboxes can briefly return to cached old decisions. Hold the overlay until read refresh settles; failed reads remain non-actionable. Effort S |

## Decision

Keep the existing group → candidate → required full-message preview → apply flow.
Do not replace it with a second bulk deletion product or a free-form canonical
message editor. Each candidate gains **Adjust deletion ranges**:

- Original candidate is read-only, selectable text. Users can add one or several
  selected subranges, remove a proposed subrange, or restore the whole candidate.
- An immediately updated after-context shows what will remain.
- Saving explicitly means **Save ranges and select**. It only persists the review
  choice; it does not modify the message. KEEP later retains the saved ranges,
  so selecting the candidate again does not silently expand the deletion.
- Ranges can narrow the scanned candidate, never extend outside it. Widening or
  arbitrary replacement remains in the existing Markdown source editor.
- Defaults remain KEEP. No arbitrary one-item minimum is imposed: no selection
  means no deletion, many selected candidates are previewed/applied together.
- This-time adjustments never rewrite personal/global detection rules. Learning
  a long-term rule remains an explicit separate action.

Rejected: replacing source text in the preview would duplicate the existing
version editor and obscure detector authority; storing only client-side ranges
would lose them on close and let saved choices disagree with apply.

## Persistence and safety contract

Add nullable JSON `reviewed_ranges` to cleanup occurrences, migration 0051 after
0050. NULL means the complete original occurrence (legacy behavior). Explicit
ranges are absolute Unicode code-point offsets, ordered, non-overlapping,
nonempty, limited to 20, and contained by original start/end. Existing source
offsets, detector/revision, fingerprint and provenance remain unchanged.

A read-only single-candidate endpoint supplies an edit token. A range save holds
the same scan lock used by decisions/apply, checks the current edit token, source
version/fingerprint, active conversation, detector match and protection, and
selects the candidate. Stale/protected/conflict/applied candidates are not editable.
The preview token binds reviewed ranges; preview and apply share the same range
validation/expansion. No range-save creates a canonical version.

Summary fragments count exact proposed ranges; selection counts and applied
counts continue counting candidates. A selected candidate with invalid stored
ranges makes its message conflict/unchanged, never a guessed full deletion.
Old selections with NULL ranges retain the existing behavior.

## State and recovery

| State | Observable action / recovery |
| --- | --- |
| Editing | Source selection and range list are local; cancel/close with dirty changes requires the existing confirmation |
| Pending save | Inputs/save/back are disabled; one request owner; no automatic replay |
| Confirmed save | Update scan metadata, return to review, refresh lists, retain review scroll/focus |
| 409/validation or unknown response | Retain local draft, disable another write, offer read-only reload of that candidate |
| Reload matches draft and DELETE | Report current state matches; allow return, without claiming this request caused it |
| Reload differs | Show current state and draft; explicitly adopt the new base before saving again |
| Read fails/offline | Keep draft, show bounded bilingual error and read-only retry |
| Source changed/protected/ineligible | Read remains visible; cannot save; return/rescan |
| Unmount/account change | Abort local reads; ignore retired callbacks; never replay writes |

## Visual / input contract

Reuse `.interface-design/system.md`: quiet reading-desk domain (source, match,
range, retained text, review choice, message version). Paper/raised paper/graphite,
muted ink, sea-green action and amber review already have semantic tokens.
Signature is exact source → proposed removal → retained context, not generic cards.
Preserve application font, text-sm work/text-xs metadata, 4px spacing scale,
border-ui and inset bg-surface. No dependency, token, font, route or theme redesign.
No decorative side border is needed; selected state uses checkbox plus text/tint.

Labelled native read-only textarea supports pointer/touch/keyboard selection;
range rows have a named Remove action. On narrow width actions wrap, text wraps,
and range/source panes scroll vertically. No drag-only handles, motion dependency,
source-text logging or new telemetry.

## Acceptance and limitations

Author synthetic regressions for multiple narrowed ranges, Unicode offsets,
invalid/overlapping/out-of-bounds ranges, restored full selection, bulk KEEP/DELETE
preservation, preview-token invalidation, stale source, protected content,
concurrent edits and account isolation. Verify schema/model/migration consistency.
Existing release gates must not be replayed. No browser, production, migration
execution or deployment acceptance is claimed by this source work.

### Static-check follow-up (recorded before the corrective edit)

The nonincremental Web typecheck found TS2367 at `import-panel.tsx:245`:
the restored-session error branch passes `phase === "loading"` to `retrying`,
although that branch has already narrowed phase to `"error"`. Remove the
impossible comparison. The separate loading status still owns pending feedback;
retry changes phase to loading and removes the error control. This is a
compile-only correction to the earlier import recovery batch, not a change to
session reads, retries or writes.

## Implemented source

- `cleanup-range-editor.tsx` owns explicit select/replace/add/keep-part/reset,
  range count, retained context, draft confirmation and bounded unknown-save
  recovery. It does not turn the read-only full-message preview into a source
  editor. Saving ranges and selecting is one review action.
- `cleanup-range-selection.ts` maps Unicode/CRLF safely and merges overlapping
  or touching added selections; no partial UTF-16 surrogate becomes a boundary.
- `cleanup_ranges.py` validates the same saved intervals for preview/apply and
  owns edit-token checks under the scan lock. It leaves source and detector
  provenance intact. JSON NULL is the old full-candidate behavior.
- The occurrence model/schema, owner-scoped single GET and range PUT, shared
  preview token, fragment counts and apply expansion are connected. Migration
  0051 has one parent/head and a consent-revoking downgrade; it was not applied.
- Review pending state excludes stale/protected/conflict/applied items and
  survives the awaited list refresh. Stable checkbox names are retained;
  status is linked through `aria-describedby`, with row tint and native check.
  Expanded after-context respects the saved subranges.
- No new dependency, service, automatic rule learning or canonical edit path.
  Existing rule/conversation groups and cross-page bulk scope avoid requiring
  sequential editing of every ordinary candidate. Only exceptions need refinement.

## Local verification and evidence

| Check | Result / boundary |
| --- | --- |
| Focused API regression, six modules | **65 passed**, 67.41 s; in-process TestClient and isolated SQLite, no listening service |
| Unicode selection helper | **4 passed**; actual TS helper transpiled in memory, no browser |
| Targeted Web ESLint | Passed on range helper/editor, candidate, workspace, panel and import panel |
| Nonincremental Web typecheck | Passed after the TS2367 correction recorded above |
| `git diff --check` | Passed; existing CRLF conversion warnings are not ignored whitespace errors |
| `python -m alembic heads` | Single `20261015_0051 (head)`; graph read only, no database migration |
| Unexecuted migration / PG / access-test syntax | AST parse passed; not runtime acceptance |
| User import storage | No worktree changes under `apps/api/storage/imports/` |

API coverage includes 60 candidates across two review pages/conversations,
individual refinements retained by bulk selection, 61 actual fragments applied
in one action, Unicode source fidelity, strict payload/omission handling, old
preview rejection, KEEP/reselect, create-version and same-ID source changes,
protected/corrupt ranges and existing bounded validation work. Applied counts
remain candidate counts rather than pretending every subrange is a new item.

Earlier verification exposed one test-fixture error: replacing the immutable
initial message version correctly returned 400. The fixture now creates version
2 before testing same-ID replacement; product immutability was not weakened.
An intermediate six-module run passed 61 cases, before the four additional
cross-page/strict-payload cases in the final 65-case run. The initial Web
typecheck failure and its minimal pre-recorded correction are retained above.

Sanitized aggregate evidence:
[`local-checks.json`](ux-audit-noise-range-editing-2026-10-15-evidence/local-checks.json).
Temporary test data stayed in the task-specific desktop `wkkk` subtree, with
process-local TEMP/TMP; no global environment configuration was changed.

## Still pending / handoff

The PostgreSQL competing-token and safe-downgrade tests in
`test_cleanup_ranges_postgres.py`, and owner-isolation extension in
`test_cleanup_access.py`, are authored but **unexecuted**. No authentication
session, PostgreSQL service, migration, Web/API listener, browser/render
inspection, accessibility score, full build/gates, commit, push, CI or deployment
ran. Production remains the previously accepted source/schema, not this batch.

Before a separately authorized release: verify disposable PostgreSQL upgrade,
downgrade and contention; test desktop/mobile keyboard and touch selection,
retained text, dirty/unknown-save close, stale source, selected-only last-page
recovery, focus restoration, contrast and all supported themes/viewports. Stop
writers and use the safe downgrade before starting old API code; old code must
not apply refined choices as whole-candidate deletions.

This completes the requested local implementation batch, not the overall UX
goal or production acceptance. Pause here for the user's next instruction.
