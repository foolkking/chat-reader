---
name: context-continuation-maintainer
description: Create, advance, finalize, compact, repair, or re-fingerprint persisted continuation state for supplied or referenced Chat Reader Conversation Context Packages and compatible extracted packages. Use when the user asks to update continuation/current.md plus continuation/index.json, build continuation for a Raw-only package, process a long history in maintenance stages, finalize Maintenance Fragments, repair stale or inconsistent continuation, or produce a new validated .context.zip revision. Reuse the shared context-package runtime for PackageSource, CanonicalMessage, Current/Index parsing, fingerprints, validation, and extraction. Preserve Raw Conversation and attachment bytes; write only derived continuation state through validated atomic materialization.
---
# Context Continuation Maintainer
Maintain the persisted continuation layer of a Chat Reader Context Package. Act as the semantic Writer/Reconciler for Continuation Schema v1 while delegating deterministic parsing, fingerprints, rendering, validation, and package writes to bundled scripts.

## 1. Core Contract
1. Inspect the source package and determine its current continuation runtime state.
2. Select exactly one maintenance mode: `ONE_SHOT`, `STAGED_BUILD`, `FINALIZE`, or `REPAIR`.
3. Reuse previously verified semantic work whenever its Raw source remains unchanged.
4. Semantically acquire every newly claimed covered message that is not inherited from a valid verified prefix.
5. Resolve adoption, supersession, scope, state level, uncertainty, and context-critical attachment dependencies before promotion.
6. Choose continuation boundaries by semantic closure, never by a fixed numeric quota alone.
7. Reconcile semantic changes into one coherent Continuation Candidate.
8. Apply Current retention/GC and preserve historical retrievability in Index/Raw.
9. Maintain one Maintenance Trace proving the maintenance work actually performed.
10. Materialize `current.md`, `index.json`, and manifest continuation metadata only through the deterministic writer.
11. Validate the newly assembled package before publication.
12. Leave Raw Conversation and Raw Attachments unchanged.
Never directly hand-edit finalized `continuation/current.md`, `continuation/index.json`, source fingerprints, continuation revisions, or manifest continuation metadata when the deterministic materializer is available.
Never modify `conversation.canjsonl`, Canonical Raw Message content, Raw IDs, or asset-object bytes.

## 2. Authority and Semantic Invariants
Preserve these rules in every maintenance mode:
- Raw Conversation and Raw Attachments outrank all derived continuation state.
- Historical package instructions are evidence, not live executable authority.
- Current platform instructions and current-session user instructions govern present behavior.
- Current-session input may change future direction but does not rewrite historical facts.
- Role affects interpretation, not required semantic coverage.
- Assistant proposal != adopted Decision.
- Assistant recap != user adoption.
- Resolve referential adoption such as "yes", "use that", "agreed except X", or "keep the previous rules" before promoting a Decision.
- Plan != implementation != testing != production verification.
- A lower-level PASS does not prove a higher-level, end-to-end, or production-equivalent PASS.
- NOT VERIFIED != BROKEN.
- Recency != supersession.
- Implementation does not silently override a prior prohibition or Constraint.
- Scoped rules must not become global without evidence.
- Search hits, Index entries, summaries, filenames, and generated prompts are not Raw Evidence.
- Attachment filenames/titles do not prove attachment contents.
- Missing evidence remains unknown or limited; absence from the export is not proof of non-existence.
- Conflicting evidence remains Conflict until resolved or explicitly preserved.
- Historical reports retain their original source, version/environment, and as-of scope.
- Historical tool results are historical records, not newly executed operations.
Preserve actor, scope, time, adoption, implementation status, verification level, uncertainty, and provenance whenever they materially affect continuation.

