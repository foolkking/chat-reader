# Authentication and account contract

Invitation lookup/consumption and administrator revocation now serialize on the
invitation row. Both INVITE_ONLY and OPEN registration consume an explicitly
supplied invitation once; invalid, expired, used or revoked supplied tokens are
rejected before account creation. Open registration without a token is unchanged.
Authenticated writes to legacy subject-key personal tables recheck the account
under a shared row lock, so stale requests cannot recreate private records after
disable/deletion. Details and cleanup recovery are in
[Administration Contract](ADMINISTRATION_CONTRACT.md).

Public login/registration/verification pages follow the device color scheme,
without reading an unbound legacy account preference cache. Authenticated
appearance continues to use account-scoped preference revisions.
An already retained locked account remains in the sign-in-required state when
the session transport fails even if the browser reports it is online. A network
transition during session verification retries the offline eligibility check;
it does not grant new authorization or discard data.

## Regular-account email change (working tree, 2026-10-01)

Account & security offers a new address plus the current password for USER
accounts. The server checks the password, normalizes and checks the address,
then issues an EMAIL_CHANGE grant in the existing verification table. SMTP
configuration is required; no new environment variable or migration is needed.
ADMIN email remains deployment-managed. The old address stays active until an
explicit confirmation; sending, viewing and resending do not change it.

The 30-minute, single-use grant stores only a digest and binds the user UUID,
target address, purpose and credential version. The URL uses
`/verify-email#purpose=email-change&token=...`, keeping the grant out of page
requests/referrers. Preview and confirmation require a valid session for the
same regular account. A signed-out recipient can sign in to the original
account in another tab and recheck the page. Opening/reloading the page never
consumes a grant. Resend verifies the password again and revokes prior grants;
cancel revokes the pending request. GET exposes only that account's current
unexpired pending address and mail-configuration availability.

Confirmation locks user, principal and current session in that order, rechecks
eligibility and grant validity, and updates email/verification time while
preserving UUID, ownership and the current opaque session token. User/principal
credential versions and the current session advance together. Other sessions
and outstanding password-reset/email grants are revoked in the same transaction.
The unique address constraint resolves competing confirmations with rollback;
failed attempts preserve both the original address and unconsumed grant.
Password change and password-reset consumption now follow the same user-first
lock order; reset consumption rechecks the grant after acquiring its lock.

Account/IP throttles reuse the existing auth limiter (5 per subject/IP and 20
per IP per hour for issuance). Preview and confirmation are also bounded. All
mutations retain same-origin checks and no-store responses. Delivery failures
leave the original address usable and permit retry; neither mail content nor
addresses/tokens enter diagnostic events. A lost confirmation response can be
reported as recovered success only after a fresh session read proves the
previously previewed UUID and target email. No local signout cleanup runs:
account-local offline copies, drafts and pending operations retain their owner.

Verification: `test_email_change.py`, `test_email_change_postgres.py`, and
`settings-email-change.spec.ts`. The browser suite uses real SMTP/PG flows,
includes offline reload and separately identifies the injected request/lost
response recovery case. Existing registration verification remains covered by
`settings-registration.spec.ts`. Complete run evidence is in the dated settings
execution record. The code is deployed as `ad223cd` on 2026-10-02; production
SMTP is unconfigured, so email delivery remains unavailable there.

## Explicit signout cleanup (2026-10-01 working tree)

Logout/password-change session revocation and local physical deletion are
separate outcomes. After successful revocation, failed/blocked database or
cache deletion locks the private boundary and exposes retry, preserving an
account-scoped cleanup record. The login page resumes durable cleanup. A same
account bind must complete pending deletion before reopening its store;
completion markers prevent stale tabs from deleting a later session's data.
When browser storage cannot inspect pending edits, logout requires an explicit
discard choice. Memory-only recovery remains on the current page if all browser
persistence fails. Details and recovery limitations are in the PWA resilience
contract. This does not change the expiry behavior: expiry/rejection retains
data for reauthentication and does not create a destructive cleanup request.

## Offline lock retention (working tree, 2026-10-01)

