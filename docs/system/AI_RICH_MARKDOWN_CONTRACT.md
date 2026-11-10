# AI Rich Markdown Renderer Contract

Last synchronized: 2026-11-11

## Reading-density extension — released 2026-11-11

Exact `3564cbf` / CI `42828329240` is deployed; the release pointer is in
[Project State](../../PROJECT_STATE.md).
Normal reading tables now keep only two labelled 44px copy/download icons in
a fixed-width side rail **outside** the cell scroller. Fine-pointer hover and
keyboard focus reveal them using opacity only; coarse/no-hover devices retain
visible controls. There is no table title, header/security checkbox or permanent
protection count. Headers and spreadsheet-formula escaping remain enabled.
This affects presentation/export controls, not Markdown parsing or canonical data.

Cell text and TSV/CSV are read/serialized only on explicit actions, not during
render or hover. The full 50,000-cell bound is checked before extracting any
cell values. KaTeX's TeX annotation is exported once, without removing MathML
or visual DOM from the reader. Clipboard success expires after three seconds;
download feedback means the browser was asked to download, not a proven disk save.
Feedback changes only the existing icon and live region, not body geometry.

Over-limit/unsupported tables offer an explicit copy/download of the input
Markdown **segment**, including any surrounding segment content; they do not
silently truncate, guess cells, or label Markdown as CSV. The exact segment is
passed separately from display projections/offsets. This is not the whole-message
copy/publication contract. Clipboard denial provides a selected read-only field.
Recovery uses the existing modal focus lifecycle and stays until a user action;
late retired source/mount results cannot resurrect feedback.

Inline CSV/TSV attachments now use the same quoted-field parser as Viewer.
They render an 8-row/8-column prefix (28 rows when expanded), with one record
lookahead and smaller input/cell budgets. Quoted separators, escaped quotes,
multiline cells and empty fields retain their meaning. Optional smaller budgets
cannot enlarge Viewer's existing ceilings. Expansion counts logical records,
not newline characters inside a quoted value; partial previews retain the
existing full-table action.

The [recovery ledger](../execution/RECOVERABLE_OPERATIONS_2026-11-10.md) records
local checkpoints; the [release receipt](../execution/RECOVERABLE_OPERATIONS_RELEASE_2026-11-11.md)
records exact CI Reader/Share/Offline/stability acceptance and its limits.

## Purpose and canonical source

The November10 density follow-up, released November11: code actions occupy one fixed44px
rail, visible on hover/focus or touch, without geometry changes. Meaningful
language is retained; an empty/`text` default label is omitted. Full source copy,
wrap/expand and persistent manual-copy recovery remain. Mermaid already omits
the generic header; authored accessible titles/descriptions and source/failure
disclosure are not removed for visual minimalism.

Inline attachment text uses an explicit128KiB prefix with30-second preparation/
inactivity bounds. A Range-ignoring response is cancelled at that prefix;
invalid ranges/incomplete responses fail into the existing recovery row.
Partial content is disclosed independently of a caption. One full-preview
entry remains below the content and original download remains in its header.
This does not change full Viewer byte policies or truncate canonical content.

Chat Reader renders modern AI conversation Markdown through one semantic core. PostgreSQL `MessageVersion` Markdown remains canonical. Rendering never rewrites `\[...\]` to `$$...$$`, never persists KaTeX HTML, and does not add a database migration or export field.

```text
canonical Markdown source (unchanged)
-> bounded display-only compatibility projection where recognized
-> react-markdown / unified parser
-> remark-gfm + source-position-aware callouts + frozen AI soft breaks + remark-math
-> AI math compatibility AST transform
-> bounded safe-HTML and highlight AST projections
-> sanitized HAST
-> KaTeX semantic renderer
-> safe React components
```

