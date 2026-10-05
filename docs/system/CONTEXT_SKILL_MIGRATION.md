# Context Skill delivery and legacy migration

Current repository inventory, 2026-10-03. Product authority is the
[Context contract](CONTEXT_PACKAGE_CONTRACT.md). This inventory describes actual
artifacts and entry points, not a claim of completed external semantic acceptance.

## Inventory and routing

| Artifact / capability | Actual input and output | Current route and migration |
| --- | --- | --- |
| `context-acquisition.zip` | Context Package or extracted package → runtime Working Context | Default `EXPORT_CONTEXT`; download from export delivery. Reads Raw-only and Continuation; does not require a user-managed summary sidecar. |
| `context-continuation-maintainer.zip` | Context Package + external semantic work → new Context Package revision | Default `CONTEXT_MAINTENANCE`; user runs it externally. The supplied pinned ZIP has the original single-source materializer. The reviewed repository variant adds OLD + NEW support; do not claim the pinned ZIP contains it. |
| `chat-transcript-normalizer-skill.zip` | Readable irregular transcript → Profile v1 `.chat-transcript.md`, optionally a PARTIAL audit report | Default legacy category `CONVERSATION_RESCUE`, labelled format conversion. Download from the collapsed ordinary-import help or failed-analysis recovery, choose the generated Markdown, then preview/import normally. Bundle root is `chat-transcript-normalizer/`. Its output is transcript interchange, not saved Continuation state; do not force it into `.context.zip`. |
| Old acquisition `.v1.md` / `.v1-en.md` | Raw Context Package → acquired runtime context | Public legacy URLs remain readable. New UI and offline shell deliver Acquisition ZIP; legacy text is not a complete Continuation writer. |
| Old `import-rescue/Chat_Reader_Conversation_Rescue_Skill_{zh,en}.md` | Same acquisition instructions as the matching legacy acquisition files, byte for byte | Names are misleading: these files do not implement repair/package rescue. Keep old URLs for compatibility; no active download entry points use them. Normalizer replaces the import-conversion default. No fourth Rescue default is added. |
| Separate Handoff / Recovery / Merge / Migration Bundle | None found among repository public Skill assets, default Bundles or editable Skill trees | No invented migration target. Application conversation merge is canonical data processing, not a Skill; it does not combine or endorse old Current documents. |
| User Markdown or ZIP Skill | User-defined capability and outputs | Preserve personal records/preferences. Markdown becomes a same-name compatibility Bundle without rewriting instructions. Installation packaging does not certify Context conformance. |
| Repository state/plan/handoff documents, ordinary report/code Skills | Project documentation or business artifacts | Not user Continuation state. Keep their existing formats; do not rename project `PROJECT_STATE.md` into a package member. |

The default Bundle bytes live in `tools/context-skills/default-bundles/` and match
`apps/web/public/skills/`. The corresponding public `.md` files are compatibility
content endpoints. Installing/downloading a Skill Bundle and updating a Context
Package are different operations. Never embed a Skill ZIP inside a Context ZIP.

## Reviewed external runtime distribution

Editable Acquisition/Maintainer sources are under `tools/context-skills/`. They
share the fixed API protocol runtime byte for byte. The app uses its fixed runtime
for structural operations; it never loads code from an upload.

`python tools/context-skills/build.py --output apps/web/public/skills --check` verifies shared sources and the
exact default ZIPs. `--review --output <task-output-directory>` writes separately
named `.review.zip` artifacts without replacing public or pinned defaults. They
include compatibility/locator fixes and the Maintainer dual-source CLI. Review
artifacts are not an implicit system-default update or a production release.

The external sequence is Raw A → maintain A → export newer Raw B → compare OLD
maintenance package with B → reconcile → materialize new package → return members
to the conversation workspace → export again. See
[external OLD/NEW workflow](../../tools/context-skills/context-continuation-maintainer/references/package-update-workflow.md).
The external writer preserves Raw/assets from NEW, never rewrites the two inputs,
and refuses stale bindings/output races. App return saves member bytes directly
and retains three snapshots; it does not run this semantic workflow or endorse
external trust declarations.

## Standalone historical state migration

Legacy `handoff.md`, `old-current.md`, `PROJECT_STATE.md` or a rescue summary may
be provided to an external agent as **derived evidence**, together with Raw.
They are not equivalent to a Continuation Pair and are not auto-migrated by the app.

1. Acquire the actual Raw package and state its missing history/attachments.
2. Compare each useful legacy claim against Raw: distinguish a suggestion from
   adoption, implementation from verification, later correction from older intent,
   and local scope from global policy. Preserve unknowns instead of fabricating evidence.
3. Choose a supported semantic boundary, map useful claims to stable typed objects
   and actual source references, and construct the full Index partition. Missing
   history cannot become verified coverage merely because a legacy document says so.
4. Prepare external writer Candidate/Trace inputs, record actual semantic reads,
   and materialize one new `.context.zip` with Current and Index inside it. These
   temporary writer inputs are not extra user-managed continuation files.
5. Check output Raw/assets against the source and inspect the resulting Pair.
   Return the new package; a human diagnostic report is optional and never replaces it.

When only a historical Markdown summary exists, the app may save it as a user file
under its direct-update policy, but neither the app nor the migration instructions
claim it reconstructs absent Raw or a finalized verified Pair. Acquisition can
degrade to available evidence. Any future true Raw rescue must create a separately
identified incomplete package with provenance; it must not masquerade as Maintainer
byte-preserving repair. No such rescue engine is implemented or promised here.

## Acceptance boundaries

Default ZIP byte comparison, actual Normalizer import, API/worker external
materialization roundtrip and offline ZIP download have dedicated tests. Reviewed
runtime tests include historical correction, locator repair, prefix inheritance,
stale inputs and output races. They validate deterministic structure and authored
synthetic outcomes, not an arbitrary model's semantic judgment. Separate reviewed
Bundles have been generated without replacing defaults. The
[agent-authored semantic walkthrough](../evidence/CONTEXT_SEMANTIC_WALKTHROUGH_2026-10-03.md)
records actual inspection of Current and the extracted full tail, with independent
external model trials still unverified. Dated results and delivery hashes belong to the
[execution record](../execution/CONTEXT_MIGRATION_2026-10-03.md).
