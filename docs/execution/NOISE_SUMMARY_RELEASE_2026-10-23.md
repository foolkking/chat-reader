# Noise rules, thinking summaries and pending image slider — 2026-10-23

## Scope and authority

The approved implementation preserves summaries at import/legacy auto-clean,
uses conservative shared Reader/Share/Offline folding, defaults the summary
noise rule off only without personal preferences, and corrects matching,
uncertainty confirmation and literal editing/trials. Historical deleted text is
not restored automatically. No migration, offline format or Dexie change;
source has the single head `20261022_0053`.

The workspace already contained the continuous image-scale slider with
25/50/75/100% fast-drag attraction. Those changes are retained. After initially
holding submission, the user authorized deployment of the completed pending
work using the existing release procedure.

## Local verification

- 61 related API modules in fresh processes: **467 passed / 50 conditional
  skips**. Final supplemental noise/Reader/Share regression: **44 passed**,
  including repeated coverage and four additional cases. Local integration
  uses synthetic SQLite, not PostgreSQL concurrency acceptance.
- All 72 service-free UX files: **1,560 passed / zero skipped**.
- Real Next/API/single-worker Chrome: **21 passed**, covering cleanup, summary
  preservation/folding across Reader/Share/cached Offline, long normalized
  rule editing/trials, and the full cached-library suite.
  The final focused rerun is **6 passed**, including saving the edited rule
  and checking that its all-role scope remains `null` on the server.
- Separate PWA negative build: **6 passed** for actual v1/v2/v3 package
  compatibility, malformed replacement preservation, bounded writes and
  transaction-abort recovery. This is not the full negative matrix.
- Pending slider's actual-control browser fixture: **4 passed** desktop/mobile
  light/dark combinations; persistence and surrounding Reader remain adapters.
- CI image-source/PostgreSQL-service and offline-shell contracts: **67 passed**.
- Web lint, typecheck and bounded production build pass. The final browser
  rerun uses the production build, not the development server.

Earlier failures are not passing evidence: stale expectations, an introduced
inline-code scan cursor loop and underscore normalization bug were corrected;
the rich-text fixture exposed missing inherited summary formatting, now fixed.
First browser fixtures did not claim noise jobs, retained Web auth gating and
used the wrong creation message count. Retry corrected those fixture errors
without weakening production controls. One added API test ran with its old
route constant while being corrected on disk; its clean rerun passes.
The repeated browser fixture initially reused a deliberately saved exception
for the same rule/context; it now gives each run unique synthetic context and
removes its own exception, without changing product exception persistence.

All data and outputs are synthetic and task-local. No production authenticated
UI, installed external-client, full accessibility or sustained-load acceptance
is claimed.

## Release procedure and current state

Initial source `c08953b806351766343ba15e43b7923199e8c44b` was submitted.
Full workflow `39949370623` attempt 1 was dispatched at
**2026-10-23 11:54:09 UTC** and first read at **12:44:32 UTC**, after its
50-minute gate. Settings passed; API/Web failed; image build/inspection skipped.
No artifact was deployed.

- API: one historical import test still expected destructive summary deletion.
  It now checks the preserved canonical opening. Its module rerun: **2 passed**.
- Web: the 1440px real Markdown-copy case could not click the 100% preset;
  the sticky section TOC intercepted pointer events. Viewport-only placement
  also double-counted the translated content column's fixed containing-block
  origin. Placement now converts that origin and avoids visible sticky rails.
  The first local geometry-only repair still failed the actual Reader, which
  exposed the containing-block issue; it was not treated as passing evidence.
  Pure placement/snap checks: **14 passed**. Actual-control Chrome fixtures,
  now including a translated ancestor and sticky TOC: **4 passed**.
  All service-free UX tests: **1,565 passed**. Final real production-build
  Reader/Share/cached-Offline/rule-edit/Markdown-copy rerun: **5 passed** at
  1440/375px, including the once-occluded 100% preset. Lint, typecheck and
  production build pass; no timeout increase, forced click or weakened gate.

The user separately authorized old-copy deletion after the read-only capacity
check. Only 18 older `releases/<sha>/chat-reader-images.tar.gz` transfer archives
were removed, freeing **3,563,187,653 bytes (~3.32 GiB)**. The latest three,
including current and rollback, remain. No backups, Docker images, volumes,
imports, configuration or release verification records were deleted.
Production services remained healthy at `0f116fe`, schema 0053, admission idle.

## Final CI, artifact and production acceptance

Corrected exact source `18d4971339a0927bdf4120680aa16ce36365098d` was pushed
and dispatched in [workflow run 39958042690](https://github.com/foolkking/chat-reader/actions/runs/39958042690)
at **2026-10-23 21:03:08 +08:00**. The result was first read at
**21:53:23 +08:00**, after the required 50-minute wait. All five required jobs
were green. The official artifact was independently accepted: 35 OCI blobs,
343 exact source files, archive SHA-256
`ca93e8fa803ffaf23948a8132a1653a5fc3d9e87fb38b4fde80affb331ff2c50`, embedded
API revision exact, no forbidden paths, and compiled markers for summary
folding, safe rule matching/trials, image controls and sticky-rail placement.

Production preflight confirmed current `0f116fe`, direct rollback `cfaa6ed`,
schema `20261022_0053`, idle admission, 7.46 GB free before maintenance and no
pending writers. Read-only attachment audit verified **345/345** stored files
and SHA-256 values with zero issues. Application writers were stopped only for
the maintenance window **2026-10-23 21:58:23–22:06:42 +08:00**. The verified
five-component backup is `chat-reader-20261023T135839Z`; its manifest, hashes
and PostgreSQL restore TOC passed.

The CI images were loaded without local/server build. Migration remained at
0053 with canonical row counts unchanged; PostgreSQL, production env/Compose,
Nginx and the existing public-image privacy location were unchanged. API,
worker and Web now all carry the exact `18d4971` revision, are healthy/running
with restart/OOM counts zero, startup logs clean, HTTPS and denial checks pass,
and no new kernel OOM event occurred. Final capacity was **6,564,728 KiB**
available. Direct rollback remains `0f116fe`; no schema downgrade is needed.
Authenticated production UI, installed external client and sustained-load
acceptance remain unclaimed.

The corrected source needed a new complete CI and a fresh 50-minute wait.
Exclude and preserve the pre-existing generated
`apps/web/tsconfig.tsbuildinfo`. Use the complete `Build release images`
workflow, including the existing cleanup gate now explicitly enabling the new
thinking-summary suite.

For **each dispatch/retry**, wait at least 50 minutes before reading CI results.
Only a five-green exact-source run and independently verified official artifact
may proceed to staging. Recheck current runtime/rollback identity, capacity and
idle background work. Stop only Web/API/worker, verify a five-component backup,
use CI images with `--no-build`, keep PostgreSQL/config/Nginx unchanged and
perform runtime/HTTPS/denial/OOM acceptance before recording success.

Do not prune backups/images, delete volumes/imports, restore historical text,
build production images locally/on the server, or automatically downgrade.
The preceding accepted runtime is `0f116fe`; it must be reverified, not assumed.
