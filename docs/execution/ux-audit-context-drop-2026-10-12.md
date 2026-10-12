# Context drop confirmation audit — 2026-10-12

## Scope and evidence

Narrow review of the existing responsive Web Context editor/drop flow for ordinary
readers, prompted by complete CI 37995454022 at source
`5d03744e6058029b838e14a10e9085065ab43c8a`. Evidence is source, the original CI
failure log and its synthetic 375px DOM snapshot. No new local Web service or
browser was started; no failure trace was collected by that spec. The precise
React scheduling sequence in that CI run is therefore not established.

The final run fails Web and passes API (1,239 passed / three skipped / 20 warnings,
806.99s), settings (439 passed, 38.6m) and fresh-instance restore (one passed,
34.6s). Both image jobs are skipped. Web Context is 34 passed / one failed, with
no timeout or skip; its two earlier gates pass and ten later gates are unverified.
Registry initialization succeeds in all three jobs. This is not a PDF failure,
image acceptance or deployment.

## Finding ERR-01 — draft replacement depends on delayed parent state

| Field | Finding |
| --- | --- |
| Dimension | Error prevention / recovery; state coverage |
| Severity | High; unintended replacement can discard the active local draft |
| Confidence | Observed (source and CI assertion); exact CI scheduling cause inferred |
| Location | `apps/web/features/exporting/continuation-document.tsx:38`, `continuation-panel.tsx:48`, `continuation-panel.tsx:105`; `apps/web/e2e/context-continuation-drop.spec.ts:58` |
| Effort | S/M: narrow state propagation and regression coverage |

The document reports `editing && draft !== original` through a passive effect.
The panel guards `saveDropped` using its last rendered `editorDirty` state. The
input event itself only changes document state and schedules local persistence.
Consequently there is no synchronous guard connecting a changed input to the
drop handler before parent rendering/effects finish. The existing dirty effect
also clears the parent flag in every cleanup, including dirty-state changes.

In CI the test fills `Unsaved draft`, registers a dismiss handler and drops a
replacement. Its immediate textbox assertion passes, then the server generation
is **3**, not the required **2**. The failure snapshot already has no textbox and
shows both “正在保存，请稍候…” and “文件已更新。”. A registered dialog handler alone does
not prove a dialog appeared. There is no trace to establish whether this specific
write entered through the delayed dirty guard; the source exposes that window
independently and it needs a deterministic callback reproduction before repair.

Readers must be able to decline replacing their work even immediately after
typing or resuming a local draft. Fix the live guard at the input transition,
keep visual state for rendering, and clear it only on actual discard, confirmed
save or unmount. Do not wait for persistence to decide whether text is unsaved.
Keep the confirmation wording, generation contract and failure recovery intact.

## Prioritized repair and acceptance

1. Execute actual compiled document/panel callbacks with explicitly controlled
   render/effect timing; record the pre-repair result. These are scheduling
   doubles, not a claim of browser lifecycle or CPU/RSS measurement.
2. Repair only the reproduced guard gap and cover immediate/resumed edits,
   decline, accepted and failed replacement, reverting to original and cleanup.
3. Strengthen the existing synthetic browser case to require the confirmation
   actually to occur and retain a failure trace. Preserve all old generation,
   file, package, history and canonical-body assertions and existing timeouts.
4. Run scoped regressions, lint, nonincremental types and bounded Web build;
   bind an additive source checkpoint, then submit one complete exact-source CI.

The existing member validation, generation precondition, in-flight upload lock,
failed-write draft retention and coherent revision/history pairing remain useful
and in scope to preserve. No schema, API, dependency, theme, PDF budget or user
data change is proposed. Other optimization findings remain the next batch.

Per the user's 2026-10-12 instruction, pause after the new CI is submitted and
wait for their result. This does not mark the overall goal complete or authorize
deployment without full CI, screenshot, independent-image and fresh production
checks. The eventual deployment remains **0050→0050**, with no migration,
reconcile or backfill. The earlier local Web-start denial is not retried.

## Evidence identity

- Original Web job 114040200701 log SHA256:
  `16f75a943d24cd58b640ed9adc28acf3b7318cdef91e5e069de2966539cc3231`.
- Original ZIP 11647206598: 4,919,140 bytes; verified GitHub SHA256
  `359efdd2ff7c95d92e530d3e4a831735467b38495e8774fb604af22bb8f17b43`.
- The original ZIP and logs are retained in the task temporary root; durable
  sanitized diagnostic facts and new probe results will accompany this report.
- No failure screenshot was inspected; the DOM snapshot is textual evidence.

The durable [CI facts](ux-audit-context-drop-2026-10-12-evidence/ci-final.json)
retain the final job identities and the limits of the failure evidence.

This is the pre-edit diagnosis. Implementation and measured local results follow
only after the planned probe, and will be appended separately.

### Pre-repair callback reproduction

The 12-case actual-TSX callback suite produces **four passes / eight failures**
(1937.8704ms). Immediate Current/Index drops and resumed drafts omit confirmation;
accepted immediate replacement also omits confirmation, while stale dirty state
prompts after reverting to original. Immediate panel navigation and workspace
close bypass the dirty check. Unmount fails to propagate clearing to the workspace
until another parent effect. Settled decline, failed-write retention/retry,
pristine drop and duplicate in-flight exclusion already pass. These are controlled
scheduling results, not a claim to have recreated the original browser trace.

## Implemented repair and verification

The three existing components now propagate editor dirty transitions immediately;
panel drop/navigation and workspace close/navigation consult a live ref. Input,
draft resume, reverting to original, confirmed save/discard and unmount cover the
state transitions. A delayed panel effect reads the live editor value. The
workspace's dirty value does not drive rendered content, so it needs no duplicate
state update. Existing upload selections still participate in the dirty state.
No dependency, polling interval, persistence format, request payload or rendering
budget changes.

The original 12 checks now pass (1197.3584ms), and four added save/discard/stale-effect
cases make **16 passing checks** (1461.8313ms). All 27 repository-script suites
pass **756 / zero failed / zero skipped**, 10491.8808ms. Earlier 740/752 counts
overlap these checks. Lint, nonincremental types and the one-worker Web build
pass. Unrelated buildinfo remains byte-identical. No API/schema change or local
API rerun; the previous exact-source API result is historical for the next commit.

The existing two-width browser test now awaits and validates each replacement
confirmation, keeps every previous data/generation assertion, adds saved-Index
readback after decline and two synthetic draft screenshots, and retains failures'
trace. Three Context files discover **11 browser cases; zero executed locally**.
No local Web or browser was started. Browser scheduling, geometry and performance
remain for full CI acceptance; this report does not claim measured CPU/RSS.

The additive [source checkpoint](ux-audit-context-drop-2026-10-12-evidence/local-verification.json)
binds the candidate and preserves all previous source/evidence ledgers. Submit
the complete workflow once, then wait for the user's result as requested.
