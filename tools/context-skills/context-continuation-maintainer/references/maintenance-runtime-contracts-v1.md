# Maintenance Runtime Contracts v1

## Table of Contents
1. Purpose and authority
2. Shared runtime dependency
3. Writer-side objects
4. `write_maintenance_fragment.py`
5. Maintenance Fragment schema
6. `ContinuationCandidate`
7. `MaintenanceTrace`
8. `materialize_continuation.py`
9. Trust eligibility
10. Stable IDs
11. Coverage and Segment partition
12. Atomic package transaction
13. Raw immutability
14. Exit/output conventions
15. Release-gate requirements

## 1. Purpose and authority

This reference defines deterministic Writer-side contracts for Continuation Schema v1.
It does not redefine Raw Conversation parsing, Current parsing, Index parsing, or continuation fingerprints.
Those semantics belong to the shared `_context_package/` runtime and MUST remain byte-identical between `context-acquisition` and `context-continuation-maintainer` release builds.

The Maintainer model performs semantic reconciliation. Writer scripts validate and materialize that work without independently inferring Decisions, supersession, semantic closure, or Current-state meaning.

Raw Conversation and Raw Attachments are immutable authority. Writer scripts MAY change only derived continuation files and allowed manifest continuation metadata.

## 2. Shared runtime dependency

The Maintainer vendors the exact same `_context_package/` source tree as Acquisition.
The shared runtime provides:

- `PackageSource`;
- Canonical Current Message adapters;
- attachment/source-reference models;
- Current parser;
- Index parser;
- `chat-reader-content-v1` fingerprints;
- package inspection;
- continuation validation;
- deterministic extraction.

Do not fork those modules in the Writer runtime.

A development release gate MUST compare relative file sets and SHA-256 values for both vendored `_context_package/` trees against the canonical shared source tree.
The canonical development source is authoritative; release builds vendor from it rather than editing either Skill copy independently.

## 3. Writer-side objects

Writer-specific runtime objects are:

- Maintenance Fragment Candidate;
- Maintenance Fragment;
- Continuation Candidate;
- Maintenance Trace;
- materialization receipt.

Fragments are staged construction artifacts, not Reader continuation state.
Continuation Candidates are ephemeral semantic IR, not finalized Current/Index files.
Maintenance Traces are semantic attestations plus machine-checkable range/source facts; they are not persisted in the final package.

## 4. `write_maintenance_fragment.py`

CLI:

```text
python write_maintenance_fragment.py PACKAGE \
  --candidate fragment-candidate.json \
  [--validation-report validation.json] \
  --output FRAG-001.json \
  [--pretty]
```

The script MUST:

- open the source through `PackageSource`;
- bind the candidate to the actual Conversation;
- validate `input_range` and `sealed_range` against actual Canonical Messages;
- require `sealed_range` to be a subset of `input_range`;
- validate explicit Evidence locators;
- validate local staged candidate IDs;
- validate reconciliation-effect names;
- compute range-level content/locator fingerprints;
- validate attachment dependency IDs;
- write one source-bound Fragment atomically.

The script MUST NOT choose semantic closure, infer adoption, assign final global IDs, create Current/Index, or claim persisted trust.

A candidate with `sealed_range: null` MUST produce `status=no_sealable_prefix` and MUST NOT create a misleading Fragment.

## 5. Maintenance Fragment schema

Candidate schema:

```json
{
  "schema": "chat-reader-maintenance-fragment-candidate",
  "schema_version": "1.0.0",
  "fragment_id": "FRAG-002",
  "conversation_id": "...",
  "base": {"continuation_revision": 7},
  "input_range": {"seq_start": 143, "seq_end": 300},
  "sealed_range": {"seq_start": 143, "seq_end": 289},
  "candidate_segments": [],
  "current_changes": [],
  "durable_knowledge": [],
  "operational_changes": [],
  "evidence_refs": [],
  "attachment_dependencies": [],
  "cross_boundary_dependencies": [],
  "dependency_ranges": [],
  "unsealed_tail": {"seq_start": 290, "seq_end": 300, "reason": "..."}
}
```

New staged semantic objects use local IDs such as:

```text
DEC-CAND-001
TC-CAND-001
SEG-CAND-001
```

Do not allocate final `DEC-*`, `TC-*`, or new `SEG-*` IDs during staged acquisition.

`current_changes[].effect` is one of:

```text
NO_CHANGE
ADD
REFINE
SUPERSEDE
COMPLETE
REOPEN
INVALIDATE
RETIRE
```

`ADD` requires `candidate_local_id` and no `target_id`.
A non-`ADD`, non-`NO_CHANGE` mutation requires an existing `target_id`.

Fragment Evidence uses local `FE-*` identities and explicit `source_scope`:

