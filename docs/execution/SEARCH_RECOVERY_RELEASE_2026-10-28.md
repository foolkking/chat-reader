# Search and reader recovery release — 2026-10-28

## Authority and scope

The user authorized **submission and deployment** of the completed workspace
batch. This supersedes the implementation checkpoints' earlier no-submission
boundary, not their unverified results. Keep the changes together; do not start
another optimization cycle.

- Search correctness, exact destinations, scoped/offline recall, repeated
  activation and content-index lifecycle.
- Share expiry/copy recovery, account-scoped comment drafts, paginated search,
  TOCs, file references and conversation lists, and per-file upload recovery.
- The nine completeness follow-ups: delete intent, transactional rename
  derivation, ordering bounds/direction/priority, TOC append anchoring, bounded
  Office coordinates/relationships/shared strings and typed ZIP failures.
- Existing regression sources and corresponding implementation/audit records.
  Exclude the pre-existing `apps/web/tsconfig.tsbuildinfo`.

No migration, dependency change, production configuration change, canonical
rewrite, Share URL change, `.cr` change, offline package v1/v2/v3 change or
Dexie v2 change is included. Do not rescan/apply cleanup to user data.

## Validation and release gates

The inherited **no local tests, lint, typecheck, build, browser, services or
database** boundary remains. Static source/Git inspection is not a runtime
PASS. CI performs validation; no gate or assertion is weakened.

1. Commit/push the bounded batch, dispatch complete `Build release images` for
   its exact source, then wait **at least 50 minutes after every dispatch**
   before reading results. A new run starts a new wait.
2. Require all five jobs. Independently verify the official immutable artifact,
   source/run/attempt, archive digest, OCI chain, image identity, forbidden paths,
   embedded source and exact-source deployment support.
3. Freshly verify production identity, rollback, idle queues and capacity.
   Stop application writers only; resource-bound attachment integrity checks
   and a verified PostgreSQL/imports/exports/offline/assets backup precede
   application replacement.
4. Load verified CI images, check unchanged migration head/current, and
   recreate API/worker/Web with `--no-build --no-deps`.
5. Check exact images, health/worker freshness, HTTPS/denial/privacy boundaries,
   unchanged PostgreSQL/configuration, canonical aggregates, logs and OOM.
   On failure, restore the previous verified images without database downgrade.

Never build applications on the workstation or King, overwrite production
env/Compose/Nginx, restart PostgreSQL, delete user data/volumes, prune backups
or images, or run full diagnostics inside the serving API. The one explicitly
approved exact-list old-image cleanup is recorded below.

## Checkpoint

Source `51c26c3ba79eacaf614f8316f80996cb289b060f` was committed and pushed
as one batch: 98 files, excluding the pre-existing `apps/web/tsconfig.tsbuildinfo`.
Complete CI run `40631876492`, attempt 1, was dispatched for that exact source.
Its creation time is `2026-10-28T04:21:36Z`; a conservative dispatch upper
bound recorded after the metadata-index delay is `04:22:02.2168441Z`.
The run was first read at `05:12:07Z`, after the resulting
**05:12:02.2168441Z (13:12:02 Beijing)** result-read gate; its exact outcomes
and fixes are recorded below.

Fresh read-only host checks confirmed production/direct rollback
`b4effda`/`c7dc074` and healthy existing applications/PostgreSQL. Applications
have not been stopped or replaced. The preliminary capacity probe using the
current release archive refused: `3,547,948 KiB` available against
`4,013,203 KiB` required, before staging the new archive. Do not lower
headrooms or treat this old-archive probe as the new artifact's capacity PASS.
The user separately approved removing only the obsolete, unused application
images for `f3b331a`, `50f6de4` and `5992d0e`. The exact 12 API/worker/migrate/Web
references were rechecked against every container and both protected release
pointers, then removed without force or broad prune. Free space became
`4,446,956 KiB`; current/direct-rollback images were reverified present.
No release archive, backup, user data, volume or application container was
removed. A fresh exact-artifact capacity check is still required.
No application service has been stopped or replaced. CI rerun and production
acceptance remain pending.

### CI attempt 1 — failed and corrected

Run `40631876492` attempt 1 was first read at `05:12:07Z`, after its gate.
All three quality jobs failed, so image-build and artifact-inspection jobs
were correctly skipped; there was no deployable artifact.

- `web-quality`: lint found `prefer-const` in the comment-draft persistence
  queue. Replace the mutable declaration with a promise deferred through
  `Promise.resolve().then(...)`, preserving queue identity and retry behavior.
