# Task Center clarity — 2026-10-06

**Delivered:** production source 25c7f6a, CI 37453812341 five gates passed.
Deployment, acceptance, backup retention and old-image cleanup are complete.
Earlier pending checkpoints below are historical; do not replay them.

## Scope and findings

The preceding attachment release f0e355a is already deployed and accepted; its
backup and cleanup must not be replayed. This stage addresses repeated export
results with indistinguishable labels, incorrect archive/publication phases,
terminal 100% bars, buried failures, and partial/cancelled results filed as complete.

## Implementation

- Preserve owner filtering, exact artifact delivery, retry/cancel and retention.
  Add nullable source/format metadata without a migration. Snapshot the first two
  batch source titles in one bounded query; retain original identity on replay.
- Quiet divided rows use existing theme tokens. Localized operation and format
  precede source, state and server submission time through seconds. Full errors
  remain readable; active progress has accessible values. Cancelled work is separate;
  failures and partial results precede successful results.
- Restore focus if a retry/cancel moves its focused row. Do not reintroduce a
  dismissed result from the temporary completion notification.

## Verification status

Source **5f5126cbfbc78a69b9d4c22e3f20afa3c2f3c2ea** is committed and pushed.
[CI 37448984796](https://github.com/foolkking/chat-reader/actions/runs/37448984796)
was dispatched once for that exact source. API quality and Web quality have
completed successfully. Settings integration finished with **169 passed / 1 failed**;
the existing 768px Chinese maintenance regeneration case lost the accepted new
job while a background continuation poll unmounted its download control. Image
gates were skipped, so this source has no deployable artifact. Do not rerun it
unchanged. Production was independently rechecked and remains
healthy on f0e355a, with 15,886,852,096 available server bytes.

- First changed-file lint and TypeScript check passed. After adding tests, lint
  passed; the Corepack typecheck wrapper reported ENOSPC while saving its cache
  despite exit zero. This second command is not counted as clean verification.
  Direct Node invocation of the same TypeScript compiler with no incremental
  output subsequently passed; six changed Python files parsed successfully.
- Added real persisted API read/retry/source snapshot/ownership assertions and
  rendered group/focus regressions. Added a PostgreSQL/worker browser flow for
  repeated exports at 375/768/1440, both locales/themes, exact downloads, CanJSON
  checksums, refresh and dismissal; all three new Task Center cases passed.
- Exact-source CI API: **1003 passed / 3 skipped**, including the new presentation
  and persisted source/owner assertions. Runtime/Bundle **64**, cleanup **53**.
  Web baseline **135 passed / 318 gated skips**, with the new rendered partial
  grouping/focus case explicitly passed. Context **35**, authentication **18**,
  offline negatives **17**, lint/typecheck/build and other required Web gates pass.
  Suites overlap; skipped settings tests in the baseline are not passes.
- C drive has zero free space. The requested batch-specific E-drive test exception
  has not been answered. Do not write local test temporary files there without it.
  CI is available for the full suites and browser screenshots.
- Production remains f0e355a. No deployment or cleanup in this stage yet.

## Follow-up fixes awaiting exact-source CI

- Keep immutable delivery mounted during same-generation background polling.
  Bind an accepted regeneration to its owner before global query invalidations,
  including after the child unmounts following an option change. Preserve the
  original captured options and recheck account generation before global events.
- Fence retry/cancel/dismiss and disappeared-task callbacks by authentication
  generation so late successes cannot repopulate another account's cache.
- Screenshot inspection found completed exports showing 2 / 1: PostgreSQL progress
  reports use a separate session while terminal code reused a stale in-memory
  message count. Commit both single-export counters as one package and omit
  redundant single-item terminal counts in the UI.
- Add real delayed-response/polling/option-change and same-document account-switch
  regressions, plus persisted PostgreSQL and browser counter assertions. These
  follow-up runtime tests have not yet run. Direct no-output TypeScript and
  changed-file ESLint both passed after the edits; no local build/runtime test is
  claimed because C-drive temporary capacity is exhausted.
- Three screenshots under `docs/evidence/task-center-2026-10-06/` came from the
  successful new cases in failed run 37448984796, artifact 11406718713. They are
  **intermediate, pre-counter-fix evidence**, not final release screenshots.

## Original release steps (completed below)

Commit/push the follow-ups, run all five CI gates on that new source, inspect final
browser evidence and fix actual failures. Release only the verified source using
fresh source-bound helpers and the live production baseline. Keep two verified
backups, protect production data/configuration/PostgreSQL, and remove only replaced
image tags after acceptance. Do not clean local files or build images locally/on
the server. The broad optimization goal remains active.

## Follow-up source / live CI checkpoint

Follow-ups are committed/pushed as **25c7f6a16f72780b08b22f1f3bf23665ebfd300c**.
[CI 37453812341](https://github.com/foolkking/chat-reader/actions/runs/37453812341)
was dispatched once for that exact source. API and Web gates passed: API **1003
passed / 3 skipped**, runtime **64**, cleanup **53**, single head/current **0048**;
Web lint/typecheck/build, Context **35**, authentication **18**, offline negatives
**17**, baseline PWA **135 passed / 321 gated skips** and the other required Web
checks passed. Suites overlap and skips are not passes. Settings/browser and image
gates are still pending at this checkpoint. No deployment has begun.

Release helpers are prepared in memory, checked against historical template hashes,
and rebound to source 25c7f6a / live f0e355a. Actual artifact identity, image/blob
checksums and final CI gates will be verified before any server transfer. No local
image build, local temporary download or E-drive test directory was used.

Settings gate subsequently passed: **173 browser cases**, plus **1** fresh
PostgreSQL archive restore. The formerly failing 768px Chinese regeneration,
forced polling/option-change race, both same-document account-switch races and
all three Task Center export cases explicitly passed. Image gates are pending.

Final synthetic screenshots from settings artifact **11408998920** are under
`docs/evidence/task-center-2026-10-06/final/`. All three (375px Chinese/light,
768px English/dark, 1440px Chinese/light) were visually inspected: source/format/time
remain distinguishable, controls fit, and incorrect terminal 2 / 1 is absent.
These supersede the parent directory's intermediate screenshots for final UI
acceptance. Actual ZIP contents and persisted counters were asserted by the tests.

## Final release provenance and production acceptance

All five gates in CI **37453812341** passed for source
**25c7f6a16f72780b08b22f1f3bf23665ebfd300c**. No unchanged workflow rerun was needed.
Original artifact **11409659316**, attempt **1**, contains a **193,619,321-byte**
archive with SHA-256 **87f058fbc0797fd249d062fe6346b5b4bd9a2f694950726244642a1a950e2eae**.
All 50 image archive blobs/configs, image labels and 17 exact-source support paths
were independently checked. Transfer hashes matched on the server.

| Runtime | Image ID |
|---|---|
| API / worker / migrate | `sha256:22e067c1f2086f358720164519b473bd111f0e0533bf655a41ed17946045df74` |
| Web | `sha256:17bb70be10e0a17fb9802d43aa3fe8b4b6d1941cf235ea2a7215c05bf4580e26` |

Space preflight passed using the actual live f0e355a baseline. Consistent five-part
backup **chat-reader-20261006T113958Z** was produced and verified while API/worker
writes were stopped. Three identical components were reused, avoiding **623,608,310
bytes**; this is same-filesystem deduplication, not an off-site recovery copy.

Operational interruptions are not hidden or counted as success:

- Initial transfer used a Path method absent from host Python 3.6.8. It failed
  before writing a member; only the empty, exact release directory was reused
  after replacing the containment check with compatible `commonpath` logic.
- The first start attempt could not read a 0600 mounted check script as the API's
  non-root user. No migration ran; the recovery trap restored healthy old API and
  worker. Only `data-check.py` and `export-retention-smoke.py` were made readable
  (0644 inside the private host release directory). The existing recent backup
  was reverified, the old worker confirmed idle, then writes were stopped again.
- An stdin-fed resume completed only prechecks because Docker consumed remaining
  shell input. No migration/start marker existed. The command was rerun with the
  script passed as a quoted shell argument, preserving its complete instruction stream.
- First acceptance observed Web health `starting`; no functional smoke had run.
  After health became `healthy`, acceptance ran successfully. No blind CI rerun,
  production schema downgrade or canonical-data restoration was performed.

Migration remained **0048 head/current** and administrator configuration was unchanged.
Only API/worker/Web were recreated from CI images. PostgreSQL identity and start time
were unchanged. Canonical counts, personal Skill fingerprints, **301 attachment SHA-256
checks**, and imports/offline file fingerprints were identical before/after migration
and acceptance. Environment, Compose and Nginx were preserved.

Production acceptance passed login, 14 settings/read-only endpoints, guidance and
three exact default ZIPs; unauthorized upload/private-download checks; four direct
formats; batch ordered CanJSON/idempotency and persisted source; both attachment
formats with **74 actual object checksums**, manifest counts and persisted source/
format/1-package counters; physical close reclamation, Range/Context ZIP and
regeneration idempotency. Historical expired artifacts remained physically reclaimed.
No raw production files or bodies were saved as evidence. A full interactive
production browser matrix is not claimed; synthetic three-width browser evidence
comes from CI. SMTP remains unconfigured.

The current release pointer now records 25c7f6a. API/Web/PostgreSQL are healthy,
worker heartbeat is alive/idle; startup checks found no restart/OOM/error keywords.
Public HTTPS health is 200 and HTTP redirects with 301.

After acceptance, verified backup pruning removed one older backup and retained
**chat-reader-20261006T093548Z** and **chat-reader-20261006T113958Z**. Four replaced
f0e355a image tags were removed, reclaiming **284,909,568 bytes** at that step.
The verified recovery archive remains at
`/opt/chat-reader/releases/f0e355af4169ff593da8134b8148c7dc5c25425d/chat-reader-images.tar.gz`,
SHA-256 `2bc83c979a90a07178a01e0e7927d05826bc08925123beca0908ecc64441fb06`.
Load it before using rollback-images.env; no database downgrade is needed.

Post-cleanup source/health/configuration checks passed. Final available server
space: **15,674,314,752 bytes (14.60 GiB)**. No business volume or local residue
was deleted, no image was built locally/on the server, and no off-site/scheduled
backup was introduced. Redacted machine-readable evidence is in the stage's
`release-provenance.json` and `production-acceptance.json` files.

This stage is complete. The broad optimization goal remains active; future work
starts from a fresh audit and must not replay this release's completed operations.
The unrelated prior Next stream-close observation remains unproven.