Expiration and private API 401 handling now lock and retain account-local data;
they no longer invoke the destructive logout cleanup. A runtime generation
fences ongoing IndexedDB, attachment, search, export and sync work. A persisted
per-account lock prevents a stale lease from unlocking a rejected/expired
identity. Only a newly accepted server session for that UUID clears its lock;
multi-account responses without a valid UUID fail closed. Private query caches
are cleared on lock/account change. Late 401 responses from a previous runtime
generation cannot invalidate a newly verified account, and locking an old tab
does not erase another account's newly established shared lease.

Explicit logout and password changes now inspect account-local pending edits,
conflicts and notebook drafts first. Users can sync, export a readable recovery
ZIP, or explicitly discard. The final action verifies the reviewed snapshot
under the sync Web Lock and an account-specific write freeze; a changed snapshot
returns to review. Other tabs temporarily stop accepting UI edits while their
components remain mounted. Network failure releases the freeze and retains data;
logout can retry an already-invalidated session. Successful explicit signout
clears account-protected data and lets its caller settle dirty form state before
navigating. It does not trigger a competing local expiry redirect during cleanup.
Cross-tab lease removal still immediately locks the other tab's private runtime.
Storage formats remain unchanged. See
`PWA_OFFLINE_RESILIENCE_CONTRACT.md` for transaction/sync behavior and pending
stage-four work. Production remains on its prior release.

## Registration verification (working tree, migration 20260930_0034)

Each account records `approval_status` (APPROVED/PENDING/REJECTED) and the
registration-time `email_verification_required` snapshot. Login and existing
session authentication require ACTIVE status, APPROVED approval and a verified
email if required. Administrative enable does not bypass either requirement.
Disabling or rejecting an account prevents a verification grant from activating
it. Requirements only apply to new registrations; migration preserves existing
active accounts. Legacy PENDING accounts become approval-pending. Legacy
disabled accounts with a recorded approval review are conservatively retained
as rejected because the former schema cannot distinguish rejection from a
later disable after approval; they do not silently regain login access.

`PUT /api/admin/access/registration` changes only provided, non-null fields.
SMTP host and sender must be configured before enabling email verification.
The response and access overview report `smtp_configured` as configuration
presence, not an SMTP health assertion. Administrator password-reset grants
remain available without SMTP.

Registration creates no session while either requirement is outstanding.
Verification sends a 30-minute grant, stores only an HMAC token digest, and
binds purpose, target address, account and credential version. The mail URL is
`/verify-email#token=...`; fragments avoid page request/referrer logging. GET of
the confirmation endpoint is not supported. The public page never consumes on
load. `POST /api/auth/email-verification/confirm` consumes the grant; it does not
create a business session. `POST /api/auth/email-verification/request` requires
the registration email and password, revokes older outstanding grants and sends
a replacement. Delivery failure keeps the account pending and offers retry.
Invalid credentials and unavailable/expired grants do not reveal account data.
Both public mutations enforce same-origin and bounded subject/IP rate limits.
Resend, confirmation, approval and disable serialize on the user row; concurrent
confirmation can succeed once and approval cannot overwrite verified eligibility.

`GET /api/auth/capabilities` is authenticated and reports account role, feature
policy, effective import limit (minimum of deployment and policy), merge limit,
and mail-configuration presence. It does not grant administrator API access.

Regression suites: `test_registration_verification.py` and the explicitly
enabled disposable-PostgreSQL `test_registration_verification_postgres.py`.
Browser SMTP/registration verification is in `settings-registration.spec.ts`;
its test mailbox is a fixture-only endpoint, absent from the application.

## Session recovery and browser persistence (deployed 2026-09-30)

The private Web boundary distinguishes session verification, an unavailable
authority, unavailable browser storage, and an expired offline lease. Auth
HTTP requests (including response bodies) have a 10-second deadline; private
initialization has a 15-second overall deadline and explicit retry/sign-in
actions. API failures never grant a new session. `reauth=1` keeps the recovery
sign-in form open even when the server still recognizes its cookie.

