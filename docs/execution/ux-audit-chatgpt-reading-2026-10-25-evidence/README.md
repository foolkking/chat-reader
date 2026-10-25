# Synthetic reading-compatibility evidence — 2026-10-25

These local receipts accompany the [dated audit](../ux-audit-chatgpt-reading-2026-10-25.md).
No real conversation, import, identifier, Share token, credential or cookie is
included. Screenshots contain only synthetic text.

## Original two-fix checkpoint

| File | Scope |
| --- | --- |
| `verification.json` | Commands, observed counts, source/artifact SHA-256 and validation limits. |
| `controlled-regression.json` | Isolated HEAD/current detector comparison, seven synthetic inputs and explicitly unfixed follow-up probes. No repository source swapping. |
| `supported-say-type-probe.json` | Synthetic supported detector/parser input and result; not HTTP/persistence acceptance. |
| `browser-result.json` | 83 isolated Chrome scenarios and the harness's explicit adapter boundary. |
| `reading-rich-1440.png`, `reading-rich-375.png` | Visually reviewed real shared-renderer output at desktop/mobile viewport widths; not authenticated Reader/Share/Offline pages. |

Repeatable product gates and process-local temp setup are documented in
[`docs/testing.md`](../../testing.md#chatgpt-reading-compatibility--2026-10-25-local-only).
The full service-free gate explicitly enumerates `*.test.mjs` on PowerShell;
the browser gate remains a separate command. Source-contract Playwright checks
run without a webServer or browser.

One-off scripts, raw stdout and temporary test configurations remain in the
task-specific `wkkk` directory, not in this evidence directory. The two probe
JSON files retain synthetic inputs and method descriptions for inspection;
they are historical observations, not additional committed product tests.
The controlled comparison was run after implementation, not as a claim that
all new tests were first observed failing.

At this original checkpoint, no full PWA, authenticated three-chain, physical offline device, PostgreSQL,
production, clipboard, screen-reader or sustained-load acceptance is implied.
No commit, push, CI or deployment was performed.

## Remaining-work continuation

The [separate continuation](../CHATGPT_READING_REMAINING_2026-10-25.md) owns the
later v7/exporter-v6 results. Original files above remain unchanged; their counts,
source hashes and narrower environment boundaries are historical.

| File | Scope |
| --- | --- |
| `remaining-work-results.json` | Current source/artifact SHA-256, exact gate counts, full-API failure/rerun distinction, eight implemented/safe-alternative follow-ups, two partials and eight unmet sample prerequisites. |
| `remaining-browser-result.json` | Latest 86-scenario isolated Chrome gate, explicit adapters and empty page/console error lists. Not authenticated server acceptance. |
| `remaining-parser-reuse.json` | Actual 90-character fixed-source parse-count probe with assistant-ui forwarding adapter; host-only extra parses 0, source-update extra parses 1. Not a long-body benchmark. |
| `remaining-reading-rich-1440.png`, `remaining-reading-rich-375.png` | Shared-renderer synthetic body fixture in the component harness; not three-chain page screenshots or proof of every v7 feature. |
| `remaining-mapping-rendered-1440.png`, `remaining-mapping-rendered-375.png` | Actual authenticated mapping UI/API: bounded sample, counts and Rendered/Source controls. Viewport screenshots, not full scroll-content captures. |
| `remaining-warnings-expanded-1440.png`, `remaining-warnings-expanded-375.png` | Actual archive UI with explicit preview/commit/cleanup adapters; all six synthetic completion warnings exposed. Not `.cr` parsing. |

Separate real local-service E2E tests pass for authenticated Reader, guest Share
and worker-downloaded Offline Reader/reload, with the same complete turn and
real message DOM anchors. No page images, auth state, generated conversation
IDs or Share tokens from those chains are persisted here. API/worker use fresh
task-local PostgreSQL/storage; E2E-only resource overrides are disclosed in the
continuation. The broad API run initially had 15 failures; all 15 plus one
adjacent test passed on rerun, **not** a subsequent green full-suite run.

No full PWA/offline-version/position-restoration matrix, physical device,
production, screen-reader, clipboard, CPU/RSS or sustained-load acceptance.
No commit, push, CI or deployment.
