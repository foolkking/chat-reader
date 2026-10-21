# AI Rich Markdown Renderer Contract

Last synchronized: 2026-10-21

## Purpose and canonical source

Chat Reader renders modern AI conversation Markdown through one semantic core. PostgreSQL `MessageVersion` Markdown remains canonical. Rendering never rewrites `\[...\]` to `$$...$$`, never persists KaTeX HTML, and does not add a database migration or export field.

```text
canonical Markdown source (unchanged)
-> bounded display-only compatibility projection where recognized
-> react-markdown / unified parser
-> remark-gfm + frozen AI soft breaks + remark-math
-> AI math compatibility AST transform
-> sanitized HAST
-> KaTeX semantic renderer
-> safe React components
```

`RICH_MARKDOWN_RENDERER_VERSION = ai-rich-markdown-v5` identifies the parser/render policy. A future parsed-result cache must include source hash, MessageVersion identity and this version. Generated HTML is never canonical.

## Shared consumers

The same semantic and security configuration is used by Reader message Markdown, Source Editor live preview, Markdown attachment inline/Viewer rendering, and existing annotation/import surfaces that consume `MarkdownRenderer`. Presentation wrappers may differ; Math/GFM/footnote/code/link semantics must not diverge.

The local Table tool's `MarkdownTablePreview` uses the existing
GFM/math/sanitization configuration for all cells, including plain text. It does
not bypass the shared parser with a separately constructed table. Its stable cell components expose actual
table cells for editing; post-sanitization application-owned coordinates do not
authorize source HTML. Links become inert styled text and images inert alt text
in this editing surface, so a cell click cannot navigate or load a remote image.
Normal Reader links/images retain their existing policy. Both normal and editable
table cells retain the parser's GFM left/center/right alignment style; no parser
version, canonical data or export contract changes.

The four Table tool edge controls live outside the cell scroller, within the
same focus scope. CSS reserves their full 44px hit regions around the visible
preview, so wide/long content cannot displace them to a hidden content midpoint
or cover cells/scrollbars. Additions still modify the whole draft, not the visible
page. The [edge-reachability continuation](../execution/TABLE_TOOL_VIEWPORT_EDGES_2026-10-20.md)
checks real coordinates/hit tests, mouse/touch and post-add focus in 45 local
Chrome scenarios. This is presentation-only; no extra table, parser, scroll/
resize listener, persistent state or data-contract change is introduced.

The source-only table transformation recognizes definite inline math ownership
of pipes, uses `\vert` for bare math bars (not the different `\|` norm), and
retains literal code backslash pairs. It declines ambiguous TeX text/preamble/
character-code arguments and raw-pipe reference IDs instead of changing their
meaning or outside definitions. Actual shared-chain MathML/code tests verify
the supported examples; this is not a full TeX parser.

Table previews also collect read-only link-definition context, once per frozen
source snapshot: source <=1 MiB
UTF-8, projected definitions <=256 and <=32 KiB. Fenced/indented examples are
excluded; destination/label spelling and duplicate order are retained. Titles
are unnecessary for the inert caption/alt projection and remain untouched in
source. CodeMirror still extracts raw label/URL spelling. For sources containing
`<`, a completed, source-bound GFM probe first determines actual definition and
literal ranges; a same-width mask prevents literal examples from lending
definitions or an HTML opener from hiding later genuine definitions.
Unverified HTML returns no projected references and a limitation notice.
Incomplete/oversized context, multiline labels/destinations and footnote
bodies get a conditional limitation notice rather than being represented as
complete. Context never enters table serialization or the apply transaction.

For raw CRLF inputs, the ordinary editor-context fallback and reference collector parse
a same-length whitespace view (`CR` before `LF` becomes a space), not a shortened
LF copy. Installed Lezer otherwise treats CR as content on an HTML blank line.
All offsets and extracted source spelling still refer to the original string.
The GFM probe itself handles original CRLF through the renderer's parser, not
through this Lezer HTML approximation.
Raw-CRLF trees are not reused as if they were normalized editor snapshots; the
actual LF CodeMirror reuse path remains unchanged. Source text/newline bytes,
reference IDs/destinations and export data are never rewritten by this view.

