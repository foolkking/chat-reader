# Authentication and account contract

## Current implementation (working tree, 2026-09-01)

The next release upgrades the legacy single owner into one `ADMIN` account and
adds account-scoped `USER` accounts. Migration `20260901_0030` backfills the
legacy owner and private rows; it is present in the repository but has not been
applied to the operator database in this session.

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
