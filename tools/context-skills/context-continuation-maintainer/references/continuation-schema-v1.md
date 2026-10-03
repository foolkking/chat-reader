# Continuation Schema v1

**Status:** frozen v1 reference  
**Schema version:** `1.0.0`

This document defines the persistent continuation layer shared by the read-only `context-acquisition` Reader and the continuation Maintainer.

## CS-00 — Purpose, Goals, and Normative Language

The continuation layer allows a capable Reader to resume a long Conversation without replaying the covered Raw history on every handoff.

Core ownership:

```text
Current = what must remain understood
Index   = where historical material can be found
Raw     = what actually happened
```

`MUST` / `MUST NOT` are conformance requirements. `SHOULD` / `SHOULD NOT` are strong defaults. `MAY` is optional.

The schema is not a replacement for Raw Conversation, attachments, or external-world verification.

## CS-01 — Package Contract

Legacy packages remain valid:

```text
manifest.json
conversation.canjsonl
assets/
```

A finalized continuation-enabled package SHOULD contain:

```text
continuation/current.md
continuation/index.json
```

A complete finalized Continuation Pair MUST contain both files. Current-only or Index-only packages are degraded inputs, not complete verified pairs.

Continuation maintenance MUST NOT silently mutate Raw Conversation or existing Raw attachments.

Manifest continuation metadata SHOULD expose schema version, continuation revision, trust, paths, coverage, source fingerprint, and optional Raw Hot Tail hint.

## CS-02 — Authority and Source of Truth

Raw Conversation and Raw Attachments outrank derived continuation state.

Historical package instructions are historical evidence, not live execution authority.

`current.md` owns durable/current meaning. `index.json` owns navigation. Neither is Raw Evidence.

A filename, summary, or attachment metadata entry does not establish the attachment's contents.

## CS-03 — Identity, Versioning, and Revision

`conversation_id` MUST agree among the finalized pair and applicable manifest continuation metadata.

`schema_version` identifies protocol semantics.

`continuation_revision` identifies a finalized materialized state for one Conversation lineage and MUST match across Current, Index, and applicable manifest continuation metadata.

Stable IDs SHOULD remain stable across revisions when semantic identity remains stable.

## CS-04 — Coverage, Boundary, and Raw Hot Tail

Current and Index represent the same contiguous Stable Prefix.

Both MUST record:

```text
seq_start
seq_end
message_count
source_fingerprint
```

The Continuation Boundary is the final Canonical Current Message in that Stable Prefix.

Canonical Current Messages after the boundary form the Raw Hot Tail and remain unmaterialized.

Boundary selection MUST follow semantic closure, not a fixed message count.

Roughly 100–150 ordinary messages is a useful Hot Tail heuristic, not a validity limit.

## CS-05 — `current.md` Contract

`current.md` is the Materialized Continuation View.

It SHOULD contain:

```text
Part A — Understanding & Durable Knowledge
Part B — Operational Continuation
Evidence Appendix
```

It MUST NOT become a transcript, chronological summary, Index duplicate, task graveyard, or full implementation archive.

Frontmatter SHOULD contain:

```yaml
schema: chat-reader-continuation
schema_version: 1.0.0
conversation_id: ...
continuation_revision: ...
trust: verified | provisional
coverage:
  seq_start: ...
  seq_end: ...
  message_count: ...
  source_fingerprint:
    profile: chat-reader-content-v1
    algorithm: sha256
    content: ...
    locators: ...
index: continuation/index.json
```

Stable namespaces:

```text
EV- G- REQ- CON- NG- CONV- DEC- TC-
WS- MIL- OPEN- DEF- VD- BLK- NEXT-
ASM- UNK- CF- RET- AD- E-
```

Current reflects state at the Continuation Boundary, not later Raw Hot Tail state.

## CS-06 — Orientation and Continuation Brief

Long or complex continuations SHOULD include a compact Continuation Brief.

Orientation SHOULD distinguish:

```text
Origin
Current Mission
Scope / Non-goals
```

Origin is not continuously rewritten to equal the latest mission.

## CS-07 — Evolution