## Bounded ChatGPT rich-text reading fallback

`chatgpt-rich-text-compatibility.ts` handles the reported lower-case
`box`/`row`/`text`/`badge`/`divider` export shape. It is a sample-driven reading
fallback, **not** a documented general ChatGPT export format, HTML/JSX parser or
ChatKit runtime. A standalone balanced box with a recognized rich child must
establish the profile outside code. Unknown attributes do not authorize it.
The narrow attribute allowlist tracks the documented presentation vocabulary
for the corresponding ChatKit widget names (layout, spacing, border/radius,
background, color/variant, badge flags and text emphasis) only as a
recognition boundary; those attributes are discarded and never executed.
Events, `style`, `className`, arbitrary JSX expressions and unknown attributes
remain literal/inert and do not establish a profile.

The display projection removes recognized layout wrappers, retains text/badge
labels and uses a thematic break for a divider. An escaped profile additionally
recovers bounded heading, paired strong/code delimiters and ordered-list escapes,
plus export whitespace entities. It does not blindly unescape Markdown, links,
TeX or HTML. Fenced, inline and standalone indented code stay literal. Missing
content, original card styling, arbitrary widgets and exporter changes are not
reconstructed.

Full current-version text supplies ephemeral profile metadata to canonical
blocks, including both virtualized paths and leading thinking. Block IDs,
indices, raw copy strings, task identity and canonical data remain unchanged.
Source-preview positions undo these new display edits relative to the input
after the **existing** math normalization; this is not a repair or guarantee
for older math preprocessing offset shifts.

Limits are 524,288 UTF-16 source units, 8,192 tokens/edits and 64 detection nesting
levels. Invalid detection or exhausted budgets leave input unchanged, not
truncated. Work runs only through mounted render inputs; it adds no observer,
timer, request, dependency or persistent field. CPU/RSS and browser geometry
have not been measured for this fallback.

`skipHtml`, sanitization, safe links/images and local KaTeX policy remain enabled.
Importer originals, PostgreSQL Markdown, exports, `.cr`, offline packages v1/v2/v3
and Dexie v2 are not migrated or rewritten.

## Math delimiter profile

| Source delimiter | Semantic node |
| --- | --- |
| `\(...\)` | `inlineMath` |
| `$...$` | `inlineMath` |
| `\[...\]` | `math` |
| `$$...$$` | `math` |

CommonMark consumes backslash punctuation escapes before `remark-math` sees them. `remarkAiMathCompatibility` therefore uses mdast source positions to recover bracket/parenthesis delimiters only in normal Markdown text. It never scans rendered DOM and never performs a blind source string replacement. `code` and `inlineCode` nodes are excluded.

Some ChatGPT clipboard/export paths consume only the outer escapes before ingestion. `ai-rich-markdown-v4` recognizes bounded compatibility shapes without rewriting source:

- standalone `[` and `]` lines (or `/[` and `]/`) become display math when their body contains a recognized LaTeX command or a conservative mathematical token grammar; compact products such as `kn` are accepted only inside this strong standalone-bracket context;
- compact parentheses embedded in prose, such as `(n^6)`, `(1/3)`, `(k)` and `(n)`, become inline math when they satisfy the same bounded grammar. Prose phrases, dates, versions, uppercase identifiers such as `A1`, currency and code do not qualify.

The standalone-bracket grammar recognizes a bounded set of common KaTeX scientific commands, including Greek symbols, set relations, `mathbb`/font commands, products, inner products and labeled arrows. Explicit TeX spacing is accepted only inside a standalone display candidate. This does not make arbitrary prose or inline text a formula.

