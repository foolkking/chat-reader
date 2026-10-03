# Continuation Examples v1

**Status:** Draft conformance corpus with executable regression subset for `Continuation Schema v1`  
**Target schema version:** `1.0.0`  
**Companion specification:** `continuation-schema-v1.md`  
**Primary consumers:** `context-acquisition`, `context-continuation-maintainer`, validators, and human reviewers.

---

# 0. Purpose

This document is the conformance and example corpus for `Continuation Schema v1`.

It is not a tutorial and it is not a collection of decorative examples. Its purpose is to make the semantic rules of the schema operational and testable.

The corpus MUST help a maintainer or reader answer questions such as:

- What should enter `current.md`, and what should remain only in `index.json` or Raw Evidence?
- When does a historical episode become a Semantic Segment?
- What counts as an adopted Decision rather than a proposal?
- What counts as implementation, verification, a known Defect, or Verification Debt?
- How should an old Decision be superseded without erasing history?
- How should Topic Capsules be promoted, compressed, demoted, and retired?
- How should append-only updates reuse the verified prefix?
- How should historical edits, locator changes, attachment changes, and branch changes be handled?
- How should long maintenance be split into Fragments without recreating low-value checkpoints?
- How should a continuation remain rich enough for high-quality handoff without becoming a second transcript?

The central evaluation target is:

> A continuation should preserve enough durable meaning that a capable reader can approach the quality of high-fidelity direct acquisition on consequential questions, while remaining much smaller and faster to reuse than replaying the covered Raw Conversation.

---

# 1. How to Use This Corpus

## 1.1 Conformance roles

This corpus is used by four roles:

1. **Maintainer** — creates or updates `current.md` and `index.json`.
2. **Reader** — reconstructs Working Context from the Continuation Pair plus Raw Hot Tail.
3. **Validator** — checks structure, references, fingerprints, pair consistency, and semantic invariants.
4. **Human reviewer** — judges whether continuation quality is sufficient and whether compression introduced drift.

## 1.2 PASS / FAIL / WARN

Each case may define:

- **Critical PASS criteria** — must hold.
- **Critical FAIL conditions** — any one is a conformance failure.
- **WARN conditions** — suspicious but not necessarily invalid.

A high average quality score MUST NOT cancel a critical failure such as:

- a proposal promoted to an adopted Decision;
- a still-valid Constraint being lost;
- implementation promoted to verification;
- `NOT VERIFIED` promoted to `BROKEN`;
- a local exception incorrectly generalized globally;
- Raw Evidence being overridden by a derived summary.

## 1.3 Fixture classes and notation

The corpus intentionally contains two fixture classes.

### `[SEMANTIC]` fixtures

Most examples are compact semantic conformance cases. They specify the raw pattern, expected interpretation, forbidden interpretation, and/or reconciliation behavior without carrying a full exporter-sized source package.

They are normative for semantic behavior but are not by themselves byte-for-byte regression fixtures.

Notation:

```text
U[n]: user message at sequence n
A[n]: assistant message at sequence n
T[n]: tool/result record associated with sequence n
ATT-x: attachment
```

### `[EXECUTABLE]` fixtures

Release-critical behavior SHOULD additionally be backed by deterministic fixture files. An executable fixture uses a file set such as:

```text
fixtures/<fixture-id>/
├── raw.canjsonl
├── expected-current.md          # when a materialized Current is part of the fixture
├── expected-index.json          # when a materialized Index is part of the fixture
└── assertions.json              # machine-checkable semantic / state assertions
```

The fixture files are the machine-consumable source of truth for that executable case. The prose in this document explains the intent and release criterion.

The companion executable subset for this revision is packaged under `continuation-conformance-fixtures-v1/`. `fixture-manifest.json` records file paths, byte sizes, and SHA-256 digests so a test harness can verify that it is running the intended fixture revision.

`raw.canjsonl` in the conformance bundle is a minimal canonical-message fixture projection used by the test harness. It is not a claim that every Chat Reader exporter must serialize raw messages with exactly the same wire fields. Production readers still map exporter records into Canonical Current Messages according to the schema.

Real implementations MUST use actual source identities and MUST NOT invent unavailable IDs.

## 1.4 Required output dimensions

Where applicable, each fixture evaluates:

- Orientation;
- Evolution;
- Goal Tree;
- Requirements / Constraints / Non-goals / Conventions;
- Adopted Decisions;
- Topic Capsules;
- State at Continuation Boundary;
- Workstreams;
- Milestones;
- Open Work;
- Defects;
- Verification Debt;
- Blockers;
- Next Actions;
- Assumptions / Unknowns / Conflicts;
- Retired Stubs;
- Evidence Registry;
- Index Chapters;
- Semantic Segments;
- Key Refs;
- fingerprints;
- trust;
- boundary selection;
- retention / demotion behavior.

---

# 2. Global Conformance Invariants

Every fixture inherits these invariants unless it explicitly tests a degraded mode.

## INV-01 — Raw authority

Raw Conversation and Raw Attachments remain authoritative.

`current.md` and `index.json` MUST NOT override contradictory Raw Evidence.

## INV-02 — Current / Index separation

```text
current.md = durable/current meaning and operational state
index.json = historical navigation
Raw          = what actually happened
```

## INV-03 — Same Stable Prefix

A finalized `current.md` and `index.json` MUST represent the same:

- Conversation;
- continuation revision;
- coverage;
- source fingerprint.

## INV-04 — Boundary state

`current.md` describes state at the Continuation Boundary.

Raw Hot Tail is reconciled by the Reader to obtain current Working Context.

## INV-05 — Proposal is not adoption

Assistant proposal alone MUST NOT become an adopted Decision.

## INV-06 — Plan is not implementation

A request or plan to do work MUST NOT become completed work without implementation evidence.

## INV-07 — Implementation is not verification

Implementation evidence MUST NOT automatically become verification evidence.

## INV-08 — Not verified is not broken

Unverified behavior belongs in Verification Debt unless actual failure evidence exists.

## INV-09 — Recency is not supersession

Newer material does not automatically cancel older durable rules.

## INV-10 — Current is aggressively maintained

Current SHOULD be compacted semantically through Retention / GC.

## INV-11 — Index is historically conservative

Index SHOULD preserve historical navigability and stable Segment identities.

## INV-12 — Honest uncertainty

Unknowns, assumptions, and conflicts MUST remain explicit when evidence does not support certainty.

---

# Part I — Conversation Archetypes

# EX-01 — Short Direct Conversation

**Purpose:** Validate that the new system does not weaken the high-fidelity continuation behavior expected for an ordinary conversation of roughly 80–150 messages.

## Input pattern

Assume 132 ordinary messages covering:

- initial project goal;
- three durable constraints;
- two design alternatives;
- explicit adoption of one alternative;
- implementation discussion;
- one reported implementation result;
- one unverified production path;
- recent open work;
- no existing continuation layer.

Representative snippets:

```text
U[4]: I want a reusable materials-analysis workspace, not isolated plotting demos.
A[5]: Proposes architecture A and architecture B.
U[8]: Use B, but keep provenance as a project-wide rule.
...
U[71]: Implement the shared artifact flow.
A[96]: Reports that the shared artifact flow is implemented.
U[101]: I have not run the full production path yet.
...
U[129]: Next I want to review the duplicated interaction surfaces before changing them.
```

## Expected Reader mode

```text
DIRECT
```

The Reader SHOULD fully acquire all Canonical Current Message bodies rather than use Bootstrap.

## Expected Working Context

Must recover at least:

```text
Origin:
Reusable materials-analysis workspace rather than isolated demos.

Constraint:
Preserve provenance project-wide.

Decision:
Architecture B is adopted.

State:
Shared artifact flow is reported implemented.

Verification Debt:
Full production path remains unverified.

Next:
Review duplicated interaction surfaces before implementation.
```

## Forbidden interpretations

Critical FAIL if:

- architecture A is recorded as adopted merely because the assistant proposed it first;
- production path is described as verified;
- provenance constraint is lost because it appeared early;
- next action is changed from review to implementation.