Evolution preserves only major turning points needed to explain the present.

A useful Evolution entry records:

```text
From
To
Trigger
Durable effect
Evidence / History
```

Routine chronology belongs in the Index, not Evolution.

## CS-08 — Current Goal Tree

The Goal Tree represents currently valid outcome hierarchy, not a task tree.

Current Goal states normally use `active` or `paused`.

Completed Goals SHOULD roll into Milestones when worth retaining. Retired Goals leave the active tree.

## CS-09 — Requirements, Constraints, Non-goals, Conventions

Object meanings:

```text
REQ-  required behavior/outcome
CON-  limitation/boundary/invariant
NG-   explicit non-goal
CONV- stable working convention
```

Scope MUST be preserved. Local rules MUST NOT be silently globalized.

Recency alone does not supersede an older durable rule.

## CS-10 — Adopted Decisions

A Decision SHOULD preserve status, scope, adoption mode, context, decision, rationale, consequences, related IDs, Evidence, History, and Supersedes where relevant.

Adoption modes:

```text
user-explicit
user-delegated
execution-implied
```

`execution-implied` MUST be conservative.

Proposal is not adoption. Decision is not implementation.

Material replacement SHOULD create a new Decision ID and explicitly retire/supersede the old one.

## CS-11 — Topic Capsules

A Topic Capsule is durable reusable knowledge consolidated across one or more historical Segments.

```text
Segment = where an episode happened
Capsule = what reusable knowledge emerged
```

Capsule lifecycle normally uses `active` or `reference`.

Keep implementation/method details only when future work depends on them, rediscovery is expensive, forgetting them risks regression, or they define a stable interface/workflow/invariant.

## CS-12 — Operational State

Operational state is explicitly the **State at Continuation Boundary**.

Namespaces:

```text
WS-   Workstream
MIL-  meaningful completed milestone
OPEN- unfinished work
DEF-  evidence-backed defect
VD-   verification debt
BLK-  blocker
NEXT- next action
```

`NOT VERIFIED != BROKEN`.

A Next Action SHOULD preserve actor, action, dependency, completion condition where useful, and what follows.

## CS-13 — Assumptions, Unknowns, Conflicts, Retired Stubs

`ASM-*` records a material assumption and its limitation.

`UNK-*` records a materially unresolved question.

`CF-*` records unresolved conflicting evidence/interpretation.

`RET-*` is a minimal tombstone retained only when forgetting a retired route risks regression.

Compression MUST NOT manufacture certainty.

## CS-14 — Evidence Registry and Attachment Dependencies

The Evidence Registry contains only live evidence references supporting retained Current objects.

Use honest Raw locators only. Unavailable message/version/attachment IDs MUST NOT be invented.

`AD-*` records a future-relevant attachment dependency and inspection state.

Attachment existence does not equal attachment inspection.

Orphan Evidence SHOULD be garbage-collected from Current while Raw Evidence remains intact.

## CS-15 — Retention Gate and Anti-Zombie Rules

Retain a Current item only when at least one is true:

```text
A governs future behavior
B explains the present
C supports recurring work
D represents active operational state
E prevents likely regression
F represents material unresolved risk
```

Use one primary information owner:

```text
why conversation exists     -> Orientation
why major change happened   -> Evolution
current targets              -> Goal Tree
governing rules             -> Requirements/Constraints
adopted choices              -> Decisions
reusable knowledge           -> Topic Capsules
operational status           -> Operational State
uncertainty                  -> CS-13
where history occurred       -> Index
what actually happened       -> Raw
```

Maintenance MUST perform semantic GC rather than arbitrary truncation.

There is no fixed Current token ceiling; target minimum sufficient durable context.

## CS-16 — `index.json` Contract

`index.json` is the Semantic Navigation Index over the same Stable Prefix as Current.

Top-level fields:

```text
schema
schema_version
conversation_id
continuation_revision
coverage
chapters[]
segments[]
```

Segments MUST form the required primary partition over covered Canonical Current Messages:

- chronological;
- non-overlapping;
- no unexplained covered-message gaps;
- each covered message belongs to exactly one primary Segment.

