# Context package upload recovery — 2026-10-13

## Scope

This record covers the report that a small `.context.zip` succeeds while a larger
package can make the page show a server error for several minutes before the
`current` and `index` files appear updated. This is a local repair after the
accepted `84988a2` deployment. No CI run or deployment was started for this
record.

## Evidence

The Context return endpoint is intentionally synchronous until it has staged the
complete multipart file. `LocalAssetStore.stage` copies the package to the
quarantine area, hashes it in bounded chunks, flushes it and calls `fsync`; only
then does the endpoint promote it and return `202`. The worker reads the stored
package once more for integrity verification and then extracts only
`continuation/current.md` and `continuation/index.json`. This explains why a
larger package keeps the browser in an upload/polling state longer, but it does
not explain a three-minute application outage by itself.

The production route is handled directly by the host Nginx Context upload
location, with request buffering disabled and a 520 MiB gateway limit. The
read-only production logs for the reported activity showed two successful
`202` uploads (about 9.9 seconds and 5.4 seconds); their worker jobs committed
in about 1.45 seconds and 0.27 seconds. API health stayed `200`, and API,
worker, and Web containers had no restart or OOM event.

The matching Web logs contain repeated `getaddrinfo EAI_AGAIN api` failures
while Next was proxying task, conversation and continuation reads. The Web
container uses `API_INTERNAL_URL=http://api:8000`, so these failures came from a
transient Docker embedded-DNS lookup failure in the status/read path. The task
could already be accepted and committed while the page was unable to read its
status. A larger upload makes this more visible because the user remains on the
progress surface longer and sees more polling attempts. The logs do not support
claiming that ZIP parsing itself took three minutes.

## Local repair

- `ContinuationPanel` retries state, history and task reads with bounded
  backoff. A temporary read failure with cached data now keeps the last coherent
  content and uses a quiet recovery status instead of an error alert.
- The Context task status explicitly says that the upload task continues in the
  background while its progress read is retrying. Terminal task states still
  stop polling normally.
- The global task monitor uses the same retry and stale-data behavior, so a
  transient `/api/tasks/active` proxy failure does not turn an existing task
  into a false server-error banner.
- The shipped Nginx source now routes the general same-origin `/api/` prefix to
  the host-loopback FastAPI port. Existing exact/regex upload locations remain
  more specific and retain their larger limits. This removes the avoidable
  browser-to-Web-to-Docker-DNS hop for ordinary status reads when this local
  source is next released.
- The Context browser regression deliberately makes the first task read return
  `502`, then verifies that the panel recovers and continues the package update.

## Verification

- Focused Web ESLint: passed for the two components and the Context browser spec.
- Non-incremental Web TypeScript check: passed.
- Playwright discovery: two Context cases found; live browser execution was not
  started locally.
- `git diff --check`: passed.
- Existing `apps/web/tsconfig.tsbuildinfo` remained at its recorded SHA-256.
- No API, database, migration, production environment, volume, CI, or deploy
  state was changed.

## Follow-up boundary

The product repair is local and uncommitted. A later explicitly authorized
release can verify it in exact-source CI and deploy it. The current production
container network remains unchanged until then; the source-level loopback route
removes the avoidable Web-to-Docker-DNS dependency for the next release, while
the bounded client retries remain a fallback for other transient gateway errors.