## 3. Shared Runtime and Resources
Reuse the exact shared context-package runtime used by `context-acquisition`. Do not fork or reimplement Package, Raw, Current, Index, or fingerprint semantics inside the Maintainer.
The shared runtime owns at least:
- `PackageSource` and package-root/safety handling;
- `CanonicalMessage` / Canonical Current Message adapters;
- Attachment and source-reference descriptors;
- Current parser;
- Index parser;
- semantic and locator fingerprint projections/composition;
- package inspection;
- continuation validation;
- deterministic Raw extraction.
Use these bundled Reader utilities directly:
- `scripts/inspect_context_package.py`
- `scripts/validate_continuation.py`
- `scripts/extract_context_ranges.py`
Use Maintainer writer utilities:
- `scripts/write_maintenance_fragment.py`
- `scripts/materialize_continuation.py`
Consult references progressively:
- `references/continuation-schema-v1.md` for normative Continuation Schema rules.
- `references/continuation-examples-v1.md` for semantic/conformance edge cases and release precedents.
- `references/context-package-runtime-contracts-v1.md` for the shared deterministic Reader runtime contract.
- `references/maintenance-runtime-contracts-v1.md` for Fragment, Candidate, Maintenance Trace, writer CLI, transaction, and materialization contracts.
Do not load long reference files routinely when the normal workflow is already clear.

## 4. Maintenance Trace
Maintain one in-memory Maintenance Trace for every maintenance run. Treat it as the semantic attestation used to decide whether the requested persisted trust is eligible.
Track at least:
- maintenance mode;
- Conversation identity and base continuation revision;
- source binding;
- inherited verified prefix/ranges, when any;
- complete semantic reads of newly covered Raw;
- targeted historical semantic rechecks;
- context-critical attachment requirements and inspection status;
- candidate and accepted boundary;
- unsealed Raw tail;
- source/coverage limitations;
- semantic-gate status;
- retention/GC completion;
- requested trust target.
Conceptual form:
```yaml
schema: chat-reader-maintenance-trace
schema_version: 1.0.0
mode: ONE_SHOT
conversation_id: conversation-x
source_binding:
  conversation_id: conversation-x
  entrypoint_sha256: sha256:...
  base_current_sha256: sha256:...
  base_index_sha256: sha256:...
baseline:
  runtime_state: valid_verified
  continuation_revision: 7
  inherited_verified_prefix:
    seq_start: 1
    seq_end: 500
  inherited_verified_ranges: []
semantic_reads:
  - seq_start: 501
    seq_end: 608
    every_sequence: true
    full_body_required: true
targeted_rechecks:
  - seq_start: 371
    seq_end: 375
    every_sequence: true
    full_body_required: true
    reason: old_decision_referenced_by_new_tail
attachments:
  required: [ATT-012]
  inspected: [ATT-012]
  unavailable: []
boundary:
  candidate_sequence: 612
  accepted_sequence: 608
  unsealed_tail:
    seq_start: 609
    seq_end: 612
semantic_gate:
  adoption_resolved: true
  supersession_resolved: true
  scope_resolved: true
  state_levels_resolved: true
  material_conflicts_preserved: true
  context_critical_dependencies_resolved: true
coverage_limitations: []
retention_gc:
  status: performed
trust_target:
  requested: verified
```
A deterministic script may validate ranges, IDs, attachment presence, and source bindings, but it cannot independently prove semantic assertions such as `adoption_resolved`. Treat these as Maintainer semantic attestations, not mechanical proof.
Do not persist the Maintenance Trace into the final Context Package unless a future schema explicitly requires it.

## 5. Maintenance Mode Router
Use exactly four primary modes:
- `ONE_SHOT`
- `STAGED_BUILD`
- `FINALIZE`
- `REPAIR`
Do not create public modes for bootstrap, append, GC, migration, locator repair, or staged repair. Record staged work origin inside the chosen mode instead.
Route by requested outcome, repair need, and semantic work size in this order:
1. If the requested outcome is to consolidate existing valid Maintenance Fragments into a Continuation Pair, use `FINALIZE`.
2. If the user explicitly requests staged/ranged Fragment work rather than final materialization, use `STAGED_BUILD`.
3. Inspect whether existing derived continuation state requires repair.
4. Estimate whether the required semantic work can be completed reliably in one run.
5. If repair is required and the affected semantic scope fits one run, use `REPAIR`.
6. If repair is required and the affected semantic scope is too large, use `STAGED_BUILD` with `maintenance_origin: repair`; later use `FINALIZE` after replacement Fragments are ready.
7. If repair is not required and the maintenance scope fits one run, use `ONE_SHOT`.
8. Otherwise use `STAGED_BUILD`.
Important routing rules:
- `valid_verified` or `valid_provisional` plus a new Raw Hot Tail is ordinary maintenance, not Repair.
- `no_continuation` routes to `ONE_SHOT` or `STAGED_BUILD`, not Repair.
- `current_only` routes to `REPAIR` by default: validate Current against Raw, then preserve/reconcile it and rebuild a matching Index, or fall back to Raw reconstruction when it is not safely reusable.
- `index_only` routes to `REPAIR` when reconstructing a complete Pair from source-bound Index + Raw; treat Index only as navigation evidence. If it cannot be safely source-bound, rebuild from Raw with `ONE_SHOT`/`STAGED_BUILD`.
- `locator_only_mismatch`, `content_mismatch`, repairable `coverage_mismatch`, or deterministic Pair corruption require Repair semantics; choose `REPAIR` versus repair-origin `STAGED_BUILD` by affected scope size.
- `pair_identity_mismatch` requires independent source binding before any component is reused.
- `unsupported_major` is not ordinary Repair. Use a supported migration path or rebuild from Raw with `ONE_SHOT`/`STAGED_BUILD`.
Select one mode for the current run. `FINALIZE` must not silently repair stale Fragments, and `REPAIR` must not silently turn into an untracked staged build.