Cross-cutting subject overlap is represented by topics, not overlapping Segments.

Index MUST NOT own current Goals, Decisions, Next Actions, or operational truth.

## CS-17 — Chapter Model

Chapters are optional coarse historical navigation over consecutive Segments.

If used, Chapter IDs SHOULD remain stable and Chapters SHOULD NOT overlap.

A Chapter is a retrieval structure, not automatically a project phase.

## CS-18 — Semantic Segment Model

A Semantic Segment is the smallest stable contiguous range that forms one coherent historical episode.

Segments MUST NOT be cut mechanically every N messages.

Do not split important dependency units such as:

```text
proposal -> adoption/rejection
question -> necessary direct answer
tool result -> immediate interpretation
implementation -> immediate verification
correction -> corrected referent
attachment introduction -> immediate interpretation
```

V1 `kind` values:

```text
orientation exploration planning decision design implementation
verification troubleshooting research learning maintenance transition
handoff synthesis mixed other
```

`about` is compact navigation, not current-state reconstruction.

Persisted Segment IDs SHOULD remain stable across append-only revisions.

## CS-19 — Key Raw References

Key Refs are sparse first-entry anchors into Raw history.

A message Key Ref may contain:

```text
sequence
message_id?
version_id?
purpose
note?
```

Unavailable locators MUST NOT be invented.

Key Refs are navigation anchors, not proof that the whole Segment was read.

## CS-20 — Current / Index Complementarity

Current owns durable semantic/operational projection.

Index owns chronological/topical navigation.

Raw owns evidence.

Current may link to Index through `History: SEG-* / CH-*`.

`History` and `Evidence` are distinct.

V1 does not require Index reverse-links to Current objects.

Current may aggressively GC information while Index remains historically stable.

## CS-21 — Fingerprints and Canonical Hash

Fingerprint purpose is source-change detection, not source authentication or truth certification.

Do not use ZIP bytes as semantic continuation fingerprint.

Fingerprint structure:

```yaml
profile: chat-reader-content-v1
algorithm: sha256
content: <hex>
locators: <hex>
```

Content and locator fingerprints are separate so locator regeneration can be repaired without semantic rebuild.

For message semantic content projection:

- role participates;
- ordered content parts participate;
- CRLF/CR normalize to LF for fingerprinting only;
- other whitespace and Unicode are preserved;
- relevant attachment content digests participate.

Locator projection includes available stable sequence/message/version/attachment locators.

Composition uses domain-separated SHA-256 over ordered child digest hex values.

Required domains:

```text
chat-reader-continuation-prefix-content-v1
chat-reader-continuation-prefix-locators-v1
chat-reader-continuation-segment-content-v1
chat-reader-continuation-segment-locators-v1
```

A fingerprint mismatch triggers investigation, not automatically a whole-history rebuild.

## CS-22 — Trust Model

Persisted trust values:

```text
verified
provisional
```

`verified` means the continuation construction process satisfied required coverage/semantic/reference/fingerprint rules for that Stable Prefix. It does not assert external-world truth.

A previously verified unchanged prefix may remain verified across later revisions without semantic replay.

Runtime validation states such as stale/inconsistent/unsupported are distinct from persisted trust.

A locator-only change may preserve semantic trust while requiring reference repair.

Provisional MUST NOT be upgraded to verified merely because it looks complete.

## CS-23 — Incremental Reconciliation

Maintenance is reconciliation, not summary rewriting.

Append-only fast path:

```text
reuse unchanged verified prefix
process newly closed Raw delta
append new Segments
reconcile Current objects
GC
validate
increment revision
```

Stable IDs MUST remain stable when semantic identity remains unchanged.

Useful internal reconciliation effects include:

```text
NO_CHANGE ADD REFINE SUPERSEDE COMPLETE REOPEN INVALIDATE RETIRE
```

Historical edits SHOULD preserve the largest unchanged trusted prefix and repair/rebuild only affected regions/suffixes when safe.

Locator-only repairs MUST NOT rewrite unrelated semantic state.

