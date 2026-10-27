# Reviewed noise corrections release — 2026-10-27

## Authority and scope

The user authorized **submission and deployment** after the completed local
review fixes. Release the reviewed batch as one unit, not a new optimization
cycle. Do not use web search or operate the GitHub website; use existing local
credentials and API/CLI. Exclude the pre-existing `apps/web/tsconfig.tsbuildinfo`.

- Retain bounded/interleaved trial sampling and the reviewed code, containers,
  references, links, URLs, tables and explanatory-text boundary corrections.
- Correct dollar-math ownership/scope, link-title delimiter ownership, literal
  HTML fallback protection and conservative supported-rich-layout handling.
- Preserve Unicode source-envelope mapping; the independently costly monotonic
  provenance fast path remains withdrawn.
- Keep all 41 immutable action references in the two workflows; SHA-aware source
  contracts verify actual checkout/start order and the Docker build driver.
- No migration, dependency upgrade, canonical rewrite, Share URL, `.cr`, offline
  package, Dexie or reading-position change. No batch apply/rescan of user data.

Implementation and historical attempts remain in the
[review record](ux-audit-noise-matching-2026-10-25.md#37-review-fixes-and-application-renderer-contract--2026-10-27)
and [completed local receipt](ux-audit-noise-matching-2026-10-25-evidence/review-fixes-completed-2026-10-27.json).
The receipt's source hashes describe captured local bytes, including mixed
Windows line endings; CI and image identity must instead match exact committed
Git source. Evidence receipts retain their original bytes without normalization.

## Local validation before submission

Completed scoped checks: 16 API modules, **4,212 passed / one Windows symlink
skip** (not the full API suite); 75 UX/source/SSR files, **1,641 passed**;
58 CI-source checks passed; lint and nonincremental Web typecheck passed.
The 26 shared real-renderer/API synthetic sources cover LF and CRLF, with
normal/legacy scan-preview-apply and forged-delete safety checks.
Prior memory/disk interruptions remain recorded, not counted as passes.
No authenticated production UI, sustained load or real-user precision-rate
acceptance is claimed.

The eight unique upstream action tag/commit pairs were independently checked
through the GitHub API before submission and all matched their 40-character
pins. This does not substitute for executing the complete workflow.

## Release gates and current checkpoint

Status: **CI-only keyboard-focus repair passed CI and was deployed/accepted**.
Source **`f83ce40b04bd446918ba764787a03a1ccebbc88d`**, full workflow
**`40446169506`**, attempt 1. Dispatch completed at **03:48:00 UTC /
11:48:00 +08:00**; the first result read must be no earlier than
**2026-10-27 04:38:00 UTC / 12:38:00 +08:00**.
Only source/run/attempt/creation metadata was retrieved before that gate,
not job results. The first result read was **04:38:05 UTC / 12:38:05 +08:00**.
API and Web passed. Settings completed **462 browser cases / one failure**:
the English annotation-deletion recovery case clicked before the independent
notebook reads were ready. Its trace shows the final notebook response completing
after the delete click began; the application correctly withheld confirmation
and showed the restore-notebook notice. No annotation write occurred.
Image building/inspection were skipped; no deployable artifact or deployment.

The correction is test-only: hold the notebook GET, explicitly visit Notes and
await the existing editor's `data-notebook-save-ready=true`, then run the
unchanged two-item partial-delete/recovery assertions. No sleep, retry, timeout
increase, weakened assertion or product/readiness-guard change. Both locales
exercise the held read. A new complete CI and fresh 50-minute gate are required.

Previously accepted production is
`c7dc0749e3ba18394cb0a37b8d66e9f01837c5a8`, direct rollback `3fbf79d`,
schema `20261022_0053`; these must be freshly checked before deployment.
An initial read-only host check at 03:48:53 UTC confirmed those release
pointers, healthy API/Web/PostgreSQL and a running worker. No services changed.

The initial capacity probe had only about 5 MiB above the old archive's
conservative requirement, before staging this release. The user separately
approved deleting **only two named old image-transfer archives**:
`8ca8e90` and `cfaa6ed`. At **04:00:18 UTC / 12:00:18 +08:00**, exact path,
non-symlink, size, hash and source-manifest checks preceded their deletion.
Removed file bytes total **364,619,667 (about 348 MiB)**; available disk became
4,366,128 KiB. Docker image IDs and current/direct-rollback transfer archives
were unchanged; no backup, volume, user data or configuration was touched.
This does not authorize any further cleanup or waive the fresh staged-artifact
capacity gate.

### Complete rerun

The test-only correction passed local lint, nonincremental typecheck and
collection of all eight original scenarios, without changing their skip policy.
Source **`0c5f0334dd9af87b4ce4e9883cf2bd1250a11ffc`** was committed/pushed;
complete CI **`40451679590`**, attempt 1, was dispatched at
**04:47:33 UTC / 12:47:33 +08:00**. Its independent 50-minute read boundary is
**2026-10-27 05:37:33 UTC / 13:37:33 +08:00** (the reader adds two seconds).
The first run's failed result/evidence remains preserved. Production has not
been stopped or replaced. An initial SSH push failed without updating remote
source; the HTTPS credential-helper push then succeeded before dispatch.

The result was first read at **05:37:39 UTC / 13:37:39 +08:00**, after the
gate. API and settings quality passed. Web lint, typecheck, production build,
dependency/source contracts, ordinary-user recovery regressions, and the
dedicated **Source Editor content cleanup browser gate** all passed. The
default PWA baseline then failed only
`task-center-dismissal.spec.ts:176` (“retry keeps keyboard focus on the moving
task”): after the synthetic task moved from Failed to In progress, focus was
not on its row. It is outside the noise changes and their changed paths; the
noise-specific release gates completed before this baseline failure. The
single-owner authentication and negative-PWA gates, artifact inspection, and
image build were consequently skipped. This is a real required CI failure,
not a passing or deployable run. No scope was changed and no retry, commit,
push, artifact deployment or production action followed.

### CI-only focus repair

After that stopped checkpoint, the user explicitly requested debugging CI to
completion **without local execution**. From this instruction onward, no local
tests, build, browser, API or worker are run. Source reading/editing and Git/
GitHub CLI operations are used; CI owns all validation.

The failed trace confirms an accepted retry and the new In progress row, with
the row remaining unfocused for the full assertion timeout. The old restoration
was a single `requestAnimationFrame` scheduled by mutation success. Source
inspection identifies a scheduling race: the query notification's React commit
can occur after that frame, while the old focused element is still connected.
The repair tracks the actual focused task-row element and restores only after
its DOM removal in the existing layout effect. A real focus move to another
control retires restoration, including moves outside the monitor; authentication
generation, monitor membership and body-only lost-focus checks remain required.
No timers, mutation retries, forced focus on success or global focus policy
changes are introduced. Retry/cancel requests and their cache ownership guards
are unchanged.

The original failing assertion remains. Four added browser scenarios hold the
retry/cancel response while checking disabled actions, then require either focus
on the relocated row or preservation of deliberately focused dialog Close.
Each also requires exactly one mutation request. No timeout increase, sleep,
skip, weaker assertion, workflow or release-gate change is made.
At that checkpoint the checks were unverified and no image or production
operation had occurred; the completed results are recorded below.

1. Commit/push only this reviewed batch, then dispatch full `Build release images`
   for the exact source. After **each** dispatch, wait at least **50 minutes**
   before reading its result; failed reruns start a new wait.
2. Require all five jobs and independently verify the official immutable
   artifact's source/run/attempt, archive, OCI chain, image configs/layers,
   embedded source and exact-source deployment support.
3. Read-only production identity/config/queue/capacity/rollback preflight; stop
   only application writers, verify attachment storage with resource bounds,
   create and validate a fresh PostgreSQL/imports/exports/offline/assets backup.
4. Load only verified CI images; check migration head/current without upgrade
   when unchanged; replace API/worker/Web using `--no-build --no-deps`.
5. Verify exact images, health/worker freshness, HTTPS/denial/privacy boundaries,
   unchanged PostgreSQL/config, canonical aggregates, logs and OOM counters.
   On failure, restore verified previous images without database downgrade.

Never build application images on King or the workstation, overwrite production
env/Compose/Nginx, restart PostgreSQL, delete user imports/volumes, prune backups
or images, or run full diagnostics inside the serving API.
Record exact CI, verification, backup and acceptance facts here as they occur.

### Complete CI, artifact and production acceptance

The repaired exact source
`b4effda45c74b0295823736a7da5db70265f57dd` was pushed to `master` and passed
all five required jobs in `Build release images`, workflow run
`40463956431`, attempt 1:
`api-quality`, `web-quality`, `settings-quality`, `build-images` and
`inspect-release-artifact`. The dispatch completed at
`2026-10-27 06:55:06Z`; the first result read was
`2026-10-27 07:45:12Z`, after the required 50-minute boundary
`2026-10-27 07:45:06Z`.

The deployable artifact is GitHub artifact `12717900348`,
`chat-reader-images-b4effda45c74b0295823736a7da5db70265f57dd-1`.
Its ZIP digest is
`sha256:d8e515f6a3adfe2efcf232b2345c711978df481d60580c7ffe379c0dda7c3c6f`,
and the extracted OCI archive digest is
`d03e1824cb1c3cae1e6ef6fbd875c1780e18b2552009cc6ca5be3f52580b2313`.
The source/run/attempt, OCI descriptor and config/layer chains, embedded
source, Linux/amd64 image metadata and forbidden-path checks passed:
35 blobs, 23 layers, 21,339 layer entries and 336 embedded API source files
were independently checked. The current CI artifact contract does not require
the stale `match_modes` bundle marker used by an older local audit copy; the
repository CI inspector and current release verifier were used instead.

Remote staged-artifact capacity preflight passed with 4,175,048 KiB available
against 4,013,187 KiB required. The production baseline remained
`c7dc0749e3ba18394cb0a37b8d66e9f01837c5a8`, direct rollback remained
`3fbf79dd0f1da2906ff32d202dfa85cb8544c612`, and the schema was
`20261022_0053`. Application writers were stopped from
`2026-10-27 07:57:17Z` to `2026-10-27 08:06:17Z`; PostgreSQL stayed running.
The fresh verified five-component backup is
`/opt/chat-reader/backups/chat-reader-20261027T075731Z`. Its read-only
attachment audit was complete and clean: 337 active attachments, 356 asset
objects/files, and 356 SHA-256 verifications.

No migration was applied: head/current remained `20261022_0053`, and canonical
row counts were unchanged. The application was recreated with
`--no-build --no-deps`; runtime acceptance passed at
`2026-10-27 08:06:17Z` (`16:06:17 +08:00`). API/Web/worker run the exact
`b4effda` images and are healthy/fresh. HTTPS health/login, HTTP-to-HTTPS
redirect, authentication/denial and public-image privacy checks passed;
startup logs had zero error-keyword lines, PostgreSQL/config/Compose/Nginx
hashes were unchanged, and no new kernel or host OOM was observed.
Current/direct rollback pointers are now `b4effda`/`c7dc074`. No production
build, configuration or Nginx write, user-data/volume deletion, backup/image
pruning or database downgrade occurred. Authenticated browser acceptance,
physical clipboard behavior and sustained load remain unclaimed.
