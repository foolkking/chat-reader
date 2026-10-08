# Offline failure guidance — 2026-10-08

Status: implemented; static/backend checks pass, browser acceptance pending.

## Evidence and behavior

The download loop previously discarded every failed task's error as GENERATION.
After the attachment-integrity fix, users still saw only "retry to rebuild" even
when the underlying attachment needed repair. Task Center displayed raw English
failure text. This is source-code evidence, not a user study.

The server now reports stable `OFFLINE_ASSET_INTEGRITY` / `OFFLINE_ASSET_IO` values.
A shared pure error module admits only recognized codes (including exact legacy
messages); unknown exceptions remain GENERATION rather than being cached/displayed
as raw diagnostics. Offline Center and Task Center show localized causes and next
actions. Existing-copy retention wording is conditional; Task Center does not
claim a browser copy exists. Manual retries of these failed generation categories
use fresh job/package admission, preserving existing local data and retry guards.
No new reminder, dialog, automatic retry or forced user action was added.

## Verification

- 5 backend attachment tests passed: actual worker failure codes, prior artifact
  preservation, repaired-source success and bounded cancellation.
- Web lint, nonincremental TypeScript check and production build passed.
- Pure module checks covered recognized/unknown/legacy errors, JSON-roundtrip
  error categories, rebuild versus network/write retry and both locales' wording.
  These checks do not prove browser persistence or button behavior.
- Browser acceptance remains pending: test both surfaces, reload with a retained
  copy and without one, repair then manually retry, and confirm a new server job
  replaces the failed attempt while local contents remain readable. Include both
  languages, keyboard and small/large widths. At this initial check the earlier
  Web-start rejection still prevented execution; no alternative startup attempted.

Follow-up: two browser cases were added to `settings-offline-recovery.spec.ts`
(375px Chinese integrity failure; 1440px English packaging I/O failure). They
verify retained message bytes, persisted error after reload, new admission key/job
on retry and successful real download completion. Only the failed task response
is fault-injected; server worker failure persistence is covered by backend tests.
The new tests pass ESLint and nonincremental typecheck but have **not run**.
Task Center and first-download/no-existing-copy browser checks were not yet written
at that point. The original port inspection found no listeners on 3107, 8008 or
45438. The later user continuation and preparation are recorded below.

Temporary evidence is under desktop `wkkk/chat-reader-offline-error-guidance-20261008`.
No migration, commit, CI, deployment or production access. The earlier full API /
PostgreSQL gates predate this small error-contract change; they are not rerun here.

## Resumed preparation and retained-copy correction

The user explicitly continued on October 8. A fresh disposable browser database
upgraded to the existing single head 0050; the authenticated API, SMTP sink and
single worker reported ready. Automatic review again rejected
`corepack pnpm --filter web exec next start --hostname 127.0.0.1 -p 3107`, returning
only `blocked by policy`. No alternative launcher/port/server was attempted. The
supervisor then reported `ISOLATED_SERVICES_STOPPED`; all four test ports were
confirmed without listeners. The test database remains in the stopped task cluster.

Source review found the shared message still defaulted to a retained-copy claim:
the sync center could say a copy was retained on a first download or when only an
unrelated conversation existed locally. Retention now requires an explicit boolean.
The sync center checks only the displayed failure page via the existing ID/project
indexes; the library matches the actual failed scope. Cancellation without a
matching copy and unclassified operation failures no longer claim a readable copy.
No message/attachment write, schema change or new persistent field was added.

At this checkpoint eight offline browser cases were prepared: two retained-copy rebuilds, four
first-copy rebuilds (empty and unrelated libraries in both locales), and two Task
Center display checks at 768px. Existing download cases now bind the actual
`job_id` response field; an untyped `id` previously prevented fault injection.
Only failure transport/display is injected. Successful admission, package bytes,
retry identities and IndexedDB results are intended to use the real fixture.
Task Center cases at this checkpoint checked wording/keyboard access, not server
retry persistence. The later follow-up below replaces that limited test intent.

Current lint, nonincremental TypeScript and bounded Web build passed. A list-only
Playwright command discovered these eight cases plus eight noise-selection cases;
**16 discovered, zero executed**. No screenshot or browser pass is claimed. The
build now records the isolated API on port 8008 rather than the previous default
port; startup must use the same upstream. New preparation logs live under desktop
`wkkk/chat-reader-browser-acceptance-20261008`.

[Aggregate evidence](offline-error-guidance-2026-10-08-evidence/results.json)
separates completed static checks from pending browser acceptance. No commit,
CI, deployment, production access or local image build.

## Task Center workflow follow-up

The [subsequent recovery record](offline-task-recovery-2026-10-08.md) fixes the
server-only Retry path and updates the two Task Center cases to require real
explicit admission, ZIP download and IndexedDB persistence. Retained-copy cases
also check Task Center entry, correct failure-page focus and no automatic retry.
Their discovery still totals eight offline plus eight selection cases; none has
executed because the same Web-start policy block remains. The new 33-case API
gate covers real worker recovery and target authorization separately.