```text
sealed
inherited
cross_boundary
```

For message Evidence:

- the sequence MUST exist;
- `sealed` Evidence MUST lie inside `sealed_range`;
- `inherited` Evidence MUST lie inside validated inherited coverage;
- explicit message/version IDs, when supplied, MUST resolve exactly.

Final Fragment output includes source bindings for input, sealed, and declared dependency ranges.
Whole-entrypoint SHA-256 is retained for audit, but Fragment reuse eligibility is based on relevant range bindings so a later append does not invalidate an unchanged sealed Fragment.

## 6. `ContinuationCandidate`

Schema:

```json
{
  "schema": "chat-reader-continuation-candidate",
  "schema_version": "1.0.0",
  "conversation_id": "...",
  "maintenance_mode": "ONE_SHOT",
  "base": {
    "continuation_present": true,
    "continuation_revision": 7
  },
  "coverage": {
    "seq_start": 1,
    "seq_end": 608
  },
  "trust_target": "verified",
  "current": {},
  "index": {},
  "fragments_used": []
}
```

The Candidate MUST NOT provide:

- target continuation revision;
- `message_count` as authoritative coverage fact;
- Prefix fingerprints;
- Segment fingerprints;
- final rendered Current Markdown;
- final rendered Index JSON.

Any final stable ID referenced by a Candidate MUST already exist in the reusable, same-Conversation base. New final objects use placeholders:

```text
NEW-DEC-001
NEW-TC-001
NEW-SEG-001
NEW-CH-001
```

The materializer allocates stable IDs once and rewrites all references before rendering.

### Current Candidate model

`current` is structured semantic IR with optional keys:

```text
continuation_brief
orientation.origin
orientation.current_mission
evolution
goals
requirements
constraints
non_goals
conventions
decisions
topic_capsules
state_at_boundary
workstreams
milestones
open_work
defects
verification_debt
blockers
next_actions
assumptions
unknowns
conflicts
retired_stubs
attachment_dependencies
evidence_registry
```

Object-bearing arrays use objects of the form:

```json
{
  "id": "DEC-021",
  "title": "Canonical artifact flow",
  "fields": {
    "Status": "current",
    "Adoption": "user-explicit",
    "History": ["SEG-034"]
  },
  "body": "..."
}
```

### Index Candidate model

`index` contains `chapters` and `segments`.
Candidate Segments omit `message_count` and fingerprints; the materializer computes them from Raw.
Candidate KeyRefs identify message sequence and purpose; the materializer resolves current message/version locators.

## 7. `MaintenanceTrace`

Schema:

```text
chat-reader-maintenance-trace 1.0.0
```

Required control fields include:

- `mode`;
- `conversation_id`;
- source binding;
- baseline revision/inheritance;
- semantic reads;
- targeted rechecks;
- attachment requirements/inspection status;
- accepted boundary;
- semantic gate;
- retention/GC status.

Verified eligibility is evaluated from the Trace plus current deterministic validation state.
`source_binding.conversation_id` and `source_binding.entrypoint_sha256` are required for materialization; an optional `source_binding.entrypoint` must match the active manifest entrypoint.
The Trace's semantic booleans are Maintainer attestations, not machine proof of semantic truth.

`semantic_reads` and `targeted_rechecks` count as full message coverage only when both are true:

```text
every_sequence: true
full_body_required: true
```

`semantic_gate` contains:

```text
adoption_resolved
supersession_resolved
scope_resolved
state_levels_resolved
material_conflicts_preserved
context_critical_dependencies_resolved
```

All must be true before final materialization.

`retention_gc.status` is normally `performed`.
For a pure locator-only Repair with intentionally unchanged semantic Current, `audited_no_change` or `not_required_pure_locator_repair` is allowed when `repair_kind: pure_locator` is declared.

## 8. `materialize_continuation.py`

CLI:

```text
python materialize_continuation.py PACKAGE \
  [--previous-package OLD.context.zip] \
  --candidate continuation-candidate.json \
  --maintenance-trace maintenance-trace.json \
  [--validation-report validation.json] \
  [--fragment FRAG-001.json]... \
  --output OUTPUT.context.zip \
  [--pretty]
```

For two-package maintenance, PACKAGE is the new Raw snapshot and
`--previous-package` supplies the old Continuation. Use the
[package-update workflow](package-update-workflow.md) for complete inventory
bindings, supplementary-context review, repair boundaries and concurrency rules.
Do not supply `--validation-report` in this mode; the writer validates an overlay
of NEW Raw and OLD members itself. The output must preserve NEW Raw and assets,
and both source packages remain unchanged. Candidate and Trace are external
construction inputs, not Chat Reader application candidates or saved sidecars.

The script MUST:

