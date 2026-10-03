# Context semantic walkthrough — 2026-10-03

This is a single-agent, synthetic external-workflow review. It is not an
independent evaluation of another model, a real-user-data trial, or proof that
arbitrary agents follow the Skills. No model service or uploaded script was
executed by Chat Reader.

## Material and method

The reviewed Acquisition/Maintainer instructions and OLD/NEW workflow were read.
The agent authored and read every one of 14 synthetic messages, then reconciled a
boundary at message 12. Source and expected interpretation are in
[`semantic-walkthrough-v1.json`](../../tools/context-skills/tests/fixtures/semantic-walkthrough-v1.json).
The generated Current, Index and both extracted tail messages were subsequently
read and assessed. This semantic assessment is separate from the deterministic
test, which checks only that writer/reader processing preserves the authored model.

The test uses actual external materialization, fresh package validation and
extraction. Raw bytes remain identical; Current and Index share coverage 1–12;
Index references resolve across all 12 covered messages; messages 13–14 remain
outside the saved boundary and are both delivered by the reader.

## Reviewed distinctions

| Evidence | Reconciled meaning | Outcome in the inspected output |
| --- | --- | --- |
| Messages 1–3: assistant proposes automatic publication; user accepts the report with explicit exclusions | No publication; qualified adoption does not accept all proposed clauses | Current retains the prohibition and attributes the proposal/rejection |
| Messages 3, 9, 11: pilot CSV, other projects JSON, possible future reconsideration | The scope remains pilot-only; a future option is not an adopted decision | One scoped decision; no global CSV policy |
| Messages 4–6, 12: plan, implementation report, unit-test revision correction | Local implementation is reported; revision 6 passing tests do not verify revision 7; no deployment proof | Workstream and verification debt remain separate and attributed |
| Messages 7–8: absent approval attachment and incomplete deployment history | Approval/deployment are unknown here; neither filename nor omission proves either outcome | Unknowns preserve the missing evidence without fabricating approval or nonexistence |
| Messages 10–11: incorrect assistant recap followed by explicit correction | The recap is historical, not active policy or test evidence | Retired stub points to the correction; Index preserves both messages |
| Messages 13–14: tail reports a failed browser run, followed by an assistant proposal to bypass it | Effective state changes to a reported browser failure; fix it next. Publication remains prohibited | Both complete tail bodies were extracted; the review reconciles failure without promoting the bypass proposal |

At the saved boundary, browser checks are unverified. After acquiring the tail,
the user-reported failure becomes the effective state. The saved Current is not
silently rewritten by Acquisition. Revision 7 unit tests and production status
remain unknown; a browser failure does not decide either.

## Repeatability and limits

Run `python -m pytest tools/context-skills/tests/test_semantic_walkthrough.py -q`
with the task temporary directory configured. The fixture has explicit authored
semantic attestations; passing this test does not generate or independently prove
those attestations. The first harness attempts omitted the required validation
report, then read the extraction receipt instead of its materialized message
files. Both were corrected; no runtime behavior was weakened to make them pass.

The reviewed runtime suite, including this walkthrough, is part of the existing
CI Context runtime step. Linux still needs to exercise the Windows-skipped symlink
case. Independent external model use and real deployment remain unverified.
The three user-supplied default ZIPs are unchanged. Separately generated
`.review.zip` artifacts contain reviewed source fixes and the dual-package writer;
they are not installed as system defaults.

## Default Normalizer walkthrough

The exact supplied Normalizer Bundle was also exercised externally against a
three-message synthetic JSON source. Its instructions, script contracts, candidate
contract, serializer and source/publication I/O helper were read; script imports
and direct dynamic-execution calls were inspected before running. Only Python
members from the pinned ZIP were copied into the authorized E: test directory.
Subprocesses received a minimal environment without the fixture account credentials.
This is a scoped review, not a comprehensive audit of every adapter or arbitrary input.

The source explicitly contains two successive user turns, a fenced Markdown
example with a literal full Response delimiter, one assistant reply, and a known
historical Exported value. The agent read the source and constructed a direct,
verbatim candidate without merging, deletion or inferred timestamps/models.
Actual inspector → serializer → validator results:

- Adapter: `chatgpt_json`; result: `NORMALIZED`; three output messages.
- Validator: `valid`, candidate/source binding matches; source bytes unchanged.
- The actual application `parse_transcript` read the produced file with exact
  roles/bodies and original Exported value. Normalization time was not inserted
  into the transcript. The generated Markdown was also read directly.

Bundle SHA-256:
`55032c9df6eab4fe7fc32afcca183772f0be176ad13581cab752e415a6c59ee5`.
Local synthetic artifacts and the one-time harness are under
`.tmp/context-tests/normalizer-external-20261003/` and
`.tmp/context-tests/normalizer-external-walkthrough.py`.
No application path executes these scripts; this was an external acceptance probe.
Ambiguous branches, reconstructed tool spans, PARTIAL/BLOCKED outcomes and large
Normalizer inputs were not exercised by this walkthrough and are not counted as
passing. Existing application import/offline regression evidence remains separate.