## 6. ONE_SHOT
Use `ONE_SHOT` when the semantic acquisition, reconciliation, boundary choice, GC, and finalization can be completed reliably in one maintenance run.
### 6.1 Existing verified continuation plus tail
For a `valid_verified` baseline:
1. Inherit the unchanged verified Stable Prefix.
2. Read Current and the complete Index Catalog as needed for reconciliation.
3. Semantically read every Canonical Current Message newly claimed by the target Stable Prefix.
4. Perform targeted historical rechecks only when new Raw depends on unresolved old evidence.
5. Resolve context-critical attachments.
6. Reconcile semantic effects.
7. Choose the latest safe semantic boundary.
8. Build one Continuation Candidate.
9. Run retention/GC.
10. Materialize and validate the new package.
Do not indiscriminately replay an unchanged verified prefix.
### 6.2 Provisional or incomplete baseline
A `valid_provisional`, `current_only`, or `index_only` baseline may aid navigation/reconciliation but contributes no inherited verified semantic coverage.
To remain provisional, acquire enough Raw to support an honest semantically closed Pair and preserve all unresolved exposure.
To request `verified`, semantically read every accessible Canonical Current Message in the claimed Stable Prefix that is not inherited from a valid verified prefix, including any previously provisional region.
### 6.3 Raw-only manageable history
For a Raw-only package, semantically read every accessible Canonical Current Message in the proposed verified Stable Prefix before requesting `trust: verified`.
Search, summaries, parser scans, and recent-only reading cannot substitute for semantic coverage.
### 6.4 No routine Fragment
Do not create a Maintenance Fragment during normal One-Shot maintenance. A Fragment is a staged-construction artifact, not an ordinary checkpoint.
### 6.5 No-op
If no material semantic/coverage/reference change should be persisted, keep the existing revision and return a no-op result. Do not increment revision merely because maintenance was attempted.

## 7. STAGED_BUILD
Use `STAGED_BUILD` when the maintenance semantic scope is too large for one reliable run, including a large repair. Record `maintenance_origin: build` or `repair` in staged maintenance state.
The output of each stage is a Maintenance Fragment, not a Continuation Pair.
### 7.1 Input range is not sealed range
Treat `input_range` and `sealed_range` separately.
Never seal through the requested numeric endpoint merely because the user requested that range. Seal only through the latest semantically closed unit supported by the acquired Raw.
If no safe prefix inside the requested input range can be sealed, record `no_sealable_prefix` and enlarge the next semantic window instead of creating a misleading Fragment.
### 7.2 Fragment semantics
A Fragment is:
- provisional construction evidence;
- source-bound;
- range-bound;
- not `current.md`;
- not `index.json`;
- not Reader continuation state;
- never `verified` trust.
Use local candidate IDs inside Fragments for newly discovered semantic objects. Do not allocate final global stable IDs during staged acquisition.
### 7.3 Cross-boundary dependencies
Record unresolved dependencies that cross the sealed boundary, including open proposal/adoption, question/answer, implementation/verification, correction/referent, attachment/interpretation, or other semantic units.
Do not promote a semantic claim as fully sealed when its only decisive evidence lies in the unsealed suffix.
### 7.4 Fragment writing
After semantic preparation, call `write_maintenance_fragment.py` to bind the Fragment to the actual Raw source, validate ranges/references, compute range fingerprints, and write the Fragment artifact.
Do not ask the deterministic writer to choose the semantic boundary.