ChatGPT also emits conceptual display labels inside the same standalone brackets. A label qualifies only when it is at most 80 characters, each label token starts uppercase and contains no free whitespace, and any operator is `>` or `+`. Examples include `Image > Text`, `Image+Text`, `OCR/Text`, `Text-only`, `Question` and `Answer + Provenance`. The UI-only value wraps labels in KaTeX `text{...}`; canonical Markdown keeps its original brackets. Lowercase prose and multiword prose remain paragraphs.

Because canonical API RenderBlocks may split a bracket region at blank lines, Reader presentation may project adjacent paragraph/heading blocks into one semantic Markdown input while preserving every persisted block and the original source. Setext underline/heading artifacts are normalized to an equality only inside an already established formula boundary. Bare prose brackets and ordinary Markdown headings are not math.

Single-dollar parsing is deliberately conservative. Mathematical signals remain math, while pure numeric/currency-like spans such as `$20$`, `$20 and $10$`, and ordinary `USD $20` text remain literal. Use `\(20\)` for an unambiguous numeric formula.

Macros are scoped to one KaTeX render. No macro state is shared across messages or versions. `mhchem`, MathJax fallback and AsciiMath are not enabled.

## KaTeX, errors and accessibility

KaTeX is locally bundled and configured as follows:

```text
output = htmlAndMathml
trust = false
throwOnError = false
strict = warn
maxExpand = 1000
maxSize = 20
```

MathML remains present for assistive technology. A malformed formula becomes a local escaped `data-math-error` fallback with status text; other Markdown continues rendering. Arbitrary trusted commands and external resource loading are disabled. Formula failures must not blank a Message, Reader or Viewer.

Display formula containers own `overflow-x: auto`. The Reader page width is unchanged. Tables and code blocks likewise own their two-dimensional overflow.

## GFM, footnotes and code

The supported profile includes CommonMark headings/lists/quotes/code plus GFM tables, task-list presentation, strikethrough and autolinks. Markdown task-list checkboxes remain presentation unless the existing owner task-binding contract supplies stable business task keys.

Footnote reference/backlink IDs are namespaced with the rendering scope (normally MessageVersion or attachment identity), preventing repeated `[^1]` labels from colliding. Canonical blocks may split a reference and standalone definition; Reader projects current-version blocks back into one semantic parse without changing stored text.

Inline and fenced code are parsed before the AI math transform. Math delimiters inside code stay code. Existing Shiki/plain-code fallback remains authoritative. Mermaid behavior is unchanged; no new diagram runtime is introduced.

Reader headings use the same sanitized KaTeX subtree as paragraphs. A presentation wrapper must not apply an element allowlist after KaTeX because stripping its wrappers exposes the hidden MathML text, TeX annotation and visual HTML simultaneously. Heading images remain suppressed by the React component map instead of by destructively unwrapping semantic output.

## HTML, links and images

- Raw user HTML is inert: `skipHtml` and the sanitizer remain enabled.
- Links allow existing safe anchors/paths and approved `http`, `https`, and `mailto` schemes. External links use `noopener noreferrer`.
- `javascript:`, `vbscript:` and unsafe `data:` targets are not executable links.
- Remote Markdown images are not auto-loaded. The renderer shows an inert placeholder and explicit safe link where allowed.
- Attachment-backed images continue through the Attachment Renderer contract; this phase does not change attachment identity or Viewer architecture.

## Performance and offline assets

Rich Markdown is parsed per mounted message or attachment. There is no whole-Reader DOM scan, KaTeX auto-render pass or post-mount rewrite. Source Editor live preview is opt-in and starts collapsed on every workspace open; once opened, `useDeferredValue` keeps preview work behind typing, while CodeMirror's external baseline remains independent from preview rendering.

