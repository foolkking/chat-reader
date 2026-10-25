# ChatGPT reading — remaining-work continuation

Date: 2026-10-25. Local continuation; no submission or deployment authorized.

## Scope before edits

The user requested completion of the remaining work after the
[20-candidate checkpoint](ux-audit-chatgpt-reading-2026-10-25.md).
That checkpoint and its receipts remain historical and are not overwritten.

Execute the evidenced issues first: inert visible HTML fallback (COPY-03),
parser-consistent nested code protection (DATA-09), bounded fallback on rejected
profiles (DATA-10), supported-exporter text-type validation (DATA-12), complete
import warning disclosure (COPY-05), rendered/source mapping preview (COPY-06),
on-demand reading-policy explanation (COPY-04), and Mermaid source alternatives
(A11Y-01). Measure before changing repeated-render behavior (PLAT-01), and
exercise actual isolated authenticated Reader/Share/Offline consumers (PLAT-02).

Use existing paper/graphite/sea-green tokens, borders, small metadata and
12–16px spacing. Native disclosures keep secondary information out of the
reading path. No new design system, dependency, permanent message banner or
interactive artifact runtime.

Sample-dependent writing, citations, chart data, attachment pointers,
transcripts, private tool output, historical restoration and interactive
artifact alternatives must not be invented. Existing explicit Markdown/static
attachments remain authoritative. Record unmet prerequisites separately rather
than counting these as implemented adapters.

## Safety and validation plan

- Preserve canonical text, real DOM anchors, Share URLs, `.cr`, offline v1/v2/v3,
  Dexie v2 and unrelated worktree changes.
- Use synthetic fixtures only; temporary files and isolated services under the
  task's `wkkk/chat-reader-gpt-reading-remaining-20261025` subdirectory.
- Retain pre-edit failures, then run focused and service-free tests, relevant API
  tests, Chrome UI checks, lint, nonincremental typecheck and production build.
- Real-service checks use a fresh local PostgreSQL cluster and task-local storage;
  no production configuration, database, volume or user import is touched.
- Report exact execution counts and limitations, not broad accessibility,
  sustained-performance or production acceptance.

## Results

**Bounded continuation completed locally on 2026-10-25.** Of the original
18 deferred candidates, eight now have an implementation or safe alternative,
two have explicitly limited progress, and eight remain source-dependent.
This is not completion of every possible ChatGPT adapter or release acceptance.
The original COPY-01/TRUST-02 fixes remain in place.

| Candidate | Disposition and actual implementation | Acceptance boundary |
| --- | --- | --- |
| COPY-03 | Done: unsupported/rejected HTML AST nodes become visible inert text or a literal flow-code block before sanitized rendering. Policy is `ai-rich-markdown-v7`. | No raw HTML runtime; `skipHtml`, sanitization and safe URLs remain. Exact canonical source is unchanged. |
| DATA-09 | Done: the installed CodeMirror Markdown parser supplements literal-code protection for quote/list/unclosed fences, preserving CRLF offsets. | Existing guards remain; no second handwritten container parser or wider rich-tag allowlist. |
| DATA-10 | Safe alternative done: invalid/over-budget profiles retain the complete original input, and v7 exposes otherwise hidden HTML source. | No segmented recovery, higher limits, truncation or long-body performance claim. |
| DATA-12 | Done: supported exporter `say` accepts strings; object/list/number/boolean inputs reject with structured HTTP 422. Missing/null retains empty-text compatibility with explicit warnings. | Exporter parser is `chat-reader-import-v6`; Markdown parser remains v5. Official-graph rejection and pairing remain unchanged. |
| COPY-05 | Done: the first four completion warnings remain visible; a counted native disclosure exposes every remaining warning. | Six-warning UI fixture reaches all six. Its archive preview/commit/cleanup responses are explicit adapters, not real `.cr` parsing. |
| COPY-06 | Done: read-only Rendered/Source mapping views share the existing renderer and disclose the 12-message/2,000-character sample limits, full message count and `content_truncated`. | Actual API and UI checks show one preview/zero saves across toggles; API commit retains all 13 fixture messages and full long text. |
| COPY-04 | Done: the source editor offers an on-demand explanation of display-only recovery and unchanged stored source. | No permanent message banner, new persisted policy field or automatic edit. |
| A11Y-01 | Done within scope: supplied Mermaid SVG title/description labels the image and visible description; exact source is always available and opens on failure. Suppress Mermaid's orphan global error graphic. | Real component checks cover supplied text, source, failure and source changes. No invented diagram meaning or screen-reader/WCAG certification. |
| PLAT-01 | Partial: measured and removed a redundant host-style-only parse in mounted `AssistantMarkdownPart`; source/context changes still invalidate. | Fixed 90-character source: host-only additional parses 1 before / 0 after; source update still adds 1. Not a long-body latency, paint, CPU/RSS or shared-cache result. |
| PLAT-02 | Partial: real local authenticated Reader, cookie-free guest Share and worker-downloaded Offline Reader use the same complete two-message turn and stable real message DOM anchors; offline reload passes. | Not the full position-restoration, legacy offline-package, PWA/device or production matrix. |

