# AI Rich Markdown Renderer Contract

Last synchronized: 2026-08-12

## Purpose and canonical source

Chat Reader renders modern AI conversation Markdown through one semantic core. PostgreSQL `MessageVersion` Markdown remains canonical. Rendering never rewrites `\[...\]` to `$$...$$`, never persists KaTeX HTML, and does not add a database migration or export field.

```text
canonical Markdown source
-> react-markdown / unified parser
-> remark-gfm + frozen AI soft breaks + remark-math
-> AI math compatibility AST transform
-> sanitized HAST
-> KaTeX semantic renderer
-> safe React components
```

`RICH_MARKDOWN_RENDERER_VERSION = ai-rich-markdown-v4` identifies the parser/render policy. A future parsed-result cache must include source hash, MessageVersion identity and this version. Generated HTML is never canonical.

## Shared consumers

The same semantic and security configuration is used by Reader message Markdown, Source Editor live preview, Markdown attachment inline/Viewer rendering, and existing annotation/import surfaces that consume `MarkdownRenderer`. Presentation wrappers may differ; Math/GFM/footnote/code/link semantics must not diverge.

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

KaTeX CSS comes from the local package. Offline shell preparation deterministically includes current styles/scripts and same-origin `KaTeX_*` font files referenced by current `@font-face` rules. It does not scan arbitrary historical Performance resources. An offline-ready shell therefore includes math CSS and fonts without a CDN.

Search and exports continue using canonical Markdown/searchable text. KaTeX spans and MathML never enter search indexes, Markdown/CanJSON exports or `.cr` canonical records.

## Supported and deferred syntax

Supported now: four math delimiters, common KaTeX aligned/matrix/cases environments, GFM tables/tasks/strike/autolinks, footnotes, fenced/inline code, headings, blockquotes and the frozen existing single-newline visual-break policy.

Deferred by design: MathJax fallback, AsciiMath, `mhchem`, arbitrary raw HTML, new callout syntax and new Mermaid behavior. Unsupported KaTeX commands use the bounded local fallback.

## Regression evidence

- `ai-rich-markdown-parser.spec.ts`: parser delimiter, consumed inline/bracket compatibility, prose/date/version/code exclusions, currency and canonical-source invariants.
- `ai-rich-markdown.spec.ts`: real Reader/Editor DOM, golden formula, 109-formula stress, security, MathML and 360px overflow.
- `production-rich-markdown-copy.spec.ts`: an ephemeral UTF-8 copy of the reported production source, full Source Preview semantic count and cleanup through the product API.
- `production-rich-markdown-scientific-copy.spec.ts`: an ephemeral copy of a scientific ChatGPT source, common command coverage, canonical-source equality and cleanup through the product API.
- `ai-rich-markdown-attachment.spec.ts`: real `.md` upload, occurrence save, inline preview and unified Viewer.
- `library-offline.spec.ts`: deterministic KaTeX font inventory and offline cold start.
- `reader-restoration.spec.ts`: heavy Reader windowing, scroll, navigation and Share regression.

API success alone is not Rich Markdown user-flow PASS. Production-equivalent browser results and the latest production Chrome result are higher-level evidence.