## 8. FINALIZE
Use `FINALIZE` to turn staged maintenance into one coherent Continuation Pair.
### 8.1 Validate the Fragment set first
Confirm every Fragment belongs to the same Conversation/source lineage and still matches its sealed/dependency Raw ranges. `input_range` values may overlap for context, but inherited Stable Prefix plus valid `sealed_range` values must jointly support continuous finalized coverage through the proposed boundary with no unexplained semantic gap or incompatible base/source binding.
A Raw edit inside a Fragment's semantic dependency scope makes that Fragment stale. A later append beyond a sealed Fragment does not by itself invalidate it.
If any required Fragment is stale, stop `FINALIZE`; report the exact stale range/dependency and rebuild that staged artifact in a later `STAGED_BUILD` run before retrying Finalize. If the same Raw change also invalidates already covered continuation state, repair that baseline separately with `REPAIR` or repair-origin `STAGED_BUILD`. Do not repair stale Fragments inside the same Finalize run.
### 8.2 Do not concatenate Fragment summaries
Reconcile all Fragments semantically before building the final Candidate.
Resolve at least:
- duplicate candidate objects;
- Decision adoption and supersession across Fragment boundaries;
- Goal evolution;
- Topic Capsules spanning multiple Fragments;
- operational state transitions;
- stale Open items;
- cross-boundary dependencies;
- material conflicts/unknowns;
- Current retention/GC.
`current.md = fragment1 + fragment2 + fragment3` is never a valid Finalize strategy.
### 8.3 Re-read boundary zones
Semantically re-read enough Raw around Fragment joins and unresolved dependencies to resolve cross-fragment meaning. Fragment metadata does not replace the Raw evidence required to settle adoption, supersession, or state transitions.
### 8.4 Latest safe boundary
Finalize only through the latest safe semantic boundary. Leave any unresolved suffix as Raw Hot Tail even when the supplied Fragments extend farther.

## 9. REPAIR
Use `REPAIR` for already covered continuation state whose persisted Pair or source binding is stale, inconsistent, or damaged.
Prefer the minimum semantic rebuild necessary to restore correctness.
### 9.1 Locator-only mismatch
When content fingerprint matches and locator remapping is deterministic:
- reuse semantic Current content;
- reuse unaffected Segment meaning;
- repair Raw Evidence/KeyRef/attachment locators;
- recompute locator fingerprints;
- preserve unrelated Goals, Decisions, Capsules, and Operational State;
- materialize a new revision only if persisted state actually changes.
Do not rebuild the entire Conversation merely because exporter IDs changed.
### 9.2 Content mismatch
When covered Raw semantic content changed:
1. Locate the earliest affected Segment/range.
2. Read the changed Raw plus sufficient semantic neighbors.
3. Determine which Current objects and later state depend on the changed evidence.
4. Preserve unaffected earlier semantic objects and stable IDs.
5. Rebuild or refine affected Segments and dependent Current objects.
6. Explicitly record any previously verified ranges/material that remain source-identical and semantically unaffected after impact analysis; do not inherit the old Pair wholesale.
7. Re-run retention/GC.
8. Recompute fingerprints and fully validate the result.
Do not continue claiming the old persisted `verified` state after a content mismatch.
### 9.3 Branch, deletion, or reorder
When historical branching, deletion, or reordering changes the covered chronology, preserve the maximal unchanged verified prefix and rebuild the affected suffix from the earliest divergence. Reevaluate Current objects supported only by replaced suffix evidence. Do not patch isolated objects while leaving a semantically replaced suffix represented as valid history.
### 9.4 Attachment content change
When an attachment content digest changes, do not trust filename equality. Inspect the changed attachment when it is context-critical, identify Current/Index semantics that depend on it, and reconcile only the affected meaning plus downstream dependencies. Preserve unrelated state.
### 9.5 Coverage/pair corruption
For coverage/partition corruption, repair only after the actual Raw coverage and Current/Index ownership can be established without guessing.
For pair identity mismatch, never silently merge mismatched Current and Index components. Reuse a component only when it can be independently bound to the source Conversation.
### 9.6 Large repair
Do not remain in `REPAIR` when the affected semantic region is too large for one reliable run. Route that run to repair-origin `STAGED_BUILD`, create source-bound replacement Fragments, and use a later `FINALIZE` run.

