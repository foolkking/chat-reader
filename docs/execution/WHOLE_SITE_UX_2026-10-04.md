# Whole-site UX execution — 2026-10-04

## Boundary and changes

This round follows the completed Context/settings release `0219fd5`. The
[audit](../evidence/ux-audit-whole-site-2026-10-04.md) was delivered before UI edits.
Eighteen independent issues are implemented; prior settings cleanup is not counted.
This batch is not deployed. No migration, model call, uploaded-script execution or
maintenance reminder is introduced.

| Audit IDs | Implemented result |
|---|---|
| FORM-01, COPY-01 | New/inserted-message and project forms protect dirty input, guard in-flight writes and retain failed drafts; composition follows account language. |
| A11Y-01, NAV-01 | Short-screen project settings scroll within fixed header/footer. Modal focus and keyboard menus work without starting ancestor DnD. Touch menus stay visible. |
| DATA-01, NAV-04, STATE-01 | Saved symbols/colors render. Phones create projects. Sorting/archive/restore report failure and permit retry while retaining data. |
| FILTER-01, NAV-02, NAV-03 | All scope includes archives; stale/IME input cannot navigate; search submit is separate from deliberate result selection; browser history updates input. |
| VIS-01, A11Y-02, STATE-02 | Collapsible filters count/clear, invalid dates explain the issue, scope resets pagination without stealing focus, keyboard/visual order agrees, failures are not empty results. |
| STATE-03, ACTION-01 | Attachment loading reports unknown/error/retry. Rename preserves failed input, copy waits for completion, partial removal retains failed selection. |
| STATE-04, STATE-05, VIS-02 | Export retries status on the same job; task reads/actions report errors. Sidebar/mobile show one bounded shortcut, zero-hit scans do not ask for review; details remain in Task Center. |

Successful writes in the added UX gate use real API/worker/PostgreSQL. Failures
are injected explicitly and retried against real services with persistence checks.
Mock-only presentation checks and synthetic screenshots are distinguished from
production acceptance. No real user data or credentials are captured.

## Validation checkpoint

Final-source build, lint and typecheck pass. Alembic has one head `20261003_0046`;
a separate disposable PostgreSQL database migrated from empty to head.

- `ux-functional-final-source`: 16 passed/one new pagination fixture failed
  before execution because manual creation accepts exactly two messages. The
  fixture now imports 60 synthetic messages through the actual worker.
- Those 16 passes cover DnD (3), 375/768/1440 × Chinese-light/English-dark (6),
  search, attachments, export recovery, fresh/IME search, insertion, phone project
  lifecycle and eight independent noise scans. Counts overlap other runs.
- `ux-legacy-regression`: 29 passed/two failed. Source upload atomicity (13), Share
  focus (2), legacy offline parity (1) and 13 task/shell cases passed. Corrections
  for the two failures are described below; unrerun cases are not passes.
- Earlier authenticated integration passed admin (4), settings presentation (6),
  share management (5), offline identity lock (1) and mutation lifecycle (2), with
  overlapping UX cases. The interrupted run is not a fully passing suite.
- This was an intermediate checkpoint; final results are recorded below, while CI runs against the committed source.

## Failed/incomplete attempts

The first acceptance runs exposed actual short-screen fieldset overflow and
project menu keyboard events starting DnD. Both were fixed and subsequently
passed browser checks. Other fixture corrections addressed duplicate mobile
sidebars, navigation-before-reload, reopening menus, Message actions before
Export, the actual archive row and the real conversation-search endpoint.

`ux-functional-final` had 14 passes/two failures: a DnD link-name assertion
omitted its preview text despite correct persistence/rendering; eight requests
for the same scan hit the existing reuse rule. The test now uses eight conversations
and checks persisted dismissal from eight results to seven.

