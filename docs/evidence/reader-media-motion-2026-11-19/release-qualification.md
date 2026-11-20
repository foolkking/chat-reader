# First signed-release qualification: short Reader input pause

- Protected `v0.1.0` peels to `71f5b7ef48e7190d38266aa1cbc6bdd9d0cd5c4b`.
  Parent `44531165012/1` dispatched `44531226887/1`. Web shard 1,
  job `135584775550`, failed the original wheel monotonicity assertion. The
  later missing navigation/import evidence came from gates that never ran.
  Image inspection, rehearsal and publication were skipped; signing was not tested.
- Independently checked the failing shard artifact `14535315168`,
  SHA-256 `bb28c02fa82462f06206579a9b146fd2f440d38152f5342817129808449f09da`.
  Short fixture, mixed pointer/wheel: raw scroll offset went **2720 → 451**
  after **266.7 ms** without a coordinate change. The artifact did not track
  a shared reading-line anchor for that sample; raw motion alone cannot prove
  a 2269px jump of the text.
- Added a separate 450ms interruption control without changing the original
  gestures, budgets or jobs. Same synthetic fixture, Windows Chrome: exact
  old sources **2645 → 375** (real article offset 84.6875 → 84.71875).
  Fixed sources **2645 → 2645** (84.6875 unchanged); reverse wheel moved
  immediately without an extra turn read. All 46 mounted cases and 100
  focused Node tests passed. This does not certify a physical device,
  Linux qualification, production backup, or a signed release.

## Project sort native press

- Ordinary full CI `44542132920/1` at `eb988e698f0c48c7772bb601951574f3867d3732`:
  web shard 1 (Reader) passed; web shard 2, job `135622992281`, failed. Exact artifact
  `14540261311`, SHA-256 `fe61341d3919d0d842c87375ace06a1e32ef6a8e0f07b54b1b2db0f10d0108f0`.
  Source Editor/mutation gate: 120/121 passed. The 375px empty-project case timed out
  waiting for the manual-sort item; the native failure snapshot shows a closed trigger,
  not a rendered menu with the wrong selector. The trace was disabled in the existing
  suite, so the exact ordering of pointer and fetch events on that runner is unknown.
- Reproduced a concrete path to the same symptom using the real React Query hook, menu and
  Chromium: after native pointer-down, apply the account's project-directory sort and hold
  that reordered list read until pointer-up. Previously the metadata query changed keys,
  the native button became disabled mid-press, and its click was lost. Read a project's
  sort metadata using a stable existing list key, independent of directory presentation.
  A missing/failed read still cannot authorize a write; the server checks the sort revision.
- Red on the unchanged hook; green on the fixed hook. At 375/1440px and zh-CN/en-US every
  press opened the menu and only choosing manual order produced one project-scoped write.
  The full mounted navigation/import matrix passed 44 cases; 83 focused tests, lint and
  typecheck passed. This is not a claim that the original failing end-to-end gate has rerun.

## Subsequent exact full CI

`a3512d7103fd8d5f2b9fc3941ba206cf50313f1c`, ordinary full run `44551142239/1`,
finished successfully at **2026-11-19 15:28:58 UTC**. All 19 exact jobs succeeded,
including the original Reader and Source Editor/mutation gates. Read after a real
`Start-Sleep -Seconds 1500` (1500.085 seconds); no prior-run reuse or weakened tests.

Artifact `14545625537`, ZIP digest
`2bf3acea7e03aebde944e5000512bc123116c86e8ecfc24b68cab00170de6f58`,
was actually downloaded. The unmodified candidate/quality/archive verifiers checked
the contained proofs, five memory controls, config/layer graph and exact source/run/attempt.
Image archive: 177,674,617 bytes, SHA-256
`cd1effad1d69dc1fe909b6398985ecd6ec5ab9e6f8e00ad9f8db9eed1c7d25bd`.
This unsigned CI archive is **not a signed Release package**.

PR #2 includes both fixes; PR #1 was closed only after verifying its commit was an
ancestor. Ruleset `br` prohibits updates to all branches, with no bypass actor; the
existing branch could not accept a normal fast-forward, and the replacement PR is
blocked despite having no merge conflict. No rule was changed or release-history
tag rewritten. Publishing/signing are still untested beyond their configuration
checks, and no new tag or production deployment was attempted. Fresh capacity
arithmetic for these exact bytes is positive but does not constitute deployment
admission. [Machine-readable checkpoint](ci-and-publication-checkpoint.json).

## Signed v0.1.1 and production deployment — 2026-11-20

PR #2 subsequently merged. The merge has the same tree but a different SHA, so it was qualified again.
For `44568680941/1`, all 19 exact-source jobs and the isolated rehearsal passed. The publisher failed
at `docker push`; the original API tag matched that attempt's independently verified OCI index and the
Web tag was absent. Docker's raw diagnostic was not retained: a network, registry or authorization root
cause cannot be inferred from that trace alone. No Release was published from that attempt.

After a complete rerun with a fresh qualification (`44576778073/1`), both the rehearsal and
`44568680941/2` publication passed. Both Ed25519 signatures, the exact archive, and both public GHCR
digest readbacks matched. `king` was then deployed via its manual path; the optional host updater was
not enrolled. See the [deployment and timings](../../deployment.md#v011-production) and the
[exact redacted receipt](v0.1.1-production.json).
