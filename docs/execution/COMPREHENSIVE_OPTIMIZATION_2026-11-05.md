# Comprehensive optimization — 2026-11-05

Authorized scope: implement the consolidated authentication/offline and two-round
review plan, then review and fix findings. The subsequent user request authorizes
commit/push and exact-source CI on existing master, waiting at least 50 minutes
after dispatch before checking, then debugging/resubmitting until green.
Preserve previous uncommitted documentation and build-info changes. No deployment,
production operation, new branch or replay of user imports is authorized.

## Implementation ledger

Status is intentionally explicit; a written test is not a passing test, and
synthetic verification is not production acceptance.

| Work package | Status |
| --- | --- |
| Independent trusted-device access and online session recovery | Implemented; confirmation, legacy protection, non-blocking expiry/failure, reason classification, same-account sync fencing |
| Resumable deletion, tag cleanup and complete Share invalidation | Implemented; tombstone/job atomicity and cascade fault injection |
| Attachment safety and existing batch-ZIP delivery | Implemented; admission, compression, retained delivery and regeneration recheck policy |
| Discoverable unfinished imports | Implemented; account-scoped paged list and original-session resume without re-analysis |
| Search dates, notes/descriptions, tags and duplicate locations | Implemented; single migration metadata backfill and worker-owned private indexing |
| Archive portability and source-editor draft recovery | Implemented; additive extension, ID/owner checks, baseline mappings, explicit draft recovery |
| Incremental offline completion and measured resource bounds | Implemented; cursor-based feedback, query invalidation without Reader remount, bounded record iteration and URL reuse |
| Share create receipts and explicit whole-notebook scope | Implemented; serialized intent keys, read-only receipt lookup, bounded scope preview |
| Python lock, isolated restore drill and CI test ownership | Implemented; separate runtime/test/build hash locks, actual dump/restore, duplicate API subsets removed |

## Completion review and corrections

Review traced the account lifecycle, late requests, archive ownership/ID mapping,
deleted-source access, scan-policy changes, search ranking and paging, retained
operation IDs, existing data compatibility and the CI/image installation chain.
Findings fixed before submission:

- Late successful authentication could undo a local lock: abort/epoch guards and
  persisted locks prevent this. A new accepted password form selects its own
  account without clearing another account's retained lock.
- PostgreSQL 0058 requires a non-null maintenance-job owner; the 0059 populated
  migration now binds the index-backfill job to the provisioned administrator.
- SQLite UUID formatting could omit favorites from archives; normalized matching,
  project/tag ownership validation and system-restore collection checks were added.
- Saved searches now validate same-owner tags; tag deletion clears stale filters.
  New favorites reject deleted/foreign conversations, using compatible lock order.
- Retained attachment ZIPs now recheck source safety when claimed/downloaded.
  Full regression caught an overly broad status check: detached attachments remain
  readable in authorized history, but not in current batches/public-image links.
- Confirmed saves/discard retire queued source-draft writes so cleanup cannot
  recreate the acknowledged text. Preference/outbox authentication failures resume
  with existing operation IDs only after same-account verification.
- Offline cold-start regression caught device-only controls in server HTML.
  The hydration tree is now stable; device controls appear after hydration.
- Existing Reader instances now receive notebook search navigation without a
  destructive remount. Browser fixtures distinguish backend preference locale
  from browser fallback and hold synthetic cancellation failures deterministically.
- Disabled-account recovery tests now assert the retained-data lock screen and
  use the actual password form to unlock it, rather than assuming an automatic
  redirect or allowing an out-of-band cookie to clear the lock. The CI command
  contract retains the full suite, timeout and PostgreSQL requirements while
  checking the added diagnostic capture flag.

## Local execution evidence

All task-local temporary files belong under
`C:/Users/86182/Desktop/wkkk/chat-reader-implementation-20261105`.
The original build-info is preserved there for byte-for-byte restoration after checks.

| Check | Observed result |
| --- | --- |
| Full API suite with disposable PostgreSQL | 6033 passed, 1 failed, 4 setup errors, 10 skipped; 4949.76 s on Windows |
| Full-run failure diagnosis | Detached-history regression fixed; four housekeeping setups required Windows `PG_BIN`, now supported with matching-major verification |
| Post-fix attachment/upload/restore/auth/workflow/archive/migration suite | 31 passed, 80.21 s, including all five failing/error cases from the full run |
| Clean hash-locked dependency environment | Runtime/test/build locks installed successfully in an isolated Python 3.11 venv; project installed without dependency resolution/build isolation; the same 31 post-fix tests passed in 84.57 s |
| Additional populated migration / owner-feature / archive checks | 15 passed, 46.43 s |
| PostgreSQL restore and archive feature suite | 14 passed, 68.92 s; real dump/restore, historical versions, favorites and attachment bytes |
| UX and service-worker Node regression | 1975 passed, 0 failed |
| CI/source/security Node contracts | 71 passed, 0 failed; immutable source, diagnostic timeout and release gates retained |
| Auth gate and recovery browser acceptance | 23 passed; real authentication/cookie/Share/password boundaries plus missing cookie, expired trust, explicit trust consent, hidden-tab expiry, unavailable transport, explicit revocation/lock, late probe, route/focus dedup and storage failures |
| Settings/offline/sync/preferences browser acceptance | 18 passed, 1.6 min; retained local edits, account isolation/disable/recovery, snapshot failure, pending signout and preference conflicts |
| Reader / Library / source draft / Share browser regression | 37 passed, 3.7 min; cold start, v1-compatible reader paths, geometry, scroll, draft reload/recovery and two-language mobile/desktop source fidelity |
| PWA negative matrix | 28 passed, 1.3 min; browser restart, large package, quota/crash/replacement and compatibility failure preservation |
| Web lint / typecheck / production build | Passed; builds inspected for complete route output, not only process exit |
| Migration | Single head 0059; disposable PostgreSQL up/down/up and populated 0058→0059 worker backfill passed |
| Documentation and workspace handoff | 37 changed/new knowledge Markdown files, 1,350 local file links, no missing files; diff whitespace check passed; original build-info restored byte-for-byte and excluded from the commit; owned API/worker/test cluster stopped without deleting evidence |

