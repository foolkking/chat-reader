# Administrator requests — 2026-10-05

Status: backend, core Help/request UI and contextual limit entries implemented
locally and not deployed; local regression is recorded below and release CI remains. The separate
Skill release `2863a00` has passed complete CI and remains staged; its production
replacement is still gated by server capacity. This support batch must not be
included in that pinned release or represented as a finished user-facing feature.

## Scope and sequence

The approved usability review is
[Skill/help review](../evidence/ux-audit-skills-help-2026-10-05.md).
First implement persistence, actual effective limits, private/admin APIs, bounded
notification delivery and archive/delete compatibility. Then build Help/request
and administrator screens, protected local drafts and entry points. Finish with
real browser/SMTP/offline acceptance and full CI before a separate release.

Only import-file size and merge message count are adjustable. No storage billing,
periodic allowance, new mail provider or automated conversation collection is added.

## Implemented locally

- Migration `20261005_0047` after `20261003_0046`: private requests, messages and
  account limit overrides. PostgreSQL upgrade/downgrade and owner-cascade behavior
  have real test evidence. The production/staged release remains on `0046`.
- Owner-scoped create/list/read/reply/withdraw and Root-only list/read/reply/
  approve/reject/resolve/request-info. UUIDs come from authenticated state;
  mutable ADMIN role alone is insufficient. All writes require an idempotency
  key; request mutations also check the base revision. Per-owner PostgreSQL
  advisory locking serializes duplicate creates and concurrent decisions.
- Approval and limit change share one transaction. Effective values combine the
  global default and explicit increase, capped by API, gateway declaration and
  adaptive import total capacity. Per-file and per-request aggregate limits are
  distinct. Capability responses, standard/adaptive upload and merge admission
  use the same account resolver. Feature gates remain authoritative.
- Merge jobs retain the accepted count ceiling. Later revocation affects new
  admissions, not accepted work; growing sources beyond the accepted ceiling fail
  safely without publishing a partial merge.
- Root may replace/revoke overrides with a base revision and reason. The current
  change reason remains in private storage, never general audit/log metadata.
  Repeating the most recent override key is idempotent; an older base after a
  subsequent change returns conflict rather than replaying an old grant.
- Station requests are authoritative. Email is explicit opt-in and uses the
  persisted deployment-managed Root email or the request owner's current email.
  Clients cannot choose arbitrary recipients. The single worker sends a minimal
  notification and an authenticated fragment link; it sends no title/body,
  diagnostics or attachment content. Delivery state is separate from request state.
- SMTP acceptance, explicit rejection and uncertain transport failure are distinct.
  Failed/unavailable notifications have an author-scoped explicit retry, at most
  three delivery attempts, with idempotent queueing. UNKNOWN is never automatically
  replayed. A stale worker send marker becomes UNKNOWN. Notification jobs remain
  internal; request detail owns their status/retry UI.
- `.cr` optional `support_requests_version: 1`: personal exports include only own
  request/reply history and redact other account identities. Additive restoration
  makes requests IMPORTED/read-only, does not grant limits and does not send mail.
  System restore remaps account references, restores bounded grants, and clears
  delivery replay state. Old archives without the extension still read.
- Account deletion counts private requests and foreign keys cascade their history
  and overrides. It does not affect another account's resources.
- Import frontend precheck includes the server's optional combined-batch ceiling;
  legacy servers omitting it retain their existing per-file behavior.

## Evidence and retained failures

All content/mail recipients are synthetic. Temporary files and isolated PostgreSQL
are under `C:/Users/86182/Desktop/wkkk/chat-reader-support-20261005`; no user import
storage, existing database or production environment was used for tests.

- Initial collection stopped on one indentation error; fixed before running tests.
- First request suite: 3 passed / 4 failed because mail configuration referenced a
  nonexistent Settings field. Delivery now resolves the deployment Root account
  from the database. Request/admin regression then passed **16 tests**.
- Archive/real PostgreSQL batch: initially **26 passed / 3 failed**. Two fixtures
  expected a 100 MiB gateway bound while the local API configuration still capped
  it at 50; the fixture now sets its synthetic API bound explicitly. The legacy
  archive fixture also needed to remove the new extension declaration when
  intentionally removing all configuration tables. Corrected batch: **29 passed**.