Existing paper/graphite/sea-green styling and native disclosures are reused.
The 1440px/375px mapping and expanded-warning screenshots were visually reviewed;
mobile controls remain in the viewport and content stays locally bounded.
This is a scoped delta review, not a scored full-product accessibility audit.

## Unimplemented source-dependent adapters

These are deliberate unmet prerequisites, not silent successes or runnable
background work. Reopen only with a sanitized **currently supported export**
and the expected static reading result. Public UI capabilities do not establish
an export protocol.

| Candidate | Required evidence before implementation |
| --- | --- |
| COPY-02 writing surface | Actual separate title/body fields or markers, including empty/repeated titles and multi-paragraph examples. |
| DATA-04 citations | Exported citation markers **and** corresponding source metadata; do not invent URLs. |
| DATA-05 chart data | Actual labels, ordered values, units/precision and missing-value semantics; do not infer numbers from screenshots. |
| DATA-06 attachment pointers | Matching export manifest and available files, plus a missing-file example; do not turn pointers into fake links. |
| DATA-07 transcript | Actual transcript text, speaker/order/time semantics; no unsolicited transcription. |
| DATA-08 tool output | Actual visible result/error fields distinct from commands; never execute imported instructions. |
| DATA-11 historical recovery | Authorized affected canonical versions, original source/backup and a reviewed per-message diff/selection policy; never overwrite history speculatively. |
| TRUST-03 interactive artifact alternative | An actually exported static image/PDF/text artifact and expected non-interactive representation; no script execution, remote replay or invented state. |

Existing Markdown, links, tables and static attachments remain usable without
these adapters. No private sample was opened or copied.

## Executed verification

Commands inherit process-local TEMP/TMP. One-off configs, raw logs, synthetic
databases and storage stay under the task directory; only sanitized summaries
and synthetic screenshots are retained in the repository.

| Gate | Final observed result | Scope |
| --- | --- | --- |
| `node --test scripts/ux/chatgpt-rich-text.test.mjs` | **43 passed** | Expanded pre-edit run: 40 passed / 3 failed; actual parser/shared-renderer checks. |
| Complete service-free UX, explicit PowerShell enumeration | **75 files; 1,589 passed, zero failed/skipped** | `node --test --test-concurrency=1 @tests`; includes explicit component adapters. |
| `node scripts/ux/source-editor-table-browser.mjs` | **86 passed**, no page/console errors | Local Chrome renderer/workspace/DOM/CSS; API/Next-loader/assistant-ui forwarding and surrounding UI adapters are explicit. |
| Focused API, nine files listed below | **78 passed / 2 skipped / 1 deselected** | Optional private paired fixtures unavailable/excluded; no private source read. |
| `chatgpt-reading-acceptance.spec.ts` | **2 passed**, latest run 12.0s | Isolated API, single worker, fresh PostgreSQL and production Next build; installed Edge Chromium. First test uses real three-chain/mapping APIs; second has archive response adapters. |
| Two rich-Markdown/import Playwright source-contract files | **4 passed** | No browser or webServer; not rendered E2E/PWA. |
| Web lint / nonincremental typecheck / production build | **Passed** | Lint/typecheck repeated after final screenshot-test edits; no product edits after the successful build. |
| Alembic heads / isolated PostgreSQL upgrade | One **`20261022_0053`** head; fresh database upgraded from zero | No migration change or production database claim. |
| Broad API run | **1,730 passed / 15 failed / 189 skipped / 2 warnings** | Not a green full-suite gate; details and targeted rerun below. |
| Rerun of all 15 failures plus one adjacent export case | **16 passed**, 37.09s | No memory-safety/default override. Does not replace a complete green full-suite rerun. |

