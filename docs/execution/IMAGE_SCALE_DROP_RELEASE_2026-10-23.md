# Compact image scale and bounded file drop — 2026-10-23

## Accepted release

Runtime source **`0f116fe012bc1ed39eced7d9289caf94975f336e`** was accepted at
**2026-10-23 05:00:36 UTC / 13:00:36 +08:00**. The lower-right floating image
control shows only the saved percentage and opens a downward 1–100% selector.
Original bytes, original-relative sizing and stable/public-link behavior remain
unchanged. Workspace file drags dim/blur the background; only the central target
or sidebar Import button opens Import. Ordinary page drops are ignored, while
source-editor attachment uploads and Context continuation retain local ownership.
No API, dependency, migration, offline package or Dexie change.

The current contracts are
[image display](../system/MESSAGE_MARKDOWN_COPY_CONTRACT.md#owner-selected-image-size)
and [bounded import](../system/ADAPTIVE_IMPORT_CONTRACT.md). This dated record is
release evidence, not an independent contract.

## Submission and CI

The user stopped further local validation and authorized commit, CI and deployment.
Earlier lint/typecheck/build had passed; no additional local or authenticated
production-browser suite was run after that instruction. A strict-mode-ambiguous
test locator was corrected to the unique `main` before submission. Existing
`apps/web/tsconfig.tsbuildinfo` was excluded and preserved in the worktree.

Full run **`39897308692` attempt 1** passed all five jobs: API, Web, Settings,
image build and independent artifact inspection. Dispatch completed at
**03:52:24.6460641 UTC**; the required 50-minute deadline was
**04:42:24.6460641 UTC**. First read at **04:42:24.911302 UTC** found all three
quality jobs passed and images still building. Final success read was
**04:45:40.157233 UTC**. No CI restart or gate waiver occurred.

The downloaded exact-source artifact matches its official ZIP digest and
source/run/producer manifest. Independent inspection verified **35 OCI blobs,
343 source files and 21,333 layer entries**, embedded source revision, new
selector/drop markers and actual Next/DOMPurify versions; no forbidden paths.
Image archive SHA-256:
`0206a63ac24f169979dc107bf3c3bb125a053bc947471daf5fb89b1392a9c0e7`.
The fourth workflow-declared Nginx fragment was source-verified only, not applied.

## Deployment and recovery

Initial staging confirmed the previous exact runtime `cfaa6ed`, healthy services,
zero admitted background work and single/current **`20261022_0053`**.
Combined capacity passed with **4,852,260 KiB available / 4,009,773 KiB required**.
The first driver exited before maintenance because old server Python rejected
the Windows timestamp's seventh fractional digit. A task-owned second driver
rounds fractional UTC timestamps upward to microseconds, preserving the full
wait requirement. The application source/CI artifact did not change.

The second attempt stopped only Web/API/worker and passed the read-only SHA
attachment audit and stopped-writer memory/data gates. Five-component backup
**`chat-reader-20261023T045237Z`** passed checksums, four tar streams and
PostgreSQL TOC verification. Three byte-identical components reuse hardlinks;
logical snapshots are not independent physical copies.

King loaded CI images and recreated applications with **`--no-build`**.
Migration preflight/upgrade/current checks had no schema work to perform:
0053 and seven canonical table counts remained unchanged. PostgreSQL identity,
start/restarts, production environment/Compose and existing Nginx privacy route
were unchanged. No Nginx reload, production build, volume/import deletion or
backup/image/transfer pruning occurred.

API/Web health, fresh worker heartbeat, exact runtime images, HTTPS/login,
HTTP-to-HTTPS redirect and anonymous-denial/no-store boundaries passed.
Applications have zero restarts/OOM and startup-error keywords; no new kernel
OOM event and no host OOM-counter increment occurred.
Current/direct rollback is **`0f116fe/cfaa6ed`**, both 0053: do not downgrade.
Planned maintenance was **12:52:17–13:00:36 +08:00**, not zero downtime.

No authenticated production UI, installed external Markdown client, full
accessibility or sustained-load acceptance is claimed. Final documentation-only
commits do not change the deployed runtime source.
See the [sanitized receipt](../evidence/image-scale-drop-release-2026-10-23.json).
