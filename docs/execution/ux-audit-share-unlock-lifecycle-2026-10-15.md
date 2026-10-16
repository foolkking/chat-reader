# UX quick review — Share password-unlock lifecycle

2026-10-15 · pre-edit source evidence. Full ordinary-user goal remains active.

## Scope and evidence

Mainstream responsive Web, only the public Share password gate and its
request/input lifetime. This is a local state repair, not an authentication,
cookie, access-control or rate-limit change.

SEEN: `apps/web/features/sharing/share-readonly-reader.tsx:61–63,218–255,
669–691,1027–1057`; `apps/web/lib/api.ts:1464–1466`; the existing
visit-scoped Reader/Share callback patterns and extracted-source regressions.
NOT SEEN: mounted React, password-manager behavior, real unlock/refetch,
browser focus/announcements, production or CPU/RSS. Facts about branches are
Observed (code); visible timing consequences and frequency are Inferred.
Tests/gates, services, browser operation and release remain off.

## Executive summary

The gate already has a native form, persistent password label and translated
pending/failure copy. Its inline submit callback has no synchronous admission
guard or current-visit ownership. Two submissions before a busy render can
both start, and an old completion can refetch its former Share or publish
feedback after a token change. Password, busy and error state are not reset
by the existing visit lifecycle. Editing remains enabled during a request and
leaves the old error beside a different password. Reuse the existing visit
identity with one owned in-memory attempt, reset only ephemeral gate state
on visit changes, and retain input on a current failed attempt.

## Findings and quick wins

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| STATE-SHARE-UNLOCK-01 | Defect / state coverage; feedback | Medium | Observed (code); runtime consequence Inferred | S |
| FORM-SHARE-UNLOCK-01 | Defect / forms and input; error recovery | Medium | Observed (code); runtime consequence Inferred | S |

**STATE-SHARE-UNLOCK-01.** Pre-edit location: inline `onSubmit:675–688`,
gate submit button at 1055 and visit layout lifecycle at 218–255.
`setUnlockBusy(true)` is only a future render flag; the callback neither
checks nor owns an attempt. After both awaits, catch/finally still update
state without checking the token visit. A visitor can spend multiple unlock
attempts on a rapid resubmit, or see an old error/pending completion replace
feedback belonging to another Share. Admit once synchronously through a ref,
then require both the active visit and that exact attempt before starting
the follow-up read or publishing/clearing state. Retirement suppresses local
follow-up only; it does not undo a POST/cookie already sent.

**FORM-SHARE-UNLOCK-01.** Pre-edit locations: input at 1053, direct setter
prop at 673 and visit layout lifecycle at 218–255. The password remains
editable while the submitted value is pending; its old error survives edits,
and all three gate states survive a token change. A visitor can associate
feedback with a password that was never submitted, or unknowingly reuse a
previous Share's password. Lock pending edits, clear obsolete error on a
permitted edit, and reset password/busy/error at visit setup and retire the
owned attempt at cleanup. Preserve raw password whitespace and failed input;
do not persist passwords. Clear the in-memory input only after a current
successful metadata read, not merely a successful unlock POST.

## Ordered repair and acceptance

1. Add local attempt identity, guarded edit/submit callbacks and a small
   visit layout lifecycle; wire the existing gate to them. Retain finite
   current 429/other failure copy, native form and current API/refetch policy.
2. Author an extracted-source regression for rapid duplicates, pending edit,
   retry/rate-limit, untrimmed input, failed follow-up read, visit/unmount/
   replay retirement and old finally versus a newer pending attempt. Do not
   execute it; do not reclassify older checks as acceptance.
3. After authorization run focused/related Web checks with task TEMP/TMP,
   then actual keyboard/password-manager and slow-response/token-switch
   acceptance. Source adapters alone do not prove browser or auth behavior.

## What stays and open questions

No new request, retry, abort, dependency, timer, storage, API, query key,
translation policy, Share URL/access, position format, package or Dexie
change. Existing local-position retention on 401 and complete-turn/real-DOM
reading remain unchanged. No claim that a retired request is physically
cancelled or its server-side effects reversed. Indefinitely pending
requests, real session/cookie outcomes and edge-loading lifecycle remain
separate.

## Implemented source checkpoint

The existing gate now uses guarded edit/submit callbacks with one synchronous
owned attempt ref. Post-await follow-up and publication/finally require the
active token visit and that exact attempt. A separate visit layout lifecycle
resets only ephemeral password/busy/error and retires owned work; the existing
Reader visit/reset lifecycle is unchanged. Pending input is disabled and the
native form has `aria-busy`. Permitted edits clear obsolete errors; failures
retain raw input, and only a current successful metadata read clears it.

`scripts/ux/share-unlock-lifecycle.test.mjs` is authored but **unexecuted**. It
extracts the real visit factory and whole visit layout effect as well as
unlock state/ref/reset/callbacks and actual gate call/helper. Controlled
hooks, unrelated Reader setters, POST/query outcomes and static markup cover
rapid duplicate/pending edit, both finite locales, failure/retry, whitespace,
failed follow-up, visit/unmount/replay retirement and old finally versus a
new pending attempt. Native form/default prevention and existing password
label/autocomplete wiring have authored assertions. This is not mounted
React, a browser, password-manager or cookie/auth evidence.

The six current documentation entry/architecture/flow/test/inventory files
are synchronized. No test/gate, syntax check, service, browser, build, commit,
CI, deployment or resource measurement ran. Formatting-only diff review is
recorded separately below; source authoring is not acceptance.

Formatting-only `git diff --check` on the tracked Share source and six current
documentation files exited 0. Existing LF→CRLF warnings were left alone.
The new report and new regression are untracked and were not covered by
that tracked-diff check. No test or syntax execution is implied.