## Golden questions

A conformant Reader should answer:

1. Why did this Conversation begin?
2. Which architecture was actually adopted?
3. What durable rule must future implementation preserve?
4. What is implemented?
5. What remains unverified?
6. What is the next action, and who performs it?

---

# EX-02 — Long Software / Product Project

**Purpose:** Validate the full two-layer `current.md` model for a long-running project Conversation.

## Input pattern

A 700+ message product/engineering Conversation evolves through:

```text
Initial scientific data + visualization idea
    ↓
Platform architecture
    ↓
Artifact / schema / workflow model
    ↓
Scientific viewers
    ↓
Reliability / regression work
    ↓
Production UI/UX consolidation
```

Representative durable facts:

```text
- The product must not collapse into a generic chat UI.
- Repeated UI patterns should share a reusable framework.
- Scientific provenance must be preserved.
- Independent viewer interaction flows were intentionally superseded.
- Current focus is UI/UX consolidation, not basic viewer construction.
```

## Expected `current.md`

### Part A should contain

**Orientation**

```text
Origin:
Materials-oriented intelligent analysis + visualization platform.

Current Mission:
Consolidate a coherent production-grade materials intelligence platform.
```

**Evolution**

At least the major direction changes, but NOT every phase.

Example:

```markdown
### EV-003 — From isolated viewers to integrated scientific presentation
From: viewer-specific flows
To: shared platform artifact/workbench flow
Trigger: duplicated interactions and inconsistent downstream behavior
Durable effect: future viewer work extends the shared platform path
History: SEG-031, SEG-034
```

**Goal Tree**

```text
G-001 Materials Intelligence Platform
├── G-004 Data Platform
├── G-008 Research Agent
├── G-012 Scientific Presentation
└── G-017 Production Reliability / UX
```

**Requirements / Constraints / Non-goals**

Must preserve only still-valid durable rules.

**Decisions**

Must preserve current adopted choices, not all historical alternatives.

**Topic Capsules**

Expected examples:

```text
TC-007 Scientific Structure Viewer
TC-011 Scientific Artifact Model
TC-021 Shared Interaction Framework
```

### Part B should contain

```text
State at Continuation Boundary
Current Workstreams
Important Milestones
Open Work
Known Defects
Verification Debt
Blockers
Next Actions
```

## Expected `index.json`

For a long Conversation, Chapters are useful:

```text
CH-001 Initial platform definition
CH-002 Data/schema/artifact architecture
CH-003 Scientific viewer integration
CH-004 Reliability and repair
CH-005 Production UI/UX consolidation
```

Each Chapter contains non-overlapping consecutive Segments.

## Anti-zombie expectations

MUST NOT preserve as full Current items:

- every bug ever fixed;
- every test command;
- every phase label;
- every historical assistant proposal;
- every completed UI tweak;
- complete old viewer architecture.

Old material remains retrievable in Index/Raw.

## Critical FAIL conditions

- `current.md` becomes a chronological project diary;
- `index.json` duplicates current state;
- retired viewer architecture remains as a full active Topic Capsule;
- completed minor work remains as dozens of Open/Milestone objects;
- the early product non-goal is lost.

---

# EX-03 — Research Project

**Purpose:** Demonstrate that the schema is not software-project-specific.

## Input pattern

A research Conversation develops through:

```text
Multimodal Agent
    ↓
VLA / Embodied AI
    ↓
Efficient VLA vs memory/KV/cache discussion
    ↓
paper reading + benchmark work
    ↓
OpenVLA + LIBERO reproduction
    ↓
research direction remains intentionally not fully frozen
```

Representative evidence:

```text
U[22]: My advisor explicitly said VLA.
U[47]: He is more likely to focus on acceleration.
U[61]: Memory may be easier to operate with limited resources.
U[83]: First read papers and make reviews before fixing the direction.
U[140]: I want OpenVLA + LIBERO reproduction before LoRA.
```

## Expected Current

### Orientation

```text
Origin:
Research direction initially centered on multimodal agents.

Current Mission:
Build a VLA/Embodied AI research foundation with emphasis on efficient inference, memory/cache and reproducible evaluation before committing to a narrower publication topic.
```

### Evolution

Expected high-value transitions:

```text
EV-001 Multimodal Agent → VLA
EV-002 Broad VLA → efficiency / memory-oriented research questions
EV-003 Direction discussion → paper/benchmark/reproduction-first strategy
```

### Goal Tree

```text
G-001 VLA / Embodied AI research capability
├── G-004 Literature / benchmark understanding
├── G-006 OpenVLA + LIBERO reproducible baseline
├── G-009 Efficient VLA / memory research exploration
└── G-011 Experimental efficiency measurement
```

### Topic Capsules

Examples:

```text
TC-004 Efficient VLA
TC-005 KV / Cache / Memory Optimization
TC-009 LIBERO Evaluation Pipeline
TC-011 OpenVLA Reproduction Method
```

### Unknown / Decision status

Important:

```text
Do NOT fabricate a final research-topic Decision if the user deliberately postponed it.
```

This may remain:

```markdown
### UNK-004 — Final narrow research topic
Question: Efficient VLA acceleration or memory/cache-focused method?
Known: both remain plausible; paper review and reproducible baseline are prerequisites.
Impact: do not claim the final research direction is frozen.
```

## Critical FAIL conditions

- “advisor mentioned memory” becomes “final decision is memory”;
- “advisor likely focuses acceleration” becomes a project-wide requirement to publish only acceleration work;
- reproduction result is promoted to research conclusion without evidence;
- historical multimodal-agent stage clutters Current after no longer being needed except as Evolution context.

---

# EX-04 — Open-ended Decision / Exploration

**Purpose:** Validate a Conversation where the main product is structured reasoning, not implementation.

## Input pattern

Question:

```text
Should I focus on Efficient VLA or Memory/KV/cache?
```

Discussion includes:

- advisor guidance;
- hardware/resource limits;
- novelty concerns;
- publication feasibility;
- transfer from VLM research;
- user's desire not to freeze direction too early.

No explicit final choice is made.

## Expected Current

Should emphasize:

```text
Orientation / decision context
Criteria
Durable constraints
Relevant Topic Capsules
Current leaning if explicitly expressed
Unknowns / unresolved factors
Next evidence-gathering action
```

MUST NOT invent:

```text
DEC-001 — Choose Efficient VLA
```

unless evidence actually supports adoption.

## Useful structure

```markdown
### TC-003 — Efficient VLA option
Current evidence:
...
Tradeoffs:
...

### TC-004 — Memory / KV / Cache option
Current evidence:
...
Tradeoffs:
...

### UNK-002 — Final specialization choice
...

### NEXT-003 — Complete targeted paper/benchmark review before narrowing the topic
Actor: user
```

## Index expectation

A Segment may be `kind: synthesis` or `kind: exploration`.

Index MUST describe the historical comparison without declaring a winner.

---

# EX-05 — Troubleshooting / Incident

**Purpose:** Validate diagnostic history, rejected hypotheses, root-cause evidence, and next minimal tests.

## Input pattern

```text
U[10]: Retry delay settings do not seem to work.
A[11]: Hypothesis A: wrong config key.
U[24]: Shows config file.
A[25]: Hypothesis B: runtime binary ignores it.
U[41]: PowerShell output shows runtime paths.
A[42]: Earlier path assumption is wrong.
U[57]: New binary behaves differently.
U[63]: Still no proof the exact retry constant changed.
```

## Expected Current

### Orientation

Problem and environment.

### Evolution

Diagnostic transitions only if still explanatory:

```text
Initial assumption: config-only issue
→ runtime-path discovery
→ binary/runtime behavior becomes primary hypothesis
```

### Topic Capsule

```text
TC-005 Codex runtime layout / retry behavior
```

Should preserve stable environment knowledge and important ruled-out assumptions.

### Operational state

```text
Known:
runtime path discovered.

Unknown:
exact retry backoff source not yet proven.

Next:
inspect/patch compiled runtime or locate already-built binary.
```