Focused API files, run from `apps/api`:

```text
tests/test_adaptive_import_api.py
tests/test_official_normalizer.py
tests/test_import_preview_official.py
tests/test_canonical_persistence_official.py
tests/test_chatgpt_rich_text_source.py
tests/test_exporter_json_parser.py
tests/test_exporter_markdown_parser.py
tests/test_canonical_persistence_exporter.py
tests/test_import_preview_exporter_combo.py
```

Arguments: `-k 'not real_paired_fixture' -q --basetemp=<task-temp>/pytest-final-import
-p no:cacheprovider`. Web commands and local-service E2E prerequisites are in
[testing](../testing.md#chatgpt-reading-compatibility--2026-10-25-local-only).
The E2E service processes alone used a 64 MiB upload reserve and analysis factor
1 on the resource-limited host. Product defaults/probes are unchanged; this
proves functional behavior, not normal-default capacity. The API focused/full/
failure-rerun processes did not use these E2E overrides.

### Broad API failure and rerun boundary

`corepack pnpm run test:api --basetemp=<task-temp>/pytest-full -p no:cacheprovider`
initially failed 15 cases while local services were also consuming resources.
The cases cover cleanup review discovery (1), continuation exports (2), edit
conflict (1), exports (7), search API (3) and search indexer (1). They all stop
at import commit returning 400 or the resulting absent conversation IDs.
The large-conversation export traceback explicitly reports a memory-pressure
rejection; the other tracebacks alone do **not** establish that all 15 share
that cause. Rolled-back temporary database rows supplied no additional cause.

After stopping the prior task services, all 15 selectors plus the adjacent
Markdown-export case passed in a fresh process. No memory probe, assertion,
product admission limit or test was weakened. There is no clean baseline
full-suite comparison and no subsequent full-suite green run: resource context
is a plausible explanation, not a proven diagnosis for every initial failure.
The 189 skips are not passes. Full API release acceptance remains unclaimed.

### Failure provenance

Pre-edit HTML/code tests and supported `say` probes supplied concrete failures.
Early browser authentication/locator/native-disclosure fixtures were corrected
without bypassing product checks. Visual review additionally exposed Mermaid's
orphan syntax-error SVG, now covered by a negative DOM assertion; 86/86 then
passed. Initial clipped screenshot captures were replaced with viewport
captures that assert the mapping controls are in view. The earlier controlled
HEAD/current comparison remains a post-implementation control, not a claim
that every test was run red first.

## Evidence, preservation and closeout

The [continuation receipt](ux-audit-chatgpt-reading-2026-10-25-evidence/remaining-work-results.json)
records source/artifact SHA-256, exact counts, dispositions and limits.
[Evidence navigation](ux-audit-chatgpt-reading-2026-10-25-evidence/README.md)
separates the original checkpoint from the independently named continuation
browser/parse receipts and six reviewed screenshots. Original receipts and
images are not overwritten.

Canonical text/versions, full-turn semantics, stable DOM anchors, schema, Share
URLs, `.cr`, offline v1/v2/v3 and Dexie formats have no intended contract change.
No batch reimport, missing-history reconstruction or user-import modification
was performed. The unrelated preexisting `apps/web/tsconfig.tsbuildinfo` retains
its original SHA-256 rather than being reset to HEAD.

Task-local Web/API/worker and PostgreSQL are stopped; their three listener
ports are closed. Task artifacts remain in their own directory for inspection;
no unrelated temporary/user files or production volumes were cleaned.
No commit, push, CI, deployment, production configuration or `.env` change.
No complete PWA/offline-version/position-restoration matrix, physical device,
clipboard, screen-reader, sustained-load or whole-product WCAG acceptance.