The local editable Table tool keeps its Markdown element stable for unchanged
normalized display text and scope, independently of the live cell callback.
Context consumers still update editable values/handlers, but callback-only changes
do not re-enter `react-markdown` and parse the same text. Only the mounted preview's
current element is retained, not a global or historical-source cache. The tool
validates the draft during editing and repeats source/range validation on Apply;
this optimization does not reduce that safety boundary.
Its Markdown/editor state remains urgent while the rendered GFM/math snapshot uses
React's deferred value during rapid edits. The preview exposes `aria-busy` and a
short status while catching up; Apply is disabled until the exact current snapshot
has rendered and passed table-shape verification. Other cell entry/navigation and
edge additions are also disabled against an outdated preview, while the active
cell input retains focus and continues to accept typing. Escape during catch-up
returns to Markdown instead of trying to focus a disabled cell button.
Vertical cell navigation can cross row pages; newly inserted edge rows/columns
receive the corresponding first-cell/header focus. These are pending focus
requests scoped to the grid, not navigation history: a later focus in Markdown
or another control cancels them. Shift+arrow keys in the active input preserve
native text selection, while Shift+Enter moves to the previous row. Enter at
the final row remains in the input and never submits the containing source form.
The first/last column likewise retains an active input when no horizontal
destination exists. Stable cell components and live callback context preserve
the active input when plain text gains rich syntax; Escape restores the current
cell and never targets a retired input.
Raw Markdown values update immediately; their table parsing also uses a deferred
snapshot, accepted only while it still equals the current input. Apply, new cell
entry/navigation and edge additions stay blocked during source parsing as well
as rich-preview catch-up. Existing grid input can continue during rich catch-up,
but cannot overwrite a newer, unparsed Markdown edit. Neither deferred path
interrupts an already-running parse or guarantees removal of main-thread long tasks.
For a canonical, valid grid draft, a cell edit serializes only its changed physical
row and updates the UTF-8 total by the old/new row delta. Raw-source edits, invalid
draft recovery and row/column additions retain full serialization/byte checks.
Canonical line starts are retained only for the current mounted draft and updated
by the row delta; structural/raw edits invalidate them. Plain single-line raw
edits can also reuse the parsed rows when shape, newline and byte bounds agree.
This avoids repeated inline-syntax parsing, not all full-source scans or copies;
arbitrary/rich/structural edits still use the deferred authoritative parser.
The Markdown textarea remains controlled by React state; there is no independent
DOM draft or animation-frame write queue. Normalization strips only ASCII space
and tab padding from cells, preserving NBSP, BOM and other Unicode spacing as
content. Boundary trimming uses linear scans rather than backtracking suffix
regular expressions; the existing large-whitespace watchdog remains required.
Delimiter-shaped values (`---`, `:---:`, etc.) in the header or body remain
literal cell content. Only the separator immediately after the header is
structural; subsequent marker rows are data. Cursor discovery narrows around
the first eligible separator after an opening line, while an explicit selection
with only a later, ambiguous separator fails closed. Full, simple and
incremental draft parsing use that same distinction.
The table tool reuses one local `TextEncoder` instance for its repeated UTF-8
budget checks. This is an object-construction reduction only; it does not cache
source text or alter byte accounting. If the settled rich preview does not
contain the expected table shape, Apply remains blocked and the dialog exposes a
specific correction message instead of an unexplained disabled action.
Table-inline bracket classification uses one lazily allocated suffix index per
operation instead of rescanning from every opening image. Two linear passes keep
the previous independent code/escape/reference contexts, including nested and
unclosed syntax; there is no arbitrary nesting cutoff or global cache. The index
costs four bytes per input UTF-16 code unit plus one sentinel, only when needed.
A cell exceeding the existing 1 MiB tool budget by code-unit length is rejected
before syntax indexing/escaping; complete serialized UTF-8 checks still apply.
This local source-tool fix is not a new shared Markdown renderer or a server OOM
claim. Ordinary large-table rich-render long tasks remain.
The existing cell scanner also declines actual HTML table-tag syntax outside
code/escapes/literal reference or alt data. Complete-table and incremental cell
validation use that same rule. A code example such as `<td colspan="2">` or plain
attribute prose is not itself an HTML table; the old whole-fragment substring
refusal no longer blocks those cells. Fixed-form sticky matching checks at the
current offset without suffix copies or overlapping whitespace patterns.
Real HTML tables/merged cells remain unsupported; `skipHtml` and renderer
sanitization are unchanged. Ambiguous inline syntax can still be declined.
Inline backtick runs establish code context only when an equal-length closer
exists. Unpaired ticks stay literal, so they cannot swallow later column
separators or hide unsupported HTML/math structure. Both row scanning and pipe
serialization use a lazy per-operation linear match index: one byte per input
code unit, allocated only when a backtick needs classification, with no global
cache. Escaping can consume an opening run's first tick, but backslashes inside
code cannot escape its closer. Matched-code pipe repair remains supported.
For malformed rows, ordinary unescaped pipes still separate cells; existing
maximum-column padding preserves excess content rather than silently dropping
it to reproduce GFM's truncated rendering.
Automatic table discovery reads the existing CodeMirror Markdown code-block
context rather than maintaining a second fence scanner. The source editor
captures its maintained tree through the active line; the dialog and Apply
reuse it only with matching source and sufficient parsed coverage. An unusable
snapshot falls back to parsing the source prefix through the table header,
never the table body or following text. This is a per-operation fallback, not
a global AST cache; work can still grow with a long prefix. CodeMirror's
`ensureSyntaxTree` work hint is not a hard real-device latency guarantee.
Fenced/indented examples require an explicit complete selection. Quote/list
content cannot close another container's fence, and leaving a container ends
its code context according to the parser. The neutral preview renders only the
table body so a missing outside list ancestor cannot turn its indentation into
code; source prefixes remain unchanged in Markdown and Apply.
For sources containing `<`, editor nodes alone are not sufficient authority:
installed CodeMirror ends textarea at a blank line but can wrongly continue
ordinary quoted HTML across an empty quote payload. A bounded mounted
`MarkdownTableSourceProbe` uses the existing ReactMarkdown/remark configuration,
collects actual literal/definition ranges, then empties the AST before HAST,
KaTeX or DOM generation. It does not call a React component as a parser function,
add a dependency, or introduce another HTML/fence scanner.
It follows the existing display-math and rich-layout projections, restoring
coordinates to the frozen original source. Differential math-projection tests
bind its output to the existing normalizer. The complete proof is reused during
bidirectional editing and passed to the final source/range revalidation.
Stale/incomplete/absent proof cannot authorize automatic HTML-context editing.
Explicit complete selections still edit samples without removing wrappers or
loosening `skipHtml`.
Input is capped at 1 MiB UTF-8, traversal at 100,000 nodes and retained ranges at
8,192. Exhaustion fails closed with complete-selection recovery, never truncated
source or guessed authorization. AST parsing itself is bounded by input size,
not by a claimed time/heap SLA; no process-global or historical-source cache.
When no original table is available, the dialog omits both the inert blank
Markdown field and the dead Apply action. The dialog's accessible description
uses the existing recovery explanation; Back to source restores editor focus.
Identified tables' incomplete/invalid or stale drafts retain editable source
and disabled Apply safeguards, with the last valid preview where available.
This is conditional UI, not a parser, canonical-data or authorization change.
To bound rich-renderer work from one pathological cell, visible cells longer than
32,768 UTF-16 code units are replaced with an empty display-only value before the
shared GFM/math renderer parses the table; the cell UI shows an ellipsis and a
current-page count. The full Markdown, editable cell value, canonical serialization,
and Apply transaction retain the exact content. This is a renderer-input bound, not
a source-size limit or a claim that all browser rendering costs are bounded.
The editable preview normally mounts at most 400 cells per page (including the
header). Above 3,200 source cells (including header/delimiter), it uses a 120-cell
preview budget. A complete header and at least one data row still render, so a
200-column table may mount 400 cells even on that adaptive path. Both paths cap
data rows at 30; neither lowers the 50,000-cell source-tool limit or truncates
Markdown/Apply data.
Multi-page tables expose First/Previous/Next/Last commands and the actual row
range. Commands only change the bounded preview page, not Markdown or the draft.
At a boundary, a newly disabled focused control hands focus to its enabled
adjacent pager control; it does not enter a cell or override another chosen
control. Single-page tables omit the strip. The 44px controls stay together and
the range may wrap above them on narrow screens; no full-table mounting, new
page-number input or new tool mode is introduced.
Bounded, unthrottled client observations and remaining long tasks are documented in
the [large-table record](../execution/TABLE_TOOL_PERFORMANCE_2026-10-20.md) and
[adaptive continuation](../execution/TABLE_TOOL_ADAPTIVE_PREVIEW_2026-10-20.md);
they are not server RSS/OOM or cross-device performance acceptance.

