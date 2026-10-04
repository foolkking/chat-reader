# Whole-site UX deployment — 2026-10-04

Production `https://chat.king.2bd.net` runs implementation
`5ef984af86d6b36b7cfac8f1a82d8118d6434d51`, built and inspected by successful
[CI 37208932974](https://github.com/foolkking/chat-reader/actions/runs/37208932974),
attempt 1. The user authorized deployment and removal of superseded images.
Later documentation commits do not alter the deployed application image.

## Provenance and recovery

| Item | Verified result |
|---|---|
| GitHub artifact | 195,311,630 bytes; SHA-256 `ec6f3d0310dfd7e143a3bad07d07e22119dd7ad06ffeb55841a31f0b57e30d93` |
| API/worker image | `sha256:abf92e25638b309e74aa0ae5181179bac10305b40af48005ae60c20692c87101` |
| Web image | `sha256:7261f32c77f94c8d8fd59ae98b53fc15b3f7605ded139831605c9c326ecb3808` |
| Backup | `/opt/chat-reader/backups/chat-reader-20261004T151827Z` |
| Migration | `20261003_0046`, unchanged single head/current |
| Release records | `/opt/chat-reader/releases/5ef984af86d6b36b7cfac8f1a82d8118d6434d51/` |

Capacity preflight passed before service changes. API/worker writes were stopped
for a consistent PostgreSQL/import/export/offline/asset backup. All five checksums,
archive readability and PostgreSQL restore listing passed. Only prebuilt API,
worker and Web were recreated with `--no-build`; PostgreSQL identity/start time,
deployment administrator configuration and `.env.production` remained unchanged.
Canonical counts, personal Skill fingerprints and all 301 attachment checksums
match before/after. There are no personal Skill rows in this production snapshot;
nonempty preservation relies on the separately recorded synthetic tests.

## Production acceptance and gateway correction

- API, Web and PostgreSQL healthy; worker `alive_idle`, zero processing tasks,
  zero container restarts/OOMs and zero startup error keyword lines.
- Public health, authenticated login and twelve read-only settings/capability
  requests pass. Application build metadata matches the deployed revision.
- All three default Skill ZIP checksums and download headers match pinned files.
- Real browser acceptance at 375/768/1440px covers account, help and Skill settings,
  Task Center keyboard closure and search-filter expansion/collapse without
  horizontal overflow or page errors. No content or preference was written;
  the smoke session was revoked and private requests then return 401.
- Full mutation, offline and settings acceptance remains the CI/synthetic evidence
  in [UX execution](WHOLE_SITE_UX_2026-10-04.md), not an assertion that production
  user content was edited during deployment.

The first two 12 MiB anonymous Context upload probes returned 502. Nginx reported
`writev() failed (32: Broken pipe) while sending request to upstream`, while API
and Web remained healthy. Both scoped Context/Skill upload locations now clear
the upstream `Connection` header with `proxy_set_header Connection ""`, preserving
early 401 responses during streaming. Limits, authentication and routes are unchanged.
The prior snippet is retained as `context-upload.before.conf` in the release folder.
`nginx -t` and reload passed. The original full probe then passed, followed by
eight separate 1 KiB/12 MiB probes, all 401. The source Nginx template matches
the effective change. This server configuration correction was verified live;
it is not represented as part of the previously built application image.

A helper initially used Python's newer `capture_output` option on the server's
Python 3.6 and stopped before reload. It was corrected to supported subprocess
arguments, then syntax validation and reload succeeded. Failed attempts above
are retained rather than counted as passes.

## Requested old-image cleanup

After successful acceptance, removed 12 exact Chat Reader tags for revisions
`0219fd5`, `ad223cd` and `5877558` across API/Web/worker/migrate. Each image's
revision label and absence from all running or stopped container references was
checked twice; removal used explicit tags without force or global pruning.
Only current `5ef984a` Chat Reader tags remain. Unrelated images, all business
volumes, production configuration, backups and local workstation residues were
untouched. Post-cleanup services and public health pass again.

Filesystem free space increased by **842,178,560 bytes (about 803 MiB)**, from
4,188,422,144 to 5,030,600,704 bytes. Shared layers mean removed tag sizes cannot
be summed to estimate reclaimed storage.

The previous `0219fd5` image archive is retained and checksum-verified at
`/opt/chat-reader/releases/0219fd5c5facfd6c57a5d651e74e7e58ff6b62eb/chat-reader-images.tar.gz`
(SHA-256 `3e267f3a53611d36f9298a8b8651ef77a48ca8a4868a21a1ee5d6daf78d9f778`).
Rollback now requires **docker load of this archive before using rollback-images.env**;
the server records this in `/etc/chat-reader/release-state/rollback-requires-load.txt`.
Do not assume the old tags are still locally installed. Backup restoration is a
separate operation and was not performed.