The full suite started before the last review corrections; targeted post-fix
results do not turn that earlier run into an all-green full-suite claim.
Exact-source Linux CI remains the final integrated gate. Local browser runs used
the installed Chrome; CI keeps its existing pinned bundled Chromium requirement.
An intermediate combined run reused an administrator whose password the auth
gate had deliberately rotated, then hit the synthetic rate limiter. The owned
test database's throttle was reset and the independent settings run passed with
the rotated password; no production account or rate-limit policy was changed.

### Measurement, not a production performance claim

- PostgreSQL synthetic search: 1,000 candidates, 20 returned hits and only 20
  document bodies materialized; 3560.8 ms with tracing, Python traced peak
  3,581,604 bytes. This proves bounded body loading, not a throughput percentage.
- Synthetic fflate input: 9,000,028 expanded bytes / 17,674 compressed bytes,
  72.83 ms synchronous decompression in one local run. Existing capacity limits
  remain; no claim that all supported devices or maximum-size packages meet this.
- Twenty repeated verified attachment reads allocated one object URL/response
  Blob rather than twenty. Integrity verification itself is deliberately retained.
- No streaming package redesign, new search engine or unlimited background
  worker concurrency was introduced.

## Compatibility and remaining acceptance boundaries

Dexie stays v2; offline package v1/v2/v3, old `.cr` and existing Share URLs remain.
The nullable session reason and idempotency index share one migration head.
Source data timestamps are not rewritten. Current production is still `be58b12`
and schema 0058. The user's original ZIP, actual 47-conversation offline update,
authenticated production UI, physical-device accessibility/performance and
off-site/production-backup restoration are not asserted as verified.

## CI handoff

Completion review and local checks are finished; exact-source CI dispatch follows
the master commit. The dispatch handoff must record the exact SHA/run and a
not-before time at least 50 minutes after dispatch. Never substitute another
branch, older successful run or a partial job result for acceptance. CI acceptance
and any subsequent fixes remain pending; nothing in this receipt authorizes deployment.

### First exact-source CI diagnosis

Submitted master `309f2ee2662819c0f3b9aa41b49acb6bc94573f7`,
run `41905294676`. Created **2026-11-04 20:18:09Z**; first result read
**2026-11-04 21:09:42Z**, over 50 minutes later. Web quality passed.
API quality stopped before migration/tests: the Ubuntu 26.04 runner could not
resolve `postgresql-client-16` from its default repositories. This is not a
passing full-API result; dependent release gates did not run.

Correction removes that host-package dependency, not the restore checks. Both
actual recovery suites now share matching-major client selection: explicit
local `PG_BIN`, otherwise the already-owned pinned CI PostgreSQL container.
Dump/restore use binary streams and the internal port; bad identity, missing
explicit tools and a wrong major fail closed. Focused local verification and
the next exact-source run are recorded separately when complete.

The already-failed superseded run was cancelled after the first 50-minute
check to finalize its settings evidence, not to count cancellation as acceptance.
Its partial 463-case matrix recorded six failures. Five depended on the former
focus/credential behavior; fixtures now switch accounts through the real password
form, retain cross-account API denials/late-byte checks, and do not expect every
focus to bypass the five-minute deduplication window.

The sixth was a product defect: a persisted signout-cleanup marker on cold
Library startup was hidden by the early local-lock screen. Recovery now checks
the durable cleanup first, pauses online operations and displays the existing
retry surface without reopening private data. A new browser regression checks
the cleanup/local-lock precedence and zero session queries before recovery.

PostgreSQL backup client/unit/real-restore checks: **13 passed, 18.34 s**.
CI/security Node contracts: **72 passed**. A combined Windows run of all Node
groups hit the existing 10-second Git-Bash harness timeout under concurrent
browser load (2,046 passed / one timeout); the isolated CI/security rerun passed
without changing the timeout or assertions. UX/PWA and browser final receipts
follow separately; this does not establish exact-source Linux acceptance.

Final pre-resubmission verification:

| Check | Observed result |
| --- | --- |
| Six recorded settings failures and cleanup variants | 10 passed, 57.2 s; includes the unchanged four real-storage cleanup tests and the new cold-start precedence regression |
| Complete auth-recovery browser suite | 20 passed, 1.3 min |
| Isolated UX/PWA Node regressions | 1,975 passed; no timeout or assertion changes |
| Web lint, typecheck and production build | Passed after the CI corrections |

The account-switch fixtures submit the real password form; they do not remove
the retained account locks or bypass the server session. Direct-export and
late-batch regressions still require denial of another account's source/task
and reject delayed private bytes. The final review found no reason to weaken
the existing signout-storage failure tests. Their source is unchanged.
The original unrelated build-info is again restored byte-for-byte and excluded.
The failed first run is not accepted; the corrected master requires a new
complete exact-source CI, with a new 50-minute first-check gate.