KaTeX CSS comes from the local package. Offline shell preparation deterministically includes current styles/scripts and same-origin `KaTeX_*` font files referenced by current `@font-face` rules. It does not scan arbitrary historical Performance resources. An offline-ready shell therefore includes math CSS and fonts without a CDN.

Search and exports continue using canonical Markdown/searchable text. KaTeX spans and MathML never enter search indexes, Markdown/CanJSON exports or `.cr` canonical records.

## Supported and deferred syntax

Supported now: four math delimiters, common KaTeX aligned/matrix/cases environments, GFM tables/tasks/strike/autolinks, footnotes, fenced/inline code, headings, blockquotes, the frozen existing single-newline visual-break policy and the bounded rich-text reading fallback above.

Deferred by design: MathJax fallback, AsciiMath, `mhchem`, arbitrary raw HTML, new callout syntax and new Mermaid behavior. Unsupported KaTeX commands use the bounded local fallback.

## Regression evidence

- `scripts/ux/chatgpt-rich-text.test.mjs`: 35 service-free parser/SSR checks, including the original 27 v5 checks plus actual editable-table coordinates/math, inert links/images, GFM alignment and normalization MathML/code/reference integrity, literal/code-backtick escaped-pipe fidelity and Unicode/autolink/control-character cell presentation. Explicit assistant-ui/virtualizer adapters are not full Reader browser acceptance.
- `scripts/ux/source-editor-table-tools.test.mjs`: 52 service-free checks, including
  single-cell validation, seeded equivalence with the former bracket classifier,
  6,000 balanced nested images, actual GFM code-context comparisons, frozen-tree
  reuse/stale coverage, prefix-only fallback, literal HTML block protection,
  eligible HTML boundaries, same-offset CRLF parsing, literal HTML code/attribute
  content versus unsupported structures and isolated malformed-input/deep-quote/
  HTML-looking whitespace watchdogs, literal backticks, an independent seeded
  code-span match oracle, 1,000 distinct unpaired backtick runs, conservative
  incremental plain edits, UTF-8 bounds, Unicode boundary-content preservation,
  delimiter-shaped literal cells and ambiguous-selection/range safeguards.
  The Node Worker is test isolation only, not a new browser parser worker.