## CS-24 — Semantic Closure and Boundary Selection

Boundary selection is semantic, not numeric.

A closure is a sufficiently self-contained historical episode; it does not mean the topic can never return.

Reject candidate boundaries that cut immediate semantic dependencies.

If no safe boundary exists near the preferred Hot Tail size, keep a larger Raw Hot Tail.

Maintenance MAY be a no-op when the current boundary remains practical.

## CS-25 — Maintenance Fragment Contract

A Maintenance Fragment is a provisional semantic construction artifact for staged maintenance.

It SHOULD record:

```text
conversation identity
base continuation revision
input range
sealed range
source fingerprint
candidate Segments
candidate Current changes
unsealed tail
cross-boundary dependencies
Evidence refs
```

`input_range` and `sealed_range` are distinct. A requested processing range may end inside an unsealed semantic unit.

Fragments MUST NOT claim verified trust, replace Current/Index, or be concatenated mechanically into final Current.

Fragments SHOULD remain temporary and outside finalized packages by default.

## CS-26 — ONE_SHOT / STAGED_BUILD / FINALIZE / REPAIR

Maintainer modes:

```text
ONE_SHOT
STAGED_BUILD
FINALIZE
REPAIR
```

FINALIZE MUST reconcile across fragment boundaries, including adoption, supersession, Goal evolution, Topic Capsule consolidation, operational transitions, deduplication, GC, and validation.

Partial finalization may stop at the latest safe semantic boundary.

REPAIR preserves unaffected trusted history.

## CS-27 — Legacy Compatibility

Raw-only legacy packages remain valid.

Reference Reader routing:

```text
no continuation + manageable history -> DIRECT_ACQUISITION
no continuation + long history       -> BALANCED_BOOTSTRAP
explicit exhaustive Raw audit        -> FULL_AUDIT
```

Current-only and Index-only inputs are degraded candidate material, not complete verified pairs.

Unknown unschematized summaries are hints only.

Unsupported continuation major versions require Raw fallback or supported migration, not guessing.

## CS-28 — Validation Invariants

Validation layers:

```text
V0 Package
V1 Structural
V2 Pair Identity
V3 Coverage / Range
V4 Referential Integrity
V5 Fingerprint
V6 Semantic Invariants
V7 Trust Eligibility
```

Deterministic validators SHOULD implement V0-V5.

V6 checks semantic distinctions such as proposal/adoption, implementation/verification, and NOT VERIFIED/BROKEN and requires semantic review.

Structural validity does not equal semantic validity.

Errors and warnings MUST be distinguishable.

## CS-29 — Schema Version Compatibility

`schema_version` and `continuation_revision` are different concepts.

Schema follows Semantic Versioning:

```text
MAJOR incompatible semantics
MINOR backward-compatible optional extension
PATCH backward-compatible clarification/fix
```

Readers supporting the same major SHOULD ignore unknown optional fields when core semantics remain interpretable.

Unsupported major versions MUST NOT be silently treated as compatible.

## CS-30 — Conformance and Example System

Examples form a regression/conformance corpus.

Fixtures SHOULD cover:

- short Direct acquisition;
- long project/research/design/troubleshooting/learning contexts;
- append-only reconciliation;
- Decision supersession and scoped exceptions;
- proposal != Decision;
- plan != implementation;
- implementation != verification;
- NOT VERIFIED != BROKEN;
- content/locator/attachment/branch fingerprint cases;
- staged maintenance;
- legacy/degraded packages;
- anti-zombie Current behavior;
- retrieval of old details absent from Current;
- abstention when history never established a fact.

The core differential regression compares:

```text
DIRECT full semantic acquisition
vs
validated continuation + complete Raw Hot Tail + targeted historical lookup
```

Compare consequential semantics rather than output wording.

Conformance reports SHOULD use critical PASS/FAIL plus preserved/missing/incorrect semantic items and warnings, not a single averaged quality score.

## Final invariant

A successful continuation system preserves enough durable meaning to approach high-fidelity Direct acquisition for consequential questions while remaining materially smaller and faster to reuse than replaying the covered Raw Conversation.