1. open and bind the current source snapshot;
2. validate Candidate/Trace identity and base revision;
3. validate the existing validation report when derived continuation exists;
4. validate supplied Fragment bindings;
5. reject stale Fragments;
6. allocate stable IDs;
7. derive coverage `message_count` from Raw;
8. require complete primary Segment partition of the target Stable Prefix;
9. compute Prefix and Segment fingerprints through the shared runtime;
10. render Current and Index deterministically from one resolved Candidate;
11. update manifest continuation metadata;
12. assemble a temporary output package;
13. check Raw immutability;
14. run the shared deterministic continuation validator;
15. publish only if the final runtime state matches the requested trust.

The script MUST NOT perform semantic reconciliation or silently downgrade requested trust.

`ONE_SHOT`, `FINALIZE`, and `REPAIR` may materialize.
`STAGED_BUILD` may not materialize a final Pair.

## 9. Trust eligibility

For `trust_target=verified`, the source must not be declared incomplete, covered message bodies must be available, and every target Canonical Message must be covered by one of:

- inherited unchanged verified material accepted by the current validation state; or
- a complete semantic read/recheck recorded in the Maintenance Trace.

A `valid_verified` unchanged Stable Prefix may be inherited.
A safe locator-only mismatch with persisted verified trust may inherit semantic content after locator repair.
A `valid_provisional` baseline is not inherited as verified semantic coverage.
Current-only, Index-only, and Raw-only sources do not provide inherited verified coverage.

For partial historical content mismatch, explicit `inherited_verified_ranges` are allowed only when a full validation report proves the corresponding old Segments remain content-identical.

`trust_target=provisional` relaxes historical completeness only. It does not relax Pair consistency, semantic closure, source truthfulness, Segment partition, explicit references, or fingerprint correctness.

The script rejects an ineligible verified request with `trust_target_refused`. It does not silently persist provisional trust.

## 10. Stable IDs

Stable IDs are preserved when semantic identity and namespace/type identity persist.
New placeholders are allocated per namespace using `max(existing numeric ID)+1`.
Historical holes are not reused.

Example:

```text
existing DEC-001, DEC-002, DEC-004
NEW-DEC-001 -> DEC-005
```

Allocation is unified across Current and Index before rendering.

## 11. Coverage and Segment partition

A v1 Stable Prefix begins at the first Canonical Current Message and ends on an actual Canonical Current Message.
Sequence numbers may be sparse; `message_count` is derived from observed Canonical Messages, not arithmetic sequence span.

Every covered Canonical Current Message belongs to exactly one primary Segment.
Segments are chronological and non-overlapping.
A Candidate KeyRef must resolve to an actual message inside its owning Segment.

For `FINALIZE`, inherited Stable Prefix plus supplied Fragment `sealed_range` coverage must support every target covered Canonical Message with no unexplained gap.
Input ranges may overlap for context; final sealed semantic coverage may not contain a black hole.

Persisted Current and Index always describe semantic state at the accepted continuation boundary, never post-boundary Hot Tail state.

## 12. Atomic package transaction

Materialization is out-of-place.
The output path MUST differ from the source and MUST NOT already exist.
For a directory source package, the output MUST also be outside that source directory.

Transaction:

```text
read source
-> copy source members to temporary package tree
-> render new Current/Index
-> update manifest
-> create temporary ZIP
-> check Raw immutability
-> validate temporary ZIP
-> atomically publish output
```

Any failure before publication discards the temporary candidate.

A materialized change increments revision `N -> N+1`; a Raw-only build begins at revision 1.
True no-op handling belongs to the semantic Maintainer workflow and should avoid calling the materializer.

Current, Index, and manifest continuation metadata MUST publish the same continuation revision and coverage.

## 13. Raw immutability

The Conversation entrypoint bytes MUST remain unchanged.
All `assets/` object bytes MUST remain unchanged.
ZIP metadata may differ; whole-ZIP byte identity is not required.

The materializer verifies authoritative Raw bytes before publication.

## 14. Exit/output conventions

Both Writer scripts print one JSON receipt to stdout.
Human diagnostics, if any, belong on stderr.

Successful writes return exit code 0.
Schema, selector, binding, trust, or validation refusal returns a structured nonzero result rather than an uncaught traceback.

Writer receipts never claim that deterministic processing itself semantically understood the Conversation.

## 15. Release-gate requirements

Before packaging the Maintainer Skill:

- run shared `_context_package/` hash equality gate;
- run existing Acquisition IP / VC / ER tests against the canonical shared runtime;
- run Writer MF / MC tests;
- run EX-49 fingerprint vectors;
- validate the final Skill directory;
- package only after all required gates pass.

The full conformance fixture corpus remains a development/release asset and is not bundled into `skill.zip` unless a tiny self-test vector is explicitly needed.
