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

Status: **first full CI failed; narrow test correction, not deployed**.
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