## Forbidden

- Every command becomes a Topic Capsule.
- A suspected root cause is written as confirmed.
- Missing verification becomes a Defect beyond observed behavior.

---

# EX-06 — Learning / Tutoring Conversation

**Purpose:** Validate a long learning Conversation where durable knowledge and learning progress matter more than project state.

## Input pattern

A learner studies:

```text
ACT → CVAE → action chunking → encoder roles → deployment differences
```

The learner repeatedly asks follow-up conceptual questions.

## Expected Current

### Orientation

```text
Learning goal:
Understand VLA/robot-learning paper concepts deeply enough to read and critique papers rather than memorize terminology.
```

### Goal Tree

```text
G-001 Build VLA paper-reading foundation
├── G-003 Understand ACT / CVAE
├── G-004 Understand action chunking
└── G-005 Connect training-time and inference-time semantics
```

### Topic Capsules

```text
TC-002 ACT
TC-003 CVAE role
TC-004 Action Chunking
```

A Capsule may include:

```text
Concept
Intuition
Formal role
Common confusion
Relationship to neighboring concepts
```

### Operational state

May include:

```text
Mastered material
Current confusion
Next learning step
```

## Must not force software-only sections

No need to invent:

```text
Known Defects
Deployment
Milestones
```

if they do not fit.

---

# EX-07 — Design / Document Iteration

**Purpose:** Validate a Conversation where artifacts/design principles evolve through feedback.

## Input pattern

```text
Draft 1
→ user rejects floating panel location
→ proposes reference style
→ user accepts style but rejects navigation behavior
→ Draft 2
→ user accepts layout principle
```

## Expected Current

### Evolution

```text
EV-002 — From detached floating panel to anchored context-sensitive panel
```

### Decisions

Only explicitly adopted design principles.

### Topic Capsules

```text
TC-006 Floating Panel Placement
TC-007 Interaction / Navigation Behavior
```

### Retired Stub

If the old approach is likely to recur:

```text
RET-003 — detached lower-page floating window
Replaced by: DEC-008 / TC-006
Why retained: reintroducing it recreates the original placement problem.
```

## Critical FAIL

A rejected style remains in Current as if still valid.

---

# EX-08 — Mixed Research + Engineering Project

**Purpose:** Validate a Conversation containing research understanding, implementation, evaluation, and resource constraints simultaneously.

## Input pattern

OpenVLA + LIBERO reproduction:

```text
Research understanding
→ environment setup
→ official checkpoint evaluation
→ dataset inspection
→ efficiency metrics
→ user decides not to run M6 yet
```

## Expected Current

### Part A

```text
Origin / Mission
Goal Tree
Constraints:
- GPU-first preference
- official LIBERO RLDS conventions
- unnorm_key correctness
- success detection correctness

Topic Capsules:
- OpenVLA evaluation pipeline
- LIBERO observation/action conventions
- normalization / unnormalization
- efficiency measurement
```

### Part B

```text
WS evaluation baseline
MIL environment setup
OPEN evaluation diagnosis
VD full strict A/B not yet complete
NEXT non-training analysis before M6
```

## Critical semantic rule

User statement:

```text
“I do not want to execute M6 now.”
```

MUST NOT be lost merely because the old roadmap listed M6 next.

This is an example where later user direction supersedes an earlier planned next step without rewriting the whole historical roadmap.

---

# Part II — Incremental Reconciliation Cases

# EX-09 — Append-only Update

**Purpose:** Validate the main fast path.

## Before

```text
Continuation revision: 7
Verified coverage: 1–300
Raw Conversation end: 300
```

Stable objects:

```text
G-001
CON-003
DEC-004
TC-005
SEG-001 ... SEG-012
```

## New raw delta

```text
301–360 appended
1–300 content + locator fingerprints unchanged
```

History 301–342 forms one closed semantic episode.

343–360 remains unresolved.

## Correct update

```text
New continuation boundary: 342
New raw tail: 343–360
Continuation revision: 8
```

Preserve unchanged IDs:

```text
G-001
CON-003
DEC-004
TC-005
SEG-001 ... SEG-012
```

Append:

```text
SEG-013 = 301–342
```

Only semantic consequences of 301–342 should reconcile Current.

## Critical FAIL

- re-reading 1–300 as if no verified continuation existed;
- regenerating all Segment IDs;
- changing unchanged Current IDs;
- absorbing 343–360 despite unresolved semantic dependency.

---

# EX-10 — Decision Supersession

## Raw pattern

```text
U[40]: Use architecture B.
...
U[180]: B is causing duplicated flows. Replace it with architecture C everywhere.
```

## Before

```markdown
### DEC-004 — Use architecture B
Status: current
Adoption: user-explicit
```

## Correct after

```markdown
### DEC-011 — Use architecture C
Status: current
Adoption: user-explicit
Supersedes: DEC-004
```

`DEC-004` leaves active Decisions.

If forgetting B would likely cause regression:

```markdown
### RET-004 — Architecture B
Replaced by: DEC-011
Why retained: avoid reintroducing duplicated flows.
History: SEG-006, SEG-021
```

## Wrong

Editing `DEC-004` in place so that it now says architecture C.

That destroys historical identity.

---

# EX-11 — Scoped Exception Without False Globalization

## Before

```text
DEC-004:
Architecture B is the project-wide default.
```

## New message

```text
U[210]: Keep B as the default, but module X must use C because its runtime constraint is different.
```

## Correct

```markdown
### DEC-004 — Architecture B as project-wide default
Status: current
Scope: project-wide except explicit exceptions

### DEC-012 — Module X uses architecture C
Status: current
Scope: module X
Adoption: user-explicit
Related: DEC-004
```

## Critical FAIL

Replacing global B with global C.

---

# EX-12 — Goal Split / Evolution

## Before

```markdown
### G-001 — Build a materials intelligence platform
State: active
```

## New history

The broad mission stabilizes into four durable sub-goals.

## Correct

```text
G-001 remains parent
├── G-004 Data Platform
├── G-008 Research Agent
├── G-012 Scientific Presentation
└── G-017 Production Reliability
```

This is refinement, not replacement.

## Wrong

Retiring G-001 and creating four unrelated top-level Goals when the umbrella goal remains valid.

---

# EX-13 — Topic Capsule Lifecycle

## Revision 3

```text
TC-007 lifecycle: active
```

Detailed because it is the main current implementation topic.

## Revision 7

Work shifts elsewhere, but the method remains likely to be reused.

Correct:

```text
TC-007 lifecycle: reference
```

Compress to:

- stable method;
- invariant;
- key pitfall;
- History;
- Evidence.

## Revision 12

The entire method is replaced and future reuse is unlikely.

Correct:

- remove full `TC-007`;
- optionally preserve `RET-*` if regression risk exists;
- keep all historical Segments in Index.

## Critical FAIL

Leaving every Capsule forever as `active`.

---

# EX-14 — Completed Work Roll-up

## Raw history

Twenty minor tasks complete a scientific-viewer baseline:

```text
- add route
- fix adapter
- fix labels
- add XRD
- fix XRD
- add RDF
- update viewer
- update browser test
- fix export
- ...
```

## Wrong Current

```text
MIL-101 Add route
MIL-102 Fix adapter
MIL-103 Fix labels
...
MIL-120 Fix export
```

## Correct Current

```markdown
### MIL-018 — Scientific viewer baseline completed

Outcome:
Structure, XRD, and RDF viewer capabilities were integrated into the shared presentation workflow.

Verification:
Covered browser/API checks passed; production-equivalent end-to-end verification remains VD-004.

History:
CH-006
```

Detailed tasks remain only in Index/Raw.

---

# Part III — Evidence and State Error Cases

# EX-15 — Proposal Is Not Decision

## Raw

```text
A[20]: I recommend option A.
A[25]: A would simplify deployment.
U[30]: I am not choosing yet. Compare A and B first.
```

## Correct

No adopted Decision exists.

May preserve:

```text
OPEN / UNK / Topic Capsule comparing alternatives
```

## Critical FAIL