- `scripts/ux/source-editor-table-references.test.mjs`: 10 checks using the installed CodeMirror parser for context identity, code/container exclusion, CRLF HTML boundaries, UTF-8/count bounds and explicit incomplete context.
- `scripts/ux/source-editor-table-context.test.mjs`: five source-probe/projection
  checks. These plus 52 table, 10 reference and 35 shared-renderer cases total 102;
  adding the 20 common-focus cases gives the current 122-case focused gate.
  Earlier 71/75/83-case checkpoints retain their original scope and source hashes.
- `scripts/ux/source-editor-table-browser.mjs`: explicit local-only Chrome gate, not part of `*.test.mjs`. Actual dialog/focus/parser/renderer/CSS and SourceEditorWorkspace/EditMessageForm/CodeMirror, with synthetic APIs/Next loader and unrelated UI adapters. The assistant-ui test adapter now forwards actual source into the renderer core rather than returning null. See the [initial component record](../execution/TABLE_TOOL_EDITING_2026-10-20.md), [real workspace continuation](../execution/TABLE_TOOL_WORKSPACE_2026-10-20.md) and [27-scenario integrity checkpoint](../execution/TABLE_TOOL_CONTENT_INTEGRITY_2026-10-20.md); none accepts authenticated server, Reader/Share/Offline or resource behavior.
- The [long-cell continuation](../execution/TABLE_TOOL_LONG_CELL_2026-10-20.md) uses synthetic 40,000-character cells to verify the display-only renderer bound and exact Apply preservation; it does not represent real-device latency or broad memory/resource acceptance.
- The [parser-reuse continuation](../execution/TABLE_TOOL_PARSER_REUSE_2026-10-20.md)
  verifies callback-only parser-entry avoidance against a failing browser baseline
  and exercises deterministic suspended previews (latest/invalid drafts, continued
  input, focus and refresh). It retains the installed renderer behind a counting/
  hold wrapper, not a parser substitute; 35 local scenarios are not full app or
  real-device acceptance.