## 10. Semantic Reconciliation
Classify each material semantic change using exactly one primary effect:
- `NO_CHANGE`
- `ADD`
- `REFINE`
- `SUPERSEDE`
- `COMPLETE`
- `REOPEN`
- `INVALIDATE`
- `RETIRE`
Use these effects to reason about existing stable objects before rendering a Candidate.
Examples:
- An existing Decision with clarified wording but unchanged semantic identity -> `REFINE` and preserve its ID.
- A newly adopted replacement Decision -> `SUPERSEDE` the old object and `ADD` a new Decision.
- An Open item whose required validation has actually completed -> `COMPLETE` before rolling it into a Milestone if appropriate.
- An allegedly broken feature with no failure evidence -> keep Verification Debt/Unknown; do not manufacture `DEF-*`.
Do not delete history merely to express a state transition.

## 11. Stable Identity
Preserve an existing stable ID when both the semantic object's identity and its namespace/type persist across revisions.
Allocate a new final ID for a genuinely new semantic object or a real namespace/type correction; preserve provenance to the retired/corrected prior object rather than forcing the old ID into the wrong namespace.
For new objects in a Continuation Candidate, use placeholders such as:
- `NEW-DEC-001`
- `NEW-TC-001`
- `NEW-OPEN-001`
- `NEW-SEG-001`
- `NEW-CH-001`
Let the deterministic materializer allocate final IDs and rewrite internal references atomically.
Do not fill historical numeric holes. Allocate new IDs after the maximum existing ID in that namespace.
Keep existing Segment IDs stable during ordinary append maintenance. Split/merge historical Segments only during justified Repair, preserving an existing Segment ID where semantic identity reasonably persists and assigning new IDs only to genuinely new split material.

## 12. Boundary Selection
Choose boundaries semantically, not numerically.
Do not cut between materially coupled units such as:
- proposal and adoption/rejection;
- question and direct answer;
- tool result and immediate interpretation;
- implementation and immediate verification;
- correction and its referent;
- "continue above" and the referenced material;
- attachment introduction and interpretation;
- observed failure and immediate diagnosis.
Semantic closure means the unit is coherent enough to materialize now; it does not mean the topic can never recur.
A boundary must correspond to an actual Canonical Current Message and to the end of a finalized primary Segment.
Persisted Current MUST describe semantic state at the accepted Continuation Boundary. Raw after that boundary MAY be read to judge closure or dependencies, but post-boundary consequences MUST NOT leak into finalized Current, finalized Segments, or other covered continuation claims. Keep them in the Raw Hot Tail until a later revision covers them.
If no worthwhile safe advancement exists, prefer no-op over a mechanically advanced boundary.

## 13. Current Retention and GC
Run a Current retention/GC gate before every final semantic materialization. For pure locator/structural Repair with unchanged content fingerprint and intentionally preserved semantic Current, use `retention_gc.status: audited_no_change` or `not_required_pure_locator_repair` rather than changing unrelated Current semantics. All other One-Shot, Finalize, and semantic Repair runs require `performed`.
Retain a Current item when it materially does at least one of:
- governs future behavior;
- explains the present state;
- supports recurring work;
- represents active operational state;
- prevents a likely regression;
- captures a material unresolved risk.
Before demoting or removing a Current object, confirm the relevant rationale/evidence remains retrievable through Index/Raw; keep a minimal `RET-*` stub only when regression/rationale risk makes continued Current visibility materially useful. Then demote or remove low-value historical detail without losing historical findability.
Do not allow Current to become:
- a chronological transcript;
- a task graveyard;
- a permanent list of superseded Decisions;
- a duplicate of every Segment title;
- a dumping ground for all completed implementation steps.
Do not over-compress Current into an orientation sentence plus one Open item. Preserve enough durable context for a fresh Reader to understand consequential goals, constraints, Decisions, reusable knowledge, boundary state, verification debt, and next actions.
Apply "one fact, one owner": give each durable fact one primary Current owner and use references instead of duplicating divergent wording across objects.

