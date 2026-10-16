# Support Requests capability-read lifecycle audit

- Date: 2026-10-15
- Scope: `apps/web/components/support-requests-panel.tsx` capability bootstrap only
- Evidence basis: current source inspection; no service, browser, login, or production run
- Pre-edit SHA-256: `874C9BD94FDF8BAFF92907D8C026A180DA322B89B9D8371111DC5A0AA685B24D`
- Post-edit SHA-256: `6376E0C34CEFC8C5539973EBD110671772D7D4762CF08DC08CECB064B8922F93`

## User-facing path

An authenticated user opens Settings → Help/Support requests. The panel reads
account capabilities before choosing the personal or administrator inbox and
before exposing request actions. When the online read fails, the existing
offline fallback may use cached help information. The visible recovery action
is a capability-only **Retry**; it must not submit a request or alter drafts.

## Evidence and findings

### SUPPORT-CAP-STATE-01 — retry responses are not latest-request fenced

Evidence: lines 54–59 create one `AbortController` per `capAttempt`, but the
callbacks only test `controller.signal.aborted`. A retry aborts the previous
controller but does not carry a mounted/latest sequence. If an older response
has already resolved or a mocked/transport layer does not honor abort
immediately, it can publish `caps`, `role`, or `capError` after the newer retry.

User impact: the panel can temporarily show the wrong inbox mode or hide/show
administrator-only actions based on an older attempt. This is a read-only
capability issue, but it changes what ordinary users see and which controls are
available.

### SUPPORT-CAP-AUTH-02 — capability state has no explicit authentication epoch

Evidence: the panel imports `authenticationGeneration()` for support resources,
but the capability effect at lines 54–59 does not capture or compare the
authentication generation. Its offline ticket protects the existing offline
access boundary, not component lifetime or the latest capability attempt.

User impact: a late capability result from the previous account/session can
remain eligible to update the mounted panel during an account transition unless
the surrounding settings surface unmounts quickly enough.

### SUPPORT-CAP-RECOVERY-03 — cached fallback can outlive the retry that caused it

Evidence: after the online capability read fails, the effect awaits
`readCachedHelpInfo()` and then applies the cached role when offline. That
secondary read has no latest-attempt check; its completion can race a newer
retry. The current source also keeps the previously confirmed role while a new
attempt is pending.

User impact: a user who retries after a transient failure can see a delayed
offline role or stale previous role determine the support surface, making the
result feel nondeterministic. Cached-role fallback semantics should remain, but
only for the current mounted attempt.

## Planned bounded repair

Add mounted, authentication-generation, latest-attempt, and controller fences
around the capability read and cached fallback. Abort the previous capability
read when retrying, clear unconfirmed capability state while the current read
is pending, and keep the existing offline ticket, cached-role fallback, retry
copy, inbox permission checks, drafts, API contract, and support request data
unchanged.

Implemented in `apps/web/components/support-requests-panel.tsx`: the panel now
owns one capability controller and sequence, retires it on unmount/retry,
captures the authentication generation, and checks the same admission boundary
before publishing online or cached results. A capability retry clears the
previously unconfirmed role and capability snapshot while it reads.

## Acceptance boundary

- No capability response or cached fallback from an old attempt can publish
  after a newer attempt, account epoch, or unmount.
- Retry remains read-only and does not submit a request or delete a draft.
- Offline cached role is still usable only under the existing offline access
  checks.
- No API, schema, URL, Share, `.cr`, offline-package, or persistence change.
- Source-only verification is limited to diff whitespace checking; browser,
  API, build, CI, and production acceptance remain pending.