- The [bracket-index continuation](../execution/TABLE_TOOL_BRACKET_INDEX_2026-10-20.md)
  records the quadratic nested-image baseline, linear-index repair and
  240,000-code-unit malformed Markdown recovery in the actual workspace,
  followed by a reproduced deep-quote fence-scan timeout and its repair.
  The latest local browser gate passes 37 scenarios; bounded Node timings do not
  establish ordinary large-table, real-device or server-memory acceptance.
- The [keyboard/focus continuation](../execution/TABLE_TOOL_NAVIGATION_2026-10-20.md)
  extends existing actual-browser scenarios with cross-page movement, four new-cell
  focus assertions and native Shift+up/down selection. All 37 scenarios and local
  Web gates pass at that checkpoint. The separate five-case GFM comparison
  exposed fence/container-context mismatches; the next continuation repairs them.
- The [code-context continuation](../execution/TABLE_TOOL_CODE_CONTEXT_2026-10-20.md)
  repairs those five mismatches on identical actual GFM output, replaces the old
  bounded legacy comparison with 500 actual GFM code-context comparisons, and
  passes 41 real-dialog/workspace browser scenarios. New cases verify protected
  examples, outside-container recovery, nested-list preview/indentation and
  deliberate code selections. A transparent parser-call counter observes no
  standalone context parse in the tested editor-snapshot paths; it does not
  imply no background/incremental parsing or a universal performance bound.
- The [literal-context continuation](../execution/TABLE_TOOL_LITERAL_CONTEXT_2026-10-20.md)
  retains the raw-HTML and CRLF regression baselines, exact source/offset
  preservation, real full-source preview checks, explicit sample editing and
  49 Chrome scenarios. Later diagnostics exposed missed textarea behavior and
  an introduced false refusal of a real quoted table; those failures are not
  folded into the smaller scope's green gate counts.
- The [GFM-context continuation](../execution/TABLE_TOOL_GFM_CONTEXT_2026-10-20.md)
  repairs the three observed differences with source-bound actual-parser proof,
  retains its failing browser baseline, and passes 83 focused / 56 Chrome /
  1,491 service-free checks plus Web gates. Real source preview, Apply/Undo,
  proof reuse/refresh, oversized recovery and projection offsets are exercised.
- The [empty-state continuation](../execution/TABLE_TOOL_EMPTY_STATE_2026-10-20.md)
  retains those context checks, adds compact empty-state/focus/description
  verification and passes 57 Chrome scenarios with the same 83 focused/1,491
  service-free cases and Web gates. A viewport-reset test-assumption mistake is
  preserved separately from final verified 1440/375px geometry.
- The [recovery-action evidence](../evidence/table-tool-recovery-actions-2026-10-20.json)
  records the subsequent removal of unavailable Apply, not the safeguards on
  identified drafts; the same 57 Chrome/83 focused/1,491 service-free checks
  and Web gates pass again, with source-bound receipts and actual 1440/375px.