## 14. Index Maintenance
Treat Index as historically conservative navigation, not current truth.
During ordinary append maintenance:
- preserve existing primary Segments and stable IDs;
- append new Segments at semantic closures;
- extend the current Chapter when the same historical era continues;
- create a new Chapter only for a meaningful historical transition;
- keep Segment `about` compact and navigational;
- keep `topics` as retrieval hints, not an ontology;
- keep Key Refs sparse and evidentially useful.
Every Canonical Current Message in finalized coverage must belong to exactly one primary Segment. Do not leave unexplained covered gaps or overlapping primary Segment ownership.
Current owns durable meaning/status. Index owns historical location. Raw owns evidence.

## 15. Continuation Candidate
Build one structured Continuation Candidate before final rendering. Do not independently hand-author finalized Current and Index.
The Candidate is an ephemeral semantic IR containing:
- Conversation identity;
- maintenance mode;
- base revision or no base;
- proposed coverage boundary;
- requested trust target;
- structured Current objects;
- Chapters and Segments;
- stable IDs for existing objects;
- placeholders for new objects;
- Fragment provenance when applicable.
Do not place mechanically derived values in the Candidate when the materializer can compute them. In particular, do not author:
- target continuation revision;
- final message counts;
- Prefix or Segment fingerprints;
- package/member hashes;
- finalized Markdown serialization;
- finalized Index serialization.
The Candidate may request `trust_target: verified` or `provisional`; the deterministic writer decides whether the request is eligible.

## 16. Trust Eligibility
Treat persisted trust as earned state, never decorative metadata. `provisional` relaxes historical completeness, not correctness: a provisional Pair still requires an honest semantic boundary, correct proposal/adoption and state distinctions, complete primary Segment partition for claimed coverage, valid references/fingerprints, and preserved uncertainty.
### 16.1 Verified with inherited verified material
To request `verified` while reusing prior verified work, require:
- every inherited verified prefix/range is source-identical to the material previously verified and is explicitly recorded in the Maintenance Trace;
- for repair, semantic impact analysis confirms the inherited material remains unaffected or the necessary targeted rechecks were completed;
- every newly covered or invalidated accessible Canonical Current Message not safely inherited was semantically read completely;
- required targeted historical dependencies were resolved;
- every context-critical attachment needed for a persisted proposition was inspected, or—if unavailable—the dependent proposition is persisted only as Unknown/Conflict/limited rather than as a stronger supported claim;
- adoption/supersession/scope/state distinctions are resolved or uncertainty is preserved;
- accepted semantic boundary is safe and Current reflects state at that boundary only;
- the required retention/GC gate was satisfied;
- final deterministic validation passes.
Do not treat an old Pair as wholly inherited merely because it was previously `verified`; content mismatch, branch replacement, deletion, reorder, or dependency impact may invalidate only part of that prior work.
### 16.2 Verified without inherited verified material
If no prior verified semantic material can be safely inherited—including Raw-only, fully provisional, Current-only, Index-only, or rebuilt degraded state—verified eligibility requires complete semantic acquisition of every accessible Canonical Current Message in the claimed Stable Prefix. Derived material may guide retrieval/reconciliation but cannot substitute for missing semantic coverage.
### 16.3 Provisional
Use `provisional` when the Pair is structurally and semantically honest/useful but historical semantic coverage/completeness is intentionally incomplete or source limitations prevent verified eligibility. Preserve unread-history exposure and source limitations explicitly; never use provisional trust to excuse unsafe boundaries, broken references/partition, fabricated certainty, or evidence-status inflation.
Do not upgrade provisional to verified because it appears comprehensive. Complete the actual missing semantic coverage, attachment work, reconciliation, and validation first.
### 16.4 No silent downgrade
If `verified` is requested but eligibility fails, reject that trust target unless the Maintainer explicitly chose a provisional fallback. Do not silently write `provisional` while reporting successful verified maintenance.