Supported static HTML is allowlisted and projected into inert HAST nodes;
unsupported or malformed HTML remains visible as inert text/code. Every path,
including generated callouts and HTML, still passes through sanitization.
The HTML projection merges adjacent HTML AST fragments and intervening
whitespace-only nodes within the same Markdown parent before parsing. This
supports common exporter cards whose balanced elements are split into several
HTML nodes, including a block card followed by Markdown prose, without treating
arbitrary Markdown/code as HTML. It does not merge across unrelated Markdown
blocks, code, or parents. Each merged fragment still must pass the bounded
balanced-tag/attribute/style allowlist; unsupported or malformed markup stays
visible and inert. ZIP-local resource identity is handled only by Adaptive
Import's explicit archive-member mapping; ordinary raw HTML does not guess
relative paths. Callouts run before text-splitting transforms; source ranges
are derived from raw source lines or omitted when not provable. Exact
navigation reveals supported disclosure ancestors, including those of a
matched text Range, without expanding unrelated cards in the same block.

`remark-safe-html.ts` supports safe `details`/`summary` composition, including
contiguous HTML fragments. Obsidian `![[wikilinks]]`, Bases, Dataview, Canvas,
community plugins, macros and arbitrary JS remain out of scope. These require
source-specific parsing or resource contracts and must not be represented as
supported merely because they resemble Markdown.

`RICH_MARKDOWN_RENDERER_VERSION = ai-rich-markdown-v13` identifies the parser/render policy. A future parsed-result cache must include source hash, MessageVersion identity and this version. Generated HTML is never canonical. This display-policy version is separate from the import parser version.

Attachment occurrence resolution traverses both ordinary Markdown nodes and
the allowlisted HTML projection before sanitization. Links/images/audio/video
retain authorized occurrence identity and real DOM anchors, including fallback
states. Offline blob sources are recovered only from the trusted attachment
context; blob protocols and source-provided identity attributes are not
globally allowlisted. Repeated resources use their ordered block occurrences.
The [completion audit](../execution/ux-audit-reader-zip-completion-2026-11-03.md)
records shared-renderer tests and the outstanding browser/geometry gates.

## Shared consumers

The same semantic and security configuration is used by Reader message Markdown, Source Editor live preview, Markdown attachment inline/Viewer rendering, and existing annotation/import surfaces that consume `MarkdownRenderer`. Presentation wrappers may differ; Math/GFM/footnote/code/link semantics must not diverge.

The local Table tool's `MarkdownTablePreview` uses the existing
GFM/math/sanitization configuration for all cells, including plain text. It does
not bypass the shared parser with a separately constructed table. Its stable cell components expose actual
table cells for editing; post-sanitization application-owned coordinates do not
authorize source HTML. Links become inert styled text and images inert alt text
in this editing surface; audio/video also become inert text rather than mounting
players or requesting metadata. A cell click cannot navigate or play media.
Normal Reader links/images retain their existing policy. Both normal and editable
table cells retain the parser's GFM left/center/right alignment style; no parser
version, canonical data or export contract changes.

Normal tables and editable previews also share `MarkdownTableScroll`,
`MarkdownTableContent` and `MarkdownTableCell` presentation primitives from
`markdown-table.tsx`. Normal message tables own the outer horizontal scroller;
the Table tool reuses the content/cells inside its existing bounded two-axis
scroller, without adding a second table or another outer scroll layer.
Normal table source-position attributes remain on the outer wrapper. Header
semantics, alignment and existing row stripe/hover tokens are retained.
Cell content is bounded to 28rem (18rem below 640px); prose can wrap, while
unbreakable formulas/code overflow inside their cell rather than adjacent cells.
This display-only bound does not truncate Markdown, add editing controls to
read-only consumers or change the parser/cache version.

The Table tool's header contains focused-row/focused-column menus and structural
Undo. Focusing a cell establishes the target; opening a menu highlights its
whole visible row/column and names the target. Menus expose insert before/after
and delete, apply to the full draft rather than the preview page, keep at least
one column and preserve the fixed GFM header. Zero data rows are allowed.
No per-cell menu handles or reserved handle padding are mounted. Menu portals
remain inside the dialog focus scope; Escape returns to the trigger without
closing the tool. At narrow widths the visible label drops its index, not its
accessible name or 44px hit target.