```markdown
### DEC-002 — Use option A
```

---

# EX-16 — Plan Is Not Implementation

## Raw

```text
U[50]: Please implement retry support tomorrow.
A[51]: Here is the plan and command sequence.
```

No actual execution follows.

## Correct

```text
OPEN / NEXT
```

Implementation is NOT complete.

## Critical FAIL

```text
MIL — Retry support implemented
```

---

# EX-17 — Implemented Is Not Verified

## Raw

```text
A[90]: I changed the implementation and the code compiles.
U[91]: I haven't run the production user flow yet.
```

## Correct

```text
Implementation state: reported implemented
Verification Debt: production user flow unverified
```

## Critical FAIL

```text
production_verified = true
```

---

# EX-18 — NOT VERIFIED ≠ BROKEN

## Raw

```text
A[110]: Unit tests pass.
U[111]: We still haven't tested the browser path.
```

There is no failure report.

## Correct

```markdown
### VD-004 — Browser flow not yet verified
```

## Wrong

```markdown
### DEF-004 — Browser flow is broken
```

This is a critical semantic failure.

---

# EX-19 — User Correction Overrides Earlier Interpretation

## Raw

```text
A[130]: So the canonical repository is repo-A.
U[131]: No, repo-A was the old temporary copy. repo-B is canonical.
```

## Correct

Current should use repo-B.

Index should make the correction a Key Ref:

```json
{
  "sequence": 131,
  "purpose": "correction"
}
```

## Critical FAIL

Preserving repo-A merely because it appeared first or in a longer assistant message.

---

# Part IV — Fingerprint and Historical Edit Cases

# EX-20 — Append-only Prefix Fingerprint Remains Stable

## Before

```text
Stable Prefix: 1–300
content fingerprint = C1
locator fingerprint = L1
```

## New export

```text
1–300 unchanged
301–360 appended
```

## Expected

```text
prefix 1–300 content fingerprint = C1
prefix 1–300 locator fingerprint = L1
```

The old verified prefix may be reused.

---

# EX-21 — Historical Content Changed

## Before

```text
SEG-008 covers 180–220
content fingerprint = C8
```

## New export

Message 194 body was edited.

## Expected

```text
SEG-008 content fingerprint != C8
```

Maintainer must:

1. inspect changed raw material;
2. repair SEG-008;
3. identify Current objects depending on SEG-008/Evidence in that range;
4. reconcile impacts.

## Wrong

Full rebuild from sequence 1 without checking whether the unchanged prefix can be preserved.

---

# EX-22 — Locator-only Change

## Before

```text
Message content identical
message_id = old-123
```

## New export

```text
Message content identical
message_id = new-987
```

Expected:

```text
content fingerprint: unchanged
locator fingerprint: changed
```

Correct response:

```text
repair Evidence / KeyRefs / attachment references
preserve semantic Current objects
```

Critical FAIL:

Re-summarizing the full history solely because IDs were regenerated.

---

# EX-23 — Attachment Content Changed

## Before

`TC-007` depends on `ATT-018` design specification.

## New package

`ATT-018` has same filename but different content digest.

## Correct

- detect attachment digest change;
- inspect changed attachment content;
- identify Current objects supported by it;
- reconcile only affected semantics plus any downstream dependency.

Filename equality MUST NOT hide the change.

---

# EX-24 — Branch / Deletion Requires Suffix Rebuild

## Before

Verified 1–600.

## New export

Sequences 1–280 are unchanged.

The branch from 281 onward was replaced.

## Correct

```text
preserve verified 1–280
rebuild affected suffix from 281 onward
```

Any Current objects deriving solely from the replaced suffix must be reevaluated.

## Critical FAIL

Treating old 281–600 as still valid because `conversation_id` stayed the same.

---

# Part V — Staged Maintenance

# EX-25 — Requested Fixed Range Ends Inside a Semantic Unit

## User request

```text
Process messages 1–150 first.
```

## Raw pattern

```text
143: assistant proposes A/B/C
146: user asks for comparison
149: assistant compares
150: user says “I lean toward B but wait...”
151–166: discussion continues
169: user explicitly adopts B
```

## Correct Fragment

```yaml
input_range:
  seq_start: 1
  seq_end: 150

sealed_range:
  seq_start: 1
  seq_end: 142
```

Record:

```text
Unsealed tail: 143–150
Reason: unresolved decision episode continues beyond requested input range.
```

Next staged build SHOULD resume with enough overlap/context to include 143 onward.

## Critical FAIL

Sealing through 150 merely because the user requested 1–150.

---

# EX-26 — Multiple Fragments Require Final Reconciliation

## Fragments

```text
FRAG-001 sealed 1–142
FRAG-002 sealed 143–289
FRAG-003 sealed 290–438
```

Each fragment contains candidate Decisions and Capsules.

## FINALIZE must do

- resolve duplicate candidate objects;
- resolve Decision supersession across fragments;
- consolidate one Topic Capsule spanning multiple fragments;
- resolve Goal evolution;
- remove stale candidate Open items;
- run Retention / GC;
- produce one coherent `current.md` and one coherent `index.json`.

## Critical FAIL

```text
current.md = fragment1 summary + fragment2 summary + fragment3 summary
```

---

# EX-27 — Stale Fragment After Raw Edit

## Sequence

1. FRAG-002 created from raw 143–289.
2. User later edits message 211 in the source export.
3. FINALIZE receives the new source snapshot.

## Correct

Fragment fingerprint no longer matches.

FINALIZE MUST NOT blindly reuse semantic conclusions from FRAG-002.

It should rebuild or repair the affected fragment range.

---

# Part VI — Legacy and Degraded Packages

# EX-28 — Legacy Raw-only Package

## Package

```text
manifest.json
conversation.canjsonl
assets/
```

No continuation files.

## Reader behavior

If ~120 ordinary messages:

```text
DIRECT high-fidelity acquisition
```

If 700+ messages:

```text
balanced BOOTSTRAP
```

unless the user explicitly requests exhaustive full audit.

## Maintainer behavior

May create first continuation through:

```text
ONE_SHOT
or
STAGED_BUILD + FINALIZE
```

---

# EX-29 — Current-only Package

## Package

```text
continuation/current.md
index.json missing
```

## Correct Reader behavior

May use Current provisionally for semantic context.

Must recognize:

```text
historical navigation degraded
Continuation Pair incomplete
```

## Correct Maintainer behavior

REPAIR MUST first validate the existing `current.md` against Raw Evidence:

```text
1. validate conversation_id / source identity
2. validate Current coverage against available Raw
3. recompute content + locator fingerprints for the claimed prefix
4. validate Current structure and consequential Evidence references
```

Then:

```text
if Current content fingerprint matches and Current remains semantically usable:
    rebuild index.json for exactly the same Stable Prefix
    preserve Current objects/IDs unless reconciliation reveals a real semantic issue
    finalize a new consistent pair
else:
    mark the old Current stale/ineligible for trusted fast restore
    locate the affected historical range
    reconcile/repair Current as needed
    rebuild Index for the repaired Stable Prefix
```

The Maintainer MUST NOT assume that `current.md` is trustworthy merely because it exists, and MUST NOT call the pair fully verified before repair and validation succeed.

---

# EX-30 — Index-only Package

## Package

```text
continuation/index.json
current.md missing
```

## Correct

Index can guide:

```text
historical retrieval + recent raw bootstrap
```

It MUST NOT be treated as current semantic truth.

Maintainer may rematerialize Current from Index + Raw Evidence.

---

# EX-31 — Unsupported Schema Major

## Input

Reader supports:

```text
1.x
```

Package declares:

```text
2.0.0
```

## Correct

Do not guess compatibility.

Use one of:

```text
migration
raw fallback
bootstrap
```

## Critical FAIL

“Looks similar, so treat as v1.”

---

# Part VII — Anti-Zombie and Information Ownership

# EX-32 — Zombie Current

## Bad Current

