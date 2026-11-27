# Archive navigation: release-gate diagnosis, 2026-11-26

## Scope and evidence

This is a focused navigation review, not a redesign or a whole-product
usability certification. The task is to press an archived conversation once,
enter its Reader, and return without losing the list or reading position.
No personal conversations or production mutations were used.

Exact source `97e19367b0ce48886a8b4f4e6e597694105056db` passed branch
`45638462292/1`, all 19 jobs and independent artifact verification.
Protected `v0.1.9` subsequently failed child qualification `45644445123/1`,
job `139311528820`; parent `45644411382/1` did not publish.
The failed reading gate had 59 passes and one failure. Artifact `15036978832`
is 20,520,085 bytes, SHA256
`9624bcfdcbf814222d5ecebb58c2290b5ddec8456339f6791e530a305055a659`.
The failed tag remains intact.

The failure was at `reader-fast-find.ts:112`: no first Reader article after
the initial archive-list click. It happened **before** delayed bookmark
delivery, touch input, or any drift assertion. The error snapshot still shows
the archive list. All 19 API requests in the relevant window succeeded.
There was no reading-position or Reader-window request. The spec deliberately
disabled traces, so the original click and RSC event sequence is unavailable.
An unrelated earlier proxy error is a deliberate TCP test, not this failure.

## Reproduced defects

| Finding | Severity / confidence | Reproducible observation | Required correction |
|---|---|---|---|
| Optional project loading removes space above a live conversation link | Major (3), directly reproduced | With preferences fixed, deliver the real empty archived-project response between native down/up: link moves −116px at 375px, −96px at 1280px; node survives but release/click hit a DIV | Asynchronous project loading, empty/nonempty results and errors must not move a conversation being activated; preserve project operations and retry feedback |
| Late account sorting replaces the pressed link | Major (3), directly reproduced | With the project result already settled, deliver changed preferences between down/up: query changes, old anchor disconnects, same-title replacement appears, but no native link click occurs | Retain the displayed query and matching controls for the native interaction; release on completion/cancellation and never cross account or scope |

Focused heuristic score: **6/10**, deducting two major failures of predictable
navigation and error prevention. This is an explicitly scoped review score,
not a measured user-success percentage or a score for the whole application.
Passing the controlled single-activation and cancellation checks is necessary
before considering either finding repaired; a prettier screenshot is insufficient.

Four controlled failures and four successful timing controls were exercised
in actual Edge against isolated production-built Linux Web/API. The old
helper separately passed 20 repeated runs; that does not disprove the races.
The original CI could have hit either mechanism, but its missing event trace
does not permit unique attribution.

## Implementation and acceptance constraints

- Preserve a native link: modifier keys, new tabs, keyboard activation,
  cancelled touch/drag and browser back must keep their normal meanings.
- Reuse the existing temporary list-order ownership rather than adding
  another navigation system or issuing `router.push` on pointer-down.
- Keep archived-project access, loading/error recovery and acknowledged
  operations. Test empty, nonempty and failed late reads, not just the
  original empty fixture.
- Keep the original reading assertions, timeouts and ≤2px peak / ≤1px final
  drift limits. Do not add a second click, delay until preferences settle,
  skip, retry, or replace the real list activation with direct navigation.
- Retain before/after event targets, real node identity, geometry and
  screenshots using synthetic records. Desktop touch emulation does not
  certify physical iOS/Android behavior.

The controlled captures and screenshots are retained in `v019-control/repro`
under the task evidence directory. The independent timeline is in
`sagan/v019-tag-failure`, alongside the original failed release evidence.

## Corrections and verification

Archived conversations now appear before the asynchronously loaded projects.
A native pointer interaction or keyboard focus holds the active list order
until activation or cancellation. Scope changes and removal of the focused
node also release that hold. The mounted component passed eight Edge
interaction and cleanup cases. The standalone hook passed sixteen Node cases.

The additional browser gate exercises empty, populated and failed project
reads plus pointer, keyboard and cancelled activation at 375px and 1280px.
Each activation checks the original anchor, the native click and the actual
Reader that opened. Its twelve cases passed in the isolated production build.
See the [merge and release evidence](README.md#v019-archive-activation-before-the-reading-assertion)
for the separate API read failure found during the subsequent recovery run.