Successful login/registration navigates before local initialization. Online
use selects the verified user's Dexie namespace without requiring a database
open; unavailable browser persistence cannot turn an accepted password into
invalid credentials. Only the owner principal may claim a pre-account legacy
database. Existing legacy bindings and v1 package readability are preserved;
logout retains the binding so a failed deletion cannot expose it to another
account. The service worker starts only after private initialization (and is
excluded from public authentication and Share pages).

Overlapping verification is suppressed and abandoned checks cannot redirect
after navigation. Cross-tab identity changes hide the old account immediately.
An expiry timer rechecks trust at the last server-confirmed deadline, including
offline use. Logout removes the offline lease and presence marker immediately;
storage cleanup is attempted independently and navigation waits at most three
seconds for it. OS-downloaded files remain outside this boundary.

The API runs synchronous authentication database work in a worker thread so it
does not block the ASGI event loop. Sliding cookie renewal preserves explicit
route-level cookie deletion after a password change. Session lists exclude
expired and outdated credential versions; malformed login emails return the
same generic credential failure; password-reset availability honors the admin
policy as well as SMTP configuration. Orphaned regular-user principals cannot
fall back to legacy owner authority. No migration or session-cookie format
changes are required.

Regression ownership: `apps/api/tests/test_auth.py`,
`apps/web/e2e/auth-recovery.spec.ts`, `auth-gate.spec.ts`, and
`multi-account-auth-contract.spec.ts`. The CI auth gate provisions both a
synthetic email and password; missing email previously skipped its real browser
tests. Source `5877558070311d1728974198f37a4500d25233b1` is deployed to King.
The operator confirmed successful login and library entry after a forced
refresh; CI's 16 authentication browser tests and production health/anonymous
boundary checks passed. This confirms the reported stuck-login recovery;
it does not claim completion of the separate full authenticated desktop/mobile
and logout production checklist.

## Account model (implemented; introduced 2026-09-01)

The deployed account model upgrades the legacy single owner into one `ADMIN` account and
adds account-scoped `USER` accounts. Migration `20260901_0030` backfills the
legacy owner and private rows; it is already included in the production
migration chain, whose current head is `20260927_0033`.

- The operator provisions the only administrator with
  `python -m scripts.owner_auth provision --email <admin-email>` and enters a
  strong password interactively. The repository never contains the password.