- Those tests cover concurrent first submission, competing approvals, real FK
  deletion, upgrade/downgrade, additive history restoration, no replayed grants or
  mail, new-instance system account remapping and old archive readability.
- Expanded request/merge suite: **29 passed / 1 failed**; the new merge test used
  the wrong create-response field. Corrected focused rerun: **1 passed**. Tests
  include real localhost SMTP sending to both fixed recipient types, private body
  exclusion, finite idempotent retries, ambiguous delivery recovery, transaction
  rollback and real merge publication under the accepted ceiling.
- Single Alembic head: **20261005_0047**. These suites overlap; do not sum totals.
- Final request/import-budget regression: **22 passed**, including both real
  combined-size rejection routes with no persisted import after failure.
- Web lint and typecheck passed. Production Web build, browser/PWA and full API CI
  are deferred until the remaining frontend/draft integration; these are not passes
  for this batch. The already-passing Skill CI does not validate these local edits.
- Adaptive/import-admission regression: **37 passed / 1 failed**. The additional
  gateway guard initially masked the existing SESSION_TOO_LARGE error contract.
  The gateway check now covers only its own request ceiling and leaves the session
  service's existing code intact. Targeted corrected regression: **3 passed**,
  including both gateway rejection routes. No assertion was relaxed.
- `git diff --check` passed. The task-owned PostgreSQL on loopback port 55947 was
  stopped after tests; no test services remain live. Its synthetic cluster/logs
  stay in the named task temporary directory for the user's later cleanup.

## Remaining work and handoff

1. Contextual import/merge requests now preserve selected files, title and order.
   Finish the expanded regression/release checks below before including this batch.
2. Pagination, storage recovery, pending-export bytes and keyboard order now have
   browser evidence. Additional delayed-response/account-switch and unavailable/
   retry-mail browser probes remain; backend isolation/mail evidence is separate.
3. Root can adjust/revoke overrides from request detail. Further high-value inbox
   navigation refinements may continue under the optimization goal.
4. Local full API/PWA and migration/archive regressions are recorded; run release CI and keep all skips
   and unexecuted cases distinct from passes. Production SMTP remains unconfigured;
   local SMTP acceptance is not evidence of live email delivery.

The broader optimization goal remains active. Skill discovery/remaining high-value
UX work is still tracked separately. No production backup, image or service has
been changed in this support batch.

## Core request UI checkpoint

Implemented Help simplification, personal/admin inboxes, status/type filtering,
message pagination, create/reply/withdraw/approve/decline/resolve/request-info,
actual effective limits and override reset. Markdown composition includes preview
and undo/redo. Diagnostics stay unchecked and collapse in persisted history.
Mail failure/retry status is separate from station persistence, with author-scoped
`can_retry_mail` capability. A single authenticated notification-link handler avoids
duplicating dialogs across responsive sidebars.

Protected, ordered Dexie draft writes include exact in-flight payload/key recovery,
concurrent-tab detection, expiry fencing and pending signout/export integration.
Read-only terminal requests retain access to an unsent draft for copying/deletion.
Late draft writes keep the original account epoch even after asynchronous failure.
Added a direct dependency on the already-resolved `@codemirror/commands` 6.10.4;
unrelated pnpm libc metadata rewrites were removed from the lockfile diff.

Verification chronology (overlapping suites, not additive):

- Two production Web builds and lint/typecheck passed before the final additional
  mounted-editor account-epoch fence; a fresh final build/browser check follows it.
- Backend/real PostgreSQL regression: 18 passed / 1 failed because the unavailable-
  mail fixture inherited the browser SMTP configuration. The fixture now explicitly
  declares unavailable SMTP. Corrected request regression: 13 passed. The other six
  real PostgreSQL/archive cases had passed and no corresponding code changed.
- Browser setup initially could not find its bundled executable, then reached a
  mismatched test origin. Existing wkkk Chromium and PUBLIC_WEB_BASE_URL/CORS_ORIGINS
  were selected; no download, global setting or production configuration changed.