## 17. Atomic Materialization
Use `materialize_continuation.py` for every finalized Pair produced by One-Shot, Finalize, or Repair.
The materializer must:
1. Re-bind the current source snapshot.
2. Check base continuation revision and optimistic-concurrency preconditions.
3. Validate Candidate and Maintenance Trace structure.
4. Validate Fragment bindings when supplied.
5. Allocate new stable IDs deterministically.
6. Derive coverage message counts from Raw.
7. Build one coherent final Current/Index semantic model.
8. Compute Prefix and Segment content/locator fingerprints with the shared fingerprint implementation.
9. Render deterministic `current.md` and `index.json` from the shared final semantic model.
10. Render manifest continuation metadata from that same coverage/revision model and require `Current coverage == Index coverage == manifest continuation coverage`.
11. Assemble a temporary output package while copying Raw/asset bytes unchanged.
12. Validate the temporary output package.
13. Verify Raw immutability.
14. Publish only if all required gates pass; otherwise discard/rollback the temporary output.
Never perform in-place mutation of the source package by default. Produce a new output package.
Do not silently overwrite an existing output path.

## 18. Concurrency, Revision, and Source Binding
Bind maintenance work to the source snapshot and baseline revision on which semantic work was performed.
Before final materialization, confirm:
- Conversation identity unchanged;
- Raw source binding still matches;
- base Current/Index binding still matches when applicable;
- base continuation revision is still the expected revision.
If the source or base revision changed during maintenance, stop with a stale-input/concurrency conflict. Do not publish analysis derived from an older snapshot onto a newer source.
Increment continuation revision only when a new materialized continuation state is actually published. Locator repair, semantic repair, coverage advancement, or GC changes may justify a new revision. A true no-op does not.

## 19. Raw Immutability
A finalized output package may change only derived continuation material and allowed manifest continuation metadata.
Require source/output Raw bytes to remain unchanged for:
- the Conversation entrypoint;
- asset objects;
- other authoritative Raw package members defined as immutable by the package contract.
ZIP container metadata may differ. Byte-for-byte equality of the whole ZIP is not required; byte identity of authoritative Raw members is.
If Raw bytes differ unexpectedly, fail materialization and do not publish.

## 20. Validation and Rollback
Validate the temporary output with the same deterministic runtime used by the Reader.
For requested/effective `verified`, final validation must yield `valid_verified`.
For requested/effective `provisional`, final validation must yield `valid_provisional`.
Do not publish when:
- Current/Index identity or revision diverges;
- coverage or Segment partition fails;
- explicit references are broken;
- stored/recomputed fingerprints disagree;
- Fragment source binding is stale;
- trust eligibility is not satisfied;
- Raw immutability fails;
- validation returns an incompatible runtime state.
On failure, leave the source package unchanged and preserve enough diagnostics to repeat or repair the maintenance work.

## 21. User-Facing Output
Keep maintenance execution internal unless the user asks for detailed diagnostics.
For successful final materialization, report concisely:
- maintenance mode;
- old and new continuation revision when applicable;
- old and new Stable Prefix boundary when applicable;
- effective trust;
- whether a Raw Hot Tail remains;
- output package/artifact.
For `STAGED_BUILD`, report the Fragment created, sealed range, unsealed tail, and what range/dependency should be acquired next. Do not claim that continuation was finalized.
For no-op maintenance, state that the existing continuation remains unchanged and explain the material reason briefly.
For blocked maintenance, identify the concrete blocker: stale source, stale Fragment, unsupported schema, unresolved semantic dependency, missing critical attachment, concurrency conflict, trust-target failure, or deterministic validation failure.
Do not dump the entire Continuation Candidate, Maintenance Trace, or Current/Index unless the user requests them.

## 22. Final Maintenance Gate
Before claiming successful continuation maintenance, confirm:
- Raw authority and immutability were preserved;
- maintenance mode was correct;
- semantic coverage supports the requested boundary/trust;
- proposal/adoption/supersession distinctions are preserved;
- plan/implementation/testing/verification remain distinct;
- NOT VERIFIED was not converted into BROKEN;
- material scope and conflicts are preserved;
- context-critical attachment dependencies are inspected or their dependent claims are honestly limited/unknown;
- semantic boundary is safe and persisted Current contains no post-boundary state leakage;
- stable IDs were preserved where semantic identity and namespace/type persisted;
- the required Current retention/GC gate was satisfied, including the explicit pure-locator no-change exception when applicable;
- Index remains complete for finalized coverage;
- Candidate and Maintenance Trace agree on the accepted boundary;
- Current, Index, and manifest continuation coverage/revision are atomically aligned;
- source/revision bindings are current;
- final deterministic validation passed;
- authoritative Raw bytes are unchanged;
- published trust exactly matches eligibility.
Only then report the new continuation as successfully materialized.