- The [input review](../execution/ux-audit-table-input-2026-10-20.md) retains the
  composing-Escape draft-loss baseline and shared-focus repair. Its 103 focused
  checks include 20 common-hook cases, with 59 Chrome scenarios and 1,494
  service-free cases plus Web gates. CDP composition checks trusted Escape in
  both cell and Markdown fields, then ordinary dismissal; this is not a physical
  IME candidate-window or cross-browser acceptance.
- The [HTML-cell review](../execution/ux-audit-table-html-cells-2026-10-20.md)
  retains the 35-pass/2-failure unit baseline and 59-pass browser failure.
  Its final 106 focused, 61 Chrome and 1,497 service-free cases plus Web gates
  verify literal content, actual-structure refusal, correction, Apply/Undo and
  375px Chinese touch. The isolated fixed-size whitespace/angle watchdog is not
  a general parser-time, heap or server-resource guarantee.
- The [literal-backtick review](../execution/ux-audit-table-code-span-2026-10-20.md)
  retains the 70-pass/4-failure expanded baseline and passes all six local gates:
  111 focused, 62 Chrome and 1,502 service-free cases, lint, nonincremental
  typecheck and single-worker build. Actual Reader/editable-preview output,
  900 synthetic GFM comparisons, desktop Apply/Undo and 375px touch are checked.
  An opt-in five-workload profile still observes large-table long tasks; neither
  its CPU samples nor the isolated Node watchdog establish an OOM/latency SLA.
- The [pending-parse review](../execution/ux-audit-table-pending-parse-2026-10-21.md)
  retains the actual Chrome enabled-Apply failure while raw parsing was suspended.
  Independent parser/renderer scheduling probes verify protection and newest-input
  recovery. All six source-bound local gates pass: 111 focused, 64 Chrome and
  1,502 service-free cases, lint, nonincremental typecheck and one-worker build.
  The preceding adaptive-input checkpoint retains its own 62 scenarios and
  sequential performance observations; neither accepts all main-thread costs.
- The [row-boundary review](../execution/ux-audit-table-page-navigation-2026-10-21.md)
  preserves missing-command and intermediate focus-loss failures. The direct
  commands, boundary focus, exact tail edits, model shrinking and 320/375px touch
  Apply/Undo pass in 67 Chrome scenarios. All six source-bound gates also pass
  111 focused / 1,502 service-free checks plus Web gates. Expanded profiling
  separates first-row, tail, source, navigation and GC phases; older unsegmented
  long-task totals cannot be attributed only to grid input. Long tasks remain.
- `apps/api/tests/test_chatgpt_rich_text_source.py`: three pure importer/block-building checks retain exact synthetic source/hash and task offsets. Current v5 evidence is in [the rich-text report](../execution/ux-audit-chatgpt-rich-text-2026-10-15.md); older browser/production evidence below does not accept this new fallback.
- `ai-rich-markdown-parser.spec.ts`: parser delimiter, consumed inline/bracket compatibility, prose/date/version/code exclusions, currency and canonical-source invariants.
- `ai-rich-markdown.spec.ts`: real Reader/Editor DOM, golden formula, 109-formula stress, security, MathML and 360px overflow.
- `production-rich-markdown-copy.spec.ts`: an ephemeral UTF-8 copy of the reported production source, full Source Preview semantic count and cleanup through the product API.
- `production-rich-markdown-scientific-copy.spec.ts`: an ephemeral copy of a scientific ChatGPT source, common command coverage, canonical-source equality and cleanup through the product API.
- `ai-rich-markdown-attachment.spec.ts`: real `.md` upload, occurrence save, inline preview and unified Viewer.
- `library-offline.spec.ts`: deterministic KaTeX font inventory and offline cold start.
- `reader-restoration.spec.ts`: heavy Reader windowing, scroll, navigation and Share regression.

API success alone is not Rich Markdown user-flow PASS. Production-equivalent browser results and the latest production Chrome result are higher-level evidence.
