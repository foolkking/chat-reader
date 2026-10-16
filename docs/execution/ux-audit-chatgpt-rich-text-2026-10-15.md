# ChatGPT rich-text export compatibility — 2026-10-15

## Scope and evidence

This continues the ordinary-user optimization goal. Scope is the reported
export shape: `box`, `row`, `text`, `badge`, `divider`, whitespace entities and
multiply escaped Markdown. Audience is mixed; the core task is reading an
imported answer without interpreting layout source.

SEEN: current shared Markdown configuration, renderer, canonical block
presentation, importer source preservation and local test patterns. No user
conversation body, identifier or token is copied into this report or fixtures.
NOT SEEN: a live Reader, production, actual exporter execution, mobile geometry,
focus, offline-device behavior or CPU/RSS measurements. No service is started.

Official documentation was read through the in-app browser, not Web Search:
`https://developers.openai.com/api/docs/guides/chatkit-widgets#components-widgetnode`
and the ChatGPT plugin UI guide. ChatKit documents similarly named components,
but does **not** establish the reported lower-case/escaped notation as a public
ChatGPT transcript export specification. Compatibility must therefore be
conservative and sample-driven, not a general HTML/JSX interpreter.

## Findings recorded before product edits

| ID | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| COPY-RICH-01 | Content/readability | High | Observed (code); live rendering not observed | M |
| COPY-RICH-02 | Content/readability | Medium | Observed (code); live rendering not observed | M |

### COPY-RICH-01 — Layout wrappers have no safe reading projection

Location: `apps/web/features/conversations/markdown-renderer.tsx:425–455`,
`apps/web/features/rich-markdown/rich-markdown-config.ts:18–45`.
Both renderer branches keep `skipHtml`; their only string preprocessing is
display-math compatibility. There is no layout-wrapper projection. Raw wrappers
can be skipped with their block content; escaped wrappers remain source text.
Readers lose the answer's structure or content on a core reading path.

Recommendation: recognize a bounded, explicit rich-export profile outside code;
flatten its known layout wrappers into normal Markdown, retain text/badge
content and represent dividers with a Markdown thematic break. Never execute
attributes, load a widget runtime, enable raw HTML or guess missing HTML.

### COPY-RICH-02 — Escaped formatting is never recovered for that profile

Location: `apps/web/features/conversations/markdown-renderer.tsx:402–455`,
`apps/web/features/conversations/block-renderer.tsx:40–73`.
The shared path only normalizes math; escaped headings, strong markers, inline
code delimiters and ordered-list punctuation remain literal. Reader parses
canonical blocks separately, so detecting a wrapper only in the current block
would also miss adjacent escaped headings.

Recommendation: enable narrowly scoped formatting recovery only after detecting
the profile in the current full message/surface. Pass that presentation decision
to individual blocks without replacing block text, IDs or indices. Preserve
canonical copy/export, code, task keys, asset links and source-preview offsets.

## Ordered implementation / acceptance plan

1. Reproduce missing semantics with synthetic inputs through the real installed
   React Markdown parser/SSR stack; retain the failing baseline.
2. Add one bounded shared projection and propagate the full-message profile to
   mounted blocks. Preserve all canonical storage and import/export behavior.
3. Exercise raw, one-/multi-escaped, cross-block and negative code/HTML cases,
   source offsets, math, tasks, assets, budget exhaustion and repeat rendering.
4. Run only service-free targeted checks, lint and nonincremental type checking.
   Record what passed and what remains unexecuted; do not re-label earlier
   source-only batches as verified.

## Working behavior deliberately retained

Raw HTML remains inert. Canonical Markdown, import alignment, exports, `.cr`,
offline package versions and Dexie are unchanged. Unknown syntax is not
silently converted into a widget. No library, remote resource, DOM scan,
observer, timer, network request, schema change or migration is planned.

## Open questions / boundaries

Exact original card styling and missing export-only content cannot be recovered
from a text sample. A separately maintained external exporter is outside this
repository's authority. Browser/Reader/Share/offline geometry and real-device
performance require later authorized acceptance, not SSR claims.