```markdown
## History
Phase 1 ...
Phase 2 ...
Phase 3 ...
Phase 4 ...
Phase 5 ...

## Completed
- fixed button
- changed CSS
- changed package
- fixed typo
- ran test
- reran test
...

## Decisions
- old Decision A
- old Decision B
- current Decision C
```

## Why bad

- Evolution became a timeline.
- Completed became a task graveyard.
- superseded Decisions never retired.
- Current duplicates the historical archive.

## Correct repair

```text
Major explanatory direction changes → Evolution
Important rolled-up outcomes → Milestones
Current Decision C → active Decision
Old A/B → Retired Stub only if regression risk exists
Detailed history → Index
```

---

# EX-33 — Over-thin Current

## Bad Current

```markdown
Purpose:
Build a materials platform.

Current:
UI needs work.

Next:
Continue UI work.
```

## Why bad

A new reader cannot answer:

- why the architecture evolved;
- which constraints still govern UI changes;
- which design was explicitly rejected;
- how the viewer/artifact model works;
- what is implemented versus merely unverified;
- which work should happen before implementation.

## Correct repair

Add only high-value durable context:

```text
Origin
Current Mission
key Evolution
Goal Tree
still-valid Constraints
adopted Decisions
active/reference Topic Capsules
Boundary State
Open/VD/Next
```

Do NOT solve by copying the transcript.

---

# EX-34 — Index Becomes a Summary

## Bad Segment

```json
{
  "id": "SEG-017",
  "about": "<900-word project-status narrative including current decisions, current goals, next actions, implementation guide, and all known limitations>"
}
```

## Correct

`about` should be a compact historical navigation description, normally one to three sentences.

Detailed durable meaning belongs in Current.

---

# EX-35 — Current Duplicates Index

## Bad Current

```markdown
## History

SEG-001 — initial platform
SEG-002 — schema
SEG-003 — viewer
SEG-004 — UI
SEG-005 — debugging
...
SEG-052 — latest work
```

## Correct

Current references only the historical ranges needed by retained objects:

```markdown
### TC-007 — Scientific Viewer
History: SEG-031, SEG-034

### DEC-021 — Canonical Artifact Flow
History: SEG-034
```

Index owns the full chronology.

---

# Part VIII — Boundary, Current + Tail, and Cross-file Consistency

# EX-36 — Boundary State Updated by Raw Hot Tail

**Purpose:** Ensure `current.md` is interpreted as state at the boundary, not as final Conversation state.

## Continuation

```text
coverage: 1–500
```

Current says:

```text
OPEN-014 status: in-progress
NEXT-009: user reviews design before implementation
```

## Raw Hot Tail

```text
U[520]: I approve the design. Let the coding agent implement it.
A[545]: Reports implementation complete.
U[550]: I have not tested it yet.
```

## Reader Working Context

Should become:

```text
Design review: completed
Implementation: reported complete
Verification: not yet completed
Next: verification/testing
```

## Critical FAIL

Returning the boundary state unchanged merely because `current.md` is `verified`.

---

# EX-37 — Current / Index Conflict: Raw Wins

## Derived files

Current says:

```text
DEC-021 adopted
```

Index SEG-034 says:

```text
proposal still under discussion
```

## Required behavior

Reader must inspect Raw Evidence around the adoption episode.

Possible outcomes:

- Raw confirms adoption → repair Index.
- Raw shows no adoption → repair Current.
- Raw remains ambiguous → represent Unknown/Conflict.

## Critical FAIL

Choosing whichever derived file looks more authoritative without raw inspection.

---

# EX-38 — Complete Segment Partition

## Stable Prefix

```text
1–120
```

Bad Index:

```text
SEG-001 1–30
SEG-002 50–80
SEG-003 81–120
```

Sequences 31–49 are a navigation black hole.

Correct Index:

```text
SEG-001 1–30
SEG-002 31–49
SEG-003 50–80
SEG-004 81–120
```

Every covered Canonical Current Message belongs to exactly one primary Segment.

---

# EX-39 — Segment Must Not Split Referent / Adoption

## Raw

```text
A[200]: Option A ..., option B ..., option C ...
U[201]: Use the second one, but keep cache behavior from A.
```

## Wrong

```text
SEG-014 = 180–200
SEG-015 = 201–220
```

`U[201]` is not self-contained.

## Correct

`A[200]` and `U[201]` MUST belong to the same primary Semantic Segment.

The validator SHOULD fail a segmentation that places them in different primary Segments. Copying or paraphrasing the proposal into the later Segment is not an acceptable repair for a bad primary boundary; the historical partition itself must preserve the referent/adoption unit.

The resulting Decision must capture:

```text
B selected
cache behavior from A retained as scoped modification
```

---

# EX-40 — Chapters Are Optional, Segments Are Required

## Case A — 5 Segments

Correct:

```json
"chapters": []
```

No need to create artificial Chapters.

## Case B — 70 Segments across 8 major eras

Chapters SHOULD be introduced to avoid a flat, difficult-to-navigate index.

## Critical FAIL

Using Chapters without Segments, such as:

```text
CH-001 seq1–300
CH-002 seq301–700
```

with no fine-grained Segment navigation.

---

# Part IX — Attachments and Evidence

# EX-41 — Attachment-backed Decision

## Raw pattern

```text
U[300]: Uploads ATT-018 `viewer-design.md` and asks to use its interaction contract.
A[301]: Summarizes it.
U[302]: Yes, use this as the canonical viewer interaction contract.
```

## Correct Current

```markdown
### DEC-031 — Use the ATT-018 viewer interaction contract
Adoption: user-explicit
Evidence: E-101, E-102

### AD-004 — Canonical viewer design specification
Attachment: ATT-018
Role: defines viewer interaction contract
Inspection status: relevant sections inspected
```

## Critical FAIL

- treating the attachment filename alone as proof of its contents;
- recording the Decision without inspecting the relevant content;
- omitting the explicit user adoption message.

---

# EX-42 — Attachment Mentioned but Not Needed

## Raw

A ZIP contains 25 attachments, but only two affect current Decisions/Topic Capsules.

## Correct

- index all attachments at package level;
- inspect the two context-critical attachments;
- do not read every unrelated attachment solely because it exists;
- do not add all 25 to `Attachment Dependencies`.

This preserves the v4 principle of selective attachment depth without losing evidence discipline.

---

# Part X — Differential Quality, Retrieval, and Abstention

# EX-43 — DIRECT vs CONTINUATION Differential Test `[EXECUTABLE]`

**Purpose:** This is the core executable regression fixture for the entire continuation system. It is no longer a test recipe.

## Fixture files

The companion fixture bundle MUST provide:

```text
fixtures/ex-43/
├── raw.canjsonl
├── expected-current-at-100.md
├── expected-index-at-100.json
└── assertions.json
```

`raw.canjsonl` contains exactly **140** Canonical Current Message fixture records. The fixture deliberately contains:

- an explicit Origin and Current Mission;
- one major Evolution from standalone viewer work to integrated scientific presentation;
- three durable Constraints;
- a GraphQL proposal that is explored but never adopted;
- a user-explicit project-wide Decision to use canonical artifact flow;
- an active Scientific Viewer Topic Capsule;
- a completed lower-level viewer baseline Milestone;
- a semantically safe Continuation Boundary at sequence 100;
- a Raw Hot Tail at sequences 101–140 containing a module-scoped CSV exception;
- one Open UI/UX consolidation item;
- one production-flow Verification Debt;
- one deployment-status Unknown;
- one explicit Next Action owned by the user before coding may begin.

The exact raw messages and expected artifacts are machine-consumable; validators MUST NOT substitute a freshly invented 140-message Conversation.

## Golden materialized prefix

The Maintainer materializes exactly:

```text
Stable Prefix: 1–100
Raw Hot Tail: 101–140
Continuation revision: 1
Trust: verified
```

`expected-current-at-100.md` defines the golden semantic Current at the boundary.

`expected-index-at-100.json` defines the golden Chapter/Segment partition:

