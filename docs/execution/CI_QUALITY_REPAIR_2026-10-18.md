# CI quality repair — 2026-10-18

## Actual failed run

The user reported the outcome; inspection used local Git credentials and the
GitHub REST API, not browser login or web search. Run **39130940184**, attempt
one, tests exact source `70911e105a1149e0a1268cbe1402828832e2cd08`.

| Job | Result and actual boundary |
| --- | --- |
| API quality | Passed |
| Settings quality | Failed before checkout/tests: all three pinned ECR PostgreSQL pulls returned `toomanyrequests: Data limit exceeded` |
| Web quality | Reached default PWA: 145 passed, 738 conditional skips, six failures in the Chinese background-import matrix |
| Image build / artifact inspection | Skipped because required quality jobs failed; no deployable candidate was accepted |

The six browser failures all expected Chinese queued-analysis copy but received
English. The original trace proves the browser's mock `/api/preferences`
response contains only theme and language, without field revisions. SSR had
language revision **73** and theme revision **78** from earlier gates. Preference
sync correctly rejects an older snapshot (missing revisions default to one).
This is a test-fixture defect, not evidence that the translation is missing or
that stale-preference protection should be weakened.

Original logs, the original Web evidence ZIP and selected trace remain only in
the task-owned `C:\Users\86182\Desktop\wkkk\chat-reader-ci-repair` directory.
No credentials, cookies, business text or conversation identifiers are copied
into this record.

## Changes

1. The existing 12-case background-import matrix reads the initial preference
   snapshot without changing it. Its browser response preserves the complete
   snapshot and advances only the selected language/theme revisions. It now
   verifies actual DOM language and theme before interacting, then retains all
   existing queue, close/reopen, failed-read recovery, no-repeat/no-cancel,
   result and layout assertions. No application preference code is changed.
2. All three quality jobs start disposable PostgreSQL **after checkout**, so a
   helper can retry ECR and fall back to official Docker Hub. Both references
   retain the previously verified immutable index
   `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.
   The helper uses bounded pulls, explicit Linux/amd64, existing ports and
   readiness checks, and run/attempt/job-owned cleanup. Both-source failure
   remains a failed gate. No floating tag, production database, named volume,
   authentication-limit relaxation or SQLite substitute is introduced.
3. Source contracts now cover the helper, unchanged release inputs/gates and
   both-source failure. Synthetic shell tests execute the actual helper while
   replacing Docker/sleep/timeout with controlled shell functions; they cannot
   contact a real daemon or registry.

## Local verification

| Check | Result |
| --- | --- |
| `corepack pnpm run lint` | Passed |
| `corepack pnpm --filter web exec tsc --noEmit --incremental false` | Passed |
| Background-import Playwright matrix | **12/12 passed**, 375/768/1440px × Chinese/English × light/dark |
| Browser bootstrap | Synthetic SSR snapshot with language/theme revisions **73/78**, matching the CI trace; installed Chrome, test auth disabled |
| `node --test scripts/ci/release-image-sources.test.mjs scripts/ci/postgres-service.test.mjs` | **34/34 passed**, no skips |
| Bash syntax | Passed using Git for Windows Bash |
| Actionlint | Pinned **1.7.12** passed; optional shellcheck/pyflakes disabled |
| Parsed workflow comparison against `70911e1` | Only fixture startup/cleanup, settings port variable and additive helper tests differ; every prior quality step, timeout, dependency, image/artifact gate is preserved |
| `git diff --check` | Passed |

The Actionlint Windows ZIP was checked before extraction/execution against the
previously recorded SHA-256
`6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9`.
The temporary bootstrap server was stopped after the browser matrix.

An initial local browser attempt used the production-auth default and reached
the login page; it is not counted as validation. The pinned bundled Chromium
was unavailable locally, so accepted local runs explicitly use installed
Chrome. CI continues to use its pinned Playwright Chromium.

## Release and remaining limits

The user has authorized commit/push and CI retry, with deployment only after
quality succeeds. **After dispatching this retry, stop and wait for the user's
CI result. Do not poll or deploy automatically.**

Actual official-registry pulls/container startup, the entire settings matrix,
full PWA/auth/negative gates and image production are not claimed by these
local checks; the new exact-source CI owns them. Both public registries can be
unavailable. Python/Node image-build distribution pins are unchanged.
No application/API code or migration changes in this repair. The candidate's
earlier 0052 migration remains unshipped; production is still `3e68d1f`/0051.