## Implementation and verification

### Official component-surface checkpoint (pre-edit, 2026-10-15)

The OpenAI Developers ChatKit widgets reference was re-read through the
Codex in-app browser (not Web Search). It documents `Badge`, `Box`, `Row`,
`Divider`, and `Text` as widget nodes, and lists safe presentation properties
such as `direction`, `align`, `justify`, `wrap`, sizing, spacing, `border`,
`radius`, `background`, `color`, `variant`, `pill`, `weight`, `textAlign`,
`italic`, and `lineThrough`. It does **not** document the reported lower-case
ChatGPT transcript/export syntax as a public export contract. The fallback
therefore remains display-only and sample-driven, but its attribute allowlist
should cover the documented presentation surface without accepting event,
script, JSX-expression, `style`, or arbitrary attributes.

Pre-edit gap for this checkpoint: the existing detector recognizes the
reported tag names but rejects several documented presentation attributes
(`flex`, `width`, `minWidth`, `margin`, `variant`, `pill`, `weight`, and
similar), causing an otherwise readable rich-text sample to remain literal.
No canonical source, importer, API block, Share URL, offline package, or
security policy should change.

### Implemented

- One shared, bounded `chatgpt-rich-text-compatibility.ts` projection, renderer
  policy `ai-rich-markdown-v5`. Recognized tags become readable text/paragraphs,
  badge labels and thematic breaks; only established escaped profiles recover
  the supported Markdown escapes and whitespace entities.
- The recognition allowlist now covers the documented widget presentation
  vocabulary needed by the lower-case compatibility shape (layout, spacing,
  sizing, border/radius, background, badge variants and text emphasis). It
  remains a discarded recognition boundary: event handlers, `style`,
  `className`, arbitrary attributes and JSX expressions stay fail-closed.
- Full-message profile propagation to canonical blocks, regular/element/window
  rendering, headings and thinking; original provider text/copy data, IDs,
  indices, task keys and API data remain canonical.
- Code/unknown HTML/security exclusions and 524,288-unit / 8,192-token-or-edit /
  64-detection-depth limits. No dependency/runtime, request, timer, observer,
  schema, migration or offline-package change.
- Source-position restoration for this new display projection, after the
  existing math preprocessing. Existing math-normalization offset shifts remain
  outside this repair's guarantee.

### Actual checks and retained failures

| Evidence in `ux-audit-chatgpt-rich-text-2026-10-15-evidence/` | Result / meaning |
| --- | --- |
| `baseline.txt` | 0 pass / 2 fail before implementation: raw layout content absent; escaped formatting literal |
| `expanded-first.txt` | 19/21: indented-code detection gap fixed; math fixture corrected to use the actual preprocessing/supported delimiter path |
| `expanded-second.txt` | 21/21 focused checks pass |
| `expanded-third.txt` | 23/25: virtualized test doubles lacked the existing layout-signature dependency; explicit adapter supplied, no product change |
| `targeted-node.txt` | First cross-run 101/105; four stale fixture failures reviewed in the separate source-gate report |
| `targeted-node-final.txt` | All original 105 selected checks pass after fixture repairs |
| `leading-thinking-baseline.txt` | Added branch case fails before its prop repair; 25 name-filtered skips are not passes |
| `targeted-node-final-106.txt` | **106/106 pass, zero skipped** in five selected files; **26** were rich-text focused before this checkpoint |
| `targeted-node-attribute-surface.txt` | **27/27 pass** after the official component-surface allowlist expansion |
| `api-parser.txt` | **5 pass / 1 deselected**: three new synthetic source cases plus two existing exporter cases, no DB/server |
| `lint.txt`, `typecheck.txt` | Initial full gates expose three invalid lint directives/four type errors in older local changes |
| `lint-final.txt`, `typecheck-final.txt`, `typecheck-root-final.txt` | Full lint and nonincremental Web types pass (exit 0); root command also exercised |