- Initial UI runs found test locator assumptions (nested-label helper text,
  hydration timing and the existing confirmation dialog role). After correction,
  three-width create/response-loss replay/approval/effective-limit/mail-link cases
  passed; the offline/concurrent-draft/signout case also passed.
- Expanded 11-case run: 10 passed / 1 test locator conflict with Next's route
  announcer. Scoping the request error to its panel fixed that assertion. The next
  run passed all five support scenarios, including override reset, reply conflict
  preservation and cross-account denied reads after expiry. One preexisting Help
  account-switch scenario instead raced an old private reconnect check with the
  next account's out-of-band registration. It now navigates through login before
  fixture cookie replacement, matching the actual sign-in workflow.
- Screenshots at 375/768/1440 were reviewed; attached diagnostics were then made
  collapsible to keep replies readable. All screenshots contain synthetic content.

The earlier statement that no test services remained live describes the backend
checkpoint. The UI batch uses an isolated database `support_browser_20261005` on
the task-owned loopback PostgreSQL 55947, API 8127, SMTP 8327 and Web 3107. Final
shutdown/evidence is recorded below; do not treat them as production services.

Final UI checkpoint: the final source passed a fresh production Web build,
lint/typecheck and single Alembic head `20261005_0047`. The consolidated browser
run passed **11/11** (no skips): all five support scenarios and six Help/runtime
scenarios, including both interface languages/themes and 375/768/1440 widths.
The supported flows verify real PostgreSQL results and local drafts, not mocked
success responses. A response is deliberately lost only after the real server
commits it, then replay is checked for a single persisted request/message.
Final screenshots were inspected after diagnostics were collapsed.

Evidence under the task directory: `web-build-ui-final.log`, `lint-ui-final.log`,
`typecheck-ui-final2.log`, `browser-support-final.log`, `api-ui-r11.log`,
`api-ui-r12.log`, and `browser-screenshots/`. Earlier failed runs remain separately
recorded. API, worker, local SMTP, Web and the task-owned PostgreSQL were stopped
after the final checks; temporary files remain for the user's later cleanup.
Full API/PWA/settings/backup release gates and additional scenarios listed above
remain unexecuted for the combined support feature. No support commit/push/CI or
production replacement is claimed by this checkpoint.

Existing-token release verification was repeated through the local credential
wrapper without printing a credential: Skill source `2863a00` still has five
successful CI jobs in run `37269234174`. Production remains healthy on `3f1d539`.
Server free space was 3,267,620 KiB, still below the staged release's ~5,278,167 KiB
preflight requirement. Backup hard-link deduplication remains unapproved; no
production backup/image/service mutation was made.

## Contextual limit and recovery checkpoint

Import and both global/project merge dialogs now show actual effective limits and
open the existing focused request/system-settings surface while retaining File
objects, merge title and order. Only numeric requests are prefilled; an existing
protected draft wins. Aggregate uploads ask for smaller batches; unsupported hard
limit increases route to a question. Returning refreshes limits without submitting
the original operation. A capability refresh must not dismiss an open composer.
Merge admission exposes `MERGE_MESSAGE_LIMIT` and creates no job on rejection;
the client refreshes counts/limits while preserving the operation.

Real browser interaction found a 768px project toolbar overlap: end-aligned actions
could scroll beneath the selection summary. Groups now wrap by available space,
with leading-edge overflow. Merge order also has 44px handles and explicit up/down
buttons. Quiet borders and the mobile import command's icon/text alignment were
corrected after inspecting synthetic screenshots. Request warning borders now use
the actual theme token; an empty account name no longer adds a leading separator.

Verification chronology:

- The request/archive/real PostgreSQL/merge batch passed **30 tests**, including
  a stable merge limit error and no queued job after rejected admission.
- Initial contextual browser run: three failures. Mobile Import needed the real
  sidebar opening step; the rapid drag-key sequence did not reorder; the project
  toolbar intercepted the merge click. The actual toolbar was fixed and explicit
  keyboard-operable order controls added. The next run passed both merge flows,
  with only the test's pluralized adaptive-import endpoint still wrong. Correcting
  that endpoint yielded **14/14** across contextual requests, Help and core support.