Structural Undo retains at most eight immutable draft snapshots and a 2 MiB
serialized-UTF-8 budget; it is not an unbounded typing history or a measurement
of actual JS heap size. Subsequent cell/Markdown edits invalidate that history
so Undo cannot silently discard newer text. A concise footer live region reports
changes without creating a separate toolbar. Small tables start with a 96px
resizable Markdown input (three to six initial rows), not a permanently 160px
pane. Apply still modifies only the original CodeMirror range in one transaction;
server save/version semantics are unchanged.

The four Table tool edge controls live outside the cell scroller, within the
same focus scope. CSS reserves their full 44px hit regions around the visible
preview, so wide/long content cannot displace them to a hidden content midpoint
or cover cells/scrollbars. Additions still modify the whole draft, not the visible
page. A 24px-gutter density trial failed real hit tests and was withdrawn; it is
not the current layout. The [shared-body implementation](../execution/TABLE_BODY_SHARED_PRESENTATION_2026-10-22.md)
records its 81-scenario isolated Chrome checkpoint, including actual body rendering.
The [2026-10-25 reading audit](../execution/ux-audit-chatgpt-reading-2026-10-25.md)
added two body cases at its historical 83-scenario checkpoint. The
[remaining-work continuation](../execution/CHATGPT_READING_REMAINING_2026-10-25.md)
extends the isolated gate to 86 and separately exercises actual local
authenticated Reader, guest Share and downloaded Offline Reader. The component
gate itself is still not authenticated three-chain acceptance.
The earlier [edge-reachability continuation](../execution/TABLE_TOOL_VIEWPORT_EDGES_2026-10-20.md)
checks real coordinates/hit tests, mouse/touch and post-add focus in 45 local
Chrome scenarios. This is presentation-only; no extra table, parser, edge scroll/
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
ChatKit runtime. At least one standalone balanced box with a recognized rich
child must establish the profile outside protected code. Detection finishes all
recognized candidates in the current input before authorizing recovery:
escape flags aggregate across boxes, and a later recognized mismatched,
unclosed or over-depth structure rejects the profile instead of allowing
partial conversion. Unsupported attributes/tag shapes are still skipped by
the existing scanner; this is not validation of arbitrary markup.
Unknown attributes do not authorize a profile.
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
TeX or HTML. Existing inline/indented/fence guards are supplemented by the
installed CodeMirror Markdown parser's fenced-code ranges, including nested
quote/list and unclosed fences; CRLF masking preserves original offsets.
Literal examples do not authorize a profile or lose their tags.
This is not a general HTML/container parser. Missing content, original card styling,
arbitrary widgets and exporter changes are not reconstructed.

Full current-version text supplies ephemeral profile metadata to canonical
blocks, including both virtualized paths and leading thinking. These fragments
inherit the established full-text profile; they are not independently required
to contain a balanced outer box. Block IDs,
indices, raw copy strings, task identity and canonical data remain unchanged.
Source-preview positions undo these new display edits relative to the input
after the **existing** math normalization; this is not a repair or guarantee
for older math preprocessing offset shifts.

Limits are 524,288 UTF-16 source units, 8,192 tokens/edits and 64 detection nesting
levels. Invalid detection or exhausted budgets leave input unchanged, not
truncated. After the compatibility projection, unsupported/rejected HTML parser
nodes become visible text (inline) or plain source-code blocks (flow), not
executable HAST. This also makes malformed/over-budget source readable without
relaxing detection budgets or attempting partial rich-layout recovery.
No arbitrary HTML, scripts or widget runtime are enabled.

Work runs only through mounted render inputs; it adds no observer, timer,
request, dependency or persistent field. The local Chrome harness checks
mixed-box semantics, code, inert HTML, Mermaid alternatives and overflow at
1440/375px. A separate local API/worker/PostgreSQL E2E verifies the same complete
turn and actual message DOM anchors in Reader, guest Share and offline reload.
It does not establish position-restoration geometry, physical-device behavior,
CPU/RSS, general latency or sustained performance.