The Node checks use actual installed React/Markdown/remark/rehype/KaTeX and
compiled application components. Assistant-ui provider/primitive, unrelated UI
hooks and virtualizer geometry have explicit adapters. The source-gate checks
use controlled locks, transport and callback scheduling. They are not DOM,
live-browser, permission, geometry, offline-device or performance evidence.

Commands (repository root unless stated):

```powershell
$taskTempRoot = 'C:\Users\86182\Desktop\wkkk\chat-reader-rich-text-20261015'
$env:TEMP = $taskTempRoot
$env:TMP = $taskTempRoot
node --test scripts/ux/chatgpt-rich-text.test.mjs scripts/ux/resumed-source-gates.test.mjs scripts/ux/manual-markdown-fidelity.test.mjs scripts/ux/message-version-recovery.test.mjs scripts/ux/interaction-confirmation-lifecycle.test.mjs
corepack pnpm run lint
corepack pnpm --filter web exec tsc --noEmit --incremental false
corepack pnpm run typecheck --incremental false
# cwd apps/api; bytecode/cache/temp are kept out of the repository:
$env:PYTHONDONTWRITEBYTECODE = '1'
python -m pytest tests/test_chatgpt_rich_text_source.py tests/test_exporter_markdown_parser.py -k 'not real_paired_fixture' --basetemp "$taskTempRoot\pytest-rich-text" -o "cache_dir=$taskTempRoot\pytest-cache"
```

The excluded real paired fixture is not accepted. No full API suite, Web build,
PWA/Playwright execution, product service, production operation, commit, CI or
deployment occurred. Other historical source-only batches are not collectively
verified. A scoped whitespace check passes. Current source/test bindings are
recorded separately in `source-bindings.json`.

Final branch review found a separate leading-thinking disclosure bypassing the
block-level metadata path. Before its prop repair, the added real-component SSR
case failed (0 pass / 1 fail / 25 filtered skips), retained in
`leading-thinking-baseline.txt`. It must inherit the same message-level profile;
the existing reasoning detection, collapse behavior and canonical text stay intact.

### Service-free continuation verification (2026-10-15)

After the source-only repair, the targeted rich-text regression was rerun with
the repository's actual installed React/Markdown/remark/rehype/KaTeX stack and
the explicit assistant-ui/virtualizer adapters already used by the fixture:

| Check | Result | Boundary |
| --- | --- | --- |
| `node --test scripts/ux/chatgpt-rich-text.test.mjs` | **27 passed / 0 failed / 0 skipped** | Parser, projection, source-position, shared Markdown/Block/Assistant SSR and safe-link/image cases; no mounted browser |
| `python -m pytest tests/test_chatgpt_rich_text_source.py tests/test_exporter_markdown_parser.py -k 'not real_paired_fixture'` | **5 passed / 1 deselected** | Pure importer/block and exporter-parser checks; the external paired fixture stayed explicitly excluded |

The exact continuation outputs are retained in
`ux-audit-chatgpt-rich-text-2026-10-15-evidence/continuation-node-20261015.txt`,
`continuation-api-20261015.txt` and `continuation-summary-20261015.txt`.
Temporary pytest files were kept under the task-specific `C:\Users\86182\Desktop\wkkk`
directory. No Web/API service, login, production data, browser, offline device,
build, full CI, commit, deployment or CPU/RSS measurement was used.

### Remaining acceptance

Later authorized Reader/Share/offline and attachment/editor browser checks should
confirm long-message layout, focus/selection, preserved source anchors and
real-device CPU/RSS. Exact card/widget styling and missing exporter content are
not supported. The wider ordinary-user optimization goal remains unfinished;
the previously accepted deployment is not to be repeated.

Pre-edit Git blob bindings:

| File | Blob |
| --- | --- |
| `markdown-renderer.tsx` | `dd785c3db71713ee8dec2a93f8917effaff5e7e7` |
| `block-renderer.tsx` | `55e80e9df49fb5c930f7ca7bdfa4289ee4dc8d62` |
| `assistant-message-renderer.tsx` | `b4ebe2db71c7d191c4fac909711ee7405c71436d` |
| `rich-markdown-config.ts` | `5e1c175f3b5dc855a426374fdfd86c80dcf68266` |