- An authorized deployment sets `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the
  migration container. PostgreSQL stores only an HMAC-derived configuration
  digest alongside the Argon2id password hash. An unchanged pair is idempotent
  and does not overwrite a password changed in Account & security. Changing
  either deployment value causes the next migration run to synchronize the
  administrator and revoke prior sessions. Only the first temporary password
  may use the bounded six-character bootstrap exception; later changed
  passwords use the normal minimum-length policy.
- New users authenticate with normalized email plus password. Registration is
  controlled by `CLOSED`, `INVITE_ONLY` or `OPEN`; invitations are one-time and
  stored as digests. New registrations are `USER`, not administrators.
- Every private resource is filtered by the server-authenticated `User.id`.
  Share remains a separate token-scoped, read-only capability and Offline is a
  browser-local snapshot boundary.
- Sessions remain opaque HttpOnly cookies with 48-hour sliding inactivity,
  device independence, same-origin mutation checks and global revocation after
  password change. Password reset requires configured SMTP or an administrator
  generated reset grant.

The remaining sections below describe the original Release-N owner contract;
where they conflict, the current implementation above and the code are the
authority. Browser acceptance against the upgraded deployment is `NOT VERIFIED`.

Release N protects Chat Reader business content with one owner password and
server-side, per-device sessions. It deliberately establishes a `principal_id`
request context and an `AuthProvider` boundary, but it does not implement
accounts, registration, roles, tenants, email recovery, OAuth or other
multi-user features.

## Credential and session model

- The only principal is the non-editable logical owner, `owner`.
- The owner password is stored only as an Argon2id hash in `auth_principals`.
  It is provisioned or reset through `python -m scripts.owner_auth` in the API
  deployment environment, which reads the password from an interactive terminal
  and never prints it.
- A successful login creates a fresh opaque random session token. The browser
  receives it only in the `chat_reader_session` cookie (`HttpOnly`, `Path=/`,
  `SameSite=Lax`, and `Secure` in production). JavaScript, URLs, localStorage
  and sessionStorage never receive the token.
- PostgreSQL stores only an HMAC-SHA-256 token digest, the owner principal,
  credential version, creation time, last activity time and revocation time.
  The HMAC key is the deployment-only `AUTH_SESSION_SECRET` and is never stored
  in repository configuration or diagnostic output.
- Sessions expire at exactly 48 hours of server-side inactivity. Authenticated
  business requests refresh `last_activity_at` no more often than the configured
  5-15 minute activity-touch interval. Device activity is therefore independent:
  using one browser does not extend another browser's session.
- Logout revokes only the current session. Password changes increment the owner
  credential version and revoke every session, including the current device.
  The browser must then log in with the new password.

## Protection boundary

FastAPI applies a default-deny authentication middleware to every route except
the explicit infrastructure/auth allowlist: public health, login, session
status, logout, the separately protected loopback diagnostics route and the
token-scoped `/api/shared/{token}/*` capability surface. A missing, malformed,
expired, revoked or unverifiable owner cookie returns `401`; an authentication
database error returns a fail-closed `503`. Share APIs remain capability
authorized: a default Share is public-by-link, while an optional Share
password is verified separately and issues only a Share-scoped unlock cookie.
Owner application APIs, private attachment content, export downloads, offline
package downloads and import/job business APIs remain owner-session protected.

Unsafe browser requests require an exact same-origin `Origin` matching
`PUBLIC_WEB_BASE_URL`. This complements the session cookie's `SameSite=Lax`
setting and rejects cross-origin mutations. Authenticated and authentication
responses are non-cacheable. `/api/health` stays a coarse public infrastructure
endpoint; detailed diagnostics remains outside the browser password boundary and
is protected by the Release L SSH plus API-loopback operator boundary.

Next's proxy redirects a browser with no owner session cookie to `/login` for
private pages, while the exact `/share/{token}` page is an explicit public
exception. The API remains the authorization authority for all Share data and
resources. A Share capability token is never copied into a login
`return_to`; a successful owner login returns only a safe same-origin internal
destination.

## PWA and offline boundary

The offline shell and static login assets may remain cached. Business records in
Dexie and downloaded attachment bytes in the protected Cache Storage cache are
cleared on logout or when the browser learns that its session is invalid. An
offline browser may use local business data only while its last server-confirmed
session expiry is still in the future; it cannot establish or extend trust while
offline. A cached shell must therefore show the password/reconnect state rather
than reveal expired business data.

Files a user explicitly downloaded to the operating system are outside browser
session control and are not removed by logout.

## Configuration and recovery

Production startup is fail-closed: `AUTH_ENABLED=true`, a non-placeholder
`AUTH_SESSION_SECRET` of at least 32 characters, `AUTH_COOKIE_SECURE=true` and
an exact `AUTH_INACTIVITY_TIMEOUT_SECONDS=172800` are required. Development and
tests may explicitly set `AUTH_ENABLED=false`; production never falls back to
unauthenticated access.

Before an auth deployment, an operator must have both a verified owner-password
provisioning/reset path and the server's existing SSH operator access. Password
reset uses the same local CLI and revokes all sessions. The procedure never
places a password in shell history, logs, CI, documentation or Git.

Database backups may contain the Argon2id hash and revoked session metadata but
never plaintext credentials or `AUTH_SESSION_SECRET`. Disaster recovery must
provide a fresh recovery-only session secret before starting the recovered API;
this makes restored browser cookies unusable while retaining the owner password
hash for controlled re-provisioning.

## Verification

The automated matrix covers new-device gating, generic login failure, secure
cookie issuance, HMAC-only token persistence, exact inactivity boundary,
rate-limited sliding activity, device independence, logout/replay rejection,
global password-change invalidation, cross-origin mutation denial, Share and
artifact default protection, PWA cache clearing and fresh-secret restore safety.
Production acceptance additionally uses a disposable browser profile and no
sensitive test content.
