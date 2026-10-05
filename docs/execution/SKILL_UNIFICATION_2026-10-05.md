# Skill unification — 2026-10-05

Status: source `2863a00fadb500e6c2d8e206958de1edd947d50c` is committed/pushed.
[CI 37269234174](https://github.com/foolkking/chat-reader/actions/runs/37269234174)
passed all five quality/image/independent-inspection jobs. Deployment is pending
capacity recovery authorization; production remains `3f1d539`. This batch addresses MODEL-01, ACTION-01,
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
- Full local API regression started before the final lock correction: 870 passed,
  9 failed, 1 setup error, 5 skipped. The main database had not been migrated,
  integration auth configuration lacked the test session secret, and one Argon2
  setup allocation failed while the machine was under memory pressure. A separate
  migrated task database plus the same synthetic configuration used by CI yielded
  17 passed across all affected scenarios. No application assertions were weakened.
  A first focused invocation named two absent test files and ran no tests.
- Exact-source CI: API 883 passed / 3 skipped; reviewed runtime 64; focused
  worker/observability 53; Context browser 35; focused online 45; authenticated
  settings 126 plus 1 isolated archive restore; default PWA 134 passed / 269
  mode-specific skips; authentication 18; offline negatives 17. Other targeted
  Source Editor, Share, attachment, PDF and CSP gates passed. Suites overlap;
  skipped scenarios are not passes. Image build and independent artifact load /
  revision inspection passed. Uploaded scripts and external models are not executed.
- Task-owned browser API, worker and PostgreSQL were stopped after testing. Local
  task files remain; unrelated processes and preexisting workspace residues stay intact.

## Remaining release and goal work

Commit and complete CI are finished using the existing local Git credential in
child process memory; no interactive sign-in or credential output was required.
Production replacement and acceptance remain. A read-only preflight with the
retained previous archive measured 3,461,012 KiB available vs 5,278,142 KiB needed;
the new artifact requires its own preflight after staging. No service was stopped
and no production image/data/backup was removed.

CI artifact: `chat-reader-images-2863a00fadb500e6c2d8e206958de1edd947d50c-1`.
Archive size 196,486,912 bytes, SHA-256
`21a0246cdf87eb4e853c04d411b4a865db396e853ef9409bf8835192420dbecf`.
The local archive was parsed independently: four tags, amd64, complete source
labels and image config digests match its manifest. API/worker/migrate image:
`sha256:c3aca6d00d2464af75b38616aafeaf62536530d509f58e4bd12d236a548c411f`;
Web image: `sha256:745be1bcc0f62e633e2a71c0aff66240ee56349cbce78de266604ca9a4fa0d11`.
Prepared release helpers and artifact target
`/opt/chat-reader/releases/2863a00fadb500e6c2d8e206958de1edd947d50c/`; staging alone
does not load images, change the release pointer or recreate production services.
Server archive/manifest/inspection checksums match. Initial verification attempts
stopped on Windows CRLF in the generated checksum list and archived shell helpers;
the release-local files were normalized, with production configuration untouched.
The actual staged-artifact preflight then refused: **3,268,780 KiB available vs
5,278,167 KiB required**. PostgreSQL/environment and existing Compose baseline are
captured in that release directory. No preflight-passed marker, new backup, image
load, migration or service replacement exists for this source yet.

Historical backup archives were checksum-verified without changing them. A reviewed
optional plan would hard-link 15 byte-identical intermediate archive files while
retaining all backup paths and two independently stored copies per group, reclaiming
2,773,138,943 bytes (2.58 GiB). PostgreSQL dumps are excluded. The user has been
asked because prior cleanup authorization covered old images, not backup storage;
this operation is pending and must not be inferred approved from elapsed time.
After approval/capacity recovery: validate the staged artifact, repeat preflight,
make a new consistent backup, verify unchanged data/head, replace only application
services, accept live behavior, then remove exactly unused previous image tags.

Resume with the staged `deduplicate-backup-archives.py --apply` only if the user
approves the reviewed plan; otherwise leave backups intact. It retains the oldest
and newest independent archive per group and only links identical intermediate
members. Its pre-apply checks rehash content and reject changed paths/inodes.
Then run `preflight-release.sh` (not `prepare-release.sh`, whose baseline already
exists), `backup-and-load.sh`, `migrate-and-start.sh`, `accept-release.sh`,
`finalize-release.py`, `cleanup-superseded-images.py` and `post-cleanup-verify.sh`,
checking each result before the next. All are source-pinned, staged helpers;
old-image cleanup is gated on accepted runtime and the retained `3f1d539` archive.
Recheck queue idleness and production baseline freshness before restarting writes.

Administrator support/quota requests, broader Normalizer discovery and remaining
high-value whole-site improvements continue under the persistent optimization goal.
This Skill batch does not close that goal or verify external model semantics.