`ux-functional-verified` used a build missing the local API override, baking 8000
instead of isolated 8098 into Next rewrites. It failed before product assertions
and was replaced. No production environment changed. An initial API run inherited
browser `AUTH_ENABLED=true`; general fixtures failed and it was interrupted. The
rerun disables that baseline setting, uses a separate database and enables explicit
PostgreSQL tests; authentication tests establish their own mode.

Original offline parity cases assume the legacy auth-disabled Web shell; running
them with the authenticated shell failed at offline authorization. The separate
authenticated offline-lock gate covers UUID and expiry fencing. The legacy rerun
then exposed incidental source-ref ordering: DB and offline traversal emit records
in different inter-message order. Equality now sorts explicit identities first,
preserving every field and count; Raw/message-order assertions remain intact.

Task regression found English detailed offline phases reduced to “Processing”.
Equivalent English phase labels restore progress detail, and the test checks the
specific search-packaging stage in either language. Failed/interrupted runs remain
historical evidence, not successful checks.

## Delivery and limits

The previous [deployment](DEPLOYMENT_CONTEXT_2026-10-04.md) is separately verified.
This round's commit/push/CI and visual evidence are recorded below on completion.
No user analytics/interview or independent external Skill/model trial is claimed.
Skipped tests are not passes and overlapping suites are not added together.

PROJECT_STATE and navigation now distinguish the live release from this batch;
contradictory old checkpoints are preserved in
`docs/archive/PROJECT_STATE-history-2026-10-04.md`. Current interaction contracts
live in frontend/user-flow/testing docs. AGENTS retains the C: temporary-root rule;
this test batch uses its explicitly authorized E: exception with process-local
TEMP/TMP. Unrelated TypeScript build-info changes, imports and caches are untouched.

## Final local results

- Full API: **867 passed / 4 skipped**, 26m12s, disposable PostgreSQL with
  integration gates enabled. Skips: Windows symlink permission and three absent
  optional external fixture inputs. They are not counted as passes.
- `ux-complete-regression`: **47 passed / 1 failed**; the remaining pagination
  fixture entered adaptive resolving instead of direct import. It now creates
  30 real two-message conversations. Search also indexes conversation summaries,
  so the 60-message paging test explicitly selects the message scope. The final
  isolated pagination run passes, including 50→60 results, role filter→30, date
  validation/focus and clearing back to 50 without losing the query.
- Context offline parity: both actual and legacy packages pass real download,
  disconnected reload and re-export. Source upload atomicity 13, Share focus 2,
  Task Center/shell 14, and project DnD 3 pass in the complete regression.
- Visual sweep: 54 frames across nine surfaces, three widths and two appearance
  settings. Early hydration frames were discarded and recaptured after real data
  and preference readiness. Public Share retains its configured appearance; an
  OS dark-mode preference does not override the share policy.

The sweep's first attempt used a desktop-only per-message source action on mobile;
its next run stalled during repeated disposable context teardown. Reusing one
public context completed the sweep. A run with service workers deliberately
blocked produced an offline-resource initialization error; the real-worker sweep
replaced that artificial setup. Rapid navigation logged an interrupted response
stream on the local Next server without a failed page assertion. These attempts
are not promoted to separate successful acceptance.

The final aggregate UX gate and CI evidence accompany this source revision;
production continues to run the earlier `0219fd5` release.

Final focused acceptance: **14/14 passed**, no skipped cases, including the final
60-message paging test and scan selection scoped to this fixture's own records.
Final build, lint and typecheck pass. Whole-source PWA/security/settings gates are
required in the workflow for this commit; their downloadable gate evidence is
authoritative for CI rather than reusing the previous deployment's run.

Cleanup attempt: two confirmed obsolete pytest directories accidentally created
under `apps/api/1projectchat-reader.tmpcontext-tests…` total 2,066,616,430 bytes
on E:. Both contained named test outputs and no reparse-point members. Automatic
approval rejected the narrowly scoped PowerShell deletion with “blocked by policy”.
The directories were retained and no workaround deletion was attempted. C: was
not touched and no space-recovery claim is made.