`skipHtml`, sanitization, safe links/images and local KaTeX policy remain enabled.
Importer originals, PostgreSQL Markdown, exports, `.cr`, offline packages v1/v2/v3
and Dexie v2 are not migrated or rewritten.
The [dated audit and adjacent synthetic evidence](../execution/ux-audit-chatgpt-reading-2026-10-25.md)
own the original 20-candidate checkpoint and controlled baseline comparison.
The [follow-up record](../execution/CHATGPT_READING_REMAINING_2026-10-25.md)
owns subsequent HTML/code/type repairs and remaining source-dependent adapters.
The v7 changes are local only, not accepted by an older production release.

Source Editor offers an on-demand reading-policy disclosure: preview is
display-only, unsupported markup stays visible/inert and stored source is
unchanged. Adaptive mapping uses the same shared renderer with explicit bounded
sample/source modes (see [API bounds](BACKEND_AND_API.md#json--markdown-pairing-v5-current)).
Import completion keeps its first four warnings visible and exposes the
remainder through a native, counted disclosure; warnings are not discarded.

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

Inline and fenced code are parsed before the AI math transform. Math delimiters inside code stay code. Existing Shiki/plain-code fallback remains authoritative.

The existing Mermaid runtime remains strict. Supplied SVG `title`/`desc`
(including `accTitle`/`accDescr`) provide the image label and associated visible
description; absent descriptions are not invented. Every diagram retains an
accessible native source disclosure. Failure shows localized status and opens
the exact source; Mermaid's global syntax-error drawing is suppressed so failure
cannot leave orphan graphics outside the message. No new diagram runtime or
raw source-HTML insertion is introduced. This is not screen-reader conformance
acceptance.

Code-block copy uses the shared source-scoped clipboard controller. Pending
requests disable duplicate clicks; only a successful matching request shows
Copied. A missing or denied Clipboard API shows a localized alert and labelled,
read-only manual-copy field containing the full source, including collapsed
lines. The field is focused/selected and excluded from semantic Markdown-copy
content. Retrying or changing source retires stale feedback; no source rewrite,
deprecated copy command or automatic retry is introduced. This does not change
the highlighting, parser, offline package or canonical-data contract.

Reader headings use the same sanitized KaTeX subtree as paragraphs. A presentation wrapper must not apply an element allowlist after KaTeX because stripping its wrappers exposes the hidden MathML text, TeX annotation and visual HTML simultaneously. Heading images remain suppressed by the React component map instead of by destructively unwrapping semantic output.

## HTML, links and images

- A bounded Markdown-AST transform renders only an inert HTML subset: text,
  semantics, lists, details, cards, tables, links, images and local audio/video.
  Scripts, event attributes, arbitrary classes/IDs, frames, dangerous URLs and
  external media are rejected before HAST; rejected or malformed input remains
  visible as inert text/code. The output still passes through
  `rehype-sanitize`, and canonical Markdown is unchanged.
- Obsidian `> [!TYPE]` callouts, `+`/`-` folding markers and `==highlight==`
  are projected at AST level. Callout titles and bodies keep their original
  inline Markdown nodes, link targets, math, tasks and source positions; they
  are not flattened and reparsed as plain text. Native safe
  `<details><summary>…</summary>…</details>` remains supported.
- Links allow existing safe anchors/paths and approved `http`, `https`, and `mailto` schemes. External links use `noopener noreferrer`.
- `javascript:`, `vbscript:` and unsafe `data:` targets are not executable links.
- Remote Markdown images/media are not auto-loaded. Same-origin images reserve
  a trusted width/height ratio when present; failed resources retain inert
  fallback content and a safe open action where allowed.
- Attachment-backed images continue through the Attachment Renderer contract; this phase does not change attachment identity or Viewer architecture.

## Performance and offline assets

Rich Markdown is parsed per mounted message or attachment. There is no whole-Reader DOM scan, KaTeX auto-render pass or post-mount rewrite. Source Editor live preview is opt-in and starts collapsed on every workspace open; once opened, `useDeferredValue` keeps preview work behind typing, while CodeMirror's external baseline remains independent from preview rendering.

`AssistantMarkdownPart` retains stable renderer configuration/components and its
current primitive subtree. A host-only class change updates the outer wrapper
without reparsing unchanged source; content/scope/context/attachment callback
changes still reach the parser. A fixed synthetic browser probe measured one
additional host-only parse before the fix and zero afterward; changing source
still adds one parse. This is mounted-subtree reuse, not a shared message cache,
general parse elimination or a long-task/RSS improvement claim.

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

Supported now: four math delimiters, common KaTeX aligned/matrix/cases environments, GFM tables/tasks/strike/autolinks, footnotes, fenced/inline code, headings, blockquotes, the frozen existing single-newline visual-break policy, bounded safe HTML/details/media, Obsidian callouts and inline highlights, and the bounded rich-text reading fallback above.

Deferred by design: MathJax fallback, AsciiMath, `mhchem`, executable raw HTML,
wikilinks/attachment-name resolution, Bases, Dataview, Canvas, community plugins,
new diagram runtimes and reconstruction of missing diagram meaning. Unsupported
KaTeX commands use the bounded local fallback. Real merged HTML tables and
external media remain unsupported.

## Regression evidence

- Latest continuation (2026-10-25): 43 shared-renderer/parser checks and
  86 isolated Chrome scenarios, plus a separate actual local-service
  Reader/Share/Offline/mapping E2E. Final suite results and explicit adapters are
  recorded in the [continuation](../execution/CHATGPT_READING_REMAINING_2026-10-25.md)
  and [testing scope](../testing.md#chatgpt-reading-compatibility--2026-10-25-local-only).
  No complete PWA/physical-device/production or broad performance acceptance.
- Original pre-continuation checkpoint (2026-10-25): 82 focused Node checks, all 1,586
  service-free checks across 75 files, 83 isolated Chrome scenarios and four
  Playwright **source** contracts pass. Seven-file API import/source regression
  passes 16 with one deliberately deselected private fixture. Lint,
  nonincremental typecheck, one-worker production build and single-head
  inspection pass. See [testing scope](../testing.md#chatgpt-reading-compatibility--2026-10-25-local-only);
  no authenticated three-chain/PWA/PostgreSQL/production acceptance is implied.
- `scripts/ux/chatgpt-rich-text.test.mjs`: 43 service-free parser/SSR checks,
  including v7 inert visible HTML, nested/unclosed container code and safe
  over-budget fallback; v6 multi-box/profile negatives and prior shared table,
  math, link, source-coordinate and code fidelity remain covered.
  Explicit assistant-ui/virtualizer adapters are not full Reader browser acceptance.
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
  checks. At the preceding table checkpoint, these plus 52 table, 10 reference
  and then-35 shared-renderer cases totaled 102; adding the 20 common-focus cases
  gave that checkpoint's 122-case focused gate.
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
- `apps/api/tests/test_chatgpt_rich_text_source.py`: three pure importer/block-building checks retain exact synthetic source/hash and task offsets. Initial v5 evidence is in [the rich-text report](../execution/ux-audit-chatgpt-rich-text-2026-10-15.md); v6 local evidence is above. Older browser/production evidence does not accept the new local changes.
- `ai-rich-markdown-parser.spec.ts`: parser delimiter, consumed inline/bracket compatibility, prose/date/version/code exclusions, currency and canonical-source invariants.
- `ai-rich-markdown.spec.ts`: real Reader/Editor DOM, golden formula, 109-formula stress, security, MathML and 360px overflow.
- `production-rich-markdown-copy.spec.ts`: an ephemeral UTF-8 copy of the reported production source, full Source Preview semantic count and cleanup through the product API.
- `production-rich-markdown-scientific-copy.spec.ts`: an ephemeral copy of a scientific ChatGPT source, common command coverage, canonical-source equality and cleanup through the product API.
- `ai-rich-markdown-attachment.spec.ts`: real `.md` upload, occurrence save, inline preview and unified Viewer.
- `library-offline.spec.ts`: deterministic KaTeX font inventory and offline cold start.
- `reader-restoration.spec.ts`: heavy Reader windowing, scroll, navigation and Share regression.

API success alone is not Rich Markdown user-flow PASS. Production-equivalent browser results and the latest production Chrome result are higher-level evidence.