- Additional checks cover draft precedence, concurrent limit change, pagination,
  a failed IndexedDB write, exact exported draft bytes and capability refresh while
  a request remains open. Their final results are recorded below after execution.
- Production builds, lint/typecheck and single local head/current `0047` passed.
  An intermediate rebuild caught a new test's access to an `unknown` value; the
  assertion was corrected to compare the typed object shape before rebuilding.
- Full API uses a separate disposable database `support_full_contextual_20261005`,
  with its own storage directories. Authenticated settings/browser cases use the
  existing isolated browser database. Neither shares production or user imports.

Logs/screenshots remain under the named support task directory. Current gate logs
are `api-contextual.log`, `api-full-contextual.log`, `browser-contextual-r1.log`
through `browser-contextual-r3.log`, `browser-settings-full.log` and the
`web-build-contextual*`/`lint-contextual*`/`typecheck-contextual*` files. Failed
attempts are retained; overlapping suite counts are not added together.

The existing-credential CI query again confirmed the five successful Skill release
jobs. Production remained healthy and space was **3,266,836 KiB**, still below
the staged artifact's capacity threshold. Backup deduplication remains unapproved;
this checkpoint does not claim a new deployment or cleanup.

The full API run completed with **901 passed / 4 skipped** in the disposable
PostgreSQL/storage environment. Three skips require unprovided external import
fixtures; one requires Windows symlink creation unavailable in this environment.
The request, archive, real PostgreSQL, Reader, Share, import and migration tests
are included; skipped scenarios are not passes. No API failure occurred.

The complete authenticated settings matrix initially finished **135 passed /
1 failed**. The newly added pagination scenario passed actual request/reply pages
and return position, then failed to identify its state select by an exact label.
Explicit localized accessible names were added to both filters. A focused run
then passed this case but exposed a test assumption about focus refresh: the app
disabled it globally. Import/merge capabilities now explicitly refresh when the
page becomes visible again, without dismissing an open request or submitting work.
The synthetic visibility event was aligned with the query library's window event.

Final focused browser rerun: **16/16 passed, no skips**. It includes the corrected
pagination case, actual concurrent grant/revocation and merge result, visibility
refresh without closing the request, original-file retention/focus, IndexedDB
failure recovery, draft precedence, exact pending-export bytes, lost-response
idempotency and account expiry/isolation. The latest production build and lint
pass. This does not rewrite the earlier 135/1 matrix result into an all-pass run.

The baseline PWA setup first reused an auth-enabled Web against the auth-disabled
fixture and was stopped. Subsequent fixture lifecycle attempts were interrupted
while separating automatic Web startup from API/worker ownership; cancellation
had also stopped the API child process. These are failed/interrupted environment
attempts, not passed functional gates. A fresh API/worker lifetime and Playwright-
owned Web lifecycle were started for the corrected baseline; see final result.

The fourth baseline attempt reached **132 passed / 3 failed / 275 skipped /
3 not run**: leftover synthetic authentication test variables selected the
auth-only gate against the deliberately auth-disabled API, and also made the
two Markdown-copy cases attempt login. Those variables were removed from the
baseline process. No application assertion or skip condition was changed; the
standard baseline was rerun with its intended environment.

Corrected baseline: **134 passed / 279 opt-in skips**, no failures. This includes
Reader/Share Markdown-copy behavior and the shared selection toolbar. Optional
authentication/offline-negative/Context/restore modes require their own release
gates; their skipped entries do not count as passing. Final screenshots at
375/768/1440 were inspected; the input button stays on one row and merge borders
use the existing quiet theme token.

Final evidence: `api-full-contextual.log`, `browser-contextual-acceptance.log`,
`browser-settings-full.log`, `pwa-contextual-r5.log`, latest
`web-build-contextual-acceptance2.log`, `lint-contextual-acceptance.log` and
`typecheck-contextual-checkpoint.log`. The final build also ran TypeScript.
All task-owned API/worker/SMTP/Web/PostgreSQL processes were stopped. Synthetic
databases, logs and other local residues remain in the task directory for later
user cleanup. No production configuration, backups or images were changed.
