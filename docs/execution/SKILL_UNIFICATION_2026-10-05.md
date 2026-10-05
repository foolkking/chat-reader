# Skill unification — 2026-10-05

Status: local implementation and verification in progress; not committed or
deployed. Production remains `3f1d539`. This batch addresses MODEL-01, ACTION-01,
STATE-01 and the Skill management parts of the dated usability review. It does
not claim administrator quota/support requests are implemented.

## Behavior

- Exactly three effective system purposes; no Skill language picker or cloning.
  Equivalent historical aliases share one display entry. Distinct full Bundles
  remain explicit choices; identical instructions with different scripts never
  imply equivalence. Existing personal resources/history remain intact.
- One explicit personal preference across interface languages, stored in both
  compatibility slots. Single old preferences are reused; divergent old choices
  remain until explicit unification. Disable/delete clears only matching choices.
  Account fences plus purpose-scoped PostgreSQL advisory locks serialize initial
  selection creation and changes; stale ORM reads are refreshed after locking.
- System replacement/restore/default selection applies across languages while
  preserving personal preference. Download URLs pin the displayed revision.
- Compact divided rows, horizontal mobile purpose tabs, 44px actions, collapsible
  upload form, dirty replacement protection and actual loading/error/retry states.
- Normalizer uses the resolved selected Bundle and interface language, with no
  silent fallback on load failure. Clipboard denial exposes manual copying.
- Archive preflight retains owner/category validation while allowing cross-locale
  preference references. No migration added; existing head is `20261003_0046`.
- Ordinary Web builds now honor explicit NEXT_BUILD_CPUS, preserving unset and
  standalone defaults. This bounded retry resolves the observed local memory limit.

## Verification so far

All fixtures are synthetic and temporary storage is scoped to the task directory
under `C:/Users/86182/Desktop/wkkk`; existing PostgreSQL and user imports are untouched.

- Focused API: 59 passed before the final explicit preference lock addition.
- Disposable PostgreSQL: 5 passed before that addition, including personal/system
  archive roundtrips, rollback and selection concurrency. Review found the account
  lock was shared, so additional purpose locking and stale-read coverage were added.
- Final frontend: lint/typecheck and bounded production build passed. Ordinary
  build initially ran out of memory at static generation; its shell exit 0 was
  not treated as success. The bounded retry completed its full route table.
- Browser initial 8, expanded 12, then consolidated 15 passed. The last run uses
  existing authenticated administrator coverage instead of duplicate admin cases
  in the auth-disabled Context suite. Three widths, both interface languages,
  real changed-language reopen, preferred downloads, replacement/history bytes,
  dirty conflicts, restore, normalizer load/clipboard failure and MD name retention
  are covered. The six administrator cases also verify a separate user's
  preference and denied privileged reads. Final screenshots were visually reviewed.
- Initial API run: 44 passed / 3 failed due to two incorrect legacy subject fixture
  assumptions and the old locale-specific last-active fixture; corrected before 59.
- Existing local PostgreSQL role lacked CREATE DATABASE: 5 setup errors, then an
  isolated task-owned cluster was used. The first attempted cluster port failed to
  bind; the working cluster uses another local-only port. No existing role changed.
- Final lock-specific API/real PostgreSQL regression: 46 passed, including two
  simultaneous first selections and two stale readers unifying divergent legacy
  choices. Final lint/typecheck and single Alembic head checks passed.
- Full API regression started before the final lock correction is still running;
  its non-passing cases must be classified. A first focused invocation named two
  absent test files and ran no tests; it is not counted as a pass.

## Remaining release and goal work

Finish API regression/lock checks, final lint/typecheck/head, Context and baseline
PWA gates, source CI, commit/deployment and production acceptance. Keep failures,
skips and unexecuted checks separate. Use existing local Git credentials in memory;
do not require interactive login or log credential values. Retain backups and the
verified recovery archive before removing exact unused old image tags.

Administrator support/quota requests, broader Normalizer discovery and remaining
high-value whole-site improvements continue under the persistent optimization goal.
This Skill batch does not close that goal or verify external model semantics.