```text
CH-001: 1–30   platform orientation + durable constraints
CH-002: 31–70  architecture exploration + artifact-flow adoption
CH-003: 71–100 durable viewer knowledge + implementation + baseline closure

SEG-001:   1–10
SEG-002:  11–20
SEG-003:  21–30
SEG-004:  31–42   GraphQL exploration through explicit user non-adoption
SEG-005:  43–50   viewer-output / artifact architecture alternatives
SEG-006:  51–60   proposal through explicit user adoption at U[59]
SEG-007:  61–70
SEG-008:  71–80
SEG-009:  81–90
SEG-010:  91–100
```

EX-43 freezes literal prefix and per-Segment fingerprint values. `assertions.json` declares the exact fixture-level canonicalization/composition method used to compute them, while EX-49 independently exercises canonicalization properties. The golden Evidence anchors intentionally point to the user source messages for CON-001/002/003 (U[11]/U[13]/U[15]) and the explicit adoption message for DEC-001 (U[59]), rather than relying on assistant recaps.

## Test A — DIRECT

Input only `raw.canjsonl`; do not provide continuation artifacts.

Reader performs high-fidelity Direct acquisition of all 140 messages and constructs `Working Context A`. `assertions.json` machine-encodes this as `must_read_range: [1, 140]` plus `must_read_every_sequence: true`; reading only the range endpoints, search hits, counts, or selected messages does not satisfy the fixture.

## Test B — CONTINUATION

Provide:

```text
expected-current-at-100.md
expected-index-at-100.json
raw.canjsonl
```

Reader MUST load the verified prefix at 1–100, read the complete Raw Hot Tail 101–140, reconcile the tail against boundary state, and construct `Working Context B`.

It MUST NOT replay raw sequences 1–100 merely to satisfy this fixture while the Continuation Pair validates successfully. `assertions.json` machine-encodes `must_not_replay_verified_prefix: [1, 100]`; replay is allowed only under the enumerated validation-failure fallback conditions.

## Machine-checkable golden assertions

`assertions.json` is normative for the executable fixture. It also freezes acquisition-path requirements and source-message evidence anchors: CON-001→U[11], CON-002→U[13], CON-003→U[15], and DEC-001 adoption→U[59]. At minimum both A and B MUST preserve:

```text
Origin:
  materials-intelligence platform; not a generic chat app

Constraints:
  CON-001 scientific provenance preserved
  CON-002 coherent shared interaction patterns
  CON-003 original scientific inputs remain immutable

Decisions:
  canonical artifact flow remains the project-wide viewer default
  legacy CSV export is only a module-scoped compatibility exception

Topic knowledge:
  Scientific Viewer Architecture remains active

Milestone:
  structure/XRD/RDF baseline completed at lower-level validation

Open:
  UI/UX interaction consolidation remains unfinished

Verification Debt:
  full production-equivalent viewer flow is not verified

Unknown:
  whether production contains the latest viewer baseline is not established

Next Action:
  user reviews two UI consolidation options before coding begins
```

The following MUST NOT be inferred:

```text
GraphQL rewrite was adopted
CSV exception replaced the project-wide artifact default
production deployment completed
full production verification passed
coding may begin before user review
```

## Required comparison dimensions

Compare A and B on:

```text
Origin
Current Mission
Evolution
Goal Tree
Requirements / Constraints
Decisions
Scoped exceptions
Topic knowledge
Operational State
Completed/Open
Defect vs Verification Debt
Unknowns
Next Actions
```

## PASS condition

A and B MUST satisfy the same consequential assertions in `assertions.json`. Wording MAY differ.

B MUST NOT lose a consequential item merely because history 1–100 was consumed through the Continuation Pair instead of replayed.

## Critical FAIL

Any of:

- lost durable Constraint;
- GraphQL proposal promoted to Decision;
- scoped CSV exception generalized globally;
- false supersession;
- false production verification;
- false deployment completion;
- incorrect Next Action actor/dependency;
- missing material Unknown;
- Continuation mode unnecessarily requires replay of unchanged verified 1–100 to produce the correct result.

---

# EX-44 — Historical Retrieval After Current Demotion

## History

An old Redis deployment discussion was important at the time but no longer deserves Current retention.

Correct maintenance:

```text
remove old Redis Topic Capsule from Current
retain SEG-012 / SEG-013 in Index
retain Raw Evidence
```

Later user asks:

```text
“What did we decide about Redis earlier?”
```

## Expected Reader path

```text
Current: no retained object
↓
Index topic/title/about search
↓
SEG-012 / SEG-013
↓
Key Refs
↓
Raw Evidence
```

## PASS

Reader recovers the old decision/history without requiring full Conversation replay.

This proves:

```text
Current GC ≠ forgetting
```

---

# EX-45 — Abstention / Unknown Test

## Raw

The Conversation discusses a production deployment but never records whether deployment actually happened.

A later message says:

```text
“We should deploy next week.”
```

No later result exists.

## Correct Current

```markdown
### UNK-009 — Production deployment status
Question: Was production deployment actually completed?
Known: deployment was planned; no execution/result evidence is present.
Impact: do not claim production deployment completed.
```

## Critical FAIL

```text
Production deployment completed.
```

This case validates abstention rather than summary-based invention.

---

# EX-46 — Provisional → Verified Trust Transition `[SEMANTIC]`

## Initial state

A long legacy package is bootstrapped selectively. The Maintainer creates a useful continuation candidate but has not traversed the full claimed Stable Prefix or checked all context-critical attachments.

Correct persisted state:

```text
trust: provisional
```

## Later maintenance

A later maintenance run:

- completes required coverage of the same prefix;
- resolves adoption/supersession dependencies;
- inspects required attachments;
- validates pair identity, coverage, references, and fingerprints;
- passes semantic invariants.

## Correct transition

```text
provisional revision N
    ↓ actual missing work completed
verified revision N+1
```

## Critical FAIL

Upgrading to `verified` merely because the provisional summary "looks complete".

---

# EX-47 — Content Mismatch Invalidates Verified Fast Restore `[SEMANTIC]`

## Before

```text
current/index trust: verified
covered prefix: 1–300
content fingerprint: H1
```

## New source

A covered message body changes and recomputation yields:

```text
content fingerprint: H2
H2 != H1
```

## Correct runtime behavior

The persisted `verified` label MUST NOT be treated as currently valid for trusted fast restore.

Reader/Validator marks the pair stale or inconsistent for the current source and requires repair or bounded raw fallback.

Maintainer locates the affected range, reconciles downstream Current objects, rebuilds affected Index material, validates, and only then MAY finalize a new `verified` revision.

## Critical FAIL

Continuing to claim the old pair is verified merely because its frontmatter still says `trust: verified`.

---

# EX-48 — Locator-only Mismatch Preserves Semantic Reuse `[SEMANTIC]`

## Before

```text
content fingerprint: HC
locator fingerprint: HL1
trust: verified
```

## New export

Raw message bodies, roles, content-part order, and attachment bytes are unchanged, but exporter message/version IDs are regenerated:

```text
content fingerprint: HC
locator fingerprint: HL2
HL2 != HL1
```

## Correct behavior

- semantic Current content MAY be reused;
- broken Evidence / KeyRef / attachment locators MUST be repaired;
- the old pair MUST NOT expose known-broken citations as if valid;
- unrelated Goals, Decisions, Capsules, and Operational State SHOULD NOT be rebuilt;
- after reference repair and validation, a new verified revision MAY be finalized.

## Critical FAIL

Treating a locator-only mismatch as either:

1. no issue at all while continuing to serve broken references; or
2. a reason to semantically rebuild the entire unchanged Conversation.

---

# EX-49 — Fingerprint Canonicalization Property Vectors `[EXECUTABLE]`

The companion fixture file is:

```text
fixtures/ex-49/canonicalization-vectors.json
```

The fixture remains property-based at the semantic level, but its machine file now uses only valid `sha256:<64 lowercase hex>` digest inputs and also freezes concrete expected digest outputs for every vector. A validator can therefore check both the required equality/inequality property and literal reproducibility under the declared fixture method.

Required vectors:

### FP-CRLF — Line-ending normalization