- `settings-quality`: its authenticated Web production build reached
  TypeScript and found implicit `any` on the TOC page callback. Type the
  callback result as the existing `TocResponse` contract.
- `api-quality`: 5,899 passed and 3 skipped; two parameterizations of the
  attachment-rename rollback test failed because the HTTP test client projects
  handler exceptions as a 500 response rather than re-raising them. Assert the
  500 boundary response and retain the before/after snapshot equality that
  proves name, search index and offline revision rollback.

These were the observed failure classes. The source and this record are
corrected without running local tests/builds or weakening CI. The correction
was committed and pushed as `db051dbfec5b72b782ce73de8dcb1602c89eba39`.
Complete CI run `40637231494`, attempt 1, was dispatched for that exact
source; metadata-only creation time is `2026-10-28T05:18:33Z`. The conservative
dispatch upper bound is `05:18:37.465063Z`; do not read any result before
`06:08:37.465063Z` (**14:08:37 Beijing**). This is a new 50-minute gate.

Fresh post-cleanup checks confirmed all 12 specifically approved old image
references are absent, both current `b4effda` and direct rollback `c7dc074`
image sets remain present, and Web/API/worker/PostgreSQL are still running
healthy with zero restarts. Free disk was `4,446,680 KiB` at that check. No
release archive has been staged and no application writer has been stopped.

### CI attempt 2 — failed; corrective pass in progress

Run `40637231494`, attempt 1, was first read at
`2026-10-28T06:09:24.6908441Z` (**14:09:24 Beijing**), after its
`06:08:37.465063Z` result-read gate. `api-quality` passed, but
`web-quality` and `settings-quality` failed; the image and artifact jobs were
skipped, so this run produced no deployable artifact.

The failures split into implementation/test-contract issues, not a reason to
weaken the release gates:

- Keep uncertain-deletion comment drafts as explicit orphan recovery copies.
  The old assertion incorrectly expected an authoritative absence check to
  erase unsaved text; the test is being strengthened to require read-only
  orphan display and explicit discard.
- Keep message-only search fallback when canonical `matches` are absent.
  A snippet is not a verified range, so it must not create a character offset,
  end offset or quote highlight.
- Fix the offline scoped-search completeness bug without FlexSearch tag
  intersection: query with a positive corpus bound, filter conversation/type/
  role against the document map, then expose only the bounded page lookahead.
- Synchronize static harnesses with `useInfiniteQuery`, page parameters,
  `prefetchInfiniteQuery`, and the no-placeholder paginated TOC contract.
  Restore the worker startup helper dependency in the isolated viewer harness,
  update the archive truncation assertion, and make the settings E2E setup
  test the default focus preference before exercising annotations.

These corrections were committed and pushed as
`eae099b1b61b8fc99e2ed21893a0fa6fe053271e`. Static inspection confirms the
worker asks FlexSearch for at most the positive indexed-document corpus size,
filters scope before the exposed lookahead/page window, and retains the
bounded exactness contract; the added tests cover targets beyond 100/200
unrelated/title hits and all four pages across 151 scoped matches. Reader list,
search, prefetch, and TOC fixtures now model the production infinite-query
contracts. The settings run's exact failure was the first `Exit focus mode`
expectation at line 146 while navigating with `?annotations=open`; that
explicit deep link intentionally disables focus mode. The setup now navigates
without the override so it tests the saved default before opening Annotations.

No local runtime checks were run. A documentation-only closeout correction
updates the current checkpoint before dispatching the next complete
exact-source CI; that new run must pass its own 50-minute result-read gate.
Production remains `b4effda` with direct rollback `c7dc074`; no writer was
stopped and no production data/configuration was changed.

Implementation evidence and remaining verification boundaries:

- [Search correctness](SEARCH_CORRECTNESS_2026-10-27.md),
  [offline recall](SEARCH_RECALL_OFFLINE_2026-10-27.md) and
  [lifecycle](SEARCH_LIFECYCLE_2026-10-27.md).
- [Reader recovery](UX_AUDIT_OPTIMIZATION_2026-10-28.md) and
  [completeness follow-ups](UX_AUDIT_COMPLETENESS_IMPLEMENTATION_2026-10-28.md).
- [Verification matrix](../testing.md). Same-runtime failed-delete intent is
  not durable through forced reload/crash; bounded Office previews are not
  full fidelity or malicious-document certification. Authenticated production
  UI, physical clipboard and sustained-load acceptance are not implied by CI.