```text
user body "line1\r\nline2"
user body "line1\nline2"
→ content digests MUST be equal
```

### FP-ROLE — Role participates in the digest

```text
user:      "use B"
assistant: "use B"
→ content digests MUST differ
```

### FP-PART-ORDER — Structured part order is preserved

```text
[text A, text B]
[text B, text A]
→ content digests MUST differ
```

### FP-ATTACHMENT — Attachment content participates

```text
attachment digest sha256:1111111111111111111111111111111111111111111111111111111111111111
attachment digest sha256:2222222222222222222222222222222222222222222222222222222222222222
→ message content digests MUST differ
```

### FP-DOMAIN — Composition is domain separated

Given the same ordered child digest list:

```text
Prefix composition digest
Segment composition digest
→ MUST differ
```

## Critical FAIL

Any implementation that:

- changes content digest solely because CRLF became LF;
- ignores author role;
- sorts structured content parts;
- ignores an attachment digest included in the canonical semantic projection;
- uses an indistinguishable composition domain for Prefix and Segment digests.

---

# EX-50 — Pair Identity, Revision, and Coverage Mismatch `[SEMANTIC]`

## Case A — Conversation identity mismatch

```text
current.conversation_id = A
index.conversation_id   = B
```

Result: invalid pair.

## Case B — Continuation revision mismatch

```text
current.revision = 7
index.revision   = 6
```

Result: inconsistent pair; MUST NOT use trusted fast restore.

## Case C — Coverage mismatch

```text
current coverage = 1–100
index coverage   = 1–110
```

Result: inconsistent pair. The system MUST NOT infer which 10 messages are materially represented by Current.

## Case D — Correct boundary + tail

```text
current/index coverage = 1–100
raw source = 1–140
raw hot tail = 101–140
```

Result: valid coverage model if all other checks pass.

---

# Part XI — Reference Good Output Patterns

# 46. Rich Project `current.md` Pattern

The following is a structural pattern, not a mandatory one-size-fits-all template.

```markdown
---
schema: chat-reader-continuation
schema_version: 1.0.0
conversation_id: <id>
continuation_revision: 7
trust: verified
coverage:
  seq_start: 1
  seq_end: 612
  message_count: 612
  source_fingerprint:
    profile: chat-reader-content-v1
    algorithm: sha256
    content: "<hex>"
    locators: "<hex>"
index: continuation/index.json
source_revision: 18
updated_at: <timestamp>
---

# Continuation State

## Continuation Brief

Short 30-second orientation.

# Part A — Understanding & Durable Knowledge

## Orientation

### Origin
...

### Current Mission
...

### Scope / Non-goals
...

## Evolution

### EV-001 — ...
...

## Current Goal Tree

### G-001 — ...
...

## Stable Requirements and Constraints

### REQ-001 — ...
### CON-001 — ...
### NG-001 — ...
### CONV-001 — ...

## Adopted Decisions

### DEC-001 — ...
...

## Topic Capsules

### TC-001 — ...
...

# Part B — Operational Continuation

## State at Continuation Boundary
...

## Current Workstreams

### WS-001 — ...

## Completed Milestones

### MIL-001 — ...

## Open Work

### OPEN-001 — ...

## Known Defects

### DEF-001 — ...

## Verification Debt

### VD-001 — ...

## Blockers

### BLK-001 — ...

## Next Actions

### NEXT-001 — ...

# Uncertainty and Historical Boundary

## Assumptions
### ASM-001 — ...

## Unknowns
### UNK-001 — ...

## Conflicts
### CF-001 — ...

## Superseded / Retired Stubs
### RET-001 — ...

# Evidence Appendix

## Attachment Dependencies
### AD-001 — ...

## Evidence Registry
### E-001
...
```

Optional empty sections are omitted.

---

# 47. Research-oriented `current.md` Pattern

A research Conversation MAY specialize the same schema without inventing a different file format.

```markdown
## Orientation
Origin: ...
Current Mission: ...

## Evolution
EV-001 — Research direction transition ...

## Current Goal Tree
G-001 — Research objective
G-002 — Literature / benchmark foundation
G-003 — Reproducible experimental baseline

## Requirements / Constraints
CON-001 — Resource limitation
CONV-002 — Paper-reading method

## Adopted Decisions
DEC-004 — Use LIBERO-Spatial first

## Topic Capsules
TC-003 — Efficient VLA
TC-004 — KV/cache optimization
TC-008 — LIBERO evaluation protocol

## State at Continuation Boundary
...

## Current Workstreams
WS-003 — OpenVLA baseline evaluation
WS-004 — VLA benchmark synthesis

## Verification Debt
VD-002 — strict A/B efficiency measurement incomplete

## Unknowns
UNK-004 — final narrow research topic not frozen

## Next Actions
NEXT-005 — complete targeted paper + benchmark review
```

The schema is reused; only the useful modules appear.

---

# 48. Troubleshooting-oriented `current.md` Pattern

```markdown
## Orientation
Problem: retry delay settings appear ineffective.
Environment: ...

## Evolution
EV-001 — Config hypothesis → runtime-path hypothesis

## Topic Capsules
TC-003 — Runtime layout
TC-004 — Retry behavior / backoff mechanism

## State at Continuation Boundary
Known: ...
Unverified: ...

## Known Defects
DEF-002 — observed retry delay differs from intended behavior

## Unknowns
UNK-003 — exact compiled backoff constant source

## Retired Stubs
RET-002 — old runtime-path assumption ruled out

## Next Actions
NEXT-004 — inspect active runtime binary/source path
```

Do not force project-only concepts that are irrelevant.

---

# 49. Good `index.json` Pattern — Illustrative Partial Snippet

This is an **illustrative partial snippet**, not a standalone fully valid Index instance. `CH-001` intentionally references `SEG-002` and `SEG-003` that are omitted here for brevity. Executable fixtures MUST provide every referenced Segment.

```json
{
  "schema": "chat-reader-continuation-index",
  "schema_version": "1.0.0",
  "conversation_id": "<id>",
  "continuation_revision": 7,
  "coverage": {
    "seq_start": 1,
    "seq_end": 612,
    "message_count": 612,
    "source_fingerprint": {
      "profile": "chat-reader-content-v1",
      "algorithm": "sha256",
      "content": "<hex>",
      "locators": "<hex>"
    }
  },
  "chapters": [
    {
      "id": "CH-001",
      "seq_start": 1,
      "seq_end": 175,
      "title": "Initial platform definition and architecture",
      "about": "Covers the initial platform framing, early architecture discussion, and transition away from isolated utility-style implementations.",
      "segment_ids": ["SEG-001", "SEG-002", "SEG-003"]
    }
  ],
  "segments": [
    {
      "id": "SEG-001",
      "seq_start": 1,
      "seq_end": 32,
      "message_count": 32,
      "kind": "orientation",
      "title": "Initial materials-intelligence platform framing",
      "about": "Defines the initial platform intent and establishes the first scope boundaries.",
      "topics": ["project-scope", "materials-platform"],
      "key_refs": [
        {
          "type": "message",
          "sequence": 3,
          "purpose": "origin"
        }
      ],
      "attachment_refs": [],
      "fingerprint": {
        "profile": "chat-reader-content-v1",
        "algorithm": "sha256",
        "content": "<hex>",
        "locators": "<hex>"
      }
    }
  ]
}
```

---

# Part XII — Reference Bad Output Patterns

# 50. Bad Pattern — Chronological Current

```markdown
## History

Message 1–20: ...
Message 21–40: ...
Message 41–60: ...
...
```

**Violation:** Current is duplicating Index/transcript chronology.

---

# 51. Bad Pattern — Index Owns Current Truth

```json
{
  "id": "SEG-019",
  "current_decision": "Use architecture C",
  "next_action": "Deploy",
  "current_status": "production verified"
}
```

**Violation:** Index owns historical navigation, not current truth.

---

# 52. Bad Pattern — Fake Evidence Identity

Raw export has no `message_id`, but continuation contains:

```text
Message-ID: MSG-173
```

invented by the Maintainer.

**Violation:** unavailable locator was fabricated.

Correct: use honest available sequence/record locator only.

---

# 53. Bad Pattern — Fixed 150-message Segmentation

```text
SEG-001 1–150
SEG-002 151–300
SEG-003 301–450
```

with no semantic analysis.

**Violation:** Segment boundaries must be semantic.

The 150-message concept belongs to Hot Tail budgeting, not Segment creation.

---

# 54. Bad Pattern — Fragment as Final Current

A staged fragment says:

```text
Candidate Decision: use B
Cross-boundary dependency: user acceptance may appear later
```

but it is copied directly into final Current as:

```text
DEC — use B
```

**Violation:** fragment is provisional and requires FINALIZE reconciliation.

---

# Part XIII — Conformance Reporting Template

A validator/reviewer SHOULD report conformance using a structure like:

```markdown
# Continuation Conformance Report

## Fixture
EX-xx — <name>

## Critical Invariants
- Raw authority: PASS
- Pair identity / continuation revision: PASS
- Coverage equality: PASS
- Boundary semantic closure: PASS
- Proposal != Decision: PASS
- Plan != implementation: PASS
- Implementation != verification: PASS
- NOT VERIFIED != BROKEN: PASS
- Current/Index complementarity: PASS
- Attachment dependency integrity: PASS

## Semantic Preservation

### Preserved
- Origin
- CON-003
- DEC-004
- TC-007
- VD-004
- NEXT-009

### Missing
- <none or list>

### Incorrect
- <none or list>

## Historical Retrieval
- Chapter navigation: PASS
- Segment navigation: PASS
- Key Ref quality: PASS

## Incremental Stability
- Stable IDs preserved: PASS
- Unchanged prefix reused: PASS
- Fingerprints valid: PASS

## Trust / Runtime Validity
- Persisted trust eligibility: PASS
- Runtime validity: valid
- Provisional → verified transition rules: PASS / N/A

## Retention / GC
- Retention Gate applied: PASS
- Zombie Current detected: NO
- Orphan Evidence removed: PASS / N/A
- Historical detail demoted to Index when appropriate: PASS

## Warnings
- TC-004 may be eligible for reference demotion.

## Result
PASS
```

A critical semantic failure MUST produce FAIL even if most other checks pass.

---

# Part XIV — Coverage Matrix

This matrix links **all CS-00 through CS-30 areas** to their primary conformance cases. Indirect coverage is still useful, but every schema block has an explicit audit entry.

| Schema area | Primary fixtures |
|---|---|
| CS-00 Purpose / terminology / conformance intent | EX-01, EX-43, EX-44, EX-45 |
| CS-01 Package contract / optional continuation layer | EX-28, EX-29, EX-30, EX-31, EX-43 |
| CS-02 Authority / Raw source of truth | EX-15, EX-19, EX-37, EX-41, EX-45 |
| CS-03 Identity / version / continuation revision | EX-31, EX-43, EX-47, EX-48, EX-50 |
| CS-04 Coverage / boundary / Raw Hot Tail | EX-25, EX-36, EX-38, EX-43, EX-50 |
| CS-05 `current.md` contract | EX-02, EX-03, EX-32, EX-33, EX-43 |
| CS-06 Orientation / Brief | EX-01, EX-02, EX-03, EX-43 |
| CS-07 Evolution | EX-02, EX-03, EX-05, EX-32, EX-43 |
| CS-08 Goal Tree | EX-02, EX-03, EX-12, EX-43 |
| CS-09 Requirements / Constraints | EX-01, EX-02, EX-11, EX-43 |
| CS-10 Decisions | EX-10, EX-11, EX-15, EX-19, EX-43 |
| CS-11 Topic Capsules | EX-02, EX-03, EX-06, EX-13, EX-43 |
| CS-12 Operational State | EX-08, EX-14, EX-16, EX-17, EX-18, EX-36, EX-43 |
| CS-13 Unknown / Conflict / Retired | EX-03, EX-05, EX-10, EX-45, EX-43 |
| CS-14 Evidence / Attachments | EX-19, EX-23, EX-41, EX-42, EX-48 |
| CS-15 Anti-zombie / Retention | EX-13, EX-14, EX-32, EX-33, EX-35, EX-44 |
| CS-16 Index contract | EX-02, EX-38, EX-40, EX-43, EX-50 |
| CS-17 Chapters | EX-02, EX-40, EX-43 |
| CS-18 Segments | EX-25, EX-38, EX-39, EX-43 |
| CS-19 Key Refs | EX-19, EX-39, EX-41, EX-44, EX-48 |
| CS-20 Current/Index complementarity | EX-32, EX-34, EX-35, EX-44 |
| CS-21 Fingerprints / canonicalization | EX-20, EX-21, EX-22, EX-23, EX-24, EX-47, EX-48, EX-49 |
| CS-22 Trust | EX-28, EX-29, EX-30, EX-43, EX-46, EX-47, EX-48 |
| CS-23 Reconciliation | EX-09, EX-10, EX-11, EX-12, EX-24, EX-47, EX-48 |
| CS-24 Boundary / semantic closure | EX-09, EX-25, EX-36, EX-39, EX-43 |
| CS-25 Fragments | EX-25, EX-26, EX-27 |
| CS-26 Finalize / Repair | EX-26, EX-27, EX-29, EX-30, EX-47, EX-48 |
| CS-27 Legacy compatibility | EX-28, EX-29, EX-30, EX-31 |
| CS-28 Validation | all cases; especially EX-37, EX-38, EX-43, EX-49, EX-50 |
| CS-29 Version compatibility | EX-31 |
| CS-30 Conformance system | EX-43, EX-44, EX-45, EX-46, EX-49 |

---

# Part XV — Minimum Release Gate for the Two Skills

Before `context-acquisition` or `context-continuation-maintainer` is considered ready for release, the implementation **MUST pass the mandatory gate below**. Additional semantic fixtures outside the gate remain recommended regression coverage and SHOULD be run when the relevant behavior changes.

## Maintainer release gate

MUST pass:

```text
EX-02 Long project
EX-03 Research project
EX-09 Append-only update
EX-10 Decision supersession
EX-11 Scoped exception
EX-13 Capsule lifecycle
EX-14 Work roll-up
EX-15 Proposal != Decision
EX-17 Implemented != Verified
EX-18 Not Verified != Broken
EX-20–24 Fingerprint/edit cases
EX-46–49 Trust/fingerprint transition + canonicalization cases
EX-25–27 Staged maintenance
EX-32–35 Anti-zombie
EX-38 Segment partition
EX-41 Attachment-backed Decision
EX-50 Pair identity/revision/coverage mismatch
```

## Acquisition release gate

MUST pass:

```text
EX-01 Short Direct
EX-28 Raw-only legacy
EX-29 Current-only degraded
EX-30 Index-only degraded
EX-31 Unsupported major
EX-36 Boundary + Hot Tail
EX-37 Current/Index conflict
EX-43 executable DIRECT vs CONTINUATION differential
EX-44 historical retrieval after demotion
EX-46–48 trust transition / invalidation / locator-repair cases
EX-50 pair identity/revision/coverage mismatch
EX-45 abstention
```

## Shared critical gate

Both Skills MUST preserve:

```text
proposal != Decision
plan != implementation
implementation != verification
NOT VERIFIED != BROKEN
recency != supersession
Raw > derived views
boundary respects semantic closure
verified trust is earned, not assumed
Current retention/GC does not destroy historical retrievability
```

---

# Final Conformance Principle

A good continuation system does **not** try to remember everything in `current.md`.

It preserves the right information at the right layer:

```text
Current
= information that must stay understood

Index
= information that must stay findable

Raw
= information that must stay faithful
```

A correct implementation therefore succeeds in two directions at once:

1. **High-fidelity continuation:** a new reader can resume consequential work without replaying the covered history.
2. **Controlled forgetting from active context:** details may leave Current without disappearing from historical retrieval.

The conformance corpus is successful only when it detects failures in either direction: excessive forgetting or excessive accumulation.
